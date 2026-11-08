// 讀取 Word（.docx）並轉成 HTML，給「試卷釋疑」小工具顯示。不用外部套件，離線也能用。
// 支援：段落（置中、靠右、縮排）、標題、粗體、斜體、底線、刪除線、文字顏色、螢光筆、字型大小、上下標、
//       項目符號與編號（一、1.、(1)、①…）、表格（合併儲存格）、圖片、超連結、換行與定位點。
// 不支援：舊版 .doc、文字方塊的版面位置、頁首頁尾、註腳、方程式（會略過）。
//
// 字型大小一律換成 em（相對於文件的預設字型大小），小工具調整字的大小時整份文件一起縮放。

// ---------------------------------------------------------------- ZIP（.docx 其實是 ZIP 壓縮檔）
const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

// → Map(檔名 → 讀出內容的函式 () => Promise<Uint8Array>)
export function readZip(buffer) {
  const b = new Uint8Array(buffer);
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (u32(b, i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('不是 Word 檔（.docx）或檔案已損壞');
  const count = u16(b, end + 10);
  let p = u32(b, end + 16);
  const files = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < count && u32(b, p) === 0x02014b50; n++) {
    const method = u16(b, p + 10);
    const size = u32(b, p + 20);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const local = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    files.set(name, async () => {
      const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
      const data = b.subarray(start, start + size);
      if (method === 0) return data;
      if (method !== 8) throw new Error('不支援的壓縮方式');
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

// ---------------------------------------------------------------- XML → { name, attrs, children, text }
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const unescape = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1));
  return ENT[e] ?? m;
});

export function parseXml(src) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!(?:[^>])*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] != null) { top.children.push({ text: m[1] }); continue; }
    if (m[6] != null) { top.children.push({ text: unescape(m[6]) }); continue; }
    if (!m[3]) continue; // 註解、宣告
    if (m[2]) { // 結束標籤
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs = {};
    for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unescape(a[2] ?? a[3]);
    const el = { name: m[3], attrs, children: [] };
    top.children.push(el);
    if (!m[5]) stack.push(el);
  }
  return root;
}

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
const val = (el, name, a = 'w:val') => kid(el, name)?.attrs[a];
// 開關屬性：<w:b/> 或 <w:b w:val="true"/> 是開；w:val="0"/"false"/"none" 是關
function flag(el, name) {
  const k = kid(el, name);
  if (!k) return undefined;
  const v = k.attrs['w:val'];
  return !(v === '0' || v === 'false' || v === 'none');
}

// ---------------------------------------------------------------- 樣式、編號
const HIGHLIGHT = {
  yellow: '#fff200', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000',
  darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000',
  darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000', white: '#ffffff',
};
const hex = (v) => (/^[0-9a-f]{6}$/i.test(v || '') ? '#' + v : '');

// 文字格式：只取用得到的欄位，後面的蓋過前面的
function runProps(rPr) {
  if (!rPr) return {};
  const o = {};
  const set = (k, v) => { if (v !== undefined && v !== '' && v !== null) o[k] = v; };
  set('b', flag(rPr, 'w:b'));
  set('i', flag(rPr, 'w:i'));
  const u = val(rPr, 'w:u');
  if (u) o.u = u !== 'none';
  set('strike', flag(rPr, 'w:strike') || flag(rPr, 'w:dstrike'));
  set('color', hex(val(rPr, 'w:color')));
  set('highlight', HIGHLIGHT[val(rPr, 'w:highlight')]);
  const shd = kid(rPr, 'w:shd')?.attrs['w:fill'];
  if (!o.highlight) set('highlight', hex(shd));
  const sz = +val(rPr, 'w:sz');
  if (sz) o.sz = sz / 2;
  set('vert', val(rPr, 'w:vertAlign'));
  set('vanish', flag(rPr, 'w:vanish'));
  return o;
}

function readStyles(xml) {
  const doc = xml ? parseXml(xml) : null;
  const root = find(doc, 'w:styles');
  const raw = new Map();
  for (const s of kids(root, 'w:style')) {
    raw.set(s.attrs['w:styleId'], {
      name: (val(s, 'w:name') || '').toLowerCase(),
      basedOn: val(s, 'w:basedOn'),
      rPr: runProps(kid(s, 'w:rPr')),
      jc: val(kid(s, 'w:pPr'), 'w:jc'),
      outline: val(kid(s, 'w:pPr'), 'w:outlineLvl'),
      numPr: kid(kid(s, 'w:pPr'), 'w:numPr'), // 「編號清單」等樣式自帶編號
      isDefault: s.attrs['w:default'] === '1' && s.attrs['w:type'] === 'paragraph',
    });
  }
  const resolved = new Map();
  const get = (id, depth = 0) => {
    if (!id || !raw.has(id) || depth > 8) return null;
    if (resolved.has(id)) return resolved.get(id);
    const s = raw.get(id);
    const base = get(s.basedOn, depth + 1);
    const r = { name: s.name, rPr: { ...(base?.rPr || {}), ...s.rPr }, jc: s.jc || base?.jc, outline: s.outline ?? base?.outline, numPr: s.numPr || base?.numPr };
    resolved.set(id, r);
    return r;
  };
  const defaults = runProps(find(find(root, 'w:rPrDefault'), 'w:rPr'));
  const defaultPara = [...raw].find(([, s]) => s.isDefault)?.[0];
  const base = { ...defaults, ...(get(defaultPara)?.rPr || {}) };
  return { get, basePt: base.sz || 12, defaultPara };
}

// 中文數字（一、二…九十九）
const CN = '〇一二三四五六七八九';
function chineseNum(n) {
  if (n <= 0 || n >= 100) return String(n);
  if (n < 10) return CN[n];
  const t = Math.floor(n / 10), o = n % 10;
  return (t === 1 ? '' : CN[t]) + '十' + (o ? CN[o] : '');
}
const ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
const roman = (n) => ROMAN.reduce((s, [v, r]) => { while (n >= v) { s += r; n -= v; } return s; }, '');
const letters = (n) => { let s = ''; while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } return s; };
const HEAVENLY = '甲乙丙丁戊己庚辛壬癸';

export function formatNumber(n, fmt) {
  switch (fmt) {
    case 'decimal': case 'decimalZero': return fmt === 'decimalZero' && n < 10 ? '0' + n : String(n);
    case 'upperLetter': return letters(n).toUpperCase();
    case 'lowerLetter': return letters(n);
    case 'upperRoman': return roman(n).toUpperCase();
    case 'lowerRoman': return roman(n);
    case 'decimalEnclosedCircle': case 'decimalEnclosedCircleChinese': return n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : `(${n})`;
    case 'decimalFullWidth': return String(n).replace(/\d/g, (d) => String.fromCharCode(0xff10 + +d));
    case 'ideographTraditional': return HEAVENLY[(n - 1) % 10];
    case 'taiwaneseCountingThousand': case 'taiwaneseCounting': case 'chineseCounting': case 'chineseCountingThousand':
    case 'ideographDigital': case 'japaneseCounting': case 'ideographLegalTraditional':
      return chineseNum(n);
    case 'none': return '';
    default: return String(n);
  }
}

function readNumbering(xml) {
  const root = find(xml ? parseXml(xml) : null, 'w:numbering');
  const abstract = new Map();
  for (const a of kids(root, 'w:abstractNum')) {
    const lvls = {};
    for (const l of kids(a, 'w:lvl')) {
      lvls[l.attrs['w:ilvl']] = { fmt: val(l, 'w:numFmt') || 'decimal', text: val(l, 'w:lvlText') ?? '%1.', start: +(val(l, 'w:start') || 1) };
    }
    abstract.set(a.attrs['w:abstractNumId'], lvls);
  }
  const nums = new Map();
  for (const n of kids(root, 'w:num')) nums.set(n.attrs['w:numId'], abstract.get(val(n, 'w:abstractNumId')) || {});
  const counters = new Map(); // numId → [每一層目前的數字]
  return (numId, ilvl) => {
    const lvls = nums.get(numId);
    if (!lvls || numId === '0') return '';
    const lv = +ilvl || 0;
    const c = counters.get(numId) || [];
    for (let i = 0; i < lv; i++) if (c[i] == null) c[i] = lvls[i]?.start ?? 1;
    c[lv] = c[lv] == null ? (lvls[lv]?.start ?? 1) : c[lv] + 1;
    c.length = lv + 1; // 下一層重新編號
    counters.set(numId, c);
    const def = lvls[lv] || { fmt: 'decimal', text: `%${lv + 1}.` };
    if (def.fmt === 'bullet') return /[-]/.test(def.text) || !def.text ? '•' : def.text;
    return def.text.replace(/%(\d)/g, (m, k) => formatNumber(c[k - 1] ?? 1, (lvls[k - 1] || def).fmt));
  };
}

// ---------------------------------------------------------------- 轉成 HTML
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// buffer：.docx 的內容；imageUrl(路徑, Uint8Array) → 圖片網址（瀏覽器用 URL.createObjectURL）
// → { html, images: 圖片數量 }
export async function docxToHtml(buffer, { imageUrl = () => '' } = {}) {
  const zip = readZip(buffer);
  const text = async (name) => (zip.has(name) ? new TextDecoder().decode(await zip.get(name)()) : '');
  const main = await text('word/document.xml');
  if (!main) throw new Error('找不到 Word 文件的內容（word/document.xml）');
  const styles = readStyles(await text('word/styles.xml'));
  const numbering = readNumbering(await text('word/numbering.xml'));
  const rels = new Map();
  for (const r of kids(find(parseXml(await text('word/_rels/document.xml.rels')), 'Relationships'), 'Relationship')) {
    rels.set(r.attrs.Id, { target: r.attrs.Target, external: r.attrs.TargetMode === 'External' });
  }
  const em = (pt) => `${+(pt / styles.basePt).toFixed(3)}em`;
  const imgCache = new Map();
  let images = 0;

  async function image(rid, cx) {
    const rel = rels.get(rid);
    if (!rel || rel.external) return '';
    const path = rel.target.startsWith('/') ? rel.target.slice(1) : 'word/' + rel.target.replace(/^\.\//, '');
    if (!zip.has(path)) return '';
    if (!imgCache.has(path)) imgCache.set(path, imageUrl(path, await zip.get(path)()));
    const src = await imgCache.get(path);
    if (!src) return '';
    images++;
    const w = cx ? Math.round(cx / 9525) : 0; // EMU → px
    return `<img src="${esc(src)}" alt=""${w ? ` style="width:${w}px"` : ''}>`;
  }

  function runStyle(p) {
    const css = [];
    if (p.b) css.push('font-weight:700');
    if (p.i) css.push('font-style:italic');
    const deco = [p.u && 'underline', p.strike && 'line-through'].filter(Boolean);
    if (deco.length) css.push('text-decoration:' + deco.join(' '));
    if (p.color) css.push('color:' + p.color);
    if (p.highlight) css.push('background:' + p.highlight);
    if (p.sz && p.sz !== styles.basePt) css.push('font-size:' + em(p.sz));
    return css.join(';');
  }

  async function runs(el, paraRPr, link) {
    let out = '';
    for (const c of kids(el)) {
      if (c.name === 'w:r') {
        const rStyle = styles.get(val(kid(c, 'w:rPr'), 'w:rStyle'));
        const p = { ...paraRPr, ...(rStyle?.rPr || {}), ...runProps(kid(c, 'w:rPr')) };
        if (p.vanish) continue;
        let inner = '';
        for (const k of kids(c)) {
          if (k.name === 'w:t') inner += esc(k.children.map((t) => t.text || '').join(''));
          else if (k.name === 'w:tab' || k.name === 'w:ptab') inner += '<span class="dx-tab">\t</span>';
          else if (k.name === 'w:br' || k.name === 'w:cr') inner += k.attrs['w:type'] === 'page' ? '<hr class="dx-page">' : '<br>';
          else if (k.name === 'w:noBreakHyphen') inner += '‑';
          else if (k.name === 'w:sym') inner += esc(String.fromCharCode(parseInt(k.attrs['w:char'] || '0', 16) & 0xff) || '');
          else if (k.name === 'w:drawing' || k.name === 'mc:AlternateContent') {
            const blip = find(k, 'a:blip');
            const ext = find(k, 'wp:extent');
            if (blip) inner += await image(blip.attrs['r:embed'] || blip.attrs['r:link'], +(ext?.attrs.cx || 0));
          } else if (k.name === 'w:pict' || k.name === 'w:object') {
            const im = find(k, 'v:imagedata');
            if (im) inner += await image(im.attrs['r:id']);
          }
        }
        if (!inner) continue;
        const style = runStyle(p);
        if (p.vert === 'superscript') inner = `<sup>${inner}</sup>`;
        else if (p.vert === 'subscript') inner = `<sub>${inner}</sub>`;
        out += style ? `<span style="${style}">${inner}</span>` : inner;
      } else if (c.name === 'w:hyperlink') {
        const rel = rels.get(c.attrs['r:id']);
        const href = rel?.external && /^https?:\/\//i.test(rel.target) ? rel.target : '';
        const inner = await runs(c, paraRPr, true);
        out += href && !link ? `<a class="dx-link" href="${esc(href)}" data-href="${esc(href)}">${inner}</a>` : inner;
      } else if (['w:ins', 'w:smartTag', 'w:fldSimple', 'w:customXml', 'w:sdt', 'w:sdtContent', 'w:dir', 'w:bdo'].includes(c.name)) {
        out += await runs(c, paraRPr, link);
      }
      // w:del（追蹤修訂刪除的文字）、w:proofErr、w:bookmarkStart 等略過
    }
    return out;
  }

  async function paragraph(p) {
    const pPr = kid(p, 'w:pPr');
    const style = styles.get(val(pPr, 'w:pStyle') || styles.defaultPara);
    const rPr = { ...(style?.rPr || {}) };
    const jc = val(pPr, 'w:jc') || style?.jc;
    const heading = /^(heading|標題)\s*(\d)$/.exec(style?.name || '')?.[2] || (style?.name === 'title' ? '1' : '');
    const css = [];
    const align = { center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' }[jc];
    if (align) css.push('text-align:' + align);
    const ind = kid(pPr, 'w:ind');
    const left = +(ind?.attrs['w:left'] || ind?.attrs['w:start'] || 0);
    if (left > 0) css.push(`padding-left:${+(left / 20 / styles.basePt).toFixed(2)}em`); // twip → pt → em
    const first = +(ind?.attrs['w:firstLine'] || 0) - +(ind?.attrs['w:hanging'] || 0);
    if (first) css.push(`text-indent:${+(first / 20 / styles.basePt).toFixed(2)}em`);
    // 段落自己的編號優先；只寫了層級沒寫清單時用樣式的清單
    const own = kid(pPr, 'w:numPr');
    const numId = val(own, 'w:numId') ?? val(style?.numPr, 'w:numId');
    const ilvl = val(own, 'w:ilvl') ?? val(style?.numPr, 'w:ilvl');
    const label = numId ? numbering(numId, ilvl) : '';
    let body = await runs(p, rPr);
    if (label) body = `<span class="dx-num">${esc(label)}</span>${body}`;
    const tag = heading ? `h${Math.min(+heading + 1, 6)}` : 'p';
    return `<${tag} class="dx-p"${css.length ? ` style="${css.join(';')}"` : ''}>${body || '<br>'}</${tag}>`;
  }

  async function table(tbl) {
    let out = '<table class="dx-table">';
    for (const tr of kids(tbl, 'w:tr')) {
      out += '<tr>';
      for (const tc of kids(tr, 'w:tc')) {
        const tcPr = kid(tc, 'w:tcPr');
        const vm = kid(tcPr, 'w:vMerge');
        if (vm && vm.attrs['w:val'] !== 'restart') continue; // 上面儲存格合併下來的
        const span = +(val(tcPr, 'w:gridSpan') || 1);
        let rows = 1;
        if (vm) { // 往下數合併了幾列
          const idx = colIndex(tr, tc);
          let next = nextSibling(tbl, tr);
          while (next) {
            const cell = cellAt(next, idx);
            const m = kid(kid(cell, 'w:tcPr'), 'w:vMerge');
            if (!m || m.attrs['w:val'] === 'restart') break;
            rows++;
            next = nextSibling(tbl, next);
          }
        }
        const fill = hex(kid(tcPr, 'w:shd')?.attrs['w:fill']);
        out += `<td${span > 1 ? ` colspan="${span}"` : ''}${rows > 1 ? ` rowspan="${rows}"` : ''}${fill ? ` style="background:${fill}"` : ''}>${await blocks(tc)}</td>`;
      }
      out += '</tr>';
    }
    return out + '</table>';
  }
  const colIndex = (tr, tc) => { let i = 0; for (const c of kids(tr, 'w:tc')) { if (c === tc) return i; i += +(val(kid(c, 'w:tcPr'), 'w:gridSpan') || 1); } return i; };
  const cellAt = (tr, idx) => { let i = 0; for (const c of kids(tr, 'w:tc')) { if (i === idx) return c; i += +(val(kid(c, 'w:tcPr'), 'w:gridSpan') || 1); } return null; };
  const nextSibling = (tbl, tr) => { const rows = kids(tbl, 'w:tr'); return rows[rows.indexOf(tr) + 1] || null; };

  async function blocks(el) {
    let out = '';
    for (const c of kids(el)) {
      if (c.name === 'w:p') out += await paragraph(c);
      else if (c.name === 'w:tbl') out += await table(c);
      else if (c.name === 'w:sdt' || c.name === 'w:sdtContent' || c.name === 'w:customXml' || c.name === 'w:ins') out += await blocks(c);
    }
    return out;
  }

  const body = find(parseXml(main), 'w:body');
  const html = await blocks(body);
  return { html, images };
}
