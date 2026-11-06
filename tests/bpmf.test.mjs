import './helpers.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hanChars, setReading, stripVS, withReading } from '../static/js/bpmf.js';
import { htmlToText } from '../static/js/text-notes.js';

const VS = (n) => String.fromCodePoint(0xe01e0 + n);

describe('注音字型的破音字', () => {
  test('找出國字與目前的讀音（英數字、標點不算）', () => {
    const list = hanChars(`銀行${VS(1)}A1，樂${VS(0)}`);
    assert.deepEqual(list.map(({ ch, vs, at, len }) => [ch, vs, at, len]), [
      ['銀', null, 0, 1], ['行', 1, 1, 3], ['樂', 0, 7, 3],
    ]);
  });
  test('換讀音：加上、更換、拿掉選擇符', () => {
    let t = '銀行行員';
    t = setReading(t, hanChars(t)[1], 1);
    assert.equal(t, `銀行${VS(1)}行員`);
    t = setReading(t, hanChars(t)[1], 3);
    assert.equal(t, `銀行${VS(3)}行員`);
    t = setReading(t, hanChars(t)[1], null);
    assert.equal(t, '銀行行員');
    assert.equal(withReading('樂', 0), '樂' + VS(0));
  });
  test('自動判斷：常用詞、得／地／了、一與不的變調', async () => {
    const data = await import('../static/js/bpmf-data.js');
    const { autoReadings } = await import('../static/js/bpmf.js');
    const { readFileSync } = await import('node:fs');
    const table = {};
    for (const l of readFileSync(new URL('../tools/bpmf/phonic_table_Z.txt', import.meta.url), 'utf8').split(/\r?\n/)) {
      const p = l.split('\t');
      if (p.length > 3) table[p[0]] = p.slice(3);
    }
    // 把結果寫成「字[讀音]」，只列出多音字
    const read = (s, opts) => {
      const ch = [...s];
      const r = autoReadings(ch, data, opts);
      return ch.map((c, i) => (table[c]?.length > 1 ? c + '[' + table[c][r[i] ?? 0] + ']' : '')).filter(Boolean).join(' ');
    };
    assert.equal(read('銀行行員喜歡音樂'), '行[ㄏㄤˊ] 行[ㄏㄤˊ] 員[ㄩㄢˊ] 樂[ㄩㄝˋ]');
    assert.equal(read('我覺得他跑得快'), '覺[ㄐㄩㄝˊ] 得[˙ㄉㄜ] 跑[ㄆㄠˇ] 得[˙ㄉㄜ]');
    assert.equal(read('取得'), '得[ㄉㄜˊ]');
    assert.equal(read('目的的確'), '的[ㄉㄧˋ] 的[ㄉㄧˊ]');
    assert.equal(read('慢慢地走'), '地[˙ㄉㄜ]');
    assert.equal(read('受不了，了解'), '不[ㄅㄨˋ] 了[ㄌㄧㄠˇ] 了[ㄌㄧㄠˇ] 解[ㄐㄧㄝˇ]');
    assert.equal(read('一個人一天第一'), '一[ㄧˊ] 個[ㄍㄜˋ] 一[ㄧˋ] 一[ㄧ]');
    assert.equal(read('一二三，統一'), '一[ㄧ] 一[ㄧ]');
    assert.equal(read('不是不能'), '不[ㄅㄨˊ] 不[ㄅㄨˋ]');
    assert.equal(read('校長說長大要重新開始'), '校[ㄒㄧㄠˋ] 長[ㄓㄤˇ] 說[ㄕㄨㄛ] 長[ㄓㄤˇ] 大[ㄉㄚˋ] 要[ㄧㄠˋ] 重[ㄔㄨㄥˊ]');
    // 關閉變調：「一」「不」不指定
    assert.equal(read('一個不是', { sandhi: false }), '一[ㄧ] 個[ㄍㄜˋ] 不[ㄅㄨˋ]');
    // 老師手動指定的字不改，而且「不」的變調會參考手動指定的讀音
    const ch = [...'不會'];
    assert.deepEqual(autoReadings(ch, data, { fixed: [null, 0] }), [1, null]); // 會 ㄏㄨㄟˋ（第四聲）→ 不 ㄅㄨˊ
    assert.deepEqual(autoReadings(ch, data, { fixed: [null, 2] }), [null, null]); // 會 ㄏㄨㄟˇ → 不 維持 ㄅㄨˋ
  });
  test('詞庫：bpmf-data.js 和 words.txt 一致（改了 words.txt 要重新執行 tools/bpmf/build.mjs）', async () => {
    const { WORDS } = await import('../static/js/bpmf-data.js');
    const { readFileSync } = await import('node:fs');
    const words = readFileSync(new URL('../tools/bpmf/words.txt', import.meta.url), 'utf8').split(/\r?\n/)
      .map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s+/)[0]);
    assert.deepEqual(Object.keys(WORDS).sort(), [...new Set(words)].sort());
  });
  test('搜尋、純文字時不含選擇符', () => {
    assert.equal(stripVS(`音樂${VS(1)}`), '音樂');
    assert.equal(htmlToText(`<b>音樂${VS(2)}</b>`), '音樂');
  });
});
