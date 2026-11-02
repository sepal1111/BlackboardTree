import { resetStorage, tick } from './helpers.mjs';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectColumns, rowsToPeople, parseRows, textToRows, findPhotoMatch, matchPhoto, studentsOf, hasPhotos, watchRoster, rememberList,
} from '../static/js/roster.js';

describe('detectColumns：自動判斷欄位', () => {
  test('學校匯出的名單：第一列是報表標題，欄位很多', () => {
    const rows = [
      ['113學年度 三年二班 學生名單'],
      ['班級', '座號', '學號', '姓名', '性別', '身分證字號', '家長姓名', '聯絡電話'],
      ['302', '1', '1130201', '王小明', '男', 'A123456789', '王大明', '0912345678'],
      ['302', '2', '1130202', '陳美麗', '女', 'B223456789', '陳志強', '0922333444'],
      ['302', '3', '1130203', '林志豪', '男', 'C123456780', '林媽媽', '02-2345-6789'],
    ];
    assert.deepEqual(detectColumns(rows), { header: 1, no: 1, name: 3, sid: 2 });
    assert.deepEqual(parseRows(rows), [
      { no: '01', sid: '1130201', name: '王小明' },
      { no: '02', sid: '1130202', name: '陳美麗' },
      { no: '03', sid: '1130203', name: '林志豪' },
    ]);
  });

  test('「學生姓名」標題也算姓名欄，「家長姓名」不算', () => {
    const rows = [['家長姓名', '學生姓名'], ['王大明', '王小明'], ['陳志強', '陳美麗']];
    assert.equal(detectColumns(rows).name, 1);
  });

  test('沒有標題列：座號＋姓名', () => {
    const rows = [['1', '王小明'], ['2', '陳美麗'], ['3', '林志豪']];
    assert.deepEqual(detectColumns(rows), { header: -1, no: 0, name: 1, sid: -1 });
  });

  test('只有一欄名字', () => {
    assert.deepEqual(detectColumns([['王小明'], ['陳美麗']]), { header: -1, no: -1, name: 0, sid: -1 });
  });

  test('沒有標題時，身分證字號、電話不會被當成學號', () => {
    const rows = [
      ['A123456789', '王小明', '1130201', '0912345678'],
      ['B223456789', '陳美麗', '1130202', '0922333444'],
      ['C123456780', '林志豪', '1130203', '0933444555'],
    ];
    const d = detectColumns(rows);
    assert.equal(d.sid, 2);
    assert.equal(d.name, 1);
  });

  test('每列都相同的班級欄不會被當成座號', () => {
    const rows = [['30', '1', '王小明'], ['30', '2', '陳美麗'], ['30', '3', '林志豪']];
    assert.equal(detectColumns(rows).no, 1);
  });
});

describe('rowsToPeople：依欄位對應轉成學生', () => {
  const map = { header: 0, no: 0, name: 1, sid: -1 };

  test('座號補成兩位數，跳過空白列、重複的標題列與重複姓名', () => {
    const rows = [
      ['座號', '姓名'],
      ['1', '王小明'],
      ['', ''],
      ['座號', '姓名'],
      ['12', '陳美麗'],
      ['13', '王小明'],
      [' 3 ', '  林  志豪 '],
    ];
    assert.deepEqual(rowsToPeople(rows, map), [
      { no: '01', sid: '', name: '王小明' },
      { no: '12', sid: '', name: '陳美麗' },
      { no: '03', sid: '', name: '林 志豪' },
    ]);
  });

  test('沒有選姓名欄時回傳空陣列', () => {
    assert.deepEqual(rowsToPeople([['1', '王小明']], { header: -1, no: 0, name: -1, sid: -1 }), []);
  });
});

describe('textToRows：貼上的文字', () => {
  test('Tab 分隔（從 Excel 複製）', () => {
    assert.deepEqual(textToRows('1\t王小明\r\n2\t陳美麗'), [['1', '王小明'], ['2', '陳美麗']]);
  });

  test('CSV，含引號與全形逗號', () => {
    assert.deepEqual(textToRows('"王, 小明",1130201\n陳美麗，1130202'), [['王, 小明', '1130201'], ['陳美麗', '1130202']]);
  });

  test('「01 王小明」「1. 王小明」「3、林志豪」拆成座號與姓名', () => {
    assert.deepEqual(textToRows('01 王小明\n2. 陳美麗\n3、林志豪'), [['01', '王小明'], ['2', '陳美麗'], ['3', '林志豪']]);
  });

  test('去掉 UTF-8 BOM', () => {
    assert.deepEqual(textToRows('﻿王小明'), [['王小明']]);
  });

  test('貼上後直接匯入', () => {
    assert.deepEqual(parseRows(textToRows('01 王小明\n02 陳美麗\n')), [
      { no: '01', sid: '', name: '王小明' },
      { no: '02', sid: '', name: '陳美麗' },
    ]);
  });
});

describe('findPhotoMatch：照片檔名對應學生', () => {
  const students = [
    { no: '01', sid: '1130201', name: '王小明' },
    { no: '02', sid: 'S1130202', name: '陳美麗' },
    { no: '03', name: '林志豪' },
    { no: '04', sid: '0012345', name: '張三' },
  ];
  const cases = [
    ['1130201.jpg', '王小明', 'sid'],
    ['1130201_王小明.JPG', '王小明', 'sid'],
    ['IMG_1130201.jpg', '王小明', 'sid'],
    ['S1130202.png', '陳美麗', 'sid'],
    ['1130202.jpg', '陳美麗', 'sid'],   // 學號有英文字母，檔名只寫數字
    ['12345.jpg', '張三', 'sid'],      // 學號開頭的 0 可省略
    ['陳美麗.jpg', '陳美麗', 'name'],
    ['03林志豪.jpg', '林志豪', 'name'],
    ['03.jpg', '林志豪', 'no'],
    ['3.jpeg', '林志豪', 'no'],
  ];
  for (const [file, name, by] of cases) {
    test(`${file} → ${name}（依${by}）`, () => {
      const m = findPhotoMatch(students, file);
      assert.equal(m?.student.name, name);
      assert.equal(m.by, by);
    });
  }

  test('對應不到時回傳 null', () => {
    assert.equal(findPhotoMatch(students, '99.jpg'), null);
    assert.equal(matchPhoto(students, '風景.jpg'), null);
  });
});

describe('名單資料', () => {
  test('舊格式（只有 names）也讀得到學生', () => {
    assert.deepEqual(studentsOf({ names: ['王小明'] }), [{ name: '王小明' }]);
    assert.deepEqual(studentsOf(null), []);
    assert.equal(hasPhotos({ students: [{ name: 'a' }, { name: 'b', photo: { kind: 'data', url: 'x' } }] }), true);
  });
});

describe('watchRoster：小工具跟著名單變化', () => {
  beforeEach(resetStorage);

  function fakeCtx(state, classLists = [{ id: 'L1', students: [] }]) {
    const store = new EventTarget();
    store.settings = { classLists };
    store.getSettings = async () => store.settings;
    let saves = 0;
    return { state, store, save: () => { saves++; }, get saves() { return saves; } };
  }

  test('學生改名時，座位、抽過的紀錄、分組、加分都換成新名字', async () => {
    const state = {
      listId: 'L1', seats: ['王小明', null, '陳美麗'], picked: ['王小明'], groups: [['王小明', '陳美麗']],
      current: '王小明', scores: { 王小明: 3, 陳美麗: 1 },
    };
    const ctx = fakeCtx(state);
    const stop = watchRoster(ctx, () => {});
    await tick();
    ctx.store.dispatchEvent(new CustomEvent('rename', { detail: { listId: 'L1', from: '王小明', to: '王曉明' } }));
    assert.deepEqual(state.seats, ['王曉明', null, '陳美麗']);
    assert.deepEqual(state.picked, ['王曉明']);
    assert.deepEqual(state.groups, [['王曉明', '陳美麗']]);
    assert.equal(state.current, '王曉明');
    assert.deepEqual(state.scores, { 王曉明: 3, 陳美麗: 1 });
    assert.equal(ctx.saves, 1);

    // 別的班級改名不影響；停止監聽後也不再更新
    ctx.store.dispatchEvent(new CustomEvent('rename', { detail: { listId: 'L2', from: '陳美麗', to: 'x' } }));
    stop();
    ctx.store.dispatchEvent(new CustomEvent('rename', { detail: { listId: 'L1', from: '陳美麗', to: 'y' } }));
    assert.deepEqual(state.seats, ['王曉明', null, '陳美麗']);
    assert.equal(ctx.saves, 1);
  });

  test('新的小工具自動連結上次用的班級', async () => {
    rememberList('L2');
    const state = {};
    const ctx = fakeCtx(state, [{ id: 'L1' }, { id: 'L2' }]);
    let changes = 0;
    watchRoster(ctx, () => { changes++; });
    await tick();
    assert.equal(state.listId, 'L2');
    assert.equal(changes, 1);
    ctx.store.dispatchEvent(new Event('settings'));
    assert.equal(changes, 2);
  });

  test('已經手動輸入名字的小工具不會自動連結', async () => {
    rememberList('L1');
    const state = { names: '王小明\n陳美麗' };
    watchRoster(fakeCtx(state), () => {});
    await tick();
    assert.equal(state.listId, undefined);
  });
});
