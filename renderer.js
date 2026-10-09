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
  plus: '<path d="M12 5v14M5 12h14"/>',
  sparkles: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 16l1 2.5 2.5 1-2.5 1L19 23l-1-2.5-2.5-1 2.5-1L19 16Z"/>'
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
const workspaceSelect = $('workspace-select');
const workspaceListEl = $('workspace-list');
let workspaces = [];
let activeWorkspaceId = 'personal';

let settings = { searchUrl: 'https://duckduckgo.com/?q=%s', homepage: '', restoreSession: true, translateTo: 'es', suspendInactiveTabsMinutes: 0 };
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
  const tab = { id, wv, url: o.url || pageUrl('newtab'), title: 'Nueva pestaña', favicon: null, loading: false, loaded: !o.background, suspended: false, lastActiveAt: Date.now(), private: !!o.private, pinned: !!o.pinned, profile, group: o.group || '', zoom: 0 };

  wv.addEventListener('dom-ready', () => {
    if (tab.id === active && internalName(tab.url) === 'newtab') safe(() => wv.focus());
    updateToolbar();
  });
  wv.addEventListener('focus', hideMenu);
  wv.addEventListener('page-title-updated', (e) => { if (tab.suspended) return; tab.title = e.title; renderTabs(); });
  wv.addEventListener('page-favicon-updated', (e) => { if (tab.suspended) return; tab.favicon = e.favicons[0] || null; renderTabs(); });
  wv.addEventListener('did-start-loading', () => { if (tab.suspended) return; tab.loading = true; renderTabs(); updateToolbar(); });
  wv.addEventListener('did-stop-loading', () => { if (tab.suspended) return; tab.loading = false; renderTabs(); updateToolbar(); });
  const onNav = (e) => {
    if (tab.suspended) return;
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
  if (!o.background) wv.src = tab.url;
  if (o.background) renderTabs(); else activate(id);
  scheduleSave();
  return tab;
}

function activate(id) {
  closeFind();
  const previous = current();
  if (previous && previous.id !== id) previous.lastActiveAt = Date.now();
  active = id;
  tabs.forEach((t) => t.wv.classList.toggle('hidden', t.id !== id));
  const tab = current();
  if (tab) tab.lastActiveAt = Date.now();
  if (tab && (!tab.loaded || tab.suspended)) {
    tab.suspended = false;
    tab.loaded = true;
    tab.wv.src = tab.url;
  }
  renderTabs();
  revealActiveTab();
  updateToolbar();
  scheduleSave();
}

setInterval(() => {
  const minutes = Number(settings.suspendInactiveTabsMinutes) || 0;
  if (!minutes) return;
  const cutoff = Date.now() - minutes * 60 * 1000;
  let changed = false;
  tabs.forEach((tab) => {
    if (tab.id === active || tab.pinned || tab.private || !tab.loaded || tab.suspended || tab.loading || internalName(tab.url)) return;
    if (tab.lastActiveAt > cutoff || safe(() => tab.wv.isCurrentlyAudible(), false)) return;
    const currentUrl = safe(() => tab.wv.getURL(), tab.url);
    if (/^https?:/i.test(currentUrl)) tab.url = currentUrl;
    tab.suspended = true;
    tab.loaded = false;
    tab.wv.src = 'about:blank';
    changed = true;
  });
  if (changed) renderTabs();
}, 60000);

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
  const previousScrollLeft = tabsEl.scrollLeft;
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
  tabsEl.scrollLeft = previousScrollLeft;
}

function revealActiveTab() {
  requestAnimationFrame(() => {
    const activeEl = tabsEl.querySelector('.tab.active');
    if (!activeEl) return;
    const tabRect = activeEl.getBoundingClientRect();
    const stripRect = tabsEl.getBoundingClientRect();
    const visibleRight = stripRect.left + tabsEl.clientWidth;
    if (tabRect.left < stripRect.left) tabsEl.scrollLeft -= stripRect.left - tabRect.left;
    else if (tabRect.right > visibleRight) tabsEl.scrollLeft += tabRect.right - visibleRight;
  });
}

tabsEl.addEventListener('wheel', (event) => {
  if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
    tabsEl.scrollLeft += event.deltaY;
    event.preventDefault();
  }
}, { passive: false });

function groupColor(name) {
  const colors = ['#3DDBB0', '#6AA9FF', '#FF9F5A', '#C792EA', '#F2C94C', '#FF7B91'];
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

/* ---------- sesión (restaurar pestañas) ---------- */

let saveTimer;
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveSession, 500); }
function workspaceTabsSnapshot() {
  const candidates = tabs.filter((tab) => !tab.private && (/^https?:\/\//i.test(tab.url) || internalName(tab.url) === 'newtab'));
  const list = candidates.map((tab) => ({ url: internalName(tab.url) === 'newtab' ? '' : tab.url, pinned: tab.pinned, profile: tab.profile, group: tab.group }));
  const activeTab = current();
  return { tabs: list, active: activeTab ? candidates.findIndex((tab) => tab.id === activeTab.id) : -1 };
}
function saveSession() {
  const list = tabs.filter((t) => !t.private && internalName(t.url) !== 'newtab').map((t) => ({ url: t.url, pinned: t.pinned, profile: t.profile, group: t.group }));
  const cur = current();
  const idx = cur && !cur.private ? list.findIndex((x) => x.url === cur.url) : -1;
  browserApi.storeSet('session', { tabs: list, active: idx });
  const workspace = workspaces.find((item) => item.id === activeWorkspaceId);
  if (workspace) {
    Object.assign(workspace, workspaceTabsSnapshot());
    workspace.profile = settings.activeProfile || workspace.profile || 'personal';
    browserApi.storeSet('workspaces', workspaces);
    browserApi.storeSet('activeWorkspace', activeWorkspaceId);
    renderWorkspaceUI();
  }
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
    { label: 'Guardar página como PDF', hint: 'Ctrl+Shift+P', run: run('save-pdf') },
    { label: 'Capturar página', hint: 'Ctrl+Shift+S', run: run('capture-page') },
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

const tabPicker = $('tab-picker');
const tabPickerInput = $('tab-picker-input');
const tabPickerResults = $('tab-picker-results');
let tabPickerSelection = 0;
function renderTabPicker() {
  const query = tabPickerInput.value.trim().toLocaleLowerCase();
  const matches = tabs.filter((tab) => !query || (tab.title + ' ' + tab.url).toLocaleLowerCase().includes(query)).slice(0, 80);
  tabPickerSelection = Math.min(tabPickerSelection, Math.max(0, matches.length - 1));
  tabPickerResults.textContent = '';
  if (!matches.length) {
    const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'No se encontraron pestañas.';
    tabPickerResults.appendChild(empty); return;
  }
  matches.forEach((tab, index) => {
    const row = document.createElement('button'); row.type = 'button'; row.className = 'tab-result' + (index === tabPickerSelection ? ' selected' : '');
    row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(index === tabPickerSelection));
    const title = document.createElement('span'); title.className = 'result-title'; title.textContent = tab.title || 'Nueva pestaña';
    const url = document.createElement('span'); url.className = 'result-url'; url.textContent = tab.url;
    row.append(title, url);
    row.addEventListener('click', () => { closeTabPicker(); activate(tab.id); });
    tabPickerResults.appendChild(row);
  });
}
function openTabSearch() {
  tabPicker.hidden = false; tabPickerInput.value = ''; tabPickerSelection = 0;
  renderTabPicker(); tabPickerInput.focus();
}
function closeTabPicker() { tabPicker.hidden = true; }
tabPickerInput.addEventListener('input', () => { tabPickerSelection = 0; renderTabPicker(); });
tabPickerInput.addEventListener('keydown', (event) => {
  const count = tabPickerResults.querySelectorAll('.tab-result').length;
  if (event.key === 'Escape') { event.preventDefault(); closeTabPicker(); }
  else if (event.key === 'ArrowDown' && count) { event.preventDefault(); tabPickerSelection = (tabPickerSelection + 1) % count; renderTabPicker(); }
  else if (event.key === 'ArrowUp' && count) { event.preventDefault(); tabPickerSelection = (tabPickerSelection - 1 + count) % count; renderTabPicker(); }
  else if (event.key === 'Enter' && count) { event.preventDefault(); tabPickerResults.querySelectorAll('.tab-result')[tabPickerSelection].click(); }
});
tabPicker.addEventListener('mousedown', (event) => event.stopPropagation());
document.addEventListener('mousedown', (event) => { if (!tabPicker.hidden && !tabPicker.contains(event.target)) closeTabPicker(); });
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

function saveActivePage(format) {
  const tab = current();
  if (!tab || internalName(tab.url) || !/^https?:/i.test(tab.url)) { toast('Abre una página web para guardarla.'); return; }
  browserApi.exportPage(tab.wv.getWebContentsId(), format).then((result) => {
    if (result && result.ok) toast(format === 'pdf' ? 'PDF guardado.' : 'Captura guardada.');
    else if (result && !result.canceled) toast(result.message || 'No se pudo guardar.');
  }).catch(() => toast('No se pudo guardar la página.'));
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
function selectSidePane(name, showSide) {
  if (showSide !== false) toggleSide(true);
  document.querySelectorAll('.seg').forEach((button) => {
    const selected = button.dataset.pane === name;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
    $('pane-' + button.dataset.pane).hidden = !selected;
  });
  if (name === 'notes') notesEl.focus();
}
function safeWorkspaceProfile(profile) {
  return typeof profile === 'string' && /^[a-z0-9][a-z0-9 _-]{0,23}$/i.test(profile) ? profile : 'personal';
}
function normalizeWorkspaces(items, legacySession) {
  if (!Array.isArray(items)) items = [];
  const clean = items.slice(0, 30).flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const id = String(item.id || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
    const name = String(item.name || '').trim().slice(0, 32);
    if (!id || !name) return [];
    const savedTabs = Array.isArray(item.tabs) ? item.tabs.filter((tab) => tab && (tab.url === '' || /^https?:\/\//i.test(tab.url))).slice(0, 100).map((tab) => ({
      url: tab.url, pinned: !!tab.pinned, group: String(tab.group || '').slice(0, 24)
    })) : [];
    return [{ id, name, profile: safeWorkspaceProfile(item.profile), tabs: savedTabs, active: Math.max(0, Math.min(Number(item.active) || 0, Math.max(0, savedTabs.length - 1))) }];
  });
  if (!clean.length) {
    const oldTabs = legacySession && Array.isArray(legacySession.tabs) ? legacySession.tabs : [];
    clean.push({ id: 'personal', name: 'Personal', profile: safeWorkspaceProfile(settings.activeProfile), tabs: oldTabs.filter((tab) => tab && /^https?:\/\//i.test(tab.url)).slice(0, 100), active: Math.max(0, Number(legacySession && legacySession.active) || 0) });
  }
  return clean;
}
function renderWorkspaceUI() {
  if (!workspaceSelect || !workspaceListEl) return;
  workspaceSelect.textContent = '';
  workspaces.forEach((workspace) => {
    const option = document.createElement('option'); option.value = workspace.id; option.textContent = workspace.name;
    workspaceSelect.appendChild(option);
  });
  workspaceSelect.value = activeWorkspaceId;
  workspaceListEl.textContent = '';
  workspaces.forEach((workspace) => {
    const row = document.createElement('div'); row.className = 'workspace-row' + (workspace.id === activeWorkspaceId ? ' active' : '');
    const open = document.createElement('button'); open.type = 'button'; open.className = 'workspace-open';
    const name = document.createElement('strong'); name.textContent = workspace.name;
    const meta = document.createElement('small'); meta.textContent = `${workspace.tabs.length} pestaña${workspace.tabs.length === 1 ? '' : 's'} guardada${workspace.tabs.length === 1 ? '' : 's'}`;
    open.append(name, meta); open.addEventListener('click', () => switchWorkspace(workspace.id));
    const rename = document.createElement('button'); rename.type = 'button'; rename.className = 'workspace-mini'; rename.textContent = '✎'; rename.title = 'Renombrar espacio';
    rename.addEventListener('click', () => showWorkspaceForm('rename', workspace));
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'workspace-mini'; remove.textContent = '×'; remove.title = 'Eliminar espacio'; remove.disabled = workspaces.length < 2;
    remove.addEventListener('click', () => deleteWorkspace(workspace.id));
    row.append(open, rename, remove); workspaceListEl.appendChild(row);
  });
}
function showWorkspaceForm(mode, workspace) {
  const form = $('workspace-form');
  form.dataset.mode = mode;
  form.dataset.workspaceId = workspace ? workspace.id : '';
  $('workspace-name').value = workspace ? workspace.name : '';
  form.querySelector('button[type="submit"]').textContent = mode === 'rename' ? 'Guardar' : 'Crear';
  form.hidden = false; $('workspace-name').focus();
}
async function switchWorkspace(id, options) {
  const target = workspaces.find((workspace) => workspace.id === id);
  if (!target || target.id === activeWorkspaceId) return;
  if (!(options && options.skipSave)) saveSession();
  const hadPrivate = tabs.some((tab) => tab.private);
  tabs.forEach((tab) => tab.wv.remove());
  tabs.splice(0, tabs.length); active = null;
  if (hadPrivate) browserApi.privateClosed();
  activeWorkspaceId = target.id;
  try { settings = await browserApi.setSettings({ activeProfile: target.profile }); }
  catch { /* usar el perfil guardado si el cambio no responde */ }
  renderWorkspaceUI();
  const savedTabs = Array.isArray(target.tabs) ? target.tabs.filter((tab) => tab && (tab.url === '' || /^https?:\/\//i.test(tab.url))) : [];
  if (!savedTabs.length) createTab({ profile: target.profile });
  else {
    savedTabs.forEach((tab) => createTab({ url: tab.url || pageUrl('newtab'), pinned: !!tab.pinned, group: tab.group, profile: target.profile, background: true }));
    activate(tabs[Math.min(target.active || 0, tabs.length - 1)].id);
  }
  scheduleSave(); toast('Espacio abierto: ' + target.name);
}
function deleteWorkspace(id) {
  if (workspaces.length < 2) return;
  const wasActive = id === activeWorkspaceId;
  if (wasActive) saveSession();
  workspaces = workspaces.filter((workspace) => workspace.id !== id);
  browserApi.storeSet('workspaces', workspaces);
  if (wasActive) switchWorkspace(workspaces[0].id, { skipSave: true });
  renderWorkspaceUI();
}
$('workspace-select').addEventListener('change', () => switchWorkspace(workspaceSelect.value));
$('workspace-add').addEventListener('click', () => { selectSidePane('workspaces'); showWorkspaceForm('create'); });
$('workspace-create').addEventListener('click', () => showWorkspaceForm('create'));
$('workspace-cancel').addEventListener('click', () => { $('workspace-form').hidden = true; });
$('workspace-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('workspace-name').value.trim().slice(0, 32);
  if (!name) { $('workspace-name').focus(); return; }
  const mode = $('workspace-form').dataset.mode;
  if (mode === 'rename') {
    const item = workspaces.find((workspace) => workspace.id === $('workspace-form').dataset.workspaceId);
    if (item) item.name = name;
  } else {
    const id = 'ws-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const profile = ('espacio-' + id.slice(3)).slice(0, 24);
    workspaces.push({ id, name, profile, tabs: [], active: 0 });
    const target = workspaces[workspaces.length - 1];
    browserApi.storeSet('workspaces', workspaces);
    $('workspace-form').hidden = true; $('workspace-name').value = '';
    renderWorkspaceUI(); switchWorkspace(target.id); return;
  }
  $('workspace-form').hidden = true; $('workspace-name').value = '';
  browserApi.storeSet('workspaces', workspaces); renderWorkspaceUI();
});
$('workspace-save').addEventListener('click', () => { saveSession(); toast('Pestañas guardadas en este espacio.'); });
document.querySelectorAll('.seg').forEach((button) => button.addEventListener('click', () => selectSidePane(button.dataset.pane, false)));
$('assistantbtn').addEventListener('click', () => selectSidePane('assistant'));
let notesTimer;
notesEl.addEventListener('input', () => { clearTimeout(notesTimer); notesTimer = setTimeout(() => browserApi.storeSet('notes', notesEl.value), 500); });
document.querySelectorAll('.seg').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.seg').forEach((x) => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', String(on)); });
  $('pane-fav').hidden = b.dataset.pane !== 'fav';
  $('pane-notes').hidden = b.dataset.pane !== 'notes';
  if (b.dataset.pane === 'notes') notesEl.focus();
}));
let notesTimer;
notesEl.addEventListener('input', () => { clearTimeout(notesTimer); notesTimer = setTimeout(() => browserApi.storeSet('notes', notesEl.value), 500); });

let assistantHistory = [];
let assistantReady = false;
function addAssistantMessage(text, kind) {
  const bubble = document.createElement('div'); bubble.className = 'assistant-message' + (kind ? ' ' + kind : '');
  bubble.textContent = text;
  $('assistant-chat').appendChild(bubble);
  $('assistant-chat').scrollTop = $('assistant-chat').scrollHeight;
  return bubble;
}
async function refreshAssistantStatus() {
  $('assistant-status').textContent = 'Comprobando IA local…';
  $('assistant-refresh').disabled = true;
  try {
    const status = await browserApi.assistantStatus();
    assistantReady = !!(status && status.available && status.installed);
    $('assistant-status').textContent = status && status.message || 'No se pudo consultar el asistente.';
    $('assistant-setup').hidden = assistantReady;
    $('assistant-setup').innerHTML = status && status.available
      ? `Para habilitarlo, descarga el modelo desde <a href="https://ollama.com/library/qwen2.5:1.5b-instruct" target="_blank" rel="noreferrer">Ollama</a> (aprox. 986 MB) y ejecuta <code>ollama run qwen2.5:1.5b-instruct</code>. Las respuestas se procesan en tu equipo.`
      : `Instala y abre <a href="https://ollama.com/download" target="_blank" rel="noreferrer">Ollama</a>. Después ejecuta <code>ollama run qwen2.5:1.5b-instruct</code> para descargar el modelo. Las respuestas se procesan en tu equipo.`;
    $('assistant-question').disabled = !assistantReady;
    $('assistant-send').disabled = !assistantReady;
    document.querySelectorAll('.assistant-quick button').forEach((button) => { button.disabled = !assistantReady; });
  } catch {
    assistantReady = false;
    $('assistant-status').textContent = 'No se pudo consultar la IA local.';
    $('assistant-setup').hidden = false;
    $('assistant-setup').textContent = 'Abre Ollama y pulsa Revisar para conectarlo.';
    $('assistant-question').disabled = true; $('assistant-send').disabled = true;
  } finally { $('assistant-refresh').disabled = false; }
}
async function askAssistant(question) {
  const text = String(question || '').trim().slice(0, 2000);
  if (!text) { $('assistant-question').focus(); return; }
  if (!assistantReady) { addAssistantMessage('Primero instala y abre Ollama, y descarga el modelo que aparece arriba.', 'error'); return; }
  $('assistant-question').value = '';
  addAssistantMessage(text, 'user');
  const contextRequested = $('assistant-page-context').checked;
  let pageText = '';
  if (contextRequested) {
    const tab = current();
    if (tab && /^https?:\/\//i.test(tab.url)) {
      try { pageText = await tab.wv.executeJavaScript('document.body ? document.body.innerText.slice(0, 10000) : ""'); }
      catch { addAssistantMessage('No pude leer el contenido de esa página. Puedes copiar el texto en tu pregunta.', 'error'); return; }
    } else { addAssistantMessage('Abre una página web para compartir su texto con el asistente.', 'error'); return; }
  }
  const pending = addAssistantMessage('Pensando…');
  $('assistant-send').disabled = true;
  try {
    const result = await browserApi.assistantAsk({ question: text, history: assistantHistory.slice(-8), pageText });
    pending.remove();
    if (!result || !result.ok) { addAssistantMessage(result && result.message || 'No se pudo obtener respuesta.', 'error'); return; }
    addAssistantMessage(result.answer, 'assistant');
    assistantHistory.push({ role: 'user', content: text }, { role: 'assistant', content: result.answer });
    if (assistantHistory.length > 16) assistantHistory = assistantHistory.slice(-16);
  } catch {
    pending.remove(); addAssistantMessage('No se pudo conectar con Ollama. Comprueba que siga abierto.', 'error');
  } finally { $('assistant-send').disabled = !assistantReady; }
}
$('assistant-refresh').addEventListener('click', refreshAssistantStatus);
$('assistant-form').addEventListener('submit', (event) => { event.preventDefault(); askAssistant($('assistant-question').value); });
document.querySelectorAll('.assistant-quick button').forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.needsPage === 'true') $('assistant-page-context').checked = true;
  askAssistant(button.dataset.assistantPrompt);
}));
refreshAssistantStatus();

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
  'tab-search': openTabSearch,
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
  'save-pdf': () => saveActivePage('pdf'),
  'capture-page': () => saveActivePage('png'),
  translate: () => {
    const t = current();
    if (!t || !/^https?:\/\//i.test(t.url)) { toast('Esta página no se puede traducir.'); return; }
    navigate('https://translate.google.com/translate?sl=auto&tl=' + encodeURIComponent(settings.translateTo || 'es') + '&u=' + encodeURIComponent(t.url));
  },
  'update-available': (version) => toast('Hay una actualización nueva (' + version + '). Revisa Ajustes > Actualizaciones.')
};
browserApi.onCommand((cmd, arg) => { const f = commands[cmd]; if (f) f(arg); });

/* ---------- arranque ---------- */

(async function init() {
  const [s, bm, notes, session, dls, savedWorkspaces, savedWorkspaceId] = await Promise.all([
    browserApi.getSettings(), browserApi.storeGet('bookmarks'), browserApi.storeGet('notes'), browserApi.storeGet('session'), browserApi.getDownloads(), browserApi.storeGet('workspaces'), browserApi.storeGet('activeWorkspace')
  ]);
  settings = s || settings;
  workspaces = normalizeWorkspaces(savedWorkspaces, session);
  activeWorkspaceId = workspaces.some((workspace) => workspace.id === savedWorkspaceId) ? savedWorkspaceId : workspaces[0].id;
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  if (activeWorkspace && activeWorkspace.profile !== settings.activeProfile) {
    try { settings = await browserApi.setSettings({ activeProfile: activeWorkspace.profile }); } catch { /* mantiene los ajustes actuales */ }
  }
  renderWorkspaceUI();
  browserApi.storeSet('workspaces', workspaces);
  browserApi.storeSet('activeWorkspace', activeWorkspaceId);
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
  const savedWorkspaceTabs = settings.restoreSession && activeWorkspace && Array.isArray(activeWorkspace.tabs) ? activeWorkspace.tabs : [];
  if (savedWorkspaceTabs.length) {
    savedWorkspaceTabs.forEach((item) => createTab({ url: item.url, pinned: !!item.pinned, profile: activeWorkspace.profile, group: item.group, background: true }));
    activate(tabs[Math.min(activeWorkspace.active || 0, tabs.length - 1)].id); restored = true;
  } else if (!Array.isArray(savedWorkspaces) && settings.restoreSession && session && Array.isArray(session.tabs) && session.tabs.length) {
    session.tabs.filter((item) => item && allowedUrl(item.url)).forEach((item) => createTab({ url: item.url, pinned: !!item.pinned, profile: item.profile, group: item.group, background: true }));
    if (tabs.length) { activate((tabs[session.active] || tabs[tabs.length - 1]).id); restored = true; }
  }
  if (!restored) createTab();
})();
