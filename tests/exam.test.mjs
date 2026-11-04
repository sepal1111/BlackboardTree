import './helpers.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseHM, fmtHM, examSchedule, examStatus } from '../static/js/widgets/util.js';

const at = (hm, sec = 0) => { const [hh, mm] = hm.split(':').map(Number); return new Date(2026, 10, 4, hh, mm, sec); };
const SESSIONS = [
  { id: 'b', subject: '數學', start: '09:00', end: '09:50' },
  { id: 'a', subject: '國語', start: '08:10', end: '08:50' },
  { id: 'c', subject: '自然', start: '10:10', end: '11:00' },
];

describe('考試時間格式', () => {
  test('parseHM：08:10、8:10、全形冒號都可以，錯的回傳 null', () => {
    assert.equal(parseHM('08:10'), 490);
    assert.equal(parseHM('8:10'), 490);
    assert.equal(parseHM('8：10'), 490);
    assert.equal(parseHM('24:00'), null);
    assert.equal(parseHM('08:60'), null);
    assert.equal(parseHM(''), null);
    assert.equal(parseHM(undefined), null);
  });
  test('fmtHM：分鐘數轉回 HH:MM，超出一天的範圍會限制在 00:00～23:59', () => {
    assert.equal(fmtHM(490), '08:10');
    assert.equal(fmtHM(1500), '23:59');
    assert.equal(fmtHM(-5), '00:00');
  });
  test('examSchedule：依開始時間排序，略過時間錯誤或結束早於開始的', () => {
    const list = examSchedule([...SESSIONS, { subject: '錯誤', start: '10:00', end: '09:00' }, { subject: '空白', start: '', end: '' }]);
    assert.deepEqual(list.map((x) => x.subject), ['國語', '數學', '自然']);
    assert.deepEqual(examSchedule(null), []);
  });
});

describe('考試狀態與倒數', () => {
  test('沒有設定', () => {
    assert.equal(examStatus([], at('08:00')).phase, 'empty');
  });
  test('第一節考試前：倒數到開始', () => {
    const s = examStatus(SESSIONS, at('08:00'));
    assert.equal(s.phase, 'before');
    assert.equal(s.session.subject, '國語');
    assert.equal(s.left, 600);
    assert.equal(s.first, true);
  });
  test('考試中：倒數到結束，並告知下一節', () => {
    const s = examStatus(SESSIONS, at('08:30', 15));
    assert.equal(s.phase, 'during');
    assert.equal(s.session.subject, '國語');
    assert.equal(s.left, 20 * 60 - 15);
    assert.equal(s.total, 40 * 60);
    assert.equal(s.next.subject, '數學');
  });
  test('剛結束的 60 秒內提醒停筆，之後變成下一節的倒數', () => {
    const ended = examStatus(SESSIONS, at('08:50', 30));
    assert.equal(ended.phase, 'ended');
    assert.equal(ended.session.subject, '國語');
    assert.equal(ended.next.subject, '數學');
    const brk = examStatus(SESSIONS, at('08:51', 0));
    assert.equal(brk.phase, 'before');
    assert.equal(brk.session.subject, '數學');
    assert.equal(brk.left, 9 * 60);
    assert.equal(brk.first, false);
  });
  test('開始的那一秒就算考試中，結束的那一秒就算結束', () => {
    assert.equal(examStatus(SESSIONS, at('09:00')).phase, 'during');
    assert.equal(examStatus(SESSIONS, at('09:50')).phase, 'ended');
  });
  test('延長後和下一節重疊時，「下一節」仍然是時間上的下一節', () => {
    const s = examStatus([{ subject: '國語', start: '08:10', end: '09:05' }, { subject: '數學', start: '09:00', end: '09:50' }, { subject: '自然', start: '10:10', end: '11:00' }], at('08:30'));
    assert.equal(s.next.subject, '數學');
  });
  test('最後一節考完：全部結束', () => {
    assert.equal(examStatus(SESSIONS, at('11:00', 30)).phase, 'ended');
    const s = examStatus(SESSIONS, at('11:05'));
    assert.equal(s.phase, 'done');
    assert.equal(s.session.subject, '自然');
  });
  test('兩節接在一起時，前一節結束就直接進入下一節', () => {
    const s = examStatus([{ subject: 'A', start: '08:00', end: '08:40' }, { subject: 'B', start: '08:40', end: '09:20' }], at('08:40', 5));
    assert.equal(s.phase, 'during');
    assert.equal(s.session.subject, 'B');
  });
});

describe('考試人數統計', () => {
  test('實到 = 應到 - 缺考，缺考座號排序、去除重複', async () => {
    const { examAttendance, fmtAttendance } = await import('../static/js/widgets/util.js');
    const a = examAttendance([1, 2, 3, 4, 5, 6], [5, 2, 5]);
    assert.equal(a.expected, 6);
    assert.equal(a.present, 4);
    assert.deepEqual(a.absent, [2, 5]);
    assert.equal(fmtAttendance(a), '應到 6 人　實到 4 人　缺考 2 人，2號、5號');
  });
  test('不在名單裡的座號不算缺考（例如名單改了或人數變少）', async () => {
    const { examAttendance } = await import('../static/js/widgets/util.js');
    const a = examAttendance([1, 2, 3], [3, 8]);
    assert.deepEqual(a.absent, [3]);
    assert.equal(a.present, 2);
  });
  test('沒有缺考顯示「缺考 0 人」，沒有座號時應到為 0', async () => {
    const { examAttendance, fmtAttendance } = await import('../static/js/widgets/util.js');
    assert.equal(fmtAttendance(examAttendance([1, 2], [])), '應到 2 人　實到 2 人　缺考 0 人');
    assert.equal(examAttendance(null, null).expected, 0);
  });
  test('名單的座號：沒有座號的學生接在最大座號後面，座號可以是文字', async () => {
    const { seatNumbersOf } = await import('../static/js/widgets/util.js');
    assert.deepEqual(seatNumbersOf([{ no: '1' }, { no: 3 }, { name: '沒座號' }, { no: '05' }]), [1, 3, 6, 5]);
  });
});
