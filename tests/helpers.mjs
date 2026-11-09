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

// 做一個最小的 ZIP（.docx、.odt 等）：files = { 路徑: 文字或 Uint8Array }，store 的用不壓縮，其他用 deflate
export async function makeZip(files, { store = [] } = {}) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = typeof content === 'string' ? enc.encode(content) : content;
    const deflate = !store.includes(name);
    const data = deflate
      ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
      : raw;
    const nameBytes = enc.encode(name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, deflate ? 8 : 0, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameBytes.length, true);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(10, deflate ? 8 : 0, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, raw.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);
    central.push(new Uint8Array(cd.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)]).arrayBuffer();
}
