// 匯入資源的檔案網址：
//   桌面版：影片、音訊、PDF、文件交給內建伺服器（myscreen-relay.exe 的 /media）從磁碟分段讀取，
//           不會整個讀進記憶體（幾 GB 的影片也能播、能拖曳進度）；圖片沿用原本的讀檔方式
//   網頁版：資料夾模式的檔案是磁碟上的 File，轉成 blob 網址時也不會整個讀進記憶體
import { resKind } from './res-list.js';

const DESKTOP = () => typeof window !== 'undefined' && typeof window.NL_PORT !== 'undefined';
const SMALL = 32 * 1024 * 1024; // 內建伺服器不能用時，這個大小以下的檔案才直接讀進記憶體

// app.js 設定：回傳 Promise<'http://127.0.0.1:port/media?t=...&p='>（需要時才啟動內建伺服器）
let localServer = null;
export function setLocalFileServer(fn) { localServer = fn; }

// 參照 → 這台電腦上的完整路徑（桌面版；讀不到時是空字串）
export function absPathOf(store, ref) {
  if (!ref || !DESKTOP()) return '';
  if (ref.kind === 'abs') return ref.path || '';
  const be = store.backend;
  if (ref.kind === 'file' || ref.kind === 'smb') return be?.fs?.base && be.relOf ? be.fs.p(be.relOf(ref)) : '';
  return '';
}

async function localUrl(abs) {
  if (localServer) {
    try { return (await localServer()) + encodeURIComponent(abs.replace(/\//g, '\\')); } catch { /* 改用讀檔 */ }
  }
  try {
    const st = await window.Neutralino.filesystem.getStats(abs);
    if (st.size > SMALL) throw new Error('big');
    const buf = await window.Neutralino.filesystem.readBinaryFile(abs);
    return URL.createObjectURL(new Blob([buf]));
  } catch {
    throw new Error('內建伺服器無法啟動，無法播放這台電腦上的大檔案');
  }
}

// 參照 → 可以放在 <img>、<video>、<iframe> 的網址
export async function resUrl(store, ref) {
  if (!ref) return '';
  if (ref.kind === 'data' || ref.kind === 'url') return ref.url || '';
  const abs = absPathOf(store, ref);
  if (abs && (ref.kind === 'abs' || resKind(ref) !== 'image')) return localUrl(abs);
  if (ref.kind === 'abs') return '';
  return (await store.imageUrl(ref)) || '';
}

// 參照 → 檔案內容（文字檔、Word、ODF 要自己轉換）
export async function resBuffer(store, ref) {
  const url = await resUrl(store, ref);
  if (!url) throw new Error('讀不到檔案');
  const r = await fetch(url);
  if (!r.ok) throw new Error('讀不到檔案（' + r.status + '）');
  return r.arrayBuffer();
}

// 檔案是否還在（abs 參照換電腦後就讀不到）
export async function resExists(store, ref) {
  const abs = absPathOf(store, ref);
  if (!abs) return true;
  try { await window.Neutralino.filesystem.getStats(abs); return true; } catch { return false; }
}
