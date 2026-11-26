'use strict';
// The settings every copy starts with, and how saved trade settings are laid over them.
// config.json on the user's PC holds only what differs; loadConfig in main.js merges the two.
const { DEFAULT_RULES } = require('./core/mapMods');
const { DEFAULT_MESSAGES } = require('./core/trade');

const DEFAULT_CONFIG = {
  league: '',
  logPath: '',
  characterName: '',
  // clipboard: check the hovered item and, over the inventory, name or count its slot.
  // priceCheck: only check its price; nothing is named or counted. Held only while the game is in front.
  // record: starts and stops a troubleshooting recording (admins and moderators only).
  // stashSearch: opens the saved stash searches at the mouse. Held only while the game is in front.
  // advancedCheck: the advanced price check's own key (Ctrl and Alt are the keys the copy needs anyway)
  hotkeys: { clipboard: 'F8', snapshot: 'F9', priceCheck: 'Ctrl+D', advancedCheck: 'Ctrl+Alt+D', record: 'Shift+F9', stashSearch: 'Ctrl+Shift+F' },
  checkToast: true, // after the check key, say in game for a moment what was read
  // auto: checking an item searches the trade site straight away (two web requests).
  // overlay: show the search on top of the game, beside the inventory or stash.
  priceSearch: { auto: true, overlay: true, sockets: true },
  // key: the key that opens your inventory in game. onKey: read once each time you press it.
  // timed: also check by itself every intervalMs (breaks GGG's one-read-per-key-press rule).
  // autoCopy: the check hotkey presses Ctrl+Alt+C in the game for you (one copy per key press).
  inventory: { displayId: null, key: 'Tab', onKey: true, onClick: true, timed: false, intervalMs: 1000, autoCopy: true },
  mapRules: DEFAULT_RULES,
  loadout: [],
  // What you are farming: each has a name and an atlas tree link, and its own sessions.
  strategies: [{ id: 'default', name: 'Default', atlasUrl: '' }],
  activeStrategy: 'default',
  // Saved stash searches, [{ name, text }]: a click in their menu puts the text in the game's stash search box.
  stashSearches: [],
  // The Regex page's map and vendor builders, as last set (cleanBuilders in src/core/regex.js).
  regex: { map: {}, vendor: {} },
  customPrices: {}, // name -> chaos, for items poe.ninja does not list
  ignoredItems: [], // names of items never to count, whatever the picture
  theme: 'slate', // how the window looks: an id from Theme.STANDARD or Theme.PREMIUM (src/ui/theme.js)
  themeCustom: null, // the four colours of the Custom theme: { bg, surface, ink, accent }
  motion: true, // short animations (toasts, the loading screen, Wraeclast's embers); off: everything appears at once
  trackerRepo: 'Divine4k/poeapp', // where the Tracker page keeps its items, as GitHub issues (admins only)
  trackerTabs: [], // the Tracker's own tabs after Main, in order (each is a label "tab: <name>" on its boxes)
  trackerLayout: {}, // where the boxes sit on the Tracker map, per layer: '<layer>/<box>' (issue number or 'root') -> [x, y]
  navOrder: [], // sidebar pages in the order you dragged them; pages not listed keep their usual place
  // Trade offers from whispers. overlay: show them on top of the game. position and offsets:
  // where on the game's screen. hotkeys.next does the next step for the oldest offer (one chat
  // line per press); hotkeys.dismiss removes the oldest offer. hotkeys.layout opens layout mode
  // for the whole overlay; it is kept here because that is where settings saved so far have it.
  trade: {
    enabled: true, overlay: true, position: 'bottom', offsetX: 0, offsetY: 0, sound: true,
    // invite, trade, busy, still and whisper act on the newest buyer and are unset until you
    // choose them. hideout and remaining type /hideout and /remaining; they are only held while
    // the game is in front, so F5 still refreshes a browser page.
    hotkeys: { next: 'F2', dismiss: 'F3', layout: 'Shift+F2', invite: '', trade: '', busy: '', still: '', whisper: '', hideout: 'F5', remaining: '' },
    // Steps taken without a key press once the game reports "Trade accepted", and around it.
    // All off unless switched on: GGG's rule is one action per key press or click.
    auto: { thankSold: false, kickSold: false, thankBought: false, leaveBought: false, homeBought: false, joinHideout: false, ignoreSold: false, closeBoughtSec: 0 },
    messages: { ...DEFAULT_MESSAGES },
  },
  // Where each thing on the overlay sits, once it has been dragged in layout mode: id -> { x, y, grow }.
  overlayLayout: {},
};

function mergeTrade(base, patch) {
  const p = patch || {};
  return { ...base, ...p, hotkeys: { ...base.hotkeys, ...(p.hotkeys || {}) }, messages: { ...base.messages, ...(p.messages || {}) }, auto: { ...base.auto, ...(p.auto || {}) } };
}

module.exports = { DEFAULT_CONFIG, mergeTrade };
