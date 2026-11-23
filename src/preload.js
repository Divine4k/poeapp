'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  onState: (cb) => ipcRenderer.on('state', (_e, state) => cb(state)),
  setConfig: (patch) => ipcRenderer.invoke('set-config', patch),
  action: (a) => ipcRenderer.invoke('action', a),
  search: (q) => ipcRenderer.invoke('search', q),
  inventory: () => ipcRenderer.invoke('inventory'),
  runSnapshot: (runId) => ipcRenderer.invoke('run-snapshot', runId),
  savedSession: (id) => ipcRenderer.invoke('saved-session', id),
  priceCategories: () => ipcRenderer.invoke('price-categories'),
  priceList: (a) => ipcRenderer.invoke('price-list', a),
  // the trade overlay window
  onTrade: (cb) => ipcRenderer.on('trade', (_e, data) => cb(data)),
  overlaySize: (height) => ipcRenderer.send('overlay-size', height),
});
