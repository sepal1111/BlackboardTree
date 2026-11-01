// 時間類：時鐘、計時器、碼錶、日期
import { h, field, select, checkbox, promptDialog } from '../ui.js';
import { beep, pad, fmtDuration, parseDuration, WEEKDAYS } from './util.js';

export const clock = {
  type: 'clock', title: '時鐘', icon: '🕒', size: { w: 0.24, h: 0.2 },
  state: () => ({ mode: 'digital', seconds: true, h24: true, date: true }),
  mount(body, ctx) {
    const s = ctx.state;
    const digital = h('div', { class: 'clock-digital' });
    const dateEl = h('div', { class: 'clock-date' });
    const hands = {};
    const svg = h('div', { class: 'clock-analog' });
    svg.innerHTML = `<svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="94" class="face"/>${
      Array.from({ length: 60 }, (_, i) => `<line x1="100" y1="${i % 5 ? 12 : 10}" x2="100" y2="${i % 5 ? 16 : 24}" class="${i % 5 ? 'tick' : 'tick big'}" transform="rotate(${i * 6} 100 100)"/>`).join('')
    }${Array.from({ length: 12 }, (_, i) => {
      const a = ((i + 1) * 30 - 90) * Math.PI / 180;
      return `<text x="${100 + 64 * Math.cos(a)}" y="${100 + 64 * Math.sin(a)}" class="num">${i + 1}</text>`;
    }).join('')}<line id="hh" x1="100" y1="100" x2="100" y2="52" class="hand h"/><line id="mm" x1="100" y1="100" x2="100" y2="30" class="hand m"/><line id="ss" x1="100" y1="112" x2="100" y2="24" class="hand s"/><circle cx="100" cy="100" r="5" class="pin"/></svg>`;
    ['hh', 'mm', 'ss'].forEach((k) => { hands[k] = svg.querySelector('#' + k); });
    const wrap = h('div', { class: 'clock' });
    body.append(wrap);

    function layout() {
      wrap.innerHTML = '';
      if (s.mode === 'analog') wrap.append(svg); else wrap.append(digital);
      if (s.date) wrap.append(dateEl);
      tick();
    }
    function tick() {
      const d = new Date();
      if (s.mode === 'analog') {
        const sec = d.getSeconds(), min = d.getMinutes() + sec / 60, hr = (d.getHours() % 12) + min / 60;
        hands.hh.setAttribute('transform', `rotate(${hr * 30} 100 100)`);
        hands.mm.setAttribute('transform', `rotate(${min * 6} 100 100)`);
        hands.ss.setAttribute('transform', `rotate(${sec * 6} 100 100)`);
        hands.ss.style.display = s.seconds ? '' : 'none';
      } else {
        let hr = d.getHours();
        let suffix = '';
        if (!s.h24) { suffix = hr < 12 ? '上午 ' : '下午 '; hr = hr % 12 || 12; }
        digital.innerHTML = `<small>${suffix}</small>${s.h24 ? pad(hr) : hr}<span class="blink">:</span>${pad(d.getMinutes())}${s.seconds ? `<span class="sec">${pad(d.getSeconds())}</span>` : ''}`;
      }
      dateEl.textContent = `${d.getMonth() + 1}月${d.getDate()}日 星期${WEEKDAYS[d.getDay()]}`;
    }
    layout();
    const t = setInterval(tick, 500);
    return {
      destroy: () => clearInterval(t),
      settings: (c) => c.append(
        field('樣式', select([['digital', '數字'], ['analog', '指針']], s.mode, (v) => { s.mode = v; layout(); ctx.save(); })),
        checkbox('顯示秒數', s.seconds, (v) => { s.seconds = v; layout(); ctx.save(); }),
        checkbox('24 小時制', s.h24, (v) => { s.h24 = v; layout(); ctx.save(); }),
        checkbox('顯示日期', s.date, (v) => { s.date = v; layout(); ctx.save(); }),
      ),
    };
  },
};

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

export const calendar = {
  type: 'calendar', title: '日期', icon: '📅', size: { w: 0.22, h: 0.36 },
  state: () => ({ roc: true, month: true }),
  mount(body, ctx) {
    const s = ctx.state;
    const wrap = h('div', { class: 'cal' });
    body.append(wrap);
    function render() {
      const d = new Date();
      const y = d.getFullYear(), m = d.getMonth();
      const first = new Date(y, m, 1).getDay();
      const days = new Date(y, m + 1, 0).getDate();
      let grid = '';
      if (s.month) {
        grid = '<div class="cal-grid">' + WEEKDAYS.map((w) => `<b>${w}</b>`).join('');
        for (let i = 0; i < first; i++) grid += '<span></span>';
        for (let i = 1; i <= days; i++) grid += `<span class="${i === d.getDate() ? 'today' : ''}">${i}</span>`;
        grid += '</div>';
      }
      wrap.innerHTML = `<div class="cal-head"><div class="cal-year">${s.roc ? `民國 ${y - 1911} 年` : `${y} 年`} ${m + 1} 月</div>
        <div class="cal-day">${d.getDate()}</div><div class="cal-week">星期${WEEKDAYS[d.getDay()]}</div></div>${grid}`;
    }
    render();
    const t = setInterval(render, 60000);
    return {
      destroy: () => clearInterval(t),
      settings: (c) => c.append(
        checkbox('使用民國年', s.roc, (v) => { s.roc = v; render(); ctx.save(); }),
        checkbox('顯示月曆', s.month, (v) => { s.month = v; render(); ctx.save(); }),
      ),
    };
  },
};
