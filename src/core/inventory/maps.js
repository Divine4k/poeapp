'use strict';
// Recognises map items and their tier.
//
// Since 3.30 maps are plain "Map (Tier N)" items whose picture is a stone disc with the tier as
// a Roman numeral. All sixteen look alike at a glance (the general picture fingerprint scores
// different tiers up to 0.96 alike), so the tier is read by comparing the numeral area pixel by
// pixel against one reference picture per tier (mapTemplates.json, cut from a real capture).
const { CANON } = require('./grid');

const X0 = 6, X1 = 46, Y0 = 10, Y1 = 42;   // the disc and numeral, inside the 52x52 cell
const W = X1 - X0, H = Y1 - Y0;
const MATCH = 0.8;                         // minimum agreement with the best tier
const LEAD = 0.05;                         // and it must beat the runner-up tier by this much

// Cuts the numeral area out of a cell (shifted by dx, dy) as centred, unit-length values.
function patch(rgb, dx = 0, dy = 0) {
  const out = new Float32Array(W * H * 3);
  let n = 0, sum = 0;
  for (let y = Y0; y < Y1; y++) {
    for (let x = X0; x < X1; x++) {
      const o = ((y + dy) * CANON + x + dx) * 3;
      for (let k = 0; k < 3; k++) { out[n] = rgb[o + k]; sum += out[n]; n++; }
    }
  }
  const mean = sum / n;
  let energy = 0;
  for (let i = 0; i < n; i++) { out[i] -= mean; energy += out[i] * out[i]; }
  const norm = Math.sqrt(energy) || 1;
  for (let i = 0; i < n; i++) out[i] /= norm;
  return out;
}

const TEMPLATES = require('./mapTemplates.json').map((t) => {
  const raw = Buffer.from(t.patch, 'base64');
  const v = new Float32Array(raw.length);
  let sum = 0;
  for (let i = 0; i < raw.length; i++) { v[i] = raw[i]; sum += raw[i]; }
  const mean = sum / raw.length;
  let energy = 0;
  for (let i = 0; i < v.length; i++) { v[i] -= mean; energy += v[i] * v[i]; }
  const norm = Math.sqrt(energy) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return { tier: t.tier, name: t.name || `Map (Tier ${t.tier})`, v };
});

// Returns { tier, name, score, lead } when the cell holds a map, otherwise null. Besides the
// sixteen plain tiers there are references for special maps that have their own picture.
function readMapTier(rgb) {
  const scores = TEMPLATES.map(() => -1);
  // A one-pixel shift either way covers rounding at other screen sizes.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const p = patch(rgb, dx, dy);
      for (let t = 0; t < TEMPLATES.length; t++) {
        const v = TEMPLATES[t].v;
        let dot = 0;
        for (let i = 0; i < p.length; i++) dot += p[i] * v[i];
        if (dot > scores[t]) scores[t] = dot;
      }
    }
  }
  let best = 0, second = -1;
  for (let t = 1; t < scores.length; t++) if (scores[t] > scores[best]) best = t;
  for (let t = 0; t < scores.length; t++) if (t !== best && scores[t] > second) second = scores[t];
  if (scores[best] < MATCH || scores[best] - second < LEAD) return null;
  return { tier: TEMPLATES[best].tier, name: TEMPLATES[best].name, score: scores[best], lead: scores[best] - second };
}

module.exports = { readMapTier, REGION: { X0, X1, Y0, Y1 } };
