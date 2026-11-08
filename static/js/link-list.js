// 網址清單：學校（教務處）先把各年級、各科的網址寫成文字檔，各班導師放進白板資料夾（V:\MyScreen），
// 老師在「網頁／影片」小工具就能直接挑選，不用自己貼網址。例如段考時的試題疑義、更正說明（Google 簡報、Canva 公開檢視連結）。
//
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

// 讀取白板資料夾裡所有的網址清單 → { files: [檔名], items: [{ group, name, url, file }] }
// backend 要是 FolderBackend（只存在這台電腦時沒有資料夾可以放檔案）
export async function loadLinkLists(backend) {
  if (!backend?.fs) return { files: [], items: [] };
  const dir = backend.d();
  const files = (await backend.fs.list(dir))
    .filter((f) => !f.dir && LINK_FILE_RE.test(f.name))
    .map((f) => f.name)
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  const items = [];
  const seen = new Set();
  for (const name of files) {
    const blob = await backend.fs.readBlob(dir ? `${dir}/${name}` : name);
    if (!blob) continue;
    for (const it of parseLinkList(await decodeText(blob), fileGroup(name))) {
      const key = `${it.group}\n${it.name}\n${it.url}`;
      if (seen.has(key)) continue; // 同一份清單放了兩次
      seen.add(key);
      items.push({ ...it, file: name });
    }
  }
  return { files, items };
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
# 把這個檔案放進白板資料夾（例如 V:\\MyScreen），在「網頁／影片」小工具按「📋 從網址清單選擇」就能挑選
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
