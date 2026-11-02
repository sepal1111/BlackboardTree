import './helpers.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUi, visibleTools, toggleTool, iconPx, dockInfo, DEFAULT_UI } from '../static/js/ui-prefs.js';

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
      { dock: 'left', icon: 'xl', labels: 'hide', hidden: ['clock'] });
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
