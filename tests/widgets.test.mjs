import './helpers.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fmtDuration, parseDuration, shuffle, splitNames } from '../static/js/widgets/util.js';
import { classifyUrl } from '../static/js/widgets/media.js';
import { widgetList, widgets, upgradeWidget } from '../static/js/widgets/index.js';
import { dateHtml } from '../static/js/widgets/time.js';
import { castVote } from '../static/js/widgets/classroom.js';

describe('計時器的時間格式', () => {
  test('fmtDuration', () => {
    assert.equal(fmtDuration(65), '01:05');
    assert.equal(fmtDuration(59.2), '01:00'); // 無條件進位：剩 0.2 秒時還顯示 1 秒
    assert.equal(fmtDuration(3661), '1:01:01');
    assert.equal(fmtDuration(65, true), '0:01:05');
    assert.equal(fmtDuration(-5), '00:00');
  });

  test('parseDuration：只寫一個數字是分鐘', () => {
    assert.equal(parseDuration('5'), 300);
    assert.equal(parseDuration('1:30'), 90);
    assert.equal(parseDuration('1：30'), 90); // 全形冒號
    assert.equal(parseDuration('1 30'), 90);
    assert.equal(parseDuration('1:00:00'), 3600);
    assert.equal(parseDuration('abc'), null);
  });
});

describe('名單工具', () => {
  test('splitNames：換行、逗號、頓號都能分隔', () => {
    assert.deepEqual(splitNames('王小明、陳美麗,林志豪\n 張三 ，\n'), ['王小明', '陳美麗', '林志豪', '張三']);
    assert.deepEqual(splitNames(undefined), []);
  });

  test('shuffle：不改原陣列，元素相同', () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8];
    const b = shuffle(a);
    assert.deepEqual(a, [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual([...b].sort((x, y) => x - y), a);
  });
});

describe('classifyUrl：手機傳來的網址', () => {
  test('YouTube 各種網址與開始時間', () => {
    assert.deepEqual(classifyUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s'),
      { kind: 'youtube', id: 'dQw4w9WgXcQ', list: null, start: 90, href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s' });
    assert.equal(classifyUrl('https://youtu.be/dQw4w9WgXcQ?t=45').start, 45);
    assert.equal(classifyUrl('https://youtu.be/dQw4w9WgXcQ').id, 'dQw4w9WgXcQ');
    assert.equal(classifyUrl('https://m.youtube.com/watch?v=abc123xyz').id, 'abc123xyz');
    assert.equal(classifyUrl('https://youtube.com/shorts/abcdefg').id, 'abcdefg');
    const pl = classifyUrl('https://www.youtube.com/playlist?list=PL123');
    assert.equal(pl.kind, 'youtube');
    assert.equal(pl.list, 'PL123');
  });

  test('影片檔與一般網頁', () => {
    assert.equal(classifyUrl('https://example.com/movie/a.MP4').kind, 'video');
    assert.equal(classifyUrl(' https://example.com/page ').kind, 'web');
  });

  test('社群網站轉成嵌入網址', () => {
    const fbReel = classifyUrl('https://www.facebook.com/reel/123456');
    assert.equal(fbReel.platform, 'facebook');
    assert.equal(fbReel.portrait, true);
    assert.match(fbReel.embed, /^https:\/\/www\.facebook\.com\/plugins\/video\.php\?href=/);
    assert.match(classifyUrl('https://www.facebook.com/page/posts/123').embed, /plugins\/post\.php/);
    assert.equal(classifyUrl('https://www.facebook.com/somepage').kind, 'web'); // 粉絲專頁首頁不能嵌入
    assert.equal(classifyUrl('https://www.instagram.com/reels/ABC_1/').embed, 'https://www.instagram.com/reel/ABC_1/embed/');
    assert.equal(classifyUrl('https://www.threads.net/@user.name/post/XYZ').embed, 'https://www.threads.com/@user.name/post/XYZ/embed');
    assert.equal(classifyUrl('https://www.tiktok.com/@u/video/7123456').embed, 'https://www.tiktok.com/embed/v2/7123456');
    assert.equal(classifyUrl('https://vimeo.com/76979871').embed, 'https://player.vimeo.com/video/76979871');
    assert.equal(classifyUrl('https://vimeo.com/123/abcdef').embed, 'https://player.vimeo.com/video/123?h=abcdef');
  });

  test('不是 http(s) 網址時回傳 null', () => {
    assert.equal(classifyUrl('not a url'), null);
    assert.equal(classifyUrl('javascript:alert(1)'), null);
    assert.equal(classifyUrl('ftp://example.com/a.mp4'), null);
  });
});

describe('小工具清單', () => {
  test('每個小工具都有必要的欄位，type 不重複', () => {
    assert.equal(Object.keys(widgets).length, widgetList.length);
    for (const w of widgetList) {
      assert.equal(typeof w.type, 'string', w.title);
      assert.ok(w.title && w.icon, w.type);
      assert.ok(w.size.w > 0 && w.size.w <= 1 && w.size.h > 0 && w.size.h <= 1, w.type);
      assert.equal(typeof w.state, 'function', w.type);
      assert.equal(typeof w.mount, 'function', w.type);
      assert.doesNotThrow(() => JSON.stringify(w.state()), w.type); // 預設狀態要能存進白板
    }
  });

  test('每個小工具都有工具列圖示檔', () => {
    for (const w of widgetList) {
      assert.equal(w.img, `icons/tools/${w.type}.svg`);
      assert.ok(existsSync(new URL(`../static/${w.img}`, import.meta.url)), `缺少 static/${w.img}`);
    }
  });
});

describe('舊白板的小工具升級', () => {
  test('紅綠燈、骰子已移除', () => {
    assert.equal(upgradeWidget({ id: 'a', type: 'dice', state: { count: 2 } }), null);
    assert.equal(upgradeWidget({ id: 'b', type: 'traffic' }), null);
    assert.equal(upgradeWidget(null), null);
    assert.ok(!widgets.dice && !widgets.traffic && !widgets.calendar);
  });

  test('舊「日期」變成只顯示日期的時鐘日期，位置不變', () => {
    const w = { id: 'c', type: 'calendar', x: 0.1, y: 0.2, w: 0.3, h: 0.4, z: 3, state: { roc: false, month: true } };
    assert.deepEqual(upgradeWidget(w), { ...w, type: 'clock', state: { mode: 'none', date: 'month', roc: false } });
    assert.deepEqual(upgradeWidget({ type: 'calendar', state: { month: false } }).state, { mode: 'none', date: 'line', roc: true });
    assert.deepEqual(upgradeWidget({ type: 'calendar' }).state, { mode: 'none', date: 'month', roc: true });
  });

  test('舊時鐘的「顯示日期」勾選框轉成日期選項', () => {
    assert.equal(upgradeWidget({ type: 'clock', state: { mode: 'analog', date: true } }).state.date, 'line');
    assert.equal(upgradeWidget({ type: 'clock', state: { date: false } }).state.date, 'none');
    const cur = { type: 'clock', state: { date: 'month' } };
    assert.equal(upgradeWidget(cur), cur); // 新格式不動
  });
});

describe('時鐘日期的日期文字', () => {
  const d = new Date(2026, 10, 2); // 2026/11/2 星期一

  test('跟時間一起時是一行文字', () => {
    assert.equal(dateHtml(d, 'line', true, true), '11月2日 星期一');
  });

  test('只顯示日期時放大，民國年／西元年', () => {
    const roc = dateHtml(d, 'line', true, false);
    assert.match(roc, /民國 115 年 11 月/);
    assert.match(roc, /class="cal-day">2</);
    assert.match(dateHtml(d, 'line', false, false), /2026 年 11 月/);
  });

  test('月曆：11 月 1 日是星期日，共 30 天，標出今天', () => {
    const html = dateHtml(d, 'month', true, true);
    assert.match(html, /cal-line/);
    assert.equal((html.match(/<span><\/span>/g) || []).length, 0);
    assert.equal((html.match(/<span class="[^"]*">\d+<\/span>/g) || []).length, 30);
    assert.match(html, /<span class="today">2<\/span>/);
    const dec = dateHtml(new Date(2026, 11, 25), 'month', true, false);
    assert.equal((dec.match(/<span><\/span>/g) || []).length, 2); // 12/1 是星期二
  });
});

describe('投票：學生投票的計票', () => {
  const fresh = () => ({ options: [{ label: '麵', votes: 0 }, { label: '飯', votes: 2 }], ballots: {}, allowChange: true });

  test('投票加一票，記下名字', () => {
    const s = fresh();
    assert.deepEqual(castVote(s, ' 王小明 ', 0), { ok: true, text: '已投給「麵」', choice: 0 });
    assert.equal(s.options[0].votes, 1);
    assert.deepEqual(s.ballots, { '王小明': { name: '王小明', label: '麵' } });
  });

  test('同一個名字只算一票：重複投同一項不加票，改票時移動那一票', () => {
    const s = fresh();
    castVote(s, 'Amy', 0);
    assert.equal(castVote(s, 'amy', 0).ok, true); // 大小寫視為同一人
    assert.equal(s.options[0].votes, 1);
    assert.deepEqual(castVote(s, 'AMY', 1), { ok: true, text: '已改投「飯」', choice: 1 });
    assert.deepEqual(s.options.map((o) => o.votes), [0, 3]);
  });

  test('不允許改票時拒絕，並告訴學生原本投哪一項', () => {
    const s = { ...fresh(), allowChange: false };
    castVote(s, '小華', 1);
    assert.deepEqual(castVote(s, '小華', 0), { ok: false, text: '你已經投給「飯」，這次投票不能改票', choice: 1 });
    assert.deepEqual(s.options.map((o) => o.votes), [0, 3]);
  });

  test('沒有名字、選項不存在都不計票', () => {
    const s = fresh();
    assert.equal(castVote(s, '  ', 0).ok, false);
    assert.equal(castVote(s, '小明', 5).ok, false);
    assert.equal(castVote(s, '小明', NaN).ok, false);
    assert.deepEqual(s.options.map((o) => o.votes), [0, 2]);
  });

  test('題目改了選項後，舊選票不會扣到別的選項', () => {
    const s = fresh();
    castVote(s, '小明', 0);
    s.options = [{ label: '水餃', votes: 0 }, { label: '飯', votes: 2 }]; // 老師把「麵」改成「水餃」
    castVote(s, '小明', 1);
    assert.deepEqual(s.options.map((o) => o.votes), [0, 3]);
  });
});
