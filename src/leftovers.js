'use strict';
// Closes copies of this app that were left running without a window, for example by an update
// that restarted the app before the old copy had fully gone. Such a copy keeps the hotkeys, so
// the new one cannot take them. Windows only; elsewhere this does nothing.
//
// Only one copy may run (see the lock in main.js), so by the time this is called any other
// main process of the same program is a leftover by definition. Helper processes of this copy
// (they carry "--type=" on their command line) are never touched.
const { execFile } = require('child_process');

// The PowerShell that finds and closes them, printing how many it closed.
// exe: this program's .exe. appDir: the app folder when started through Electron from a
// download (several Electron apps share electron.exe, so the folder must match too); '' for
// the installed program.
function leftoverScript({ pid, exe, appDir = '' }) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$me = ${Number(pid)}; $exe = ${q(exe)}; $dir = ${q(appDir)}`,
    "$found = @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $me -and $_.ExecutablePath -ieq $exe -and $_.CommandLine -notmatch '--type=' -and ($dir -eq '' -or $_.CommandLine.ToLower().Contains($dir.ToLower())) })",
    'foreach ($p in $found) { Stop-Process -Id $p.ProcessId -Force }',
    "'closed ' + $found.Count",
  ].join('\n');
}

// Resolves the number of leftover copies that were closed (0 when there were none, or on any problem).
function closeLeftovers({ pid = process.pid, exe = process.execPath, appDir = '' } = {}) {
  if (process.platform !== 'win32') return Promise.resolve(0);
  const script = leftoverScript({ pid, exe, appDir });
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 15000 }, (err, out) => {
      const m = /closed (\d+)/.exec(String(out || ''));
      resolve(err || !m ? 0 : Number(m[1]));
    });
  });
}

// After an update the new copy is started with --after-pid=<old copy>. It waits here until
// the old copy is gone, so the two never hold the app's files or hotkeys at the same time.
// This used to be a hidden cmd.exe that waited with ping and taskkill, but each of those
// opened a black command window of its own on the way. The old copy is closed by force when
// it is still there after limitMs. Returns 'gone', 'closed' or 'none'.
function waitForExit(pid, limitMs = 12000, { alive = isAlive, sleep = sleepSync, kill = (p) => process.kill(p) } = {}) {
  pid = Number(pid);
  if (!pid || pid === process.pid || !alive(pid)) return 'none';
  for (let waited = 0; waited < limitMs; waited += 150) {
    sleep(150);
    if (!alive(pid)) return 'gone';
  }
  try { kill(pid); } catch (_) { /* gone in the meantime */ }
  for (let i = 0; i < 20 && alive(pid); i++) sleep(100);
  return 'closed';
}
function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
// Waits without letting anything else run; only used while the app is still starting.
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
// The number after --after-pid= among the arguments, or 0.
const afterPid = (argv) => { const a = (argv || []).find((x) => String(x).startsWith('--after-pid=')); return a ? Number(a.slice(12)) || 0 : 0; };

module.exports = { closeLeftovers, leftoverScript, waitForExit, afterPid };
