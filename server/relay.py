"""手機遙控轉送。

教室電腦（screen）連上 /ws/screen 取得 6 位數代碼；手機（remote）用代碼連上 /ws/remote。
學生投票：教室電腦送 vote-open 取得另一組「投票代碼」，學生用它連上 /ws/vote，只能送出投票，不能遙控白板。
新的手機要等老師在教室電腦上按「允許」才能遙控；允許過的裝置（key）在代碼更換前重新連線不用再問。
伺服器只轉送訊息，不保存任何資料。
"""
from __future__ import annotations

import asyncio
import re
import secrets
import time
from collections import defaultdict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

ROOM_KEEP_SEC = 600          # 教室電腦斷線後保留代碼的時間（重新連線可沿用）
MAX_REMOTES = 8              # 每個白板最多同時連線的遙控裝置
MAX_VOTERS = 200             # 每個投票最多同時連線的學生
MAX_MSG = 256 * 1024
MAX_PENDING = 3              # 同時等待老師允許的手機
ASK_SEC = 60                 # 老師沒有回應時自動拒絕
KEY_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
PK_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")     # 手機的一次性公鑰（沒有加密金鑰時，見 static/js/remote-crypto.js）
BOX_RE = re.compile(r"^[A-Za-z0-9_-]{100,200}$")  # 用手機公鑰加密的遙控金鑰


class Room:
    def __init__(self, code: str):
        self.code = code
        self.secret = secrets.token_urlsafe(24)
        self.screen: WebSocket | None = None
        self.remotes: set[WebSocket] = set()
        self.state: dict | None = None
        self.gone_at: float | None = None
        self.vote_code: str | None = None   # 學生投票用的代碼（沒有開放投票時為 None）
        self.poll: dict | None = None
        self.voters: dict[str, WebSocket] = {}
        self.next_voter = 0
        self.allowed: set[str] = set()                       # 老師允許過的手機（裝置 key）
        self.pending: dict[str, asyncio.Future] = {}         # 等待老師允許的手機
        self.next_pending = 0


rooms: dict[str, Room] = {}
vote_rooms: dict[str, Room] = {}
join_fail: dict[str, list[float]] = defaultdict(list)


def _cleanup() -> None:
    now = time.time()
    for ip in [ip for ip, ts in join_fail.items() if all(now - t >= 300 for t in ts)]:
        join_fail.pop(ip, None)
    for code, r in list(rooms.items()):
        if r.screen is None and r.gone_at and now - r.gone_at > ROOM_KEEP_SEC and not r.remotes and not r.voters:
            rooms.pop(code, None)
            if r.vote_code:
                vote_rooms.pop(r.vote_code, None)


def _new_code() -> str:
    while True:
        code = f"{secrets.randbelow(1_000_000):06d}"
        if code not in rooms and code not in vote_rooms:
            return code


async def _send(ws: WebSocket, msg: dict) -> None:
    try:
        await ws.send_json(msg)
    except Exception:  # noqa: BLE001
        pass


async def _broadcast(room: Room, msg: dict) -> None:
    for ws in list(room.remotes):
        await _send(ws, msg)


async def _receive(ws: WebSocket) -> dict | None:
    text = await ws.receive_text()
    if len(text) > MAX_MSG:
        return None
    try:
        import json

        msg = json.loads(text)
    except ValueError:
        return None
    return msg if isinstance(msg, dict) else None


async def _broadcast_voters(room: Room, msg: dict) -> None:
    for ws in list(room.voters.values()):
        await _send(ws, msg)


async def _close_vote(room: Room) -> None:
    voters = list(room.voters.values())
    room.voters.clear()
    if room.vote_code:
        vote_rooms.pop(room.vote_code, None)
    room.vote_code = None
    room.poll = None
    for v in voters:
        await _send(v, {"type": "closed"})
        try:
            await v.close()
        except Exception:  # noqa: BLE001
            pass


def _device_name(ua: str) -> str:
    """從瀏覽器的 User-Agent 猜是哪種裝置，讓老師判斷是不是自己的手機。"""
    for key, name in (("iPhone", "iPhone"), ("iPad", "iPad"), ("Android", "Android 手機／平板"),
                      ("Windows", "Windows 電腦"), ("Macintosh", "Mac 或 iPad"), ("CrOS", "Chromebook")):
        if key in ua:
            return name
    return "不明裝置"


def _deny_pending(room: Room, reason: str) -> None:
    """拒絕所有等待中的手機（換代碼、教室電腦離線時）。"""
    for fut in room.pending.values():
        if not fut.done():
            fut.set_result((False, reason, ""))
    room.pending.clear()


def _is_code(v: str) -> bool:
    return len(v) == 6 and v.isdigit()


def _new_room() -> Room:
    room = Room(_new_code())
    rooms[room.code] = room
    return room


@router.websocket("/ws/screen")
async def ws_screen(ws: WebSocket):
    await ws.accept()
    _cleanup()
    try:
        hello = await _receive(ws) or {}
    except WebSocketDisconnect:
        return
    room = rooms.get(str(hello.get("code", "")))
    if not room or not secrets.compare_digest(room.secret, str(hello.get("secret", ""))):
        room = _new_room()
    elif room.screen is not None:
        await _send(room.screen, {"type": "replaced"})
        try:
            await room.screen.close()
        except Exception:  # noqa: BLE001
            pass
    room.screen = ws
    room.gone_at = None
    await _send(ws, {"type": "room", "code": room.code, "secret": room.secret, "remotes": len(room.remotes)})
    await _broadcast(room, {"type": "screen", "online": True})
    await _broadcast_voters(room, {"type": "screen", "online": True})
    try:
        while True:
            msg = await _receive(ws)
            if not msg:
                continue
            t = msg.get("type")
            if t == "state":
                room.state = msg.get("state")
                await _broadcast(room, {"type": "state", "state": room.state})
            elif t == "notice":
                if isinstance(msg.get("box"), str):  # 加密的提示（手機才解得開）
                    await _broadcast(room, {"type": "notice", "box": msg["box"][:4000]})
                else:
                    await _broadcast(room, {"type": "notice", "text": str(msg.get("text", ""))[:200]})
            elif t == "kick":
                # 中斷所有遙控並換一組新代碼，舊代碼立即失效
                for r in list(room.remotes):
                    await _send(r, {"type": "kicked"})
                    try:
                        await r.close()
                    except Exception:  # noqa: BLE001
                        pass
                room.remotes.clear()
                rooms.pop(room.code, None)
                room.code = _new_code()
                room.secret = secrets.token_urlsafe(24)
                room.allowed.clear()
                _deny_pending(room, "老師已更換代碼，請重新掃描電視上的 QR Code")
                rooms[room.code] = room
                await _send(ws, {"type": "room", "code": room.code, "secret": room.secret, "remotes": 0})
            elif t == "join-answer":
                fut = room.pending.pop(str(msg.get("id", "")), None)
                if fut and not fut.done():
                    box = msg.get("box")  # 手動輸入代碼的手機：加密過的遙控金鑰
                    fut.set_result((msg.get("ok") is True, "老師沒有允許這台裝置遙控",
                                    box if isinstance(box, str) and BOX_RE.match(box) else ""))
            elif t == "vote-open":
                # 開放學生投票（或更新題目）；可指定沿用原本的投票代碼，讓學生斷線後自動連回
                if not room.vote_code:
                    want = str(msg.get("code", ""))
                    room.vote_code = want if _is_code(want) and want not in rooms and want not in vote_rooms else _new_code()
                    vote_rooms[room.vote_code] = room
                room.poll = msg.get("poll") if isinstance(msg.get("poll"), dict) else None
                await _send(ws, {"type": "vote-room", "code": room.vote_code, "voters": len(room.voters)})
                await _broadcast_voters(room, {"type": "poll", "poll": room.poll})
            elif t == "vote-close":
                await _close_vote(room)
                await _send(ws, {"type": "vote-room", "code": "", "voters": 0})
            elif t == "vote-ack":
                voter = room.voters.get(str(msg.get("to", "")))
                if voter:
                    await _send(voter, {"type": "ack", "ok": bool(msg.get("ok")), "text": str(msg.get("text", ""))[:200], "choice": msg.get("choice")})
    except WebSocketDisconnect:
        pass
    finally:
        if room.screen is ws:
            room.screen = None
            room.gone_at = time.time()
            _deny_pending(room, "教室電腦目前沒有連線，請稍後再試")
            await _broadcast(room, {"type": "screen", "online": False})
            await _broadcast_voters(room, {"type": "screen", "online": False})


@router.websocket("/ws/remote")
async def ws_remote(ws: WebSocket, code: str = "", key: str = "", pk: str = ""):
    await ws.accept()
    if not KEY_RE.match(key):
        key = ""
    if not PK_RE.match(pk):
        pk = ""
    ip = ws.client.host if ws.client else "?"
    now = time.time()
    join_fail[ip] = [t for t in join_fail[ip] if now - t < 300]
    if len(join_fail[ip]) >= 20:
        await _send(ws, {"type": "error", "message": "嘗試次數過多，請 5 分鐘後再試"})
        await ws.close()
        return
    room = rooms.get(code)
    if not room:
        join_fail[ip].append(now)
        await _send(ws, {"type": "error", "message": "代碼錯誤或已失效，請重新掃描電視上的 QR Code"})
        await ws.close()
        return
    if len(room.remotes) >= MAX_REMOTES:
        await _send(ws, {"type": "error", "message": "連線的裝置太多了"})
        await ws.close()
        return
    key_box = ""
    # 沒有加密金鑰的手機（帶 pk）即使允許過也要再問一次，老師允許時才交得到金鑰
    if pk or not (key and key in room.allowed):
        # 第一次連線的手機：請老師在教室電腦上允許（允許前看不到白板內容，也不能送指令）
        err = ("教室電腦目前沒有連線，請稍後再試" if room.screen is None
               else "有其他裝置正在等待老師允許，請稍後再試" if len(room.pending) >= MAX_PENDING else "")
        if err:
            await _send(ws, {"type": "error", "message": err})
            await ws.close()
            return
        room.next_pending += 1
        pid = str(room.next_pending)
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        room.pending[pid] = fut
        await _send(ws, {"type": "wait"})
        await _send(room.screen, {"type": "join-request", "id": pid, "device": _device_name(ws.headers.get("user-agent", "")), "ip": ip, "pk": pk})
        try:
            ok, reason, key_box = await asyncio.wait_for(asyncio.shield(fut), ASK_SEC)
        except asyncio.TimeoutError:
            ok, reason = False, "老師沒有回應，請再試一次"
        room.pending.pop(pid, None)
        if room.screen:
            await _send(room.screen, {"type": "join-gone", "id": pid})
        if not ok or room.code != code:
            join_fail[ip].append(time.time())  # 被拒絕也算失敗，避免一直跳出詢問
            await _send(ws, {"type": "error", "message": reason if not ok else "代碼已更換，請重新掃描電視上的 QR Code"})
            await ws.close()
            return
        if key:
            room.allowed.add(key)
    room.remotes.add(ws)
    hello = {"type": "hello", "online": room.screen is not None, "state": room.state}
    if key_box:
        hello["key"] = key_box
    await _send(ws, hello)
    if room.screen:
        await _send(room.screen, {"type": "remotes", "count": len(room.remotes), "joined": True})
    try:
        while True:
            msg = await _receive(ws)
            if not msg or msg.get("type") != "cmd":
                continue
            if room.code != code:  # 代碼已更換（被中斷）
                break
            if room.screen and isinstance(msg.get("box"), str):  # 加密的指令，原樣轉送
                await _send(room.screen, {"type": "cmd", "box": msg["box"]})
            elif room.screen:
                await _send(room.screen, {
                    "type": "cmd",
                    "target": msg.get("target"),
                    "widgetId": msg.get("widgetId"),
                    "action": msg.get("action"),
                    "args": msg.get("args") if isinstance(msg.get("args"), dict) else {},
                })
            else:
                await _send(ws, {"type": "notice", "text": "教室電腦目前沒有連線"})
    except WebSocketDisconnect:
        pass
    finally:
        room.remotes.discard(ws)
        if room.screen:
            await _send(room.screen, {"type": "remotes", "count": len(room.remotes)})


@router.websocket("/ws/vote")
async def ws_vote(ws: WebSocket, code: str = ""):
    """學生投票：只能收到題目、送出 {type: vote, name, choice}。"""
    await ws.accept()
    ip = ws.client.host if ws.client else "?"
    now = time.time()
    join_fail[ip] = [t for t in join_fail[ip] if now - t < 300]
    if len(join_fail[ip]) >= 20:
        await _send(ws, {"type": "error", "message": "嘗試次數過多，請 5 分鐘後再試"})
        await ws.close()
        return
    room = vote_rooms.get(code)
    if not room:
        join_fail[ip].append(now)
        await _send(ws, {"type": "error", "message": "投票代碼錯誤，或老師已經結束投票"})
        await ws.close()
        return
    if len(room.voters) >= MAX_VOTERS:
        await _send(ws, {"type": "error", "message": "連線的人數太多了"})
        await ws.close()
        return
    room.next_voter += 1
    vid = str(room.next_voter)
    room.voters[vid] = ws
    await _send(ws, {"type": "poll", "poll": room.poll, "online": room.screen is not None})
    if room.screen:
        await _send(room.screen, {"type": "voters", "count": len(room.voters)})
    try:
        while True:
            msg = await _receive(ws)
            if not msg or msg.get("type") != "vote":
                continue
            if room.vote_code != code:  # 投票已結束
                break
            try:
                choice = int(msg.get("choice"))
            except (TypeError, ValueError):
                continue
            if room.screen:
                await _send(room.screen, {"type": "vote", "from": vid, "name": str(msg.get("name", "")).strip()[:20], "choice": choice})
            else:
                await _send(ws, {"type": "ack", "ok": False, "text": "教室電腦目前沒有連線，請稍後再試"})
    except WebSocketDisconnect:
        pass
    finally:
        if room.voters.get(vid) is ws:
            room.voters.pop(vid, None)
        if room.screen:
            await _send(room.screen, {"type": "voters", "count": len(room.voters)})
