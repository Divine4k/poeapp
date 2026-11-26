'use strict';
// Takes the picture of one screen in a process of its own, so the app itself does not stand
// still while Windows hands it over (asking Windows from the app took about half a second and
// froze it each time: see "Performance" in CLAUDE.md).
//
// Windows only. A small PowerShell helper, like the one in gamewin.js. Asked for a rectangle
// of the screen in real pixels, it copies those pixels (the same copy every screenshot tool
// makes) and writes them back. It reads nothing else, touches no other program and sends
// nothing anywhere. It ends by itself when the app does.
//
// Whether its pictures may be used at all is decided in capture.js, by comparing them with the
// app's own pictures first.
const { spawnAside } = require('./aside');

// One request per line on its input: "x y width height". The answer: 16 bytes (the letters
// PCAP, width, height, 1 for done or 0 for failed), then width x height x 4 bytes, blue green
// red and a full fourth byte, top row first: the same layout as the app's own pictures.
const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
public static class PoeAppCapture {
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr dc, ref BITMAPINFOHEADER bmi, uint usage, out IntPtr bits, IntPtr section, uint offset);
  [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr o);
  [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, uint rop);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr o);
  [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
  [StructLayout(LayoutKind.Sequential)] struct BITMAPINFOHEADER {
    public int biSize, biWidth, biHeight; public short biPlanes, biBitCount;
    public int biCompression, biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant;
  }
  // Real pixels, whatever the scale of the screen.
  public static void Aware() {
    try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch (Exception) { }
    try { SetProcessDPIAware(); } catch (Exception) { }
  }
  static byte[] Shot(int x, int y, int w, int h) {
    IntPtr screen = GetDC(IntPtr.Zero), mem = IntPtr.Zero, bmp = IntPtr.Zero, old = IntPtr.Zero;
    try {
      mem = CreateCompatibleDC(screen);
      BITMAPINFOHEADER bi = new BITMAPINFOHEADER();
      bi.biSize = 40; bi.biWidth = w; bi.biHeight = -h; bi.biPlanes = 1; bi.biBitCount = 32;
      IntPtr bits;
      bmp = CreateDIBSection(screen, ref bi, 0, out bits, IntPtr.Zero, 0);
      if (bmp == IntPtr.Zero || bits == IntPtr.Zero) return null;
      old = SelectObject(mem, bmp);
      if (!BitBlt(mem, 0, 0, w, h, screen, x, y, 0x00CC0020)) return null;
      byte[] px = new byte[w * h * 4];
      Marshal.Copy(bits, px, 0, px.Length);
      for (int i = 3; i < px.Length; i += 4) px[i] = 255;
      return px;
    } finally {
      if (old != IntPtr.Zero) SelectObject(mem, old);
      if (bmp != IntPtr.Zero) DeleteObject(bmp);
      if (mem != IntPtr.Zero) DeleteDC(mem);
      ReleaseDC(IntPtr.Zero, screen);
    }
  }
  public static void Run() {
    Aware();
    Stream output = Console.OpenStandardOutput();
    TextReader input = Console.In;
    string line;
    while ((line = input.ReadLine()) != null) {
      string[] p = line.Trim().Split(' ');
      int x = 0, y = 0, w = 0, h = 0; byte[] px = null;
      try {
        x = int.Parse(p[0]); y = int.Parse(p[1]); w = int.Parse(p[2]); h = int.Parse(p[3]);
        if (w > 0 && h > 0 && w <= 16384 && h <= 16384) px = Shot(x, y, w, h);
      } catch (Exception) { px = null; }
      byte[] head = new byte[16];
      head[0] = 80; head[1] = 67; head[2] = 65; head[3] = 80;
      BitConverter.GetBytes(w).CopyTo(head, 4); BitConverter.GetBytes(h).CopyTo(head, 8);
      BitConverter.GetBytes(px == null ? 0 : 1).CopyTo(head, 12);
      output.Write(head, 0, 16);
      if (px != null) output.Write(px, 0, px.Length);
      output.Flush();
    }
  }
}
'@
[PoeAppCapture]::Run()
`;

const HEAD = 16;

// Takes the helper's answers apart as they arrive in pieces. feed(chunk) returns the answers
// completed by that piece: { ok, width, height, data }. Throws on bytes that are not an answer.
class AnswerReader {
  constructor() { this.parts = []; this.have = 0; }
  feed(chunk) {
    this.parts.push(chunk); this.have += chunk.length;
    const out = [];
    for (;;) {
      if (this.have < HEAD) break;
      if (this.parts.length > 1 && this.parts[0].length < HEAD) this.parts = [Buffer.concat(this.parts)];
      const head = this.parts[0];
      if (head.toString('latin1', 0, 4) !== 'PCAP') throw new Error('not an answer from the capture helper');
      const width = head.readInt32LE(4), height = head.readInt32LE(8), ok = head.readInt32LE(12) === 1;
      const size = ok ? width * height * 4 : 0;
      if (this.have < HEAD + size) break;
      const all = this.parts.length === 1 ? this.parts[0] : Buffer.concat(this.parts);
      out.push({ ok, width, height, data: ok ? all.subarray(HEAD, HEAD + size) : null });
      const rest = all.subarray(HEAD + size);
      this.parts = rest.length ? [rest] : []; this.have = rest.length;
    }
    return out;
  }
}

class CaptureHelper {
  // spawnImpl: for tests.
  constructor({ spawnImpl = spawnAside, timeoutMs = 1500, onStarted = () => {} } = {}) {
    this.onStarted = onStarted;
    this.spawnImpl = spawnImpl;
    this.timeoutMs = timeoutMs;
    this.proc = null;
    this.waiting = null;  // the one request under way: { resolve, timer }
    this.queue = Promise.resolve();
    this.failed = 0;      // times it could not be started or stopped answering
    this.gaveUp = false;
  }

  get usable() { return process.platform === 'win32' && !this.gaveUp; }

  start() {
    if (this.proc || !this.usable) return;
    let proc;
    try {
      proc = this.spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }, (ms) => this.onStarted(ms));
    } catch (_) { this.trouble(); return; }
    this.proc = proc;
    const reader = new AnswerReader();
    proc.stdout.on('data', (d) => {
      let answers;
      try { answers = reader.feed(d); } catch (_) { this.stop(); this.trouble(); return; }
      for (const a of answers) this.answer(a);
    });
    const gone = () => { if (this.proc === proc) { this.proc = null; this.answer(null); } };
    proc.on('error', () => { gone(); this.trouble(); });
    proc.on('exit', gone);
    proc.stdin.on('error', () => {});
  }

  trouble() { this.failed++; if (this.failed >= 3) this.gaveUp = true; }

  answer(a) {
    const w = this.waiting;
    if (!w) return;
    this.waiting = null;
    clearTimeout(w.timer);
    w.resolve(a && a.ok && a.width === w.width && a.height === w.height ? a.data : null);
  }

  // The pixels of that rectangle of the screen (real pixels), or null when the helper could
  // not give them in time. One at a time; a second request waits for the first.
  shot(rect) {
    const run = () => new Promise((resolve) => {
      if (!this.usable) { resolve(null); return; }
      this.start();
      if (!this.proc) { resolve(null); return; }
      const x = Math.round(rect.x), y = Math.round(rect.y), width = Math.round(rect.width), height = Math.round(rect.height);
      this.waiting = {
        resolve, width, height,
        // No answer in time: the helper is started afresh, so a late answer cannot be taken for the next one.
        timer: setTimeout(() => { this.waiting = null; this.stop(); this.trouble(); resolve(null); }, this.timeoutMs),
      };
      try { this.proc.stdin.write(`${x} ${y} ${width} ${height}\n`); } catch (_) { this.answer(null); }
    });
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  stop() {
    const p = this.proc;
    this.proc = null;
    if (p) { try { p.stdin.end(); } catch (_) { /* gone */ } try { p.kill(); } catch (_) { /* gone */ } }
    this.answer(null);
  }
}

// How many of the inventory's slots hold exactly the same pixels in two pictures of the screen.
// The fourth byte of a pixel is not looked at (the reader never uses it).
function slotsSame(a, b, rect) {
  const { COLS, ROWS, extractCell } = require('./core/inventory/grid');
  let same = 0;
  for (let k = 0; k < COLS * ROWS; k++) {
    if (Buffer.compare(extractCell(a, rect, Math.floor(k / COLS), k % COLS), extractCell(b, rect, Math.floor(k / COLS), k % COLS)) === 0) same++;
  }
  return same;
}

// Is one of them over the part of the screen the reader looks at (the inventory's grid, with a
// slot's width around it)? Only then does it matter whether a picture leaves the app's windows
// out: anywhere else on the screen they change nothing that is read.
function overReadArea(win, display, width, height) {
  const { ROWS, gridRect } = require('./core/inventory/grid');
  const g = gridRect(width, height), b = display.bounds, fx = width / b.width, fy = height / b.height;
  const area = { x0: g.x0 - g.cell, y0: g.y0 - g.cell, x1: width, y1: g.y0 + (ROWS + 1) * g.cell };
  const w = { x0: (win.x - b.x) * fx, y0: (win.y - b.y) * fy, x1: (win.x + win.width - b.x) * fx, y1: (win.y + win.height - b.y) * fy };
  return w.x0 < area.x1 && w.x1 > area.x0 && w.y0 < area.y1 && w.y1 > area.y0;
}

module.exports = { CaptureHelper, AnswerReader, slotsSame, overReadArea, SCRIPT };
