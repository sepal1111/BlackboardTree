import './helpers.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, upsertNote, deleteNote, searchNotes } from '../static/js/text-notes.js';

describe('文字小工具的紀錄', () => {
  test('html 轉純文字：換行、標籤、特殊字元', () => {
    assert.equal(htmlToText('今日作業<br>1. 數學<b>p.12</b><div>2. 國語&nbsp;&amp;&lt;生字&gt;</div>'), '今日作業\n1. 數學p.12\n2. 國語 &<生字>');
    assert.equal(htmlToText(''), '');
  });
  test('同一則繼續編輯時更新並移到最前面，不會多一筆', () => {
    const list = [];
    assert.equal(upsertNote(list, { id: 'a', html: '今日作業' }, 1), true);
    assert.equal(upsertNote(list, { id: 'b', html: '明天帶美勞用具' }, 2), true);
    assert.equal(upsertNote(list, { id: 'a', html: '今日作業：數學' }, 3), true);
    assert.deepEqual(list.map((n) => [n.id, n.text, n.at]), [['a', '今日作業：數學', 3], ['b', '明天帶美勞用具', 2]]);
  });
  test('內容沒變、空白內容不記錄', () => {
    const list = [];
    upsertNote(list, { id: 'a', html: '早安' }, 1);
    assert.equal(upsertNote(list, { id: 'a', html: '早安' }, 5), false);
    assert.equal(list[0].at, 1);
    assert.equal(upsertNote(list, { id: 'b', html: '<br>&nbsp;' }, 2), false);
    assert.equal(list.length, 1);
  });
  test('超過上限時刪掉最舊的', () => {
    const list = [];
    for (let i = 0; i < 5; i++) upsertNote(list, { id: 'n' + i, html: '第' + i }, i, 3);
    assert.deepEqual(list.map((n) => n.id), ['n4', 'n3', 'n2']);
  });
  test('搜尋：多個關鍵字都要符合，最新的在前', () => {
    const list = [];
    upsertNote(list, { id: 'a', html: '數學作業 p.12' }, 1);
    upsertNote(list, { id: 'b', html: '國語作業 生字' }, 2);
    upsertNote(list, { id: 'c', html: '數學考試 週五' }, 3);
    assert.deepEqual(searchNotes(list, '數學').map((n) => n.id), ['c', 'a']);
    assert.deepEqual(searchNotes(list, '數學 作業').map((n) => n.id), ['a']);
    assert.deepEqual(searchNotes(list, '').map((n) => n.id), ['c', 'b', 'a']);
    assert.deepEqual(searchNotes(null, 'x'), []);
  });
  test('排版：橫式與直式的水平、垂直位置', async () => {
    const { textLayout } = await import('../static/js/widgets/media.js');
    assert.deepEqual(textLayout({}), { textAlign: 'left', justify: 'flex-start' });
    assert.deepEqual(textLayout({ align: 'center', valign: 'middle' }), { textAlign: 'center', justify: 'safe center' });
    assert.deepEqual(textLayout({ align: 'right', valign: 'bottom' }), { textAlign: 'right', justify: 'safe flex-end' });
    // 直式：水平位置管欄的排列（右＝起點），垂直位置管每一欄內的文字
    assert.deepEqual(textLayout({ vertical: true, align: 'right', valign: 'top' }), { textAlign: 'start', justify: 'flex-start' });
    assert.deepEqual(textLayout({ vertical: true, align: 'center', valign: 'middle' }), { textAlign: 'center', justify: 'safe center' });
    assert.deepEqual(textLayout({ vertical: true, align: 'left', valign: 'bottom' }), { textAlign: 'end', justify: 'safe flex-end' });
  });
  test('注音字型：CSS 引用的字型檔都存在，也附上授權', async () => {
    const { TEXT_FONTS } = await import('../static/js/widgets/media.js');
    const fs = await import('node:fs');
    const css = Object.values(TEXT_FONTS).map((f) => f.css).filter(Boolean);
    assert.deepEqual(css.sort(), ['bpmf-huninn', 'bpmf-zihi-kai-std']);
    for (const name of css) {
      const dir = new URL(`../static/vendor/fonts/${name}/`, import.meta.url);
      const text = fs.readFileSync(new URL(`${name}.css`, dir), 'utf8');
      const files = [...text.matchAll(/url\(\.\/(files\/[^)]+)\)/g)].map((m) => m[1]);
      assert.ok(files.length > 50);
      assert.ok(files.every((f) => f.endsWith('.woff2') && fs.existsSync(new URL(f, dir))));
      assert.ok(fs.existsSync(new URL('LICENSE', dir)));
    }
  });
  test('注音字型直式時，英數字改用直立的英文字型', async () => {
    const { fontFamilyOf } = await import('../static/js/widgets/media.js');
    assert.match(fontFamilyOf('bpmf-kai', true), /^"BT Upright Serif", "Bpmf Zihi Kai Std"/);
    assert.match(fontFamilyOf('bpmf-round', true), /^"BT Upright Sans", "Bpmf Huninn"/);
    assert.match(fontFamilyOf('bpmf-kai', false), /^"Bpmf Zihi Kai Std"/);
    assert.equal(fontFamilyOf('default', true), '');
    assert.equal(fontFamilyOf('不存在', false), '');
  });
  test('刪除一則', () => {
    const list = [];
    upsertNote(list, { id: 'a', html: 'x' }, 1);
    assert.equal(deleteNote(list, 'a'), true);
    assert.equal(deleteNote(list, 'a'), false);
    assert.deepEqual(list, []);
  });
});
