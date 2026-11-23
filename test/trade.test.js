'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLine } = require('../src/core/clientLog');
const { parseTradeMessage, priceChaos, chatCommand, nextAction, TradeBook, overlayBounds, stashCellRect, overlayAllowed } = require('../src/core/trade');
const { GameWatch, isGameName } = require('../src/gamewin');

const line = (rest) => `2026/11/23 15:00:01 123456 cff945b9 [INFO Client 4321] ${rest}`;
const PRICED = 'Hi, I would like to buy your Tabula Rasa Simple Robe listed for 12 chaos in Standard (stash tab "Sell"; position: left 3, top 5)';
const BULK = "Hi, I'd like to buy your 400 Chaos Orb for my 1.5 Divine Orb in Hardcore Settlers";
const prices = { get: (n) => ({ 'Chaos Orb': { chaos: 1 }, 'Divine Orb': { chaos: 200 } }[n] || null) };
const whisper = (player, text, dir = 'in', ts = 1000) => ({ type: 'whisper', dir, player, text, ts });

test('log lines: whispers, joining, trade results, AFK', () => {
  assert.deepEqual(parseLine(line(`@From <GUILD> Buyer_One: ${PRICED}`)), { type: 'whisper', ts: new Date(2026, 10, 23, 15, 0, 1).getTime(), dir: 'in', player: 'Buyer_One', text: PRICED });
  const out = parseLine(line(`@To Seller: ${BULK}`));
  assert.equal(out.dir, 'out'); assert.equal(out.player, 'Seller');
  assert.deepEqual([parseLine(line(': Buyer_One has joined the area.')).type, parseLine(line(': Buyer_One has left the area.')).type], ['joined', 'left']);
  assert.equal(parseLine(line(': Buyer_One has joined the area.')).name, 'Buyer_One');
  assert.equal(parseLine(line(': Trade accepted.')).result, 'accepted');
  assert.equal(parseLine(line(': Trade cancelled.')).result, 'cancelled');
  assert.equal(parseLine(line(': AFK mode is now ON. Autoreply "This player is AFK."')).on, true);
  // Chat in a public channel can not pass for a system line or a whisper.
  assert.equal(parseLine(line('#Troll: Trade accepted.')), null);
  assert.equal(parseLine(line('$Troll: @From Bob: hi')), null);
});

test('trade messages: priced, unpriced, bulk, and ordinary chat', () => {
  assert.deepEqual(parseTradeMessage(PRICED), { item: 'Tabula Rasa Simple Robe', qty: 1, price: { amount: 12, currency: 'chaos' }, league: 'Standard', tab: 'Sell', left: 3, top: 5, note: '' });
  const un = parseTradeMessage('Hi, I would like to buy your Level 21 Vaal Grace in Hardcore Settlers (stash tab "~b/o 1 in"; position: left 12, top 1) can you do 5c?');
  assert.equal(un.item, 'Level 21 Vaal Grace'); assert.equal(un.price, null); assert.equal(un.league, 'Hardcore Settlers');
  assert.equal(un.tab, '~b/o 1 in'); assert.equal(un.note, 'can you do 5c?');
  assert.deepEqual(parseTradeMessage(BULK), { item: 'Chaos Orb', qty: 400, price: { amount: 1.5, currency: 'Divine Orb' }, league: 'Hardcore Settlers', tab: '', left: 0, top: 0, note: '' });
  // Both as the trade site writes it today and with the full stop older versions added.
  const map = parseTradeMessage("Hi, I'd like to buy your 1 Map (Tier 16) (Memory-Influenced) for my 35 Chaos Orb in Covens");
  assert.equal(map.item, 'Map (Tier 16) (Memory-Influenced)'); assert.equal(map.league, 'Covens'); assert.equal(map.price.amount, 35);
  const dotted = parseTradeMessage(`${BULK}. got more?`);
  assert.equal(dotted.league, 'Hardcore Settlers'); assert.equal(dotted.note, 'got more?');
  assert.equal(parseTradeMessage('Hi, I would like to buy your Dragon Call, Kinetic Wand listed for 5 chaos in Covens (stash tab "~price 5 chaos"; position: left 15, top 14)').item, 'Dragon Call, Kinetic Wand');
  assert.equal(parseTradeMessage('hey, are you there?'), null);
  assert.equal(priceChaos({ amount: 1.5, currency: 'Divine Orb' }, prices), 300);
  assert.equal(priceChaos({ amount: 2, currency: 'divine' }, prices), 400);
  assert.equal(priceChaos({ amount: 2, currency: 'shekels' }, prices), null);
});

test('chat lines: one line each, nothing a whisper could smuggle in', () => {
  const o = { player: 'Buyer_One', item: 'Tabula Rasa', qty: 1, price: { amount: 12, currency: 'chaos' } };
  assert.equal(chatCommand('invite', o), '/invite Buyer_One');
  assert.equal(chatCommand('trade', o), '/tradewith Buyer_One');
  assert.equal(chatCommand('hideout', o), '/hideout Buyer_One');
  assert.equal(chatCommand('leave', o, { characterName: 'Me_Myself' }), '/kick Me_Myself');
  assert.equal(chatCommand('leave', o), '/leave');
  assert.equal(chatCommand('still', o), '@Buyer_One Hi, are you still interested in Tabula Rasa for 12 chaos?');
  assert.equal(chatCommand('sold', { ...o, item: 'x\n/kick Friend' }, { messages: { sold: 'gone: {item}' } }), '@Buyer_One gone: x /kick Friend');
  assert.equal(chatCommand('invite', { ...o, player: 'a b' }), null);
  assert.equal(chatCommand('invite', { ...o, player: '/oos' }), null);
  assert.equal(chatCommand('dance', o), null);
});

test('a sale from whisper to thanks', () => {
  const b = new TradeBook();
  const o = b.onLog(whisper('Buyer_One', PRICED));
  assert.equal(o.state, 'new'); assert.equal(nextAction(o), 'invite');
  assert.equal(b.onLog(whisper('Buyer_One', 'ok thanks')), false);
  // The same buyer asking again is the same offer, not a second card.
  assert.equal(b.onLog(whisper('Buyer_One', PRICED, 'in', 2000)), true);
  assert.equal(b.offers.length, 1); assert.equal(b.offers[0].asks, 2);

  b.applied(o.id, 'invite');
  assert.equal(nextAction(b.get(o.id)), null);
  b.onLog({ type: 'joined', name: 'Buyer_One' });
  assert.equal(nextAction(b.get(o.id)), 'trade');
  b.applied(o.id, 'trade', 3000);
  b.onLog({ type: 'trade', result: 'cancelled' });
  assert.equal(b.get(o.id).state, 'here');
  b.applied(o.id, 'trade', 4000);
  assert.equal(b.onLog({ type: 'trade', result: 'accepted', ts: 5000 }), true);
  assert.equal(nextAction(b.get(o.id)), 'thanks');
  b.applied(o.id, 'thanks');
  assert.equal(nextAction(b.get(o.id)), 'kick');
  b.applied(o.id, 'kick');
  assert.equal(b.offers.length, 0);

  const s = b.summary(prices, 6000);
  assert.equal(s.history.length, 1);
  assert.equal(s.history[0].value, 12);
  assert.deepEqual(s.totals.soldAll, { count: 1, chaos: 12, unpriced: 0 });
  assert.equal(s.totals.boughtAll.count, 0);
});

test('a second buyer for an item that just sold is flagged', () => {
  const b = new TradeBook();
  const first = b.onLog(whisper('Buyer_One', PRICED));
  const second = b.onLog(whisper('Buyer_Two', PRICED));
  b.applied(first.id, 'invite'); b.onLog({ type: 'joined', name: 'Buyer_One' });
  b.applied(first.id, 'trade');
  b.onLog({ type: 'trade', result: 'accepted', ts: 5000 });
  assert.equal(b.get(second.id).soldAlready, true);
  assert.equal(nextAction(b.get(second.id)), 'sold');
  const late = b.onLog(whisper('Buyer_Three', PRICED, 'in', 6000));
  assert.equal(late.soldAlready, true);
  // Once the buyer has left after the trade, their card goes by itself.
  b.onLog({ type: 'left', name: 'Buyer_One' });
  assert.equal(b.get(first.id), null);
});

test('"Trade accepted" with nobody to pin it on changes nothing', () => {
  const b = new TradeBook();
  b.onLog(whisper('Buyer_One', PRICED));
  assert.equal(b.onLog({ type: 'trade', result: 'accepted' }), false);
  assert.equal(b.history.length, 0);
});

test('buying: hideout, then thanks and leave after the trade', () => {
  const b = new TradeBook();
  const o = b.onLog(whisper('Seller', BULK, 'out'));
  assert.equal(nextAction(o), 'hideout');
  b.applied(o.id, 'hideout');
  assert.equal(nextAction(b.get(o.id)), null);
  b.onLog({ type: 'trade', result: 'accepted', ts: 9000 });
  assert.equal(nextAction(b.get(o.id)), 'thanks');
  const s = b.summary(prices, 9500);
  assert.deepEqual(s.totals.boughtAll, { count: 1, chaos: 300, unpriced: 0 });
  // 400 chaos for 1.5 divine (300c) is a fine deal for the buyer, and it is not our listing.
  assert.equal(s.offers[0].market, 400);
  assert.equal(s.offers[0].low, false);
});

test('summary: market value, low offers, quad tabs, saving', () => {
  const b = new TradeBook();
  b.onLog(whisper('Flipper', "Hi, I'd like to buy your 1 Divine Orb for my 120 Chaos Orb in Standard."));
  b.onLog(whisper('Buyer', 'Hi, I would like to buy your Mageblood Heavy Belt listed for 180 divine in Standard (stash tab "Big"; position: left 14, top 2)'));
  b.onLog(whisper('Other', 'Hi, I would like to buy your Headhunter Leather Belt listed for 30 divine in Standard (stash tab "Big"; position: left 2, top 2)'));
  b.onLog({ ...whisper('Tester', PRICED), test: true });
  const s = b.summary(prices, 2000);
  assert.equal(s.offers[0].low, true); // 120c offered for something worth 200c
  assert.equal(s.offers[1].grid, 24);
  assert.equal(s.offers[2].grid, 24); // same tab, so the same size
  assert.equal(s.offers[3].grid, 12);

  const again = new TradeBook();
  again.restore(JSON.parse(JSON.stringify(b.toJSON())), 2000);
  assert.equal(again.offers.length, 3); // the test offer is not kept
  assert.equal(again.quadTabs.has('Big'), true);
  const old = new TradeBook();
  old.restore(JSON.parse(JSON.stringify(b.toJSON())), 2000 + 31 * 60000);
  assert.equal(old.offers.length, 0);
  new TradeBook().restore('nonsense');
});

test('catching up after a restart: recent lines once, old lines never', () => {
  const now = 100 * 60000;
  const events = [
    whisper('Old_Buyer', PRICED, 'in', now - 40 * 60000),
    whisper('Buyer_One', PRICED, 'in', now - 3 * 60000),
    { type: 'joined', name: 'Buyer_One', ts: now - 2 * 60000 },
    { type: 'trade', result: 'accepted', ts: now - 60000 },
    whisper('Buyer_Two', BULK, 'in', now - 30000),
    { type: 'area', ts: now - 1000 },
  ];
  const b = new TradeBook();
  assert.equal(b.catchUp(events, now), 4);
  assert.deepEqual(b.offers.map((o) => `${o.player}:${o.state}`), ['Buyer_One:done', 'Buyer_Two:new']);
  assert.equal(b.history.length, 1);
  // The same lines again, after saving and loading: nothing is counted twice.
  const again = new TradeBook();
  again.restore(JSON.parse(JSON.stringify(b.toJSON())), now);
  assert.equal(again.catchUp(events, now), 0);
  assert.equal(again.history.length, 1); assert.equal(again.offers.length, 2);
});

test('overlay placement stays on the game screen', () => {
  const display = { bounds: { x: 1920, y: 0, width: 1920, height: 1080 } };
  // Default: right of the flasks, growing upward from just above the experience bar.
  const bottom = overlayBounds(display, 120, {});
  assert.deepEqual(bottom, { x: 1920 + 562, y: 933, width: 330, height: 120 });
  const top = overlayBounds(display, 120, { position: 'top' });
  assert.deepEqual(top, { x: 1920 + 795, y: 65, width: 330, height: 120 });
  const pushed = overlayBounds(display, 300, { position: 'right', offsetX: 50, offsetY: 90 });
  assert.equal(pushed.x + pushed.width, 1920 + 1920);
  assert.equal(pushed.y + pushed.height, 1080);
  assert.equal(overlayBounds(display, 5000, {}).height, 756);
});

test('stash slots: measured on 1080p, scaled by screen height', () => {
  const hd = { bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
  // Normal tab: the grid lines in the screenshot are at x 16, 69, 121... and y 134, 186, 239...
  assert.deepEqual(stashCellRect(hd, 12, 1, 1), { x: 13, y: 131, width: 59, height: 59 });
  const last = stashCellRect(hd, 12, 12, 12);
  assert.equal(last.x + last.width - 3, 648); assert.equal(last.y + last.height - 3, 766);
  // Quad tab, the slot from the whisper "left 15, top 14".
  assert.deepEqual(stashCellRect(hd, 24, 15, 14), { x: 382, y: 473, width: 32, height: 32 });
  // 1440p on a second screen to the right.
  const qhd = stashCellRect({ bounds: { x: 1920, y: 0, width: 2560, height: 1440 } }, 12, 1, 1);
  assert.deepEqual(qhd, { x: 1920 + 18, y: 176, width: 76, height: 76 });
});

test('the overlay hides when another program is in front', () => {
  assert.equal(overlayAllowed({ known: true, game: true, own: false }), true);
  assert.equal(overlayAllowed({ known: true, game: false, own: true }), true); // this app's own window
  assert.equal(overlayAllowed({ known: true, game: false, own: false }), false);
  assert.equal(overlayAllowed({ known: false, game: false, own: false }), true); // nothing to go on
});

test('front window helper: only a fresh report of the game counts', async () => {
  const w = new GameWatch();
  assert.equal(w.gameInFront(), false);
  w.report('chrome', 1000);
  assert.equal(w.gameInFront(1100), false);
  w.report('PathOfExileSteam', 2000);
  assert.equal(w.gameInFront(2100), true);
  assert.equal(w.gameInFront(2000 + 5000), false); // the helper went quiet
  assert.equal(isGameName('PathOfExile_x64'), true); assert.equal(isGameName('firefox'), false); assert.equal(isGameName(''), false);
  // A report from before the switch was asked for is not proof of anything.
  w.report('PathOfExile', Date.now() - 500);
  assert.equal(await w.waitForGame(150, Date.now()), false);
  setTimeout(() => w.report('PathOfExile'), 40);
  assert.equal(await w.waitForGame(1000, Date.now()), true);
});
