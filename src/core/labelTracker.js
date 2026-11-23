'use strict';
// Turns OCR results from successive screen captures into loot events.
//
// A label that shows up in `confirmFrames` captures in a row is reported as "seen".
// A seen label that then disappears while close to the character (screen centre) is reported
// as a probable "pickup". Labels that leave near the screen edge, or that all vanish at once
// (label toggle, loading screen, alt-tab), are not counted.
const { splitStack } = require('./fuzzy');

// lines: [{ text, bbox: { x0, y0, x1, y1 } }] -> [{ name, qty, x, y }]
function detect(lines, matcher) {
  const out = [];
  for (const line of lines || []) {
    const raw = String(line.text || '').trim();
    if (raw.length < 4 || raw.length > 60) continue;
    const { qty, text } = splitStack(raw);
    const name = matcher.match(text);
    if (!name) continue;
    const b = line.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 };
    out.push({ name, qty, x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
  }
  return out;
}

class LabelTracker {
  constructor({ confirmFrames = 2, missFrames = 2, centerX = 0.5, centerY = 0.44, radius = 0.3 } = {}) {
    this.confirmFrames = confirmFrames;
    this.missFrames = missFrames;
    this.centerX = centerX;
    this.centerY = centerY;
    this.radius = radius; // as a fraction of frame height
    this.tracks = [];
  }

  reset() { this.tracks = []; }

  // detections: output of detect(); frame: { width, height }. Returns [{ type, name, qty }].
  update(detections, frame) {
    const events = [];
    const maxJump = frame.width * 0.45;
    const used = new Set();
    for (const t of this.tracks) t.matched = false;

    for (const d of detections) {
      let best = null, bestDist = maxJump;
      for (const t of this.tracks) {
        if (t.matched || t.name !== d.name || used.has(t)) continue;
        const dist = Math.hypot(t.x - d.x, t.y - d.y);
        if (dist < bestDist) { bestDist = dist; best = t; }
      }
      if (best) {
        best.matched = true; used.add(best);
        best.x = d.x; best.y = d.y; best.hits += 1; best.misses = 0;
        if (d.qty > best.qty) best.qty = d.qty; // OCR sometimes drops the "3x" prefix
      } else {
        this.tracks.push({ name: d.name, qty: d.qty, x: d.x, y: d.y, hits: 1, misses: 0, matched: true, announced: false });
      }
    }

    const gone = [];
    for (const t of this.tracks) {
      if (!t.matched) t.misses += 1;
      if (!t.announced && t.hits >= this.confirmFrames) {
        t.announced = true;
        events.push({ type: 'seen', name: t.name, qty: t.qty });
      }
      if (t.misses >= this.missFrames) gone.push(t);
    }

    if (gone.length) {
      const announced = this.tracks.filter((t) => t.announced).length;
      const goneAnnounced = gone.filter((t) => t.announced);
      const massVanish = goneAnnounced.length > 3 && goneAnnounced.length >= announced * 0.6;
      if (!massVanish) {
        const cx = frame.width * this.centerX, cy = frame.height * this.centerY;
        const r = frame.height * this.radius;
        for (const t of goneAnnounced) {
          if (Math.hypot(t.x - cx, t.y - cy) <= r) events.push({ type: 'pickup', name: t.name, qty: t.qty });
        }
      }
      this.tracks = this.tracks.filter((t) => !gone.includes(t));
    }
    return events;
  }
}

module.exports = { detect, LabelTracker };
