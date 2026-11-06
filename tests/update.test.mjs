import './helpers.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareVersions, parseVersion, normalizeManifest, notesSince, checkForUpdate, downloadVerified,
  sha256Hex, shouldAutoCheck, updateScript, encodePowerShell, plainNote, verifyManifest, signedPayload, UPDATE_PUBLIC_KEY,
} from '../static/js/update.js';
import { generateKeyPairSync, sign } from 'node:crypto';

// 測試用的簽章金鑰（正式的私鑰只在發布者的電腦上）
const { privateKey: TEST_KEY, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const TEST_PUB = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const signed = (obj, key = TEST_KEY) => ({ ...obj, signature: sign('sha256', Buffer.from(signedPayload(obj)), { key, dsaEncoding: 'ieee-p1363' }).toString('base64') });

const SHA = 'a'.repeat(64);
const manifest = (over = {}) => ({
  version: '1.5.0', date: '2026-11-02', notes: ['- 新功能'],
  history: [
    { version: '1.5.0', date: '2026-11-02', notes: ['- 新功能'] },
    { version: '1.4.0', date: '2026-11-01', notes: ['- 工具列文字'] },
    { version: '1.3.0', notes: ['- 投票題庫'] },
  ],
  setup: { file: 'BlackboardTree-Setup-1.6.0.exe', size: 10, sha256: SHA },
  portable: { file: 'BlackboardTree.exe', size: 20, sha256: SHA },
  ...over,
});
const jsonRes = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj });

describe('版本號比較', () => {
  test('依序比較主版本、次版本、修正版（不是字串比較）', () => {
    assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
    assert.equal(compareVersions('1.4.0', '1.4.0'), 0);
    assert.equal(compareVersions('1.4.0', '1.4.1'), -1);
    assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
  });
  test('格式不對的版本視為最舊', () => {
    assert.equal(parseVersion('1.4'), null);
    assert.equal(parseVersion('1.4.0-beta'), null);
    assert.equal(compareVersions('1.0.0', ''), 1);
    assert.equal(compareVersions(undefined, '1.0.0'), -1);
  });
});

describe('latest.json 格式檢查', () => {
  test('正確的內容', () => {
    const m = normalizeManifest(manifest());
    assert.equal(m.version, '1.5.0');
    assert.equal(m.setup.file, 'BlackboardTree-Setup-1.6.0.exe');
    assert.equal(m.history.length, 3);
  });
  test('更新內容保留子項目的縮排，去掉空白行', () => {
    const m = normalizeManifest(manifest({ notes: ['- 主項目', '  - 子項目  ', '   '] }));
    assert.deepEqual(m.notes, ['- 主項目', '  - 子項目']);
  });
  test('版本號錯誤時拒絕', () => {
    assert.throws(() => normalizeManifest({ version: 'abc' }), /格式/);
    assert.throws(() => normalizeManifest(null), /格式/);
  });
  test('檔名含路徑、檢查碼或大小錯誤的下載檔不採用', () => {
    const m = normalizeManifest(manifest({
      setup: { file: '../evil.exe', size: 10, sha256: SHA },
      portable: { file: 'BlackboardTree.exe', size: 0, sha256: SHA },
    }));
    assert.equal(m.setup, null);
    assert.equal(m.portable, null);
    assert.equal(normalizeManifest(manifest({ setup: { file: 'a.exe', size: 1, sha256: 'xyz' } })).setup, null);
  });
});

test('更新內容只列出比目前新的版本，新的在前', () => {
  const m = normalizeManifest(manifest());
  assert.deepEqual(notesSince(m, '1.3.0').map((x) => x.version), ['1.5.0', '1.4.0']);
  assert.deepEqual(notesSince(m, '1.5.0'), []);
  const noHistory = normalizeManifest(manifest({ history: [] }));
  assert.deepEqual(notesSince(noHistory, '1.0.0').map((x) => x.version), ['1.5.0']);
});

describe('檢查更新', () => {
  test('有新版本', async () => {
    let asked = '';
    const r = await checkForUpdate({ current: '1.4.0', url: 'https://x/latest.json', fetchFn: async (u) => { asked = u; return jsonRes(signed(manifest())); }, publicKey: TEST_PUB });
    assert.equal(r.newer, true);
    assert.equal(r.latest, '1.5.0');
    assert.match(asked, /^https:\/\/x\/latest\.json\?t=\d+$/, '加上時間參數避開快取');
  });
  test('已經是最新版', async () => {
    const r = await checkForUpdate({ current: '1.5.0', fetchFn: async () => jsonRes(signed(manifest())), publicKey: TEST_PUB });
    assert.equal(r.newer, false);
  });
  test('連不上或伺服器錯誤時給看得懂的訊息', async () => {
    await assert.rejects(checkForUpdate({ current: '1.0.0', fetchFn: async () => { throw new TypeError('Failed to fetch'); } }), /無法連線到 GitHub/);
    await assert.rejects(checkForUpdate({ current: '1.0.0', fetchFn: async () => jsonRes({}, 404) }), /404/);
  });
  test('數位簽章：沒有簽章、內容被改過、別人的金鑰簽的都拒絕', async () => {
    const check = (json) => checkForUpdate({ current: '1.0.0', fetchFn: async () => jsonRes(json), publicKey: TEST_PUB });
    await assert.rejects(check(manifest()), /數位簽章/);
    const tampered = signed(manifest());
    tampered.setup.sha256 = 'b'.repeat(64);
    await assert.rejects(check(tampered), /數位簽章/);
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    await assert.rejects(check(signed(manifest(), other)), /數位簽章/);
    assert.equal(await verifyManifest(signed(manifest()), TEST_PUB), true);
    assert.equal(await verifyManifest(signed(manifest())), false, '預設用程式內建的正式公鑰');
  });
  test('程式內建正式的公鑰（ECDSA P-256）', () => {
    assert.match(UPDATE_PUBLIC_KEY, /^MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE[A-Za-z0-9+/]{86}==$/);
  });
});

describe('下載並驗證', () => {
  const data = new TextEncoder().encode('Blackboard Tree new version');
  const streamRes = (bytes) => ({
    ok: true, status: 200,
    body: { getReader() { let sent = false; return { read: async () => (sent ? { done: true } : (sent = true, { done: false, value: bytes })) }; } },
  });
  test('大小與 SHA-256 相符時回傳檔案內容，網址和 latest.json 同資料夾', async () => {
    const info = { file: 'BlackboardTree.exe', size: data.length, sha256: await sha256Hex(data) };
    let asked = '';
    const progress = [];
    const out = await downloadVerified(info, 'https://raw.example/u/r/main/desktop/out/latest.json', {
      fetchFn: async (u) => { asked = u; return streamRes(data); }, onProgress: (p) => progress.push(p),
    });
    assert.deepEqual([...out], [...data]);
    assert.match(asked, /^https:\/\/raw\.example\/u\/r\/main\/desktop\/out\/BlackboardTree\.exe\?v=/);
    assert.equal(progress.at(-1), 1);
  });
  test('檢查碼不符時拒絕（檔案損壞或 GitHub 還沒更新完）', async () => {
    const info = { file: 'BlackboardTree.exe', size: data.length, sha256: SHA };
    await assert.rejects(downloadVerified(info, 'https://x/latest.json', { fetchFn: async () => streamRes(data) }), /檢查碼不符/);
  });
  test('大小不符時拒絕', async () => {
    const info = { file: 'BlackboardTree.exe', size: data.length + 5, sha256: await sha256Hex(data) };
    await assert.rejects(downloadVerified(info, 'https://x/latest.json', { fetchFn: async () => streamRes(data) }), /不完整/);
  });
});

test('自動檢查一天最多一次', () => {
  const now = 10 * 86400000;
  assert.equal(shouldAutoCheck(0, now), true);
  assert.equal(shouldAutoCheck(now - 3600000, now), false);
  assert.equal(shouldAutoCheck(now - 86400000, now), true);
  assert.equal(shouldAutoCheck(now + 3600000, now), true, '電腦時間被調回去時也要能檢查');
});

describe('更新用的 PowerShell 指令', () => {
  test('安裝版：等程式結束後靜默安裝；重新開啟交給安裝程式，路徑中的單引號要跳脫', () => {
    const s = updateScript({ kind: 'installed', pid: 123, appExe: 'C:\\a\\MyScreen.exe', file: "C:\\Users\\王's\\Temp\\BlackboardTree-Setup-1.6.0.exe" });
    assert.match(s, /Wait-Process -Id 123/);
    assert.match(s, /\/SILENT/);
    assert.doesNotMatch(s, /VERYSILENT|ALLUSERS/);
    assert.match(s, /'C:\\Users\\王''s\\Temp\\BlackboardTree-Setup-1\.6\.0\.exe'/);
    assert.equal(s.match(/Start-Process/g).length, 1, '只啟動安裝程式，不另外開啟舊檔名的程式');
    assert.doesNotMatch(s, /-Wait\b/, '-Wait 會連安裝程式開啟的黑板樹一起等');
    assert.ok(s.indexOf('WaitForExit') < s.indexOf('Remove-Item'), '安裝完才刪除安裝程式');
  });
  test('裝在 Program Files 時加 /ALLUSERS', () => {
    assert.match(updateScript({ kind: 'installed', pid: 1, appExe: 'C:\\a.exe', file: 'C:\\s.exe', allUsers: true }), /\/ALLUSERS/);
  });
  test('免安裝版：把 .new 換成原本的檔名', () => {
    const s = updateScript({ kind: 'portable', pid: 1, appExe: 'D:\\工具\\BlackboardTree.exe', file: 'D:\\工具\\BlackboardTree.exe.new' });
    assert.match(s, /Move-Item -LiteralPath 'D:\\工具\\BlackboardTree\.exe\.new' -Destination 'D:\\工具\\BlackboardTree\.exe'/);
    assert.match(s, /-WorkingDirectory 'D:\\工具'/);
  });
  test('EncodedCommand 是 UTF-16LE Base64（中文也正確）', () => {
    const enc = encodePowerShell('Write-Host 中文');
    assert.equal(Buffer.from(enc, 'base64').toString('utf16le'), 'Write-Host 中文');
  });
});

test('版本紀錄的 Markdown 轉成純文字', () => {
  assert.equal(plainNote('- **學生投票**：使用 `vote.html`'), '學生投票：使用 vote.html');
  assert.equal(plainNote('  - 子項目'), '子項目');
});
