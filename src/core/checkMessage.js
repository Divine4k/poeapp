'use strict';
// Puts what the check key just found into a line or two for the message shown in game.
// Plain logic, no Electron.

function worth(c, divine) {
  if (!isFinite(c)) return '0c';
  const a = Math.abs(c);
  if (divine > 0 && a >= divine) return `${(c / divine).toFixed(a >= divine * 10 ? 1 : 2)} div`;
  return `${a >= 100 ? Math.round(c) : Math.round(c * 10) / 10}c`;
}

// "Saved: Vaal Orb. More words." -> "Saved: Vaal Orb" and "More words."
const firstSentence = (t) => { const i = t.indexOf('. '); return (i > 0 ? t.slice(0, i) : t).replace(/\.$/, ''); };
const restOf = (t) => { const i = t.indexOf('. '); return i > 0 ? t.slice(i + 2).trim() : ''; };

// A notice on its own: its first sentence as the headline, the rest underneath.
function noteMessage(note) {
  if (!note || !note.text) return null;
  return { title: firstSentence(note.text), detail: restOf(note.text), bad: !!note.bad };
}

// state: { mapCheck, priceCheck, notice, divine } as the app holds them. since: when the key was
// pressed; only results newer than that count. Returns { title, detail, bad } or null.
function checkMessage({ mapCheck, priceCheck, tradeCheck, notice, divine = 0 } = {}, since = 0) {
  const fresh = (x) => x && x.at >= since;
  const note = fresh(notice) ? notice : null;
  if (fresh(mapCheck)) {
    const m = mapCheck;
    const name = `${m.name}${m.tier ? ` (T${m.tier})` : ''}`;
    const verdict = m.unidentified ? 'unidentified, mods hidden' : (m.dangerCount ? `do not run: ${m.dangerCount} dangerous ${m.dangerCount === 1 ? 'mod' : 'mods'}` : 'safe to run');
    const danger = (m.mods || []).filter((x) => x.dangerous).map((x) => x.mod).join('; ');
    return { title: `${name}: ${verdict}`, detail: danger || (note ? note.text : ''), bad: !!(m.unidentified || m.dangerCount) };
  }
  if (fresh(priceCheck)) {
    const p = priceCheck;
    if (p.error) return { title: 'No item read', detail: p.error, bad: true };
    const what = `${p.name}${p.qty > 1 ? ` ×${p.qty}` : ''}`;
    const value = p.found ? `${worth(p.total, divine)}${p.qty > 1 ? ` (${worth(p.each, divine)} each)` : ''}` : '';
    // Gear is priced by a trade search, and its answer follows in a message of its own. That
    // comes before anything about counting the slot: gear is never counted as loot.
    if (!p.found && fresh(tradeCheck) && tradeCheck.filters.ok) {
      const title = tradeCheck.filters.title;
      if (tradeCheck.state === 'searching') return { title: `${title}: searching the trade site`, detail: '', bad: false };
      if (tradeCheck.state === 'idle') return { title: `${title}: not searched`, detail: 'Tick what matters on the Prices page, then press Search.', bad: false };
      if (tradeCheck.state === 'error') return { title: `${title}: not searched`, detail: tradeCheck.error, bad: true };
    }
    // Over the inventory the key also names or counts the item in that slot. Whether that
    // worked is the headline; the price follows.
    if (note) {
      // A long first sentence of the form "What happened: why" is cut at the colon, so the
      // headline stays short enough to read at a glance and the reason moves to the small print.
      let title = firstSentence(note.text), why = '';
      const colon = title.indexOf(': ');
      if (title.length > 44 && colon > 0) { why = `${title.slice(colon + 2, colon + 3).toUpperCase()}${title.slice(colon + 3)}.`; title = title.slice(0, colon); }
      return { title, detail: [why, restOf(note.text), p.found ? `${what} is worth ${value}.` : `No price found for ${what}.`].filter(Boolean).join(' '), bad: !!note.bad };
    }
    if (!p.found) return { title: `${what}: no price found`, detail: '', bad: true };
    return { title: `${what}: ${value}`, detail: '', bad: false };
  }
  if (note) return noteMessage(note);
  return null;
}

// What a finished trade search found, for the message in game.
function tradeMessage(tc, divine = 0) {
  if (!tc) return null;
  const title = tc.filters.title;
  if (tc.state === 'error') return { title: `${title}: not searched`, detail: tc.error, bad: true };
  if (tc.state !== 'done') return null;
  const s = tc.summary || {};
  if (!s.total) return { title: `${title}: nothing like it is listed`, detail: 'Untick a stat on the Prices page to widen the search.', bad: false };
  if (s.low === null) return { title: `${title}: ${s.total} listed`, detail: 'Their prices are in currencies the app has no rate for.', bad: false };
  return { title: `${title}: from ${worth(s.low, divine)}`, detail: `${s.total} listed. Middle of the cheapest ${Math.min(10, s.total)}: ${worth(s.median, divine)}.`, bad: false };
}

module.exports = { checkMessage, noteMessage, tradeMessage, worth };
