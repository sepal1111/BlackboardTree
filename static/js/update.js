// 檢查新版本與下載更新
// 新版本的資訊放在 GitHub 上的 desktop/out/latest.json（由 desktop\build.ps1 產生，和 exe 一起 commit）。
// 用 raw.githubusercontent.com 讀取：允許跨網域、沒有 GitHub API 每小時 60 次的限制（全校共用一個對外 IP 時也不怕）。
// 下載後比對 latest.json 裡的大小與 SHA-256，確認檔案完整才安裝；latest.json 本身有數位簽章（見 verifyManifest）。

export const UPDATE_URL = 'https://raw.githubusercontent.com/sepal1111/BlackboardTree/main/desktop/out/latest.json';
export const RELEASES_PAGE = 'https://github.com/sepal1111/BlackboardTree/releases';
const DAY = 24 * 3600 * 1000;

const VERSION_RE = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;
const FILE_RE = /^[\w.-]{1,80}\.exe$/; // 只接受單純的檔名，不能有路徑
const SHA_RE = /^[0-9a-f]{64}$/;

export const parseVersion = (v) => (VERSION_RE.test(String(v || '').trim()) ? String(v).trim().split('.').map(Number) : null);

// a > b：1，a < b：-1，相同：0；格式不對的版本視為最舊
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

function normFile(f) {
  if (!f || typeof f !== 'object') return null;
  const sha256 = String(f.sha256 || '').toLowerCase();
  const size = Number(f.size);
  if (!FILE_RE.test(String(f.file || '')) || !SHA_RE.test(sha256) || !(size > 0)) return null;
  return { file: String(f.file), size, sha256 };
}

// 保留開頭的縮排（子項目），只去掉結尾空白
const normNotes = (n) => (Array.isArray(n) ? n.map((s) => String(s).replace(/\s+$/, '')).filter((s) => s.trim()).slice(0, 40) : []);

// 讀進來的 latest.json 先檢查格式，避免壞掉或被竄改的內容造成問題
export function normalizeManifest(json) {
  if (!json || typeof json !== 'object' || !parseVersion(json.version)) throw new Error('版本資訊的格式不正確');
  const history = (Array.isArray(json.history) ? json.history : [])
    .filter((x) => x && parseVersion(x.version))
    .map((x) => ({ version: String(x.version), date: String(x.date || ''), notes: normNotes(x.notes) }));
  return {
    version: String(json.version),
    date: String(json.date || ''),
    notes: normNotes(json.notes),
    history,
    setup: normFile(json.setup),
    portable: normFile(json.portable),
  };
}

// 目前版本之後到最新版的所有更新內容（新的在前）
export function notesSince(manifest, current) {
  const list = manifest.history.length ? manifest.history : [{ version: manifest.version, date: manifest.date, notes: manifest.notes }];
  return list.filter((x) => compareVersions(x.version, current) > 0 && compareVersions(x.version, manifest.version) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
}

// ---- 數位簽章：latest.json 由發布者的私鑰簽章（desktop/make-latest.mjs），程式內建公鑰驗證
// 就算 GitHub 上的檔案被竄改，沒有私鑰就做不出正確的簽章，黑板樹不會下載更新
// 公鑰：ECDSA P-256（SPKI，Base64）；私鑰放在發布者電腦的 %USERPROFILE%\.blackboardtree\update-signing-key.pem
export const UPDATE_PUBLIC_KEY = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEN0e2TyDZedFopHaACHHwB4GtiYZ9bMBrazejUmaAlsZE8tJxPByAy3BDZjTlXfCPTcqegh2Ojmy62XlY19iElw==';

// 簽章的內容：latest.json 去掉 signature 後的精簡 JSON（欄位順序與檔案相同）
export function signedPayload(json) {
  const { signature, ...rest } = json || {};
  return JSON.stringify(rest);
}

const b64bytes = (s) => Uint8Array.from(atob(String(s)), (c) => c.charCodeAt(0));

export async function verifyManifest(json, publicKey = UPDATE_PUBLIC_KEY) {
  try {
    if (!json || typeof json.signature !== 'string') return false;
    const subtle = globalThis.crypto.subtle;
    const key = await subtle.importKey('spki', b64bytes(publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64bytes(json.signature), new TextEncoder().encode(signedPayload(json)));
  } catch {
    return false;
  }
}

// 檢查是否有新版本；回傳 { current, latest, newer, manifest, url }
export async function checkForUpdate({ current, url = UPDATE_URL, fetchFn = globalThis.fetch, publicKey = UPDATE_PUBLIC_KEY } = {}) {
  const sep = url.includes('?') ? '&' : '?';
  let res;
  try {
    res = await fetchFn(url + sep + 't=' + Date.now(), { cache: 'no-store' }); // GitHub 會快取 5 分鐘，加參數拿到最新的
  } catch {
    throw new Error('無法連線到 GitHub，請確認這台電腦可以上網');
  }
  if (!res.ok) throw new Error(`無法取得版本資訊（${res.status}）`);
  let json;
  try { json = await res.json(); } catch { throw new Error('版本資訊的格式不正確'); }
  if (!(await verifyManifest(json, publicKey))) throw new Error('版本資訊的數位簽章不正確，為了安全不會更新。請到 GitHub 下載頁面確認');
  const manifest = normalizeManifest(json);
  return { current, latest: manifest.version, newer: compareVersions(manifest.version, current) > 0, manifest, url };
}

export async function sha256Hex(bytes) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 下載 latest.json 裡的檔案（和 latest.json 放在同一個資料夾），確認大小與 SHA-256 相符
export async function downloadVerified(info, manifestUrl, { fetchFn = globalThis.fetch, onProgress } = {}) {
  if (!info) throw new Error('這個版本沒有提供這種下載檔');
  const fileUrl = new URL(info.file, manifestUrl).href;
  let res;
  try { res = await fetchFn(fileUrl + '?v=' + info.sha256.slice(0, 12), { cache: 'no-store' }); } catch { throw new Error('下載失敗，請確認網路連線'); }
  if (!res.ok) throw new Error(`下載失敗（${res.status}）`);
  let bytes;
  if (res.body?.getReader) {
    const reader = res.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      if (got > info.size) throw new Error('下載的檔案大小不符');
      onProgress?.(got / info.size);
    }
    bytes = new Uint8Array(got);
    let o = 0;
    for (const p of parts) { bytes.set(p, o); o += p.length; }
  } else {
    bytes = new Uint8Array(await res.arrayBuffer());
    onProgress?.(1);
  }
  if (bytes.length !== info.size) throw new Error('下載的檔案不完整，請再試一次');
  if ((await sha256Hex(bytes)) !== info.sha256) throw new Error('下載的檔案檢查碼不符（GitHub 可能還在更新），請稍後再試');
  return bytes;
}

// 自動檢查：一天最多一次
export const shouldAutoCheck = (lastCheck, now = Date.now()) => !(lastCheck > 0) || now - lastCheck >= DAY || now < lastCheck;

// 等目前的黑板樹結束後再更新的 PowerShell 指令（用 -EncodedCommand，路徑有中文、空白也不會出錯）
const psq = (s) => "'" + String(s).replace(/'/g, "''") + "'";

export function updateScript({ kind, pid, appExe, file, allUsers = false }) {
  const lines = [
    '$ErrorActionPreference = "SilentlyContinue"',
    `Wait-Process -Id ${Number(pid) || 0} -Timeout 60`,
    'Start-Sleep -Milliseconds 500',
  ];
  if (kind === 'installed') {
    const args = ['/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOCANCEL', '/CLOSEAPPLICATIONS'];
    if (allUsers) args.push('/ALLUSERS');
    // 安裝完成後由安裝程式重新開啟（setup.iss 的 IsInAppUpdate），1.6.0 起程式檔名可能和原本不同，所以這裡不開
    // 不用 Start-Process -Wait：它會連安裝程式開啟的黑板樹也一起等，要等到老師關閉程式才結束
    lines.push(`$p = Start-Process -FilePath ${psq(file)} -ArgumentList ${psq(args.join(' '))} -PassThru`,
      '$p.WaitForExit()',
      `Remove-Item -LiteralPath ${psq(file)} -Force`);
    return lines.join('\n');
  }
  // 免安裝版：把下載好的 .new 換成正式檔名；檔案被鎖住時多試幾次
  lines.push('for ($i = 0; $i -lt 20; $i++) {',
    `  try { Move-Item -LiteralPath ${psq(file)} -Destination ${psq(appExe)} -Force -ErrorAction Stop; break } catch { Start-Sleep -Milliseconds 500 }`,
    '}',
    `Start-Process -FilePath ${psq(appExe)} -WorkingDirectory ${psq(appExe.replace(/[\\/][^\\/]*$/, ''))}`);
  return lines.join('\n');
}

// PowerShell -EncodedCommand 要的是 UTF-16LE 的 Base64
export function encodePowerShell(script) {
  const bytes = new Uint8Array(script.length * 2);
  for (let i = 0; i < script.length; i++) {
    const c = script.charCodeAt(i);
    bytes[i * 2] = c & 255;
    bytes[i * 2 + 1] = c >> 8;
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// 版本紀錄的 Markdown（**粗體**、`程式碼`）轉成純文字
export const plainNote = (s) => String(s).replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/^\s*[-*]\s+/, '');
