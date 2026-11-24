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

// The keys of one line go out back to back with no wait at all, the way PoE Lurker sends them:
// the game takes its keys in order, so the chat box opens, fills and sends within a frame or
// two and is barely seen. The only wait is after a line, before the clipboard may change for
// the next one: the game must have read the paste by then. In milliseconds, about two frames.
const LINE_GAP_MS = 35;
const RESTORE_MS = 400;

// Types one line into the game's chat: Enter, paste, Enter, all at once. The
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
    uIOhook.keyTap(UiohookKey.A, [UiohookKey.Ctrl]); // replace anything half typed
    uIOhook.keyTap(UiohookKey.V, [UiohookKey.Ctrl]);
    if (send) uIOhook.keyTap(UiohookKey.Enter);
    await sleep(LINE_GAP_MS);
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

// Copies the item under the mouse with Ctrl+Alt+C, the game's copy that also names each
// modifier's tier. Holding Alt locks the game's item tooltip in place, and it lets go when Alt
// is released. Pressed and released within the same instant (as one key tap does), the game
// can miss the release, and the tooltip then stays on screen until the item is picked up and
// put down again. So each step waits a couple of frames, and Alt is held over at least one.
// Ctrl and Alt are released even when you were holding Ctrl for the check key yourself.
const COPY_STEP_MS = 30;
async function copyItem(hook, wait = sleep) {
  const { uIOhook, UiohookKey: K } = hook;
  uIOhook.keyToggle(K.Ctrl, 'down');
  uIOhook.keyToggle(K.Alt, 'down');
  await wait(COPY_STEP_MS);
  try {
    uIOhook.keyToggle(K.C, 'down');
    await wait(COPY_STEP_MS);
    uIOhook.keyToggle(K.C, 'up');
    await wait(COPY_STEP_MS);
  } finally {
    // Whatever happened above, no key is left held down in the game.
    uIOhook.keyToggle(K.Alt, 'up');
    uIOhook.keyToggle(K.Ctrl, 'up');
  }
}

module.exports = { focusGame, typeChat, copyItem, LINE_GAP_MS, COPY_STEP_MS };
