// 圖片工具的多張照片：狀態整理、排序、切換（不碰畫面，方便測試）

// 舊版只有一張（state.ref），改成 refs 陣列；index 超出範圍時拉回來
export function normalizeImageState(s) {
  if (!Array.isArray(s.refs)) s.refs = [];
  if (s.ref && !s.refs.length) s.refs = [s.ref];
  delete s.ref;
  s.refs = s.refs.filter((r) => r && typeof r === 'object');
  if (s.mode !== 'grid' && s.mode !== 'slide') s.mode = s.refs.length > 1 ? 'grid' : 'slide';
  if (!['s', 'm', 'l'].includes(s.thumb)) s.thumb = 'm';
  s.index = clampIndex(s.index, s.refs.length);
  return s;
}

export const clampIndex = (i, n) => (n ? Math.min(n - 1, Math.max(0, Math.floor(+i || 0))) : 0);

// 單張切換：最後一張的下一張回到第一張
export const wrapIndex = (i, n) => (n ? ((Math.floor(i) % n) + n) % n : 0);

// 把第 i 張往前（d = -1）或往後（d = 1）移；回傳新的陣列
export function moveItem(arr, i, d) {
  const j = i + d;
  if (i < 0 || i >= arr.length || j < 0 || j >= arr.length) return arr.slice();
  const out = arr.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

// 顯示用的檔名（舊的參照沒有 name，就從路徑或網址取最後一段）
export function refName(ref) {
  if (!ref) return '';
  if (ref.name) return ref.name;
  if (ref.kind === 'data') return '';
  const p = String(ref.path || ref.url || '').split(/[?#]/)[0];
  try { return decodeURIComponent(p.split(/[\\/]/).pop() || ''); } catch { return p.split(/[\\/]/).pop() || ''; }
}

// 縮圖卡片的大小（像素）
export const THUMB_PX = { s: 120, m: 180, l: 260 };
export const THUMB_STEPS = ['s', 'm', 'l'];

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
export const isImageName = (name) => IMAGE_EXT.test(name || '') && !String(name).startsWith('.');

// 加入照片時去掉已經在清單裡的（同一個檔案、同一個網址）
const refKey = (r) => (r.kind === 'data' || r.kind === 'url' ? r.kind + ':' + r.url : `${r.base || 'root'}:${r.path}`);
export function addRefs(list, more) {
  const seen = new Set(list.map(refKey));
  const out = list.slice();
  for (const r of more) {
    const k = refKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}
