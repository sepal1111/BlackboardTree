// 內容類：文字、畫板、圖片、QR Code、嵌入網頁、視訊鏡頭
import { h, field, select, checkbox, pickImage, setImage, toast } from '../ui.js';

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

export const text = {
  type: 'text', title: '文字', icon: '📝', size: { w: 0.32, h: 0.26 },
  state: () => ({ html: '', size: 9, color: '#1f2937', bg: '#fffbea', align: 'left' }),
  mount(body, ctx) {
    const s = ctx.state;
    const ed = h('div', { class: 'text-ed', contenteditable: 'true', spellcheck: 'false', 'data-ph': '在這裡輸入文字…' });
    ed.innerHTML = s.html;
    body.append(ed);
    const apply = () => {
      ed.style.fontSize = `${s.size}cqmin`;
      ed.style.color = s.color;
      ed.style.textAlign = s.align;
      body.style.background = s.bg;
    };
    apply();
    ed.addEventListener('input', () => { s.html = ed.innerHTML; ctx.save(); });
    ed.addEventListener('paste', (e) => {
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });
    ed.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        document.execCommand({ b: 'bold', i: 'italic', u: 'underline' }[e.key.toLowerCase()]);
      }
    });
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/\n/g, '<br>');
    return {
      remote: {
        view: () => ({ text: ed.innerText.slice(0, 2000) }),
        act(a, { text = '' } = {}) {
          if (a === 'set') ed.innerHTML = esc(String(text).slice(0, 5000));
          else if (a === 'append') ed.innerHTML += (ed.innerHTML ? '<br>' : '') + esc(String(text).slice(0, 5000));
          else return;
          s.html = ed.innerHTML; ctx.save();
        },
      },
      update(state) { if (document.activeElement !== ed) ed.innerHTML = state.html; },
      settings: (c) => c.append(
        field('字體大小', h('input', { type: 'range', min: 4, max: 30, step: 0.5, value: s.size, oninput: (e) => { s.size = +e.target.value; apply(); ctx.save(); } })),
        field('文字顏色', colorRow(s.color, (v) => { s.color = v; apply(); ctx.save(); })),
        field('背景顏色', colorRow(s.bg, (v) => { s.bg = v; apply(); ctx.save(); })),
        field('對齊', select([['left', '靠左'], ['center', '置中'], ['right', '靠右']], s.align, (v) => { s.align = v; apply(); ctx.save(); })),
        h('p', { class: 'muted' }, '小技巧：選取文字後按 Ctrl+B 粗體、Ctrl+I 斜體、Ctrl+U 底線。'),
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
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

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
      destroy: () => { ro.disconnect(); clearTimeout(saveT); },
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

function toEmbedUrl(url) {
  try {
    const u = new URL(url);
    let id = null;
    if (/youtube\.com$/.test(u.hostname.replace(/^www\.|^m\./, ''))) id = u.searchParams.get('v') || (u.pathname.match(/\/(shorts|live|embed)\/([\w-]+)/) || [])[2];
    if (u.hostname === 'youtu.be') id = u.pathname.slice(1);
    if (id) return `https://www.youtube-nocookie.com/embed/${id}`;
    if (/docs\.google\.com$/.test(u.hostname) && /\/(edit|view)/.test(u.pathname)) return url.replace(/\/(edit|view)[^/]*$/, '/preview');
    return u.href;
  } catch { return null; }
}

export const embed = {
  type: 'embed', title: '嵌入網頁', icon: '🌐', size: { w: 0.45, h: 0.45 },
  state: () => ({ url: '' }),
  mount(body, ctx) {
    const s = ctx.state;
    const wrap = h('div', { class: 'embed' });
    body.append(wrap);
    const input = h('input', { class: 'input', placeholder: 'YouTube、Google 簡報或其他網址', value: s.url });
    function render() {
      wrap.innerHTML = '';
      const src = s.url && toEmbedUrl(s.url);
      if (!src) {
        const inline = h('input', { class: 'input', placeholder: '貼上 YouTube 或網頁網址後按 Enter' });
        inline.addEventListener('keydown', (e) => { if (e.key === 'Enter') { s.url = inline.value.trim(); input.value = s.url; render(); ctx.save(); } });
        wrap.append(h('div', { class: 'embed-empty' }, inline, h('small', { class: 'muted' }, '部分網站不允許被嵌入，會顯示空白。')));
        return;
      }
      wrap.append(h('iframe', { src, allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' }));
    }
    input.addEventListener('change', () => { s.url = input.value.trim(); render(); ctx.save(); });
    render();
    return { settings: (c) => c.append(field('網址', input)) };
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
