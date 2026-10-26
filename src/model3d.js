// Photo -> 3D model (GLB) for the modeling room. Runs in the main process so the keys never reach the page.
// Two routes: Higgsfield (the key already used for images) and Meshy (its own documented image-to-3D API).
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MAX_WAIT_MS = 12 * 60 * 1000;

function dataUri(img) {
  const mime = /^image\/(png|jpe?g|webp)$/i.test(img.mime || '') ? img.mime : 'image/jpeg';
  return `data:${mime};base64,${img.base64}`;
}

// dig the first .glb url out of whatever shape a provider answers with
function findGlbUrl(obj, depth = 0) {
  if (!obj || depth > 8) return null;
  if (typeof obj === 'string') return /^https?:\/\/[^\s]+\.glb(\?|$)/i.test(obj) ? obj : null;
  if (Array.isArray(obj)) { for (const x of obj) { const u = findGlbUrl(x, depth + 1); if (u) return u; } return null; }
  if (typeof obj === 'object') {
    for (const k of ['glb', 'model_urls', 'model_url', 'model', 'mesh', 'url', 'output', 'result', 'results', 'outputs', 'data']) {
      if (k in obj) { const u = findGlbUrl(obj[k], depth + 1); if (u) return u; }
    }
    for (const v of Object.values(obj)) { const u = findGlbUrl(v, depth + 1); if (u) return u; }
  }
  return null;
}

async function jsonOrText(res) {
  const t = await res.text();
  try { return JSON.parse(t); } catch { return { raw: t.slice(0, 400) }; }
}

async function downloadGlb(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Downloading the model failed (${r.status}).`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 20 || buf.toString('ascii', 0, 4) !== 'glTF') throw new Error('The provider returned a file that is not a GLB model.');
  return buf;
}

// ---------- Meshy ----------
async function viaMeshy({ key, base, image, textured, onProgress }) {
  if (!key) throw new Error('No Meshy API key. Add it in the modeling room settings, or switch to Higgsfield.');
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${key}` };
  const res = await fetch(`${base}/openapi/v1/image-to-3d`, {
    method: 'POST', headers,
    body: JSON.stringify({ image_url: dataUri(image), should_texture: !!textured, enable_pbr: false, should_remesh: true })
  });
  const data = await jsonOrText(res);
  if (!res.ok || !data.result) throw new Error(`Meshy ${res.status}: ${data.message || JSON.stringify(data).slice(0, 300)}`);
  const id = data.result, started = Date.now();
  onProgress({ message: 'Meshy is building the model', pct: 8 });
  while (Date.now() - started < MAX_WAIT_MS) {
    await sleep(MOCK_FAST ? 50 : 4000);
    const sr = await fetch(`${base}/openapi/v1/image-to-3d/${id}`, { headers });
    const sd = await jsonOrText(sr);
    if (!sr.ok) throw new Error(`Meshy ${sr.status}: ${sd.message || JSON.stringify(sd).slice(0, 300)}`);
    const st = String(sd.status || '').toUpperCase();
    if (typeof sd.progress === 'number') onProgress({ message: 'Meshy is building the model', pct: Math.max(8, Math.min(95, sd.progress)) });
    if (st === 'SUCCEEDED') {
      const url = (sd.model_urls && sd.model_urls.glb) || findGlbUrl(sd);
      if (!url) throw new Error('Meshy finished but gave no GLB link: ' + JSON.stringify(sd).slice(0, 300));
      return downloadGlb(url);
    }
    if (st === 'FAILED' || st === 'CANCELED') throw new Error('Meshy could not make the model: ' + ((sd.task_error && sd.task_error.message) || st));
  }
  throw new Error('Meshy took too long (over 12 minutes).');
}

// ---------- Higgsfield ----------
// Higgsfield's public API docs only list image and video models, so the 3D endpoint is a setting. The request and polling
// follow the same pattern as the image calls (POST https://api.higgsfield.ai/<model>, then poll the status url).
async function viaHiggsfield({ keyId, secret, model, base, image, textured, onProgress }) {
  keyId = String(keyId || '').trim(); secret = String(secret || '').trim();
  if (!keyId && !secret) throw new Error('No Higgsfield key. Add it in Settings.');
  model = String(model || '').trim().replace(/^\/+/, '');
  if (!model) model = DEFAULT_HF_3D;
  // Higgsfield shows one combined key (id:secret); two boxes also work
  const auth = keyId && secret ? `Key ${keyId}:${secret}` : `Key ${keyId || secret}`;
  const res = await fetch(`${base}/${model}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: auth },
    body: JSON.stringify({ image_url: dataUri(image), should_texture: !!textured })
  });
  const data = await jsonOrText(res);
  if (!res.ok) throw new Error(`Higgsfield ${res.status}: ${JSON.stringify(data).slice(0, 400)}`);
  const direct = findGlbUrl(data);
  if (direct && /complete|succe/i.test(String(data.status || 'completed'))) return downloadGlb(direct);
  const statusUrl = data.status_url || (data.request_id ? `${base}/requests/${data.request_id}/status` : null);
  if (!statusUrl) throw new Error('Higgsfield did not return a job to follow: ' + JSON.stringify(data).slice(0, 300));
  const started = Date.now();
  onProgress({ message: 'Higgsfield is building the model', pct: 8 });
  while (Date.now() - started < MAX_WAIT_MS) {
    await sleep(MOCK_FAST ? 50 : 4000);
    const sr = await fetch(statusUrl, { headers: { authorization: auth, accept: 'application/json' } });
    const sd = await jsonOrText(sr);
    const st = String(sd.status || '').toLowerCase();
    if (st === 'completed' || st === 'succeeded' || st === 'success') {
      const url = findGlbUrl(sd);
      if (!url) throw new Error('Higgsfield finished but no GLB link was found: ' + JSON.stringify(sd).slice(0, 400));
      return downloadGlb(url);
    }
    if (['failed', 'cancelled', 'canceled', 'error', 'nsfw'].includes(st)) throw new Error('Higgsfield job ' + st + ': ' + JSON.stringify(sd).slice(0, 400));
    onProgress({ message: 'Higgsfield is building the model', pct: Math.min(90, 8 + Math.round((Date.now() - started) / 4000)) });
  }
  throw new Error('Higgsfield took too long (over 12 minutes).');
}

let MOCK_FAST = false;
// Higgsfield's own image-to-3D model, used automatically so nobody has to pick one. Can be overridden in the modeling room settings.
const DEFAULT_HF_3D = 'meshy_v7_image_to_3d';

async function generate({ settings, image, textured = true, outDir, name, bases, onProgress = () => {}, fast = false }) {
  MOCK_FAST = !!fast;
  if (!image || !image.base64) throw new Error('Drop a photo first.');
  const provider = settings.model3dProvider === 'meshy' ? 'meshy' : 'higgsfield';
  const buf = provider === 'meshy'
    ? await viaMeshy({ key: settings.meshyKey, base: bases.meshy, image, textured, onProgress })
    : await viaHiggsfield({ keyId: settings.higgsfieldKeyId, secret: settings.higgsfieldSecret, model: settings.higgsfield3dModel, base: bases.higgsfield, image, textured, onProgress });
  onProgress({ message: 'Saving the model', pct: 97 });
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const safe = String(name || 'model').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-').slice(0, 40) || 'model';
  const file = path.join(outDir, `${safe}-${stamp}.glb`);
  fs.writeFileSync(file, buf);
  return { path: file, base64: buf.toString('base64'), provider, bytes: buf.length };
}

module.exports = { generate, findGlbUrl };
