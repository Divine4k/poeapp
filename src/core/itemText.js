'use strict';
// Parses the text Path of Exile puts on the clipboard when you press Ctrl+C over an item.

function parseItemText(text) {
  if (typeof text !== 'string' || !/^Item Class: /m.test(text)) return null;
  const sections = text.replace(/\r/g, '').trim().split(/\n-{4,}\n/).map((s) => s.split('\n').map((l) => l.trim()).filter(Boolean));
  const head = sections[0] || [];
  const item = { itemClass: '', rarity: '', name: '', baseType: '', stackSize: 1, isMap: false, mods: [] };
  const titles = [];
  for (const line of head) {
    let m;
    if ((m = /^Item Class: (.+)$/.exec(line))) item.itemClass = m[1];
    else if ((m = /^Rarity: (.+)$/.exec(line))) item.rarity = m[1];
    else titles.push(line);
  }
  if (titles.length >= 2) { item.name = titles[0]; item.baseType = titles[1]; }
  else { item.name = titles[0] || ''; item.baseType = titles[0] || ''; }

  const num = (re) => { const m = re.exec(text); return m ? parseInt(m[1].replace(/[,.]/g, ''), 10) : null; };
  const stack = /^Stack Size: ([\d,.]+)\//m.exec(text);
  if (stack) item.stackSize = parseInt(stack[1].replace(/[,.]/g, ''), 10) || 1;
  item.stackable = !!stack;

  item.isMap = /^Map Tier: /m.test(text) || /Maps?$/.test(item.itemClass);
  if (item.isMap) {
    item.mapTier = num(/^Map Tier: (\d+)/m);
    item.quantity = num(/^Item Quantity: \+(\d+)%/m);
    item.rarityBonus = num(/^Item Rarity: \+(\d+)%/m);
    item.packSize = num(/^Monster Pack Size: \+(\d+)%/m);
    // Mods sit in the sections after "Item Level", before the usage hint.
    const start = sections.findIndex((s) => s.some((l) => /^Item Level: /.test(l)));
    for (let i = start + 1; i < sections.length && start >= 0; i++) {
      const s = sections[i];
      if (s.some((l) => /^Travel to this Map/i.test(l))) break;
      for (const l of s) {
        if (/^(Corrupted|Unidentified|Mirrored|Split|Note: )/.test(l)) continue;
        item.mods.push(l.replace(/ \((implicit|enchant|fractured|crafted)\)$/, ''));
      }
    }
    item.corrupted = /^Corrupted$/m.test(text);
    item.unidentified = /^Unidentified$/m.test(text);
  }
  return item;
}

// The name to price an item by: unique name for uniques, otherwise the base type.
function priceName(item) {
  if (!item) return '';
  return item.rarity === 'Unique' ? item.name : (item.baseType || item.name);
}

module.exports = { parseItemText, priceName };
