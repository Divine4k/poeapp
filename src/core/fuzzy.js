'use strict';
// Name normalisation so lookups ignore case, punctuation and spacing.
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .trim();
}

module.exports = { normalize };
