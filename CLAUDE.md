# Map Companion (poeapp): notes for working on it

Electron 33 desktop app for Windows, a second-screen companion for Path of Exile 1. Reads the game log, reads the inventory from screen captures, prices loot via poe.ninja, searches the official trade site, shows a trade overlay on top of the game. User-facing docs: `README.md`. Owner decisions (default keys, where settings live): Project doc `claude/decisions.md`.

## Working rules
- Use the file map below; open only the files the task needs. Do not read README.md unless the task is about it.
- **Pushing to `main` ships the change to every user**: the in-app updater installs the newest commit on `main` (`src/updater.js`). Never push without the owner's click.
- Pushing to the `release` branch builds a new Windows installer (GitHub Actions, `.github/workflows/installer.yml`). Only when asked.
- Bump `version` in `package.json` for user-visible changes.
- When the layout of the code or a command changes, update this file in the same commit.

## Commands
```
npm run t            all tests, short output (~5 s, no Electron needed): one dot per test, failures in full
npm test             all tests, full output (CI uses this)
npm run test:<area>  one area: core, inventory, trade, keys, store, cloud, update
npm start            run the app (needs npm install; Electron)
node scripts/build-stats.js <stats.ndjson>   rebuild trade-site stat list at a new league
```
The whole suite is fast, so `npm run t` after any change is fine. Tests cover `src/core`, `src/shared.js`, `src/cloud.js`, `src/updater.js`, `src/ui/keys.js`; `main.js` and the UI pages have no tests, so check those by reading the change carefully.

## File map
| Path | What |
|---|---|
| `src/main.js` | Main process: config (`DEFAULT_CONFIG`, `loadConfig`), state sent to the window (`buildState`), game log watching, prices, inventory reading and naming items, account/uploads, updates, hotkeys (`registerHotkeys`, `syncKeyHook`), price check + trade search, trade offers and chat lines, overlay layout (`WIDGETS`), the IPC `actions` table, startup. Sections are marked `// ---- name ----`; grep for them. |
| `src/preload.js` | The `window.api` bridge (getState, onState, setConfig, action, account, search...) |
| `src/ui/index.html` | Main window markup; scripts load demo.js, keys.js, tradecard.js, app.js |
| `src/ui/app.js` | Main window logic, one IIFE. Sections (`// ---- name ----`): status bar, map pictures, attention list, current map, items page, session, strategies, tools (map check, costs, price check), trade search, inventory tab, trade page, sidebar order, events, game log check, price browser, strategy dialog, settings (`KEY_GROUPS` = every key), account |
| `src/ui/style.css`, `tradecard.css` | Main window styles |
| `src/ui/demo.js` | Fake state when index.html is opened in a plain browser (preview without Electron) |
| `src/ui/keys.js` | Key names shared by page and main process |
| `src/ui/check.*` | Price check / trade search window over the game |
| `src/ui/overlay.*`, `tradecard.js` | Trade overlay over the game; how one offer is drawn |
| `src/ui/layout.*` | Layout mode (drag overlay parts, Shift+F2) |
| `src/ui/toast.*` | Short message over the game |
| `src/core/session.js` | Map runs, timers, deaths, loot, costs (pure logic) |
| `src/core/clientLog.js` | Reads Client.txt (read-only) |
| `src/core/prices.js` | poe.ninja prices |
| `src/core/itemText.js` | Parses the item text copied with Ctrl+C |
| `src/core/mapMods.js` | Map mod warning rules |
| `src/core/trade.js` | Trade offers from whispers, next step per offer |
| `src/core/tradeQuery.js`, `tradeStats.js`, `tradeApi.js` | Trade site search: item -> query, mod line -> stat id, the HTTP calls |
| `src/core/checkMessage.js`, `checkPanel.js` | Text and placement of the price check result |
| `src/core/store.js` | Per-map inventory pictures and other files beside the session |
| `src/core/inventory/` | Screen reading: `grid` finds the grid, `reader` reads a frame, `icons` recognises items by fingerprint, `digits` stack numbers, `maps` map tiers, `ledger` loot from successive reads, `backlog` unnamed items |
| `src/core/data/stats.ndjson.gz` | Trade-site stat list (built by scripts/build-stats.js) |
| `src/shared.js` | Shared item database (fingerprints named by users), via the server |
| `src/cloud.js` | Account, session uploads; `SERVER` = https://poeapp.divine4k.workers.dev |
| `src/updater.js` | In-app updates from `main` of this repo |
| `src/overlay.js`, `capture.js`, `chat.js`, `gamewin.js`, `http.js`, `art.js`, `leftovers.js` | Overlay windows, screen capture, typing chat lines, which window is in front, web requests, item pictures, closing stray copies |
| `server/` | Cloudflare Worker + D1 schema. Deployed by pasting `worker.js` into the dashboard (see server/README.md); a push does not deploy it |
| `test/*.test.js` | node:test unit tests; `test/server.js` fake server; `test/fixtures/` captures |

## Conventions
- Settings: every setting is on the Settings page (`#tab-settings`), bound with `data-cfg="path.in.config"`, saved on change, no Save buttons. Every key goes in `KEY_GROUPS` in app.js only. New config keys get a default in `DEFAULT_CONFIG` (main.js).
- UI actions go through `api.action({ type, ... })` to the `actions` table in main.js; main pushes the whole state back (`push()`), the page redraws in `render()`.
- Plain English in user-facing text, no jargon. Comments explain why, in the same plain style.
- Nothing is typed into the game without the user's own key press or click (see README "Rules and risk"); keep it that way.

## Related
- `Divine4k/poeappitemdata`: the old shared item list. The server copied it once and now serves the list itself; the repo is no longer written to by the app.
