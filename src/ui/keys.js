'use strict';
// Key names: what a key press is called in the app's settings, and whether two names mean the
// same key. Used by the Settings page (in the window) and when the settings are read (in the
// app itself), so this file loads both ways. Plain logic, no Electron.
(() => {
  // The ways a modifier may be written, and the one way the app writes it.
  const MODS = {
    ctrl: 'Ctrl', control: 'Ctrl', cmdorctrl: 'Ctrl', commandorcontrol: 'Ctrl',
    alt: 'Alt', option: 'Alt', altgr: 'AltGr', shift: 'Shift',
    super: 'Super', meta: 'Super', cmd: 'Super', command: 'Super',
  };
  const MOD_ORDER = ['Ctrl', 'Alt', 'AltGr', 'Shift', 'Super'];
  const SAME = { esc: 'escape', return: 'enter' };
  const NAMES = {
    space: 'Space', tab: 'Tab', enter: 'Enter', escape: 'Escape', backspace: 'Backspace', delete: 'Delete', insert: 'Insert',
    home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', up: 'Up', down: 'Down', left: 'Left', right: 'Right',
    plus: 'Plus', printscreen: 'PrintScreen',
  };

  // "ctrl + d" as its modifiers, in the app's order, and its key.
  function parts(name) {
    const mods = new Set();
    let key = '';
    for (const raw of String(name == null ? '' : name).split('+')) {
      const p = raw.trim();
      if (!p) continue;
      const mod = MODS[p.toLowerCase()];
      if (mod) mods.add(mod); else key = p;
    }
    return { mods: MOD_ORDER.filter((m) => mods.has(m)), key };
  }

  // One spelling to compare with: "Ctrl+D", "ctrl+d" and "D+Control" are the same key.
  function keyId(name) {
    const { mods, key } = parts(name);
    if (!key && !mods.length) return '';
    const k = key.toLowerCase();
    return [...mods, SAME[k] || k].join('+').toLowerCase();
  }
  const sameKey = (a, b) => { const x = keyId(a); return x !== '' && x === keyId(b); };

  // A key name as it is shown: "ctrl+f2" reads "Ctrl+F2".
  function pretty(name) {
    const { mods, key } = parts(name);
    const k = key.toLowerCase();
    const shown = NAMES[SAME[k] || k] || (/^(f\d{1,2}|.)$/.test(k) ? k.toUpperCase() : key);
    return [...mods, shown].filter(Boolean).join('+');
  }

  // What a hotkey is called for each key of the keyboard, by where the key sits
  // (KeyboardEvent.code). Letters go by what the key types instead, so a keyboard that is not
  // QWERTY gets the letter printed on the key.
  const CODE_KEYS = {
    Space: 'Space', Tab: 'Tab', Enter: 'Enter', NumpadEnter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
  };
  const ONLY_MODIFIER = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$|^AltGraph$/;
  const FKEY = /^F([1-9]|1\d|2[0-4])$/;
  // Keys that may be a hotkey on their own. Every other key needs Ctrl or Alt with it: a hotkey
  // is taken away from the game and from every other program, and a plain D, 1 or Space is
  // needed for typing.
  const ALONE = /^(F\d{1,2}|num\w+|Insert|Home|End|PageUp|PageDown)$/;

  const letterOf = (e) => (/^[a-z]$/i.test(String(e.key || '')) ? e.key.toUpperCase() : '');
  const heldOf = (e) => [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);

  // A key press in the window as a hotkey name. e: a keydown event, or anything with its code,
  // key, ctrlKey, altKey, shiftKey and metaKey.
  // Returns { key } when the press can be a hotkey, { held } while only Ctrl, Alt or Shift are
  // down, or { problem } saying why it cannot.
  function hotkeyFromEvent(e) {
    const code = String(e.code || '');
    const mods = heldOf(e);
    if (ONLY_MODIFIER.test(code)) return { held: mods.join('+') };
    let m, key = letterOf(e);
    if (!key && (m = /^Key([A-Z])$/.exec(code))) key = m[1];
    if (!key && (m = /^Digit(\d)$/.exec(code))) key = m[1];
    if (!key && (m = /^Numpad(\d)$/.exec(code))) key = `num${m[1]}`;
    if (!key && FKEY.test(code)) key = code;
    if (!key) key = CODE_KEYS[code] || '';
    if (!key) return { problem: 'That key cannot be used as a hotkey. Press another one.' };
    if (!ALONE.test(key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
      return { problem: `Hold Ctrl or Alt together with ${pretty(key)}, or use an F key. On its own it would be taken away from the game and from typing.` };
    }
    return { key: [...mods, key].join('+') };
  }

  // The key that opens the inventory in game, as the app's key listener calls it. One key, no
  // Ctrl, Alt or Shift: the app only listens for it and never takes it away from the game.
  const LISTENED = new Set(['Tab', 'Space', 'Enter', 'Backspace', 'CapsLock', 'PageUp', 'PageDown', 'End', 'Home', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown',
    'Insert', 'Delete', 'NumpadMultiply', 'NumpadAdd', 'NumpadSubtract', 'NumpadDecimal', 'NumpadDivide',
    'Semicolon', 'Equal', 'Comma', 'Minus', 'Period', 'Slash', 'Backquote', 'BracketLeft', 'Backslash', 'BracketRight', 'Quote']);
  function gameKeyFromEvent(e) {
    const code = String(e.code || '');
    if (ONLY_MODIFIER.test(code)) return { held: '' };
    let m;
    const letter = letterOf(e);
    if (letter) return { key: letter };
    if ((m = /^Key([A-Z])$/.exec(code))) return { key: m[1] };
    if ((m = /^Digit(\d)$/.exec(code))) return { key: m[1] };
    if (FKEY.test(code) || /^Numpad\d$/.test(code) || LISTENED.has(code)) return { key: code };
    return { problem: 'The app cannot listen for that key. Press another one.' };
  }

  // The entry of list ([{ id, key, ... }]) that already has this key, other than entry id.
  const clash = (list, id, key) => (list || []).find((x) => x.id !== id && sameKey(x.key, key)) || null;

  // A key still saved as an old default follows the new default, unless another of the app's
  // keys (others) already has it. A key that was chosen, or cleared, is returned as it is.
  function movedDefault(current, from, to, others) {
    if (!sameKey(current, from)) return current;
    return (others || []).some((k) => sameKey(k, to)) ? current : to;
  }

  const api = { keyId, sameKey, pretty, hotkeyFromEvent, gameKeyFromEvent, clash, movedDefault };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Keys = api;
})();
