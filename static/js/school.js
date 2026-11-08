// 學校共用資料夾：教務處把網址清單、PDF、圖片放在全校教室電腦都讀得到的資料夾（例如 \\fileserver\公告），
// 每台黑板樹都從這裡讀，不用每位老師各自複製檔案。只有桌面版能用（網頁版讀不到網路上的資料夾）。
//
// 設定的來源（後面的優先）：
//   1. 資訊組安裝時設定：程式資料夾的 school.json {"dir": "\\\\fileserver\\公告"}（安裝程式 /SCHOOLDIR="…" 會寫入）
//   2. 這台電腦的設定（⚙ 設定 → 🏫 學校共用資料夾），存在 prefs.json 的 ms:schoolDir；空字串 = 這台電腦不使用
import { LS } from './store.js';
import { NeuAdapter } from './backends/fs.js';

const KEY = 'ms:schoolDir';
const DESKTOP = () => typeof window !== 'undefined' && typeof window.NL_PORT !== 'undefined';
let deployed = '';

// school.json 的內容 → 資料夾路徑（容許 BOM、只寫路徑的純文字）
export function parseSchoolConfig(text) {
  const t = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!t) return '';
  try { return String(JSON.parse(t)?.dir || '').trim(); } catch { return t.split(/\r?\n/)[0].trim(); }
}

export async function initSchoolDir() {
  if (!DESKTOP()) return;
  const dir = String(window.NL_PATH || '.').replace(/[\\/]+$/, '');
  try { deployed = parseSchoolConfig(await window.Neutralino.filesystem.readFile(dir + '/school.json')); } catch { deployed = ''; }
}

export const deployedSchoolDir = () => deployed;
export const schoolSupported = () => DESKTOP();

export function schoolDir() {
  const v = LS.get(KEY, null);
  return typeof v === 'string' ? v : deployed;
}

// null：改回資訊組的設定；''：這台電腦不使用
export function setSchoolDir(v) {
  if (v === null) LS.del(KEY);
  else LS.set(KEY, String(v).trim());
}

// 讀取學校共用資料夾用的轉接器（沒有設定、網頁版時是 null）
export function schoolFs() {
  const d = schoolDir();
  return d && DESKTOP() ? new NeuAdapter(d) : null;
}
