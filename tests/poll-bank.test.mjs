import './helpers.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePollText, parsePollRows, addToBank, itemFromPoll, makeResult, addResult, resultSig, resultsToCsv, fmtTime, totalVotes,
} from '../static/js/poll-bank.js';

describe('匯入投票題目', () => {
  test('文字：每題一段，題目之間空一行', () => {
    const { items, skipped } = parsePollText('﻿午餐想吃什麼？\n麵\n 飯 \n\n\n最喜歡的季節\r\n春\r\n夏\r\n');
    assert.deepEqual(items, [
      { question: '午餐想吃什麼？', options: ['麵', '飯'] },
      { question: '最喜歡的季節', options: ['春', '夏'] },
    ]);
    assert.deepEqual(skipped, []);
  });

  test('選項少於 2 個的題目略過；重複的選項只留一個', () => {
    const { items, skipped } = parsePollText('只有一個選項\nA\n\n重複\nA\nA\nB');
    assert.deepEqual(items, [{ question: '重複', options: ['A', 'B'] }]);
    assert.deepEqual(skipped, ['只有一個選項']);
  });

  test('從 Excel 貼上（有 Tab）：每列一題', () => {
    const { items } = parsePollText('題目\t選項1\t選項2\n喜歡數學嗎\t喜歡\t普通\t不喜歡\n空白欄\t\tX\t\tY');
    assert.deepEqual(items, [
      { question: '喜歡數學嗎', options: ['喜歡', '普通', '不喜歡'] },
      { question: '空白欄', options: ['X', 'Y'] },
    ]);
  });

  test('Excel／CSV 的列：第一列是標題時略過，空白列略過', () => {
    const { items, skipped } = parsePollRows([['問題', 'A', 'B'], [], ['Q1', 'a', 'b'], ['Q2', 'only']]);
    assert.deepEqual(items, [{ question: 'Q1', options: ['a', 'b'] }]);
    assert.deepEqual(skipped, ['Q2']);
    assert.equal(parsePollRows([['Q', 'x', 'y']]).items.length, 1); // 第一列不是標題就保留
  });
});

describe('題庫', () => {
  test('加入題庫時略過完全相同的題目，回傳加入幾題', () => {
    const bank = [];
    assert.equal(addToBank(bank, [{ question: 'Q', options: ['a', 'b'] }, { question: 'Q', options: ['a', 'b'] }]), 1);
    assert.equal(addToBank(bank, [{ question: 'Q', options: ['a', 'c'] }, { question: ' ', options: ['a', 'b'] }, { question: 'R', options: ['a'] }]), 1);
    assert.equal(bank.length, 2);
    assert.ok(bank[0].id && bank[0].at);
  });

  test('投票小工具的狀態轉成題庫項目（不含票數）', () => {
    assert.deepEqual(itemFromPoll({ question: 'Q', options: [{ label: 'a', votes: 3 }, { label: 'b', votes: 0 }] }), { question: 'Q', options: ['a', 'b'] });
  });
});

describe('投票紀錄', () => {
  const state = () => ({
    question: '午餐', options: [{ label: '麵', votes: 2 }, { label: '飯', votes: 1 }],
    ballots: { amy: { name: 'Amy', label: '麵' }, '小明': { name: '小明', label: '飯' } },
  });

  test('記錄結果：票數、投票學生、白板名稱、時間', () => {
    const r = makeResult(state(), '三年二班', 1000);
    assert.equal(r.board, '三年二班');
    assert.equal(r.at, 1000);
    assert.deepEqual(r.options, [{ label: '麵', votes: 2 }, { label: '飯', votes: 1 }]);
    assert.deepEqual(r.ballots, [{ name: 'Amy', label: '麵' }, { name: '小明', label: '飯' }]);
    assert.equal(totalVotes(state()), 3);
  });

  test('結果沒變時指紋相同（不會重複記錄），多一票就不同', () => {
    const s = state();
    const sig = resultSig(s);
    assert.equal(resultSig(state()), sig);
    s.options[1].votes++;
    assert.notEqual(resultSig(s), sig);
  });

  test('新的紀錄放最前面，超過上限刪掉最舊的', () => {
    const list = [];
    for (let i = 1; i <= 5; i++) addResult(list, { id: i }, 3);
    assert.deepEqual(list.map((r) => r.id), [5, 4, 3]);
  });

  test('匯出 CSV：Excel 可直接開啟、每個選項一列、處理逗號與公式開頭', () => {
    const at = new Date(2026, 10, 2, 9, 5).getTime();
    const r = makeResult({ question: '喜歡, 還是不喜歡？', options: [{ label: '=1+1', votes: 1 }, { label: 'B', votes: 0 }], ballots: { x: { name: '王"小"明', label: '=1+1' } } }, '班級', at);
    const csv = resultsToCsv([r]);
    assert.ok(csv.startsWith('﻿日期時間,白板,題目,選項,票數,百分比,投票學生\r\n'));
    const lines = csv.slice(1).trim().split('\r\n');
    assert.equal(lines.length, 3);
    assert.equal(lines[1], `${fmtTime(at)},班級,"喜歡, 還是不喜歡？",'=1+1,1,100%,"王""小""明"`);
    assert.equal(lines[2], `${fmtTime(at)},班級,"喜歡, 還是不喜歡？",B,0,0%,`);
    assert.equal(fmtTime(at), '2026/11/02 09:05');
  });
});
