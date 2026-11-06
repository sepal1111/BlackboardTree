import './helpers.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { recordClassTool, classToolsOf, forgetClassTool, recordLastTool, lastToolState } from '../static/js/roster.js';

const settings = () => ({ classLists: [{ id: 'c1', name: '三年二班', students: [] }, { id: 'c2', name: '三年三班', students: [] }] });

describe('各班使用過的小工具', () => {
  test('連結班級的小工具會記下最後的狀態，最近用的在前', () => {
    const st = settings();
    assert.equal(recordClassTool(st, 'seats', { listId: 'c1', rows: 5, seats: ['甲', '乙'] }, 100), true);
    assert.equal(recordClassTool(st, 'points', { listId: 'c1', scores: { 甲: 3 } }, 200), true);
    const list = classToolsOf(st, 'c1');
    assert.deepEqual(list.map((x) => x.type), ['points', 'seats']);
    assert.deepEqual(list[1].state.seats, ['甲', '乙']);
    assert.deepEqual(classToolsOf(st, 'c2'), []);
  });
  test('同一種小工具只留最新的一筆；狀態沒變就不重寫', () => {
    const st = settings();
    recordClassTool(st, 'points', { listId: 'c1', scores: { 甲: 1 } }, 100);
    assert.equal(recordClassTool(st, 'points', { listId: 'c1', scores: { 甲: 1 } }, 500), false);
    assert.equal(classToolsOf(st, 'c1')[0].usedAt, 100);
    recordClassTool(st, 'points', { listId: 'c1', scores: { 甲: 2 } }, 600);
    const list = classToolsOf(st, 'c1');
    assert.equal(list.length, 1);
    assert.deepEqual(list[0].state.scores, { 甲: 2 });
  });
  test('存的是複本：之後修改小工具不會改到紀錄', () => {
    const st = settings();
    const state = { listId: 'c1', scores: { 甲: 1 } };
    recordClassTool(st, 'points', state, 1);
    state.scores.甲 = 99;
    assert.equal(classToolsOf(st, 'c1')[0].state.scores.甲, 1);
  });
  test('沒有連結班級、班級不存在、自己輸入名單的不記錄', () => {
    const st = settings();
    assert.equal(recordClassTool(st, 'timer', { duration: 300 }), false);
    assert.equal(recordClassTool(st, 'names', { listId: '', names: '甲\n乙' }), false);
    assert.equal(recordClassTool(st, 'names', { listId: 'gone' }), false);
    assert.equal(st.classTools, undefined);
  });
  test('班級刪除後，下次記錄時清掉該班的紀錄', () => {
    const st = settings();
    recordClassTool(st, 'seats', { listId: 'c2', rows: 4 }, 1);
    st.classLists = st.classLists.filter((l) => l.id !== 'c2');
    recordClassTool(st, 'seats', { listId: 'c1', rows: 5 }, 2);
    assert.deepEqual(Object.keys(st.classTools), ['c1']);
  });
  test('刪除一筆紀錄；最後一筆刪掉時連班級也清掉', () => {
    const st = settings();
    recordClassTool(st, 'seats', { listId: 'c1' }, 1);
    assert.equal(forgetClassTool(st, 'c1', 'seats'), true);
    assert.deepEqual(classToolsOf(st, 'c1'), []);
    assert.equal(st.classTools.c1, undefined);
    assert.equal(forgetClassTool(st, 'c1', 'seats'), false);
  });
  test('設定檔內容有誤時不出錯', () => {
    assert.deepEqual(classToolsOf({ classTools: { c1: 'x' } }, 'c1'), []);
    assert.deepEqual(classToolsOf({ classTools: { c1: { seats: null } } }, 'c1'), []);
    assert.deepEqual(classToolsOf(null, 'c1'), []);
  });
});

describe('新開小工具時沿用上次的狀態', () => {
  test('上次用的班級：用那一班最後的座位', () => {
    const st = settings();
    recordClassTool(st, 'seats', { listId: 'c1', rows: 4, seats: ['甲', '乙'] });
    recordClassTool(st, 'seats', { listId: 'c2', rows: 6, seats: ['丙'] });
    assert.deepEqual(lastToolState(st, 'seats', 'c1').seats, ['甲', '乙']);
    assert.equal(lastToolState(st, 'seats', 'c2').rows, 6);
    assert.equal(lastToolState(st, 'points', 'c1'), null); // 這班沒用過
  });
  test('回傳的是複本，改了不會動到紀錄', () => {
    const st = settings();
    recordClassTool(st, 'seats', { listId: 'c1', seats: ['甲'] });
    lastToolState(st, 'seats', 'c1').seats[0] = '乙';
    assert.equal(lastToolState(st, 'seats', 'c1').seats[0], '甲');
  });
  test('沒有班級（自己輸入名單）：記在 lastTools，沒有上次的班級時沿用', () => {
    const st = settings();
    assert.equal(recordLastTool(st, 'seats', { listId: '', names: '甲,乙', seats: ['乙', '甲'] }, 1), true);
    assert.equal(recordLastTool(st, 'seats', { listId: '', names: '甲,乙', seats: ['乙', '甲'] }, 2), false);
    assert.equal(recordLastTool(st, 'seats', { listId: 'c1', seats: [] }), false); // 有班級的不記在這裡
    assert.deepEqual(lastToolState(st, 'seats', '').seats, ['乙', '甲']);
    assert.deepEqual(lastToolState(st, 'seats', 'gone').seats, ['乙', '甲']); // 上次的班級已刪除
    assert.equal(lastToolState({}, 'seats', ''), null);
  });
});
