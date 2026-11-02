// 班級經營類：抽籤、分組、骰子、紅綠燈、工作模式、投票、音量計
import { h, field, select, checkbox, promptDialog, toast } from '../ui.js';
import { shuffle, splitNames, beep } from './util.js';

// 名單編輯區：可以從「已儲存的班級名單」載入，或另存
function namesEditor(ctx, onChange) {
  const s = ctx.state;
  const ta = h('textarea', { class: 'input', rows: 8, placeholder: '每行一個名字（也可以用逗號分隔）', value: s.names });
  ta.addEventListener('input', () => { s.names = ta.value; onChange(); ctx.save(); });
  const sel = h('select', { class: 'input' }, h('option', { value: '' }, '— 載入已儲存的名單 —'));
  ctx.store.getSettings().then((st) => {
    for (const l of st.classLists) sel.append(h('option', { value: l.id }, `${l.name}（${l.names.length} 人）`));
  });
  sel.addEventListener('change', async () => {
    const st = await ctx.store.getSettings();
    const l = st.classLists.find((x) => x.id === sel.value);
    if (l) { s.names = l.names.join('\n'); ta.value = s.names; onChange(); ctx.save(); }
  });
  const saveBtn = h('button', { class: 'btn', onclick: async () => {
    const names = splitNames(s.names);
    if (!names.length) return toast('名單是空的');
    const name = await promptDialog('名單名稱（例如：三年二班）');
    if (!name) return;
    const st = await ctx.store.getSettings();
    const ex = st.classLists.find((l) => l.name === name);
    if (ex) ex.names = names; else st.classLists.push({ id: Date.now().toString(36), name, names });
    ctx.store.saveSettings();
    toast(`已儲存「${name}」，其他白板與裝置也能使用`);
  } }, '💾 儲存為班級名單');
  return h('div', { class: 'stack' }, sel, field('名單', ta), saveBtn);
}

export const names = {
  type: 'names', title: '隨機抽籤', icon: '🎲', size: { w: 0.3, h: 0.3 },
  state: () => ({ names: '', current: '', picked: [], removePicked: true }),
  mount(body, ctx) {
    const s = ctx.state;
    const display = h('div', { class: 'pick-name' });
    const info = h('div', { class: 'pick-info' });
    const pickBtn = h('button', { class: 'btn primary big' }, '抽一位');
    body.append(h('div', { class: 'picker' }, display, h('div', { class: 'timer-ctrl' }, pickBtn,
      h('button', { class: 'btn', title: '重新開始', onclick: () => { s.picked = []; s.current = ''; ctx.save(); render(); } }, '↺ 重置')), info));
    let anim = null;
    const pool = () => {
      const all = splitNames(s.names);
      return s.removePicked ? all.filter((n) => !s.picked.includes(n)) : all;
    };
    function render() {
      const all = splitNames(s.names);
      display.textContent = s.current || (all.length ? '準備好了嗎？' : '請先在 ⚙ 設定輸入名單');
      display.classList.toggle('placeholder', !s.current);
      info.textContent = all.length ? (s.removePicked ? `剩下 ${pool().length} / ${all.length} 人` : `共 ${all.length} 人`) : '';
    }
    pickBtn.onclick = () => {
      if (anim) return;
      let p = pool();
      if (!p.length) {
        if (!splitNames(s.names).length) return toast('請先按右上角 ⚙ 輸入名單');
        s.picked = []; p = pool(); toast('所有人都抽過了，重新開始');
      }
      const winner = p[Math.floor(Math.random() * p.length)];
      let i = 0;
      const steps = 18;
      display.classList.remove('placeholder');
      const step = () => {
        if (i++ < steps) {
          display.textContent = p[Math.floor(Math.random() * p.length)];
          anim = setTimeout(step, 40 + i * i * 0.9);
        } else {
          anim = null;
          s.current = winner;
          if (s.removePicked) s.picked.push(winner);
          ctx.save(); render();
          display.classList.add('pop');
          setTimeout(() => display.classList.remove('pop'), 600);
          beep({ times: 1, freq: 1046, dur: 0.15 });
        }
      };
      step();
    };
    render();
    return {
      destroy: () => clearTimeout(anim),
      remote: {
        view: () => ({ current: s.current, left: pool().length, total: splitNames(s.names).length, picking: !!anim }),
        act(a) {
          if (a === 'pick') pickBtn.onclick();
          else if (a === 'reset') { s.picked = []; s.current = ''; ctx.save(); render(); }
        },
      },
      settings: (c) => c.append(namesEditor(ctx, render),
        checkbox('抽過的人不再重複', s.removePicked, (v) => { s.removePicked = v; ctx.save(); render(); })),
    };
  },
};

export const groups = {
  type: 'groups', title: '分組', icon: '👥', size: { w: 0.4, h: 0.42 },
  state: () => ({ names: '', mode: 'count', n: 4, groups: [] }),
  mount(body, ctx) {
    const s = ctx.state;
    const grid = h('div', { class: 'groups-grid' });
    body.append(h('div', { class: 'groups' },
      h('div', { class: 'groups-bar' },
        h('button', { class: 'btn primary', onclick: () => make() }, '🔀 隨機分組')),
      grid));
    function make() {
      const list = shuffle(splitNames(s.names));
      if (!list.length) return toast('請先按右上角 ⚙ 輸入名單');
      const count = s.mode === 'count' ? Math.max(1, Math.min(s.n, list.length)) : Math.max(1, Math.ceil(list.length / Math.max(1, s.n)));
      s.groups = Array.from({ length: count }, () => []);
      list.forEach((n, i) => s.groups[i % count].push(n));
      ctx.save(); render();
    }
    function render() {
      grid.innerHTML = '';
      if (!s.groups.length) { grid.append(h('div', { class: 'muted center' }, '設定名單後按「隨機分組」')); return; }
      grid.style.setProperty('--cols', Math.ceil(Math.sqrt(s.groups.length * 1.6)));
      s.groups.forEach((g, i) => grid.append(h('div', { class: `group-card c${i % 8}` },
        h('b', null, `第 ${i + 1} 組`), h('div', null, g.join('、')))));
    }
    render();
    return {
      remote: {
        view: () => ({ groups: s.groups, total: splitNames(s.names).length }),
        act(a) { if (a === 'shuffle') make(); },
      },
      settings: (c) => c.append(namesEditor(ctx, () => {}),
        h('div', { class: 'row' },
          field('分組方式', select([['count', '指定組數'], ['size', '每組人數']], s.mode, (v) => { s.mode = v; ctx.save(); })),
          field('數量', h('input', { class: 'input', type: 'number', min: 1, max: 50, value: s.n, oninput: (e) => { s.n = Math.max(1, +e.target.value || 1); ctx.save(); } })))),
    };
  },
};

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
export const dice = {
  type: 'dice', title: '骰子', icon: '🎯', size: { w: 0.26, h: 0.26 },
  state: () => ({ count: 2, values: [3, 5] }),
  mount(body, ctx) {
    const s = ctx.state;
    const row = h('div', { class: 'dice-row' });
    const total = h('div', { class: 'dice-total' });
    body.append(h('div', { class: 'dice', onclick: roll, title: '點一下擲骰子' }, row, total));
    let rolling = false;
    function render() {
      row.innerHTML = '';
      s.values.slice(0, s.count).forEach((v) => row.append(h('div', { class: 'die' + (rolling ? ' rolling' : '') },
        Array.from({ length: 9 }, (_, i) => h('i', { class: PIPS[v].includes(i) ? 'on' : '' })))));
      total.textContent = s.count > 1 && !rolling ? `合計 ${s.values.slice(0, s.count).reduce((a, b) => a + b, 0)}` : '';
    }
    function roll() {
      if (rolling) return;
      rolling = true;
      let n = 0;
      const t = setInterval(() => {
        s.values = Array.from({ length: s.count }, () => 1 + Math.floor(Math.random() * 6));
        render();
        if (++n > 8) { clearInterval(t); rolling = false; render(); ctx.save(); }
      }, 70);
    }
    while (s.values.length < 6) s.values.push(1);
    render();
    return {
      remote: {
        view: () => ({ values: s.values.slice(0, s.count), rolling }),
        act(a) { if (a === 'roll') roll(); },
      },
      settings: (c) => c.append(field('骰子數量', select([1, 2, 3, 4, 5, 6].map((n) => [n, n + ' 顆']), s.count, (v) => { s.count = +v; render(); ctx.save(); }))),
    };
  },
};

export const traffic = {
  type: 'traffic', title: '紅綠燈', icon: '🚦', size: { w: 0.12, h: 0.36 },
  state: () => ({ light: 'red' }),
  mount(body, ctx) {
    const s = ctx.state;
    const wrap = h('div', { class: 'traffic' });
    body.append(wrap);
    function render() {
      wrap.innerHTML = '';
      for (const c of ['red', 'yellow', 'green']) {
        wrap.append(h('button', { class: `lamp ${c}${s.light === c ? ' on' : ''}`, title: { red: '停', yellow: '準備', green: '開始' }[c],
          onclick: () => { s.light = c; render(); ctx.save(); } }));
      }
    }
    const ro = new ResizeObserver(() => wrap.classList.toggle('horizontal', body.clientWidth > body.clientHeight * 1.3));
    ro.observe(body);
    render();
    return {
      destroy: () => ro.disconnect(),
      remote: {
        view: () => ({ light: s.light }),
        act(a, { light } = {}) { if (a === 'set' && ['red', 'yellow', 'green'].includes(light)) { s.light = light; render(); ctx.save(); } },
      },
    };
  },
};

const MODES = [
  ['silent', '🤫', '安靜作業'], ['whisper', '🗣️', '輕聲細語'], ['partner', '🧑‍🤝‍🧑', '兩人討論'],
  ['group', '👨‍👩‍👧‍👦', '小組合作'], ['hand', '✋', '舉手發言'], ['listen', '👂', '專心聆聽'],
  ['clean', '🧹', '整理環境'], ['break', '☕', '休息時間'],
];
export const work = {
  type: 'work', title: '工作模式', icon: '🤫', size: { w: 0.22, h: 0.3 },
  state: () => ({ mode: 'silent', custom: '' }),
  mount(body, ctx) {
    const s = ctx.state;
    const big = h('div', { class: 'work-big' });
    const bar = h('div', { class: 'work-bar' });
    body.append(h('div', { class: 'work' }, big, bar));
    function render() {
      const m = MODES.find((x) => x[0] === s.mode) || MODES[0];
      big.innerHTML = `<div class="work-emoji">${m[1]}</div><div class="work-label">${s.custom || m[2]}</div>`;
      big.className = 'work-big m-' + m[0];
      bar.innerHTML = '';
      MODES.forEach(([k, e, l]) => bar.append(h('button', { class: k === s.mode ? 'on' : '', title: l,
        onclick: () => { s.mode = k; s.custom = ''; render(); ctx.save(); } }, e)));
    }
    render();
    return {
      remote: {
        view: () => ({ mode: s.mode, custom: s.custom, modes: MODES.map(([k, e, l]) => ({ k, e, l })) }),
        act(a, { mode } = {}) { if (a === 'set' && MODES.some((m) => m[0] === mode)) { s.mode = mode; s.custom = ''; render(); ctx.save(); } },
      },
      settings: (c) => c.append(field('自訂文字（留空則使用預設）', h('input', { class: 'input', value: s.custom,
        oninput: (e) => { s.custom = e.target.value; render(); ctx.save(); } }))),
    };
  },
};

export const poll = {
  type: 'poll', title: '投票', icon: '📊', size: { w: 0.3, h: 0.36 },
  state: () => ({ question: '你最喜歡哪一個？', options: [{ label: '選項 A', votes: 0 }, { label: '選項 B', votes: 0 }, { label: '選項 C', votes: 0 }] }),
  mount(body, ctx) {
    const s = ctx.state;
    const q = h('div', { class: 'poll-q' });
    const list = h('div', { class: 'poll-list' });
    body.append(h('div', { class: 'poll' }, q, list,
      h('div', { class: 'poll-foot' }, h('span', { class: 'muted' }, '點選項加一票，右鍵減一票'),
        h('button', { class: 'btn small', onclick: () => { s.options.forEach((o) => { o.votes = 0; }); render(); ctx.save(); } }, '歸零'))));
    function render() {
      q.textContent = s.question;
      const total = s.options.reduce((a, o) => a + o.votes, 0);
      const max = Math.max(1, ...s.options.map((o) => o.votes));
      list.innerHTML = '';
      s.options.forEach((o, i) => list.append(h('button', {
        class: `poll-opt c${i % 8}`,
        onclick: () => { o.votes++; render(); ctx.save(); },
        oncontextmenu: (e) => { e.preventDefault(); o.votes = Math.max(0, o.votes - 1); render(); ctx.save(); },
      }, h('i', { style: { width: (o.votes / max) * 100 + '%' } }), h('span', null, o.label),
      h('b', null, `${o.votes}${total ? `（${Math.round((o.votes / total) * 100)}%）` : ''}`))));
    }
    render();
    return {
      remote: {
        view: () => ({ question: s.question, options: s.options }),
        act(a, { i } = {}) {
          const o = s.options[i];
          if (a === 'vote' && o) o.votes++;
          else if (a === 'unvote' && o) o.votes = Math.max(0, o.votes - 1);
          else if (a === 'reset') s.options.forEach((x) => { x.votes = 0; });
          else return;
          render(); ctx.save();
        },
      },
      settings: (c) => c.append(
        field('題目', h('input', { class: 'input', value: s.question, oninput: (e) => { s.question = e.target.value; render(); ctx.save(); } })),
        field('選項（每行一個）', h('textarea', { class: 'input', rows: 6, value: s.options.map((o) => o.label).join('\n'),
          oninput: (e) => {
            const labels = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean);
            s.options = labels.map((l, i) => ({ label: l, votes: s.options[i]?.label === l ? s.options[i].votes : 0 }));
            render(); ctx.save();
          } }))),
    };
  },
};

export const sound = {
  type: 'sound', title: '音量計', icon: '🔊', size: { w: 0.26, h: 0.32 },
  state: () => ({ sensitivity: 50, limit: 70, alarm: false }),
  mount(body, ctx) {
    const s = ctx.state;
    const face = h('div', { class: 'snd-face' }, '🎤');
    const bar = h('div', { class: 'snd-bar' }, h('i'), h('em'));
    const msg = h('div', { class: 'snd-msg' });
    const btn = h('button', { class: 'btn primary' }, '開始偵測');
    body.append(h('div', { class: 'sound' }, face, bar, msg, btn));
    let stream, raf, ac, level = 0, lastAlarm = 0;
    bar.querySelector('em').style.left = s.limit + '%';

    async function start() {
      if (!window.isSecureContext || !navigator.mediaDevices) {
        msg.textContent = '需要 HTTPS 或 localhost 才能使用麥克風（請參考 README）';
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) { msg.textContent = '無法使用麥克風：' + e.message; return; }
      ac = new AudioContext();
      const src = ac.createMediaStreamSource(stream);
      const an = ac.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      const buf = new Float32Array(an.fftSize);
      btn.textContent = '停止';
      const loop = () => {
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const rms = Math.sqrt(sum / buf.length);
        const val = Math.min(100, (rms * 400 * (s.sensitivity / 50)));
        level = level * 0.85 + val * 0.15;
        bar.querySelector('i').style.width = level + '%';
        const loud = level > s.limit;
        bar.classList.toggle('loud', loud);
        face.textContent = loud ? '😣' : level > s.limit * 0.6 ? '😐' : '😊';
        msg.textContent = loud ? '太吵了！請降低音量' : '很好，保持下去';
        if (loud && s.alarm && Date.now() - lastAlarm > 3000) { lastAlarm = Date.now(); beep({ times: 2, freq: 660 }); }
        raf = requestAnimationFrame(loop);
      };
      loop();
    }
    function stop() {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      ac?.close();
      stream = null;
      btn.textContent = '開始偵測';
      face.textContent = '🎤';
      msg.textContent = '';
      bar.querySelector('i').style.width = '0';
    }
    btn.onclick = () => (stream ? stop() : start());
    return {
      destroy: stop,
      settings: (c) => c.append(
        field('靈敏度', h('input', { type: 'range', min: 10, max: 100, value: s.sensitivity, oninput: (e) => { s.sensitivity = +e.target.value; ctx.save(); } })),
        field('警戒線', h('input', { type: 'range', min: 20, max: 95, value: s.limit, oninput: (e) => { s.limit = +e.target.value; bar.querySelector('em').style.left = s.limit + '%'; ctx.save(); } })),
        checkbox('超過警戒線時發出提示音', s.alarm, (v) => { s.alarm = v; ctx.save(); })),
    };
  },
};

// 座位表：依名單排座位，點兩個座位可以交換，也能隨機排座、隨機點名
export const seats = {
  type: 'seats', title: '座位表', icon: '🪑', size: { w: 0.5, h: 0.55 },
  state: () => ({ names: '', rows: 5, cols: 6, seats: [], flip: false, highlight: -1 }),
  mount(body, ctx) {
    const s = ctx.state;
    const grid = h('div', { class: 'seats-grid' });
    const desk = h('div', { class: 'seats-desk' }, '講　台');
    const wrap = h('div', { class: 'seats' },
      h('div', { class: 'seats-bar' },
        h('button', { class: 'btn primary', onclick: () => shuffleSeats() }, '🔀 隨機排座位'),
        h('button', { class: 'btn', onclick: () => pick() }, '🎯 隨機點名')),
      desk, grid);
    body.append(wrap);
    let selected = -1;
    let anim = null;

    // 名單改變時：保留原本的位置，刪掉不在名單的人，新的人補進空位
    function sync() {
      const list = splitNames(s.names);
      const total = s.rows * s.cols;
      let arr = Array.from({ length: total }, (_, i) => s.seats[i] || '');
      const seen = new Set();
      arr = arr.map((n) => (n && list.includes(n) && !seen.has(n) ? (seen.add(n), n) : ''));
      const missing = list.filter((n) => !seen.has(n));
      for (const n of missing) {
        let i = arr.indexOf('');
        if (i < 0) { s.rows += 1; arr.push(...Array(s.cols).fill('')); i = arr.indexOf(''); }
        arr[i] = n;
      }
      s.seats = arr;
      if (s.highlight >= arr.length || !arr[s.highlight]) s.highlight = -1;
    }
    function shuffleSeats() {
      const list = splitNames(s.names);
      if (!list.length) return toast('請先按右上角 ⚙ 輸入名單');
      const total = s.rows * s.cols;
      // 人數少於座位時，空位也一起打散
      s.seats = shuffle([...list, ...Array(Math.max(0, total - list.length)).fill('')]);
      s.highlight = -1; selected = -1;
      sync(); ctx.save(); render();
    }
    function swap(a, b) {
      if (a === b || a < 0 || b < 0 || a >= s.seats.length || b >= s.seats.length) return;
      [s.seats[a], s.seats[b]] = [s.seats[b], s.seats[a]];
      if (s.highlight === a) s.highlight = b; else if (s.highlight === b) s.highlight = a;
      ctx.save(); render();
    }
    function pick() {
      if (anim) return;
      const filled = s.seats.map((n, i) => (n ? i : -1)).filter((i) => i >= 0);
      if (!filled.length) return toast('請先按右上角 ⚙ 輸入名單');
      const winner = filled[Math.floor(Math.random() * filled.length)];
      let k = 0;
      const step = () => {
        if (k++ < 16) {
          s.highlight = filled[Math.floor(Math.random() * filled.length)];
          render();
          anim = setTimeout(step, 50 + k * k * 1.2);
        } else {
          anim = null; s.highlight = winner; ctx.save(); render();
          beep({ times: 1, freq: 1046, dur: 0.15 });
        }
      };
      step();
    }
    function render() {
      grid.innerHTML = '';
      grid.style.setProperty('--cols', s.cols);
      grid.style.setProperty('--rows', s.rows);
      wrap.classList.toggle('flip', s.flip);
      const order = s.seats.map((_, i) => i);
      if (s.flip) order.reverse(); // 老師視角：講台在下方，左右也相反
      if (!splitNames(s.names).length) {
        grid.append(h('div', { class: 'muted center', style: { gridColumn: '1 / -1' } }, '按右上角 ⚙ 輸入名單，或載入已儲存的班級名單'));
        return;
      }
      for (const i of order) {
        const n = s.seats[i];
        grid.append(h('button', {
          class: 'seat' + (n ? '' : ' empty') + (i === selected ? ' sel' : '') + (i === s.highlight ? ' hl' : ''),
          title: n ? '點一下，再點另一個座位即可交換' : '空位',
          onclick: () => {
            if (selected < 0) { selected = i; render(); return; }
            const a = selected; selected = -1;
            if (a === i) render(); else swap(a, i);
          },
        }, n));
      }
    }
    sync();
    render();
    const resize = (dr, dc) => {
      const list = splitNames(s.names);
      const rows = Math.max(1, Math.min(15, s.rows + dr)), cols = Math.max(1, Math.min(15, s.cols + dc));
      if (rows * cols < list.length) return toast(`座位不夠，至少要 ${list.length} 個`);
      // 依「列、行」重新對應，保留原本的位置
      const next = Array(rows * cols).fill('');
      for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) if (r < rows && c < cols) next[r * cols + c] = s.seats[r * s.cols + c] || '';
      s.seats = next; s.rows = rows; s.cols = cols;
      sync(); ctx.save(); render();
    };
    return {
      destroy: () => clearTimeout(anim),
      remote: {
        view: () => ({ rows: s.rows, cols: s.cols, seats: s.seats, flip: s.flip, highlight: s.highlight, picking: !!anim }),
        act(a, args = {}) {
          if (a === 'shuffle') shuffleSeats();
          else if (a === 'pick') pick();
          else if (a === 'swap') swap(+args.a, +args.b);
          else if (a === 'clear') { s.highlight = -1; ctx.save(); render(); }
        },
      },
      settings: (c) => {
        const size = h('span', { class: 'seats-size' });
        const showSize = () => { size.textContent = `${s.rows} 排 × ${s.cols} 行（${s.rows * s.cols} 個座位）`; };
        showSize();
        const adj = (label, dr, dc) => h('button', { class: 'btn', onclick: () => { resize(dr, dc); showSize(); } }, label);
        c.append(namesEditor(ctx, () => { sync(); render(); showSize(); }),
          field('座位數', h('div', { class: 'stack' }, size,
            h('div', { class: 'row-btns' }, adj('− 排', -1, 0), adj('＋ 排', 1, 0), adj('− 行', 0, -1), adj('＋ 行', 0, 1)))),
          checkbox('老師視角（講台在下方）', s.flip, (v) => { s.flip = v; ctx.save(); render(); }),
          h('p', { class: 'muted' }, '在座位表上點一個座位，再點另一個座位，兩人就會交換（也可以和空位交換）。'));
      },
    };
  },
};
