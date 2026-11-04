// 時間類：時鐘日期、計時器、碼錶、考試時間
import { h, field, select, checkbox, promptDialog, timePicker } from '../ui.js';
import { beep, pad, fmtDuration, parseDuration, WEEKDAYS, parseHM, fmtHM, examSchedule, examStatus, examAttendance, seatNumbersOf, fmtSeats, fmtAttendance } from './util.js';
import { studentsOf, lastListId, rememberList } from '../roster.js';

// 時鐘日期：時間（數字／指針／不顯示）＋日期（一行／月曆／不顯示）
export const clock = {
  type: 'clock', title: '時鐘日期', icon: '🕒', size: { w: 0.24, h: 0.2 },
  state: () => ({ mode: 'digital', seconds: true, h24: true, date: 'line', roc: true }),
  mount(body, ctx) {
    const s = ctx.state;
    const digital = h('div', { class: 'clock-digital' });
    const hands = {};
    const svg = h('div', { class: 'clock-analog' });
    svg.innerHTML = `<svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="94" class="face"/>${
      Array.from({ length: 60 }, (_, i) => `<line x1="100" y1="${i % 5 ? 12 : 10}" x2="100" y2="${i % 5 ? 16 : 24}" class="${i % 5 ? 'tick' : 'tick big'}" transform="rotate(${i * 6} 100 100)"/>`).join('')
    }${Array.from({ length: 12 }, (_, i) => {
      const a = ((i + 1) * 30 - 90) * Math.PI / 180;
      return `<text x="${100 + 64 * Math.cos(a)}" y="${100 + 64 * Math.sin(a)}" class="num">${i + 1}</text>`;
    }).join('')}<line id="hh" x1="100" y1="100" x2="100" y2="52" class="hand h"/><line id="mm" x1="100" y1="100" x2="100" y2="30" class="hand m"/><line id="ss" x1="100" y1="112" x2="100" y2="24" class="hand s"/><circle cx="100" cy="100" r="5" class="pin"/></svg>`;
    ['hh', 'mm', 'ss'].forEach((k) => { hands[k] = svg.querySelector('#' + k); });
    const timeBox = h('div', { class: 'clk-time' });
    const dateBox = h('div');
    const wrap = h('div', { class: 'clock' });
    body.append(wrap);
    let shown = ''; // 目前顯示的日期，換日時才重畫

    // 時間和日期不能都關掉
    const mode = () => (s.mode === 'none' && s.date === 'none' ? 'digital' : s.mode);
    function layout() {
      const m = mode();
      wrap.innerHTML = '';
      wrap.className = `clock date-${s.date}${m === 'none' ? ' no-time' : ''}`;
      timeBox.innerHTML = '';
      if (m !== 'none') { timeBox.append(m === 'analog' ? svg : digital); wrap.append(timeBox); }
      dateBox.className = s.date === 'line' && m !== 'none' ? 'clock-date' : 'clk-cal';
      if (s.date !== 'none') wrap.append(dateBox);
      shown = '';
      tick();
    }
    function renderDate(d) {
      const key = `${s.date}|${s.roc}|${mode()}|${d.toDateString()}`;
      if (key === shown) return;
      shown = key;
      dateBox.innerHTML = dateHtml(d, s.date, s.roc, mode() !== 'none');
    }
    function tick() {
      const d = new Date();
      const m = mode();
      if (m === 'analog') {
        const sec = d.getSeconds(), min = d.getMinutes() + sec / 60, hr = (d.getHours() % 12) + min / 60;
        hands.hh.setAttribute('transform', `rotate(${hr * 30} 100 100)`);
        hands.mm.setAttribute('transform', `rotate(${min * 6} 100 100)`);
        hands.ss.setAttribute('transform', `rotate(${sec * 6} 100 100)`);
        hands.ss.style.display = s.seconds ? '' : 'none';
      } else if (m === 'digital') {
        let hr = d.getHours();
        let suffix = '';
        if (!s.h24) { suffix = hr < 12 ? '上午 ' : '下午 '; hr = hr % 12 || 12; }
        digital.innerHTML = `<small>${suffix}</small>${s.h24 ? pad(hr) : hr}<span class="blink">:</span>${pad(d.getMinutes())}${s.seconds ? `<span class="sec">${pad(d.getSeconds())}</span>` : ''}`;
      }
      if (s.date !== 'none') renderDate(d);
    }
    layout();
    const t = setInterval(tick, 500);
    const set = (k) => (v) => { s[k] = v; layout(); ctx.save(); };
    return {
      destroy: () => clearInterval(t),
      settings: (c) => c.append(
        field('時間', select([['digital', '數字'], ['analog', '指針'], ['none', '不顯示']], s.mode, set('mode'))),
        checkbox('顯示秒數', s.seconds, set('seconds')),
        checkbox('24 小時制', s.h24, set('h24')),
        field('日期', select([['line', '一行文字'], ['month', '月曆'], ['none', '不顯示']], s.date, set('date'))),
        checkbox('使用民國年', s.roc, set('roc')),
      ),
    };
  },
};

// 日期的 HTML：withTime 為 false 時把日期放大當主角
export function dateHtml(d, kind, roc, withTime) {
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
  const week = `星期${WEEKDAYS[d.getDay()]}`;
  const year = roc ? `民國 ${y - 1911} 年` : `${y} 年`;
  if (kind === 'line' && withTime) return `${m + 1}月${day}日 ${week}`;
  const head = withTime
    ? `<div class="cal-line"><span>${year}</span> ${m + 1}月${day}日 ${week}</div>`
    : `<div class="cal-head"><div class="cal-year">${year} ${m + 1} 月</div><div class="cal-day">${day}</div><div class="cal-week">${week}</div></div>`;
  if (kind !== 'month') return head;
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  let grid = '<div class="cal-grid">' + WEEKDAYS.map((w) => `<b>${w}</b>`).join('');
  for (let i = 0; i < first; i++) grid += '<span></span>';
  for (let i = 1; i <= days; i++) grid += `<span class="${i === day ? 'today' : ''}">${i}</span>`;
  return head + grid + '</div>';
}

export const timer = {
  type: 'timer', title: '計時器', icon: '⏳', size: { w: 0.28, h: 0.32 },
  state: () => ({ duration: 300, remaining: 300, endAt: null, sound: true }),
  mount(body, ctx) {
    const s = ctx.state;
    let fired = false;
    const ring = h('div', { class: 'timer-ring' });
    const time = h('button', { class: 'timer-time', title: '點一下修改時間' });
    const startBtn = h('button', { class: 'btn primary big' });
    const presets = h('div', { class: 'chips' }, [1, 3, 5, 10, 15, 30].map((m) =>
      h('button', { class: 'chip', onclick: () => set(m * 60) }, m + ' 分')));
    const wrap = h('div', { class: 'timer' }, ring, time,
      h('div', { class: 'timer-ctrl' },
        h('button', { class: 'btn', onclick: () => add(-60) }, '−1 分'),
        startBtn,
        h('button', { class: 'btn', onclick: () => add(60) }, '+1 分'),
        h('button', { class: 'btn', title: '重設', onclick: () => set(s.duration) }, '↺')),
      presets);
    body.append(wrap);

    const left = () => (s.endAt ? (s.endAt - Date.now()) / 1000 : s.remaining);
    function set(sec) {
      s.duration = sec; s.remaining = sec; s.endAt = null; fired = false;
      render(); ctx.save();
    }
    function add(sec) {
      if (s.endAt) s.endAt = Math.max(Date.now(), s.endAt + sec * 1000);
      else s.remaining = Math.max(0, s.remaining + sec);
      if (s.remaining > s.duration) s.duration = s.remaining;
      fired = false; render(); ctx.save();
    }
    function toggle() {
      if (s.endAt) { s.remaining = Math.max(0, left()); s.endAt = null; } else {
        if (s.remaining <= 0) s.remaining = s.duration;
        s.endAt = Date.now() + s.remaining * 1000; fired = false;
        beep({ times: 0 }); // 讓瀏覽器允許之後播放音效
      }
      render(); ctx.save();
    }
    startBtn.onclick = toggle;
    time.onclick = async () => {
      const v = await promptDialog('設定時間（分:秒，例如 5:00 或 90 代表 90 分鐘）', fmtDuration(s.duration));
      const sec = v && parseDuration(v);
      if (sec) set(sec);
    };
    function render() {
      const l = left();
      const done = l <= 0;
      time.textContent = fmtDuration(l);
      wrap.classList.toggle('done', done && !!s.endAt);
      startBtn.textContent = s.endAt ? '暫停' : '開始';
      const pct = s.duration ? Math.max(0, Math.min(1, l / s.duration)) : 0;
      ring.style.setProperty('--p', pct);
      if (done && s.endAt && !fired) {
        fired = true;
        if (s.sound) beep({ times: 4 });
      }
    }
    render();
    const t = setInterval(render, 200);
    return {
      destroy: () => clearInterval(t),
      settings: (c) => c.append(checkbox('時間到時播放音效', s.sound, (v) => { s.sound = v; ctx.save(); })),
      remote: {
        view: () => ({ duration: s.duration, remaining: s.remaining, endAt: s.endAt }),
        act(a, { sec } = {}) {
          if (a === 'toggle') toggle();
          else if (a === 'add') add(+sec || 0);
          else if (a === 'reset') set(s.duration);
          else if (a === 'set' && +sec > 0) set(+sec);
        },
      },
    };
  },
};

export const stopwatch = {
  type: 'stopwatch', title: '碼錶', icon: '⏱️', size: { w: 0.26, h: 0.3 },
  state: () => ({ startAt: null, elapsed: 0, laps: [] }),
  mount(body, ctx) {
    const s = ctx.state;
    const time = h('div', { class: 'sw-time' });
    const startBtn = h('button', { class: 'btn primary big' });
    const laps = h('ol', { class: 'sw-laps' });
    body.append(h('div', { class: 'stopwatch' }, time,
      h('div', { class: 'timer-ctrl' },
        startBtn,
        h('button', { class: 'btn', onclick: () => { s.laps.unshift(now()); ctx.save(); renderLaps(); } }, '分段'),
        h('button', { class: 'btn', onclick: () => { s.startAt = null; s.elapsed = 0; s.laps = []; ctx.save(); renderLaps(); render(); } }, '歸零')),
      laps));
    const now = () => s.elapsed + (s.startAt ? Date.now() - s.startAt : 0);
    const fmt = (ms) => `${fmtDuration(Math.floor(ms / 1000) - 0.0001)}<small>.${pad(Math.floor((ms % 1000) / 10))}</small>`;
    startBtn.onclick = () => {
      if (s.startAt) { s.elapsed = now(); s.startAt = null; } else s.startAt = Date.now();
      ctx.save(); render();
    };
    function renderLaps() {
      laps.innerHTML = s.laps.map((l, i) => `<li><span>第 ${s.laps.length - i} 段</span><b>${fmt(l)}</b></li>`).join('');
    }
    function render() {
      time.innerHTML = fmt(now());
      startBtn.textContent = s.startAt ? '暫停' : (s.elapsed ? '繼續' : '開始');
    }
    renderLaps(); render();
    const t = setInterval(render, 50);
    return {
      destroy: () => clearInterval(t),
      remote: {
        view: () => ({ startAt: s.startAt, elapsed: s.elapsed }),
        act(a) {
          if (a === 'toggle') startBtn.click();
          else if (a === 'lap') { s.laps.unshift(now()); ctx.save(); renderLaps(); }
          else if (a === 'reset') { s.startAt = null; s.elapsed = 0; s.laps = []; ctx.save(); renderLaps(); render(); }
        },
      },
    };
  },
};

// 考試時間：設定各節考試的科目與起訖時間，依照現在時間自動顯示這一節的倒數
// state.sessions：[{ id, subject, start: '08:10', end: '08:50' }]
// 人數統計：listId 連結班級名單（null＝還沒選過，''＝自己輸入應到人數 expected），absent 是缺考的座號
export const exam = {
  type: 'exam', title: '考試時間', icon: '📝', size: { w: 0.36, h: 0.42 },
  state: () => ({ title: '', sessions: [], warn: 5, sound: true, clock: true, listId: null, expected: 0, absent: [] }),
  mount(body, ctx) {
    const s = ctx.state;
    const el = {
      title: h('div', { class: 'exam-name' }),
      subject: h('div', { class: 'exam-subject' }),
      range: h('div', { class: 'exam-range' }),
      label: h('div', { class: 'exam-label' }),
      time: h('div', { class: 'exam-time' }),
      bar: h('div', { class: 'exam-bar' }),
      next: h('div', { class: 'exam-next' }),
      att: h('div', { class: 'exam-att' }),
      setup: h('button', { class: 'btn primary', onclick: () => body.closest('.widget')?.querySelector('[data-act=settings]')?.click() }, '⚙ 設定考試科目與時間'),
      clock: h('div', { class: 'exam-clock' }),
    };
    const wrap = h('div', { class: 'exam' }, ...Object.values(el));
    body.append(wrap);

    // 全班座號：連結班級名單時用名單的座號，否則 1～應到人數
    const classList = () => (s.listId ? ctx.store.settings?.classLists?.find((l) => l.id === s.listId) || null : null);
    const seatList = () => {
      const l = classList();
      if (l) return seatNumbersOf(studentsOf(l));
      return Array.from({ length: Math.max(0, Math.min(99, +s.expected || 0)) }, (_, i) => i + 1);
    };
    const attendance = () => examAttendance(seatList(), s.absent);
    function drawAtt() {
      const a = attendance();
      el.att.replaceChildren(...(a.expected ? [
        h('span', null, '應到 ', h('b', null, a.expected), ' 人'),
        h('span', null, '實到 ', h('b', null, a.present), ' 人'),
        // 缺考 2 人，5號、12號
        h('span', { class: a.absent.length ? 'miss' : '' }, '缺考 ', h('b', null, a.absent.length), ' 人',
          a.absent.length ? ['，', h('b', null, fmtSeats(a.absent))] : null),
      ] : []));
    }
    function toggleAbsent(no) {
      no = +no;
      if (!seatList().includes(no)) return;
      const set = new Set((s.absent || []).map(Number));
      if (set.has(no)) set.delete(no); else set.add(no);
      s.absent = [...set].sort((a, b) => a - b);
      changed();
    }
    // 第一次使用：自動帶入上次用過的班級；名單載入或修改後重新計算人數
    const onSettings = () => { drawAtt(); ctx.push?.(); };
    ctx.store.addEventListener('settings', onSettings);
    ctx.store.getSettings().then((st) => {
      if (s.listId == null) {
        const last = lastListId();
        s.listId = st.classLists.some((l) => l.id === last) ? last : '';
        ctx.save();
      }
      onSettings();
    }).catch(() => {});

    let prev = null; // 上一次畫面的狀態：用來判斷「剛進入提醒時間」「剛結束」才響鈴，開啟白板時不會亂響
    function render() {
      const now = new Date();
      const st = examStatus(s.sessions, now);
      const x = st.session;
      const warnSec = (+s.warn || 0) * 60;
      const warning = st.phase === 'during' && warnSec > 0 && st.left <= warnSec;
      wrap.className = `exam phase-${st.phase}${warning ? ' warning' : ''}`;
      el.title.textContent = s.title || '';
      el.clock.textContent = s.clock ? `現在時間 ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` : '';
      el.subject.textContent = st.phase === 'empty' ? '考試時間'
        : st.phase === 'done' ? '今天的考試都結束了' : (x.subject || '考試');
      el.range.textContent = x && st.phase !== 'done' ? `${fmtHM(x.s)} – ${fmtHM(x.e)}` : '';
      el.label.textContent = {
        empty: '還沒有設定考試', during: '距離考試結束', ended: '考試結束，請停筆',
        before: st.first ? '距離考試開始' : '下一節考試開始還有', done: '',
      }[st.phase];
      el.time.textContent = st.phase === 'during' || st.phase === 'before' ? fmtDuration(st.left) : '';
      el.bar.style.setProperty('--p', st.phase === 'during' ? st.left / st.total : 0);
      const nx = st.phase === 'during' || st.phase === 'ended' ? st.next : null;
      el.next.textContent = nx ? `下一節：${nx.subject || '考試'} ${fmtHM(nx.s)} – ${fmtHM(nx.e)}` : '';
      el.setup.hidden = st.phase !== 'empty';

      const key = x ? `${x.id || x.subject}|${x.start}|${x.end}` : '';
      if (prev && s.sound) {
        if (warning && !(prev.warning && prev.key === key)) beep({ times: 2 });
        if (st.phase === 'ended' && !(prev.phase === 'ended' && prev.key === key)) beep({ times: 4 });
      }
      prev = { phase: st.phase, key, warning };
    }
    drawAtt();
    render();
    const t = setInterval(render, 250);
    // 修改設定後不要因為「狀態改變」而響鈴
    const changed = () => { ctx.save(); ctx.push?.(); prev = null; drawAtt(); render(); };

    function settings(c) {
      const rows = h('div', { class: 'exam-rows' });
      const time = (x, k) => timePicker(x[k] || '', (v) => { x[k] = v; changed(); mark(); });
      function mark() {
        rows.querySelectorAll('.exam-row').forEach((r, i) => {
          const x = s.sessions[i];
          r.classList.toggle('bad', !(parseHM(x.start) != null && parseHM(x.end) > parseHM(x.start)));
        });
      }
      function draw() {
        rows.replaceChildren(...s.sessions.map((x, i) => h('div', { class: 'exam-row' },
          h('input', { class: 'input subj', value: x.subject || '', placeholder: '科目（例如：國語）', oninput: (e) => { x.subject = e.target.value; changed(); } }),
          time(x, 'start'), h('span', null, '–'), time(x, 'end'),
          h('button', { class: 'btn', title: '刪除這一節', onclick: () => { s.sessions.splice(i, 1); changed(); draw(); } }, '✕'))));
        if (!s.sessions.length) rows.append(h('p', { class: 'muted' }, '還沒有考試，按「＋ 新增一節」開始設定。'));
        mark();
      }
      function add() {
        const last = examSchedule(s.sessions).pop();
        const d = new Date();
        const start = last ? last.e + 10 : Math.ceil((d.getHours() * 60 + d.getMinutes() + 1) / 5) * 5;
        s.sessions.push({ id: Math.random().toString(36).slice(2, 10), subject: '', start: fmtHM(start), end: fmtHM(start + 40) });
        changed(); draw();
        rows.querySelector('.exam-row:last-child .subj')?.focus();
      }
      draw();
      c.append(
        field('考試名稱（可不填）', h('input', { class: 'input', value: s.title || '', placeholder: '例如：第一次段考', oninput: (e) => { s.title = e.target.value; changed(); } })),
        h('div', { class: 'field' }, h('span', null, '考試科目與時間'), rows,
          h('div', { class: 'row-btns' }, h('button', { class: 'btn', onclick: add }, '＋ 新增一節')),
          h('small', null, '依照這台電腦的時間自動切換：考試前倒數開始、考試中倒數結束，結束後自動換到下一節。時間錯誤（結束早於開始）的那一節會標成紅色，不會顯示。')),
        field('結束前提醒', select([[0, '不提醒'], [1, '1 分鐘'], [3, '3 分鐘'], [5, '5 分鐘'], [10, '10 分鐘'], [15, '15 分鐘']], s.warn, (v) => { s.warn = +v; changed(); }),
          '剩下這些時間時，倒數會變成紅色'),
        checkbox('提醒與考試結束時響鈴', s.sound, (v) => { s.sound = v; changed(); }),
        checkbox('顯示現在時間', s.clock, (v) => { s.clock = v; changed(); }),
        attSettings(),
      );
    }

    // 人數統計：選班級（或自己輸入應到人數），點座號標記缺考
    function attSettings() {
      const box = h('div', { class: 'field exam-att-set' });
      async function draw() {
        const st = await ctx.store.getSettings().catch(() => ({ classLists: [] }));
        const lists = st.classLists || [];
        const linked = classList();
        const a = attendance();
        const sum = fmtAttendance(a);
        box.replaceChildren(...[ // replaceChildren 會把 null 變成文字「null」，所以先濾掉
          h('span', null, '人數統計'),
          select([['', '✏️ 自己輸入應到人數'], ...lists.map((l) => [l.id, `👥 ${l.name}（${studentsOf(l).length} 人）`])], linked ? linked.id : '', (v) => {
            s.listId = v; s.absent = []; rememberList(v); changed(); draw(); // 換班級時缺考重新點選
          }),
          linked ? null : h('label', { class: 'row-btns att-row' }, '應到',
            h('input', {
              class: 'input att-num', type: 'number', min: 0, max: 99, value: s.expected || '', placeholder: '人數',
              onchange: (e) => { s.expected = Math.max(0, Math.min(99, parseInt(e.target.value, 10) || 0)); changed(); draw(); },
            }), '人'),
          h('small', null, a.expected ? '點選缺考的座號（再點一下取消），手機遙控也可以點選。' : '設定應到人數後，白板上會顯示應到、實到人數與缺考座號。'),
          a.expected ? h('div', { class: 'seat-pick' }, a.seats.map((no) => h('button', {
            type: 'button', class: 'seat-chip' + (a.absent.includes(no) ? ' off' : ''),
            title: a.absent.includes(no) ? '缺考，點一下改為到考' : '點一下標記缺考',
            onclick: () => { toggleAbsent(no); draw(); },
          }, no))) : null,
          a.expected ? h('div', { class: 'row-btns' }, h('b', { class: 'att-sum' }, sum),
            a.absent.length ? h('button', { type: 'button', class: 'btn', onclick: () => { s.absent = []; changed(); draw(); } }, '全部到考') : null) : null].filter(Boolean));
      }
      draw();
      return box;
    }

    // 延長目前這一節（例如考卷晚發），也可以在剛結束的 60 秒內延長
    function extend(min) {
      const st = examStatus(s.sessions);
      if (st.phase !== 'during' && st.phase !== 'ended') return;
      const x = s.sessions.find((y) => (st.session.id ? y.id === st.session.id : y.start === st.session.start && y.end === st.session.end));
      if (!x) return;
      x.end = fmtHM(parseHM(x.end) + min);
      changed();
    }

    return {
      destroy: () => { clearInterval(t); ctx.store.removeEventListener('settings', onSettings); },
      settings,
      remote: {
        view: () => { const a = attendance(); return { title: s.title, sessions: s.sessions, warn: s.warn, seats: a.seats, absent: a.absent }; },
        act(a, { min, no } = {}) {
          if (a === 'extend' && +min > 0 && +min <= 60) extend(+min);
          else if (a === 'absent') toggleAbsent(no);
          else if (a === 'allPresent') { s.absent = []; changed(); }
        },
      },
    };
  },
};
