// 小工具共用函式
let audioCtx;
export function beep({ times = 3, freq = 880, dur = 0.18, gap = 0.12 } = {}) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime + 0.02;
    for (let i = 0; i < times; i++) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      const s = t0 + i * (dur + gap);
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.4, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
      o.connect(g).connect(audioCtx.destination);
      o.start(s);
      o.stop(s + dur + 0.02);
    }
  } catch { /* 沒有音效裝置 */ }
}

export const pad = (n, l = 2) => String(n).padStart(l, '0');

export function fmtDuration(sec, showHours = false) {
  sec = Math.max(0, Math.ceil(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h || showHours ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function parseDuration(str) {
  const parts = String(str).trim().split(/[:：\s]+/).map(Number);
  if (parts.some(isNaN) || !parts.length) return null;
  if (parts.length === 1) return parts[0] * 60;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const splitNames = (text) => String(text || '').split(/[\n,，、]+/).map((s) => s.trim()).filter(Boolean);

export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

// 觀察元素大小變化。在回呼裡改版面會讓瀏覽器回報「ResizeObserver loop」，
// 所以延到下一個畫格再執行，而且大小沒變時不重複處理；回傳停止觀察的函式
export function observeSize(el, fn) {
  let frame = 0, last = '';
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const key = el.clientWidth + 'x' + el.clientHeight;
      if (key === last) return;
      last = key;
      fn();
    });
  });
  ro.observe(el);
  return () => { cancelAnimationFrame(frame); ro.disconnect(); };
}

// ---- 考試時間（教室電腦的小工具與手機遙控頁共用）
// 時間用「08:10」格式存，換成從午夜起算的分鐘數；格式錯誤回傳 null
export function parseHM(str) {
  const m = /^(\d{1,2})\s*[:：]\s*(\d{2})$/.exec(String(str ?? '').trim());
  if (!m) return null;
  const hr = +m[1], min = +m[2];
  return hr < 24 && min < 60 ? hr * 60 + min : null;
}
export const fmtHM = (min) => `${pad(Math.floor(Math.max(0, Math.min(min, 1439)) / 60))}:${pad(Math.max(0, Math.min(min, 1439)) % 60)}`;

// 時間正確的考試，依開始時間排序；s、e 是開始、結束的分鐘數
export function examSchedule(sessions) {
  return (Array.isArray(sessions) ? sessions : [])
    .map((x) => ({ ...x, s: parseHM(x?.start), e: parseHM(x?.end) }))
    .filter((x) => x.s != null && x.e != null && x.e > x.s)
    .sort((a, b) => a.s - b.s || a.e - b.e);
}

// 現在是哪一節考試、狀態與倒數秒數
//   empty：沒有設定；before：考試前或兩節之間，left = 距離下一節開始
//   during：考試中，left = 距離結束，total = 這節的長度；ended：剛結束（60 秒內），提醒停筆
//   done：今天的考試都結束了
export const EXAM_ENDED_SECONDS = 60;
export function examStatus(sessions, now = new Date()) {
  const list = examSchedule(sessions);
  if (!list.length) return { phase: 'empty', list };
  const t = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000;
  const during = list.find((x) => t >= x.s * 60 && t < x.e * 60);
  if (during) {
    const i = list.indexOf(during);
    return { phase: 'during', session: during, index: i, list, left: during.e * 60 - t, total: (during.e - during.s) * 60, next: list[i + 1] || null };
  }
  const ended = list.filter((x) => t >= x.e * 60 && t - x.e * 60 < EXAM_ENDED_SECONDS).pop();
  const nextIdx = list.findIndex((x) => t < x.s * 60);
  const next = nextIdx >= 0 ? list[nextIdx] : null;
  if (ended) return { phase: 'ended', session: ended, index: list.indexOf(ended), list, left: 0, next };
  if (next) return { phase: 'before', session: next, index: nextIdx, list, left: next.s * 60 - t, first: !list.some((x) => t >= x.e * 60), next };
  return { phase: 'done', session: list[list.length - 1], index: list.length - 1, list };
}

// 考試人數：seats 是全班的座號，absent 是缺考的座號；不在名單裡的座號不算
export function examAttendance(seats, absent) {
  const all = [...new Set((Array.isArray(seats) ? seats : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  const set = new Set(all);
  const miss = [...new Set((Array.isArray(absent) ? absent : []).map(Number))].filter((n) => set.has(n)).sort((a, b) => a - b);
  return { seats: all, expected: all.length, present: all.length - miss.length, absent: miss };
}

// 學生名單的座號；沒有座號的學生接在最大座號後面編號，人數才不會算少
export function seatNumbersOf(students) {
  const list = Array.isArray(students) ? students : [];
  const nums = list.map((s) => { const n = parseInt(s?.no, 10); return Number.isInteger(n) && n > 0 ? n : null; });
  let next = Math.max(0, ...nums.filter(Boolean));
  return nums.map((n) => n ?? ++next);
}

// 缺考座號「5號、12號」；人數統計「應到 30 人　實到 28 人　缺考 2 人，5號、12號」
export const fmtSeats = (nums) => nums.map((n) => n + '號').join('、');
export const fmtAbsent = (a) => `缺考 ${a.absent.length} 人${a.absent.length ? '，' + fmtSeats(a.absent) : ''}`;
export const fmtAttendance = (a) => `應到 ${a.expected} 人　實到 ${a.present} 人　${fmtAbsent(a)}`;
