// 產生 desktop/out/latest.json：已安裝的黑板樹會讀 GitHub 上的這個檔案來檢查新版本（static/js/update.js）
// 由 build.ps1 呼叫：node make-latest.mjs <版本>
// 更新內容取自 RELEASE.md 的「## 版本紀錄」（每個版本一段「### 1.5.0」）
// latest.json 會用發布者的私鑰簽章（黑板樹內建公鑰驗證，見 static/js/update.js 的 verifyManifest）
//   私鑰：%USERPROFILE%\.blackboardtree\update-signing-key.pem（或環境變數 BT_SIGNING_KEY 指定的檔案），不能放進 git
//   第一次使用：node make-latest.mjs --init-key 產生金鑰，再把印出的公鑰貼到 update.js 的 UPDATE_PUBLIC_KEY
import { createHash, generateKeyPairSync, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signedPayload, UPDATE_PUBLIC_KEY } from '../static/js/update.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const KEY_PATH = process.env.BT_SIGNING_KEY || join(homedir(), '.blackboardtree', 'update-signing-key.pem');
const publicKeyB64 = (key) => createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64');

if (process.argv[2] === '--init-key') {
  if (existsSync(KEY_PATH)) { console.error(`已經有金鑰：${KEY_PATH}（不會覆蓋）`); process.exit(1); }
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  mkdirSync(dirname(KEY_PATH), { recursive: true });
  writeFileSync(KEY_PATH, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  console.log(`已產生私鑰：${KEY_PATH}（請備份到安全的地方，遺失後已安裝的黑板樹就無法自動更新）`);
  console.log(`公鑰（貼到 static/js/update.js 的 UPDATE_PUBLIC_KEY）：\n${publicKeyB64(privateKey)}`);
  process.exit(0);
}

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

// 簽章：沒有私鑰，或私鑰和程式內建的公鑰對不上，就停止（不能發布沒有簽章的版本資訊）
if (!existsSync(KEY_PATH)) {
  console.error(`找不到更新簽章用的私鑰：${KEY_PATH}\n  第一次使用請執行 node make-latest.mjs --init-key；換電腦時把備份的私鑰放回這個位置`);
  process.exit(1);
}
const privateKey = createPrivateKey(readFileSync(KEY_PATH));
if (publicKeyB64(privateKey) !== UPDATE_PUBLIC_KEY) {
  console.error('私鑰和 static/js/update.js 的 UPDATE_PUBLIC_KEY 不是同一組，已安裝的黑板樹會拒絕這個版本資訊');
  process.exit(1);
}
latest.signature = sign('sha256', Buffer.from(signedPayload(latest)), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
writeFileSync(here('./out/latest.json'), JSON.stringify(latest, null, 2) + '\n');
console.log(`  版本資訊：desktop\\out\\latest.json（${version}${latest.setup ? '' : '，沒有安裝程式'}）`);
