// 兩種儲存方式，介面相同：
//   FolderBackend — 網路磁碟機（V:）或任何資料夾（老師自己選擇的儲存位置）
//   LocalBackend  — 只存在這台電腦的瀏覽器
import { mimeOf, splitPath } from './fs.js';

export const DATA_DIR = 'MyScreen';

function conflict(current) {
  const e = new Error('此白板已在其他裝置更新');
  e.status = 409;
  e.data = { current };
  return e;
}

const parse = (t) => { try { return t ? JSON.parse(t) : null; } catch { return null; } };
const meta = (b) => ({ id: b.id, name: b.name, rev: b.rev, created: b.created, updatedAt: b.updatedAt });
const extOf = (name) => { const m = /\.([a-z0-9]{1,6})$/i.exec(name || ''); return m ? m[1].toLowerCase() : 'png'; };
const mediaName = (name) => `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 10)}.${extOf(name)}`;

// 圖片參照格式：
//   {kind:'file', base:'data', path:'media/x.png'}  資料夾內（MyScreen\media）的圖片
//   {kind:'file', base:'root', path:'照片/a.jpg'}    使用者瀏覽個人資料夾選的圖片
//   {kind:'smb', path}                               1.0 以前的舊格式，等同 base:'root'
//   {kind:'data'|'url', url}                         內嵌或外部網址
function commonImage(ref) {
  if (!ref) return '';
  if (ref.kind === 'data' || ref.kind === 'url') return ref.url || '';
  return null;
}

// ---------------------------------------------------------------- 資料夾
export class FolderBackend {
  // fs：FsaAdapter 或 NeuAdapter；root 若本身就是 MyScreen 資料夾，dataDir 為空字串
  constructor(fs, { id, dataDir = DATA_DIR } = {}) {
    this.fs = fs;
    this.kind = 'folder';
    this.id = id || 'folder:' + fs.label;
    this.dataDir = dataDir;
    this.canBrowse = true;
    this.cache = new Map();
    this.urls = new Map();
  }

  get label() { return [this.fs.label.replace(/[\\/]$/, ''), this.dataDir].filter(Boolean).join('\\'); }

  d(...p) { return [this.dataDir, ...p].filter(Boolean).join('/'); }

  async check() {
    // 讀得到根目錄才算連線成功
    if (!(await this.fs.exists(''))) throw new Error(`找不到 ${this.fs.label}，請確認網路磁碟機已連線`);
    await this.fs.list('');
  }

  async listBoards() {
    const files = (await this.fs.list(this.d('boards'), { stat: true }))
      .filter((f) => !f.dir && f.name.endsWith('.json') && f.name !== 'index.json');
    const out = [];
    for (const f of files) {
      const id = f.name.slice(0, -5);
      let c = this.cache.get(id);
      if (!c || c.mtime !== f.mtime) {
        const b = await this.getBoard(id);
        if (!b) continue;
        c = { mtime: f.mtime, meta: meta(b) };
        this.cache.set(id, c);
      }
      out.push(c.meta);
    }
    return out.sort((a, b) => (a.created || 0) - (b.created || 0));
  }

  async getBoard(id) {
    const b = parse(await this.fs.read(this.d('boards', id + '.json')));
    if (b) b.id = id;
    return b;
  }

  async putBoard({ id, name, data }, baseRev, force = false) {
    const cur = await this.getBoard(id);
    if (cur && !force && baseRev != null && cur.rev !== baseRev) throw conflict(cur);
    const now = Date.now();
    const board = { id, name, rev: (cur?.rev || 0) + 1, created: cur?.created || now, updatedAt: now, data };
    await this.fs.write(this.d('boards', id + '.json'), JSON.stringify(board));
    this.cache.delete(id);
    return { rev: board.rev, updatedAt: now };
  }

  async deleteBoard(id) {
    await this.fs.remove(this.d('boards', id + '.json'));
    this.cache.delete(id);
  }

  async getSettings() { return parse(await this.fs.read(this.d('settings.json')))?.data || {}; }

  async putSettings(data) { await this.fs.write(this.d('settings.json'), JSON.stringify({ data, updatedAt: Date.now() })); }

  async listFiles(path) {
    const items = await this.fs.list(path);
    return items.map((i) => ({ ...i, type: i.dir ? 'dir' : mimeOf(i.name) }))
      .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'zh-Hant') : a.dir ? -1 : 1));
  }

  async upload(file) {
    const path = 'media/' + mediaName(file.name);
    await this.fs.writeBlob(this.d(path), file);
    return { kind: 'file', base: 'data', path };
  }

  async imageUrl(ref) {
    const c = commonImage(ref);
    if (c !== null) return c;
    const rel = ref.kind === 'file' && ref.base === 'data' ? this.d(ref.path) : splitPath(ref.path).join('/');
    if (this.urls.has(rel)) return this.urls.get(rel);
    const blob = await this.fs.readBlob(rel);
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
    this.urls.set(rel, url);
    return url;
  }

  thumbUrl(path) { return this.imageUrl({ kind: 'file', base: 'root', path }); }
}

// ---------------------------------------------------------------- 只存在這台電腦
const LSX = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

export class LocalBackend {
  constructor() {
    this.kind = 'local';
    this.id = 'local';
    this.label = '這台電腦';
    this.canBrowse = false;
    this.p = 'ms:_guest:';
    // 舊版只存白板內容；補上清單
    if (!LSX.get(this.p + 'index', null)) LSX.set(this.p + 'index', []);
  }

  async check() {}
  async listBoards() { return LSX.get(this.p + 'index', []); }
  async getBoard(id) { return LSX.get(this.p + 'board:' + id, null); }
  async putBoard({ id, name, data, created }) {
    const cur = LSX.get(this.p + 'board:' + id, null);
    const now = Date.now();
    const board = { id, name, rev: (cur?.rev || 0) + 1, created: cur?.created || created || now, updatedAt: now, data };
    try {
      LSX.set(this.p + 'board:' + id, board);
    } catch {
      throw new Error('瀏覽器儲存空間已滿，請刪除部分圖片或繪圖');
    }
    const idx = LSX.get(this.p + 'index', []).filter((b) => b.id !== id);
    idx.push(meta(board));
    LSX.set(this.p + 'index', idx);
    return { rev: board.rev, updatedAt: now };
  }
  async deleteBoard(id) {
    LSX.del(this.p + 'board:' + id);
    LSX.set(this.p + 'index', LSX.get(this.p + 'index', []).filter((b) => b.id !== id));
  }
  async getSettings() { return LSX.get(this.p + 'settings', {}); }
  async putSettings(data) { LSX.set(this.p + 'settings', data); }
  async imageUrl(ref) { return commonImage(ref) || ''; }
}
