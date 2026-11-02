"""MyScreen 教室白板 — 網頁版伺服器。

負責：提供前端網頁、手機遙控與學生投票的轉送（relay.py），以及告訴網頁這台電腦的校內 IP。
白板不存在伺服器上：老師在網頁上選擇儲存位置（網路磁碟機或資料夾），由瀏覽器直接讀寫。
"""
from __future__ import annotations

import json
import mimetypes
import os
import socket
import sys
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles

sys.path.insert(0, str(Path(__file__).resolve().parent))
from relay import router as relay_router  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
mimetypes.add_type("image/svg+xml", ".svg")  # Windows 登錄檔可能沒有 .svg，圖示會變成純文字

DEFAULT_CONFIG = {
    "host": "0.0.0.0",
    "port": 8080,
    "ssl_certfile": "",
    "ssl_keyfile": "",
}


def load_config() -> dict:
    cfg = dict(DEFAULT_CONFIG)
    path = ROOT / "config.json"
    if path.exists():
        user = json.loads(path.read_text(encoding="utf-8"))
        cfg.update({k: v for k, v in user.items() if k in DEFAULT_CONFIG})
    if os.environ.get("MYSCREEN_PORT"):
        cfg["port"] = int(os.environ["MYSCREEN_PORT"])
    return cfg


CONFIG = load_config()


def app_version() -> str:
    """版本號以桌面版的 neutralino.config.json 為準（網頁版「關於與更新」顯示、檢查新版本用）。"""
    try:
        return str(json.loads((ROOT / "desktop" / "neutralino.config.json").read_text(encoding="utf-8")).get("version", ""))
    except (OSError, ValueError):
        return ""

app = FastAPI(title="MyScreen", docs_url=None, redoc_url=None)
app.include_router(relay_router)


def lan_ips() -> list[str]:
    """這台電腦在校內網路的 IPv4（手機用這個連線）；對外連線用的網卡排第一。"""
    found: list[str] = []
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))  # UDP 不會真的送出封包，只是讓系統選出預設網卡
            found.append(s.getsockname()[0])
    except OSError:
        pass
    try:
        found += [i[4][0] for i in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)]
    except OSError:
        pass
    out: list[str] = []
    for ip in found:
        if ip not in out and not ip.startswith(("127.", "169.254.", "0.")):
            out.append(ip)
    return out


@app.get("/api/config")
def get_config():
    # 只聽 127.0.0.1 時手機連不進來，就不提供校內 IP
    local_only = str(CONFIG["host"]).startswith("127.") or CONFIG["host"] == "localhost"
    return {"lanIps": [] if local_only else lan_ips(), "version": app_version()}


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
    print(f"[MyScreen] 網址：{scheme}://localhost:{CONFIG['port']}")
    uvicorn.run(app, host=CONFIG["host"], port=int(CONFIG["port"]), **kw)


if __name__ == "__main__":
    main()
