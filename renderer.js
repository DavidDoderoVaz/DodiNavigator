'use strict';

const $ = (id) => document.getElementById(id);
const browserApi = window.api;
const BASE = new URL('./', location.href).href;
const PAGES = { newtab: 'newtab.html', history: 'history.html', downloads: 'downloads.html', settings: 'settings.html' };
const ALIASES = { history: 'history', historial: 'history', downloads: 'downloads', descargas: 'downloads', settings: 'settings', ajustes: 'settings' };
const ICONS = {
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  forward: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  reload: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
  stop: '<path d="M6 6l12 12M18 6L6 18"/>',
  home: '<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  side: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  up: '<path d="M18 15l-6-6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>'
};
const svg = (name, size) => '<svg width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = svg(el.dataset.icon); });

const tabsEl = $('tabs');
const viewsEl = $('views');
const addr = $('addr');
const menuEl = $('menu');
const findbar = $('findbar');
const findInput = $('find-input');
const findCount = $('find-count');
const side = $('side');
const notesEl = $('notes');

let settings = { searchUrl: 'https://duckduckgo.com/?q=%s', homepage: '', restoreSession: true, translateTo: 'es' };
let bookmarks = [];
const tabs = [];
const closed = [];
let active = null;
let nextId = 1;
let dragId = null;

/* ---------- utilidades ---------- */

const safe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };
const current = () => tabs.find((t) => t.id === active);
const pageUrl = (name) => BASE + PAGES[name];

function internalName(url) {
  if (!url || !url.startsWith(BASE)) return null;
  const f = url.slice(BASE.length).split(/[?#]/)[0];
  return Object.keys(PAGES).find((k) => PAGES[k] === f) || null;
}
function displayUrl(url) {
  const n = internalName(url);
  if (n === 'newtab') return '';
  return n ? 'dodi://' + n : url;
}
function normalize(input) {
  const t = input.trim();
  if (!t) return pageUrl('newtab');
  const d = t.match(/^dodi:\/\/([a-z]+)\/?$/i);
  if (d && ALIASES[d[1].toLowerCase()]) return pageUrl(ALIASES[d[1].toLowerCase()]);
  if (/^https?:\/\//i.test(t)) return t;
  if (/^localhost(:\d+)?([/?#].*)?$/i.test(t)) return 'http://' + t;
  if (!/\s/.test(t) && /^[^\s/]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(t)) return 'https://' + t;
  return settings.searchUrl.replace('%s', encodeURIComponent(t));
}
const homeUrl = () => (settings.homepage ? normalize(settings.homepage) : pageUrl('newtab'));
const allowedUrl = (u) => typeof u === 'string' && (/^https?:\/\//i.test(u) || !!internalName(u));

function navigate(url, tab) {
  const t = tab || current();
  if (!t) return;
  try { t.wv.loadURL(url); } catch (e) { t.wv.src = url; }
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

/* ---------- pestañas ---------- */

function sortPinned() { tabs.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)); }

function createTab(opts) {
  const o = opts || {};
  const id = nextId++;
  const wv = document.createElement('webview');
  const profile = o.profile || settings.activeProfile || 'personal';
  const profileSlug = String(profile).toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'personal';
  const partition = o.private ? 'dodi-private' : (profileSlug === 'personal' ? 'persist:dodi' : 'persist:dodi-profile-' + profileSlug);
  wv.setAttribute('partition', partition);
  wv.setAttribute('allowpopups', '');
  const tab = { id, wv, url: o.url || pageUrl('newtab'), title: 'Nueva pestaña', favicon: null, loading: false, private: !!o.private, pinned: !!o.pinned, profile, group: o.group || '', zoom: 0 };

  wv.addEventListener('dom-ready', () => {
    if (tab.id === active && internalName(tab.url) === 'newtab') safe(() => wv.focus());
    updateToolbar();
  });
  wv.addEventListener('focus', hideMenu);
  wv.addEventListener('page-title-updated', (e) => { tab.title = e.title; renderTabs(); });
  wv.addEventListener('page-favicon-updated', (e) => { tab.favicon = e.favicons[0] || null; renderTabs(); });
  wv.addEventListener('did-start-loading', () => { tab.loading = true; renderTabs(); updateToolbar(); });
  wv.addEventListener('did-stop-loading', () => { tab.loading = false; renderTabs(); updateToolbar(); });
  const onNav = (e) => {
    if (e.isMainFrame === false) return;
    tab.url = e.url;
    if (internalName(e.url)) tab.favicon = null;
    renderTabs(); updateToolbar(); scheduleSave();
  };
  wv.addEventListener('did-navigate', onNav);
  wv.addEventListener('did-navigate-in-page', onNav);
  wv.addEventListener('did-fail-load', (e) => {
    if (e.isMainFrame && e.errorCode !== -3) {
      tab.title = 'No se pudo cargar la página'; renderTabs();
      if (e.errorCode >= -215 && e.errorCode <= -200) toast('Conexión bloqueada: no se pudo verificar el certificado de seguridad del sitio.');
    }
  });
  wv.addEventListener('found-in-page', (e) => {
    if (tab.id !== active) return;
    const r = e.result;
    findCount.textContent = r.matches > 0 ? r.activeMatchOrdinal + ' de ' + r.matches : 'Sin resultados';
  });

  tabs.push(tab);
  sortPinned();
  viewsEl.appendChild(wv);
  wv.src = tab.url;
  if (o.background) renderTabs(); else activate(id);
  scheduleSave();
  return tab;
}

function activate(id) {
  closeFind();
  active = id;
  tabs.forEach((t) => t.wv.classList.toggle('hidden', t.id !== id));
  renderTabs();
  updateToolbar();
  scheduleSave();
}

function closeTab(id) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const tab = tabs[idx];
  if (!tab.private && !internalName(tab.url)) { closed.push({ url: tab.url, pinned: tab.pinned }); if (closed.length > 20) closed.shift(); }
  tabs.splice(idx, 1);
  tab.wv.remove();
  if (tab.private && !tabs.some((t) => t.private)) browserApi.privateClosed();
  if (!tabs.length) createTab();
  else if (active === id) activate(tabs[Math.min(idx, tabs.length - 1)].id);
  else renderTabs();
  scheduleSave();
}

function closeOthers(id) {
  tabs.filter((t) => t.id !== id && !t.pinned).forEach((t) => closeTab(t.id));
}

function cycleTab(dir) {
  const idx = tabs.findIndex((t) => t.id === active);
  activate(tabs[(idx + dir + tabs.length) % tabs.length].id);
}

function moveTab(fromId, toId) {
  if (fromId === toId) return;
  const from = tabs.findIndex((t) => t.id === fromId);
  const to = tabs.findIndex((t) => t.id === toId);
  if (from < 0 || to < 0) return;
  const [t] = tabs.splice(from, 1);
  tabs.splice(to, 0, t);
  sortPinned();
  renderTabs();
  scheduleSave();
}

function openInternal(name) {
  const existing = tabs.find((t) => !t.private && internalName(t.url) === name);
  if (existing) { activate(existing.id); return; }
  const cur = current();
  if (cur && internalName(cur.url) === 'newtab') navigate(pageUrl(name)); else createTab({ url: pageUrl(name) });
}

function tabMenu(t) {
  const groups = [...new Set(tabs.map((x) => x.group).filter(Boolean))];
  return [
    { label: t.pinned ? 'Desfijar pestaña' : 'Fijar pestaña', run: () => { t.pinned = !t.pinned; sortPinned(); renderTabs(); scheduleSave(); } },
    { label: 'Duplicar pestaña', run: () => createTab({ url: t.url, private: t.private, profile: t.profile, group: t.group }) },
    { label: t.group ? 'Cambiar grupo…' : 'Crear grupo…', run: () => {
      const name = prompt('Nombre del grupo de pestañas:', t.group || '');
      if (name && name.trim()) { t.group = name.trim().slice(0, 24); renderTabs(); scheduleSave(); }
    } },
    ...(t.group ? [{ label: 'Quitar del grupo', run: () => { t.group = ''; renderTabs(); scheduleSave(); } }] : []),
    ...groups.filter((g) => g !== t.group).map((g) => ({ label: 'Mover a: ' + g, run: () => { t.group = g; renderTabs(); scheduleSave(); } })),
    '-',
    { label: 'Cerrar pestaña', hint: 'Ctrl+W', run: () => closeTab(t.id) },
    { label: 'Cerrar las demás', disabled: tabs.length < 2, run: () => closeOthers(t.id) }
  ];
}

function renderTabs() {
  if (dragId !== null) return;
  tabsEl.textContent = '';
  tabs.forEach((t) => {
    const el = document.createElement('div');
    el.className = 'tab' + (t.id === active ? ' active' : '') + (t.loading ? ' loading' : '') + (t.private ? ' private' : '') + (t.pinned ? ' pinned' : '');
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', String(t.id === active));
    el.tabIndex = 0;
    el.draggable = true;
    el.title = t.title + (t.private ? ' (privada)' : '');
    if (t.group) { el.style.borderTop = '3px solid ' + groupColor(t.group); el.title = '[' + t.group + '] ' + el.title; }
    el.addEventListener('click', () => activate(t.id));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(t.id); } });
    el.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(t.id); });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); showMenu(tabMenu(t), e.clientX, e.clientY); });
    el.addEventListener('dragstart', (e) => { dragId = t.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(t.id)); });
    el.addEventListener('dragover', (e) => { if (dragId !== null) { e.preventDefault(); el.classList.add('over'); } });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', (e) => { e.preventDefault(); const from = dragId; dragId = null; moveTab(from, t.id); });
    el.addEventListener('dragend', () => { dragId = null; renderTabs(); });

    let lead;
    if (t.private) { lead = document.createElement('span'); lead.className = 'lock'; lead.innerHTML = svg('lock', 14); }
    else if (t.favicon) { lead = document.createElement('img'); lead.className = 'fav'; lead.alt = ''; lead.src = t.favicon; }
    else { lead = document.createElement('span'); lead.className = 'fav'; }

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = t.title || t.url;

    const close = document.createElement('button');
    close.className = 'close';
    close.setAttribute('aria-label', 'Cerrar pestaña');
    close.textContent = '×';
    close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(t.id); });

    if (t.group) { const badge = document.createElement('span'); badge.className = 'group-tag'; badge.textContent = t.group; el.appendChild(badge); }
    el.append(lead, title, close);
    tabsEl.appendChild(el);
  });
}

function groupColor(name) {
  const colors = ['#3DDBB0', '#6AA9FF', '#FF9F5A', '#C792EA', '#F2C94C', '#FF7B91'];
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

/* ---------- sesión (restaurar pestañas) ---------- */

let saveTimer;
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveSession, 500); }
function saveSession() {
  const list = tabs.filter((t) => !t.private && internalName(t.url) !== 'newtab').map((t) => ({ url: t.url, pinned: t.pinned, profile: t.profile, group: t.group }));
  const cur = current();
  const idx = cur && !cur.private ? list.findIndex((x) => x.url === cur.url) : -1;
  browserApi.storeSet('session', { tabs: list, active: idx });
}

/* ---------- barra de herramientas ---------- */

function updateToolbar() {
  const tab = current();
  if (!tab) return;
  if (document.activeElement !== addr) addr.value = displayUrl(tab.url);
  const internal = !!internalName(tab.url);
  $('back').disabled = !safe(() => tab.wv.canGoBack(), false);
  $('forward').disabled = !safe(() => tab.wv.canGoForward(), false);
  $('star').disabled = internal;
  $('star').classList.toggle('on', bookmarks.some((b) => b.url === tab.url));
  $('reload').setAttribute('aria-label', tab.loading ? 'Detener' : 'Recargar');
  $('reload').innerHTML = svg(tab.loading ? 'stop' : 'reload');
  document.body.classList.toggle('private-mode', tab.private);
}

$('back').addEventListener('click', () => commands.back());
$('forward').addEventListener('click', () => commands.forward());
$('reload').addEventListener('click', () => { const t = current(); if (t && t.loading) safe(() => t.wv.stop()); else commands.reload(); });
$('home').addEventListener('click', () => commands.home());
$('newtab').addEventListener('click', () => createTab());
$('downloads').addEventListener('click', () => openInternal('downloads'));
$('sidebtn').addEventListener('click', () => commands.side());
$('side-close').addEventListener('click', () => toggleSide(false));
$('more').addEventListener('click', () => {
  const r = $('more').getBoundingClientRect();
  showMenu(mainMenu(), r.right - 250, r.bottom + 4);
});

addr.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { navigate(normalize(addr.value)); const t = current(); if (t) safe(() => t.wv.focus()); }
  if (e.key === 'Escape') { addr.blur(); updateToolbar(); }
});
addr.addEventListener('focus', () => addr.select());
addr.addEventListener('blur', updateToolbar);

/* ---------- menús emergentes ---------- */

function showMenu(items, x, y) {
  menuEl.textContent = '';
  items.forEach((it) => {
    if (it === '-') { const hr = document.createElement('div'); hr.className = 'sep'; hr.setAttribute('role', 'separator'); menuEl.appendChild(hr); return; }
    const b = document.createElement('button');
    b.className = 'mi';
    b.setAttribute('role', 'menuitem');
    b.disabled = !!it.disabled;
    const l = document.createElement('span');
    l.textContent = it.label;
    b.appendChild(l);
    if (it.hint) { const k = document.createElement('kbd'); k.textContent = it.hint; b.appendChild(k); }
    b.addEventListener('click', () => { hideMenu(); it.run(); });
    menuEl.appendChild(b);
  });
  menuEl.hidden = false;
  menuEl.style.left = Math.max(4, Math.min(x, innerWidth - menuEl.offsetWidth - 4)) + 'px';
  menuEl.style.top = Math.max(4, Math.min(y, innerHeight - menuEl.offsetHeight - 4)) + 'px';
  const first = menuEl.querySelector('button:not(:disabled)');
  if (first) first.focus();
}
function hideMenu() { menuEl.hidden = true; }
document.addEventListener('mousedown', (e) => { if (!menuEl.hidden && !menuEl.contains(e.target)) hideMenu(); });
menuEl.addEventListener('keydown', (e) => {
  const btns = Array.from(menuEl.querySelectorAll('button:not(:disabled)'));
  const i = btns.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
  if (e.key === 'Escape') hideMenu();
});

function mainMenu() {
  const run = (c) => () => commands[c]();
  return [
    { label: 'Nueva pestaña', hint: 'Ctrl+T', run: run('new-tab') },
    { label: 'Nueva pestaña privada', hint: 'Ctrl+Shift+N', run: run('new-private-tab') },
    '-',
    { label: 'Historial', hint: 'Ctrl+H', run: run('history') },
    { label: 'Descargas', hint: 'Ctrl+J', run: run('downloads') },
    { label: 'Favoritos y notas', hint: 'Ctrl+B', run: run('side') },
    '-',
    { label: 'Buscar en la página', hint: 'Ctrl+F', run: run('find') },
    { label: 'Acercar', hint: 'Ctrl++', run: run('zoom-in') },
    { label: 'Alejar', hint: 'Ctrl+-', run: run('zoom-out') },
    { label: 'Tamaño normal', hint: 'Ctrl+0', run: run('zoom-reset') },
    { label: 'Modo lectura', hint: 'Ctrl+Alt+R', run: run('reader') },
    { label: 'Traducir página', hint: 'Ctrl+Alt+T', run: run('translate') },
    '-',
    { label: 'Herramientas de desarrollo', hint: 'F12', run: run('devtools') },
    { label: 'Ajustes', hint: 'Ctrl+,', run: run('settings') }
  ];
}

/* ---------- buscar en la página ---------- */

function openFind() { findbar.hidden = false; findInput.focus(); findInput.select(); }
function closeFind() {
  if (findbar.hidden) return;
  findbar.hidden = true;
  findCount.textContent = '';
  const t = current();
  if (t) safe(() => t.wv.stopFindInPage('clearSelection'));
}
function doFind(forward, newSession) {
  const t = current();
  if (!t) return;
  if (!findInput.value) { safe(() => t.wv.stopFindInPage('clearSelection')); findCount.textContent = ''; return; }
  safe(() => t.wv.findInPage(findInput.value, { forward, findNext: newSession }));
}
findInput.addEventListener('input', () => doFind(true, true));
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doFind(!e.shiftKey, false);
  if (e.key === 'Escape') closeFind();
});
$('find-next').addEventListener('click', () => doFind(true, false));
$('find-prev').addEventListener('click', () => doFind(false, false));
$('find-close').addEventListener('click', closeFind);

/* ---------- zoom, lectura, traducción ---------- */

function zoom(delta) {
  const t = current();
  if (!t) return;
  t.zoom = delta === 0 ? 0 : Math.max(-3, Math.min(5, t.zoom + delta));
  safe(() => t.wv.setZoomLevel(t.zoom));
  toast('Zoom: ' + Math.round(Math.pow(1.2, t.zoom) * 100) + '%');
}

// Esta función se inyecta dentro de la página (por eso es autocontenida).
function readerToggle() {
  var id = '__dodi_reader';
  var old = document.getElementById(id);
  if (old) { old.remove(); document.documentElement.style.overflow = ''; return 'closed'; }
  function score(el) {
    var n = 0, ps = el.querySelectorAll(':scope > p, :scope > div > p');
    for (var i = 0; i < ps.length; i++) n += Math.min(ps[i].textContent.length, 300);
    return n;
  }
  var best = document.querySelector('article') || document.querySelector('main');
  if (!best || score(best) < 200) {
    var max = 0, cands = document.querySelectorAll('div,section,article,main');
    for (var c = 0; c < cands.length; c++) { var s = score(cands[c]); if (s > max) { max = s; best = cands[c]; } }
  }
  if (!best) return 'none';
  var h1 = document.querySelector('h1');
  var title = ((h1 && h1.textContent) || document.title || '').trim();
  var wrap = document.createElement('div');
  wrap.id = id;
  wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;overflow:auto;background:#F7F5F0;color:#1b1b1b;font:20px/1.7 Georgia,serif;';
  var inner = document.createElement('div');
  inner.style.cssText = 'max-width:720px;margin:0 auto;padding:64px 24px 120px;';
  function close() { wrap.remove(); document.documentElement.style.overflow = ''; document.removeEventListener('keydown', onKey, true); }
  function onKey(e) { if (e.key === 'Escape') close(); }
  var btn = document.createElement('button');
  btn.textContent = 'Cerrar modo lectura';
  btn.style.cssText = 'position:fixed;top:16px;right:16px;padding:8px 14px;border:1px solid #aaa;border-radius:8px;background:#fff;color:#111;font:14px system-ui,sans-serif;cursor:pointer;';
  btn.onclick = close;
  var h = document.createElement('h1');
  h.textContent = title;
  h.style.cssText = 'font:700 36px/1.2 system-ui,sans-serif;margin:0 0 32px;color:#111;';
  inner.appendChild(h);
  var nodes = best.querySelectorAll('h2,h3,p,li,pre,img');
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i], tag = el.tagName, node;
    if (tag === 'IMG') {
      var src = el.currentSrc || el.src;
      if (!src || el.width < 200) continue;
      node = document.createElement('img');
      node.src = src;
      node.style.cssText = 'max-width:100%;height:auto;display:block;margin:20px 0;';
    } else {
      var txt = el.textContent.trim();
      if (txt.length < 2) continue;
      if (tag === 'H2' || tag === 'H3') {
        node = document.createElement('h2');
        node.style.cssText = 'font:700 26px/1.3 system-ui,sans-serif;margin:36px 0 12px;color:#111;';
      } else {
        node = document.createElement('p');
        node.style.cssText = 'margin:0 0 20px;' + (tag === 'PRE' ? 'font:15px/1.5 monospace;white-space:pre-wrap;' : '');
      }
      node.textContent = txt;
    }
    inner.appendChild(node);
  }
  wrap.appendChild(btn);
  wrap.appendChild(inner);
  document.body.appendChild(wrap);
  document.documentElement.style.overflow = 'hidden';
  document.addEventListener('keydown', onKey, true);
  return 'opened';
}

/* ---------- favoritos y panel lateral ---------- */

function saveBookmarks() { browserApi.storeSet('bookmarks', bookmarks); }
function removeBookmark(url) { bookmarks = bookmarks.filter((b) => b.url !== url); saveBookmarks(); renderBookmarks(); updateToolbar(); }

function renderBookmarks() {
  const bar = $('bookmarks');
  const list = $('fav-list');
  bar.textContent = '';
  list.textContent = '';
  bar.classList.toggle('has', bookmarks.length > 0);
  $('fav-empty').hidden = bookmarks.length > 0;
  bookmarks.forEach((b) => {
    const btn = document.createElement('button');
    btn.className = 'bm';
    btn.textContent = b.title;
    btn.title = b.url + '\n(clic derecho para quitar)';
    btn.addEventListener('click', () => navigate(b.url));
    btn.addEventListener('contextmenu', (e) => { e.preventDefault(); removeBookmark(b.url); });
    bar.appendChild(btn);

    const li = document.createElement('li');
    const open = document.createElement('button');
    open.className = 'fav-open';
    open.textContent = b.title;
    open.title = b.url;
    open.addEventListener('click', () => navigate(b.url));
    const rm = document.createElement('button');
    rm.className = 'fav-rm';
    rm.textContent = '×';
    rm.setAttribute('aria-label', 'Quitar ' + b.title);
    rm.addEventListener('click', () => removeBookmark(b.url));
    li.append(open, rm);
    list.appendChild(li);
  });
}

$('star').addEventListener('click', () => {
  const t = current();
  if (!t || internalName(t.url)) return;
  if (bookmarks.some((b) => b.url === t.url)) bookmarks = bookmarks.filter((b) => b.url !== t.url);
  else bookmarks.push({ title: t.title || t.url, url: t.url });
  saveBookmarks(); renderBookmarks(); updateToolbar();
});

function toggleSide(show) {
  side.hidden = show === undefined ? !side.hidden : !show;
  $('sidebtn').classList.toggle('on', !side.hidden);
}
document.querySelectorAll('.seg').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.seg').forEach((x) => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', String(on)); });
  $('pane-fav').hidden = b.dataset.pane !== 'fav';
  $('pane-notes').hidden = b.dataset.pane !== 'notes';
  if (b.dataset.pane === 'notes') notesEl.focus();
}));
let notesTimer;
notesEl.addEventListener('input', () => { clearTimeout(notesTimer); notesTimer = setTimeout(() => browserApi.storeSet('notes', notesEl.value), 500); });

/* ---------- comandos (menú, atajos y botones) ---------- */

const commands = {
  'new-tab': () => createTab(),
  'new-private-tab': () => createTab({ private: true }),
  'reopen-tab': () => { const c = closed.pop(); if (c) createTab(c); },
  'open-url': (a) => { if (a && /^https?:\/\//i.test(a.url)) createTab({ url: a.url, private: !!a.private }); },
  'close-tab': () => { const t = current(); if (t) closeTab(t.id); },
  'focus-address': () => addr.focus(),
  reload: () => { const t = current(); if (t) safe(() => t.wv.reload()); },
  back: () => { const t = current(); if (t) safe(() => t.wv.goBack()); },
  forward: () => { const t = current(); if (t) safe(() => t.wv.goForward()); },
  home: () => navigate(homeUrl()),
  'next-tab': () => cycleTab(1),
  'prev-tab': () => cycleTab(-1),
  find: openFind,
  'zoom-in': () => zoom(0.5),
  'zoom-out': () => zoom(-0.5),
  'zoom-reset': () => zoom(0),
  side: () => toggleSide(),
  history: () => openInternal('history'),
  downloads: () => openInternal('downloads'),
  settings: () => openInternal('settings'),
  devtools: () => { const t = current(); if (t) safe(() => t.wv.openDevTools()); },
  reader: () => {
    const t = current();
    if (!t || internalName(t.url)) return;
    safe(() => t.wv.executeJavaScript('(' + readerToggle.toString() + ')()'));
  },
  translate: () => {
    const t = current();
    if (!t || !/^https?:\/\//i.test(t.url)) { toast('Esta página no se puede traducir.'); return; }
    navigate('https://translate.google.com/translate?sl=auto&tl=' + encodeURIComponent(settings.translateTo || 'es') + '&u=' + encodeURIComponent(t.url));
  }
};
browserApi.onCommand((cmd, arg) => { const f = commands[cmd]; if (f) f(arg); });

/* ---------- arranque ---------- */

(async function init() {
  const [s, bm, notes, session, dls] = await Promise.all([
    browserApi.getSettings(), browserApi.storeGet('bookmarks'), browserApi.storeGet('notes'), browserApi.storeGet('session'), browserApi.getDownloads()
  ]);
  settings = s || settings;
  bookmarks = Array.isArray(bm) ? bm : [];
  if (!bookmarks.length) { // migrar favoritos de la versión 1.0
    try { const old = JSON.parse(localStorage.getItem('dodi.bookmarks') || '[]'); if (Array.isArray(old)) { bookmarks = old; saveBookmarks(); } } catch (e) { /* nada */ }
  }
  notesEl.value = typeof notes === 'string' ? notes : '';
  renderBookmarks();

  const lastState = new Map((dls || []).map((d) => [d.id, d.state]));
  browserApi.onSettings((n) => { settings = n; });
  browserApi.onDownloads((list) => {
    let busy = false;
    list.forEach((d) => {
      if (d.state === 'progressing' || d.state === 'paused') busy = true;
      const prev = lastState.get(d.id);
      if (prev && prev !== 'completed' && d.state === 'completed') toast('Descarga completa: ' + d.name);
      lastState.set(d.id, d.state);
    });
    $('downloads').classList.toggle('busy', busy);
  });

  let restored = false;
  if (settings.restoreSession && session && Array.isArray(session.tabs) && session.tabs.length) {
    session.tabs.filter((x) => x && allowedUrl(x.url)).forEach((x) => createTab({ url: x.url, pinned: !!x.pinned, profile: x.profile, group: x.group, background: true }));
    if (tabs.length) { activate((tabs[session.active] || tabs[tabs.length - 1]).id); restored = true; }
  }
  if (!restored) createTab();
})();
