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
