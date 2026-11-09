// 測試內建遙控伺服器（myscreen-relay.exe）的協定，與 server/relay.py 相同
// 用法（先執行過 desktop\build.ps1）：node desktop/relay/test-relay.mjs [myscreen-relay.exe 路徑]
// 需要 Node.js 22 以上（內建 WebSocket）；全部通過時結束代碼為 0
import { spawn, execSync } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const exe = process.argv[2] || fileURLToPath(new URL('../resources/myscreen-relay.exe', import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
const firstLine = (p) => new Promise((resolve) => p.stdout.once('data', (d) => resolve(d.toString().trim())));

const TOKEN = 'test-token-0123456789abcdef';
const proc = spawn(exe, ['--port', '52480', '--parent', String(process.pid), '--token', TOKEN]);
const listen = await firstLine(proc);
const port = +listen.split(' ')[1];
check('啟動輸出 LISTEN <port> <ip>', /^LISTEN \d+ /.test(listen), listen);

// 連接埠被占用時自動換下一個
const proc2 = spawn(exe, ['--port', String(port), '--parent', String(process.pid)]);
const listen2 = await firstLine(proc2);
check('連接埠被占用時改用下一個', +listen2.split(' ')[1] === port + 1, listen2);
proc2.kill();

// 只連線、不送 HTTP 標頭的連線：10 秒後被伺服器關閉（最後再檢查）
let idleClosedAt = 0;
const idleStart = Date.now();
const idle = net.connect(port, '127.0.0.1');
idle.on('close', () => { idleClosedAt = Date.now(); });
idle.on('error', () => {});

// 手機遙控網頁
const page = await fetch(`http://127.0.0.1:${port}/remote.html`);
check('提供 remote.html', page.ok && (await page.text()).includes('黑板樹'));
const js = await fetch(`http://127.0.0.1:${port}/js/widgets/util.js`);
check('提供手機頁的 JS', js.ok);
const naclJs = await fetch(`http://127.0.0.1:${port}/vendor/nacl-fast.min.js`);
check('提供加密程式（remote-crypto.js、nacl-fast.min.js）', naclJs.ok && (await naclJs.text()).includes('secretbox') && (await fetch(`http://127.0.0.1:${port}/js/remote-crypto.js`)).ok);
check('不存在的檔案回 404', (await fetch(`http://127.0.0.1:${port}/../server/app.py`)).status === 404);

// 本機檔案（匯入資源）：要 token、只給影音文件類型、支援 Range
{
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'bt-media-'));
  const file = join(dir, '測試 影片.mp4');
  const data = Buffer.alloc(1000000);
  for (let i = 0; i < data.length; i++) data[i] = i % 251;
  writeFileSync(file, data);
  writeFileSync(join(dir, 'secret.ini'), 'x');
  const media = (p, t = TOKEN, headers = {}) => fetch(`http://127.0.0.1:${port}/media?t=${t}&p=${encodeURIComponent(p)}`, { headers });
  const full = await media(file);
  const body = Buffer.from(await full.arrayBuffer());
  check('本機檔案：完整讀取', full.status === 200 && body.equals(data) && full.headers.get('accept-ranges') === 'bytes' && full.headers.get('content-type') === 'video/mp4');
  const part = await media(file, TOKEN, { Range: 'bytes=500000-500099' });
  const pb = Buffer.from(await part.arrayBuffer());
  check('本機檔案：Range 分段', part.status === 206 && part.headers.get('content-range') === 'bytes 500000-500099/1000000' && pb.equals(data.subarray(500000, 500100)));
  const tail = await media(file, TOKEN, { Range: 'bytes=-10' });
  check('本機檔案：Range 最後幾個位元組', tail.status === 206 && Buffer.from(await tail.arrayBuffer()).equals(data.subarray(-10)));
  const open = await media(file, TOKEN, { Range: 'bytes=999990-' });
  check('本機檔案：Range 到結尾', open.status === 206 && (await open.arrayBuffer()).byteLength === 10);
  check('本機檔案：超出範圍回 416', (await media(file, TOKEN, { Range: 'bytes=2000000-' })).status === 416);
  check('本機檔案：沒有 token 或 token 錯誤回 403', (await media(file, 'wrong')).status === 403 && (await fetch(`http://127.0.0.1:${port}/media?p=${encodeURIComponent(file)}`)).status === 403);
  check('本機檔案：不是影音文件類型回 403', (await media(join(dir, 'secret.ini'))).status === 403);
  check('本機檔案：不存在回 404', (await media(join(dir, 'none.mp4'))).status === 404);
}

const base = `ws://127.0.0.1:${port}`;
function client(path) {
  const ws = new WebSocket(base + path);
  const msgs = [];
  ws.onmessage = (e) => msgs.push(JSON.parse(e.data));
  const opened = new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const next = async (type, ms = 2000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const i = msgs.findIndex((m) => !type || m.type === type);
      if (i >= 0) return msgs.splice(i, 1)[0];
      await wait(20);
    }
    return null;
  };
  return { ws, msgs, opened, next, send: (o) => ws.send(JSON.stringify(o)) };
}

// 教室電腦取得代碼
const screen = client('/ws/screen');
await screen.opened;
screen.send({ type: 'hello' });
const room = await screen.next('room');
check('教室電腦取得代碼', room && /^\d{6}$/.test(room.code) && room.secret?.length > 20, room && room.code);

// 推送狀態（含中文、巢狀物件、超過 64KB）
screen.send({ type: 'state', state: { board: { id: 'b1', name: '三年二班' }, widgets: [{ id: 'w1', type: 'names', view: { current: '王小明' } }], pad: 'x'.repeat(70000) } });
await wait(200);

const bad = client('/ws/remote?code=000000');
await bad.opened;
const err = await bad.next('error');
check('錯誤代碼被拒絕', err && err.message.includes('代碼錯誤'));

// 新的手機：先等老師允許，允許前收不到白板內容、也不能送指令
const KEY = 'phoneKey_1234567890abcdef';
const phone = client('/ws/remote?code=' + room.code + '&key=' + KEY);
await phone.opened;
check('新手機先等待老師允許', !!(await phone.next('wait')));
const req = await screen.next('join-request');
check('教室電腦收到連線要求（含裝置名稱）', req && req.id && typeof req.device === 'string' && req.device.length > 0, req && req.device);
phone.send({ type: 'cmd', target: 'app', action: 'chrome' });
await wait(200);
check('允許前不能送指令、看不到狀態', !screen.msgs.some((m) => m.type === 'cmd') && !phone.msgs.some((m) => m.type === 'hello' || m.type === 'state'));
screen.send({ type: 'join-answer', id: req.id, ok: true });
const hello = await phone.next('hello');
check('手機收到 hello 與目前狀態', hello && hello.online === true && hello.state?.widgets?.[0]?.view?.current === '王小明' && hello.state.pad.length === 70000);
const joined = await screen.next('remotes');
check('教室電腦收到裝置連線通知', joined && joined.count === 1 && joined.joined === true);
check('教室電腦收到「詢問結束」', !!(await screen.next('join-gone')));

// 老師按拒絕
const stranger = client('/ws/remote?code=' + room.code + '&key=strangerKey_0987654321');
await stranger.opened;
const req2 = await screen.next('join-request');
screen.send({ type: 'join-answer', id: req2.id, ok: false });
const denied = await stranger.next('error');
check('老師拒絕的裝置被中斷', denied && denied.message.includes('沒有允許'), denied && denied.message);
await screen.next('join-gone');

// 允許過的手機重新連線不用再問
const again = client('/ws/remote?code=' + room.code + '&key=' + KEY);
await again.opened;
check('允許過的手機重新連線不用再問', !!(await again.next('hello')) && !(await screen.next('join-request', 300)));
again.ws.close();
await screen.next('remotes');

// 手動輸入代碼、沒有加密金鑰的手機（帶公鑰 pk）：允許過也要再問，老師允許時把加密過的金鑰交給手機
const PK = 'A'.repeat(43), KEYBOX = 'B'.repeat(139);
const manual = client('/ws/remote?code=' + room.code + '&key=' + KEY + '&pk=' + PK);
await manual.opened;
check('沒有金鑰的手機要再問一次', !!(await manual.next('wait')));
const reqPk = await screen.next('join-request');
check('連線要求帶手機的公鑰', reqPk && reqPk.pk === PK, reqPk && reqPk.pk);
screen.send({ type: 'join-answer', id: reqPk.id, ok: true, box: KEYBOX });
const helloPk = await manual.next('hello');
check('允許後手機收到加密過的金鑰', helloPk && helloPk.key === KEYBOX);
await screen.next('remotes');
await screen.next('join-gone');
manual.ws.close();
await screen.next('remotes');

// 從其他電腦（校內 IP）不能冒充教室畫面
const lanIp = listen.split(' ')[2]?.split(',')[0];
if (lanIp) {
  const fake = new WebSocket(`ws://${lanIp}:${port}/ws/screen`);
  const fakeMsgs = [];
  fake.onmessage = (e) => fakeMsgs.push(JSON.parse(e.data));
  const fakeResult = await new Promise((r) => { fake.onopen = () => { fake.send(JSON.stringify({ type: 'hello' })); setTimeout(() => r('open'), 500); }; fake.onerror = () => r('refused'); fake.onclose = () => r('closed'); });
  check('其他電腦不能連 /ws/screen', fakeResult !== 'open' && !fakeMsgs.some((m) => m.type === 'room'), fakeResult);
} else {
  check('其他電腦不能連 /ws/screen（沒有校內 IP，略過）', true);
}

// 允許前送出的指令會在允許後才轉送（已經是老師允許的裝置），這裡先清掉
await wait(100);
for (let i = screen.msgs.length - 1; i >= 0; i--) if (screen.msgs[i].type === 'cmd' && screen.msgs[i].action === 'chrome') screen.msgs.splice(i, 1);

phone.send({ type: 'cmd', target: 'widget', widgetId: 'w1', action: 'pick', args: { name: '陳大華' } });
const cmd = await screen.next('cmd');
check('指令轉送到教室電腦', cmd && cmd.widgetId === 'w1' && cmd.action === 'pick' && cmd.args.name === '陳大華');

screen.send({ type: 'state', state: { board: { name: '更新' } } });
const st = await phone.next('state');
check('狀態同步到手機', st && st.state.board.name === '更新');
screen.send({ type: 'notice', text: '已在白板上播放影片' });
const notice = await phone.next('notice');
check('提示訊息轉送', notice && notice.text === '已在白板上播放影片');

// 加密的指令、提示原樣轉送
phone.send({ type: 'cmd', box: 'encryptedCmd_123' });
const ecmd = await screen.next('cmd');
check('加密的指令原樣轉送', ecmd && ecmd.box === 'encryptedCmd_123' && ecmd.action === undefined);
screen.send({ type: 'notice', box: 'n'.repeat(300) });
const enotice = await phone.next('notice');
check('加密的提示原樣轉送（不截到 200 字）', enotice && enotice.box?.length === 300 && enotice.text === undefined);

// 教室電腦斷線、重新連線沿用代碼
screen.ws.close();
const off = await phone.next('screen');
check('教室電腦離線通知', off && off.online === false);
const screen2 = client('/ws/screen');
await screen2.opened;
screen2.send({ type: 'hello', code: room.code, secret: room.secret });
const room2 = await screen2.next('room');
check('重新連線沿用原本代碼', room2 && room2.code === room.code);
const on = await phone.next('screen');
check('手機收到重新上線', on && on.online === true);

// 伺服器重新啟動過（代碼不在伺服器上）：沿用教室電腦原本的代碼
const screen3 = client('/ws/screen');
await screen3.opened;
screen3.send({ type: 'hello', code: '123456', secret: 'abcdefghijklmnopqrstuvwxyzABCDEF' });
const room3 = await screen3.next('room');
check('伺服器重啟後沿用教室電腦的代碼', room3 && room3.code === '123456');
screen3.ws.close();

// 學生投票：另一組代碼，只能投票
const vpage = await fetch(`http://127.0.0.1:${port}/vote.html`);
check('提供 vote.html', vpage.ok && (await vpage.text()).includes('/ws/vote'));
screen2.send({ type: 'vote-open', poll: { id: 'w9', question: '午餐吃什麼', options: ['麵', '飯'] } });
const vroom = await screen2.next('vote-room');
check('開放投票取得投票代碼', vroom && /^\d{6}$/.test(vroom.code) && vroom.code !== room.code, vroom && vroom.code);
const asRemote = client('/ws/remote?code=' + vroom.code);
await asRemote.opened;
check('投票代碼不能當遙控代碼', !!(await asRemote.next('error')));
const stu = client('/ws/vote?code=' + vroom.code);
await stu.opened;
const p1 = await stu.next('poll');
check('學生收到題目', p1 && p1.poll.question === '午餐吃什麼' && p1.poll.options[1] === '飯' && p1.online === true);
const vc = await screen2.next('voters');
check('教室電腦收到學生人數', vc && vc.count === 1);
stu.send({ type: 'cmd', target: 'app', action: 'chrome' });
stu.send({ type: 'vote', name: '  王小明同學的名字非常非常非常長超過二十個字  ', choice: 1 });
const vmsg = await screen2.next('vote');
check('學生的投票轉送到教室電腦（不轉送遙控指令）', vmsg && vmsg.choice === 1 && vmsg.name.length === 20 && vmsg.name.startsWith('王小明') && !screen2.msgs.some((m) => m.type === 'cmd'));
screen2.send({ type: 'vote-ack', to: vmsg.from, ok: true, text: '已投給「飯」', choice: 1 });
const ack = await stu.next('ack');
check('投票結果回傳給學生', ack && ack.ok === true && ack.text === '已投給「飯」' && ack.choice === 1);
screen2.send({ type: 'vote-open', poll: { id: 'w9', question: '改題目', options: ['A'] } });
const p2 = await stu.next('poll');
const vroom2 = await screen2.next('vote-room');
check('更新題目：學生收到新題目、代碼不變', p2 && p2.poll.question === '改題目' && vroom2 && vroom2.code === vroom.code);
screen2.send({ type: 'vote-close' });
check('結束投票：學生收到通知', !!(await stu.next('closed')));
const vroom3 = await screen2.next('vote-room');
check('結束投票：代碼清除', vroom3 && vroom3.code === '');
const late = client('/ws/vote?code=' + vroom.code);
await late.opened;
check('結束後投票代碼失效', !!(await late.next('error')));
screen2.send({ type: 'vote-open', code: vroom.code, poll: { id: 'w9', question: '再一次', options: ['A'] } });
const vroom4 = await screen2.next('vote-room');
check('重新開放時可沿用原本的投票代碼', vroom4 && vroom4.code === vroom.code);
screen2.send({ type: 'vote-close' });
await screen2.next('vote-room');

// 中斷全部並換代碼
screen2.send({ type: 'kick' });
const kicked = await phone.next('kicked');
const room4 = await screen2.next('room');
check('中斷全部：手機被踢出', !!kicked);
check('中斷全部：換新代碼', room4 && room4.code !== room.code);
const old = client('/ws/remote?code=' + room.code);
await old.opened;
check('舊代碼失效', !!(await old.next('error')));

// 換代碼後，原本允許過的手機也要重新允許
const re = client('/ws/remote?code=' + room4.code + '&key=' + KEY);
await re.opened;
check('換代碼後要重新允許', !!(await re.next('wait')));
const req3 = await screen2.next('join-request');
screen2.send({ type: 'join-answer', id: req3.id, ok: true });
await re.next('hello');

// 同時等待允許的手機最多 3 台
const waiting = [];
for (let i = 0; i < 4; i++) { const c = client(`/ws/remote?code=${room4.code}&key=waitingKey_${i}_abcdefghij`); await c.opened; waiting.push(c); }
await wait(300);
const fourth = waiting[3].msgs.find((m) => m.type === 'error');
check('同時等待允許最多 3 台', fourth && fourth.message.includes('等待老師允許'), fourth && fourth.message);
for (let i = 0; i < 3; i++) { const r = await screen2.next('join-request'); screen2.send({ type: 'join-answer', id: r.id, ok: false }); }
await wait(200);

// 最多 8 台裝置（用允許過的手機）
const many = [re];
for (let i = 0; i < 8; i++) { const c = client('/ws/remote?code=' + room4.code + '&key=' + KEY); await c.opened; many.push(c); }
await wait(300);
const ninth = many[8].msgs.find((m) => m.type === 'error');
check('超過 8 台裝置被拒絕', ninth && ninth.message.includes('太多'));
// 只連線不送資料的連線要被關閉
await wait(Math.max(0, 11500 - (Date.now() - idleStart)));
check('只連線不送資料的連線 10 秒後被關閉', idleClosedAt - idleStart >= 9000 && idleClosedAt - idleStart < 12000, idleClosedAt ? `${idleClosedAt - idleStart}ms` : '沒有關閉');
idle.destroy();
proc.kill();

// 父程序結束後伺服器要自動關閉（黑板樹當掉時）
const parent = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1000)']);
const orphan = spawn(exe, ['--port', String(port + 5), '--parent', String(parent.pid)]);
await firstLine(orphan);
await wait(5500);
let alive = false;
try { alive = execSync(`tasklist /FI "PID eq ${orphan.pid}" /NH`).toString().includes(String(orphan.pid)); } catch { /* ignore */ }
check('父程序結束後伺服器自動關閉', !alive);
if (alive) orphan.kill();


console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(failed ? `\n${failed} 項失敗` : `\n全部 ${results.length} 項通過`);
process.exit(failed ? 1 : 0);
