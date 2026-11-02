// 共用 UI：DOM 輔助、對話框、提示訊息、選單、檔案選擇器

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
  el.replaceChildren(msg);
  el.classList.toggle('interactive', msg instanceof Node); // 內含連結時可以點
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

// 存成檔案：桌面版跳出「另存新檔」，網頁版直接下載。回傳存檔路徑（桌面版）、true（下載）或 false（取消）
export async function saveTextFile(name, text, mime = 'text/csv') {
  const NL = window.Neutralino;
  if (window.NL_PORT && NL) {
    const ext = name.split('.').pop();
    const path = await NL.os.showSaveDialog('另存新檔', { defaultPath: name, filters: [{ name: ext.toUpperCase() + ' 檔', extensions: [ext] }] });
    if (!path) return false;
    const file = /\.[^\\/]+$/.test(path) ? path : `${path}.${ext}`; // 沒打副檔名時補上
    await NL.filesystem.writeFile(file, text);
    return file;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return true;
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

// 圖片網址要非同步取得（資料夾模式要先讀檔再轉成 blob 網址）
export async function setImage(img, store, ref) {
  img.src = (await store.imageUrl(ref)) || '';
  if (!img.src || img.src === location.href) img.dispatchEvent(new Event('error'));
}

// ---------- 圖片選擇器：個人資料夾 / 上傳 / 網址（回傳圖片參照或 null）
export function pickImage(store) {
  return new Promise((resolve) => {
    let result = null;
    const list = h('div', { class: 'fp-list' });
    const crumbs = h('div', { class: 'fp-crumbs' });
    const fileInput = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    let m;

    const choose = (r) => { result = r; m.close(); };

    // 資料夾模式的縮圖要一張張讀檔，進入畫面才載入
    const io = new IntersectionObserver((ents) => ents.forEach(async (en) => {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      en.target.src = (await store.backend.thumbUrl(en.target.dataset.path).catch(() => '')) || '';
    }));
    const thumb = (p) => { const img = h('img', { alt: '', 'data-path': p }); io.observe(img); return img; };

    async function open(path) {
      list.innerHTML = '<div class="fp-empty">讀取中…</div>';
      crumbs.innerHTML = '';
      const parts = path ? path.split('/') : [];
      crumbs.append(h('button', { onclick: () => open('') }, '🏠 ' + (store.backend.fs?.label || '我的檔案')));
      parts.forEach((p, i) => crumbs.append(' / ', h('button', { onclick: () => open(parts.slice(0, i + 1).join('/')) }, p)));
      try {
        const all = await store.backend.listFiles(path);
        list.innerHTML = '';
        const items = all.filter((it) => it.dir || it.type.startsWith('image/'));
        if (!items.length) list.append(h('div', { class: 'fp-empty' }, '這個資料夾沒有圖片'));
        for (const it of items) {
          const p = path ? path + '/' + it.name : it.name;
          list.append(it.dir
            ? h('button', { class: 'fp-item dir', onclick: () => open(p) }, h('div', { class: 'fp-thumb' }, '📁'), h('span', null, it.name))
            : h('button', { class: 'fp-item', onclick: () => choose({ kind: 'file', base: 'root', path: p }) },
              h('div', { class: 'fp-thumb' }, thumb(p)), h('span', null, it.name)));
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
        if (!store.backend.canBrowse) {
          choose({ kind: 'data', url: await fileToDataUrl(f) });
        } else {
          toast('儲存中…');
          const ref = await store.backend.upload(f);
          toast(`已存到 ${store.backend.label} 的 media 資料夾`);
          choose(ref);
        }
      } catch (e) { toast('上傳失敗：' + e.message); }
    });

    const urlInput = h('input', { class: 'input', placeholder: 'https://… 圖片網址' });
    const body = h('div', { class: 'fp' },
      h('div', { class: 'fp-bar' },
        h('button', { class: 'btn primary', onclick: () => fileInput.click() }, store.backend.canBrowse ? '📤 加入新圖片' : '📤 從這台電腦選擇'),
        urlInput,
        h('button', { class: 'btn', onclick: () => urlInput.value.trim() && choose({ kind: 'url', url: urlInput.value.trim() }) }, '使用網址')),
      fileInput,
      !store.backend.canBrowse ? h('p', { class: 'muted' }, '目前資料只存在這台電腦。改用網路磁碟機儲存後，就能直接選用個人資料夾裡的圖片。') : [crumbs, list]);

    m = modal({ title: '選擇圖片', body, wide: true, onClose: () => { io.disconnect(); resolve(result); } });
    if (store.backend.canBrowse) open('');
  });
}
