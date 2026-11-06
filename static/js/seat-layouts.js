// 座位表的紀錄：每班可以存好幾組座位排法，各自標上科目或類型（例如「數學」「考試」「分組活動」）
// 存在老師的 settings.json：settings.seatLayouts = { [班級 id]: [{ id, label, rows, cols, seats, flip, at }] }
// 座位表正在使用某一組時（state.layoutId），換座位會自動存回那一組

export const MAX_LAYOUTS = 30;   // 每班最多幾組，太多時刪掉最久沒用的
export const MAX_LABEL = 20;
// 標籤的快速選項（也可以自己輸入）
export const SEAT_TAGS = ['一般上課', '考試', '分組活動', '國語', '數學', '英語', '自然', '社會', '藝術', '健體', '綜合'];

export const newLayoutId = () => 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const cleanLabel = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);

function bucket(settings, listId, create) {
  if (!settings) return null;
  if (!settings.seatLayouts || typeof settings.seatLayouts !== 'object' || Array.isArray(settings.seatLayouts)) {
    if (!create) return null;
    settings.seatLayouts = {};
  }
  const all = settings.seatLayouts;
  // 班級刪除後清掉它的紀錄
  const lists = Array.isArray(settings.classLists) ? settings.classLists : [];
  for (const k of Object.keys(all)) if (!lists.some((l) => l.id === k)) delete all[k];
  const key = String(listId || '');
  if (!key || !lists.some((l) => l.id === key)) return null;
  if (!Array.isArray(all[key])) { if (!create) return null; all[key] = []; }
  return all[key];
}

const snapshot = (st) => ({
  rows: Math.max(1, Math.min(15, +st.rows || 1)),
  cols: Math.max(1, Math.min(15, +st.cols || 1)),
  seats: (Array.isArray(st.seats) ? st.seats : []).map((n) => String(n || '')),
  flip: !!st.flip,
});

// 某班的座位紀錄，最近用的在前
export function layoutsOf(settings, listId) {
  const list = bucket(settings, listId, false) || [];
  return list.filter((l) => l && l.id && Array.isArray(l.seats)).sort((a, b) => (b.at || 0) - (a.at || 0));
}

// 把目前的座位存成新的一組（同名的標籤會覆蓋那一組）；回傳存好的那一組
export function saveLayout(settings, listId, state, label, now = Date.now(), max = MAX_LAYOUTS) {
  const list = bucket(settings, listId, true);
  const name = cleanLabel(label);
  if (!list || !name) return null;
  const old = list.find((l) => l.label === name);
  const item = Object.assign(old || { id: newLayoutId() }, { label: name }, snapshot(state), { at: now });
  if (!old) list.push(item);
  if (list.length > max) {
    list.sort((a, b) => (b.at || 0) - (a.at || 0));
    list.length = max;
  }
  return item;
}

// 正在使用的那一組：座位有改變時存回去。回傳是否有改變
export function updateLayout(settings, listId, id, state, now = Date.now()) {
  const item = (bucket(settings, listId, false) || []).find((l) => l.id === id);
  if (!item) return false;
  const snap = snapshot(state);
  if (JSON.stringify([item.rows, item.cols, item.seats, item.flip]) === JSON.stringify([snap.rows, snap.cols, snap.seats, snap.flip])) return false;
  Object.assign(item, snap, { at: now });
  return true;
}

export function findLayout(settings, listId, id) {
  return (bucket(settings, listId, false) || []).find((l) => l.id === id) || null;
}

export function renameLayout(settings, listId, id, label) {
  const list = bucket(settings, listId, false) || [];
  const item = list.find((l) => l.id === id);
  const name = cleanLabel(label);
  if (!item || !name || list.some((l) => l !== item && l.label === name)) return false;
  item.label = name;
  return true;
}

export function deleteLayout(settings, listId, id) {
  const list = bucket(settings, listId, false);
  const i = list ? list.findIndex((l) => l.id === id) : -1;
  if (i < 0) return false;
  list.splice(i, 1);
  if (!list.length) delete settings.seatLayouts[String(listId || '')];
  return true;
}

// 套用一組紀錄：已經不在名單裡的人變空位（還沒有座位的人，座位表會自動補進空位）
export function applyLayout(layout, names) {
  const have = new Set(names);
  const seen = new Set();
  const snap = snapshot(layout);
  const total = snap.rows * snap.cols;
  const seats = Array.from({ length: total }, (_, i) => {
    const n = snap.seats[i] || '';
    if (!n || !have.has(n) || seen.has(n)) return '';
    seen.add(n);
    return n;
  });
  return { rows: snap.rows, cols: snap.cols, seats, flip: snap.flip };
}

// 學生改名：該班所有座位紀錄裡的名字也一起換
export function renameInLayouts(settings, listId, from, to) {
  const list = bucket(settings, listId, false);
  if (!list) return false;
  let changed = false;
  for (const l of list) {
    if (!Array.isArray(l.seats)) continue;
    l.seats = l.seats.map((n) => (n === from ? (changed = true, to) : n));
  }
  return changed;
}
