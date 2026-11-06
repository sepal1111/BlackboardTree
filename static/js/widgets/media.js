// 內容類：文字、畫板、圖片、QR Code、嵌入網頁、視訊鏡頭
import { h, field, select, checkbox, pickImage, setImage, toast, modal, confirmDialog } from '../ui.js';
import { htmlToText, upsertNote, deleteNote, searchNotes, newNoteId } from '../text-notes.js';
import { observeSize } from './util.js';
import { hanChars, readingsOf, setReading, stripVS, withReading, autoReadings, loadBpmfData, vsOfIndex, indexOfVs } from '../bpmf.js';

const COLORS = ['#1f2937', '#ffffff', '#ef4444', '#f97316', '#eab308', '#22c55e', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899'];

function colorRow(value, onPick) {
  const row = h('div', { class: 'swatches' });
  const render = (v) => {
    row.innerHTML = '';
    COLORS.forEach((c) => row.append(h('button', { class: 'sw' + (c === v ? ' on' : ''), style: { background: c }, onclick: () => { onPick(c); render(c); } })));
    row.append(h('input', { type: 'color', value: v?.startsWith('#') ? v : '#000000', oninput: (e) => { onPick(e.target.value); } }));
  };
  render(value);
  return row;
}

// 文字：小工具上方有格式工具列（大小、顏色、粗體；選取文字時只改選取的部分）
// 寫過的內容自動存成紀錄（settings.textNotes，見 text-notes.js），可以「新的一頁」或從「📚 紀錄」叫回
const TEXT_COLORS = ['#1f2937', '#e03131', '#1971c2', '#2f9e44', '#f08c00', '#7048e8'];
const pad2 = (n) => String(n).padStart(2, '0');
// 螢幕上的水平／垂直位置 → CSS。文字框是直向的 flex 容器：justify-content 管「區塊方向」，text-align 管「行內方向」
// 橫式：行內＝水平、區塊＝垂直；直式（vertical-rl）：行內＝垂直、區塊＝水平（由右往左）
// 用 safe：內容超過框時不會被裁掉上面（或右邊）而捲不到
export function textLayout({ align = 'left', valign = 'top', vertical = false } = {}) {
  const pos = (v, a, b) => (v === a ? 'start' : v === b ? 'end' : 'center');
  if (!vertical) {
    const j = pos(valign, 'top', 'bottom');
    return { textAlign: align, justify: j === 'center' ? 'safe center' : j === 'end' ? 'safe flex-end' : 'flex-start' };
  }
  const j = pos(align, 'right', 'left');
  return { textAlign: pos(valign, 'top', 'bottom'), justify: j === 'center' ? 'safe center' : j === 'end' ? 'safe flex-end' : 'flex-start' };
}
// 字型：注音字型是內建的開源字型（ButTaiwan bpmfvs，OFL），字本身就帶注音；用到時才載入（依 unicode-range 分塊下載）
export const TEXT_FONTS = {
  default: { label: '預設字型', family: '' },
  kai: { label: '標楷體（電腦有安裝才會顯示）', family: '"標楷體", "DFKai-SB", "BiauKai", "TW-Kai", serif' },
  'bpmf-kai': { label: '注音楷體', family: '"Bpmf Zihi Kai Std", "標楷體", "DFKai-SB", serif', css: 'bpmf-zihi-kai-std', latin: 'BT Upright Serif' },
  'bpmf-round': { label: '注音圓體', family: '"Bpmf Huninn", sans-serif', css: 'bpmf-huninn', latin: 'BT Upright Sans' },
};
// 注音字型的 vert 功能會把英數字換成「轉向」的字形（直式時橫躺），而標點的直排字形也靠 vert，不能整個關掉；
// 所以直式時英數字改用系統的英文字型（app.css 的 @font-face，只涵蓋英數字），中文與標點仍用注音字型
export function fontFamilyOf(font, vertical) {
  const f = TEXT_FONTS[font] || TEXT_FONTS.default;
  return vertical && f.latin ? `"${f.latin}", ${f.family}` : f.family;
}
const loadedFonts = new Set();
function loadFont(key) {
  const css = TEXT_FONTS[key]?.css;
  if (!css || loadedFonts.has(css)) return;
  loadedFonts.add(css);
  document.head.append(h('link', { rel: 'stylesheet', href: new URL(`../../vendor/fonts/${css}/${css}.css`, import.meta.url).href }));
}
// 工具列的對齊小圖示（四條線）
function icon(kind) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', '15'); svg.setAttribute('height', '15');
  const lines = kind === 'h' ? [[2, 3, 14, 3], [4.5, 6.3, 11.5, 6.3], [2, 9.6, 14, 9.6], [4.5, 12.9, 11.5, 12.9]]
    : [[1, 1.5, 15, 1.5], [1, 14.5, 15, 14.5], [8, 4.5, 8, 11.5], [5.5, 6.5, 8, 4.2], [10.5, 6.5, 8, 4.2], [5.5, 9.5, 8, 11.8], [10.5, 9.5, 8, 11.8]];
  for (const [x1, y1, x2, y2] of lines) {
    const l = document.createElementNS(ns, 'line');
    Object.entries({ x1, y1, x2, y2, stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round' }).forEach(([k, v]) => l.setAttribute(k, v));
    svg.append(l);
  }
  return svg;
}
const fmtWhen = (at) => { const d = new Date(at); return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

export const text = {
  type: 'text', title: '文字', icon: '📝', size: { w: 0.32, h: 0.26 },
  // align：水平（left/center/right）；valign：垂直（top/middle/bottom）；vertical：直式（由右往左）。都以「螢幕上的方向」記錄
  state: () => ({ html: '', size: 9, color: '#1f2937', bg: '#fffbea', align: 'left', valign: 'top', vertical: false, font: 'default', noteId: '' }),
  mount(body, ctx) {
    const s = ctx.state;
    const ed = h('div', { class: 'text-ed', contenteditable: 'true', spellcheck: 'false', 'data-ph': '在這裡輸入文字…' });
    ed.innerHTML = s.html;
    // 按鈕用 mousedown＋preventDefault：點按鈕時不會失去文字的選取範圍
    const keep = (fn) => (e) => { e.preventDefault(); fn(); };
    let btnH, btnV, btnW, btnB, btnP;
    const tb = h('div', { class: 'text-tb' },
      h('button', { title: '縮小文字（有選取時只縮小選取的文字）', onmousedown: keep(() => resize(1 / 1.2)) }, 'A−'),
      h('button', { title: '放大文字（有選取時只放大選取的文字）', onmousedown: keep(() => resize(1.2)) }, 'A+'),
      h('span', { class: 'tb-sep' }),
      TEXT_COLORS.map((c, i) => h('button', { class: 'tb-color' + (i >= 3 ? ' extra' : ''), style: { background: c }, title: '文字顏色（有選取時只改選取的文字）', onmousedown: keep(() => recolor(c)) })),
      h('button', { class: 'tb-b', title: '粗體（先選取文字，Ctrl+B）', onmousedown: keep(() => { if (hasSel()) { document.execCommand('bold'); changed(); } else toast('請先選取要變粗體的文字'); }) }, 'B'),
      h('span', { class: 'tb-sep' }),
      btnH = h('button', { class: 'tb-ic', title: '水平置中（再按一次取消）', onmousedown: keep(() => setLayout({ align: s.align === 'center' ? startAlign() : 'center' })) }, icon('h')),
      btnV = h('button', { class: 'tb-ic', title: '垂直置中（再按一次取消）', onmousedown: keep(() => setLayout({ valign: s.valign === 'middle' ? 'top' : 'middle' })) }, icon('v')),
      btnW = h('button', { class: 'tb-ic tb-w', title: '直式文字（由右往左）／橫式', onmousedown: keep(() => toggleVertical()) }, '直'),
      btnB = h('button', { class: 'tb-ic tb-w', title: '注音字型（再按一次換回原本的字型；⚙ 設定可選注音楷體或注音圓體）', onmousedown: keep(() => toggleBpmf()) }, 'ㄅ'),
      btnP = h('button', { class: 'tb-ic tb-w', title: '破音字：選擇讀音（先選取一段文字，就只列出那一段）', onmousedown: keep(() => openReadings()) }, '音'),
      h('span', { class: 'tb-sep' }),
      h('button', { title: '新的一頁：清空並開始新的一則（原本的內容留在紀錄）', onmousedown: keep(() => newPage()) }, '📄'),
      h('button', { title: '文字紀錄：叫回以前寫過的內容', onmousedown: keep(() => openNotes()) }, '📚'));
    body.classList.add('text-body');
    body.append(ed);
    // 工具列放在小工具的標題列（標題與右上角按鈕之間），不會蓋住文字
    const head = body.parentElement?.querySelector('.w-head');
    if (head) head.insertBefore(tb, head.querySelector('.w-actions')); else body.append(tb);
    // 小工具很窄時：隱藏標題與較少用的顏色，工具列才放得下
    const compact = () => head?.classList.toggle('tb-compact', body.clientWidth < 470);
    const stopObserve = observeSize(body, compact);
    setTimeout(compact);
    const apply = () => {
      ed.style.fontSize = `${s.size}cqmin`;
      ed.style.color = s.color;
      body.style.background = s.bg;
      const { textAlign, justify } = textLayout(s);
      ed.classList.toggle('vert', !!s.vertical);
      ed.style.textAlign = textAlign;
      ed.style.justifyContent = justify;
      btnH.classList.toggle('on', s.align === 'center');
      btnV.classList.toggle('on', s.valign === 'middle');
      btnW.classList.toggle('on', !!s.vertical);
      const font = TEXT_FONTS[s.font] ? s.font : 'default';
      loadFont(font);
      ed.style.fontFamily = fontFamilyOf(font, s.vertical);
      ed.classList.toggle('bpmf', font.startsWith('bpmf'));
      btnB.classList.toggle('on', font.startsWith('bpmf'));
      btnP.hidden = !font.startsWith('bpmf'); // 破音字只有注音字型才需要
      if (font.startsWith('bpmf')) setTimeout(() => scheduleAuto(50)); // 換成注音字型時自動判斷一次
    };
    apply();
    // 直式從右邊開始寫，橫式從左邊
    const startAlign = () => (s.vertical ? 'right' : 'left');
    function setLayout(p) { Object.assign(s, p); apply(); ctx.save(); }
    function toggleVertical() {
      const v = !s.vertical;
      // 切換時把「起點」一起換邊（橫式靠左 ⇄ 直式靠右），置中則維持
      const align = s.align === 'center' ? 'center' : (v ? 'right' : 'left');
      setLayout({ vertical: v, align });
    }
    // ㄅ：開啟時用上次選的注音字型（預設注音楷體），關閉時回到開啟前的字型
    function toggleBpmf() {
      if (String(s.font).startsWith('bpmf')) setLayout({ bpmfFont: s.font, font: s.plainFont || 'default' });
      else setLayout({ plainFont: s.font || 'default', font: s.bpmfFont || 'bpmf-kai' });
    }

    const hasSel = () => {
      const sel = getSelection();
      return !!sel && sel.rangeCount > 0 && !sel.isCollapsed && ed.contains(sel.anchorNode) && ed.contains(sel.focusNode);
    };
    function changed() { s.html = ed.innerHTML; ctx.save(); scheduleNote(); scheduleAuto(); }
    // 大小：有選取時把選取的文字包成 <span style="font-size">（相對大小，整段放大縮小時一起變）；沒選取時改整段
    function resize(k) {
      if (hasSel()) {
        const sel = getSelection();
        const r = sel.getRangeAt(0);
        const span = document.createElement('span');
        span.style.fontSize = k > 1 ? '1.2em' : '0.83em';
        span.append(r.extractContents());
        r.insertNode(span);
        sel.removeAllRanges();
        const nr = document.createRange();
        nr.selectNodeContents(span);
        sel.addRange(nr);
        changed();
      } else {
        s.size = Math.round(Math.max(3, Math.min(40, s.size * k)) * 2) / 2;
        apply(); ctx.save();
      }
    }
    function recolor(c) {
      if (hasSel()) {
        document.execCommand('styleWithCSS', false, true);
        document.execCommand('foreColor', false, c);
        changed();
      } else { s.color = c; apply(); ctx.save(); }
    }

    // ---- 破音字
    // 自動判斷：依常用詞與規則（bpmf.js 的 autoReadings）在字後面加上讀音選擇符；打字停下來 0.5 秒後執行
    // 老師手動修正的字包在 <span class="py-m" data-ch="字"> 裡，自動判斷不會改它，可以在「音」視窗改回自動
    const isBpmf = () => String(s.font).startsWith('bpmf');
    const pyAuto = () => s.pyAuto !== false;
    let composing = false;
    let autoTimer = 0;
    function scheduleAuto(ms = 500) {
      clearTimeout(autoTimer);
      if (isBpmf() && pyAuto()) autoTimer = setTimeout(() => runAuto(), ms);
    }
    // 手動修正的 span 只能包一個字：在它前後打的字移到 span 外面
    function tidyManual() {
      for (const sp of ed.querySelectorAll('.py-m')) {
        const t = sp.textContent;
        const list = hanChars(t);
        const keep = list.find((c) => c.ch === sp.dataset.ch);
        if (!keep) { sp.replaceWith(document.createTextNode(t)); continue; }
        if (keep.at === 0 && keep.len === t.length) continue;
        const before = t.slice(0, keep.at);
        const after = t.slice(keep.at + keep.len);
        sp.textContent = t.slice(keep.at, keep.at + keep.len);
        if (before) sp.before(before);
        if (after) sp.after(after);
      }
    }
    // 依文件順序收集每個字；換行、區塊當成斷詞的位置
    function sequence() {
      const seq = [];
      const walk = document.createTreeWalker(ed, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      for (let node = walk.nextNode(); node; node = walk.nextNode()) {
        if (node.nodeType === 1) {
          if (/^(BR|DIV|P|LI)$/.test(node.tagName)) seq.push({ ch: '\n' });
          continue;
        }
        const manual = !!node.parentElement?.closest('.py-m');
        const han = new Map(hanChars(node.data).map((c) => [c.at, c]));
        for (let i = 0; i < node.data.length;) {
          const c = han.get(i);
          if (c) { seq.push({ ...c, node, manual }); i += c.len; continue; }
          const cp = node.data.codePointAt(i);
          const ch = String.fromCodePoint(cp);
          if (!(cp >= 0xe0100 && cp <= 0xe01ef)) seq.push({ ch });
          i += ch.length;
        }
      }
      return seq;
    }
    // reset：拿掉所有自動判斷的讀音（關閉自動判斷時）
    async function runAuto({ reset = false } = {}) {
      clearTimeout(autoTimer);
      if (!isBpmf() || (!reset && !pyAuto())) return;
      if (composing) { scheduleAuto(); return; }
      const data = reset ? null : await loadBpmfData().catch(() => null);
      if (!reset && !data) return;
      tidyManual();
      const seq = sequence();
      const fixed = seq.map((x) => (x.manual ? indexOfVs(x.vs) : null));
      const res = reset ? [] : autoReadings(seq.map((x) => x.ch), data, { sandhi: s.pySandhi !== false, fixed });
      // 依文字節點分組，由後往前改，游標位置跟著調整
      const edits = new Map();
      seq.forEach((x, i) => {
        if (!x.node || x.manual) return;
        const want = vsOfIndex(res[i] ?? null);
        if (want === x.vs) return;
        if (!edits.has(x.node)) edits.set(x.node, []);
        edits.get(x.node).push({ ...x, want });
      });
      if (!edits.size) return;
      const sel = getSelection();
      const pts = sel.rangeCount && ed.contains(sel.anchorNode)
        ? [[sel.anchorNode, sel.anchorOffset], [sel.focusNode, sel.focusOffset]] : null;
      for (const [node, list] of edits) {
        let text = node.data;
        const shift = (p) => list.reduce((d, e) => d + (e.at + e.len <= p ? withReading(e.ch, e.want).length - e.len : 0), 0);
        if (pts) pts.forEach((pt) => { if (pt[0] === node) pt[2] = pt[1] + shift(pt[1]); });
        for (const e of [...list].sort((a, b) => b.at - a.at)) text = text.slice(0, e.at) + withReading(e.ch, e.want) + text.slice(e.at + e.len);
        node.data = text;
      }
      if (pts && pts.some((p) => p[2] != null)) {
        try { sel.setBaseAndExtent(pts[0][0], pts[0][2] ?? pts[0][1], pts[1][0], pts[1][2] ?? pts[1][1]); } catch { /* 游標位置失效時不處理 */ }
      }
      s.html = ed.innerHTML; ctx.save(); scheduleNote();
    }
    ed.addEventListener('compositionstart', () => { composing = true; });
    ed.addEventListener('compositionend', () => { composing = false; scheduleAuto(); });

    // 手動指定某個字的讀音（包進 .py-m）；vs 規則見 bpmf.js
    function setManual(it, vs) {
      const sp = it.node.parentElement?.closest('.py-m');
      if (sp && ed.contains(sp)) { it.node.data = setReading(it.node.data, it, vs); return; }
      const r = document.createRange();
      r.setStart(it.node, it.at); r.setEnd(it.node, it.at + it.len);
      const span = h('span', { class: 'py-m', 'data-ch': it.ch }, withReading(it.ch, vs));
      r.deleteContents(); r.insertNode(span);
    }
    function setAutoAgain(it) {
      const sp = it.node.parentElement?.closest('.py-m');
      if (!sp) return;
      const parent = sp.parentNode;
      sp.replaceWith(document.createTextNode(sp.textContent));
      parent.normalize();
    }

    // 「音」視窗：列出文字裡的破音字（有選取時只列選取的部分），點選讀音就是手動修正
    async function openReadings() {
      const family = TEXT_FONTS[s.font]?.family;
      if (!family || !isBpmf()) { toast('請先按「ㄅ」換成注音字型'); return; }
      const sel = getSelection();
      const range = hasSel() ? sel.getRangeAt(0).cloneRange() : null;
      await runAuto(); // 先把自動判斷做完，列出的才是目前的讀音
      const box = h('div', { class: 'py-list' });
      const hint = h('small', { class: 'muted' }, '正在查詢讀音…');
      const dlg = modal({
        title: '音 破音字讀音', wide: true, actions: [{ label: '完成', primary: true }],
        body: h('div', { class: 'stack' }, hint, box),
      });
      const inRange = (x) => !range || range.comparePoint(x.node, x.at) === 0 || range.comparePoint(x.node, x.at + x.len) === 0;
      async function draw() {
        const scroll = box.scrollTop;
        const rows = [];
        const seq = sequence();
        const around = (a, b) => seq.slice(Math.max(0, a), Math.max(0, b)).map((x) => (x.ch === '\n' ? ' ' : x.ch)).join('');
        for (const [j, it] of seq.entries()) {
          if (!it.node || !inRange(it)) continue;
          const list = await readingsOf(it.ch, family);
          if (list.length < 2 && it.vs == null) continue; // 只有一種讀音、也沒改過的字不用列
          rows.push(h('div', { class: 'py-row' + (it.manual ? ' manual' : '') },
            h('div', { class: 'py-ctx' }, around(j - 4, j),
              h('b', { style: { fontFamily: family } }, withReading(it.ch, it.vs)), around(j + 1, j + 5)),
            h('div', { class: 'py-opts' }, [...list, 0].map((k) => h('button', {
              class: 'py-opt' + (k === it.vs ? ' on' : ''),
              style: { fontFamily: family },
              title: k === null ? '預設讀音' : k === 0 ? '不標注音' : `第 ${k + 1} 種讀音`,
              onclick: () => { setManual(it, k); changed(); draw(); },
            }, withReading(it.ch, k)))),
            it.manual
              ? h('div', { class: 'py-state' }, h('span', { class: 'py-tag' }, '手動'),
                h('button', { class: 'btn', title: '取消手動修正，交給自動判斷', onclick: async () => { setAutoAgain(it); await runAuto(); changed(); draw(); } }, '↺ 改回自動'))
              : h('div', { class: 'py-state' }, h('span', { class: 'py-tag auto' }, pyAuto() ? '自動' : '預設'))));
        }
        hint.textContent = rows.length
          ? '點選正確的讀音（會標成「手動」，自動判斷不會再改它）。最右邊是「不標注音」。' + (range ? '（只列出選取的部分）' : '')
          : (range ? '選取的文字裡沒有破音字。' : '這段文字裡沒有破音字。');
        box.replaceChildren(...rows);
        box.scrollTop = scroll;
      }
      await draw();
      return dlg;
    }

    // ---- 文字紀錄
    let noteTimer = 0;
    function scheduleNote() { clearTimeout(noteTimer); noteTimer = setTimeout(saveNote, 2500); }
    async function saveNote() {
      clearTimeout(noteTimer); noteTimer = 0;
      if (!htmlToText(s.html)) return;
      const st = await ctx.store.getSettings().catch(() => null);
      if (!st) return;
      if (!s.noteId) { s.noteId = newNoteId(); ctx.save(); }
      if (!Array.isArray(st.textNotes)) st.textNotes = [];
      if (upsertNote(st.textNotes, { id: s.noteId, html: s.html })) ctx.store.saveSettings();
    }
    async function newPage() {
      if (!htmlToText(s.html)) { ed.focus(); return; }
      await saveNote();
      s.noteId = ''; s.html = ''; ed.innerHTML = '';
      ctx.save(); ed.focus();
      toast('已開始新的一頁，原本的內容存在「📚 紀錄」');
    }
    function use(n) {
      ed.innerHTML = n.html; s.html = n.html; s.noteId = n.id;
      ctx.save();
    }
    async function openNotes() {
      await saveNote();
      const st = await ctx.store.getSettings();
      if (!Array.isArray(st.textNotes)) st.textNotes = [];
      const list = st.textNotes;
      const q = h('input', { class: 'input', placeholder: '搜尋紀錄（例如：作業）', oninput: () => draw() });
      const box = h('div', { class: 'tn-list' });
      function draw() {
        const items = searchNotes(list, q.value);
        box.replaceChildren(...(items.length ? items.map((n) => h('div', { class: 'tn-item' + (n.id === s.noteId ? ' on' : '') },
          h('div', { class: 'tn-text' }, n.text),
          h('div', { class: 'tn-meta' },
            h('small', null, fmtWhen(n.at) + (n.id === s.noteId ? '・目前顯示' : '')),
            h('button', { class: 'btn primary', onclick: () => { use(n); dlg.close(); toast('已換成這則紀錄'); } }, '使用'),
            h('button', {
              class: 'btn', title: '刪除這則紀錄', onclick: async () => {
                if (!await confirmDialog('要刪除這則紀錄嗎？（文字框目前的內容不受影響）', '刪除', true)) return;
                deleteNote(list, n.id);
                if (n.id === s.noteId) { s.noteId = ''; ctx.save(); }
                ctx.store.saveSettings(); draw();
              },
            }, '🗑'))))
          : [h('p', { class: 'muted' }, list.length ? '找不到符合的紀錄。' : '還沒有紀錄。在文字框輸入內容後，會自動存成紀錄。')]));
      }
      draw();
      const dlg = modal({
        title: '📚 文字紀錄', wide: true, actions: [{ label: '關閉' }],
        body: h('div', { class: 'stack' }, h('small', { class: 'muted' }, '寫過的內容會自動存在這裡（存在你的資料夾，換電腦也找得到）。按「使用」換成那則內容；文字框目前的內容也已經存好。'), q, box),
      });
      setTimeout(() => q.focus(), 50);
    }

    ed.addEventListener('input', changed);
    ed.addEventListener('blur', () => { if (noteTimer) saveNote(); });
    ed.addEventListener('paste', (e) => {
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });
    ed.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        document.execCommand({ b: 'bold', i: 'italic', u: 'underline' }[e.key.toLowerCase()]);
        changed();
      }
    });
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/\n/g, '<br>');
    return {
      destroy: () => { stopObserve(); if (noteTimer) saveNote(); },
      remote: {
        view: () => ({ text: stripVS(ed.innerText).slice(0, 2000) }),
        act(a, { text = '' } = {}) {
          if (a === 'set') ed.innerHTML = esc(String(text).slice(0, 5000));
          else if (a === 'append') ed.innerHTML += (ed.innerHTML ? '<br>' : '') + esc(String(text).slice(0, 5000));
          else return;
          changed();
        },
      },
      update(state) { if (document.activeElement !== ed) ed.innerHTML = state.html; },
      settings: (c) => c.append(
        field('字體大小', h('input', { type: 'range', min: 3, max: 40, step: 0.5, value: s.size, oninput: (e) => { s.size = +e.target.value; apply(); ctx.save(); } })),
        field('文字顏色', colorRow(s.color, (v) => { s.color = v; apply(); ctx.save(); })),
        field('背景顏色', colorRow(s.bg, (v) => { s.bg = v; apply(); ctx.save(); })),
        field('字型', select(Object.entries(TEXT_FONTS).map(([k, f]) => [k, f.label]), TEXT_FONTS[s.font] ? s.font : 'default', (v) => setLayout({ font: v })),
          '注音字型的每個字都附注音（課本的樣式）。破音字預設顯示最常見的讀音，按工具列的「音」可以改成其他讀音或不標注音。'),
        field('文字方向', select([['h', '橫式'], ['v', '直式（由右往左）']], s.vertical ? 'v' : 'h', (v) => { if ((v === 'v') !== !!s.vertical) toggleVertical(); })),
        field('水平位置', select([['left', '靠左'], ['center', '置中'], ['right', '靠右']], s.align, (v) => setLayout({ align: v }))),
        field('垂直位置', select([['top', '靠上'], ['middle', '置中'], ['bottom', '靠下']], s.valign || 'top', (v) => setLayout({ valign: v }))),
        field('文字紀錄', h('div', { class: 'row-btns' },
          h('button', { class: 'btn', onclick: () => openNotes() }, '📚 開啟紀錄'),
          h('button', { class: 'btn', onclick: () => newPage() }, '📄 新的一頁')),
          '寫過的內容會自動存成紀錄，換電腦、換白板都能叫回。'),
        field('破音字（注音字型）', h('div', { class: 'stack' },
          checkbox('自動判斷常用詞的讀音（例如：銀行、音樂、睡覺、目的）', pyAuto(), (v) => { s.pyAuto = v; ctx.save(); runAuto({ reset: !v }); }),
          checkbox('「一」「不」標示變調（課本的標法，例如：一個、不是）', s.pySandhi !== false, (v) => { s.pySandhi = v; ctx.save(); runAuto(); })),
          '自動判斷可能有錯，按工具列的「音」可以手動修正；手動修正過的字不會再被自動改掉。'),
        h('p', { class: 'muted' }, '小技巧：滑鼠移到文字框上會出現工具列。先選取一段文字，再按 A+／A− 或顏色，就只會改那一段；沒有選取時改整段。工具列的 ↔ 水平置中、↕ 垂直置中、「直」切換直式文字、「ㄅ」切換注音字型、「音」選破音字的讀音。Ctrl+B 粗體、Ctrl+I 斜體、Ctrl+U 底線。'),
      ),
    };
  },
};

export const draw = {
  type: 'draw', title: '畫板', icon: '✏️', size: { w: 0.4, h: 0.45 },
  state: () => ({ img: null, bg: '#ffffff' }),
  mount(body, ctx) {
    const s = ctx.state;
    const canvas = h('canvas', { class: 'draw-canvas' });
    let color = '#1f2937', size = 4, eraser = false;
    const tools = h('div', { class: 'draw-tools' });
    body.append(h('div', { class: 'draw' }, canvas, tools));
    body.style.background = s.bg;
    const g = canvas.getContext('2d');
    let dpr = 1;

    function renderTools() {
      tools.innerHTML = '';
      ['#1f2937', '#ef4444', '#f97316', '#22c55e', '#0ea5e9', '#6366f1', '#ec4899'].forEach((c) =>
        tools.append(h('button', { class: 'sw' + (c === color && !eraser ? ' on' : ''), style: { background: c }, onclick: () => { color = c; eraser = false; renderTools(); } })));
      tools.append(
        h('select', { class: 'input mini', onchange: (e) => { size = +e.target.value; } },
          [[2, '細'], [4, '中'], [8, '粗'], [16, '特粗']].map(([v, l]) => { const o = h('option', { value: v }, l); o.selected = v === size; return o; })),
        h('button', { class: 'tool' + (eraser ? ' on' : ''), title: '橡皮擦', onclick: () => { eraser = !eraser; renderTools(); } }, '🧽'),
        h('button', { class: 'tool', title: '全部清除', onclick: () => { g.clearRect(0, 0, canvas.width, canvas.height); persist(); } }, '🗑️'));
    }
    renderTools();

    function loadImage(src) {
      g.clearRect(0, 0, canvas.width, canvas.height);
      if (!src) return;
      const img = new Image();
      img.onload = () => g.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.src = src;
    }
    function resize() {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const snapshot = canvas.width ? canvas.toDataURL() : s.img;
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      loadImage(snapshot);
    }
    const unobserve = observeSize(canvas, resize);

    let saveT;
    function persist() {
      clearTimeout(saveT);
      saveT = setTimeout(() => { s.img = canvas.toDataURL('image/png'); ctx.save(); }, 400);
    }
    let last = null;
    canvas.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      canvas.setPointerCapture(e.pointerId);
      const r = canvas.getBoundingClientRect();
      last = [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr];
      stroke(last, last);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!last) return;
      const r = canvas.getBoundingClientRect();
      const p = [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr];
      stroke(last, p);
      last = p;
    });
    const end = () => { if (last) { last = null; persist(); } };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    function stroke(a, b) {
      g.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
      g.strokeStyle = color;
      g.lineWidth = (eraser ? size * 4 : size) * dpr;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.stroke();
    }
    return {
      destroy: () => { unobserve(); clearTimeout(saveT); },
      update(state) { if (!last) loadImage(state.img); },
      settings: (c) => c.append(field('背景顏色', colorRow(s.bg, (v) => { s.bg = v; body.style.background = v; ctx.save(); }))),
    };
  },
};

export const image = {
  type: 'image', title: '圖片', icon: '🖼️', size: { w: 0.34, h: 0.36 },
  state: () => ({ ref: null, fit: 'contain', caption: '' }),
  mount(body, ctx) {
    const s = ctx.state;
    const wrap = h('div', { class: 'image-w' });
    body.append(wrap);
    async function choose() {
      const r = await pickImage(ctx.store);
      if (r) { s.ref = r; render(); ctx.save(); }
    }
    function render() {
      wrap.innerHTML = '';
      if (!s.ref) {
        wrap.append(h('button', { class: 'btn primary', onclick: choose }, '選擇圖片'));
        return;
      }
      const img = h('img', { alt: s.caption || '', style: { objectFit: s.fit } });
      setImage(img, ctx.store, s.ref);
      img.onerror = () => { wrap.innerHTML = ''; wrap.append(h('div', { class: 'muted center' }, '圖片無法載入'), h('button', { class: 'btn', onclick: choose }, '重新選擇')); };
      wrap.append(img);
      if (s.caption) wrap.append(h('div', { class: 'image-cap' }, s.caption));
    }
    render();
    return {
      settings: (c) => c.append(
        h('button', { class: 'btn primary', onclick: choose }, '更換圖片'),
        field('顯示方式', select([['contain', '完整顯示'], ['cover', '填滿裁切']], s.fit, (v) => { s.fit = v; render(); ctx.save(); })),
        field('說明文字', h('input', { class: 'input', value: s.caption, oninput: (e) => { s.caption = e.target.value; render(); ctx.save(); } }))),
    };
  },
};

export const qr = {
  type: 'qr', title: 'QR Code', icon: '🔳', size: { w: 0.22, h: 0.34 },
  state: () => ({ text: '', label: true }),
  mount(body, ctx) {
    const s = ctx.state;
    const box = h('div', { class: 'qr-box' });
    const cap = h('div', { class: 'qr-cap' });
    const input = h('input', { class: 'input', placeholder: '貼上網址或文字', value: s.text });
    input.addEventListener('input', () => { s.text = input.value; render(); ctx.save(); });
    body.append(h('div', { class: 'qr' }, box, cap));
    function render() {
      box.innerHTML = '';
      if (!s.text) { box.append(h('div', { class: 'muted center' }, '按 ⚙ 輸入網址')); cap.textContent = ''; return; }
      try {
        const q = window.qrcode(0, 'M');
        q.addData(s.text, 'Byte');
        q.make();
        box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      } catch { box.textContent = '內容太長，無法產生'; }
      cap.textContent = s.label ? s.text : '';
    }
    if (window.qrcode) window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs['UTF-8'];
    render();
    return {
      settings: (c) => c.append(field('網址或文字', input), checkbox('在下方顯示文字', s.label, (v) => { s.label = v; render(); ctx.save(); })),
    };
  },
};

const VIDEO_EXT = /\.(mp4|webm|ogv|ogg|mov|m4v)$/i;

// 判斷網址類型：youtube（嵌入播放器）、video（影片檔）、web（一般網頁）
export function classifyUrl(url) {
  let u;
  try { u = new URL(String(url).trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtube.com') id = u.searchParams.get('v') || (u.pathname.match(/\/(shorts|live|embed|v)\/([\w-]{6,})/) || [])[2];
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  const list = u.searchParams.get('list');
  if (id || (host === 'youtube.com' && list)) {
    const t = u.searchParams.get('t') || u.searchParams.get('start') || '';
    const m = String(t).match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
    const start = m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
    return { kind: 'youtube', id, list, start, href: u.href };
  }
  const social = socialEmbed(u, host);
  if (social) return { kind: 'social', ...social, href: u.href };
  if (VIDEO_EXT.test(u.pathname)) return { kind: 'video', href: u.href };
  return { kind: 'web', href: u.href };
}

export const PLATFORMS = {
  facebook: { name: 'Facebook', icon: '📘' },
  instagram: { name: 'Instagram', icon: '📸' },
  threads: { name: 'Threads', icon: '🧵' },
  tiktok: { name: 'TikTok', icon: '🎵' },
  vimeo: { name: 'Vimeo', icon: '🎞️' },
};

// 社群網站的貼文／影片：轉成官方的嵌入網址。portrait = 直式影片（Reels、短影音）
function socialEmbed(u, host) {
  const path = u.pathname;
  const enc = encodeURIComponent;
  if (/^(facebook\.com|fb\.com|fb\.watch|web\.facebook\.com)$/.test(host)) {
    const href = enc(u.href);
    const reel = /\/(reel|share\/r)\//.test(path);
    if (host === 'fb.watch' || reel || /\/(videos|watch|share\/v)(\/|$)/.test(path)) {
      return { platform: 'facebook', portrait: reel, embed: `https://www.facebook.com/plugins/video.php?href=${href}&show_text=false` };
    }
    if (/\/(posts|permalink\.php|share\/p|photo|story\.php)/.test(path)) {
      return { platform: 'facebook', portrait: true, embed: `https://www.facebook.com/plugins/post.php?href=${href}&show_text=true` };
    }
    return null; // 粉絲專頁首頁等：當一般網頁用瀏覽器開
  }
  if (host === 'instagram.com') {
    const m = path.match(/^\/(?:[\w.]+\/)?(p|reels?|tv)\/([\w-]+)/);
    if (m) return { platform: 'instagram', portrait: true, embed: `https://www.instagram.com/${m[1] === 'reels' ? 'reel' : m[1]}/${m[2]}/embed/` };
    return null;
  }
  if (host === 'threads.net' || host === 'threads.com') {
    const m = path.match(/^\/(@[\w.]+)\/post\/([\w-]+)/);
    if (m) return { platform: 'threads', portrait: true, embed: `https://www.threads.com/${m[1]}/post/${m[2]}/embed` };
    return null;
  }
  if (host === 'tiktok.com') {
    const m = path.match(/\/video\/(\d+)/);
    if (m) return { platform: 'tiktok', portrait: true, embed: `https://www.tiktok.com/embed/v2/${m[1]}` };
    return null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = path.match(/\/(?:video\/)?(\d+)(?:\/(\w+))?/);
    if (m) return { platform: 'vimeo', portrait: false, embed: `https://player.vimeo.com/video/${m[1]}${m[2] ? `?h=${m[2]}` : ''}` };
  }
  return null;
}

// 用電腦的預設瀏覽器開啟（桌面版），網頁版則開新分頁
export async function openExternal(url) {
  if (window.Neutralino && window.NL_PORT) { await window.Neutralino.os.open(url); return true; }
  return !!window.open(url, '_blank', 'noopener');
}

function youtubeSrc(info, autoplay) {
  const q = new URLSearchParams({ enablejsapi: '1', rel: '0', playsinline: '1' });
  if (autoplay) q.set('autoplay', '1');
  if (info.start) q.set('start', info.start);
  if (info.list) q.set('list', info.list);
  return `https://www.youtube-nocookie.com/embed/${info.id || 'videoseries'}?${q}`;
}

function toEmbedUrl(url) {
  if (/docs\.google\.com/.test(url) && /\/(edit|view)/.test(url)) return url.replace(/\/(edit|view)[^/]*$/, '/preview');
  return classifyUrl(url)?.href || null;
}

export const embed = {
  type: 'embed', title: '網頁／影片', icon: '🌐', size: { w: 0.45, h: 0.45 },
  state: () => ({ url: '', autoplay: false }),
  mount(body, ctx) {
    const s = ctx.state;
    const wrap = h('div', { class: 'embed' });
    body.append(wrap);
    const input = h('input', { class: 'input', placeholder: 'YouTube、影片檔、Google 簡報或其他網址', value: s.url });
    let frame = null, video = null, info = null, playing = false, muted = false;
    const yt = (func, args = []) => frame?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
    function render() {
      wrap.innerHTML = '';
      wrap.classList.remove('social');
      frame = video = null; playing = false;
      info = s.url ? classifyUrl(s.url) : null;
      if (!info) {
        const inline = h('input', { class: 'input', placeholder: '貼上 YouTube、影片或網頁網址後按 Enter' });
        inline.addEventListener('keydown', (e) => { if (e.key === 'Enter') { s.url = inline.value.trim(); input.value = s.url; render(); ctx.save(); } });
        wrap.append(h('div', { class: 'embed-empty' }, inline, h('small', { class: 'muted' }, '部分網站不允許被嵌入，會顯示空白。')));
        return;
      }
      const autoplay = s.autoplay;
      if (s.autoplay) { s.autoplay = false; ctx.save(); } // 只在剛從手機送來時自動播放一次
      if (info.kind === 'video') {
        video = h('video', { src: info.href, controls: true, playsinline: true, preload: 'metadata' });
        video.addEventListener('play', () => { playing = true; ctx.push?.(); });
        video.addEventListener('pause', () => { playing = false; ctx.push?.(); });
        video.addEventListener('error', () => toast('影片無法播放，可能是格式不支援或網址需要登入'));
        wrap.append(video);
        if (autoplay) video.play().catch(() => {});
        return;
      }
      const src = info.kind === 'youtube' ? youtubeSrc(info, autoplay) : info.kind === 'social' ? info.embed : toEmbedUrl(s.url);
      frame = h('iframe', { src, allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' });
      if (info.kind === 'youtube') {
        playing = autoplay;
        // 讓 YouTube 回報播放狀態
        frame.addEventListener('load', () => frame?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1 }), '*'));
      }
      wrap.append(frame);
      if (info.kind === 'social') wrap.classList.add('social');
    }
    const onMsg = (e) => {
      if (!frame || e.source !== frame.contentWindow) return;
      let d; try { d = JSON.parse(e.data); } catch { return; }
      const st = d?.info?.playerState ?? (d?.event === 'onStateChange' ? d.info : undefined);
      if (typeof st === 'number' && (st === 1) !== playing) { playing = st === 1; ctx.push?.(); }
      if (typeof d?.info?.muted === 'boolean') muted = d.info.muted;
    };
    window.addEventListener('message', onMsg);
    input.addEventListener('change', () => { s.url = input.value.trim(); render(); ctx.save(); });
    render();
    return {
      destroy: () => window.removeEventListener('message', onMsg),
      remote: {
        view: () => ({ kind: info?.kind || '', platform: info?.platform || '', url: s.url, playing, muted: video ? video.muted : muted }),
        act(a) {
          if (video) {
            if (a === 'play') video.play().catch(() => {});
            else if (a === 'pause') video.pause();
            else if (a === 'toggle') (video.paused ? video.play().catch(() => {}) : video.pause());
            else if (a === 'back') video.currentTime = Math.max(0, video.currentTime - 10);
            else if (a === 'fwd') video.currentTime += 10;
            else if (a === 'mute') video.muted = !video.muted;
            else if (a === 'restart') { video.currentTime = 0; video.play().catch(() => {}); }
          } else if (info?.kind === 'youtube') {
            if (a === 'toggle') a = playing ? 'pause' : 'play';
            if (a === 'play') { yt('playVideo'); playing = true; }
            else if (a === 'pause') { yt('pauseVideo'); playing = false; }
            else if (a === 'mute') { yt(muted ? 'unMute' : 'mute'); muted = !muted; }
            else if (a === 'restart') { yt('seekTo', [0, true]); yt('playVideo'); playing = true; }
          }
          if (a === 'reload') render();
          if (a === 'browser' && info) openExternal(info.href);
          ctx.push?.();
        },
      },
      settings: (c) => c.append(field('網址', input)),
    };
  },
};

export const webcam = {
  type: 'webcam', title: '視訊鏡頭', icon: '📷', size: { w: 0.36, h: 0.36 },
  state: () => ({ mirror: true }),
  mount(body, ctx) {
    const s = ctx.state;
    const video = h('video', { autoplay: true, playsinline: true, muted: true, class: 'cam' });
    const btn = h('button', { class: 'btn primary', onclick: () => start() }, '開啟鏡頭');
    const wrap = h('div', { class: 'cam-wrap' }, btn);
    body.append(wrap);
    let stream;
    async function start() {
      if (!window.isSecureContext || !navigator.mediaDevices) return toast('需要 HTTPS 或 localhost 才能使用鏡頭（請參考 README）');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        video.style.transform = s.mirror ? 'scaleX(-1)' : '';
        wrap.innerHTML = '';
        wrap.append(video);
      } catch (e) { toast('無法開啟鏡頭：' + e.message); }
    }
    return {
      destroy: () => stream?.getTracks().forEach((t) => t.stop()),
      settings: (c) => c.append(checkbox('鏡像顯示', s.mirror, (v) => { s.mirror = v; video.style.transform = v ? 'scaleX(-1)' : ''; ctx.save(); })),
    };
  },
};
