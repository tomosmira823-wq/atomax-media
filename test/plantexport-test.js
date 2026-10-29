// Unit test for the AutoCAD script / route list export. Run: node test/plantexport-test.js
const fs = require('fs'), path = require('path'), os = require('os');
(async () => {
  const tmp = path.join(os.tmpdir(), 'plantexport-' + process.pid + '.mjs'); fs.copyFileSync(path.join(__dirname, '..', 'src', 'plantexport.js'), tmp);
  const { toScript, toCsv, unitScale } = await import('file://' + tmp);
  const eq = (a, b, m) => { if (a !== b) { console.error('FAIL', m, '\n got', JSON.stringify(a), '\n want', JSON.stringify(b)); process.exit(1); } };
  const ops = [
    { op: 'add_pipe', name: 'New pipe', points: [[0, 0.35, -0.6], [9, 0.35, -0.6], [9, 0.35, 2]], radius: 0.075 },
    { op: 'add_box', name: 'Support', size: [0.2, 0.3, 0.4], position: [5, 0.15, -0.6], rotation_y_deg: 30 },
    { op: 'add_cylinder', name: 'Post', radius: 0.05, height: 1, axis: 'y', position: [1, 0.5, 1] },
    { op: 'recolour', node: 'Rail', colour: '#fff' }, { op: 'add_pipe', name: 'Skipped', points: [[0, 0, 0], [1, 0, 0]], radius: 0.1 }
  ];
  const s = toScript(ops, { scale: 1000, addedNames: ['New pipe', 'Support', 'Post'] });
  eq(s.count, 3, 'three parts exported (skipped one not applied)');
  const t = s.text.split('\r\n');
  eq(t.includes('0,600,350'), true, 'model (0,0.35,-0.6) -> CAD (0,600,350)');
  eq(t.includes('9000,600,350'), true, 'second point');
  eq(t.includes('9000,-2000,350'), true, 'third point (z=2 -> y=-2000)');
  const ci = t.indexOf('CYLINDER'); eq(t.slice(ci, ci + 5).join('|'), 'CYLINDER|0,600,350|75|A|9000,600,350', 'first run cylinder');
  eq(t.includes('SPHERE'), true, 'elbow sphere'); eq(t.includes('Skipped'), false, 'unapplied part not exported'); eq(/Skipped/.test(s.text), false, 'no Skipped in script');
  const bi = t.indexOf('BOX'); eq(t.slice(bi, bi + 7).join('|'), 'BOX|C|5000,600,150|L|200|400|300', 'box dims swap Y and Z');
  eq(t.includes('ROTATE3D'), true, 'rotation emitted');
  const pi = t.lastIndexOf('CYLINDER'); eq(t.slice(pi, pi + 5).join('|'), 'CYLINDER|1000,-1000,0|50|A|1000,-1000,1000', 'vertical post from base to top');
  const c = toCsv(ops, { scale: 1000, addedNames: ['New pipe', 'Support', 'Post'] }).split('\r\n');
  eq(c[0], 'Name,Kind,StartX,StartY,StartZ,EndX,EndY,EndZ,Diameter,Length', 'csv header');
  eq(c[1], 'New pipe run 1,pipe,0,600,350,9000,600,350,150,9000', 'csv first run');
  eq(unitScale('probably millimetres'), 1, 'mm'); eq(unitScale('probably metres'), 1000, 'm'); eq(unitScale('x', 'mm'), 1, 'override');
  fs.unlinkSync(tmp); console.log('plantexport ok');
})();
