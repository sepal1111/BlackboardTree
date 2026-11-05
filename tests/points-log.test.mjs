import './helpers.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { OLD_KEY, dayKey, logPoint, ensureDaily, totalsIn, daysIn, rankPeople, renameInDaily, leaderboardCsv, rangeLabel, RANGES } from '../static/js/points-log.js';

const D = (s) => new Date(s + 'T10:00:00');
const people = [{ no: '01', name: '王小明' }, { no: '02', name: '陳美麗' }, { no: '03', name: '林志豪' }, { no: '04', name: '張三' }];

describe('課堂加分的每日紀錄', () => {
  test('每次加減分記在當天，每天只存每人的淨分數', () => {
    const daily = {};
    logPoint(daily, '王小明', 1, D('2026-11-04'));
    logPoint(daily, '王小明', 1, D('2026-11-04'));
    logPoint(daily, '陳美麗', -1, D('2026-11-04'));
    logPoint(daily, '王小明', 1, D('2026-11-05'));
    assert.deepEqual(daily, { '2026-11-04': { 王小明: 2, 陳美麗: -1 }, '2026-11-05': { 王小明: 1 } });
  });
  test('加回 0 分時移除那一筆，整天都是 0 就移除那一天', () => {
    const daily = {};
    logPoint(daily, '王小明', 1, D('2026-11-04'));
    logPoint(daily, '王小明', -1, D('2026-11-04'));
    assert.deepEqual(daily, {});
  });
  test('舊資料沒有每日紀錄：目前分數變成「先前累計」，只做一次', () => {
    const s = { scores: { 王小明: 5, 陳美麗: 0, 林志豪: -2 } };
    assert.equal(ensureDaily(s), true);
    assert.deepEqual(s.daily, { [OLD_KEY]: { 王小明: 5, 林志豪: -2 } });
    assert.equal(ensureDaily(s), false);
    const fresh = { scores: {} };
    ensureDaily(fresh);
    assert.deepEqual(fresh.daily, {});
  });
  test('dayKey 用本地日期', () => {
    assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  });
});

describe('排行榜', () => {
  const daily = {
    [OLD_KEY]: { 王小明: 3 },
    '2026-11-03': { 陳美麗: 2, 林志豪: 1 },
    '2026-11-04': { 王小明: 1, 陳美麗: 2 },
    '2026-11-05': { 林志豪: 4, 張三: -1 },
  };
  test('累計包含先前累計；今天、指定區間依日期（含頭尾）', () => {
    assert.deepEqual(totalsIn(daily, {}), { 王小明: 4, 陳美麗: 4, 林志豪: 5, 張三: -1 });
    assert.deepEqual(totalsIn(daily, RANGES.today(D('2026-11-05'))), { 林志豪: 4, 張三: -1 });
    assert.deepEqual(totalsIn(daily, { from: '2026-11-03', to: '2026-11-04' }), { 陳美麗: 4, 林志豪: 1, 王小明: 1 });
    assert.deepEqual(daysIn(daily, { from: '2026-11-04' }), ['2026-11-04', '2026-11-05']);
  });
  test('同分同名次（1、2、2、4），同分依座號；沒有分數的人也列出', () => {
    const r = rankPeople(people, totalsIn(daily, {}));
    assert.deepEqual(r.map((p) => [p.rank, p.name, p.total]), [[1, '林志豪', 5], [2, '王小明', 4], [2, '陳美麗', 4], [4, '張三', -1]]);
    const none = rankPeople(people, {});
    assert.deepEqual(none.map((p) => p.rank), [1, 1, 1, 1]);
  });
  test('學生改名時每日紀錄跟著改', () => {
    const d = { '2026-11-04': { 王小明: 2 }, '2026-11-05': { 王小明: 1, 王曉明: 1 } };
    renameInDaily(d, '王小明', '王曉明');
    assert.deepEqual(d, { '2026-11-04': { 王曉明: 2 }, '2026-11-05': { 王曉明: 2 } });
  });
  test('匯出 CSV：BOM、名次座號姓名合計與每天分數，負分是數字不加引號', () => {
    const csv = leaderboardCsv(people, daily, { from: '2026-11-04', to: '2026-11-05' });
    assert.ok(csv.startsWith('﻿'));
    const lines = csv.slice(1).trim().split('\r\n');
    assert.equal(lines[0], '名次,座號,姓名,合計,11/04,11/05');
    assert.equal(lines[1], '1,03,林志豪,4,0,4');
    assert.equal(lines[4], '4,04,張三,-1,0,-1');
    assert.match(leaderboardCsv(people, daily, {}).split('\r\n')[0], /先前累計/);
  });
  test('名字以 = 開頭時加上 \' 避免被 Excel 當成公式', () => {
    const csv = leaderboardCsv([{ no: 1, name: '=1+1' }], {}, {});
    assert.match(csv, /'=1\+1/);
  });
  test('範圍說明', () => {
    assert.equal(rangeLabel('total', {}), '累計');
    assert.equal(rangeLabel('today', { from: '2026-11-05' }), '今天（11/05）');
    assert.equal(rangeLabel('range', { from: '2026-11-01', to: '2026-11-05' }), '11/01～11/05');
  });
});
