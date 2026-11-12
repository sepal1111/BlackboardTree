// 試卷釋疑的本機快取：學校共用資料夾（或老師選的資料夾）可能同時有很多間教室在讀，
// 所以開啟時先把檔案複製到這台電腦（%APPDATA%\MyScreen\cache\examdoc），之後都從副本顯示；
// 定時只看原始檔案的大小與修改時間（不讀內容），有變才再複製一次。
// 原始檔案讀不到（網路斷線）時，繼續顯示先前的副本。
//
// 副本的檔名是「來源代碼-版本代碼.副檔名」，每個版本一個新檔案：正在播放的舊影片不會被覆蓋，
// 換成新版本後再刪舊檔（被占用刪不掉時，下次整理再刪）。
// 紀錄存在 LS（ms:docCache）：{ [原始檔完整路徑]: { file, stamp, at } }

export const CACHE_KEY = 'ms:docCache';
export const KEEP_DAYS = 30;          // 超過這麼久沒有開啟的副本會刪掉
export const STAT_TIMEOUT = 5000;     // 網路資料夾斷線時，查詢不要卡住

// 檔案的大小＋修改時間；讀不到時是空字串
export const stampOf = (st) => (st ? `${st.size}:${st.modifiedAt || st.mtime || 0}` : '');

// 短的雜湊（FNV-1a），用來產生副本檔名
export function hash(s) {
  let h = 0x811c9dc5;
  for (const c of String(s)) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0');
}

export const extOf = (p) => (/\.([A-Za-z0-9]{1,8})$/.exec(String(p)) || [, 'bin'])[1].toLowerCase();
export const cacheName = (src, stamp) => `${hash(String(src).toLowerCase())}-${hash(stamp)}.${extOf(src)}`;

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

// io：{ stat(abs) → {size, modifiedAt} | null, copy(src, dst), remove(abs), list(dir) → [檔名], ensureDir(dir) }
// store：{ get() → 紀錄物件, set(紀錄物件) }
export class DocCache {
  constructor({ io, dir, store, now = () => Date.now(), keepDays = KEEP_DAYS, statTimeout = STAT_TIMEOUT }) {
    Object.assign(this, { io, dir: String(dir).replace(/[\\/]+$/, ''), store, now, keepDays, statTimeout });
    this.busy = new Map(); // 同一個檔案同時只複製一次（同一台電腦開了兩個小工具）
  }

  path(file) { return `${this.dir}\\${file}`; }
  entries() { return { ...(this.store.get() || {}) }; }
  entry(src) { return this.entries()[src] || null; }

  save(src, value) {
    const all = this.entries();
    if (value) all[src] = value; else delete all[src];
    this.store.set(all);
  }

  async statSource(src) {
    try { return (await withTimeout(this.io.stat(src), this.statTimeout)) || null; } catch { return null; }
  }

  async hasCopy(e) {
    if (!e) return false;
    try { return !!(await this.io.stat(this.path(e.file))); } catch { return false; }
  }

  // 複製一份新版本；複製期間原始檔案又變了（還在寫入）就丟掉，等下次再試 → 新紀錄或 null
  async copyVersion(src, st) {
    const stamp = stampOf(st);
    const file = cacheName(src, stamp);
    const dst = this.path(file);
    await this.io.ensureDir(this.dir);
    await this.io.remove(dst).catch(() => {});
    await this.io.copy(src, dst);
    const [after, copy] = await Promise.all([this.statSource(src), this.io.stat(dst).catch(() => null)]);
    if (stampOf(after) !== stamp || !copy || copy.size !== st.size) {
      await this.io.remove(dst).catch(() => {});
      return null;
    }
    const old = this.entry(src);
    const e = { file, stamp, at: this.now() };
    this.save(src, e);
    if (old && old.file !== file) await this.io.remove(this.path(old.file)).catch(() => {});
    return e;
  }

  once(src, fn) {
    if (!this.busy.has(src)) this.busy.set(src, fn().finally(() => this.busy.delete(src)));
    return this.busy.get(src);
  }

  // 開啟：副本是最新的就直接用，否則複製一份；原始檔案讀不到時用舊副本
  // → { path, stamp, at, offline }，連副本都沒有時丟出錯誤
  open(src) {
    return this.once(src, async () => {
      const st = await this.statSource(src);
      let e = this.entry(src);
      const ok = await this.hasCopy(e);
      if (st && !(ok && e.stamp === stampOf(st))) {
        const fresh = await this.copyVersion(src, st).catch(() => null);
        if (fresh) return { ...this.touch(src, fresh), path: this.path(fresh.file), offline: false };
      }
      if (ok) return { ...this.touch(src, e), path: this.path(e.file), offline: !st, stale: !!st && e.stamp !== stampOf(st) };
      throw new Error(st ? '無法複製檔案到這台電腦' : '讀不到檔案');
    });
  }

  touch(src, e) {
    const next = { ...e, at: this.now() };
    this.save(src, next);
    return next;
  }

  // 定時檢查：原始檔案和副本不同時複製新版本 → 新的 { path, stamp }，沒有變（或讀不到、還在寫入）時是 null
  check(src, stamp) {
    return this.once(src, async () => {
      const st = await this.statSource(src);
      if (!st || stampOf(st) === stamp) return null;
      const e = await this.copyVersion(src, st).catch(() => null);
      return e ? { ...e, path: this.path(e.file) } : null;
    });
  }

  // 整理：太久沒開的副本、沒有紀錄的檔案（舊版本刪不掉留下的）都刪掉
  async prune() {
    const all = this.entries();
    const limit = this.now() - this.keepDays * 86400000;
    const keep = new Set();
    for (const [src, e] of Object.entries(all)) {
      if (!e || e.at < limit) delete all[src];
      else keep.add(e.file);
    }
    this.store.set(all);
    let names = [];
    try { names = await this.io.list(this.dir); } catch { return; }
    for (const n of names) if (!keep.has(n)) await this.io.remove(this.path(n)).catch(() => {});
  }
}

// ---------------------------------------------------------------- 桌面版
let shared = null;
export async function desktopDocCache(LS) {
  if (shared) return shared;
  const N = window.Neutralino;
  const dir = String(await N.os.getPath('data')).replace(/[\\/]+$/, '').replace(/\//g, '\\') + '\\MyScreen\\cache\\examdoc';
  const io = {
    stat: (p) => N.filesystem.getStats(p).catch(() => null),
    copy: (a, b) => N.filesystem.copy(a, b),
    remove: (p) => N.filesystem.remove(p),
    list: async (d) => (await N.filesystem.readDirectory(d)).filter((e) => e.type === 'FILE').map((e) => e.entry),
    ensureDir: async (d) => {
      const parts = d.split('\\');
      let cur = parts.shift();
      for (const p of parts) {
        cur += '\\' + p;
        if (!(await N.filesystem.getStats(cur).catch(() => null))) await N.filesystem.createDirectory(cur).catch(() => {});
      }
    },
  };
  shared = new DocCache({ io, dir, store: { get: () => LS.get(CACHE_KEY, {}), set: (v) => LS.set(CACHE_KEY, v) } });
  setTimeout(() => shared.prune().catch(() => {}), 20000); // 啟動一陣子後整理一次
  return shared;
}
