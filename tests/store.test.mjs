import { MemFs, resetStorage, stopTimers, tick } from './helpers.mjs';
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Store, LS } from '../static/js/store.js';
import { FolderBackend, LocalBackend } from '../static/js/backends/index.js';

const stores = [];
function folderStore(fs) {
  const s = new Store(new FolderBackend(fs));
  stores.push(s);
  return s;
}
const events = (target, type) => {
  const got = [];
  target.addEventListener(type, (e) => got.push(e.detail));
  return got;
};

beforeEach(resetStorage);
afterEach(() => { stores.splice(0).forEach(stopTimers); });

describe('LS：這台電腦的設定', () => {
  test('存取 JSON，讀不到或格式錯誤時回傳預設值', () => {
    assert.equal(LS.get('x', 'd'), 'd');
    LS.set('x', { a: 1 });
    assert.deepEqual(LS.get('x'), { a: 1 });
    localStorage.setItem('bad', '{');
    assert.equal(LS.get('bad', 0), 0);
    LS.del('x');
    assert.equal(LS.get('x', null), null);
  });
});

describe('FolderBackend：V:\\MyScreen 的檔案格式', () => {
  test('白板存成 MyScreen/boards/<id>.json，每次寫入 rev 加 1', async () => {
    const fs = new MemFs();
    const b = new FolderBackend(fs);
    const r1 = await b.putBoard({ id: 'b1', name: '國語', data: { widgets: [] } }, null);
    assert.equal(r1.rev, 1);
    const saved = fs.json('MyScreen/boards/b1.json');
    assert.deepEqual({ ...saved, created: 0, updatedAt: 0 }, { id: 'b1', name: '國語', rev: 1, created: 0, updatedAt: 0, data: { widgets: [] } });
    const r2 = await b.putBoard({ id: 'b1', name: '國語', data: {} }, 1);
    assert.equal(r2.rev, 2);
    assert.equal(fs.json('MyScreen/boards/b1.json').created, saved.created); // 建立時間不變
  });

  test('baseRev 和檔案不同時拒絕寫入（409），並附上目前的版本', async () => {
    const fs = new MemFs();
    const b = new FolderBackend(fs);
    await b.putBoard({ id: 'b1', name: 'A', data: {} }, null);
    await b.putBoard({ id: 'b1', name: 'B', data: {} }, 1);
    await assert.rejects(b.putBoard({ id: 'b1', name: 'C', data: {} }, 1), (e) => e.status === 409 && e.data.current.name === 'B');
    assert.equal(fs.json('MyScreen/boards/b1.json').name, 'B');
    assert.equal((await b.putBoard({ id: 'b1', name: 'C', data: {} }, 1, true)).rev, 3); // force 覆蓋
  });

  test('白板清單依建立時間排序，略過 index.json 與壞掉的檔案', async () => {
    const fs = new MemFs();
    const b = new FolderBackend(fs);
    await fs.write('MyScreen/boards/z.json', JSON.stringify({ name: '先建立', rev: 1, created: 1 }));
    await fs.write('MyScreen/boards/a.json', JSON.stringify({ name: '後建立', rev: 1, created: 2 }));
    await fs.write('MyScreen/boards/index.json', '[]');
    await fs.write('MyScreen/boards/broken.json', '{');
    assert.deepEqual((await b.listBoards()).map((x) => [x.id, x.name]), [['z', '先建立'], ['a', '後建立']]);
  });

  test('白板清單只重讀有修改過的檔案', async () => {
    const fs = new MemFs();
    const b = new FolderBackend(fs);
    await fs.write('MyScreen/boards/a.json', JSON.stringify({ name: '一', rev: 1 }));
    await b.listBoards();
    let reads = 0;
    const read = fs.read.bind(fs);
    fs.read = (p) => { reads++; return read(p); };
    await b.listBoards();
    assert.equal(reads, 0);
    await fs.write('MyScreen/boards/a.json', JSON.stringify({ name: '二', rev: 2 }));
    assert.equal((await b.listBoards())[0].name, '二');
    assert.equal(reads, 1);
  });

  test('settings.json 格式為 {data, updatedAt}', async () => {
    const fs = new MemFs();
    const b = new FolderBackend(fs);
    assert.deepEqual(await b.getSettings(), {});
    await b.putSettings({ classLists: [] });
    const f = fs.json('MyScreen/settings.json');
    assert.deepEqual(f.data, { classLists: [] });
    assert.equal(typeof f.updatedAt, 'number');
  });

  test('上傳的圖片存在 media/，回傳 data 參照', async () => {
    const fs = new MemFs();
    const b = new FolderBackend(fs);
    const ref = await b.upload(new File(['img'], '照片.JPG'));
    assert.equal(ref.kind, 'file');
    assert.equal(ref.base, 'data');
    assert.match(ref.path, /^media\/\d{8}-[a-z0-9]+\.jpg$/);
    assert.equal(await fs.read('MyScreen/' + ref.path), 'img');
    assert.equal(await b.imageUrl({ kind: 'url', url: 'https://x/a.png' }), 'https://x/a.png');
    assert.equal(await b.imageUrl(null), '');
  });

  test('選的資料夾本身就是 MyScreen 時（dataDir 空字串）', async () => {
    const fs = new MemFs('D:\\MyScreen');
    const b = new FolderBackend(fs, { dataDir: '' });
    await b.putBoard({ id: 'b1', name: 'x', data: {} }, null);
    assert.ok(fs.files.has('boards/b1.json'));
    assert.equal(b.label, 'D:\\MyScreen');
    assert.equal(new FolderBackend(new MemFs('V:\\')).label, 'V:\\MyScreen');
  });
});

describe('Store：存檔與同步', () => {
  test('新增白板後寫入資料夾，狀態回到已同步', async () => {
    const fs = new MemFs();
    const store = folderStore(fs);
    const statuses = events(store, 'status');
    const board = store.newBoard('數學課');
    assert.equal(store.status, 'saving');
    await store.flushAll();
    assert.equal(board.rev, 1);
    assert.equal(fs.json(`MyScreen/boards/${board.id}.json`).name, '數學課');
    assert.deepEqual(statuses, ['saving', 'synced']);
    assert.deepEqual(store.index.map((b) => b.name), ['數學課']);
  });

  test('多次修改合併成一次寫入', async () => {
    const fs = new MemFs();
    const store = folderStore(fs);
    const board = store.newBoard('白板');
    await store.flushAll();
    board.data.widgets.push({ id: 'w1' });
    store.saveBoard(board);
    board.data.widgets.push({ id: 'w2' });
    store.saveBoard(board);
    await store.flushAll();
    assert.equal(board.rev, 2);
    assert.equal(fs.json(`MyScreen/boards/${board.id}.json`).data.widgets.length, 2);
  });

  test('兩台電腦同時修改：後存的收到衝突，檔案保留先存的版本', async () => {
    const fs = new MemFs();
    const a = folderStore(fs);
    const b = folderStore(fs);
    const boardA = a.newBoard('共用');
    await a.flushAll();
    const boardB = await b.getBoard(boardA.id);

    boardA.name = 'A 改的';
    a.saveBoard(boardA);
    await a.flushAll();

    const remote = events(b, 'remote');
    boardB.name = 'B 改的';
    b.saveBoard(boardB);
    await b.flushAll();
    assert.equal(remote.length, 1);
    assert.equal(remote[0].conflict, true);
    assert.equal(remote[0].board.name, 'A 改的');
    assert.equal(fs.json(`MyScreen/boards/${boardA.id}.json`).name, 'A 改的');
    assert.equal(b.status, 'synced');
  });

  test('網路磁碟機斷線：先存在這台電腦，恢復後補存', async () => {
    const fs = new MemFs();
    const store = folderStore(fs);
    const board = store.newBoard('離線');
    await store.flushAll();

    fs.failing = true;
    board.name = '斷線時改的';
    store.saveBoard(board);
    await store.flushAll();
    assert.equal(store.status, 'offline');
    assert.ok(store.pending.has(board.id));

    // 斷線中重新開啟程式：讀得到這台電腦的備份
    const again = folderStore(fs);
    assert.equal((await again.getBoard(board.id)).name, '斷線時改的');
    assert.equal(again.status, 'offline');
    assert.deepEqual((await again.listBoards()).map((b) => b.name), ['斷線時改的']);

    fs.failing = false;
    await store.flushAll();
    assert.equal(store.status, 'synced');
    assert.equal(fs.json(`MyScreen/boards/${board.id}.json`).name, '斷線時改的');
  });

  test('白板清單保留還沒存完的本機修改', async () => {
    const fs = new MemFs();
    const store = folderStore(fs);
    const board = store.newBoard('原名');
    await store.flushAll();
    board.name = '新名字';
    store.saveBoard(board);
    assert.deepEqual((await store.listBoards()).map((b) => b.name), ['新名字']);
  });

  test('poll：其他電腦修改或刪除目前的白板', async () => {
    const fs = new MemFs();
    const a = folderStore(fs);
    const b = folderStore(fs);
    const board = a.newBoard('上課用');
    await a.flushAll();
    await a.listBoards();

    const other = await b.getBoard(board.id);
    other.name = '另一台改的';
    b.saveBoard(other);
    await b.flushAll();

    const remote = events(a, 'remote');
    let indexChanged = 0;
    a.addEventListener('index', () => { indexChanged++; });
    await a.poll(board);
    assert.equal(remote.length, 1);
    assert.equal(remote[0].board.name, '另一台改的');
    assert.equal(indexChanged, 1);

    await b.deleteBoard(board.id);
    const deleted = events(a, 'deleted');
    await a.poll({ ...board, rev: 2 });
    assert.deepEqual(deleted, [board.id]);
  });

  test('poll：有本機修改還沒存時不覆蓋', async () => {
    const fs = new MemFs();
    const a = folderStore(fs);
    const b = folderStore(fs);
    const board = a.newBoard('x');
    await a.flushAll();
    const other = await b.getBoard(board.id);
    b.saveBoard(other);
    await b.flushAll();

    a.saveBoard(board); // 還在等待寫入
    const remote = events(a, 'remote');
    await a.poll(board);
    assert.equal(remote.length, 0);
  });

  test('舊格式的班級名單補上 students，存檔時再產生 names', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fs = new MemFs();
    await fs.write('MyScreen/settings.json', JSON.stringify({ data: { classLists: [{ id: 'L1', name: '三年二班', names: ['王小明', '陳美麗'] }] } }));
    const store = folderStore(fs);
    const st = await store.getSettings();
    assert.deepEqual(st.classLists[0].students, [{ name: '王小明' }, { name: '陳美麗' }]);

    let changed = 0;
    store.addEventListener('settings', () => { changed++; });
    st.classLists[0].students.push({ no: '03', name: '林志豪' });
    store.saveSettings();
    assert.equal(changed, 1);
    t.mock.timers.tick(500);
    await tick();
    const saved = fs.json('MyScreen/settings.json').data.classLists[0];
    assert.deepEqual(saved.names, ['王小明', '陳美麗', '林志豪']);
    assert.equal(saved.students[2].no, '03');
  });

  test('讀不到設定時用這台電腦的備份', async () => {
    const fs = new MemFs();
    const first = folderStore(fs);
    await fs.write('MyScreen/settings.json', JSON.stringify({ data: { classLists: [{ id: 'L1', students: [] }] } }));
    await first.getSettings();
    fs.failing = true;
    const second = folderStore(fs);
    assert.equal((await second.getSettings()).classLists[0].id, 'L1');
  });
});

describe('LocalBackend：只存在這台電腦', () => {
  test('白板與清單存在 localStorage，Store 不另外留備份', async () => {
    const store = new Store(new LocalBackend());
    stores.push(store);
    assert.equal(store.remote, false);
    const board = store.newBoard('本機');
    await store.flushAll();
    assert.equal(board.rev, 1);
    assert.deepEqual((await store.listBoards()).map((b) => b.name), ['本機']);
    assert.equal((await new LocalBackend().getBoard(board.id)).name, '本機');
    assert.equal(LS.get(store.key('board:' + board.id), null), null);
    await store.deleteBoard(board.id);
    assert.deepEqual(await new LocalBackend().listBoards(), []);
  });
});
