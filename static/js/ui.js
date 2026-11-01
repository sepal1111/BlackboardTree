// 共用 UI：DOM 輔助、對話框、提示訊息、選單、檔案選擇器
import { api, fileUrl } from './api.js';

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// ---------- 提示訊息
let toastTimer;
export function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------- 對話框
export function modal({ title, body, actions = [], wide = false, onClose } = {}) {
  const root = document.getElementById('modal-root');
  const close = () => {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const foot = actions.length
    ? h('div', { class: 'm-foot' }, actions.map((a) => h('button', {
      class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''),
      onclick: () => { if (a.onClick?.() !== false) close(); },
    }, a.label)))
    : null;
  const box = h('div', { class: 'modal' + (wide ? ' wide' : '') },
    h('div', { class: 'm-head' }, h('h3', null, title || ''), h('button', { class: 'icon-btn', title: '關閉', onclick: close }, '✕')),
    h('div', { class: 'm-body' }, body),
    foot);
  const wrap = h('div', { class: 'm-wrap', onpointerdown: (e) => { if (e.target === wrap) close(); } }, box);
  root.append(wrap);
  document.addEventListener('keydown', onKey);
  setTimeout(() => box.querySelector('input,textarea,select')?.focus(), 30);
  return { close, el: box };
}

export function promptDialog(title, value = '', placeholder = '') {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input', { class: 'input', value, placeholder });
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const m = modal({
      title, body: input, onClose: () => finish(null),
      actions: [{ label: '取消' }, { label: '確定', primary: true, onClick: () => finish(input.value.trim()) }],
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { finish(input.value.trim()); m.close(); } });
    setTimeout(() => input.select(), 40);
  });
}

export function confirmDialog(msg, okLabel = '確定', danger = false) {
  return new Promise((resolve) => {
    let v = false;
    modal({
      title: '請確認', body: h('p', null, msg), onClose: () => resolve(v),
      actions: [{ label: '取消' }, { label: okLabel, primary: !danger, danger, onClick: () => { v = true; } }],
    });
  });
}

// ---------- 下拉選單
export function menu(anchor, items) {
  document.querySelector('.popmenu')?.remove();
  const el = h('div', { class: 'popmenu' }, items.map((it) => it === '-'
    ? h('hr')
    : h('button', {
      class: (it.active ? 'active ' : '') + (it.danger ? 'danger' : ''),
      onclick: () => { el.remove(); it.onClick(); },
    }, it.label)));
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  const top = r.bottom + 6;
  el.style.left = Math.min(r.left, innerWidth - el.offsetWidth - 8) + 'px';
  if (top + el.offsetHeight > innerHeight) el.style.top = Math.max(8, r.top - el.offsetHeight - 6) + 'px';
  else el.style.top = top + 'px';
  const off = (e) => { if (!el.contains(e.target)) { el.remove(); document.removeEventListener('pointerdown', off, true); } };
  setTimeout(() => document.addEventListener('pointerdown', off, true));
}

// ---------- 表單小元件（給小工具的設定面板用）
export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', null, label), control, hint ? h('small', null, hint) : null);
}
export function select(options, value, onChange) {
  return h('select', { class: 'input', onchange: (e) => onChange(e.target.value) },
    options.map(([v, l]) => { const o = h('option', { value: v }, l); if (String(v) === String(value)) o.selected = true; return o; }));
}
export function checkbox(label, checked, onChange) {
  return h('label', { class: 'check' }, h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }), label);
}

// ---------- 圖片處理：縮小後轉成 dataURL（訪客模式用）
export function fileToDataUrl(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('無法讀取圖片')); };
    img.src = url;
  });
}

export function imageSrc(ref) {
  if (!ref) return '';
  if (ref.kind === 'smb') return fileUrl(ref.path);
  return ref.url || '';
}

// ---------- 圖片選擇器：個人 SAMBA 資料夾 / 上傳 / 網址
// 回傳 {kind:'smb', path} | {kind:'data', url} | {kind:'url', url} | null
export function pickImage(store) {
  return new Promise((resolve) => {
    let result = null;
    const list = h('div', { class: 'fp-list' });
    const crumbs = h('div', { class: 'fp-crumbs' });
    const fileInput = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    let m;

    const choose = (r) => { result = r; m.close(); };

    async function open(path) {
      list.innerHTML = '<div class="fp-empty">讀取中…</div>';
      crumbs.innerHTML = '';
      const parts = path ? path.split('/') : [];
      crumbs.append(h('button', { onclick: () => open('') }, '🏠 我的檔案'));
      parts.forEach((p, i) => crumbs.append(' / ', h('button', { onclick: () => open(parts.slice(0, i + 1).join('/')) }, p)));
      try {
        const r = await api.get('/api/files?path=' + encodeURIComponent(path));
        list.innerHTML = '';
        const items = r.items.filter((it) => it.dir || it.type.startsWith('image/'));
        if (!items.length) list.append(h('div', { class: 'fp-empty' }, '這個資料夾沒有圖片'));
        for (const it of items) {
          const p = path ? path + '/' + it.name : it.name;
          list.append(it.dir
            ? h('button', { class: 'fp-item dir', onclick: () => open(p) }, h('div', { class: 'fp-thumb' }, '📁'), h('span', null, it.name))
            : h('button', { class: 'fp-item', onclick: () => choose({ kind: 'smb', path: p }) },
              h('div', { class: 'fp-thumb' }, h('img', { src: fileUrl(p), loading: 'lazy', alt: '' })), h('span', null, it.name)));
        }
      } catch (e) {
        list.innerHTML = '';
        list.append(h('div', { class: 'fp-empty' }, '無法讀取：' + e.message));
      }
    }

    fileInput.addEventListener('change', async () => {
      const f = fileInput.files[0];
      if (!f) return;
      try {
        if (store.guest) {
          choose({ kind: 'data', url: await fileToDataUrl(f) });
        } else {
          toast('上傳中…');
          const r = await api.post('/api/upload?name=' + encodeURIComponent(f.name), f);
          toast('已上傳到你的 SAMBA 資料夾');
          choose({ kind: 'smb', path: r.path });
        }
      } catch (e) { toast('上傳失敗：' + e.message); }
    });

    const urlInput = h('input', { class: 'input', placeholder: 'https://… 圖片網址' });
    const body = h('div', { class: 'fp' },
      h('div', { class: 'fp-bar' },
        h('button', { class: 'btn primary', onclick: () => fileInput.click() }, store.guest ? '📤 從這台電腦選擇' : '📤 上傳圖片'),
        urlInput,
        h('button', { class: 'btn', onclick: () => urlInput.value.trim() && choose({ kind: 'url', url: urlInput.value.trim() }) }, '使用網址')),
      fileInput,
      store.guest ? h('p', { class: 'muted' }, '訪客模式無法瀏覽 SAMBA，登入後即可使用個人資料夾中的圖片。') : [crumbs, list]);

    m = modal({ title: '選擇圖片', body, wide: true, onClose: () => resolve(result) });
    if (!store.guest) open('');
  });
}
