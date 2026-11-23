# Map Companion for Path of Exile 1

A second-screen app for mapping: map timer, loot value read from your inventory, map mod check, cost tracking and price lookup.

Not affiliated with or endorsed by Grinding Gear Games. Prices and item pictures come from [poe.ninja](https://poe.ninja).

## What it does

| Feature | How it gets its data |
|---|---|
| Map timer, maps run, deaths, session totals, profit per hour | Reads the game log (`Client.txt`) automatically |
| Loot value per map | Reads your inventory from the screen whenever it is open |
| Map mod check | You press Ctrl+C on a map in game, then F8 |
| Price check | Same: Ctrl+C on an item, then F8. Or search by name |
| Net profit | A cost loadout (scarabs, map, chisels) charged to every new map |

## How loot is counted

The app compares each inventory reading with the one before.

- **In a map:** anything that went up since the baseline is loot for that map.
- **Arriving in the hideout:** the first reading still counts for the map you just left.
- **After that, in the hideout:** nothing counts. Stashing, or taking scarabs out, only moves the baseline.
- **Several inventories from one map:** a map stays current until you open a different one, so every trip adds to it.

Items are recognised by their picture, and the stack number is read from the corner of the cell.

- Currency, scarabs, fragments, essences, fossils, oils and similar are recognised.
- Divination cards all share one picture, so they cannot be told apart. The same goes for maps and gems.
- Rares and uniques are not priced.
- A stack the app does not recognise shows up under the loot list with its picture. Name it once and it is recognised from then on.

## Naming items and the shared list

Items the app cannot recognise appear under the loot list with their picture. Three ways to name one, fastest first:

1. Hover it in game, press Ctrl+C, then F8. The item under your mouse gets the copied name.
2. Click one of the suggested names next to its picture.
3. Type the name, or press **Ignore** to never be asked about it again.

Named items are kept on your PC. They can also be uploaded to the shared list, which lives on the `data` branch of this repository (`items.json`) and is downloaded by every copy of the app. Uploading needs a fine-grained GitHub token limited to this repository with "Contents: read and write", pasted under Settings. The shared list holds only item names and small picture fingerprints.

## Install (Windows)

1. Install [Node.js LTS](https://nodejs.org).
2. Download this repository (Code > Download ZIP) and unzip it.
3. Double-click `start.bat`. The first start installs what it needs and takes a few minutes.

On first start the app downloads item pictures once (a few minutes in the background).

## Updating

The app checks this repository every two minutes. When a newer version has been pushed, an **Install update and restart** button appears in the top bar. Settings also has **Check for updates**. Your settings, named items and session are kept.

The updater installs whatever is on the `main` branch of `Divine4k/poeapp`, so anyone who can push there controls what gets installed.

## Game settings

- Run Path of Exile in **Windowed Fullscreen**. Exclusive fullscreen often captures as a black screen.
- F8 must not be bound to anything in game. Change it in Settings if it is.
- If your inventory key is not Tab, set it in Settings.

## Rules and risk

GGG's developer guidelines say an app may read the screen or clipboard **once per manual key press**, may read the game log, and must not send input to the game or touch its memory or files.

- This app sends nothing to the game and never touches game memory or files.
- **Reading on your inventory key** is one read per key press, so it stays inside the rule. The app listens for that one key without blocking it.
- **"Also check by itself"** (Settings, off by default) reads the screen about once a second without a key press. That breaks the rule and is your own risk. It is what catches the inventory when you open the stash with a click.
- With "check by itself" off, press your inventory key once after arriving in the hideout, before you stash.
- GGG has never officially approved any local third-party tool, so no tool is guaranteed safe.

## What has and has not been tested

- Tested on two real 1920x1080 captures: finding the grid, telling empty from filled cells, reading every stack number (68 of 68), recognising the same item across captures, and the loot counting.
- Rescaled copies of those captures (900p, 1440p, 4K) also read correctly, but real captures at those sizes have not been tried.
- **Not tested:** the app running against the live game, matching against downloaded item pictures, the key listener, and poe.ninja's live data. Expect to report problems on first use.

## Development

```
npm install
npm start      # run the app
npm test       # unit tests
```

Opening `src/ui/index.html` in a browser shows the dashboard with demo data.
