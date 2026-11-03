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
console.log('sld ok: A1, no overlaps, text centred');
