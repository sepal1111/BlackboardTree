// 班級名單：匯入學生名單（Excel、CSV、直接貼上）與照片
// 名單存在 settings.json 的 classLists，照片存在 MyScreen\media，抽籤、分組、座位表都直接讀取
import { h, modal, toast, confirmDialog, promptDialog } from './ui.js';
import { LS } from './store.js';

const LAST_KEY = 'ms:lastList';

// ------------------------------------------------------------ 資料
export const studentsOf = (list) => list?.students || (list?.names || []).map((name) => ({ name }));
export const hasPhotos = (list) => studentsOf(list).some((s) => s.photo);


export const lastListId = () => LS.get(LAST_KEY, '');
export const rememberList = (id) => id && LS.set(LAST_KEY, id);

// 小工具用：連結的班級名單（同步取得，設定尚未載入時回傳 null）
export function linkedList(ctx) {
  const id = ctx.state.listId;
  if (!id) return null;
  return ctx.store.settings?.classLists.find((l) => l.id === id) || null;
}

// 小工具第一次掛上時：設定載入後重畫；沒有名單的新小工具自動連結上次用的班級
// 學生改名：座位、分組、抽過的紀錄都換成新名字，位置不變
function renameIn(state, from, to) {
  const r = (v) => (v === from ? to : v);
  if (Array.isArray(state.seats)) state.seats = state.seats.map(r);
  if (Array.isArray(state.picked)) state.picked = state.picked.map(r);
  if (Array.isArray(state.groups)) state.groups = state.groups.map((g) => g.map(r));
  if (state.current === from) state.current = to;
  if (state.scores && from in state.scores) { state.scores[to] = state.scores[from]; delete state.scores[from]; }
}

export function watchRoster(ctx, onChange) {
  const s = ctx.state;
  const handler = () => onChange();
  const onRename = (e) => { if (e.detail.listId === s.listId) { renameIn(s, e.detail.from, e.detail.to); ctx.save(); } };
  ctx.store.addEventListener('settings', handler);
  ctx.store.addEventListener('rename', onRename);
  ctx.store.getSettings().then((st) => {
    if (!s.listId && !String(s.names || '').trim()) {
      const last = lastListId();
      if (st.classLists.some((l) => l.id === last)) { s.listId = last; ctx.save(); }
    }
    onChange();
  });
  return () => { ctx.store.removeEventListener('settings', handler); ctx.store.removeEventListener('rename', onRename); };
}

// 照片縮圖（給手機遙控用，轉成小張 data URL）
const thumbs = new Map();
export function photoThumb(store, ref, onReady) {
  if (!ref) return '';
  const key = JSON.stringify(ref);
  if (thumbs.has(key)) return thumbs.get(key);
  thumbs.set(key, '');
  store.imageUrl(ref).then((url) => new Promise((resolve, reject) => {
    if (!url) return reject();
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 160 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = reject;
    img.src = url;
  })).then((d) => { thumbs.set(key, d); onReady?.(); }, () => {});
  return '';
}

// ------------------------------------------------------------ 匯入名單
// ---- 欄位判斷
// 學校匯出的名單欄位很多（班級、座號、學號、姓名、性別、身分證、家長姓名、電話…），
// 先自動判斷，再由老師在匯入畫面確認或修改
export const FIELDS = [
  { key: 'no', label: '座號' },
  { key: 'name', label: '姓名', required: true },
  { key: 'sid', label: '學號' },
];
const OTHER_PERSON = /家長|父|母|監護|聯絡|緊急|導師|老師|教師|班長/;
// 標題文字的分數（越高越像）
const HEAD_SCORE = {
  name: (t) => (/^(學生)?姓名$|^name$/i.test(t) ? 10 : /姓名|名字|^學生$/.test(t) && !OTHER_PERSON.test(t) ? 6 : 0),
  no: (t) => (/^座號$/.test(t) ? 10 : /座號/.test(t) ? 8 : /^(序號|序|編號|號碼|號次|no\.?|number)$/i.test(t) ? 5 : 0),
  sid: (t) => (/^學號$/.test(t) ? 10 : /學號|學生編號|學籍|student\s*(id|no)/i.test(t) && !/身分|身份/.test(t) ? 8 : /^id$/i.test(t) ? 3 : 0),
};
const isNatId = (v) => /^[A-Za-z][12890]\d{8}$/.test(v); // 身分證、居留證
const isPhone = (v) => /^0\d{7,9}$/.test(v.replace(/[-\s()]/g, '')) && v.replace(/\D/g, '').length >= 8;
const isSid = (v) => /^[A-Za-z]{0,2}\d{4,10}$/.test(v) && !isNatId(v) && !isPhone(v);
const isName = (v) => /^[一-鿿㐀-䶿·．‧]{2,6}$/.test(v) || /^[A-Za-z][A-Za-z .'-]{1,40}$/.test(v);

const clean = (rows) => rows.map((r) => (r || []).map((c) => String(c ?? '').trim())).filter((r) => r.some(Boolean));
export const colCount = (rows) => Math.max(0, ...rows.map((r) => r.length));

// 回傳 { header: 標題列位置（-1 = 沒有標題）, no, name, sid: 欄位位置（-1 = 不匯入） }
export function detectColumns(rows) {
  rows = clean(rows);
  const cols = colCount(rows);
  const idx = [...Array(cols).keys()];
  // 標題列：前 6 列中最像標題的一列（學校報表第一列常是「○○學年度 ○年○班 名單」）
  let header = -1, best = 0;
  rows.slice(0, 6).forEach((r, i) => {
    const sc = FIELDS.reduce((a, f) => a + Math.max(0, ...r.map((t) => HEAD_SCORE[f.key](t))), 0);
    if (sc > best) { best = sc; header = i; }
  });
  if (best < 6) header = -1;
  const body = rows.slice(header + 1);
  const sample = body.slice(0, 30);
  const ratio = (c, fn) => { const v = sample.map((r) => r[c] || '').filter(Boolean); return v.length ? v.filter(fn).length / v.length : 0; };
  // 座號、學號每個人都不一樣（班級欄每列都相同，不能當座號）
  const unique = (c) => { const v = sample.map((r) => r[c] || '').filter(Boolean); return v.length < 2 || new Set(v).size / v.length >= 0.9; };
  const used = new Set();
  const choose = (key, contentFn, needUnique) => {
    let bi = -1, bs = 0;
    for (const c of idx) {
      if (used.has(c) || (needUnique && !unique(c))) continue;
      const hs = header >= 0 ? HEAD_SCORE[key](rows[header][c] || '') : 0;
      const cs = contentFn ? ratio(c, contentFn) : 0;
      // 有標題時以標題為主、內容為輔；沒有標題時只看內容
      const sc = header >= 0 ? (hs ? hs + cs * 3 : 0) : cs >= 0.8 ? cs : 0;
      if (sc > bs) { bs = sc; bi = c; }
    }
    if (bi >= 0) used.add(bi);
    return bi;
  };
  const sid = choose('sid', isSid, true);
  const no = choose('no', (v) => /^\d{1,2}$/.test(v) && +v > 0, true);
  let name = choose('name', isName);
  if (name < 0) {
    // 後備：第一個大部分是文字（不是數字）的欄
    name = idx.find((c) => !used.has(c) && ratio(c, (v) => !/^\d+$/.test(v) && !isSid(v) && !isNatId(v)) >= 0.6) ?? -1;
  }
  return { header, no, name, sid };
}

// 依欄位對應轉成學生資料
export function rowsToPeople(rows, map) {
  rows = clean(rows);
  if (map.name < 0) return [];
  const seen = new Set();
  return rows.slice(map.header + 1).map((r) => ({
    no: map.no >= 0 ? normNo(r[map.no]) : '',
    sid: map.sid >= 0 ? r[map.sid] || '' : '',
    name: (r[map.name] || '').replace(/\s+/g, ' '),
  }))
    // 跳過重複出現的標題列、空白與重複姓名
    .filter((p) => p.name && !HEAD_SCORE.name(p.name) && !seen.has(p.name) && seen.add(p.name));
}

// rows：二維陣列（Excel 的工作表或文字解析結果）→ [{no, sid, name}]（自動判斷欄位）
export const parseRows = (rows) => rowsToPeople(rows, detectColumns(rows));

const colLetter = (i) => (i >= 26 ? colLetter(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));

// 欄位對應畫面：顯示自動判斷結果與預覽，讓老師選擇每個項目要用檔案的哪一欄
export function columnDialog(rawRows, source) {
  const rows = clean(rawRows);
  const cols = colCount(rows);
  const map = detectColumns(rows);
  return new Promise((resolve) => {
    let result = null;
    const body = h('div', { class: 'colmap' });
    const okBtn = { label: '匯入', primary: true, onClick: () => { result = rowsToPeople(rows, map); if (!result.length) { toast('請選擇「姓名」欄'); return false; } } };
    function colName(c) {
      const head = map.header >= 0 ? rows[map.header][c] : '';
      const sample = rows.slice(map.header + 1).map((r) => r[c]).find(Boolean) || '';
      return `${colLetter(c)} 欄：${head || sample || '（空白）'}${head && sample ? `（例：${sample}）` : ''}`;
    }
    function render() {
      body.innerHTML = '';
      const headOpts = [[-1, '沒有標題列（第 1 列就是學生）'], ...rows.slice(0, 6).map((r, i) => [i, `第 ${i + 1} 列：${r.filter(Boolean).slice(0, 4).join('、')}`])];
      const sel = (value, opts, onChange) => {
        const el = h('select', { class: 'input', onchange: (e) => onChange(+e.target.value) }, opts.map(([v, l]) => h('option', { value: v }, l)));
        el.value = value;
        return el;
      };
      body.append(
        h('p', { class: 'muted' }, `來源：${source}。系統已自動判斷欄位，請確認下方每個項目對應到檔案的哪一欄；其他欄位（性別、身分證、家長資料等）不會匯入。`),
        h('div', { class: 'colmap-fields' },
          h('label', { class: 'colmap-f' }, h('span', null, '標題列'), sel(map.header, headOpts, (v) => {
            map.header = v;
            const d = detectColumns(rows); // 換標題列後重新判斷欄位
            if (d.header === v) Object.assign(map, d);
            render();
          })),
          ...FIELDS.map((f) => h('label', { class: 'colmap-f' + (f.required && map[f.key] < 0 ? ' missing' : '') },
            h('span', null, f.label + (f.required ? '（必選）' : '')),
            sel(map[f.key], [[-1, '（不匯入）'], ...[...Array(cols).keys()].map((c) => [c, colName(c)])], (v) => {
              for (const g of FIELDS) if (g.key !== f.key && map[g.key] === v && v >= 0) map[g.key] = -1; // 一欄只能對應一個項目
              map[f.key] = v; render();
            })))));
      // 預覽表格
      const tag = (c) => FIELDS.find((f) => map[f.key] === c);
      const table = h('table', { class: 'colmap-table' },
        h('thead', null, h('tr', null, [...Array(cols).keys()].map((c) => h('th', { class: tag(c) ? 'on' : '' },
          h('div', { class: 'cm-letter' }, colLetter(c)), tag(c) ? h('div', { class: 'cm-tag' }, tag(c).label) : h('div', { class: 'cm-tag off' }, '不匯入'),
          map.header >= 0 ? h('div', { class: 'cm-head' }, rows[map.header][c] || '') : null)))),
        h('tbody', null, rows.slice(map.header + 1, map.header + 9).map((r) => h('tr', null, [...Array(cols).keys()].map((c) => h('td', { class: tag(c) ? 'on' : '' }, r[c] || ''))))));
      const people = rowsToPeople(rows, map);
      body.append(h('div', { class: 'colmap-preview' }, table),
        h('div', { class: 'colmap-sum' + (people.length ? '' : ' err') }, people.length
          ? `將匯入 ${people.length} 位學生，例如：${people.slice(0, 3).map((p) => [p.no && p.no + '號', p.name, p.sid && `（${p.sid}）`].filter(Boolean).join(' ')).join('、')}`
          : '請選擇「姓名」對應的欄位'));
    }
    render();
    modal({ title: '📥 選擇匯入欄位', body, wide: true, onClose: () => resolve(result), actions: [{ label: '取消' }, okBtn] });
  });
}

const normNo = (v) => (/^\d+$/.test(String(v || '').trim()) ? String(parseInt(v, 10)).padStart(2, '0') : String(v || '').trim());

// 文字（貼上的 Excel 內容、CSV、每行一個名字）→ 二維陣列
export function textToRows(text) {
  return String(text).replace(/^﻿/, '').split(/\r?\n/).map((line) => {
    if (line.includes('\t')) return line.split('\t');
    if (/[,，]/.test(line)) return splitCsv(line);
    const m = line.trim().match(/^(\d{1,3})[\s.、:：)）]+(.+)$/); // 「01 王小明」「1. 王小明」
    return m ? [m[1], m[2].trim()] : [line];
  });
}

function splitCsv(line) {
  const out = [];
  let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if ((ch === ',' || ch === '，') && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

let xlsxLoading;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  xlsxLoading = xlsxLoading || new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/xlsx.mini.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('無法載入 Excel 讀取元件'));
    document.head.append(s);
  });
  return xlsxLoading;
}

// 讀取檔案：.xlsx/.xls 用 SheetJS；.csv/.txt 自動判斷 UTF-8 或 Big5（台灣版 Excel 存的 CSV）
export async function fileToRows(file) {
  const buf = await file.arrayBuffer();
  if (/\.(xlsx|xlsm|xls|ods)$/i.test(file.name)) {
    const XLSX = await loadXlsx();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  }
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = new TextDecoder('big5').decode(buf); }
  return textToRows(text);
}

// ------------------------------------------------------------ 照片
async function resizePhoto(file, max) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
}

// 縮小後存到 MyScreen\media（只存在這台電腦時改成內嵌）
async function savePhoto(store, file, baseName) {
  const backend = store.backend;
  if (!backend.upload) {
    const blob = await resizePhoto(file, 160);
    const url = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
    return { kind: 'data', url };
  }
  const blob = await resizePhoto(file, 360);
  return backend.upload(new File([blob], baseName + '.jpg', { type: 'image/jpeg' }));
}

// 檔名對學生，依序比對：
//   1. 學號：檔名中的數字串等於學號（1130101.jpg、1130101_王小明.jpg、S1130101.png、IMG_1130101.jpg）
//   2. 姓名：王小明.jpg、01王小明.jpg
//   3. 座號：檔名只有 1～3 位數字（01.jpg、1.jpg）
const idKey = (v) => String(v || '').trim().toLowerCase().replace(/^([a-z]*)0+(?=\d)/, '$1');
export function findPhotoMatch(students, fileName) {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  const low = base.toLowerCase();
  const runs = (low.match(/[a-z]{0,2}\d+/g) || []).flatMap((r) => [r, r.replace(/^[a-z]+/, '')]).map(idKey);
  // 學號有英文字母（S1130103）時，檔名只寫數字（1130103.jpg）也算
  const bySid = students.find((s) => s.sid && (runs.includes(idKey(s.sid)) || runs.includes(idKey(s.sid.replace(/^[a-z]+/i, '')))));
  if (bySid) return { student: bySid, by: 'sid' };
  const byName = students.find((s) => s.name === base) || students.find((s) => s.name.length >= 2 && base.includes(s.name));
  if (byName) return { student: byName, by: 'name' };
  if (/^\d{1,3}$/.test(base)) {
    const byNo = students.find((s) => s.no && parseInt(s.no, 10) === parseInt(base, 10));
    if (byNo) return { student: byNo, by: 'no' };
  }
  return null;
}
export const matchPhoto = (students, fileName) => findPhotoMatch(students, fileName)?.student || null;

const pick = (accept, multiple) => new Promise((resolve) => {
  const input = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
  input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
  document.body.append(input);
  input.click();
});

// ------------------------------------------------------------ 管理畫面
export async function rosterDialog(store, { selectId } = {}) {
  const st = await store.getSettings();
  let cur = st.classLists.find((l) => l.id === selectId) || st.classLists.find((l) => l.id === lastListId()) || st.classLists[0] || null;
  const side = h('div', { class: 'roster-side' });
  const main = h('div', { class: 'roster-main' });
  const changed = () => store.saveSettings();

  function renderSide() {
    side.innerHTML = '';
    for (const l of st.classLists) {
      side.append(h('button', { class: 'roster-tab' + (l === cur ? ' on' : ''), onclick: () => { cur = l; rememberList(l.id); render(); } },
        h('b', null, l.name), h('small', null, `${studentsOf(l).length} 人${hasPhotos(l) ? '・📷' : ''}`)));
    }
    side.append(h('button', { class: 'roster-tab new', onclick: async () => {
      const name = await promptDialog('班級名稱（例如：三年二班）');
      if (!name) return;
      cur = { id: Date.now().toString(36), name, students: [] };
      st.classLists.push(cur); rememberList(cur.id); changed(); render();
    } }, '＋ 新增班級'));
  }

  function renderMain() {
    main.innerHTML = '';
    if (!cur) {
      main.append(h('div', { class: 'roster-empty' }, h('p', null, '還沒有班級名單。'), h('p', { class: 'muted' }, '按左邊「＋ 新增班級」，再匯入 Excel 名單和學生照片。')));
      return;
    }
    const l = cur;
    const list = studentsOf(l);
    const nameInput = h('input', { class: 'input roster-name', value: l.name, onchange: (e) => { l.name = e.target.value.trim() || l.name; changed(); renderSide(); } });
    main.append(
      h('div', { class: 'roster-head' }, nameInput,
        h('button', { class: 'btn danger', onclick: async () => {
          if (!(await confirmDialog(`確定要刪除「${l.name}」嗎？使用這份名單的小工具會改回空白名單。`))) return;
          st.classLists = st.classLists.filter((x) => x !== l); cur = st.classLists[0] || null; changed(); render();
        } }, '刪除班級')),
      h('div', { class: 'roster-actions' },
        h('button', { class: 'btn primary', onclick: () => importFile(l) }, '📥 匯入名單（Excel／CSV）'),
        h('button', { class: 'btn', onclick: () => importPaste(l) }, '📋 貼上名單'),
        h('button', { class: 'btn', onclick: () => importPhotos(l) }, '🖼️ 匯入照片')),
      h('p', { class: 'muted roster-tip' }, 'Excel 第一列可以是標題（座號、姓名、學號）。照片可一次選多張，檔名含學號（1130101.jpg、1130101_王小明.jpg）、姓名或座號都會自動對應，學號優先。'));

    const grid = h('div', { class: 'roster-grid' });
    list.forEach((s, i) => {
      const img = h('img', { alt: '' });
      const ph = h('button', { class: 'roster-photo' + (s.photo ? '' : ' none'), title: '更換照片', onclick: () => onePhoto(l, s) }, s.photo ? img : '📷');
      if (s.photo) store.imageUrl(s.photo).then((u) => { img.src = u; });
      grid.append(h('div', { class: 'roster-card' }, ph,
        h('div', { class: 'roster-ids' },
          h('input', { class: 'roster-no', value: s.no || '', placeholder: '座號', title: '座號', onchange: (e) => { s.no = normNo(e.target.value); changed(); } }),
          h('input', { class: 'roster-sid', value: s.sid || '', placeholder: '學號', title: '學號', onchange: (e) => {
            const v = e.target.value.trim();
            if (v && list.some((x) => x !== s && x.sid && idKey(x.sid) === idKey(v))) { e.target.value = s.sid || ''; return toast('這個學號已經有人使用'); }
            s.sid = v; changed();
          } })),
        h('input', { class: 'roster-nm', value: s.name, onchange: (e) => {
          const v = e.target.value.trim();
          if (!v || list.some((x) => x !== s && x.name === v)) { e.target.value = s.name; return toast(v ? '已經有同名的學生' : '姓名不能空白'); }
          const from = s.name;
          s.name = v;
          store.dispatchEvent(new CustomEvent('rename', { detail: { listId: l.id, from, to: v } }));
          changed();
        } }),
        h('button', { class: 'roster-del', title: '移除這位學生', onclick: () => { list.splice(i, 1); changed(); render(); } }, '✕')));
    });
    grid.append(h('button', { class: 'roster-card add', onclick: async () => {
      const name = await promptDialog('學生姓名');
      if (!name) return;
      const nos = list.map((s) => parseInt(s.no, 10)).filter((n) => !isNaN(n));
      list.push({ no: normNo(String((nos.length ? Math.max(...nos) : 0) + 1)), name: name.trim() });
      changed(); render();
    } }, '＋ 新增學生'));
    main.append(h('div', { class: 'roster-count muted' }, `共 ${list.length} 人，${list.filter((s) => s.sid).length} 人有學號，${list.filter((s) => s.photo).length} 人有照片`), grid);
  }

  function render() {
    if (cur) cur.students = studentsOf(cur);
    renderSide();
    renderMain();
  }

  // 匯入名單：已有學生時取代，照片依姓名保留
  function applyImport(l, people) {
    if (!people.length) return toast('讀不到姓名，請確認有「姓名」欄，或每行一個名字');
    // 沒有座號時依順序編號，照片才能用 01.jpg 對應
    if (people.every((p) => !p.no)) people.forEach((p, i) => { p.no = String(i + 1).padStart(2, '0'); });
    const old = studentsOf(l);
    l.students = people.map((p) => {
      const o = (p.sid && old.find((x) => x.sid && idKey(x.sid) === idKey(p.sid))) || old.find((x) => x.name === p.name);
      return { ...p, ...(o?.photo ? { photo: o.photo } : {}) };
    });
    changed(); render();
    toast(`已匯入 ${people.length} 位學生`);
  }
  async function importFile(l) {
    const [file] = await pick('.xlsx,.xls,.ods,.csv,.txt', false);
    if (!file) return;
    if (studentsOf(l).length && !(await confirmDialog(`要用「${file.name}」取代目前的 ${studentsOf(l).length} 位學生嗎？（照片會依學號或姓名保留）`))) return;
    let rows;
    try { rows = await fileToRows(file); } catch (e) { return toast('無法讀取檔案：' + e.message, 4000); }
    const people = await columnDialog(rows, file.name);
    if (people) applyImport(l, people);
  }
  function importPaste(l) {
    const ta = h('textarea', { class: 'input', rows: 12, placeholder: '從 Excel 選取「座號、姓名」兩欄複製後貼上，\n或每行輸入一個名字：\n01 王小明\n02 陳大華' });
    const dlg = modal({ title: '📋 貼上名單', body: ta, actions: [
      { label: '取消' },
      { label: '下一步', primary: true, onClick: () => {
        const rows = textToRows(ta.value);
        (async () => {
          const n = studentsOf(l).length;
          if (n && !(await confirmDialog(`要用貼上的名單取代目前的 ${n} 位學生嗎？（照片會依學號或姓名保留）`))) return;
          // 有多欄時讓老師確認欄位；只有一欄名字就直接匯入
          const people = colCount(rows.filter((r) => r.some((c) => String(c).trim()))) > 1 ? await columnDialog(rows, '貼上的內容') : parseRows(rows);
          if (people) applyImport(l, people);
        })();
      } },
    ] });
    setTimeout(() => ta.focus(), 50);
    return dlg;
  }
  async function importPhotos(l) {
    const list = studentsOf(l);
    if (!list.length) return toast('請先匯入名單，再匯入照片');
    const files = (await pick('image/*', true)).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    let ok = 0;
    const miss = [];
    const by = { sid: 0, name: 0, no: 0 };
    toast(`正在處理 ${files.length} 張照片…`, 60000);
    for (const f of files) {
      const m = findPhotoMatch(list, f.name);
      if (!m) { miss.push(f.name); continue; }
      const s = m.student;
      try { s.photo = await savePhoto(store, f, `${l.id}-${s.sid || s.no || s.name}`); ok++; by[m.by]++; } catch { miss.push(f.name); }
    }
    changed(); render();
    const how = [by.sid && `學號 ${by.sid}`, by.name && `姓名 ${by.name}`, by.no && `座號 ${by.no}`].filter(Boolean).join('、');
    // 檔名是學號但名單沒有學號：提醒先匯入含學號的名單
    const hint = miss.some((n) => /\d{4,}/.test(n)) && !list.some((s) => s.sid) ? '。照片檔名像是學號，但名單沒有學號，請匯入含「學號」欄的名單，或在名單中填入學號' : '';
    toast(`已加入 ${ok} 張照片${how ? `（依${how}）` : ''}` + (miss.length ? `；${miss.length} 張對應不到：${miss.slice(0, 5).join('、')}${miss.length > 5 ? '…' : ''}` : '') + hint, miss.length ? 10000 : 3500);
  }
  async function onePhoto(l, s) {
    const [f] = await pick('image/*', false);
    if (!f) return;
    try { s.photo = await savePhoto(store, f, `${l.id}-${s.no || s.name}`); changed(); render(); } catch (e) { toast('照片儲存失敗：' + e.message); }
  }

  render();
  return modal({ title: '👥 班級名單', body: h('div', { class: 'roster' }, side, main), wide: true, actions: [{ label: '完成', primary: true }] });
}
