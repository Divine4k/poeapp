'use strict';
// Theme engine for the main window. Runs in the head, before the page is drawn, so the window
// never flashes in the default colours first. The app's settings (config.theme, themeCustom)
// say which theme it is; the last one is also kept in localStorage for that first moment.
// The themes themselves are in themes.css; this file only picks one, works out the colours
// of your own theme, and follows Windows for "Automatic".
window.Theme = (() => {
  const KEY = 'theme';
  const STANDARD = ['auto', 'slate', 'light', 'dim', 'midnight', 'ember', 'verdant', 'paper', 'contrast', 'custom'];
  const PREMIUM = ['wraeclast'];
  const ALL = [...STANDARD, ...PREMIUM];
  const NAMES = {
    auto: ['Automatic', 'Light or Slate, following Windows.'], slate: ['Slate', 'The default: dark grey with gold.'], light: ['Light', 'White panels, dark text.'],
    dim: ['Dim', 'A softer dark grey.'], midnight: ['Midnight', 'Deep blue with ice blue.'], ember: ['Ember', 'Charcoal with fire orange.'],
    verdant: ['Verdant', 'Dark forest with jade.'], paper: ['Paper', 'Warm paper with rust red.'], contrast: ['High contrast', 'Black and white, yellow accent. Easiest to read.'],
    custom: ['Custom', 'Your own four colours.'],
    wraeclast: ['Wraeclast', 'The whole window as in the game: carved bronze frames, gold-leaf letters, embers, ornaments.'],
  };
  // The colours a custom theme can start from: background, panels, text, accent.
  const BASES = {
    slate: { bg: '#1B1F24', surface: '#242A31', ink: '#E9E2D3', accent: '#D1AD62' }, light: { bg: '#EEF0F3', surface: '#FFFFFF', ink: '#15181D', accent: '#9A6B12' },
    dim: { bg: '#1E1E1E', surface: '#282828', ink: '#ECECEC', accent: '#E3B341' }, midnight: { bg: '#10151F', surface: '#18202E', ink: '#E4EBF5', accent: '#7FB4FF' },
    ember: { bg: '#1A1514', surface: '#241D1B', ink: '#F2E6DC', accent: '#FF8A4C' }, verdant: { bg: '#121A17', surface: '#1A2420', ink: '#E3EEE6', accent: '#6FCF97' },
    paper: { bg: '#F3EEE3', surface: '#FFFCF6', ink: '#1E1A14', accent: '#B5481A' }, contrast: { bg: '#000000', surface: '#0B0B0B', ink: '#FFFFFF', accent: '#FFD500' },
  };

  const hex = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h == null ? '' : h).trim()); return m ? `#${m[1].toUpperCase()}` : null; };
  const rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const toHex = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
  const lum = (h) => { const c = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

  // Your own theme: four colours in, the rest (quiet text, lines, text on the accent, the state
  // colours) worked out so that it stays readable.
  function derive(c) {
    const { bg, surface, ink, accent } = c;
    const dark = lum(ink) > lum(bg);
    let muted = ink;
    for (let t = 0.4; t <= 1.0001; t += 0.05) { const m = mix(bg, ink, t); if (contrast(m, bg) >= 4.5 && contrast(m, surface) >= 4.5) { muted = m; break; } }
    return {
      dark,
      vars: {
        '--stone': bg, '--slab': surface, '--bone': ink, '--ash': muted, '--seam': mix(surface, ink, 0.16), '--gold': accent,
        '--ink': contrast('#111111', accent) >= contrast('#FFFFFF', accent) ? '#111111' : '#FFFFFF',
        '--portal': dark ? '#62AFD0' : '#1F6FB2', '--blood': dark ? '#E0655A' : '#B3261E', '--moss': dark ? '#86BB72' : '#2E7D4F',
      },
    };
  }
  // Warnings for your own theme: text that is hard to read, an accent that disappears.
  function info(c) {
    const text = Math.min(contrast(c.ink, c.bg), contrast(c.ink, c.surface)), acc = Math.min(contrast(c.accent, c.bg), contrast(c.accent, c.surface));
    return { lowText: text < 4.5, lowAccent: acc < 1.6 };
  }
  function clean(s) {
    if (typeof s === 'string') s = { id: s };
    if (!s || !ALL.includes(s.id)) return { id: 'slate', custom: null };
    let custom = null;
    if (s.custom && typeof s.custom === 'object') {
      const c = { bg: hex(s.custom.bg), surface: hex(s.custom.surface), ink: hex(s.custom.ink), accent: hex(s.custom.accent) };
      if (c.bg && c.surface && c.ink && c.accent) custom = c;
    }
    return { id: s.id === 'custom' && !custom ? 'slate' : s.id, custom };
  }
  const prefersDark = () => { try { return !window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (_) { return true; } };
  let current = { id: 'slate', custom: null };
  let applied = '';
  // Puts a theme on the page. s: { id, custom } or a theme id.
  function apply(s) {
    s = clean(s);
    const key = JSON.stringify([s, s.id === 'auto' ? prefersDark() : 0]);
    current = s;
    if (key === applied) return s;
    applied = key;
    const root = document.documentElement;
    root.dataset.themeChoice = s.id;
    root.dataset.theme = s.id === 'auto' ? (prefersDark() ? 'slate' : 'light') : s.id;
    for (const v of ['--stone', '--slab', '--bone', '--ash', '--seam', '--gold', '--ink', '--portal', '--blood', '--moss']) root.style.removeProperty(v);
    root.style.removeProperty('color-scheme');
    if (s.id === 'custom') {
      const d = derive(s.custom);
      for (const [k, v] of Object.entries(d.vars)) root.style.setProperty(k, v);
      root.style.setProperty('color-scheme', d.dark ? 'dark' : 'light');
    }
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) { /* only the first moment of the next start shows the default */ }
    return s;
  }
  function load() { try { const raw = localStorage.getItem(KEY); return clean(raw && raw[0] === '{' ? JSON.parse(raw) : raw); } catch (_) { return clean(null); } }
  // Animations: off makes everything appear at once.
  function motion(on) { document.documentElement.dataset.motion = on === false ? 'off' : 'on'; try { localStorage.setItem('motion', on === false ? 'off' : 'on'); } catch (_) { /* fine */ } }

  apply(load());
  try { if (localStorage.getItem('motion') === 'off') motion(false); } catch (_) { /* fine */ }
  // "Automatic" follows Windows when it switches between light and dark.
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (current.id === 'auto') apply(current); }); } catch (_) { /* fine */ }
  return { STANDARD, PREMIUM, NAMES, BASES, apply, info, derive, hex, motion, get current() { return current; } };
})();
