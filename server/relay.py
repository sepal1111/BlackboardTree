"""手機遙控轉送。

教室電腦（screen）連上 /ws/screen 取得 6 位數代碼；手機（remote）用代碼連上 /ws/remote。
伺服器只轉送訊息，不保存任何資料。
"""
from __future__ import annotations

import secrets
import time
from collections import defaultdict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

ROOM_KEEP_SEC = 600          # 教室電腦斷線後保留代碼的時間（重新連線可沿用）
MAX_REMOTES = 8              # 每個白板最多同時連線的遙控裝置
MAX_MSG = 256 * 1024


class Room:
    def __init__(self, code: str):
        self.code = code
        self.secret = secrets.token_urlsafe(24)
        self.screen: WebSocket | None = None
        self.remotes: set[WebSocket] = set()
        self.state: dict | None = None
        self.gone_at: float | None = None


rooms: dict[str, Room] = {}
join_fail: dict[str, list[float]] = defaultdict(list)


def _cleanup() -> None:
    now = time.time()
    for code, r in list(rooms.items()):
        if r.screen is None and r.gone_at and now - r.gone_at > ROOM_KEEP_SEC and not r.remotes:
            rooms.pop(code, None)


def _new_code() -> str:
    while True:
        code = f"{secrets.randbelow(1_000_000):06d}"
        if code not in rooms:
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
                rooms[room.code] = room
                await _send(ws, {"type": "room", "code": room.code, "secret": room.secret, "remotes": 0})
    except WebSocketDisconnect:
        pass
    finally:
        if room.screen is ws:
            room.screen = None
            room.gone_at = time.time()
            await _broadcast(room, {"type": "screen", "online": False})


@router.websocket("/ws/remote")
async def ws_remote(ws: WebSocket, code: str = ""):
    await ws.accept()
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
    room.remotes.add(ws)
    await _send(ws, {"type": "hello", "online": room.screen is not None, "state": room.state})
    if room.screen:
        await _send(room.screen, {"type": "remotes", "count": len(room.remotes), "joined": True})
    try:
        while True:
            msg = await _receive(ws)
            if not msg or msg.get("type") != "cmd":
                continue
            if room.code != code:  # 代碼已更換（被中斷）
                break
            if room.screen:
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
