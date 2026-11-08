// 黑板樹手機遙控頁：掃描電視上的 QR Code 後開啟
import { h } from './ui.js';
import { fmtDuration, pad, fmtHM, examStatus, fmtSeats } from './widgets/util.js';
import { seal, open, newPair, unwrapKey, parseHash, KEY_RE } from './remote-crypto.js';

const $ = (s) => document.querySelector(s);
let ws = null;
let code = '';
let state = null;
let offset = 0;          // 教室電腦時鐘 − 手機時鐘
let online = false;
let stopped = false;
let retry = 0;
let wasOnline = false; // 曾經連上過：教室電腦重開黑板樹時會自動重新連線
let errRetry = 0;
const cards = new Map(); // widgetId -> { el, key }

// 這台手機的識別碼：老師允許過之後，斷線重連不用再問（換代碼後要重新允許）
function deviceKey() {
  try {
    let k = localStorage.getItem('bt:remoteKey');
    if (!/^[\w-]{16,64}$/.test(k || '')) {
      const b = crypto.getRandomValues(new Uint8Array(18));
      k = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      localStorage.setItem('bt:remoteKey', k);
    }
    return k;
  } catch { return ''; }
}
const myKey = deviceKey();
let waiting = false; // 等老師允許中：不送指令
let key = '';          // 這組代碼的加密金鑰（QR Code 網址裡，或老師允許時交換取得）
let pair = null;       // 手動輸入代碼、沒有金鑰時的一次性金鑰對

// 記住最近一組代碼的金鑰：重新整理、斷線重連時不用再交換
function savedKey(c) {
  try { const v = JSON.parse(localStorage.getItem('bt:remoteK') || 'null'); return v && v.code === c && KEY_RE.test(v.key || '') ? v.key : ''; } catch { return ''; }
}
function saveKey(c, k) {
  try { localStorage.setItem('bt:remoteK', JSON.stringify({ code: c, key: k })); } catch { /* 無痕模式等存不了也沒關係 */ }
}

// ------------------------------------------------------------ 連線
function start() {
  const fromHash = parseHash(location.hash);
  if (fromHash.code) {
    if (fromHash.key) saveKey(fromHash.code, fromHash.key);
    return connect(fromHash.code);
  }
  showJoin();
}

function showJoin(err = '') {
  $('#main').classList.add('hidden');
  $('#join').classList.remove('hidden');
  $('#join-err').textContent = err;
  setTimeout(() => $('#join-code').focus(), 50);
}

$('#join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const c = $('#join-code').value.replace(/\D/g, '');
  if (c.length !== 6) { $('#join-err').textContent = '代碼是 6 位數字'; return; }
  history.replaceState(null, '', '#' + c);
  stopped = false;
  wasOnline = false;
  connect(c);
});

function connect(c) {
  code = c;
  key = savedKey(c);
  // 沒有金鑰（手動輸入代碼）：帶一次性公鑰，老師允許時交換金鑰
  if (!key && !pair) pair = newPair();
  $('#join').classList.add('hidden');
  $('#main').classList.remove('hidden');
  setConn('連線中…', '');
  const sock = new WebSocket(location.origin.replace(/^http/, 'ws') + '/ws/remote?code=' + c + (myKey ? '&key=' + myKey : '') + (key ? '' : '&pk=' + pair.publicKey));
  ws = sock;
  sock.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'error') {
      // 教室電腦重新開啟黑板樹時，代碼要等幾秒才會恢復，先不要放棄
      if (wasOnline && errRetry < 8) { errRetry++; setConn('等待教室電腦…', 'bad'); return; }
      stopped = true; showJoin(m.message);
    }
    else if (m.type === 'wait') { waiting = true; setConn('請老師在電視上按「允許」…', 'wait'); }
    else if (m.type === 'kicked') { stopped = true; showJoin('老師已中斷遙控連線，請重新掃描電視上的 QR Code'); }
    else if (m.type === 'hello') {
      if (!key && m.key) { key = unwrapKey(m.key, pair); if (key) { saveKey(c, key); pair = null; } }
      if (!key) { stopped = true; sock.close(); showJoin('無法建立加密連線，請掃描電視上的 QR Code'); return; }
      waiting = false; retry = 0; errRetry = 0; wasOnline = true; online = m.online;
      const st = m.state ? open(m.state, key) : null; // 剛換代碼時可能還是舊的內容，解不開就等下一次
      if (st) setState(st);
      updateConn();
    }
    else if (m.type === 'screen') { online = m.online; updateConn(); }
    else if (m.type === 'state') {
      const st = open(m.state, key);
      if (!st) { setConn('無法解密，請重新掃描 QR Code', 'bad'); return; }
      online = true; setState(st); updateConn();
    }
    else if (m.type === 'notice') {
      // 教室電腦的提示有加密（box）；遙控伺服器自己的提示（例如「教室電腦目前沒有連線」）沒有
      const text = m.box ? open(m.box, key)?.text : m.text;
      if (text) toast(String(text));
    }
  };
  sock.onclose = () => {
    if (ws !== sock || stopped) return;
    setConn('重新連線…', 'bad');
    retry = Math.min(retry + 1, 5);
    setTimeout(() => { if (!stopped && ws === sock) connect(code); }, 800 * retry);
  };
}

function setConn(text, cls) { const el = $('#conn'); el.textContent = text; el.className = 'conn ' + cls; }
function updateConn() { if (online) setConn('● 已連線', 'ok'); else setConn('教室電腦離線', 'bad'); }

function send(target, action, args = {}, widgetId) {
  if (ws?.readyState !== 1) return toast('尚未連線');
  if (waiting) return toast('請先等老師在電視上按「允許」');
  if (!key) return toast('尚未建立加密連線');
  ws.send(JSON.stringify({ type: 'cmd', box: seal({ target, action, args, widgetId }, key) }));
  navigator.vibrate?.(8);
}
const wcmd = (w, action, args) => send('widget', action, args, w.id);

let toastT;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 2200);
}

document.addEventListener('visibilitychange', () => {
  // 手機鎖屏後連線常被切斷，回到畫面時立即重連
  if (!document.hidden && !stopped && code && (!ws || ws.readyState > 1)) connect(code);
});

// ------------------------------------------------------------ 畫面
function setState(s) {
  state = s;
  offset = (s.now || Date.now()) - Date.now();
  renderHeader();
  renderCards();
}

function renderHeader() {
  const sel = $('#board-select');
  sel.innerHTML = '';
  if (!state.board) sel.append(h('option', { value: '' }, '（電腦上尚未開啟白板）'));
  for (const b of state.boards || []) {
    const o = h('option', { value: b.id }, b.name);
    if (state.board?.id === b.id) o.selected = true;
    sel.append(o);
  }
  const add = $('#add-select');
  add.innerHTML = '';
  add.append(h('option', { value: '' }, '＋ 加入小工具'));
  for (const a of state.addable || []) add.append(h('option', { value: a.type }, `${a.icon} ${a.title}`));
  add.disabled = !state.board;
  $('#btn-chrome').textContent = state.chromeHidden ? '👁 顯示工具列' : '🙈 隱藏工具列';
}

$('#board-select').addEventListener('change', (e) => e.target.value && send('app', 'board', { id: e.target.value }));
$('#add-select').addEventListener('change', (e) => {
  if (e.target.value) send('app', 'add', { type: e.target.value });
  e.target.value = '';
});
$('#btn-chrome').addEventListener('click', () => send('app', 'chrome'));
$('#btn-fs').addEventListener('click', () => send('app', 'fullscreen'));

// 傳送網址：YouTube／影片會在白板上播放，其他網址在教室電腦開啟瀏覽器
const isUrl = (t) => /^https?:\/\/\S+$/i.test(t);
function fixUrl(t) {
  t = String(t || '').trim();
  const m = t.match(/https?:\/\/\S+/i); // 從分享的文字中找出網址
  if (m) return m[0];
  if (/^(www\.|youtu\.be\/|youtube\.com\/)\S+$/i.test(t)) return 'https://' + t;
  return t;
}
const urlCard = (() => {
  const input = h('input', { type: 'url', class: 'url-input', placeholder: '貼上網址（YouTube、FB、IG、Threads、網頁）', enterkeyhint: 'send', autocomplete: 'off' });
  const go = () => {
    const url = fixUrl(input.value);
    if (!isUrl(url)) return toast('請貼上 http:// 或 https:// 開頭的網址');
    send('app', 'url', { url });
    input.value = '';
    input.blur();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  // 貼上網址就直接送出
  input.addEventListener('paste', () => setTimeout(() => { if (isUrl(fixUrl(input.value))) go(); }, 0));
  const pasteBtn = h('button', { class: 'primary', onclick: async () => {
    if (input.value.trim()) return go();
    try {
      input.value = await navigator.clipboard.readText();
      go();
    } catch { input.focus(); toast('請長按輸入框，選「貼上」'); }
  } }, '📋 貼上並開啟');
  return h('section', { class: 'card url-card' },
    h('div', { class: 'card-title' }, '🔗 傳送網址到電視'),
    h('div', { class: 'url-row' }, input, pasteBtn),
    h('div', { class: 'muted' }, 'YouTube、Facebook、Instagram、Threads、TikTok 的影片或影片檔會顯示在白板上；其他網址會在教室電腦開啟瀏覽器。'));
})();

function renderCards() {
  const main = $('#cards');
  main.prepend(urlCard);
  const list = state.widgets || [];
  const ids = new Set(list.map((w) => w.id));
  for (const [id, c] of cards) if (!ids.has(id)) { c.el.remove(); cards.delete(id); }
  main.querySelector(':scope > .empty')?.remove();
  if (!state.board) main.append(h('div', { class: 'empty' }, '請在教室電腦上選擇白板，或從上方選單切換。'));
  else if (!list.length) main.append(h('div', { class: 'empty' }, '白板上還沒有小工具，可以從下方「加入小工具」新增。'));
  for (const w of list) {
    const key = JSON.stringify(w.view);
    let c = cards.get(w.id);
    if (!c) { c = { el: h('section', { class: 'card' }), key: null }; cards.set(w.id, c); }
    // 正在輸入文字時不要重畫，避免打字被打斷
    const typing = document.activeElement?.tagName === 'TEXTAREA' && c.el.contains(document.activeElement);
    if (c.key !== key && !typing) {
      c.key = key;
      c.el.innerHTML = '';
      c.el.append(cardHead(w), ...(RENDER[w.type] || renderOther)(w));
    }
    main.append(c.el); // 依白板上的位置排序
  }
}

function cardHead(w) {
  return h('div', { class: 'card-head' },
    h('span', { class: 'card-title' }, `${w.icon} ${w.title}`),
    h('button', { class: 'card-max' + (w.max ? ' on' : ''), title: w.max ? '還原大小' : '在電視上放大到全螢幕', onclick: () => send('app', 'max', { widgetId: w.id }) }, w.max ? '🗗 還原' : '⛶ 放大'),
    h('button', { class: 'card-x', title: '從白板移除', onclick: () => { if (confirm(`要從白板移除「${w.title}」嗎？`)) send('app', 'close', { widgetId: w.id }); } }, '✕'));
}

const now = () => Date.now() + offset;
const btn = (label, onclick, cls = '') => h('button', { class: cls, onclick }, label);

// 每秒更新倒數／碼錶顯示
const tickers = new Set();
setInterval(() => tickers.forEach((f) => (f.isConnected ? f.tick() : tickers.delete(f))), 250);
function ticker(el, fn) { el.tick = () => fn(el); fn(el); tickers.add(el); return el; }

const RENDER = {
  timer(w) {
    const v = w.view || {};
    const running = !!v.endAt;
    const time = ticker(h('div', { class: 'big-text' }), (el) => {
      const left = running ? (v.endAt - now()) / 1000 : v.remaining;
      el.textContent = fmtDuration(left);
      el.classList.toggle('done', running && left <= 0);
    });
    return [time,
      h('div', { class: 'row' }, btn('−1 分', () => wcmd(w, 'add', { sec: -60 })), btn(running ? '暫停' : '開始', () => wcmd(w, 'toggle'), 'primary big'), btn('+1 分', () => wcmd(w, 'add', { sec: 60 }))),
      h('div', { class: 'chips' }, [1, 3, 5, 10, 15].map((m) => btn(`${m} 分`, () => wcmd(w, 'set', { sec: m * 60 }))), btn('↺ 重設', () => wcmd(w, 'reset')))];
  },
  exam(w) {
    const v = w.view || {};
    // 依手機的時間（已校正為教室電腦的時間）計算，和電視上的倒數一致
    const box = ticker(h('div', { class: 'exam-card' }), (el) => {
      const st = examStatus(v.sessions, new Date(now()));
      const x = st.session;
      const warn = st.phase === 'during' && v.warn > 0 && st.left <= v.warn * 60;
      const label = { empty: '還沒有設定考試，請在教室電腦按 ⚙ 設定', during: '距離考試結束', ended: '考試結束，請停筆', before: st.first ? '距離考試開始' : '下一節考試開始還有', done: '今天的考試都結束了' }[st.phase];
      el.replaceChildren(...[ // replaceChildren 會把 null 變成文字「null」，所以先濾掉
        v.title ? h('div', { class: 'muted', style: { textAlign: 'center' } }, v.title) : null,
        x && st.phase !== 'done' ? h('div', { class: 'name' }, x.subject || '考試') : null,
        x && st.phase !== 'done' ? h('div', { class: 'muted', style: { textAlign: 'center' } }, `${fmtHM(x.s)} – ${fmtHM(x.e)}`) : null,
        h('div', { style: { textAlign: 'center', fontWeight: 700 } }, label),
        st.phase === 'during' || st.phase === 'before' ? h('div', { class: 'big-text' + (warn ? ' done' : '') }, fmtDuration(st.left)) : null,
        st.list.length ? h('div', { class: 'exam-list' }, st.list.map((y) => h('div', { class: y === x && st.phase !== 'done' ? 'on' : '' }, `${fmtHM(y.s)}–${fmtHM(y.e)}　${y.subject || '考試'}`))) : null].filter(Boolean));
    });
    // 人數統計：點座號標記／取消缺考
    const seats = v.seats || [];
    const absent = new Set(v.absent || []);
    const att = seats.length ? h('div', { class: 'exam-att-card' },
      h('div', { class: 'att-line' },
        h('span', null, '應到 ', h('b', null, seats.length)),
        h('span', null, '實到 ', h('b', null, seats.length - absent.size)),
        h('span', { class: absent.size ? 'miss' : '' }, '缺考 ', h('b', null, absent.size), ' 人')),
      absent.size ? h('div', { class: 'att-miss' }, '缺考座號：', h('b', null, fmtSeats([...absent].sort((a, b) => a - b)))) : null,
      h('div', { class: 'muted' }, '點座號標記缺考，再點一下取消'),
      h('div', { class: 'seat-pick' }, seats.map((no) => btn(String(no), () => wcmd(w, 'absent', { no }), 'seat-chip' + (absent.has(no) ? ' off' : '')))),
      absent.size ? btn('全部到考', () => wcmd(w, 'allPresent')) : null) : null;
    return [box, h('div', { class: 'row' },
      btn('延長 5 分鐘', () => wcmd(w, 'extend', { min: 5 })), btn('延長 10 分鐘', () => wcmd(w, 'extend', { min: 10 }))), att];
  },
  stopwatch(w) {
    const v = w.view || {};
    const time = ticker(h('div', { class: 'big-text' }), (el) => {
      const ms = (v.elapsed || 0) + (v.startAt ? now() - v.startAt : 0);
      el.textContent = `${fmtDuration(Math.floor(ms / 1000) - 0.0001)}.${pad(Math.floor((ms % 1000) / 10))}`;
    });
    return [time, h('div', { class: 'row' },
      btn(v.startAt ? '暫停' : (v.elapsed ? '繼續' : '開始'), () => wcmd(w, 'toggle'), 'primary big'),
      btn('分段', () => wcmd(w, 'lap')), btn('歸零', () => wcmd(w, 'reset')))];
  },
  names(w) {
    const v = w.view || {};
    return [
      v.photo ? h('img', { class: 'stu-photo', src: v.photo, alt: '' }) : null,
      h('div', { class: 'name' + (v.current && !v.picking ? '' : ' ph') }, v.picking ? '抽籤中…' : (v.current || (v.total ? '準備好了嗎？' : '這一班還沒有學生名單'))),
      h('div', { class: 'muted', style: { textAlign: 'center' } }, v.total ? `剩下 ${v.left} / ${v.total} 人` : ''),
      h('div', { class: 'row' }, btn('🎲 抽一位', () => wcmd(w, 'pick'), 'primary big'), btn('↺ 重置', () => wcmd(w, 'reset')))];
  },
  groups(w) {
    const v = w.view || {};
    return [
      h('div', { class: 'groups' }, (v.groups || []).length
        ? v.groups.map((g, i) => h('div', null, h('b', null, `第 ${i + 1} 組：`), g.join('、')))
        : h('span', { class: 'muted' }, v.total ? '尚未分組' : '這一班還沒有學生名單')),
      btn('🔀 隨機分組', () => wcmd(w, 'shuffle'), 'primary big')];
  },
  work(w) {
    const v = w.view || {};
    return [h('div', { class: 'modes' }, (v.modes || []).map((m) =>
      h('button', { class: m.k === v.mode ? 'on' : '', onclick: () => wcmd(w, 'set', { mode: m.k }) }, h('span', null, m.e), m.l)))];
  },
  poll(w) {
    const v = w.view || {};
    const opts = v.options || [];
    const total = opts.reduce((a, o) => a + o.votes, 0);
    const max = Math.max(1, ...opts.map((o) => o.votes));
    return [h('div', { class: 'card-title' }, v.question || ''),
      ...opts.map((o, i) => h('div', { class: 'opt' },
        h('button', { class: 'vote', onclick: () => wcmd(w, 'vote', { i }) }, h('i', { style: { width: (o.votes / max) * 100 + '%' } }),
          h('span', null, `${o.label}　${o.votes}${total ? `（${Math.round((o.votes / total) * 100)}%）` : ''}`)),
        btn('−', () => wcmd(w, 'unvote', { i }), 'minus'))),
      btn('票數歸零', () => wcmd(w, 'reset'))];
  },
  seats(w) {
    const v = w.view || {};
    const cols = v.cols || 1;
    let order = (v.seats || []).map((_, i) => i);
    if (v.flip) order.reverse();
    const desk = h('div', { class: 'seat-desk' }, '講台');
    const grid = h('div', { class: 'seat-grid', style: { gridTemplateColumns: `repeat(${cols}, 1fr)` } },
      order.map((i) => h('button', {
        class: 'seat-cell' + (v.seats[i] ? '' : ' vacant') + (i === v.highlight ? ' hl' : ''),
        'data-i': i,
        onclick: (e) => {
          const sel = grid.querySelector('.sel');
          if (!sel) { e.currentTarget.classList.add('sel'); return; }
          sel.classList.remove('sel');
          if (sel !== e.currentTarget) wcmd(w, 'swap', { a: +sel.dataset.i, b: i });
        },
      }, v.seats[i] || '')));
    const name = v.highlight >= 0 && !v.picking ? v.seats[v.highlight] : '';
    return [
      v.photo && name ? h('img', { class: 'stu-photo', src: v.photo, alt: '' }) : null,
      name ? h('div', { class: 'name' }, name) : h('div', { class: 'muted', style: { textAlign: 'center' } }, '點一個座位，再點另一個座位即可交換'),
      ...(v.flip ? [grid, desk] : [desk, grid]),
      h('div', { class: 'row' }, btn('🎯 隨機點名', () => wcmd(w, 'pick'), 'primary'), btn('🔀 隨機排座位', () => { if (confirm('要重新隨機排座位嗎？')) wcmd(w, 'shuffle'); }))];
  },
  embed(w) {
    const v = w.view || {};
    const SOCIAL = { facebook: '📘 Facebook', instagram: '📸 Instagram', threads: '🧵 Threads', tiktok: '🎵 TikTok', vimeo: '🎞️ Vimeo' };
    const label = v.kind === 'social' ? SOCIAL[v.platform] || '社群影片'
      : { youtube: '▶️ YouTube 影片', video: '🎬 影片', web: '🌐 網頁' }[v.kind] || '尚未設定網址';
    const out = [h('div', { class: 'card-title' }, label), h('div', { class: 'muted url-text' }, v.url || '')];
    if (v.kind === 'youtube' || v.kind === 'video') {
      out.push(h('div', { class: 'row' },
        ...(v.kind === 'video' ? [btn('⏪ 10 秒', () => wcmd(w, 'back'))] : []),
        btn(v.playing ? '⏸ 暫停' : '▶ 播放', () => wcmd(w, v.playing ? 'pause' : 'play'), 'primary big'),
        ...(v.kind === 'video' ? [btn('10 秒 ⏩', () => wcmd(w, 'fwd'))] : [])),
      h('div', { class: 'chips' }, btn(v.muted ? '🔊 取消靜音' : '🔇 靜音', () => wcmd(w, 'mute')), btn('⏮ 從頭播放', () => wcmd(w, 'restart'))));
    } else if (v.kind === 'social') {
      // 社群網站的播放器不開放外部控制
      out.push(h('div', { class: 'muted' }, '社群網站的影片無法從手機控制，請在電視上點播放。若顯示「無法觀看」，可能是非公開貼文，可改用瀏覽器開啟。'),
        h('div', { class: 'chips' }, btn('🔄 重新載入', () => wcmd(w, 'reload')), btn('🌐 改用瀏覽器開啟', () => wcmd(w, 'browser'))));
    } else if (v.kind === 'web') out.push(h('div', { class: 'chips' }, btn('🔄 重新載入', () => wcmd(w, 'reload'))));
    return out;
  },
  examdoc(w) {
    const v = w.view || {};
    const ICON = { pdf: '📕', image: '🖼️', text: '📝', word: '📘', doc: '📘', web: '🌐' };
    if (!v.name) return [h('div', { class: 'muted' }, '尚未選擇檔案，請在電視上按「📂 選擇試卷釋疑」')];
    const out = [h('div', { class: 'card-title' }, (ICON[v.doc] || '📄') + ' ' + v.name)];
    if (v.scroll) out.push(h('div', { class: 'row' }, btn('▲ 上一頁', () => wcmd(w, 'up')), btn('▼ 下一頁', () => wcmd(w, 'down'), 'primary')));
    const chips = [];
    if (v.doc === 'text' || v.doc === 'word') chips.push(btn('A− 字變小', () => wcmd(w, 'smaller')), btn('A+ 字變大', () => wcmd(w, 'bigger')));
    chips.push(btn('🔄 重新載入', () => wcmd(w, 'reload')));
    out.push(h('div', { class: 'chips' }, ...chips));
    return out;
  },
  points(w) {
    const list = w.view?.students || [];
    if (!list.length) return [h('div', { class: 'muted' }, '這一班還沒有學生名單')];
    const sum = list.reduce((a, p) => a + p.score, 0);
    return [
      h('div', { class: 'row' },
        btn('全班 +1', () => wcmd(w, 'all', { d: 1 }), 'primary'),
        btn('全班 −1', () => wcmd(w, 'all', { d: -1 })),
        btn('歸零', () => { if (confirm('要把所有人的分數歸零嗎？')) wcmd(w, 'reset'); })),
      h('div', { class: 'muted', style: { textAlign: 'center' } }, `全班 ${sum} 分`),
      h('div', { class: 'pts-list' }, list.map((p) => h('div', { class: 'pts-row' + (p.score > 0 ? ' pos' : p.score < 0 ? ' neg' : '') },
        h('span', { class: 'pts-r-no' }, p.no),
        h('span', { class: 'pts-r-name' }, p.name),
        h('span', { class: 'pts-r-score' }, p.score > 0 ? `+${p.score}` : String(p.score)),
        h('button', { class: 'pts-r-minus', onclick: () => wcmd(w, 'add', { name: p.name, d: -1 }) }, '−'),
        h('button', { class: 'pts-r-plus', onclick: () => wcmd(w, 'add', { name: p.name, d: 1 }) }, '+')))),
    ];
  },
  text(w) {
    const ta = h('textarea', { placeholder: '在這裡輸入，送到電視上的文字框' });
    ta.value = w.view?.text || '';
    return [ta, h('div', { class: 'row' },
      btn('取代文字', () => { wcmd(w, 'set', { text: ta.value }); ta.blur(); }, 'primary'),
      btn('加在後面', () => { wcmd(w, 'append', { text: ta.value }); ta.value = ''; ta.blur(); }))];
  },
};

function renderOther() { return [h('div', { class: 'muted' }, '這個小工具請在教室電腦上操作。')]; }

start();
