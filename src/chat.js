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

// The clipboard as it was before the app borrowed it, put back shortly after the last line.
// Several lines in a row (thanks, then kick) share one borrow, so nothing waits in between.
let borrowed = null; // { text } while the clipboard holds one of our lines
let giveBack = null;

// How long the game gets to act on a key before the next one, in milliseconds. The game reads
// its keys in order, so this only has to cover the paste reading the clipboard: one drawn frame.
const KEY_GAP_MS = 18;
const RESTORE_MS = 400;

// Types one line into the game's chat: Enter, paste, Enter, as fast as the game takes it. The
// clipboard is put back a moment after the last line.
// hook: the uiohook-napi module. clipboard: Electron's clipboard.
// send: false leaves the line in the open chat box instead of sending it.
async function typeChat(hook, clipboard, text, { send = true } = {}) {
  const line = send ? String(text || '').replace(/[\r\n]+/g, ' ').trim() : String(text || '').replace(/[\r\n]+/g, ' ');
  if (!line) return false;
  const { uIOhook, UiohookKey } = hook;
  clearTimeout(giveBack);
  if (!borrowed) borrowed = { text: clipboard.readText() };
  try {
    clipboard.writeText(line);
    uIOhook.keyTap(UiohookKey.Enter);
    await sleep(KEY_GAP_MS);
    uIOhook.keyTap(UiohookKey.A, [UiohookKey.Ctrl]); // replace anything half typed
    uIOhook.keyTap(UiohookKey.V, [UiohookKey.Ctrl]);
    await sleep(KEY_GAP_MS);
    if (send) uIOhook.keyTap(UiohookKey.Enter);
    await sleep(KEY_GAP_MS); // the paste must have been read before the clipboard changes again
  } finally {
    giveBack = setTimeout(() => {
      const mine = borrowed;
      borrowed = null;
      // Only if the clipboard still holds our line: you may have copied something since.
      try { if (mine && clipboard.readText() === line) clipboard.writeText(mine.text); } catch (_) { /* nothing to restore to */ }
    }, RESTORE_MS);
  }
  return true;
}

module.exports = { focusGame, typeChat, KEY_GAP_MS };
