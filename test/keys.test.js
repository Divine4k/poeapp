'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { keyId, sameKey, pretty, hotkeyFromEvent, gameKeyFromEvent, clash, movedDefault } = require('../src/ui/keys');

// A key press as the window reports it.
const press = (code, key, mods = {}) => ({ code, key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test('key names: the same key however it is written', () => {
  assert.equal(sameKey('Ctrl+D', 'ctrl+d'), true);
  assert.equal(sameKey('Ctrl+D', 'D+Control'), true);
  assert.equal(sameKey('CmdOrCtrl+Shift+F2', 'shift + ctrl + f2'), true);
  assert.equal(sameKey('Esc', 'Escape'), true);
  assert.equal(sameKey('Ctrl+Return', 'Ctrl+Enter'), true);
  assert.equal(sameKey('Ctrl+D', 'Ctrl+F'), false);
  assert.equal(sameKey('Ctrl+D', 'D'), false);
  assert.equal(sameKey('Shift+F2', 'F2'), false);
  // No key is never "the same key" as no key: two unset actions do not clash.
  assert.equal(sameKey('', ''), false);
  assert.equal(sameKey(undefined, null), false);
  assert.equal(keyId('  '), '');
});

test('key names: shown the way they are printed on the keyboard', () => {
  assert.equal(pretty('ctrl+d'), 'Ctrl+D');
  assert.equal(pretty('shift+f2'), 'Shift+F2');
  assert.equal(pretty('F8'), 'F8');
  assert.equal(pretty('alt+control+pagedown'), 'Ctrl+Alt+PageDown');
  assert.equal(pretty('tab'), 'Tab');
  assert.equal(pretty('i'), 'I');
  assert.equal(pretty('Backquote'), 'Backquote');
  assert.equal(pretty('Ctrl+num1'), 'Ctrl+num1');
  assert.equal(pretty(''), '');
});

test('choosing a hotkey: a key press becomes a name Electron takes', () => {
  assert.deepEqual(hotkeyFromEvent(press('KeyD', 'd', { ctrlKey: true })), { key: 'Ctrl+D' });
  assert.deepEqual(hotkeyFromEvent(press('F2', 'F2', { shiftKey: true })), { key: 'Shift+F2' });
  assert.deepEqual(hotkeyFromEvent(press('F8', 'F8')), { key: 'F8' });
  assert.deepEqual(hotkeyFromEvent(press('F24', 'F24')), { key: 'F24' });
  assert.deepEqual(hotkeyFromEvent(press('KeyQ', 'Q', { ctrlKey: true, altKey: true, shiftKey: true })), { key: 'Ctrl+Alt+Shift+Q' });
  assert.deepEqual(hotkeyFromEvent(press('Digit1', '!', { altKey: true, shiftKey: true })), { key: 'Alt+Shift+1' });
  assert.deepEqual(hotkeyFromEvent(press('Numpad5', '5')), { key: 'num5' });
  assert.deepEqual(hotkeyFromEvent(press('NumpadAdd', '+')), { key: 'numadd' });
  assert.deepEqual(hotkeyFromEvent(press('Space', ' ', { ctrlKey: true })), { key: 'Ctrl+Space' });
  assert.deepEqual(hotkeyFromEvent(press('ArrowUp', 'ArrowUp', { altKey: true })), { key: 'Alt+Up' });
  assert.deepEqual(hotkeyFromEvent(press('Backquote', '`', { ctrlKey: true })), { key: 'Ctrl+`' });
  assert.deepEqual(hotkeyFromEvent(press('PageDown', 'PageDown')), { key: 'PageDown' });
  assert.deepEqual(hotkeyFromEvent(press('Insert', 'Insert')), { key: 'Insert' });
});

test('choosing a hotkey: the letter printed on the key, whatever the keyboard layout', () => {
  // A German keyboard: the key that types Z sits where a US keyboard has Y.
  assert.deepEqual(hotkeyFromEvent(press('KeyY', 'z', { ctrlKey: true })), { key: 'Ctrl+Z' });
  // A French keyboard: the key that types M sits where a US keyboard has the semicolon.
  assert.deepEqual(hotkeyFromEvent(press('Semicolon', 'm', { altKey: true })), { key: 'Alt+M' });
  // A layout that types no Latin letter falls back to where the key sits.
  assert.deepEqual(hotkeyFromEvent(press('KeyD', 'в', { ctrlKey: true })), { key: 'Ctrl+D' });
});

test('choosing a hotkey: keys held, keys refused', () => {
  // Only Ctrl, Alt or Shift so far: the choosing goes on.
  assert.deepEqual(hotkeyFromEvent(press('ControlLeft', 'Control', { ctrlKey: true })), { held: 'Ctrl' });
  assert.deepEqual(hotkeyFromEvent(press('ShiftRight', 'Shift', { ctrlKey: true, shiftKey: true })), { held: 'Ctrl+Shift' });
  assert.deepEqual(hotkeyFromEvent(press('AltLeft', 'Alt')), { held: '' });
  // A key needed for typing is not taken on its own, nor with Shift alone.
  for (const e of [press('KeyD', 'd'), press('KeyD', 'D', { shiftKey: true }), press('Digit1', '1'), press('Space', ' '), press('Enter', 'Enter'), press('Tab', 'Tab'), press('Delete', 'Delete'), press('ArrowLeft', 'ArrowLeft'), press('Comma', ',')]) {
    const got = hotkeyFromEvent(e);
    assert.equal(got.key, undefined, e.code);
    assert.match(got.problem, /Hold Ctrl or Alt/, e.code);
  }
  assert.match(hotkeyFromEvent(press('KeyD', 'd')).problem, /with D,/);
  // Keys Electron has no name for.
  assert.match(hotkeyFromEvent(press('ContextMenu', 'ContextMenu')).problem, /cannot be used/);
  assert.match(hotkeyFromEvent(press('', 'Unidentified', { ctrlKey: true })).problem, /cannot be used/);
  assert.match(hotkeyFromEvent(press('F25', 'F25')).problem, /cannot be used/);
});

test('choosing the inventory key: one key, named as the key listener names it', () => {
  assert.deepEqual(gameKeyFromEvent(press('Tab', 'Tab')), { key: 'Tab' });
  assert.deepEqual(gameKeyFromEvent(press('KeyI', 'i')), { key: 'I' });
  assert.deepEqual(gameKeyFromEvent(press('KeyY', 'z')), { key: 'Z' });
  assert.deepEqual(gameKeyFromEvent(press('Digit4', '$', { shiftKey: true })), { key: '4' });
  assert.deepEqual(gameKeyFromEvent(press('Backquote', '`')), { key: 'Backquote' });
  assert.deepEqual(gameKeyFromEvent(press('Space', ' ')), { key: 'Space' });
  assert.deepEqual(gameKeyFromEvent(press('F3', 'F3')), { key: 'F3' });
  assert.deepEqual(gameKeyFromEvent(press('Numpad0', '0')), { key: 'Numpad0' });
  assert.deepEqual(gameKeyFromEvent(press('ShiftLeft', 'Shift', { shiftKey: true })), { held: '' });
  assert.match(gameKeyFromEvent(press('ContextMenu', 'ContextMenu')).problem, /cannot listen/);
});

test('the inventory key names are ones the key listener knows', () => {
  // The names uiohook-napi 1.5 gives its keys (UiohookKey), which is what the app looks the key up in.
  const known = new Set(['Backspace', 'Tab', 'Enter', 'CapsLock', 'Escape', 'Space', 'PageUp', 'PageDown', 'End', 'Home', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Insert', 'Delete',
    ...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', ...Array.from({ length: 10 }, (_, i) => `Numpad${i}`), 'NumpadMultiply', 'NumpadAdd', 'NumpadSubtract', 'NumpadDecimal', 'NumpadDivide',
    ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`), 'Semicolon', 'Equal', 'Comma', 'Minus', 'Period', 'Slash', 'Backquote', 'BracketLeft', 'Backslash', 'BracketRight', 'Quote']);
  const codes = ['Tab', 'Space', 'Enter', 'Backspace', 'CapsLock', 'PageUp', 'PageDown', 'End', 'Home', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Insert', 'Delete',
    'NumpadMultiply', 'NumpadAdd', 'NumpadSubtract', 'NumpadDecimal', 'NumpadDivide', 'Semicolon', 'Equal', 'Comma', 'Minus', 'Period', 'Slash', 'Backquote', 'BracketLeft', 'Backslash', 'BracketRight', 'Quote',
    ...Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`), ...Array.from({ length: 10 }, (_, i) => `Digit${i}`), ...Array.from({ length: 10 }, (_, i) => `Numpad${i}`), ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`)];
  for (const code of codes) {
    const got = gameKeyFromEvent(press(code, ''));
    assert.ok(known.has(got.key), `${code} -> ${got.key}`);
  }
});

test('two actions cannot share a key', () => {
  const list = [{ id: 'check', name: 'Check and count', key: 'F8' }, { id: 'next', name: 'Next step', key: 'F2' }, { id: 'invite', name: 'Invite', key: '' }, { id: 'busy', name: 'Busy', key: '' }];
  assert.equal(clash(list, 'invite', 'f2').id, 'next');
  assert.equal(clash(list, 'next', 'F2'), null); // its own key
  assert.equal(clash(list, 'invite', 'Shift+F2'), null);
  assert.equal(clash(list, 'invite', ''), null);  // clearing one never clashes with another unset key
  assert.equal(clash(null, 'invite', 'F2'), null);
});

test('the price check key moves from its old default to the new one, once', () => {
  const others = ['F8', 'F9', 'F2', 'F3', 'Shift+F2', '', '', 'F5'];
  // Still on the old default, however it was typed: it follows.
  assert.equal(movedDefault('Ctrl+F', 'Ctrl+F', 'Ctrl+D', others), 'Ctrl+D');
  assert.equal(movedDefault('ctrl+f', 'Ctrl+F', 'Ctrl+D', others), 'Ctrl+D');
  // A key chosen by hand, and a key that was cleared, stay as they are.
  assert.equal(movedDefault('Alt+Q', 'Ctrl+F', 'Ctrl+D', others), 'Alt+Q');
  assert.equal(movedDefault('', 'Ctrl+F', 'Ctrl+D', others), '');
  assert.equal(movedDefault('Ctrl+D', 'Ctrl+F', 'Ctrl+D', others), 'Ctrl+D');
  // The new default is already another action's key: nothing is taken away from it.
  assert.equal(movedDefault('Ctrl+F', 'Ctrl+F', 'Ctrl+D', [...others, 'ctrl+d']), 'Ctrl+F');
  assert.equal(movedDefault('Ctrl+F', 'Ctrl+F', 'Ctrl+D', undefined), 'Ctrl+D');
});
