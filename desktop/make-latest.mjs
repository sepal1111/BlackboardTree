// 產生 desktop/out/latest.json：已安裝的黑板樹會讀 GitHub 上的這個檔案來檢查新版本（static/js/update.js）
// 由 build.ps1 呼叫：node make-latest.mjs <版本>
// 更新內容取自 RELEASE.md 的「## 版本紀錄」（每個版本一段「### 1.5.0」）
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const version = process.argv[2];
if (!/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(version || '')) {
  console.error('用法：node make-latest.mjs 1.5.0');
  process.exit(1);
}

function fileInfo(name) {
  const p = here('./out/' + name);
  if (!existsSync(p)) return null;
  return { file: name, size: statSync(p).size, sha256: createHash('sha256').update(readFileSync(p)).digest('hex') };
}

// RELEASE.md「## 版本紀錄」底下每個「### x.y.z」的項目（保留「- 」與縮排，前端再轉成純文字）
function releaseHistory() {
  const md = readFileSync(here('../RELEASE.md'), 'utf8').replace(/\r\n/g, '\n');
  const start = md.indexOf('\n## 版本紀錄');
  if (start < 0) return [];
  const body = md.slice(start + 1).split('\n').slice(1); // 跳過「## 版本紀錄」這一行
  const out = [];
  let cur = null;
  for (const line of body) {
    if (/^## /.test(line)) break;
    const m = line.match(/^###\s+(\d+\.\d+\.\d+)\s*(?:[（(](\d{4}-\d{2}-\d{2})[)）])?/);
    if (m) { cur = { version: m[1], date: m[2] || '', notes: [] }; out.push(cur); continue; }
    if (cur && /^\s*[-*]\s+\S/.test(line)) cur.notes.push(line.replace(/\s+$/, ''));
  }
  return out.slice(0, 10);
}

const history = releaseHistory();
const mine = history.find((x) => x.version === version);
if (!mine || !mine.notes.length) {
  console.warn(`  注意：RELEASE.md 的「版本紀錄」還沒有 ### ${version}，檢查更新時不會顯示更新內容`);
}
const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); // 台灣日期
const latest = {
  version,
  date: mine?.date || today,
  notes: mine?.notes || [],
  history,
  setup: fileInfo(`BlackboardTree-Setup-${version}.exe`),
  portable: fileInfo('BlackboardTree.exe'),
};
if (!latest.portable) { console.error('找不到 out/BlackboardTree.exe'); process.exit(1); }
writeFileSync(here('./out/latest.json'), JSON.stringify(latest, null, 2) + '\n');
console.log(`  版本資訊：desktop\\out\\latest.json（${version}${latest.setup ? '' : '，沒有安裝程式'}）`);
