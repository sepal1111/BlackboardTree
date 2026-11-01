// 白板資料：伺服器模式存到 SAMBA（本機留快取），訪客模式只存在這台裝置的瀏覽器
import { api } from './api.js';

export const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export class Store extends EventTarget {
  constructor(user, guest) {
    super();
    this.user = user;
    this.guest = guest;
    this.prefix = `ms:${guest ? '_guest' : user}:`;
    this.index = [];
    this.pending = new Map();   // boardId -> board（待上傳）
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

  // ---------- 白板清單
  async listBoards() {
    if (this.guest) {
      this.index = LS.get(this.key('index'), []);
      return this.index;
    }
    try {
      const r = await api.get('/api/boards');
      // 尚未上傳完成的白板，以本機為準
      const local = new Map(this.index.map((b) => [b.id, b]));
      this.index = r.boards.map((b) => (this.pending.has(b.id) || this.inflight.has(b.id)) && local.get(b.id) ? local.get(b.id) : b);
      for (const id of this.pending.keys()) if (!this.index.find((b) => b.id === id)) this.index.push(local.get(id));
      LS.set(this.key('index'), this.index);
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
    LS.set(this.key('index'), this.index);
  }

  async getBoard(id) {
    if (this.guest) return LS.get(this.key('board:' + id), null);
    const cached = LS.get(this.key('board:' + id), null);
    if (this.pending.has(id)) return this.pending.get(id);
    try {
      const b = await api.get('/api/boards/' + id);
      LS.set(this.key('board:' + id), b);
      return b;
    } catch (e) {
      if (e.status === 404) return cached && cached.rev === 0 ? cached : null;
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
    if (!this.guest) {
      this.pending.set(board.id, board);
      this.setStatus('saving');
    }
    clearTimeout(this.timers.get(board.id));
    this.timers.set(board.id, setTimeout(() => this.flush(board.id, board), immediate ? 0 : 700));
  }

  async flush(id, boardRef) {
    const board = this.guest ? boardRef : this.pending.get(id);
    if (!board) return;
    if (!LS.set(this.key('board:' + id), board) && this.guest) {
      this.dispatchEvent(new CustomEvent('error', { detail: '瀏覽器儲存空間已滿，請刪除部分圖片或繪圖' }));
    }
    if (this.guest) return;
    if (this.inflight.has(id)) {
      this.timers.set(id, setTimeout(() => this.flush(id), 400));
      return;
    }
    this.pending.delete(id);
    this.inflight.add(id);
    try {
      const r = await api.put('/api/boards/' + id, { name: board.name, data: board.data, baseRev: board.rev || null });
      board.rev = r.rev;
      board.updatedAt = r.updatedAt;
      this.touchIndex(board);
      LS.set(this.key('board:' + id), board);
    } catch (e) {
      if (e.status === 409 && e.data?.current) {
        this.dispatchEvent(new CustomEvent('remote', { detail: { board: e.data.current, conflict: true } }));
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

  async deleteBoard(id) {
    clearTimeout(this.timers.get(id));
    this.pending.delete(id);
    this.index = this.index.filter((b) => b.id !== id);
    LS.set(this.key('index'), this.index);
    LS.del(this.key('board:' + id));
    if (!this.guest) await api.del('/api/boards/' + id).catch(() => {});
  }

  hasLocalChanges(id) { return this.pending.has(id) || this.inflight.has(id); }

  // 定期檢查其他裝置的修改
  async poll(currentBoard) {
    if (this.guest || document.hidden) return;
    const before = new Map(this.index.map((b) => [b.id, b.rev]));
    await this.listBoards();
    const changedList = this.index.length !== before.size || this.index.some((b) => before.get(b.id) !== b.rev);
    if (changedList) this.dispatchEvent(new Event('index'));
    if (!currentBoard || this.hasLocalChanges(currentBoard.id)) return;
    const remote = this.index.find((b) => b.id === currentBoard.id);
    if (remote && remote.rev > (currentBoard.rev || 0)) {
      try {
        const b = await api.get('/api/boards/' + currentBoard.id);
        if (!this.hasLocalChanges(currentBoard.id)) {
          LS.set(this.key('board:' + b.id), b);
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
    const local = LS.get(this.key('settings'), { classLists: [] });
    if (this.guest) return (this.settings = local);
    try {
      const r = await api.get('/api/settings');
      this.settings = { classLists: [], ...(r.data || {}) };
      LS.set(this.key('settings'), this.settings);
    } catch {
      this.settings = local;
    }
    return this.settings;
  }

  saveSettings() {
    LS.set(this.key('settings'), this.settings);
    if (this.guest) return;
    clearTimeout(this.settingsTimer);
    this.settingsTimer = setTimeout(() => api.put('/api/settings', { data: this.settings }).catch(() => {}), 500);
  }
}
