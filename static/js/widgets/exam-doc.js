// 試卷釋疑：顯示學校共用資料夾裡的試題疑義、更正說明
// 可以顯示 PDF、圖片、Word（.docx）、文字檔，以及網址清單裡的網址（Google 簡報、Canva 公開檢視連結）。
// 學校共用資料夾的位置：安裝時的 /SCHOOLDIR（school.json），或「設定 → 🏫 學校共用資料夾」。只有桌面版能讀取。
// 檔案更新時（學校改了更正說明）每分鐘檢查一次，自動重新顯示。
import { h, field, select, toast, modal } from '../ui.js';
import { LS } from '../store.js';
import { loadSchoolLinks, filterLinks, groupLinks, isSchoolUrl, schoolPath, docKind, decodeText, toEmbedUrl, linkify, DOC_ICON } from '../link-list.js';
import { schoolFs, schoolSupported } from '../school.js';
import { docxToHtml } from '../docx.js';
import { openExternal, EMBED_SANDBOX } from './media.js';

const CHECK_MS = 60 * 1000;
const BASE_PX = 22; // 文字、Word 在 100% 時的字大小
const ZOOMS = [0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5, 3];
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', emf: 'image/emf', wmf: 'image/wmf', pdf: 'application/pdf' };
const mimeOf = (name) => MIME[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream';

const NO_FOLDER = () => schoolSupported()
  ? [h('p', null, '這台電腦還沒有設定學校共用資料夾。'), h('p', { class: 'muted' }, '請到「⚙ 設定 → 🏫 學校共用資料夾」選擇學校放試卷釋疑的資料夾（例如 \\\\fileserver\\公告）。')]
  : [h('p', null, '試卷釋疑要讀取學校共用資料夾，只能在電腦版（桌面程式）使用。')];

// 從學校共用資料夾挑選 → { name, url, doc, group } 或 null
export function pickExamDoc() {
  return new Promise((resolve) => {
    let result = null;
    let all = [];
    let group = LS.get('ms:examDocGroup', '');
    const fs = schoolFs();
    const search = h('input', { class: 'input', type: 'search', placeholder: '搜尋，例如：七年級 數學' });
    const chips = h('div', { class: 'lp-groups' });
    const list = h('div', { class: 'lp-list' });
    const foot = h('div', { class: 'lp-foot muted' });
    let m;

    function renderGroups() {
      const groups = [...new Set(all.map((it) => it.group))].filter(Boolean);
      if (group && !groups.includes(group)) group = '';
      chips.replaceChildren();
      if (groups.length < (all.some((it) => !it.group) ? 1 : 2)) return;
      for (const g of ['', ...groups]) {
        chips.append(h('button', {
          class: 'chip' + (g === group ? ' on' : ''),
          onclick: () => { group = g; LS.set('ms:examDocGroup', g); renderGroups(); renderList(); },
        }, g || '全部'));
      }
    }

    function renderList() {
      list.replaceChildren();
      const shown = filterLinks(group ? all.filter((it) => it.group === group) : all, search.value);
      if (!shown.length) { list.append(h('div', { class: 'fp-empty' }, '找不到符合的檔案')); return; }
      for (const g of groupLinks(shown)) {
        if (g.group) list.append(h('div', { class: 'lp-head' }, g.group));
        for (const it of g.items) {
          let sub = it.file.split('/').pop();
          if (it.doc === 'web') { try { sub = new URL(it.url).hostname.replace(/^www\./, ''); } catch { /* ignore */ } }
          list.append(h('button', { class: 'lp-item', title: it.doc === 'web' ? it.url : it.file, onclick: () => { result = it; m.close(); } },
            h('span', { class: 'lp-name' }, `${DOC_ICON[it.doc] || '📄'} ${it.name}`), h('small', { class: 'muted' }, sub)));
        }
      }
    }

    function showEmpty(msg) {
      list.replaceChildren(h('div', { class: 'lp-empty' }, ...msg));
      chips.replaceChildren();
    }

    async function load() {
      if (!fs) { search.disabled = true; showEmpty(NO_FOLDER()); return; }
      list.replaceChildren(h('div', { class: 'fp-empty' }, '讀取中…'));
      try {
        const r = await loadSchoolLinks(fs);
        all = r.items;
        foot.replaceChildren(`讀取自 ${fs.label}（共 ${all.length} 個）`);
        search.disabled = !all.length;
        if (!all.length) {
          showEmpty([
            h('p', null, '學校共用資料夾裡還沒有試卷釋疑的檔案。'),
            h('p', null, '可以放 PDF、圖片、Word（.docx）、文字檔（.txt），或「網址清單.txt」。'),
            h('p', { class: 'muted' }, '放在年級的子資料夾（例如 七年級\\數學更正.pdf）會依年級分類。'),
          ]);
          return;
        }
        renderGroups();
        renderList();
      } catch (e) {
        search.disabled = true;
        showEmpty([h('p', { class: 'err' }, e.message)]);
      }
    }

    search.addEventListener('input', renderList);
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      list.querySelector('.lp-item')?.click();
    });
    const body = h('div', { class: 'lp' },
      h('div', { class: 'fp-bar' }, search, h('button', { class: 'btn', onclick: load }, '🔄 重新讀取')),
      chips, list, foot);
    m = modal({ title: '📑 選擇試卷釋疑', body, wide: true, onClose: () => resolve(result) });
    load();
  });
}

export const examdoc = {
  type: 'examdoc', title: '試卷釋疑', icon: '📑', size: { w: 0.55, h: 0.6 },
  // url：網址或 school:相對路徑；doc：類型（web、pdf、image、text、word、doc）；zoom：文字、Word 的大小
  state: () => ({ url: '', name: '', doc: '', zoom: 1 }),
  mount(body, ctx) {
    const s = ctx.state;
    const wrap = h('div', { class: 'embed xd' });
    body.append(wrap);
    let urls = [];         // 要釋放的 blob 網址
    let scroller = null;   // 文字、Word、圖片可以捲動的區塊
    let stamp = '';        // 檔案的大小＋修改時間，變了就重新顯示
    let timer = null;
    let seq = 0;
    const free = () => { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; };
    const blobUrl = (data, type) => { const u = URL.createObjectURL(new Blob([data], { type })); urls.push(u); return u; };
    const rel = () => schoolPath(s.url);

    async function choose() {
      const it = await pickExamDoc();
      if (!it) return;
      s.url = it.url; s.name = it.name; s.doc = it.doc;
      ctx.setTitle(s.name);
      ctx.save();
      render();
    }

    const zoomStep = (d) => {
      const i = ZOOMS.findIndex((z) => z >= s.zoom - 0.001);
      s.zoom = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 3 : i) + d))];
      if (scroller?.classList.contains('xd-text')) scroller.style.fontSize = Math.round(BASE_PX * s.zoom) + 'px';
      ctx.save();
      ctx.push?.();
    };

    function openOutside() {
      if (!s.url) return;
      if (s.doc === 'web') { openExternal(s.url); return; }
      const fs = schoolFs();
      if (fs) openExternal(fs.p(rel())).catch?.((e) => toast('無法開啟：' + e.message));
    }

    function tools() {
      const bar = h('div', { class: 'xd-tools' });
      const b = (label, title, fn) => bar.append(h('button', { title, onclick: fn }, label));
      if (s.doc === 'text' || s.doc === 'word') { b('A−', '字變小', () => zoomStep(-1)); b('A+', '字變大', () => zoomStep(1)); }
      b('↻', '重新載入', () => render());
      b('📂', '換一個檔案', choose);
      return bar;
    }

    function message(...kids) {
      wrap.append(h('div', { class: 'embed-empty xd-msg' }, ...kids));
    }

    async function render(keepScroll = false) {
      const my = ++seq;
      const top = keepScroll ? scroller?.scrollTop || 0 : 0;
      wrap.replaceChildren();
      scroller = null;
      clearInterval(timer);
      timer = null;
      if (!s.url) {
        ctx.setTitle('');
        const fs = schoolFs();
        if (!fs) { message(...NO_FOLDER()); return; }
        message(h('button', { class: 'btn primary big', onclick: choose }, '📂 選擇試卷釋疑'),
          h('small', { class: 'muted' }, `從 ${fs.label} 選擇 PDF、圖片、Word、文字檔或網址`));
        return;
      }
      ctx.setTitle(s.name);
      const doc = s.doc || (isSchoolUrl(s.url) ? docKind(rel()) : 'web');
      if (doc === 'web') {
        const src = toEmbedUrl(s.url);
        free();
        wrap.append(h('iframe', { src, sandbox: EMBED_SANDBOX, allow: 'autoplay; fullscreen; encrypted-media', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' }), tools());
        return;
      }
      const fs = schoolFs();
      if (!fs) { message(...NO_FOLDER()); return; }
      if (doc === 'doc') {
        message(h('p', null, `「${s.name}」是舊版 Word 檔（.doc），黑板樹無法直接顯示。`),
          h('p', { class: 'muted' }, '請學校另存成 .docx 或 PDF；或先用電腦上的 Word 開啟。'),
          h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: openOutside }, '用電腦開啟'), h('button', { class: 'btn', onclick: choose }, '📂 換一個檔案')));
        return;
      }
      message(h('p', { class: 'muted' }, '讀取中…'));
      let blob, st;
      try {
        st = await fs.stat(rel());
        blob = st ? await fs.readBlob(rel()) : null;
      } catch (e) { blob = null; }
      if (my !== seq) return;
      wrap.replaceChildren();
      if (!blob) {
        message(h('p', null, `讀不到「${s.name}」。`),
          h('p', { class: 'muted' }, `檔案可能被移走、改名，或這台電腦暫時連不到 ${fs.label}。`),
          h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => render() }, '🔄 再試一次'), h('button', { class: 'btn primary', onclick: choose }, '📂 換一個檔案')));
        watch(''); // 連線恢復時自動顯示
        return;
      }
      free();
      try {
        if (doc === 'pdf') {
          // PDF 要用沒有 sandbox 的框，WebView2 才會用內建的 PDF 檢視器
          wrap.append(h('iframe', { src: blobUrl(await blob.arrayBuffer(), 'application/pdf') + '#view=FitH' }));
        } else if (doc === 'image') {
          scroller = h('div', { class: 'xd-img' }, h('img', { src: blobUrl(await blob.arrayBuffer(), mimeOf(rel())), alt: s.name }));
          wrap.append(scroller);
        } else if (doc === 'text') {
          const text = await decodeText(blob);
          scroller = h('div', { class: 'xd-text xd-plain' });
          for (const part of linkify(text)) {
            scroller.append(part.url ? h('a', { href: part.url, onclick: (e) => { e.preventDefault(); openExternal(part.url); } }, part.url) : part.text);
          }
          wrap.append(scroller);
        } else if (doc === 'word') {
          const { html } = await docxToHtml(await blob.arrayBuffer(), { imageUrl: (p, data) => blobUrl(data, mimeOf(p)) });
          if (my !== seq) return;
          scroller = h('div', { class: 'xd-text xd-word' });
          scroller.innerHTML = html; // docx.js 已經把文字都跳脫過
          scroller.addEventListener('click', (e) => {
            const a = e.target.closest('a.dx-link');
            if (!a) return;
            e.preventDefault();
            openExternal(a.dataset.href);
          });
          wrap.append(scroller);
        } else {
          message(h('p', null, '不支援這種檔案。'));
          return;
        }
      } catch (e) {
        wrap.replaceChildren();
        message(h('p', null, `無法顯示「${s.name}」：${e.message}`), h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: openOutside }, '用電腦開啟')));
        return;
      }
      if (scroller?.classList.contains('xd-text')) scroller.style.fontSize = Math.round(BASE_PX * s.zoom) + 'px';
      if (scroller && top) scroller.scrollTop = top;
      wrap.append(tools());
      watch(`${st.size}:${st.modifiedAt || st.mtime || ''}`);
    }

    // 每分鐘看檔案有沒有更新
    function watch(now) {
      stamp = now;
      clearInterval(timer);
      timer = setInterval(async () => {
        const fs = schoolFs();
        if (!fs || !isSchoolUrl(s.url)) return;
        let st = null;
        try { st = await fs.stat(rel()); } catch { /* 連不到 */ }
        const next = st ? `${st.size}:${st.modifiedAt || st.mtime || ''}` : '';
        if (next && next !== stamp) render(true);
      }, CHECK_MS);
    }

    const scroll = (dir) => {
      if (!scroller) return;
      scroller.scrollBy({ top: dir * scroller.clientHeight * 0.8, behavior: 'smooth' });
    };

    render();
    return {
      destroy: () => { clearInterval(timer); seq++; free(); },
      remote: {
        view: () => ({ name: s.name, doc: s.doc, url: s.doc === 'web' ? s.url : '', zoom: s.zoom, scroll: !!scroller }),
        act(a) {
          if (a === 'reload') render(true);
          else if (a === 'bigger') zoomStep(1);
          else if (a === 'smaller') zoomStep(-1);
          else if (a === 'up') scroll(-1);
          else if (a === 'down') scroll(1);
          ctx.push?.();
        },
      },
      settings: (c) => {
        c.append(
          field('顯示的檔案', h('div', { class: 'row' },
            h('span', null, s.name ? `${DOC_ICON[s.doc] || '📄'} ${s.name}` : '（尚未選擇）'),
            h('button', { class: 'btn', onclick: choose }, '📂 選擇'),
            s.url ? h('button', { class: 'btn', onclick: openOutside }, '用電腦開啟') : '')),
          field('文字、Word 的字大小', select(ZOOMS.map((z) => [String(z), Math.round(z * 100) + '%']), String(s.zoom), (v) => {
            s.zoom = +v; ctx.save(); render(true);
          })),
        );
      },
    };
  },
};
