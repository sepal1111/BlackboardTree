import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeImageState, wrapIndex, clampIndex, moveItem, refName, addRefs, isImageName } from '../static/js/image-list.js';

const A = { kind: 'file', base: 'data', path: 'media/a.jpg', name: '校外教學.jpg' };
const B = { kind: 'file', base: 'root', path: '照片/b.png' };
const C = { kind: 'url', url: 'https://x.tw/img/c%20d.webp?w=1' };

describe('圖片工具的多張照片', () => {
  it('舊版只有一張（ref）會變成 refs 陣列', () => {
    const s = normalizeImageState({ ref: A, fit: 'cover', caption: 'x', refs: [] });
    assert.deepEqual(s.refs, [A]);
    assert.equal('ref' in s, false);
    assert.equal(s.mode, 'slide');
    assert.equal(s.thumb, 'm');
    assert.equal(s.index, 0);
  });

  it('沒有設定顯示方式時，多張用縮圖卡片；index 超出範圍拉回來', () => {
    const s = normalizeImageState({ refs: [A, B, null], index: 9 });
    assert.equal(s.refs.length, 2);
    assert.equal(s.mode, 'grid');
    assert.equal(s.index, 1);
    assert.equal(normalizeImageState({ refs: [A, B], mode: 'slide' }).mode, 'slide');
    assert.equal(normalizeImageState({ refs: [], index: 3 }).index, 0);
  });

  it('單張切換頭尾相接', () => {
    assert.equal(wrapIndex(3, 3), 0);
    assert.equal(wrapIndex(-1, 3), 2);
    assert.equal(wrapIndex(1, 3), 1);
    assert.equal(wrapIndex(5, 0), 0);
    assert.equal(clampIndex(-2, 3), 0);
    assert.equal(clampIndex('2', 3), 2);
  });

  it('調整順序', () => {
    assert.deepEqual(moveItem([A, B, C], 0, 1), [B, A, C]);
    assert.deepEqual(moveItem([A, B, C], 2, -1), [A, C, B]);
    assert.deepEqual(moveItem([A, B, C], 0, -1), [A, B, C]); // 第一張不能再往前
    assert.deepEqual(moveItem([A, B, C], 2, 1), [A, B, C]);
  });

  it('顯示用的檔名', () => {
    assert.equal(refName(A), '校外教學.jpg');
    assert.equal(refName(B), 'b.png');
    assert.equal(refName(C), 'c d.webp');
    assert.equal(refName({ kind: 'data', url: 'data:image/jpeg;base64,xx' }), '');
    assert.equal(refName(null), '');
  });

  it('加入時略過重複的圖片', () => {
    const out = addRefs([A, B], [{ ...B }, C, { ...C }]);
    assert.deepEqual(out, [A, B, C]);
  });

  it('只挑圖片檔', () => {
    assert.equal(isImageName('a.JPG'), true);
    assert.equal(isImageName('b.jpeg'), true);
    assert.equal(isImageName('說明.pdf'), false);
    assert.equal(isImageName('.hidden.png'), false);
  });
});
