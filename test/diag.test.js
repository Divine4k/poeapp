'use strict';
// Under the hood: the numbers (src/core/diag.js).
const test = require('node:test');
const assert = require('node:assert');
const { Diag, report, brief, briefLines, limitOf } = require('../src/core/diag');
const { summarise, readme, eventLine } = require('../src/core/recording');

const clocked = () => { let t = 1000000; const d = new Diag({ now: () => t, tick: () => t }); return { d, go: (ms) => { t += ms; } }; };

test('a job is counted with its usual, slow-end and worst time', () => {
  const { d } = clocked();
  for (let i = 1; i <= 100; i++) d.time('web: poe.ninja', i);
  const j = d.snapshot().jobs[0];
  assert.deepStrictEqual([j.name, j.n, j.total, j.usual, j.slowEnd, j.max, j.last, j.over], ['web: poe.ninja', 100, 5050, 51, 96, 100, 100, 0]);
});

test('only the last 200 runs decide the usual time; the worst is never forgotten', () => {
  const { d } = clocked();
  d.time('x', 90);
  for (let i = 0; i < 400; i++) d.time('x', 2);
  const j = d.snapshot().jobs[0];
  assert.strictEqual(j.usual, 2);
  assert.strictEqual(j.slowEnd, 2);
  assert.strictEqual(j.max, 90);
  assert.strictEqual(j.n, 401);
});

test('limits go by the start of the name, the first match winning', () => {
  assert.strictEqual(limitOf('state update: put together'), 16);
  assert.strictEqual(limitOf('inventory: reading the slots'), 60);
  assert.strictEqual(limitOf('inventory: capture of the screen'), 150);
  assert.strictEqual(limitOf('button: troubleSend'), 120000);
  assert.strictEqual(limitOf('button: endMap'), 300);
  assert.strictEqual(limitOf('something new'), 100);
});

test('a job over its limit becomes a slow moment, with its detail', () => {
  const { d } = clocked();
  const seen = [];
  d.onSlow = (m) => seen.push(m);
  d.time('inventory: reading the slots', 12);
  d.time('inventory: reading the slots', 180, '14 recognised');
  const s = d.snapshot();
  assert.strictEqual(s.jobs[0].over, 1);
  assert.deepStrictEqual(s.slow.map((m) => [m.kind, m.name, m.ms, m.limit, m.detail]), [['slow', 'inventory: reading the slots', 180, 60, '14 recognised']]);
  assert.strictEqual(seen.length, 1);
});

test('start and run time work that answers now, later, or fails', async () => {
  const { d, go } = clocked();
  const done = d.start('a'); go(30); assert.strictEqual(done(), 30);
  assert.strictEqual(d.run('b', () => { go(5); return 7; }), 7);
  assert.strictEqual(await d.run('c', async () => { go(40); return 'x'; }), 'x');
  assert.throws(() => d.run('d', () => { go(3); throw new Error('no'); }), /no/);
  await assert.rejects(d.run('e', async () => { go(9); throw new Error('later'); }), /later/);
  const by = Object.fromEntries(d.snapshot().jobs.map((j) => [j.name, j.max]));
  assert.deepStrictEqual(by, { a: 30, b: 5, c: 40, d: 3, e: 9 });
});

test('a freeze names the busy work that ended in it, not work that was only waiting', async () => {
  const { d, go } = clocked();
  d.time('web: trade site, search', 900);            // waiting for a website: not the reason
  d.time('inventory: reading the slots', 210);       // the main process did nothing else
  go(10);
  d.stall('main process', 240);
  d.stall('main window', 90);
  const s = d.snapshot();
  const main = s.slow.find((m) => m.kind === 'freeze' && m.name === 'main process');
  assert.strictEqual(main.detail, 'while: inventory: reading the slots 210 ms');
  assert.strictEqual(s.slow.find((m) => m.name === 'main window').detail, undefined);
  assert.deepStrictEqual(s.stalls.map((x) => [x.where, x.n, x.max]), [['main process', 1, 240], ['main window', 1, 90]]);
});

test('usage readings keep peaks per part, and a part that is gone shows as closed', () => {
  const { d, go } = clocked();
  d.sample({ cpu: 2, mem: 300, pcCpu: 40, pcFree: 9000, parts: [{ name: 'Main process', cpu: 1.5, mem: 120 }, { name: 'Screen recorder', cpu: 0.5, mem: 180 }] });
  go(5000);
  d.sample({ cpu: 9, mem: 250, pcCpu: 70, pcFree: 7000, parts: [{ name: 'Main process', cpu: 9, mem: 130 }] });
  const s = d.snapshot();
  assert.deepStrictEqual(s.peaks, { cpu: 9, mem: 300, pcCpu: 70, pcFreeLow: 7000 });
  const rec = s.parts.find((p) => p.name === 'Screen recorder');
  assert.deepStrictEqual([rec.on, rec.mem, rec.memPeak], [false, 0, 180]);
  const main = s.parts.find((p) => p.name === 'Main process');
  assert.deepStrictEqual([main.cpu, main.cpuPeak, main.cpuUsual, main.memPeak], [9, 9, 5.3, 130]);
  assert.strictEqual(s.samples.length, 2);
});

test('no more readings are kept than half an hour, and the same error again is counted', () => {
  const { d, go } = clocked();
  for (let i = 0; i < 500; i++) { go(5000); d.sample({ cpu: 1, mem: 100, parts: [] }); }
  assert.strictEqual(d.snapshot().samples.length, 360);
  d.error('web', 'no answer'); d.error('web', 'no answer'); d.error('web', 'other');
  assert.deepStrictEqual(d.snapshot().errors.map((e) => [e.text, e.n]), [['no answer', 2], ['other', 1]]);
});

test('a fork gets only what happens from then on, until it ends', () => {
  const { d } = clocked();
  d.time('before', 5);
  const kid = d.fork();
  d.time('during', 7); d.stall('main process', 100); d.error('x', 'y'); d.gauge('One state update', 150, 'KB');
  d.sample({ cpu: 3, mem: 200, parts: [{ name: 'Main process', cpu: 3, mem: 200 }] });
  kid.end();
  d.time('after', 9);
  const k = kid.snapshot();
  assert.deepStrictEqual(k.jobs.map((j) => j.name), ['during']);
  assert.deepStrictEqual([k.stalls.length, k.errors.length, k.samples.length, k.gauges[0].peak], [1, 1, 1, 150]);
  assert.deepStrictEqual(d.snapshot().jobs.map((j) => j.name).sort(), ['after', 'before', 'during']);
});

test('reset starts the count over', () => {
  const { d } = clocked();
  d.time('a', 500); d.stall('main process', 300);
  d.reset();
  const s = d.snapshot();
  assert.deepStrictEqual([s.jobs.length, s.slow.length, s.stalls.length], [0, 0, 0]);
});

test('the report and the brief say the worst in words', () => {
  const { d, go } = clocked();
  d.pc = '16 threads, 32 GB memory';
  d.sample({ cpu: 2, mem: 400, pcCpu: 50, pcFree: 8000, parts: [{ name: 'Main process', cpu: 2, mem: 400 }] });
  d.time('state update: put together', 1.2);
  d.time('price check: from the key to the answer', 3100, 'gear');
  go(2000);
  d.stall('main process', 320);
  d.error('web: trade site, search', 'answered 429');
  const snap = d.snapshot();
  const text = report(snap, { title: 'Under the hood, during the recording', t0: 1000000 });
  assert.match(text, /^## Under the hood, during the recording/);
  assert.match(text, /PC: 16 threads, 32 GB memory/);
  assert.match(text, /\| Main process \| 2% \| 2% \| 400 MB at 00:00\.0 \| 400 MB \| 400 MB \|/);
  assert.match(text, /- main process: 1 time, 320 ms in all, the longest 320 ms at 00:02\.0\./);
  assert.match(text, /\| price check: from the key to the answer \| 1 \| 3100 ms \| 3100 ms \| 3100 ms \| 1 \| 2500 ms \| - \| gear \|/);
  assert.match(text, /00:00\.0 {2}slow {3}price check: from the key to the answer took 3100 ms \(limit 2500 ms\) {2}gear/);
  assert.match(text, /00:02\.0 {2}FROZE {2}main process for 320 ms/);
  assert.match(text, /web: trade site, search: answered 429/);
  const b = brief(snap);
  assert.deepStrictEqual([b.freezes.n, b.freezes.max, b.slowJobs, b.errors, b.mem.peak], [1, 320, 1, 1, 400]);
  assert.deepStrictEqual(briefLines(b), [
    'The app froze 1 time, the longest for 320 ms.',
    'Slow: price check: from the key to the answer (up to 3100 ms).',
    'Processor 2% of the PC usually, 2% at most; memory up to 400 MB.',
    '1 error.',
  ]);
  assert.deepStrictEqual(briefLines(brief(new Diag().snapshot())), ['The app never froze.', 'No job was slow.']);
});

test('in a recording, slow jobs and freezes get their own line; plain timings are only counted', () => {
  const events = [
    { t: 100, kind: 'timing', name: 'state update: put together', ms: 2.4 },
    { t: 200, kind: 'usage', cpu: 1.2, mem: 410, pcCpu: 44, pcFree: 9000 },
    { t: 300, kind: 'slow', name: 'inventory: reading the slots', ms: 180, limit: 60, detail: '14 recognised' },
    { t: 400, kind: 'freeze', name: 'main process', ms: 240, detail: 'while: inventory: reading the slots 180 ms' },
  ];
  const short = summarise(events);
  assert.strictEqual(short.quiet, 2);
  assert.deepStrictEqual(short.rows.map((r) => [r.text, r.bad]), [
    ['Slow: inventory: reading the slots took 180 ms (over 60 ms counts as slow). 14 recognised', true],
    ['The main process froze for 240 ms (while: inventory: reading the slots 180 ms)', true],
  ]);
  assert.strictEqual(summarise(events, { everything: true }).rows.length, 4);
  assert.match(eventLine(events[0]), /00:00\.100 {2}timing {3}Took 2\.4 ms: state update: put together/);
  assert.match(eventLine(events[1]), /Usage: the app 1\.2% processor, 410 MB memory; the whole PC 44% processor, 9000 MB memory free/);
  const md = readme({ id: 'x', startedAt: 0, endedAt: 1000, note: 'n' }, events, '## Under the hood, during the recording\n\nbody');
  assert.match(md, /diagnostics\.json\.gz/);
  assert.ok(md.indexOf('## Under the hood, during the recording') < md.indexOf('## Timeline'));
  assert.doesNotMatch(readme({ id: 'x', startedAt: 0, endedAt: 1000, note: 'n' }, events), /diagnostics/);
});

test('a recording takes its own numbers along: only what happened while it ran, in the file, the list and the README', async () => {
  const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
  const { Troubleshoot } = require('../src/troubleshoot');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poeapp-hood-'));
  const d = new Diag();
  d.time('before the recording', 700);
  const fetchImpl = async () => { throw new Error('not used'); };
  const t = new Troubleshoot({
    dir, recorder: { start: async () => { throw new Error('no screen'); }, stop: async () => null }, displayId: () => null, version: '0.51.0',
    cloud: { github: async () => ({ repo: 'a/b', token: 'x' }) }, fetchImpl, diag: d,
    snapshot: async () => ({ state: { status: {}, summary: { runs: [] } }, inventory: null }), who: () => ({ name: 'Tester', role: 'admin' }),
  });
  d.onSlow = (m) => { if (t.recording) t.event(m.kind === 'freeze' ? 'freeze' : 'slow', { name: m.name, ms: m.ms, limit: m.limit, detail: m.detail }); };
  await t.start();
  d.time('inventory: reading the slots', 190, '12 recognised');
  d.stall('main process', 200);
  d.sample({ cpu: 4, mem: 500, pcCpu: 60, pcFree: 4000, parts: [{ name: 'Main process', cpu: 4, mem: 500 }] });
  const id = await t.stop();
  d.time('after the recording', 900);
  const kept = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, id, 'diagnostics.json.gz'))));
  assert.deepStrictEqual(kept.during.jobs.map((j) => j.name), ['inventory: reading the slots']);
  assert.ok(kept.whole.jobs.some((j) => j.name === 'before the recording'));
  assert.ok(kept.t0 > 0);
  const det = t.details(id);
  assert.deepStrictEqual([det.hood.freezes.n, det.hood.slowJobs, det.hood.mem.peak], [1, 1, 500]);
  assert.deepStrictEqual(det.events.filter((e) => e.kind === 'slow' || e.kind === 'freeze').map((e) => [e.kind, e.name]), [['slow', 'inventory: reading the slots'], ['freeze', 'main process']]);
  const text = t.hoodText(id);
  assert.match(text, /## Under the hood, during the recording/);
  assert.match(text, /## Under the hood, since the app was started/);
  assert.match(text, /FROZE {2}main process for 200 ms {2}while: inventory: reading the slots 190 ms/);
  assert.strictEqual(d.kids.size, 0); // the recording's own count is let go
  // A written report takes the numbers up to then.
  const rid = await t.newReport();
  assert.ok(t.details(rid).hood.slowest.some((j) => j.name === 'after the recording'));
  assert.match(t.hoodText(rid), /## Under the hood, from the start of the app to this report/);
  assert.strictEqual(t.hoodText('20260101-000000-nobody'), '');
});

test('what happened: a line for each job worth one, with its outcome; quick routine ones are only counted', async () => {
  const { d, go } = clocked();
  d.time('state update: put together', 0.4);                 // quick and routine: no line
  d.time('main process: heartbeat came late by', 30);        // never a line
  d.time('price check: search (waiting included)', 0.4, 'failed: the trade site asked for a pause'); // set off by you: always a line
  d.time('inventory: capture of the screen', 510, '1920x1080');
  await assert.rejects(d.run('web: poe.ninja', async () => { go(40); throw new Error('no answer'); }));
  d.note('hotkey', 'App key Ctrl+D (priceCheck)');
  d.note('notice', 'No item under the mouse', true);
  d.error('main window', 'x is not defined');
  const s = d.snapshot();
  assert.deepStrictEqual(s.log.map((l) => [l.kind, l.text, l.detail || '', !!l.bad]), [
    ['job', 'price check: search (waiting included)', 'failed: the trade site asked for a pause', false],
    ['slow', 'inventory: capture of the screen', '1920x1080', true],
    ['failed', 'web: poe.ninja', 'failed: no answer', true],
    ['hotkey', 'App key Ctrl+D (priceCheck)', '', false],
    ['notice', 'No item under the mouse', '', true],
    ['error', 'main window: x is not defined', '', true],
  ]);
  const web = s.jobs.find((j) => j.name === 'web: poe.ninja');
  assert.deepStrictEqual([web.failed, web.lastDetail], [1, 'failed: no answer']);
  assert.strictEqual(s.jobs.find((j) => j.name === 'state update: put together').n, 1);
  const text = report(s);
  assert.match(text, /### What happened, newest last/);
  assert.match(text, /failed {2}web: poe\.ninja {2}40 ms {2}failed: no answer/);
  assert.match(text, /\| web: poe\.ninja \| 1 \| 40 ms \| 40 ms \| 40 ms \| - \| 2000 ms \| 1 \| failed: no answer \|/);
});

test('a freeze names the job the app was in the middle of, and a job still going is listed as running', () => {
  const { d, go } = clocked();
  const done = d.start('inventory: asking Windows for the screen', '1920x1080');
  go(300);
  d.stall('main process', 280);
  const s = d.snapshot();
  assert.strictEqual(s.slow[0].detail, 'in the middle of: inventory: asking Windows for the screen (started 300 ms before)');
  assert.deepStrictEqual(s.running.map((r) => [r.name, r.ms, r.detail]), [['inventory: asking Windows for the screen', 300, '1920x1080']]);
  assert.match(report(s), /### Running when this was written\n\n- inventory: asking Windows for the screen: started 300 ms ago \(1920x1080\)/);
  go(200);
  assert.strictEqual(done('1 picture came back'), 500);
  assert.strictEqual(done('again'), 0); // told twice: counted once
  assert.strictEqual(d.snapshot().running.length, 0);
  assert.strictEqual(d.snapshot().jobs[0].n, 1);
});

test('the longest freezes are kept however many follow; counts, sizes and facts are in the report', () => {
  const { d, go } = clocked();
  d.stall('main process', 1859);
  for (let i = 0; i < 600; i++) { go(100); d.stall('main process', 100 + (i % 50)); }
  d.count('inventory: not read, another program was in front'); d.count('inventory: not read, another program was in front');
  d.gauge('Items named on this PC', 400); d.gauge('Items named on this PC', 412);
  d.facts.Screens = '1920x1080 at scale 1'; d.facts.settings = { league: 'Standard' };
  d.sample({ cpu: 1, mem: 300, parts: [{ name: 'Main process', cpu: 1, mem: 200 }] }); go(5000);
  d.sample({ cpu: 1, mem: 340, parts: [{ name: 'Main process', cpu: 1, mem: 240 }] }); go(5000);
  d.sample({ cpu: 1, mem: 380, parts: [{ name: 'Main process', cpu: 1, mem: 280 }] });
  const s = d.snapshot();
  assert.strictEqual(s.worst[0].ms, 1859);
  assert.strictEqual(s.worst.length, 8);
  assert.strictEqual(s.slow.length, 400);
  const text = report(s);
  assert.match(text, /The longest:\n\n```\n\d\d:\d\d:\d\d {2}main process for 1859 ms/);
  assert.match(text, /- inventory: not read, another program was in front: 2 \(last at/);
  assert.match(text, /- Items named on this PC: 412 now, 400 when first measured, 412 at most\./);
  assert.match(text, /- Screens: 1920x1080 at scale 1/);
  assert.match(text, /### Settings\n\n```json\n\{"league":"Standard"\}/);
  assert.match(text, /Memory over time, MB:[\s\S]*\| 300 \| 200 \|[\s\S]*\| 380 \| 280 \|/);
  assert.match(text, /\| Main process \| 1% \| 1% \| 200 MB at/);
  d.reset();
  assert.strictEqual(d.facts.Screens, '1920x1080 at scale 1'); // what PC this is survives starting over
});

test('what the app does goes to "what happened" recording or not; your keys, chat and anything secret do not', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const { Troubleshoot, scrub } = require('../src/troubleshoot');
  const d = new Diag();
  const t = new Troubleshoot({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'poeapp-note-')), recorder: {}, displayId: () => null, version: 'x', cloud: {}, fetchImpl: null, snapshot: async () => ({}), who: () => ({}), diag: d });
  t.event('key', { dir: 'down', key: 'A' });
  t.event('mouse', { dir: 'down', button: 'left', x: 1, y: 2 });
  t.event('log', { line: '2026/11/26 01:00:00 1 a [INFO] @From Someone: hi there' });                 // chat: not kept
  t.event('log', { line: '2026/11/26 01:00:01 1 a [INFO] : You have entered Strand.', ev: { type: 'area', kind: 'map', code: 'MapWorldsStrand' } });
  t.event('hotkey', { job: 'priceCheck', key: 'Ctrl+D' });
  t.event('action', { type: 'endRun' });
  t.event('setting', { league: 'Standard', shareToken: 'abc123' });
  t.event('notice', { text: 'Could not read the log', bad: true });
  t.state({ status: { log: { ok: true } }, summary: { runs: [] } });
  t.state({ status: { log: { ok: true } }, summary: { runs: [] } }); // nothing changed: no line
  const log = d.snapshot().log;
  assert.deepStrictEqual(log.slice(0, 5).map((l) => [l.kind, l.text, !!l.bad]), [
    ['log', 'area map MapWorldsStrand', false],
    ['hotkey', 'App key Ctrl+D (priceCheck)', false],
    ['action', 'Pressed in the app: endRun', false],
    ['setting', 'Setting changed: {"league":"Standard","shareToken":"(hidden)"}', false],
    ['notice', 'Could not read the log', true],
  ]);
  assert.strictEqual(log.length, 6);
  assert.strictEqual(log[5].kind, 'state');
  assert.ok(!JSON.stringify(log).includes('abc123') && !JSON.stringify(log).includes('hi there'));
  assert.deepStrictEqual(scrub({ a: { password: 'p', name: 'n' }, list: [{ token: 't' }] }), { a: { password: '(hidden)', name: 'n' }, list: [{ token: '(hidden)' }] });
});
