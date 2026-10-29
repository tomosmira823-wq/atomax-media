// The File Room (the six filing cabinets) and the Server Room (one rack per service, spend screen, ops desk, backups and updates).
// Built from the same pieces as the rest of the office (boxes, CSS2D chips, the #put() models), in the same navy, white and green.
import * as THREE from 'three';

const CAB_COLOURS = { skills: 0x40c057, templates: 0xffd43b, knowledge: 0x4dabf7, jobs: 0xb197fc, brand: 0xf783ac, rulebooks: 0x38d9a9 };
const CAB_LABELS = { skills: 'SKILLS', templates: 'TEMPLATES', knowledge: 'COMPANY KNOWLEDGE', jobs: 'JOBS', brand: 'BRAND', rulebooks: 'AGENT RULEBOOKS' };
const CAB_ORDER = ['skills', 'templates', 'knowledge', 'jobs', 'brand', 'rulebooks'];
const RACKS = [['claude', 'CLAUDE'], ['openai', 'OPENAI'], ['higgsfield', 'HIGGSFIELD'], ['linkedin', 'LINKEDIN'], ['meta', 'META'], ['x', 'X']];
const LIGHT = { ok: 0x40bd00, near: 0xffa94d, error: 0xff6b6b, capped: 0xff6b6b, expiring: 0xff6b6b, nokey: 0x495266, off: 0x495266 };

function cabinetBody(box, mat, x, z, colour, key, name, t) {
  const g = new THREE.Group();
  g.add(box(0.95, 3.1, 1.5, mat(0xeef0f3, { roughness: 0.6 }), 0, 1.7, 0));
  g.add(box(1.0, 0.12, 1.56, mat(colour, { emissive: colour, emissiveIntensity: 0.25 }), 0, 3.3, 0, false));
  g.add(box(0.98, 0.3, 1.52, mat(0x12161f), 0, 0.15, 0, false));
  // name plate on the front (east) face
  g.add(box(0.04, 0.42, 1.2, mat(0x12161f), 0.48, 2.85, 0, false));
  const plate = t(CAB_LABELS[key], 1.1, 0.34, { color: '#ffffff', size: 56, weight: '700', spacing: 6 }); plate.rotation.y = Math.PI / 2; plate.position.set(0.5, 2.85, 0); g.add(plate);
  // four drawers; the top one slides out when the cabinet is opened
  let top = null;
  for (let i = 0; i < 4; i++) {
    const d = new THREE.Group();
    d.add(box(0.04, 0.6, 1.36, mat(0xf7f8fa, { roughness: 0.5 }), 0.5, 0, 0));
    d.add(box(0.05, 0.05, 0.4, mat(0x12161f), 0.54, 0.1, 0, false));
    d.position.set(0, 2.1 - i * 0.66, 0);
    g.add(d);
    if (i === 0) top = d;
  }
  g.position.set(x, 0, z);
  return { g, drawer: top };
}

// ---------- the File Room ----------
export function buildFileRoom(ctx, R) {
  const { s, box, mat, t, chip } = ctx;
  const cabs = [];
  const roots = [];
  // six cabinets along the west wall (the wall shared with the lounge), drawers facing into the room
  CAB_ORDER.forEach((key, i) => {
    const z = R.z0 + 2.0 + i * 1.5;
    const { g, drawer } = cabinetBody(box, mat, R.x0 + 0.7, z, CAB_COLOURS[key], key, CAB_LABELS[key], t);
    g.traverse(o => { o.userData.cabinet = key; });
    g.userData.cabinet = key;
    s.add(g); roots.push(g);
    cabs.push({ key, group: g, drawer, open: false, z });
    ctx.obstacles.push({ rect: true, x0: R.x0, x1: R.x0 + 1.5, z0: z - 0.85, z1: z + 0.85 });
  });
  // a long table with six chairs for reading and sorting files
  const tc = { x: R.cx + 2.6, z: R.cz };
  const top = box(2.6, 0.09, 6.0, mat(0xf6f7f9, { roughness: 0.3 }), tc.x, 1.0, tc.z);
  s.add(top); s.add(box(2.6, 0.03, 6.0, mat(ctx.GREEN, { emissive: ctx.GREEN, emissiveIntensity: 0.25 }), tc.x, 0.94, tc.z, false));
  ctx.obstacles.push({ rect: true, x0: tc.x - 1.5, x1: tc.x + 1.5, z0: tc.z - 3.2, z1: tc.z + 3.2 });
  const sx = tc.x; for (const dz of [-2.2, 0, 2.2]) { ctx.chairs.push([sx - 1.6, tc.z + dz, -Math.PI / 2]); ctx.chairs.push([sx + 1.6, tc.z + dz, Math.PI / 2]); }
  // a monitor and a stack of folders on the table
  s.add(box(0.1, 0.5, 0.7, mat(0x0b0e16), tc.x - 0.4, 1.3, tc.z - 1.6, false));
  s.add(box(0.02, 0.3, 0.6, mat(0x1971c2, { emissive: 0x1971c2, emissiveIntensity: 0.4 }), tc.x - 0.36, 1.3, tc.z - 1.6, false));
  [[0xe03131, 0.4], [0x2f9e44, 0.5]].forEach(([c, dx], k) => s.add(box(0.5, 0.05, 0.6, mat(c), tc.x + dx - 0.2, 1.08 + k * 0.05, tc.z + 1.8, false)));
  // back wall shelf of binders at the east end
  const shelf = new THREE.Group();
  for (let k = 0; k < 4; k++) shelf.add(box(0.35, 1.0 + (k % 2) * 0.2, 0.12, mat(CAB_COLOURS[CAB_ORDER[k]], { roughness: 0.6 }), k * 0.4 - 0.6, 2.2 + (k % 2) * 0.1, 0));
  shelf.position.set(R.x1 - 1.0, 0, R.z0 + 1.2); s.add(shelf);
  chip('Click a cabinet to open it', R.cx + 1, 3.9, R.z0 + 2.6);
  return { cabs, roots: cabs.map(c => c.group), spots: { file: { p: [R.cx + 8, 6.4, R.z1 + 8], t: [R.cx - 1.5, 1.0, R.cz] } } };
}

// ---------- the Server Room ----------
export function buildServerRoom(ctx, R, spend) {
  const { s, box, mat, t, chip } = ctx;
  const racks = [];
  RACKS.forEach(([key, label], i) => {
    const z = R.z0 + 1.7 + i * 1.5;
    const g = new THREE.Group();
    const body = 0x0b0e16;
    g.add(box(1.1, 3.4, 1.3, mat(body, { roughness: 0.5, metalness: 0.3 }), 0, 1.7, 0));
    const cap = box(1.14, 0.14, 1.34, mat(LIGHT.off, { emissive: LIGHT.off, emissiveIntensity: 0.9 }), 0, 3.47, 0, false); g.add(cap);
    // little green LEDs down the front
    for (let k = 0; k < 8; k++) g.add(box(0.03, 0.05, 0.05, mat(0x40bd00, { emissive: 0x40bd00, emissiveIntensity: 1.0 }), 0.56, 0.5 + k * 0.36, (k % 2 ? 0.3 : -0.3), false));
    g.add(box(0.03, 0.2, 1.0, mat(0x2a3142), 0.56, 3.0, 0, false));
    g.position.set(R.x0 + 0.7, 0, z); s.add(g);
    const isX = key === 'x';
    if (isX) {   // not connected yet: an empty dashed frame
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.1, 3.4, 1.3)), new THREE.LineBasicMaterial({ color: 0x8e97ab }));
      edges.position.set(R.x0 + 0.7, 1.7, z); s.add(edges);
    }
    const chipObj = chip(label, R.x0 + 0.7, 4.1, z);
    obstacle(ctx, R.x0, R.x0 + 1.4, z - 0.8, z + 0.8);
    racks.push({ key, group: g, cap: cap.material, chip: chipObj, z, label });
  });
  // ops desk in the middle with three monitors and a chair
  const dx = R.cx + 0.4, dz = R.cz + 0.8;
  s.add(box(3.6, 0.09, 1.4, mat(0xf6f7f9, { roughness: 0.3 }), dx, 1.0, dz));
  s.add(box(3.6, 0.03, 1.4, mat(0x1971c2, { emissive: 0x1971c2, emissiveIntensity: 0.25 }), dx, 0.94, dz, false));
  [-1.1, 0, 1.1].forEach((mx, k) => { s.add(box(0.06, 0.6, 0.9, mat(0x0b0e16), dx + mx, 1.45, dz - 0.2, false)); s.add(box(0.02, 0.44, 0.78, mat([0x40bd00, 0x1971c2, 0xffa94d][k], { emissive: [0x40bd00, 0x1971c2, 0xffa94d][k], emissiveIntensity: 0.5 }), dx + mx - 0.03, 1.45, dz - 0.2, false)); });
  ctx.obstacles.push({ rect: true, x0: dx - 1.9, x1: dx + 1.9, z0: dz - 0.9, z1: dz + 0.9 });
  ctx.chairs.push([dx, dz + 1.3, 0]);
  // spend screen on the back wall, east of the doorway
  const sw = 3.6, sh = 2.4, sx = R.x1 - 2.4, sy = 3.0;
  const c = document.createElement('canvas'); c.width = 1024; c.height = Math.round(1024 * sh / sw);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({ map: tex }));
  screen.position.set(sx, sy, R.z0 + 0.2); s.add(screen);
  s.add(box(sw + 0.2, sh + 0.2, 0.06, mat(0x222938), sx, sy, R.z0 + 0.12, false));
  // Backups and Updates, black cabinets at the front right
  const bk = box(1.6, 2.0, 1.4, mat(0x0b0e16, { metalness: 0.3 }), R.x1 - 1.8, 1.0, R.z1 - 2.4); s.add(bk);
  s.add(box(1.62, 0.1, 1.42, mat(0x40bd00, { emissive: 0x40bd00, emissiveIntensity: 0.6 }), R.x1 - 1.8, 2.05, R.z1 - 2.4, false));
  const up = box(1.6, 2.0, 1.4, mat(0x0b0e16, { metalness: 0.3 }), R.x1 - 1.8, 1.0, R.z1 - 0.2); s.add(up);
  s.add(box(1.62, 0.1, 1.42, mat(0x4dabf7, { emissive: 0x4dabf7, emissiveIntensity: 0.6 }), R.x1 - 1.8, 2.05, R.z1 - 0.2, false));
  ctx.obstacles.push({ rect: true, x0: R.x1 - 2.6, x1: R.x1 - 1.0, z0: R.z1 - 3.2, z1: R.z1 - 1.2 });
  chip('Backups', R.x1 - 1.8, 2.8, R.z1 - 2.4);
  chip('Updates', R.x1 - 1.8, 2.8, R.z1 - 0.2);
  chip('Click a rack for spend, limits and errors', R.cx + 2.6, 4.7, R.cz + 2.6);
  return { racks, screen, tex, canvas: c, roots: racks.map(r => r.group), spots: { server: { p: [R.cx + 8, 6.4, R.z1 + 8], t: [R.cx - 1.5, 1.2, R.cz] } } };
}

function obstacle(ctx, x0, x1, z0, z1) { ctx.obstacles.push({ rect: true, x0, x1, z0, z1 }); }

// Racks: the light on top and the label chip follow the provider's state (and the social logins)
export function paintRacks(room, status) {
  if (!status) return;
  const social = Object.fromEntries((status.social || []).map(x => [x.key, x]));
  for (const r of room.racks) {
    const p = status.providers.find(x => x.provider === r.key);
    const so = r.key === 'meta' ? social.facebook : r.key === 'linkedin' ? social.linkedin : r.key === 'x' ? social.x : null;
    const state = so ? so.state : p ? p.state : 'off';
    const col = state === 'off' || state === 'nokey' ? LIGHT.off : state === 'ok' ? LIGHT.ok : state === 'near' ? LIGHT.near : LIGHT.error;
    r.cap.color.set(col); r.cap.emissive.set(col);
    const word = state === 'ok' ? 'OK' : state === 'near' ? (p ? Math.round(p.spent / p.cap * 100) + '% of cap' : '') : state === 'capped' ? 'cap reached' : state === 'error' ? 'error' : state === 'expiring' ? 'login expiring' : state === 'nokey' ? 'no key' : 'not connected';
    const name = r.label.charAt(0) + r.label.slice(1).toLowerCase();
    r.chip.element.textContent = name + ' · ' + word;
  }
}

// Paint the spend screen: a bar per provider, spend against cap, and the social logins.
export function paintSpend(room, status) {
  const c = room.canvas, g = c.getContext('2d'), W = c.width, H = c.height;
  g.fillStyle = '#0b0e16'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#8e97ab'; g.font = '700 34px system-ui, sans-serif'; g.fillText('API SPEND · THIS MONTH (estimate)', 36, 58);
  const rows = status ? status.providers : [];
  rows.forEach((p, i) => {
    const y = 120 + i * 78, frac = p.cap ? Math.min(1, p.spent / p.cap) : 0;
    const col = p.state === 'capped' || p.state === 'error' ? '#ff6b6b' : p.state === 'near' ? '#ffa94d' : '#40bd00';
    g.fillStyle = '#e6e9f0'; g.font = '600 34px system-ui, sans-serif'; g.fillText(p.label, 36, y + 30);
    g.fillStyle = '#1d2433'; g.fillRect(260, y, 560, 36);
    g.fillStyle = col; g.fillRect(260, y, 560 * frac, 36);
    g.fillStyle = '#e6e9f0'; g.font = '600 30px system-ui, sans-serif'; g.fillText(`£${p.spent.toFixed(0)} of £${p.cap}`, 850, y + 30);
  });
  if (!rows.length) { g.fillStyle = '#8e97ab'; g.font = '600 32px system-ui, sans-serif'; g.fillText('Spend shows here after the first run', 36, 160); }
  room.tex.needsUpdate = true;
}

export const RACK_LIGHT = LIGHT;
export { CAB_ORDER, CAB_COLOURS, CAB_LABELS, RACKS };
