// The modeling room's panel: drop a photo, get a 3D model, turn it around, save it. The model also appears on the scan pedestal.
import * as THREE from 'three';
import { mountHistory } from './history.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const IMG_OK = /\.(jpe?g|png|webp|bmp|gif)$/i;
const MAX_SIDE = 2048;

function b64ToArrayBuffer(b64) {
  const bin = atob(b64), n = bin.length, out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
const parseGlb = (b64) => new Promise((resolve, reject) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(b64ToArrayBuffer(b64), '', resolve, reject));

// a PDF goes to Claude as it is (it reads the pages itself)
async function prepPdf(file) {
  if (file.size > 24 * 1048576) throw new Error('That PDF is too big (over 24 MB). Export just the sheet you need.');
  const buf = new Uint8Array(await file.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  const c = document.createElement('canvas'); c.width = 240; c.height = 160; const x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, 240, 160); x.fillStyle = '#c0392b'; x.font = '700 40px Arial'; x.textAlign = 'center'; x.fillText('PDF', 120, 90);
  return { base64: btoa(bin), mime: 'application/pdf', name: file.name, w: 0, h: 0, preview: c.toDataURL() };
}
// photo -> JPEG on a white background, no bigger than MAX_SIDE (keeps the upload small, flattens transparent cut-outs)
async function prepPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that image. Use a JPG, PNG or WebP photo.')); i.src = url; });
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h);
    const base64 = c.toDataURL('image/jpeg', 0.92).split(',')[1];
    return { base64, mime: 'image/jpeg', name: file.name, w, h, preview: url };
  } catch (e) { URL.revokeObjectURL(url); throw e; }
}


// Claude's list of shapes -> a THREE group -> GLB (base64)
function buildFromParts(parts) {
  const g = new THREE.Group(), n = (v, d) => (Number.isFinite(+v) ? +v : d), D = Math.PI / 180;
  for (const p of parts.slice(0, 200)) {
    const sz = Array.isArray(p.size) ? p.size.map(x => Math.max(0.001, n(x, 0.1))) : [0.2];
    let geo;
    switch (String(p.shape).toLowerCase()) {
      case 'box': geo = new THREE.BoxGeometry(sz[0], sz[1] ?? sz[0], sz[2] ?? sz[0]); break;
      case 'cylinder': geo = new THREE.CylinderGeometry(sz[0], sz[1] ?? sz[0], sz[2] ?? 0.5, 28); break;
      case 'sphere': geo = new THREE.SphereGeometry(sz[0], 28, 20); break;
      case 'cone': geo = new THREE.ConeGeometry(sz[0], sz[1] ?? 0.5, 28); break;
      case 'torus': geo = new THREE.TorusGeometry(sz[0], sz[1] ?? sz[0] * 0.3, 14, 36); break;
      case 'capsule': geo = new THREE.CapsuleGeometry(sz[0], sz[1] ?? 0.5, 8, 18); break;
      default: continue;
    }
    let col; try { col = new THREE.Color(p.color || '#999999'); } catch { col = new THREE.Color(0x999999); }
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col, metalness: Math.min(1, Math.max(0, n(p.metal, 0.1))), roughness: Math.min(1, Math.max(0, n(p.rough, 0.6))) }));
    const pos = p.pos || [0, 0, 0], rot = p.rot || [0, 0, 0];
    m.position.set(n(pos[0], 0), n(pos[1], 0), n(pos[2], 0)); m.rotation.set(n(rot[0], 0) * D, n(rot[1], 0) * D, n(rot[2], 0) * D);
    m.castShadow = true; g.add(m);
  }
  return g;
}
async function exportGlb(obj) {
  const buf = await new GLTFExporter().parseAsync(obj, { binary: true });
  const u8 = new Uint8Array(buf); let bin = ''; for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function initModelingUI({ office, api, getSettings, openSettings }) {
  let photo = null, textured = true, running = false, last = null, kind = 'photo';
  const panel = $('#modelPanel');

  // ---- the turntable viewer inside the panel (made on first use) ----
  let viewer = null;
  function ensureViewer() {
    if (viewer) return viewer;
    const canvas = $('#modelCanvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.add(new THREE.HemisphereLight(0xe8eeff, 0x202633, 0.8));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(3, 5, 4); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 2.2; controls.enablePan = false;
    viewer = { renderer, scene, camera, controls, model: null, raf: 0 };
    const loop = () => {
      viewer.raf = requestAnimationFrame(loop);
      if (!panel.classList.contains('open') || $('#modelResult').hidden) return;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
      controls.update(); renderer.render(scene, camera);
    };
    loop();
    return viewer;
  }
  async function showInViewer(b64) {
    const v = ensureViewer(), gltf = await parseGlb(b64);
    if (v.model) { v.scene.remove(v.model); v.model.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    const obj = gltf.scene, box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
    obj.position.sub(ctr); const wrap = new THREE.Group(); wrap.add(obj); v.scene.add(wrap); v.model = wrap;
    const r = Math.max(size.x, size.y, size.z, 1e-6);
    v.camera.near = r / 100; v.camera.far = r * 100; v.camera.updateProjectionMatrix();
    v.camera.position.set(r * 1.3, r * 0.8, r * 1.9); v.controls.target.set(0, 0, 0); v.controls.update();
    // triangle count for the info line
    let tris = 0; obj.traverse(o => { if (o.isMesh && o.geometry) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    return { tris: Math.round(tris) };
  }
  async function putOnPedestal(b64) { try { office.showModel((await parseGlb(b64)).scene); } catch (e) { console.warn('pedestal model failed', e); } }

  // ---- photo drop ----
  function renderPhoto() {
    $('#photoPrev').innerHTML = photo ? `<img class="photo" src="${photo.preview}" alt="" /><div class="fchip"><span>${esc(photo.name)} <small>${photo.mime === 'application/pdf' ? 'PDF' : photo.w + '×' + photo.h}</small></span><button data-rm title="Remove">×</button></div>` : '';
    $('#dropPhoto').classList.toggle('has', !!photo);
    $('#dropPhoto .dz-t').textContent = photo ? 'Drop a different file to swap it' : (COPY[kind] || COPY.photo)[1];
    $('#modelGo').disabled = running || !photo; $('#modelClaude').disabled = running || !canClaude();
  }
  const canClaude = () => kind === 'text' ? !!$('#modelText').value.trim() : !!photo;
  const COPY = { photo: ['1 · Photo of anything', 'Drop a photo here', 'JPG, PNG or WebP · one object, clear and well lit works best · or click to browse', 'Build it with Claude only (no extra key)'],
    schematic: ['Schematic or drawing', 'Drop the schematic here', 'PNG, JPG or PDF · plans, elevations, GA or panel drawings, as many views as are on the sheet · or click to browse', 'Build it to scale with Claude'],
    text: ['', '', '', 'Build it with Claude'] };
  function setKind(k) {
    kind = k; document.querySelectorAll('#modelKind button').forEach(x => x.classList.toggle('on', x.dataset.kind === k));
    const c = COPY[k];
    $('#blkText').hidden = k !== 'text'; $('#lblText').textContent = 'Describe it'; $('#lblPhoto').hidden = $('#dropPhoto').hidden = k === 'text';
    if (k !== 'text') { $('#lblPhoto').textContent = c[0]; $('#dropPhoto .dz-t').textContent = photo ? 'Drop a different file to swap it' : c[1]; $('#dropPhoto .dz-s').textContent = c[2]; }
    document.querySelectorAll('#modelPanel .photoOnly').forEach(el => { el.hidden = k !== 'photo'; });
    $('#modelClaude').textContent = c[3]; $('#modelClaude').classList.toggle('primary', k !== 'photo');
    $('#m_research').checked = k !== 'schematic';
    $('#modelText').placeholder = 'e.g. a Raspberry Pi 4 Model B, or a red steel toolbox with a lift-up lid and two latches, 500 mm wide';
    $('#dropPhoto input[type=file]').accept = k === 'schematic' ? 'image/*,application/pdf,.pdf' : 'image/*';
    $('#modelErr').textContent = ''; renderPhoto();
  }
  document.querySelectorAll('#modelKind button').forEach(b => b.addEventListener('click', () => setKind(b.dataset.kind)));
  $('#modelText').addEventListener('input', renderPhoto);
  async function addPhoto(files) {
    const f = [...files].find(x => x.type.startsWith('image/') || IMG_OK.test(x.name) || (kind === 'schematic' && (x.type === 'application/pdf' || /\.pdf$/i.test(x.name))));
    if (!f) { if (files.length) $('#modelErr').textContent = 'That is not a photo. Use a JPG, PNG or WebP image.'; return; }
    $('#modelErr').textContent = '';
    try { if (photo) URL.revokeObjectURL(photo.preview); photo = (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) ? await prepPdf(f) : await prepPhoto(f); } catch (e) { $('#modelErr').textContent = e.message; return; }
    renderPhoto();
  }
  const dz = $('#dropPhoto'), input = dz.querySelector('input[type=file]');
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', (e) => { e.preventDefault(); addPhoto(e.dataTransfer.files); });
  dz.addEventListener('click', (e) => { if (e.target.closest('button')) { if (photo) URL.revokeObjectURL(photo.preview); photo = null; renderPhoto(); return; } input.click(); });
  input.addEventListener('change', () => { addPhoto(input.files); input.value = ''; });
  // a photo dropped anywhere else must never navigate the window away (checkui.js does the same; harmless twice)
  ['dragover', 'drop'].forEach(ev => window.addEventListener(ev, (e) => e.preventDefault()));

  document.querySelectorAll('#modelMode button').forEach(b => b.addEventListener('click', () => {
    textured = b.dataset.tex === '1';
    document.querySelectorAll('#modelMode button').forEach(x => x.classList.toggle('on', x === b));
  }));

  // ---- 3D settings (saved straight into the shared settings object so the main Settings screen never overwrites them) ----
  function fillCfg() {
    const sv = getSettings().higgsfield3dModel || '';
    $('#m_hfModel').value = sv.includes(':') ? '' : sv;
    $('#m_claudeModel').value = getSettings().claude3dModel || '';
    const mk = !!getSettings().meshyKey; $('#m_meshyKey').value = getSettings().meshyKey || '';
    $('#modelVia').textContent = mk ? 'Your photo is sent to Meshy with your Meshy key to make the model. Use photos you are happy to share.' : 'Your photo is sent to Higgsfield through the key in Settings to make the model. Higgsfield\'s API may not include 3D: if you get "model_not_found", add a Meshy key under Advanced.';
  }
  $('#m_save').addEventListener('click', async () => {
    const v = $('#m_hfModel').value.trim();
    if (v.includes(':')) { $('#m_hfModel').value = ''; $('#m_saved').textContent = 'That is your API key. Keys go in Settings, leave this empty.'; setTimeout(() => { $('#m_saved').textContent = ''; }, 4000); await api.settings.set({ higgsfield3dModel: '' }); getSettings().higgsfield3dModel = ''; return; }
    const s = getSettings(); const mk = $('#m_meshyKey').value.trim(); s.meshyKey = mk; s.model3dProvider = mk ? 'meshy' : 'higgsfield'; s.higgsfield3dModel = v;
    await api.settings.set({ model3dProvider: s.model3dProvider, meshyKey: mk, higgsfield3dModel: v }); fillCfg();
    $('#m_saved').textContent = 'Saved'; setTimeout(() => { $('#m_saved').textContent = ''; }, 1800);
  });

  // ---- run ----
  api.model.onProgress((p) => {
    if (!running) return;
    $('#modelMsg').textContent = p.message || 'Working';
    if (p.pct) $('#modelBar').style.width = Math.min(100, p.pct) + '%';
  });
  const showSetup = () => { $('#modelSetup').hidden = false; $('#modelRun').hidden = true; $('#modelResult').hidden = true; };

  async function showResult(r, label) {
    last = r; $('#modelSetup').hidden = true; $('#modelRun').hidden = true; $('#modelResult').hidden = false;
    const { tris } = await showInViewer(r.base64);
    await putOnPedestal(r.base64);
    const kb = r.bytes > 1048576 ? (r.bytes / 1048576).toFixed(1) + ' MB' : Math.round(r.bytes / 1024) + ' KB';
    $('#modelInfo').textContent = `${label} · ${tris.toLocaleString('en-GB')} triangles · ${kb}. Drag to turn it. It is also on the scan pedestal in the room.`;
  }

  async function go() {
    if (running || !photo) return;
    const s = getSettings();
    if (s.model3dProvider !== 'meshy' && !(s.higgsfieldKeyId || s.higgsfieldSecret)) { $('#modelErr').textContent = 'Connect Higgsfield first: paste your Higgsfield API key in Settings.'; openSettings(); return; }
    running = true; renderPhoto(); last = null; $('#modelErr').textContent = '';
    $('#modelSetup').hidden = true; $('#modelResult').hidden = true; $('#modelRun').hidden = false;
    $('#modelMsg').textContent = 'Sending the photo'; $('#modelBar').style.width = '4%';
    office.setScanning(true);
    try {
      const r = await api.model.generate({ image: { base64: photo.base64, mime: photo.mime }, textured, name: photo.name });
      try { await showResult(r, r.provider === 'meshy' ? 'Made with Meshy' : 'Made with Higgsfield'); }
      catch (ve) { showSetup(); $('#modelErr').textContent = `The model was made and saved to ${r.path}, but the viewer could not open it (${String(ve.message || ve).slice(0, 160)}). You can still open that file in other 3D software.`; }
    } catch (e) {
      showSetup(); $('#modelErr').textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    } finally { running = false; office.setScanning(false); renderPhoto(); }
  }
  $('#modelGo').addEventListener('click', go);
  $('#m_claudeModel').addEventListener('change', async () => { const v = $('#m_claudeModel').value; getSettings().claude3dModel = v; await api.settings.set({ claude3dModel: v }); });
  async function goClaude() {
    if (running || !canClaude()) return;
    const s = getSettings();
    if (!s.anthropicKey) { $('#modelErr').textContent = 'Add your Claude API key in Settings first.'; openSettings(); return; }
    running = true; renderPhoto(); last = null; $('#modelErr').textContent = '';
    $('#modelSetup').hidden = true; $('#modelResult').hidden = true; $('#modelRun').hidden = false;
    $('#modelMsg').textContent = kind === 'text' ? 'Claude is reading your description' : kind === 'schematic' ? 'Claude is reading the drawing' : 'Claude is studying the photo'; $('#modelBar').style.width = '15%';
    office.setScanning(true);
    try {
      const j = await api.model.claude({ kind, text: $('#modelText').value, image: kind === 'text' || !photo ? null : { base64: photo.base64, mime: photo.mime }, research: $('#m_research').checked, model: $('#m_claudeModel').value });
      $('#modelMsg').textContent = 'Building the model'; $('#modelBar').style.width = '70%';
      const obj = buildFromParts(j.parts);
      if (!obj.children.length) throw new Error('Claude gave shapes I could not build. Try again.');
      const r = await api.model.saveGlb({ base64: await exportGlb(obj), name: j.name || (photo && photo.name) || 'model' });
      try { const rs = j.research, dm = rs && rs.dims && rs.dims.length ? ` · real size ${rs.dims.length}×${rs.dims.width}×${rs.dims.height} mm` : '';
        await showResult(r, `${rs && rs.what ? rs.what : 'Built by Claude'} · ${obj.children.length} shapes${dm} · ${j.researchNote || (kind === 'text' ? 'built from your description' : kind === 'schematic' ? 'built to scale from the drawing' : 'built from the photo')}`); }
      catch (ve) { showSetup(); $('#modelErr').textContent = `Saved to ${r.path} but the viewer could not open it (${String(ve.message || ve).slice(0, 160)}).`; }
    } catch (e) {
      showSetup(); $('#modelErr').textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    } finally { running = false; office.setScanning(false); renderPhoto(); }
  }
  $('#modelClaude').addEventListener('click', goClaude);


  $('#modelOpen').addEventListener('click', async () => {
    try { const r = await api.model.open(); if (r) await showResult(r, r.path.split(/[\\/]/).pop()); }
    catch (e) { $('#modelErr').textContent = String(e.message || e); }
  });
  $('#modelSave').addEventListener('click', async (e) => { if (!last) return; const p = await api.model.saveAs({ from: last.path, name: last.path.split(/[\\/]/).pop() }); if (p) e.target.textContent = 'Saved'; setTimeout(() => { e.target.textContent = 'Save a copy'; }, 1800); });
  $('#modelShow').addEventListener('click', () => { if (last) api.showItem(last.path); });
  $('#modelAgain').addEventListener('click', () => { showSetup(); renderPhoto(); hist.refresh(); });

  const hist = mountHistory($('#modelHist'), {
    heading: 'Previous models',
    load: async () => (await api.model.list()).map(m => ({ key: m.name, at: m.at, title: m.name.replace(/\.glb$/i, ''), summary: Math.max(1, Math.round(m.bytes / 1024)) + ' KB' })),
    open: async (name) => { try { const r = await api.model.load({ file: name }); await showResult(r, name.replace(/\.glb$/i, '')); } catch (e) { $('#modelErr').textContent = String(e.message || e); } }
  });
  fillCfg(); renderPhoto();
  return {
    show() { fillCfg(); hist.refresh(); panel.classList.add('open'); },
    hide() { panel.classList.remove('open'); },
    get running() { return running; },
    get _viewer() { return viewer; },
    // test hook: feed a GLB straight in without calling a provider
    async _showGlb(b64, bytes = 0) { await showResult({ base64: b64, path: 'test.glb', bytes, provider: 'test' }, 'Test model'); }
  };
}
