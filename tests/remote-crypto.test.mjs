import './helpers.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { newKey, seal, open, newPair, wrapKey, unwrapKey, parseHash, KEY_RE, toB64, fromB64 } from '../static/js/remote-crypto.js';

describe('手機遙控的加密', () => {
  test('金鑰是 43 字的 base64url，每次都不同', () => {
    const a = newKey(), b = newKey();
    assert.ok(KEY_RE.test(a) && KEY_RE.test(b));
    assert.notEqual(a, b);
  });

  test('加密後解得回來；看不出原文，每次密文都不同', () => {
    const key = newKey();
    const data = { board: '三年二班', list: ['王小明', '陳大華'], n: 3 };
    const box = seal(data, key);
    assert.ok(!box.includes('王小明') && !box.includes('board'));
    assert.notEqual(seal(data, key), box);
    assert.deepEqual(open(box, key), data);
  });

  test('金鑰不對、內容被改過、格式錯誤都回傳 null', () => {
    const key = newKey();
    const box = seal({ a: 1 }, key);
    assert.equal(open(box, newKey()), null);
    const b = fromB64(box);
    b[b.length - 1] ^= 1;
    assert.equal(open(toB64(b), key), null);
    assert.equal(open('', key), null);
    assert.equal(open(null, key), null);
    assert.equal(open(box, ''), null);
    assert.throws(() => seal({ a: 1 }, ''));
  });

  test('大量資料也能加密（超過 32 KB）', () => {
    const key = newKey();
    const big = { s: '字'.repeat(50000) };
    assert.deepEqual(open(seal(big, key), key), big);
  });

  test('用手機的公鑰交換金鑰：只有那支手機解得開', () => {
    const key = newKey();
    const phone = newPair();
    assert.ok(KEY_RE.test(phone.publicKey));
    const box = wrapKey(key, phone.publicKey);
    assert.ok(box.length >= 100 && box.length <= 200, 'relay 只接受 100–200 字');
    assert.equal(unwrapKey(box, phone), key);
    assert.equal(unwrapKey(box, newPair()), '');
    assert.equal(unwrapKey('abc', phone), '');
    assert.equal(wrapKey(key, 'bad'), '');
  });

  test('解析 QR Code 網址的 #', () => {
    const k = newKey();
    assert.deepEqual(parseHash('#123456.' + k), { code: '123456', key: k });
    assert.deepEqual(parseHash('#123456'), { code: '123456', key: '' });
    assert.deepEqual(parseHash('#123 456'), { code: '123456', key: '' });
    assert.deepEqual(parseHash('#123456.short'), { code: '123456', key: '' });
    assert.deepEqual(parseHash('#12345'), { code: '', key: '' });
    assert.deepEqual(parseHash('#%E0%A4%A'), { code: '', key: '' });
    assert.deepEqual(parseHash(''), { code: '', key: '' });
  });
});
