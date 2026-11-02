// 班級經營類：抽籤、分組、座位表、課堂加分、骰子、紅綠燈、工作模式、投票、音量計
import { h, field, select, checkbox, promptDialog, confirmDialog, toast, setImage } from '../ui.js';
import { shuffle, splitNames, beep, observeSize } from './util.js';
import { studentsOf, hasPhotos, linkedList, watchRoster, photoThumb, rosterDialog, rememberList } from '../roster.js';

// 目前的名單：連結班級名單時讀名單（含座號、照片），否則用自己輸入的名字
function people(ctx) {
  const l = linkedList(ctx);
  if (l) return studentsOf(l);
  return splitNames(ctx.state.names).map((name) => ({ name }));
}
const namesOf = (ctx) => people(ctx).map((p) => p.name);
const photosOf = (ctx) => new Map(people(ctx).filter((p) => p.photo).map((p) => [p.name, p.photo]));
// 連結了班級名單、但設定還沒載入時，先不要動到已存的資料
const rosterReady = (ctx) => !ctx.state.listId || !!ctx.store.settings;

function photoImg(ctx, ref, cls) {
  const img = h('img', { class: cls, alt: '', draggable: 'false' });
  setImage(img, ctx.store, ref);
  img.onerror = () => img.remove();
  return img;
}

// 名單設定：選擇班級名單（直接讀取匯入的名單與照片），或自己輸入
function namesEditor(ctx, onChange) {
  const s = ctx.state;
  const box = h('div', { class: 'stack' });
  async function render() {
    const st = await ctx.store.getSettings();
    box.innerHTML = '';
    const linked = st.classLists.find((l) => l.id === s.listId);
    const opts = [['', '✏️ 自己輸入名單'], ...st.classLists.map((l) => [l.id, `👥 ${l.name}（${studentsOf(l).length} 人${hasPhotos(l) ? '，有照片' : ''}）`])];
    box.append(field('名單來源', select(opts, linked ? linked.id : '', (v) => {
      if (!v && linked && !splitNames(s.names).length) s.names = studentsOf(linked).map((p) => p.name).join('\n');
      s.listId = v;
      rememberList(v);
      ctx.save(); onChange(); render();
    })));
    if (linked) {
      const list = studentsOf(linked);
      const strip = h('div', { class: 'roster-strip' });
      list.slice(0, 14).forEach((p) => strip.append(h('span', { class: 'rs-item', title: p.name },
        p.photo ? photoImg(ctx, p.photo, 'rs-photo') : h('span', { class: 'rs-photo none' }, p.name.slice(-2)))));
      if (list.length > 14) strip.append(h('span', { class: 'muted' }, `…共 ${list.length} 人`));
      box.append(strip, h('p', { class: 'muted' }, '直接使用班級名單：在「👥 名單」修改學生或照片後，這裡會自動更新。'));
    } else {
      const ta = h('textarea', { class: 'input', rows: 8, placeholder: '每行一個名字（也可以用逗號分隔）', value: s.names });
      ta.addEventListener('input', () => { s.names = ta.value; onChange(); ctx.save(); });
      const saveBtn = h('button', { class: 'btn', onclick: async () => {
        const names = splitNames(s.names);
        if (!names.length) return toast('名單是空的');
        const name = await promptDialog('名單名稱（例如：三年二班）');
        if (!name) return;
        const ex = st.classLists.find((l) => l.name === name);
        const students = names.map((n, i) => ({ no: String(i + 1).padStart(2, '0'), name: n }));
        let l = ex;
        if (ex) ex.students = students; else st.classLists.push(l = { id: Date.now().toString(36), name, students });
        s.listId = l.id; rememberList(l.id);
        ctx.store.saveSettings(); ctx.save(); onChange(); render();
        toast(`已儲存「${name}」，其他白板與裝置也能使用`);
      } }, '💾 儲存為班級名單');
      box.append(field('名單', ta), saveBtn);
    }
    box.append(h('button', { class: 'btn', onclick: () => rosterDialog(ctx.store, { selectId: s.listId }) }, '👥 管理班級名單（匯入 Excel、照片）'));
  }
  // 在班級名單畫面修改後，重新整理這個設定區
  const onSettings = () => { if (!box.isConnected) ctx.store.removeEventListener('settings', onSettings); else render(); };
  ctx.store.addEventListener('settings', onSettings);
  render();
  return box;
}

export const names = {
  type: 'names', title: '隨機抽籤', icon: '🎲', size: { w: 0.3, h: 0.34 },
  state: () => ({ names: '', listId: '', current: '', picked: [], removePicked: true, showPhoto: true }),
  mount(body, ctx) {
    const s = ctx.state;
    const photo = h('div', { class: 'pick-photo' });
    const display = h('div', { class: 'pick-name' });
    const info = h('div', { class: 'pick-info' });
    const pickBtn = h('button', { class: 'btn primary big' }, '抽一位');
    const picker = h('div', { class: 'picker' }, photo, display, h('div', { class: 'timer-ctrl' }, pickBtn,
      h('button', { class: 'btn', title: '重新開始', onclick: () => { s.picked = []; s.current = ''; ctx.save(); render(); } }, '↺ 重置')), info);
    body.append(picker);
    let anim = null;
    const pool = () => {
      const all = namesOf(ctx);
      return s.removePicked ? all.filter((n) => !s.picked.includes(n)) : all;
    };
    let shownPhoto = null;
    function showPhoto(name) {
      const ref = s.showPhoto && name ? photosOf(ctx).get(name) : null;
      picker.classList.toggle('with-photo', !!ref);
      if (JSON.stringify(ref) === JSON.stringify(shownPhoto)) return;
      shownPhoto = ref;
      photo.innerHTML = '';
      if (ref) photo.append(photoImg(ctx, ref, ''));
    }
    function render() {
      const all = namesOf(ctx);
      display.textContent = s.current || (all.length ? '準備好了嗎？' : '請先在 ⚙ 設定選擇班級名單');
      display.classList.toggle('placeholder', !s.current);
      info.textContent = all.length ? (s.removePicked ? `剩下 ${pool().length} / ${all.length} 人` : `共 ${all.length} 人`) : '';
      showPhoto(s.current);
    }
    pickBtn.onclick = () => {
      if (anim) return;
      let p = pool();
      if (!p.length) {
        if (!namesOf(ctx).length) return toast('請先按右上角 ⚙ 選擇班級名單');
        s.picked = []; p = pool(); toast('所有人都抽過了，重新開始');
      }
      const winner = p[Math.floor(Math.random() * p.length)];
      let i = 0;
      const steps = 18;
      display.classList.remove('placeholder');
      showPhoto(null);
      ctx.push?.();
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
    const unwatch = watchRoster(ctx, render);
    render();
    return {
      destroy: () => { clearTimeout(anim); unwatch(); },
      remote: {
        view: () => ({
          current: s.current, left: pool().length, total: namesOf(ctx).length, picking: !!anim,
          photo: !anim && s.current ? photoThumb(ctx.store, photosOf(ctx).get(s.current), ctx.push) : '',
        }),
        act(a) {
          if (a === 'pick') pickBtn.onclick();
          else if (a === 'reset') { s.picked = []; s.current = ''; ctx.save(); render(); }
        },
      },
      settings: (c) => c.append(namesEditor(ctx, () => { s.picked = s.picked.filter((n) => namesOf(ctx).includes(n)); render(); }),
        checkbox('抽過的人不再重複', s.removePicked, (v) => { s.removePicked = v; ctx.save(); render(); }),
        checkbox('顯示照片（班級名單有照片時）', s.showPhoto, (v) => { s.showPhoto = v; ctx.save(); render(); })),
    };
  },
};

export const groups = {
  type: 'groups', title: '分組', icon: '👥', size: { w: 0.4, h: 0.42 },
  state: () => ({ names: '', listId: '', mode: 'count', n: 4, groups: [], showPhoto: true }),
  mount(body, ctx) {
    const s = ctx.state;
    const grid = h('div', { class: 'groups-grid' });
    body.append(h('div', { class: 'groups' },
      h('div', { class: 'groups-bar' },
        h('button', { class: 'btn primary', onclick: () => make() }, '🔀 隨機分組')),
      grid));
    function make() {
      const list = shuffle(namesOf(ctx));
      if (!list.length) return toast('請先按右上角 ⚙ 選擇班級名單');
      const count = s.mode === 'count' ? Math.max(1, Math.min(s.n, list.length)) : Math.max(1, Math.ceil(list.length / Math.max(1, s.n)));
      s.groups = Array.from({ length: count }, () => []);
      list.forEach((n, i) => s.groups[i % count].push(n));
      ctx.save(); render();
    }
    function render() {
      grid.innerHTML = '';
      if (!s.groups.length) { grid.append(h('div', { class: 'muted center' }, '選擇名單後按「隨機分組」')); return; }
      const photos = s.showPhoto ? photosOf(ctx) : new Map();
      grid.style.setProperty('--cols', Math.ceil(Math.sqrt(s.groups.length * 1.6)));
      s.groups.forEach((g, i) => grid.append(h('div', { class: `group-card c${i % 8}` },
        h('b', null, `第 ${i + 1} 組`),
        photos.size
          ? h('div', { class: 'gm-list' }, g.map((n) => h('span', { class: 'gm' }, photos.get(n) ? photoImg(ctx, photos.get(n), 'gm-photo') : null, n)))
          : h('div', null, g.join('、')))));
    }
    const unwatch = watchRoster(ctx, render);
    render();
    return {
      destroy: () => unwatch(),
      remote: {
        view: () => ({ groups: s.groups, total: namesOf(ctx).length }),
        act(a) { if (a === 'shuffle') make(); },
      },
      settings: (c) => c.append(namesEditor(ctx, () => {}),
        h('div', { class: 'row' },
          field('分組方式', select([['count', '指定組數'], ['size', '每組人數']], s.mode, (v) => { s.mode = v; ctx.save(); })),
          field('數量', h('input', { class: 'input', type: 'number', min: 1, max: 50, value: s.n, oninput: (e) => { s.n = Math.max(1, +e.target.value || 1); ctx.save(); } }))),
        checkbox('顯示照片（班級名單有照片時）', s.showPhoto, (v) => { s.showPhoto = v; ctx.save(); render(); })),
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
    const unobserve = observeSize(body, () => wrap.classList.toggle('horizontal', body.clientWidth > body.clientHeight * 1.3));
    render();
    return {
      destroy: () => unobserve(),
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
  state: () => ({ names: '', listId: '', rows: 5, cols: 6, seats: [], flip: false, highlight: -1, showPhoto: true }),
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
      if (!rosterReady(ctx)) return;
      const list = namesOf(ctx);
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
      const list = namesOf(ctx);
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
      if (!namesOf(ctx).length) {
        grid.append(h('div', { class: 'muted center', style: { gridColumn: '1 / -1' } }, '按右上角 ⚙ 選擇班級名單'));
        return;
      }
      const photos = s.showPhoto ? photosOf(ctx) : new Map();
      grid.classList.toggle('with-photo', photos.size > 0);
      for (const i of order) {
        const n = s.seats[i];
        const ref = n && photos.get(n);
        grid.append(h('button', {
          class: 'seat' + (n ? '' : ' empty') + (i === selected ? ' sel' : '') + (i === s.highlight ? ' hl' : ''),
          title: n ? '點一下，再點另一個座位即可交換' : '空位',
          onclick: () => {
            if (selected < 0) { selected = i; render(); return; }
            const a = selected; selected = -1;
            if (a === i) render(); else swap(a, i);
          },
        }, ref ? photoImg(ctx, ref, 'seat-photo') : null, h('span', { class: 'seat-name' }, n)));
      }
    }
    const unwatch = watchRoster(ctx, () => { sync(); render(); });
    sync();
    render();
    const resize = (dr, dc) => {
      const list = namesOf(ctx);
      const rows = Math.max(1, Math.min(15, s.rows + dr)), cols = Math.max(1, Math.min(15, s.cols + dc));
      if (rows * cols < list.length) return toast(`座位不夠，至少要 ${list.length} 個`);
      // 依「列、行」重新對應，保留原本的位置
      const next = Array(rows * cols).fill('');
      for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) if (r < rows && c < cols) next[r * cols + c] = s.seats[r * s.cols + c] || '';
      s.seats = next; s.rows = rows; s.cols = cols;
      sync(); ctx.save(); render();
    };
    return {
      destroy: () => { clearTimeout(anim); unwatch(); },
      remote: {
        view: () => ({
          rows: s.rows, cols: s.cols, seats: s.seats, flip: s.flip, highlight: s.highlight, picking: !!anim,
          photo: !anim && s.seats[s.highlight] ? photoThumb(ctx.store, photosOf(ctx).get(s.seats[s.highlight]), ctx.push) : '',
        }),
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
          checkbox('顯示照片（班級名單有照片時）', s.showPhoto, (v) => { s.showPhoto = v; ctx.save(); render(); }),
          h('p', { class: 'muted' }, '在座位表上點一個座位，再點另一個座位，兩人就會交換（也可以和空位交換）。'));
      },
    };
  },
};

// 沒有照片時的預設頭像
const AVATAR = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#cfe3f1"/><circle cx="50" cy="40" r="17" fill="#f6d5bf"/><path d="M17 100c2-21 15-31 33-31s31 10 33 31z" fill="#46587a"/></svg>');

// 課堂加分：每位學生一張卡片（座號、照片、姓名、分數、加減分按鈕）
export const points = {
  type: 'points', title: '課堂加分', icon: '⭐', size: { w: 0.64, h: 0.66 },
  state: () => ({ names: '', listId: '', scores: {}, showPhoto: true, sort: 'no', sound: true }),
  mount(body, ctx) {
    const s = ctx.state;
    const grid = h('div', { class: 'pts-grid' });
    const total = h('span', { class: 'pts-total' });
    body.append(h('div', { class: 'pts' },
      h('div', { class: 'pts-bar' },
        h('button', { class: 'btn', onclick: () => all(1) }, '全班 +1'),
        h('button', { class: 'btn', onclick: () => all(-1) }, '全班 −1'),
        total,
        h('button', { class: 'btn', onclick: async () => { if (await confirmDialog('要把所有人的分數歸零嗎？', '歸零', true)) reset(); } }, '↺ 歸零')),
      grid));
    const score = (n) => s.scores[n] || 0;
    // 沒有座號時依名單順序編號
    const list = () => {
      const ps = people(ctx).map((p, i) => ({ ...p, no: p.no || String(i + 1).padStart(2, '0') }));
      if (s.sort === 'score') ps.sort((a, b) => score(b.name) - score(a.name) || String(a.no).localeCompare(String(b.no), undefined, { numeric: true }));
      return ps;
    };
    const cards = new Map(); // 姓名 -> { el, scoreEl }

    function change(name, d, { quiet = false } = {}) {
      const v = score(name) + d;
      if (v) s.scores[name] = v; else delete s.scores[name];
      if (s.sort === 'score' && !quiet) render(); else updateCard(name);
      const c = cards.get(name);
      if (c && !quiet) {
        const f = h('span', { class: 'pts-float ' + (d > 0 ? 'up' : 'down') }, (d > 0 ? '+' : '−') + Math.abs(d));
        c.el.append(f);
        setTimeout(() => f.remove(), 900);
        c.el.classList.remove('flash-up', 'flash-down');
        void c.el.offsetWidth; // 重新觸發動畫
        c.el.classList.add(d > 0 ? 'flash-up' : 'flash-down');
      }
      if (s.sound && !quiet) beep({ times: 1, freq: d > 0 ? 988 : 330, dur: 0.12 });
      updateTotal();
      ctx.save();
    }
    function all(d) {
      const ps = list();
      if (!ps.length) return toast('請先按右上角 ⚙ 選擇班級名單');
      ps.forEach((p) => change(p.name, d, { quiet: true }));
      if (s.sort === 'score') render();
      grid.classList.remove('flash-all'); void grid.offsetWidth; grid.classList.add('flash-all');
      if (s.sound) beep({ times: 2, freq: d > 0 ? 988 : 330, dur: 0.1 });
    }
    function reset() { s.scores = {}; render(); ctx.save(); }
    function updateCard(name) {
      const c = cards.get(name);
      if (!c) return;
      const v = score(name);
      c.scoreEl.textContent = v > 0 ? `+${v}` : String(v);
      c.el.classList.toggle('pos', v > 0);
      c.el.classList.toggle('neg', v < 0);
    }
    function updateTotal() {
      const ps = list();
      total.textContent = ps.length ? `全班 ${ps.reduce((a, p) => a + score(p.name), 0)} 分` : '';
    }
    function render() {
      grid.innerHTML = '';
      cards.clear();
      const ps = list();
      if (!ps.length) { grid.append(h('div', { class: 'muted center' }, '按右上角 ⚙ 選擇班級名單')); updateTotal(); return; }
      for (const p of ps) {
        const scoreEl = h('span', { class: 'pts-score' });
        const photo = s.showPhoto ? h('div', { class: 'pts-photo' }, p.photo ? photoImg(ctx, p.photo, '') : h('img', { src: AVATAR, alt: '' })) : null;
        const el = h('div', { class: 'pts-card' + (s.showPhoto ? '' : ' no-photo') },
          scoreEl,
          h('span', { class: 'pts-no' }, `${p.no}號`),
          h('div', { class: 'pts-main' }, photo, h('div', { class: 'pts-name' }, p.name)),
          h('div', { class: 'pts-btns' },
            h('button', { class: 'pts-minus', title: '減 1 分', onclick: () => change(p.name, -1) }, '−'),
            h('button', { class: 'pts-plus', title: '加 1 分', onclick: () => change(p.name, 1) }, '+')));
        cards.set(p.name, { el, scoreEl });
        grid.append(el);
        updateCard(p.name);
      }
      fit();
      updateTotal();
    }
    // 依小工具大小算出最適合的欄數，讓全班卡片盡量放大又不用捲動
    function fit() {
      const n = cards.size;
      const W = grid.clientWidth, H = grid.clientHeight;
      if (!n || !W || !H) return;
      const gap = 8, ratio = 1.45; // 卡片寬高比
      let best = 1, bestW = 0;
      for (let c = 1; c <= n; c++) {
        const rows = Math.ceil(n / c);
        const cw = (W - gap * (c - 1)) / c, ch = (H - gap * (rows - 1)) / rows;
        const w = Math.min(cw, ch * ratio);
        if (w > bestW) { bestW = w; best = c; }
      }
      grid.style.setProperty('--cols', best);
      grid.style.setProperty('--card-w', Math.max(120, Math.floor(bestW)) + 'px');
    }
    const unobserve = observeSize(grid, fit);
    const unwatch = watchRoster(ctx, render);
    render();
    return {
      destroy: () => { unobserve(); unwatch(); },
      remote: {
        view: () => ({ students: list().map((p) => ({ name: p.name, no: p.no, score: score(p.name) })) }),
        act(a, args = {}) {
          if (a === 'add' && list().some((p) => p.name === args.name)) change(args.name, Math.sign(+args.d) || 1);
          else if (a === 'all') all(Math.sign(+args.d) || 1);
          else if (a === 'reset') reset();
        },
      },
      settings: (c) => c.append(namesEditor(ctx, render),
        field('排列方式', select([['no', '依座號'], ['score', '依分數（高分在前）']], s.sort, (v) => { s.sort = v; ctx.save(); render(); })),
        checkbox('顯示照片', s.showPhoto, (v) => { s.showPhoto = v; ctx.save(); render(); }),
        checkbox('加減分時播放音效', s.sound, (v) => { s.sound = v; ctx.save(); })),
    };
  },
};
