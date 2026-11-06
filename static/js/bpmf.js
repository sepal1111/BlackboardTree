// 注音字型的破音字：內建的注音字型（ButTaiwan bpmfvs）依「注音 IVS」規格，在字後面加上異體字選擇符（看不見的字元）來換讀音
//   沒有選擇符：預設讀音（最常見的）
//   U+E01E0：不標注音（只顯示國字）
//   U+E01E1、U+E01E2…：第 2、第 3…種讀音
// 每個字有哪些讀音直接問字型（畫出來比對），不需要另外的讀音資料庫

export const VS0 = 0xe01e0;
export const MAX_ALT = 9; // 最多試到第 10 種讀音（實際上沒有字超過 6 種）
const isVS = (cp) => cp >= 0xe0100 && cp <= 0xe01ef;
const isHan = (ch) => /\p{Script=Han}/u.test(ch);

// 找出文字裡每個國字與它目前的讀音；at：在字串中的位置（UTF-16），len：國字＋選擇符的長度
// vs：null＝預設讀音；0＝不標注音；1 以上＝第 vs+1 種讀音
export function hanChars(text) {
  const out = [];
  const s = String(text || '');
  for (let i = 0; i < s.length;) {
    const cp = s.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    let len = ch.length;
    let vs = null;
    if (isHan(ch)) {
      const next = s.codePointAt(i + len);
      if (next != null && isVS(next)) {
        vs = next >= VS0 && next <= VS0 + 15 ? next - VS0 : null;
        len += 2; // 選擇符在 U+E0100 以後，佔 2 個 UTF-16
      }
      out.push({ at: i, len, ch, vs });
    }
    i += len;
  }
  return out;
}

// 國字加上讀音（vs 規則同上）
export const withReading = (ch, vs) => (vs == null ? ch : ch + String.fromCodePoint(VS0 + vs));

// 把字串中某一個字換成指定的讀音
export function setReading(text, { at, len, ch }, vs) {
  return text.slice(0, at) + withReading(ch, vs) + text.slice(at + len);
}

// 拿掉所有選擇符（搜尋、純文字用）
export const stripVS = (text) => String(text || '').replace(/[\u{E0100}-\u{E01EF}]/gu, '');

// ---- 自動判斷讀音（常用詞＋規則）。data 來自 bpmf-data.js（tools/bpmf/build.mjs 產生）
// chars：一串字（每個元素一個字；換行、標點也算一個字，用來斷開詞）
// fixed：同樣長度，老師手動指定的讀音序號（沒有指定是 null），判斷「一」「不」變調時會參考
// 回傳：每個字的讀音序號（0＝第 1 種讀音）；null＝不需要指定（用預設讀音）
const NUM = '零〇一二三四五六七八九十百千萬兩';
const SUBJECT = '我你他她它牠們誰';
export function autoReadings(chars, data, { sandhi = true, fixed = [] } = {}) {
  const { POLY, TONE4, WORDS, MAX_WORD } = data;
  const n = chars.length;
  const out = new Array(n).fill(null);
  const set = (i, idx) => { if (out[i] == null && fixed[i] == null) out[i] = idx; };
  const isH = (i) => i >= 0 && i < n && isHan(chars[i]);
  // 1. 常用詞：長的詞先套用，同一個字已經被長詞決定就不再改
  const hits = [];
  for (let i = 0; i < n; i++) {
    if (!isH(i)) continue;
    for (let len = Math.min(MAX_WORD, n - i); len >= 2; len--) {
      const code = WORDS[chars.slice(i, i + len).join('')];
      if (code) hits.push({ i, len, code });
    }
  }
  hits.sort((a, b) => b.len - a.len || a.i - b.i);
  for (const { i, code } of hits) [...code].forEach((c, k) => { if (c !== '.') set(i + k, +c); });
  // 讀音的聲調（判斷變調用）：手動 > 自動判斷 > 預設讀音
  const tone = (i) => {
    if (!isH(i)) return 0;
    const t = POLY[chars[i]];
    if (t) return +t[fixed[i] ?? out[i] ?? 0] || 0;
    return TONE4.includes(chars[i]) ? 4 : 1; // 只要分辨「是不是第四聲」
  };
  // 2. 規則（由後往前，「一」「不」才看得到後面的字已經決定的讀音）
  for (let i = n - 1; i >= 0; i--) {
    const ch = chars[i];
    if (out[i] != null || fixed[i] != null) continue;
    const prev = chars[i - 1];
    const next = chars[i + 1];
    if (ch === '得') {
      // 接在動詞、形容詞後面（跑得快、覺得）唸 ˙ㄉㄜ；句首或「我得、他得」維持 ㄉㄜˊ
      if (isH(i - 1) && !SUBJECT.includes(prev)) set(i, 1);
    } else if (ch === '地') {
      if (isH(i - 1) && prev === chars[i - 2]) set(i, 1); // 慢慢地、笑嘻嘻地
    } else if (ch === '了') {
      if (prev === '不' && isH(i - 2) && !isH(i + 1)) set(i, 1); // 走不了。
    } else if (sandhi && ch === '一') {
      // 本調 ㄧ：後面不是國字、數字中（一二三、二十一）、第一；其他依下一個字變調
      if (!isH(i + 1) || NUM.includes(next) || (prev && (NUM.includes(prev) || prev === '第'))) set(i, 0);
      else set(i, tone(i + 1) === 4 ? 1 : 2); // 一個 ㄧˊ、一天 ㄧˋ
    } else if (sandhi && ch === '不') {
      if (isH(i + 1) && tone(i + 1) === 4) set(i, 1); // 不是 ㄅㄨˊ
    }
  }
  return out;
}

// 讀音序號 → 選擇符的 vs（0 是第 1 種讀音＝不加選擇符）
export const vsOfIndex = (idx) => (idx ? idx : null);
// vs → 讀音序號（vs 0 是不標注音，沒有讀音序號）
export const indexOfVs = (vs) => (vs == null ? 0 : vs >= 1 ? vs : null);

let dataPromise;
export const loadBpmfData = () => (dataPromise ||= import('./bpmf-data.js'));

// ---- 瀏覽器：問字型某個字有幾種讀音（把每種選擇符畫出來，和預設讀音不同的才算）
const cache = new Map();
function render(text, family) {
  const c = document.createElement('canvas');
  c.width = 72; c.height = 56;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.font = `40px ${family}`;
  g.textBaseline = 'top';
  g.fillText(text, 4, 6);
  return g.getImageData(0, 0, c.width, c.height).data;
}
const same = (a, b) => { for (let i = 3; i < a.length; i += 4) if (a[i] !== b[i]) return false; return true; };

// 回傳這個字可以選的讀音：[null（預設）, 1, 2, …]；字型裡沒有其他讀音時只有 [null]
export async function readingsOf(ch, family) {
  const key = family + '|' + ch;
  if (cache.has(key)) return cache.get(key);
  const alts = Array.from({ length: MAX_ALT }, (_, k) => withReading(ch, k + 1));
  try { await document.fonts.load(`40px ${family}`, ch + alts.join('')); } catch { /* 載不到就用目前的 */ }
  const base = render(ch, family);
  const list = [null];
  for (let k = 1; k <= MAX_ALT; k++) {
    if (same(render(withReading(ch, k), family), base)) break; // 字型不認得的選擇符會畫成預設讀音
    list.push(k);
  }
  cache.set(key, list);
  return list;
}
