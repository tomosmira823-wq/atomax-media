const assert = require('assert'); const fs = require('fs');
const dx = require('../src/dxffix');
const buf = fs.readFileSync(process.argv[2] || '/tmp/dx/t.dxf');
const p = dx.parseDxf(buf);
assert.ok(p.ents.length >= 4);
assert.strictEqual(dx.countMatches(p, 'C-O102').places, 2);   // not the C-O102x one
const r = dx.applyFixes(buf, [{ id: 'a', before: 'C-O102', after: 'C-0102' }, { id: 'b', before: 'NOPE', after: 'X' }, { id: 'c', before: 'C-103', after: 'C-1é' }]);
assert.strictEqual(r.results[0].places, 2); assert.strictEqual(r.results[1].status, 'not found'); assert.strictEqual(r.results[2].status, 'skipped');
const q = dx.parseDxf(r.buf);
assert.strictEqual(q.pairs.length, p.pairs.length);
assert.ok(q.ents.some(e => e.plain.includes('C-O102x')));
assert.strictEqual(dx.countMatches(q, 'C-O102').places, 0);
let diff = 0; p.pairs.forEach((x, i) => { if (x.val !== q.pairs[i].val) diff++; }); assert.strictEqual(diff, 2);
assert.throws(() => dx.parseDxf(Buffer.from('AutoCAD Binary DXF\r\n\x1a\0')));
console.log('dxffix ok');
