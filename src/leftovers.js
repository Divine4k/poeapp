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

// The command line that restarts the app once this copy is gone: wait, make sure this copy
// really is gone (it is closed by force if it is still there), wait again, start the new one.
function restartCommand({ pid, target }) {
  return `ping -n 3 127.0.0.1 >nul & taskkill /F /PID ${Number(pid)} >nul 2>&1 & ping -n 2 127.0.0.1 >nul & start "" ${target}`;
}

module.exports = { closeLeftovers, leftoverScript, restartCommand };
