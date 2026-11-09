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

// ---------- 時間選擇器（24 小時制，取代瀏覽器內建的上午／下午選單）
// value：'08:10'（空字串代表未設定）；onChange 收到新的 'HH:MM'
const pad2 = (n) => String(n).padStart(2, '0');
export function timePicker(value, onChange) {
  let cur = /^\d{1,2}:\d{2}$/.test(value || '') ? value.padStart(5, '0') : '';
  const label = h('span', { class: 'tp-value' });
  const btn = h('button', { type: 'button', class: 'input tp-btn', onclick: () => open() }, label, h('span', { class: 'tp-ico' }, '🕒'));
  const show = () => { label.textContent = cur || '--:--'; btn.classList.toggle('empty', !cur); };
  show();

  function open() {
    document.querySelector('.tp-pop')?.dispatchEvent(new Event('tp-close'));
    let [hh, mm] = (cur || '08:00').split(':').map(Number);
    const big = h('div', { class: 'tp-big' });
    const hours = h('div', { class: 'tp-grid tp-hours' });
    const mins = h('div', { class: 'tp-grid tp-mins' });
    const pop = h('div', { class: 'tp-pop' },
      big,
      h('div', { class: 'tp-sec' }, '時'), hours,
      h('div', { class: 'tp-sec' }, '分'), mins,
      h('div', { class: 'tp-foot' },
        h('button', { type: 'button', class: 'btn', onclick: () => step(-1) }, '−1 分'),
        h('button', { type: 'button', class: 'btn', onclick: () => step(1) }, '+1 分'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => close() }, '完成')));
    function commit() {
      cur = `${pad2(hh)}:${pad2(mm)}`;
      show();
      onChange(cur);
      draw();
    }
    function step(d) {
      const t = (hh * 60 + mm + d + 1440) % 1440;
      hh = Math.floor(t / 60); mm = t % 60;
      commit();
    }
    function draw() {
      big.textContent = `${pad2(hh)}:${pad2(mm)}`;
      hours.replaceChildren(...Array.from({ length: 24 }, (_, i) => h('button', {
        type: 'button', class: 'tp-cell' + (i === hh ? ' on' : '') + (i >= 7 && i <= 17 ? ' day' : ''),
        onclick: () => { hh = i; commit(); },
      }, pad2(i))));
      mins.replaceChildren(...Array.from({ length: 12 }, (_, i) => i * 5).map((m) => h('button', {
        type: 'button', class: 'tp-cell' + (m === mm ? ' on' : (mm > m && mm < m + 5 ? ' near' : '')),
        onclick: () => { mm = m; commit(); },
      }, pad2(m))));
    }
    draw();
    document.body.append(pop);
    // 放在欄位下方；下方空間不夠就放上方。設定視窗捲動時跟著欄位移動
    function place() {
      const r = btn.getBoundingClientRect();
      pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px';
      const below = r.bottom + 6;
      pop.style.top = (below + pop.offsetHeight > innerHeight - 8 ? Math.max(8, r.top - pop.offsetHeight - 6) : below) + 'px';
    }
    place();
    btn.classList.add('open');

    const outside = (e) => { if (!pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) close(); };
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); close(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); step(e.key === 'ArrowUp' ? 1 : -1); }
    };
    const onScroll = (e) => { if (!pop.contains(e.target)) { if (btn.isConnected) place(); else close(); } };
    function close() {
      pop.remove();
      btn.classList.remove('open');
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    }
    pop.addEventListener('tp-close', close);
    setTimeout(() => {
      document.addEventListener('pointerdown', outside, true);
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', place);
    });
    document.addEventListener('keydown', onKey, true);
  }
  return btn;
}
