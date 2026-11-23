'use strict';
// Sends one chat line to the game, and brings the game window to the front first when the
// click came from this app's own window. Each call is the result of one click or key press by
// the user and sends exactly one line: the same thing trade tools such as PoE Lurker and
// Awakened PoE Trade do. Nothing here runs by itself.
const { execFile } = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Asks Windows to bring the Path of Exile window to the front. Resolves 'ok', 'none' (the
// game is not running) or 'no' (Windows refused). Found by process name, never by window
// title, so a browser tab called "Path of Exile" can not be picked by mistake.
function focusGame() {
  if (process.platform !== 'win32') return Promise.resolve('none');
  const script = "$p = Get-Process -Name 'PathOfExile*' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1; "
    + "if (-not $p) { 'none' } elseif ((New-Object -ComObject WScript.Shell).AppActivate($p.Id)) { 'ok' } else { 'no' }";
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], { windowsHide: true, timeout: 5000 }, (err, out) => {
      const word = String(out || '').trim().split(/\s+/).pop();
      resolve(err ? 'no' : (word === 'ok' || word === 'none' ? word : 'no'));
    });
  });
}

// Types one line into the game's chat: Enter, paste, Enter. The clipboard is put back after.
// hook: the uiohook-napi module. clipboard: Electron's clipboard.
// send: false leaves the line in the open chat box instead of sending it.
async function typeChat(hook, clipboard, text, { send = true } = {}) {
  const line = send ? String(text || '').replace(/[\r\n]+/g, ' ').trim() : String(text || '').replace(/[\r\n]+/g, ' ');
  if (!line) return false;
  const { uIOhook, UiohookKey } = hook;
  const before = clipboard.readText();
  clipboard.writeText(line);
  try {
    uIOhook.keyTap(UiohookKey.Enter);
    await sleep(60);
    uIOhook.keyTap(UiohookKey.A, [UiohookKey.Ctrl]); // replace anything half typed
    uIOhook.keyTap(UiohookKey.V, [UiohookKey.Ctrl]);
    await sleep(60);
    if (send) uIOhook.keyTap(UiohookKey.Enter);
    await sleep(120);
  } finally {
    clipboard.writeText(before);
  }
  return true;
}

module.exports = { focusGame, typeChat };
