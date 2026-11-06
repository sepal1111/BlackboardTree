// 手機遙控的加密：手機和教室電腦之間的白板內容、指令都先加密，遙控伺服器只轉送看不懂的資料
// 遙控網頁是 HTTP（區網沒有憑證），瀏覽器不提供內建的加密功能，所以用 tweetnacl（XSalsa20-Poly1305、X25519）
// - 每組遙控代碼有一把隨機金鑰（32 bytes），放在 QR Code 網址的 # 後面：#<代碼>.<金鑰>，瀏覽器不會把 # 後面送到網路上
// - 手動輸入代碼的手機沒有金鑰：連線時帶自己的公鑰（&pk=），老師按「允許」時，教室電腦把金鑰用這個公鑰加密後交給手機
import '../vendor/nacl-fast.min.js';

const nacl = globalThis.nacl;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64(s) {
  try {
    const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

// 金鑰、公鑰：32 bytes 的 base64url（43 字）
export const KEY_RE = /^[\w-]{43}$/;
export const newKey = () => toB64(nacl.randomBytes(32));
const keyBytes = (k) => (KEY_RE.test(k || '') ? fromB64(k) : null);

// 加密任意 JSON 資料：nonce(24) + 密文，base64url
export function seal(obj, key) {
  const k = keyBytes(key);
  if (!k) throw new Error('沒有加密金鑰');
  const nonce = nacl.randomBytes(24);
  const box = nacl.secretbox(enc.encode(JSON.stringify(obj)), nonce, k);
  const out = new Uint8Array(24 + box.length);
  out.set(nonce);
  out.set(box, 24);
  return toB64(out);
}

// 解密；金鑰不對、內容被改過都回傳 null
export function open(str, key) {
  const k = keyBytes(key);
  const b = typeof str === 'string' ? fromB64(str) : null;
  if (!k || !b || b.length < 24 + 16) return null;
  const plain = nacl.secretbox.open(b.subarray(24), b.subarray(0, 24), k);
  if (!plain) return null;
  try { return JSON.parse(dec.decode(plain)); } catch { return null; }
}

// 手機：產生一次性的金鑰對，公鑰放在連線網址
export function newPair() {
  const p = nacl.box.keyPair();
  return { publicKey: toB64(p.publicKey), secretKey: p.secretKey };
}

// 教室電腦：把遙控金鑰加密給手機（教室電腦的一次性公鑰(32) + nonce(24) + 密文）
export function wrapKey(key, phonePk) {
  const k = keyBytes(key), pk = keyBytes(phonePk);
  if (!k || !pk) return '';
  const mine = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);
  const box = nacl.box(k, nonce, pk, mine.secretKey);
  const out = new Uint8Array(32 + 24 + box.length);
  out.set(mine.publicKey);
  out.set(nonce, 32);
  out.set(box, 56);
  return toB64(out);
}

// 手機：用自己的私鑰解出遙控金鑰；失敗回傳 ''
export function unwrapKey(str, pair) {
  const b = typeof str === 'string' ? fromB64(str) : null;
  if (!b || b.length < 56 + 16 || !pair) return '';
  const k = nacl.box.open(b.subarray(56), b.subarray(32, 56), b.subarray(0, 32), pair.secretKey);
  return k && k.length === 32 ? toB64(k) : '';
}

// QR Code 網址的 #：「123456.<金鑰>」或舊的「123456」
export function parseHash(hash) {
  let s = String(hash || '').replace(/^#/, '');
  try { s = decodeURIComponent(s); } catch { /* 網址格式不對就用原本的字 */ }
  const [c = '', k = ''] = s.split('.');
  const code = c.replace(/\D/g, '');
  return { code: code.length === 6 ? code : '', key: KEY_RE.test(k) ? k : '' };
}
