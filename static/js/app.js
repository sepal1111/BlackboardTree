// MyScreen 主程式：選擇儲存位置、白板清單、拖曳縮放、工具列、背景
import { api } from './api.js';
import { Store, LS, uid, initLocalPrefs, flushLocalPrefs } from './store.js';
import { FolderBackend, ServerBackend, LocalBackend, DATA_DIR } from './backends/index.js';
import { FsaAdapter, NeuAdapter, kvGet, kvSet } from './backends/fs.js';
import { widgets, widgetList, upgradeWidget } from './widgets/index.js';
import { classifyUrl, openExternal, PLATFORMS } from './widgets/media.js';
import { h, toast, modal, menu, promptDialog, confirmDialog, pickImage } from './ui.js';
import { RemoteHost } from './remote-host.js';
import { rosterDialog, studentsOf, hasPhotos } from './roster.js';
import { renderPollLibrary } from './poll-bank.js';
import { DOCK_POSITIONS, ICON_SIZES, DEFAULT_UI, normalizeUi, iconPx, dockInfo, visibleTools, toggleTool } from './ui-prefs.js';

const TOOL_TYPES = widgetList.map((d) => d.type);

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
const S = { store: null, board: null, mounted: new Map(), config: null, pollTimer: null, settingsModal: null, remote: null, ui: normalizeUi(null, TOOL_TYPES) };

// ------------------------------------------------------------ 啟動
async function boot() {
  if (DESKTOP) {
    window.Neutralino.init();
    await initLocalPrefs(); // 讀取這台電腦上的設定（遙控代碼、離線備份等），要在其他步驟之前
    window.Neutralino.events.on('windowClose', quitApp);
    initTray();
  }
  S.config = DESKTOP ? null : await api.get('/api/config').catch(() => null);
  await loadSchoolConfig();
  // 桌面版：開啟 MyScreen 時一起啟動內建遙控伺服器，關閉時一起關閉
  if (DESKTOP && !S.relaySchool && !window.NL_RELAY) startLocalRelay().catch((e) => console.warn(e));
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
  const settings = await S.store.getSettings().catch(() => ({}));
  S.ui = normalizeUi(settings.ui, TOOL_TYPES); // 工具列位置、圖示大小、顯示的工具（跟著老師）
  applyUi();
  renderStatus();
  const prevRelay = relayBase();
  S.relayUser = normalizeRelay(settings.relay || '');
  if (relayBase() !== prevRelay) resetRemote();
  if (relayBase() === LOCAL) ensureRemote().catch(() => {});
  else if (!S.relaySchool && !window.NL_RELAY) stopLocalRelay(); // 老師改用 NAS 等其他伺服器
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
  board.data.widgets = (board.data.widgets || []).map(upgradeWidget).filter(Boolean);
  LS.set(S.store.key('last'), board.id);
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  renderBoard();
}

function closeBoard() {
  if (S.maxId) toggleMax(null);
  S.settingsModal?.close();
  for (const m of S.mounted.values()) m.inst.destroy?.();
  S.mounted.clear();
  document.querySelectorAll('#stage .widget').forEach((el) => el.remove());
  S.board = null;
  S.remote?.closePoll();
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
  if (S.maxId) toggleMax(null);
  S.settingsModal?.close();
  for (const m of S.mounted.values()) m.inst.destroy?.();
  S.mounted.clear();
  const stage = $('#stage');
  stage.querySelectorAll('.widget').forEach((el) => el.remove());
  applyBackground();
  for (const w of S.board.data.widgets) mountWidget(w);
  if (S.remote?.poll && !S.mounted.has(S.remote.poll.id)) S.remote.closePoll();
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

// 工具圖示：有圖檔用圖檔，圖檔載入失敗時改回 emoji
function toolIcon(def, cls) {
  if (!def.img) return h('span', { class: cls }, def.icon);
  const img = h('img', { class: cls, src: def.img, alt: '', draggable: 'false' });
  img.onerror = () => img.replaceWith(h('span', { class: cls }, def.icon));
  return img;
}

function renderDock() {
  const dock = $('#dock-items');
  dock.innerHTML = '';
  for (const def of visibleTools(widgetList, S.ui)) {
    dock.append(h('button', { class: 'dock-btn', title: def.title, onclick: () => addWidget(def.type) },
      toolIcon(def, 'di'), h('span', { class: 'dl' }, def.title)));
  }
}

// 套用畫面偏好：工具列位置、圖示大小、顯示的工具
function applyUi() {
  const pos = dockInfo(S.ui);
  document.body.dataset.dock = pos.value;
  document.documentElement.style.setProperty('--dock-icon', iconPx(S.ui) + 'px');
  $('#eh-icon').textContent = pos.arrow;
  $('#eh-text').textContent = `從${pos.where}工具列加入計時器、抽籤、文字等小工具`;
  renderDock();
}

// 修改畫面偏好：立即套用，存到老師的 settings.json
async function setUi(next) {
  S.ui = normalizeUi(next, TOOL_TYPES);
  applyUi();
  S.remote?.push(); // 手機上「加入小工具」的清單也跟著變
  if (!S.store) return;
  const st = await S.store.getSettings();
  st.ui = { ...S.ui, hidden: [...S.ui.hidden] };
  S.store.saveSettings();
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
  if (S.maxId === id) toggleMax(null);
  if (S.remote?.poll?.id === id) S.remote.closePoll();
  const m = S.mounted.get(id);
  m?.inst.destroy?.();
  m?.el.remove();
  S.mounted.delete(id);
  S.board.data.widgets = S.board.data.widgets.filter((w) => w.id !== id);
  $('#empty-hint').classList.toggle('hidden', S.board.data.widgets.length > 0);
  save();
}

// 把小工具放大到至少 size（佔畫面比例），並保持在畫面內
function fitWidget(w, { w: minW = 0, h: minH = 0 } = {}) {
  if (w.w >= minW && w.h >= minH) return;
  w.w = Math.min(1, Math.max(w.w, minW));
  w.h = Math.min(1, Math.max(w.h, minH));
  w.x = Math.max(0, Math.min(w.x, 1 - w.w));
  w.y = Math.max(0, Math.min(w.y, 1 - w.h));
  const el = S.mounted.get(w.id)?.el;
  if (el) place(el, w);
  save();
}

// ------------------------------------------------------------ 學生投票
// 同一時間只有一個投票小工具開放學生投票；投票代碼與手機遙控的代碼不同，學生只能投票
function voteApi(w) {
  const mine = () => S.remote?.poll?.id === w.id;
  return {
    async open(poll) {
      if (relayBase() === LOCAL && !S.remote) toast('正在啟動伺服器…', 1500);
      const r = await ensureRemote();
      if (!r) throw new Error('沒有可用的遙控伺服器，請先在「📱 遙控」完成設定');
      if (r.poll && r.poll.id !== w.id) toast('已結束另一個投票，改為開放這一題');
      r.openPoll({ id: w.id, ...poll });
    },
    update(poll) { if (mine()) S.remote.openPoll({ id: w.id, ...poll }); },
    close() { if (mine()) S.remote.closePoll(); },
    // 目前狀態：null 代表這個小工具沒有開放投票
    info() {
      if (!mine()) return null;
      const r = S.remote;
      return { status: r.status, code: r.voteCode, url: r.voteCode ? r.voteUrl : '', voters: r.voters, local: r.local };
    },
    // 狀態有變化時通知（投票代碼、連線人數、伺服器連線）；回傳取消函式
    watch(fn) {
      window.addEventListener('ms-vote', fn);
      return () => window.removeEventListener('ms-vote', fn);
    },
  };
}

function onStudentVote(m) {
  const poll = S.remote?.poll;
  if (!poll) return { ok: false, text: '老師已經結束投票' };
  const inst = S.mounted.get(poll.id)?.inst;
  if (!inst?.vote) return { ok: false, text: '老師目前沒有開啟這個投票' };
  return inst.vote(m.name, m.choice);
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
      h('button', { title: '放大到全螢幕（雙擊標題列也可以）', 'data-act': 'max' }, '⛶'),
      h('button', { title: '設定', 'data-act': 'settings' }, '⚙'),
      h('button', { title: '複製', 'data-act': 'dup' }, '⧉'),
      h('button', { title: '關閉', 'data-act': 'close' }, '✕')));
  const grip = h('div', { class: 'w-resize', title: '拖曳調整大小' });
  const el = h('div', { class: `widget w-${w.type}`, 'data-id': w.id }, head, body, grip);
  place(el, w);
  $('#stage').append(el);

  const ctx = { state: w.state, widget: w, store: S.store, save: () => save(), push: () => S.remote?.push(), vote: voteApi(w), fit: (size) => fitWidget(w, size), boardName: () => S.board?.name || '' };
  let inst = {};
  try { inst = def.mount(body, ctx) || {}; } catch (e) { console.error(e); body.textContent = '此小工具發生錯誤'; }
  S.mounted.set(w.id, { el, inst, w });
  if (!inst.settings) head.querySelector('[data-act=settings]').remove();

  head.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'max') toggleMax(w.id);
    if (act === 'close') removeWidget(w.id);
    if (act === 'dup') addWidget(w.type, w);
    if (act === 'settings') openSettings(w, def, inst);
  });

  head.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) toggleMax(w.id); });

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
    if (e.button !== 0 || e.target.closest('button') || el.classList.contains('maximized')) return;
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
// ---- 白板操作（上方選單與設定畫面共用）；回傳 true 表示有變更
async function switchBoard(id) {
  if (id === S.board?.id) return false;
  const board = await S.store.getBoard(id).catch((e) => { toast(e.message); return null; });
  if (!board) return false;
  openBoard(board);
  return true;
}
async function newBoardAction() {
  const n = await promptDialog('新白板名稱', '新白板');
  if (!n) return false;
  openBoard(S.store.newBoard(n));
  return true;
}
async function renameBoardAction() {
  const n = await promptDialog('白板名稱', S.board.name);
  if (!n) return false;
  S.board.name = n; renderTopbar(); save(true);
  return true;
}
function copyBoardAction() {
  const b = S.store.newBoard(S.board.name + '（副本）');
  b.data = structuredClone(S.board.data);
  S.store.saveBoard(b, true);
  openBoard(b);
  return true;
}
async function deleteBoardAction() {
  if (!(await confirmDialog(`確定要刪除「${S.board.name}」嗎？刪除後無法復原。`, '刪除', true))) return false;
  await S.store.deleteBoard(S.board.id);
  showBoards();
  return true;
}

function boardMenu(anchor) {
  const items = S.store.index.map((b) => ({
    label: (b.id === S.board.id ? '● ' : '　') + b.name,
    active: b.id === S.board.id,
    onClick: () => switchBoard(b.id),
  }));
  menu(anchor, [{ label: '📋 所有白板…', onClick: () => showBoards() }, '-', ...items, '-',
    { label: '＋ 新增白板', onClick: newBoardAction },
    { label: '✎ 重新命名', onClick: renameBoardAction },
    { label: '⧉ 複製這個白板', onClick: copyBoardAction },
    { label: '🗑 刪除這個白板', danger: true, onClick: deleteBoardAction },
    '-',
    { label: '⚙ 設定…', onClick: () => settingsDialog('board') },
  ]);
}

// ------------------------------------------------------------ 總設定：白板、班級名單、工具列
const SETTING_TABS = [
  { id: 'board', label: '🗂 白板' },
  { id: 'roster', label: '👥 班級名單' },
  { id: 'dock', label: '🧰 工具列' },
  { id: 'poll', label: '📊 投票' },
];

function settingsDialog(tab = 'board') {
  if (!S.store || !S.board) return;
  const side = h('div', { class: 'set-side' });
  const main = h('div', { class: 'set-main' });
  const sec = (title, ...kids) => h('div', { class: 'set-sec' }, h('h4', null, title), ...kids);
  const seg = (opts, value, onPick) => h('div', { class: 'seg' }, opts.map((o) =>
    h('button', { class: o.value === value ? 'on' : '', onclick: () => onPick(o.value) }, o.label)));

  function renderBoardTab() {
    const list = [...S.store.index].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    main.append(
      sec('目前的白板',
        h('div', { class: 'set-item on' }, h('div', { class: 'si-main' }, h('b', null, S.board.name), h('small', null, `${S.board.data.widgets.length} 個小工具`))),
        h('div', { class: 'row-btns' },
          h('button', { class: 'btn', onclick: async () => { if (await renameBoardAction()) render(); } }, '✎ 重新命名'),
          h('button', { class: 'btn', onclick: () => { copyBoardAction(); render(); } }, '⧉ 複製'),
          h('button', { class: 'btn', onclick: () => { dlg.close(); backgroundDialog(); } }, '🎨 背景'),
          h('button', { class: 'btn danger', onclick: async () => { if (await deleteBoardAction()) dlg.close(); } }, '🗑 刪除'))),
      sec('更換白板',
        h('div', { class: 'set-list' }, list.map((b) => h('button', {
          class: 'set-item' + (b.id === S.board.id ? ' on' : ''),
          onclick: async () => { if (await switchBoard(b.id)) render(); },
        }, h('div', { class: 'si-main' }, h('b', null, b.name), h('small', null, fmtTime(b.updatedAt))),
          b.id === S.board.id ? h('small', null, '使用中') : null))),
        h('div', { class: 'row-btns' },
          h('button', { class: 'btn primary', onclick: async () => { if (await newBoardAction()) render(); } }, '＋ 新增白板'))));
  }

  function renderPollTab() {
    const box = h('div', { class: 'poll-lib' });
    main.append(sec('投票題庫與紀錄',
      h('p', { class: 'muted' }, '常用的題目可以存在題庫重複使用，也可以從 Excel、文字一次匯入。學生投票結束時會自動記錄結果，可匯出成 Excel。'),
      box));
    renderPollLibrary(box, S.store, {
      useLabel: '加到白板',
      onUse: (it) => {
        addWidget('poll', null, { state: { question: it.question, options: it.options.map((label) => ({ label, votes: 0 })), ballots: {} } });
        dlg.close();
        toast('已在白板加入這個投票');
      },
    });
  }

  function renderRosterTab() {
    const st = S.store.settings;
    const lists = st?.classLists || [];
    main.append(sec('班級名單',
      h('p', { class: 'muted' }, '抽籤、分組、座位表、課堂加分會使用這裡的名單。可以匯入 Excel／CSV 名單與學生照片。'),
      lists.length
        ? h('div', { class: 'set-list' }, lists.map((l) => h('button', {
          class: 'set-item', onclick: () => rosterDialog(S.store, { selectId: l.id }),
        }, h('div', { class: 'si-main' }, h('b', null, l.name), h('small', null, `${studentsOf(l).length} 人${hasPhotos(l) ? '・有照片' : ''}`)), h('small', null, '編輯 ›'))))
        : h('p', null, '還沒有班級名單。'),
      h('div', { class: 'row-btns' }, h('button', { class: 'btn primary', onclick: () => rosterDialog(S.store) }, '👥 管理班級名單'))));
  }

  function renderDockTab() {
    const ui = S.ui;
    const shown = TOOL_TYPES.length - ui.hidden.length;
    main.append(
      sec('工具列位置',
        seg(DOCK_POSITIONS.map((p) => ({ value: p.value, label: `${p.arrow} ${p.label}` })), ui.dock, (v) => update({ ...ui, dock: v }))),
      sec('工具圖示大小',
        seg(ICON_SIZES, ui.icon, (v) => update({ ...ui, icon: v })),
        h('small', { class: 'muted' }, '在教室大電視上使用時，可以選「大」或「特大」。')),
      sec(`要顯示的工具（${shown} / ${TOOL_TYPES.length}）`,
        h('small', { class: 'muted' }, '點一下切換顯示或隱藏。隱藏的工具不會出現在工具列與手機遙控，已經放在白板上的不受影響。'),
        h('div', { class: 'tool-grid' }, widgetList.map((d) => {
          const on = !ui.hidden.includes(d.type);
          return h('button', {
            class: 'tool-tg' + (on ? ' on' : ''), title: on ? '點一下隱藏' : '點一下顯示',
            onclick: () => {
              const next = toggleTool(ui, d.type, !on, TOOL_TYPES);
              if (next === ui) return toast('至少要顯示一個工具');
              update(next);
            },
          }, toolIcon(d, 'ti'), d.title);
        })),
        h('div', { class: 'row-btns' },
          h('button', { class: 'btn', onclick: () => update({ ...ui, hidden: [] }) }, '全部顯示'),
          h('button', { class: 'btn', onclick: () => update({ ...DEFAULT_UI, hidden: [] }) }, '恢復預設'))));
  }

  function update(next) { setUi(next); render(); }

  function render() {
    side.innerHTML = '';
    for (const t of SETTING_TABS) {
      side.append(h('button', { class: 'set-tab' + (t.id === tab ? ' on' : ''), onclick: () => { tab = t.id; render(); } }, t.label));
    }
    main.innerHTML = '';
    ({ board: renderBoardTab, roster: renderRosterTab, dock: renderDockTab, poll: renderPollTab })[tab]();
  }

  // 名單在名單管理畫面修改後，這裡的人數跟著更新
  const onSettings = () => { if (tab === 'roster') render(); };
  S.store.addEventListener('settings', onSettings);
  S.store.getSettings().then(() => { if (tab === 'roster') render(); });
  render();
  const dlg = modal({ title: '⚙ 設定', body: h('div', { class: 'settings' }, side, main), wide: true,
    actions: [{ label: '完成', primary: true }],
    onClose: () => S.store?.removeEventListener('settings', onSettings) });
  return dlg;
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

async function isFullscreen() {
  if (DESKTOP) return window.Neutralino.window.isFullScreen().catch(() => false);
  return !!document.fullscreenElement;
}
async function setFullscreen(on) {
  try {
    if (DESKTOP) { if (on) await window.Neutralino.window.setFullScreen(); else await window.Neutralino.window.exitFullScreen(); return true; }
    if (on) await document.documentElement.requestFullscreen(); else if (document.fullscreenElement) await document.exitFullscreen();
    return true;
  } catch { return false; } // 手機遙控觸發時瀏覽器不允許全螢幕，小工具仍會填滿視窗
}

// 小工具放大：填滿整個畫面（蓋住工具列），並切換到全螢幕；再按一次或按 Esc 還原
// fromRemote：手機遙控觸發時，網頁版瀏覽器不允許全螢幕（需要在電腦上點擊），只填滿視窗
function toggleMax(id, { fromRemote = false } = {}) {
  const prev = S.maxId && S.mounted.get(S.maxId);
  if (prev) setMaxButton(prev, false);
  if (!id || S.maxId === id) {
    S.maxId = null;
    document.body.classList.remove('has-max');
    if (S.maxFull) { S.maxFull = false; setFullscreen(false); }
  } else {
    const m = S.mounted.get(id);
    if (!m) return;
    S.maxId = id;
    setMaxButton(m, true);
    document.body.classList.add('has-max');
    if (!S.maxFull && (DESKTOP || !fromRemote)) {
      // 原本就是全螢幕時，還原後也維持全螢幕
      isFullscreen().then((full) => {
        if (full || S.maxId !== id) return;
        S.maxFull = true;
        setFullscreen(true).then((ok) => { if (!ok) S.maxFull = false; });
      });
    }
  }
  S.remote?.push();
}
function setMaxButton(m, on) {
  m.el.classList.toggle('maximized', on);
  const b = m.el.querySelector('[data-act=max]');
  if (b) { b.textContent = on ? '🗗' : '⛶'; b.title = on ? '還原大小（Esc）' : '放大到全螢幕（雙擊標題列也可以）'; }
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
// 轉送伺服器（手機與教室電腦之間的中繼，通常架在學校 NAS），優先順序：
//   1. 老師自己設定的（存在 V:\MyScreen\settings.json，換電腦也能用）
//   2. 學校預設：程式資料夾的 myscreen.json（資訊組手動放置，安裝程式不會寫入）
//   3. 建置時寫入的 NL_RELAY
//   4. 桌面版：都沒有設定時，用這台電腦當伺服器（內建的 myscreen-relay.exe，手機要在同一個校內網路）
//   5. 網頁版：提供這個網頁的伺服器
const LOCAL = 'local';
const relayBase = () => (S.relayUser || S.relaySchool || window.NL_RELAY || (DESKTOP ? LOCAL : (S.config ? location.origin : ''))).replace(/\/+$/, '');

// ---- 內建遙控伺服器（桌面版）
// 程式資料夾裡的 myscreen-relay.exe；免安裝版沒有時，從 MyScreen.exe 內嵌的資源解出來
async function relayExePath() {
  const fs = window.Neutralino.filesystem;
  const exists = (p) => fs.getStats(p).then(() => true, () => false);
  const dir = String(window.NL_PATH || '.').replace(/[\\/]+$/, '');
  const beside = dir + '/myscreen-relay.exe';
  const size = (p) => fs.getStats(p).then((s) => s.size, () => -1);
  const embedded = await window.Neutralino.resources.getStats('/resources/myscreen-relay.exe').then((s) => s.size, () => -1);
  // 安裝版：安裝程式放在程式資料夾（防火牆例外也是指定這個位置）
  // 免安裝版：從 MyScreen.exe 內嵌的資源解出來；版本不同時重新解出
  if (await exists(beside) && (embedded < 0 || (await size(beside)) === embedded)) return beside;
  const temp = (await window.Neutralino.os.getPath('temp')) + '/myscreen-relay.exe';
  for (const target of [beside, temp]) {
    try { await window.Neutralino.resources.extractFile('/resources/myscreen-relay.exe', target); return target; } catch { /* 試下一個位置 */ }
  }
  if (await exists(beside)) return beside; // 無法更新（例如正在使用），就用原本的
  throw new Error('找不到內建遙控伺服器（myscreen-relay.exe）');
}

// 啟動內建伺服器，回傳 { port, ips }
function startLocalRelay() {
  if (S.localRelay) return S.localRelay;
  S.localRelay = (async () => {
    const exe = await relayExePath();
    const pid = window.NL_PID ? ` --parent ${window.NL_PID}` : '';
    const proc = await window.Neutralino.os.spawnProcess(`"${exe.replace(/\//g, '\\')}" --port 52480${pid}`);
    return await new Promise((resolve, reject) => {
      let buf = '', all = '', info = null;
      const ipList = (s) => (s ? s.split(',').filter(Boolean) : []);
      const timer = setTimeout(() => reject(new Error('內建遙控伺服器沒有回應')), 8000);
      const onEvt = (e) => {
        const d = e.detail;
        if (d.id !== proc.id) return;
        if (d.action === 'stdOut') {
          all += d.data;
          buf += d.data;
          const lines = buf.split(/\r?\n/);
          buf = lines.pop();
          for (const line of lines) {
            const m = line.match(/^LISTEN (\d+) ?([\d.,]*)/);
            const ips = line.match(/^IPS ?([\d.,]*)/);
            if (m && !info) {
              clearTimeout(timer);
              info = { id: proc.id, port: +m[1], ips: ipList(m[2]) };
              S.relayInfo = info;
              resolve(info);
              updateTray();
            } else if (ips && info) {
              info.ips = ipList(ips[1]);
              onLocalIpsChanged(info);
            }
          }
        } else if (d.action === 'exit') {
          clearTimeout(timer);
          window.Neutralino.events.off('spawnedProcess', onEvt);
          // 伺服器意外結束：下次開啟遙控時重新啟動
          if (S.relayInfo === info) S.relayInfo = null;
          if (S.localRelay && info) { S.localRelay = null; if (S.remote?.local) resetRemote(); }
          updateTray();
          reject(new Error('內建遙控伺服器無法啟動' + (all.includes('ERROR') ? '：' + all.trim() : '')));
        }
      };
      window.Neutralino.events.on('spawnedProcess', onEvt);
    });
  })();
  S.localRelay.catch(() => { S.localRelay = null; updateTray(); });
  updateTray();
  return S.localRelay;
}

async function stopLocalRelay() {
  const p = S.localRelay;
  S.localRelay = null;
  S.relayInfo = null;
  updateTray();
  if (!p) return;
  try { const info = await p; await window.Neutralino.os.updateSpawnedProcess(info.id, 'exit'); } catch { /* 已經結束 */ }
}

// 網路變動後 IP 不同了：QR Code 改用新的 IP（老師選過、而且還在的 IP 優先）
function onLocalIpsChanged(info) {
  S.localIps = info.ips;
  const r = S.remote;
  if (r?.local) {
    const cur = (r.publicBase.match(/\/\/([\d.]+):/) || [])[1];
    if (!info.ips.includes(cur)) {
      const saved = LS.get('ms:remoteIp', '');
      const ip = info.ips.includes(saved) ? saved : info.ips[0];
      r.publicBase = ip ? `http://${ip}:${info.port}` : `http://127.0.0.1:${info.port}`;
    }
    r.dispatchEvent(new Event('change')); // 重畫 QR Code
  }
  updateTray();
}

// ---- 系統匣（桌面版右下角的圖示）：顯示遙控伺服器狀態，可開啟 QR Code 或結束程式
let trayTimer = 0;
function trayStatus() {
  const base = relayBase();
  if (base !== LOCAL) return `遙控伺服器：${base}`;
  const info = S.relayInfo;
  if (!info) return S.localRelay ? '遙控伺服器：啟動中…' : '遙控伺服器：未啟動';
  const pub = S.remote?.local ? S.remote.publicBase.replace(/^https?:\/\//, '') : `${info.ips[0] || '127.0.0.1'}:${info.port}`;
  return `遙控伺服器：執行中（${pub}）`;
}
function updateTray() {
  if (!DESKTOP) return;
  clearTimeout(trayTimer);
  trayTimer = setTimeout(() => {
    const r = S.remote;
    const items = [
      { id: 'status', text: trayStatus(), isDisabled: true },
      ...(r?.status === 'online' ? [{ id: 'count', text: r.remotes ? `${r.remotes} 台手機／平板連線中` : '尚無手機連線', isDisabled: true }] : []),
      { text: '-' },
      { id: 'remote', text: '手機遙控（顯示 QR Code）' },
      { id: 'show', text: '顯示 MyScreen' },
      { text: '-' },
      { id: 'quit', text: '結束 MyScreen（同時關閉遙控伺服器）' },
    ];
    window.Neutralino.os.setTray({ icon: '/resources/icon.png', menuItems: items }).catch(() => {});
  }, 150);
}

async function showWindow() {
  const w = window.Neutralino.window;
  try {
    await w.show();
    if (await w.isMinimized()) await w.unminimize();
    await w.focus();
  } catch { /* ignore */ }
}

// 關閉視窗或從系統匣結束：存檔後關閉遙控伺服器再結束
let quitting = false;
async function quitApp() {
  if (quitting) return;
  quitting = true;
  await S.store?.flushAll().catch(() => {});
  await flushLocalPrefs();
  await stopLocalRelay();
  window.Neutralino.app.exit();
}

function initTray() {
  window.Neutralino.events.on('trayMenuItemClicked', async (e) => {
    const id = e.detail?.id;
    if (id === 'show' || id === 'remote') await showWindow();
    if (id === 'remote') remoteDialog();
    if (id === 'quit') quitApp();
  });
  updateTray();
}

// 讀取安裝程式寫入的學校預設（桌面版）
async function loadSchoolConfig() {
  if (!DESKTOP) return;
  try {
    const dir = String(window.NL_PATH || '.').replace(/[\\/]+$/, '');
    const cfg = JSON.parse(await window.Neutralino.filesystem.readFile(dir + '/myscreen.json'));
    S.relaySchool = normalizeRelay(cfg.relay || '');
  } catch { /* 沒有設定檔 */ }
}

// 「192.168.1.10:8080」→「http://192.168.1.10:8080」
function normalizeRelay(v) {
  v = String(v || '').trim().replace(/\/+$/, '').replace(/\/remote\.html.*$/, '');
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = 'http://' + v;
  try { const u = new URL(v); return u.origin + u.pathname.replace(/\/+$/, ''); } catch { return ''; }
}

// 換伺服器：關掉舊連線，下次開啟遙控時用新的伺服器
function resetRemote() {
  S.remote?.stop();
  S.remote = null;
  window.dispatchEvent(new Event('ms-vote'));
  renderRemoteBtn();
}

// 遙控伺服器設定畫面
function relaySetupDialog(message = '') {
  const input = h('input', { class: 'input', placeholder: '例如：192.168.1.10:8080', value: S.relayUser || '' });
  const school = S.relaySchool || window.NL_RELAY || '';
  const fallback = school ? `學校預設：${school}` : '這台電腦（內建遙控伺服器，不需要 NAS）';
  const dlg = modal({
    title: '📱 設定手機遙控',
    body: h('div', { class: 'stack' },
      message ? h('p', { class: 'err' }, message) : null,
      h('p', null, '預設由這台電腦擔任遙控伺服器，手機只要連上校內網路就能使用。如果學校另外架了遙控伺服器（例如在 NAS 上），可以在這裡填入網址。'),
      h('label', { class: 'field' }, h('span', null, '遙控伺服器網址'), input),
      h('p', { class: 'muted' }, `留空則使用${fallback}。這個設定存在你的個人資料夾（V:\\MyScreen），換到其他電腦也會套用。`)),
    actions: [
      { label: '取消' },
      { label: '儲存', primary: true, onClick: () => {
        const raw = input.value.trim();
        const v = normalizeRelay(raw);
        if (raw && !v) { toast('網址格式不正確'); return false; }
        S.relayUser = v;
        if (S.store) S.store.getSettings().then((st) => { if (v) st.relay = v; else delete st.relay; S.store.saveSettings(); });
        resetRemote();
        setTimeout(remoteDialog, 50);
      } },
    ],
  });
  setTimeout(() => input.focus(), 50);
  return dlg;
}

function remoteState() {
  const b = S.board;
  const list = b ? [...b.data.widgets].sort((x, y) => (x.y - y.y) || (x.x - y.x)) : [];
  return {
    now: Date.now(),
    board: b ? { id: b.id, name: b.name } : null,
    boards: (S.store?.index || []).map((x) => ({ id: x.id, name: x.name })),
    chromeHidden: document.body.classList.contains('chrome-hidden'),
    addable: visibleTools(widgetList, S.ui).filter((d) => ['timer', 'stopwatch', 'names', 'groups', 'seats', 'points', 'text', 'work', 'poll', 'clock'].includes(d.type))
      .map((d) => ({ type: d.type, title: d.title, icon: d.icon })),
    widgets: list.map((w) => {
      const def = widgets[w.type];
      const inst = S.mounted.get(w.id)?.inst;
      let view = null;
      try { view = inst?.remote?.view() ?? null; } catch { /* ignore */ }
      return { id: w.id, type: w.type, title: def?.title || w.type, icon: def?.icon || '', view, max: S.maxId === w.id };
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
    } else if (m.action === 'max' && S.board) {
      toggleMax(S.maxId === args.widgetId ? null : args.widgetId, { fromRemote: true });
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
    if (!(await openExternal(info.href))) {
      // 瀏覽器擋掉沒有點擊動作的彈出視窗，改成在畫面上顯示按鈕
      toast(h('span', null, '手機送來網址：', h('a', { href: info.href, target: '_blank', rel: 'noopener', class: 'toast-link' }, '點這裡開啟')), 15000);
      return S.remote?.notice('瀏覽器擋住了新視窗，請在電腦畫面上點一下「點這裡開啟」');
    }
    return S.remote?.notice('已在教室電腦開啟瀏覽器');
  }
  if (!S.board) return S.remote?.notice('請先在電腦上開啟一個白板');
  // 影片：放在畫面中間、佔大部分空間（直式短影音放成直的）；取代上一個從手機送來的影片，避免兩個一起出聲
  const prev = S.board.data.widgets.find((x) => x.type === 'embed' && x.state?.fromRemote);
  const pos = info.portrait ? { x: 0.34, y: 0.05, w: 0.32, h: 0.86 } : { x: 0.12, y: 0.08, w: 0.76, h: 0.8 };
  if (prev) removeWidget(prev.id);
  const w = addWidget('embed', null, { ...pos, state: { url: info.href, autoplay: true, fromRemote: true } });
  const platform = PLATFORMS[info.platform]?.name;
  S.remote?.notice(info.kind === 'youtube' ? '已在白板上播放 YouTube 影片'
    : platform ? `已在白板上顯示 ${platform} 影片，請在電視上點播放` : '已在白板上播放影片');
  return w;
}

const isLoopback = (host) => host === 'localhost' || host.startsWith('127.') || host === '[::1]';

async function ensureRemote() {
  const base = relayBase();
  if (!base) return null;
  if (S.remote && S.remote.local !== (base === LOCAL)) resetRemote();
  if (!S.remote) {
    let opts = { getState: remoteState, onCmd: remoteCmd, onVote: onStudentVote }, wsBase = base;
    if (base === LOCAL) {
      const info = await startLocalRelay();
      wsBase = `http://127.0.0.1:${info.port}`;
      S.localIps = info.ips;
      const ip = info.ips.includes(LS.get('ms:remoteIp', '')) ? LS.get('ms:remoteIp', '') : info.ips[0];
      opts.publicBase = ip ? `http://${ip}:${info.port}` : wsBase;
    } else {
      // 用 localhost 開啟網頁版時，手機要改用伺服器的校內 IP 才連得到
      const u = new URL(base);
      const lan = S.config?.lanIps || [];
      if (isLoopback(u.hostname) && lan.length) {
        const ip = lan.includes(LS.get('ms:remoteIp', '')) ? LS.get('ms:remoteIp', '') : lan[0];
        opts.publicBase = `${u.protocol}//${ip}${u.port ? ':' + u.port : ''}`;
        opts.lanIps = lan;
      }
    }
    if (S.remote) return S.remote; // 等待期間已經建立
    S.remote = new RemoteHost(wsBase, opts);
    S.remote.local = base === LOCAL;
    S.remote.lanIps = opts.lanIps || null;
    S.remote.addEventListener('change', renderRemoteBtn);
    const voteChanged = () => window.dispatchEvent(new Event('ms-vote'));
    S.remote.addEventListener('vote', voteChanged);
    S.remote.addEventListener('change', voteChanged);
    S.remote.addEventListener('joined', () => toast('📱 遙控裝置已連線'));
    S.remote.start();
  }
  return S.remote;
}

function renderRemoteBtn() {
  const btn = $('#remote-btn');
  btn.classList.toggle('hidden', !relayBase() && !DESKTOP);
  const r = S.remote;
  const n = r?.status === 'online' ? r.remotes : 0;
  btn.querySelector('.tb-label').textContent = n ? `遙控中（${n}）` : '遙控';
  btn.classList.toggle('active', n > 0);
  updateTray();
}

async function remoteDialog() {
  if (S.remoteDlg) return; // 已經開著（例如從系統匣再點一次）
  S.remoteDlg = true;
  try { await openRemoteDialog(); } finally { if (S.remoteDlg === true) S.remoteDlg = null; }
}

async function openRemoteDialog() {
  let r;
  if (relayBase() === LOCAL && !S.remote) toast('正在啟動遙控伺服器…', 1500);
  try { r = await ensureRemote(); } catch (e) { return relaySetupDialog(e.message); }
  if (!r) return relaySetupDialog();
  const box = h('div', { class: 'remote-box' });
  const render = () => {
    box.innerHTML = '';
    if (r.status !== 'online') {
      box.append(h('div', { class: 'remote-wait' }, r.status === 'error'
        ? [h('div', null, `無法連線到遙控伺服器（${r.local ? '這台電腦' : r.base}），正在重試…`),
          h('div', { class: 'muted' }, r.local ? '內建遙控伺服器沒有回應，請關閉 MyScreen 後重新開啟。' : '請確認網址正確、這台電腦連得到學校 NAS。'),
          h('button', { class: 'btn', onclick: () => { dlg.close(); relaySetupDialog(); } }, '⚙ 更改遙控伺服器')]
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
    // 電腦有多個網路位址時（例如同時接有線和無線），可以切換 QR Code 用的位址
    const port = r.publicBase.split(':').pop();
    const ips = r.local ? (S.localIps || []) : (r.lanIps || []);
    const ipSwitch = ips.length > 1 ? h('div', { class: 'remote-ips' }, h('span', { class: 'muted' }, '手機連不上時，可改用其他網址：'),
      ips.map((ip) => h('button', { class: 'chip' + (r.publicBase.includes('//' + ip + ':') ? ' on' : ''), onclick: () => {
        LS.set('ms:remoteIp', ip); r.publicBase = r.publicBase.replace(/\/\/[^/:]+/, '//' + ip); render(); updateTray();
        window.dispatchEvent(new Event('ms-vote')); // 投票的 QR Code 也跟著換
      } }, ip))) : null;
    box.append(
      qr,
      h('div', { class: 'remote-info' },
        h('div', { class: 'muted' }, '用手機或平板掃描 QR Code，或開啟下方網址並輸入代碼'),
        h('div', { class: 'remote-code' }, r.code.slice(0, 3) + ' ' + r.code.slice(3)),
        h('div', { class: 'remote-url' }, `${r.publicBase}/remote.html`),
        ipSwitch,
        r.local ? h('div', { class: 'muted remote-tip' }, '由這台電腦擔任遙控伺服器：手機要連上校內網路。若一直連不上，可能被 Windows 防火牆擋住，請資訊組協助（安裝時勾選「允許手機連線」）。') : null,
        h('div', { class: 'remote-count' }, r.remotes ? `📱 目前有 ${r.remotes} 台裝置連線` : '尚無裝置連線'),
        h('div', { class: 'row-btns' },
          h('button', { class: 'btn danger', onclick: () => { r.kick(); toast('已中斷所有遙控裝置，並更換新代碼'); } }, '中斷全部並換代碼'),
          DESKTOP ? h('button', { class: 'linkbtn', onclick: () => { dlg.close(); relaySetupDialog(); } }, '⚙ 遙控伺服器設定') : null)));
  };
  render();
  // 手機連上後自動關閉，讓電視畫面回到白板
  const onJoin = () => setTimeout(() => dlg.close(), 800);
  r.addEventListener('change', render);
  r.addEventListener('joined', onJoin);
  const dlg = modal({ title: '📱 手機遙控', body: box, wide: true, actions: [{ label: '完成', primary: true }],
    onClose: () => { S.remoteDlg = null; r.removeEventListener('change', render); r.removeEventListener('joined', onJoin); } });
  S.remoteDlg = dlg;
}

// ------------------------------------------------------------ 綁定
$('#board-btn').addEventListener('click', (e) => boardMenu(e.currentTarget));
$('#roster-btn').addEventListener('click', () => S.store && rosterDialog(S.store));
$('#settings-btn').addEventListener('click', () => settingsDialog());
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
  if (e.key === 'Escape' && S.maxId && !document.querySelector('#modal-root .m-wrap')) { toggleMax(null); return; }
  if (e.target.closest('input,textarea,[contenteditable]')) return;
  if (e.key === 'h' || e.key === 'H') { document.body.classList.toggle('chrome-hidden'); S.remote?.push(); }
  if (e.key === 'f' || e.key === 'F') toggleFullscreen();
});
window.addEventListener('beforeunload', (e) => {
  if (S.store?.pending.size) { e.preventDefault(); e.returnValue = ''; }
});

boot();
