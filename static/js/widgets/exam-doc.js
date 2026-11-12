// 試卷釋疑：顯示學校共用資料夾（或老師選的資料夾）裡的試題疑義、更正說明
// 可以顯示 PDF、圖片、影片、Word（.docx）、文字檔，以及網址清單裡的網址（Google 簡報、Canva 公開檢視連結）。
// 學校共用資料夾的位置：安裝時的 /SCHOOLDIR（school.json），或「設定 → 🏫 學校共用資料夾」；
// 也可以在挑選檔案時「選擇資料夾」，讀這台電腦或網路上的任何資料夾。只有桌面版能讀取。
//
// 很多間教室可能同時讀同一個檔案，所以開啟時先複製到這台電腦（doc-cache.js），從副本顯示；
// 每 10 秒只查一次原始檔案的大小與修改時間，有更新才重新複製，並自動換成新的內容（保留捲動位置、影片播放位置）。
import { h, field, select, toast, modal } from '../ui.js';
import { LS } from '../store.js';
import { loadSchoolLinks, filterLinks, groupLinks, isSchoolUrl, schoolPath, docKind, decodeText, toEmbedUrl, linkify, DOC_ICON } from '../link-list.js';
import { schoolFs, schoolSupported } from '../school.js';
import { NeuAdapter } from '../backends/fs.js';
import { docxToHtml } from '../docx.js';
import { desktopDocCache } from '../doc-cache.js';
import { localUrl } from '../res-files.js';
import { openExternal, EMBED_SANDBOX } from '../web-url.js';

export const CHECK_MS = 10 * 1000;
const BASE_PX = 22; // 文字、Word 在 100% 時的字大小
const ZOOMS = [0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5, 3];
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', emf: 'image/emf', wmf: 'image/wmf', pdf: 'application/pdf' };
const mimeOf = (name) => MIME[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream';
const DIR_KEY = 'ms:examDocDir';   // 老師選過的資料夾
const SRC_KEY = 'ms:examDocSrc';   // 上次挑選時看的是 school 還是 local

// 老師選的資料夾裡的檔案：網址寫成「local:完整路徑」
export const LOCAL_PREFIX = 'local:';
export const isLocalUrl = (u) => String(u || '').startsWith(LOCAL_PREFIX);
export const localPath = (u) => String(u || '').slice(LOCAL_PREFIX.length);

// 小工具記的網址 → 原始檔案在這台電腦上的完整路徑（讀不到時是空字串）
export function sourcePath(url, school = schoolFs()) {
  if (isLocalUrl(url)) return localPath(url);
  if (isSchoolUrl(url)) return school ? school.p(schoolPath(url)) : '';
  return '';
}

const folderName = (p) => String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
const hhmm = (t) => new Date(t).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });

const DESKTOP_ONLY = () => [h('p', null, '試卷釋疑要讀取資料夾裡的檔案，只能在電腦版（桌面程式）使用。')];

// 可以挑選的位置：學校共用資料夾、老師選的資料夾
function sources() {
  const out = [];
  const school = schoolFs();
  if (school) out.push({ id: 'school', label: '🏫 學校共用資料夾', fs: school, url: (it) => it.url });
  const dir = LS.get(DIR_KEY, '');
  if (dir) {
    const fs = new NeuAdapter(dir);
    out.push({ id: 'local', label: '📁 ' + folderName(dir), fs, url: (it) => (it.doc === 'web' ? it.url : LOCAL_PREFIX + fs.p(it.file)) });
  }
  return out;
}

// 挑選檔案 → { name, url, doc, group } 或 null
export function pickExamDoc() {
  return new Promise((resolve) => {
    let result = null;
    let all = [];
    let group = LS.get('ms:examDocGroup', '');
    let srcId = LS.get(SRC_KEY, 'school');
    let src = null;
    const search = h('input', { class: 'input', type: 'search', placeholder: '搜尋，例如：七年級 數學' });
    const where = h('div', { class: 'lp-groups lp-src' });
    const chips = h('div', { class: 'lp-groups' });
    const list = h('div', { class: 'lp-list' });
    const foot = h('div', { class: 'lp-foot muted' });
    let m;

    async function chooseFolder() {
      const p = await window.Neutralino.os.showFolderDialog('選擇試卷釋疑的資料夾').catch(() => '');
      if (!p) return;
      LS.set(DIR_KEY, p.replace(/\//g, '\\'));
      srcId = 'local';
      LS.set(SRC_KEY, srcId);
      load();
    }

    function renderWhere(all) {
      where.replaceChildren();
      for (const s of all) {
        where.append(h('button', {
          class: 'chip' + (s === src ? ' on' : ''), title: s.fs.label,
          onclick: () => { srcId = s.id; LS.set(SRC_KEY, srcId); group = ''; load(); },
        }, s.label));
      }
      where.append(h('button', { class: 'chip', onclick: chooseFolder }, all.some((s) => s.id === 'local') ? '📂 換一個資料夾…' : '📂 選擇資料夾…'));
    }

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
          list.append(h('button', { class: 'lp-item', title: it.doc === 'web' ? it.url : it.file, onclick: () => { result = { ...it, url: src.url(it) }; m.close(); } },
            h('span', { class: 'lp-name' }, `${DOC_ICON[it.doc] || '📄'} ${it.name}`), h('small', { class: 'muted' }, sub)));
        }
      }
    }

    function showEmpty(msg) {
      list.replaceChildren(h('div', { class: 'lp-empty' }, ...msg));
      chips.replaceChildren();
    }

    async function load() {
      if (!schoolSupported()) { where.replaceChildren(); search.disabled = true; showEmpty(DESKTOP_ONLY()); return; }
      const all_ = sources();
      src = all_.find((s) => s.id === srcId) || all_[0] || null;
      renderWhere(all_);
      foot.replaceChildren();
      if (!src) {
        search.disabled = true;
        showEmpty([
          h('p', null, '請選擇放試卷釋疑檔案的資料夾。'),
          h('button', { class: 'btn primary', onclick: chooseFolder }, '📂 選擇資料夾'),
          h('p', { class: 'muted' }, '全校共用的資料夾也可以到「⚙ 設定 → 🏫 學校共用資料夾」設定。'),
        ]);
        return;
      }
      list.replaceChildren(h('div', { class: 'fp-empty' }, '讀取中…'));
      const my = src;
      try {
        const r = await loadSchoolLinks(src.fs);
        if (my !== src) return;
        all = r.items;
        foot.replaceChildren(`讀取自 ${src.fs.label}（共 ${all.length} 個）`);
        search.disabled = !all.length;
        if (!all.length) {
          showEmpty([
            h('p', null, '這個資料夾裡還沒有試卷釋疑的檔案。'),
            h('p', null, '可以放 PDF、圖片、影片（.mp4）、Word（.docx）、文字檔（.txt），或「網址清單.txt」。'),
            h('p', { class: 'muted' }, '放在年級的子資料夾（例如 七年級\\數學更正.pdf）會依年級分類。'),
          ]);
          return;
        }
        renderGroups();
        renderList();
      } catch (e) {
        if (my !== src) return;
        search.disabled = true;
        showEmpty([h('p', { class: 'err' }, src.id === 'local' ? `讀不到 ${src.fs.label}，請確認資料夾還在、這台電腦連得到` : e.message)]);
      }
    }

    search.addEventListener('input', renderList);
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      list.querySelector('.lp-item')?.click();
    });
    const body = h('div', { class: 'lp' },
      where,
      h('div', { class: 'fp-bar' }, search, h('button', { class: 'btn', onclick: load }, '🔄 重新讀取')),
      chips, list, foot);
    m = modal({ title: '📑 選擇試卷釋疑', body, wide: true, onClose: () => resolve(result) });
    load();
  });
}

export const examdoc = {
  type: 'examdoc', title: '試卷釋疑', icon: '📑', size: { w: 0.55, h: 0.6 },
  // url：網址、school:相對路徑，或 local:完整路徑；doc：類型（web、pdf、image、video、text、word、doc）；zoom：文字、Word 的大小
  state: () => ({ url: '', name: '', doc: '', zoom: 1 }),
  mount(body, ctx) {
    const s = ctx.state;
    const wrap = h('div', { class: 'embed xd' });
    body.append(wrap);
    let urls = [];         // 要釋放的 blob 網址
    let scroller = null;   // 文字、Word、圖片可以捲動的區塊
    let video = null;
    let shown = null;      // 目前顯示的副本 { path, stamp, at, offline }；null = 讀不到
    let timer = null;
    let seq = 0;
    let gone = false;
    const free = () => { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; };
    const blobUrl = (data, type) => { const u = URL.createObjectURL(new Blob([data], { type })); urls.push(u); return u; };
    const src = () => sourcePath(s.url);
    const docOf = () => s.doc || (isSchoolUrl(s.url) ? docKind(schoolPath(s.url)) : isLocalUrl(s.url) ? docKind(localPath(s.url)) : 'web');
    const isFile = () => isSchoolUrl(s.url) || isLocalUrl(s.url);

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
      const p = src() || shown?.path;
      if (p) openExternal(p).catch?.((e) => toast('無法開啟：' + e.message));
    }

    function tools() {
      const bar = h('div', { class: 'xd-tools' + (docOf() === 'video' ? ' top' : '') }); // 影片的播放列在下面
      const b = (label, title, fn) => bar.append(h('button', { title, onclick: fn }, label));
      if (shown?.offline) bar.append(h('span', { class: 'xd-badge', title: '連不到原始檔案，顯示這台電腦上的副本；連線恢復後會自動更新' }, `⚠ 離線副本（${hhmm(shown.at)}）`));
      if (s.doc === 'text' || s.doc === 'word') { b('A−', '字變小', () => zoomStep(-1)); b('A+', '字變大', () => zoomStep(1)); }
      b('↻', '重新載入', () => render(true));
      b('📂', '換一個檔案', choose);
      return bar;
    }

    function message(...kids) {
      wrap.append(h('div', { class: 'embed-empty xd-msg' }, ...kids));
    }

    // ---- 定時檢查（每台電腦錯開時間，不要全校同一秒去讀）
    function schedule(ms = CHECK_MS) {
      clearTimeout(timer);
      if (!gone) timer = setTimeout(tick, ms);
    }

    async function tick() {
      timer = null;
      const p = isFile() ? src() : '';
      if (!p || !schoolSupported()) return schedule();
      const my = seq;
      try {
        const cache = await desktopDocCache(LS);
        if (!shown) { // 原本讀不到：再試一次
          await cache.open(p);
          if (my === seq) render(true);
          return;
        }
        const next = await cache.check(p, shown.stamp);
        if (my !== seq) return;
        if (next) {
          render(true);
          toast(`📑 「${s.name}」已更新`);
          return;
        }
        if (shown.offline && await cache.statSource(p)) { render(true); return; } // 連線恢復，拿掉離線提示
      } catch { /* 還是讀不到 */ }
      if (my === seq) schedule();
    }

    async function render(keep = false) {
      const my = ++seq;
      const top = keep ? scroller?.scrollTop || 0 : 0;
      const play = keep && video ? { time: video.currentTime, paused: video.paused } : null;
      clearTimeout(timer);
      timer = null;
      video?.pause();
      if (!s.url) {
        wrap.replaceChildren();
        scroller = video = shown = null;
        free();
        ctx.setTitle('');
        if (!schoolSupported()) { message(...DESKTOP_ONLY()); return; }
        const from = sources().map((x) => x.fs.label).join('、');
        message(h('button', { class: 'btn primary big', onclick: choose }, '📂 選擇試卷釋疑'),
          h('small', { class: 'muted' }, from ? `從 ${from} 選擇 PDF、圖片、影片、Word、文字檔或網址` : '選擇放 PDF、圖片、影片、Word、文字檔的資料夾'));
        return;
      }
      ctx.setTitle(s.name);
      const doc = docOf();
      if (doc === 'web') {
        wrap.replaceChildren();
        scroller = video = shown = null;
        free();
        wrap.append(h('iframe', { src: toEmbedUrl(s.url), sandbox: EMBED_SANDBOX, allow: 'autoplay; fullscreen; encrypted-media', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' }), tools());
        return;
      }
      if (!schoolSupported()) { wrap.replaceChildren(); message(...DESKTOP_ONLY()); return; }
      const p = src();
      if (!p) {
        wrap.replaceChildren();
        message(h('p', null, '這台電腦沒有設定學校共用資料夾，讀不到這個檔案。'),
          h('p', { class: 'muted' }, '請到「⚙ 設定 → 🏫 學校共用資料夾」設定，或換一個檔案。'),
          h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: choose }, '📂 換一個檔案')));
        return;
      }
      if (doc === 'doc') {
        wrap.replaceChildren();
        message(h('p', null, `「${s.name}」是舊版 Word 檔（.doc），黑板樹無法直接顯示。`),
          h('p', { class: 'muted' }, '請另存成 .docx 或 PDF；或先用電腦上的 Word 開啟。'),
          h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: openOutside }, '用電腦開啟'), h('button', { class: 'btn', onclick: choose }, '📂 換一個檔案')));
        return;
      }
      if (!keep) { wrap.replaceChildren(); message(h('p', { class: 'muted' }, '讀取中…')); }
      let entry = null;
      try { entry = await (await desktopDocCache(LS)).open(p); } catch { entry = null; }
      if (my !== seq) return;
      if (!entry) {
        wrap.replaceChildren();
        scroller = video = shown = null;
        message(h('p', null, `讀不到「${s.name}」。`),
          h('p', { class: 'muted' }, `檔案可能被移走、改名，或這台電腦暫時連不到 ${p.replace(/[\\/][^\\/]*$/, '')}。`),
          h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => render() }, '🔄 再試一次'), h('button', { class: 'btn primary', onclick: choose }, '📂 換一個檔案')));
        schedule(); // 連線恢復時自動顯示
        return;
      }
      // 先在畫面外準備好新內容，再一次換上，更新時不會閃一下「讀取中」
      const old = urls;
      urls = [];
      let view, nextScroller = null, nextVideo = null;
      try {
        const read = () => window.Neutralino.filesystem.readBinaryFile(entry.path);
        if (doc === 'pdf') {
          // PDF 要用沒有 sandbox 的框，WebView2 才會用內建的 PDF 檢視器
          const u = await localUrl(entry.path);
          if (u.startsWith('blob:')) urls.push(u);
          view = h('iframe', { src: u + '#view=FitH' });
        } else if (doc === 'video') {
          const u = await localUrl(entry.path);
          if (u.startsWith('blob:')) urls.push(u);
          nextVideo = h('video', { class: 'xd-video', src: u, controls: true, playsinline: true, preload: 'auto' });
          nextVideo.addEventListener('play', () => ctx.push?.());
          nextVideo.addEventListener('pause', () => ctx.push?.());
          if (play) {
            nextVideo.addEventListener('loadedmetadata', () => {
              nextVideo.currentTime = Math.min(play.time, nextVideo.duration || play.time);
              if (!play.paused) nextVideo.play().catch(() => {});
            }, { once: true });
          }
          nextVideo.addEventListener('error', () => {
            if (my !== seq) return;
            wrap.replaceChildren();
            message(h('p', null, `無法播放「${s.name}」。`), h('p', { class: 'muted' }, '建議轉成 MP4（H.264）格式；或先用電腦上的播放程式開啟。'),
              h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: openOutside }, '用電腦開啟'), h('button', { class: 'btn', onclick: choose }, '📂 換一個檔案')));
          });
          view = h('div', { class: 'xd-vid' }, nextVideo);
        } else if (doc === 'image') {
          nextScroller = h('div', { class: 'xd-img' }, h('img', { src: blobUrl(await read(), mimeOf(entry.path)), alt: s.name }));
          view = nextScroller;
        } else if (doc === 'text') {
          const text = await decodeText(new Blob([await read()]));
          nextScroller = h('div', { class: 'xd-text xd-plain' });
          for (const part of linkify(text)) {
            nextScroller.append(part.url ? h('a', { href: part.url, onclick: (e) => { e.preventDefault(); openExternal(part.url); } }, part.url) : part.text);
          }
          view = nextScroller;
        } else if (doc === 'word') {
          const { html } = await docxToHtml(await read(), { imageUrl: (q, data) => blobUrl(data, mimeOf(q)) });
          nextScroller = h('div', { class: 'xd-text xd-word' });
          nextScroller.innerHTML = html; // docx.js 已經把文字都跳脫過
          nextScroller.addEventListener('click', (e) => {
            const a = e.target.closest('a.dx-link');
            if (!a) return;
            e.preventDefault();
            openExternal(a.dataset.href);
          });
          view = nextScroller;
        } else {
          throw new Error('不支援這種檔案');
        }
      } catch (e) {
        if (my !== seq) { urls.forEach((u) => URL.revokeObjectURL(u)); urls = old; return; }
        old.forEach((u) => URL.revokeObjectURL(u));
        wrap.replaceChildren();
        scroller = video = null;
        shown = entry;
        message(h('p', null, `無法顯示「${s.name}」：${e.message}`), h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: openOutside }, '用電腦開啟')));
        schedule();
        return;
      }
      if (my !== seq) { urls.forEach((u) => URL.revokeObjectURL(u)); urls = old; return; }
      old.forEach((u) => URL.revokeObjectURL(u));
      shown = entry;
      scroller = nextScroller;
      video = nextVideo;
      if (scroller?.classList.contains('xd-text')) scroller.style.fontSize = Math.round(BASE_PX * s.zoom) + 'px';
      wrap.replaceChildren(view, tools());
      if (scroller && top) scroller.scrollTop = top;
      schedule(keep ? CHECK_MS : CHECK_MS * (0.5 + Math.random())); // 第一次隨機錯開
      ctx.push?.();
    }

    const scroll = (dir) => {
      if (!scroller) return;
      scroller.scrollBy({ top: dir * scroller.clientHeight * 0.8, behavior: 'smooth' });
    };

    render();
    return {
      destroy: () => { gone = true; clearTimeout(timer); seq++; video?.pause(); free(); },
      remote: {
        view: () => ({ name: s.name, doc: s.doc, url: s.doc === 'web' ? s.url : '', zoom: s.zoom, scroll: !!scroller, video: !!video, playing: !!video && !video.paused, offline: !!shown?.offline }),
        act(a) {
          if (a === 'reload') render(true);
          else if (a === 'bigger') zoomStep(1);
          else if (a === 'smaller') zoomStep(-1);
          else if (a === 'up') scroll(-1);
          else if (a === 'down') scroll(1);
          else if (a === 'play' && video) { if (video.paused) video.play().catch(() => {}); else video.pause(); }
          else if (a === 'restart' && video) { video.currentTime = 0; video.play().catch(() => {}); }
          ctx.push?.();
        },
      },
      settings: (c) => {
        c.append(
          field('顯示的檔案', h('div', { class: 'row' },
            h('span', null, s.name ? `${DOC_ICON[s.doc] || '📄'} ${s.name}` : '（尚未選擇）'),
            h('button', { class: 'btn', onclick: choose }, '📂 選擇'),
            s.url ? h('button', { class: 'btn', onclick: openOutside }, '用電腦開啟') : '')),
          isFile() ? h('small', { class: 'muted' }, `來源：${src() || '（讀不到）'}　每 10 秒檢查一次，檔案更新時自動換成新的內容`) : '',
          field('文字、Word 的字大小', select(ZOOMS.map((z) => [String(z), Math.round(z * 100) + '%']), String(s.zoom), (v) => {
            s.zoom = +v; ctx.save(); render(true);
          })),
        );
      },
    };
  },
};
