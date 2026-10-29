// Mouse and keyboard for the computer-control feature, on Windows, with no native modules: each action becomes a small PowerShell script
// that calls user32 (SetCursorPos, mouse_event, keybd_event, SendInput). The script text is built here so it can be unit tested anywhere.
const { execFile } = require('child_process');

const VK = {
  backspace: 0x08, tab: 0x09, return: 0x0D, enter: 0x0D, shift: 0x10, ctrl: 0x11, control: 0x11, alt: 0x12, pause: 0x13, capslock: 0x14, escape: 0x1B, esc: 0x1B,
  space: 0x20, pageup: 0x21, page_up: 0x21, prior: 0x21, pagedown: 0x22, page_down: 0x22, next: 0x22, end: 0x23, home: 0x24, left: 0x25, up: 0x26, right: 0x27, down: 0x28,
  insert: 0x2D, delete: 0x2E, del: 0x2E, super: 0x5B, win: 0x5B, windows: 0x5B, cmd: 0x5B, meta: 0x5B,
  minus: 0xBD, '-': 0xBD, equal: 0xBB, '=': 0xBB, plus: 0xBB, comma: 0xBC, ',': 0xBC, period: 0xBE, '.': 0xBE, slash: 0xBF, '/': 0xBF, backslash: 0xDC, '\\': 0xDC,
  semicolon: 0xBA, ';': 0xBA, quote: 0xDE, "'": 0xDE, bracketleft: 0xDB, '[': 0xDB, bracketright: 0xDD, ']': 0xDD, grave: 0xC0, '`': 0xC0
};
for (let i = 1; i <= 12; i++) VK['f' + i] = 0x6F + i;
for (let c = 65; c <= 90; c++) VK[String.fromCharCode(c + 32)] = c;
for (let d = 0; d <= 9; d++) VK[String(d)] = 0x30 + d;
const EXTENDED = new Set([0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x5B]);
const MODS = new Set([0x10, 0x11, 0x12, 0x5B]);

// "ctrl+shift+s" / "Return" / "alt+F4" -> [vk, vk, ...] (modifiers first); null if a key is unknown
function parseKeys(text) {
  const parts = String(text || '').toLowerCase().split('+').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const codes = [];
  for (const p of parts) { const c = VK[p]; if (c == null) return null; codes.push(c); }
  return codes.filter(c => MODS.has(c)).concat(codes.filter(c => !MODS.has(c)));
}

const PRELUDE = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION u; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  public static void TypeText(string s) {
    foreach (char ch in s) {
      if (ch == '\\r') continue;
      if (ch == '\\n') { keybd_event(0x0D, 0, 0, UIntPtr.Zero); keybd_event(0x0D, 0, 2, UIntPtr.Zero); System.Threading.Thread.Sleep(15); continue; }
      INPUT[] a = new INPUT[2];
      a[0].type = 1; a[0].u.ki.wScan = (ushort)ch; a[0].u.ki.dwFlags = 4;
      a[1].type = 1; a[1].u.ki.wScan = (ushort)ch; a[1].u.ki.dwFlags = 4 | 2;
      SendInput(2, a, Marshal.SizeOf(typeof(INPUT)));
      System.Threading.Thread.Sleep(8);
    }
  }
}
"@
[void][W]::SetProcessDPIAware()
`;

const MOUSE = { left: [2, 4], right: [8, 16], middle: [32, 64] };
const mouseClick = (button, n) => { const [d, u] = MOUSE[button]; let s = ''; for (let i = 0; i < n; i++) s += `[W]::mouse_event(${d},0,0,0,[UIntPtr]::Zero); [W]::mouse_event(${u},0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 60\n`; return s; };
const keyDown = (c) => `[W]::keybd_event(${c},0,${EXTENDED.has(c) ? 1 : 0},[UIntPtr]::Zero)\n`;
const keyUp = (c) => `[W]::keybd_event(${c},0,${(EXTENDED.has(c) ? 1 : 0) | 2},[UIntPtr]::Zero)\n`;
const moveTo = (x, y) => `[void][W]::SetCursorPos(${Math.round(x)},${Math.round(y)}); Start-Sleep -Milliseconds 40\n`;
const withMods = (mods, body) => { const codes = parseKeys(mods) || []; return codes.map(keyDown).join('') + body + codes.slice().reverse().map(keyUp).join(''); };

// a: { kind, x, y, x2, y2, text, repeat, direction, amount, duration } with x/y already in physical screen pixels
function scriptFor(a) {
  let body = '';
  switch (a.kind) {
    case 'move': body = moveTo(a.x, a.y); break;
    case 'click': case 'double_click': case 'triple_click': {
      const n = a.kind === 'click' ? 1 : a.kind === 'double_click' ? 2 : 3;
      body = (a.x != null ? moveTo(a.x, a.y) : '') + withMods(a.mods, mouseClick(a.button || 'left', n)); break;
    }
    case 'drag': body = moveTo(a.x, a.y) + withMods(a.mods, `[W]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 120\n` + moveTo((a.x + a.x2) / 2, (a.y + a.y2) / 2) + moveTo(a.x2, a.y2) + `Start-Sleep -Milliseconds 120; [W]::mouse_event(4,0,0,0,[UIntPtr]::Zero)\n`); break;
    case 'mouse_down': body = '[W]::mouse_event(2,0,0,0,[UIntPtr]::Zero)\n'; break;
    case 'mouse_up': body = '[W]::mouse_event(4,0,0,0,[UIntPtr]::Zero)\n'; break;
    case 'scroll': {
      const amt = Math.max(1, Math.min(50, Math.round(a.amount || 3))), dir = a.direction || 'down';
      const flag = (dir === 'left' || dir === 'right') ? 0x1000 : 0x800, delta = (dir === 'up' || dir === 'right') ? 120 : -120;
      body = (a.x != null ? moveTo(a.x, a.y) : '') + withMods(a.mods, `for ($i=0; $i -lt ${amt}; $i++) { [W]::mouse_event(${flag},0,0,${delta},[UIntPtr]::Zero); Start-Sleep -Milliseconds 40 }\n`); break;
    }
    case 'type': body = `[W]::TypeText([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(String(a.text || ''), 'utf8').toString('base64')}')))\n`; break;
    case 'key': {
      const codes = parseKeys(a.text); if (!codes) throw new Error('Unknown key: ' + a.text);
      const mods = codes.filter(c => MODS.has(c)), keys = codes.filter(c => !MODS.has(c)), reps = Math.max(1, Math.min(100, Math.round(a.repeat || 1)));
      let once = mods.map(keyDown).join('') + keys.map(keyDown).join('') + keys.slice().reverse().map(keyUp).join('') + mods.slice().reverse().map(keyUp).join('');
      if (!keys.length) once = mods.map(keyDown).join('') + mods.slice().reverse().map(keyUp).join('');
      for (let i = 0; i < reps; i++) body += once + 'Start-Sleep -Milliseconds 40\n';
      break;
    }
    case 'hold_key': {
      const codes = parseKeys(a.text); if (!codes) throw new Error('Unknown key: ' + a.text);
      body = codes.map(keyDown).join('') + `Start-Sleep -Milliseconds ${Math.round(Math.min(300, a.duration || 1) * 1000)}\n` + codes.slice().reverse().map(keyUp).join(''); break;
    }
    case 'cursor': body = `$p = New-Object 'W+POINT'; [void][W]::GetCursorPos([ref]$p); Write-Output ($p.X.ToString() + "," + $p.Y.ToString())\n`; break;
    default: throw new Error('Unsupported action: ' + a.kind);
  }
  return PRELUDE + body;
}

function runPs(script, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('Computer control only works on Windows.'));
    const enc = Buffer.from(script, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim().slice(0, 400))); else resolve(String(stdout || '').trim());
    });
  });
}

module.exports = { parseKeys, scriptFor, runPs, VK };
