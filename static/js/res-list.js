// 「匯入資源」小工具的資料：資源清單、檔案類型、舊白板升級（不碰畫面，方便測試）
//
// 每個資源是一個參照（ref），沿用圖片參照的格式（見 backends/index.js），另外多了：
//   {kind:'abs', path:'D:\\影片\\a.mp4', name}  這台電腦上的檔案（太大不複製，只記住位置；只有這台電腦能顯示）
//   name：顯示用的檔名；as：舊的圖片工具留下來的網址一律當圖片
import { classifyUrl } from './web-url.js';

const EXT = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'],
  video: ['mp4', 'webm', 'ogv', 'mov', 'm4v'],
  audio: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba'],
  pdf: ['pdf'],
  text: ['txt', 'md', 'csv', 'log', 'json'],
  word: ['docx'],
  odt: ['odt'],
  ods: ['ods'],
  odp: ['odp'],
  office: ['doc', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf'], // 無法直接顯示，提供「用電腦開啟」
};
const BY_EXT = Object.fromEntries(Object.entries(EXT).flatMap(([k, list]) => list.map((e) => [e, k])));

export const extOf = (name) => { const m = /\.([a-z0-9]{1,5})$/i.exec(String(name || '').split(/[?#]/)[0]); return m ? m[1].toLowerCase() : ''; };
export const fileKind = (name) => BY_EXT[extOf(name)] || '';

// 可以匯入的檔案（隱藏檔、Office 暫存檔除外）
export const isImportable = (name) => !!fileKind(name) && !/^[.~]/.test(String(name));
export const isImageName = (name) => fileKind(name) === 'image' && !String(name).startsWith('.');

// 資源類型：image、video、audio、pdf、text、word、odt、ods、odp、office、youtube、social、web
export function resKind(ref) {
  if (!ref) return '';
  if (ref.as) return ref.as;
  if (ref.kind === 'data') return /^data:image\//.test(ref.url || '') ? 'image' : '';
  if (ref.kind === 'url') {
    const k = fileKind(ref.url);
    if (k && k !== 'office') return k;
    const info = classifyUrl(ref.url);
    if (!info) return '';
    return info.kind === 'video' ? 'video' : info.kind;
  }
  return fileKind(ref.name || ref.path);
}

export const KIND_ICON = {
  image: '🖼️', video: '🎬', audio: '🎵', pdf: '📕', text: '📝', word: '📘', odt: '📄', ods: '📊', odp: '📽️',
  office: '📎', youtube: '▶️', social: '📱', web: '🌐',
};
export const KIND_LABEL = {
  image: '圖片', video: '影片', audio: '音訊', pdf: 'PDF', text: '文字檔', word: 'Word 文件', odt: '文字文件', ods: '試算表', odp: '簡報',
  office: '檔案', youtube: 'YouTube', social: '社群影片', web: '網頁',
};
// 可以調整字大小的類型
export const ZOOMABLE = ['text', 'word', 'odt', 'ods'];
// 這些類型要讀出檔案內容自己轉成 HTML
export const DOC_KINDS = ['text', 'word', 'odt', 'ods', 'odp'];

// 超過這個大小（位元組）的本機檔案不複製，只記住位置
export const BIG_FILE = 200 * 1024 * 1024;

// ---------------------------------------------------------------- 狀態
export function normalizeResState(s) {
  if (!Array.isArray(s.refs)) s.refs = [];
  if (s.ref && !s.refs.length) s.refs = [s.ref];
  delete s.ref;
  s.refs = s.refs.filter((r) => r && typeof r === 'object');
  if (s.mode !== 'grid' && s.mode !== 'slide') s.mode = s.refs.length > 1 ? 'grid' : 'slide';
  if (!['s', 'm', 'l'].includes(s.thumb)) s.thumb = 'm';
  if (!(+s.zoom > 0)) s.zoom = 1;
  s.index = clampIndex(s.index, s.refs.length);
  return s;
}

// 舊版的「圖片」「網頁／影片」小工具 → 匯入資源
export function upgradeImageState(st = {}) {
  const refs = (Array.isArray(st.refs) && st.refs.length ? st.refs : st.ref ? [st.ref] : [])
    .filter((r) => r && typeof r === 'object')
    .map((r) => (r.kind === 'url' && !r.as ? { ...r, as: 'image' } : r));
  const out = { ...st, refs };
  delete out.ref;
  return out;
}
export function upgradeEmbedState(st = {}) {
  const url = String(st.url || '').trim();
  return { refs: url ? [{ kind: 'url', url }] : [], mode: 'slide', index: 0, autoplay: !!st.autoplay, fromRemote: !!st.fromRemote };
}

export const clampIndex = (i, n) => (n ? Math.min(n - 1, Math.max(0, Math.floor(+i || 0))) : 0);
export const wrapIndex = (i, n) => (n ? ((Math.floor(i) % n) + n) % n : 0);

export function moveItem(arr, i, d) {
  const j = i + d;
  if (i < 0 || i >= arr.length || j < 0 || j >= arr.length) return arr.slice();
  const out = arr.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

// 顯示用的名稱
export function refName(ref) {
  if (!ref) return '';
  if (ref.name) return ref.name;
  if (ref.kind === 'data') return '';
  const raw = String(ref.path || ref.url || '');
  if (ref.kind === 'url') {
    const info = classifyUrl(raw);
    if (info?.kind === 'youtube') return 'YouTube 影片';
    if (info && info.kind !== 'video' && !fileKind(raw)) {
      try { const u = new URL(raw); return u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname : ''); } catch { return raw; }
    }
  }
  const p = raw.split(/[?#]/)[0];
  const last = p.split(/[\\/]/).pop() || '';
  try { return decodeURIComponent(last); } catch { return last; }
}

export const THUMB_PX = { s: 120, m: 180, l: 260 };
export const THUMB_STEPS = ['s', 'm', 'l'];

const refKey = (r) => (r.kind === 'data' || r.kind === 'url' ? r.kind + ':' + r.url : `${r.kind === 'abs' ? 'abs' : r.base || 'root'}:${r.path}`);
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

// 檔案大小 → 「1.2 GB」
export function fmtSize(n) {
  if (!(n >= 0)) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${i ? n.toFixed(n < 10 ? 1 : 0) : n} ${u[i]}`;
}
