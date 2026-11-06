import './helpers.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { layoutsOf, saveLayout, updateLayout, findLayout, renameLayout, deleteLayout, applyLayout, renameInLayouts, cleanLabel } from '../static/js/seat-layouts.js';

const settings = () => ({ classLists: [{ id: 'c1', name: '三年一班' }, { id: 'c2', name: '三年二班' }] });
const st = (seats, rows = 2, cols = 2, flip = false) => ({ rows, cols, seats, flip });

describe('座位表的紀錄', () => {
  test('每班可以存好幾組，各自有名稱，最近用的在前', () => {
    const s = settings();
    const a = saveLayout(s, 'c1', st(['小明', '小華', '', '小美']), '數學', 1);
    const b = saveLayout(s, 'c1', st(['小美', '', '小明', '小華']), '考試', 2);
    saveLayout(s, 'c2', st(['阿德']), '英語', 3);
    assert.deepEqual(layoutsOf(s, 'c1').map((l) => l.label), ['考試', '數學']);
    assert.deepEqual(layoutsOf(s, 'c2').map((l) => l.label), ['英語']);
    assert.equal(findLayout(s, 'c1', a.id).seats[0], '小明');
    assert.notEqual(a.id, b.id);
  });
  test('同名稱會覆蓋那一組，不會多一筆', () => {
    const s = settings();
    const a = saveLayout(s, 'c1', st(['小明']), '數學', 1);
    const b = saveLayout(s, 'c1', st(['小華']), ' 數學 ', 2);
    assert.equal(a.id, b.id);
    assert.equal(layoutsOf(s, 'c1').length, 1);
    assert.equal(layoutsOf(s, 'c1')[0].seats[0], '小華');
  });
  test('空白名稱、不存在的班級不存', () => {
    const s = settings();
    assert.equal(saveLayout(s, 'c1', st([]), '  '), null);
    assert.equal(saveLayout(s, 'nope', st([]), '數學'), null);
    assert.equal(cleanLabel('一二三四五六七八九十一二三四五六七八九十多'), '一二三四五六七八九十一二三四五六七八九十');
  });
  test('沒有班級的座位表不存', () => {
    const s = settings();
    assert.equal(saveLayout(s, '', st(['甲']), '社團'), null);
    assert.deepEqual(layoutsOf(s, ''), []);
  });
  test('使用中的那一組：座位改變才存回', () => {
    const s = settings();
    const a = saveLayout(s, 'c1', st(['小明', '小華']), '數學', 1);
    assert.equal(updateLayout(s, 'c1', a.id, st(['小明', '小華']), 5), false);
    assert.equal(findLayout(s, 'c1', a.id).at, 1);
    assert.equal(updateLayout(s, 'c1', a.id, st(['小華', '小明'], 3, 2, true), 6), true);
    assert.deepEqual([a.rows, a.cols, a.flip, a.seats, a.at], [3, 2, true, ['小華', '小明'], 6]);
    assert.equal(updateLayout(s, 'c1', 'missing', st([])), false);
  });
  test('改名不能和其他組同名；刪除後清掉空的班級', () => {
    const s = settings();
    const a = saveLayout(s, 'c1', st([]), '數學');
    saveLayout(s, 'c1', st([]), '考試');
    assert.equal(renameLayout(s, 'c1', a.id, '考試'), false);
    assert.equal(renameLayout(s, 'c1', a.id, '數學（分組）'), true);
    assert.equal(a.label, '數學（分組）');
    for (const l of layoutsOf(s, 'c1')) deleteLayout(s, 'c1', l.id);
    assert.equal('c1' in s.seatLayouts, false);
  });
  test('套用：已經不在名單的人變空位、重複的名字只留一個', () => {
    const r = applyLayout(st(['小明', '轉走的', '小明', '小華'], 2, 2, true), ['小明', '小華', '新同學']);
    assert.deepEqual(r, { rows: 2, cols: 2, seats: ['小明', '', '', '小華'], flip: true });
  });
  test('班級刪除後，它的紀錄也清掉', () => {
    const s = settings();
    saveLayout(s, 'c2', st([]), '英語');
    s.classLists = s.classLists.filter((l) => l.id !== 'c2');
    assert.deepEqual(layoutsOf(s, 'c2'), []);
    assert.equal('c2' in s.seatLayouts, false);
  });
  test('學生改名：紀錄裡的名字一起換', () => {
    const s = settings();
    saveLayout(s, 'c1', st(['小明', '小華']), '數學');
    saveLayout(s, 'c1', st(['小華', '小明']), '考試');
    assert.equal(renameInLayouts(s, 'c1', '小明', '王小明'), true);
    assert.deepEqual(layoutsOf(s, 'c1').map((l) => l.seats.join()).sort(), ['小華,王小明', '王小明,小華']);
  });
  test('太多組時刪掉最久沒用的', () => {
    const s = settings();
    for (let i = 0; i < 5; i++) saveLayout(s, 'c1', st([]), '第' + i, i, 3);
    assert.deepEqual(layoutsOf(s, 'c1').map((l) => l.label), ['第4', '第3', '第2']);
  });
});
