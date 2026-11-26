'use strict';
// Starts a helper program without the app standing still for it.
//
// Starting a program is one call that does not return until Windows has made the process, and
// while it runs the main process answers nothing. For PowerShell that took 3.3 seconds on the
// owner's PC at the first start (Under the hood, 0.63.0) and 0.4 the second time. Here the
// start happens on a thread of its own, which also passes on what the helper writes and what
// is written to it. spawnAside() gives back something shaped like what child_process.spawn
// gives, as far as the app's helpers use it: stdout 'data', stdin.write/end, 'exit', 'error',
// kill().
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

if (!isMainThread && workerData && workerData.asideFor) {
  // ---- on the thread ----
  const { command, args, options } = workerData.asideFor;
  let proc = null;
  const end = (m) => { parentPort.postMessage(m); setTimeout(() => process.exit(0), 20); };
  try {
    proc = spawn(command, args, options);
    parentPort.postMessage({ t: 'started' });
    if (proc.stdout) proc.stdout.on('data', (d) => {
      // A copy of its own, handed over without being copied again.
      const ab = d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
      parentPort.postMessage({ t: 'out', d: ab }, [ab]);
    });
    if (proc.stdin) proc.stdin.on('error', () => {});
    proc.on('error', (e) => end({ t: 'error', message: e.message || String(e) }));
    proc.on('close', (code) => end({ t: 'exit', code })); // close, not exit: everything it wrote has been passed on by then
  } catch (e) {
    end({ t: 'error', message: e.message || String(e) });
  }
  parentPort.on('message', (m) => {
    if (!proc) return;
    try {
      if (m.t === 'in' && proc.stdin) proc.stdin.write(m.s);
      else if (m.t === 'end' && proc.stdin) proc.stdin.end();
      else if (m.t === 'kill') { if (proc.stdin) { try { proc.stdin.end(); } catch (_) { /* gone */ } } proc.kill(); }
    } catch (_) { /* the helper is gone; its exit says so */ }
  });
} else {
  // ---- in the app ----
  // onStarted(ms): how long the start took, for Under the hood.
  function spawnAside(command, args, options, onStarted = () => {}) {
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    let over = false;
    const t0 = Date.now();
    const worker = new Worker(__filename, { workerData: { asideFor: { command, args, options } } });
    const done = (kind, value) => { if (over) return; over = true; p.emit(kind, value); };
    worker.on('message', (m) => {
      if (m.t === 'out') p.stdout.emit('data', Buffer.from(m.d));
      else if (m.t === 'started') onStarted(Date.now() - t0);
      else if (m.t === 'error') { p.emit('error', new Error(m.message)); over = true; }
      else if (m.t === 'exit') done('exit', m.code);
    });
    worker.on('error', (e) => { if (!over) { over = true; p.emit('error', e); } });
    worker.on('exit', () => done('exit', null));
    const post = (m) => { if (!over) { try { worker.postMessage(m); } catch (_) { /* thread gone */ } } };
    p.stdin = Object.assign(new EventEmitter(), { write: (s) => post({ t: 'in', s: String(s) }), end: () => post({ t: 'end' }) });
    p.kill = () => { post({ t: 'kill' }); setTimeout(() => { worker.terminate().catch(() => {}); }, 800); };
    return p;
  }
  module.exports = { spawnAside };
}
