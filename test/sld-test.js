// SLD layout check on a real job's content (Hollins Lane): fits A1, no text touching text or linework, text in boxes centred. Needs python3 + ezdxf.
const D = require('../src/dxfmaker.js'), fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hollins-sld.json'), 'utf8'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sld-'));
const r = D.make(spec, dir, 'HL', { border: 'atomax', fill: { client: spec.client, project: 'X021126 Hollins Lane', drawn: 'TM', checked: 'DH', approved: 'JB' } });
const sheet = D.layoutSld(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hollins-sld.json'), 'utf8')), { border: 'atomax', fill: {} }).sheet;
if (sheet !== 'A1') { console.log('FAIL: Hollins Lane should fit A1, got', sheet); process.exit(1); }
const ov = execFileSync('python3', [path.join(__dirname, 'dxf-overlaps.py'), r.path]).toString().trim().split('\n').pop();
const ce = execFileSync('python3', [path.join(__dirname, 'dxf-centring.py'), r.path]).toString().trim().split('\n').pop();
console.log(ov); console.log(ce);
if (!/ 0 problems$/.test(ov)) { console.log('FAIL: overlaps'); process.exit(1); }
const worst = +(ce.match(/worst offset ([\d.]+)/) || [])[1]; if (!(worst <= 0.3)) { console.log('FAIL: text not centred'); process.exit(1); }
// check report X021126 (106): the LV SWITCHROOM box holds the switchboard; the RMU, transformer and generator feeding it sit outside, their cables crossing the wall
{ const L = D.layoutSld(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hollins-sld.json'), 'utf8')), { border: 'atomax', fill: {} }), P = D.flatPrims(L.prims);
  const box = D.primsBounds(P.filter(p => p.layer === 'SLD-ENCLOSURE')), at = (re) => P.find(p => (p.t === 'mtext' || p.t === 'text') && re.test(p.text));
  for (const re of [/^TX01\n/, /^RMU-01\n/, /^GEN-01\n/]) { const t = at(re); if (!t) throw new Error('no label ' + re); if (t.y <= box.y1) throw new Error(re + ' is inside the switchroom box'); }
  const q1 = at(/^Q1/); if (!q1 || q1.y > box.y1 || q1.y < box.y0) throw new Error('Q1 should be inside the switchroom box'); }
// markup R2 (SLD): boards in the same room inside the room box, a feeder ending in the room (DB-03 to MCC-01 PLC) inside too,
// field cables leaving through the bottom wall; earthing off its own earth bar
{ const L = D.layoutSld(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hollins-sld-room.json'), 'utf8')), { border: 'atomax', fill: {} }), P = D.flatPrims(L.prims);
  const enc = P.filter(p => p.layer === 'SLD-ENCLOSURE'), box = D.primsBounds(enc), at = (re) => P.find(p => (p.t === 'mtext' || p.t === 'text') && re.test(p.text));
  // the room outline steps (one cable level for every board in it, a lobe round a feeder that stays inside), so "inside" is judged in the
  // item's own column: between the lowest wall dash spanning its x and the top of the room
  const wallUnder = (x) => Math.min(...enc.filter(p => p.t === 'line' && Math.abs(p.y1 - p.y2) < 1e-6 && Math.min(p.x1, p.x2) <= x + 4 && Math.max(p.x1, p.x2) >= x - 4).map(p => p.y1));   // dashes: a point can sit over a gap
  const inside = (t) => t.y > wallUnder(t.x) && t.y < box.y1;
  for (const re of [/^MCC-01\n/, /^DB-03/, /^MCC-01 PLC/, /^MET-01/, /^DB-01\n/]) { const t = at(re); if (!t || !inside(t)) throw new Error(re + ' should be inside the room box'); }
  for (const re of [/^M-P01/, /^FT-01/, /^TX01\n/]) { const t = at(re); if (!t || inside(t)) throw new Error(re + ' should be outside the room box'); }
  // boards fed side by side in the room: their outgoing cables start at one level (the tags sit in one row)
  const cabY = (re) => { const t = at(re); return t ? Math.round(t.y) : null; };
  if (Math.abs(cabY(/^C-026/) - cabY(/^C-027/)) > 1) throw new Error('DB-03 cables not level');
  if (!at(/EARTH BAR$/) || !P.some(p => p.layer === 'SLD-EARTH')) throw new Error('no earth bar');
  if (D.cleanLabel('400V 3PH+N 50HZ\nPFC 31.5kA 3PH SYM') !== '400V 3PH+N 50Hz\nPROSPECTIVE FAULT 31.5kA 3PH SYM') throw new Error('Hz / prospective fault');
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sldr-')); const made = D.make(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hollins-sld-room.json'), 'utf8')), tmp, 'R', { border: 'atomax', fill: {} });
  const r = require('child_process').spawnSync('python3', [path.join(__dirname, 'dxf-overlaps.py'), made.path || made.files[0].path], { encoding: 'utf8' }); if (!/ 0 problems/.test(r.stdout)) throw new Error('room SLD overlaps: ' + r.stdout.slice(-300)); }
// 14:53 run: the room box must not stretch the drawing (it was scaled to 86% on A0); C-001's voltage never written twice
{ const L = D.layoutSld(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hollins-sld-room.json'), 'utf8')), { border: 'atomax', fill: {} });
  if ((L.sheet || L.page) !== 'A1') throw new Error('room SLD should stay on A1, got ' + (L.sheet || L.page));
  if (D.flatPrims(L.prims).some(p => /REDUCED TO/.test(String(p.text || '')))) throw new Error('room SLD was scaled down'); }
console.log('sld ok: A1, no overlaps, text centred');
