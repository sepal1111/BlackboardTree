// 圖片：可以放多張照片，用「縮圖卡片」（像檔案總管的大圖示，縮圖維持原本的長寬比例）
// 或「單張切換」（左右滑動、按 ‹ › 換下一張）顯示
import { h, field, select, checkbox, setImage, confirmDialog } from '../ui.js';
import { pickImage } from '../image-picker.js';
import { normalizeImageState, wrapIndex, clampIndex, moveItem, refName, addRefs, THUMB_PX, THUMB_STEPS } from '../image-list.js';

export const image = {
  type: 'image', title: '圖片', icon: '🖼️', size: { w: 0.34, h: 0.36 },
  // refs：圖片參照；mode：grid 縮圖卡片／slide 單張切換；thumb：縮圖大小 s/m/l；names：縮圖下方顯示檔名
  state: () => ({ refs: [], mode: 'slide', index: 0, fit: 'contain', thumb: 'm', names: true, caption: '' }),
  mount(body, ctx) {
    const s = normalizeImageState(ctx.state);
    const wrap = h('div', { class: 'image-w' });
    body.append(wrap);
    let slide = null;          // 單張模式的控制：{ step(d) }
    let redrawSettings = null; // 設定畫面開著時，同步更新圖片清單

    const changed = (push = true) => {
      s.index = clampIndex(s.index, s.refs.length);
      ctx.save();
      render();
      redrawSettings?.();
      if (push) ctx.push?.();
    };

    async function add() {
      const refs = await pickImage(ctx.store, { multiple: true });
      if (!refs?.length) return;
      const wasEmpty = !s.refs.length;
      s.refs = addRefs(s.refs, refs);
      if (wasEmpty) { s.index = 0; s.mode = s.refs.length > 1 ? 'grid' : 'slide'; }
      changed();
    }

    function setMode(mode) { s.mode = mode; changed(); }
    function thumbStep(d) {
      const i = THUMB_STEPS.indexOf(s.thumb);
      s.thumb = THUMB_STEPS[Math.max(0, Math.min(THUMB_STEPS.length - 1, i + d))];
      changed(false);
    }

    function picture(ref, cls, fit) {
      const img = h('img', { alt: refName(ref), draggable: 'false', class: cls, style: fit ? { objectFit: fit } : null });
      img.onerror = () => img.replaceWith(h('div', { class: 'img-bad' }, '⚠️', h('small', null, '圖片無法載入')));
      setImage(img, ctx.store, ref);
      return img;
    }

    function tools() {
      const bar = h('div', { class: 'img-tools' });
      const b = (label, title, fn) => bar.append(h('button', { title, onclick: fn }, label));
      if (s.refs.length > 1) {
        if (s.mode === 'grid') {
          b('−', '縮圖變小', () => thumbStep(-1));
          b('+', '縮圖變大', () => thumbStep(1));
          b('🖼', '單張切換', () => setMode('slide'));
        } else b('▦', '縮圖卡片', () => setMode('grid'));
      }
      b('➕', '加入圖片', add);
      return bar;
    }

    function renderGrid() {
      const grid = h('div', { class: 'img-grid' });
      grid.style.setProperty('--cell', THUMB_PX[s.thumb] + 'px');
      s.refs.forEach((ref, i) => {
        const name = refName(ref);
        grid.append(h('button', {
          class: 'img-card', title: name || `第 ${i + 1} 張`,
          onclick: () => { s.index = i; setMode('slide'); },
        }, h('div', { class: 'img-box' }, picture(ref)), s.names && name ? h('div', { class: 'img-name' }, name) : null));
      });
      return grid;
    }

    function renderSlide() {
      const n = s.refs.length;
      const view = h('div', { class: 'img-slide', tabindex: '0' });
      const track = h('div', { class: 'img-track' });
      const counter = h('div', { class: 'img-count' });
      const pane = (i) => h('div', { class: 'img-pane' }, picture(s.refs[wrapIndex(i, n)], '', s.fit));
      const fill = () => {
        track.style.transition = 'none';
        track.style.transform = n > 1 ? 'translateX(-100%)' : '';
        track.replaceChildren(...(n > 1 ? [pane(s.index - 1), pane(s.index), pane(s.index + 1)] : [pane(s.index)]));
        const name = refName(s.refs[s.index]);
        counter.textContent = `${s.index + 1} / ${n}` + (s.names && name ? `　${name}` : '');
      };
      let moving = false;
      const step = (d) => {
        if (n < 2 || moving) return;
        moving = true;
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

      // 左右拖曳換張
      view.addEventListener('pointerdown', (e) => {
        if (n < 2 || moving || e.button !== 0 || e.target.closest('button')) return;
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
        if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); step(1); }
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); step(-1); }
      });

      view.append(track);
      if (n > 1) {
        view.append(
          h('button', { class: 'img-nav prev', title: '上一張', onclick: () => step(-1) }, '‹'),
          h('button', { class: 'img-nav next', title: '下一張', onclick: () => step(1) }, '›'),
          counter);
      }
      fill();
      slide = { step };
      return view;
    }

    function render() {
      wrap.replaceChildren();
      slide = null;
      if (!s.refs.length) {
        wrap.classList.add('empty');
        wrap.append(h('button', { class: 'btn primary', onclick: add }, '選擇圖片'), h('small', { class: 'muted' }, '可以一次選好幾張'));
        return;
      }
      wrap.classList.remove('empty');
      const grid = s.mode === 'grid' && s.refs.length > 1;
      wrap.append(h('div', { class: 'img-main' }, grid ? renderGrid() : renderSlide(), tools()));
      if (s.caption) wrap.append(h('div', { class: 'image-cap' }, s.caption));
    }

    render();
    return {
      destroy: () => { redrawSettings = null; },
      remote: {
        view: () => ({ count: s.refs.length, index: s.index, mode: s.mode, name: refName(s.refs[s.index]) }),
        act(a) {
          if (a === 'next' || a === 'prev') {
            if (s.mode !== 'slide') { s.mode = 'slide'; changed(false); }
            slide?.step(a === 'next' ? 1 : -1);
          } else if (a === 'grid' || a === 'slide') setMode(a);
          ctx.push?.();
        },
      },
      settings: (c) => {
        const listBox = h('div', { class: 'img-manage' });
        const head = h('span');
        redrawSettings = () => {
          if (!listBox.isConnected && listBox.parentNode) { redrawSettings = null; return; }
          head.textContent = `圖片（${s.refs.length} 張）`;
          listBox.replaceChildren(...(s.refs.length ? s.refs.map((ref, i) => {
            const im = h('img', { alt: '' });
            im.onerror = () => im.replaceWith(h('span', { class: 'img-row-bad' }, '⚠️'));
            setImage(im, ctx.store, ref);
            return h('div', { class: 'img-row' },
              h('span', { class: 'img-row-no' }, i + 1), im,
              h('span', { class: 'img-row-name' }, refName(ref) || '（圖片）'),
              h('button', { class: 'btn small', title: '往前', disabled: i === 0, onclick: () => { s.refs = moveItem(s.refs, i, -1); if (s.index === i) s.index--; else if (s.index === i - 1) s.index++; changed(); } }, '↑'),
              h('button', { class: 'btn small', title: '往後', disabled: i === s.refs.length - 1, onclick: () => { s.refs = moveItem(s.refs, i, 1); if (s.index === i) s.index++; else if (s.index === i + 1) s.index--; changed(); } }, '↓'),
              h('button', { class: 'btn small', title: '從這個小工具移除（不會刪除檔案）', onclick: () => { s.refs = s.refs.filter((_, j) => j !== i); if (s.index > i) s.index--; changed(); } }, '✕'));
          }) : [h('div', { class: 'muted' }, '還沒有圖片')]));
        };
        redrawSettings();
        c.append(
          h('div', { class: 'field' }, head, listBox,
            h('div', { class: 'row-btns' },
              h('button', { class: 'btn primary', onclick: add }, '➕ 加入圖片'),
              h('button', { class: 'btn', onclick: async () => { if (s.refs.length && await confirmDialog('要移除這個小工具裡的所有圖片嗎？（不會刪除檔案）')) { s.refs = []; changed(); } } }, '全部移除'))),
          field('多張圖片的顯示方式', select([['grid', '縮圖卡片'], ['slide', '單張切換']], s.mode, (v) => setMode(v))),
          field('縮圖大小', select([['s', '小'], ['m', '中'], ['l', '大']], s.thumb, (v) => { s.thumb = v; changed(false); })),
          checkbox('顯示檔名', s.names, (v) => { s.names = v; changed(false); }),
          field('單張的顯示方式', select([['contain', '完整顯示'], ['cover', '填滿裁切']], s.fit, (v) => { s.fit = v; changed(false); })),
          field('說明文字', h('input', { class: 'input', value: s.caption, oninput: (e) => { s.caption = e.target.value; ctx.save(); render(); } })));
      },
    };
  },
};
