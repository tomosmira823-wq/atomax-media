// The modeling room: a studio next to the drawing room. A scan pedestal in the middle shows whatever model was last made
// from a photo. Kept in its own file so the drawing room code in office.js stays untouched.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const GREEN = 0x40bd00, NAVY = 0x0e121d, NAVY2 = 0x1b2131, WHITE = 0xf4f5f7;
export const WALL_H = 6;
const LOGO_AR = 560 / 2163;

function mat(color, opts = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05, ...opts }); }
function box(w, h, d, m, x = 0, y = 0, z = 0, cast = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z); mesh.castShadow = cast; mesh.receiveShadow = true; return mesh;
}
function textPlane(text, w, h, { color = '#ffffff', size = 64, weight = '700', spacing = 0 } = {}) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = Math.round(1024 * h / w);
  const ctx = c.getContext('2d'); ctx.fillStyle = color; ctx.font = `${weight} ${size}px Segoe UI, Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (spacing) ctx.letterSpacing = spacing + 'px';
  ctx.fillText(text, c.width / 2, c.height / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
}

// Geometry of the room: same depth as the drawing room, 16 wide, directly west of it (with the same wall thickness gap).
export function modelingBounds(drawX1, z0, z1, w = 16) {
  const x0 = drawX1 + 0.3, x1 = x0 + w;
  return { w, x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, d: z1 - z0 };
}

export function buildModelingRoom({ scene, bounds: M, logoTex, doorZ = -0.5 }) {
  const GL = { emissive: GREEN, emissiveIntensity: 0.5 };
  const backWall = new THREE.Group(), leftWall = new THREE.Group();
  scene.add(backWall); scene.add(leftWall);
  const clickRoots = [], obstacles = [];

  // floor: dark polished concrete with a faint green grid, so it reads as a studio rather than an office
  const fc = document.createElement('canvas'); fc.width = 1024; fc.height = Math.round(1024 * M.d / M.w);
  const fx = fc.getContext('2d'); fx.fillStyle = '#242b3b'; fx.fillRect(0, 0, fc.width, fc.height);
  fx.strokeStyle = 'rgba(64,189,0,0.22)'; fx.lineWidth = 2;
  const step = fc.width / 16;
  for (let x = 0; x <= fc.width; x += step) { fx.beginPath(); fx.moveTo(x, 0); fx.lineTo(x, fc.height); fx.stroke(); }
  for (let y = 0; y <= fc.height; y += step) { fx.beginPath(); fx.moveTo(0, y); fx.lineTo(fc.width, y); fx.stroke(); }
  const ft = new THREE.CanvasTexture(fc); ft.colorSpace = THREE.SRGBColorSpace; ft.anisotropy = 8;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(M.w, M.d), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.35, metalness: 0.15 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(M.cx, 0.002, M.cz); floor.receiveShadow = true; scene.add(floor);
  scene.add(box(M.w + 1, 0.6, M.d + 1, mat(NAVY2), M.cx, -0.32, M.cz, false));

  // walls (back + west; the front stays open for the camera, the east side is the drawing room's own wall)
  backWall.add(box(M.w + 0.3, WALL_H, 0.3, mat(NAVY, { roughness: 0.9 }), M.cx, WALL_H / 2, M.z0 - 0.15));
  backWall.add(box(M.w, 0.14, 0.05, mat(GREEN, GL), M.cx, 5.3, M.z0 + 0.05, false));
  {   // west wall = divider with the drawing room, with a doorway
    const wallW = mat(0xeef0f3, { roughness: 0.95 }), wx = M.x0 - 0.15, d0 = doorZ - 1.0, d1 = doorZ + 1.0, fr = mat(NAVY2);
    leftWall.add(box(0.3, WALL_H, d0 - M.z0, wallW, wx, WALL_H / 2, (M.z0 + d0) / 2));
    leftWall.add(box(0.3, WALL_H, M.z1 - d1, wallW, wx, WALL_H / 2, (d1 + M.z1) / 2));
    leftWall.add(box(0.3, WALL_H - 3.2, d1 - d0, wallW, wx, 3.2 + (WALL_H - 3.2) / 2, doorZ));
    [d0, d1].forEach(z => leftWall.add(box(0.36, 3.25, 0.12, fr, wx, 1.62, z)));
    leftWall.add(box(0.36, 0.12, d1 - d0 + 0.12, fr, wx, 3.25, doorZ));
    leftWall.add(box(0.4, 0.03, d1 - d0, mat(GREEN, GL), wx, 0.03, doorZ, false));
  }
  leftWall.add(box(0.05, 0.14, M.d, mat(GREEN, GL), M.x0 + 0.05, 5.3, M.cz, false));

  // sign + logo
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(6, 6 * LOGO_AR), new THREE.MeshBasicMaterial({ map: logoTex, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  logo.position.set(M.cx, 4.3, M.z0 + 0.05); backWall.add(logo);
  backWall.add(box(6.4, 0.05, 0.03, mat(GREEN, GL), M.cx, 3.35, M.z0 + 0.06, false));
  const tag = textPlane('MODELING ROOM', 6.4, 0.7, { color: '#8e97ab', size: 64, weight: '600', spacing: 10 }); tag.position.set(M.cx, 2.85, M.z0 + 0.05); backWall.add(tag);

  // lights: this room is outside the main sun's shadow box, so it gets its own key light
  const key = new THREE.DirectionalLight(0xfff1dc, 1.6); key.position.set(M.cx + 6, 14, M.cz + 10); key.target.position.set(M.cx, 0, M.cz - 2);
  key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
  const sc = key.shadow.camera; sc.left = -12; sc.right = 12; sc.top = 12; sc.bottom = -12; sc.near = 1; sc.far = 40; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.04;
  scene.add(key); scene.add(key.target);
  const glow = new THREE.PointLight(0x8dff6a, 9, 26, 1.6); glow.position.set(M.cx, 4.2, M.cz - 2); scene.add(glow);

  // ---- the scan pedestal (click it) ----
  const px = M.cx, pz = M.cz - 1.5;
  const ped = new THREE.Group();
  ped.add(new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.5, 0.35, 48), mat(NAVY2, { roughness: 0.4, metalness: 0.4 })));
  ped.children[0].position.y = 0.175; ped.children[0].castShadow = ped.children[0].receiveShadow = true;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 0.08, 48), mat(0xe8eaee, { roughness: 0.3 })); disc.position.y = 0.39; disc.receiveShadow = true; ped.add(disc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.25, 0.05, 10, 72), mat(GREEN, { emissive: GREEN, emissiveIntensity: 0.9 })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.36; ped.add(ring);
  // the scanning hoop that sweeps up and down while a model is being made
  const hoop = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.035, 8, 72), new THREE.MeshBasicMaterial({ color: 0x8dff6a, transparent: true, opacity: 0.0 })); hoop.rotation.x = Math.PI / 2; hoop.position.y = 0.5; ped.add(hoop);
  const slot = new THREE.Group(); slot.position.y = 0.43; ped.add(slot);          // the model sits here and turns slowly
  ped.position.set(px, 0, pz); scene.add(ped); obstacles.push({ x: px, z: pz, r: 2.8 });
  clickRoots.push(ped);

  // placeholder shown until a first model exists: a faint wire cube
  const holder = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.6, 1.6, 1.6)), new THREE.LineBasicMaterial({ color: 0x8dff6a, transparent: true, opacity: 0.55 }));
  holder.position.y = 0.9; slot.add(holder);

  // ---- camera on a tripod and two soft boxes, aimed at the pedestal ----
  const dark = mat(NAVY2, { roughness: 0.5, metalness: 0.3 });
  const tri = new THREE.Group();
  // three legs run from one apex under the camera down to feet on the floor
  const APEX = new THREE.Vector3(0, 2.1, 0);
  [0, 1, 2].forEach(i => {
    const a = i * 2.094, foot = new THREE.Vector3(Math.sin(a) * 0.95, 0, Math.cos(a) * 0.95), d = APEX.clone().sub(foot), L = d.length();
    const leg = box(0.09, L, 0.09, dark, 0, 0, 0); leg.position.copy(foot).addScaledVector(d, 0.5); leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); tri.add(leg);
    tri.add(box(0.2, 0.06, 0.2, mat(0x0b0e16), foot.x, 0.03, foot.z, false));
  });
  tri.add(box(0.2, 0.3, 0.2, dark, 0, 2.15, 0));          // head block where the legs meet
  tri.add(box(0.34, 0.06, 0.34, mat(0x0b0e16), 0, 2.33, 0)); // mounting plate
  const cam = new THREE.Group(); cam.add(box(0.7, 0.45, 0.4, mat(0x2b3348), 0, 0, 0)); const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.4, 20), mat(0x0b0e16, { roughness: 0.2, metalness: 0.5 })); lens.rotation.x = Math.PI / 2; lens.position.z = 0.4; cam.add(lens);
  cam.add(box(0.12, 0.05, 0.05, mat(GREEN, GL), 0.22, 0.26, 0, false)); cam.position.y = 2.33 + 0.03 + 0.225; tri.add(cam); // sits right on the plate
  tri.position.set(px + 3.2, 0, pz - 4.4); tri.lookAt(px, 0, pz); scene.add(tri); obstacles.push({ x: px + 3.2, z: pz - 4.4, r: 1 });   // back right, so the doorway stays clear
  [[-5.6, 2.6], [4.6, -3.4]].forEach(([dx, dz], i) => {
    const sb = new THREE.Group();
    sb.add(box(0.07, 2.6, 0.07, dark, 0, 1.3, 0)); sb.add(box(0.7, 0.06, 0.7, dark, 0, 0.03, 0));
    const panel = box(1.6, 1.6, 0.14, mat(0xf4f5f7, { emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.9 }), 0, 2.9, 0.1, false); sb.add(panel);
    sb.add(box(1.75, 1.75, 0.08, dark, 0, 2.9, 0, false));
    sb.position.set(px + dx, 0, pz + dz); sb.lookAt(px, 2.0, pz); scene.add(sb); obstacles.push({ x: px + dx, z: pz + dz, r: 0.8 });
  });

  // ---- workbench with a small 3D printer and some finished prints, along the back wall ----
  const bench = new THREE.Group();
  bench.add(box(5.6, 0.12, 1.6, mat(0xb98a55, { roughness: 0.6 }), 0, 1.0, 0));
  [[-2.6, -0.65], [2.6, -0.65], [-2.6, 0.65], [2.6, 0.65]].forEach(([x, z]) => bench.add(box(0.1, 1.0, 0.1, dark, x, 0.5, z)));
  const printer = new THREE.Group();
  printer.add(box(1.3, 0.12, 1.1, mat(0x2b3348), 0, 0.06, 0));
  [[-0.6, -0.5], [0.6, -0.5], [-0.6, 0.5], [0.6, 0.5]].forEach(([x, z]) => printer.add(box(0.06, 1.3, 0.06, mat(GREEN, GL), x, 0.7, z, false)));
  printer.add(box(1.3, 0.07, 1.1, mat(0x2b3348), 0, 1.35, 0));
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.0), new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, transmission: 0.8, opacity: 0.25, transparent: true, roughness: 0.05, depthWrite: false })); glass.position.y = 0.75; printer.add(glass);
  const part = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 6), mat(GREEN, { emissive: GREEN, emissiveIntensity: 0.25 })); part.position.set(0, 0.37, 0); part.castShadow = true; printer.add(part);
  printer.position.set(-1.7, 1.06, 0); bench.add(printer);
  [[0.8, 0xe8eaee, 'sphere'], [1.7, GREEN, 'cone'], [2.3, 0xffd43b, 'box']].forEach(([x, c, k]) => {
    const g = k === 'sphere' ? new THREE.SphereGeometry(0.28, 20, 14) : k === 'cone' ? new THREE.ConeGeometry(0.28, 0.6, 6) : new THREE.BoxGeometry(0.45, 0.45, 0.45);
    const m = new THREE.Mesh(g, mat(c, { roughness: 0.5 })); m.position.set(x, 1.06 + (k === 'cone' ? 0.3 : k === 'sphere' ? 0.28 : 0.22), 0.1); m.castShadow = true; bench.add(m);
  });
  bench.position.set(M.cx - 4.6, 0, M.z0 + 1.2); scene.add(bench); obstacles.push({ x: M.cx - 4.6, z: M.z0 + 1.4, r: 3 });

  // shelf of reference prints on the west wall
  const shelf = new THREE.Group();
  shelf.add(box(0.5, 0.08, 4.4, mat(0xb98a55), 0, 0, 0)); shelf.add(box(0.5, 0.08, 4.4, mat(0xb98a55), 0, 1.3, 0));
  [-2.1, 2.1].forEach(z => shelf.add(box(0.5, 1.4, 0.08, dark, 0, 0.65, z)));
  [[-1.5, 0xe8eaee], [-0.5, GREEN], [0.6, 0xffd43b], [1.5, 0x3b6aa8]].forEach(([z, c], i) => { const m = new THREE.Mesh(i % 2 ? new THREE.IcosahedronGeometry(0.3, 0) : new THREE.CylinderGeometry(0.25, 0.3, 0.6, 12), mat(c, { roughness: 0.5 })); m.position.set(0, 0.4, z); m.castShadow = true; shelf.add(m); });
  shelf.position.set(M.x0 + 0.5, 1.4, M.cz + 4.6); leftWall.add(shelf);

  // ---- dressing: workstation, track lights, wireframe posters, LED strips, plants ----
  const steel = mat(0x2a3042, { roughness: 0.35, metalness: 0.5 });
  const wireCanvas = (kind, w = 512, h = 640) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
    g.fillStyle = '#10151f'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(64,189,0,0.18)'; g.lineWidth = 1;
    for (let x = 0; x < w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } for (let y = 0; y < h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.strokeStyle = '#40bd00'; g.lineWidth = 3; g.lineJoin = 'round';
    const cx = w / 2, cy = h * 0.46, r = w * 0.27;
    if (kind === 0) { const o = r * 0.55, f = [[-r, -r + o], [r, -r + o], [r, r + o], [-r, r + o]], b = f.map(([x, y]) => [x + o, y - o]); [f, b].forEach(q => { g.beginPath(); q.forEach(([x, y], i) => i ? g.lineTo(cx + x, cy + y) : g.moveTo(cx + x, cy + y)); g.closePath(); g.stroke(); }); f.forEach((q, i) => { g.beginPath(); g.moveTo(cx + q[0], cy + q[1]); g.lineTo(cx + b[i][0], cy + b[i][1]); g.stroke(); }); }
    else if (kind === 1) { g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke(); for (let k = 1; k < 5; k++) { g.beginPath(); g.ellipse(cx, cy, r, r * k / 5, 0, 0, 7); g.stroke(); g.beginPath(); g.ellipse(cx, cy, r * k / 5, r, 0, 0, 7); g.stroke(); } }
    else { const a = [cx, cy - r], b = [cx - r, cy + r * 0.7], d = [cx + r, cy + r * 0.7], e = [cx + r * 0.25, cy + r * 1.1]; [[a, b], [a, d], [a, e], [b, e], [e, d], [b, d]].forEach(([u, v]) => { g.beginPath(); g.moveTo(...u); g.lineTo(...v); g.stroke(); }); }
    g.fillStyle = '#8e97ab'; g.font = '600 26px Segoe UI, Arial, sans-serif'; g.textAlign = 'center'; g.fillText(['CUBE.GLB', 'SPHERE.GLB', 'PYRAMID.GLB'][kind], cx, h - 36);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  [[-6.6, 0], [-4.9, 2], [4.9, 1], [6.6, 0]].forEach(([dx, k], i) => {
    const f = new THREE.Group(); f.add(box(1.4, 1.8, 0.06, mat(NAVY2, { roughness: 0.4 }), 0, 0, 0, false));
    const art = new THREE.Mesh(new THREE.PlaneGeometry(1.26, 1.58), new THREE.MeshBasicMaterial({ map: wireCanvas(k), toneMapped: false })); art.position.z = 0.035; f.add(art);
    f.position.set(M.cx + dx, 3.7, M.z0 + 0.1); backWall.add(f);
  });
  backWall.add(box(M.w, 0.06, 0.04, mat(GREEN, GL), M.cx, 0.16, M.z0 + 0.05, false)); leftWall.add(box(0.04, 0.06, M.d, mat(GREEN, GL), M.x0 + 0.05, 0.16, M.cz, false));
  // workstation at the back right: two screens with models on them
  const ws = new THREE.Group(), woodM = mat(0xb98a55, { roughness: 0.6 });
  ws.add(box(3.0, 0.08, 1.4, woodM, 0, 1.0, 0)); [[-1.4, -0.6], [1.4, -0.6], [-1.4, 0.6], [1.4, 0.6]].forEach(([x, z]) => ws.add(box(0.07, 1.0, 0.07, steel, x, 0.5, z)));
  ws.add(box(2.9, 0.35, 0.05, steel, 0, 0.7, -0.62, false));
  [-0.75, 0.75].forEach((x, i) => { const m = new THREE.Group(); m.add(box(1.25, 0.76, 0.05, mat(0x0b0e16), 0, 0, 0)); const sc = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.66), new THREE.MeshBasicMaterial({ map: wireCanvas(i ? 1 : 0, 576, 330), toneMapped: false })); sc.position.z = 0.03; m.add(sc); m.add(box(0.06, 0.3, 0.06, steel, 0, -0.5, -0.05, false)); m.add(box(0.4, 0.04, 0.3, steel, 0, -0.66, -0.02, false)); m.position.set(x, 1.45, -0.35); m.rotation.y = i ? -0.18 : 0.18; ws.add(m); });
  ws.add(box(0.8, 0.03, 0.26, mat(0x151a28), -0.1, 1.06, 0.3, false)); ws.add(box(0.1, 0.03, 0.16, mat(0x151a28), 0.55, 1.06, 0.3, false));
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.065, 0.12, 14), mat(GREEN)); mug.position.set(1.2, 1.1, 0.3); ws.add(mug);
  ws.position.set(M.cx + 6.3, 0, M.z0 + 1.2); scene.add(ws); obstacles.push({ x: M.cx + 6.3, z: M.z0 + 1.4, r: 2.1 });
  const stool = new THREE.Group(); const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 18), mat(GREEN)); seat.position.y = 0.72; seat.castShadow = true; stool.add(seat);
  [0, 1, 2].forEach(i => { const a = i * 2.094; stool.add(box(0.05, 0.72, 0.05, steel, Math.sin(a) * 0.2, 0.36, Math.cos(a) * 0.2)); });
  stool.position.set(M.cx + 6.0, 0, M.z0 + 3.0); scene.add(stool);
  // track lights over the pedestal
  const track = new THREE.Group(); track.add(box(4.4, 0.08, 0.14, steel, 0, 0, 0, false));
  [-1.6, 0, 1.6].forEach((x, i) => { const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.34, 14), steel); sp.position.set(x, -0.22, 0); sp.rotation.x = 0.35 * (i - 1); track.add(sp); const gl = new THREE.Mesh(new THREE.CircleGeometry(0.13, 14), new THREE.MeshBasicMaterial({ color: 0xfff2c8 })); gl.position.set(x, -0.4, 0.06 * (i - 1)); gl.rotation.x = Math.PI / 2; track.add(gl); });
  [-2, 2].forEach(x => track.add(box(0.025, WALL_H - 5.0, 0.025, mat(0x111522), x, (WALL_H - 4.1) / 2, 0, false)));
  track.position.set(px, 4.1, pz); scene.add(track);
  // leafy plants
  const plant = (x, z, h = 1.5) => { const g = new THREE.Group(); const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.26, 0.55, 18), mat(0xf2f4f7, { roughness: 0.5 })); pot.position.y = 0.28; pot.castShadow = true; g.add(pot); const lm = [mat(0x2f9e44), mat(0x40bd00), mat(0x237a34)];
    for (let k = 0; k < 9; k++) { const a = k * 2.4, r = 0.12 + (k % 3) * 0.1; const lf = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), lm[k % 3]); lf.scale.set(0.55, 1.5 + (k % 3) * 0.35, 0.3); lf.position.set(Math.sin(a) * r, 0.55 + h * 0.3 + (k % 3) * 0.28, Math.cos(a) * r); lf.rotation.set(Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5); lf.castShadow = true; g.add(lf); }
    g.position.set(x, 0, z); scene.add(g); obstacles.push({ x, z, r: 0.8 }); };
  plant(M.x0 + 1.3, M.z1 - 1.3, 1.8); plant(M.x1 - 1.3, M.z1 - 1.4, 1.4);

  // ---- door plaque on the drawing room's west wall: click it to come through ----
  const plaque = new THREE.Group();
  plaque.add(box(0.08, 0.62, 3.0, mat(NAVY2), 0, 0, 0));
  plaque.add(box(0.09, 0.05, 3.0, mat(GREEN, GL), 0, -0.3, 0, false));
  const plText = textPlane('MODELING ROOM', 3.0, 0.42, { color: '#ffffff', size: 62, weight: '700', spacing: 4 }); plText.rotation.y = Math.PI / 2; plText.position.set(0.05, 0.02, 0); plaque.add(plText);
  plaque.position.set(M.x0 + 0.04, 3.9, doorZ);
  leftWall.add(plaque);

  // ---- Milo's drafting board and Vera's review table (seated agents are added by office.js) ----
  const stations = {}, holos = [];
  const sketchTex = (label) => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 440; const g = c.getContext('2d');
    g.fillStyle = '#f2f5f8'; g.fillRect(0, 0, 640, 440); g.strokeStyle = 'rgba(40,90,160,0.22)'; g.lineWidth = 1;
    for (let x = 0; x <= 640; x += 20) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 440); g.stroke(); } for (let y = 0; y <= 440; y += 20) { g.beginPath(); g.moveTo(0, y); g.lineTo(640, y); g.stroke(); }
    g.strokeStyle = '#1d3f73'; g.lineWidth = 3; g.lineJoin = 'round';
    const cube = (cx, cy, r) => { const o = r * 0.5, f = [[-r, -r + o], [r, -r + o], [r, r + o], [-r, r + o]], b = f.map(([x, y]) => [x + o, y - o]); [f, b].forEach(q => { g.beginPath(); q.forEach(([x, y], i) => i ? g.lineTo(cx + x, cy + y) : g.moveTo(cx + x, cy + y)); g.closePath(); g.stroke(); }); f.forEach((pt, i) => { g.beginPath(); g.moveTo(cx + pt[0], cy + pt[1]); g.lineTo(cx + b[i][0], cy + b[i][1]); g.stroke(); }); };
    cube(190, 230, 70);
    g.strokeStyle = '#c0392b'; g.lineWidth = 8; g.lineCap = 'round'; g.beginPath(); g.moveTo(60, 380); g.lineTo(560, 380); g.lineTo(560, 120); g.lineTo(610, 120); g.stroke();
    g.fillStyle = '#1d3f73'; g.font = '700 26px Segoe UI, Arial, sans-serif'; g.fillText(label, 340, 70);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  const holoCube = (size) => { const l = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size)), new THREE.LineBasicMaterial({ color: 0x8dff6a, transparent: true, opacity: 0.9 })); holos.push(l); return l; };
  const station = (id, tx, tz, yaw, build, hintText) => {
    const g = new THREE.Group(); g.position.set(tx, 0, tz); g.rotation.y = yaw; scene.add(g);
    const woodT = mat(0xb98a55, { roughness: 0.6 });
    g.add(box(2.6, 0.1, 1.7, woodT, 0, 1.0, 0)); [[-1.2, -0.7], [1.2, -0.7], [-1.2, 0.7], [1.2, 0.7]].forEach(([x, z]) => g.add(box(0.08, 1.0, 0.08, steel, x, 0.5, z)));
    build(g);
    const sg = new THREE.Group(); const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.1, 18), mat(GREEN)); seat.position.y = 0.72; seat.castShadow = true; sg.add(seat);
    [0, 1, 2].forEach(i => { const a = i * 2.094; sg.add(box(0.05, 0.72, 0.05, steel, Math.sin(a) * 0.2, 0.36, Math.cos(a) * 0.2)); });
    sg.position.set(0, 0, 1.45); g.add(sg);
    g.updateMatrixWorld(true);
    const stool = sg.getWorldPosition(new THREE.Vector3()), table = g.getWorldPosition(new THREE.Vector3());
    const hint = document.createElement('div'); hint.className = 'lbl hint'; hint.textContent = hintText;
    const hObj = new CSS2DObject(hint); hObj.position.set(tx, 3.6, tz); scene.add(hObj); hObj.visible = false;
    obstacles.push({ x: tx, z: tz, r: 1.5 });
    stations[id] = { table: [table.x, table.z], stool: [stool.x, stool.z], roots: [g], hint: hObj };
  };
  const bx = M.cx + 5.4, bz = M.cz + 1.2;
  station('modeller', bx, bz, Math.PI / 2, (g) => {
    const tg = new THREE.Group(); tg.position.set(0, 1.12, -0.1); tg.rotation.x = 0.45; g.add(tg);
    tg.add(box(2.2, 0.06, 1.4, mat(0x2a3042, { roughness: 0.5 }), 0, 0, 0));
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.25), new THREE.MeshStandardMaterial({ map: sketchTex('NEW PIPE RUN'), roughness: 0.9 })); sheet.rotation.x = -Math.PI / 2; sheet.position.y = 0.035; tg.add(sheet);
    g.add(box(2.2, 0.05, 0.1, mat(GREEN, GL), 0, 1.07, 0.65, false));
    const h = holoCube(0.6); h.position.set(0.5, 2.2, -0.2); g.add(h);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.012, 8, 48), new THREE.MeshBasicMaterial({ color: 0x8dff6a, transparent: true, opacity: 0.7 })); ring2.rotation.x = Math.PI / 2; ring2.position.set(0.5, 1.72, -0.2); g.add(ring2);
    const lamp = new THREE.Group(); lamp.add(box(0.2, 0.04, 0.2, steel, 0, 0, 0)); lamp.add(box(0.03, 0.7, 0.03, steel, 0, 0.35, 0)); const hd = box(0.3, 0.06, 0.2, steel, 0.1, 0.72, 0); lamp.add(hd); lamp.position.set(-1.0, 1.05, -0.5); g.add(lamp);
    const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 12), mat(0xffd43b)); pen.position.set(-0.8, 1.1, 0.5); g.add(pen);
  }, 'Click to give Milo a 3D job');
  const tx0 = M.cx + 5.4, tz0 = M.cz + 4.6;
  station('builder', tx0, tz0, Math.PI / 2, (g) => {
    // Theo's desk: a big monitor with a model on it, a stack of rolled drawings and a hard hat
    const mon = new THREE.Group(); mon.add(box(1.5, 0.9, 0.06, mat(0x0b0e16), 0, 0, 0)); const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.8), new THREE.MeshBasicMaterial({ map: wireCanvas(2, 512, 290), toneMapped: false })); scr.position.z = 0.035; mon.add(scr);
    mon.add(box(0.12, 0.3, 0.1, steel, 0, -0.55, -0.05)); mon.position.set(-0.2, 1.55, -0.45); g.add(mon);
    for (let i = 0; i < 3; i++) { const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 14), mat(0xf4f5f7, { roughness: 0.8 })); roll.rotation.z = Math.PI / 2; roll.position.set(0.7, 1.12 + (i === 2 ? 0.1 : 0), -0.2 + (i % 2) * 0.14); g.add(roll); }
    const hat = new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xffd43b, { roughness: 0.5 })); hat.position.set(-1.0, 1.05, 0.45); g.add(hat);
    g.add(box(0.5, 0.02, 0.38, mat(0xf4f5f7), 0.1, 1.07, 0.5, false)); g.add(box(0.8, 0.03, 0.26, mat(0x151a28), -0.3, 1.06, 0.35, false));
    const h = holoCube(0.4); h.position.set(0.55, 1.9, -0.4); g.add(h);
  }, 'Click to have Theo build something new');
  const vx = M.cx - 5.2, vz = M.cz + 3.9;
  station('checker', vx, vz, -Math.PI / 2, (g) => {
    g.add(box(2.2, 0.03, 1.3, new THREE.MeshStandardMaterial({ color: 0xf8fbff, emissive: 0xdfeeff, emissiveIntensity: 0.9, roughness: 0.6 }), 0, 1.07, -0.05, false));
    const h = holoCube(0.45); h.position.set(-0.2, 1.6, -0.1); g.add(h);
    const frame = new THREE.Group(); frame.add(new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 10, 32), mat(0x2a3042, { metalness: 0.5, roughness: 0.4 })));
    const lens2 = new THREE.Mesh(new THREE.CircleGeometry(0.31, 28), new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.3, roughness: 0.05 })); frame.add(lens2);
    frame.add(box(0.05, 0.6, 0.05, steel, 0, -0.62, 0)); frame.position.set(0.7, 1.75, -0.1); frame.rotation.x = -0.4; g.add(frame);
    g.add(box(0.5, 0.02, 0.38, mat(0xf4f5f7), -0.9, 1.07, 0.4, false)); g.add(box(0.38, 0.01, 0.01, mat(0x40bd00), -0.9, 1.09, 0.34, false));
  }, 'Click to see the model check');

  // little chip above the pedestal: tells you it can be clicked
  const chip = document.createElement('div'); chip.className = 'lbl hint'; chip.textContent = 'Click to turn a photo into a 3D model';
  const chipObj = new CSS2DObject(chip); chipObj.position.set(px, 3.7, pz); scene.add(chipObj); chipObj.visible = false;

  // ---- model on the pedestal ----
  let current = null, spin = 0, busyT = 0, busy = false;
  const api = {
    backWall, leftWall, clickRoots, obstacles, plaque, hint: chipObj, stations, pedestal: { x: px, z: pz },
    spots: {
      modeling: { p: [M.cx + 8, 15, 24], t: [M.cx + 1, 0.5, -2] },
      scan: { p: [px + 6.5, 5.0, pz + 8.5], t: [px + 0.4, 1.3, pz] },
      modeler: { p: [M.cx + 0.5, 5.6, M.cz + 12.5], t: [M.cx + 2.2, 1.3, M.cz + 0.6] }
    },
    // put a loaded glTF scene on the pedestal, scaled to fit
    setModel(object3d) {
      if (current) { slot.remove(current); current.traverse(o => { if (o.geometry) o.geometry.dispose(); }); current = null; }
      holder.visible = !object3d;
      if (!object3d) return;
      const b = new THREE.Box3().setFromObject(object3d), size = b.getSize(new THREE.Vector3()), ctr = b.getCenter(new THREE.Vector3());
      const k = 2.6 / Math.max(size.x, size.y, size.z, 1e-6);
      const wrap = new THREE.Group(); object3d.position.sub(ctr); wrap.add(object3d); wrap.scale.setScalar(k);
      wrap.position.y = size.y * k / 2 + 0.05;
      wrap.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      slot.add(wrap); current = wrap;
    },
    hasModel() { return !!current; },
    setBusy(v) { busy = !!v; if (!busy) hoop.material.opacity = 0; },
    step(dt) {
      slot.rotation.y += dt * 0.45; spin += dt; holos.forEach((h, i) => { h.rotation.y += dt * (0.8 + i * 0.3); h.rotation.x += dt * 0.35; });
      if (busy) { busyT += dt; hoop.material.opacity = 0.85; hoop.position.y = 0.6 + (Math.sin(busyT * 1.8) * 0.5 + 0.5) * 2.6; ring.material.emissiveIntensity = 0.9 + Math.sin(busyT * 6) * 0.5; }
      else ring.material.emissiveIntensity = 0.9;
    }
  };
  return api;
}
