// 讀取 OpenDocument（LibreOffice／ODF）轉成 HTML，給「匯入資源」小工具顯示。不用外部套件，離線也能用。
//   .odt 文字文件：段落（對齊、縮排）、標題、粗體、斜體、底線、刪除線、顏色、螢光筆、字型大小、上下標、
//                  清單（項目符號、編號）、表格（合併儲存格）、圖片、超連結、換行與定位點
//   .ods 試算表：每個工作表一個表格（顯示儲存格的文字，合併儲存格、數字靠右）
//   .odp 簡報：逐頁顯示，文字框與圖片依原本的位置排列（字型大小是近似值）
// 不支援：頁首頁尾、註腳、註解、圖表、方程式、試算表的公式重算（顯示存檔時的結果）。
// 文字一律跳脫，超連結只保留 http(s)，輸出可以直接放進 innerHTML。
import { readZip, parseXml } from './docx.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const kids = (el, name) => (el?.children || []).filter((c) => c.name && (!name || c.name === name));
const kid = (el, name) => (el?.children || []).find((c) => c.name === name);
function find(el, name) {
  for (const c of el?.children || []) {
    if (!c.name) continue;
    if (c.name === name) return c;
    const f = find(c, name);
    if (f) return f;
  }
  return null;
}
const round = (n) => Math.round(n * 1000) / 1000;

// 長度（cm、mm、in、pt、px）→ pt
export function toPt(v) {
  const m = /^(-?[\d.]+)\s*(cm|mm|in|pt|pc|px)?$/.exec(String(v || '').trim());
  if (!m) return null;
  const n = +m[1];
  return n * ({ cm: 28.3465, mm: 2.83465, in: 72, pt: 1, pc: 12, px: 0.75 }[m[2] || 'pt']);
}

// ---------------------------------------------------------------- 打開檔案
async function openOdf(buffer) {
  let zip;
  try { zip = readZip(buffer); } catch { throw new Error('不是 OpenDocument 檔案，或檔案已損壞'); }
  const dec = new TextDecoder();
  const read = async (name) => { const f = zip.get(name); return f ? dec.decode(await f()) : ''; };
  const content = parseXml(await read('content.xml'));
  if (!find(content, 'office:body')) throw new Error('不是 OpenDocument 檔案，或檔案已損壞');
  return { zip, content, styles: parseXml(await read('styles.xml')) };
}

// ---------------------------------------------------------------- 樣式
// 樣式名稱 → { parent, text: {}, para: {} }；預設樣式放在 '#default:<family>'
function readStyles(...docs) {
  const map = new Map();
  const lists = new Map();
  const add = (el) => {
    if (el.name === 'style:style' || el.name === 'style:default-style') {
      const name = el.name === 'style:default-style' ? '#default:' + el.attrs['style:family'] : el.attrs['style:name'];
      map.set(name, {
        family: el.attrs['style:family'],
        parent: el.attrs['style:parent-style-name'] || (el.name === 'style:style' ? '#default:' + el.attrs['style:family'] : ''),
        text: kid(el, 'style:text-properties')?.attrs || {},
        para: kid(el, 'style:paragraph-properties')?.attrs || {},
        cell: kid(el, 'style:table-cell-properties')?.attrs || {},
        graphic: kid(el, 'style:graphic-properties')?.attrs || {},
        list: el.attrs['style:list-style-name'] || '',
      });
    } else if (el.name === 'text:list-style') {
      const levels = {};
      for (const lv of kids(el)) {
        const n = +lv.attrs['text:level'] || 1;
        levels[n] = lv.name === 'text:list-level-style-number' ? { num: lv.attrs['style:num-format'] || '1' } : { num: '' };
      }
      lists.set(el.attrs['style:name'], levels);
    }
  };
  for (const doc of docs) {
    for (const sec of ['office:styles', 'office:automatic-styles']) {
      const s = find(doc, sec);
      for (const el of kids(s)) add(el);
    }
  }
  // 往上找父樣式，合併屬性（自己的優先）
  const cache = new Map();
  const resolve = (name, depth = 0) => {
    const st = name && depth <= 20 ? map.get(name) : null;
    if (!st) return { text: {}, para: {}, cell: {}, graphic: {}, list: '' };
    if (cache.has(name)) return cache.get(name);
    const p = resolve(st.parent, depth + 1);
    const r = { text: { ...p.text, ...st.text }, para: { ...p.para, ...st.para }, cell: { ...p.cell, ...st.cell }, graphic: { ...p.graphic, ...st.graphic }, list: st.list || p.list };
    cache.set(name, r);
    return r;
  };
  return { resolve, lists };
}

// 字型大小（pt）；百分比是相對於外層
function sizePt(t, refPt) {
  const fs = String(t['fo:font-size'] || '');
  if (!fs) return refPt;
  return fs.endsWith('%') ? (refPt * parseFloat(fs)) / 100 : toPt(fs) || refPt;
}

// 文字屬性 → CSS；basePt：外層的字型大小（字型大小換成相對於外層的 em）
function textCss(t, basePt) {
  const css = [];
  if (t['fo:font-weight'] && t['fo:font-weight'] !== 'normal') css.push('font-weight:700');
  if (t['fo:font-style'] === 'italic' || t['fo:font-style'] === 'oblique') css.push('font-style:italic');
  const deco = [];
  if (t['style:text-underline-style'] && t['style:text-underline-style'] !== 'none') deco.push('underline');
  if (t['style:text-line-through-style'] && t['style:text-line-through-style'] !== 'none') deco.push('line-through');
  if (deco.length) css.push('text-decoration:' + deco.join(' '));
  if (/^#[0-9a-f]{6}$/i.test(t['fo:color'] || '')) css.push('color:' + t['fo:color']);
  if (/^#[0-9a-f]{6}$/i.test(t['fo:background-color'] || '')) css.push('background:' + t['fo:background-color']);
  const pos = String(t['style:text-position'] || '');
  if (/^(super|sub|-?\d)/.test(pos) && !/^0%?(\s|$)/.test(pos)) {
    css.push('vertical-align:' + (/^(sub|-)/.test(pos) ? 'sub' : 'super'), 'font-size:.65em');
  } else if (t['fo:font-size']) {
    const fs = String(t['fo:font-size']);
    const em = fs.endsWith('%') ? parseFloat(fs) / 100 : toPt(fs) / basePt;
    if (em > 0 && Math.abs(em - 1) > 0.01) css.push(`font-size:${round(em)}em`);
  }
  return css.join(';');
}

function paraCss(p, basePt) {
  const css = [];
  const al = { center: 'center', end: 'right', right: 'right', justify: 'justify' }[p['fo:text-align']];
  if (al) css.push('text-align:' + al);
  const ml = toPt(p['fo:margin-left']);
  if (ml > 1) css.push(`margin-left:${round(ml / basePt)}em`);
  const ti = toPt(p['fo:text-indent']);
  if (ti && Math.abs(ti) > 1) css.push(`text-indent:${round(ti / basePt)}em`);
  if (/^#[0-9a-f]{6}$/i.test(p['fo:background-color'] || '')) css.push('background:' + p['fo:background-color']);
  return css.join(';');
}

const ATTR_STYLE = (css) => (css ? ` style="${esc(css)}"` : '');
const LIST_TYPE = { 1: '1', a: 'a', A: 'A', i: 'i', I: 'I' };

// ---------------------------------------------------------------- 文字內容（.odt 與簡報的文字框共用）
function makeWriter({ st, basePt, image }) {
  async function inline(el, out, curPt = basePt) {
    for (const c of el.children || []) {
      if (!c.name) { out.push(esc(c.text)); continue; }
      switch (c.name) {
        case 'text:span': {
          const inner = [];
          const t = st.resolve(c.attrs['text:style-name']).text;
          await inline(c, inner, sizePt(t, curPt));
          const css = textCss(t, curPt);
          out.push(css ? `<span style="${esc(css)}">${inner.join('')}</span>` : inner.join(''));
          break;
        }
        case 'text:a': {
          const inner = [];
          await inline(c, inner, curPt);
          const href = c.attrs['xlink:href'] || '';
          out.push(/^https?:\/\//i.test(href) ? `<a class="dx-link" href="#" data-href="${esc(href)}">${inner.join('')}</a>` : inner.join(''));
          break;
        }
        case 'text:s': out.push('&nbsp;'.repeat(Math.min(200, +c.attrs['text:c'] || 1))); break;
        case 'text:tab': out.push('<span class="dx-tab"></span>'); break;
        case 'text:line-break': out.push('<br>'); break;
        case 'draw:frame': out.push(await frame(c)); break;
        case 'draw:a': await inline(c, out, curPt); break;
        case 'text:note': case 'office:annotation': case 'office:annotation-end': case 'text:bookmark-ref':
        case 'text:tracked-changes': case 'text:deletion': break;
        default: await inline(c, out, curPt); // 欄位（頁碼、日期…）、書籤：只取裡面的文字
      }
    }
    return out;
  }

  async function frame(el) {
    const img = kid(el, 'draw:image');
    if (img) {
      const url = await image(img.attrs['xlink:href']);
      if (!url) return '';
      const w = toPt(el.attrs['svg:width']);
      return `<img src="${esc(url)}" alt=""${w ? ` style="width:${Math.round(w / 0.75)}px"` : ''}>`;
    }
    const box = kid(el, 'draw:text-box');
    return box ? (await blocks(box)).join('') : '';
  }

  async function paragraph(el, tag, extraCss = '', prefix = '') {
    const r = st.resolve(el.attrs['text:style-name']);
    const pcss = [paraCss(r.para, basePt), textCss(r.text, basePt), extraCss].filter(Boolean).join(';');
    const inner = (await inline(el, [], sizePt(r.text, basePt))).join('');
    return `<${tag} class="dx-p"${ATTR_STYLE(pcss)}>${prefix}${inner || '&nbsp;'}</${tag}>`;
  }

  async function list(el, level, styleName) {
    const name = el.attrs['text:style-name'] || styleName;
    const lv = st.lists.get(name)?.[level];
    const num = lv?.num;
    const tag = num ? 'ol' : 'ul';
    const type = num && LIST_TYPE[num] ? ` type="${LIST_TYPE[num]}"` : '';
    const start = el.attrs['text:start-value'] ? ` start="${+el.attrs['text:start-value'] || 1}"` : '';
    const items = [];
    for (const it of kids(el)) {
      if (it.name !== 'text:list-item' && it.name !== 'text:list-header') continue;
      const parts = [];
      for (const c of kids(it)) {
        if (c.name === 'text:list') parts.push(await list(c, level + 1, name));
        else parts.push(...(await blocks({ children: [c] })));
      }
      items.push(`<li${it.name === 'text:list-header' ? ' style="list-style:none"' : ''}>${parts.join('')}</li>`);
    }
    return `<${tag} class="od-list"${type}${start}>${items.join('')}</${tag}>`;
  }

  async function table(el) {
    const rows = [];
    const collect = (node) => {
      for (const c of kids(node)) {
        if (c.name === 'table:table-row') rows.push(c);
        else if (/^table:table-(header-)?rows$|^table:table-row-group$/.test(c.name)) collect(c);
      }
    };
    collect(el);
    const out = [];
    for (const r of rows) {
      const cells = [];
      for (const c of kids(r, 'table:table-cell')) {
        const cs = +c.attrs['table:number-columns-spanned'] || 1;
        const rs = +c.attrs['table:number-rows-spanned'] || 1;
        const bg = st.resolve(c.attrs['table:style-name']).cell['fo:background-color'];
        const css = /^#[0-9a-f]{6}$/i.test(bg || '') ? `background:${bg}` : '';
        cells.push(`<td${cs > 1 ? ` colspan="${cs}"` : ''}${rs > 1 ? ` rowspan="${rs}"` : ''}${ATTR_STYLE(css)}>${(await blocks(c)).join('')}</td>`);
      }
      out.push(`<tr>${cells.join('')}</tr>`);
    }
    return `<table class="dx-table">${out.join('')}</table>`;
  }

  // 區塊：段落、標題、清單、表格、圖片…
  async function blocks(el) {
    const out = [];
    for (const c of el.children || []) {
      if (!c.name) continue;
      switch (c.name) {
        case 'text:p': out.push(await paragraph(c, 'p')); break;
        case 'text:h': {
          const lv = Math.min(6, Math.max(2, (+c.attrs['text:outline-level'] || 1) + 1));
          out.push(await paragraph(c, 'h' + lv));
          break;
        }
        case 'text:list': out.push(await list(c, 1, '')); break;
        case 'table:table': out.push(await table(c)); break;
        case 'draw:frame': out.push(await frame(c)); break;
        case 'text:section': case 'text:index-body': case 'text:table-of-content': case 'text:alphabetical-index':
        case 'text:illustration-index': case 'text:table-index': case 'text:user-index': case 'draw:a':
          out.push(...(await blocks(c))); break;
        case 'text:soft-page-break': break;
        default: break; // 宣告、變數設定、註解…
      }
    }
    return out;
  }

  return { blocks, inline, paragraph };
}

// 圖片：ZIP 裡的路徑 → 網址（同一張只讀一次）
function imageLoader(zip, imageUrl) {
  const cache = new Map();
  let count = 0;
  const load = async (href) => {
    if (!href || /^[a-z]+:/i.test(href)) return '';
    const path = href.replace(/^\.\//, '');
    if (!cache.has(path)) {
      const f = zip.get(path);
      cache.set(path, f ? f().then((data) => imageUrl(path, data)).catch(() => '') : Promise.resolve(''));
    }
    const url = await cache.get(path);
    if (url) count++;
    return url;
  };
  load.count = () => count;
  return load;
}

function basePtOf(st, family) {
  const t = st.resolve('#default:' + family).text;
  return toPt(t['fo:font-size']) || 12;
}

// ---------------------------------------------------------------- .odt
export async function odtToHtml(buffer, { imageUrl = () => '' } = {}) {
  const { zip, content, styles } = await openOdf(buffer);
  const body = find(content, 'office:text');
  if (!body) throw new Error('這不是文字文件（.odt）');
  const st = readStyles(styles, content);
  const basePt = basePtOf(st, 'paragraph');
  const image = imageLoader(zip, imageUrl);
  const w = makeWriter({ st, basePt, image });
  const html = (await w.blocks(body)).join('');
  return { html, images: image.count() };
}

// ---------------------------------------------------------------- .ods
const MAX_ROWS = 2000;
const MAX_COLS = 200;
export async function odsToHtml(buffer, { imageUrl = () => '' } = {}) {
  const { zip, content, styles } = await openOdf(buffer);
  const body = find(content, 'office:spreadsheet');
  if (!body) throw new Error('這不是試算表（.ods）');
  const st = readStyles(styles, content);
  const basePt = basePtOf(st, 'table-cell') || basePtOf(st, 'paragraph');
  const w = makeWriter({ st, basePt, image: imageLoader(zip, imageUrl) });
  const out = [];
  for (const tb of kids(body, 'table:table')) {
    const rows = [];
    const rowEls = [];
    const collect = (node) => {
      for (const c of kids(node)) {
        if (c.name === 'table:table-row') rowEls.push(c);
        else if (/^table:table-(header-)?rows$|^table:table-row-group$/.test(c.name)) collect(c);
      }
    };
    collect(tb);
    for (const r of rowEls) {
      const rep = Math.min(+r.attrs['table:number-rows-repeated'] || 1, MAX_ROWS);
      const cells = [];
      for (const c of kids(r)) {
        if (c.name !== 'table:table-cell' && c.name !== 'table:covered-table-cell') continue;
        const crep = Math.min(+c.attrs['table:number-columns-repeated'] || 1, MAX_COLS);
        const covered = c.name === 'table:covered-table-cell';
        let html = '';
        if (!covered) {
          const parts = [];
          for (const p of kids(c, 'text:p')) parts.push((await w.inline(p, [])).join(''));
          html = parts.join('<br>');
        }
        const r2 = st.resolve(c.attrs['table:style-name']);
        const css = [textCss(r2.text, basePt), /^#[0-9a-f]{6}$/i.test(r2.cell['fo:background-color'] || '') ? 'background:' + r2.cell['fo:background-color'] : '',
          /^(float|percentage|currency)$/.test(c.attrs['office:value-type'] || '') && !r2.para['fo:text-align'] ? 'text-align:right' : paraCss(r2.para, basePt)].filter(Boolean).join(';');
        const cell = { html, css, covered, cs: +c.attrs['table:number-columns-spanned'] || 1, rs: +c.attrs['table:number-rows-spanned'] || 1 };
        for (let i = 0; i < crep && cells.length < MAX_COLS; i++) cells.push(i ? { ...cell } : cell);
      }
      for (let i = 0; i < rep && rows.length < MAX_ROWS; i++) rows.push(cells);
    }
    // 去掉後面空白的列與欄（試算表會用「重複」補滿整張表）
    const filled = (c) => c && !c.covered && c.html.replace(/&nbsp;/g, '').trim() !== '';
    while (rows.length && !rows[rows.length - 1].some(filled)) rows.pop();
    let cols = 0;
    for (const r of rows) r.forEach((c, i) => { if (filled(c)) cols = Math.max(cols, i + 1 + (c.cs - 1)); });
    if (!rows.length || !cols) continue;
    const trs = rows.map((r) => {
      const tds = [];
      for (let i = 0; i < cols; i++) {
        const c = r[i];
        if (!c) { tds.push('<td></td>'); continue; }
        if (c.covered) continue;
        tds.push(`<td${c.cs > 1 ? ` colspan="${Math.min(c.cs, cols - i)}"` : ''}${c.rs > 1 ? ` rowspan="${c.rs}"` : ''}${ATTR_STYLE(c.css)}>${c.html}</td>`);
      }
      return `<tr>${tds.join('')}</tr>`;
    });
    out.push(`<h3 class="od-sheet">${esc(tb.attrs['table:name'] || '')}</h3><table class="dx-table od-table">${trs.join('')}</table>`);
  }
  return { html: out.join('') || '<p class="dx-p">（試算表是空的）</p>', images: 0 };
}

// ---------------------------------------------------------------- .odp
// 投影片：寬高用 pt；每頁是一個 .od-slide，裡面的物件依位置以百分比排列。
// 字型大小用 cqw（相對於投影片寬度），小工具大小改變時一起縮放。
export async function odpToHtml(buffer, { imageUrl = () => '' } = {}) {
  const { zip, content, styles } = await openOdf(buffer);
  const body = find(content, 'office:presentation');
  if (!body) throw new Error('這不是簡報（.odp）');
  const st = readStyles(styles, content);
  const layout = find(styles, 'style:page-layout-properties');
  const W = toPt(layout?.attrs['fo:page-width']) || toPt('28cm');
  const H = toPt(layout?.attrs['fo:page-height']) || toPt('15.75cm');
  const BASE = 18; // 一般文字的大小（pt）；標題、內文再依類別放大
  const image = imageLoader(zip, imageUrl);
  const w = makeWriter({ st, basePt: BASE, image });
  const pct = (v, total) => round(((toPt(v) || 0) / total) * 100);
  const CLASS_EM = { title: 2.2, subtitle: 1.5, outline: 1.5 };

  async function shape(el) {
    const out = [];
    if (el.name === 'draw:g') {
      for (const c of kids(el)) out.push(...(await shape(c)));
      return out;
    }
    if (!/^draw:(frame|custom-shape|rect|ellipse|text-box)$/.test(el.name)) return out;
    const cls = el.attrs['presentation:class'] || '';
    if (/^(page-number|footer|date-time|header)$/.test(cls)) return out;
    const box = `left:${pct(el.attrs['svg:x'], W)}%;top:${pct(el.attrs['svg:y'], H)}%;width:${pct(el.attrs['svg:width'], W)}%;height:${pct(el.attrs['svg:height'], H)}%`;
    const img = kid(el, 'draw:image');
    if (img && !find(img, 'text:p')) {
      const url = await image(img.attrs['xlink:href']);
      if (url) out.push(`<img class="od-obj" style="${box}" src="${esc(url)}" alt="">`);
      return out;
    }
    const tb = kid(el, 'draw:text-box') || el;
    const inner = (await w.blocks(tb)).join('');
    if (!inner) return out;
    const g = st.resolve(el.attrs['draw:style-name'] || el.attrs['presentation:style-name']).graphic;
    const bg = /^#[0-9a-f]{6}$/i.test(g['draw:fill-color'] || '') && g['draw:fill'] === 'solid' ? `;background:${g['draw:fill-color']}` : '';
    const em = CLASS_EM[cls] ? `;font-size:${CLASS_EM[cls]}em` : '';
    out.push(`<div class="od-obj od-text${cls ? ' od-' + esc(cls) : ''}" style="${box}${bg}${em}">${inner}</div>`);
    return out;
  }

  const slides = [];
  for (const page of kids(body, 'draw:page')) {
    const parts = [];
    for (const c of kids(page)) {
      if (c.name === 'presentation:notes') continue;
      parts.push(...(await shape(c)));
    }
    const font = round((BASE / W) * 100);
    slides.push(`<section class="od-slide" style="aspect-ratio:${round(W)}/${round(H)}"><div class="od-page" style="font-size:${font}cqw">${parts.join('')}</div></section>`);
  }
  return { html: slides.join('') || '<p class="dx-p">（簡報沒有投影片）</p>', images: image.count(), slides: slides.length };
}
