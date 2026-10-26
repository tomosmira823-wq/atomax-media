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
export function modelingBounds(drawX0, z0, z1, w = 16) {
  const x1 = drawX0 - 0.3, x0 = x1 - w;
  return { w, x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, d: z1 - z0 };
}

export function buildModelingRoom({ scene, bounds: M, logoTex, drawLeftWall }) {
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
  leftWall.add(box(0.3, WALL_H, M.d, mat(0xeef0f3, { roughness: 0.95 }), M.x0 - 0.15, WALL_H / 2, M.cz));
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
  [0, 1, 2].forEach(i => { const a = i * 2.094; const leg = box(0.06, 2.0, 0.06, dark, Math.sin(a) * 0.45, 1.0, Math.cos(a) * 0.45); leg.rotation.z = -Math.sin(a) * 0.22; leg.rotation.x = Math.cos(a) * 0.22; tri.add(leg); });
  tri.add(box(0.12, 0.5, 0.12, dark, 0, 2.15, 0));
  const cam = new THREE.Group(); cam.add(box(0.7, 0.45, 0.4, mat(0x2b3348), 0, 0, 0)); const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.4, 20), mat(0x0b0e16, { roughness: 0.2, metalness: 0.5 })); lens.rotation.x = Math.PI / 2; lens.position.z = 0.4; cam.add(lens);
  cam.add(box(0.12, 0.05, 0.05, mat(GREEN, GL), 0.22, 0.26, 0, false)); cam.position.y = 2.55; tri.add(cam);
  tri.position.set(px + 5.4, 0, pz + 3.2); tri.lookAt(px, 0, pz); scene.add(tri); obstacles.push({ x: px + 5.4, z: pz + 3.2, r: 1 });
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
  shelf.position.set(M.x0 + 0.5, 1.4, M.cz + 1.5); leftWall.add(shelf);

  // ---- door plaque on the drawing room's west wall: click it to come through ----
  const plaque = new THREE.Group();
  plaque.add(box(0.08, 0.62, 3.2, mat(NAVY2), 0, 0, 0));
  plaque.add(box(0.09, 0.05, 3.2, mat(GREEN, GL), 0, -0.3, 0, false));
  const plText = textPlane('‹  MODELING ROOM', 3.0, 0.42, { color: '#ffffff', size: 62, weight: '700', spacing: 4 }); plText.rotation.y = Math.PI / 2; plText.position.set(0.05, 0.02, 0); plaque.add(plText);
  plaque.position.set(M.x1 + 0.3 + 0.04, 3.9, -3.8);
  if (drawLeftWall) drawLeftWall.add(plaque); else scene.add(plaque);

  // little chip above the pedestal: tells you it can be clicked
  const chip = document.createElement('div'); chip.className = 'lbl hint'; chip.textContent = 'Click to turn a photo into a 3D model';
  const chipObj = new CSS2DObject(chip); chipObj.position.set(px, 3.7, pz); scene.add(chipObj); chipObj.visible = false;

  // ---- model on the pedestal ----
  let current = null, spin = 0, busyT = 0, busy = false;
  const api = {
    backWall, leftWall, clickRoots, obstacles, plaque, hint: chipObj, pedestal: { x: px, z: pz },
    spots: {
      modeling: { p: [M.cx + 8, 15, 24], t: [M.cx + 1, 0.5, -2] },
      scan: { p: [px + 6.5, 5.0, pz + 8.5], t: [px + 0.4, 1.3, pz] }
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
      slot.rotation.y += dt * 0.45; spin += dt;
      if (busy) { busyT += dt; hoop.material.opacity = 0.85; hoop.position.y = 0.6 + (Math.sin(busyT * 1.8) * 0.5 + 0.5) * 2.6; ring.material.emissiveIntensity = 0.9 + Math.sin(busyT * 6) * 0.5; }
      else ring.material.emissiveIntensity = 0.9;
    }
  };
  return api;
}
