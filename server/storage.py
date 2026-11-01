"""儲存層：本機資料夾或 SAMBA (SMB2/3) 分享資料夾。

兩種實作都使用「相對路徑」，以 / 分隔，並禁止 .. 跳出根目錄。
"""
from __future__ import annotations

import errno
import os
import re
import uuid
from pathlib import Path


class StorageError(Exception):
    """一般儲存錯誤（連線失敗、權限不足等）。"""


class AuthError(StorageError):
    """帳號或密碼錯誤。"""


def split_rel(rel: str) -> list[str]:
    parts = [p for p in re.split(r"[\\/]+", rel or "") if p and p != "."]
    if any(p == ".." for p in parts):
        raise StorageError("不允許的路徑")
    return parts


class LocalStorage:
    """本機資料夾（也可以是 Windows 的 UNC 路徑，例如 \\\\nas\\share\\{username}）。"""

    def __init__(self, root: str):
        self.root = Path(root).resolve()

    def _abs(self, rel: str) -> Path:
        p = self.root.joinpath(*split_rel(rel)).resolve()
        if p != self.root and self.root not in p.parents:
            raise StorageError("不允許的路徑")
        return p

    def check(self) -> None:
        try:
            self.root.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            raise StorageError(f"無法存取資料夾：{e}") from e

    def read_bytes(self, rel: str) -> bytes | None:
        try:
            return self._abs(rel).read_bytes()
        except FileNotFoundError:
            return None

    def write_bytes(self, rel: str, data: bytes) -> None:
        p = self._abs(rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_name(f".{p.name}.{uuid.uuid4().hex[:8]}.tmp")
        tmp.write_bytes(data)
        os.replace(tmp, p)

    def delete(self, rel: str) -> None:
        try:
            self._abs(rel).unlink()
        except FileNotFoundError:
            pass

    def listdir(self, rel: str) -> list[dict]:
        p = self._abs(rel)
        if not p.is_dir():
            raise StorageError("資料夾不存在")
        out = []
        for e in os.scandir(p):
            if e.name.startswith("."):
                continue
            st = e.stat()
            out.append({"name": e.name, "dir": e.is_dir(), "size": st.st_size, "mtime": st.st_mtime})
        return out

    def open_read(self, rel: str):
        p = self._abs(rel)
        if not p.is_file():
            raise FileNotFoundError(rel)
        return open(p, "rb"), p.stat().st_size

    def close(self) -> None:
        pass


class SMBStorage:
    """以使用者自己的 SAMBA 帳密連線。每位使用者有獨立的連線快取。"""

    def __init__(self, server: str, share: str, username: str, password: str,
                 domain: str = "", port: int = 445, encrypt: bool = False):
        import smbclient  # 延遲載入，local 模式不需要

        self._smb = smbclient
        self.server = server
        self.port = port
        self.base = "\\\\" + server + "\\" + share.strip("\\/").replace("/", "\\")
        self.cache: dict = {}
        user = f"{domain}\\{username}" if domain else username
        self.kw = dict(username=user, password=password, port=port, connection_cache=self.cache,
                       connection_timeout=8)
        self.encrypt = encrypt

    def _p(self, rel: str) -> str:
        parts = split_rel(rel)
        return "\\".join([self.base, *parts]) if parts else self.base

    def _wrap(self, e: Exception) -> Exception:
        from smbprotocol.exceptions import LogonFailure, SMBAuthenticationError

        if isinstance(e, (LogonFailure, SMBAuthenticationError)):
            return AuthError("帳號或密碼錯誤")
        msg = str(e)
        if "STATUS_LOGON_FAILURE" in msg or "STATUS_ACCOUNT" in msg or "STATUS_WRONG_PASSWORD" in msg:
            return AuthError("帳號或密碼錯誤")
        if "STATUS_ACCESS_DENIED" in msg:
            return StorageError("沒有存取權限")
        if "STATUS_BAD_NETWORK_NAME" in msg:
            return StorageError("找不到分享資料夾，請檢查 config.json 的 share 設定")
        return StorageError(f"SAMBA 錯誤：{msg}")

    def check(self) -> None:
        try:
            self._smb.register_session(self.server, encrypt=self.encrypt or None, **self.kw)
            self._smb.listdir(self.base, **self.kw)
        except Exception as e:  # noqa: BLE001
            self.close()
            raise self._wrap(e) from e

    def read_bytes(self, rel: str) -> bytes | None:
        try:
            with self._smb.open_file(self._p(rel), mode="rb", **self.kw) as f:
                return f.read()
        except OSError as e:
            if e.errno == errno.ENOENT:
                return None
            raise self._wrap(e) from e
        except Exception as e:  # noqa: BLE001
            raise self._wrap(e) from e

    def _makedirs(self, path: str) -> None:
        try:
            self._smb.makedirs(path, exist_ok=True, **self.kw)
        except OSError as e:
            if e.errno != errno.EEXIST:
                raise

    def write_bytes(self, rel: str, data: bytes) -> None:
        parts = split_rel(rel)
        try:
            if len(parts) > 1:
                self._makedirs(self._p("/".join(parts[:-1])))
            target = self._p(rel)
            tmp = self._p("/".join(parts[:-1] + [f".{parts[-1]}.{uuid.uuid4().hex[:8]}.tmp"]))
            with self._smb.open_file(tmp, mode="wb", **self.kw) as f:
                f.write(data)
            self._smb.replace(tmp, target, **self.kw)
        except Exception as e:  # noqa: BLE001
            raise self._wrap(e) from e

    def delete(self, rel: str) -> None:
        try:
            self._smb.remove(self._p(rel), **self.kw)
        except OSError as e:
            if e.errno != errno.ENOENT:
                raise self._wrap(e) from e

    def listdir(self, rel: str) -> list[dict]:
        out = []
        try:
            for e in self._smb.scandir(self._p(rel), **self.kw):
                if e.name.startswith(".") or e.name.startswith("~$"):
                    continue
                st = e.stat()
                out.append({"name": e.name, "dir": e.is_dir(), "size": st.st_size, "mtime": st.st_mtime})
        except Exception as e:  # noqa: BLE001
            raise self._wrap(e) from e
        return out

    def open_read(self, rel: str):
        p = self._p(rel)
        try:
            st = self._smb.stat(p, **self.kw)
            return self._smb.open_file(p, mode="rb", **self.kw), st.st_size
        except OSError as e:
            if e.errno == errno.ENOENT:
                raise FileNotFoundError(rel) from e
            raise self._wrap(e) from e

    def close(self) -> None:
        try:
            self._smb.reset_connection_cache(connection_cache=self.cache)
        except Exception:  # noqa: BLE001
            pass
