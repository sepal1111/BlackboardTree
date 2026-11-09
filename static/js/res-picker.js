// 檔案選擇器：個人資料夾、這台電腦的資料夾（桌面、圖片、下載、各磁碟）、選擇檔案、網址
// pickImage(store)                          → 一張圖片的參照或 null（背景圖片用）
// pickResources(store, { multiple: true })  → 參照的陣列或 null（匯入資源：圖片、影片、音訊、文件、網址）
// 從這台電腦選的檔案會複製到白板資料夾的 media（訪客模式的圖片轉成內嵌圖片），換到其他電腦也看得到；
// 桌面版 200 MB 以上的影片、音訊、文件不複製，只記住完整路徑（只有這台電腦能顯示）。
import { h, modal, toast, fileToDataUrl } from './ui.js';
import { LS } from './store.js';
import { FsaAdapter, NeuAdapter, mimeOf } from './backends/fs.js';
import { isImageName, isImportable, fileKind, extOf, KIND_ICON, BIG_FILE, fmtSize } from './res-list.js';

const DESKTOP = () => typeof window !== 'undefined' && typeof window.NL_PORT !== 'undefined';
const TAB_KEY = 'ms:imgPickTab';
const DIR_KEY = 'ms:imgLocalDir';
const byName = (a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'zh-Hant', { numeric: true }) : a.dir ? -1 : 1);
const join = (a, b) => (a ? a + '/' + b : b);
const trim = (p) => String(p || '').replace(/[\\/]+$/, '');

let webDir = null; // 網頁版這次開過的本機資料夾（重新整理後要再選一次）

// ---------- 桌面版：這台電腦常用的位置
async function exists(p) {
  try {
    return await Promise.race([
      window.Neutralino.filesystem.getStats(p).then((s) => !!s.isDirectory),
      new Promise((r) => setTimeout(() => r(false), 1500)), // 斷線的網路磁碟機不要等太久
    ]);
  } catch { return false; }
}

async function desktopPlaces() {
  const os = window.Neutralino.os;
  const get = (k) => os.getPath(k).then(trim).catch(() => '');
  const [docs, pics, down, data] = await Promise.all([get('documents'), get('pictures'), get('downloads'), get('data')]);
  const home = data.replace(/\\AppData\\Roaming$/i, '');
  const parent = (p) => p.replace(/[\\/][^\\/]+$/, '');
  const deskCands = [docs && parent(docs) + '\\Desktop', home + '\\Desktop', home + '\\OneDrive\\Desktop', home + '\\OneDrive\\桌面'].filter(Boolean);
  let desk = '';
  for (const d of deskCands) if (await exists(d)) { desk = d; break; }
  const places = [];
  const last = LS.get(DIR_KEY, '');
  if (last && await exists(last)) places.push({ icon: '🕘', name: '上次的資料夾', path: last });
  if (desk) places.push({ icon: '🖥️', name: '桌面', path: desk });
  if (pics) places.push({ icon: '🖼️', name: '圖片', path: pics });
  if (down) places.push({ icon: '⬇️', name: '下載', path: down });
  if (docs) places.push({ icon: '📄', name: '文件', path: docs });
  const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const ok = await Promise.all(letters.map((l) => exists(l + ':\\')));
  letters.forEach((l, i) => { if (ok[i]) places.push({ icon: '💽', name: `磁碟 ${l}:`, path: l + ':' }); });
  return places;
}

// 多選時用拖曳框選：滑鼠從任何地方拖曳；觸控先按住 0.4 秒再拖曳（直接滑動仍是捲動）。
// 從已選的項目開始拖曳會取消框到的項目，按住 Ctrl 則是反轉。
function boxSelect(list, { isSel, setSel, done }) {
  let st = null;      // { id, x0, y0, x, y, base: Map, mode, on }
  let pending = null; // 觸控按住中
  let skipClick = false;
  let raf = 0;
  const box = h('div', { class: 'fp-box' });
  const items = () => [...list.querySelectorAll('.fp-item')].filter((b) => b._pick);
  const pt = (e) => {
    const r = list.getBoundingClientRect();
    return { x: e.clientX - r.left + list.scrollLeft, y: e.clientY - r.top + list.scrollTop, cy: e.clientY, r };
  };

  function update() {
    const x1 = Math.min(st.x0, st.x), x2 = Math.max(st.x0, st.x);
    const y1 = Math.min(st.y0, st.y), y2 = Math.max(st.y0, st.y);
    Object.assign(box.style, { left: x1 + 'px', top: y1 + 'px', width: x2 - x1 + 'px', height: y2 - y1 + 'px' });
    for (const b of items()) {
      const hit = b.offsetLeft < x2 && b.offsetLeft + b.offsetWidth > x1 && b.offsetTop < y2 && b.offsetTop + b.offsetHeight > y1;
      const was = st.base.get(b);
      const want = !hit ? was : st.mode === 'toggle' ? !was : st.mode === 'add';
      if (isSel(b) !== want) setSel(b, want);
    }
    done();
  }

  function begin(e, p) {
    const startItem = e.target.closest?.('.fp-item');
    st = {
      id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y, cy: p.cy,
      base: new Map(items().map((b) => [b, isSel(b)])),
      mode: e.ctrlKey || e.metaKey ? 'toggle' : startItem?._pick && isSel(startItem) ? 'remove' : 'add',
    };
    list.append(box);
    list.classList.add('boxing');
    try { list.setPointerCapture(e.pointerId); } catch { /* 觸控結束得太快 */ }
    update();
    const tick = () => { // 拖到上下邊緣時自動捲動
      if (!st) return;
      const r = list.getBoundingClientRect();
      const d = st.cy < r.top + 30 ? -12 : st.cy > r.bottom - 30 ? 12 : 0;
      if (d) {
        const before = list.scrollTop;
        list.scrollTop += d;
        if (list.scrollTop !== before) { st.y += list.scrollTop - before; update(); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function end() {
    clearTimeout(pending?.timer);
    pending = null;
    if (!st) return;
    cancelAnimationFrame(raf);
    skipClick = st.moved;
    st = null;
    box.remove();
    list.classList.remove('boxing');
  }

  list.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || st || pending) return;
    if (e.target.closest?.('.fp-item.dir')) return; // 資料夾照常點開
    const p = pt(e);
    if (p.x - list.scrollLeft > list.clientWidth || p.y - list.scrollTop > list.clientHeight) return; // 捲軸
    if (e.pointerType === 'touch') {
      pending = { id: e.pointerId, e, p, timer: setTimeout(() => { const q = pending; pending = null; begin(q.e, q.p); st.moved = true; navigator.vibrate?.(15); }, 400) };
    } else {
      pending = { id: e.pointerId, e, p, mouse: true };
    }
  });
  list.addEventListener('pointermove', (e) => {
    if (pending?.id === e.pointerId) {
      const d = Math.hypot(e.clientX - pending.e.clientX, e.clientY - pending.e.clientY);
      if (pending.mouse && d > 6) { const q = pending; pending = null; begin(q.e, q.p); st.moved = true; }
      else if (!pending.mouse && d > 10) { clearTimeout(pending.timer); pending = null; } // 手指在捲動
      if (!st) return;
    }
    if (st?.id !== e.pointerId) return;
    const p = pt(e);
    Object.assign(st, { x: p.x, y: p.y, cy: p.cy });
    update();
  });
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
  list.addEventListener('lostpointercapture', end);
  // 框選中不讓手指捲動、不跳出右鍵選單
  list.addEventListener('touchmove', (e) => { if (st) e.preventDefault(); }, { passive: false });
  list.addEventListener('contextmenu', (e) => { if (st || pending) e.preventDefault(); });
  // 框選放開後不要再觸發一次點選
  list.addEventListener('click', (e) => {
    if (!skipClick) return;
    skipClick = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);
  list.addEventListener('pointerdown', () => { skipClick = false; }, true);
}

export const pickImage = (store, opt = {}) => pickResources(store, { ...opt, accept: 'image' });

export function pickResources(store, { multiple = false, accept = 'all' } = {}) {
  const images = accept === 'image';
  const okName = images ? isImageName : isImportable;
  const what = images ? '圖片' : '檔案';
  const unit = images ? '張' : '個';
  return new Promise((resolve) => {
    const be = store.backend;
    const canLocal = DESKTOP() || FsaAdapter.supported();
    const tabs = [];
    if (be.canBrowse) tabs.push({ id: 'store', label: '📂 ' + (be.fs?.label || be.label || '我的檔案') });
    if (canLocal) tabs.push({ id: 'local', label: '💻 這台電腦' });

    let result = null;
    let m;
    let tab = tabs.find((t) => t.id === LS.get(TAB_KEY, ''))?.id || tabs[0]?.id || '';
    let loc = null;      // 目前瀏覽的位置：{ fs, root, path }（root：資料夾的顯示名稱）
    let shown = [];      // 目前資料夾裡的圖片
    let busy = false;
    const picked = new Map(); // 多選：key → { local, fs, path, name }
    const urls = [];

    const list = h('div', { class: 'fp-list' });
    const crumbs = h('div', { class: 'fp-crumbs' });
    const tabBar = h('div', { class: 'fp-tabs' });
    const count = h('span', { class: 'fp-count' });
    const addBtn = h('button', { class: 'btn primary', onclick: () => finish() }, '加入');
    const fileInput = h('input', { type: 'file', accept: images ? 'image/*' : null, multiple, style: { display: 'none' } });
    const hint = h('small', { class: 'muted' });

    // 縮圖進入畫面才讀檔
    const io = new IntersectionObserver((ents) => ents.forEach(async (en) => {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      const { fs, path, local } = en.target._src;
      let url = '';
      try {
        if (local) {
          const blob = await fs.readBlob(path);
          if (blob) { url = URL.createObjectURL(blob); urls.push(url); }
        } else url = (await be.thumbUrl(path)) || '';
      } catch { url = ''; }
      en.target.src = url;
    }));

    const keyOf = (local, path) => (local ? 'L:' + (loc?.root || '') + '|' : 'S:') + path;

    // 把選好的檔案變成參照（這台電腦的檔案先複製進白板資料夾）
    async function toRef(it) {
      if (!it.local) return { kind: 'file', base: 'root', path: it.path, name: it.name };
      const kind = fileKind(it.name);
      const abs = it.fs?.p ? it.fs.p(it.path) : ''; // 桌面版：這台電腦上的完整路徑
      if (abs) {
        const size = (await it.fs.stat(it.path))?.size || 0;
        if (kind !== 'image' && (size >= BIG_FILE || !be.canBrowse)) return { kind: 'abs', path: abs, name: it.name };
        if (be.canBrowse && be.importPath) {
          const r = await be.importPath(abs, it.name);
          if (r) return { ...r, name: it.name };
        }
      }
      const blob = it.file || (await it.fs.readBlob(it.path));
      if (!blob) throw new Error(`讀不到「${it.name}」`);
      if (kind !== 'image' && !be.canBrowse) throw new Error(`「${it.name}」：資料只存在這台電腦時只能加入圖片，請改用資料夾儲存`);
      if (kind !== 'image' && it.file && DESKTOP() && blob.size >= BIG_FILE) throw new Error(`「${it.name}」太大（${fmtSize(blob.size)}），請改從「💻 這台電腦」選擇`);
      const file = blob instanceof File ? blob : new File([blob], it.name, { type: blob.type || mimeOf(it.name) });
      if (be.canBrowse) return { ...(await be.upload(file)), name: it.name };
      return { kind: 'data', url: await fileToDataUrl(file), name: it.name };
    }

    async function finish(items = [...picked.values()]) {
      if (busy || !items.length) return;
      busy = true;
      const refs = [];
      const copying = items.some((it) => it.local);
      try {
        for (let i = 0; i < items.length; i++) {
          if (copying) toast(items.length > 1 ? `加入${what}中… ${i + 1} / ${items.length}` : `加入${what}中…`);
          refs.push(await toRef(items[i]));
        }
        if (copying && be.canBrowse && refs.some((r) => r.base === 'data')) toast(`已複製到 ${be.label} 的 media 資料夾`);
      } catch (e) {
        toast('加入失敗：' + e.message);
        if (!refs.length) { busy = false; return; }
      }
      result = multiple ? refs : refs[0];
      m.close();
    }

    function updateFoot() {
      if (!multiple) return;
      count.textContent = picked.size ? `已選 ${picked.size} ${unit}` : shown.length ? '點一下或拖曳框選，可以選多個' : '';
      addBtn.textContent = picked.size ? `加入 ${picked.size} ${unit}` : '加入';
      addBtn.disabled = !picked.size;
    }

    function itemFor(it, local) {
      const path = join(loc?.path ?? '', it.name);
      const k = keyOf(local, path);
      const kind = fileKind(it.name);
      let img;
      if (kind === 'image') {
        img = h('img', { alt: '', draggable: 'false' });
        img._src = { fs: loc?.fs, path, local };
        io.observe(img);
      } else img = h('span', { class: 'fp-icon' }, KIND_ICON[kind] || '📄', h('small', null, extOf(it.name).toUpperCase()));
      const badge = h('span', { class: 'fp-check' }, '✓');
      const btn = h('button', { class: 'fp-item' + (picked.has(k) ? ' sel' : ''), title: it.name },
        h('div', { class: 'fp-thumb' }, img), badge, h('span', null, it.name));
      const data = { local, fs: loc?.fs, path, name: it.name };
      btn._pick = { k, data };
      btn.onclick = () => {
        if (!multiple) { finish([data]); return; }
        if (picked.has(k)) picked.delete(k); else picked.set(k, data);
        btn.classList.toggle('sel', picked.has(k));
        updateFoot();
      };
      return btn;
    }

    if (multiple) boxSelect(list, {
      isSel: (b) => picked.has(b._pick.k),
      setSel: (b, on) => {
        if (on) picked.set(b._pick.k, b._pick.data); else picked.delete(b._pick.k);
        b.classList.toggle('sel', on);
      },
      done: updateFoot,
    });

    function selectAll() {
      const btns = [...list.querySelectorAll('.fp-item')].filter((b) => b._pick);
      const all = btns.every((b) => picked.has(b._pick.k));
      for (const b of btns) {
        if (all) picked.delete(b._pick.k); else picked.set(b._pick.k, b._pick.data);
        b.classList.toggle('sel', !all);
      }
      updateFoot();
    }

    const dirBtn = (icon, name, onclick) => h('button', { class: 'fp-item dir', onclick }, h('div', { class: 'fp-thumb' }, icon), h('span', null, name));

    async function showFolder(local) {
      list.innerHTML = '<div class="fp-empty">讀取中…</div>';
      shown = [];
      updateFoot();
      const here = loc;
      try {
        const all = local ? await loc.fs.list(loc.path) : await be.listFiles(loc.path);
        if (here !== loc) return;
        const dirs = all.filter((i) => i.dir).sort(byName);
        shown = all.filter((i) => !i.dir && okName(i.name)).sort(byName);
        list.innerHTML = '';
        for (const d of dirs) list.append(dirBtn('📁', d.name, () => go({ ...loc, path: join(loc.path, d.name) })));
        for (const it of shown) list.append(itemFor(it, local));
        if (!dirs.length && !shown.length) list.append(h('div', { class: 'fp-empty' }, `這個資料夾沒有可以加入的${what}`));
        if (local && DESKTOP()) LS.set(DIR_KEY, loc.fs.p(loc.path));
      } catch (e) {
        list.innerHTML = '';
        list.append(h('div', { class: 'fp-empty' }, '無法讀取：' + e.message));
      }
      updateFoot();
    }

    function renderCrumbs(local) {
      crumbs.innerHTML = '';
      if (local) {
        crumbs.append(h('button', { onclick: () => go(null) }, '💻 這台電腦'));
        if (loc) crumbs.append(' / ', h('button', { onclick: () => go({ ...loc, path: '' }) }, loc.root));
      } else {
        crumbs.append(h('button', { onclick: () => go({ path: '' }) }, '🏠 ' + (be.fs?.label || '我的檔案')));
      }
      const parts = loc?.path ? loc.path.split('/') : [];
      parts.forEach((p, i) => crumbs.append(' / ', h('button', { onclick: () => go({ ...loc, path: parts.slice(0, i + 1).join('/') }) }, p)));
      if (multiple && loc) crumbs.append(h('span', { class: 'fp-spacer' }), h('button', { onclick: selectAll }, '全選這個資料夾'));
    }

    async function showPlaces() {
      list.innerHTML = '';
      shown = [];
      updateFoot();
      if (DESKTOP()) {
        list.innerHTML = '<div class="fp-empty">讀取中…</div>';
        const places = await desktopPlaces();
        if (tab !== 'local' || loc) return;
        list.innerHTML = '';
        for (const p of places) list.append(dirBtn(p.icon, p.name, () => go({ fs: new NeuAdapter(p.path), root: p.name === '上次的資料夾' ? p.path : p.name, path: '' })));
        list.append(dirBtn('📁', '選擇其他資料夾…', async () => {
          const p = await window.Neutralino.os.showFolderDialog(`選擇${what}所在的資料夾`).catch(() => '');
          if (p) go({ fs: new NeuAdapter(p), root: trim(p), path: '' });
        }));
      } else {
        if (webDir) list.append(dirBtn('🕘', webDir.name, () => go({ fs: webDir, root: webDir.name, path: '' })));
        list.append(dirBtn('📁', '開啟資料夾…', async () => {
          try {
            const handle = await window.showDirectoryPicker({ id: 'ms-images', mode: 'read', startIn: 'pictures' });
            webDir = new FsaAdapter(handle);
            go({ fs: webDir, root: handle.name, path: '' });
          } catch { /* 取消 */ }
        }));
      }
    }

    function go(next) {
      loc = next;
      list.querySelectorAll('img').forEach((i) => io.unobserve(i));
      const local = tab === 'local';
      renderCrumbs(local);
      if (local && !loc) showPlaces();
      else showFolder(local);
    }

    function setTab(id) {
      tab = id;
      LS.set(TAB_KEY, id);
      hint.textContent = id !== 'local' ? '' : be.canBrowse
        ? `選好的${what}會複製一份到 ${be.label} 的 media 資料夾，換到其他電腦也看得到。` + (images || !DESKTOP() ? '' : '200 MB 以上的檔案不複製，只有這台電腦能顯示。')
        : images ? '' : DESKTOP() ? '資料只存在這台電腦：圖片以外的檔案只記住位置，只有這台電腦能顯示。' : '資料只存在這台電腦時只能加入圖片；要加入影片、文件，請改用資料夾儲存。';
      tabBar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
      go(id === 'store' ? { path: '' } : null);
    }

    fileInput.addEventListener('change', () => {
      const files = [...fileInput.files];
      fileInput.value = '';
      if (files.length) finish(files.map((f) => ({ local: true, file: f, name: f.name })));
    });

    for (const t of tabs) tabBar.append(h('button', { 'data-tab': t.id, onclick: () => setTab(t.id) }, t.label));
    const urlInput = h('input', { class: 'input', placeholder: images ? 'https://… 圖片網址' : 'https://… 網址（YouTube、網頁、Google 簡報、影片、圖片）' });
    const useUrl = () => {
      const u = urlInput.value.trim();
      if (!u) return;
      result = multiple ? [{ kind: 'url', url: u }] : { kind: 'url', url: u };
      m.close();
    };
    const body = h('div', { class: 'fp' },
      h('div', { class: 'fp-bar' },
        tabs.length > 1 ? tabBar : '',
        h('span', { class: 'fp-spacer' }),
        h('button', { class: 'btn', onclick: () => fileInput.click() }, multiple ? '📤 選擇檔案（可多選）' : '📤 選擇檔案')),
      fileInput,
      tabs.length ? [crumbs, list] : h('p', { class: 'muted' }, `可以按「📤 選擇檔案」從這台電腦挑選${what}；改用網路磁碟機儲存後，也能直接選用個人資料夾裡的${what}。`),
      hint,
      h('div', { class: 'fp-bar' }, urlInput, h('button', { class: 'btn', onclick: useUrl }, '使用網址')),
      multiple ? h('div', { class: 'fp-foot' }, count, h('span', { class: 'fp-spacer' }), addBtn) : '');

    m = modal({
      title: images ? (multiple ? '加入圖片' : '選擇圖片') : '📂 匯入資源', body, wide: true,
      onClose: () => { io.disconnect(); urls.forEach((u) => URL.revokeObjectURL(u)); resolve(result); },
    });
    if (tab) setTab(tab);
    updateFoot();
  });
}
