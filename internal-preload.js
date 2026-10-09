// Se ejecuta dentro de cada pestaña, pero solo expone la API a las páginas internas (file://).
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:') {
  const inv = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
  ipcRenderer.send('subscribe');
  contextBridge.exposeInMainWorld('dodi', {
    getSettings: () => inv('settings:get'),
    setSettings: (p) => inv('settings:set', p),
    onSettings: (cb) => ipcRenderer.on('settings', (_e, s) => cb(s)),
    getShortcuts: () => inv('shortcuts:get'),
    setShortcuts: (l) => inv('shortcuts:set', l),
    getHistory: (q) => inv('history:get', q),
    deleteHistory: (url, time) => inv('history:delete', url, time),
    clearHistory: () => inv('history:clear'),
    getDownloads: () => inv('downloads:get'),
    onDownloads: (cb) => ipcRenderer.on('downloads', (_e, d) => cb(d)),
    openDownload: (id) => inv('downloads:open', id),
    showDownload: (id) => inv('downloads:show', id),
    cancelDownload: (id) => inv('downloads:cancel', id),
    pauseDownload: (id) => inv('downloads:pause', id),
    resumeDownload: (id) => inv('downloads:resume', id),
    clearDownloads: () => inv('downloads:clear'),
    clearData: (kind) => inv('data:clear', kind),
    getPermissions: () => inv('permissions:get'),
    revokePermission: (key) => inv('permissions:revoke', key),
    clearPermissions: () => inv('permissions:clear'),
    getExtensions: () => inv('extensions:get'),
    addExtension: () => inv('extensions:add'),
    removeExtension: (key) => inv('extensions:remove', key),
    getStats: () => inv('stats:get'),
    getTabMemory: () => inv('stats:tabs'),
    getUpdateStatus: () => inv('update:status'),
    exportConfig: () => inv('config:export'),
    importConfig: () => inv('config:import'),
    checkUpdates: () => inv('update:check'),
    downloadUpdate: () => inv('update:download'),
    installUpdate: () => inv('update:install'),
    onUpdateStatus: (cb) => ipcRenderer.on('update:status', (_e, status) => cb(status))
  });
}
