// 投票題庫與投票紀錄：存在老師的 settings.json（pollBank、pollResults），換電腦也能用
//   pollBank：[{ id, question, options: [文字], at }]
//   pollResults：[{ id, at, board, question, options: [{ label, votes }], ballots: [{ name, label }] }]（新的在前）
import { h, modal, toast, confirmDialog, saveTextFile } from './ui.js';
import { uid } from './store.js';
import { fileToRows } from './roster.js';

export const MAX_RESULTS = 500;  // 紀錄太多時刪掉最舊的，避免 settings.json 太大
export const MAX_OPTIONS = 20;

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------ 匯入
// 文字：每題一段（第一行是題目，下面每行一個選項，題目之間空一行）；
// 從 Excel 貼上（有 Tab）時改用每列一題：題目、選項1、選項2…
export function parsePollText(text) {
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/);
  if (lines.some((l) => l.includes('\t'))) return parsePollRows(lines.map((l) => l.split('\t')));
  const list = [];
  let cur = null;
  for (const raw of lines) {
    const line = clean(raw);
    if (!line) { cur = null; continue; }
    if (!cur) list.push(cur = { question: line, options: [] });
    else cur.options.push(line);
  }
  return finish(list);
}

// Excel／CSV：每列一題，第一欄是題目，後面是選項；第一列是「題目」標題時略過
export function parsePollRows(rows) {
  const list = [];
  (rows || []).forEach((r, i) => {
    const cells = (r || []).map(clean).filter(Boolean);
    if (!cells.length) return;
    if (i === 0 && /^(題目|問題|question)$/i.test(cells[0])) return;
    list.push({ question: cells[0], options: cells.slice(1) });
  });
  return finish(list);
}

// 選項去除重複（計票以選項文字為準），少於 2 個選項的題目略過
function finish(list) {
  const items = [], skipped = [];
  for (const it of list) {
    const options = [...new Set(it.options)].slice(0, MAX_OPTIONS);
    if (options.length >= 2) items.push({ question: it.question, options });
    else skipped.push(it.question);
  }
  return { items, skipped };
}

// ------------------------------------------------------------ 題庫
const itemKey = (it) => JSON.stringify([it.question, it.options]);

// 加入題庫（略過完全相同的題目），回傳實際加入幾題
export function addToBank(bank, items) {
  const have = new Set(bank.map(itemKey));
  let added = 0;
  for (const it of items) {
    const item = { question: clean(it.question), options: (it.options || []).map(clean).filter(Boolean) };
    if (!item.question || item.options.length < 2 || have.has(itemKey(item))) continue;
    have.add(itemKey(item));
    bank.push({ id: uid(), ...item, at: Date.now() });
    added++;
  }
  return added;
}

// 投票小工具的狀態 → 題庫項目
export const itemFromPoll = (s) => ({ question: s.question, options: s.options.map((o) => o.label) });

// ------------------------------------------------------------ 投票紀錄
export const totalVotes = (s) => s.options.reduce((a, o) => a + (o.votes || 0), 0);

// 目前結果的指紋：和上次記錄時一樣就不重複記錄
export const resultSig = (s) => JSON.stringify([s.question, s.options.map((o) => [o.label, o.votes]), Object.keys(s.ballots || {}).length]);

export function makeResult(s, board = '', at = Date.now()) {
  return {
    id: uid(), at, board,
    question: s.question,
    options: s.options.map((o) => ({ label: o.label, votes: o.votes || 0 })),
    ballots: Object.values(s.ballots || {}).map((b) => ({ name: b.name, label: b.label })),
  };
}

export function addResult(list, rec, max = MAX_RESULTS) {
  list.unshift(rec);
  if (list.length > max) list.length = max;
}

const pad = (n) => String(n).padStart(2, '0');
export function fmtTime(at) {
  const d = new Date(at);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Excel 會把 = + - @ 開頭的內容當公式，前面加 ' 避免學生名字被當成公式執行
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// 匯出成 CSV（UTF-8 加 BOM，Excel 直接開啟不會亂碼）：每個選項一列
export function resultsToCsv(records) {
  const rows = [['日期時間', '白板', '題目', '選項', '票數', '百分比', '投票學生']];
  for (const r of records) {
    const total = r.options.reduce((a, o) => a + o.votes, 0);
    for (const o of r.options) {
      rows.push([fmtTime(r.at), r.board, r.question, o.label, o.votes, total ? Math.round((o.votes / total) * 100) + '%' : '0%',
        r.ballots.filter((b) => b.label === o.label).map((b) => b.name).join('、')]);
    }
  }
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ------------------------------------------------------------ 畫面
async function readPollFile(file) {
  if (/\.txt$/i.test(file.name)) {
    const buf = await file.arrayBuffer();
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = new TextDecoder('big5').decode(buf); }
    return parsePollText(text);
  }
  return parsePollRows(await fileToRows(file));
}

// 匯入題目：貼上文字或選擇檔案，預覽後加入題庫
export function importDialog(store, onDone) {
  let parsed = { items: [], skipped: [] };
  const info = h('div', { class: 'muted' });
  const text = h('textarea', {
    class: 'input', rows: 9,
    placeholder: '午餐想吃什麼？\n麵\n飯\n水餃\n\n最喜歡的季節\n春\n夏\n秋\n冬',
    oninput: () => { parsed = parsePollText(text.value); show(); },
  });
  const file = h('input', {
    type: 'file', accept: '.xlsx,.xls,.csv,.txt', class: 'hidden',
    onchange: async () => {
      const f = file.files[0];
      if (!f) return;
      try { parsed = await readPollFile(f); text.value = parsed.items.map((it) => [it.question, ...it.options].join('\n')).join('\n\n'); show(); }
      catch (e) { toast('無法讀取檔案：' + e.message); }
      file.value = '';
    },
  });
  function show() {
    info.textContent = parsed.items.length || parsed.skipped.length
      ? `可以匯入 ${parsed.items.length} 題` + (parsed.skipped.length ? `；略過 ${parsed.skipped.length} 題（選項少於 2 個）：${parsed.skipped.slice(0, 3).join('、')}${parsed.skipped.length > 3 ? '…' : ''}` : '')
      : '';
  }
  modal({
    title: '📥 匯入投票題目',
    body: h('div', { class: 'poll-import' },
      h('p', { class: 'muted' }, '每題一段：第一行是題目，下面每行一個選項，題目之間空一行。也可以從 Excel 複製貼上（每列一題：題目、選項1、選項2…），或選擇 Excel／CSV／文字檔。'),
      h('div', { class: 'row-btns' }, h('button', { class: 'btn', onclick: () => file.click() }, '📄 選擇檔案…'), file),
      text, info),
    actions: [
      { label: '取消' },
      {
        label: '匯入', primary: true, onClick: () => {
          if (!parsed.items.length) { toast('沒有可以匯入的題目'); return false; }
          store.getSettings().then((st) => {
            st.pollBank ||= [];
            const n = addToBank(st.pollBank, parsed.items);
            store.saveSettings();
            toast(n ? `已匯入 ${n} 題` : '這些題目都已經在題庫裡了');
            onDone?.();
          });
        },
      },
    ],
  });
}

// 題庫與投票紀錄（⚙ 設定的「投票」分頁、投票小工具的 📚 都用這個）
// opts.onUse(item)：使用題庫的題目；opts.useLabel：按鈕文字；opts.current()：目前小工具的狀態（可存到題庫、記錄結果）
// opts.record()：記錄目前結果，回傳是否有記錄
export function renderPollLibrary(box, store, opts = {}) {
  let tab = opts.tab || 'bank';
  let open = '';
  const render = async () => {
    const st = await store.getSettings();
    const bank = st.pollBank || [];
    const results = st.pollResults || [];
    box.innerHTML = '';
    box.append(h('div', { class: 'seg' },
      h('button', { class: tab === 'bank' ? 'on' : '', onclick: () => { tab = 'bank'; render(); } }, `📚 題庫（${bank.length}）`),
      h('button', { class: tab === 'results' ? 'on' : '', onclick: () => { tab = 'results'; render(); } }, `🗒 投票紀錄（${results.length}）`)));
    if (tab === 'bank') renderBank(st, bank); else renderResults(st, results);
  };
  const save = () => { store.saveSettings(); render(); };

  function renderBank(st, bank) {
    const cur = opts.current?.();
    box.append(h('div', { class: 'row-btns' },
      cur ? h('button', {
        class: 'btn', onclick: () => {
          st.pollBank ||= [];
          const n = addToBank(st.pollBank, [itemFromPoll(cur)]);
          toast(n ? '已存到題庫' : '題庫裡已經有這一題');
          save();
        },
      }, '＋ 存目前題目') : null,
      h('button', { class: 'btn', onclick: () => importDialog(store, render) }, '📥 匯入題目…')));
    if (!bank.length) {
      box.append(h('p', { class: 'muted' }, '題庫是空的。可以把常用的題目存起來重複使用，或從 Excel、文字一次匯入多題。'));
      return;
    }
    box.append(h('div', { class: 'set-list poll-bank' }, bank.map((it) => h('div', { class: 'set-item' },
      h('div', { class: 'si-main' }, h('b', null, it.question), h('small', null, it.options.join('・'))),
      h('div', { class: 'row-btns' },
        opts.onUse ? h('button', { class: 'btn small primary', onclick: () => opts.onUse(it) }, opts.useLabel || '使用') : null,
        h('button', {
          class: 'btn small', title: '從題庫刪除', onclick: async () => {
            if (!await confirmDialog(`要從題庫刪除「${it.question}」嗎？`, '刪除', true)) return;
            st.pollBank = st.pollBank.filter((x) => x.id !== it.id);
            save();
          },
        }, '刪除'))))));
  }

  function renderResults(st, results) {
    const cur = opts.current?.();
    box.append(h('div', { class: 'row-btns' },
      cur && opts.record ? h('button', {
        class: 'btn', onclick: async () => {
          if (!totalVotes(cur)) return toast('目前還沒有票');
          toast(await opts.record() ? '已記錄目前結果' : '這個結果已經記錄過了');
          render();
        },
      }, '💾 記錄目前結果') : null,
      results.length ? h('button', { class: 'btn', onclick: () => exportResults(results, '投票紀錄') }, '📤 匯出全部（Excel）') : null));
    if (!results.length) {
      box.append(h('p', { class: 'muted' }, '還沒有投票紀錄。結束學生投票時會自動記錄結果，也可以按「記錄目前結果」。'));
      return;
    }
    box.append(h('div', { class: 'set-list' }, results.map((r) => {
      const total = r.options.reduce((a, o) => a + o.votes, 0);
      const item = h('div', { class: 'set-item poll-rec' + (open === r.id ? ' on' : '') },
        h('button', { class: 'si-main', onclick: () => { open = open === r.id ? '' : r.id; render(); } },
          h('b', null, r.question),
          h('small', null, `${fmtTime(r.at)}${r.board ? '・' + r.board : ''}・${total} 票${r.ballots.length ? `・${r.ballots.length} 位學生` : ''}`)),
        h('small', null, open === r.id ? '收合 ▴' : '查看 ▾'));
      if (open !== r.id) return item;
      const max = Math.max(1, ...r.options.map((o) => o.votes));
      return h('div', { class: 'poll-rec-wrap' }, item, h('div', { class: 'poll-rec-detail' },
        r.options.map((o, i) => {
          const names = r.ballots.filter((b) => b.label === o.label).map((b) => b.name);
          return h('div', { class: `poll-rec-opt c${i % 8}` },
            h('div', { class: 'pro-bar' }, h('i', { style: { width: (o.votes / max) * 100 + '%' } }),
              h('span', null, o.label), h('b', null, `${o.votes}（${total ? Math.round((o.votes / total) * 100) : 0}%）`)),
            names.length ? h('small', { class: 'muted' }, names.join('、')) : null);
        }),
        h('div', { class: 'row-btns' },
          opts.onUse ? h('button', { class: 'btn small', onclick: () => opts.onUse({ question: r.question, options: r.options.map((o) => o.label) }) }, '再問一次') : null,
          h('button', {
            class: 'btn small', onclick: () => {
              st.pollBank ||= [];
              toast(addToBank(st.pollBank, [{ question: r.question, options: r.options.map((o) => o.label) }]) ? '已存到題庫' : '題庫裡已經有這一題');
              store.saveSettings();
            },
          }, '＋ 存到題庫'),
          h('button', { class: 'btn small', onclick: () => exportResults([r], r.question) }, '📤 匯出'),
          h('button', {
            class: 'btn small danger', onclick: async () => {
              if (!await confirmDialog('要刪除這筆投票紀錄嗎？', '刪除', true)) return;
              st.pollResults = st.pollResults.filter((x) => x.id !== r.id);
              save();
            },
          }, '刪除'))));
    })));
  }

  render();
  return render;
}

async function exportResults(records, name) {
  const safe = String(name).replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 40) || '投票紀錄';
  try {
    const ok = await saveTextFile(`${safe}.csv`, resultsToCsv(records));
    if (ok) toast(typeof ok === 'string' ? '已匯出：' + ok : '已匯出（Excel 可直接開啟）');
  } catch (e) { toast('匯出失敗：' + e.message); }
}

export function pollLibraryDialog(store, opts) {
  const box = h('div', { class: 'poll-lib' });
  const dlg = modal({ title: '📊 投票題庫與紀錄', body: box, wide: true, actions: [{ label: '完成', primary: true }] });
  renderPollLibrary(box, store, { ...opts, onUse: opts.onUse && ((it) => { if (opts.onUse(it) !== false) dlg.close(); }) });
  return dlg;
}
