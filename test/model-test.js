// Exercises src/model3d.js against the mock server (start `node test/mock-api.js` first).
// Checks both routes: photo goes up as a data URI, progress is reported, a real GLB comes back and is saved.
const fs = require('fs');
const os = require('os');
const path = require('path');
const model3d = require('../src/model3d');

const BASE = 'http://127.0.0.1:52900';
const PNG = fs.readFileSync(path.join(__dirname, '..', 'src', 'icon-512.png')).toString('base64');
let failed = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++; };

(async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'amo-model-'));
  const bases = { meshy: BASE + '/meshy', higgsfield: BASE + '/higgsfield' };
  await fetch(BASE + '/__reset');

  // Meshy route
  let prog = [];
  const m = await model3d.generate({ settings: { model3dProvider: 'meshy', meshyKey: 'k' }, image: { base64: PNG, mime: 'image/png' }, name: 'My Pump.jpg', outDir: out, bases, fast: true, onProgress: (p) => prog.push(p) });
  ok(m.provider === 'meshy' && fs.existsSync(m.path) && fs.readFileSync(m.path).toString('ascii', 0, 4) === 'glTF', 'meshy: GLB downloaded and saved');
  ok(path.basename(m.path).startsWith('My-Pump-') && m.path.endsWith('.glb'), 'meshy: file named from the photo');
  ok(prog.length >= 2 && prog.some(p => p.pct === 40), 'meshy: progress reported');
  let calls = await (await fetch(BASE + '/__calls')).json();
  ok(calls.some(c => c.dataUri === true && c.auth === 'Bearer k'), 'meshy: photo sent as data URI with bearer key');

  // Higgsfield route
  await fetch(BASE + '/__reset');
  const h = await model3d.generate({ settings: { model3dProvider: 'higgsfield', higgsfieldKeyId: 'id', higgsfieldSecret: 'sec', higgsfield3dModel: '/some/3d/path' }, image: { base64: PNG, mime: 'image/png' }, name: 'x.png', outDir: out, bases, fast: true });
  ok(h.provider === 'higgsfield' && fs.existsSync(h.path), 'higgsfield: GLB downloaded and saved');
  calls = await (await fetch(BASE + '/__calls')).json();
  ok(calls.some(c => c.dataUri === true && c.auth === 'Key id:sec' && c.url === '/higgsfield/some/3d/path'), 'higgsfield: posted to the configured path with Key id:secret');

  // sensible errors
  const bad = async (settings, re, label) => { try { await model3d.generate({ settings, image: { base64: PNG }, outDir: out, bases, fast: true }); ok(false, label); } catch (e) { ok(re.test(e.message), label + ' -> ' + e.message.slice(0, 70)); } };
  await bad({ model3dProvider: 'meshy' }, /Meshy API key/, 'meshy without key');
  await bad({ model3dProvider: 'higgsfield' }, /Higgsfield key/, 'higgsfield without keys');
  const d = await model3d.generate({ settings: { model3dProvider: 'higgsfield', higgsfieldKeyId: 'a', higgsfieldSecret: 'b' }, image: { base64: PNG }, outDir: out, bases, fast: true });
  const c2 = await (await fetch(BASE + '/__calls')).json();
  ok(fs.existsSync(d.path) && c2.some(c => c.url === '/higgsfield/meshy_v7_image_to_3d'), 'higgsfield with no endpoint set uses the built-in 3D model');
  try { await model3d.generate({ settings: { model3dProvider: 'meshy', meshyKey: 'k' }, image: null, outDir: out, bases }); ok(false, 'no photo'); } catch (e) { ok(/photo/i.test(e.message), 'no photo -> ' + e.message); }

  ok(model3d.findGlbUrl({ a: [{ b: { url: 'https://x.io/a/b.glb?sig=1' } }] }) === 'https://x.io/a/b.glb?sig=1', 'findGlbUrl digs through nesting');
  ok(model3d.findGlbUrl({ url: 'https://x.io/a.png' }) === null, 'findGlbUrl ignores non-GLB links');
  console.log(failed ? `${failed} FAILED` : 'all passed'); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
