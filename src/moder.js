// Milo's hands: load a 3D model, describe it so Claude can plan, apply Claude's edit list, check for clashes, render views, export.
// Everything runs on a copy: the original file is never changed.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export const MODEL_EXT = /\.(glb|gltf|obj|stl)$/i;
const r3 = (n) => Math.round(n * 1000) / 1000;
const v3 = (v) => [r3(v.x), r3(v.y), r3(v.z)];

export async function loadModel(name, buf) {
  const ext = (name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
  let obj;
  if (ext === 'glb' || ext === 'gltf') {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const gltf = await new Promise((res, rej) => loader.parse(ext === 'gltf' ? new TextDecoder().decode(buf) : buf, '', res, rej));
    obj = gltf.scene;
  } else if (ext === 'obj') {
    obj = new OBJLoader().parse(new TextDecoder().decode(buf));
  } else if (ext === 'stl') {
    const geo = new STLLoader().parse(buf); geo.computeVertexNormals();
    obj = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xb8c0cc, roughness: 0.6, metalness: 0.3 }));
  } else throw new Error(name + ': Milo can open GLB, GLTF, OBJ and STL models. For STEP or IFC, export a GLB first.');
  const g = new THREE.Group(); g.name = name.replace(/\.[^.]+$/, ''); g.add(obj);
  g.traverse(o => { if (o.isMesh && !o.material) o.material = new THREE.MeshStandardMaterial({ color: 0xb8c0cc }); });
  return g;
}

// everything Milo works on: one root holding each loaded model as a named group
export function makeRoot(models) {
  const root = new THREE.Group(); root.name = 'MODEL';
  for (const m of models) root.add(m.clone(true));
  root.updateMatrixWorld(true);
  return root;
}

const boxOf = (o) => new THREE.Box3().setFromObject(o);
const colourOf = (o) => { const m = Array.isArray(o.material) ? o.material[0] : o.material; return m && m.color ? '#' + m.color.getHexString() : null; };

// named things Claude can point at: top-level groups plus meaningful named children (max 70)
export function nodeList(root) {
  const out = [];
  const seen = new Map();
  const visit = (o, depth) => {
    if (o === root) { o.children.forEach(c => visit(c, depth + 1)); return; }
    const hasGeo = o.isMesh || o.children.some(c => c.isMesh) || o.children.length;
    const b = boxOf(o); if (b.isEmpty()) return;
    let name = o.name && !/^(Scene|RootNode|Object3D)$/i.test(o.name) ? o.name : (o.isMesh ? 'Mesh' : 'Group');
    const n = (seen.get(name) || 0) + 1; seen.set(name, n); if (n > 1) name = `${name}_${n}`;
    o.userData.moName = name;
    out.push({ name, depth, min: v3(b.min), max: v3(b.max), size: v3(b.getSize(new THREE.Vector3())), colour: colourOf(o) || (o.isMesh ? null : undefined), kind: o.isMesh ? 'mesh' : 'group', children: o.children.length });
    if (depth < 4 && !o.isMesh) o.children.forEach(c => visit(c, depth + 1));
  };
  visit(root, 0);
  return out.slice(0, 70);
}

export function describe(root) {
  const b = boxOf(root), size = b.getSize(new THREE.Vector3());
  let tris = 0, meshes = 0; root.traverse(o => { if (o.isMesh) { meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  const longest = Math.max(size.x, size.y, size.z);
  const unit = longest > 500 ? 'probably millimetres' : longest > 0.2 && longest < 200 ? 'probably metres' : 'unclear (check with the user)';
  return { up: 'Y is up. X runs left-right and Z runs toward the viewer.', bounds: { min: v3(b.min), max: v3(b.max), size: v3(size) }, unitGuess: unit, meshes, triangles: Math.round(tris), nodes: nodeList(root) };
}

export function describeText(d) {
  const lines = [`Overall box: min ${d.bounds.min.join(', ')} · max ${d.bounds.max.join(', ')} · size ${d.bounds.size.join(' × ')} (${d.unitGuess}). ${d.up}`, `${d.meshes} meshes, ${d.triangles} triangles.`, 'Named parts (name · min · max · colour):'];
  for (const n of d.nodes) lines.push(`${'  '.repeat(n.depth)}- ${n.name} · [${n.min.join(', ')}] · [${n.max.join(', ')}]${n.colour ? ' · ' + n.colour : ''}`);
  return lines.join('\n');
}

// ---------- applying the edit list ----------
function findNode(root, name) {
  const want = String(name || '').trim().toLowerCase(); if (!want) return null;
  let exact = null, part = null;
  root.traverse(o => {
    if (o === root) return;
    const n = String(o.userData.moName || o.name || '').toLowerCase();
    if (!exact && n === want) exact = o;
    else if (!part && n && (n.includes(want) || want.includes(n)) && n.length > 2) part = o;
  });
  return exact || part;
}
const num = (a, d) => (Number.isFinite(+a) ? +a : d);
const vec = (a, d = [0, 0, 0]) => Array.isArray(a) && a.length >= 3 ? new THREE.Vector3(num(a[0], d[0]), num(a[1], d[1]), num(a[2], d[2])) : new THREE.Vector3(...d);
const colour = (c, d = 0x9aa4b2) => { try { return new THREE.Color(c || d); } catch { return new THREE.Color(d); } };
const stdMat = (c) => new THREE.MeshStandardMaterial({ color: colour(c), roughness: 0.55, metalness: 0.35 });
const tag = (o, name, kind) => { o.name = name; o.userData.moName = name; o.userData.added = true; o.userData.kind = kind; o.castShadow = o.receiveShadow = true; return o; };

function cylinderBetween(a, b, radius, mat, seg = 20) {
  const dir = b.clone().sub(a), len = dir.length();
  if (len < 1e-6) return null;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, seg), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

export function applyOps(root, ops) {
  const added = [], changed = [], warnings = [], lines = [];
  let addGroup = root.getObjectByName('MO_ADDED');
  if (!addGroup) { addGroup = new THREE.Group(); addGroup.name = 'MO_ADDED'; root.add(addGroup); }
  for (const op of (Array.isArray(ops) ? ops : [])) {
    try {
      const kind = String(op.op || '').toLowerCase();
      const name = String(op.name || kind).slice(0, 60);
      if (kind === 'add_pipe') {
        const pts = (op.points || []).map(p => vec(p)); if (pts.length < 2) throw new Error('a pipe needs at least two points');
        const radius = Math.max(1e-4, num(op.radius, num(op.diameter, 0.1) / 2)), mat = stdMat(op.colour);
        const g = new THREE.Group();
        for (let i = 0; i < pts.length - 1; i++) { const c = cylinderBetween(pts[i], pts[i + 1], radius, mat); if (c) g.add(c); }
        for (let i = 1; i < pts.length - 1; i++) { const j = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 14), mat); j.position.copy(pts[i]); g.add(j); }
        if (op.flanges) for (const p of [pts[0], pts[pts.length - 1]]) { const f = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.15, 16, 12), mat); f.position.copy(p); g.add(f); }
        addGroup.add(tag(g, name, 'pipe')); added.push(name);
        let len = 0; for (let i = 0; i < pts.length - 1; i++) len += pts[i].distanceTo(pts[i + 1]);
        lines.push(`Added pipe "${name}" (${pts.length - 1} straight runs, about ${r3(len)} long, radius ${r3(radius)}).`);
      } else if (kind === 'add_box') {
        const s = vec(op.size, [1, 1, 1]), m = new THREE.Mesh(new THREE.BoxGeometry(s.x, s.y, s.z), stdMat(op.colour));
        m.position.copy(vec(op.position)); m.rotation.set(THREE.MathUtils.degToRad(num(op.rotation_x_deg, 0)), THREE.MathUtils.degToRad(num(op.rotation_y_deg, 0)), THREE.MathUtils.degToRad(num(op.rotation_z_deg, 0)));
        addGroup.add(tag(m, name, 'box')); added.push(name); lines.push(`Added box "${name}" ${r3(s.x)} × ${r3(s.y)} × ${r3(s.z)}.`);
      } else if (kind === 'add_cylinder') {
        const r = Math.max(1e-4, num(op.radius, 0.1)), h = Math.max(1e-4, num(op.height, 1)), m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24), stdMat(op.colour));
        const axis = String(op.axis || 'y').toLowerCase(); if (axis === 'x') m.rotation.z = Math.PI / 2; else if (axis === 'z') m.rotation.x = Math.PI / 2;
        m.position.copy(vec(op.position)); addGroup.add(tag(m, name, 'cylinder')); added.push(name); lines.push(`Added cylinder "${name}" radius ${r3(r)}, height ${r3(h)}, along ${axis}.`);
      } else if (kind === 'move' || kind === 'rotate' || kind === 'scale' || kind === 'delete' || kind === 'recolour' || kind === 'recolor') {
        const o = findNode(root, op.node); if (!o) { warnings.push(`Could not find "${op.node}" to ${kind}.`); continue; }
        const label = o.userData.moName || o.name || 'part';
        if (kind === 'delete') { o.parent.remove(o); changed.push(label); lines.push(`Removed "${label}".`); }
        else if (kind === 'move') {
          const b = boxOf(o); const by = op.by ? vec(op.by) : vec(op.to).sub(b.getCenter(new THREE.Vector3()));
          const inv = new THREE.Matrix4().copy(o.parent.matrixWorld).invert(); const local = by.clone().applyMatrix4(inv).sub(new THREE.Vector3().applyMatrix4(inv));
          o.position.add(local); changed.push(label); lines.push(`Moved "${label}" by ${v3(by).join(', ')}.`);
        } else if (kind === 'rotate') {
          const b = boxOf(o), c = b.getCenter(new THREE.Vector3()), axis = String(op.axis || 'y').toLowerCase(), ang = THREE.MathUtils.degToRad(num(op.degrees, 0));
          const ax = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
          const q = new THREE.Quaternion().setFromAxisAngle(ax, ang), pw = new THREE.Vector3(); o.getWorldPosition(pw);
          const np = c.clone().add(pw.clone().sub(c).applyQuaternion(q)); o.parent.worldToLocal(np);
          o.quaternion.premultiply(q); o.position.copy(np); changed.push(label); lines.push(`Rotated "${label}" ${num(op.degrees, 0)}° about ${axis}.`);
        } else if (kind === 'scale') {
          const f = Array.isArray(op.factor) ? vec(op.factor, [1, 1, 1]) : new THREE.Vector3().setScalar(num(op.factor, 1));
          o.scale.multiply(f); changed.push(label); lines.push(`Scaled "${label}" by ${v3(f).join(', ')}.`);
        } else {
          const c = colour(op.colour); o.traverse(m => { if (m.isMesh) { m.material = (Array.isArray(m.material) ? m.material[0] : m.material).clone(); m.material.color = c; } });
          changed.push(label); lines.push(`Recoloured "${label}" ${op.colour}.`);
        }
      } else warnings.push(`Unknown edit "${op.op}" skipped.`);
    } catch (e) { warnings.push(`${op && op.op}: ${e.message}`); }
  }
  root.updateMatrixWorld(true);
  return { added, changed, warnings, lines };
}

// ---------- clash and sanity checks (done in code, not guessed) ----------
export function clashCheck(root) {
  root.updateMatrixWorld(true);
  const addG = root.getObjectByName('MO_ADDED'); const clashes = [], notes = [];
  if (!addG || !addG.children.length) return { clashes, notes: ['Nothing was added, so there is nothing to clash.'] };
  const originals = [];
  root.children.forEach(top => { if (top !== addG) top.traverse(o => { if (o.isMesh) originals.push(o); }); });
  const env = new THREE.Box3(); root.children.forEach(top => { if (top !== addG) env.union(boxOf(top)); });
  for (const part of addG.children) {
    const segs = []; part.traverse(o => { if (o.isMesh) segs.push(o); });
    const hit = new Map();
    for (const sg of segs) {
      const sb = boxOf(sg).expandByScalar(-1e-5);
      for (const o of originals) {
        const ob = boxOf(o); if (!sb.intersectsBox(ob)) continue;
        const ov = sb.clone().intersect(ob), s = ov.getSize(new THREE.Vector3());
        const name = (o.userData.moName || o.name || o.parent?.name || 'part');
        const prev = hit.get(name) || 0; hit.set(name, Math.max(prev, Math.min(s.x, s.y, s.z)));
      }
    }
    for (const [name, depth] of hit) clashes.push({ added: part.name, with: name, overlap: r3(depth) });
    const pb = boxOf(part);
    if (!env.isEmpty() && !env.containsBox(pb)) notes.push(`"${part.name}" sticks out past the existing model's overall box.`);
    const tiny = pb.getSize(new THREE.Vector3()); if (Math.max(tiny.x, tiny.y, tiny.z) < Math.max(...env.getSize(new THREE.Vector3()).toArray()) * 0.01) notes.push(`"${part.name}" is very small next to the model (check the units).`);
  }
  if (!clashes.length) notes.push('No added part overlaps an existing part (box test).');
  return { clashes: clashes.slice(0, 30), notes };
}

// ---------- pictures for Claude ----------
export function renderViews(root, w = 640, h = 440) {
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false }); r.setSize(w, h, false); r.setClearColor(0xeef1f6);
  const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xffffff, 0x8892a6, 1.6)); const dl = new THREE.DirectionalLight(0xffffff, 1.8); dl.position.set(3, 6, 4); sc.add(dl);
  const clone = root.clone(true); sc.add(clone);
  // added parts shown in red so Claude can tell old from new
  const add = clone.getObjectByName('MO_ADDED');
  if (add) add.traverse(o => { if (o.isMesh) { o.material = new THREE.MeshStandardMaterial({ color: 0xd62d20, roughness: 0.5, metalness: 0.2 }); } });
  const b = boxOf(clone), c = b.getCenter(new THREE.Vector3()), size = b.getSize(new THREE.Vector3()), R = Math.max(size.length() * 0.6, 1e-3);
  const cam = new THREE.PerspectiveCamera(35, w / h, R / 100, R * 40);
  const shot = (dir, label) => { cam.position.copy(c).addScaledVector(dir.clone().normalize(), R * 2.6); cam.up.set(0, 1, 0); if (Math.abs(dir.y) > 0.99) cam.up.set(0, 0, -1); cam.lookAt(c); r.render(sc, cam); return { label, base64: r.domElement.toDataURL('image/jpeg', 0.82).split(',')[1] }; };
  const out = [shot(new THREE.Vector3(1, 0.8, 1), 'isometric'), shot(new THREE.Vector3(0, 0, 1), 'front (looking along -Z)'), shot(new THREE.Vector3(0.001, 1, 0), 'top (looking down)'), shot(new THREE.Vector3(1, 0, 0), 'side (looking along -X)')];
  r.dispose(); r.forceContextLoss && r.forceContextLoss();
  return out;
}

export async function exportGlb(root) {
  const buf = await new GLTFExporter().parseAsync(root, { binary: true });
  let bin = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(bin);
}

export { THREE };
