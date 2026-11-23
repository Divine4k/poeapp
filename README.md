# Map Companion for Path of Exile 1

A second-screen app for mapping: map timer, loot value, map mod check, cost tracking and price lookup.

Not affiliated with or endorsed by Grinding Gear Games. Prices come from [poe.ninja](https://poe.ninja).

## What it does

| Feature | How it gets its data |
|---|---|
| Map timer, maps run, deaths, session totals, profit per hour | Reads the game log (`Client.txt`) automatically |
| Loot value per map | Screen scan of loot labels, on a hotkey (F7) or on a timer |
| Map mod check | You press Ctrl+C on a map in game, then F8 |
| Price check | Same: Ctrl+C on an item, then F8. Or search by name |
| Net profit | A cost loadout (scarabs, map, chisels) charged to every new map |

## Install (Windows)

1. Install [Node.js LTS](https://nodejs.org).
2. Download this repository (Code > Download ZIP) and unzip it.
3. Double-click `start.bat`. The first start installs what it needs and takes a few minutes.

The first screen scan downloads the text reader's English data (about 10 MB), so it needs internet once.

## Game settings

- Run Path of Exile in **Windowed Fullscreen**. Exclusive fullscreen often captures as a black screen.
- Use a loot filter with clear, readable labels. Bigger label text reads better.
- F7 and F8 must not be bound to anything in game. Change them in Settings if they are.

## Using it

- Enter a map: the timer starts. Go to your hideout: it pauses. Open a different map: the previous one is closed and a new one starts.
- Press **F7** when drops are on screen. Every priced label on screen is added to the current map. Press it once per loot pile, before you pick it up. "Undo scan" removes the last scan.
- **Timed scanning** (Settings, off by default) scans by itself while you are in a map. A label that disappears close to your character counts as picked up.
- Open **Settings** and tick the map mods your build cannot run. Then Ctrl+C a map and press **F8**.
- In the **Costs** tab, list what you put into every map.

## Rules and risk

GGG's developer guidelines say an app may read the screen or clipboard **once per manual key press**, may read the game log, and must not send input to the game or touch its memory or files.

- This app sends nothing to the game and never touches game memory or files.
- The hotkey scan, the clipboard check and the log reading stay inside those rules.
- **Timed scanning does not.** It reads the screen without a key press. It is off by default, and switching it on is your own risk.
- GGG has never officially approved any local third-party tool, so no tool is guaranteed safe.

## Limits

- The screen scan and log handling have been unit tested, but **not yet tested against the live game**. Expect to tune things on first use.
- Screen reading makes mistakes. It can miss labels, and timed mode can count a label as picked up when it was only hidden. Use Remove or Undo to correct it.
- Unidentified uniques only show their base type, so the scan cannot price them. Rares are not priced at all.
- Exact, automatic loot tracking needs GGG's account API. GGG is not accepting new app registrations at the moment, so it is not included.
- Prices refresh every 30 minutes.

## Development

```
npm install
npm start      # run the app
npm test       # unit tests for the logic in src/core
```

Opening `src/ui/index.html` in a browser shows the dashboard with demo data.
