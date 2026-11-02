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
// 標題列欄位：學號要先判斷（「學生編號」不能被當成姓名或座號）
const SID_RE = /學號|學生編號|學籍|student\s*(id|no)|^id$/i;
const NO_RE = /座號|號碼|序號|^序$|^編號$|^no\.?$|^number$/i;
const NAME_RE = /姓名|名字|^name$/i;
const isSid = (v) => /^[A-Za-z]{0,2}\d{4,}$/.test(v);

// rows：二維陣列（Excel 的工作表或文字解析結果）→ [{no, sid, name}]
export function parseRows(rows) {
  rows = rows.map((r) => (r || []).map((c) => String(c ?? '').trim())).filter((r) => r.some(Boolean));
  if (!rows.length) return [];
  const head = rows[0];
  const col = (re) => head.findIndex((c) => re.test(c));
  const iSid0 = col(SID_RE);
  const colExcept = (re) => head.findIndex((c, i) => i !== iSid0 && re.test(c));
  let iSid = iSid0, iName = colExcept(NAME_RE), iNo = colExcept(NO_RE);
  if (iName < 0) iName = colExcept(/學生/); // 標題只寫「學生」
  let body = rows;
  if (iName >= 0) body = rows.slice(1);
  else {
    // 沒有標題列：數字欄當座號，第一個有文字的欄當姓名
    const sample = rows.slice(0, 15);
    const cols = Math.max(...rows.map((r) => r.length));
    const idx = [...Array(cols).keys()];
    iNo = idx.find((c) => sample.every((r) => /^\d{1,3}$/.test(r[c] || ''))) ?? -1;
    iSid = idx.find((c) => c !== iNo && sample.every((r) => isSid(r[c] || ''))) ?? -1;
    iName = idx.find((c) => c !== iNo && c !== iSid && sample.some((r) => r[c] && !/^\d+$/.test(r[c]) && !isSid(r[c]))) ?? -1;
    if (iName < 0) return [];
  }
  const seen = new Set();
  return body.map((r) => ({
    no: iNo >= 0 ? normNo(r[iNo]) : '',
    sid: iSid >= 0 ? r[iSid] || '' : '',
    name: r[iName] || '',
  })).filter((s) => s.name && !seen.has(s.name) && seen.add(s.name));
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
    try { applyImport(l, parseRows(await fileToRows(file))); } catch (e) { toast('無法讀取檔案：' + e.message, 4000); }
  }
  function importPaste(l) {
    const ta = h('textarea', { class: 'input', rows: 12, placeholder: '從 Excel 選取「座號、姓名」兩欄複製後貼上，\n或每行輸入一個名字：\n01 王小明\n02 陳大華' });
    const dlg = modal({ title: '📋 貼上名單', body: ta, actions: [
      { label: '取消' },
      { label: '匯入', primary: true, onClick: () => {
        const people = parseRows(textToRows(ta.value));
        const n = studentsOf(l).length;
        if (!n || !people.length) applyImport(l, people);
        else confirmDialog(`要用貼上的 ${people.length} 位學生取代目前的 ${n} 位學生嗎？（照片會依學號或姓名保留）`).then((ok) => ok && applyImport(l, people));
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
