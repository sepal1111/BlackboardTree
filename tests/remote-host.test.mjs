import { resetStorage, tick } from './helpers.mjs';
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RemoteHost } from '../static/js/remote-host.js';
import { LS, SS } from '../static/js/store.js';
import { seal, open, newPair, unwrapKey, KEY_RE } from '../static/js/remote-crypto.js';

// 假的 WebSocket：記錄送出的訊息，測試裡用 recv() 模擬 relay 傳來的訊息
class FakeWs {
  static all = [];
  constructor(url) { this.url = url; this.sent = []; this.readyState = 0; FakeWs.all.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  send(s) { this.sent.push(JSON.parse(s)); }
  recv(m) { this.onmessage?.({ data: JSON.stringify(m) }); }
  close() { this.readyState = 3; this.onclose?.(); }
  get last() { return this.sent.at(-1); }
}

let host;
beforeEach(() => { resetStorage(); FakeWs.all = []; globalThis.WebSocket = FakeWs; });
afterEach(() => host?.stop());

function makeHost(onCmd = () => {}) {
  host = new RemoteHost('http://127.0.0.1:52480/', { getState: () => ({ board: '國語' }), onCmd, publicBase: 'http://192.168.1.5:52480' });
  return host;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('RemoteHost：教室電腦端的遙控連線', () => {
  test('連到 /ws/screen，取得代碼後記住，並送出白板狀態', async () => {
    const h = makeHost();
    h.start();
    const ws = FakeWs.all[0];
    assert.equal(ws.url, 'ws://127.0.0.1:52480/ws/screen');
    assert.equal(h.status, 'connecting');
    ws.open();
    assert.deepEqual(ws.sent[0], { type: 'hello' });

    ws.recv({ type: 'room', code: '123456', secret: 's1', remotes: 0 });
    assert.equal(h.status, 'online');
    assert.ok(KEY_RE.test(h.key), '每組代碼有一把加密金鑰');
    assert.equal(h.url, 'http://192.168.1.5:52480/remote.html#123456.' + h.key); // 手機用校內 IP，金鑰放在 # 後面
    assert.deepEqual(SS.get('ms:remote'), { code: '123456', secret: 's1', key: h.key }); // 只在這次開啟期間有效
    assert.equal(LS.get('ms:remote'), undefined, '不能永久保存代碼');
    await wait(5);
    assert.equal(ws.last.type, 'state');
    assert.equal(typeof ws.last.state, 'string', '白板內容要加密');
    assert.ok(!ws.last.state.includes('國語'));
    assert.deepEqual(open(ws.last.state, h.key), { board: '國語' });
  });

  test('同一次開啟期間斷線時用記住的代碼連回', () => {
    SS.set('ms:remote', { code: '654321', secret: 'abc' });
    makeHost().start();
    FakeWs.all[0].open();
    assert.deepEqual(FakeWs.all[0].sent[0], { type: 'hello', code: '654321', secret: 'abc' });
  });

  test('收到手機指令時執行，之後推送新狀態；失敗時通知手機', async () => {
    const got = [];
    const h = makeHost(async (m) => { got.push(m); if (m.action === 'bad') throw new Error('不行'); });
    h.start();
    const ws = FakeWs.all[0];
    ws.open();
    ws.recv({ type: 'room', code: '1', secret: 's' });
    await wait(5);
    ws.sent = [];

    ws.recv({ type: 'cmd', box: seal({ target: 'app', action: 'next' }, h.key) });
    await tick();
    assert.equal(got[0].action, 'next');
    assert.deepEqual(got[0].args, {});
    await wait(150); // 狀態推送會等 120ms 合併
    assert.equal(ws.sent.length, 1);
    assert.deepEqual(open(ws.sent[0].state, h.key), { board: '國語' });

    ws.sent = [];
    ws.recv({ type: 'cmd', box: seal({ target: 'app', action: 'bad' }, h.key) });
    await tick();
    assert.equal(ws.sent[0].type, 'notice');
    assert.deepEqual(open(ws.sent[0].box, h.key), { text: '執行失敗：不行' });

    // 沒加密、或用別的金鑰加密的指令不理會
    got.length = 0;
    ws.recv({ type: 'cmd', target: 'app', action: 'next' });
    ws.recv({ type: 'cmd', box: seal({ target: 'app', action: 'next' }, 'A'.repeat(43)) });
    ws.recv({ type: 'cmd', box: 'garbage' });
    await tick();
    assert.equal(got.length, 0);
  });

  test('手機加入時通知畫面', () => {
    const h = makeHost();
    let joined = 0;
    h.addEventListener('joined', () => { joined++; });
    h.start();
    const ws = FakeWs.all[0];
    ws.open();
    ws.recv({ type: 'room', code: '1', secret: 's' });
    ws.recv({ type: 'remotes', count: 2, joined: true });
    assert.equal(h.remotes, 2);
    assert.equal(joined, 1);
  });

  test('斷線後自動重連，停止後不再重連', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = makeHost();
    h.start();
    FakeWs.all[0].open();
    FakeWs.all[0].close();
    assert.equal(h.status, 'error');
    t.mock.timers.tick(1000);
    assert.equal(FakeWs.all.length, 2);
    assert.equal(h.status, 'connecting');

    h.stop();
    assert.equal(h.status, 'off');
    t.mock.timers.tick(10000);
    assert.equal(FakeWs.all.length, 2);
  });

  test('同一組代碼在別的視窗開啟時停止', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = makeHost();
    h.start();
    const ws = FakeWs.all[0];
    ws.open();
    ws.recv({ type: 'replaced' });
    assert.equal(h.status, 'off');
    ws.close();
    t.mock.timers.tick(10000);
    assert.equal(FakeWs.all.length, 1);
  });

  test('kick 要求 relay 中斷所有手機', () => {
    const h = makeHost();
    h.start();
    FakeWs.all[0].open();
    h.kick();
    assert.deepEqual(FakeWs.all[0].last, { type: 'kick' });
  });
});

describe('RemoteHost：學生投票', () => {
  function online(onVote) {
    host = new RemoteHost('http://127.0.0.1:52480', { getState: () => ({}), onCmd: () => {}, onVote, publicBase: 'http://192.168.1.5:52480' });
    host.start();
    const ws = FakeWs.all[0];
    ws.open();
    ws.recv({ type: 'room', code: '111111', secret: 's' });
    return ws;
  }

  test('開放投票：送出題目、取得投票代碼與學生網址', () => {
    const ws = online();
    let changed = 0;
    host.addEventListener('vote', () => changed++);
    host.openPoll({ id: 'w1', question: '午餐', options: ['麵', '飯'] });
    assert.deepEqual(ws.last, { type: 'vote-open', code: '', poll: { id: 'w1', question: '午餐', options: ['麵', '飯'] } });
    ws.recv({ type: 'vote-room', code: '222222', voters: 0 });
    assert.equal(host.voteUrl, 'http://192.168.1.5:52480/vote.html#222222');
    assert.notEqual(host.voteUrl, host.url); // 學生拿不到遙控代碼
    ws.recv({ type: 'voters', count: 3 });
    assert.equal(host.voters, 3);
    assert.ok(changed >= 3);
  });

  test('學生的投票交給 onVote，結果回傳給那位學生', () => {
    const got = [];
    const ws = online((m) => { got.push(m); return m.choice === 9 ? { ok: false, text: '選項已經更新' } : { ok: true, text: '已投給「麵」', choice: 0 }; });
    host.openPoll({ id: 'w1', question: 'Q', options: ['麵'] });
    ws.recv({ type: 'vote', from: '7', name: '小明', choice: 0 });
    assert.deepEqual(got[0], { type: 'vote', from: '7', name: '小明', choice: 0 });
    assert.deepEqual(ws.last, { type: 'vote-ack', to: '7', ok: true, text: '已投給「麵」', choice: 0 });
    ws.recv({ type: 'vote', from: '8', name: '小華', choice: 9 });
    assert.deepEqual(ws.last, { type: 'vote-ack', to: '8', ok: false, text: '選項已經更新' });
  });

  test('onVote 出錯時回覆失敗，不會中斷連線', () => {
    const ws = online(() => { throw new Error('壞掉'); });
    ws.recv({ type: 'vote', from: '1', name: 'A', choice: 0 });
    assert.deepEqual(ws.last, { type: 'vote-ack', to: '1', ok: false, text: '投票失敗：壞掉' });
  });

  test('結束投票；重新連線時恢復投票並沿用原本的投票代碼', async () => {
    const ws = online();
    host.openPoll({ id: 'w1', question: 'Q', options: ['A'] });
    ws.recv({ type: 'vote-room', code: '333333', voters: 0 });
    ws.close(); // 斷線，1 秒後重新連線
    await wait(1100);
    const ws2 = FakeWs.all.at(-1);
    assert.notEqual(ws2, ws);
    ws2.open();
    ws2.recv({ type: 'room', code: '111111', secret: 's' });
    assert.deepEqual(ws2.sent.find((m) => m.type === 'vote-open'), { type: 'vote-open', code: '333333', poll: { id: 'w1', question: 'Q', options: ['A'] } });
    host.closePoll();
    assert.deepEqual(ws2.last, { type: 'vote-close' });
    assert.equal(host.poll, null);
    assert.equal(host.voteCode, '');
  });
});

describe('新的手機要老師允許', () => {
  test('收到 join-request 時通知畫面，回答後送出 join-answer；join-gone 時通知關閉詢問', () => {
    const h = makeHost();
    h.start();
    const ws = FakeWs.all[0];
    ws.open();
    ws.recv({ type: 'room', code: '123456', secret: 's1' });
    const asked = [];
    const gone = [];
    h.addEventListener('join-request', (e) => asked.push(e.detail));
    h.addEventListener('join-gone', (e) => gone.push(e.detail.id));
    ws.recv({ type: 'join-request', id: 3, device: 'iPhone', ip: '192.168.1.20' });
    assert.deepEqual(asked, [{ id: '3', device: 'iPhone', ip: '192.168.1.20' }]);
    h.answerJoin('3', true);
    assert.deepEqual(ws.last, { type: 'join-answer', id: '3', ok: true });
    h.answerJoin('4', 0);
    assert.deepEqual(ws.last, { type: 'join-answer', id: '4', ok: false });
    ws.recv({ type: 'join-gone', id: 3 });
    assert.deepEqual(gone, ['3']);
  });

  test('手動輸入代碼的手機（帶公鑰）：允許時把金鑰加密交給它，拒絕時不給', () => {
    const h = makeHost();
    h.start();
    const ws = FakeWs.all[0];
    ws.open();
    ws.recv({ type: 'room', code: '123456', secret: 's1' });
    const phone = newPair();
    ws.recv({ type: 'join-request', id: 5, device: 'Android 手機', ip: '192.168.1.21', pk: phone.publicKey });
    h.answerJoin('5', true);
    assert.equal(ws.last.ok, true);
    assert.equal(unwrapKey(ws.last.box, phone), h.key, '手機用自己的私鑰解出金鑰');
    assert.equal(unwrapKey(ws.last.box, newPair()), '', '別人解不開');
    ws.recv({ type: 'join-request', id: 6, device: 'iPhone', ip: '192.168.1.22', pk: newPair().publicKey });
    h.answerJoin('6', false);
    assert.deepEqual(ws.last, { type: 'join-answer', id: '6', ok: false });
  });

  test('換代碼時換金鑰；同一組代碼重新連線沿用金鑰', () => {
    const h = makeHost();
    h.start();
    const ws = FakeWs.all[0];
    ws.open();
    ws.recv({ type: 'room', code: '111111', secret: 's1' });
    const k1 = h.key;
    ws.recv({ type: 'room', code: '111111', secret: 's1' });
    assert.equal(h.key, k1);
    ws.recv({ type: 'room', code: '222222', secret: 's2' });
    assert.notEqual(h.key, k1);
  });
});
