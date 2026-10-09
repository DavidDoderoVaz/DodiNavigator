const { contextBridge, ipcRenderer } = require('electron');

const inv = (ch, ...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('api', {
  onCommand: (cb) => ipcRenderer.on('cmd', (_e, cmd, arg) => cb(cmd, arg)),
  getSettings: () => inv('settings:get'),
  setSettings: (p) => inv('settings:set', p),
  onSettings: (cb) => ipcRenderer.on('settings', (_e, s) => cb(s)),
  storeGet: (k) => inv('store:get', k),
  storeSet: (k, v) => inv('store:set', k, v),
  assistantStatus: () => inv('assistant:status'),
  assistantAsk: (payload) => inv('assistant:ask', payload),
  getDownloads: () => inv('downloads:get'),
  onDownloads: (cb) => ipcRenderer.on('downloads', (_e, d) => cb(d)),
  privateClosed: () => inv('private:closed'),
  exportPage: (id, format) => inv('page:export', id, format)
});
