const { app, BrowserWindow, Menu, session, ipcMain, shell, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { fileURLToPath } = require('url');

const PARTITION = 'persist:dodi';
const PRIVATE_PARTITION = 'dodi-private';
const ENGINES = {
  duckduckgo: 'https://duckduckgo.com/?q=%s',
  google: 'https://www.google.com/search?q=%s',
  bing: 'https://www.bing.com/search?q=%s',
  brave: 'https://search.brave.com/search?q=%s'
};
const DEFAULT_SETTINGS = {
  searchEngine: 'duckduckgo', homepage: '', accent: '#3DDBB0', theme: 'dark',
  adblock: true, restoreSession: true, translateTo: 'es', clearOnExit: false, activeProfile: 'personal', profiles: ['personal']
};
const DEFAULT_SHORTCUTS = [
  { title: 'Wikipedia', url: 'https://www.wikipedia.org/' },
  { title: 'YouTube', url: 'https://www.youtube.com/' },
  { title: 'GitHub', url: 'https://github.com/' },
  { title: 'Mapas', url: 'https://www.openstreetmap.org/' },
  { title: 'Noticias', url: 'https://news.ycombinator.com/' }
];
const UI_STORE_KEYS = ['bookmarks', 'notes', 'session'];
const RISKY_EXT = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|js|jse|wsf|lnk|jar|reg|hta)$/i;

let win = null;
let store = null;
let historyStore = null;
let blocker = null;
let blockerError = '';
let downloads = [];
let statsDate = '';
let blockedRequestsToday = 0;
const liveItems = new Map();
const subs = new Set();
const initializedPartitions = new Set();
const ghosteryIpcChannels = new Set([
  '@ghostery/adblocker/inject-cosmetic-filters',
  '@ghostery/adblocker/is-mutation-observer-enabled'
]);
const ghosteryIpcRegistrations = new Map();
let ghosteryIpcCompatInstalled = false;

/* ---------- almacenamiento en JSON (carpeta de datos del usuario) ---------- */

function makeStore(file, defaults) {
  const p = path.join(app.getPath('userData'), file);
  let data = { ...defaults };
  let timer = null;
  try { data = { ...defaults, ...JSON.parse(fs.readFileSync(p, 'utf8')) }; } catch (e) { /* primer arranque */ }
  const write = () => { try { fs.writeFileSync(p, JSON.stringify(data)); } catch (e) { /* ignorar */ } };
  return {
    get: (k) => data[k],
    set(k, v) { data[k] = v; this.flush(); },
    flush() { clearTimeout(timer); timer = setTimeout(write, 400); },
    flushNow() { clearTimeout(timer); write(); }
  };
}

const settings = () => ({ ...DEFAULT_SETTINGS, ...(store.get('settings') || {}) });
const publicSettings = () => {
  const s = settings();
  return { ...s, searchUrl: ENGINES[s.searchEngine] || ENGINES.duckduckgo, adblockAvailable: !!blocker, adblockError: blockerError };
};

function sanitizeSettings(p) {
  const out = {};
  if (typeof p.searchEngine === 'string' && Object.hasOwn(ENGINES, p.searchEngine)) out.searchEngine = p.searchEngine;
  if (typeof p.homepage === 'string') {
    const h = p.homepage.trim();
    if (h === '' || /^https?:\/\/\S+$/i.test(h)) out.homepage = h;
  }
  if (typeof p.accent === 'string' && /^#[0-9a-f]{6}$/i.test(p.accent)) out.accent = p.accent;
  if (p.theme === 'dark' || p.theme === 'light') out.theme = p.theme;
  if (typeof p.adblock === 'boolean') out.adblock = p.adblock;
  if (typeof p.restoreSession === 'boolean') out.restoreSession = p.restoreSession;
  if (typeof p.translateTo === 'string' && /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(p.translateTo)) out.translateTo = p.translateTo;
  if (typeof p.clearOnExit === 'boolean') out.clearOnExit = p.clearOnExit;
  if (typeof p.activeProfile === 'string' && /^[a-z0-9][a-z0-9 _-]{0,23}$/i.test(p.activeProfile.trim())) out.activeProfile = p.activeProfile.trim();
  if (Array.isArray(p.profiles)) out.profiles = [...new Set(p.profiles.filter((x) => typeof x === 'string' && /^[a-z0-9][a-z0-9 _-]{0,23}$/i.test(x.trim())).map((x) => x.trim()))].slice(0, 20);
  return out;
}

function profilePartition(name) {
  const slug = String(name || 'personal').toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'personal';
  if (slug === 'personal') return PARTITION;
  return `persist:dodi-profile-${slug}`;
}
function allowedPartition(partition) {
  return partition === PARTITION || partition === PRIVATE_PARTITION || /^persist:dodi-profile-[a-z0-9-]{1,24}$/.test(partition);
}

function sanitizeShortcuts(list) {
  if (!Array.isArray(list)) return DEFAULT_SHORTCUTS;
  const out = [];
  for (const it of list) {
    try {
      const u = new URL(String(it.url));
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      out.push({ title: String(it.title || u.hostname).trim().slice(0, 30) || u.hostname, url: u.href });
    } catch (e) { /* url inválida */ }
  }
  return out.slice(0, 24);
}

/* ---------- seguridad de IPC ---------- */

function isInternalUrl(u) {
  try {
    let f = path.resolve(fileURLToPath(u));
    let root = path.resolve(__dirname) + path.sep;
    if (process.platform === 'win32') { f = f.toLowerCase(); root = root.toLowerCase(); }
    return f.startsWith(root);
  } catch (e) { return false; }
}
const senderUrl = (e) => (e.senderFrame ? e.senderFrame.url : e.sender.getURL());
const fromMain = (e) => !!win && e.sender === win.webContents;
const ok = (e) => fromMain(e) || isInternalUrl(senderUrl(e));

function send(cmd, arg) {
  if (win && !win.isDestroyed()) win.webContents.send('cmd', cmd, arg);
}
function broadcast(channel, payload) {
  const targets = [win && !win.isDestroyed() ? win.webContents : null, ...subs];
  targets.forEach((wc) => { if (wc && !wc.isDestroyed()) wc.send(channel, payload); });
}
const isPrivate = (contents) => contents.session === session.fromPartition(PRIVATE_PARTITION);

/* ---------- historial ---------- */

function addHistory(url, title) {
  const items = historyStore.get('items');
  const last = items[items.length - 1];
  if (last && last.url === url && Date.now() - last.time < 5000) return;
  items.push({ url, title: title || '', time: Date.now() });
  if (items.length > 5000) items.splice(0, items.length - 5000);
  historyStore.flush();
}
function updateHistoryTitle(url, title) {
  const items = historyStore.get('items');
  for (let i = items.length - 1; i >= Math.max(0, items.length - 5); i--) {
    if (items[i].url === url) { items[i].title = title; historyStore.flush(); break; }
  }
}

/* ---------- descargas ---------- */

function uniquePath(dir, name) {
  const safeName = path.basename(name) || 'descarga';
  const ext = path.extname(safeName);
  const base = path.basename(safeName, ext);
  let p = path.join(dir, safeName);
  let i = 1;
  while (fs.existsSync(p)) p = path.join(dir, `${base} (${i++})${ext}`);
  return p;
}

let pushTimer = null;
function pushDownloads(now) {
  if (now) { clearTimeout(pushTimer); pushTimer = null; broadcast('downloads', downloads); return; }
  if (pushTimer) return;
  pushTimer = setTimeout(() => { pushTimer = null; broadcast('downloads', downloads); }, 250);
}
const persistDownloads = () => store.set('downloads', downloads.filter((d) => !liveItems.has(d.id)).slice(0, 100));

function setupDownloads(ses) {
  ses.on('will-download', (_e, item) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const savePath = uniquePath(app.getPath('downloads'), item.getFilename());
    item.setSavePath(savePath);
    const rec = { id, name: path.basename(savePath), url: item.getURL(), path: savePath, total: item.getTotalBytes(), received: 0, state: 'progressing', time: Date.now() };
    downloads.unshift(rec);
    liveItems.set(id, item);
    item.on('updated', (_ev, state) => {
      rec.received = item.getReceivedBytes();
      rec.total = item.getTotalBytes();
      rec.state = state === 'interrupted' ? 'interrupted' : (item.isPaused() ? 'paused' : 'progressing');
      pushDownloads(false);
    });
    item.once('done', (_ev, state) => {
      rec.state = state;
      rec.received = item.getReceivedBytes();
      liveItems.delete(id);
      persistDownloads();
      pushDownloads(true);
    });
    pushDownloads(true);
  });
}

/* ---------- permisos (se pregunta al usuario) ---------- */

const permCache = new Map();
function setupPermissions(ses, partition) {
  const labels = { media: 'la cámara o el micrófono', geolocation: 'tu ubicación', notifications: 'enviar notificaciones' };
  ses.setPermissionRequestHandler(async (_wc, permission, cb, details) => {
    if (['fullscreen', 'clipboard-sanitized-write', 'pointerLock'].includes(permission)) return cb(true);
    if (!labels[permission]) return cb(false);
    let origin = '';
    try { origin = new URL(details.requestingUrl).origin; } catch (e) { /* sin origen */ }
    const key = `${origin}|${permission}`;
    const cacheKey = `${partition}|${key}`;
    const privateSession = partition === PRIVATE_PARTITION;
    const saved = privateSession ? undefined : (store.get('permissions') || {})[key];
    if (typeof saved === 'boolean') return cb(saved);
    if (permCache.has(cacheKey)) return cb(permCache.get(cacheKey));
    const r = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Permitir', 'Bloquear'], defaultId: 1, cancelId: 1,
      title: 'Permiso solicitado', message: `${origin || 'Este sitio'} quiere usar ${labels[permission]}.`
    });
    const allow = r.response === 0;
    permCache.set(cacheKey, allow);
    if (!privateSession) store.set('permissions', { ...(store.get('permissions') || {}), [key]: allow });
    cb(allow);
  });
}

function setupProfileSession(partition) {
  if (!allowedPartition(partition)) return null;
  const ses = session.fromPartition(partition);
  if (initializedPartitions.has(partition)) return ses;
  initializedPartitions.add(partition);
  setupDownloads(ses);
  setupPermissions(ses, partition);
  if (blocker) {
    try { if (settings().adblock) enableBlockingInSession(ses); }
    catch (e) {
      blockerError = e.message || 'No se pudo activar el filtro en este perfil.';
      console.error('[Dodi adblock] No se pudo activar el filtro en una sesión:', blockerError);
    }
  }
  return ses;
}

async function clearBrowsingData() {
  permCache.clear();
  store.set('permissions', {});
  historyStore.set('items', []);
  for (const partition of initializedPartitions) {
    const ses = session.fromPartition(partition);
    await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] });
    await ses.clearCache();
  }
}

/* ---------- bloqueador de anuncios (opcional) ---------- */

async function initAdblock() {
  try {
    const { ElectronBlocker } = require('@ghostery/adblocker-electron');
    blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
      path: path.join(app.getPath('userData'), 'adblock-engine.bin'),
      read: fs.promises.readFile,
      write: fs.promises.writeFile
    });
    shareGhosteryIpcHandlers();
    const onBeforeRequest = blocker.onBeforeRequest.bind(blocker);
    blocker.onBeforeRequest = (details, callback) => onBeforeRequest(details, (response) => {
      if (response && response.cancel) {
        const today = localDateKey();
        if (today !== statsDate) { statsDate = today; blockedRequestsToday = 0; }
        blockedRequestsToday++;
        if (blockedRequestsToday % 20 === 0) store.set('browserStats', { date: statsDate, blockedRequests: blockedRequestsToday });
      }
      callback(response);
    });
    applyAdblock();
    broadcast('settings', publicSettings());
  } catch (e) {
    blocker = null;
    blockerError = e.message || 'No se pudieron cargar las listas de filtros.';
    console.error('[Dodi adblock] No se pudo iniciar el bloqueador:', blockerError);
    broadcast('settings', publicSettings());
  }
}
function shareGhosteryIpcHandlers() {
  if (ghosteryIpcCompatInstalled) return;
  ghosteryIpcCompatInstalled = true;
  const register = ipcMain.handle.bind(ipcMain);
  const remove = ipcMain.removeHandler.bind(ipcMain);
  ipcMain.handle = (channel, listener) => {
    if (!ghosteryIpcChannels.has(channel)) return register(channel, listener);
    const count = ghosteryIpcRegistrations.get(channel) || 0;
    if (count > 0) {
      ghosteryIpcRegistrations.set(channel, count + 1);
      return ipcMain;
    }
    try {
      const result = register(channel, listener);
      ghosteryIpcRegistrations.set(channel, 1);
      return result;
    } catch (error) {
      ghosteryIpcRegistrations.delete(channel);
      throw error;
    }
  };
  ipcMain.removeHandler = (channel) => {
    if (!ghosteryIpcChannels.has(channel)) return remove(channel);
    const count = ghosteryIpcRegistrations.get(channel) || 0;
    if (count > 1) {
      ghosteryIpcRegistrations.set(channel, count - 1);
      return;
    }
    ghosteryIpcRegistrations.delete(channel);
    return remove(channel);
  };
}
// Ghostery's current Electron wrapper expects APIs added in Electron 35.
// Keep Electron 33 compatible by adapting its older preload-list methods.
function enableBlockingInSession(ses) {
  if (typeof ses.registerPreloadScript !== 'function'
      && typeof ses.getPreloads === 'function'
      && typeof ses.setPreloads === 'function') {
    const registered = new Map();
    ses.registerPreloadScript = ({ filePath }) => {
      const id = `dodi-adblock-${crypto.randomUUID()}`;
      const preloads = ses.getPreloads();
      if (!preloads.includes(filePath)) ses.setPreloads([...preloads, filePath]);
      registered.set(id, filePath);
      return id;
    };
    ses.unregisterPreloadScript = (id) => {
      const filePath = registered.get(id);
      if (!filePath) return;
      registered.delete(id);
      if (![...registered.values()].includes(filePath)) {
        ses.setPreloads(ses.getPreloads().filter((item) => item !== filePath));
      }
    };
  }
  return blocker.enableBlockingInSession(ses);
}
function applyAdblock() {
  if (!blocker) return;
  const errors = [];
  initializedPartitions.forEach((p) => {
    const ses = session.fromPartition(p);
    try {
      if (settings().adblock) enableBlockingInSession(ses);
      else blocker.disableBlockingInSession(ses);
    } catch (e) { errors.push(e.message || 'Error al aplicar el filtro.'); }
  });
  blockerError = errors[0] || '';
  if (blockerError) console.error('[Dodi adblock] No se pudo aplicar el filtro:', blockerError);
}

function localDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function browserStats() {
  if (localDateKey() !== statsDate) { statsDate = localDateKey(); blockedRequestsToday = 0; }
  if (typeof app.getAppMetrics !== 'function') throw new Error('Esta versión de Electron no ofrece métricas del sistema.');
  const metrics = app.getAppMetrics();
  const workingSetKb = metrics.reduce((sum, metric) => sum + (metric.memory && metric.memory.workingSetSize || 0), 0);
  const cpuPercent = metrics.reduce((sum, metric) => sum + (metric.cpu && metric.cpu.percentCPUUsage || 0), 0);
  return {
    memoryMiB: Math.round(workingSetKb / 1024),
    cpuPercent: Math.round(cpuPercent),
    blockedRequestsToday,
    adblockAvailable: !!blocker,
    adblockError: blockerError,
    adblockEnabled: !!blocker && !blockerError && !!settings().adblock
  };
}

/* ---------- ventana ---------- */

function createWindow() {
  const iconPath = path.join(__dirname, 'build', 'icon.png');
  const light = settings().theme === 'light';
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 720, minHeight: 480,
    backgroundColor: '#0F1B1F', title: 'DodiNavigator', autoHideMenuBar: true,
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: light ? '#F2ECFA' : '#0B1417', symbolColor: light ? '#5F5367' : '#9DB3B7', height: 52 }
    } : {}),
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, webviewTag: true
    }
  });
  // Surface renderer failures in the CMD window used to launch the app.
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[Dodi renderer] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) console.error(`[Dodi load] ${description} (${code}): ${url}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[Dodi renderer exited] ${details.reason}, code ${details.exitCode}`);
  });
  win.webContents.on('will-attach-webview', (e, webPreferences, params) => {
    if (!allowedPartition(params.partition)) { e.preventDefault(); return; }
    setupProfileSession(params.partition);
    webPreferences.preload = path.join(__dirname, 'internal-preload.js');
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.webSecurity = true;
    webPreferences.sandbox = true;
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile('index.html');
  win.on('closed', () => { win = null; });
}

function contextMenuFor(contents, params) {
  const t = [];
  const editable = params.isEditable;
  if (params.linkURL && /^https?:/i.test(params.linkURL)) {
    t.push({ label: 'Abrir enlace en pestaña nueva', click: () => send('open-url', { url: params.linkURL, private: isPrivate(contents) }) });
    t.push({ label: 'Copiar dirección del enlace', click: () => clipboard.writeText(params.linkURL) });
    t.push({ type: 'separator' });
  }
  if (params.mediaType === 'image' && params.srcURL) {
    t.push({ label: 'Guardar imagen como…', click: () => contents.downloadURL(params.srcURL) });
    t.push({ label: 'Copiar imagen', click: () => contents.copyImageAt(params.x, params.y) });
    t.push({ type: 'separator' });
  }
  if (editable) {
    t.push({ label: 'Deshacer', click: () => contents.undo() }, { label: 'Rehacer', click: () => contents.redo() }, { type: 'separator' });
    t.push({ label: 'Cortar', click: () => contents.cut() });
  }
  if (params.selectionText || editable) t.push({ label: 'Copiar', click: () => contents.copy() });
  if (editable) t.push({ label: 'Pegar', click: () => contents.paste() });
  t.push({ label: 'Seleccionar todo', click: () => contents.selectAll() }, { type: 'separator' });
  t.push({ label: 'Atrás', enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() });
  t.push({ label: 'Adelante', enabled: contents.navigationHistory.canGoForward(), click: () => contents.navigationHistory.goForward() });
  t.push({ label: 'Recargar', click: () => contents.reload() });
  t.push({ type: 'separator' }, { label: 'Inspeccionar', click: () => contents.inspectElement(params.x, params.y) });
  Menu.buildFromTemplate(t).popup({ window: win });
}

app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview') return;
  contents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[Dodi tab] ${message} (${sourceId}:${line})`);
  });
  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) console.error(`[Dodi tab load] ${description} (${code}): ${url}`);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) send('open-url', { url, private: isPrivate(contents) });
    return { action: 'deny' };
  });
  contents.on('context-menu', (_ev, params) => contextMenuFor(contents, params));
  contents.on('did-navigate', (_ev, url) => {
    if (!isPrivate(contents) && /^https?:/i.test(url)) addHistory(url, contents.getTitle());
  });
  contents.on('page-title-updated', (_ev, title) => {
    if (!isPrivate(contents)) updateHistoryTitle(contents.getURL(), title);
  });
});

function buildMenu() {
  const it = (label, accelerator, cmd, arg) => ({ label, accelerator, click: () => send(cmd, arg) });
  const template = [
    {
      label: 'Navegador',
      submenu: [
        it('Nueva pestaña', 'CmdOrCtrl+T', 'new-tab'),
        it('Nueva pestaña privada', 'CmdOrCtrl+Shift+N', 'new-private-tab'),
        it('Reabrir pestaña cerrada', 'CmdOrCtrl+Shift+T', 'reopen-tab'),
        it('Cerrar pestaña', 'CmdOrCtrl+W', 'close-tab'),
        it('Ir a la barra de direcciones', 'CmdOrCtrl+L', 'focus-address'),
        it('Buscar en la página', 'CmdOrCtrl+F', 'find'),
        it('Recargar', 'CmdOrCtrl+R', 'reload'),
        { ...it('Recargar (F5)', 'F5', 'reload'), visible: false },
        it('Atrás', 'Alt+Left', 'back'),
        it('Adelante', 'Alt+Right', 'forward'),
        it('Inicio', 'Alt+Home', 'home'),
        it('Pestaña siguiente', 'Ctrl+Tab', 'next-tab'),
        it('Pestaña anterior', 'Ctrl+Shift+Tab', 'prev-tab'),
        { type: 'separator' },
        it('Acercar', 'CmdOrCtrl+Plus', 'zoom-in'),
        { ...it('Acercar (=)', 'CmdOrCtrl+=', 'zoom-in'), visible: false },
        it('Alejar', 'CmdOrCtrl+-', 'zoom-out'),
        it('Tamaño normal', 'CmdOrCtrl+0', 'zoom-reset'),
        { role: 'togglefullscreen', label: 'Pantalla completa' },
        { type: 'separator' },
        it('Favoritos y notas', 'CmdOrCtrl+B', 'side'),
        it('Historial', 'CmdOrCtrl+H', 'history'),
        it('Descargas', 'CmdOrCtrl+J', 'downloads'),
        it('Ajustes', 'CmdOrCtrl+,', 'settings'),
        it('Modo lectura', 'CmdOrCtrl+Alt+R', 'reader'),
        it('Traducir página', 'CmdOrCtrl+Alt+T', 'translate'),
        it('Herramientas de desarrollo', 'F12', 'devtools'),
        { type: 'separator' },
        { role: 'quit', label: 'Salir' }
      ]
    },
    { role: 'editMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- IPC ---------- */

ipcMain.on('subscribe', (e) => {
  if (!isInternalUrl(senderUrl(e)) || subs.has(e.sender)) return;
  subs.add(e.sender);
  e.sender.once('destroyed', () => subs.delete(e.sender));
});

ipcMain.handle('settings:get', (e) => (ok(e) ? publicSettings() : null));
ipcMain.handle('settings:set', async (e, patch) => {
  if (!ok(e) || !patch || typeof patch !== 'object') return publicSettings();
  const clean = sanitizeSettings(patch);
  if (clean.activeProfile) {
    clean.profiles = [...new Set([...(settings().profiles || ['personal']), clean.activeProfile])].slice(0, 20);
  }
  store.set('settings', { ...settings(), ...clean });
  if ('theme' in clean && win && process.platform === 'win32') {
    const light = clean.theme === 'light';
    win.setTitleBarOverlay({ color: light ? '#F2ECFA' : '#0B1417', symbolColor: light ? '#5F5367' : '#9DB3B7', height: 52 });
  }
  if (clean.activeProfile) {
    const profileSession = setupProfileSession(profilePartition(clean.activeProfile));
    await loadConfiguredExtensions(profileSession);
  }
  if ('adblock' in clean) applyAdblock();
  broadcast('settings', publicSettings());
  return publicSettings();
});

ipcMain.handle('shortcuts:get', (e) => (ok(e) ? (store.get('shortcuts') || DEFAULT_SHORTCUTS) : []));
ipcMain.handle('shortcuts:set', (e, list) => {
  if (!ok(e)) return [];
  const clean = sanitizeShortcuts(list);
  store.set('shortcuts', clean);
  return clean;
});

ipcMain.handle('history:get', (e, q) => {
  if (!ok(e)) return [];
  const query = String(q || '').toLowerCase();
  const items = historyStore.get('items');
  const out = [];
  for (let i = items.length - 1; i >= 0 && out.length < 500; i--) {
    const h = items[i];
    if (!query || h.url.toLowerCase().includes(query) || (h.title || '').toLowerCase().includes(query)) out.push(h);
  }
  return out;
});
ipcMain.handle('history:delete', (e, url, time) => {
  if (!ok(e)) return;
  historyStore.set('items', historyStore.get('items').filter((h) => !(h.url === url && h.time === time)));
});
ipcMain.handle('history:clear', (e) => { if (ok(e)) historyStore.set('items', []); });

ipcMain.handle('downloads:get', (e) => (ok(e) ? downloads : []));
ipcMain.handle('downloads:open', async (e, id) => {
  if (!ok(e)) return;
  const d = downloads.find((x) => x.id === id);
  if (!d || d.state !== 'completed') return;
  if (RISKY_EXT.test(d.path)) {
    const r = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Abrir', 'Cancelar'], defaultId: 1, cancelId: 1,
      title: 'Archivo ejecutable', message: `"${d.name}" puede ejecutar código en tu equipo. ¿Abrirlo de todas formas?`
    });
    if (r.response !== 0) return;
  }
  shell.openPath(d.path);
});
ipcMain.handle('downloads:show', (e, id) => {
  if (!ok(e)) return;
  const d = downloads.find((x) => x.id === id);
  if (d) shell.showItemInFolder(d.path);
});
ipcMain.handle('downloads:cancel', (e, id) => {
  if (!ok(e)) return;
  const it = liveItems.get(id);
  if (it) it.cancel();
});
ipcMain.handle('downloads:pause', (e, id) => {
  if (!ok(e)) return;
  const it = liveItems.get(id);
  if (it && it.isPaused && !it.isPaused()) it.pause();
});
ipcMain.handle('downloads:resume', (e, id) => {
  if (!ok(e)) return;
  const it = liveItems.get(id);
  if (it && it.isPaused && it.isPaused()) it.resume();
});
ipcMain.handle('downloads:clear', (e) => {
  if (!ok(e)) return;
  downloads = downloads.filter((d) => liveItems.has(d.id));
  persistDownloads();
  pushDownloads(true);
});

ipcMain.handle('data:clear', async (e, kind) => {
  if (!ok(e)) return;
  for (const p of initializedPartitions) {
    const ses = session.fromPartition(p);
    if (kind === 'cache' || kind === 'all') await ses.clearCache();
    if (kind === 'cookies' || kind === 'all') {
      await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] });
    }
  }
});
ipcMain.handle('private:closed', async (e) => {
  if (!fromMain(e)) return;
  const ses = session.fromPartition(PRIVATE_PARTITION);
  await ses.clearStorageData();
  await ses.clearCache();
  for (const key of permCache.keys()) if (key.startsWith(`${PRIVATE_PARTITION}|`)) permCache.delete(key);
});

ipcMain.handle('permissions:get', (e) => {
  if (!ok(e)) return [];
  return Object.entries(store.get('permissions') || {}).map(([key, allowed]) => {
    const [origin, permission] = key.split('|');
    return { key, origin, permission, allowed };
  });
});
ipcMain.handle('permissions:revoke', (e, key) => {
  if (!ok(e) || typeof key !== 'string') return;
  const next = { ...(store.get('permissions') || {}) };
  delete next[key];
  store.set('permissions', next);
  for (const cacheKey of permCache.keys()) if (cacheKey.endsWith(`|${key}`)) permCache.delete(cacheKey);
});
ipcMain.handle('permissions:clear', (e) => {
  if (!ok(e)) return;
  permCache.clear();
  store.set('permissions', {});
});
ipcMain.handle('stats:get', (e) => {
  try {
    if (!ok(e)) return { metricsError: 'No se autorizó la lectura de métricas.' };
    return browserStats();
  } catch (error) {
    const message = error && error.message ? error.message : 'Error desconocido';
    console.error('[Dodi metrics] No se pudieron leer las métricas:', message);
    return { metricsError: message };
  }
});

/* ---------- extensiones compatibles ---------- */

function extensionSessions() {
  return [...initializedPartitions]
    .filter((partition) => partition !== PRIVATE_PARTITION && partition.startsWith('persist:'))
    .map((partition) => session.fromPartition(partition));
}

async function loadExtensionInSession(ses, extensionPath) {
  const existing = ses.getAllExtensions().find((extension) => path.resolve(extension.path) === path.resolve(extensionPath));
  if (existing) return existing;
  return ses.loadExtension(extensionPath);
}

async function loadConfiguredExtensions(ses) {
  if (!ses || !ses.isPersistent()) return;
  for (const extension of store.get('extensions') || []) {
    try { await loadExtensionInSession(ses, extension.path); }
    catch (error) { console.warn(`No se pudo cargar la extensión ${extension.name}:`, error.message); }
  }
}

ipcMain.handle('extensions:get', (e) => {
  if (!ok(e)) return [];
  return (store.get('extensions') || []).map(({ key, name, version, manifestVersion }) => ({ key, name, version, manifestVersion }));
});

ipcMain.handle('extensions:add', async (e) => {
  if (!ok(e)) return { ok: false, message: 'Solicitud no válida.' };
  const picked = await dialog.showOpenDialog(win, { title: 'Seleccionar carpeta de extensión', properties: ['openDirectory'] });
  if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true };
  const sourcePath = picked.filePaths[0];
  let manifest;
  try {
    const manifestPath = path.join(sourcePath, 'manifest.json');
    const stat = fs.statSync(manifestPath);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('manifest.json no válido.');
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest || ![2, 3].includes(manifest.manifest_version) || typeof manifest.name !== 'string' || typeof manifest.version !== 'string' ||
        (manifest.permissions !== undefined && !Array.isArray(manifest.permissions)) ||
        (manifest.host_permissions !== undefined && !Array.isArray(manifest.host_permissions))) {
      throw new Error('La carpeta no contiene una extensión compatible.');
    }
  } catch (error) {
    return { ok: false, message: error.message || 'No se pudo leer manifest.json.' };
  }

  const displayName = (manifest.name.startsWith('__MSG_') ? 'Extensión sin nombre traducido' : manifest.name).slice(0, 100);
  const permissions = [...new Set([...(manifest.permissions || []), ...(manifest.host_permissions || [])])];
  const permissionText = permissions.length ? permissions.slice(0, 18).join(', ') : 'No declara permisos explícitos.';
  const approval = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['Cancelar', 'Instalar'], defaultId: 0, cancelId: 0,
    title: 'Confirmar extensión', message: `¿Instalar “${displayName}”?`,
    detail: `Versión ${manifest.version} · Manifest V${manifest.manifest_version}\nPermisos solicitados: ${permissionText}${permissions.length > 18 ? ', …' : ''}\n\nLas extensiones pueden leer o modificar información de los sitios donde las habilites. Instala solo extensiones de confianza. Algunas funciones de Chrome no están disponibles en DodiNavigator.`
  });
  if (approval.response !== 1) return { ok: false, canceled: true };

  const key = crypto.randomUUID();
  const extensionsDir = path.join(app.getPath('userData'), 'extensions');
  const targetPath = path.join(extensionsDir, key);
  try {
    fs.mkdirSync(extensionsDir, { recursive: true });
    fs.cpSync(sourcePath, targetPath, { recursive: true, errorOnExist: true });
    const records = store.get('extensions') || [];
    const record = { key, name: displayName, version: manifest.version.slice(0, 32), manifestVersion: manifest.manifest_version, path: targetPath };
    for (const ses of extensionSessions()) await loadExtensionInSession(ses, targetPath);
    store.set('extensions', [...records, record]);
    return { ok: true, extension: { key, name: record.name, version: record.version, manifestVersion: record.manifestVersion } };
  } catch (error) {
    for (const ses of extensionSessions()) {
      try {
        const loaded = ses.getAllExtensions().find((item) => path.resolve(item.path) === path.resolve(targetPath));
        if (loaded) ses.removeExtension(loaded.id);
      } catch (_) { /* ignorar limpieza parcial */ }
    }
    try { fs.rmSync(targetPath, { recursive: true, force: true }); } catch (_) { /* ignorar limpieza */ }
    return { ok: false, message: error.message || 'No se pudo instalar la extensión.' };
  }
});

ipcMain.handle('extensions:remove', async (e, key) => {
  if (!ok(e) || typeof key !== 'string') return { ok: false };
  const records = store.get('extensions') || [];
  const extension = records.find((item) => item.key === key);
  if (!extension) return { ok: false };
  const approval = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['Cancelar', 'Quitar'], defaultId: 0, cancelId: 0,
    title: 'Quitar extensión', message: `¿Quitar “${extension.name}”?`
  });
  if (approval.response !== 1) return { ok: false, canceled: true };
  for (const ses of extensionSessions()) {
    try {
      const loaded = ses.getAllExtensions().find((item) => path.resolve(item.path) === path.resolve(extension.path));
      if (loaded) ses.removeExtension(loaded.id);
    } catch (error) { console.warn(`No se pudo descargar ${extension.name}:`, error.message); }
  }
  store.set('extensions', records.filter((item) => item.key !== key));
  try { fs.rmSync(extension.path, { recursive: true, force: true }); }
  catch (error) { console.warn('No se pudo borrar la carpeta de la extensión:', error.message); }
  return { ok: true };
});

ipcMain.handle('store:get', (e, k) => {
  if (!fromMain(e) || !UI_STORE_KEYS.includes(k)) return null;
  const v = store.get(k);
  return v === undefined ? null : v;
});
ipcMain.handle('store:set', (e, k, v) => {
  if (!fromMain(e) || !UI_STORE_KEYS.includes(k)) return;
  store.set(k, v);
});

/* ---------- arranque ---------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(async () => {
    app.setAppUserModelId('com.dodi.navigator');
    store = makeStore('data.json', {});
    historyStore = makeStore('history.json', { items: [] });
    const savedStats = store.get('browserStats') || {};
    statsDate = localDateKey();
    blockedRequestsToday = savedStats.date === statsDate ? Number(savedStats.blockedRequests) || 0 : 0;
    downloads = (store.get('downloads') || []).map((d) => (d.state === 'progressing' || d.state === 'paused' ? { ...d, state: 'interrupted' } : d));
    (settings().profiles || ['personal']).forEach((profile) => setupProfileSession(profilePartition(profile)));
    setupProfileSession(profilePartition(settings().activeProfile));
    setupProfileSession(PRIVATE_PARTITION);
    await Promise.all(extensionSessions().map((ses) => loadConfiguredExtensions(ses)));
    buildMenu();
    createWindow();
    initAdblock();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  let quitCleanupStarted = false;
  app.on('before-quit', (e) => {
    if (store) store.set('browserStats', { date: statsDate, blockedRequests: blockedRequestsToday });
    if (store && settings().clearOnExit && !quitCleanupStarted) {
      e.preventDefault();
      quitCleanupStarted = true;
      clearBrowsingData().catch((err) => console.error('No se pudieron borrar los datos al salir:', err.message))
        .finally(() => { store.flushNow(); historyStore.flushNow(); app.quit(); });
      return;
    }
    if (store) store.flushNow();
    if (historyStore) historyStore.flushNow();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
