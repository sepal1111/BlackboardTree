// MyScreen 主程式：選擇儲存位置、白板清單、拖曳縮放、工具列、背景
import { api } from './api.js';
import { Store, LS, uid } from './store.js';
import { FolderBackend, ServerBackend, LocalBackend, DATA_DIR } from './backends/index.js';
import { FsaAdapter, NeuAdapter, kvGet, kvSet } from './backends/fs.js';
import { widgets, widgetList } from './widgets/index.js';
import { classifyUrl } from './widgets/media.js';
import { h, toast, modal, menu, promptDialog, confirmDialog, pickImage } from './ui.js';
import { RemoteHost } from './remote-host.js';

const BG_PRESETS = {
  sky: 'linear-gradient(160deg,#a5d8ff 0%,#d0ebff 55%,#f1f8ff 100%)',
  meadow: 'linear-gradient(160deg,#b2f2bb 0%,#d3f9d8 50%,#f4fce3 100%)',
  sunset: 'linear-gradient(160deg,#ffc9c9 0%,#ffd8a8 50%,#fff3bf 100%)',
  lavender: 'linear-gradient(160deg,#d0bfff 0%,#e5dbff 50%,#f3f0ff 100%)',
  ocean: 'linear-gradient(160deg,#1864ab 0%,#1c7ed6 50%,#4dabf7 100%)',
  forest: 'linear-gradient(160deg,#2b8a3e 0%,#37b24d 50%,#8ce99a 100%)',
  night: 'linear-gradient(160deg,#141e30 0%,#243b55 100%)',
  chalk: 'radial-gradient(circle at 30% 20%,#3d5a40 0%,#2a3f2c 70%)',
  paper: '#f8f5ee', white: '#ffffff', gray: '#dee2e6', dark: '#212529',
  grid: '#ffffff url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2740%27 height=%2740%27%3E%3Cpath d=%27M40 0H0v40%27 fill=%27none%27 stroke=%27%23d0ebff%27/%3E%3C/svg%3E")',
  dots: '#fdfdfd url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2724%27 height=%2724%27%3E%3Ccircle cx=%272%27 cy=%272%27 r=%271.5%27 fill=%27%23ced4da%27/%3E%3C/svg%3E")',
};

// 桌面版（Neutralino）會注入 NL_ 開頭的全域變數
const DESKTOP = typeof window.NL_PORT !== 'undefined';
const DESKTOP_ROOT = window.NL_MSROOT || 'V:';      // 老師個人資料夾的磁碟機
const NETDRIVE_EXE = window.NL_NETDRIVE || '';     // 網路磁碟機連線程式
const CHOICE_KEY = 'ms:storage';

const $ = (s) => document.querySelector(s);
const S = { store: null, board: null, mounted: new Map(), config: null, pollTimer: null, settingsModal: null, remote: null };

// ------------------------------------------------------------ 啟動
async function boot() {
  if (DESKTOP) {
    window.Neutralino.init();
    window.Neutralino.events.on('windowClose', async () => {
      await S.store?.flushAll().catch(() => {});
      window.Neutralino.app.exit();
    });
  }
  S.config = DESKTOP ? null : await api.get('/api/config').catch(() => null);
  let choice = LS.get(CHOICE_KEY, null);
  if (!choice && LS.get('ms:guest', false)) choice = { kind: 'local' }; // 舊版訪客模式
  if (!choice && DESKTOP) choice = { kind: 'neu', path: DESKTOP_ROOT };
  if (choice && (await autoConnect(choice))) return;
  showStart();
}

async function autoConnect(choice) {
  try {
    if (choice.kind === 'neu') return await connectFolder(new NeuAdapter(choice.path || DESKTOP_ROOT), choice);
    if (choice.kind === 'fsa') {
      const handle = await kvGet('dir');
      if (!handle) return false;
      const ad = new FsaAdapter(handle);
      if ((await ad.permission(false)) !== 'granted') return false;
      return await connectFolder(ad, choice);
    }
    if (choice.kind === 'server' && S.config) {
      const me = await api.get('/api/me', { quiet401: true });
      return await connect(new ServerBackend(me.username, me.dataPath), choice);
    }
    if (choice.kind === 'local') return await connect(new LocalBackend(), choice);
  } catch { /* 自動連線失敗就讓老師自己選 */ }
  return false;
}

// 選的資料夾本身就是 MyScreen（或已經有 boards）就直接使用，否則在裡面建立 MyScreen 子資料夾
async function connectFolder(adapter, choice) {
  const name = adapter.label.replace(/[\\/]+$/, '').split(/[\\/]/).pop().toLowerCase();
  const isData = name === DATA_DIR.toLowerCase() || (await adapter.list('')).some((e) => e.dir && e.name === 'boards');
  const backend = new FolderBackend(adapter, { id: 'folder:' + adapter.label, dataDir: isData ? '' : DATA_DIR });
  await backend.check();
  return connect(backend, choice);
}

async function connect(backend, choice) {
  stopPolling();
  S.store = new Store(backend);
  S.store.addEventListener('status', renderStatus);
  S.store.addEventListener('index', () => {
    renderTopbar();
    S.remote?.push();
    if (!S.board && document.querySelector('.boards-grid')) showBoards();
  });
  S.store.addEventListener('error', (e) => toast(e.detail, 4000));
  S.store.addEventListener('remote', (e) => {
    const b = e.detail.board;
    if (S.board && b.id === S.board.id) {
      S.board = b;
      renderBoard();
      toast(e.detail.conflict ? '這個白板剛在其他裝置被修改，已載入最新版本' : '已同步其他裝置的修改');
    }
  });
  S.store.addEventListener('deleted', () => { toast('這個白板已在其他裝置刪除'); showBoards(); });
  try {
    await S.store.listBoards();
  } catch { return false; }
  LS.set(CHOICE_KEY, choice);
  LS.del('ms:guest');
  renderDock();
  renderStatus();
  renderRemoteBtn();
  if (S.store.remote) S.pollTimer = setInterval(() => S.store?.poll(S.board).catch(() => {}), 8000);
  showBoards();
  return true;
}

function stopPolling() { clearInterval(S.pollTimer); S.pollTimer = null; }
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.pollTimer) S.store?.poll(S.board).catch(() => {}); });

window.addEventListener('ms:unauthorized', () => {
  if (S.store?.backend.kind === 'server') {
    stopPolling();
    showStart('登入已過期，請重新登入（尚未儲存的變更保留在這台電腦）');
  }
});

// ------------------------------------------------------------ 第一步：選擇儲存位置
async function resolveNetDrive() {
  if (!NETDRIVE_EXE) return '';
  let p = NETDRIVE_EXE.replace(/\//g, '\\'); // 設定檔用 / 避免 Neutralino 的跳脫問題
  for (const [m, name] of NETDRIVE_EXE.matchAll(/%(\w+)%/g)) {
    p = p.replace(m, await window.Neutralino.os.getEnv(name).catch(() => ''));
  }
  try { await window.Neutralino.filesystem.getStats(p); return p; } catch { return ''; }
}

function screen(card) {
  closeBoard();
  $('#app').classList.add('hidden');
  const box = $('#login');
  box.classList.remove('hidden');
  box.innerHTML = '';
  box.append(card);
}

function showStart(message) {
  const err = h('div', { class: 'login-err' }, message || '');
  const fail = (e) => { err.textContent = e.message || String(e); };
  const options = [];

  if (DESKTOP) {
    // 桌面版：直接讀寫網路磁碟機
    const drive = new NeuAdapter(DESKTOP_ROOT);
    const status = h('div', { class: 'opt-status' }, '檢查中…');
    const retry = async () => {
      status.textContent = '檢查中…';
      if (await drive.exists('')) {
        try { await connectFolder(drive, { kind: 'neu', path: DESKTOP_ROOT }); } catch (e) { fail(e); status.textContent = ''; }
      } else status.textContent = `尚未連線 ${drive.label}，請先用「網路磁碟機」程式登入，再按「重新檢查」。`;
    };
    // 有安裝「網路磁碟機」程式（NetDrive）就提供一鍵開啟
    const netBtn = h('span');
    resolveNetDrive().then((exe) => {
      if (!exe) return;
      netBtn.append(h('button', { class: 'btn', onclick: () => {
        window.Neutralino.os.execCommand(`"${exe}"`, { background: true }).catch(fail);
        status.textContent = '連線完成後，請按「重新檢查」。';
      } }, '開啟網路磁碟機程式'));
    });
    options.push(h('div', { class: 'opt main' },
      h('div', { class: 'opt-title' }, `📁 我的網路磁碟機（${drive.label}）`),
      status,
      h('div', { class: 'row-btns' },
        h('button', { class: 'btn primary', onclick: retry }, '重新檢查'),
        netBtn,
        h('button', { class: 'btn', onclick: async () => {
          const p = await window.Neutralino.os.showFolderDialog('選擇白板要儲存的資料夾').catch(() => '');
          if (p) connectFolder(new NeuAdapter(p), { kind: 'neu', path: p }).catch(fail);
        } }, '選擇其他資料夾'))));
    setTimeout(retry);
  } else if (FsaAdapter.supported()) {
    // 網頁版：用瀏覽器的資料夾存取權限
    const remembered = h('span');
    kvGet('dir').then((handle) => {
      if (!handle) return;
      remembered.append(h('button', { class: 'btn primary', onclick: async () => {
        try {
          const ad = new FsaAdapter(handle);
          if ((await ad.permission(true)) !== 'granted') return fail(new Error('沒有取得資料夾權限'));
          await connectFolder(ad, { kind: 'fsa' });
        } catch (e) { fail(e); }
      } }, `繼續使用「${handle.name}」`));
    });
    options.push(h('div', { class: 'opt main' },
      h('div', { class: 'opt-title' }, '📁 網路磁碟機或資料夾'),
      h('div', { class: 'opt-status' }, '先用網路磁碟機程式連線，再選擇 V: 磁碟機（或其中的 MyScreen 資料夾）。瀏覽器詢問時請選「允許」，之後會自動讀取。'),
      h('div', { class: 'row-btns' }, remembered,
        h('button', { class: 'btn', onclick: async () => {
          let handle;
          try {
            handle = await window.showDirectoryPicker({ id: 'myscreen', mode: 'readwrite' });
          } catch (e) {
            if (e.name === 'AbortError') return;
            return fail(new Error('瀏覽器不允許選擇這個位置，請改選 V: 裡面的資料夾（可以先建立一個 MyScreen 資料夾）'));
          }
          try {
            await kvSet('dir', handle);
            await connectFolder(new FsaAdapter(handle), { kind: 'fsa' });
          } catch (e) { fail(e); }
        } }, '選擇資料夾…'))));
  } else {
    options.push(h('div', { class: 'opt' },
      h('div', { class: 'opt-title' }, '📁 網路磁碟機或資料夾'),
      h('div', { class: 'opt-status' }, window.isSecureContext
        ? '這個瀏覽器不支援資料夾存取，請改用 Edge 或 Chrome，或安裝 MyScreen 桌面版。'
        : '網址必須是 https:// 或 localhost 才能存取資料夾；也可以改用 MyScreen 桌面版。')));
  }

  if (S.config && S.config.mode !== 'relay') {
    // 伺服器模式（由伺服器用 SAMBA 帳號代為連線）
    const smb = S.config.mode === 'smb';
    const user = h('input', { class: 'input', placeholder: smb ? 'SAMBA 帳號' : '名稱（例如：王老師）', autocomplete: 'username', value: LS.get('ms:lastUser', '') });
    const pass = h('input', { class: 'input', type: 'password', placeholder: '密碼', autocomplete: 'current-password' });
    const btn = h('button', { class: 'btn primary', type: 'submit' }, '登入');
    options.push(h('form', { class: 'opt', onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true; btn.textContent = '連線中…'; err.textContent = '';
      try {
        const r = await api.post('/api/login', { username: user.value.trim(), password: pass.value }, { quiet401: true });
        LS.set('ms:lastUser', user.value.trim());
        await connect(new ServerBackend(r.username, r.dataPath), { kind: 'server' });
      } catch (ex) { fail(ex); } finally { btn.disabled = false; btn.textContent = '登入'; }
    } },
    h('div', { class: 'opt-title' }, smb ? '🔑 用學校帳號登入（不需連線網路磁碟機）' : '🔑 登入 MyScreen 伺服器'),
    h('div', { class: 'row-btns' }, user, S.config.needsPassword ? pass : null, btn)));
  }

  options.push(h('div', { class: 'opt' },
    h('div', { class: 'opt-title' }, '💻 只存在這台電腦'),
    h('div', { class: 'row-btns' },
      h('span', { class: 'opt-status grow' }, '不會同步到其他裝置'),
      h('button', { class: 'btn', onclick: () => connect(new LocalBackend(), { kind: 'local' }) }, '使用'))));

  screen(h('div', { class: 'login-card wide' },
    h('div', { class: 'logo' }, h('span', null, '▣'), ' MyScreen'),
    h('p', { class: 'muted' }, '請選擇白板要儲存在哪裡。選過一次後，下次開啟會自動讀取。'),
    options, err));
}

// ------------------------------------------------------------ 第二步：選擇白板
const fmtTime = (t) => {
  if (!t) return '';
  const d = new Date(t);
  const today = new Date().toDateString() === d.toDateString();
  return today ? `今天 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : `${d.getMonth() + 1}月${d.getDate()}日`;
};

function showBoards() {
  const store = S.store;
  const last = LS.get(store.key('last'), null);
  const grid = h('div', { class: 'boards-grid' });
  const list = [...store.index].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  for (const b of list) {
    grid.append(h('button', { class: 'board-card' + (b.id === last ? ' last' : ''), onclick: () => openBoardById(b.id) },
      h('div', { class: 'bc-name' }, b.name),
      h('div', { class: 'bc-time' }, (b.id === last ? '上次使用・' : '') + fmtTime(b.updatedAt))));
  }
  grid.append(h('button', { class: 'board-card new', onclick: async () => {
    const n = await promptDialog('新白板名稱（例如：三年二班、數學課）', list.length ? '新白板' : '我的白板');
    if (n) openBoard(store.newBoard(n));
  } }, h('div', { class: 'bc-plus' }, '＋'), h('div', null, '新增白板')));

  const icon = { folder: '📁', server: '🔑', local: '💻' }[store.backend.kind];
  screen(h('div', { class: 'login-card boards' },
    h('div', { class: 'boards-head' },
      h('div', null, h('h2', null, '選擇白板'),
        h('div', { class: 'muted' }, '儲存位置：', h('b', null, `${icon} ${store.backend.label}`),
          store.status === 'offline' ? h('span', { class: 'warn-text' }, '（目前無法連線，顯示的是這台電腦的暫存）') : null)),
      h('div', { class: 'row-btns' },
        store.remote ? h('button', { class: 'btn', onclick: async () => { await store.listBoards(); showBoards(); } }, '↻ 重新整理') : null,
        h('button', { class: 'btn', onclick: () => leaveStorage() }, '更換儲存位置'))),
    list.length ? null : h('p', { class: 'muted' }, '這裡還沒有白板，先建立一個吧！'),
    grid));
}

async function openBoardById(id) {
  const board = await S.store.getBoard(id).catch((e) => { toast(e.message); return null; });
  if (board) openBoard(board);
  else { toast('找不到這個白板，可能已被刪除'); await S.store.listBoards(); showBoards(); }
}

function openBoard(board) {
  S.board = board;
  board.data ||= {};
  board.data.widgets ||= [];
  LS.set(S.store.key('last'), board.id);
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  renderBoard();
}

function closeBoard() {
  S.settingsModal?.close();
  for (const m of S.mounted.values()) m.inst.destroy?.();
  S.mounted.clear();
  document.querySelectorAll('#stage .widget').forEach((el) => el.remove());
  S.board = null;
  S.remote?.push();
}

async function leaveStorage() {
  if (S.store) {
    await S.store.flushAll().catch(() => {});
    if (S.store.backend.kind === 'server') await api.post('/api/logout').catch(() => {});
  }
  stopPolling();
  LS.del(CHOICE_KEY);
  S.store = null;
  showStart();
}

const save = (immediate) => { if (!S.board) return; S.store.saveBoard(S.board, immediate); S.remote?.push(); };

// ------------------------------------------------------------ 畫面
function renderBoard() {
  S.settingsModal?.close();
  for (const m of S.mounted.values()) m.inst.destroy?.();
  S.mounted.clear();
  const stage = $('#stage');
  stage.querySelectorAll('.widget').forEach((el) => el.remove());
  applyBackground();
  for (const w of S.board.data.widgets) mountWidget(w);
  renderTopbar();
  $('#empty-hint').classList.toggle('hidden', S.board.data.widgets.length > 0);
  S.remote?.push();
}

function applyBackground() {
  const bg = S.board.data.background || { type: 'preset', value: 'sky' };
  const stage = $('#stage');
  stage.style.background = '';
  if (bg.type === 'preset') stage.style.background = BG_PRESETS[bg.value] || BG_PRESETS.sky;
  else if (bg.type === 'color') stage.style.background = bg.value;
  else if (bg.type === 'image') {
    stage.style.background = '#333';
    S.store.imageUrl(bg.ref).then((url) => {
      if (url && S.board?.data.background === bg) stage.style.background = `#333 url("${url.replace(/"/g, '%22')}") center / ${bg.fit || 'cover'} no-repeat`;
    });
  }
  const dark = ['ocean', 'forest', 'night', 'chalk', 'dark'].includes(bg.value) || bg.type === 'image';
  stage.classList.toggle('dark-bg', dark);
}

function renderStatus() {
  const el = $('#sync');
  if (!S.store) return;
  if (!S.store.remote) { el.textContent = '💻 僅存在此電腦'; el.className = 'pill warn'; el.title = '改用網路磁碟機儲存才能跨裝置使用'; return; }
  const map = { synced: ['✔ 已儲存', 'pill ok'], saving: ['⏳ 儲存中…', 'pill'], offline: ['⚠️ 無法連線，稍後重試', 'pill warn'] };
  const [t, c] = map[S.store.status] || map.synced;
  el.textContent = t; el.className = c;
  el.title = `儲存位置：${S.store.backend.label}`;
}

function renderTopbar() {
  $('#board-name').textContent = S.board?.name || '';
}

function renderDock() {
  const dock = $('#dock-items');
  dock.innerHTML = '';
  for (const def of widgetList) {
    dock.append(h('button', { class: 'dock-btn', title: def.title, onclick: () => addWidget(def.type) },
      h('span', { class: 'di' }, def.icon), h('span', { class: 'dl' }, def.title)));
  }
}

// ------------------------------------------------------------ 小工具
function maxZ() { return Math.max(0, ...S.board.data.widgets.map((w) => w.z || 0)); }

function addWidget(type, copyFrom, init) {
  const def = widgets[type];
  const n = S.board.data.widgets.length;
  const w = copyFrom
    ? { ...structuredClone(copyFrom), id: uid(), x: Math.min(copyFrom.x + 0.02, 1 - copyFrom.w), y: Math.min(copyFrom.y + 0.03, 0.9), z: maxZ() + 1 }
    : {
      id: uid(), type, z: maxZ() + 1, w: def.size.w, h: def.size.h,
      x: Math.max(0, 0.5 - def.size.w / 2 + ((n % 6) - 2.5) * 0.03),
      y: Math.max(0.07, 0.42 - def.size.h / 2 + ((n % 6) - 2.5) * 0.03),
      state: def.state(),
      ...(init || {}),
    };
  if (init?.state) w.state = { ...def.state(), ...init.state };
  S.board.data.widgets.push(w);
  mountWidget(w);
  $('#empty-hint').classList.add('hidden');
  save();
  return w;
}

function removeWidget(id) {
  const m = S.mounted.get(id);
  m?.inst.destroy?.();
  m?.el.remove();
  S.mounted.delete(id);
  S.board.data.widgets = S.board.data.widgets.filter((w) => w.id !== id);
  $('#empty-hint').classList.toggle('hidden', S.board.data.widgets.length > 0);
  save();
}

function place(el, w) {
  el.style.left = w.x * 100 + '%';
  el.style.top = w.y * 100 + '%';
  el.style.width = w.w * 100 + '%';
  el.style.height = w.h * 100 + '%';
  el.style.zIndex = 10 + (w.z || 0);
}

function mountWidget(w) {
  const def = widgets[w.type];
  if (!def) return;
  w.state = { ...def.state(), ...(w.state || {}) };
  const body = h('div', { class: 'w-body' });
  const head = h('div', { class: 'w-head' },
    h('span', { class: 'w-title' }, def.icon + ' ' + def.title),
    h('div', { class: 'w-actions' },
      h('button', { title: '設定', 'data-act': 'settings' }, '⚙'),
      h('button', { title: '複製', 'data-act': 'dup' }, '⧉'),
      h('button', { title: '關閉', 'data-act': 'close' }, '✕')));
  const grip = h('div', { class: 'w-resize', title: '拖曳調整大小' });
  const el = h('div', { class: `widget w-${w.type}`, 'data-id': w.id }, head, body, grip);
  place(el, w);
  $('#stage').append(el);

  const ctx = { state: w.state, widget: w, store: S.store, save: () => save(), push: () => S.remote?.push() };
  let inst = {};
  try { inst = def.mount(body, ctx) || {}; } catch (e) { console.error(e); body.textContent = '此小工具發生錯誤'; }
  S.mounted.set(w.id, { el, inst, w });
  if (!inst.settings) head.querySelector('[data-act=settings]').remove();

  head.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'close') removeWidget(w.id);
    if (act === 'dup') addWidget(w.type, w);
    if (act === 'settings') openSettings(w, def, inst);
  });

  // 點擊時移到最上層
  el.addEventListener('pointerdown', () => {
    if ((w.z || 0) < maxZ()) { w.z = maxZ() + 1; place(el, w); save(); }
  }, true);

  dragHandler(head, el, w, (dx, dy, o) => {
    w.x = clamp(o.x + dx, -w.w + 0.05, 0.95);
    w.y = clamp(o.y + dy, 0, 0.95);
  });
  dragHandler(grip, el, w, (dx, dy, o) => {
    const r = $('#stage').getBoundingClientRect();
    w.w = clamp(o.w + dx, 150 / r.width, 1);
    w.h = clamp(o.h + dy, 110 / r.height, 1);
  });
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function dragHandler(handle, el, w, apply) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    const r = $('#stage').getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const o = { x: w.x, y: w.y, w: w.w, h: w.h };
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('dragging');
    const move = (ev) => { apply((ev.clientX - sx) / r.width, (ev.clientY - sy) / r.height, o); place(el, w); };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      document.body.classList.remove('dragging');
      if (o.x !== w.x || o.y !== w.y || o.w !== w.w || o.h !== w.h) save();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

function openSettings(w, def, inst) {
  const c = h('div', { class: 'stack' });
  inst.settings(c);
  S.settingsModal = modal({ title: `${def.icon} ${def.title} 設定`, body: c, actions: [{ label: '完成', primary: true }], onClose: () => { S.settingsModal = null; } });
}

// ------------------------------------------------------------ 上方選單
function boardMenu(anchor) {
  const items = S.store.index.map((b) => ({
    label: (b.id === S.board.id ? '● ' : '　') + b.name,
    active: b.id === S.board.id,
    onClick: async () => {
      if (b.id === S.board.id) return;
      const board = await S.store.getBoard(b.id).catch((e) => { toast(e.message); return null; });
      if (board) openBoard(board);
    },
  }));
  menu(anchor, [{ label: '📋 所有白板…', onClick: () => showBoards() }, '-', ...items, '-',
    { label: '＋ 新增白板', onClick: async () => { const n = await promptDialog('新白板名稱', '新白板'); if (n) openBoard(S.store.newBoard(n)); } },
    { label: '✎ 重新命名', onClick: async () => { const n = await promptDialog('白板名稱', S.board.name); if (n) { S.board.name = n; renderTopbar(); save(true); } } },
    { label: '⧉ 複製這個白板', onClick: () => {
      const b = S.store.newBoard(S.board.name + '（副本）');
      b.data = structuredClone(S.board.data);
      S.store.saveBoard(b, true);
      openBoard(b);
    } },
    { label: '🗑 刪除這個白板', danger: true, onClick: async () => {
      if (!(await confirmDialog(`確定要刪除「${S.board.name}」嗎？刪除後無法復原。`, '刪除', true))) return;
      await S.store.deleteBoard(S.board.id);
      showBoards();
    } },
  ]);
}

function backgroundDialog() {
  const bg = S.board.data.background ||= { type: 'preset', value: 'sky' };
  const set = (v) => { S.board.data.background = v; applyBackground(); save(); renderGrid(); };
  const grid = h('div', { class: 'bg-grid' });
  function renderGrid() {
    const cur = S.board.data.background;
    grid.innerHTML = '';
    for (const [k, v] of Object.entries(BG_PRESETS)) {
      grid.append(h('button', { class: 'bg-sw' + (cur.type === 'preset' && cur.value === k ? ' on' : ''), style: { background: v }, onclick: () => set({ type: 'preset', value: k }) }));
    }
  }
  renderGrid();
  modal({
    title: '🎨 背景', wide: true,
    body: h('div', { class: 'stack' }, grid,
      h('div', { class: 'row' },
        h('label', { class: 'btn' }, '自訂顏色 ', h('input', { type: 'color', value: bg.type === 'color' ? bg.value : '#a5d8ff', oninput: (e) => set({ type: 'color', value: e.target.value }) })),
        h('button', { class: 'btn primary', onclick: async () => {
          const ref = await pickImage(S.store);
          if (ref) set({ type: 'image', ref, fit: 'cover' });
        } }, S.store.backend.canBrowse ? '🖼 從我的資料夾選圖片' : '🖼 使用圖片'))),
    actions: [{ label: '完成', primary: true }],
  });
}

function userMenu(anchor) {
  const b = S.store.backend;
  menu(anchor, [
    { label: `${{ folder: '📁', server: '👤', local: '💻' }[b.kind]} ${b.label}`, onClick: () => {} },
    ...(S.store.remote ? [{ label: '🔄 立即檢查更新', onClick: () => S.store.poll(S.board).then(() => toast("已檢查更新"), (e) => toast(e.message)) }] : []),
    '-',
    { label: b.kind === 'server' ? '登出' : '更換儲存位置', onClick: () => leaveStorage() },
  ]);
}

async function toggleFullscreen() {
  if (DESKTOP) {
    const w = window.Neutralino.window;
    if (await w.isFullScreen()) w.exitFullScreen(); else w.setFullScreen();
    return;
  }
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => toast('瀏覽器不允許全螢幕'));
}

// ------------------------------------------------------------ 手機遙控
// 轉送伺服器：桌面版看設定檔（NL_RELAY），網頁版則是提供這個網頁的伺服器
const relayBase = () => (window.NL_RELAY || (S.config ? location.origin : '')).replace(/\/+$/, '');

function remoteState() {
  const b = S.board;
  const list = b ? [...b.data.widgets].sort((x, y) => (x.y - y.y) || (x.x - y.x)) : [];
  return {
    now: Date.now(),
    board: b ? { id: b.id, name: b.name } : null,
    boards: (S.store?.index || []).map((x) => ({ id: x.id, name: x.name })),
    chromeHidden: document.body.classList.contains('chrome-hidden'),
    addable: widgetList.filter((d) => ['timer', 'stopwatch', 'names', 'groups', 'seats', 'text', 'traffic', 'work', 'dice', 'poll', 'clock', 'calendar'].includes(d.type))
      .map((d) => ({ type: d.type, title: d.title, icon: d.icon })),
    widgets: list.map((w) => {
      const def = widgets[w.type];
      const inst = S.mounted.get(w.id)?.inst;
      let view = null;
      try { view = inst?.remote?.view() ?? null; } catch { /* ignore */ }
      return { id: w.id, type: w.type, title: def?.title || w.type, icon: def?.icon || '', view };
    }),
  };
}

async function remoteCmd(m) {
  const args = m.args || {};
  if (m.target === 'app') {
    if (m.action === 'board' && S.store?.index.some((b) => b.id === args.id)) {
      if (S.board?.id !== args.id) await openBoardById(args.id);
    } else if (m.action === 'chrome') {
      document.body.classList.toggle('chrome-hidden');
    } else if (m.action === 'fullscreen') {
      await toggleFullscreen();
    } else if (m.action === 'add' && S.board && widgets[args.type]) {
      addWidget(args.type);
    } else if (m.action === 'close' && S.board) {
      removeWidget(args.widgetId);
    } else if (m.action === 'url') {
      await openUrlFromRemote(String(args.url || ''));
    }
    return;
  }
  if (m.target === 'widget' && S.board) {
    const inst = S.mounted.get(m.widgetId)?.inst;
    inst?.remote?.act(m.action, args);
  }
}

// 手機送來的網址：YouTube／影片檔放到白板上播放，其他網址用瀏覽器開啟
async function openUrlFromRemote(url) {
  const info = classifyUrl(url);
  if (!info) return S.remote?.notice('這不是有效的網址（需要 http:// 或 https:// 開頭）');
  if (info.kind === 'web') {
    if (DESKTOP) {
      await window.Neutralino.os.open(info.href);
    } else if (!window.open(info.href, '_blank', 'noopener')) {
      // 瀏覽器擋掉沒有點擊動作的彈出視窗，改成在畫面上顯示按鈕
      toast(h('span', null, '手機送來網址：', h('a', { href: info.href, target: '_blank', rel: 'noopener', class: 'toast-link' }, '點這裡開啟')), 15000);
      return S.remote?.notice('瀏覽器擋住了新視窗，請在電腦畫面上點一下「點這裡開啟」');
    }
    return S.remote?.notice('已在教室電腦開啟瀏覽器');
  }
  if (!S.board) return S.remote?.notice('請先在電腦上開啟一個白板');
  // 影片：放在畫面中間、佔大部分空間；取代上一個從手機送來的影片，避免兩個一起出聲
  const prev = S.board.data.widgets.find((x) => x.type === 'embed' && x.state?.fromRemote);
  const pos = prev ? { x: prev.x, y: prev.y, w: prev.w, h: prev.h } : { x: 0.12, y: 0.08, w: 0.76, h: 0.8 };
  if (prev) removeWidget(prev.id);
  const w = addWidget('embed', null, { ...pos, state: { url: info.href, autoplay: true, fromRemote: true } });
  S.remote?.notice(info.kind === 'youtube' ? '已在白板上播放 YouTube 影片' : '已在白板上播放影片');
  return w;
}

function ensureRemote() {
  const base = relayBase();
  if (!base) return null;
  if (!S.remote) {
    S.remote = new RemoteHost(base, { getState: remoteState, onCmd: remoteCmd });
    S.remote.addEventListener('change', renderRemoteBtn);
    S.remote.addEventListener('joined', () => toast('📱 遙控裝置已連線'));
    S.remote.start();
  }
  return S.remote;
}

function renderRemoteBtn() {
  const btn = $('#remote-btn');
  btn.classList.toggle('hidden', !relayBase());
  const r = S.remote;
  const n = r?.status === 'online' ? r.remotes : 0;
  btn.querySelector('.tb-label').textContent = n ? `遙控中（${n}）` : '遙控';
  btn.classList.toggle('active', n > 0);
}

function remoteDialog() {
  const r = ensureRemote();
  if (!r) return toast('尚未設定遙控伺服器');
  const box = h('div', { class: 'remote-box' });
  const render = () => {
    box.innerHTML = '';
    if (r.status !== 'online') {
      box.append(h('div', { class: 'remote-wait' }, r.status === 'error'
        ? `無法連線到遙控伺服器（${r.base}），正在重試…`
        : '連線中…'));
      return;
    }
    const qr = h('div', { class: 'remote-qr' });
    try {
      const q = window.qrcode(0, 'M');
      q.addData(r.url);
      q.make();
      qr.innerHTML = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    } catch { qr.textContent = r.url; }
    box.append(
      qr,
      h('div', { class: 'remote-info' },
        h('div', { class: 'muted' }, '用手機或平板掃描 QR Code，或開啟下方網址並輸入代碼'),
        h('div', { class: 'remote-code' }, r.code.slice(0, 3) + ' ' + r.code.slice(3)),
        h('div', { class: 'remote-url' }, `${r.base}/remote.html`),
        h('div', { class: 'remote-count' }, r.remotes ? `📱 目前有 ${r.remotes} 台裝置連線` : '尚無裝置連線'),
        h('div', { class: 'row-btns' },
          h('button', { class: 'btn danger', onclick: () => { r.kick(); toast('已中斷所有遙控裝置，並更換新代碼'); } }, '中斷全部並換代碼'))));
  };
  render();
  // 手機連上後自動關閉，讓電視畫面回到白板
  const onJoin = () => setTimeout(() => dlg.close(), 800);
  r.addEventListener('change', render);
  r.addEventListener('joined', onJoin);
  const dlg = modal({ title: '📱 手機遙控', body: box, wide: true, actions: [{ label: '完成', primary: true }],
    onClose: () => { r.removeEventListener('change', render); r.removeEventListener('joined', onJoin); } });
}

// ------------------------------------------------------------ 綁定
$('#board-btn').addEventListener('click', (e) => boardMenu(e.currentTarget));
$('#bg-btn').addEventListener('click', backgroundDialog);
$('#fs-btn').addEventListener('click', toggleFullscreen);
$('#user-btn').addEventListener('click', (e) => userMenu(e.currentTarget));
$('#clear-btn').addEventListener('click', async () => {
  if (!S.board.data.widgets.length) return;
  if (await confirmDialog('要移除這個白板上的所有小工具嗎？', '全部移除', true)) {
    S.board.data.widgets = [];
    renderBoard();
    save();
  }
});
$('#hide-btn').addEventListener('click', () => { document.body.classList.toggle('chrome-hidden'); S.remote?.push(); });
$('#remote-btn').addEventListener('click', remoteDialog);
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input,textarea,[contenteditable]')) return;
  if (e.key === 'h' || e.key === 'H') { document.body.classList.toggle('chrome-hidden'); S.remote?.push(); }
  if (e.key === 'f' || e.key === 'F') toggleFullscreen();
});
window.addEventListener('beforeunload', (e) => {
  if (S.store?.pending.size) { e.preventDefault(); e.returnValue = ''; }
});

boot();
