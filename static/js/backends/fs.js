// 檔案系統轉接器：讓「資料夾儲存」可以跑在瀏覽器（File System Access API）或桌面版（Neutralino）。
// 所有路徑都是相對於使用者選擇的根資料夾，以 / 分隔。

export const splitPath = (rel) => String(rel || '').split(/[\\/]+/).filter((p) => p && p !== '.' && p !== '..');

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  bmp: 'image/bmp', json: 'application/json', mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', pdf: 'application/pdf',
};
export const mimeOf = (name) => MIME[String(name).split('.').pop().toLowerCase()] || '';

// ---------------------------------------------------------------- 瀏覽器：File System Access API（Edge / Chrome）
export class FsaAdapter {
  constructor(root) {
    this.root = root;
    this.label = root.name;
  }

  static supported() { return typeof window.showDirectoryPicker === 'function' && window.isSecureContext; }

  async permission(request = false) {
    const opts = { mode: 'readwrite' };
    let p = await this.root.queryPermission(opts);
    if (p !== 'granted' && request) p = await this.root.requestPermission(opts);
    return p;
  }

  async dir(parts, create = false) {
    let d = this.root;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create });
    return d;
  }

  async file(rel, create = false) {
    const parts = splitPath(rel);
    const name = parts.pop();
    return (await this.dir(parts, create)).getFileHandle(name, { create });
  }

  static missing(e) { return e.name === 'NotFoundError' || e.name === 'TypeMismatchError'; }

  async readBlob(rel) {
    try { return await (await this.file(rel)).getFile(); } catch (e) { if (FsaAdapter.missing(e)) return null; throw e; }
  }

  async read(rel) { const f = await this.readBlob(rel); return f ? f.text() : null; }

  async write(rel, data) {
    const w = await (await this.file(rel, true)).createWritable();
    await w.write(data);
    await w.close();
  }

  writeBlob(rel, blob) { return this.write(rel, blob); }

  async list(rel, { stat = false } = {}) {
    let d;
    try { d = await this.dir(splitPath(rel)); } catch (e) { if (FsaAdapter.missing(e)) return []; throw e; }
    const out = [];
    for await (const [name, h] of d.entries()) {
      if (name.startsWith('.') || name.endsWith('.crswap')) continue;
      if (h.kind === 'directory') { out.push({ name, dir: true }); continue; }
      const item = { name, dir: false };
      if (stat) { const f = await h.getFile(); item.mtime = f.lastModified; item.size = f.size; }
      out.push(item);
    }
    return out;
  }

  async exists(rel) {
    if (!splitPath(rel).length) return true;
    try { await this.dir(splitPath(rel)); return true; } catch { return !!(await this.readBlob(rel)); }
  }

  async remove(rel) {
    const parts = splitPath(rel);
    const name = parts.pop();
    try { await (await this.dir(parts)).removeEntry(name); } catch (e) { if (!FsaAdapter.missing(e)) throw e; }
  }
}

// ---------------------------------------------------------------- 桌面版：Neutralino 原生檔案 API
export class NeuAdapter {
  constructor(base) {
    this.base = String(base).replace(/[\\/]+$/, '');
    this.label = /^[A-Za-z]:$/.test(this.base) ? this.base + '\\' : this.base;
  }

  get fs() { return window.Neutralino.filesystem; }

  p(rel) { return [this.base, ...splitPath(rel)].join('\\'); }

  async stat(rel) {
    try { return await this.fs.getStats(this.p(rel)); } catch { return null; }
  }

  async exists(rel) { return !!(await this.stat(rel)); }

  async read(rel) {
    try { return await this.fs.readFile(this.p(rel)); } catch (e) {
      if (!(await this.exists(rel))) return null;
      throw new Error(e.message || '無法讀取檔案');
    }
  }

  async readBlob(rel) {
    try {
      const buf = await this.fs.readBinaryFile(this.p(rel));
      return new Blob([buf], { type: mimeOf(rel) });
    } catch (e) {
      if (!(await this.exists(rel))) return null;
      throw new Error(e.message || '無法讀取檔案');
    }
  }

  async ensureDir(parts) {
    let cur = this.base;
    for (const p of parts) {
      cur += '\\' + p;
      try { await this.fs.getStats(cur); } catch { await this.fs.createDirectory(cur).catch(() => {}); }
    }
  }

  async write(rel, data) {
    const parts = splitPath(rel);
    await this.ensureDir(parts.slice(0, -1));
    try { await this.fs.writeFile(this.p(rel), data); } catch (e) { throw new Error(e.message || '無法寫入檔案'); }
  }

  async writeBlob(rel, blob) {
    const parts = splitPath(rel);
    await this.ensureDir(parts.slice(0, -1));
    await this.fs.writeBinaryFile(this.p(rel), await blob.arrayBuffer());
  }

  async list(rel, { stat = false } = {}) {
    let entries;
    try { entries = await this.fs.readDirectory(this.p(rel)); } catch { return []; }
    const out = [];
    for (const e of entries) {
      const name = e.entry;
      if (name === '.' || name === '..' || name.startsWith('.') || name.startsWith('~$')) continue;
      const dir = e.type === 'DIRECTORY';
      const item = { name, dir };
      if (stat && !dir) {
        const st = await this.stat(rel ? rel + '/' + name : name);
        item.mtime = st?.modifiedAt || 0;
        item.size = st?.size || 0;
      }
      out.push(item);
    }
    return out;
  }

  async remove(rel) { await this.fs.remove(this.p(rel)).catch(() => {}); }
}

// ---------------------------------------------------------------- 記住使用者選過的資料夾（IndexedDB）
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('myscreen', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function kvGet(key) {
  try {
    const db = await idb();
    return await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(key); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); });
  } catch { return undefined; }
}
export async function kvSet(key, value) {
  try {
    const db = await idb();
    await new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(value, key); t.oncomplete = res; t.onerror = res; });
  } catch { /* 無痕模式等情況 */ }
}
