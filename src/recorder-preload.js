'use strict';
// The bridge for the hidden recording window (src/ui/recorder.html), and nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rec', {
  onStart: (cb) => ipcRenderer.on('rec-start', (_e, o) => cb(o)),
  onStop: (cb) => ipcRenderer.on('rec-stop', () => cb()),
  started: (info) => ipcRenderer.send('rec-started', info),
  failed: (msg) => ipcRenderer.send('rec-failed', msg),
  chunk: (bytes) => ipcRenderer.send('rec-chunk', bytes),
  stopped: () => ipcRenderer.send('rec-stopped'),
});
