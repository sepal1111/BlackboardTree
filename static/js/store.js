// 白板存檔與跨裝置同步。實際讀寫交給 backend（資料夾／伺服器／本機）。
// 遠端儲存（資料夾、伺服器）在這台電腦另外保留快取，網路磁碟機暫時斷線時仍可使用並稍後補存。

// 這台電腦上的設定與離線備份
// 網頁版存在瀏覽器的 localStorage。桌面版的 Neutralino 每次啟動網址（連接埠）都不同，
// localStorage 會變成空的，所以改存在 %APPDATA%\MyScreen\prefs.json：啟動時讀進記憶體，修改後寫回檔案
let mem = null;      // 桌面版：{ key: JSON 字串 }
let prefsPath = '';
let prefsTimer = null;

export async function initLocalPrefs() {
  if (typeof window.NL_PORT === 'undefined') return;
  const fs = window.Neutralino.filesystem;
  try {
    const dir = String(await window.Neutralino.os.getPath('data')).replace(/[\\/]+$/, '') + '/MyScreen';
    await fs.createDirectory(dir).catch(() => {});
    prefsPath = dir + '/prefs.json';
    try { mem = JSON.parse(await fs.readFile(prefsPath)) || {}; } catch { mem = {}; }
  } catch { mem = null; } // 讀不到資料夾時退回 localStorage
}

export async function flushLocalPrefs() {
  clearTimeout(prefsTimer);
  prefsTimer = null;
  if (!mem || !prefsPath) return;
  try { await window.Neutralino.filesystem.writeFile(prefsPath, JSON.stringify(mem)); } catch { /* 下次再寫 */ }
}

const schedulePrefs = () => { clearTimeout(prefsTimer); prefsTimer = setTimeout(flushLocalPrefs, 800); };

export const LS = {
  get(k, d) {
    try {
      const v = mem ? mem[k] : localStorage.getItem(k);
      return v ? JSON.parse(v) : d;
    } catch { return d; }
  },
  set(k, v) {
    try {
      if (mem) { mem[k] = JSON.stringify(v); schedulePrefs(); } else localStorage.setItem(k, JSON.stringify(v));
      return true;
    } catch { return false; }
  },
  del(k) {
    try { if (mem) { delete mem[k]; schedulePrefs(); } else localStorage.removeItem(k); } catch { /* ignore */ }
  },
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export class Store extends EventTarget {
  constructor(backend) {
    super();
    this.backend = backend;
    this.remote = backend.kind !== 'local';
    this.guest = !this.remote; // 舊程式碼相容：沒有個人資料夾可瀏覽
    this.prefix = `ms:${backend.id}:`;
    this.index = [];
    this.pending = new Map();
    this.inflight = new Set();
    this.timers = new Map();
    this.status = 'synced';
    this.settings = null;
    this.settingsTimer = null;
  }

  key(k) { return this.prefix + k; }

  setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this.dispatchEvent(new CustomEvent('status', { detail: s }));
  }

  cache(board) { if (this.remote) LS.set(this.key('board:' + board.id), board); }

  // ---------- 白板清單
  async listBoards() {
    try {
      const list = await this.backend.listBoards();
      const local = new Map(this.index.map((b) => [b.id, b]));
      this.index = list.map((b) => (this.hasLocalChanges(b.id) && local.get(b.id)) || b);
      for (const id of this.pending.keys()) if (!this.index.find((b) => b.id === id) && local.get(id)) this.index.push(local.get(id));
      if (this.remote) LS.set(this.key('index'), this.index);
      if (!this.pending.size && !this.inflight.size) this.setStatus('synced');
    } catch (e) {
      if (e.status === 401) throw e;
      if (!this.index.length) this.index = LS.get(this.key('index'), []);
      this.setStatus('offline');
    }
    return this.index;
  }

  touchIndex(board) {
    const entry = { id: board.id, name: board.name, rev: board.rev, created: board.created, updatedAt: board.updatedAt };
    const i = this.index.findIndex((b) => b.id === board.id);
    if (i >= 0) this.index[i] = entry; else this.index.push(entry);
    if (this.remote) LS.set(this.key('index'), this.index);
  }

  async getBoard(id) {
    if (this.pending.has(id)) return this.pending.get(id);
    const cached = this.remote ? LS.get(this.key('board:' + id), null) : null;
    try {
      const b = await this.backend.getBoard(id);
      if (b) { this.cache(b); return b; }
      return cached && !cached.rev ? cached : null;
    } catch (e) {
      if (e.status === 401) throw e;
      if (cached) { this.setStatus('offline'); return cached; }
      throw e;
    }
  }

  newBoard(name) {
    const now = Date.now();
    const board = { id: uid(), name, rev: 0, created: now, updatedAt: now, data: { background: { type: 'preset', value: 'sky' }, widgets: [] } };
    this.saveBoard(board, true);
    return board;
  }

  // 白板物件被直接修改後呼叫；會延遲批次寫入
  saveBoard(board, immediate = false) {
    board.updatedAt = Date.now();
    this.touchIndex(board);
    this.pending.set(board.id, board);
    if (this.remote) this.setStatus('saving');
    clearTimeout(this.timers.get(board.id));
    this.timers.set(board.id, setTimeout(() => this.flush(board.id), immediate ? 0 : 700));
  }

  async flush(id) {
    const board = this.pending.get(id);
    if (!board) return;
    this.cache(board);
    if (this.inflight.has(id)) {
      this.timers.set(id, setTimeout(() => this.flush(id), 400));
      return;
    }
    this.pending.delete(id);
    this.inflight.add(id);
    try {
      const r = await this.backend.putBoard(board, board.rev || null);
      board.rev = r.rev;
      board.updatedAt = r.updatedAt;
      this.touchIndex(board);
      this.cache(board);
    } catch (e) {
      if (e.status === 409 && e.data?.current) {
        this.dispatchEvent(new CustomEvent('remote', { detail: { board: e.data.current, conflict: true } }));
      } else if (!this.remote) {
        this.dispatchEvent(new CustomEvent('error', { detail: e.message }));
      } else if (e.status !== 401) {
        if (!this.pending.has(id)) this.pending.set(id, board);
        this.setStatus('offline');
        this.timers.set(id, setTimeout(() => this.flush(id), 5000));
      }
    } finally {
      this.inflight.delete(id);
    }
    if (!this.pending.size && !this.inflight.size) this.setStatus('synced');
  }

  async flushAll() {
    for (const id of [...this.pending.keys()]) { clearTimeout(this.timers.get(id)); await this.flush(id); }
  }

  async deleteBoard(id) {
    clearTimeout(this.timers.get(id));
    this.pending.delete(id);
    this.index = this.index.filter((b) => b.id !== id);
    if (this.remote) { LS.set(this.key('index'), this.index); LS.del(this.key('board:' + id)); }
    await this.backend.deleteBoard(id).catch(() => {});
  }

  hasLocalChanges(id) { return this.pending.has(id) || this.inflight.has(id); }

  // 定期檢查其他裝置的修改
  async poll(currentBoard) {
    if (!this.remote || document.hidden) return;
    const before = new Map(this.index.map((b) => [b.id, b.rev]));
    await this.listBoards();
    if (this.status === 'offline') return;
    const changedList = this.index.length !== before.size || this.index.some((b) => before.get(b.id) !== b.rev);
    if (changedList) this.dispatchEvent(new Event('index'));
    if (!currentBoard || this.hasLocalChanges(currentBoard.id)) return;
    const remote = this.index.find((b) => b.id === currentBoard.id);
    if (remote && remote.rev > (currentBoard.rev || 0)) {
      try {
        const b = await this.backend.getBoard(currentBoard.id);
        if (b && !this.hasLocalChanges(currentBoard.id)) {
          this.cache(b);
          this.dispatchEvent(new CustomEvent('remote', { detail: { board: b } }));
        }
      } catch { /* 下次再試 */ }
    } else if (!remote && currentBoard.rev > 0) {
      this.dispatchEvent(new CustomEvent('deleted', { detail: currentBoard.id }));
    }
  }

  // ---------- 共用設定（班級名單等）
  async getSettings() {
    if (this.settings) return this.settings;
    const local = this.remote ? LS.get(this.key('settings'), null) : null;
    try {
      this.settings = { classLists: [], ...(await this.backend.getSettings()) };
      if (this.remote) LS.set(this.key('settings'), this.settings);
    } catch {
      this.settings = local || { classLists: [] };
    }
    // 舊格式名單（只有 names）補上 students
    this.settings.classLists = (this.settings.classLists || []).map((l) => ({ ...l, students: l.students || (l.names || []).map((name) => ({ name })) }));
    return this.settings;
  }

  saveSettings() {
    // names 給舊版程式讀；students 才有座號、照片
    for (const l of this.settings.classLists) l.names = l.students.map((x) => x.name);
    this.dispatchEvent(new Event('settings'));
    if (this.remote) LS.set(this.key('settings'), this.settings);
    clearTimeout(this.settingsTimer);
    this.settingsTimer = setTimeout(() => this.backend.putSettings(this.settings).catch(() => {}), 500);
  }

  // ---------- 圖片
  imageUrl(ref) { return this.backend.imageUrl(ref).catch(() => ''); }
}
