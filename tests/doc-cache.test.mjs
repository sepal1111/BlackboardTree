import './helpers.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DocCache, stampOf, cacheName, hash } from '../static/js/doc-cache.js';
import { sourcePath, LOCAL_PREFIX, CHECK_MS } from '../static/js/widgets/exam-doc.js';
import { docKind } from '../static/js/link-list.js';

// 假的檔案系統：完整路徑 → { size, modifiedAt }；可以模擬斷線、複製中檔案被改
function fakeIo() {
  const files = new Map();
  const io = {
    files, offline: false, copies: 0, onCopy: null, locked: new Set(),
    put(p, size, modifiedAt) { files.set(p, { size, modifiedAt }); },
    async stat(p) {
      if (io.offline && p.startsWith('\\\\server')) throw new Error('offline');
      return files.has(p) ? { ...files.get(p) } : null;
    },
    async copy(a, b) {
      if (io.offline) throw new Error('offline');
      io.copies++;
      files.set(b, { ...files.get(a) });
      io.onCopy?.();
    },
    async remove(p) { if (io.locked.has(p)) throw new Error('busy'); files.delete(p); },
    async list(d) { return [...files.keys()].filter((k) => k.startsWith(d + '\\')).map((k) => k.slice(d.length + 1)); },
    async ensureDir() {},
  };
  return io;
}

function setup() {
  const io = fakeIo();
  let saved = {};
  let t = 1000;
  const cache = new DocCache({ io, dir: 'C:\\cache', store: { get: () => saved, set: (v) => { saved = v; } }, now: () => t, statTimeout: 50 });
  return { io, cache, store: () => saved, tick: (ms) => { t += ms; } };
}

const SRC = '\\\\server\\公告\\七年級\\數學更正.pdf';
const cached = (io) => [...io.files.keys()].filter((k) => k.startsWith('C:\\cache\\'));

describe('試卷釋疑的本機快取', () => {
  it('第一次開啟：複製到這台電腦，之後從副本顯示', async () => {
    const { io, cache } = setup();
    io.put(SRC, 100, 5);
    const e = await cache.open(SRC);
    assert.equal(io.copies, 1);
    assert.match(e.path, /^C:\\cache\\[0-9a-z]+-[0-9a-z]+\.pdf$/);
    assert.equal(e.stamp, '100:5');
    assert.equal(e.offline, false);
    assert.deepEqual(cached(io), [e.path]);
  });

  it('檔案沒變：再開一次、定時檢查都不會再複製', async () => {
    const { io, cache } = setup();
    io.put(SRC, 100, 5);
    const e = await cache.open(SRC);
    await cache.open(SRC);
    assert.equal(await cache.check(SRC, e.stamp), null);
    assert.equal(io.copies, 1);
  });

  it('同一台電腦同時開兩次，只複製一次', async () => {
    const { io, cache } = setup();
    io.put(SRC, 100, 5);
    const [a, b] = await Promise.all([cache.open(SRC), cache.open(SRC)]);
    assert.equal(a.path, b.path);
    assert.equal(io.copies, 1);
  });

  it('原始檔案更新：複製新版本、刪掉舊副本', async () => {
    const { io, cache } = setup();
    io.put(SRC, 100, 5);
    const e = await cache.open(SRC);
    io.put(SRC, 120, 9);
    const next = await cache.check(SRC, e.stamp);
    assert.equal(next.stamp, '120:9');
    assert.notEqual(next.path, e.path);
    assert.deepEqual(cached(io), [next.path]);
    assert.equal((await cache.open(SRC)).path, next.path); // 下次開啟直接用新版本
    assert.equal(io.copies, 2);
  });

  it('舊副本正在使用（影片播放中）刪不掉時，下次整理再刪', async () => {
    const { io, cache } = setup();
    io.put(SRC, 100, 5);
    const e = await cache.open(SRC);
    io.locked.add(e.path);
    io.put(SRC, 120, 9);
    const next = await cache.check(SRC, e.stamp);
    assert.deepEqual(cached(io).sort(), [e.path, next.path].sort());
    io.locked.clear();
    await cache.prune();
    assert.deepEqual(cached(io), [next.path]);
  });

  it('複製時原始檔案還在寫入（又變了）：丟掉這份，下次再試', async () => {
    const { io, cache } = setup();
    io.put(SRC, 100, 5);
    const e = await cache.open(SRC);
    io.put(SRC, 50, 9);
    io.onCopy = () => { io.put(SRC, 80, 10); io.onCopy = null; };
    assert.equal(await cache.check(SRC, e.stamp), null);
    assert.deepEqual(cached(io), [e.path]); // 還是舊版本
    const next = await cache.check(SRC, e.stamp); // 寫完了
    assert.equal(next.stamp, '80:10');
  });

  it('連不到原始檔案：顯示先前的副本並標示離線；連副本都沒有時丟出錯誤', async () => {
    const { io, cache } = setup();
    io.put(SRC, 100, 5);
    await cache.open(SRC);
    io.offline = true;
    const e = await cache.open(SRC);
    assert.equal(e.offline, true);
    assert.equal(await cache.check(SRC, e.stamp), null);
    await assert.rejects(cache.open('\\\\server\\公告\\沒開過.pdf'), /讀不到/);
  });

  it('原始檔案被刪掉：還有副本就繼續顯示', async () => {
    const { io, cache } = setup();
    io.put(SRC, 100, 5);
    await cache.open(SRC);
    io.files.delete(SRC);
    assert.equal((await cache.open(SRC)).offline, true);
  });

  it('副本被清掉（例如磁碟清理）：重新複製', async () => {
    const { io, cache } = setup();
    io.put(SRC, 100, 5);
    const e = await cache.open(SRC);
    io.files.delete(e.path);
    await cache.open(SRC);
    assert.equal(io.copies, 2);
  });

  it('整理：太久沒開的副本與沒有紀錄的檔案會刪掉', async () => {
    const { io, cache, store, tick } = setup();
    io.put(SRC, 100, 5);
    io.put('D:\\試卷\\b.mp4', 10, 1);
    await cache.open(SRC);
    tick(20 * 86400000);
    const b = await cache.open('D:\\試卷\\b.mp4');
    io.put('C:\\cache\\leftover.pdf', 1, 1);
    tick(15 * 86400000);
    await cache.prune();
    assert.deepEqual(cached(io), [b.path]);
    assert.deepEqual(Object.keys(store()), ['D:\\試卷\\b.mp4']);
  });

  it('副本檔名：保留副檔名，不同版本不同檔名', () => {
    assert.equal(stampOf({ size: 3, modifiedAt: 7 }), '3:7');
    assert.equal(stampOf(null), '');
    assert.match(cacheName('X:\\a\\影片.MP4', '1:2'), /^[0-9a-z]{7}-[0-9a-z]{7}\.mp4$/);
    assert.notEqual(cacheName('X:\\a.pdf', '1:2'), cacheName('X:\\a.pdf', '1:3'));
    assert.equal(cacheName('X:\\A.pdf', '1:2'), cacheName('x:\\a.pdf', '1:2')); // Windows 路徑不分大小寫
    assert.equal(hash('abc'), hash('abc'));
  });
});

describe('試卷釋疑的檔案來源', () => {
  const school = { p: (rel) => '\\\\server\\公告\\' + rel.split('/').join('\\') };
  it('學校共用資料夾、老師選的資料夾、網址', () => {
    assert.equal(sourcePath('school:七年級/a.pdf', school), '\\\\server\\公告\\七年級\\a.pdf');
    assert.equal(sourcePath('school:a.pdf', null), ''); // 這台電腦沒有設定學校共用資料夾
    assert.equal(sourcePath(LOCAL_PREFIX + 'D:\\試卷\\b.mp4', null), 'D:\\試卷\\b.mp4');
    assert.equal(sourcePath('https://example.com', school), '');
  });

  it('每 10 秒檢查一次', () => assert.equal(CHECK_MS, 10000));

  it('影片也列出來', () => {
    assert.equal(docKind('說明.mp4'), 'video');
    assert.equal(docKind('說明.WebM'), 'video');
    assert.equal(docKind('說明.mov'), 'video');
  });
});
