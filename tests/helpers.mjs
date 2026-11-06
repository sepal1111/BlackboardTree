// 測試共用：在 Node 裡模擬前端需要的瀏覽器環境。
// 每個測試檔第一行先 import 這個檔案，再 import static/js 的模組。

class MemoryStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true });
Object.defineProperty(globalThis, 'sessionStorage', { value: new MemoryStorage(), configurable: true, writable: true });
globalThis.window = globalThis;
globalThis.self = globalThis; // static/vendor/nacl-fast.min.js 會掛在 self.nacl
globalThis.document = { hidden: false };

export const resetStorage = () => { localStorage.clear(); sessionStorage.clear(); };

// 記憶體裡的資料夾，介面同 FsaAdapter／NeuAdapter（路徑以 / 分隔、相對於根資料夾）
export class MemFs {
  constructor(label = 'V:\\') {
    this.label = label;
    this.files = new Map(); // path → { data, mtime }
    this.clock = 1000;
    this.failing = false; // true：模擬網路磁碟機斷線
  }
  norm(rel) { return String(rel || '').split(/[\\/]+/).filter(Boolean).join('/'); }
  check() { if (this.failing) throw new Error('網路磁碟機斷線'); }
  async exists(rel) {
    this.check();
    const p = this.norm(rel);
    return !p || this.files.has(p) || [...this.files.keys()].some((k) => k.startsWith(p + '/'));
  }
  async read(rel) { this.check(); return this.files.get(this.norm(rel))?.data ?? null; }
  async readBlob(rel) { const d = await this.read(rel); return d == null ? null : new Blob([d]); }
  async write(rel, data) { this.check(); this.files.set(this.norm(rel), { data, mtime: ++this.clock }); }
  async writeBlob(rel, blob) { await this.write(rel, await blob.text()); }
  async remove(rel) { this.check(); this.files.delete(this.norm(rel)); }
  async list(rel, { stat = false } = {}) {
    this.check();
    const p = this.norm(rel);
    const pre = p ? p + '/' : '';
    const out = new Map();
    for (const [k, v] of this.files) {
      if (!k.startsWith(pre)) continue;
      const [name, ...rest] = k.slice(pre.length).split('/');
      if (rest.length) out.set(name, { name, dir: true });
      else out.set(name, stat ? { name, dir: false, mtime: v.mtime, size: v.data.length } : { name, dir: false });
    }
    return [...out.values()];
  }
  json(rel) { return JSON.parse(this.files.get(this.norm(rel)).data); }
}

// 等待所有已排程的 promise 執行完
export const tick = () => new Promise((r) => setImmediate(r));

// 停掉 Store 排程的計時器（離線重試會一直排下去，不停掉測試程式不會結束）
export function stopTimers(store) {
  for (const t of store.timers.values()) clearTimeout(t);
  clearTimeout(store.settingsTimer);
}
