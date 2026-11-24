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
npm run test:<area>  one area: core, inventory, trade, keys, store, cloud, trouble, update
npm start            run the app (needs npm install; Electron)
node scripts/build-stats.js <stats.ndjson>   rebuild trade-site stat list at a new league
```
The whole suite is fast, so `npm run t` after any change is fine. Tests cover `src/core`, `src/shared.js`, `src/cloud.js`, `src/updater.js`, `src/github.js`, `src/troubleshoot.js`, `src/ui/keys.js`; `main.js` and the UI pages have no unit tests. For UI changes, the page can be opened in a browser with demo data (`src/ui/index.html`, see demo.js). To boot the real app on Linux: `npm install`, then `xvfb-run -a npx electron --no-sandbox .` with `HOME` set to a temp folder (the network is mostly blocked here; that is fine).

## File map
| Path | What |
|---|---|
| `src/main.js` | Main process (~1,800 lines, one shared state; deliberately not split further): config loading (`loadConfig`), state sent to the window (`buildState`), game log watching, prices, inventory reading and naming items, account/uploads, updates, hotkeys (`registerHotkeys`, `syncKeyHook`), price check + trade search, trade offers and chat lines, overlay layout (`WIDGETS`), the IPC `actions` table, startup. Sections are marked `// ---- name ----`: `grep -n '^// ----' src/main.js`, then read only that range. |
| `src/config.js` | `DEFAULT_CONFIG` (every setting's default) and `mergeTrade` |
| `src/pictures.js` | Inventory picture conversions (thumbnails, grid picture per map, back to pixels) |
| `src/preload.js` | The `window.api` bridge (getState, onState, setConfig, action, account, search...) |
| `src/ui/index.html` | Main window markup; loads theme.js in the head, then demo.js, keys.js, tradecard.js, then `app/*.js` in order |
| `src/ui/app/*.js` | Main window logic, split by page. Classic scripts sharing ONE global scope, loaded in the order of the `<script>` tags (core first, start last). Top-level names are visible to later files; code that runs while loading may only use earlier files. `api` is the global `window.api` (never redeclare it: in Electron it is fixed and `const api` breaks the page). Files: `core` (state, helpers like `$`, `esc`, `fmtValue`, `act`), `mapping` (status chips, update button, toasts, back-from-the-map line, inventory pictures, attention list, map card, loot list, best drops), `items`, `session` (+ strategy tabs, profit chart, maps table), `tools` (map check, costs, price check, trade search), `inventory`, `trade`, `render` (`render()`, `setState`, sidebar order and opening out, `showTab`, refresh buttons), `boot` (loading screen, `applyTheme`), `events` (page-wide click handler), `logcheck`, `trouble` (Troubleshooting page), `forms` (run buttons, add loot/costs), `prices`, `strategy-dialog`, `settings` (`KEY_GROUPS` = every key, the theme picker), `devtools` (Settings, Developer tools), `account`, `start` |
| `src/ui/style.css`, `tradecard.css` | Main window styles: the default Obsidian look (theme id `slate`), Inter font, shared pieces (`.panel`, `.it` item tile, `.chip`, buttons), the Mapping page (map card; left panel: session numbers, profit line, what needs a look, loot, best drops; right panel: the maps) |
| `src/ui/maps/` | Map pictures behind the map card; listed with their brightness in `MAP_PICTURES` (app/mapping.js) |
| `src/ui/themes.css`, `theme.js`, `fonts/` | Themes. theme.js is the engine (`window.Theme`: theme ids and names, Custom colours worked out from four, Automatic, animations on/off), run in the head so the last theme shows before anything is drawn. themes.css: Standard recolours, the picker's previews, and Premium Wraeclast. `fonts/`: Inter (the app's font) and Wraeclast's Cinzel and EB Garamond, OFL |
| `src/ui/demo.js` | Fake state when index.html is opened in a plain browser (preview without Electron) |
| `src/ui/keys.js` | Key names shared by page and main process |
| `src/ui/check.*` | Price check / trade search window over the game |
| `src/ui/overlay.*`, `tradecard.js` | Trade overlay over the game; how one offer is drawn |
| `src/ui/layout.*` | Layout mode (drag overlay parts, Shift+F2) |
| `src/ui/toast.*` | Short message over the game |
| `src/ui/recorder.*`, `src/recorder-preload.js` | Hidden window that records the screen to WebM for `src/recorder.js` |
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
| `src/cloud.js` | Account (with its role: '', moderator, admin), session uploads, Developer tools calls; `SERVER` = https://poeapp.divine4k.workers.dev |
| `src/troubleshoot.js` | Troubleshooting recordings: start/stop, what is kept (keys, clicks, log lines, app events, state at start and end), saved under `recordings/<id>/`, sent with `src/github.js` |
| `src/recorder.js` | Screen to video file through the hidden recorder window |
| `src/github.js` | Puts a folder into a GitHub repository as one commit (reports repository) |
| `src/core/recording.js` | Event list, state summary, the README of a recording (pure) |
| `src/updater.js` | In-app updates from `main` of this repo |
| `src/overlay.js`, `capture.js`, `chat.js`, `gamewin.js`, `http.js`, `art.js`, `leftovers.js` | Overlay windows, screen capture, typing chat lines and the copy key (`copyItem`), which window is in front, web requests, item pictures, closing stray copies |
| `server/` | Cloudflare Worker + D1 schema. Deployed by pasting `worker.js` into the dashboard (see server/README.md); a push does not deploy it |
| `test/*.test.js` | node:test unit tests; `test/server.js` fake server; `test/fixtures/` captures |

## Roles and troubleshooting
- Roles come from the server (`users.admin` = admin, `users.role` = 'moderator'). `cloud.role` in the app; `canTrouble()` / `isAdmin()` in main.js.
- Admins and moderators: the Troubleshooting page (`#tab-trouble`) and the record key (`hotkeys.record`, Shift+F9). Admins: Settings, Developer tools (`#set-dev`): reports repository, GitHub token, every user's role.
- The GitHub token and repository are kept on the server (D1 `meta`, key `github`), handed to admins and moderators when they send. Recordings go to the reports repository, not to this one.
- Admins and moderators also see everyone's recordings: `trouble.syncRemote()` looks in the reports repository once a minute (and when the page opens) and fetches facts and events of new ones; the video is fetched when one is opened (`videoFor`). Removed ones are listed in `recordings/hidden.json` so they are not fetched again.
- Written reports (`kind: 'note'` in meta.json): a note and up to 10 pictures (`image-N.png`), no video. Fixed marks are one file per recording in the reports repository, `fixed/<id>.json` (`{ fixed, by, at }`; `setFixed`, done one at a time). When you fix what a recording or report describes, add that file there too. Every GitHub request goes out with `cache: 'no-store'` (src/github.js): Chromium otherwise reuses answers for a minute, which made marks undo each other.
- Hook points that feed a recording in main.js: `say`, `push`, the log tail, `applyConfig`, the IPC `action` handler, hotkeys (`noted`), `sendChat`, `showToast`, console output, the window in front. A new thing the app does should call `trouble.event(kind, data)` there too.

## Conventions
- Settings: every setting is on the Settings page (`#tab-settings`), bound with `data-cfg="path.in.config"`, saved on change, no Save buttons. Every key goes in `KEY_GROUPS` (src/ui/app/settings.js) only. New config keys get a default in `DEFAULT_CONFIG` (src/config.js).
- Look: colours only through the variables in `:root` (style.css) or `color-mix()` of them, never fixed colours, so every theme works. Panels are one level deep: inside a `.panel`, sections are split by lines, not boxed again. Numbers sit in faint fields, item pictures in `.it` tiles. Rounding: `--r-lg` 14px panels, `--r-md` 10px buttons, `--r-sm` 7px small parts. A new theme: its id in `Theme.STANDARD` or `Theme.PREMIUM` and `Theme.NAMES` (theme.js), its colours and a `.pv-<id>` preview in themes.css. Wraeclast extras go in themes.css under `:root[data-theme=wraeclast]`; broad element rules and lists containing an id use `:where()` so they do not outweigh specific rules. The page allows no inline `style` attributes (CSP); set colours from CSS.
- Messages: `say()` in main.js shows as a small toast at the bottom right; nothing app-wide goes in a banner across the top. Status goes in a chip (`statusChips()` in app/mapping.js): short label, details in its hover text, a click that leads to the fix.
- Restarting (updates) uses `app.relaunch` with `--after-pid`; the new copy waits for the old one (`waitForExit` in leftovers.js). Do not start console programs (cmd, ping, taskkill) without `windowsHide` and no `detached`: each opens a black window.
- UI actions go through `api.action({ type, ... })` to the `actions` table in main.js; main pushes the whole state back (`push()`), the page redraws in `render()` (app/render.js).
- Plain English in user-facing text, no jargon. Comments explain why, in the same plain style.
- Nothing is typed into the game without the user's own key press or click (see README "Rules and risk"); keep it that way.

## Related
- `Divine4k/poeappitemdata`: the old shared item list. The server copied it once and now serves the list itself; the repo is no longer written to by the app.
