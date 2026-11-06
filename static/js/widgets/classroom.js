// 班級經營類：抽籤、分組、座位表、課堂加分、工作模式、投票、音量計
import { h, field, select, checkbox, promptDialog, confirmDialog, toast, setImage, modal, saveTextFile } from '../ui.js';
import { dayKey, logPoint, ensureDaily, RANGES, totalsIn, rankPeople, leaderboardCsv, rangeLabel } from '../points-log.js';
import { shuffle, splitNames, beep, observeSize } from './util.js';
import { studentsOf, hasPhotos, linkedList, watchRoster, photoThumb, rosterDialog, rememberList } from '../roster.js';
import { pollLibraryDialog, makeResult, addResult, resultSig, totalVotes } from '../poll-bank.js';
import { SEAT_TAGS, MAX_LABEL, cleanLabel, layoutsOf, saveLayout, updateLayout, findLayout, renameLayout, deleteLayout, applyLayout } from '../seat-layouts.js';

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

// 座位表的照片：外框量出可用空間（CSS 容器單位），照片依空間決定比例，見 app.css 的 .seat-pic
function seatPhoto(ctx, ref) {
  const img = photoImg(ctx, ref, 'seat-photo');
  const pic = h('div', { class: 'seat-pic' }, img);
  img.onerror = () => pic.remove();
  return pic;
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

// 學生投票：同一個名字只算一票（不分大小寫、空白），可設定是否允許改票
// ballots：{ 名字小寫: { name, label } }，用選項文字記錄，題目改過選項也不會算錯
export function castVote(s, rawName, choice) {
  const name = String(rawName ?? '').trim().replace(/\s+/g, ' ').slice(0, 20);
  if (!name) return { ok: false, text: '請先輸入你的名字' };
  const o = Number.isInteger(choice) ? s.options[choice] : null;
  if (!o) return { ok: false, text: '選項已經更新，請重新選擇' };
  s.ballots ||= {};
  const key = name.toLowerCase();
  const prev = s.ballots[key];
  if (prev) {
    if (prev.label === o.label) return { ok: true, text: `已投給「${o.label}」`, choice };
    if (s.allowChange === false) {
      return { ok: false, text: `你已經投給「${prev.label}」，這次投票不能改票`, choice: s.options.findIndex((x) => x.label === prev.label) };
    }
    const old = s.options.find((x) => x.label === prev.label);
    if (old) old.votes = Math.max(0, old.votes - 1);
  }
  o.votes++;
  s.ballots[key] = { name, label: o.label };
  return { ok: true, text: prev ? `已改投「${o.label}」` : `已投給「${o.label}」`, choice };
}

export const poll = {
  type: 'poll', title: '投票', icon: '📊', size: { w: 0.3, h: 0.36 },
  state: () => ({
    question: '你最喜歡哪一個？',
    options: [{ label: '選項 A', votes: 0 }, { label: '選項 B', votes: 0 }, { label: '選項 C', votes: 0 }],
    ballots: {}, allowChange: true, hideResults: true,
  }),
  mount(body, ctx) {
    const s = ctx.state;
    s.ballots ||= {};
    const q = h('div', { class: 'poll-q' });
    const list = h('div', { class: 'poll-list' });
    const live = h('div', { class: 'poll-live' });
    const liveBtn = h('button', { class: 'btn small primary', onclick: toggleLive });
    const hint = h('span', { class: 'muted' });
    const wrap = h('div', { class: 'poll' },
      h('div', { class: 'poll-main' }, h('div', { class: 'poll-core' }, q, list), live),
      h('div', { class: 'poll-foot' }, hint, h('div', { class: 'row-btns' },
        liveBtn,
        h('button', { class: 'btn small', title: '題庫與投票紀錄：存題目、匯入、重複使用、查看與匯出結果', onclick: library }, '📚 題庫'),
        h('button', { class: 'btn small', onclick: reset }, '歸零'))));
    body.append(wrap);
    let lastQr = '';

    const payload = () => ({ question: s.question, options: s.options.map((o) => o.label), allowChange: s.allowChange !== false });
    const ballots = () => Object.keys(s.ballots).length;

    // 記錄目前結果到投票紀錄（有票、而且和上次記錄的不同時才記）；回傳是否有記錄
    async function recordResult() {
      if (!totalVotes(s) || s.recordedSig === resultSig(s)) return false;
      const st = await ctx.store.getSettings();
      st.pollResults ||= [];
      addResult(st.pollResults, makeResult(s, ctx.boardName?.() || ''));
      ctx.store.saveSettings();
      s.recordedSig = resultSig(s);
      ctx.save();
      return true;
    }

    // 換成題庫裡的題目：先記錄目前結果，再把票數與投票紀錄清空
    async function useItem(it) {
      if (await recordResult()) toast('已記錄上一題的結果');
      s.question = it.question;
      s.options = it.options.map((label) => ({ label, votes: 0 }));
      s.ballots = {};
      s.recordedSig = '';
      changed();
    }

    function library() {
      pollLibraryDialog(ctx.store, { onUse: useItem, useLabel: '使用這題', current: () => s, record: recordResult });
    }

    async function toggleLive() {
      if (ctx.vote.info()) {
        ctx.vote.close();
        if (await recordResult()) toast('已記錄投票結果（按「📚 題庫」→ 投票紀錄 可查看、匯出）');
        return;
      }
      try {
        liveBtn.disabled = true;
        ctx.fit({ w: 0.5, h: 0.55 }); // QR Code 要夠大，學生才掃得到
        await ctx.vote.open(payload());
      } catch (e) { toast(e.message); } finally { liveBtn.disabled = false; render(); }
    }
    async function reset() {
      if (!totalVotes(s) && !ballots()) return;
      const msg = `要把票數歸零嗎？${ballots() ? `${ballots()} 位學生的投票也會清除，學生可以重新投票。` : ''}目前的結果會先存到投票紀錄。`;
      if (!await confirmDialog(msg, '歸零')) return;
      await recordResult();
      s.options.forEach((o) => { o.votes = 0; });
      s.ballots = {};
      render(); ctx.save();
    }

    function renderLive(info) {
      wrap.classList.toggle('is-live', !!info);
      if (!info) { live.innerHTML = ''; lastQr = ''; return; }
      if (info.status !== 'online' || !info.code) {
        lastQr = '';
        live.innerHTML = '';
        live.append(h('div', { class: 'poll-wait' }, info.status === 'error'
          ? (info.local ? '伺服器沒有回應，正在重試…' : '無法連線到遙控伺服器，正在重試…') : '正在開放投票…'));
        return;
      }
      if (lastQr !== info.url) {
        lastQr = info.url;
        live.innerHTML = '';
        const qr = h('div', { class: 'poll-qr' });
        try {
          const code = window.qrcode(0, 'M');
          code.addData(info.url);
          code.make();
          qr.innerHTML = code.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
        } catch { qr.textContent = info.url; }
        live.append(qr,
          h('div', { class: 'poll-scan' }, '掃描 QR Code 投票'),
          h('div', { class: 'poll-url' }, info.url.replace(/^https?:\/\//, '')),
          /\/\/(localhost|127\.|\[::1\])/.test(info.url)
            ? h('div', { class: 'poll-warn' }, '⚠ 這個網址只有這台電腦能開啟，學生的手機連不到。請用校內 IP 開啟黑板樹，或改用桌面版') : null,
          h('div', { class: 'poll-count' }));
      }
      live.querySelector('.poll-count').textContent = `已投票 ${ballots()} 人．連線 ${info.voters} 人`;
    }

    function render() {
      const info = ctx.vote.info();
      const hide = !!info && s.hideResults;
      q.textContent = s.question;
      const total = s.options.reduce((a, o) => a + o.votes, 0);
      const max = Math.max(1, ...s.options.map((o) => o.votes));
      list.innerHTML = '';
      s.options.forEach((o, i) => list.append(h('button', {
        class: `poll-opt c${i % 8}`,
        onclick: () => { o.votes++; render(); ctx.save(); },
        oncontextmenu: (e) => { e.preventDefault(); o.votes = Math.max(0, o.votes - 1); render(); ctx.save(); },
      }, h('i', { style: { width: hide ? '0' : (o.votes / max) * 100 + '%' } }), h('span', null, o.label),
      hide ? null : h('b', null, `${o.votes}${total ? `（${Math.round((o.votes / total) * 100)}%）` : ''}`))));
      hint.textContent = hide ? '投票中，結束後顯示結果' : (info ? '學生投票中．點選項加一票' : '點選項加一票，右鍵減一票');
      liveBtn.textContent = info ? '■ 結束投票' : '📱 學生投票';
      liveBtn.classList.toggle('danger', !!info);
      liveBtn.classList.toggle('primary', !info);
      renderLive(info);
    }
    const unwatch = ctx.vote.watch(render);
    render();
    return {
      destroy: () => unwatch(),
      vote(name, choice) {
        const res = castVote(s, name, +choice);
        if (res.ok) { render(); ctx.save(); }
        return res;
      },
      remote: {
        view: () => ({ question: s.question, options: s.options }),
        act(a, { i } = {}) {
          const o = s.options[i];
          if (a === 'vote' && o) o.votes++;
          else if (a === 'unvote' && o) o.votes = Math.max(0, o.votes - 1);
          else if (a === 'reset') {
            // 手機按歸零：先記錄結果再清空
            recordResult().finally(() => { s.options.forEach((x) => { x.votes = 0; }); s.ballots = {}; render(); ctx.save(); });
            return;
          } else return;
          render(); ctx.save();
        },
      },
      settings: (c) => c.append(
        field('題目', h('input', { class: 'input', value: s.question, oninput: (e) => { s.question = e.target.value; changed(); } })),
        field('選項（每行一個）', h('textarea', { class: 'input', rows: 6, value: s.options.map((o) => o.label).join('\n'),
          oninput: (e) => {
            const labels = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean);
            s.options = labels.map((l, i) => ({ label: l, votes: s.options[i]?.label === l ? s.options[i].votes : 0 }));
            changed();
          } })),
        h('div', { class: 'row-btns' }, h('button', { class: 'btn', onclick: library }, '📚 題庫與投票紀錄…')),
        h('div', { class: 'set-sub' }, '學生投票'),
        checkbox('投票時隱藏票數（結束投票後才顯示結果）', s.hideResults, (v) => { s.hideResults = v; render(); ctx.save(); }),
        checkbox('允許學生改票', s.allowChange !== false, (v) => { s.allowChange = v; changed(); }),
        h('small', { class: 'muted' }, '同一個名字只算一票。學生不需要帳號，輸入名字後點選項即可。'),
        ballots() ? h('div', { class: 'poll-names' }, h('b', null, `已投票（${ballots()} 人）：`),
          Object.values(s.ballots).map((b) => b.name).join('、')) : null),
    };
    // 題目或選項改了：重畫並通知學生的頁面
    function changed() {
      render(); ctx.save();
      ctx.vote.update(payload());
    }
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

const pad2 = (n) => String(n).padStart(2, '0');
const fmtWhen = (at) => { const d = new Date(at); return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

// 座位表：依名單排座位，點兩個座位可以交換，也能隨機排座、隨機點名
// 「📚 座位紀錄」：每班可以存好幾組排法並標上科目或類型（seat-layouts.js），使用中的那一組換座位時自動存回
export const seats = {
  type: 'seats', title: '座位表', icon: '🪑', size: { w: 0.5, h: 0.55 },
  state: () => ({ names: '', listId: '', rows: 5, cols: 6, seats: [], flip: false, highlight: -1, showPhoto: true, layoutId: '', layoutLabel: '', layoutList: '' }),
  // 新開座位表時沿用上次關閉前的排列（app.js 的 addWidget；上次點名的人不帶過來）
  restoreLast: (st) => ({ ...st, highlight: -1 }),
  mount(body, ctx) {
    const s = ctx.state;
    const grid = h('div', { class: 'seats-grid' });
    const desk = h('div', { class: 'seats-desk' }, '講　台');
    const tag = h('button', { class: 'seats-tag', title: '目前使用的座位紀錄（換座位會自動存回這一組）', onclick: () => openLayouts() });
    const wrap = h('div', { class: 'seats' },
      h('div', { class: 'seats-bar' },
        h('button', { class: 'btn primary', onclick: () => shuffleSeats() }, '🔀 隨機排座位'),
        h('button', { class: 'btn', onclick: () => pick() }, '🎯 隨機點名'),
        h('button', { class: 'btn', title: '把座位排法存起來、標上科目或類型，之後一鍵換回', onclick: () => openLayouts() }, '📚 座位紀錄'),
        tag),
      desk, grid);
    body.append(wrap);
    let selected = -1;
    let anim = null;

    // ---- 座位紀錄
    const key = () => s.listId || '';
    const active = () => !!s.layoutId && (s.layoutList || '') === key(); // 換了班級名單就不算在使用那一組
    let memT = 0;
    // 使用中的那一組：座位改變後存回（稍等一下，連續交換只寫一次設定檔）
    function remember(now = false) {
      clearTimeout(memT); memT = 0;
      if (!active()) return;
      const run = async () => {
        memT = 0;
        const st = await ctx.store.getSettings().catch(() => null);
        if (!st || !active()) return;
        if (!findLayout(st, key(), s.layoutId)) { s.layoutId = ''; s.layoutLabel = ''; ctx.save(); render(); return; } // 那一組已被刪除
        if (updateLayout(st, key(), s.layoutId, s)) ctx.store.saveSettings();
      };
      if (now) run(); else memT = setTimeout(run, 800);
    }
    // 改變座位前先記下來，改完顯示「↶ 復原」
    function snapshot() {
      return JSON.parse(JSON.stringify({ rows: s.rows, cols: s.cols, seats: s.seats, flip: s.flip, highlight: s.highlight, layoutId: s.layoutId, layoutLabel: s.layoutLabel, layoutList: s.layoutList }));
    }
    function offerUndo(prev, text) {
      const undo = () => {
        remember(true); // 先把目前的存好，再換回去
        Object.assign(s, prev); selected = -1;
        sync(); ctx.save(); render(); remember();
        toast('已復原');
      };
      toast(h('span', null, text + '　', h('button', { class: 'toast-undo', onclick: undo }, '↶ 復原')), 10000);
    }
    function miniGrid(l) {
      const g = h('div', { class: 'sl-mini', style: { gridTemplateColumns: `repeat(${l.cols}, 1fr)` } });
      for (let i = 0; i < l.rows * l.cols; i++) g.append(h('span', { class: l.seats[i] ? '' : 'empty' }, l.seats[i] || ''));
      return g;
    }
    async function openLayouts() {
      remember(true);
      const st = await ctx.store.getSettings();
      if (s.listId && !linkedList(ctx)) return toast('找不到這個班級名單，請按右上角 ⚙ 重新選擇');
      if (!namesOf(ctx).length) return toast('請先按右上角 ⚙ 選擇班級名單');
      const input = h('input', { class: 'input', placeholder: '例如：數學、考試、分組活動', maxlength: MAX_LABEL });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveNew(); });
      const chips = h('div', { class: 'sl-tags' }, SEAT_TAGS.map((t) => h('button', { class: 'chip', onclick: () => { input.value = t; input.focus(); } }, t)));
      const box = h('div', { class: 'tn-list' });
      const intro = h('small', { class: 'muted' });
      async function saveNew() {
        const name = cleanLabel(input.value);
        if (!name) { input.focus(); return toast('請輸入名稱，或點一個常用的名稱'); }
        const same = layoutsOf(st, key()).find((l) => l.label === name);
        if (same && same.id !== s.layoutId && !await confirmDialog(`已經有「${name}」的座位紀錄，要用目前的座位取代它嗎？`, '取代', true)) return;
        const item = saveLayout(st, key(), s, name);
        if (!item) return;
        s.layoutId = item.id; s.layoutLabel = item.label; s.layoutList = key();
        ctx.save(); ctx.store.saveSettings(); render(); draw();
        input.value = '';
        toast(`已存成「${item.label}」，之後換座位會自動存回這一組`);
      }
      function use(l) {
        const prev = snapshot();
        Object.assign(s, applyLayout(l, namesOf(ctx)), { layoutId: l.id, layoutLabel: l.label, layoutList: key(), highlight: -1 });
        selected = -1;
        l.at = Date.now();
        sync(); ctx.save(); ctx.store.saveSettings(); render(); remember();
        dlg.close();
        offerUndo(prev, `已換成「${l.label}」的座位`);
      }
      function draw() {
        const list = layoutsOf(st, key());
        intro.textContent = active()
          ? `目前使用「${s.layoutLabel}」：換座位會自動存回這一組。要做另一種排法，先輸入新名稱存成新的一組，再開始調整。`
          : '把目前的座位存成一組，標上科目或類型。不同科目、考試、分組活動可以各有一種座位排法。';
        box.replaceChildren(...(list.length ? list.map((l) => {
          const on = active() && l.id === s.layoutId;
          return h('div', { class: 'tn-item' + (on ? ' on' : '') },
            h('div', { class: 'sl-head' }, h('b', null, '🏷 ' + l.label),
              h('small', { class: 'muted' }, `${l.rows} 排 × ${l.cols} 行・${fmtWhen(l.at)}${on ? '・目前使用中' : ''}`)),
            miniGrid(l),
            h('div', { class: 'tn-meta' }, h('small'),
              on ? null : h('button', { class: 'btn primary', onclick: () => use(l) }, '使用'),
              h('button', {
                class: 'btn', title: '改名稱', onclick: async () => {
                  const v = await promptDialog('座位紀錄的名稱（科目或類型）', l.label);
                  if (!v) return;
                  if (!renameLayout(st, key(), l.id, v)) return toast('名稱不能空白，也不能和其他紀錄同名');
                  if (on) { s.layoutLabel = l.label; ctx.save(); render(); }
                  ctx.store.saveSettings(); draw();
                },
              }, '✏️'),
              h('button', {
                class: 'btn', title: '刪除這組紀錄', onclick: async () => {
                  if (!await confirmDialog(`要刪除「${l.label}」的座位紀錄嗎？（座位表目前的座位不受影響）`, '刪除', true)) return;
                  deleteLayout(st, key(), l.id);
                  if (on) { s.layoutId = ''; s.layoutLabel = ''; ctx.save(); render(); }
                  ctx.store.saveSettings(); draw();
                },
              }, '🗑')));
        }) : [h('p', { class: 'muted' }, '還沒有座位紀錄。排好座位後，在上面輸入名稱（例如「數學」「考試」）存起來，之後就能一鍵換回。')]));
      }
      draw();
      const dlg = modal({
        title: '📚 座位紀錄', wide: true, actions: [{ label: '關閉' }],
        body: h('div', { class: 'stack' },
          intro,
          h('div', { class: 'sl-new' }, input, h('button', { class: 'btn primary', onclick: saveNew }, '💾 存成新的一組')),
          chips, box),
      });
      setTimeout(() => input.focus(), 50);
    }

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
      const prev = snapshot();
      // 人數少於座位時，空位也一起打散
      s.seats = shuffle([...list, ...Array(Math.max(0, total - list.length)).fill('')]);
      s.highlight = -1; selected = -1;
      sync(); ctx.save(); render(); remember();
      offerUndo(prev, active() ? `已重新排座位（會存到「${s.layoutLabel}」）` : '已重新排座位');
    }
    function swap(a, b) {
      if (a === b || a < 0 || b < 0 || a >= s.seats.length || b >= s.seats.length) return;
      [s.seats[a], s.seats[b]] = [s.seats[b], s.seats[a]];
      if (s.highlight === a) s.highlight = b; else if (s.highlight === b) s.highlight = a;
      ctx.save(); render(); remember();
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
      tag.textContent = active() ? '🏷 ' + s.layoutLabel : '';
      tag.classList.toggle('hidden', !active());
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
        }, ref ? seatPhoto(ctx, ref) : null, h('span', { class: 'seat-name' }, n)));
      }
    }
    const unwatch = watchRoster(ctx, () => { sync(); render(); remember(); });
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
      sync(); ctx.save(); render(); remember();
    };
    return {
      destroy: () => { clearTimeout(anim); if (memT) remember(true); unwatch(); },
      remote: {
        view: () => ({
          rows: s.rows, cols: s.cols, seats: s.seats, flip: s.flip, highlight: s.highlight, picking: !!anim, label: active() ? s.layoutLabel : '',
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
        c.append(namesEditor(ctx, () => { sync(); render(); showSize(); remember(); }),
          field('座位數', h('div', { class: 'stack' }, size,
            h('div', { class: 'row-btns' }, adj('− 排', -1, 0), adj('＋ 排', 1, 0), adj('− 行', 0, -1), adj('＋ 行', 0, 1)))),
          checkbox('老師視角（講台在下方）', s.flip, (v) => { s.flip = v; ctx.save(); render(); remember(); }),
          field('座位紀錄', h('div', { class: 'row-btns' },
            h('button', { class: 'btn', onclick: () => openLayouts() }, '📚 開啟座位紀錄')),
          '不同科目、考試、分組活動可以各存一種座位排法，一鍵換回。'),
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
        h('button', { class: 'btn', onclick: () => leaderboard() }, '🏆 排行榜'),
        h('button', { class: 'btn', onclick: async () => { if (await confirmDialog('要把卡片上的分數歸零嗎？（每日紀錄會保留，排行榜與匯出不受影響）', '歸零', true)) reset(); } }, '↺ 歸零')),
      grid));
    // 每日紀錄：舊版的課堂加分沒有，第一次開啟時把目前分數當作「先前累計」
    if (ensureDaily(s) && Object.keys(s.daily).length) ctx.save();
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
      logPoint(s.daily || (s.daily = {}), name, d);
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
    // 排行榜：累計、今天、指定區間，可以匯出 CSV
    function leaderboard() {
      ensureDaily(s);
      let mode = 'total';
      const today = dayKey();
      const custom = { from: today.slice(0, 8) + '01', to: today }; // 預設：這個月
      const box = h('div', { class: 'lb' });
      const range = () => (mode === 'total' ? RANGES.total() : mode === 'today' ? RANGES.today() : { ...custom });
      const medal = (p) => (p.total > 0 && p.rank <= 3 ? ['🥇', '🥈', '🥉'][p.rank - 1] : String(p.rank));
      const fmt = (v) => (v > 0 ? `+${v}` : String(v));
      function draw() {
        const r = range();
        const ranked = rankPeople(list(), totalsIn(s.daily, r));
        const date = (k) => h('input', {
          class: 'input', type: 'date', value: custom[k] || '', max: today,
          onchange: (e) => { custom[k] = e.target.value; draw(); },
        });
        box.replaceChildren(...[
          h('div', { class: 'seg lb-seg' }, [['total', '累計'], ['today', '今天'], ['range', '指定區間']].map(([v, label]) =>
            h('button', { class: mode === v ? 'on' : '', onclick: () => { mode = v; draw(); } }, label))),
          mode === 'range' ? h('div', { class: 'lb-range' }, date('from'), h('span', null, '～'), date('to')) : null,
          h('div', { class: 'lb-title' }, `${rangeLabel(mode, r)}　共 ${ranked.length} 人`),
          ranked.length
            ? h('ol', { class: 'lb-list' }, ranked.map((p) => h('li', { class: `lb-row${p.total > 0 && p.rank <= 3 ? ' top' + p.rank : ''}` },
              h('span', { class: 'lb-rank' }, medal(p)), h('span', { class: 'lb-no' }, `${p.no}號`),
              h('span', { class: 'lb-name' }, p.name), h('b', { class: 'lb-total' + (p.total < 0 ? ' neg' : '') }, fmt(p.total)))))
            : h('p', { class: 'muted' }, '請先按 ⚙ 選擇班級名單'),
          h('small', { class: 'muted' }, '「累計」包含所有日期的加減分；卡片上的「↺ 歸零」不會清除這裡的紀錄。'),
        ].filter(Boolean));
      }
      draw();
      modal({
        title: '🏆 課堂加分排行榜', body: box, wide: true,
        actions: [
          { label: '⬇ 匯出 CSV', onClick: () => { exportCsv(mode, range()); return false; } },
          { label: '完成', primary: true },
        ],
      });
    }
    async function exportCsv(mode, r) {
      const ps = list();
      if (!ps.length) return toast('請先按 ⚙ 選擇班級名單');
      const cls = linkedList(ctx)?.name || '課堂加分';
      const name = `${cls}_課堂加分_${rangeLabel(mode, r)}`.replace(/[\\/:*?"<>|（）\s]+/g, '_').replace(/_+$/, '');
      try {
        const ok = await saveTextFile(`${name}.csv`, leaderboardCsv(ps, s.daily || {}, r));
        if (ok) toast(typeof ok === 'string' ? `已匯出：${ok}` : '已匯出 CSV');
      } catch (e) { toast('匯出失敗：' + e.message); }
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
        checkbox('加減分時播放音效', s.sound, (v) => { s.sound = v; ctx.save(); }),
        field('加分紀錄', h('div', { class: 'row-btns' },
          h('button', { class: 'btn', onclick: () => leaderboard() }, '🏆 排行榜與匯出'),
          h('button', {
            class: 'btn danger', onclick: async () => {
              if (!await confirmDialog('要清除所有的每日加分紀錄嗎？排行榜會從零開始，卡片上目前的分數不受影響。清除後無法復原。', '清除紀錄', true)) return;
              s.daily = {}; ctx.save(); toast('已清除加分紀錄');
            },
          }, '清除加分紀錄')), '每次加減分都會記錄日期，排行榜可以看累計、今天或指定區間的總分。')),
    };
  },
};
