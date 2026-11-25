'use strict';
// The steps of a tracker item: the "- [ ] ..." lines in its GitHub issue text, ticked "- [x]"
// when done. Used by the Tracker page (in the window) and by src/tracker.js (in the app itself),
// so this file loads both ways. Plain logic, no Electron.
(() => {
  const STEP = /^\s*[-*] \[( |x|X)\]\s?(.*)$/;

  // { notes, steps: [{ text, done }] }: the steps lifted out, the rest of the text as notes.
  function parseSteps(body) {
    const notes = [], steps = [];
    for (const line of String(body || '').replace(/\r\n/g, '\n').split('\n')) {
      const m = STEP.exec(line);
      if (m) steps.push({ text: m[2].trim(), done: m[1] !== ' ' });
      else notes.push(line);
    }
    return { notes: notes.join('\n').trim(), steps };
  }

  // Back into one text: the notes first, then the steps as GitHub's task list.
  function joinSteps(notes, steps) {
    const list = (steps || []).filter((s) => String(s.text || '').trim()).map((s) => `- [${s.done ? 'x' : ' '}] ${String(s.text).trim()}`);
    return [String(notes || '').trim(), list.join('\n')].filter(Boolean).join('\n\n');
  }

  // How far along: { done, total }.
  function progress(body) {
    const { steps } = parseSteps(body);
    return { done: steps.filter((s) => s.done).length, total: steps.length };
  }

  const api = { parseSteps, joinSteps, progress };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Steps = api;
})();
