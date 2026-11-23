'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  onState: (cb) => ipcRenderer.on('state', (_e, state) => cb(state)),
  setConfig: (patch) => ipcRenderer.invoke('set-config', patch),
  action: (a) => ipcRenderer.invoke('action', a),
  search: (q) => ipcRenderer.invoke('search', q),
});
