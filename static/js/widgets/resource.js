// 匯入資源：圖片、影片、音訊、PDF、文字檔、Word（.docx）、ODF 文件（.odt／.ods／.odp）、網頁、YouTube、社群影片。
// 可以放好幾個，用「縮圖卡片」（像檔案總管的大圖示，縮圖維持原本比例）或「單張切換」（左右滑動、‹ ›）顯示。
// 2.4 以前的「圖片」「網頁／影片」小工具會自動轉成這個（widgets/index.js 的 upgradeWidget）。
import { h, field, select, checkbox, toast, confirmDialog } from '../ui.js';
import { pickResources } from '../res-picker.js';
import { resUrl, resBuffer, resExists, absPathOf } from '../res-files.js';
import {
  normalizeResState, resKind, wrapIndex, clampIndex, moveItem, refName, addRefs, extOf,
  THUMB_PX, THUMB_STEPS, KIND_ICON, KIND_LABEL, ZOOMABLE, DOC_KINDS,
} from '../res-list.js';
import { classifyUrl, youtubeSrc, openExternal, EMBED_SANDBOX } from '../web-url.js';
import { toEmbedUrl, decodeText, linkify } from '../link-list.js';
import { docxToHtml } from '../docx.js';
import { odtToHtml, odsToHtml, odpToHtml } from '../odf.js';
import { mimeOf } from '../backends/fs.js';

const BASE_PX = 22; // 文字、文件在 100% 時的字大小
const ZOOMS = [0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5, 3];
const DOC_FN = { word: docxToHtml, odt: odtToHtml, ods: odsToHtml, odp: odpToHtml };

export const resource = {
  type: 'resource', title: '匯入資源', icon: '📂', size: { w: 0.45, h: 0.45 },
  // refs：資源（見 res-list.js）；mode：grid 縮圖卡片／slide 單張切換；thumb：縮圖大小 s/m/l；names：顯示檔名；
  // fit：圖片完整顯示／填滿；zoom：文字、文件的字大小；autoplay：手機送來的影片，顯示時自動播放一次
  state: () => ({ refs: [], mode: 'slide', index: 0, fit: 'contain', thumb: 'm', names: true, caption: '', zoom: 1, autoplay: false }),
  mount(body, ctx) {
    const s = normalizeResState(ctx.state);
    const wrap = h('div', { class: 'image-w res-w' });
    body.append(wrap);
    let slide = null;          // 單張模式的控制：{ step(d) }
    let cur = null;            // 目前顯示的資源：{ kind, media, frame, info, scroller }
    let playing = false, muted = false;
    let urls = [];             // 文件裡的圖片（blob 網址），換張時釋放
    let seq = 0;
    let redrawSettings = null;

    const free = () => { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; };
    const current = () => s.refs[s.index];

    const changed = (push = true) => {
      s.index = clampIndex(s.index, s.refs.length);
      ctx.save();
      render();
      redrawSettings?.();
      if (push) ctx.push?.();
    };

    async function add() {
      const refs = await pickResources(ctx.store, { multiple: true });
      if (!refs?.length) return;
      const wasEmpty = !s.refs.length;
      const before = s.refs.length;
      s.refs = addRefs(s.refs, refs);
      if (wasEmpty) { s.index = 0; s.mode = s.refs.length > 1 ? 'grid' : 'slide'; }
      else if (s.mode === 'slide' && s.refs.length > before) s.index = before; // 直接看新加入的第一個
      changed();
    }

    function addUrl(u) {
      u = String(u || '').trim();
      if (!u) return false;
      if (!classifyUrl(u)) { toast('網址要以 http:// 或 https:// 開頭'); return false; }
      const before = s.refs.length;
      s.refs = addRefs(s.refs, [{ kind: 'url', url: u }]);
      if (s.refs.length > before) { s.index = before; s.mode = 'slide'; }
      changed();
      return true;
    }

    const setMode = (mode) => { s.mode = mode; changed(); };
    function thumbStep(d) {
      const i = THUMB_STEPS.indexOf(s.thumb);
      s.thumb = THUMB_STEPS[Math.max(0, Math.min(THUMB_STEPS.length - 1, i + d))];
      changed(false);
    }
    const zoomStep = (d) => {
      const i = ZOOMS.findIndex((z) => z >= s.zoom - 0.001);
      s.zoom = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 3 : i) + d))];
      if (cur?.scroller && ZOOMABLE.includes(cur.kind)) cur.scroller.style.fontSize = Math.round(BASE_PX * s.zoom) + 'px';
      ctx.save();
      ctx.push?.();
    };

    async function openOutside(ref = current()) {
      if (!ref) return;
      if (ref.kind === 'url') { openExternal(ref.url); return; }
      const abs = absPathOf(ctx.store, ref);
      if (abs) { openExternal(abs).catch?.((e) => toast('無法開啟：' + e.message)); return; }
      const url = await resUrl(ctx.store, ref);
      if (url) window.open(url, '_blank', 'noopener');
    }

    // ---------------------------------------------------------- 一個資源的畫面
    const msg = (...kids) => h('div', { class: 'res-msg' }, ...kids);
    const iconTile = (ref, kind) => h('div', { class: 'res-icon' },
      h('span', { class: 'res-icon-e' }, KIND_ICON[kind] || '📄'),
      h('small', null, (ref.kind === 'url' && !extOf(ref.url) ? KIND_LABEL[kind] : extOf(refName(ref)).toUpperCase()) || KIND_LABEL[kind] || ''));

    function img(ref, cls, fit) {
      const el = h('img', { alt: refName(ref), draggable: 'false', class: cls || null, style: fit ? { objectFit: fit } : null });
      el.onerror = () => el.replaceWith(h('div', { class: 'img-bad' }, '⚠️', h('small', null, '圖片無法載入')));
      resUrl(ctx.store, ref).then((u) => { el.src = u || ''; if (!u) el.onerror(); }, () => el.onerror());
      return el;
    }

    // 換張時看不到的那一頁：圖片照常顯示，其他只放圖示（避免網頁、影片在背後載入、出聲）
    function placeholder(ref) {
      const kind = resKind(ref);
      if (kind === 'image') return img(ref, '', s.fit);
      return h('div', { class: 'res-ph' }, iconTile(ref, kind), h('div', { class: 'res-ph-name' }, refName(ref)));
    }

    // 目前這一個：完整顯示（影片可以播、文件可以捲動）
    function full(ref, pane) {
      const my = ++seq;
      const kind = resKind(ref);
      const c = { kind, media: null, frame: null, info: null, scroller: null };
      cur = c;
      playing = false;
      free();
      const autoplay = s.autoplay;
      if (autoplay) { s.autoplay = false; ctx.save(); } // 只在剛從手機送來時自動播放一次

      if (kind === 'image') { pane.append(img(ref, '', s.fit)); return c; }

      if (kind === 'youtube' || kind === 'social' || kind === 'web') {
        const info = classifyUrl(ref.url);
        c.info = info;
        const src = kind === 'youtube' ? youtubeSrc(info, autoplay) : kind === 'social' ? info.embed : toEmbedUrl(ref.url) || ref.url;
        // sandbox：嵌入的網頁不能把整個黑板樹換成別的網頁（沒有 allow-top-navigation）、不能自動下載檔案
        const frame = h('iframe', { class: 'res-frame', src, sandbox: EMBED_SANDBOX, allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' });
        if (kind === 'youtube') {
          playing = autoplay;
          frame.addEventListener('load', () => frame.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1 }), '*'));
        }
        if (kind === 'social') pane.classList.add('social');
        c.frame = frame;
        pane.append(frame);
        return c;
      }

      if (kind === 'office') {
        pane.append(msg(iconTile(ref, kind), h('p', null, `「${refName(ref)}」無法直接在白板上顯示。`),
          h('p', { class: 'muted' }, '請另存成 PDF、.docx、.odt，或用電腦上的程式開啟。'),
          h('button', { class: 'btn primary', onclick: () => openOutside(ref) }, '用電腦開啟')));
        return c;
      }

      pane.append(msg(h('p', { class: 'muted' }, '讀取中…')));
      (async () => {
        if (!(await resExists(ctx.store, ref))) throw Object.assign(new Error('missing'), { missing: true });
        if (kind === 'video' || kind === 'audio') {
          const url = await resUrl(ctx.store, ref);
          if (!url) throw new Error('讀不到檔案');
          const media = h(kind, { src: url, controls: true, playsinline: true, preload: 'metadata' });
          media.addEventListener('play', () => { playing = true; ctx.push?.(); });
          media.addEventListener('pause', () => { playing = false; ctx.push?.(); });
          media.addEventListener('volumechange', () => ctx.push?.());
          media.addEventListener('error', () => {
            if (my !== seq) return;
            c.media = null;
            pane.replaceChildren(msg(iconTile(ref, kind), h('p', null, `「${refName(ref)}」無法在黑板樹播放。`),
              h('p', { class: 'muted' }, kind === 'video'
                ? '可能是影片的編碼不支援（例如 iPhone 拍的 HEVC／H.265 影片）。可以用電腦的播放程式開啟，或轉成 MP4（H.264）後再匯入。'
                : '可能是音訊的編碼不支援，可以用電腦的播放程式開啟，或轉成 MP3 後再匯入。'),
              absPathOf(ctx.store, ref) ? h('button', { class: 'btn primary', onclick: () => openOutside(ref) }, '用電腦開啟') : ''));
            ctx.push?.();
          });
          c.media = media;
          return kind === 'audio' ? h('div', { class: 'res-audio' }, h('span', { class: 'res-audio-e' }, '🎵'), h('div', { class: 'res-audio-name' }, refName(ref)), media) : media;
        }
        if (kind === 'pdf') {
          // PDF 要用沒有 sandbox 的框，WebView2 才會用內建的 PDF 檢視器
          const url = await resUrl(ctx.store, ref);
          if (!url) throw new Error('讀不到檔案');
          return h('iframe', { class: 'res-frame', src: url + '#view=FitH' });
        }
        if (DOC_KINDS.includes(kind)) {
          const buf = await resBuffer(ctx.store, ref);
          if (my !== seq) return null;
          const box = h('div', { class: `res-doc xd-text ${kind === 'text' ? 'xd-plain' : 'xd-word'}${kind === 'odp' ? ' res-odp' : ''}` });
          if (kind === 'text') {
            for (const part of linkify(await decodeText(new Blob([buf])))) {
              box.append(part.url ? h('a', { href: part.url, onclick: (e) => { e.preventDefault(); openExternal(part.url); } }, part.url) : part.text);
            }
          } else {
            const mine = [];
            const { html } = await DOC_FN[kind](buf, { imageUrl: (p, data) => { const u = URL.createObjectURL(new Blob([data], { type: mimeOf(p) })); mine.push(u); return u; } });
            if (my !== seq) { mine.forEach((u) => URL.revokeObjectURL(u)); return null; }
            urls.push(...mine);
            box.innerHTML = html; // docx.js、odf.js 已經把文字都跳脫過
            box.addEventListener('click', (e) => {
              const a = e.target.closest('a.dx-link');
              if (!a) return;
              e.preventDefault();
              openExternal(a.dataset.href);
            });
          }
          if (ZOOMABLE.includes(kind)) box.style.fontSize = Math.round(BASE_PX * s.zoom) + 'px';
          c.scroller = box;
          return box;
        }
        throw new Error('不支援這種檔案');
      })().then((el) => {
        if (my !== seq || !el) return;
        pane.replaceChildren(el);
        if (autoplay && c.media) c.media.play().catch(() => {});
        ctx.push?.();
      }).catch((e) => {
        if (my !== seq) return;
        pane.replaceChildren(e.missing
          ? msg(iconTile(ref, kind), h('p', null, `找不到「${refName(ref)}」。`), h('p', { class: 'muted' }, '這個檔案太大，只記住了原本電腦上的位置；換到其他電腦、或檔案被移走時就讀不到。'))
          : msg(iconTile(ref, kind), h('p', null, `無法顯示「${refName(ref)}」：${e.message}`), absPathOf(ctx.store, ref) ? h('button', { class: 'btn primary', onclick: () => openOutside(ref) }, '用電腦開啟') : ''));
      });
      return c;
    }

    // YouTube 回報的播放狀態
    const onMsg = (e) => {
      if (!cur?.frame || e.source !== cur.frame.contentWindow) return;
      let d; try { d = JSON.parse(e.data); } catch { return; }
      const st = d?.info?.playerState ?? (d?.event === 'onStateChange' ? d.info : undefined);
      if (typeof st === 'number' && (st === 1) !== playing) { playing = st === 1; ctx.push?.(); }
      if (typeof d?.info?.muted === 'boolean') muted = d.info.muted;
    };
    window.addEventListener('message', onMsg);
    const yt = (func, args = []) => cur?.frame?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');

    // ---------------------------------------------------------- 工具列
    function tools() {
      const bar = h('div', { class: 'img-tools' });
      const b = (label, title, fn) => bar.append(h('button', { title, onclick: fn }, label));
      const grid = s.mode === 'grid' && s.refs.length > 1;
      if (grid) {
        b('−', '縮圖變小', () => thumbStep(-1));
        b('+', '縮圖變大', () => thumbStep(1));
        b('🖼', '單張切換', () => setMode('slide'));
      } else {
        const kind = resKind(current());
        if (ZOOMABLE.includes(kind)) { b('A−', '字變小', () => zoomStep(-1)); b('A+', '字變大', () => zoomStep(1)); }
        if (kind && kind !== 'image') b('↻', '重新載入', () => render());
        if (s.refs.length > 1) b('▦', '縮圖卡片', () => setMode('grid'));
      }
      b('➕', '匯入資源', add);
      return bar;
    }

    // ---------------------------------------------------------- 縮圖卡片
    function cardThumb(ref) {
      const kind = resKind(ref);
      if (kind === 'image') return img(ref);
      if (kind === 'video') {
        const v = h('video', { muted: true, preload: 'metadata', playsinline: true, class: 'res-vthumb' });
        v.onerror = () => v.replaceWith(iconTile(ref, kind));
        resExists(ctx.store, ref).then((ok) => (ok ? resUrl(ctx.store, ref) : '')).then((u) => { if (u) v.src = u + '#t=0.5'; else v.onerror(); }, () => v.onerror());
        return h('div', { class: 'res-vbox' }, v, h('span', { class: 'res-play' }, '▶'));
      }
      if (kind === 'youtube') {
        const id = classifyUrl(ref.url)?.id;
        if (id) {
          const t = h('img', { alt: '', draggable: 'false', src: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` });
          t.onerror = () => t.replaceWith(iconTile(ref, kind));
          return h('div', { class: 'res-vbox' }, t, h('span', { class: 'res-play' }, '▶'));
        }
      }
      return iconTile(ref, kind);
    }

    function renderGrid() {
      const grid = h('div', { class: 'img-grid' });
      grid.style.setProperty('--cell', THUMB_PX[s.thumb] + 'px');
      s.refs.forEach((ref, i) => {
        const name = refName(ref);
        grid.append(h('button', {
          class: 'img-card', title: name || `第 ${i + 1} 個`,
          onclick: () => { s.index = i; setMode('slide'); },
        }, h('div', { class: 'img-box' }, cardThumb(ref)), s.names && name ? h('div', { class: 'img-name' }, name) : null));
      });
      return grid;
    }

    // ---------------------------------------------------------- 單張切換
    function renderSlide() {
      const n = s.refs.length;
      const view = h('div', { class: 'img-slide', tabindex: '0' });
      const track = h('div', { class: 'img-track' });
      const counter = h('div', { class: 'img-count' });
      const swipe = () => n > 1 && resKind(current()) === 'image'; // 影片、網頁、文件要能直接操作，不用拖曳換張
      const fill = () => {
        track.style.transition = 'none';
        track.style.transform = n > 1 ? 'translateX(-100%)' : '';
        const main = h('div', { class: 'img-pane res-pane' });
        const panes = n > 1
          ? [h('div', { class: 'img-pane res-pane' }, placeholder(s.refs[wrapIndex(s.index - 1, n)])), main, h('div', { class: 'img-pane res-pane' }, placeholder(s.refs[wrapIndex(s.index + 1, n)]))]
          : [main];
        track.replaceChildren(...panes);
        full(current(), main);
        view.classList.toggle('noswipe', !swipe());
        const name = refName(current());
        counter.textContent = `${s.index + 1} / ${n}` + (s.names && name ? `　${name}` : '');
        ctx.setTitle(name);
        const t = view.parentNode?.querySelector('.img-tools');
        if (t) t.replaceWith(tools());
      };
      let moving = false;
      const step = (d) => {
        if (n < 2 || moving) return;
        moving = true;
        cur?.media?.pause();
        track.style.transition = 'transform .28s ease';
        track.style.transform = d > 0 ? 'translateX(-200%)' : 'translateX(0%)';
        const done = () => {
          if (!moving) return;
          moving = false;
          s.index = wrapIndex(s.index + d, n);
          fill();
          ctx.save();
          ctx.push?.();
        };
        track.addEventListener('transitionend', done, { once: true });
        setTimeout(done, 400);
      };

      // 左右拖曳換張（只有圖片）
      view.addEventListener('pointerdown', (e) => {
        if (!swipe() || moving || e.button !== 0 || e.target.closest('button')) return;
        const sx = e.clientX;
        const t0 = performance.now();
        let dx = 0;
        view.setPointerCapture(e.pointerId);
        track.style.transition = 'none';
        const move = (ev) => {
          dx = ev.clientX - sx;
          track.style.transform = `translateX(calc(-100% + ${dx}px))`;
        };
        const up = () => {
          view.removeEventListener('pointermove', move);
          view.removeEventListener('pointerup', up);
          view.removeEventListener('pointercancel', up);
          const w = view.clientWidth || 1;
          const fast = Math.abs(dx) > 30 && performance.now() - t0 < 250;
          if (dx < -w * 0.15 || (fast && dx < 0)) step(1);
          else if (dx > w * 0.15 || (fast && dx > 0)) step(-1);
          else { track.style.transition = 'transform .2s ease'; track.style.transform = 'translateX(-100%)'; }
        };
        view.addEventListener('pointermove', move);
        view.addEventListener('pointerup', up);
        view.addEventListener('pointercancel', up);
      });
      view.addEventListener('keydown', (e) => {
        if (e.target !== view) return; // 影片、文件自己的按鍵優先
        if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); step(1); }
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); step(-1); }
      });

      view.append(track);
      if (n > 1) {
        view.append(
          h('button', { class: 'img-nav prev', title: '上一個', onclick: () => step(-1) }, '‹'),
          h('button', { class: 'img-nav next', title: '下一個', onclick: () => step(1) }, '›'),
          counter);
      }
      slide = { step, fill };
      return view;
    }

    function render() {
      wrap.replaceChildren();
      slide = null;
      cur = null;
      seq++;
      free();
      if (!s.refs.length) {
        ctx.setTitle('');
        wrap.classList.add('empty');
        const input = h('input', { class: 'input', placeholder: '或貼上網址（YouTube、網頁、Google 簡報）後按 Enter' });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addUrl(input.value); });
        wrap.append(h('button', { class: 'btn primary big', onclick: add }, '📂 匯入資源'),
          h('small', { class: 'muted' }, '圖片、影片、音訊、PDF、Word、ODF 文件、文字檔，可以一次選好幾個'), input);
        return;
      }
      wrap.classList.remove('empty');
      const grid = s.mode === 'grid' && s.refs.length > 1;
      if (grid) ctx.setTitle('');
      const main = h('div', { class: 'img-main' });
      wrap.append(main);
      if (s.caption) wrap.append(h('div', { class: 'image-cap' }, s.caption));
      if (grid) main.append(renderGrid(), tools());
      else {
        const view = renderSlide();
        main.append(view, tools());
        slide.fill();
      }
    }

    render();

    const scroll = (dir) => {
      const el = cur?.scroller;
      if (el) el.scrollBy({ top: dir * el.clientHeight * 0.8, behavior: 'smooth' });
    };

    return {
      destroy: () => { window.removeEventListener('message', onMsg); seq++; free(); redrawSettings = null; },
      remote: {
        view: () => {
          const ref = current();
          const kind = s.mode === 'grid' && s.refs.length > 1 ? '' : resKind(ref);
          return {
            count: s.refs.length, index: s.index, mode: s.mode, name: refName(ref), kind,
            platform: cur?.info?.platform || '', url: ref?.kind === 'url' ? ref.url : '',
            playing, muted: cur?.media ? cur.media.muted : muted, scroll: !!cur?.scroller, zoom: s.zoom,
          };
        },
        act(a) {
          const m = cur?.media;
          if (a === 'next' || a === 'prev') {
            if (s.mode !== 'slide') { s.mode = 'slide'; changed(false); }
            slide?.step(a === 'next' ? 1 : -1);
          } else if (a === 'grid' || a === 'slide') setMode(a);
          else if (m) {
            if (a === 'play') m.play().catch(() => {});
            else if (a === 'pause') m.pause();
            else if (a === 'toggle') (m.paused ? m.play().catch(() => {}) : m.pause());
            else if (a === 'back') m.currentTime = Math.max(0, m.currentTime - 10);
            else if (a === 'fwd') m.currentTime += 10;
            else if (a === 'mute') m.muted = !m.muted;
            else if (a === 'restart') { m.currentTime = 0; m.play().catch(() => {}); }
          } else if (cur?.kind === 'youtube') {
            if (a === 'toggle') a = playing ? 'pause' : 'play';
            if (a === 'play') { yt('playVideo'); playing = true; }
            else if (a === 'pause') { yt('pauseVideo'); playing = false; }
            else if (a === 'mute') { yt(muted ? 'unMute' : 'mute'); muted = !muted; }
            else if (a === 'restart') { yt('seekTo', [0, true]); yt('playVideo'); playing = true; }
          }
          if (a === 'reload') render();
          else if (a === 'browser') openOutside();
          else if (a === 'up') scroll(-1);
          else if (a === 'down') scroll(1);
          else if (a === 'bigger') zoomStep(1);
          else if (a === 'smaller') zoomStep(-1);
          ctx.push?.();
        },
      },
      settings: (c) => {
        const listBox = h('div', { class: 'img-manage' });
        const head = h('span');
        redrawSettings = () => {
          if (!listBox.isConnected && listBox.parentNode) { redrawSettings = null; return; }
          head.textContent = `資源（${s.refs.length} 個）`;
          listBox.replaceChildren(...(s.refs.length ? s.refs.map((ref, i) => {
            const kind = resKind(ref);
            let thumb;
            if (kind === 'image') {
              thumb = h('img', { alt: '' });
              thumb.onerror = () => thumb.replaceWith(h('span', { class: 'img-row-bad' }, '⚠️'));
              resUrl(ctx.store, ref).then((u) => { thumb.src = u || ''; if (!u) thumb.onerror(); });
            } else thumb = h('span', { class: 'img-row-bad' }, KIND_ICON[kind] || '📄');
            return h('div', { class: 'img-row' },
              h('span', { class: 'img-row-no' }, i + 1), thumb,
              h('span', { class: 'img-row-name', title: ref.kind === 'abs' ? ref.path : '' }, (refName(ref) || '（圖片）') + (ref.kind === 'abs' ? '　💻 只在這台電腦' : '')),
              h('button', { class: 'btn small', title: '往前', disabled: i === 0, onclick: () => { s.refs = moveItem(s.refs, i, -1); if (s.index === i) s.index--; else if (s.index === i - 1) s.index++; changed(); } }, '↑'),
              h('button', { class: 'btn small', title: '往後', disabled: i === s.refs.length - 1, onclick: () => { s.refs = moveItem(s.refs, i, 1); if (s.index === i) s.index++; else if (s.index === i + 1) s.index--; changed(); } }, '↓'),
              h('button', { class: 'btn small', title: '從這個小工具移除（不會刪除檔案）', onclick: () => { s.refs = s.refs.filter((_, j) => j !== i); if (s.index > i) s.index--; changed(); } }, '✕'));
          }) : [h('div', { class: 'muted' }, '還沒有資源')]));
        };
        redrawSettings();
        const urlInput = h('input', { class: 'input', placeholder: 'https://… YouTube、網頁、Google 簡報、影片網址' });
        const useUrl = () => { if (addUrl(urlInput.value)) urlInput.value = ''; };
        urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') useUrl(); });
        c.append(
          h('div', { class: 'field' }, head, listBox,
            h('div', { class: 'row-btns' },
              h('button', { class: 'btn primary', onclick: add }, '📂 匯入資源'),
              h('button', { class: 'btn', onclick: async () => { if (s.refs.length && await confirmDialog('要移除這個小工具裡的所有資源嗎？（不會刪除檔案）')) { s.refs = []; changed(); } } }, '全部移除'))),
          h('div', { class: 'field' }, h('span', null, '加入網址'), h('div', { class: 'row-btns' }, urlInput, h('button', { class: 'btn', onclick: useUrl }, '加入'))),
          field('多個資源的顯示方式', select([['grid', '縮圖卡片'], ['slide', '單張切換']], s.mode, (v) => setMode(v))),
          field('縮圖大小', select([['s', '小'], ['m', '中'], ['l', '大']], s.thumb, (v) => { s.thumb = v; changed(false); })),
          checkbox('顯示檔名', s.names, (v) => { s.names = v; changed(false); }),
          field('圖片的顯示方式', select([['contain', '完整顯示'], ['cover', '填滿裁切']], s.fit, (v) => { s.fit = v; changed(false); })),
          field('文字檔、文件的字大小', select(ZOOMS.map((z) => [String(z), Math.round(z * 100) + '%']), String(s.zoom), (v) => { s.zoom = +v; changed(false); })),
          field('說明文字', h('input', { class: 'input', value: s.caption, oninput: (e) => { s.caption = e.target.value; ctx.save(); render(); } })));
      },
    };
  },
};
