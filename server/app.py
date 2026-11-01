"""MyScreen 教室白板 — 伺服器。

負責：登入（用 SAMBA 帳密）、白板資料讀寫（存在使用者自己的 SAMBA 資料夾）、
瀏覽個人 SAMBA 檔案、上傳圖片，並提供前端靜態檔案。
"""
from __future__ import annotations

import json
import mimetypes
import re
import secrets
import sys
import threading
import time
import uuid
from collections import defaultdict
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

sys.path.insert(0, str(Path(__file__).resolve().parent))
from storage import AuthError, LocalStorage, SMBStorage, StorageError, split_rel  # noqa: E402
from relay import router as relay_router  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"

DEFAULT_CONFIG = {
    "mode": "local",
    "host": "0.0.0.0",
    "port": 8080,
    "session_hours": 12,
    "ssl_certfile": "",
    "ssl_keyfile": "",
    "data_dir": "MyScreen",
    "browse_root": "",
    "max_upload_mb": 20,
    "smb": {"server": "", "port": 445, "share": "{username}", "domain": "", "encrypt": False},
    "local": {"root": "./data/{username}", "users": {}},
}


def load_config() -> dict:
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    path = ROOT / "config.json"
    if path.exists():
        user = json.loads(path.read_text(encoding="utf-8"))
        for k, v in user.items():
            if isinstance(v, dict) and isinstance(cfg.get(k), dict):
                cfg[k].update(v)
            else:
                cfg[k] = v
    else:
        print("[MyScreen] 找不到 config.json，使用本機測試模式（資料存在 ./data）")
    # Docker／NAS 可以直接用環境變數指定，例如 MYSCREEN_MODE=relay
    import os
    if os.environ.get("MYSCREEN_MODE"):
        cfg["mode"] = os.environ["MYSCREEN_MODE"]
    if os.environ.get("MYSCREEN_PORT"):
        cfg["port"] = int(os.environ["MYSCREEN_PORT"])
    return cfg


CONFIG = load_config()
USERNAME_RE = re.compile(r"^[\w.\-@\\]{1,64}$")
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
COOKIE = "ms_token"

app = FastAPI(title="MyScreen", docs_url=None, redoc_url=None)
app.include_router(relay_router)


# ---------------------------------------------------------------- sessions
class Session:
    def __init__(self, username: str, storage):
        self.username = username
        self.storage = storage
        self.expires = time.time() + CONFIG["session_hours"] * 3600
        self.board_cache: dict[str, tuple[float, dict]] = {}


sessions: dict[str, Session] = {}
user_locks: dict[str, threading.Lock] = defaultdict(threading.Lock)
failed: dict[str, list[float]] = defaultdict(list)


def make_storage(username: str, password: str):
    mode = CONFIG["mode"]
    if mode == "relay":
        raise StorageError("這台伺服器只提供手機遙控，請改用網路磁碟機儲存白板")
    safe_user = username.split("\\")[-1]
    if mode == "smb":
        s = CONFIG["smb"]
        if not s.get("server"):
            raise StorageError("伺服器尚未設定 SAMBA 位址（config.json → smb.server）")
        return SMBStorage(
            server=s["server"],
            share=s["share"].replace("{username}", safe_user),
            username=safe_user,
            password=password,
            domain=s.get("domain", ""),
            port=int(s.get("port", 445)),
            encrypt=bool(s.get("encrypt", False)),
        )
    users = CONFIG["local"].get("users") or {}
    if users and users.get(username) != password:
        raise AuthError("帳號或密碼錯誤")
    root = CONFIG["local"]["root"].replace("{username}", safe_user)
    if not Path(root).is_absolute() and not root.startswith("\\\\"):
        root = str(ROOT / root)
    return LocalStorage(root)


def current(request: Request) -> Session:
    token = request.cookies.get(COOKIE) or request.headers.get("authorization", "").removeprefix("Bearer ")
    s = sessions.get(token or "")
    if not s or s.expires < time.time():
        if s:
            sessions.pop(token, None)
            s.storage.close()
        raise HTTPException(401, "請先登入")
    return s


def err(e: Exception):
    if isinstance(e, AuthError):
        return HTTPException(401, str(e))
    if isinstance(e, StorageError):
        return HTTPException(502, str(e))
    return HTTPException(500, f"伺服器錯誤：{e}")


def _tpl(key: str, s: Session) -> str:
    return CONFIG[key].replace("{username}", s.username)


def data_path(s: Session, *parts: str) -> str:
    return "/".join(split_rel(_tpl("data_dir", s)) + [p for p in parts if p])


def browse_path(s: Session, rel: str) -> str:
    return "/".join(split_rel(_tpl("browse_root", s)) + split_rel(rel))


def read_json(storage, rel: str, default=None):
    raw = storage.read_bytes(rel)
    if raw is None:
        return default
    try:
        return json.loads(raw.decode("utf-8"))
    except ValueError:
        return default


def write_json(storage, rel: str, obj) -> None:
    storage.write_bytes(rel, json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


# ---------------------------------------------------------------- auth
@app.get("/api/config")
def get_config():
    needs_password = CONFIG["mode"] == "smb" or bool(CONFIG["local"].get("users"))
    return {"mode": CONFIG["mode"], "needsPassword": needs_password,
            "server": CONFIG["smb"].get("server") if CONFIG["mode"] == "smb" else None}


@app.post("/api/login")
async def login(request: Request, response: Response):
    ip = request.client.host if request.client else "?"
    now = time.time()
    failed[ip] = [t for t in failed[ip] if now - t < 300]
    if len(failed[ip]) >= 10:
        raise HTTPException(429, "登入失敗次數過多，請 5 分鐘後再試")

    body = await request.json()
    username = str(body.get("username", "")).strip()
    password = str(body.get("password", ""))
    if not USERNAME_RE.match(username):
        raise HTTPException(400, "帳號格式不正確")

    def do_login():
        storage = make_storage(username, password)
        storage.check()
        return storage

    from starlette.concurrency import run_in_threadpool

    try:
        storage = await run_in_threadpool(do_login)
    except AuthError as e:
        failed[ip].append(now)
        raise HTTPException(401, str(e)) from e
    except StorageError as e:
        raise HTTPException(502, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"無法連線：{e}") from e

    token = secrets.token_urlsafe(32)
    sessions[token] = Session(username.split("\\")[-1], storage)
    response.set_cookie(COOKIE, token, httponly=True, samesite="strict",
                        secure=bool(CONFIG.get("ssl_certfile")),
                        max_age=CONFIG["session_hours"] * 3600)
    return {"username": sessions[token].username, "dataPath": data_in_browse(sessions[token])}


@app.post("/api/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE)
    s = sessions.pop(token or "", None)
    if s:
        s.storage.close()
    response.delete_cookie(COOKIE)
    return {"ok": True}


@app.get("/api/me")
def me(request: Request):
    s = current(request)
    return {"username": s.username, "dataPath": data_in_browse(s)}


# ---------------------------------------------------------------- boards
def data_in_browse(s: Session) -> str:
    """資料夾相對於可瀏覽根目錄的位置（前端用來組出圖片路徑）。"""
    data, browse = split_rel(_tpl("data_dir", s)), split_rel(_tpl("browse_root", s))
    return "/".join(data[len(browse):]) if data[: len(browse)] == browse else ""


def scan_boards(s: Session) -> list[dict]:
    """直接掃描 boards 資料夾，與桌面版／網頁資料夾模式寫入的檔案互通。只重讀有變動的檔案。"""
    try:
        files = s.storage.listdir(data_path(s, "boards"))
    except StorageError:
        return []
    out, seen = [], set()
    for f in files:
        name = f["name"]
        if f["dir"] or not name.endswith(".json") or name == "index.json" or not ID_RE.match(name[:-5]):
            continue
        bid = name[:-5]
        seen.add(bid)
        cached = s.board_cache.get(bid)
        if not cached or cached[0] != f["mtime"]:
            b = read_json(s.storage, data_path(s, "boards", name))
            if not isinstance(b, dict):
                continue
            meta = {"id": bid, "name": b.get("name", "未命名白板"), "rev": b.get("rev", 0),
                    "created": b.get("created", 0), "updatedAt": b.get("updatedAt", 0)}
            cached = (f["mtime"], meta)
            s.board_cache[bid] = cached
        out.append(cached[1])
    for bid in list(s.board_cache):
        if bid not in seen:
            s.board_cache.pop(bid, None)
    return out


@app.get("/api/boards")
def list_boards(request: Request):
    s = current(request)
    try:
        items = scan_boards(s)
    except Exception as e:  # noqa: BLE001
        raise err(e) from e
    items.sort(key=lambda b: b.get("created", 0))
    return {"boards": items}


@app.get("/api/boards/{board_id}")
def get_board(board_id: str, request: Request):
    s = current(request)
    if not ID_RE.match(board_id):
        raise HTTPException(400, "錯誤的白板代碼")
    try:
        b = read_json(s.storage, data_path(s, "boards", f"{board_id}.json"))
    except Exception as e:  # noqa: BLE001
        raise err(e) from e
    if b is None:
        raise HTTPException(404, "找不到白板")
    return b


@app.put("/api/boards/{board_id}")
async def put_board(board_id: str, request: Request):
    s = current(request)
    if not ID_RE.match(board_id):
        raise HTTPException(400, "錯誤的白板代碼")
    body = await request.json()
    name = str(body.get("name") or "未命名白板")[:80]
    data = body.get("data") or {}
    base_rev = body.get("baseRev")
    force = bool(body.get("force"))

    def do():
        with user_locks[s.username]:
            rel = data_path(s, "boards", f"{board_id}.json")
            cur = read_json(s.storage, rel)
            if cur and not force and base_rev is not None and base_rev != cur.get("rev"):
                raise HTTPException(409, {"message": "此白板已在其他裝置更新", "current": cur})
            now = int(time.time() * 1000)
            rev = (cur or {}).get("rev", 0) + 1
            created = (cur or {}).get("created", now)
            board = {"id": board_id, "name": name, "rev": rev, "created": created, "updatedAt": now, "data": data}
            write_json(s.storage, rel, board)
            return {"rev": rev, "updatedAt": now}

    from starlette.concurrency import run_in_threadpool

    try:
        return await run_in_threadpool(do)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise err(e) from e


@app.delete("/api/boards/{board_id}")
def delete_board(board_id: str, request: Request):
    s = current(request)
    if not ID_RE.match(board_id):
        raise HTTPException(400, "錯誤的白板代碼")
    try:
        with user_locks[s.username]:
            s.storage.delete(data_path(s, "boards", f"{board_id}.json"))
            s.board_cache.pop(board_id, None)
    except Exception as e:  # noqa: BLE001
        raise err(e) from e
    return {"ok": True}


# ---------------------------------------------------------------- settings (名單等)
@app.get("/api/settings")
def get_settings(request: Request):
    s = current(request)
    try:
        return read_json(s.storage, data_path(s, "settings.json"), {"data": {}, "updatedAt": 0})
    except Exception as e:  # noqa: BLE001
        raise err(e) from e


@app.put("/api/settings")
async def put_settings(request: Request):
    s = current(request)
    body = await request.json()
    doc = {"data": body.get("data") or {}, "updatedAt": int(time.time() * 1000)}
    try:
        with user_locks[s.username]:
            write_json(s.storage, data_path(s, "settings.json"), doc)
    except Exception as e:  # noqa: BLE001
        raise err(e) from e
    return {"updatedAt": doc["updatedAt"]}


# ---------------------------------------------------------------- files
@app.get("/api/files")
def list_files(request: Request, path: str = ""):
    s = current(request)
    try:
        items = s.storage.listdir(browse_path(s, path))
    except Exception as e:  # noqa: BLE001
        raise err(e) from e
    for it in items:
        it["type"] = "dir" if it["dir"] else (mimetypes.guess_type(it["name"])[0] or "")
    items.sort(key=lambda i: (not i["dir"], i["name"].lower()))
    return {"path": "/".join(split_rel(path)), "items": items}


@app.get("/api/file")
def get_file(request: Request, path: str):
    s = current(request)
    try:
        fh, size = s.storage.open_read(browse_path(s, path))
    except FileNotFoundError as e:
        raise HTTPException(404, "找不到檔案") from e
    except Exception as e:  # noqa: BLE001
        raise err(e) from e

    def stream():
        try:
            while chunk := fh.read(256 * 1024):
                yield chunk
        finally:
            fh.close()

    ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
    return StreamingResponse(stream(), media_type=ctype, headers={
        "Content-Length": str(size), "Cache-Control": "private, max-age=3600"})


@app.post("/api/upload")
async def upload(request: Request, name: str = "image.png"):
    s = current(request)
    data = await request.body()
    if len(data) > CONFIG["max_upload_mb"] * 1024 * 1024:
        raise HTTPException(413, "檔案太大")
    ext = Path(name).suffix.lower()
    if not re.match(r"^\.[a-z0-9]{1,6}$", ext):
        ext = ".bin"
    fname = f"{time.strftime('%Y%m%d')}-{uuid.uuid4().hex[:8]}{ext}"
    rel = data_path(s, "media", fname)
    if not data_in_browse(s) and split_rel(_tpl("data_dir", s)) != split_rel(_tpl("browse_root", s)):
        raise HTTPException(500, "設定錯誤：data_dir 必須位於 browse_root 之內")
    from starlette.concurrency import run_in_threadpool

    try:
        await run_in_threadpool(s.storage.write_bytes, rel, data)
    except Exception as e:  # noqa: BLE001
        raise err(e) from e
    return {"path": f"media/{fname}"}


# ---------------------------------------------------------------- static
@app.middleware("http")
async def no_cache_static(request: Request, call_next):
    resp = await call_next(request)
    if not request.url.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")


def main():
    import uvicorn

    kw = {}
    if CONFIG.get("ssl_certfile") and CONFIG.get("ssl_keyfile"):
        kw = {"ssl_certfile": CONFIG["ssl_certfile"], "ssl_keyfile": CONFIG["ssl_keyfile"]}
    scheme = "https" if kw else "http"
    print(f"[MyScreen] 模式：{CONFIG['mode']}，網址：{scheme}://localhost:{CONFIG['port']}")
    uvicorn.run(app, host=CONFIG["host"], port=int(CONFIG["port"]), **kw)


if __name__ == "__main__":
    main()
