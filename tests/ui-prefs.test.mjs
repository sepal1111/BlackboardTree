import './helpers.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUi, visibleTools, toggleTool, iconPx, dockInfo, DEFAULT_UI, gridCell, nextGrid, snapMove, snapResize } from '../static/js/ui-prefs.js';

const types = ['timer', 'clock', 'names'];
const list = types.map((type) => ({ type }));

describe('畫面偏好（工具列位置、圖示大小、工具列文字、顯示的工具）', () => {
  test('沒有設定或格式錯誤時用預設值', () => {
    assert.deepEqual(normalizeUi(undefined, types), DEFAULT_UI);
    assert.deepEqual(normalizeUi('x', types), DEFAULT_UI);
    assert.deepEqual(normalizeUi({ dock: 'middle', icon: 'huge', labels: 'maybe', hidden: 'timer' }, types), DEFAULT_UI);
    assert.equal(DEFAULT_UI.labels, 'auto'); // 預設：視窗小的時候自動只顯示圖示
  });

  test('保留正確的設定，去掉不存在或重複的小工具', () => {
    assert.deepEqual(normalizeUi({ dock: 'left', icon: 'xl', labels: 'hide', hidden: ['clock', 'clock', 'gone'] }, types),
      { dock: 'left', icon: 'xl', labels: 'hide', grid: 'off', gridShow: 'drag', hidden: ['clock'] });
    assert.equal(normalizeUi({ dock: 'top' }, types).labels, 'auto'); // 1.3 以前沒有這個設定
  });

  test('全部隱藏時改回全部顯示', () => {
    assert.deepEqual(normalizeUi({ hidden: types }, types).hidden, []);
  });

  test('小工具列只列出要顯示的工具，順序不變', () => {
    assert.deepEqual(visibleTools(list, { hidden: ['clock'] }).map((d) => d.type), ['timer', 'names']);
  });

  test('切換工具顯示，至少保留一個', () => {
    let ui = normalizeUi({}, types);
    ui = toggleTool(ui, 'timer', false, types);
    ui = toggleTool(ui, 'clock', false, types);
    assert.deepEqual(ui.hidden, ['timer', 'clock']);
    assert.deepEqual(toggleTool(ui, 'names', false, types).hidden, ['timer', 'clock']); // 最後一個不能隱藏
    assert.deepEqual(toggleTool(ui, 'timer', true, types).hidden, ['clock']);
  });

  test('圖示大小與位置說明', () => {
    assert.equal(iconPx({ icon: 'm' }), 24);
    assert.equal(iconPx({ icon: 'xl' }), 42);
    assert.equal(iconPx({ icon: 'xs' }), 14);
    assert.equal(iconPx({ icon: '??' }), 24); // 不認得的大小用「中」
    assert.equal(dockInfo({ dock: 'right' }).where, '右側');
  });
});

describe('畫布格線與對齊', () => {
  test('格線設定：不認得的值改回預設（關閉、拖曳時顯示）', () => {
    assert.equal(normalizeUi({ grid: 'm', gridShow: 'always' }, types).grid, 'm');
    assert.equal(normalizeUi({ grid: 'm', gridShow: 'always' }, types).gridShow, 'always');
    assert.equal(normalizeUi({ grid: 'huge', gridShow: 'x' }, types).grid, 'off');
    assert.equal(normalizeUi({ dock: 'top' }, types).gridShow, 'drag'); // 1.8 以前沒有這個設定
  });
  test('格子大小是畫布寬度的幾分之一；關閉時是 0', () => {
    assert.equal(gridCell({ grid: 's' }, 1920), 30);
    assert.equal(gridCell({ grid: 'm' }, 1920), 60);
    assert.equal(gridCell({ grid: 'l' }, 1920), 120);
    assert.equal(gridCell({ grid: 'off' }, 1920), 0);
  });
  test('快捷鍵 G 依序切換：關閉 → 小 → 中 → 大 → 關閉', () => {
    assert.deepEqual(['off', 's', 'm', 'l'].map(nextGrid), ['s', 'm', 'l', 'off']);
    assert.equal(nextGrid('???'), 'off');
  });
  test('移動：左上角對齊最近的格線', () => {
    const p = snapMove({ x: 125 / 1000, y: 47 / 500 }, 50, 1000, 500);
    assert.equal(Math.round(p.x * 1000), 150);
    assert.equal(Math.round(p.y * 500), 50);
  });
  test('調整大小：右下角對齊格線，而且不小於最小尺寸', () => {
    const s = snapResize({ x: 0.1, y: 0.1, w: 0.33, h: 0.21 }, 50, 1000, 500, 150, 100);
    assert.equal(Math.round((0.1 + s.w) * 1000), 450); // 右邊 430 → 450
    assert.equal(Math.round((0.1 + s.h) * 500), 150);  // 下邊 155 → 150
    const tiny = snapResize({ x: 0, y: 0, w: 0.12, h: 0.1 }, 100, 1000, 500, 150, 110);
    assert.equal(Math.round(tiny.w * 1000), 200); // 對齊後 100 太小，往後一格
    assert.equal(Math.round(tiny.h * 500), 200);
  });
  test('格線關閉時不改變', () => {
    assert.deepEqual(snapMove({ x: 0.123, y: 0.456 }, 0, 1000, 500), { x: 0.123, y: 0.456 });
    assert.deepEqual(snapResize({ x: 0, y: 0, w: 0.3, h: 0.4 }, 0, 1000, 500), { w: 0.3, h: 0.4 });
  });
});
