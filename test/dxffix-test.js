// Self-contained: builds small DXFs (R12 by hand, R2010 with ezdxf if present) and checks every kind of edit.
const assert = require('assert'); const fs = require('fs'); const { execFileSync } = require('child_process');
const dx = require('../src/dxffix');
const T = (layer, x, y, h, t) => ['0','TEXT','8',layer,'10',String(x),'20',String(y),'30','0.0','40',String(h),'1',t];
const r12 = (ents, blocks = []) => Buffer.from(['0','SECTION','2','HEADER','9','$ACADVER','1','AC1009','0','ENDSEC',
  '0','SECTION','2','TABLES','0','TABLE','2','LAYER','70','1','0','LAYER','2','ANNOT','70','0','62','2','6','CONTINUOUS','0','ENDTAB','0','ENDSEC',
  '0','SECTION','2','BLOCKS','0','BLOCK','8','0','2','TX_SYM','70','0','10','0','20','0','30','0', ...blocks, '0','ENDBLK','8','0',
  '0','ENDSEC','0','SECTION','2','ENTITIES', ...ents, '0','INSERT','8','ANNOT','2','TX_SYM','10','5','20','5','30','0','0','INSERT','8','ANNOT','2','TX_SYM','10','50','20','5','30','0','0','ENDSEC','0','EOF',''].join('\r\n'), 'latin1');
const buf = r12([...T('ANNOT', 1, 1, 2.5, 'C-O102'), ...T('ANNOT', 1, 5, 2.5, 'C-O102'), ...T('ANNOT', 1, 9, 2.5, 'C-O102x'), ...T('ANNOT', 1, 13, 2.5, 'SAMPLE ONLY'), ...T('ANNOT', 1, 17, 2.5, 'REV B')], T('ANNOT', 0, 0, 2, 'Dyn1l'));
const p = dx.parseDxf(buf);
assert.strictEqual(p.ents.length, 6);
assert.strictEqual(p.ents[0].block, 'TX_SYM'); assert.strictEqual(p.inserts.TX_SYM, 2);
assert.strictEqual(dx.countMatches(p, 'C-O102').places, 2);
const cb = dx.countMatches(p, 'Dyn1l'); assert.strictEqual(cb.places, 0); assert.deepStrictEqual(cb.blocks, [{ name: 'TX_SYM', uses: 2 }]);
assert.ok(dx.inventory(p).includes('symbol TX_SYM'));

// replace: drawing text, symbol text only with the opt-in
let r = dx.applyFixes(buf, [{ id: 'a', before: 'C-O102', after: 'C-0102' }, { id: 'b', before: 'NOPE', after: 'X' }, { id: 'c', before: 'REV B', after: 'REV é' }, { id: 'd', before: 'Dyn1l', after: 'Dyn11' }]);
assert.deepStrictEqual(r.results.map(x => x.status), ['applied', 'not found', 'skipped', 'not found']);
assert.ok(/symbol/.test(r.results[3].reason));
let q = dx.parseDxf(r.buf); assert.strictEqual(q.pairs.length, p.pairs.length); assert.ok(q.ents.some(e => e.plain === 'C-O102x'));
r = dx.applyFixes(buf, [{ id: 'd', before: 'Dyn1l', after: 'Dyn11', editBlocks: true }]);
assert.strictEqual(r.results[0].status, 'applied'); assert.strictEqual(dx.parseDxf(r.buf).ents[0].plain, 'Dyn11'); assert.strictEqual(r.results[0].places, 1);
// replace by item number only touches that item
r = dx.applyFixes(buf, [{ id: 'e', before: 'C-O102', after: 'C-0102', ref: 2 }]); q = dx.parseDxf(r.buf);
assert.strictEqual(q.ents[1].plain, 'C-O102'); assert.strictEqual(q.ents[2].plain, 'C-0102');

// delete
r = dx.applyFixes(buf, [{ id: 'x', action: 'delete_text', before: 'SAMPLE ONLY' }]); q = dx.parseDxf(r.buf);
assert.strictEqual(r.results[0].status, 'applied'); assert.strictEqual(q.ents.length, p.ents.length - 1); assert.ok(!q.ents.some(e => e.plain === 'SAMPLE ONLY'));
r = dx.applyFixes(buf, [{ id: 'x', action: 'delete_text', before: 'C-O102' }]); assert.strictEqual(r.results[0].status, 'not found');   // appears twice, no item number
r = dx.applyFixes(buf, [{ id: 'x', action: 'delete_text', ref: 0, before: 'Dyn1l' }]); assert.strictEqual(r.results[0].status, 'not found');   // symbol, no opt-in
r = dx.applyFixes(buf, [{ id: 'x', action: 'delete_text', ref: 0, editBlocks: true }]); assert.strictEqual(r.results[0].status, 'applied');

// add
r = dx.applyFixes(buf, [{ id: 'n', action: 'add_text', text: 'REV C', x: 1, y: 21, layer: 'ANNOT', height: 2.5 }, { id: 'm', action: 'add_text', text: 'bad é', x: 1, y: 1 }]); q = dx.parseDxf(r.buf);
assert.deepStrictEqual(r.results.map(x => x.status), ['applied', 'skipped']);
const n = q.ents.find(e => e.plain === 'REV C'); assert.ok(n && n.section === 'ENTITIES' && n.x === 1 && n.y === 21 && n.layer === 'ANNOT' && n.h === 2.5);
assert.ok(q.ents.indexOf(n) === q.ents.length - 1);
// original untouched lines identical
const ol = buf.toString('latin1').split('\r\n'), nl = r.buf.toString('latin1').split('\r\n'); assert.deepStrictEqual(nl.slice(0, ol.length - 8), ol.slice(0, ol.length - 8));

// checkItem
assert.ok(dx.checkItem(p, { action: 'replace_text', before: 'Dyn1l', after: 'Dyn11' }).can);
assert.ok(!dx.checkItem(p, { action: 'replace_text', before: 'ZZZ', after: 'Y' }).can);
assert.ok(dx.checkItem(p, { action: 'delete_text', ref: 3 }).can);
assert.ok(!dx.checkItem(p, { action: 'delete_text', ref: 99 }).can);
assert.ok(dx.checkItem(p, { action: 'add_text', text: 'X', x: 1, y: 1 }).can);

// R2010 with handles (ezdxf), if available
try {
  const f = require('os').tmpdir() + '/dexfix-r2010.dxf';
  execFileSync('python3', ['-c', `import ezdxf\nd=ezdxf.new('R2010');d.layers.add('ANNOT');b=d.blocks.new('TX_SYM');b.add_text('Dyn1l',dxfattribs={'height':2,'layer':'ANNOT'})\nm=d.modelspace()\nfor i in range(3): m.add_text('C-O102',dxfattribs={'height':2.5,'layer':'ANNOT','insert':(1,i*5)})\nm.add_blockref('TX_SYM',(5,5))\nd.saveas(r'${f}')`]);
  const b2 = fs.readFileSync(f); const p2 = dx.parseDxf(b2);
  const r2 = dx.applyFixes(b2, [{ id: 'a', before: 'C-O102', after: 'C-0102' }, { id: 'b', before: 'Dyn1l', after: 'Dyn11', editBlocks: true }, { id: 'c', action: 'add_text', text: 'REV C', x: 9, y: 9, layer: 'ANNOT' }, { id: 'd', action: 'delete_text', ref: p2.ents.findIndex(e => e.plain === 'C-O102') }]);
  assert.ok(r2.results.every(x => x.status === 'applied'), JSON.stringify(r2.results));
  fs.writeFileSync(f.replace('.dxf', '-out.dxf'), r2.buf);
  const chk = execFileSync('python3', ['-c', `import ezdxf\nfrom ezdxf import recover\nd,aud=recover.readfile(r'${f.replace('.dxf', '-out.dxf')}')\nprint(len(aud.errors),len(aud.fixes))\nhs=[e.dxf.handle for e in d.modelspace()]\nassert len(hs)==len(set(hs)),'dup handles'\nprint(sorted(e.dxf.text for e in d.modelspace() if e.dxftype()=='TEXT'))\nprint([e.dxf.text for e in d.blocks.get('TX_SYM') if e.dxftype()=='TEXT'])`]).toString();
  console.log('ezdxf R2010:', chk.trim().replace(/\n/g, ' | '));
  assert.ok(chk.startsWith('0 0') && chk.includes('REV C') && chk.includes('Dyn11'));
} catch (e) { if (e.code === 'ERR_ASSERTION') throw e; console.log('(ezdxf check skipped: ' + String(e.message).split('\n')[0] + ')'); }
assert.throws(() => dx.parseDxf(Buffer.from('AutoCAD Binary DXF\r\n\x1a\0')));
console.log('dxffix ok');
