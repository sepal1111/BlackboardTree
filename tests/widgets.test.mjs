import './helpers.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDuration, parseDuration, shuffle, splitNames } from '../static/js/widgets/util.js';
import { classifyUrl } from '../static/js/widgets/media.js';
import { widgetList, widgets } from '../static/js/widgets/index.js';

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
});
