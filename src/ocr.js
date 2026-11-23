'use strict';
// Reads the text in a small picture with the text recognition that is built into Windows.
// Used for one thing: the name on the open stash tab. A PowerShell helper stays running and
// answers one picture at a time; nothing is installed and nothing leaves the PC.
const { spawn } = require('child_process');

const SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
  function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if (-not $engine) { throw 'Windows has no text recognition language installed' }
} catch { [Console]::Out.WriteLine('fatal ' + $_.Exception.Message); exit 1 }
[Console]::Out.WriteLine('ready')
while ($true) {
  $path = [Console]::In.ReadLine()
  if ($null -eq $path) { break }
  try {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $stream.Dispose()
    [Console]::Out.WriteLine('text ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$result.Text)))
  } catch { [Console]::Out.WriteLine('error ' + $_.Exception.Message) }
}
`;

class TextReader {
  constructor() {
    this.proc = null;
    this.state = process.platform === 'win32' ? 'idle' : 'off'; // idle | starting | ready | off
    this.problem = process.platform === 'win32' ? '' : 'only on Windows';
    this.waiting = null; // { resolve, timer } for the picture being read
    this.rest = '';
  }

  get available() { return this.state !== 'off'; }

  start() {
    if (this.state !== 'idle') return;
    this.state = 'starting';
    try {
      this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (e) { this.fail(e.message || String(e)); return; }
    this.proc.stdout.on('data', (d) => {
      const lines = (this.rest + d).split(/\r?\n/);
      this.rest = lines.pop();
      for (const line of lines) this.line(line.trim());
    });
    this.proc.stdin.on('error', () => { /* the helper went away; exit handles it */ });
    this.proc.on('error', (e) => this.fail(e.message || String(e)));
    this.proc.on('exit', () => { if (this.state !== 'off') this.fail('the text recognition helper stopped'); });
  }

  line(line) {
    if (line === 'ready') { this.state = 'ready'; return; }
    if (line.startsWith('fatal ')) { this.fail(line.slice(6)); return; }
    if (!this.waiting) return;
    if (line.startsWith('text ')) this.answer(Buffer.from(line.slice(5), 'base64').toString('utf8').trim());
    else if (line.startsWith('error ')) this.answer(null);
  }

  answer(value) {
    const w = this.waiting;
    this.waiting = null;
    if (w) { clearTimeout(w.timer); w.resolve(value); }
  }

  fail(problem) {
    this.state = 'off';
    this.problem = problem;
    this.answer(null);
    if (this.proc) { try { this.proc.kill(); } catch (_) { /* already gone */ } }
    this.proc = null;
  }

  // The text in the picture at pngPath: a string (possibly empty), or null when it could not
  // be read. One picture at a time; a second call while one is being read gets null.
  read(pngPath) {
    this.start();
    if (this.state === 'off' || this.waiting || !this.proc) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.waiting = { resolve, timer: setTimeout(() => this.answer(null), 6000) };
      try { this.proc.stdin.write(`${pngPath}\n`); } catch (_) { this.answer(null); }
    });
  }

  stop() {
    this.state = 'off';
    this.answer(null);
    if (this.proc) { try { this.proc.kill(); } catch (_) { /* already gone */ } }
    this.proc = null;
  }
}

module.exports = { TextReader };
