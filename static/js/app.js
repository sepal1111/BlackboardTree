// MyScreen 主程式：登入、白板、拖曳縮放、工具列、背景
import { api } from './api.js';
import { Store, LS, uid } from './store.js';
import { widgets, widgetList } from './widgets/index.js';
import { h, toast, modal, menu, promptDialog, confirmDialog, pickImage, imageSrc } from './ui.js';

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

const $ = (s) => document.querySelector(s);
const S = { store: null, board: null, mounted: new Map(), config: null, user: null, pollTimer: null, settingsModal: null };

// ------------------------------------------------------------ 啟動與登入
async function boot() {
  S.config = await api.get('/api/config').catch(() => null);
  if (!S.config) return startApp(null, true); // 直接開啟檔案或伺服器離線
  const me = await api.get('/api/me', { quiet401: true }).catch(() => null);
  if (me?.username) return startApp(me.username, false);
  if (LS.get('ms:guest', false)) return startApp(null, true);
  showLogin();
}

function showLogin(message) {
  $('#app').classList.add('hidden');
  const box = $('#login');
  box.classList.remove('hidden');
  const user = h('input', { class: 'input', placeholder: S.config?.mode === 'smb' ? 'SAMBA 帳號' : '名稱（例如：王老師）', autocomplete: 'username', value: LS.get('ms:lastUser', '') });
  const pass = h('input', { class: 'input', type: 'password', placeholder: '密碼', autocomplete: 'current-password' });
  const err = h('div', { class: 'login-err' }, message || '');
  const btn = h('button', { class: 'btn primary big', type: 'submit' }, '登入');
  const form = h('form', { class: 'login-card', onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true; btn.textContent = '連線中…'; err.textContent = '';
    try {
      const r = await api.post('/api/login', { username: user.value.trim(), password: pass.value }, { quiet401: true });
      LS.set('ms:lastUser', user.value.trim());
      LS.del('ms:guest');
      startApp(r.username, false);
    } catch (ex) {
      err.textContent = ex.message;
    } finally { btn.disabled = false; btn.textContent = '登入'; }
  } },
  h('div', { class: 'logo' }, h('span', null, '▣'), ' MyScreen'),
  h('p', { class: 'muted' }, S.config?.mode === 'smb'
    ? `使用學校 SAMBA 帳號登入，白板會儲存在你的個人資料夾（${S.config.server}），換電腦也能接著用。`
    : '輸入名稱登入，白板會儲存在這台伺服器上，其他裝置登入同一名稱即可同步。'),
  user, S.config?.needsPassword ? pass : null, err, btn,
  h('button', { class: 'linkbtn', type: 'button', onclick: () => { LS.set('ms:guest', true); startApp(null, true); } }, '先不登入，只在這台裝置使用'));
  box.innerHTML = '';
  box.append(form);
  setTimeout(() => (user.value ? pass : user).focus(), 50);
}

window.addEventListener('ms:unauthorized', () => {
  if (S.store && !S.store.guest) {
    stopPolling();
    showLogin('登入已過期，請重新登入（尚未同步的變更已保留在這台裝置）');
  }
});

async function startApp(user, guest) {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  S.user = user;
  S.store = new Store(user, guest);
  S.store.addEventListener('status', renderStatus);
  S.store.addEventListener('index', renderTopbar);
  S.store.addEventListener('error', (e) => toast(e.detail, 4000));
  S.store.addEventListener('remote', (e) => {
    const b = e.detail.board;
    if (S.board && b.id === S.board.id) {
      S.board = b;
      renderBoard();
      toast(e.detail.conflict ? '這個白板剛在其他裝置被修改，已載入最新版本' : '已同步其他裝置的修改');
    }
  });
  S.store.addEventListener('deleted', async () => {
    toast('這個白板已在其他裝置刪除');
    await openFirstBoard();
  });
  try {
    await S.store.listBoards();
  } catch { return; }
  await openFirstBoard(LS.get(S.store.key('last'), null));
  renderDock();
  renderStatus();
  stopPolling();
  if (!guest) S.pollTimer = setInterval(() => S.store.poll(S.board), 8000);
}

function stopPolling() { clearInterval(S.pollTimer); S.pollTimer = null; }
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.pollTimer) S.store.poll(S.board); });

async function openFirstBoard(preferId) {
  const idx = S.store.index;
  const id = (preferId && idx.find((b) => b.id === preferId)) ? preferId : idx[0]?.id;
  let board = id ? await S.store.getBoard(id).catch(() => null) : null;
  if (!board) board = S.store.newBoard('我的白板');
  openBoard(board);
}

function openBoard(board) {
  S.board = board;
  board.data ||= {};
  board.data.widgets ||= [];
  LS.set(S.store.key('last'), board.id);
  renderBoard();
}

const save = (immediate) => S.store.saveBoard(S.board, immediate);

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
}

function applyBackground() {
  const bg = S.board.data.background || { type: 'preset', value: 'sky' };
  const stage = $('#stage');
  stage.style.background = '';
  if (bg.type === 'preset') stage.style.background = BG_PRESETS[bg.value] || BG_PRESETS.sky;
  else if (bg.type === 'color') stage.style.background = bg.value;
  else if (bg.type === 'image') {
    stage.style.background = `#333 url("${imageSrc(bg.ref).replace(/"/g, '%22')}") center / ${bg.fit || 'cover'} no-repeat`;
  }
  const dark = ['ocean', 'forest', 'night', 'chalk', 'dark'].includes(bg.value) || bg.type === 'image';
  stage.classList.toggle('dark-bg', dark);
}

function renderStatus() {
  const el = $('#sync');
  if (!S.store) return;
  if (S.store.guest) { el.textContent = '📱 僅存在此裝置'; el.className = 'pill warn'; el.title = '登入後才能跨裝置同步'; return; }
  const map = { synced: ['☁️ 已同步', 'pill ok'], saving: ['⏳ 儲存中…', 'pill'], offline: ['⚠️ 離線，稍後重試', 'pill warn'] };
  const [t, c] = map[S.store.status] || map.synced;
  el.textContent = t; el.className = c;
  el.title = `已登入：${S.user}`;
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

function addWidget(type, copyFrom) {
  const def = widgets[type];
  const n = S.board.data.widgets.length;
  const w = copyFrom
    ? { ...structuredClone(copyFrom), id: uid(), x: Math.min(copyFrom.x + 0.02, 1 - copyFrom.w), y: Math.min(copyFrom.y + 0.03, 0.9), z: maxZ() + 1 }
    : {
      id: uid(), type, z: maxZ() + 1, w: def.size.w, h: def.size.h,
      x: Math.max(0, 0.5 - def.size.w / 2 + ((n % 6) - 2.5) * 0.03),
      y: Math.max(0.07, 0.42 - def.size.h / 2 + ((n % 6) - 2.5) * 0.03),
      state: def.state(),
    };
  S.board.data.widgets.push(w);
  mountWidget(w);
  $('#empty-hint').classList.add('hidden');
  save();
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

  const ctx = { state: w.state, widget: w, store: S.store, save: () => save() };
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
  menu(anchor, [...items, '-',
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
      await openFirstBoard();
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
        } }, S.store.guest ? '🖼 使用圖片' : '🖼 從我的 SAMBA 選圖片'))),
    actions: [{ label: '完成', primary: true }],
  });
}

function userMenu(anchor) {
  const items = [];
  if (S.store.guest) {
    items.push({ label: '🔑 登入以跨裝置同步', onClick: () => { LS.del('ms:guest'); if (S.config) showLogin(); else toast('找不到伺服器'); } });
  } else {
    items.push({ label: `👤 ${S.user}`, onClick: () => {} });
    items.push({ label: '🔄 立即同步', onClick: () => S.store.poll(S.board).then(() => toast('已檢查更新')) });
    items.push('-');
    items.push({ label: '登出', onClick: async () => {
      if (S.store.hasLocalChanges(S.board.id)) await S.store.flush(S.board.id);
      await api.post('/api/logout').catch(() => {});
      stopPolling();
      for (const m of S.mounted.values()) m.inst.destroy?.();
      S.mounted.clear();
      showLogin();
    } });
  }
  menu(anchor, items);
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => toast('瀏覽器不允許全螢幕'));
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
$('#hide-btn').addEventListener('click', () => document.body.classList.toggle('chrome-hidden'));
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input,textarea,[contenteditable]')) return;
  if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('chrome-hidden');
  if (e.key === 'f' || e.key === 'F') toggleFullscreen();
});
window.addEventListener('beforeunload', (e) => {
  if (S.store && !S.store.guest && S.store.pending.size) { e.preventDefault(); e.returnValue = ''; }
});

boot();
