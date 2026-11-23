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

// state: { mapCheck, priceCheck, notice, divine } as the app holds them. since: when the key was
// pressed; only results newer than that count. Returns { title, detail, bad } or null.
function checkMessage({ mapCheck, priceCheck, notice, divine = 0 } = {}, since = 0) {
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
    // Over the inventory the key also names or counts the item in that slot. Whether that
    // worked is the headline; the price follows.
    if (note) {
      return { title: firstSentence(note.text), detail: [p.found ? `${what} is worth ${value}.` : `No price found for ${what}.`, restOf(note.text)].filter(Boolean).join(' '), bad: !!note.bad };
    }
    if (!p.found) return { title: `${what}: no price found`, detail: '', bad: true };
    return { title: `${what}: ${value}`, detail: '', bad: false };
  }
  if (note) return { title: note.bad ? 'Nothing read' : 'Done', detail: note.text, bad: !!note.bad };
  return null;
}

module.exports = { checkMessage, worth };
