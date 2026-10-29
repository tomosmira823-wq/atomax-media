// Unit test for the PowerShell scripts the computer-control feature builds (cannot run PowerShell here, so this checks the text). node test/pcinput-test.js
const { parseKeys, scriptFor } = require('../src/pcinput.js');
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error('FAIL', m, JSON.stringify(a), '!=', JSON.stringify(b)); process.exit(1); } };
const has = (s, t, m) => { if (!s.includes(t)) { console.error('FAIL', m, '\n missing:', t); process.exit(1); } };
eq(parseKeys('ctrl+shift+s'), [0x11, 0x10, 0x53], 'ctrl+shift+s'); eq(parseKeys('Return'), [0x0D], 'return'); eq(parseKeys('alt+F4'), [0x12, 0x73], 'alt+f4'); eq(parseKeys('F12'), [0x7B], 'f12');
eq(parseKeys('ctrl+nonsense'), null, 'unknown key'); eq(parseKeys('shift+ctrl+a'), [0x10, 0x11, 0x41], 'modifier order kept, key last'); eq(parseKeys('super+r'), [0x5B, 0x52], 'super+r');
let s = scriptFor({ kind: 'click', x: 500.4, y: 300.6, button: 'left' });
has(s, 'SetCursorPos(500,301)', 'click moves'); has(s, 'mouse_event(2,0,0,0', 'left down'); has(s, 'mouse_event(4,0,0,0', 'left up'); has(s, 'SetProcessDPIAware', 'dpi aware');
s = scriptFor({ kind: 'double_click', x: 10, y: 20, button: 'left' }); eq((s.match(/mouse_event\(2,/g) || []).length, 2, 'double click = 2 downs');
s = scriptFor({ kind: 'click', x: 1, y: 1, button: 'right' }); has(s, 'mouse_event(8,', 'right down');
s = scriptFor({ kind: 'click', x: 1, y: 1, button: 'left', mods: 'shift' }); has(s, 'keybd_event(16,0,0', 'shift down before click'); has(s, 'keybd_event(16,0,2', 'shift up after');
s = scriptFor({ kind: 'type', text: 'SCRIPT é' }); has(s, Buffer.from('SCRIPT é', 'utf8').toString('base64'), 'text is base64 utf8 (no escaping problems)');
s = scriptFor({ kind: 'key', text: 'ctrl+s' }); has(s, 'keybd_event(17,0,0', 'ctrl down'); has(s, 'keybd_event(83,0,0', 's down'); has(s, 'keybd_event(17,0,2', 'ctrl up');
s = scriptFor({ kind: 'key', text: 'Down', repeat: 3 }); eq((s.match(/keybd_event\(40,0,1,/g) || []).length, 3, 'arrow is extended key, repeated 3 times');
s = scriptFor({ kind: 'scroll', x: 5, y: 5, direction: 'down', amount: 4 }); has(s, 'mouse_event(2048,0,0,-120', 'scroll down'); has(s, '-lt 4', 'four clicks');
s = scriptFor({ kind: 'scroll', direction: 'up', amount: 2 }); has(s, 'mouse_event(2048,0,0,120', 'scroll up');
s = scriptFor({ kind: 'drag', x: 0, y: 0, x2: 100, y2: 50 }); has(s, 'SetCursorPos(100,50)', 'drag ends'); has(s, 'mouse_event(4,', 'drag release');
s = scriptFor({ kind: 'cursor' }); has(s, "New-Object 'W+POINT'", 'cursor struct');
// the C# must be balanced and the here-string closed at the start of a line
const t = scriptFor({ kind: 'move', x: 1, y: 1 }); eq(t.split('\n').filter(l => l === '"@').length, 1, 'here-string closed'); eq((t.match(/{/g) || []).length, (t.match(/}/g) || []).length, 'balanced braces');
let threw = false; try { scriptFor({ kind: 'key', text: 'ctrl+bogus' }); } catch { threw = true; } eq(threw, true, 'bad key throws');
console.log('pcinput ok');
