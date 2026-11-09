// 圖片選擇器：個人資料夾、這台電腦的資料夾（桌面、圖片、下載、各磁碟）、上傳檔案、網址
// pickImage(store)                     → 一張圖片的參照或 null（背景圖片用）
// pickImage(store, { multiple: true }) → 參照的陣列或 null（圖片工具一次加入多張）
// 從這台電腦選的圖片會複製到白板資料夾的 media（訪客模式轉成內嵌圖片），換到其他電腦也看得到。
import { h, modal, toast, fileToDataUrl } from './ui.js';
import { LS } from './store.js';
import { FsaAdapter, NeuAdapter, mimeOf } from './backends/fs.js';
import { isImageName } from './image-list.js';

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

export function pickImage(store, { multiple = false } = {}) {
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
    const fileInput = h('input', { type: 'file', accept: 'image/*', multiple, style: { display: 'none' } });
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

    // 把選好的圖片變成參照（這台電腦的檔案先複製進白板資料夾）
    async function toRef(it) {
      if (!it.local) return { kind: 'file', base: 'root', path: it.path, name: it.name };
      const blob = it.file || (await it.fs.readBlob(it.path));
      if (!blob) throw new Error(`讀不到「${it.name}」`);
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
          if (copying) toast(items.length > 1 ? `複製圖片中… ${i + 1} / ${items.length}` : '複製圖片中…');
          refs.push(await toRef(items[i]));
        }
        if (copying && be.canBrowse) toast(`已複製到 ${be.label} 的 media 資料夾`);
      } catch (e) {
        toast('加入失敗：' + e.message);
        if (!refs.length) { busy = false; return; }
      }
      result = multiple ? refs : refs[0];
      m.close();
    }

    function updateFoot() {
      if (!multiple) return;
      count.textContent = picked.size ? `已選 ${picked.size} 張` : shown.length ? '點圖片可以多選' : '';
      addBtn.textContent = picked.size ? `加入 ${picked.size} 張` : '加入';
      addBtn.disabled = !picked.size;
    }

    function itemFor(it, local) {
      const path = join(loc?.path ?? '', it.name);
      const k = keyOf(local, path);
      const img = h('img', { alt: '', draggable: 'false' });
      img._src = { fs: loc?.fs, path, local };
      io.observe(img);
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
        shown = all.filter((i) => !i.dir && isImageName(i.name)).sort(byName);
        list.innerHTML = '';
        for (const d of dirs) list.append(dirBtn('📁', d.name, () => go({ ...loc, path: join(loc.path, d.name) })));
        for (const it of shown) list.append(itemFor(it, local));
        if (!dirs.length && !shown.length) list.append(h('div', { class: 'fp-empty' }, '這個資料夾沒有圖片'));
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
          const p = await window.Neutralino.os.showFolderDialog('選擇圖片所在的資料夾').catch(() => '');
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
      hint.textContent = id === 'local' && be.canBrowse ? `選好的圖片會複製一份到 ${be.label} 的 media 資料夾，換到其他電腦也看得到。` : '';
      tabBar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
      go(id === 'store' ? { path: '' } : null);
    }

    fileInput.addEventListener('change', () => {
      const files = [...fileInput.files];
      fileInput.value = '';
      if (files.length) finish(files.map((f) => ({ local: true, file: f, name: f.name })));
    });

    for (const t of tabs) tabBar.append(h('button', { 'data-tab': t.id, onclick: () => setTab(t.id) }, t.label));
    const urlInput = h('input', { class: 'input', placeholder: 'https://… 圖片網址' });
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
      tabs.length ? [crumbs, list] : h('p', { class: 'muted' }, '可以按「📤 選擇檔案」從這台電腦挑選圖片；改用網路磁碟機儲存後，也能直接選用個人資料夾裡的圖片。'),
      hint,
      h('div', { class: 'fp-bar' }, urlInput, h('button', { class: 'btn', onclick: useUrl }, '使用網址')),
      multiple ? h('div', { class: 'fp-foot' }, count, h('span', { class: 'fp-spacer' }), addBtn) : '');

    m = modal({
      title: multiple ? '加入圖片' : '選擇圖片', body, wide: true,
      onClose: () => { io.disconnect(); urls.forEach((u) => URL.revokeObjectURL(u)); resolve(result); },
    });
    if (tab) setTab(tab);
    updateFoot();
  });
}
