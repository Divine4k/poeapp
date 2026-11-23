'use strict';
// Knows which program's window is in front. Two things depend on it: nothing is ever typed
// unless Path of Exile is the window in front, and the overlay hides when you switch away.
//
// Windows only. A small PowerShell helper asks Windows four times a second which process owns
// the front window and prints its name. It reads nothing else and sends nothing.
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$t = Add-Type -Name FrontWindow -Namespace PoeApp -PassThru -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);'
$names = @{}
$n = 0
while ($true) {
  $n++
  if ($n % 20 -eq 0 -and -not (Get-Process -Id PARENT_PID)) { break }
  $p = [uint32]0
  [void]$t::GetWindowThreadProcessId($t::GetForegroundWindow(), [ref]$p)
  $name = $names[$p]
  if (-not $name) { $name = (Get-Process -Id $p).ProcessName; if ($name) { $names[$p] = $name } }
  [Console]::Out.WriteLine('fg ' + $name)
  Start-Sleep -Milliseconds 250
}
`;

const isGameName = (name) => /^PathOfExile/i.test(String(name || ''));
const FRESH_MS = 1500;

class GameWatch extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.running = false; // true once the helper has reported at least once
    this.name = '';
    this.at = 0;
    this.own = path.basename(process.execPath).replace(/\.exe$/i, '');
  }

  start() {
    if (this.proc || process.platform !== 'win32') return;
    const script = SCRIPT.replace('PARENT_PID', String(process.pid));
    try {
      this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (_) { this.proc = null; return; }
    let rest = '';
    this.proc.stdout.on('data', (d) => {
      const lines = (rest + d).split(/\r?\n/);
      rest = lines.pop();
      for (const line of lines) if (line.startsWith('fg ')) this.report(line.slice(3).trim());
    });
    const gone = () => { this.proc = null; if (this.running) { this.running = false; this.emit('change'); } };
    this.proc.on('error', gone);
    this.proc.on('exit', gone);
  }

  report(name, now = Date.now()) {
    const changed = name !== this.name || !this.running;
    this.name = name; this.at = now; this.running = true;
    if (changed) this.emit('change');
  }

  stop() {
    if (this.proc) { try { this.proc.kill(); } catch (_) { /* already gone */ } }
    this.proc = null; this.running = false;
  }

  // Only true when the helper said so within the last moment. Unknown counts as "no".
  gameInFront(now = Date.now()) { return this.running && now - this.at < FRESH_MS && isGameName(this.name); }
  ownInFront(now = Date.now()) { return this.running && now - this.at < FRESH_MS && this.name.toLowerCase() === this.own.toLowerCase(); }

  // Waits until the game is in front, for at most ms. Resolves true or false.
  // since: only a report newer than this counts, so an answer from before the switch is not used.
  async waitForGame(ms = 2500, since = Date.now()) {
    const end = Date.now() + ms;
    for (;;) {
      if (this.at >= since && this.gameInFront()) return true;
      if (Date.now() >= end) return false;
      await new Promise((r) => setTimeout(r, 80));
    }
  }
}

module.exports = { GameWatch, isGameName };
