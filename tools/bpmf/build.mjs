// 產生 static/js/bpmf-data.js（注音字型自動判斷破音字用的資料）
// 來源：phonic_table_Z.txt（ButTaiwan bpmfvs 的讀音表，Apache 2.0，見 NOTICE.txt）＋ words.txt（常用破音詞）
// 讀音表的順序就是字型裡異體字選擇符的順序：第 1 種讀音不加選擇符，第 i+1 種加 U+E01E0+i
// 用法：node tools/bpmf/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const here = (p) => new URL(p, import.meta.url);
const table = {};
for (const line of readFileSync(here('phonic_table_Z.txt'), 'utf8').split(/\r?\n/)) {
  const p = line.split('\t');
  if (p.length > 3) table[p[0]] = p.slice(3).filter(Boolean);
}

const toneOf = (r) => (r.startsWith('˙') ? 5 : r.endsWith('ˊ') ? 2 : r.endsWith('ˇ') ? 3 : r.endsWith('ˋ') ? 4 : 1);

// 多音字：字 → 每種讀音的聲調（例如 行：'2224'）
const poly = {};
let tone4 = '';
for (const [ch, rs] of Object.entries(table)) {
  if (rs.length > 1) poly[ch] = rs.map(toneOf).join('');
  else if (toneOf(rs[0]) === 4) tone4 += ch;
}

// 常用詞：詞 → 每個字的讀音序號（'.'＝不指定）
const words = {};
const errors = [];
readFileSync(here('words.txt'), 'utf8').split(/\r?\n/).forEach((line, n) => {
  line = line.trim();
  if (!line || line.startsWith('#')) return;
  const [word, ...specs] = line.split(/\s+/);
  const chars = [...word];
  const code = chars.map(() => '.');
  if (!specs.length) errors.push(`第 ${n + 1} 行「${word}」沒有指定讀音`);
  for (const spec of specs) {
    const [ch, reading] = spec.split('=');
    const rs = table[ch];
    const idx = rs ? rs.indexOf(reading) : -1;
    if (!chars.includes(ch)) errors.push(`第 ${n + 1} 行「${word}」裡沒有「${ch}」`);
    else if (!rs || rs.length < 2) errors.push(`第 ${n + 1} 行「${ch}」不是多音字`);
    else if (idx < 0) errors.push(`第 ${n + 1} 行「${ch}」沒有 ${reading} 這個讀音（有：${rs.join(' ')}）`);
    else if (idx > 9) errors.push(`第 ${n + 1} 行「${ch}」的讀音序號超過 9`);
    else chars.forEach((c, i) => { if (c === ch) code[i] = String(idx); });
  }
  if (words[word] && words[word] !== code.join('')) errors.push(`第 ${n + 1} 行「${word}」重複而且讀音不同`);
  words[word] = code.join('');
});
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

const maxLen = Math.max(...Object.keys(words).map((w) => [...w].length));
const out = `// 由 tools/bpmf/build.mjs 產生，請不要直接修改（改 tools/bpmf/words.txt 後重新產生）
// 讀音資料來源：ButTaiwan bpmfvs phonic_table_Z.txt（Apache 2.0）
// POLY：多音字每種讀音的聲調（1～4，5＝輕聲）；TONE4：只有一種讀音而且是第四聲的字；WORDS：常用破音詞每個字的讀音序號（.＝不指定）
export const POLY = ${JSON.stringify(poly)};
export const TONE4 = ${JSON.stringify(tone4)};
export const WORDS = ${JSON.stringify(words)};
export const MAX_WORD = ${maxLen};
`;
writeFileSync(here('../../static/js/bpmf-data.js'), out);
console.log(`多音字 ${Object.keys(poly).length} 字、第四聲單音字 ${[...tone4].length} 字、常用詞 ${Object.keys(words).length} 個；${(Buffer.byteLength(out) / 1024).toFixed(0)} KB`);
