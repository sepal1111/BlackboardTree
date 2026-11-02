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
