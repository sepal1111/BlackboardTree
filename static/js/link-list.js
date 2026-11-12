// 試卷釋疑：學校（教務處）把段考的試題疑義、更正說明放在學校共用資料夾，
// 老師在「試卷釋疑」小工具直接挑選顯示。可以放 PDF、圖片、Word（.docx）、文字檔，
// 或是寫一份網址清單（Google 簡報、Canva 公開檢視連結）。
//
// 網址清單
// 檔名：網址清單.txt，或「網址清單」開頭的 .txt（例如 網址清單-七年級.txt），可以放好幾個檔案
// 格式（記事本或 Excel 另存 CSV 都可以，UTF-8 或 Big5）：
//   [七年級]                                  ← 沒有網址的一行是分類標題（[ ]、【 】可加可不加）
//   國文 試題疑義 https://docs.google.com/…   ← 有網址的一行：網址前面的文字是名稱
//   數學,更正說明,https://www.canva.com/…     ← Excel 的欄位（逗號、Tab、|）會變成空格
//   # 說明文字                                ← # 或 // 開頭的行不會顯示

export const LINK_FILE = '網址清單.txt';
export const LINK_FILE_RE = /^(網址清單|links).*\.txt$/i;

const URL_RE = /https?:\/\/[^\s"'<>，、；]+/i;
const COMMENT_RE = /^\s*(#|\/\/|;|＃)/;

const clean = (s) => String(s || '')
  .replace(/["“”]/g, '')
  .replace(/[,\t|｜，]+/g, ' ')
  .replace(/^[\s:：\-–—=>→]+|[\s:：\-–—=>→]+$/g, '')
  .replace(/\s+/g, ' ')
  .trim();

// 網址後面常會黏到標點（句號、括號）
const trimUrl = (u) => u.replace(/[.,;:!?。）)\]】」』]+$/, '');

// 檔名「網址清單-七年級.txt」的「七年級」，當作沒有分類標題時的分類
// Windows 複製檔案時加上的「 (1)」「 - 複製」不算
export function fileGroup(fileName) {
  return clean(String(fileName || '')
    .replace(/\.txt$/i, '')
    .replace(/^(網址清單|links)/i, '')
    .replace(/(\s*[-－]\s*(複製|副本|copy))+$/i, '')
    .replace(/\s*[(（]\d+[)）]$/, '')
    .replace(/^[\s_\-－–—()（）]+|[()（）]+$/g, ''));
}

// 解析一個檔案的內容 → [{ group, name, url }]
export function parseLinkList(text, defaultGroup = '') {
  const out = [];
  let group = defaultGroup;
  for (const raw of String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || COMMENT_RE.test(line)) continue;
    const m = URL_RE.exec(line);
    if (!m) {
      const g = clean(line.replace(/^[[【〔(（]+|[\]】〕)）]+$/g, ''));
      if (g) group = g;
      continue;
    }
    const url = trimUrl(m[0]);
    let name = clean(line.slice(0, m.index));
    if (!name) name = clean(line.slice(m.index + m[0].length));
    if (!name) { try { name = new URL(url).hostname; } catch { name = url; } }
    out.push({ group, name, url });
  }
  return out;
}

// 文字檔可能是 UTF-8（新版記事本）或 Big5（舊版記事本、台灣版 Excel 的 CSV）
export async function decodeText(blob) {
  const buf = await blob.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('big5').decode(buf); }
}

// 試卷釋疑：學校共用資料夾裡的檔案。網址清單裡的網址照原樣，其他檔案的網址寫成「school:相對路徑」
export const SCHOOL_PREFIX = 'school:';
export const isSchoolUrl = (u) => String(u || '').startsWith(SCHOOL_PREFIX);
export const schoolPath = (u) => String(u || '').slice(SCHOOL_PREFIX.length);
// 檔案類型 → 'pdf' | 'image' | 'video' | 'text' | 'word' | 'doc' | ''（不顯示）
export function docKind(name) {
  const n = String(name || '');
  if (/^~\$|^\./.test(n)) return ''; // Word 開啟中的暫存檔、隱藏檔
  if (/\.pdf$/i.test(n)) return 'pdf';
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(n)) return 'image';
  if (/\.(mp4|m4v|webm|ogv|mov)$/i.test(n)) return 'video';
  if (/\.docx$/i.test(n)) return 'word';
  if (/\.doc$/i.test(n)) return 'doc';
  if (/\.txt$/i.test(n) && !LINK_FILE_RE.test(n)) return 'text';
  return '';
}
export const DOC_ICON = { pdf: '📕', image: '🖼️', video: '🎬', text: '📝', word: '📘', doc: '📘', web: '🌐' };
const byName = (a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true });

// 讀取一個資料夾 → { files: [相對路徑], items: [{ group, name, url, file, doc }] }
//   doc：'web'（網址清單裡的網址）或 docKind 的類型
//   depth：往下讀幾層子資料夾，子資料夾的名稱當作分類（例如 七年級\數學更正.pdf）
export async function scanLinkFolder(fs, dir = '', { depth = 0 } = {}, group = '') {
  const files = [];
  const items = [];
  const entries = (await fs.list(dir)).sort((a, b) => byName(a.name, b.name));
  const rel = (name) => (dir ? `${dir}/${name}` : name);
  for (const f of entries) {
    if (f.dir || !LINK_FILE_RE.test(f.name)) continue;
    const blob = await fs.readBlob(rel(f.name));
    if (!blob) continue;
    files.push(rel(f.name));
    for (const it of parseLinkList(await decodeText(blob), fileGroup(f.name) || group)) items.push({ ...it, file: rel(f.name), doc: 'web' });
  }
  for (const f of entries) {
    const doc = f.dir ? '' : docKind(f.name);
    if (!doc) continue;
    files.push(rel(f.name));
    items.push({ group, name: f.name.replace(/\.[^.]+$/, ''), url: SCHOOL_PREFIX + rel(f.name), file: rel(f.name), doc });
  }
  if (depth > 0) {
    for (const f of entries) {
      if (!f.dir || /^[.~$]/.test(f.name)) continue;
      const sub = await scanLinkFolder(fs, rel(f.name), { depth: depth - 1 }, clean(f.name));
      files.push(...sub.files);
      items.push(...sub.items);
    }
  }
  return { files, items };
}

// 同一份清單放了兩次時不重複
function dedupe(items) {
  const seen = new Set();
  return items.filter((it) => {
    const key = `${it.group}\n${it.name}\n${it.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 學校共用資料夾：網址清單、PDF、圖片、文字檔、Word，子資料夾讀一層（資料夾名稱當分類）
// 讀不到資料夾（沒有連線、沒有權限）時丟出錯誤
export async function loadSchoolLinks(fs) {
  if (!(await fs.exists(''))) throw new Error(`讀不到 ${fs.label}，請確認這台電腦連得到學校的共用資料夾`);
  const r = await scanLinkFolder(fs, '', { depth: 1 });
  return { files: r.files, items: dedupe(r.items) };
}

// 轉成可以放進網頁框的網址：Google 文件／簡報／雲端硬碟檔案用 /preview，Canva 公開檢視連結加上 ?embed
export function toEmbedUrl(url) {
  let u;
  try { u = new URL(String(url).trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname;
  if ((host === 'docs.google.com' || (host === 'drive.google.com' && /^\/file\//.test(u.pathname))) && /\/(edit|view|present)$/.test(u.pathname)) {
    return `${u.origin}${u.pathname.replace(/\/(edit|view|present)$/, '/preview')}`;
  }
  if (/(^|\.)canva\.com$/.test(host) && /^\/design\/.+\/view$/.test(u.pathname) && !u.searchParams.has('embed')) {
    return `${u.origin}${u.pathname}?embed`;
  }
  return u.href;
}

// 文字檔裡的網址變成可以點的連結 → [{ text } | { url }]
export function linkify(text) {
  const out = [];
  const re = /https?:\/\/[^\s"'<>，、；。）」』]+/gi;
  let last = 0, m;
  const s = String(text || '');
  while ((m = re.exec(s))) {
    const url = trimUrl(m[0]);
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    out.push({ url });
    last = m.index + url.length;
    re.lastIndex = last;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

// 搜尋：空白分開的每個字都要出現在分類或名稱裡（例如「七 數學」）
export function filterLinks(items, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((it) => {
    const hay = `${it.group} ${it.name}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// 依分類分組，保留檔案裡的順序 → [{ group, items }]
export function groupLinks(items) {
  const map = new Map();
  for (const it of items) {
    if (!map.has(it.group)) map.set(it.group, []);
    map.get(it.group).push(it);
  }
  return [...map].map(([group, list]) => ({ group, items: list }));
}

// 範例檔（給學校編寫網址清單時參考）
export const LINK_SAMPLE = `# 黑板樹網址清單
# 把這個檔案放進學校共用資料夾（或裡面的年級資料夾），在「試卷釋疑」小工具就能挑選
# 檔名要是「網址清單.txt」，或「網址清單」開頭的 .txt（例如 網址清單-七年級.txt），可以放好幾個檔案
# 寫法：
#   沒有網址的一行是分類（例如年級），[ ] 可加可不加
#   有網址的一行：前面寫名稱，後面接網址（中間空格、逗號或 Tab 都可以）
#   # 開頭的行是說明，不會顯示
# Google 簡報請用「共用 → 知道連結的使用者」或「發布到網路」的連結；Canva 請用「公開檢視連結」

[七年級]
國文 試題疑義與更正 https://docs.google.com/presentation/d/請換成簡報代碼/preview
數學 試題疑義與更正 https://www.canva.com/design/請換成設計代碼/view

[八年級]
國文 試題疑義與更正 https://docs.google.com/presentation/d/請換成簡報代碼/preview
英語 試題疑義與更正 https://docs.google.com/presentation/d/請換成簡報代碼/preview
`;
