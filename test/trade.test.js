'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLine } = require('../src/core/clientLog');
const { parseTradeMessage, priceChaos, chatCommand, nextAction, TradeBook, overlayBounds } = require('../src/core/trade');

const line = (rest) => `2026/11/23 15:00:01 123456 cff945b9 [INFO Client 4321] ${rest}`;
const PRICED = 'Hi, I would like to buy your Tabula Rasa Simple Robe listed for 12 chaos in Standard (stash tab "Sell"; position: left 3, top 5)';
const BULK = "Hi, I'd like to buy your 400 Chaos Orb for my 1.5 Divine Orb in Hardcore Settlers.";
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

test('overlay placement stays on the game screen', () => {
  const display = { bounds: { x: 1920, y: 0, width: 1920, height: 1080 } };
  const top = overlayBounds(display, 300, { position: 'top' });
  assert.deepEqual(top, { x: 1920 + 730, y: 65, width: 460, height: 300 });
  const bottom = overlayBounds(display, 300, { position: 'bottom' });
  assert.equal(bottom.y + bottom.height, 821);
  const pushed = overlayBounds(display, 300, { position: 'right', offsetX: 50, offsetY: 90 });
  assert.equal(pushed.x + pushed.width, 1920 + 1920);
  assert.equal(pushed.y + pushed.height, 1080);
  assert.equal(overlayBounds(display, 5000, {}).height, 756);
});
