import './helpers.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fileKind, isImportable, isImageName, resKind, normalizeResState, upgradeImageState, upgradeEmbedState,
  clampIndex, wrapIndex, moveItem, refName, addRefs, fmtSize, BIG_FILE,
} from '../static/js/res-list.js';
import { upgradeWidget } from '../static/js/widgets/index.js';

describe('匯入資源：檔案類型', () => {
  it('依副檔名分類', () => {
    assert.equal(fileKind('a.PNG'), 'image');
    assert.equal(fileKind('課堂.mp4'), 'video');
    assert.equal(fileKind('song.m4a'), 'audio');
    assert.equal(fileKind('講義.pdf'), 'pdf');
    assert.equal(fileKind('note.txt'), 'text');
    assert.equal(fileKind('報告.docx'), 'word');
    assert.equal(fileKind('a.odt'), 'odt');
    assert.equal(fileKind('a.ods'), 'ods');
    assert.equal(fileKind('a.odp'), 'odp');
    assert.equal(fileKind('a.pptx'), 'office');
    assert.equal(fileKind('a.exe'), '');
    assert.equal(fileKind('noext'), '');
  });

  it('隱藏檔、Office 暫存檔不列出', () => {
    assert.ok(isImportable('a.mp3'));
    assert.ok(!isImportable('~$報告.docx'));
    assert.ok(!isImportable('.hidden.png'));
    assert.ok(!isImportable('setup.exe'));
    assert.ok(isImageName('a.jpg') && !isImageName('a.mp4'));
  });

  it('資源類型：檔案、網址、內嵌圖片、舊圖片網址', () => {
    assert.equal(resKind({ kind: 'file', base: 'data', path: 'media/x.webm' }), 'video');
    assert.equal(resKind({ kind: 'abs', path: 'D:\\影片\\大檔.mp4', name: '大檔.mp4' }), 'video');
    assert.equal(resKind({ kind: 'data', url: 'data:image/png;base64,AAA' }), 'image');
    assert.equal(resKind({ kind: 'url', url: 'https://youtu.be/abcdefghijk' }), 'youtube');
    assert.equal(resKind({ kind: 'url', url: 'https://example.com/a.mp4' }), 'video');
    assert.equal(resKind({ kind: 'url', url: 'https://example.com/a.pdf' }), 'pdf');
    assert.equal(resKind({ kind: 'url', url: 'https://example.com/page' }), 'web');
    assert.equal(resKind({ kind: 'url', url: 'https://example.com/photo', as: 'image' }), 'image');
    assert.equal(resKind({ kind: 'url', url: 'https://www.instagram.com/reel/ABC_1/' }), 'social');
    assert.equal(resKind(null), '');
  });

  it('大檔案門檻是 200 MB', () => {
    assert.equal(BIG_FILE, 200 * 1024 * 1024);
    assert.equal(fmtSize(512), '512 B');
    assert.equal(fmtSize(1536), '1.5 KB');
    assert.equal(fmtSize(250 * 1024 * 1024), '250 MB');
  });
});

describe('匯入資源：狀態', () => {
  it('補上預設值、修正超出範圍的編號', () => {
    const s = normalizeResState({ refs: [{ kind: 'url', url: 'https://a.tw' }, null, 'x'], index: 9, thumb: 'xx', zoom: 0 });
    assert.equal(s.refs.length, 1);
    assert.equal(s.index, 0);
    assert.equal(s.mode, 'slide');
    assert.equal(s.thumb, 'm');
    assert.equal(s.zoom, 1);
    assert.equal(normalizeResState({ refs: [{ kind: 'url', url: 'a' }, { kind: 'url', url: 'b' }] }).mode, 'grid');
  });

  it('編號、移動', () => {
    assert.equal(clampIndex(5, 3), 2);
    assert.equal(clampIndex(-1, 3), 0);
    assert.equal(wrapIndex(-1, 3), 2);
    assert.equal(wrapIndex(3, 3), 0);
    assert.deepEqual(moveItem([1, 2, 3], 0, 1), [2, 1, 3]);
    assert.deepEqual(moveItem([1, 2, 3], 2, 1), [1, 2, 3]);
  });

  it('加入時去掉重複的資源', () => {
    const a = { kind: 'file', base: 'data', path: 'media/a.png' };
    const b = { kind: 'abs', path: 'D:\\v.mp4', name: 'v.mp4' };
    const out = addRefs([a], [{ ...a }, b, { ...b }, { kind: 'url', url: 'https://x.tw' }]);
    assert.equal(out.length, 3);
  });

  it('顯示名稱', () => {
    assert.equal(refName({ kind: 'file', base: 'root', path: '照片/%E6%B8%AC.jpg' }), '測.jpg');
    assert.equal(refName({ kind: 'abs', path: 'D:\\影片\\上課.mp4', name: '上課.mp4' }), '上課.mp4');
    assert.equal(refName({ kind: 'url', url: 'https://www.example.com/a/b?x=1' }), 'example.com/a/b');
    assert.equal(refName({ kind: 'url', url: 'https://example.com/v/clip.mp4' }), 'clip.mp4');
    assert.equal(refName({ kind: 'url', url: 'https://www.youtube.com/watch?v=abcdefghijk' }), 'YouTube 影片');
    assert.equal(refName({ kind: 'data', url: 'data:image/png;base64,AAA' }), '');
  });
});

describe('舊的「圖片」「網頁／影片」轉成匯入資源', () => {
  it('圖片：設定保留，網址一律當圖片', () => {
    const w = { id: 'a', type: 'image', x: 0.1, y: 0.2, w: 0.3, h: 0.3, z: 2, state: { ref: { kind: 'url', url: 'https://x.tw/p' }, fit: 'cover', caption: '說明' } };
    const u = upgradeWidget(w);
    assert.equal(u.type, 'resource');
    assert.equal(u.x, 0.1);
    assert.equal(u.state.fit, 'cover');
    assert.equal(u.state.caption, '說明');
    assert.deepEqual(u.state.refs, [{ kind: 'url', url: 'https://x.tw/p', as: 'image' }]);
    assert.ok(!('ref' in u.state));
    const multi = upgradeWidget({ type: 'image', state: { refs: [{ kind: 'file', base: 'data', path: 'media/a.png' }], mode: 'grid' } });
    assert.deepEqual(multi.state.refs, [{ kind: 'file', base: 'data', path: 'media/a.png' }]);
    assert.equal(multi.state.mode, 'grid');
  });

  it('網頁／影片：網址變成一個資源，手機送來的標記保留', () => {
    const u = upgradeWidget({ id: 'b', type: 'embed', state: { url: ' https://youtu.be/abcdefghijk ', fromRemote: true } });
    assert.equal(u.type, 'resource');
    assert.deepEqual(u.state, { refs: [{ kind: 'url', url: 'https://youtu.be/abcdefghijk' }], mode: 'slide', index: 0, autoplay: false, fromRemote: true });
    assert.deepEqual(upgradeEmbedState({}).refs, []);
    assert.deepEqual(upgradeImageState({}).refs, []);
  });
});
