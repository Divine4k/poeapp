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
  layout: () => ipcRenderer.invoke('layout-get'),
  overlaySize: (height) => ipcRenderer.send('overlay-size', height),
  // the price check window on top of the game
  onCheck: (cb) => ipcRenderer.on('check', (_e, data) => cb(data)),
  checkSize: (height) => ipcRenderer.send('check-size', height),
});
