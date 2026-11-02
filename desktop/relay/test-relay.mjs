// 測試內建遙控伺服器（myscreen-relay.exe）的協定，與 server/relay.py 相同
// 用法（先執行過 desktop\build.ps1）：node desktop/relay/test-relay.mjs [myscreen-relay.exe 路徑]
// 需要 Node.js 22 以上（內建 WebSocket）；全部通過時結束代碼為 0
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const exe = process.argv[2] || fileURLToPath(new URL('../resources/myscreen-relay.exe', import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
const firstLine = (p) => new Promise((resolve) => p.stdout.once('data', (d) => resolve(d.toString().trim())));

const proc = spawn(exe, ['--port', '52480', '--parent', String(process.pid)]);
const listen = await firstLine(proc);
const port = +listen.split(' ')[1];
check('啟動輸出 LISTEN <port> <ip>', /^LISTEN \d+ /.test(listen), listen);

// 連接埠被占用時自動換下一個
const proc2 = spawn(exe, ['--port', String(port), '--parent', String(process.pid)]);
const listen2 = await firstLine(proc2);
check('連接埠被占用時改用下一個', +listen2.split(' ')[1] === port + 1, listen2);
proc2.kill();

// 手機遙控網頁
const page = await fetch(`http://127.0.0.1:${port}/remote.html`);
check('提供 remote.html', page.ok && (await page.text()).includes('MyScreen'));
const js = await fetch(`http://127.0.0.1:${port}/js/widgets/util.js`);
check('提供手機頁的 JS', js.ok);
check('不存在的檔案回 404', (await fetch(`http://127.0.0.1:${port}/../server/app.py`)).status === 404);

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

const phone = client('/ws/remote?code=' + room.code);
await phone.opened;
const hello = await phone.next('hello');
check('手機收到 hello 與目前狀態', hello && hello.online === true && hello.state?.widgets?.[0]?.view?.current === '王小明' && hello.state.pad.length === 70000);
const joined = await screen.next('remotes');
check('教室電腦收到裝置連線通知', joined && joined.count === 1 && joined.joined === true);

phone.send({ type: 'cmd', target: 'widget', widgetId: 'w1', action: 'pick', args: { name: '陳大華' } });
const cmd = await screen.next('cmd');
check('指令轉送到教室電腦', cmd && cmd.widgetId === 'w1' && cmd.action === 'pick' && cmd.args.name === '陳大華');

screen.send({ type: 'state', state: { board: { name: '更新' } } });
const st = await phone.next('state');
check('狀態同步到手機', st && st.state.board.name === '更新');
screen.send({ type: 'notice', text: '已在白板上播放影片' });
const notice = await phone.next('notice');
check('提示訊息轉送', notice && notice.text === '已在白板上播放影片');

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

// 中斷全部並換代碼
screen2.send({ type: 'kick' });
const kicked = await phone.next('kicked');
const room4 = await screen2.next('room');
check('中斷全部：手機被踢出', !!kicked);
check('中斷全部：換新代碼', room4 && room4.code !== room.code);
const old = client('/ws/remote?code=' + room.code);
await old.opened;
check('舊代碼失效', !!(await old.next('error')));

// 最多 8 台裝置
const many = [];
for (let i = 0; i < 9; i++) { const c = client('/ws/remote?code=' + room4.code); await c.opened; many.push(c); }
await wait(300);
const ninth = many[8].msgs.find((m) => m.type === 'error');
check('超過 8 台裝置被拒絕', ninth && ninth.message.includes('太多'));
proc.kill();

// 父程序結束後伺服器要自動關閉（MyScreen 當掉時）
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
