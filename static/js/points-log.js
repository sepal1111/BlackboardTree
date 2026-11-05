// 課堂加分的每日紀錄、排行榜與匯出
// state.daily = { 'YYYY-MM-DD': { 姓名: 當天的淨分數 } }；每天只存每人的合計，一學期下來資料也很小
// 「↺ 歸零」只清目前卡片上的分數（state.scores），每日紀錄保留，排行榜與匯出不受影響

const pad = (n) => String(n).padStart(2, '0');
export const OLD_KEY = '0000-00-00'; // 有每日紀錄以前的分數（沒有日期，只算進「累計」）
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const dayLabel = (k) => (k === OLD_KEY ? '先前累計' : k.slice(5).replace('-', '/'));

// 記錄一次加減分
export function logPoint(daily, name, d, date = new Date()) {
  if (!name || !d) return;
  const k = dayKey(date);
  const day = daily[k] || (daily[k] = {});
  const v = (day[name] || 0) + d;
  if (v) day[name] = v; else delete day[name];
  if (!Object.keys(day).length) delete daily[k];
}

// 舊的課堂加分沒有每日紀錄：把目前的分數當作「先前累計」，排行榜的累計才不會少算
export function ensureDaily(state) {
  if (state.daily && typeof state.daily === 'object') return false;
  state.daily = {};
  const old = Object.entries(state.scores || {}).filter(([, v]) => +v);
  if (old.length) state.daily[OLD_KEY] = Object.fromEntries(old);
  return true;
}

// 範圍：{ from, to } 都是 'YYYY-MM-DD'（含頭尾），沒填代表不限
export const RANGES = {
  total: () => ({}),
  today: (now = new Date()) => ({ from: dayKey(now), to: dayKey(now) }),
};
const inRange = (k, { from = '', to = '' } = {}) => (!from || k >= from) && (!to || k <= to);
export const daysIn = (daily, range) => Object.keys(daily || {}).filter((k) => inRange(k, range)).sort();

// 範圍內每個人的總分
export function totalsIn(daily, range) {
  const out = {};
  for (const k of daysIn(daily, range)) for (const [name, v] of Object.entries(daily[k] || {})) out[name] = (out[name] || 0) + (+v || 0);
  return out;
}

// 排行：總分高的在前，同分同名次（1、2、2、4），同分依座號
const byNo = (a, b) => String(a.no ?? '').localeCompare(String(b.no ?? ''), undefined, { numeric: true });
export function rankPeople(people, totals) {
  const list = people.map((p) => ({ ...p, total: totals[p.name] || 0 })).sort((a, b) => b.total - a.total || byNo(a, b));
  list.forEach((p, i) => { p.rank = i && p.total === list[i - 1].total ? list[i - 1].rank : i + 1; });
  return list;
}

// 學生改名：每日紀錄也跟著改
export function renameInDaily(daily, from, to) {
  for (const day of Object.values(daily || {})) {
    if (from in day) { day[to] = (day[to] || 0) + day[from]; delete day[from]; if (!day[to]) delete day[to]; }
  }
}

// Excel 會把 = + - @ 開頭的文字當公式：文字前面加 '，數字照原樣
function csvCell(v) {
  if (typeof v === 'number') return String(v);
  let s = String(v ?? '');
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// 匯出 CSV（UTF-8 加 BOM，Excel 直接開啟）：名次、座號、姓名、合計、每天的分數
export function leaderboardCsv(people, daily, range) {
  const days = daysIn(daily, range);
  const rows = [['名次', '座號', '姓名', '合計', ...days.map(dayLabel)]];
  for (const p of rankPeople(people, totalsIn(daily, range))) {
    rows.push([p.rank, p.no ?? '', p.name, p.total, ...days.map((k) => +(daily[k]?.[p.name] || 0))]);
  }
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// 範圍的文字說明（排行榜標題、匯出檔名）
export function rangeLabel(mode, range) {
  if (mode === 'total') return '累計';
  if (mode === 'today') return `今天（${dayLabel(range.from)}）`;
  const f = range.from ? dayLabel(range.from) : '最早', t = range.to ? dayLabel(range.to) : '今天';
  return `${f}～${t}`;
}
