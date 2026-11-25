'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  onState: (cb) => ipcRenderer.on('state', (_e, state) => cb(state)),
  setConfig: (patch) => ipcRenderer.invoke('set-config', patch),
  action: (a) => ipcRenderer.invoke('action', a),
  account: (a) => ipcRenderer.invoke('account', a),
  search: (q) => ipcRenderer.invoke('search', q),
  inventory: () => ipcRenderer.invoke('inventory'),
  logCheck: () => ipcRenderer.invoke('log-check'),
  runSnapshot: (runId) => ipcRenderer.invoke('run-snapshot', runId),
  itemsList: () => ipcRenderer.invoke('items-list'),
  savedSession: (id) => ipcRenderer.invoke('saved-session', id),
  priceCategories: () => ipcRenderer.invoke('price-categories'),
  priceList: (a) => ipcRenderer.invoke('price-list', a),
  // the Jewels page
  jewels: (a) => ipcRenderer.invoke('jewels', a),
  onJewelProgress: (cb) => ipcRenderer.on('jewel-progress', (_e, p) => cb(p)),
  // the Troubleshooting page and the Developer tools
  troubleList: () => ipcRenderer.invoke('trouble-list'),
  troubleDetails: (id) => ipcRenderer.invoke('trouble-details', id),
  troubleVideo: (id) => ipcRenderer.invoke('trouble-video', id),
  troubleNew: () => ipcRenderer.invoke('trouble-new'),
  troubleAddImage: (id, bytes, type) => ipcRenderer.invoke('trouble-add-image', id, bytes, type),
  troubleImage: (id, name) => ipcRenderer.invoke('trouble-image', id, name),
  dev: (a) => ipcRenderer.invoke('dev', a),
  tracker: (a) => ipcRenderer.invoke('tracker', a), // the Tracker page: list, add, update
  // the trade overlay window
  onTrade: (cb) => ipcRenderer.on('trade', (_e, data) => cb(data)),
  layout: () => ipcRenderer.invoke('layout-get'),
  overlaySize: (height) => ipcRenderer.send('overlay-size', height),
  // the price check window on top of the game
  onCheck: (cb) => ipcRenderer.on('check', (_e, data) => cb(data)),
  onCheckPress: (cb) => ipcRenderer.on('check-press', (_e, p) => cb(p)), // a press of the mouse the app saw land in the window
  checkSize: (height) => ipcRenderer.send('check-size', height),
  checkKeys: (on) => ipcRenderer.send('check-keys', !!on), // a number is being typed: the window needs the keyboard
});
