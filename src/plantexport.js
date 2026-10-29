// Turn what Milo added into things AutoCAD / Plant 3D can take: an AutoCAD script (.scr) and a route list (CSV).
// The model is Y-up, AutoCAD is Z-up: model (x, y, z) becomes CAD (x, -z, y). Numbers are multiplied by `scale` (model units -> drawing units, e.g. 1000 for metres -> mm).
// The script draws a 3D centreline and plain 3D solids on MILO- layers. These are ordinary AutoCAD objects, not Plant 3D intelligent pipes.

const n = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const f = (v) => { const r = Math.round(v * 1000) / 1000; return String(Object.is(r, -0) ? 0 : r); };
const cad = (p, k) => [n(p[0]) * k, -n(p[2]) * k, n(p[1]) * k];
const pt = (p, k) => cad(p, k).map(f).join(',');
const safeName = (s) => String(s || '').replace(/[\r\n]+/g, ' ').slice(0, 60);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// only the edits that really made a new part (the applied list names them), in order
function parts(ops, addedNames) {
  const ok = new Set(addedNames || []);
  return (ops || []).filter(o => ['add_pipe', 'add_box', 'add_cylinder', 'add_sphere', 'add_cone', 'add_extrusion'].includes(String(o.op || '').toLowerCase()) && (!addedNames || ok.has(String(o.name || o.op).slice(0, 60))));
}

export function unitScale(unitGuess, choice = 'auto') {
  if (choice === 'mm') return 1;
  if (choice === 'm') return 1000;
  return /millimetre/i.test(unitGuess || '') ? 1 : 1000;   // metres (or unclear) -> millimetres
}

export function toScript(ops, { scale = 1000, addedNames = null, title = 'Milo' } = {}) {
  const k = scale, L = [];
  const layer = (name, colour) => L.push('-LAYER', 'M', name, 'C', String(colour), name, '');
  L.push(`; ${safeName(title)}: AutoCAD script made by Milo. Model Y-up -> CAD Z-up (x, -z, y). Scale ${k} (model units -> drawing units).`);
  L.push('; Open an empty drawing set to the right units, then run it with SCRIPT. Plain 3D solids and centrelines, not Plant 3D pipe objects.');
  L.push('-OSNAP', 'NONE');
  let count = 0;
  for (const op of parts(ops, addedNames)) {
    const kind = String(op.op).toLowerCase(), name = safeName(op.name || kind);
    L.push(`; ${name}`);
    if (kind === 'add_pipe') {
      const pts = (op.points || []).filter(p => Array.isArray(p) && p.length >= 3);
      if (pts.length < 2) continue;
      const r = Math.max(1e-6, n(op.radius, n(op.diameter, 0.1) / 2)) * k;
      layer('MILO-PIPE-CL', 1);
      L.push('3DPOLY', ...pts.map(p => pt(p, k)), '');
      layer('MILO-PIPE', 5);
      for (let i = 0; i < pts.length - 1; i++) {
        const a = cad(pts[i], k), b = cad(pts[i + 1], k); if (dist(a, b) < 1e-6) continue;
        L.push('CYLINDER', a.map(f).join(','), f(r), 'A', b.map(f).join(','));
      }
      for (let i = 1; i < pts.length - 1; i++) L.push('SPHERE', pt(pts[i], k), f(r));
    } else if (kind === 'add_box') {
      const s = op.size || [1, 1, 1], c = op.position || [0, 0, 0];
      layer('MILO-BOX', 3);
      L.push('BOX', 'C', pt(c, k), 'L', f(n(s[0], 1) * k), f(n(s[2], 1) * k), f(n(s[1], 1) * k));
      // model rotation about X, Y, Z -> CAD rotation about X, Z, -Y (so Y by the same angle, Z by the opposite)
      for (const [ax, deg] of [['X', n(op.rotation_x_deg, 0)], ['Z', n(op.rotation_y_deg, 0)], ['Y', -n(op.rotation_z_deg, 0)]]) if (deg) L.push('ROTATE3D', 'L', '', ax, pt(c, k), f(deg));
    } else if (kind === 'add_sphere') {
      layer('MILO-SPHERE', 6); L.push('SPHERE', pt(op.position || [0, 0, 0], k), f(Math.max(1e-6, n(op.radius, 0.1)) * k));
    } else if (kind === 'add_cone') {
      const r = Math.max(1e-6, n(op.radius, 0.1)) * k, h = Math.max(1e-6, n(op.height, 1)) * k, c = cad(op.position || [0, 0, 0], k), axis = String(op.axis || 'y').toLowerCase();
      const d = axis === 'x' ? [h / 2, 0, 0] : axis === 'z' ? [0, -h / 2, 0] : [0, 0, h / 2];   // base to tip, cone axis through the position
      layer('MILO-CONE', 2); L.push('CONE', [c[0] - d[0], c[1] - d[1], c[2] - d[2]].map(f).join(','), f(r), 'A', [c[0] + d[0], c[1] + d[1], c[2] + d[2]].map(f).join(','));
    } else if (kind === 'add_extrusion') {
      const prof = (op.profile || []).filter(p => Array.isArray(p) && p.length >= 2); if (prof.length < 3) continue;
      layer('MILO-EXTRUDE', 30); L.push('PLINE', ...prof.map(p => pt([p[0], n(op.base_y, 0), p[1]], k)), 'C', 'EXTRUDE', 'L', '', f(Math.max(1e-6, n(op.height, 1)) * k));
    } else {
      const r = Math.max(1e-6, n(op.radius, 0.1)) * k, h = Math.max(1e-6, n(op.height, 1)) * k, c = cad(op.position || [0, 0, 0], k), axis = String(op.axis || 'y').toLowerCase();
      // model axis -> CAD axis: x -> x, y -> z, z -> -y
      const d = axis === 'x' ? [h / 2, 0, 0] : axis === 'z' ? [0, -h / 2, 0] : [0, 0, h / 2];
      layer('MILO-CYL', 4);
      L.push('CYLINDER', [c[0] - d[0], c[1] - d[1], c[2] - d[2]].map(f).join(','), f(r), 'A', [c[0] + d[0], c[1] + d[1], c[2] + d[2]].map(f).join(','));
    }
    count++;
  }
  L.push('-VIEW', 'SW', 'ZOOM', 'E', '-OSNAP', 'ENDPOINT');   // finish in a south-west isometric view so the 3D shows
  return { text: L.join('\r\n') + '\r\n', count };
}

export function toCsv(ops, { scale = 1000, addedNames = null } = {}) {
  const rows = [['Name', 'Kind', 'StartX', 'StartY', 'StartZ', 'EndX', 'EndY', 'EndZ', 'Diameter', 'Length']];
  const q = (v) => /[",\r\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  for (const op of parts(ops, addedNames)) {
    const kind = String(op.op).toLowerCase(), name = safeName(op.name || kind);
    if (kind === 'add_pipe') {
      const pts = (op.points || []).filter(p => Array.isArray(p) && p.length >= 3), dia = Math.max(1e-6, n(op.radius, n(op.diameter, 0.1) / 2)) * 2 * scale;
      for (let i = 0; i < pts.length - 1; i++) { const a = cad(pts[i], scale), b = cad(pts[i + 1], scale); rows.push([`${name} run ${i + 1}`, 'pipe', ...a.map(f), ...b.map(f), f(dia), f(dist(a, b))]); }
    } else if (kind === 'add_box') {
      const c = cad(op.position || [0, 0, 0], scale); rows.push([name, 'box', ...c.map(f), '', '', '', '', '']);
    } else if (kind === 'add_sphere' || kind === 'add_cone' || kind === 'add_extrusion') {
      const c = kind === 'add_extrusion' ? cad([(op.profile || [[0, 0]])[0][0], n(op.base_y, 0), (op.profile || [[0, 0]])[0][1]], scale) : cad(op.position || [0, 0, 0], scale);
      rows.push([name, kind.slice(4), ...c.map(f), '', '', '', kind === 'add_extrusion' ? '' : f(n(op.radius, 0.1) * 2 * scale), kind === 'add_sphere' ? '' : f(n(op.height, 1) * scale)]);
    } else {
      const c = cad(op.position || [0, 0, 0], scale); rows.push([name, 'cylinder', ...c.map(f), '', '', '', f(n(op.radius, 0.1) * 2 * scale), f(n(op.height, 1) * scale)]);
    }
  }
  return rows.map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
}
