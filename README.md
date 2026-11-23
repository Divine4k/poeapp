# Map Companion for Path of Exile 1

A second-screen app for mapping: map timer, loot value read from your inventory, map mod check, cost tracking, price lookup, and trade offers with buttons on top of the game.

Not affiliated with or endorsed by Grinding Gear Games. Prices and item pictures come from [poe.ninja](https://poe.ninja).

## What it does

| Feature | How it gets its data |
|---|---|
| Map timer, maps run, deaths, session totals, profit per hour | Reads the game log (`Client.txt`) automatically |
| Loot value per map | Reads your inventory from the screen whenever it is open |
| Map mod check | Hover a map in game and press F8 |
| Price check | Hover any item and press F8, or browse the Prices page |
| Net profit | A cost loadout (scarabs, map, chisels) charged to every new map |
| What was counted per map | The inventory picture from each map is kept and shown beside the timer and under the map's row |
| Trade offers with an overlay on the game | Reads trade whispers from the game log; each button types one chat line |
| Session history | **Start new session** saves the finished one; pick it from the row of sessions on the Mapping page to see its totals and maps |
| Strategies | Tabs on the Mapping page, each with a name, an atlas tree link and its own sessions |

## How loot is counted

The app compares each inventory reading with what was there when you entered the map.

- **In a map:** anything that went up since then is loot for that map.
- **Back in the hideout:** each slot counts the first time it is seen after you arrive. Tooltips and stashing mean the inventory is rarely fully visible at once, and this way it does not have to be. A slot first seen empty that fills up later is a withdrawal, not loot.
- **Entering the next map:** what is in the inventory then becomes the new starting point, whether you stashed or not.
- **Several inventories from one map:** a map stays current until you open a different one, so every trip adds to it.

Items are recognised by their picture, and the stack number is read from the corner of the slot.

- Currency, threads, fragments, essences, fossils, oils and similar are recognised automatically.
- Divination cards, maps, gems and uniques cannot be told apart by picture. Hover one and press F8 to count that slot.
- Rares are not priced.
- Each map shows what it could not count, and is marked "incomplete" in the list.

## Trading

When someone whispers you from the trade site, the offer appears on the **Trade** page and as one small line on top of the game, right of the flasks: the next step, the item and the price. Click the item's name there to open the full card with every button. Your own whispers to sellers are listed the same way.

- **Buttons:** Invite, Trade, Thanks, Kick, Busy, "Interested?" and Sold for buyers; Hideout, Trade, Thanks and Leave when you are the buyer. The gold button is the next step.
- **It follows the trade for you.** The log says when the buyer arrives and when the trade is accepted, so the gold button moves from Invite to Trade to Thanks to Kick by itself.
- **Keys:** F2 presses the gold button of the oldest offer, F3 dismisses it. Change them under Trade settings; they must not be bound in game.
- **Repeat and late buyers:** the same buyer asking twice stays one offer ("Asked 2 times"). A buyer for something you just sold is marked, and the gold button tells them it is sold.
- **Value check:** offers below 80% of the poe.ninja price, for items poe.ninja lists under the same name, are marked "Below market".
- **Finished trades** are listed with totals for today and overall, once the game reports "Trade accepted".
- **The item's slot is framed in your stash** when you invite a buyer, when they arrive, and when you press Locate (the square on the overlay). The frame is in the right place for a normal or a quad tab at any screen size; if a quad tab is framed as a normal one, press the Normal tab / Quad tab button on the card once and the app remembers it. Stash tabs inside a folder sit a row lower and are not handled yet.
- **Away from the game nothing is drawn.** The overlay and the frame hide when another program is in front and come back with the game.
- **Show a test offer** puts a made-up offer on screen so you can place the overlay. Test offers never type anything in the game.

The overlay sits on the screen chosen under Settings ("Screen the game runs on") and needs Windowed Fullscreen. Buttons on the overlay do not take the keyboard away from the game. Buttons on the Trade page switch to the game window first, which takes about half a second.

**The app only types when Path of Exile is the window in front.** A small helper asks Windows which program is in front; if it is not the game and the game cannot be brought forward, nothing is typed and a red notice says so. If the helper cannot run on a PC, the buttons do not type at all.

Limits: only English trade whispers are recognised.

## Naming items and the shared list

Items the app cannot recognise appear under the loot list with their picture. Three ways to name one, fastest first:

1. Hover it in game and press F8. The item under your mouse gets the name the game reports.
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
- F8 and F9 must not be bound to anything in game, and neither must the trade keys F2 and F3. Change them in Settings (trade keys: Trade, Trade settings) if they are.
- F9 sends a report of what the app sees (the inventory slots, how each was read) to the `data` branch of this repository under `reports/`, for troubleshooting. That needs the GitHub token from Settings; without one the report is kept in the app's own folder.
- If your inventory key is not Tab, set it in Settings.

## Rules and risk

GGG's developer guidelines say an app may read the screen or clipboard **once per manual key press**, may send **one action to the game per manual key press**, may read the game log, and must not touch the game's memory or files.

- The app never touches game memory or files.
- **F8** sends a single Ctrl+C to the game when you press it, then reads the clipboard once. That is the same pattern price-check tools use. You can switch the Ctrl+C off in Settings and press it yourself.
- **Reading on your inventory key** is one read per key press. The app listens for that one key without blocking it.
- **Trade buttons and trade keys** type one chat line (such as `/invite Name`) per click or key press, the way PoE Lurker and Awakened PoE Trade do. Nothing is typed without a click or key press, and no button sends two lines.
- **"Also check by itself"** (Settings, off by default) reads the screen about once a second without a key press. That breaks the rule and is your own risk. It is what catches the inventory when you open the stash with a click.
- With "check by itself" off, press your inventory key once after arriving in the hideout, before you stash.
- GGG has never officially approved any local third-party tool, so no tool is guaranteed safe.

## What has and has not been tested

- Tested on two real 1920x1080 captures: finding the grid, telling empty from filled cells, reading every stack number (68 of 68), recognising the same item across captures, and the loot counting.
- Rescaled copies of those captures (900p, 1440p, 4K) also read correctly, but real captures at those sizes have not been tried.
- **Trading:** the whisper reading, the steps of a trade and the overlay windows were run on Linux against a made-up log, and the stash frame was checked against two 1920x1080 screenshots. The helper that tells which window is in front, switching to the game window, and hiding on alt-tab are Windows-only and have not been run by the author.
- **Not tested:** the app running against the live game, matching against downloaded item pictures, the key listener, and poe.ninja's live data. Expect to report problems on first use.

## Development

```
npm install
npm start      # run the app
npm test       # unit tests
```

Opening `src/ui/index.html` in a browser shows the dashboard with demo data.
