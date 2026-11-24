# Map Companion for Path of Exile 1

A second-screen app for mapping: map timer, loot value read from your inventory, map mod check, cost tracking, price lookup, trade site search for gear, and trade offers with buttons on top of the game.

Not affiliated with or endorsed by Grinding Gear Games. Prices and item pictures come from [poe.ninja](https://poe.ninja). The list of trade site stats comes from [Awakened PoE Trade](https://github.com/SnosMe/awakened-poe-trade) (MIT licence, see `src/core/data/NOTICE.md`).

## What it does

| Feature | How it gets its data |
|---|---|
| Map timer, maps run, deaths, session totals, profit per hour | Reads the game log (`Client.txt`) automatically |
| Loot value per map | Reads your inventory from the screen whenever it is open |
| Map mod check | Hover a map in game and press F8 |
| Price check | Hover any item and press F8, or browse the Prices page |
| Trade site search for rares, magic items and uniques | Hover the item and press Ctrl+F (or F8): a window opens on top of the game with its stats to tick and the cheapest listings on the official trade site |
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

- Currency, threads, fragments, essences, fossils, oils and similar are recognised automatically, as a stack or as a single item with no number on it.
- A single item is counted as one when its picture is known. Single items that are not gear or gems and have a price (emblems, invitations and the like) are learned for good when you hover one and press F8.
- Divination cards, maps, gems and uniques cannot be told apart by picture. Hover one and press F8 to count that slot.
- Rares are not priced.
- Each map shows what it could not count: click its row in the list.

## Trading

When someone whispers you from the trade site, the offer appears on the **Trade** page and as one small line on top of the game, right of the flasks: the next step, the item, the price, and Busy and Sold. The game itself outlines the item in your stash when the whisper arrives, so the app does not. Click the item's name there to open the full card with every button. Your own whispers to sellers are listed the same way.

- **Buttons:** Invite, Trade, Thanks, Kick, Busy, "Interested?" and Sold for buyers; Hideout, Trade, Thanks and Leave when you are the buyer. The gold button is the next step.
- **It follows the trade for you.** The log says when the buyer arrives and when the trade is accepted, so the gold button moves from Invite to Trade to Thanks to Kick by itself.
- **Keys:** F2 presses the gold button of the oldest offer, F3 dismisses it. Change them under Trade settings; they must not be bound in game.
- **Repeat and late buyers:** the same buyer asking twice stays one offer ("Asked 2 times"). A buyer for something you just sold is marked, and the gold button tells them it is sold.
- **Value check:** offers below 80% of the poe.ninja price, for items poe.ninja lists under the same name, are marked "Below market".
- **Finished trades** are listed with totals for today and overall, once the game reports "Trade accepted".
- **Away from the game nothing is drawn.** The overlay hides when another program is in front and comes back with the game.
- **Done by itself, if you switch it on** (Trade settings, "Done by itself", all off to begin with): after a sale, whisper thanks and kick the buyer; after a purchase, whisper thanks, leave the party and go back to your hideout; go to a seller's hideout once their party invite is accepted; leave out buyers for an item sold in the last hour; close a finished purchase after a set time. These only type while the game is the window in front. If it is not, a notice says what was not sent and the buttons are still there.
- **F5 takes you to your hideout** (types `/hideout`), as in Awakened PoE Trade. The key is only held while the game is the window in front, so F5 still refreshes a browser page. Change or clear it under Trade settings. If Awakened PoE Trade is running too, it already holds F5: pick another key in one of the two.
- **More keys**, unset until you choose them: invite, trade with, tell busy, ask "still interested" and start a whisper to the newest buyer, and show remaining monsters.
- **Ctrl+click on an offer's cross** dismisses every offer.
- **Layout mode:** Shift+F2 dims the game and shows a box for each part of the overlay. Drag a box where you want it and press Save. The small strip with Save, Cancel and Default spots can be dragged out of the way too. A box left in the lower half of the screen grows upward, one in the upper half grows downward, and the spot is kept as a share of the screen, so it survives a change of resolution. Trade settings has a button for the same thing and one to go back to the default spot.
- **Show a test offer** puts a made-up offer on screen so you can place the overlay. Test offers never type anything in the game.

The overlay sits on the screen chosen under Settings ("Screen the game runs on") and needs Windowed Fullscreen. Buttons on the overlay do not take the keyboard away from the game. Buttons on the Trade page switch to the game window first, which takes about half a second.

**The app only types when Path of Exile is the window in front.** A small helper asks Windows which program is in front; if it is not the game and the game cannot be brought forward, nothing is typed and a red notice says so. If the helper cannot run on a PC, the buttons do not type at all.

**Whispers in other languages.** A buyer's whisper is written in the language of the trade site they use, so Russian, German, French, Spanish, Portuguese, Korean and Thai whispers are listed too, with the language shown on the offer. Their wording was written from memory and has not been checked against real whispers: when a whisper does not fit, it is still listed and marked "read roughly", with the tab and slot right and the price left inside the item text. Bulk whispers in those languages are always read roughly.

**Sold per day.** The Trade page charts the value you sold on each of the last 14 days; hover a column for the day's sales and purchases.

Limits: the game itself must run in English, because arrivals, "Trade accepted" and the other system lines are only recognised in English.

## Trade site search

Gear has no poe.ninja price, so the app asks the official trade site instead, the way Awakened PoE Trade does. Hover a rare, magic or unique item (armour, weapons, jewellery, jewels, flasks) and press Ctrl+F or F8.

- **Two keys.** **Ctrl+F** is the price check key: it only checks the price and never names or counts anything. **F8** checks the price too and, over the inventory, also names or counts the item in that slot for the loot list. Ctrl+F is held only while the game is the window in front, so it still finds text in a browser. In game it replaces the game's own Ctrl+F (jump to the stash search box) while the app runs: change or clear the key in Settings if you use that.
- **The window in game.** The search opens on top of the game, left of the inventory for an item in the inventory and right of the stash for an item in the stash. It is part of the same overlay as the trade offers: in layout mode (Shift+F2) drag the "Price check" box to have it always open where you put it; "Back to the default spots" returns it to the side of the item. Under the item's name it gives the answer in large figures (cheapest, typical, how many listed). Below that are buttons for the kind of item, corrupted or not and the like (lit when they are part of the search), the stats with tick boxes and + and - (or the mouse wheel) to move a number, Search, the listings, and a link to the trade site. It never takes the keyboard, so the game keeps your keys while you click it; for the same reason numbers cannot be typed in it. Exact numbers and a highest value can be typed on the app's Prices page, which shows the same search.
- **Closing it.** The cross closes it. It also closes when the mouse leaves it after you have used it, when you check another item, when you switch away from the game, and by itself after 15 seconds if the mouse never went to it. It needs Windowed Fullscreen, like the rest of the overlay. Untick "Show the search on top of the game" on the Prices page to use only that page.

- **What is searched for.** The Prices page lists everything read from the item with a tick box each. Ticked from the start: the kind of item, corrupted or not, total maximum Life and total Elemental Resistance (the trade site's own totals, so 40 fire and 30 cold counts the same as 70 cold), influences, fractured modifiers, six links, a weapon's higher damage per second, movement speed of 25% or more on boots, and a cluster jewel's size and notables. Everything else is listed unticked.
- **Numbers.** Each stat starts a tenth below your item's value. Change the lowest and highest value in the boxes beside it.
- **Searched straight away.** Ctrl+F searches as soon as you press it, with what is ticked from the start, so the prices and listings are there when the window opens. Change the ticks or numbers and press **Search** to search again. F8, which is also pressed just to count loot, searches straight away only for a rare or magic item with something ticked; a unique shows its poe.ninja price and waits for the button. Untick "Search straight away" on the Prices page to always wait for the button.
- **What comes back.** The cheapest price, the typical price (the middle one of the cheapest ten, which a single underpriced item does not move) and how many are listed, then each listing: price, how long it has been listed, whether the seller is online or it is an instant buyout, and the seller. The window in game and the Prices page show the same; with the window switched off, a short message in game gives the totals. Listings marked "Instant buyout" are in a merchant's tab and are bought in the seller's hideout. A link opens the same search on the trade site.
- **Limits of the trade site.** Each search is two web requests. The site allows only a few per minute and locks out anyone who goes over, so the app keeps count from the site's own answers, never sends two searches within two seconds, and refuses a search rather than queue it: it says how many seconds to wait. The same search within a minute is answered from memory.
- **Uniques.** Every copy of a unique has the same modifiers, so what tells one from another is how they rolled. As in Awakened PoE Trade, the modifiers that can roll differently are ticked, each a tenth of its possible range below your roll (17 Strength out of 10 to 20 asks for 16). Life and resistances are searched as their totals. On a corrupted unique the modifiers that are normally fixed are ticked too, since a corruption can change them, and so is the corruption's own implicit. Modifiers that never change are listed unticked.
- **Stats or Base item.** For a rare or magic item the window has two tabs. **Stats** searches for items with stats like yours and is what opens. **Base item** searches for the base itself, to craft on: this base type at this item level (86 at most, as nothing rolls better above it), with its influences and any fractured modifier, whatever else is rolled on it. A tab only sets the ticks; change any of them, then press Search.
- **Tiers.** Each modifier shows its tier (T1 is the best it can be); a total shows the tiers of the modifiers that went into it. Crafted modifiers and implicits have none.
- **Both item texts are read.** The app asks the game for its fuller item text (rolled ranges, and a line above each modifier with its name and tier); the short one, from pressing Ctrl+C yourself, gives the same stats without tiers and, for a magic item, without its base type. The fuller one also says which implicit comes from a corruption, and that stat is then marked "corruption".
- **"Reduced" stats** are searched as written: "4% reduced Fire Damage taken" asks for at least 4% reduced.
- **Not read yet:** modifiers the trade site has no entry for are listed as "not searchable". Sockets by colour, quality, gems, maps and currency are not searched; those keep their poe.ninja price.
- **New league.** New modifiers need a new stat list: `node scripts/build-stats.js path/to/awakened-poe-trade/renderer/public/data/en/stats.ndjson`.

## Naming items and the shared list

Items the app cannot recognise are kept on the Items page with their picture, also after they have left your inventory. Three ways to name one, fastest first:

1. Hover it in game and press F8. The item under your mouse gets the name the game reports.
2. Click one of the suggested names next to its picture.
3. Type the name, or press **Ignore** to never be asked about it again.

Named items are kept on your PC. They can also be uploaded to the shared list, which lives on the `data` branch of this repository (`items.json`) and is downloaded by every copy of the app. Uploading needs a fine-grained GitHub token limited to this repository with "Contents: read and write", pasted under Settings. The shared list holds only item names and small picture fingerprints.

## Install (Windows)

1. Open the [Releases page](https://github.com/Divine4k/poeapp/releases) and download `MapCompanion-Setup.exe` from the newest release.
2. Run it. You can choose where it is installed. It adds a "Map Companion" shortcut to the Desktop and the Start menu.
3. Windows may warn that the publisher is unknown, because the installer is not code-signed. Choose "More info", then "Run anyway".

Updates arrive inside the app (bottom of the sidebar). Pick an install folder your Windows account can write to (the default is fine); in a protected folder such as Program Files the app cannot update itself.

On first start the app downloads item pictures once (a few minutes in the background).

### Running from the source instead

Install [Node.js LTS](https://nodejs.org), download this repository as a ZIP, unzip it and double-click `start.bat`.

## Updating

The app checks this repository every two minutes. When a newer version has been pushed, the **Check for updates** button at the bottom of the sidebar turns into **Install update**. Clicking it at any other time checks right away. Your settings, named items and session are kept.

The updater installs whatever is on the `main` branch of `Divine4k/poeapp`, so anyone who can push there controls what gets installed.

Only one copy of the app runs at a time. When it starts, it closes any copy of itself that was left running without a window (an interrupted restart can leave one behind, still holding the hotkeys) and says so in a notice.

## Game settings

- Run Path of Exile in **Windowed Fullscreen**. Exclusive fullscreen often captures as a black screen.
- Ctrl+F is taken from the game for the price check while the app runs (see Trade site search).
- F8 and F9 must not be bound to anything in game, and neither must the trade keys F2, F3 and Shift+F2. Change them in Settings (trade keys: Trade, Trade settings) if they are.
- After F8, a short message shows in game for about two seconds: the item and its value, a map's verdict, or why nothing was read. It can be moved in layout mode (Shift+F2) and switched off in Settings.
- F9 sends a report of what the app sees (the inventory slots, how each was read) to the `data` branch of this repository under `reports/`, for troubleshooting. That needs the GitHub token from Settings; without one the report is kept in the app's own folder.
- If your inventory key is not Tab, set it in Settings.

## Rules and risk

GGG's developer guidelines say an app may read the screen or clipboard **once per manual key press**, may send **one action to the game per manual key press**, may read the game log, and must not touch the game's memory or files.

- The app never touches game memory or files.
- **F8** and **Ctrl+F** send a single Ctrl+Alt+C to the game when you press them (with Alt the game copies its fuller item text, as Awakened PoE Trade asks for), then read the clipboard once. That is the same pattern price-check tools use. You can switch the copying off in Settings and press Ctrl+C yourself.
- **Reading on your inventory key** is one read per key press. The app listens for that one key without blocking it.
- **The trade site search** sends nothing to the game beyond the one copy of the key press. It reads the clipboard once per press of Ctrl+F or F8, like the price check, and talks to the trade site's public search within the limits the site sets.
- **Trade buttons and trade keys** type one chat line (such as `/invite Name`) per click or key press, the way PoE Lurker and Awakened PoE Trade do. Nothing is typed without a click or key press, and no button sends two lines.
- **"Done by itself"** (Trade settings, off by default) types thanks, kick, leave and hideout lines after a trade without a key press, as PoE Lurker does. That is outside the one-action-per-key-press rule and is your own risk.
- **"Also check by itself"** (Settings, off by default) reads the screen about once a second without a key press. That breaks the rule and is your own risk. It is what catches the inventory when you open the stash with a click.
- With "check by itself" off, press your inventory key once after arriving in the hideout, before you stash.
- GGG has never officially approved any local third-party tool, so no tool is guaranteed safe.

## What has and has not been tested

- Tested on two real 1920x1080 captures: finding the grid, telling empty from filled cells, reading every stack number (68 of 68), recognising the same item across captures, and the loot counting.
- Rescaled copies of those captures (900p, 1440p, 4K) also read correctly, but real captures at those sizes have not been tried.
- **Trading:** the whisper reading, the steps of a trade and the overlay windows were run on Linux against a made-up log. The helper that tells which window is in front, switching to the game window, and hiding on alt-tab are Windows-only and have not been run by the author.
- **Trade site search:** reading items, matching their stats, building the search and keeping to the site's limits were run against made-up items and a stand-in for the trade site. No search has been sent to the real trade site by the author, so the first real one may show a problem. The window in game was looked at in a browser and its placement and closing rules were tested, but it has not been run on top of the game.
- **Not tested:** the app running against the live game, matching against downloaded item pictures, the key listener, and poe.ninja's live data. Expect to report problems on first use.

## Development

```
npm install
npm start      # run the app
npm test       # unit tests
```

Opening `src/ui/index.html` in a browser shows the dashboard with demo data.
