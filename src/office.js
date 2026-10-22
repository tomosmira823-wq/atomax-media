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
const DESK_SLOTS = [[-9, -5.5], [-3, -5.5], [3, -5.5], [9, -5.5], [-9, 1], [-3, 1], [3, 1], [-3, 7], [1, 7]];
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
  [-0.17, 0.17].forEach(x => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), eyeW); e.position.set(x, 0.07, 0.44); head.add(e);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), eyeB); p.position.set(x, 0.07, 0.53); head.add(p);
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
  g.userData = { arms, legs, body, head };
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
    this.ready = this.#loadModels().then(() => this.#furnish()).catch(e => console.error('furniture failed', e));
    this.#animate();
    window.addEventListener('resize', () => this.#resize());
  }

  // ---------- renderer, camera, lights ----------
  #initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.labelRenderer = new CSS2DRenderer({ element: this.labelsDiv });

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(NAVY);
    this.scene.fog = new THREE.Fog(NAVY, 60, 100);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.65;

    this.camera = new THREE.PerspectiveCamera(36, 1, 1, 160);
    this.camera.position.set(27, 24, 34);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.set(1, 0.5, 0.5);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2.2;
    this.controls.minDistance = 10; this.controls.maxDistance = 70;
    this.controls.enablePan = false;

    this.scene.add(new THREE.HemisphereLight(0xe8eeff, 0x202633, 0.5));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    sun.position.set(-16, 24, 12); sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const sc = sun.shadow.camera; sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 80;
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02; sun.shadow.radius = 6; sun.shadow.blurSamples = 16;
    this.scene.add(sun);
    const fill = new THREE.PointLight(0xa8ffb0, 10, 40, 1.5); fill.position.set(6, 5, 4); this.scene.add(fill);
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
    L.add(box(0.3, WALL_H, D, mat(0xeef0f3, { roughness: 0.95 }), -W / 2 - 0.15, WALL_H / 2, 0));
    L.add(box(0.05, 0.14, D, mat(GREEN, { emissive: GREEN, emissiveIntensity: 0.5 }), -W / 2 + 0.05, 5.3, 0, false));
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, transmission: 0.75, opacity: 0.45, transparent: true, roughness: 0.03, metalness: 0, ior: 1.45, thickness: 0.05, depthWrite: false });
    for (let i = 0; i < 4; i++) {
      const z = -7.5 + i * 4.6;
      L.add(box(0.1, 3.2, 3.0, glass, -W / 2 + 0.1, 3.2, z, false));
      L.add(box(0.2, 3.4, 0.15, mat(NAVY2), -W / 2 + 0.1, 3.2, z - 1.55));
      L.add(box(0.2, 3.4, 0.15, mat(NAVY2), -W / 2 + 0.1, 3.2, z + 1.55));
      L.add(box(0.2, 0.15, 3.1, mat(NAVY2), -W / 2 + 0.1, 1.5, z));
      L.add(box(0.2, 0.15, 3.1, mat(NAVY2), -W / 2 + 0.1, 4.9, z));
    }

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
    for (let z = M.z0; z <= M.z1 - 2.4; z += 0.8) this.obstacles.push({ x: M.x0, z, r: 0.7 });
    for (let x = M.x0; x <= M.x1; x += 0.8) this.obstacles.push({ x, z: M.z0, r: 0.7 });
    this.meetingPoint = new THREE.Vector3((M.x0 + M.x1) / 2, 0, (M.z0 + M.z1) / 2);
    this.obstacles.push({ x: this.meetingPoint.x, z: this.meetingPoint.z, r: 2.3 });   // the table
    [[M.x0 + 1.2, M.z0 + 2.2, 0], [M.x1 - 1.2, M.z1 - 1.5, Math.PI], [M.x0 + 2.8, M.z1 - 1.2, -Math.PI / 2 * 0], [M.x1 - 1.4, M.z0 + 1.5, Math.PI / 2]].forEach(([x, z, f]) => this.pois.push({ x, z, face: f, room: true }));

    // reception sign (right-hand side, angled toward the viewer)
    const sign = new THREE.Group();
    sign.add(box(0.3, 2.6, 2.6, mat(NAVY), 0, 1.3, 0));
    const signLogo = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3 * LOGO_AR), new THREE.MeshBasicMaterial({ map: this.logoWhiteTex, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    signLogo.rotation.y = -Math.PI / 2; signLogo.position.set(-0.18, 1.7, 0); sign.add(signLogo);
    const signText = this.#textPlane('MEDIA OFFICE', 1.8, 0.25, { color: '#40bd00', size: 60, weight: '700', spacing: 8 });
    signText.rotation.y = -Math.PI / 2; signText.position.set(-0.18, 1.25, 0); sign.add(signText);
    sign.add(box(0.5, 0.1, 2.8, mat(GREEN, { emissive: GREEN, emissiveIntensity: 0.4 }), 0, 0.05, 0, false));
    sign.position.set(W / 2 - 1.4, 0, -0.5); sign.rotation.y = Math.PI * 0.75; s.add(sign);
    this.obstacles.push({ x: W / 2 - 1.4, z: -0.5, r: 2 });

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
    this.#put('sofa', { pos: [-5.8, 0, 9.6], rot: Math.PI, scale: K * 1.15, colours: { carpet: 0x34405c, wood: WHITE } });
    const ct = this.#put('table', { pos: [-5.8, 0, 7.1], scale: K * 1.4, colours: { wood: WHITE } });
    const th = ct ? new THREE.Box3().setFromObject(ct).max.y : 0.8;
    this.#put('cake', { pos: [-6.5, th, 7.1], scale: K });
    this.#put('radio', { pos: [-5, th, 7.0], rot: -0.5, scale: K * 0.9, colours: { metalMedium: GREEN } });
    this.#put('lamp-table', { pos: [-8.3, 0.6, 9.7], scale: K * 1.2, colours: { metal: NAVY2 }, emissive: { lamp: 0xffd9a0 } });
    this.scene.add(box(0.8, 0.6, 0.8, mat(NAVY2), -8.3, 0.3, 9.7));
    this.#put('flowers', { pos: [-8.3, 0, 7.3], scale: K });
    this.#put('cactus', { pos: [-3.2, 0, 9.8], scale: K * 1.2 });
    this.obstacles.push({ x: -5.8, z: 8.4, r: 3.4 });
    this.pois.push({ x: -5.8, z: 5, face: 0 });
    // bench under the windows + plants in corners
    this.#put('bench', { pos: [-W / 2 + 1.2, 0, -1.5], rot: Math.PI / 2, scale: K });
    this.obstacles.push({ x: -W / 2 + 1.2, z: -1.5, r: 1.6 });
    this.pois.push({ x: -W / 2 + 2.8, z: -1.5, face: -Math.PI / 2 });
    this.#put('cactus', { pos: [-W / 2 + 1.2, 0, -D / 2 + 1.2], scale: K * 1.4 });
    this.#put('flowers', { pos: [W / 2 - 1.2, 0, D / 2 - 1.2], scale: K * 1.2 });
    this.#put('cactus', { pos: [M.x1 - 0.8, 0, M.z0 + 0.8], scale: K });
    // meeting room table + chairs (coffee table scaled up to a boardroom table)
    const mt = this.#put('table', { pos: [this.meetingPoint.x, 0, this.meetingPoint.z], scale: K * 2.1, colours: { wood: WHITE } });
    if (mt) {
      const b = new THREE.Box3().setFromObject(mt), sz = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
      this.#put('flowers', { pos: [c.x, b.max.y, c.z], scale: 0.9 });
      const chair = (x, z, r) => this.#put('chair-desk', { pos: [x, 0, z], rot: r, scale: K * 1.15, colours: { metal: NAVY2, carpetBlue: GREEN } });
      const longX = sz.x >= sz.z;
      if (longX) {
        [-1.1, 1.1].forEach(dx => { chair(c.x + dx, b.min.z - 0.8, 0); chair(c.x + dx, b.max.z + 0.8, Math.PI); });
        chair(b.min.x - 0.9, c.z, Math.PI / 2); chair(b.max.x + 0.9, c.z, -Math.PI / 2);
      } else {
        [-1.1, 1.1].forEach(dz => { chair(b.min.x - 0.8, c.z + dz, Math.PI / 2); chair(b.max.x + 0.8, c.z + dz, -Math.PI / 2); });
        chair(c.x, b.min.z - 0.9, 0); chair(c.x, b.max.z + 0.9, Math.PI);
      }
    }
    // if agents were requested before the models arrived, place them now
    if (this.pendingAgents) { const l = this.pendingAgents; this.pendingAgents = null; this.setAgents(l); }
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
    const g = new THREE.Group();
    // Kenney desk (white) with a computer on it, agent-coloured rug with navy border, mug, lamp glow
    const desk = this.#put('desk-teacher', { scale: K * 1.4, colours: { wood: WHITE, metal: NAVY2 } });
    if (desk) { this.scene.remove(desk); desk.rotation.y = Math.PI; g.add(desk); }
    const dh = desk ? new THREE.Box3().setFromObject(desk).max.y : 1.0;
    const pc = this.#put('computer', { scale: K * 1.15, colours: { metal: WHITE, metalDark: NAVY2 } });
    let screenMat = null;
    if (pc) {
      this.scene.remove(pc); pc.position.set(-0.15, dh, 0.05); pc.rotation.y = Math.PI; g.add(pc);
      pc.traverse(o => { if (o.isMesh && o.material.name.startsWith('metalMedium')) screenMat = o.material; });
    }
    if (!screenMat) screenMat = new THREE.MeshStandardMaterial();
    screenMat.color.set(0x16233a); screenMat.emissive.set(0x1c3a6b); screenMat.emissiveIntensity = 0.8; screenMat.roughness = 0.25;
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.2, 14), mat(colour, { roughness: 0.4 })); mug.position.set(0.95, dh + 0.1, 0.15); mug.castShadow = true; g.add(mug);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 3.4), mat(colour, { roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.035, -0.6); rug.receiveShadow = true; g.add(rug);
    const rugEdge = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 3.6), mat(NAVY2, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })); rugEdge.rotation.x = -Math.PI / 2; rugEdge.position.set(0, 0.02, -0.6); g.add(rugEdge);
    g.userData.screenMat = screenMat;
    g.userData.deskHeight = dh;
    return g;
  }

  // ---------- public API ----------
  setAgents(list) {
    if (!this.models['desk-teacher']) { this.pendingAgents = list; return; }
    for (const a of this.agents.values()) { this.scene.remove(a.group); this.scene.remove(a.desk); this.scene.remove(a.chair); a.label.element.remove(); }
    this.agents.clear();
    this.obstacles = this.obstacles.filter(o => !o.desk);
    list.forEach((data, i) => {
      const colour = new THREE.Color(data.colour || '#40bd00');
      const [dx, dz] = DESK_SLOTS[i % DESK_SLOTS.length];
      const desk = this.#desk(colour); desk.position.set(dx, 0, dz); this.scene.add(desk);
      const chair = this.#put('chair-desk', { pos: [dx, 0, dz - 1.45], rot: 0, scale: K * 1.15, colours: { metal: NAVY2, carpetBlue: '#' + colour.getHexString() } });
      const seat = new THREE.Vector3(dx, 0, dz - 1.35);
      this.obstacles.push({ x: dx, z: dz - 0.6, r: 2.4, desk: true });
      const group = buildCharacter(data.colour, data.role, data.gear);
      group.position.copy(this.#randomIdlePoint());
      this.scene.add(group);
      const el = document.createElement('div'); el.className = 'lbl';
      el.innerHTML = `<b>${data.name}</b> · ${data.platform} <span class="st"></span>`;
      const label = new CSS2DObject(el); label.position.set(0, 2.6, 0); group.add(label);
      this.agents.set(data.id, { data, group, desk, chair, seat, state: 'idle', label, el, walkTarget: null, waypoint: null, faceTo: null, wait: Math.random() * 3, t: Math.random() * 10 });
    });
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
    if (state !== 'working') { a.walkTarget = null; a.waypoint = null; a.waypoint2 = null; a.crossed = false; a.faceTo = null; a.wait = 1 + Math.random() * 2; }
  }

  setBoard(lines) {
    this.boardLines = lines;
    const c = this.boardCanvas, ctx = c.getContext('2d');
    ctx.fillStyle = '#0f1420'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#40bd00'; ctx.fillRect(0, 0, c.width, 8);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 34px Segoe UI, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('PROJECT STATUS', 36, 64);
    ctx.font = '22px Segoe UI, sans-serif'; ctx.fillStyle = '#8e97ab'; ctx.fillText('Atomax-UK · Media Office', 36, 98);
    const rows = lines.length ? lines : [...this.agents.values()].map(a => ({ colour: a.data.colour, text: `${a.data.name} · ${a.data.platform}`, status: 'Ready' }));
    rows.slice(0, 7).forEach((r, i) => {
      const y = 150 + i * 42;
      ctx.fillStyle = r.colour || '#40bd00'; ctx.beginPath(); ctx.arc(52, y - 8, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e6eaf2'; ctx.font = '24px Segoe UI, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(r.text, 80, y);
      ctx.fillStyle = r.status === 'Working' ? '#40bd00' : (r.status === 'Done' ? '#7fc8ff' : (r.status === 'Error' ? '#e05252' : '#8e97ab'));
      ctx.textAlign = 'right'; ctx.fillText(r.status || '', c.width - 40, y);
    });
    this.boardTex.needsUpdate = true;
  }

  // ---------- animation ----------
  #animate() {
    requestAnimationFrame(() => this.#animate());
    this.step(Math.min(this.clock.getDelta(), 0.05));
  }

  step(dt) {
    for (const a of this.agents.values()) this.#stepAgent(a, dt);
    this.controls.update();
    // hide walls the camera is behind, so you never look at the back of one
    const c = this.camera.position;
    if (this.backWall) this.backWall.visible = c.z > -ROOM_D / 2 + 1;
    if (this.leftWall) this.leftWall.visible = c.x > -ROOM_W / 2 + 1;
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  #inMeeting(x, z) { const M = MEETING; return x > M.x0 && x < M.x1 && z > M.z0 && z < M.z1; }
  #clear(x, z) { return this.obstacles.every(o => Math.hypot(o.x - x, o.z - z) > o.r); }

  #randomIdlePoint() {
    for (let i = 0; i < 60; i++) {
      const x = -ROOM_W / 2 + 1.5 + Math.random() * (ROOM_W - 3);
      const z = -ROOM_D / 2 + 2.5 + Math.random() * (ROOM_D - 4);
      if (this.#clear(x, z) && !this.#inMeeting(x, z)) return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(0, 0, 4);
  }

  #pickWanderTarget(a) {
    if (Math.random() < 0.45 && this.pois.length) {
      const p = this.pois[Math.floor(Math.random() * this.pois.length)];
      a.faceTo = p.face;
      return new THREE.Vector3(p.x + (Math.random() - 0.5) * 0.6, 0, p.z + (Math.random() - 0.5) * 0.6);
    }
    a.faceTo = null;
    return this.#randomIdlePoint();
  }

  // walk to target, going via the meeting-room doorway when crossing its glass
  #goto(a, target, dt, ud) {
    const g = a.group;
    const inside = this.#inMeeting(g.position.x, g.position.z), want = this.#inMeeting(target.x, target.z);
    if (inside !== want && !a.waypoint && !a.crossed) {
      // two legs: to the door on our side, then through to the other side
      a.waypoint = inside ? MEETING.doorIn.clone() : MEETING.doorOut.clone();
      a.waypoint2 = inside ? MEETING.doorOut.clone() : MEETING.doorIn.clone();
    }
    if (a.waypoint) {
      if (g.position.distanceTo(a.waypoint) < 0.35) { a.waypoint = a.waypoint2 || null; a.waypoint2 = null; if (!a.waypoint) a.crossed = true; }
      else { this.#walkTowards(g, a.waypoint, dt, ud, a.waypoint2 == null); return false; }
    }
    if (g.position.distanceTo(target) < 0.15) { a.crossed = false; return true; }
    this.#walkTowards(g, target, dt, ud, false, a);
    return false;
  }

  #stepAgent(a, dt) {
    a.t += dt;
    const ud = a.group.userData, g = a.group;
    if (a.state === 'working') {
      if (a.walkTarget !== a.seat) { a.walkTarget = a.seat; a.crossed = false; a.waypoint = null; a.waypoint2 = null; }
      if (!this.#goto(a, a.seat, dt, ud)) return;
      g.position.copy(a.seat);
      g.rotation.y = 0; ud.head.rotation.y *= 0.9;
      ud.body.position.y = 0.85 + Math.sin(a.t * 14) * 0.02;
      ud.arms[0].rotation.x = -1.0 + Math.sin(a.t * 16) * 0.25;
      ud.arms[1].rotation.x = -1.0 + Math.cos(a.t * 16) * 0.25;
      ud.legs.forEach(l => l.rotation.x = 0);
      return;
    }
    if (!a.walkTarget) {
      a.wait -= dt;
      ud.arms.forEach(x => x.rotation.x *= 0.9); ud.legs.forEach(x => x.rotation.x *= 0.9);
      ud.body.position.y = 0.85 + Math.sin(a.t * 2) * 0.02;
      ud.head.rotation.y = Math.sin(a.t * 0.7) * 0.35;
      this.#separate(a, dt);
      if (a.faceTo !== null) { let d = a.faceTo - g.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); g.rotation.y += d * Math.min(1, dt * 4); }
      if (a.wait <= 0) { a.walkTarget = this.#pickWanderTarget(a); a.crossed = false; a.waypoint = null; a.waypoint2 = null; }
      return;
    }
    if (this.#goto(a, a.walkTarget, dt, ud)) { a.walkTarget = null; a.wait = 2 + Math.random() * 6; }
  }

  #separate(a, dt) {
    // keep standing agents from overlapping each other
    const g = a.group;
    for (const b of this.agents.values()) {
      if (b === a || b.state === 'working') continue;
      const dx = g.position.x - b.group.position.x, dz = g.position.z - b.group.position.z, d = Math.hypot(dx, dz);
      if (d < 1.3 && d > 0.001) { g.position.x += dx / d * (1.3 - d) * dt * 2; g.position.z += dz / d * (1.3 - d) * dt * 2; }
    }
  }

  #walkTowards(g, target, dt, ud, ignoreObstacles, self) {
    const dir = target.clone().sub(g.position); dir.y = 0; const dist = dir.length(); dir.normalize();
    // steer round other agents
    for (const b of this.agents.values()) {
      if (b.group === g) continue;
      const dx = g.position.x - b.group.position.x, dz = g.position.z - b.group.position.z, d = Math.hypot(dx, dz);
      if (d < 1.6 && d > 0.001 && dist > 0.6) { const push = (1.6 - d) * 1.2; dir.x += dx / d * push; dir.z += dz / d * push; }
    }
    if (!ignoreObstacles) for (const o of this.obstacles) {
      if (Math.hypot(target.x - o.x, target.z - o.z) < o.r) continue;
      const dx = g.position.x - o.x, dz = g.position.z - o.z, d = Math.hypot(dx, dz);
      if (d < o.r + 0.5 && d > 0.001) { const push = (o.r + 0.5 - d) * 1.5; dir.x += dx / d * push; dir.z += dz / d * push; }
    }
    dir.normalize();
    g.position.addScaledVector(dir, Math.min(2.2 * dt, dist));
    g.position.x = THREE.MathUtils.clamp(g.position.x, -ROOM_W / 2 + 0.8, ROOM_W / 2 - 0.8);
    g.position.z = THREE.MathUtils.clamp(g.position.z, -ROOM_D / 2 + 0.8, ROOM_D / 2 - 0.8);
    const yaw = Math.atan2(dir.x, dir.z);
    let diff = yaw - g.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    g.rotation.y += diff * Math.min(1, dt * 8);
    ud.head.rotation.y *= 0.9;
    const w = performance.now() / 90;
    ud.legs[0].rotation.x = Math.sin(w) * 0.7; ud.legs[1].rotation.x = -Math.sin(w) * 0.7;
    ud.arms[0].rotation.x = -Math.sin(w) * 0.6; ud.arms[1].rotation.x = Math.sin(w) * 0.6;
    ud.body.position.y = 0.85 + Math.abs(Math.sin(w)) * 0.05;
  }
}
