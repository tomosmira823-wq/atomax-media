// 3D office scene (Three.js). Atomax-branded room with Kenney furniture models, one desk per agent, roaming agents.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const GREEN = 0x40bd00, NAVY = 0x0e121d, NAVY2 = 0x1b2131, WHITE = 0xf4f5f7, WOOD = 0xe8d2b0;
const ROOM_W = 26, ROOM_D = 22, WALL_H = 6;
const K = 1.3; // metres -> scene units (characters are ~2.2 units tall)
const MODELS = ['desk-teacher', 'chair-desk', 'computer', 'bookcase', 'sofa', 'table', 'lamp-table', 'tv', 'vending-machine', 'flowers', 'cactus', 'bench', 'fridge', 'radio', 'cake'];

// Desk slots spread around the floor (x, z). Meeting room is front-right, lounge front-left.
// Desk slots in pods of two facing desks: [x, z, facing] (facing 0 = desk's user looks toward +z, PI = toward -z)
const DESK_SLOTS = [
  [-7.5, -2.2, 0], [-7.5, -5.4, Math.PI],
  [-1.0, -2.2, 0], [-1.0, -5.4, Math.PI],
  [-7.5, 5.2, 0], [-7.5, 2.0, Math.PI],
  [-1.0, 5.2, 0], [-1.0, 2.0, Math.PI],
  [5.0, -2.2, 0], [5.0, -5.4, Math.PI],
  [11.0, -2.2, 0], [11.0, -5.4, Math.PI]
];
// The drawing room sits next door, west of the media office's window wall (shared wall at x = -ROOM_W/2, door at z DOOR.z0..DOOR.z1).
const DRAW = { w: 18, x1: -ROOM_W / 2 - 0.3, z0: -ROOM_D / 2, z1: 5 };
DRAW.x0 = DRAW.x1 - DRAW.w; DRAW.cx = (DRAW.x0 + DRAW.x1) / 2; DRAW.cz = (DRAW.z0 + DRAW.z1) / 2; DRAW.d = DRAW.z1 - DRAW.z0;
const DOOR = { z0: -2.4, z1: 0 };
const NAV = { x0: DRAW.x0, x1: ROOM_W / 2, z0: -ROOM_D / 2, z1: ROOM_D / 2 };
const DRAW_DESK = [DRAW.cx, -6.6, 0];
const MEETING = { x0: 5, x1: 11.5, z0: 3.5, z1: 10.5, doorOut: new THREE.Vector3(3.8, 0, 9.3), doorIn: new THREE.Vector3(6.2, 0, 9.3) };

function mat(color, opts = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05, ...opts }); }
function box(w, h, d, m, x = 0, y = 0, z = 0, cast = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z); mesh.castShadow = cast; mesh.receiveShadow = true; return mesh;
}
const texLoader = new THREE.TextureLoader();
function tex(path) { const t = texLoader.load(path); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; return t; }
const LOGO_AR = 560 / 2163;


// ---------- character builder (shared by the office scene and the loadout preview) ----------
export const GEAR = ['glasses', 'hardhat', 'headset', 'tie', 'clipboard', 'lanyard'];
export function buildCharacter(colour, role = 'writer', gear) {
  const g = new THREE.Group();
  const col = new THREE.Color(colour || '#40bd00');
  const kit = Array.isArray(gear) ? gear : (role === 'reviewer' ? ['glasses', 'clipboard', 'lanyard'] : ['lanyard']);
  const m = new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.35, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.15, envMapIntensity: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.55, 8, 24), m); body.position.y = 0.85; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 24), m); head.position.y = 1.75; head.castShadow = true; g.add(head);
  const eyeW = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.1, clearcoat: 1 }), eyeB = mat(NAVY, { roughness: 0.2 });
  const eyes = [];
  [-0.17, 0.17].forEach(x => {
    const eye = new THREE.Group(); eye.position.set(x, 0.07, 0.44); head.add(eye); eyes.push(eye);
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), eyeW); eye.add(e);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), eyeB); p.position.set(0, 0, 0.09); eye.add(p);
  });
  const arms = [], legs = [];
  [-0.55, 0.55].forEach(x => { const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.45, 6, 14), m); a.position.set(x, 0.95, 0); a.castShadow = true; g.add(a); arms.push(a); });
  [-0.2, 0.2].forEach(x => { const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.3, 6, 14), m); l.position.set(x, 0.3, 0); l.castShadow = true; g.add(l); legs.push(l); });
  const dark = mat(NAVY2, { roughness: 0.3 });
  if (kit.includes('lanyard')) {
    g.add(box(0.16, 0.2, 0.02, mat(0xffffff), 0.08, 0.95, 0.44, false));
    g.add(box(0.12, 0.05, 0.03, mat(GREEN), 0.08, 1.01, 0.45, false));
  }
  if (kit.includes('glasses')) {
    [-0.17, 0.17].forEach(x => { const r = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 8, 24), dark); r.position.set(x, 0.07, 0.5); head.add(r); });
    head.add(box(0.1, 0.03, 0.03, dark, 0, 0.07, 0.5, false));
  }
  if (kit.includes('hardhat')) {
    const hat = new THREE.Mesh(new THREE.SphereGeometry(0.54, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2.6), mat(0xffffff, { roughness: 0.4 })); hat.position.y = 0.08; head.add(hat);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 32), mat(0xffffff, { roughness: 0.4 })); brim.position.y = 0.22; head.add(brim);
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.545, 0.025, 8, 32), mat(GREEN)); stripe.rotation.x = Math.PI / 2; stripe.position.y = 0.26; head.add(stripe);
  }
  if (kit.includes('headset')) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.035, 8, 32, Math.PI), dark); band.position.y = 0.05; head.add(band);
    [-0.5, 0.5].forEach(x => { const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 16), dark); cup.rotation.z = Math.PI / 2; cup.position.set(x, 0.02, 0); head.add(cup); });
    const mic = box(0.03, 0.03, 0.3, dark, 0.4, -0.15, 0.3, false); mic.rotation.y = 0.6; head.add(mic);
    const micTip = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), mat(GREEN)); micTip.position.set(0.22, -0.18, 0.45); head.add(micTip);
  }
  if (kit.includes('tie')) {
    const tie = box(0.1, 0.42, 0.03, mat(GREEN, { roughness: 0.5 }), 0, 0.95, 0.44, false); g.add(tie);
    const knot = box(0.13, 0.08, 0.04, mat(GREEN, { roughness: 0.5 }), 0, 1.2, 0.44, false); g.add(knot);
  }
  if (kit.includes('clipboard')) {
    const clip = box(0.32, 0.42, 0.03, mat(WOOD), -0.62, 1.05, 0.3, false); clip.rotation.y = 0.4; g.add(clip);
    const paper = box(0.28, 0.36, 0.01, mat(0xffffff), -0.62, 1.04, 0.33, false); paper.rotation.y = 0.4; g.add(paper);
  }
  g.userData = { arms, legs, body, head, eyes };
  return g;
}

// Small turntable preview of one agent for the loadout screen
export class AgentPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    this.camera.position.set(0, 2.1, 5.6); this.camera.lookAt(0, 1.15, 0);
    this.scene.add(new THREE.HemisphereLight(0xe8eeff, 0x202633, 0.7));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.2); sun.position.set(-3, 6, 4); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); this.scene.add(sun);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.12, 48), mat(NAVY2, { roughness: 0.6 })); disc.position.y = -0.06; disc.receiveShadow = true; this.scene.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.03, 8, 64), mat(GREEN, { emissive: GREEN, emissiveIntensity: 0.6 })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.0; this.scene.add(ring);
    this.t = 0; this.running = false;
    this.show({ colour: '#40bd00', role: 'writer' });
  }
  show(agent) {
    if (this.char) this.scene.remove(this.char);
    this.char = buildCharacter(agent.colour, agent.role, agent.gear);
    this.scene.add(this.char);
  }
  start() { if (this.running) return; this.running = true; this.clock = new THREE.Clock(); const loop = () => { if (!this.running) return; requestAnimationFrame(loop); this.step(); }; loop(); }
  stop() { this.running = false; }
  step() {
    const dt = this.clock ? this.clock.getDelta() : 0.016; this.t += dt;
    const w = this.canvas.clientWidth || 320, h = this.canvas.clientHeight || 360;
    if (this.canvas.width !== w * this.renderer.getPixelRatio()) { this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    if (this.char) {
      const ud = this.char.userData;
      this.char.rotation.y = Math.sin(this.t * 0.5) * 0.35;
      ud.body.position.y = 0.85 + Math.sin(this.t * 2) * 0.02;
      ud.arms[1].rotation.z = -2.4 + Math.sin(this.t * 6) * 0.35;   // wave
      ud.arms[1].position.y = 1.15;
      ud.head.rotation.z = Math.sin(this.t * 1.5) * 0.08;
    }
    this.renderer.render(this.scene, this.camera);
  }
}

export class Office {
  constructor(canvas, labelsDiv) {
    this.canvas = canvas; this.labelsDiv = labelsDiv;
    this.agents = new Map();
    this.clock = new THREE.Clock();
    this.boardLines = [];
    this.obstacles = [];
    this.pois = [];
    this.models = {};
    this.logoWhiteTex = tex('./assets/atomax-logo-white.png');
    this.#initRenderer();
    this.#buildShell();
    this.#buildDrawingRoom();
    this.#initPicking();
    this.room = 'media'; this.clickRoots = [];
    this.ready = this.#loadModels().then(() => this.#furnish()).catch(e => console.error('furniture failed', e));
    this.#animate();
    window.addEventListener('resize', () => this.#resize());
  }

  // ---------- renderer, camera, lights ----------
  #initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.labelRenderer = new CSS2DRenderer({ element: this.labelsDiv });

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(NAVY);
    this.scene.fog = new THREE.Fog(NAVY, 60, 100);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.8;

    this.camera = new THREE.PerspectiveCamera(36, 1, 1, 160);
    this.camera.position.set(26, 19, 32);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.set(1, 0.5, 0.5);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2.3;
    this.controls.minDistance = 4; this.controls.maxDistance = 70;
    this.controls.enablePan = false;

    this.scene.add(new THREE.HemisphereLight(0xe8eeff, 0x202633, 0.6));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.0);
    sun.position.set(-25, 24, 12); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.target.position.set(-9, 0, 0); this.scene.add(sun.target);
    const sc = sun.shadow.camera; sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 1; sc.far = 90;
    sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3;
    this.scene.add(sun);
    const fill = new THREE.PointLight(0xa8ffb0, 10, 40, 1.5); fill.position.set(6, 5, 4); this.scene.add(fill);
    const drawLight = new THREE.PointLight(0xffe9c4, 9, 34, 1.6); drawLight.position.set(DRAW.cx, 5.2, -3); this.scene.add(drawLight);
    const sky = new THREE.DirectionalLight(0xcfe3ff, 0.8); sky.position.set(-20, 8, -4); this.scene.add(sky);
    this.#resize();
  }

  #resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // ---------- room shell: floor, walls, logo, whiteboard, glass meeting room ----------
  #buildShell() {
    const s = this.scene, W = ROOM_W, D = ROOM_D;
    // floor: pale polished concrete made from a canvas (subtle tiles + noise)
    const fc = document.createElement('canvas'); fc.width = fc.height = 1024;
    const fx = fc.getContext('2d'); fx.fillStyle = '#dde0e5'; fx.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 9000; i++) { fx.fillStyle = `rgba(${90 + Math.random() * 60},${95 + Math.random() * 60},${105 + Math.random() * 60},${Math.random() * 0.08})`; fx.fillRect(Math.random() * 1024, Math.random() * 1024, 2 + Math.random() * 3, 2 + Math.random() * 3); }
    fx.strokeStyle = 'rgba(80,90,105,0.18)'; fx.lineWidth = 2;
    for (let i = 0; i <= 8; i++) { fx.beginPath(); fx.moveTo(i * 128, 0); fx.lineTo(i * 128, 1024); fx.stroke(); fx.beginPath(); fx.moveTo(0, i * 128); fx.lineTo(1024, i * 128); fx.stroke(); }
    const floorTex = new THREE.CanvasTexture(fc); floorTex.colorSpace = THREE.SRGBColorSpace; floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(W / 8, D / 8); floorTex.anisotropy = 8;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.28, metalness: 0.1, envMapIntensity: 0.9 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);
    const border = new THREE.Mesh(new THREE.PlaneGeometry(W, 1.6), mat(NAVY2, { roughness: 0.5 })); border.rotation.x = -Math.PI / 2; border.position.set(0, 0.02, -D / 2 + 0.8); border.receiveShadow = true; s.add(border);
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.12), mat(GREEN, { emissive: GREEN, emissiveIntensity: 0.35 })); stripe.rotation.x = -Math.PI / 2; stripe.position.set(0, 0.035, -D / 2 + 1.66); s.add(stripe);
    s.add(box(W + 1, 0.6, D + 1, mat(NAVY2), 0, -0.32, 0, false));


    // Walls are grouped so they can be hidden when the camera looks from behind them (no more staring at the back of a wall).
    this.backWall = new THREE.Group(); this.leftWall = new THREE.Group(); s.add(this.backWall); s.add(this.leftWall);
    const B = this.backWall, L = this.leftWall;
    B.add(box(W, WALL_H, 0.3, mat(NAVY, { roughness: 0.9 }), 0, WALL_H / 2, -D / 2 - 0.15));
    B.add(box(W, 0.14, 0.05, mat(GREEN, { emissive: GREEN, emissiveIntensity: 0.5 }), 0, 5.3, -D / 2 + 0.05, false));
    const wallM = mat(0xeef0f3, { roughness: 0.95 });
    L.add(box(0.3, WALL_H, DOOR.z0 + D / 2, wallM, -W / 2 - 0.15, WALL_H / 2, (-D / 2 + DOOR.z0) / 2));   // wall up to the door
    L.add(box(0.3, WALL_H, D / 2 - DOOR.z1, wallM, -W / 2 - 0.15, WALL_H / 2, (DOOR.z1 + D / 2) / 2));    // wall after the door
    L.add(box(0.3, WALL_H - 3.2, DOOR.z1 - DOOR.z0, wallM, -W / 2 - 0.15, 3.2 + (WALL_H - 3.2) / 2, (DOOR.z0 + DOOR.z1) / 2)); // above the door
    [DOOR.z0, DOOR.z1].forEach(z => L.add(box(0.36, 3.25, 0.12, mat(NAVY2), -W / 2 - 0.15, 1.62, z)));      // door frame
    L.add(box(0.36, 0.12, DOOR.z1 - DOOR.z0 + 0.12, mat(NAVY2), -W / 2 - 0.15, 3.25, (DOOR.z0 + DOOR.z1) / 2));
    L.add(box(0.4, 0.03, DOOR.z1 - DOOR.z0, mat(GREEN, { emissive: GREEN, emissiveIntensity: 0.35 }), -W / 2 - 0.15, 0.03, (DOOR.z0 + DOOR.z1) / 2, false)); // threshold
    // plaque over the door on the media-office side: click it to go next door
    const plaque = new THREE.Group();
    plaque.add(box(0.08, 0.62, 3.0, mat(NAVY2), 0, 0, 0));
    plaque.add(box(0.09, 0.05, 3.0, mat(GREEN, { emissive: GREEN, emissiveIntensity: 0.5 }), 0, -0.3, 0, false));
    const plText = this.#textPlane('DRAWING ROOM  ›', 2.8, 0.42, { color: '#ffffff', size: 62, weight: '700', spacing: 4 }); plText.rotation.y = Math.PI / 2; plText.position.set(0.05, 0.02, 0); plaque.add(plText);
    plaque.position.set(-W / 2 + 0.04, 3.9, (DOOR.z0 + DOOR.z1) / 2); L.add(plaque);
    this.doorPlaque = plaque;
    L.add(box(0.05, 0.14, D, mat(GREEN, { emissive: GREEN, emissiveIntensity: 0.5 }), -W / 2 + 0.05, 5.3, 0, false));
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, transmission: 0.75, opacity: 0.45, transparent: true, roughness: 0.03, metalness: 0, ior: 1.45, thickness: 0.05, depthWrite: false });
    for (let i = 0; i < 4; i++) {
      if (i === 1) continue;   // this window is where the door to the drawing room is
      const z = -7.5 + i * 4.6;
      L.add(box(0.1, 3.2, 3.0, glass, -W / 2 + 0.1, 3.2, z, false));
      L.add(box(0.2, 3.4, 0.15, mat(NAVY2), -W / 2 + 0.1, 3.2, z - 1.55));
      L.add(box(0.2, 3.4, 0.15, mat(NAVY2), -W / 2 + 0.1, 3.2, z + 1.55));
      L.add(box(0.2, 0.15, 3.1, mat(NAVY2), -W / 2 + 0.1, 1.5, z));
      L.add(box(0.2, 0.15, 3.1, mat(NAVY2), -W / 2 + 0.1, 4.9, z));
    }

    // outside the windows: soft sky gradient + distant skyline so the glass has something behind it
    const skyC = document.createElement('canvas'); skyC.width = 1024; skyC.height = 512;
    const sx = skyC.getContext('2d'); const gr = sx.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#9fc6ff'); gr.addColorStop(0.6, '#dfeeff'); gr.addColorStop(1, '#f3f7fb'); sx.fillStyle = gr; sx.fillRect(0, 0, 1024, 512);
    sx.fillStyle = 'rgba(120,140,170,0.35)'; for (let i = 0; i < 40; i++) { const bw = 20 + Math.random() * 50, bh = 60 + Math.random() * 180; sx.fillRect(i * 26, 512 - bh, bw, bh); }
    sx.fillStyle = 'rgba(90,110,140,0.5)'; for (let i = 0; i < 30; i++) { const bw = 25 + Math.random() * 40, bh = 30 + Math.random() * 110; sx.fillRect(10 + i * 34, 512 - bh, bw, bh); }
    const skyTex = new THREE.CanvasTexture(skyC); skyTex.colorSpace = THREE.SRGBColorSpace;
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(D - 0.6, WALL_H - 1.2), new THREE.MeshBasicMaterial({ map: skyTex, depthWrite: false })); sky.rotation.y = Math.PI / 2; sky.position.set(-W / 2 - 0.6, WALL_H / 2 - 0.5, 0); sky.renderOrder = -1; /* sky plane not added: the drawing room is on the other side of this wall now */
    const sunLight = new THREE.SpotLight(0xfff4e0, 40, 40, Math.PI / 5, 0.6, 1.2); sunLight.castShadow = false; sunLight.position.set(-W / 2 - 4, 7, -2); sunLight.target.position.set(-2, 0, 0); s.add(sunLight); s.add(sunLight.target);

    // ceiling structure on the open sides: slim beams so the room reads as a space, not a tray
    const beamM = mat(NAVY2, { roughness: 0.5, metalness: 0.3 });
    s.add(box(W, 0.1, 0.1, beamM, 0, WALL_H - 0.05, D / 2, false));
    s.add(box(0.1, 0.1, D, beamM, W / 2, WALL_H - 0.05, 0, false));
    s.add(box(0.12, WALL_H, 0.12, beamM, W / 2, WALL_H / 2, D / 2));
    s.add(box(0.12, WALL_H, 0.12, beamM, W / 2, WALL_H / 2, -D / 2));
    s.add(box(0.12, WALL_H, 0.12, beamM, -W / 2, WALL_H / 2, D / 2));

    // logo + tagline on the back wall
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(9, 9 * LOGO_AR), new THREE.MeshBasicMaterial({ map: this.logoWhiteTex, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    logo.position.set(-2.5, 3.75, -D / 2 + 0.05); B.add(logo);
    B.add(box(9.6, 0.05, 0.03, mat(GREEN, { emissive: GREEN, emissiveIntensity: 0.6 }), -2.5, 2.35, -D / 2 + 0.06, false));
    const tagline = this.#textPlane('MEDIA OFFICE', 6.5, 0.7, { color: '#8e97ab', size: 64, weight: '600', spacing: 10 });
    tagline.position.set(-2.5, 1.9, -D / 2 + 0.05); B.add(tagline);

    // status board canvas (drawn onto the TV once models load)
    this.boardCanvas = document.createElement('canvas'); this.boardCanvas.width = 768; this.boardCanvas.height = 448;
    this.boardTex = new THREE.CanvasTexture(this.boardCanvas); this.boardTex.colorSpace = THREE.SRGBColorSpace;
    this.setBoard([]);

    // whiteboard with sticky notes
    B.add(box(5.5, 3.2, 0.1, mat(0xfafafa), -10, 3.0, -D / 2 + 0.12, false));
    B.add(box(5.7, 3.4, 0.06, mat(0x6b7280), -10, 3.0, -D / 2 + 0.08, false));
    [0xffe066, GREEN, 0x7fc8ff, 0xffb3c1, 0xffe066, 0xc5a3ff].forEach((c, i) => B.add(box(0.6, 0.6, 0.03, mat(c), -11.7 + (i % 3) * 1.2 + (i > 2 ? 0.6 : 0), 3.6 - Math.floor(i / 3) * 1.0, -D / 2 + 0.2, false)));
    for (let i = 0; i < 4; i++) B.add(box(2.2 - i * 0.3, 0.06, 0.02, mat(0x2b2f38), -8.8, 4.1 - i * 0.35, -D / 2 + 0.19, false));
    this.pois.push({ x: -10, z: -D / 2 + 2.3, face: Math.PI });

    // glass meeting room (front-right): two glass partitions with navy frames and a door gap
    const M = MEETING, gh = 3.4;
    const part = (w, d, x, z) => { const g = box(w, gh, d, glass, x, gh / 2, z, false); s.add(g); };
    part(0.08, M.z1 - M.z0 - 2.4, M.x0, M.z0 + (M.z1 - M.z0 - 2.4) / 2);          // x0 wall, door gap at the front end
    part(M.x1 - M.x0, 0.08, (M.x0 + M.x1) / 2, M.z0);                             // z0 wall
    [[M.x0, M.z0], [M.x0, M.z1 - 2.4], [M.x1, M.z0], [M.x0, M.z1]].forEach(([x, z]) => s.add(box(0.14, gh, 0.14, mat(NAVY2), x, gh / 2, z)));
    s.add(box(0.14, 0.14, M.z1 - M.z0, mat(NAVY2), M.x0, gh, (M.z0 + M.z1) / 2, false));
    s.add(box(M.x1 - M.x0, 0.14, 0.14, mat(NAVY2), (M.x0 + M.x1) / 2, gh, M.z0, false));
    // mid-height rail on the glass so it reads as a partition, not empty space
    s.add(box(0.1, 0.06, M.z1 - M.z0 - 2.4, mat(NAVY2), M.x0, 1.1, M.z0 + (M.z1 - M.z0 - 2.4) / 2, false));
    s.add(box(M.x1 - M.x0, 0.06, 0.1, mat(NAVY2), (M.x0 + M.x1) / 2, 1.1, M.z0, false));
    const mtLabel = this.#textPlane('MEETING ROOM', 3.2, 0.35, { color: '#0e121d', size: 60, weight: '700', spacing: 8 });
    mtLabel.rotation.y = -Math.PI / 2; mtLabel.position.set(M.x0 - 0.18, 2.9, M.z0 + 2.2); s.add(mtLabel);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(M.x1 - M.x0 - 1, M.z1 - M.z0 - 1), mat(NAVY2, { roughness: 1 })); rug.rotation.x = -Math.PI / 2; rug.position.set((M.x0 + M.x1) / 2, 0.02, (M.z0 + M.z1) / 2); rug.receiveShadow = true; s.add(rug);
    const rugIn = new THREE.Mesh(new THREE.PlaneGeometry(M.x1 - M.x0 - 1.4, M.z1 - M.z0 - 1.4), mat(0x273047, { roughness: 1 })); rugIn.rotation.x = -Math.PI / 2; rugIn.position.set((M.x0 + M.x1) / 2, 0.035, (M.z0 + M.z1) / 2); s.add(rugIn);
    // glass walls as a row of small obstacles so wanderers go round them (door gap left open)
    this.meetingPoint = new THREE.Vector3((M.x0 + M.x1) / 2, 0, (M.z0 + M.z1) / 2);
    this.obstacles.push({ rect: true, x0: this.meetingPoint.x - 2.6, x1: this.meetingPoint.x + 2.6, z0: this.meetingPoint.z - 2.0, z1: this.meetingPoint.z + 2.0 });   // table + chairs
    [[M.x0 + 1.2, M.z0 + 2.2, 0], [M.x1 - 1.2, M.z1 - 1.5, Math.PI], [M.x0 + 2.8, M.z1 - 1.2, -Math.PI / 2 * 0], [M.x1 - 1.4, M.z0 + 1.5, Math.PI / 2]].forEach(([x, z, f]) => this.pois.push({ x, z, face: f, room: true }));

    // reception sign (right-hand side, angled toward the viewer)
    const sign = new THREE.Group();
    sign.add(box(0.3, 2.6, 2.6, mat(NAVY), 0, 1.3, 0));
    const signLogo = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3 * LOGO_AR), new THREE.MeshBasicMaterial({ map: this.logoWhiteTex, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    signLogo.rotation.y = -Math.PI / 2; signLogo.position.set(-0.18, 1.7, 0); sign.add(signLogo);
    const signText = this.#textPlane('MEDIA OFFICE', 1.8, 0.25, { color: '#40bd00', size: 60, weight: '700', spacing: 8 });
    signText.rotation.y = -Math.PI / 2; signText.position.set(-0.18, 1.25, 0); sign.add(signText);
    sign.add(box(0.5, 0.1, 2.8, mat(GREEN, { emissive: GREEN, emissiveIntensity: 0.4 }), 0, 0.05, 0, false));
    sign.position.set(W / 2 - 1.2, 0, -D / 2 + 3.2); sign.rotation.y = Math.PI * 0.5; s.add(sign);
    this.obstacles.push({ x: W / 2 - 1.2, z: -D / 2 + 3.2, r: 1.8 });

    // water cooler (back wall) and printer (front edge)
    const cooler = new THREE.Group();
    cooler.add(box(0.6, 1.3, 0.6, mat(0xdde1e6, { roughness: 0.4 }), 0, 0.65, 0));
    cooler.add(box(0.62, 0.1, 0.62, mat(GREEN), 0, 1.3, 0, false));
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.9, 16), new THREE.MeshPhysicalMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.7, transmission: 0.3 })); bottle.position.y = 1.8; cooler.add(bottle);
    cooler.position.set(2.8, 0, -D / 2 + 0.6); s.add(cooler);
    this.obstacles.push({ x: 2.8, z: -D / 2 + 0.6, r: 1 });
    this.pois.push({ x: 2.8, z: -D / 2 + 2.2, face: Math.PI });
    const printer = new THREE.Group();
    printer.add(box(2.4, 0.78, 1.2, mat(WHITE, { roughness: 0.5 }), 0, 0.39, 0));          // cabinet, top at 0.78
    printer.add(box(2.44, 0.06, 1.24, mat(GREEN), 0, 0.81, 0, false));                      // green lid sits on top (0.78..0.84)
    printer.add(box(1.0, 0.5, 0.8, mat(NAVY2), -0.4, 1.09, 0));                             // printer unit (0.84..1.34)
    printer.add(box(0.6, 0.02, 0.4, mat(0xffffff), -0.4, 1.36, 0.1, false));                // paper
    printer.position.set(1.8, 0, D / 2 - 1.2); s.add(printer);
    this.obstacles.push({ x: 1.8, z: D / 2 - 1.2, r: 1.8 });
    this.pois.push({ x: 1.8, z: D / 2 - 3, face: 0 });
  }

  // ---------- models ----------
  #loadModels() {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    return Promise.all(MODELS.map(n => new Promise((res, rej) => loader.load(`./assets/models/${n}.glb`, g => { this.models[n] = g.scene; res(); }, undefined, rej))));
  }

  // place a model: recolour by material name, scale, position, rotation
  #put(name, { pos = [0, 0, 0], rot = 0, scale = 1, colours = {}, emissive = {} } = {}) {
    const src = this.models[name]; if (!src) return null;
    const obj = src.clone(true);
    obj.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const out = mats.map(m => {
        const c = m.clone(); c.envMapIntensity = 0.6;
        const key = Object.keys(colours).find(k => m.name === k || m.name.startsWith(k));
        if (key) c.color.set(colours[key]);
        const ek = Object.keys(emissive).find(k => m.name === k || m.name.startsWith(k));
        if (ek) { c.emissive.set(emissive[ek]); c.emissiveIntensity = 0.9; }
        return c;
      });
      o.material = Array.isArray(o.material) ? out : out[0];
    });
    obj.scale.setScalar(scale); obj.position.set(...pos); obj.rotation.y = rot;
    this.scene.add(obj);
    return obj;
  }

  #furnish() {
    const s = this.scene, W = ROOM_W, D = ROOM_D, M = MEETING;
    // status screen on the back wall: slim bezel, screen flush on its face, soft glow underneath
    const sw = 7.2, sh = sw * 448 / 768;
    const bezel = box(sw + 0.3, sh + 0.3, 0.12, mat(0x05070c, { roughness: 0.4, metalness: 0.3 }), 7.5, 3.1, -D / 2 + 0.08, false); this.backWall.add(bezel);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({ map: this.boardTex }));
    screen.position.set(7.5, 3.1, -D / 2 + 0.145); this.backWall.add(screen);
    const glow = new THREE.PointLight(0x40bd00, 6, 7, 2); glow.position.set(7.5, 3.1, -D / 2 + 1.2); s.add(glow);
    // kitchenette: fridge + vending machine at the back-right
    this.#put('fridge', { pos: [W / 2 - 0.7, 0, 9.6], rot: -Math.PI / 2, scale: K, colours: { metalLight: WHITE, metal: 0xd7dbe0, metalDark: NAVY2 } });
    this.#put('vending-machine', { pos: [W / 2 - 0.7, 0, 7.6], rot: -Math.PI / 2, scale: K });
    this.obstacles.push({ x: W / 2 - 0.7, z: 8.6, r: 1.8 });
    this.pois.push({ x: W / 2 - 2.6, z: 7.6, face: Math.PI / 2 });
    // bookcases on the left wall
    this.#put('bookcase', { pos: [-W / 2 + 0.5, 0, 2.8], rot: Math.PI / 2, scale: K, colours: { 'Wood': NAVY2, 'DarkWood': GREEN } });
    this.#put('bookcase', { pos: [-W / 2 + 0.5, 0, 5.2], rot: Math.PI / 2, scale: K, colours: { 'Wood': NAVY2, 'DarkWood': GREEN } });
    this.obstacles.push({ x: -W / 2 + 0.8, z: 4, r: 2.4 });
    this.pois.push({ x: -W / 2 + 2.4, z: 4, face: -Math.PI / 2 });
    // lounge (front-left): sofa, coffee table with cake + radio, lamp, plants
    this.#put('sofa', { pos: [-8.8, 0, 9.6], rot: Math.PI, scale: K * 1.15, colours: { carpet: 0x34405c, wood: WHITE } });
    const ct = this.#put('table', { pos: [-8.8, 0, 7.4], scale: K * 1.4, colours: { wood: WHITE } });
    const th = ct ? new THREE.Box3().setFromObject(ct).max.y : 0.8;
    this.#put('cake', { pos: [-9.5, th, 7.4], scale: K });
    this.#put('radio', { pos: [-8, th, 7.3], rot: -0.5, scale: K * 0.9, colours: { metalMedium: GREEN } });
    this.#put('lamp-table', { pos: [-11.3, 0.6, 9.7], scale: K * 1.2, colours: { metal: NAVY2 }, emissive: { lamp: 0xffd9a0 } });
    this.scene.add(box(0.8, 0.6, 0.8, mat(NAVY2), -11.3, 0.3, 9.7));
    this.#put('flowers', { pos: [-11.3, 0, 7.6], scale: K });
    this.#put('cactus', { pos: [-6.2, 0, 9.8], scale: K * 1.2 });
    this.obstacles.push({ x: -8.8, z: 8.6, r: 3.2 });
    this.pois.push({ x: -8.8, z: 5.6, face: 0 });
    // bench under the windows + plants in corners
    // tall plants along the window wall
    [[-W / 2 + 1.1, -5.4], [-W / 2 + 1.1, 1.5]].forEach(([x, z]) => { const p = this.#put('cactus', { pos: [x, 0, z], scale: K * 1.3 }); if (p) this.obstacles.push({ x, z, r: 1 }); });
    this.#put('cactus', { pos: [-W / 2 + 1.2, 0, -D / 2 + 1.2], scale: K * 1.4 });
    this.#put('flowers', { pos: [W / 2 - 1.2, 0, D / 2 - 1.2], scale: K * 1.2 });
    this.#put('cactus', { pos: [M.x1 - 0.8, 0, M.z0 + 0.8], scale: K });
    // boardroom: long white table with navy legs, six chairs, pendant row above
    const mp = this.meetingPoint;
    const bt = new THREE.Group();
    bt.add(box(4.6, 0.09, 1.8, mat(0xf6f7f9, { roughness: 0.3 }), 0, 1.0, 0));
    bt.add(box(4.6, 0.03, 1.8, mat(GREEN, { emissive: GREEN, emissiveIntensity: 0.25 }), 0, 0.94, 0, false));
    [[-1.9, -0.6], [1.9, -0.6], [-1.9, 0.6], [1.9, 0.6]].forEach(([x, z]) => bt.add(box(0.1, 0.95, 0.1, mat(NAVY2, { metalness: 0.4 }), x, 0.47, z)));
    const plant = this.#put('flowers', { scale: 0.9 }); if (plant) { this.scene.remove(plant); plant.position.set(0, 1.05, 0); bt.add(plant); }
    [-1.3, 1.3].forEach(x => { bt.add(box(0.5, 0.012, 0.35, mat(0xffffff), x, 1.06, 0.3, false)); bt.add(box(0.5, 0.012, 0.35, mat(0xffffff), -x, 1.06, -0.3, false)); });
    [[-1.5, -1.5, 0], [0, -1.5, 0], [1.5, -1.5, 0], [-1.5, 1.5, Math.PI], [0, 1.5, Math.PI], [1.5, 1.5, Math.PI]].forEach(([x, z, r]) => { const ch = this.#officeChair(new THREE.Color(GREEN)); ch.position.set(x, 0, z); ch.rotation.y = r; bt.add(ch); });
    [-1.4, 0, 1.4].forEach(x => { const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 0.3, 20, 1, true), mat(NAVY2, { side: THREE.DoubleSide })); shade.position.set(x, WALL_H - 2.0, 0); bt.add(shade); bt.add(box(0.015, 1.9, 0.015, mat(NAVY2), x, WALL_H - 0.95, 0, false)); });
    const bpl = new THREE.PointLight(0xffe2b3, 8, 8, 2); bpl.position.set(0, WALL_H - 2.2, 0); bt.add(bpl);
    bt.position.set(mp.x, 0, mp.z); s.add(bt);
    // lounge pendant
    const lp = new THREE.PointLight(0xffe2b3, 6, 7, 2); lp.position.set(-8.8, WALL_H - 2.2, 8.4); s.add(lp);
    const lshade = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.45, 24, 1, true), mat(NAVY2, { side: THREE.DoubleSide })); lshade.position.set(-8.8, WALL_H - 2.1, 8.4); s.add(lshade); s.add(box(0.015, 2.1, 0.015, mat(NAVY2), -8.8, WALL_H - 1.05, 8.4, false));
    this.#furnishDrawing();
    this.#buildNav();
    // if agents were requested before the models arrived, place them now
    if (this.pendingAgents) { const l = this.pendingAgents; this.pendingAgents = null; this.setAgents(l.list, l.drawing); }
    this.setBoard(this.boardLines);
  }

  #textPlane(text, w, h, { color = '#ffffff', size = 64, weight = '700', spacing = 0 } = {}) {
    const c = document.createElement('canvas'); c.width = 1024; c.height = Math.round(1024 * h / w);
    const ctx = c.getContext('2d'); ctx.fillStyle = color; ctx.font = `${weight} ${size}px Segoe UI, Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (spacing) ctx.letterSpacing = spacing + 'px';
    ctx.fillText(text, c.width / 2, c.height / 2);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  }

  // ---------- desk + character ----------
  #desk(colour) {
    // Modern workstation built from primitives: slim white top, navy frame, dual monitors on a shared arm,
    // keyboard + mouse, drawer pedestal, desk plant, coloured mug and chair. Desk user sits at +z looking at -z.
    const g = new THREE.Group();
    const top = mat(0xf6f7f9, { roughness: 0.35, metalness: 0.02 }), frame = mat(NAVY2, { roughness: 0.5, metalness: 0.4 });
    const TW = 2.6, TD = 1.3, TH = 1.05;
    g.add(box(TW, 0.07, TD, top, 0, TH, 0));
    g.add(box(TW, 0.03, TD, mat(GREEN, { emissive: GREEN, emissiveIntensity: 0.25 }), 0, TH - 0.05, 0, false)); // green underline edge
    [[-TW / 2 + 0.12, -TD / 2 + 0.1], [TW / 2 - 0.12, -TD / 2 + 0.1], [-TW / 2 + 0.12, TD / 2 - 0.1], [TW / 2 - 0.12, TD / 2 - 0.1]].forEach(([x, z]) => g.add(box(0.07, TH, 0.07, frame, x, TH / 2, z)));
    g.add(box(TW - 0.3, 0.06, 0.06, frame, 0, 0.15, -TD / 2 + 0.1, false));
    // pedestal
    g.add(box(0.55, 0.78, 0.9, mat(0xe8eaee, { roughness: 0.5 }), TW / 2 - 0.35, 0.39, 0.05));
    [0.2, 0.45, 0.7].forEach(y => g.add(box(0.3, 0.02, 0.02, frame, TW / 2 - 0.35, y, 0.51, false)));
    // monitor arm + two monitors
    const armBase = box(0.25, 0.04, 0.25, frame, 0, TH + 0.05, -TD / 2 + 0.25); g.add(armBase);
    g.add(box(0.05, 0.75, 0.05, frame, 0, TH + 0.42, -TD / 2 + 0.25));
    g.add(box(1.75, 0.04, 0.04, frame, 0, TH + 0.78, -TD / 2 + 0.3, false));
    const screenMat = new THREE.MeshStandardMaterial({ color: 0x0f1626, emissive: 0x1a3660, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.1 });
    const screens = [];
    [-0.47, 0.47].forEach((x, i) => {
      const bezel = box(0.92, 0.56, 0.035, mat(0x11151e, { roughness: 0.3, metalness: 0.3 }), x, TH + 0.72, -TD / 2 + 0.33, false); bezel.rotation.y = i === 0 ? 0.12 : -0.12; g.add(bezel);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.5), screenMat); scr.position.set(x, TH + 0.72, -TD / 2 + 0.352); scr.rotation.y = bezel.rotation.y; scr.position.x += i === 0 ? 0.0 : 0.0; scr.translateZ(0.002); g.add(scr); screens.push(scr);
    });
    // keyboard + mouse + mug + plant + papers
    g.add(box(0.95, 0.03, 0.3, mat(0xf0f2f5, { roughness: 0.4 }), -0.1, TH + 0.05, 0.1, false));
    for (let r = 0; r < 3; r++) for (let c = 0; c < 10; c++) g.add(box(0.07, 0.012, 0.07, mat(0xcfd3da), -0.1 - 0.4 + c * 0.09, TH + 0.062, 0.02 + r * 0.085, false));
    g.traverse(m => { if (m.isMesh && m.geometry.type === 'BoxGeometry' && m.geometry.parameters.height < 0.1) m.castShadow = false; });
    const mouse = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.08, 4, 10), mat(0xf0f2f5, { roughness: 0.3 })); mouse.rotation.x = Math.PI / 2; mouse.position.set(0.55, TH + 0.07, 0.12); g.add(mouse);
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.18, 16), mat(colour, { roughness: 0.4 })); mug.position.set(-0.95, TH + 0.12, 0.25); mug.castShadow = true; g.add(mug);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 8, 16), mat(colour)); handle.position.set(-0.85, TH + 0.12, 0.25); g.add(handle);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.16, 12), mat(0xe8eaee)); pot.position.set(1.0, TH + 0.11, -0.4); g.add(pot);
    for (let i = 0; i < 5; i++) { const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), mat(i % 2 ? 0x2e8c00 : 0x3fae12)); const a = i / 5 * Math.PI * 2; leaf.position.set(1.0 + Math.cos(a) * 0.07, TH + 0.26 + (i % 2) * 0.05, -0.4 + Math.sin(a) * 0.07); g.add(leaf); }
    g.add(box(0.42, 0.015, 0.3, mat(0xffffff), -0.8, TH + 0.045, -0.3, false)); g.add(box(0.42, 0.015, 0.3, mat(0xfafafa), -0.76, TH + 0.06, -0.28, false));
    [0, 1, 2].forEach(i => g.add(box(0.3 - i * 0.05, 0.004, 0.02, mat(0x8e97ab), -0.8, TH + 0.07, -0.38 + i * 0.06, false)));
    // pendant light above the desk (warm pool)
    const cord = box(0.015, 2.0, 0.015, frame, 0, WALL_H - 1.0, 0, false); g.add(cord);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.4, 24, 1, true), mat(NAVY2, { side: THREE.DoubleSide, roughness: 0.6 })); shade.position.set(0, WALL_H - 2.05, 0); g.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff1cc })); bulb.position.set(0, WALL_H - 2.15, 0); g.add(bulb);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(2.2, 24), new THREE.MeshBasicMaterial({ color: 0xffe2b3, transparent: true, opacity: 0.10, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })); pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.05, 0); g.add(pool);
    g.userData.screenMat = screenMat;
    g.userData.deskHeight = TH;
    return g;
  }

  #officeChair(colour) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.45, 10), mat(NAVY2, { metalness: 0.5, roughness: 0.4 })); base.position.y = 0.3; g.add(base);
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; const leg = box(0.05, 0.04, 0.36, mat(NAVY2, { metalness: 0.5 }), Math.sin(a) * 0.18, 0.06, Math.cos(a) * 0.18, false); leg.rotation.y = a; g.add(leg); const wheel = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), mat(0x05070c)); wheel.position.set(Math.sin(a) * 0.36, 0.04, Math.cos(a) * 0.36); g.add(wheel); }
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.1, 0.6), mat(colour, { roughness: 0.6 })); seat.position.y = 0.55; seat.castShadow = true; g.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.72, 0.08), mat(colour, { roughness: 0.6 })); back.position.set(0, 0.95, -0.28); back.rotation.x = -0.12; back.castShadow = true; g.add(back);
    const mesh = box(0.5, 0.55, 0.02, mat(NAVY2, { roughness: 0.9 }), 0, 0.97, -0.26, false); mesh.rotation.x = -0.12; g.add(mesh);
    [-0.33, 0.33].forEach(x => { g.add(box(0.05, 0.22, 0.05, mat(NAVY2), x, 0.72, 0.05, false)); g.add(box(0.07, 0.03, 0.35, mat(NAVY2), x, 0.84, 0.05, false)); });
    return g;
  }

  // ---------- public API ----------
  setAgents(list, drawing = null) {
    if (!this.models['desk-teacher']) { this.pendingAgents = { list, drawing }; return; }
    (this.drawExtras || []).forEach(o => { this.scene.remove(o); if (o.element) o.element.remove(); }); this.drawExtras = [];
    for (const a of this.agents.values()) { this.scene.remove(a.group); this.scene.remove(a.desk); this.scene.remove(a.chair); a.label.element.remove(); }
    this.agents.clear();
    this.obstacles = this.obstacles.filter(o => !o.desk);
    (this.podRugs || []).forEach(r => this.scene.remove(r)); const a_rugs = []; this.podRugs = a_rugs;
    list.forEach((data, i) => {
      const colour = new THREE.Color(data.colour || '#40bd00');
      const [dx, dz, facing] = DESK_SLOTS[i % DESK_SLOTS.length];
      const desk = this.#desk(colour); desk.position.set(dx, 0, dz); desk.rotation.y = facing; this.scene.add(desk);
      if (facing === 0) { // one thin rug per pod (under both facing desks), agent colour border on a navy field
        const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 5.6), mat(NAVY2, { roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })); rug.rotation.x = -Math.PI / 2; rug.position.set(dx, 0.02, dz - 1.4); rug.receiveShadow = true; this.scene.add(rug); a_rugs.push(rug);
        const inner = new THREE.Mesh(new THREE.PlaneGeometry(3.9, 5.3), mat(0x273047, { roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); inner.rotation.x = -Math.PI / 2; inner.position.set(dx, 0.035, dz - 1.4); inner.receiveShadow = true; this.scene.add(inner); a_rugs.push(inner);
      }
      // user sits in front of the desk (+z side in desk space), facing the monitors
      desk.updateMatrixWorld(true);
      const front = new THREE.Vector3(0, 0, 1).applyQuaternion(desk.quaternion); // desk's user side in world space
      const chairPos = new THREE.Vector3(dx, 0, dz).addScaledVector(front, 1.15);
      const faceSeat = Math.atan2(-front.x, -front.z); // look back toward the desk (monitors)
      const chair = this.#officeChair(colour); chair.position.copy(chairPos); chair.rotation.y = faceSeat; this.scene.add(chair);
      const seat = new THREE.Vector3(dx, 0, dz).addScaledVector(front, 1.05);
      const dir = front.z >= 0 ? 1 : -1;
      // block the desk itself (top + monitors + pedestal); the seat side stays open so the agent can reach its chair
      this.obstacles.push({ rect: true, x0: dx - 1.45, x1: dx + 1.45, z0: dz - 0.75, z1: dz + 0.75, desk: true });
      const group = buildCharacter(data.colour, data.role, data.gear);
      group.position.copy(this.#randomIdlePoint()); group.position.x += (i - list.length / 2) * 0.01;
      this.scene.add(group);
      const el = document.createElement('div'); el.className = 'lbl';
      el.innerHTML = `<b>${data.name}</b> · ${data.platform} <span class="st"></span>`;
      const label = new CSS2DObject(el); label.position.set(0, 2.6, 0); group.add(label);
      this.agents.set(data.id, { data, group, desk, chair, seat, faceSeat, state: 'idle', label, el, walkTarget: null, waypoint: null, faceTo: null, wait: Math.random() * 3, t: Math.random() * 10, blink: 2 + Math.random() * 3 });
    });
    // fill the remaining pod slots with unassigned workstations so the floor reads as a full office
    (this.spareDesks || []).forEach(d => this.scene.remove(d)); this.spareDesks = [];
    for (let i = list.length; i < DESK_SLOTS.length; i++) {
      const [dx, dz, facing] = DESK_SLOTS[i];
      const d = this.#desk(new THREE.Color(0x8e97ab)); d.position.set(dx, 0, dz); d.rotation.y = facing; d.userData.screenMat.emissive.set(0x0b1220); d.userData.screenMat.emissiveIntensity = 0.5; this.scene.add(d); this.spareDesks.push(d);
      d.updateMatrixWorld(true);
      const front = new THREE.Vector3(0, 0, 1).applyQuaternion(d.quaternion); const dir = front.z >= 0 ? 1 : -1;
      const ch = this.#officeChair(new THREE.Color(0x6b7280)); ch.position.set(dx, 0, dz).addScaledVector(front, 1.2); ch.rotation.y = Math.atan2(-front.x, -front.z); this.scene.add(ch); this.spareDesks.push(ch);
      this.obstacles.push({ rect: true, x0: dx - 1.45, x1: dx + 1.45, z0: Math.min(dz, dz + dir * 1.3) - 0.75, z1: Math.max(dz, dz + dir * 1.3) + 0.75, desk: true }); // spare desk incl. empty chair
      if (facing === 0) {
        const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 5.6), mat(NAVY2, { roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })); rug.rotation.x = -Math.PI / 2; rug.position.set(dx, 0.02, dz - 1.4); rug.receiveShadow = true; this.scene.add(rug); this.spareDesks.push(rug);
        const inner = new THREE.Mesh(new THREE.PlaneGeometry(3.9, 5.3), mat(0x273047, { roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); inner.rotation.x = -Math.PI / 2; inner.position.set(dx, 0.035, dz - 1.4); inner.receiveShadow = true; this.scene.add(inner); this.spareDesks.push(inner);
      }
    }
    if (drawing) this.#addDrawingAgent(drawing, a_rugs);
    this.#buildNav();
    for (const a of this.agents.values()) a.path = null;
    this.setBoard(this.boardLines);
  }

  setState(id, state, status = '') {
    const a = this.agents.get(id); if (!a) return;
    a.state = state;
    a.el.querySelector('.st').textContent = status ? '— ' + status : '';
    a.el.classList.toggle('busy', state === 'working');
    const sm = a.desk.userData.screenMat;
    if (state === 'working') { sm.color.set(0x0b2a00); sm.emissive.set(GREEN); sm.emissiveIntensity = 1.2; }
    else if (state === 'done') { sm.color.set(0x0a1a2a); sm.emissive.set(0x7fc8ff); sm.emissiveIntensity = 0.8; }
    else { sm.color.set(0x16233a); sm.emissive.set(0x1c3a6b); sm.emissiveIntensity = 0.8; }
    if (state !== 'working') { a.walkTarget = null; a.path = null; a.seated = false; a.faceTo = null; a.wait = 1 + Math.random() * 2; }
  }

  setBoard(lines) {
    this.boardLines = lines;
    const c = this.boardCanvas, ctx = c.getContext('2d');
    ctx.fillStyle = '#0f1420'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#40bd00'; ctx.fillRect(0, 0, c.width, 8);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 34px Segoe UI, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('PROJECT STATUS', 36, 64);
    ctx.font = '22px Segoe UI, sans-serif'; ctx.fillStyle = '#8e97ab'; ctx.fillText('Atomax-UK · Media Office', 36, 98);
    const rows = lines.length ? lines : [...this.agents.values()].filter(a => a.zone !== 'drawing').map(a => ({ colour: a.data.colour, text: `${a.data.name} · ${a.data.platform}`, status: 'Ready' }));
    rows.slice(0, 7).forEach((r, i) => {
      const y = 150 + i * 42;
      ctx.fillStyle = r.colour || '#40bd00'; ctx.beginPath(); ctx.arc(52, y - 8, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e6eaf2'; ctx.font = '24px Segoe UI, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(r.text, 80, y);
      ctx.fillStyle = r.status === 'Working' ? '#40bd00' : (r.status === 'Done' ? '#7fc8ff' : (r.status === 'Error' ? '#e05252' : '#8e97ab'));
      ctx.textAlign = 'right'; ctx.fillText(r.status || '', c.width - 40, y);
    });
    this.boardTex.needsUpdate = true;
  }

  // ---------- drawing room (next door) ----------
  #buildDrawingRoom() {
    const s = this.scene, DW = DRAW.w, DD = DRAW.d;
    // oak plank floor
    const fc = document.createElement('canvas'); fc.width = 1024; fc.height = Math.round(1024 * DD / DW);
    const fx = fc.getContext('2d'); fx.fillStyle = '#c9a77a'; fx.fillRect(0, 0, fc.width, fc.height);
    const pw = fc.width / 24;
    for (let i = 0; i < 24; i++) { fx.fillStyle = `hsl(${30 + Math.random() * 6},${38 + Math.random() * 8}%,${58 + Math.random() * 10}%)`; fx.fillRect(i * pw, 0, pw - 2, fc.height); for (let k = 0; k < 9; k++) { const y = Math.random() * fc.height; fx.fillStyle = 'rgba(80,50,20,0.18)'; fx.fillRect(i * pw, y, pw - 2, 2); } }
    const ft = new THREE.CanvasTexture(fc); ft.colorSpace = THREE.SRGBColorSpace; ft.anisotropy = 8;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(DW, DD), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.55, metalness: 0.02 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(DRAW.cx, 0.002, DRAW.cz); floor.receiveShadow = true; s.add(floor);
    s.add(box(DW + 1, 0.6, DD + 1, mat(NAVY2), DRAW.cx, -0.32, DRAW.cz, false));
    this.drawBackWall = new THREE.Group(); this.drawLeftWall = new THREE.Group(); s.add(this.drawBackWall); s.add(this.drawLeftWall);
    const B = this.drawBackWall, L = this.drawLeftWall, GL = { emissive: GREEN, emissiveIntensity: 0.5 };
    B.add(box(DW + 0.3, WALL_H, 0.3, mat(NAVY, { roughness: 0.9 }), DRAW.cx, WALL_H / 2, DRAW.z0 - 0.15));
    B.add(box(DW, 0.14, 0.05, mat(GREEN, GL), DRAW.cx, 5.3, DRAW.z0 + 0.05, false));
    L.add(box(0.3, WALL_H, DD, mat(0xeef0f3, { roughness: 0.95 }), DRAW.x0 - 0.15, WALL_H / 2, DRAW.cz));
    L.add(box(0.05, 0.14, DD, mat(GREEN, GL), DRAW.x0 + 0.05, 5.3, DRAW.cz, false));
    // sign + logo
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(6, 6 * LOGO_AR), new THREE.MeshBasicMaterial({ map: this.logoWhiteTex, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    logo.position.set(DRAW.cx + 4.2, 3.9, DRAW.z0 + 0.05); B.add(logo);
    B.add(box(6.4, 0.05, 0.03, mat(GREEN, GL), DRAW.cx + 4.2, 2.95, DRAW.z0 + 0.06, false));
    const tag = this.#textPlane('DRAWING ROOM', 6.4, 0.7, { color: '#8e97ab', size: 64, weight: '600', spacing: 10 }); tag.position.set(DRAW.cx + 4.2, 2.5, DRAW.z0 + 0.05); B.add(tag);
    // pinboard with drawing sheets
    B.add(box(5.6, 2.8, 0.08, mat(0x6b4f2f), DRAW.cx - 5.2, 3.3, DRAW.z0 + 0.1, false));
    B.add(box(5.4, 2.6, 0.04, mat(0xc79b62, { roughness: 1 }), DRAW.cx - 5.2, 3.3, DRAW.z0 + 0.14, false));
    [[-1.9, 0.5, 1.4, 1.0], [-0.3, 0.45, 1.5, 1.1], [1.4, 0.4, 1.4, 1.0], [-1.6, -0.75, 1.0, 0.9], [-0.1, -0.7, 1.3, 0.9], [1.5, -0.7, 1.1, 0.9]].forEach(([x, y, w, h], i) => {
      B.add(box(w, h, 0.02, mat(i % 3 === 0 ? 0xdceaf7 : 0xfafafa), DRAW.cx - 5.2 + x, 3.3 + y, DRAW.z0 + 0.18, false));
      for (let k = 0; k < 3; k++) B.add(box(w * 0.7 - k * 0.15, 0.025, 0.01, mat(i % 3 === 0 ? 0x3b6aa8 : 0x8e97ab), DRAW.cx - 5.2 + x, 3.3 + y + h * 0.25 - k * 0.2, DRAW.z0 + 0.195, false));
      B.add(box(0.07, 0.07, 0.04, mat(0xd13b3b), DRAW.cx - 5.2 + x, 3.3 + y + h / 2 - 0.08, DRAW.z0 + 0.2, false));
    });
    // low beams on the open sides
    // (front of the room stays open so the camera can see in)
  }

  #furnishDrawing() {
    const s = this.scene, wood = mat(0xb98a55, { roughness: 0.6 }), dark = mat(NAVY2, { roughness: 0.5, metalness: 0.3 }), paper = mat(0xfafafa);
    const add = (o) => { s.add(o); return o; }, obs = (x, z, r) => this.obstacles.push({ x, z, r }), poi = (x, z, face) => this.pois.push({ x, z, face, zone: 'drawing' });
    // plan chest (flat-file drawers) on the left wall
    const pc = new THREE.Group();
    pc.add(box(1.3, 1.0, 3.2, mat(0xe8eaee, { roughness: 0.5 }), 0, 0.5, 0));
    [0.17, 0.5, 0.83].forEach(y => { pc.add(box(0.03, 0.26, 2.9, dark, 0.66, y, 0, false)); pc.add(box(0.04, 0.05, 0.6, mat(GREEN), 0.69, y, 0, false)); });
    pc.add(box(1.4, 0.05, 3.3, wood, 0, 1.025, 0));
    [[-0.3, 0.2, 0.9, 0.5], [0.1, -0.7, 0.7, 0.6]].forEach(([x, z, w, d]) => pc.add(box(w, 0.02, d, paper, x, 1.06, z, false)));
    pc.position.set(DRAW.x0 + 0.85, 0, -3.6); add(pc); obs(DRAW.x0 + 1, -3.6, 2.0); poi(DRAW.x0 + 2.8, -3.6, -Math.PI / 2);
    // drafting table with a tilted board and a stool
    const dt = new THREE.Group();
    [[-0.9, -0.5], [0.9, -0.5], [-0.9, 0.5], [0.9, 0.5]].forEach(([x, z]) => dt.add(box(0.07, 1.05, 0.07, dark, x, 0.52, z)));
    const board = box(2.2, 0.06, 1.5, mat(0xf2f4f7, { roughness: 0.4 }), 0, 1.15, 0); board.rotation.x = 0.28; dt.add(board);
    const sheet = box(1.8, 0.015, 1.15, mat(0xdceaf7), 0, 1.2, 0.0, false); sheet.rotation.x = 0.28; dt.add(sheet);
    for (let k = 0; k < 5; k++) { const l = box(1.4 - k * 0.18, 0.012, 0.03, mat(0x3b6aa8), -0.1, 1.215 - 0.0, -0.4 + k * 0.17, false); l.rotation.x = 0.28; l.position.y = 1.2 + (-0.4 + k * 0.17) * -0.0 + 0.02 + (-0.4 + k * 0.17) * 0.28; dt.add(l); }
    dt.add(box(2.0, 0.05, 0.1, dark, 0, 1.0, 0.75, false));
    dt.position.set(DRAW.x0 + 5.0, 0, -1.2); dt.rotation.y = Math.PI / 2 + 0.15; add(dt); obs(DRAW.x0 + 5.0, -1.2, 1.6); poi(DRAW.x0 + 7, -1.2, -Math.PI / 2);
    const stool = new THREE.Group(); stool.add(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 16), mat(GREEN))); stool.children[0].position.y = 0.78; stool.children[0].castShadow = true;
    [0, 1, 2].forEach(i => { const a = i * 2.094; const leg = box(0.05, 0.78, 0.05, dark, Math.sin(a) * 0.2, 0.39, Math.cos(a) * 0.2); stool.add(leg); });
    stool.position.set(DRAW.x0 + 6.4, 0, -1.9); add(stool); obs(DRAW.x0 + 6.4, -1.9, 0.5);
    // tube rack on the back wall
    const tr = new THREE.Group(); tr.add(box(3.0, 0.1, 0.5, dark, 0, 0.05, 0)); tr.add(box(3.0, 0.1, 0.5, dark, 0, 1.1, 0)); [-1.45, 1.45].forEach(x => tr.add(box(0.1, 1.15, 0.5, dark, x, 0.57, 0)));
    for (let i = 0; i < 9; i++) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.0, 14), mat(i % 3 === 0 ? 0xd9c39a : (i % 3 === 1 ? 0xeee6d0 : 0xc9d6e6))); t.position.set(-1.2 + (i % 5) * 0.58 + (i > 4 ? 0.29 : 0), 0.6, (i > 4 ? 0.1 : -0.1)); t.castShadow = true; tr.add(t); }
    tr.position.set(DRAW.x0 + 6.2, 0, DRAW.z0 + 0.45); add(tr); obs(DRAW.x0 + 6.2, DRAW.z0 + 0.9, 1.8); poi(DRAW.x0 + 6.2, DRAW.z0 + 2.3, Math.PI);
    // large-format plotter on a stand
    const pl = new THREE.Group();
    pl.add(box(1.9, 0.5, 0.8, mat(0xf2f4f7, { roughness: 0.4 }), 0, 1.0, 0)); pl.add(box(1.9, 0.08, 0.82, mat(GREEN), 0, 1.28, 0, false)); pl.add(box(1.5, 0.1, 0.35, mat(0x0b0e16), 0, 0.92, 0.38, false));
    pl.add(box(1.5, 0.012, 0.5, paper, 0, 0.7, 0.55, false)); pl.add(box(1.5, 0.35, 0.02, paper, 0, 0.56, 0.62, false));
    [[-0.8, -0.3], [0.8, -0.3], [-0.8, 0.3], [0.8, 0.3]].forEach(([x, z]) => pl.add(box(0.06, 0.78, 0.06, dark, x, 0.39, z)));
    pl.position.set(DRAW.x1 - 3.2, 0, DRAW.z0 + 0.9); add(pl); obs(DRAW.x1 - 3.2, DRAW.z0 + 1.2, 1.6); poi(DRAW.x1 - 3.2, DRAW.z0 + 3, Math.PI);
    // cable drums by the left wall
    [[DRAW.x0 + 1.1, -9.0, 0xc47b2b], [DRAW.x0 + 1.2, -7.2, 0x1c7ed6]].forEach(([x, z, c]) => {
      const d = new THREE.Group(); [-0.3, 0.3].forEach(o => { const f = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.06, 24), wood); f.rotation.z = Math.PI / 2; f.position.x = o; f.castShadow = true; d.add(f); });
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.54, 24), mat(c, { roughness: 0.6 })); core.rotation.z = Math.PI / 2; core.castShadow = true; d.add(core);
      d.rotation.y = Math.PI / 2; d.position.set(x, 0.6, z); add(d); obs(x, z, 0.9);
    });
    // bookcases, plants
    this.#put('bookcase', { pos: [DRAW.x0 + 0.5, 0, 1.6], rot: Math.PI / 2, scale: K, colours: { 'Wood': NAVY2, 'DarkWood': GREEN } });
    this.#put('bookcase', { pos: [DRAW.x0 + 0.5, 0, 3.8], rot: Math.PI / 2, scale: K, colours: { 'Wood': NAVY2, 'DarkWood': GREEN } });
    obs(DRAW.x0 + 0.8, 2.7, 2.2); poi(DRAW.x0 + 2.4, 2.7, -Math.PI / 2);
    [[DRAW.x1 - 1.0, 3.9], [DRAW.x0 + 1.2, DRAW.z0 + 1.2]].forEach(([x, z], i) => { const p = this.#put(i ? 'flowers' : 'cactus', { pos: [x, 0, z], scale: K * 1.3 }); if (p) obs(x, z, 0.9); });
    // a small meeting spot for Cal's reviews
    const t = this.#put('table', { pos: [DRAW.cx + 4.5, 0, 1.8], scale: K * 1.3, colours: { wood: WHITE } }); if (t) obs(DRAW.cx + 4.5, 1.8, 1.6);
    poi(DRAW.cx + 4.5, 3.6, Math.PI);
  }

  #addDrawingAgent(data, rugs) {
    const colour = new THREE.Color(data.colour || '#ffd43b'), [dx, dz, facing] = DRAW_DESK;
    const desk = this.#desk(colour); desk.position.set(dx, 0, dz); desk.rotation.y = facing; this.scene.add(desk);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), mat(NAVY2, { roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })); rug.rotation.x = -Math.PI / 2; rug.position.set(dx, 0.02, dz + 0.5); rug.receiveShadow = true; this.scene.add(rug); rugs.push(rug);
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(3.9, 3.9), mat(0x273047, { roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); inner.rotation.x = -Math.PI / 2; inner.position.set(dx, 0.035, dz + 0.5); inner.receiveShadow = true; this.scene.add(inner); rugs.push(inner);
    desk.updateMatrixWorld(true);
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(desk.quaternion);
    const chair = this.#officeChair(colour); chair.position.set(dx, 0, dz).addScaledVector(front, 1.15); chair.rotation.y = Math.atan2(-front.x, -front.z); this.scene.add(chair);
    const seat = new THREE.Vector3(dx, 0, dz).addScaledVector(front, 1.05), faceSeat = Math.atan2(-front.x, -front.z);
    this.obstacles.push({ rect: true, x0: dx - 1.45, x1: dx + 1.45, z0: dz - 0.75, z1: dz + 0.75, desk: true });
    const group = buildCharacter(data.colour, data.role === 'drawing' ? 'reviewer' : data.role, data.gear);
    group.position.copy(this.#randomIdlePoint('drawing')); this.scene.add(group);
    const el = document.createElement('div'); el.className = 'lbl';
    el.innerHTML = `<b>${data.name}</b> · ${data.platform} <span class="st"></span>`;
    const label = new CSS2DObject(el); label.position.set(0, 2.6, 0); group.add(label);
    this.agents.set(data.id, { data, group, desk, chair, seat, faceSeat, zone: 'drawing', state: 'idle', label, el, walkTarget: null, waypoint: null, faceTo: null, wait: Math.random() * 3, t: Math.random() * 10, blink: 2 + Math.random() * 3 });
    this.drawingId = data.id; this.drawingDesk = desk;
    // little chip over the desk: tells you it can be clicked
    const chip = document.createElement('div'); chip.className = 'lbl hint'; chip.textContent = 'Click to hand Cal a drawing check';
    const co = new CSS2DObject(chip); co.position.set(dx, 4.3, dz); this.scene.add(co); this.drawExtras.push(co); this.deskHint = co; co.visible = this.room === 'drawing';
    this.clickRoots = [desk, group, chair];
  }

  // ---------- room switching, picking, hand-over ----------
  focus(where, ms = 1100) {
    const [dx, dz] = DRAW_DESK;
    const spots = {
      media: { p: [26, 19, 32], t: [1, 0.5, 0.5] },
      drawing: { p: [DRAW.cx + 9, 15, 24], t: [DRAW.cx + 1.5, 0.5, -3] },
      desk: { p: [dx + 8.0, 4.8, dz + 8.0], t: [dx + 2.8, 1.0, dz + 0.6] }
    };
    const sp = spots[where]; if (!sp) return;
    this.room = where;
    this.tween = { t0: performance.now(), ms, p0: this.camera.position.clone(), tg0: this.controls.target.clone(), p1: new THREE.Vector3(...sp.p), tg1: new THREE.Vector3(...sp.t) };
    this.controls.enabled = false;
    if (this.deskHint) this.deskHint.visible = where === 'drawing';
    this.canvas.style.cursor = '';
  }

  #initPicking() {
    this.ray = new THREE.Raycaster(); this.down = null;
    const ndc = (e) => { const r = this.canvas.getBoundingClientRect(); return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
    const visibleChain = (o) => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
    const what = (e) => {
      this.ray.setFromCamera(ndc(e), this.camera);
      if (this.room === 'media' && this.doorPlaque && visibleChain(this.doorPlaque) && this.ray.intersectObject(this.doorPlaque, true).length) return 'door';
      if (this.room === 'drawing' && this.clickRoots.length && this.ray.intersectObjects(this.clickRoots, true).some(h => visibleChain(h.object))) return 'desk';
      return null;
    };
    this.canvas.addEventListener('pointerdown', (e) => { this.down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    this.canvas.addEventListener('pointerup', (e) => {
      const d = this.down; this.down = null; if (!d || this.tween) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || performance.now() - d.t > 500) return;
      const w = what(e); if (w && this.onPick) this.onPick(w);
    });
    let last = 0;
    this.canvas.addEventListener('pointermove', (e) => {
      const n = performance.now(); if (n - last < 60 || e.buttons) return; last = n;
      this.canvas.style.cursor = this.tween ? '' : (what(e) ? 'pointer' : '');
    });
  }

  // animate the cable schedule (a folder) and the drawings (paper tubes) flying onto Cal's desk
  handOver({ hasSchedule = true, drawings = 1 } = {}) {
    this.clearJob(); if (!this.drawingDesk) return;
    const [dx, dz] = DRAW_DESK, TH = 1.05; this.jobItems = [];
    const from = new THREE.Vector3(dx + 5, 3.4, dz + 6);
    const make = (mesh, to, delay) => { mesh.position.copy(from); this.scene.add(mesh); this.jobItems.push(mesh); this.props = this.props || []; this.props.push({ mesh, from: from.clone(), to, t: -delay, dur: 1.0 }); };
    if (hasSchedule) {
      const f = new THREE.Group(); f.add(box(0.5, 0.04, 0.38, mat(0x1c7ed6, { roughness: 0.5 }), 0, 0, 0, false)); f.add(box(0.46, 0.02, 0.34, mat(0xffffff), 0.01, 0.025, 0, false)); f.add(box(0.12, 0.045, 0.1, mat(GREEN), -0.15, 0.05, 0, false));
      make(f, new THREE.Vector3(dx - 0.8, TH + 0.12, dz - 0.2), 0);
    }
    const n = Math.min(drawings, 6);
    for (let i = 0; i < n; i++) {
      const t = new THREE.Group(); const body = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.6, 12), mat(i % 2 ? 0xeee6d0 : 0xd9c39a)); body.castShadow = true; t.add(body);
      [-0.3, 0.3].forEach(y => { const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.02, 12), mat(NAVY2)); cap.position.y = y; t.add(cap); });
      t.rotation.x = Math.PI / 2;
      const wrap = new THREE.Group(); wrap.add(t);
      make(wrap, new THREE.Vector3(dx + 0.55 + (i % 3) * 0.14, TH + 0.1 + Math.floor(i / 3) * 0.11, dz + 0.2), 0.25 + i * 0.18);
    }
  }
  clearJob() { (this.jobItems || []).forEach(m => this.scene.remove(m)); this.jobItems = []; this.props = []; }
  #stepProps(dt) {
    if (!this.props || !this.props.length) return;
    for (const p of this.props) {
      p.t += dt; if (p.t < 0) { p.mesh.visible = false; continue; } p.mesh.visible = true;
      const k = Math.min(1, p.t / p.dur), e = k * k * (3 - 2 * k);
      p.mesh.position.lerpVectors(p.from, p.to, e); p.mesh.position.y += Math.sin(k * Math.PI) * 1.2;
      p.mesh.rotation.y = (1 - e) * 5;
    }
    this.props = this.props.filter(p => p.t < p.dur);
    if (!this.props.length) this.props = [];
  }

  // ---------- animation ----------
  #animate() {
    requestAnimationFrame(() => this.#animate());
    if (document.hidden) return;
    this.step(Math.min(this.clock.getDelta(), 0.05));
  }

  step(dt) {
    for (const a of this.agents.values()) this.#stepAgent(a, dt);
    let tweenK = 1;
    if (this.tween) {
      const tw = this.tween; tweenK = Math.min(1, (performance.now() - tw.t0) / tw.ms); const e = tweenK * tweenK * (3 - 2 * tweenK);
      this.camera.position.lerpVectors(tw.p0, tw.p1, e); this.controls.target.lerpVectors(tw.tg0, tw.tg1, e);
      if (tweenK >= 1) { this.tween = null; this.controls.enabled = true; }
    }
    this.controls.update();
    this.#stepProps(dt);
    // hide walls the camera is behind, so you never look at the back of one
    const c = this.camera.position;
    if (this.backWall) this.backWall.visible = c.z > -ROOM_D / 2 + 1;
    if (this.leftWall) this.leftWall.visible = c.x > -ROOM_W / 2 + 1 && !(this.room !== 'media' && (!this.tween || tweenK > 0.3));
    if (this.drawBackWall) this.drawBackWall.visible = c.z > DRAW.z0 + 1;
    if (this.drawLeftWall) this.drawLeftWall.visible = c.x > DRAW.x0 + 1;
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  #inMeeting(x, z) { const M = MEETING; return x > M.x0 && x < M.x1 && z > M.z0 && z < M.z1; }
  #clear(x, z) { return this.#walkable(x, z); }

  // ---- nav grid ----
  #buildNav() {
    const CELL = 0.5; this.navCell = CELL;
    const cols = Math.ceil((NAV.x1 - NAV.x0) / CELL), rows = Math.ceil((NAV.z1 - NAV.z0) / CELL);
    const grid = new Uint8Array(cols * rows); // 1 = walkable
    const M = MEETING;
    const blocked = (x, z) => {
      const inMedia = x >= -ROOM_W / 2 + 0.7 && x <= ROOM_W / 2 - 0.7 && z >= -ROOM_D / 2 + 1.0 && z <= ROOM_D / 2 - 0.7;
      const inDraw = x >= DRAW.x0 + 0.7 && x <= DRAW.x1 - 0.7 && z >= DRAW.z0 + 1.0 && z <= DRAW.z1 - 0.7;
      const inDoor = x >= DRAW.x1 - 0.75 && x <= -ROOM_W / 2 + 0.8 && z >= DOOR.z0 + 0.25 && z <= DOOR.z1 - 0.25;
      if (!inMedia && !inDraw && !inDoor) return true;
      for (const o of this.obstacles) {
        if (o.rect) { if (x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1) return true; }
        else if (Math.hypot(o.x - x, o.z - z) < o.r) return true;
      }
      // glass partitions: x = M.x0 line (door gap near z1), z = M.z0 line
      if (Math.abs(x - M.x0) < 0.45 && z > M.z0 - 0.45 && z < M.z1 - 2.4) return true;
      if (Math.abs(z - M.z0) < 0.45 && x > M.x0 - 0.45 && x < M.x1 + 0.45) return true;
      return false;
    };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = NAV.x0 + (c + 0.5) * CELL, z = NAV.z0 + (r + 0.5) * CELL;
      grid[r * cols + c] = blocked(x, z) ? 0 : 1;
    }
    this.nav = { grid, cols, rows };
  }
  #cellOf(x, z) { const c = Math.floor((x - NAV.x0) / this.navCell), r = Math.floor((z - NAV.z0) / this.navCell); return [THREE.MathUtils.clamp(c, 0, this.nav.cols - 1), THREE.MathUtils.clamp(r, 0, this.nav.rows - 1)]; }
  #posOf(c, r) { return new THREE.Vector3(NAV.x0 + (c + 0.5) * this.navCell, 0, NAV.z0 + (r + 0.5) * this.navCell); }
  __walk(x, z) { return this.#walkable(x, z); }
  #walkable(x, z) { if (!this.nav) return true; const [c, r] = this.#cellOf(x, z); return this.nav.grid[r * this.nav.cols + c] === 1; }
  #nearestWalkable(x, z) {
    if (!this.nav) return new THREE.Vector3(x, 0, z);
    const [c0, r0] = this.#cellOf(x, z);
    for (let rad = 0; rad < 8; rad++) for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
      const c = c0 + dc, r = r0 + dr; if (c < 0 || r < 0 || c >= this.nav.cols || r >= this.nav.rows) continue;
      if (this.nav.grid[r * this.nav.cols + c]) return this.#posOf(c, r);
    }
    return new THREE.Vector3(x, 0, z);
  }
  // A* over the grid (8-neighbour, no corner cutting). Returns a list of world points, simplified.
  #findPath(from, to) {
    if (!this.nav) return [to.clone()];
    const { grid, cols, rows } = this.nav;
    const [sc, sr] = this.#cellOf(from.x, from.z); let [tc, tr] = this.#cellOf(to.x, to.z);
    if (!grid[tr * cols + tc]) { const p = this.#nearestWalkable(to.x, to.z); [tc, tr] = this.#cellOf(p.x, p.z); }
    const start = sr * cols + sc, goal = tr * cols + tc;
    if (start === goal) return [to.clone()];
    const open = [start], came = new Map(), gS = new Map([[start, 0]]);
    const h = (i) => { const c = i % cols, r = (i / cols) | 0; return Math.hypot(c - tc, r - tr); };
    const fS = new Map([[start, h(start)]]); const closed = new Set();
    let found = false, guard = 0;
    while (open.length && guard++ < 6000) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (fS.get(open[i]) < fS.get(open[bi])) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (cur === goal) { found = true; break; }
      closed.add(cur);
      const cc = cur % cols, cr = (cur / cols) | 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dc && !dr) continue; const nc = cc + dc, nr = cr + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const ni = nr * cols + nc; if (!grid[ni] || closed.has(ni)) continue;
        if (dc && dr && (!grid[cr * cols + nc] || !grid[nr * cols + cc])) continue; // no corner cutting
        const ng = gS.get(cur) + (dc && dr ? 1.414 : 1);
        if (ng < (gS.get(ni) ?? Infinity)) { came.set(ni, cur); gS.set(ni, ng); fS.set(ni, ng + h(ni)); if (!open.includes(ni)) open.push(ni); }
      }
    }
    if (!found) return [this.#nearestWalkable(from.x, from.z)];
    const cells = []; let cur = goal; while (cur !== start) { cells.push(cur); cur = came.get(cur); } cells.reverse();
    // string-pull: drop points that are collinear-ish to smooth the path
    const pts = cells.map(i => this.#posOf(i % cols, (i / cols) | 0));
    const out = []; let last = from.clone();
    for (let i = 0; i < pts.length; i++) { const nxt = pts[i + 1]; if (!nxt || !this.#lineClear(last, nxt)) { out.push(pts[i]); last = pts[i]; } }
    out[out.length - 1] = to.clone(); if (!out.length) out.push(to.clone());
    return out;
  }
  #lineClear(a, b) { const n = Math.ceil(a.distanceTo(b) / (this.navCell * 0.5)) + 1; for (let i = 0; i <= n; i++) { const t = i / n; if (!this.#walkable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false; } return true; }

  #randomIdlePoint(zone = 'media') {
    if (zone === 'drawing') {
      for (let i = 0; i < 80; i++) {
        const x = DRAW.x0 + 1.5 + Math.random() * (DRAW.w - 3), z = DRAW.z0 + 2.5 + Math.random() * (DRAW.d - 4);
        if (this.#walkable(x, z)) return new THREE.Vector3(x, 0, z);
      }
      return this.#nearestWalkable(DRAW.cx, -1);
    }
    for (let i = 0; i < 80; i++) {
      const x = -ROOM_W / 2 + 1.5 + Math.random() * (ROOM_W - 3);
      const z = -ROOM_D / 2 + 2.5 + Math.random() * (ROOM_D - 4);
      if (this.#walkable(x, z) && !this.#inMeeting(x, z)) return new THREE.Vector3(x, 0, z);
    }
    return this.#nearestWalkable(0, 4);
  }

  #pickWanderTarget(a) {
    const zone = a.zone || 'media', pois = this.pois.filter(p => (p.zone || 'media') === zone);
    if (Math.random() < 0.45 && pois.length) {
      const p = pois[Math.floor(Math.random() * pois.length)];
      a.faceTo = p.face;
      return this.#nearestWalkable(p.x + (Math.random() - 0.5) * 0.6, p.z + (Math.random() - 0.5) * 0.6);
    }
    a.faceTo = null;
    return this.#randomIdlePoint(zone);
  }

  // walk to target along an A* path over the nav grid (recomputed when the target changes or we get stuck)
  #goto(a, target, dt, ud) {
    const g = a.group;
    const dxz = Math.hypot(target.x - g.position.x, target.z - g.position.z);
    if (dxz < 0.15) { a.path = null; return true; }
    const key = target.x.toFixed(2) + ',' + target.z.toFixed(2);
    if (!a.path || a.pathKey !== key || a.stuck > 1.2) {
      a.path = this.#findPath(g.position, target); a.pathKey = key; a.pathIdx = 0; a.stuck = 0;
    }
    if (dxz < 1.0) {
      // final approach: straight line, turning to face the desk if we're going to sit
      const d = new THREE.Vector3(target.x - g.position.x, 0, target.z - g.position.z); const step = Math.min(2.2 * dt, d.length()); g.position.addScaledVector(d.normalize(), step);
      if (a.state === 'working') { let df = a.faceSeat - g.rotation.y; df = Math.atan2(Math.sin(df), Math.cos(df)); g.rotation.y += df * Math.min(1, dt * 6); }
      return Math.hypot(target.x - g.position.x, target.z - g.position.z) < 0.15;
    }
    const wp = a.path[a.pathIdx] || target;
    if (Math.hypot(wp.x - g.position.x, wp.z - g.position.z) < 0.25 && a.pathIdx < a.path.length - 1) a.pathIdx++;
    const bx = g.position.x, bz = g.position.z;
    this.#walkTowards(g, a.path[a.pathIdx] || target, dt, ud);
    a.stuck = Math.hypot(g.position.x - bx, g.position.z - bz) < 0.2 * dt ? (a.stuck || 0) + dt : 0;
    return false;
  }

  #stepAgent(a, dt) {
    a.t += dt;
    const ud = a.group.userData, g = a.group;
    if (a.state === 'working') {
      if (a.walkTarget !== a.seat) { a.walkTarget = a.seat; a.path = null; a.seated = false; }
      if (!a.seated) { if (!this.#goto(a, a.seat, dt, ud)) return; a.seated = true; }
      g.position.x = a.seat.x; g.position.z = a.seat.z;
      g.rotation.y = a.faceSeat; ud.head.rotation.y *= 0.9;
      // typing: hands forward on the keyboard, small bob, occasional glance at the second screen
      ud.body.position.y = 0.85 + Math.sin(a.t * 14) * 0.012;
      ud.arms[0].rotation.x = -1.25 + Math.sin(a.t * 18) * 0.12; ud.arms[0].rotation.z = 0.25;
      ud.arms[1].rotation.x = -1.25 + Math.cos(a.t * 18) * 0.12; ud.arms[1].rotation.z = -0.25;
      ud.head.rotation.y = Math.sin(a.t * 0.6) * 0.25; ud.head.rotation.x = 0.12;
      ud.legs.forEach(l => l.rotation.x = -1.3);
      g.position.y = 0.32; // sitting
      this.#blink(a, dt);
      return;
    }
    g.position.y += (0 - g.position.y) * Math.min(1, dt * 10);
    if (this.nav && !this.#walkable(g.position.x, g.position.z)) { const p = this.#nearestWalkable(g.position.x, g.position.z); g.position.x = p.x; g.position.z = p.z; a.path = null; }
    ud.arms.forEach(x => { x.rotation.z *= 0.9; }); ud.head.rotation.x *= 0.9;
    this.#blink(a, dt);
    if (!a.walkTarget) {
      a.wait -= dt;
      ud.arms.forEach(x => x.rotation.x *= 0.9); ud.legs.forEach(x => x.rotation.x *= 0.9);
      ud.body.position.y = 0.85 + Math.sin(a.t * 2) * 0.02;
      ud.head.rotation.y = Math.sin(a.t * 0.7) * 0.35;
      g.rotation.z = 0;
      this.#separate(a, dt);
      if (a.faceTo !== null) { let d = a.faceTo - g.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); g.rotation.y += d * Math.min(1, dt * 4); }
      if (a.wait <= 0) { a.walkTarget = this.#pickWanderTarget(a); a.path = null; }
      return;
    }
    if (this.#goto(a, a.walkTarget, dt, ud)) { a.walkTarget = null; a.path = null; a.wait = 2 + Math.random() * 6; }
  }

  #blink(a, dt) {
    a.blink -= dt;
    const eyes = a.group.userData.eyes || [];
    if (a.blink < 0) { eyes.forEach(e => e.scale.y = 0.1); if (a.blink < -0.12) { eyes.forEach(e => e.scale.y = 1); a.blink = 2.5 + Math.random() * 4; } }
  }

  #separate(a, dt) {
    // keep standing agents from overlapping each other
    const g = a.group;
    for (const b of this.agents.values()) {
      if (b === a || b.state === 'working') continue;
      const dx = g.position.x - b.group.position.x, dz = g.position.z - b.group.position.z, d = Math.hypot(dx, dz);
      if (d < 1.3 && d > 0.001) { const nx = g.position.x + dx / d * (1.3 - d) * dt * 2, nz = g.position.z + dz / d * (1.3 - d) * dt * 2; if (this.#walkable(nx, nz)) { g.position.x = nx; g.position.z = nz; } }
    }
  }

  #walkTowards(g, target, dt, ud) {
    const dir = target.clone().sub(g.position); dir.y = 0; const dist = dir.length(); dir.normalize();
    // mild steer round other agents (never strong enough to cancel forward motion)
    for (const b of this.agents.values()) {
      if (b.group === g) continue;
      const dx = g.position.x - b.group.position.x, dz = g.position.z - b.group.position.z, d = Math.hypot(dx, dz);
      if (d < 1.2 && d > 0.001 && dist > 0.6) { const push = (1.2 - d) * 0.6; dir.x += dx / d * push; dir.z += dz / d * push; }
    }
    dir.normalize();
    const step = Math.min(2.2 * dt, dist);
    const nx = g.position.x + dir.x * step, nz = g.position.z + dir.z * step;
    if (this.#walkable(nx, nz)) { g.position.x = nx; g.position.z = nz; }
    else if (this.#walkable(nx, g.position.z)) g.position.x = nx;
    else if (this.#walkable(g.position.x, nz)) g.position.z = nz;
    const yaw = Math.atan2(dir.x, dir.z);
    let diff = yaw - g.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    g.rotation.y += diff * Math.min(1, dt * 8);
    ud.head.rotation.y *= 0.9;
    // walk cycle driven by distance travelled (no sliding), with a lean into turns
    g.userData.phase = (g.userData.phase || 0) + Math.min(2.2 * dt, dist) * 4.2;
    const w = g.userData.phase;
    ud.legs[0].rotation.x = Math.sin(w) * 0.75; ud.legs[1].rotation.x = -Math.sin(w) * 0.75;
    ud.arms[0].rotation.x = -Math.sin(w) * 0.55; ud.arms[1].rotation.x = Math.sin(w) * 0.55;
    ud.body.position.y = 0.85 + Math.abs(Math.sin(w)) * 0.045;
    ud.head.position.y = 1.75 + Math.abs(Math.sin(w)) * 0.03;
    g.rotation.z = THREE.MathUtils.clamp(-diff * 0.6, -0.12, 0.12);
  }
}
