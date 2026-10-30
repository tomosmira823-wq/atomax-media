// Atomax Media Office - Electron main process
// All API keys live here (encrypted on disk) and every outside call is made from here,
// so the 3D page never sees a key.

const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, protocol, net, Notification, desktopCapturer, screen, globalShortcut } = require('electron');
const { pathToFileURL } = require('url');
const { autoUpdater } = require('electron-updater');
const social = require('./social');
const checker = require('./checker');
const markup = require('./markup');
const dxffix = require('./dxffix');
const bizmain = require('./bizmain');
const model3d = require('./model3d');
const usage = require('./usage');
const library = require('./library');
const roomsmain = require('./roomsmain');
const { STANDARD_SKILL } = checker;
const path = require('path');
const fs = require('fs');

const MOCK = process.env.AMO_MOCK === '1' ? 'http://127.0.0.1:52900' : null;
const ANTHROPIC = MOCK ? MOCK + '/anthropic' : 'https://api.anthropic.com';
const OPENAI = MOCK ? MOCK + '/openai' : 'https://api.openai.com';
const GOOGLE = MOCK ? MOCK + '/google' : 'https://generativelanguage.googleapis.com';
const USER_DIR = () => process.env.AMO_USERDATA || app.getPath('userData');
const SETTINGS_FILE = () => path.join(USER_DIR(), 'settings.json');
const AGENTS_FILE = () => path.join(USER_DIR(), 'agents.json');
const POSTS_FILE = () => path.join(USER_DIR(), 'posts.json');

// ---------- defaults ----------
const DEFAULT_SETTINGS = {
  anthropicKey: '',
  openaiKey: '',
  googleKey: '',
  googleImageModel: 'gemini-nano-banana-2.1',
  higgsfieldKeyId: '',
  higgsfieldSecret: '',
  claudeModel: 'claude-sonnet-5-5',
  claude3dModel: '',
  openaiImageModel: 'gpt-image-2',
  openaiImageModels: [],
  openaiImageQuality: 'high',
  higgsfieldModel: 'higgsfield-ai/soul/standard',
  imageProvider: 'openai',
  model3dProvider: 'higgsfield',
  higgsfield3dModel: '',
  meshyKey: '',
  caps: { claude: 60, openai: 30, google: 30, higgsfield: 50 },   // monthly spend caps in £ (estimates, see usage.js)
  social: { linkedin: {}, facebook: {}, x: {} },
  company: {
    name: 'Atomax-UK Ltd',
    about: 'Atomax-UK Ltd is an electrical engineering company in the North West of England. We do electrical CAD, instrumentation drawings, loop diagrams, cable schedules, panel design, document control and site work for industrial clients, including National Grid and process plants.',
    audience: 'Industrial clients, engineering managers, project managers, electrical and instrumentation engineers, recruiters and local businesses.',
    doNot: 'Never invent client names, project values, dates or certifications. Never share anything confidential. No politics.',
    website: 'https://www.atomax.co.uk'
  }
};

const DEFAULT_AGENTS = [
  {
    id: 'linkedin', platform: 'LinkedIn', name: 'Lena', colour: '#0a66c2', enabled: true,
    tone: 'Professional and formal. Clear, confident, no slang, no emojis unless one fits. Written for engineering managers and clients. Lead with the value or the lesson, finish with a soft call to action.',
    rules: 'Max 1300 characters. Short paragraphs with blank lines between. 3 to 5 hashtags at the end. British spelling.'
  },
  {
    id: 'instagram', platform: 'Instagram', name: 'Izzy', colour: '#e1306c', enabled: true,
    tone: 'Friendly, upbeat and casual. Behind-the-scenes feel, like a mate showing you round the workshop. Emojis welcome but not overdone.',
    rules: 'Strong first line that works as a hook before the "more" cut. 1 to 3 short paragraphs. 8 to 15 hashtags on their own lines at the end. British spelling.'
  },
  {
    id: 'facebook', platform: 'Facebook', name: 'Frank', colour: '#1877f2', enabled: true,
    tone: 'Warm and plain-spoken. Community feel, local business voice. A couple of emojis is fine.',
    rules: 'Under 600 characters. Ask a question or invite a comment at the end. 1 to 3 hashtags max. British spelling.'
  },
  {
    id: 'checker', role: 'reviewer', platform: 'Checker', name: 'Charlie', colour: '#f59f00', enabled: true,
    tone: 'Picky but fair. A senior marketing lead reviewing a junior\'s work: honest about weak posts, quick to say when one is good. Thinks about whether a real person would stop scrolling for it.',
    rules: 'Check: British spelling and grammar; the platform rules for that agent (length, hashtag count); nothing invented (client names, figures, dates, certifications); nothing confidential; tone matches the platform; the post actually answers the brief; the hook is strong; there is a clear point or call to action. Score 1-10. Below 6 is a fail.'
  },
  {
    id: 'cal', role: 'drawing', platform: 'Drawing Checker', name: 'Cal', colour: '#ffd43b', enabled: true, gear: ['glasses', 'clipboard', 'lanyard'],
    tone: 'Careful, plain-spoken and honest about what he could not read. Never guesses. Keeps findings short: drawing number, then what needs fixing.',
    rules: STANDARD_SKILL
  },
  {
    id: 'dex', role: 'drafter', platform: 'DXF Maker', name: 'Dex', colour: '#4dabf7', enabled: true, gear: ['glasses', 'lanyard'],
    tone: 'Quiet, exact and careful. Changes only what he is told to change, says what he did, and leaves the originals alone.',
    rules: 'Fix only the text changes ticked by the person. Never touch geometry. Never overwrite the original DXF.'
  },
  {
    id: 'milo', role: 'modeller', platform: '3D Modeller', name: 'Milo', colour: '#38d9a9', enabled: true, gear: ['glasses', 'lanyard'],
    tone: 'Calm, methodical and practical. Asks a short question when something matters, states his assumptions when it does not, and never touches the original model.',
    rules: 'Work on a copy of the model. Use the sizes given in the context. Keep new parts clear of existing parts unless told to connect. Name every new part.'
  },
  {
    id: 'theo', role: 'builder', platform: '3D Builder', name: 'Theo', colour: '#da77f2', enabled: true, gear: ['hardhat', 'lanyard'],
    tone: 'Practical and thorough. Builds what the prompt and the context say, in real sizes, asks a short question when something important is missing and says what he assumed.',
    rules: 'Build from scratch in metres with Y up and the floor at y = 0. Use sizes from the context. Name every part. Keep it simple and accurate rather than fancy.'
  },
  {
    id: 'documents', role: 'documents', platform: 'Documents', name: 'Dot', colour: '#b197fc', enabled: true, gear: ['lanyard', 'clipboard'],
    tone: 'Tidy and exact. Drafts Atomax-format documents and issue packs and queues them for approval; never issues anything on her own.',
    rules: 'Follow the Atomax document format. Everything goes through Approvals before it is issued.'
  },
  {
    id: 'vera', role: 'modelchecker', platform: '3D Model Checker', name: 'Vera', colour: '#ff8787', enabled: true, gear: ['glasses', 'clipboard'],
    tone: 'Picky but fair. Checks the result against the request and the context, says what is good, and is honest about what she could not tell.',
    rules: 'Check it does what was asked, sizes match the context, nothing clashes or floats, nothing extra was changed. Below 6 out of 10 goes back to Milo.'
  },
  {
    id: 'excel', role: 'excel', platform: 'Excel', name: 'Lex', colour: '#21a366', enabled: true, gear: ['glasses', 'lanyard'],
    tone: 'Tidy and exact. Copies data exactly, uses formulas for totals, never invents values.',
    rules: 'Headers wrapped, columns wide enough for their text, no frozen panes. Never overwrite an existing workbook.'
  },
  {
    id: 'word', role: 'word', platform: 'Word', name: 'Wren', colour: '#2b7cd3', enabled: true, gear: ['lanyard', 'clipboard'],
    tone: 'Clear, plain British English. Uses the Atomax document format.',
    rules: 'Atomax house format: numbered headings, approval and revision tables, TBC for anything not given.'
  },
  {
    id: 'engineer', role: 'engineer', platform: 'Engineer', name: 'Ada', colour: '#63e6be', enabled: true, gear: ['glasses', 'hardhat'],
    tone: 'Careful and plain. Shows her working, says where every number came from, and is honest about what a hand calculation cannot replace.',
    rules: 'Use only the email, attachments and project files. Never invent data. Say what needs PowerFactory / ETAP or more data.'
  },
  {
    id: 'email', role: 'email', platform: 'Email Checker', name: 'Eli', colour: '#ffa94d', enabled: true, gear: ['headset', 'lanyard'],
    tone: 'Calm and exact. Reads every line of an email, copies names and numbers exactly, never invents work.',
    rules: 'Split the email into separate asks. Give each to the agent who can do it, or to Tom. Keep site names, job numbers and dates exactly as written.'
  },
  {
    id: 'x', platform: 'X / Twitter', name: 'Xander', colour: '#111111', enabled: false,
    tone: 'Punchy and direct. One idea per post. Dry humour is fine.',
    rules: 'Max 280 characters including hashtags. 1 or 2 hashtags max. No thread unless the brief asks for one.'
  },
  {
    id: 'tiktok', platform: 'TikTok', name: 'Tia', colour: '#00f2ea', enabled: false,
    tone: 'Energetic, young, curious. Talks like a video voice-over script plus a short caption.',
    rules: 'Give a 20 to 40 second voice-over script in short lines, then a caption under 150 characters with 3 to 5 hashtags.'
  }
];

// ---------- storage helpers ----------
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

const SECRET_FIELDS = ['anthropicKey', 'openaiKey', 'googleKey', 'higgsfieldKeyId', 'higgsfieldSecret', 'meshyKey'];
function encrypt(str) {
  if (!str) return '';
  if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(str).toString('base64');
  return 'raw:' + str;
}
function decrypt(str) {
  if (!str) return '';
  if (str.startsWith('enc:')) {
    try { return safeStorage.decryptString(Buffer.from(str.slice(4), 'base64')); } catch { return ''; }
  }
  if (str.startsWith('raw:')) return str.slice(4);
  return str;
}
usage.init(USER_DIR());
library.init(USER_DIR(), DEFAULT_AGENTS, STANDARD_SKILL);
function loadSettings() {
  const raw = readJson(SETTINGS_FILE(), {});
  const s = { ...DEFAULT_SETTINGS, ...raw, company: { ...DEFAULT_SETTINGS.company, ...(raw.company || {}) } };
  for (const f of SECRET_FIELDS) s[f] = decrypt(s[f]);
  let soc = {}; try { soc = typeof raw.social === 'string' ? JSON.parse(decrypt(raw.social) || '{}') : (raw.social || {}); } catch { soc = {}; }
  s.social = { linkedin: {}, facebook: {}, x: {}, ...soc };
  return s;
}
function saveSettings(s) {
  const out = { ...s };
  for (const f of SECRET_FIELDS) out[f] = encrypt(s[f] || '');
  out.social = encrypt(JSON.stringify(s.social || {}));
  writeJson(SETTINGS_FILE(), out);
}
// renderer never sees tokens: strip them before sending settings over
function publicSettings(s) {
  const strip = (c = {}) => { const { token, refresh, userToken, ...rest } = c; return { ...rest, connected: !!(token || userToken), pages: (c.pages || []).map(p => ({ id: p.id, name: p.name, igName: p.igName })) }; };
  return { ...s, social: { linkedin: strip(s.social.linkedin), facebook: strip(s.social.facebook), x: strip(s.social.x) } };
}
function mergeSocial(current, incoming = {}) {
  // UI sends ids/secrets/targets; keep tokens and page tokens from what's stored
  const out = {};
  for (const k of ['linkedin', 'facebook', 'x']) {
    const cur = current[k] || {}, inc = incoming[k] || {};
    out[k] = { ...cur, ...inc, token: cur.token, refresh: cur.refresh, userToken: cur.userToken, pages: cur.pages, orgs: cur.orgs, expires: cur.expires, memberUrn: cur.memberUrn, name: cur.name };
    if (inc.pageId) out[k].pageId = inc.pageId; if (inc.target) out[k].target = inc.target;
  }
  return out;
}

// Serve the app over app:// so fetch() works for the 3D models (Chromium blocks fetch on file://)
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const APP_ROOT = path.join(__dirname, '..');
function registerAppProtocol() {
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    let rel = decodeURIComponent(u.pathname);
    const file = path.normalize(path.join(APP_ROOT, rel));
    if (!file.startsWith(APP_ROOT)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

// ---------- window ----------
let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 1100, minHeight: 700,
    backgroundColor: '#0b0d12',
    title: 'Atomax Media Office',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadURL('app://app/src/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  // dev helper: AMO_SCREENSHOT=/path/out.png takes a screenshot a few seconds after load and quits
  if (process.env.AMO_SCREENSHOT) {
    win.webContents.on('console-message', (_e, level, msg, line, src) => console.error('[page]', level, msg, src + ':' + line));
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (['run', 'drawing', 'dex', 'model', 'fp', 'biz', 'mo', 'pc', 'theo', 'layout', 'rooms', 'email', 'msg', 'o365', 'dexkind', 'desk'].includes(process.env.AMO_SCENARIO)) {
        const script = fs.readFileSync(path.join(__dirname, '..', 'test', ({ drawing: 'scenario-drawing.js', dex: 'scenario-dex.js', model: 'scenario-model.js', fp: 'scenario-fp.js', biz: 'scenario-biz.js', mo: 'scenario-mo.js', pc: 'scenario-pc.js', theo: 'scenario-theo.js', layout: 'scenario-layout.js', rooms: 'scenario-rooms.js', email: 'scenario-email.js', msg: 'scenario-msg.js', o365: 'scenario-o365.js', dexkind: 'scenario-dexkind.js', desk: 'scenario-desk.js' }[process.env.AMO_SCENARIO] || 'scenario-run.js')), 'utf8').replace(/__AMO_DIR__/g, (process.env.AMO_PICK_DIR || '').replace(/\\/g, '/'));
        await win.webContents.executeJavaScript(`window.__variant = ${JSON.stringify(process.env.AMO_VARIANT || '')}`);
        const out = await win.webContents.executeJavaScript(script);
        console.error('[scenario]', JSON.stringify(out));
      }
      else if (process.env.AMO_VIEW && process.env.AMO_VIEW.startsWith('go:')) { await win.webContents.executeJavaScript('new Promise(r => setTimeout(() => { window.__goRoom(' + JSON.stringify(process.env.AMO_VIEW.slice(3)) + '); r(); }, 1200))'); await new Promise(r => setTimeout(r, 14000)); }
      else if (process.env.AMO_VIEW === 'steptime') { const out = await win.webContents.executeJavaScript(`(async()=>{ const o = window.__office; await new Promise(r => setTimeout(r, 1500)); o.renderer.render = () => {}; const times = []; const N = ${process.env.AMO_STEPS || 40}; let worst = 0, worstAt = -1; for (let i = 0; i < N; i++) { if (i === 20 && ${process.env.AMO_SIT ? 'true' : 'false'}) for (const id of o.agents.keys()) o.setState(id, 'working', 'w'); const t0 = performance.now(); o.step(0.1); const t = performance.now() - t0; if (t > worst) { worst = t; worstAt = i; } if (i < 40) times.push(Math.round(t)); } times.push('worst', Math.round(worst), 'at', worstAt); const ag = [...o.agents.values()].map(a => ({ n: a.data.name, st: a.state, seated: !!a.seated, d: Math.hypot(a.group.position.x - a.seat.x, a.group.position.z - a.seat.z).toFixed(2), path: a.path && a.path.length, face: a.group.rotation.y.toFixed(2), want: a.faceSeat.toFixed(2) })); return { times, ag }; })()`); console.error('[steptime]', JSON.stringify(out)); }
      else if (process.env.AMO_VIEW === 'navtest') { const out = await win.webContents.executeJavaScript(`(async()=>{
        const o = window.__office; await new Promise(r => setTimeout(r, 1500));
        // simulate 6 minutes of office time at 10 Hz without rendering; track every agent's progress
        const stuckLog = {}; const trips = {};
        const orig = o.renderer.render.bind(o.renderer); o.renderer.render = () => {}; const origL = o.labelRenderer.render.bind(o.labelRenderer); o.labelRenderer.render = () => {};
        const ids = [...o.agents.keys()];
        const last = {}; ids.forEach(id => { last[id] = { p: o.agents.get(id).group.position.clone(), still: 0 }; stuckLog[id] = 0; trips[id] = 0; });
        const a0 = o.agents.get(ids[0]); const dbg = []; const stuckWhere = [];
        for (let i = 0; i < 500; i++) {
          if (i < 80 && i % 5 === 0) dbg.push({ i, pos: [a0.group.position.x.toFixed(2), a0.group.position.z.toFixed(2)], tgt: a0.walkTarget ? [a0.walkTarget.x.toFixed(2), a0.walkTarget.z.toFixed(2)] : null, path: a0.path ? a0.path.length : null, idx: a0.pathIdx, stuck: a0.stuck && a0.stuck.toFixed(2), walkable: o.__walk(a0.group.position.x, a0.group.position.z), wait: a0.wait && a0.wait.toFixed(1) });
          if (i === 150) ids.forEach(id => o.setState(id, 'working', 'w'));
          if (i === 350) ids.forEach(id => o.setState(id, 'idle'));
          o.step(0.1);
          for (const id of ids) { const a = o.agents.get(id); const d = a.group.position.distanceTo(last[id].p); last[id].p.copy(a.group.position);
            const seated = a.state === 'working' && Math.hypot(a.group.position.x - a.seat.x, a.group.position.z - a.seat.z) < 0.3;
            const atTarget = a.walkTarget && a.group.position.distanceTo(a.walkTarget) < 0.3;
            if (a.walkTarget && !seated && !atTarget) { if (d < 0.01) { last[id].still += 0.1; if (last[id].still > 3) { stuckLog[id]++; last[id].still = 0; stuckWhere.push({ id, pos: [a.group.position.x.toFixed(1), a.group.position.z.toFixed(1)], tgt: [a.walkTarget.x.toFixed(1), a.walkTarget.z.toFixed(1)], state: a.state, i }); } } else last[id].still = 0; }
            else last[id].still = 0;
          }
        }
        const seatedAll = ids.map(id => { const a = o.agents.get(id); return a.data.name + ':' + (a.state); });
        o.renderer.render = orig; o.labelRenderer.render = origL;
        // facing check: seated agents should look toward their desk (dot of facing vector with desk direction > 0.9)
        ids.forEach(id => o.setState(id, 'working', 'w')); for (let i = 0; i < 120; i++) o.step(0.1);
        const facing = ids.map(id => { const a = o.agents.get(id); const lx = Math.sin(a.group.rotation.y), lz = Math.cos(a.group.rotation.y); let tx = a.desk.position.x - a.group.position.x, tz = a.desk.position.z - a.group.position.z; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L; return a.data.name + ':' + (lx * tx + lz * tz).toFixed(2) + (Math.hypot(a.group.position.x - a.seat.x, a.group.position.z - a.seat.z) < 0.3 ? ' seated' : ' NOT SEATED'); });
        return { facing, stuckEvents: stuckLog, stuckWhere: stuckWhere.slice(0, 12), navCells: o.nav ? o.nav.grid.reduce((s,v)=>s+v,0) + '/' + o.nav.grid.length : null };
      })()`); console.error('[navtest]', JSON.stringify(out)); }
      else if (process.env.AMO_VIEW === 'closeup') await win.webContents.executeJavaScript(`(async()=>{ for (const id of window.__office.agents.keys()) window.__office.setState(id, 'working', 'writing'); window.__office.scene.traverse(o => { if (o.isPointLight || o.isSpotLight) o.intensity *= 0.3; }); window.__office.controls.target.set(-7.5, 1.0, -3.8); window.__office.controls.update(); window.__office.camera.position.set(-7.5, 7.5, 4.5); window.__office.camera.lookAt(-7.5, 1.0, -3.8); console.log('cam', JSON.stringify(window.__office.camera.position)); for (let i=0;i<${process.env.AMO_FRAMES || 30};i++) { window.__office.step(0.3); await new Promise(r=>setTimeout(r,0)); } })()`);
      else if (process.env.AMO_VIEW === 'modeling' || process.env.AMO_VIEW === 'office') await win.webContents.executeJavaScript(`(async()=>{ const wait = (ms) => new Promise(r => setTimeout(r, ms)); const o = window.__office; const run = async (ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { o.step(0.12); await wait(30); } }; document.querySelectorAll('.modal').forEach(m => m.classList.remove('open')); window.__goRoom(${JSON.stringify(process.env.AMO_VIEW)}); await run(2500); })()`);
      else if (process.env.AMO_VIEW === 'drafting') await win.webContents.executeJavaScript(`(async()=>{ const wait = (ms) => new Promise(r => setTimeout(r, ms)); const o = window.__office; const run = async (ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { o.step(0.12); await wait(30); } }; document.querySelectorAll('.modal').forEach(m => m.classList.remove('open')); window.__goRoom('drafting'); await run(1800); o.handOver({ to: 'dex', drawings: 3 }); await run(2500); })()`);
      else if (/^(drawing|desk)(-job)?$/.test(process.env.AMO_VIEW || '')) await win.webContents.executeJavaScript(`(async()=>{ const v = ${JSON.stringify(process.env.AMO_VIEW)}; const wait = (ms) => new Promise(r => setTimeout(r, ms)); const o = window.__office; const run = async (ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { o.step(0.12); await wait(30); } }; document.querySelectorAll('.modal').forEach(m => m.classList.remove('open')); window.__goRoom(v.startsWith('desk') ? 'desk' : 'drawing'); await run(1800); if (v.endsWith('-job')) { o.handOver({ hasSchedule: true, drawings: 4 }); const cal = [...o.agents.values()].find(a => a.zone === 'drawing'); o.setState(cal.data.id, 'working', 'reading DRG-002'); await run(4500); } else await run(1500); })()`);
      else if (process.env.AMO_VIEW === 'behind') await win.webContents.executeJavaScript(`(async()=>{ window.__office.camera.position.set(-38, 14, 6); window.__office.controls.target.set(0, 1, 0); for (let i=0;i<${process.env.AMO_FRAMES || 8};i++) { window.__office.step(0.3); await new Promise(r=>setTimeout(r,0)); } })()`);
      else if (process.env.AMO_VIEW === 'collapsed') await win.webContents.executeJavaScript(`(async()=>{ document.querySelectorAll('.panel .collapse').forEach(b => b.click()); window.__office.camera.position.set(-6, 22, 40); window.__office.controls.target.set(1, 0.5, 0); for (let i=0;i<${process.env.AMO_FRAMES || 20};i++) { window.__office.step(0.3); await new Promise(r=>setTimeout(r,0)); } })()`);
      else if (process.env.AMO_VIEW === 'loadout') await win.webContents.executeJavaScript(`(async()=>{ document.querySelector('[data-tab=agents]').click(); await new Promise(r=>setTimeout(r,200)); document.querySelector('.tcard').click(); await new Promise(r=>setTimeout(r,200)); for (let i=0;i<${process.env.AMO_FRAMES || 20};i++) { window.__preview.t += 0.1; window.__preview.step(); await new Promise(r=>setTimeout(r,0)); } })()`);
      else if (process.env.AMO_VIEW === 'history') await win.webContents.executeJavaScript(`(async()=>{ document.querySelector('[data-tab=history]').click(); for (let i=0;i<4;i++) { window.__office.step(0.1); await new Promise(r=>setTimeout(r,0)); } })()`);
      else if (process.env.AMO_VIEW === 'settings') await win.webContents.executeJavaScript(`(async()=>{ document.querySelector('[data-tab=settings]').click(); document.querySelector('#settingsModal .box').scrollTop = 700; for (let i=0;i<4;i++) { window.__office.step(0.1); await new Promise(r=>setTimeout(r,0)); } })()`);
      else await win.webContents.executeJavaScript(`(async()=>{ if (${process.env.AMO_DEMO ? 'true' : 'false'}) { for (const id of window.__office.agents.keys()) window.__office.setState(id, 'working', 'writing post'); window.__office.setBoard([...window.__office.agents.values()].map(a => ({ colour: a.data.colour, text: a.data.name + ' · ' + a.data.platform, status: 'Working' }))); } for (let i=0;i<${process.env.AMO_FRAMES || 240};i++) { window.__office.step(${process.env.AMO_DT || '1/60'}); if (i%20===0) await new Promise(r=>setTimeout(r,0)); } })()`);
      await new Promise(r => setTimeout(r, 1500));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.AMO_SCREENSHOT, img.toPNG());
      app.quit();
    }, 6000));
  }
}
app.whenReady().then(() => {
  registerAppProtocol(); createWindow();
  // auto-update from GitHub releases (packaged builds only)
  if (app.isPackaged) {
    autoUpdater.autoDownload = true;
    autoUpdater.on('update-available', (i) => updSend({ state: 'downloading', version: i.version }));
    autoUpdater.on('download-progress', (p) => updSend({ state: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (i) => updSend({ state: 'ready', version: i.version }));
    autoUpdater.on('error', (e) => updSend({ state: 'error', message: String(e?.message || e) }));
    autoUpdater.checkForUpdates().catch(() => {});
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 60 * 60 * 1000);
  }
});
ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());
ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) return 'Dev build, no updates';
  const r = await autoUpdater.checkForUpdates();
  const latest = r?.updateInfo?.version; if (!latest) return 'Could not reach GitHub releases';
  const cmp = latest.localeCompare(app.getVersion(), undefined, { numeric: true });
  return cmp > 0 ? `v${latest} available — downloading, you'll get a Restart button` : `You're on the latest (v${app.getVersion()})`;
});
ipcMain.handle('app:version', () => app.getVersion());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ---------- settings / agents / posts ----------
ipcMain.handle('settings:get', () => publicSettings(loadSettings()));
ipcMain.handle('settings:set', (_e, s) => { const cur = loadSettings(); saveSettings({ ...cur, ...s, social: mergeSocial(cur.social, s.social) }); return true; });

// ---------- social connections ----------
function platformKey(platform = '') {
  const p = platform.toLowerCase();
  if (p.includes('linkedin')) return 'linkedin';
  if (p.includes('facebook')) return 'facebook';
  if (p.includes('instagram')) return 'instagram';
  if (p.includes('twitter') || p === 'x' || p.startsWith('x ') || p.includes('x /')) return 'x';
  return null;
}
ipcMain.handle('social:connect', async (_e, { key, wantOrg }) => {
  const s = loadSettings();
  const cfg = { ...(s.social[key] || {}), wantOrg: !!wantOrg };
  const updated = key === 'linkedin' ? await social.LI.connect(cfg) : key === 'facebook' ? await social.FB.connect(cfg) : await social.X.connect(cfg);
  s.social[key] = updated; saveSettings(s);
  return publicSettings(s).social;
});
ipcMain.handle('social:disconnect', (_e, key) => {
  const s = loadSettings(); const { clientId, clientSecret, appId, appSecret } = s.social[key] || {};
  s.social[key] = { clientId, clientSecret, appId, appSecret }; saveSettings(s); return publicSettings(s).social;
});
ipcMain.handle('social:publish', async (_e, { platform, text, image }) => {
  const key = platformKey(platform);
  if (!key) throw new Error(`No connector for "${platform}". Supported: LinkedIn, Facebook, Instagram, X.`);
  const s = loadSettings();
  const save = async (cfg) => { const t = loadSettings(); t.social.x = cfg; saveSettings(t); };
  if (key === 'linkedin') return social.LI.publish(s.social.linkedin, { text, image });
  if (key === 'facebook') return social.FB.publish(s.social.facebook, { text, image });
  if (key === 'instagram') return social.FB.publishInstagram(s.social.facebook, { text, image });
  return social.X.publish(s.social.x, { text, image }, save);
});
ipcMain.handle('social:canPost', (_e, platform) => {
  const key = platformKey(platform); if (!key) return { ok: false, why: 'no connector' };
  const s = loadSettings();
  const c = key === 'instagram' ? s.social.facebook : s.social[key];
  const connected = !!(c?.token || c?.userToken);
  if (key === 'instagram' && connected) { const p = (c.pages || []).find(x => x.id === c.pageId) || c.pages?.[0]; if (!p?.igId) return { ok: false, why: 'Facebook Page has no Instagram linked' }; }
  return { ok: connected, why: connected ? '' : 'not connected (Settings → Connections)', key };
});
// older saved teams predate the drawing checker: add Cal (once) so the drawing room has someone at the desk
function withDrawingAgent(list) {
  for (const role of ['drawing', 'drafter', 'modeller', 'builder', 'modelchecker', 'documents', 'email', 'engineer', 'excel', 'word']) {
    if (list.some(a => a.role === role)) continue;
    const d = DEFAULT_AGENTS.find(a => a.role === role);
    if (d) list = [...list, { ...d }];
  }
  return list;
}
ipcMain.handle('agents:get', () => withDrawingAgent(readJson(AGENTS_FILE(), DEFAULT_AGENTS)));
ipcMain.handle('agents:set', (_e, a) => { writeJson(AGENTS_FILE(), a); return true; });
ipcMain.handle('agents:reset', () => { writeJson(AGENTS_FILE(), DEFAULT_AGENTS); return DEFAULT_AGENTS; });
ipcMain.handle('posts:get', () => readJson(POSTS_FILE(), []));
ipcMain.handle('posts:set', (_e, p) => { writeJson(POSTS_FILE(), p); return true; });
ipcMain.handle('paths:get', () => ({ userData: USER_DIR() }));
ipcMain.handle('shell:open', (_e, url) => shell.openExternal(url));
ipcMain.handle('shell:showItem', (_e, p) => { try { shell.showItemInFolder(p); return true; } catch { return false; } });

// ---------- dated history of what Cal and Dex did (kept on disk, survives closing the app) ----------
const HISTORY_FILE = () => path.join(USER_DIR(), 'history.json');
function addHistory(agent, entry) {
  try {
    const all = readJson(HISTORY_FILE(), []);
    all.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), agent, at: new Date().toISOString(), ...entry });
    writeJson(HISTORY_FILE(), all.slice(0, 300));
  } catch (e) { console.error('history save failed', e); }
}
ipcMain.handle('history:list', (_e, { agent }) => readJson(HISTORY_FILE(), []).filter(h => h.agent === agent).map(({ data, ...rest }) => rest));
ipcMain.handle('history:get', (_e, { id }) => readJson(HISTORY_FILE(), []).find(h => h.id === id) || null);
ipcMain.handle('history:remove', (_e, { id }) => { writeJson(HISTORY_FILE(), readJson(HISTORY_FILE(), []).filter(h => h.id !== id)); return true; });

// ---------- the business layer: jobs, approvals, issue packs, documents, hours, briefs ----------
const modmain = require('./modmain.js');
// the job picked on the project whiteboard (or in an agent's panel) goes to the engineering agents as background; never to the social writers (client details must not leak into posts)
let BIZ;
const AGENT_OF = { Milo: 'milo', Theo: 'theo', Vera: 'vera', Dex: 'dex', Cal: 'cal' };
const withJob = (a) => { const name = (String(a && a.system || '').match(/You are (Milo|Theo|Vera|Dex|Cal)\b/) || [])[1] || ''; let c = ''; try { c = BIZ ? BIZ.contextFor(undefined, name) : ''; } catch {} const out = c ? { ...a, system: String(a.system || '') + '\n\n' + c } : { ...a }; if (name && !out.who) out.who = AGENT_OF[name]; return out; };
roomsmain.register({ ipcMain, dialog, getWin: () => win, loadSettings, saveSettings, userDir: USER_DIR, version: () => app.getVersion(), getAgents: () => readJson(AGENTS_FILE(), DEFAULT_AGENTS) });
const updSend = (u) => { roomsmain.setUpdate(u); win?.webContents.send('update:status', u); };
BIZ = bizmain.register({ ipcMain, dialog, shell, Notification, getWin: () => win, userDir: USER_DIR, claudeFull: (a) => claudeFull(a.docKind ? { ...a, who: 'documents' } : a), checker, getSettings: () => loadSettings() });
{ const NAME_ID = { Dex: 'dex', Cal: 'cal', Lex: 'excel', Wren: 'word', Eli: 'email', Ada: 'engineer', Dot: 'documents', Milo: 'milo', Theo: 'theo', Vera: 'vera' };
  const raw = BIZ.log;
  BIZ.log = (e) => { raw(e); try { const id = e && e.jobId && NAME_ID[e.who]; const ms = id && AGENT_MS[id]; if (ms > 0) { AGENT_MS[id] = 0; BIZ.data().hours.unshift({ id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), jobId: e.jobId, date: new Date().toISOString().slice(0, 10), hours: Math.max(0.01, Math.round(ms / 36000) / 100), who: e.who, note: 'Agent time (auto): ' + e.action, auto: true }); BIZ.store.save(); } } catch {} }; }
require('./o365main').register({ ipcMain, claudeFull: (a) => claudeFull(a), BIZ, checker, userDir: USER_DIR, projects: require('./projects') });
require('./jobdeskmain').register({ ipcMain, dialog, getWin: () => win, claudeFull: (a) => claudeFull(a), BIZ, checker, userDir: USER_DIR, library, writeXlsx: require('./o365main').writeXlsx, shell });
require('./intake').register({ ipcMain, dialog, shell, getWin: () => win, userDir: USER_DIR, claudeFull: (a) => claudeFull(a), checker, BIZ, loadSettings, saveSettings });
modmain.register({ ipcMain, dialog, getWin: () => win, userDir: USER_DIR, claudeFull: (a) => claudeFull(withJob(a)), checker, log: (e) => BIZ.log(e), outputDirFor: (id, k) => BIZ.outputDirFor(id, k) });
require('./pcmain.js').register({ ipcMain, BrowserWindow, desktopCapturer, screen, globalShortcut, getWin: () => win, loadSettings, anthropicBase: ANTHROPIC, log: (e) => BIZ.log(e), jobContext: (who) => { try { return BIZ.contextFor(undefined, who); } catch { return ''; } }, mock: process.env.AMO_PC_MOCK === '1' });

// ---------- the drawing room: cable schedule vs drawings ----------
let checkRunning = false;
ipcMain.handle('check:run', async (_e, { agent, schedule, drawings, note, jobId }) => {
  if (checkRunning) throw new Error('A check is already running. Wait for Cal to finish.');
  checkRunning = true;
  try {
    const progress = (p) => { try { win && win.webContents.send('check:progress', p); } catch {} };
    const report = await checker.runCheck({
      schedule, drawings, note: note || '',
      skill: library.skillFor(agent && agent.id, (agent && agent.rules && agent.rules.trim()) || STANDARD_SKILL),
      claude: (a) => claudeFull({ ...a, who: 'cal', skills: false }), progress
    });
    // marked-up copies of the drawings that have findings; originals are never touched
    progress({ message: 'marking up the drawings', stage: 'markup' });
    try { report.markups = await markup.makeMarkups({ report, drawings, fallbackDir: (jobId && BIZ.outputDirFor(jobId, 'markups')) || path.join(USER_DIR(), 'drawing-checks') }); }
    catch (e) { report.markups = { dir: '', made: [], failed: [{ name: '(all)', reason: String(e.message || e).slice(0, 160) }], untouched: 0 }; }
    const mk = report.markups;
    report.text += '\n\nMARKED-UP COPIES (originals untouched)\n' + ((mk.made.length || mk.notes) ? `  - Saved ${mk.made.length + (mk.notes ? 1 : 0)} file${mk.made.length + (mk.notes ? 1 : 0) === 1 ? '' : 's'} in ${mk.dir}\n` + mk.made.map(m => `  - ${path.basename(m.out)} (${m.notes} note${m.notes === 1 ? '' : 's'})`).join('\n') + (mk.notes ? `\n  - ${path.basename(mk.notes.out)} (${mk.notes.count} schedule-level note${mk.notes.count === 1 ? '' : 's'} that cannot sit on a drawing)` : '') : '  - None made (nothing to mark on the drawings, or they could not be marked up).') + (mk.failed.length ? '\n' + mk.failed.map(f => `  - Could not mark up ${f.name}: ${f.reason}`).join('\n') : '') + `\n  - ${mk.untouched} file${mk.untouched === 1 ? ' has' : 's have'} nothing to mark.`;
    try { writeJson(path.join(USER_DIR(), 'last-check.json'), { at: new Date().toISOString(), findings: report.findings || [] }); } catch {}
    BIZ.log({ who: 'Cal', action: 'Checked', jobId: jobId || '', detail: `${report.headline || 'Drawing check'} · ${(report.findings || []).length} to look at · ${(drawings || []).length} drawing${(drawings || []).length === 1 ? '' : 's'}` });
    addHistory('cal', { title: report.headline || 'Drawing check', summary: `${(report.findings || []).length} to look at · schedule ${schedule && schedule.name || '?'} · ${(drawings || []).length} drawing${(drawings || []).length === 1 ? '' : 's'}`, data: report });
    return report;
  } finally { checkRunning = false; }
});
ipcMain.handle('check:skill', () => library.skillFor('cal', STANDARD_SKILL));
ipcMain.handle('check:last', () => readJson(path.join(USER_DIR(), 'last-check.json'), null));

// ---------- Dex: fixing DXFs from markups ----------
const dxfBuf = (f) => Buffer.from(f.base64, 'base64');
ipcMain.handle('dxf:propose', async (_e, { source, dxfs, markups, note }) => {
  const notes = [];
  const files = [];
  for (const f of dxfs || []) { try { files.push({ ...f, parsed: dxffix.parseDxf(dxfBuf(f)) }); } catch (e) { notes.push(f.name + ': ' + (e.message || e)); } }
  if (!files.length) return { items: [], notes: notes.length ? notes : ['Drop at least one DXF first.'] };
  let items = [];
  if (source === 'cal') {
    const last = readJson(path.join(USER_DIR(), 'last-check.json'), null);
    if (!last || !(last.findings || []).length) return { items: [], notes: ['Cal has no markups yet. Run a check in the drawing room first, or drop markup PDFs instead.'] };
    items = dxffix.proposalsFromFindings(last.findings);
  } else if (source === 'note') {
    if (!String(note || '').trim()) return { items: [], notes: ['Type what you want Dex to do first.'] };
    const inv = files.map(f => 'FILE: ' + f.name + '\n' + dxffix.inventory(f.parsed)).join('\n\n');
    try {
      const r = await claudeFull(withJob({ system: dxffix.DEX_NOTE_SYSTEM, maxTokens: 6000, messages: [{ role: 'user', content: 'The engineer says:\n<instruction>' + String(note).slice(0, 4000) + '</instruction>\n\nText in the drawing(s):\n' + inv }] }));
      const j = checker.parseJson(r.text).value;
      for (const it of (j.items || [])) {
        const fl = files.find(x => x.name === it.file) || (files.length === 1 ? files[0] : null);
        const action = ['replace_text', 'delete_text', 'add_text'].includes(it.action) ? it.action : 'none';
        const ref = Number.isInteger(it.ref) ? it.ref : (/^\d+$/.test(String(it.ref ?? '')) ? +it.ref : undefined);
        const base = { id: 'N' + (items.length + 1), drawing: fl ? fl.name : (it.file || ''), note: it.why || '', why: it.why || '', action, ref, before: it.before || '', after: it.after || '', text: it.text || '', x: it.x, y: it.y, layer: it.layer || '', height: it.height };
        if (action === 'none') { items.push({ ...base, note: it.why || 'Dex could not turn that into a text change.' }); continue; }
        if (!fl) { items.push({ ...base, action, warn: 'Dex could not tell which DXF this is for.' }); continue; }
        if (action === 'delete_text' && ref !== undefined && fl.parsed.ents[ref]) base.before = fl.parsed.ents[ref].plain;
        const c = dxffix.checkItem(fl.parsed, base);
        items.push({ ...base, file: fl.name, can: c.can, places: c.places, inBlocks: c.inBlocks, blocks: c.blocks, warn: c.warn });
      }
      if (!items.length) notes.push('Dex did not find anything to change from that.');
    } catch (e) { notes.push('Dex could not read that instruction (' + String(e.message || e).slice(0, 160) + ')'); }
    return { items, notes };
  } else {
    if (!(markups || []).length) return { items: [], notes: ['Drop at least one marked-up PDF.'] };
    for (const m of markups) {
      try {
        const r = await claudeFull({ who: 'dex', system: dxffix.DEX_SYSTEM, maxTokens: 6000, messages: [{ role: 'user', content: [checker.contentBlock('pdf', m.name, dxfBuf(m)), { type: 'text', text: 'Read every numbered red note on this marked-up drawing (file: ' + m.name + ').' }] }] });
        const j = checker.parseJson(r.text).value;
        (j.items || []).forEach((it, i) => items.push({ id: 'M' + (items.length + 1), drawing: it.drawing || m.name, note: it.note || '', action: it.action === 'replace_text' && it.before && it.after ? 'replace_text' : 'none', before: it.before || '', after: it.after || '', why: it.why || '' }));
      } catch (e) { notes.push(m.name + ': could not be read (' + String(e.message || e).slice(0, 120) + ')'); }
    }
  }
  for (const it of items) {
    if (it.action !== 'replace_text') continue;
    let f = dxffix.matchFile(it.drawing, files.map(x => ({ name: x.name, base64: x.base64 })));
    let hit = f && files.find(x => x.name === f.name);
    if (hit) { const c = dxffix.countMatches(hit.parsed, it.before); if (!c.places && !c.inBlocks) hit = null; }
    if (!hit) { const all = files.map(x => ({ x, c: dxffix.countMatches(x.parsed, it.before) })).filter(o => o.c.places || o.c.inBlocks); if (all.length === 1) hit = all[0].x; }
    if (hit) { const c = dxffix.countMatches(hit.parsed, it.before); it.file = hit.name; it.places = c.places; it.inBlocks = c.inBlocks; it.blocks = c.blocks; it.can = true; }
    else it.warn = 'Not found in any DXF you dropped.';
  }
  return { items, notes };
});
ipcMain.handle('dxf:apply', async (_e, { dxfs, fixes, jobId }) => {
  const out = { files: [], results: [], failed: [] };
  const byFile = new Map();
  for (const fx of fixes || []) { if (!fx.file) { out.results.push({ id: fx.id, status: 'not found', reason: 'No DXF matched this fix.' }); continue; } (byFile.get(fx.file) || byFile.set(fx.file, []).get(fx.file)).push(fx); }
  for (const [name, list] of byFile) {
    const f = (dxfs || []).find(d => d.name === name);
    if (!f) continue;
    try {
      const r = dxffix.applyFixes(dxfBuf(f), list);
      out.results.push(...r.results.map(x => ({ ...x, file: name })));
      if (!r.results.some(x => x.status === 'applied')) continue;
      const base = f.path ? path.dirname(f.path) : path.join(USER_DIR(), 'dxf-fixes');
      const dir = path.join(base, 'FIXED'); fs.mkdirSync(dir, { recursive: true });
      const outName = name.replace(/\.dxf$/i, '') + '_FIXED.dxf';
      const outPath = path.join(dir, outName); fs.writeFileSync(outPath, r.buf);
      out.files.push({ name: outName, path: outPath, changes: r.results.filter(x => x.status === 'applied').reduce((n, x) => n + x.places, 0) });
    } catch (e) { out.failed.push({ name, reason: String(e.message || e).slice(0, 200) }); }
  }
  if (out.files.length) {
    const dir = path.dirname(out.files[0].path);
    const desc = (x) => x.action === 'delete_text' ? `delete "${x.before || ''}"` : x.action === 'add_text' ? `add "${x.text || ''}"` : `"${x.before || ''}" -> "${x.after || ''}"`;
    const log = ['DEX FIX LOG  ' + new Date().toISOString(), 'Originals untouched. Fixed copies:', ...out.files.map(x => '  ' + x.name + ' (' + x.changes + ' change' + (x.changes === 1 ? '' : 's') + ')'), '', ...out.results.map(x => `  ${x.status.toUpperCase()}  ${x.file || ''}  ${desc(x)}  ${x.places ? x.places + ' place(s)' : ''} ${x.reason || ''}`)].join('\n');
    try { fs.writeFileSync(path.join(dir, 'DEX_FIX_LOG.txt'), log); out.log = path.join(dir, 'DEX_FIX_LOG.txt'); } catch {}
  }
  const nDone = out.results.filter(x => x.status === 'applied').length;
  for (const x of out.results.filter(r => r.status === 'applied')) BIZ.log({ who: 'Dex', action: 'Fixed', jobId: jobId || '', before: x.action === 'add_text' ? '' : (x.before || ''), after: x.action === 'delete_text' ? '' : (x.action === 'add_text' ? x.text : x.after || ''), detail: `${x.file || ''} · ${x.action === 'delete_text' ? 'deleted text' : x.action === 'add_text' ? 'added text' : 'changed text'}${x.places ? ' · ' + x.places + ' place' + (x.places === 1 ? '' : 's') : ''}` });
  addHistory('dex', { title: nDone ? `Fixed ${nDone} of ${out.results.length} ticked` : 'Nothing was changed', summary: out.files.map(f => f.name).join(', ') || (out.failed[0] ? out.failed[0].name : ''), data: out });
  return out;
});

// ---------- the modeling room: photo -> 3D model ----------
let modelRunning = false;
ipcMain.handle('model:generate', async (_e, { image, textured = true, name }) => {
  if (modelRunning) throw new Error('A model is already being made. Wait for it to finish.');
  modelRunning = true;
  try {
    const progress = (p) => { try { win && win.webContents.send('model:progress', p); } catch {} };
    return await model3d.generate({
      settings: loadSettings(), image, textured, name,
      outDir: path.join(USER_DIR(), 'models'),
      bases: { meshy: MOCK ? MOCK + '/meshy' : 'https://api.meshy.ai', higgsfield: MOCK ? MOCK + '/higgsfield' : 'https://api.higgsfield.ai' },
      fast: !!MOCK, onProgress: progress
    });
  } finally { modelRunning = false; }
});
// open any .glb from disk (also the way to look at a model made elsewhere)
ipcMain.handle('model:open', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: '3D model', extensions: ['glb'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const buf = fs.readFileSync(r.filePaths[0]);
  return { path: r.filePaths[0], base64: buf.toString('base64'), bytes: buf.length };
});
ipcMain.handle('model:saveAs', async (_e, { from, name }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: name || path.basename(from || 'model.glb'), filters: [{ name: 'GLB model', extensions: ['glb'] }] });
  if (r.canceled) return null;
  fs.copyFileSync(from, r.filePath);
  return r.filePath;
});
// Claude-only route: Claude looks at the photo and describes the object as a set of simple 3D shapes; the page builds and exports the GLB.
const JSON_RULES = `Reply with ONE JSON object and nothing else:
{"name":"short name","parts":[{"shape":"box|cylinder|sphere|cone|torus|capsule","size":[...],"pos":[x,y,z],"rot":[rx,ry,rz],"color":"#rrggbb","metal":0-1,"rough":0-1}]}
Sizes: box [width,height,depth]; cylinder [radiusTop,radiusBottom,height]; sphere [radius]; cone [radius,height]; torus [radius,tube]; capsule [radius,length].
Rules: Y is up, the object stands on y=0 and is centred on x and z. rot is in degrees. Scale the whole model so its longest side is 2 units, keeping the REAL proportions exactly (if real dimensions are given or can be read, use their ratios, including thickness and the height of every component). Use sensible real colours and finishes (metal and rough make shiny, matte, plastic or metal surfaces). Build the base body first, then every component in its real position and relative size: ports, sockets, buttons, connectors, legs, handles, doors, shelves, screws, labels as thin boxes. Use 40 to 180 parts, big shapes first. No floor or background.`;
const CLAUDE_3D_SYSTEMS = {
  photo: `You are a careful 3D modeller. Rebuild the main object in the photo as a model made only from simple primitives.\n` + JSON_RULES,
  text: `You are a careful 3D modeller. Build the object the user describes as a model made only from simple primitives. Use the real-world proportions of that kind of object (and any exact size or make given).\n` + JSON_RULES,
  schematic: `You are a careful 3D modeller who reads engineering drawings. You are given a schematic, plan, elevation, general-arrangement or panel/cabinet drawing (possibly several views). Read every view, dimension, title block note and label, work out the real 3D shape and sizes, and build a model of it from simple primitives, to scale. Combine the views: front/side/top views give the width, height and depth; hidden or detail views give extra parts. Where the drawing is a wiring or circuit schematic with no physical shape, build the equipment it shows (panel, cabinet, devices) laid out as drawn. Never invent parts that are not on the drawing; keep to what it shows.\n` + JSON_RULES
};
const CLAUDE_RESEARCH_SYSTEM = `You help build an accurate 3D model. First identify exactly what the object is (make, model, version if you can tell). Then use web search to confirm it and find its real dimensions (length, width, height in millimetres), the size and position of its main components (for example ports, connectors, buttons, chips, legs, screens), its usual colours and materials, and anything else that makes a model more accurate. Prefer the maker's datasheet or product page. If it is a generic object with no exact specification, say so and give typical real-world dimensions instead.
Reply with ONE JSON object and nothing else:
{"what":"exact identification","confidence":"high|medium|low","dimensions_mm":{"length":0,"width":0,"height":0},"components":["component: size and where it sits"],"colours":"main colours and finishes","notes":"anything else useful for modelling","sources":["urls you used"]}`;
ipcMain.handle('model:claude', async (_e, { image, text, kind = 'photo', research = true, model }) => {
  kind = ['photo', 'text', 'schematic'].includes(kind) ? kind : 'photo';
  const want = String(text || '').trim();
  if (kind === 'text' && !want) throw new Error('Type what you want a model of first.');
  if (kind !== 'text' && !(image && image.base64)) throw new Error(kind === 'schematic' ? 'Drop the schematic first.' : 'Drop a photo first.');
  const progress = (p) => { try { win && win.webContents.send('model:progress', p); } catch {} };
  const s = loadSettings(), useModel = String(model || s.claude3dModel || s.claudeModel || '').trim() || s.claudeModel;
  const media = (image && image.base64) ? [image.mime === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: image.base64 } }
    : { type: 'image', source: { type: 'base64', media_type: image.mime || 'image/jpeg', data: image.base64 } }] : [];
  const what = { photo: 'this photo', text: 'this description', schematic: 'this drawing' }[kind];
  const ask = (t) => [...media, { type: 'text', text: (want ? `${kind === 'text' ? 'Description' : 'Notes from the user'}: "${want}"\n\n` : '') + t }];
  let facts = null, researchNote = '';
  if (research) {
    progress({ message: kind === 'schematic' ? 'Claude is reading the drawing and looking up the equipment' : 'Claude is working out what it is and looking it up', pct: 12 });
    try {
      const r = await claudeFull({ system: CLAUDE_RESEARCH_SYSTEM, model: useModel, maxTokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
        messages: [{ role: 'user', content: ask(`What is shown or described in ${what}, and what are its real dimensions and component details? JSON only.`) }] });
      facts = extractJson(r.text);
      researchNote = r.searches ? `looked up online (${r.searches} search${r.searches === 1 ? '' : 'es'})` : 'identified without web results';
    } catch (e) { researchNote = 'online lookup unavailable (' + String(e.message || e).slice(0, 90) + ')'; }
  }
  progress({ message: kind === 'schematic' ? 'Claude is building it to scale from the drawing' : 'Claude is building the shapes', pct: 45 });
  const brief = (facts ? `Verified facts (use them for real proportions and components):\n${JSON.stringify(facts)}\n\n` : '') + `Build ${what} as a primitive 3D model. JSON only.`;
  const { text: out } = await claudeFull({ system: CLAUDE_3D_SYSTEMS[kind], model: useModel, maxTokens: 24000, messages: [{ role: 'user', content: ask(brief) }] });
  const j = extractJson(out);
  if (!j || !Array.isArray(j.parts) || !j.parts.length) throw new Error('Claude did not give any shapes. Try again, or pick a stronger model.');
  return { ...j, kind, research: facts ? { what: facts.what, confidence: facts.confidence, dims: facts.dimensions_mm, sources: Array.isArray(facts.sources) ? facts.sources.slice(0, 6) : [] } : null, researchNote, model: useModel };
});
ipcMain.handle('model:saveGlb', (_e, { base64, name }) => {
  const buf = Buffer.from(base64, 'base64');
  if (buf.length < 20 || buf.toString('ascii', 0, 4) !== 'glTF') throw new Error('Not a GLB file.');
  const dir = path.join(USER_DIR(), 'models'); fs.mkdirSync(dir, { recursive: true });
  const safe = String(name || 'model').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-').slice(0, 40) || 'model';
  const file = path.join(dir, `${safe}-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}.glb`);
  fs.writeFileSync(file, buf);
  return { path: file, base64, bytes: buf.length, provider: 'claude' };
});
ipcMain.handle('model:list', () => {
  const d = path.join(USER_DIR(), 'models'); try { fs.mkdirSync(d, { recursive: true }); } catch {}
  return fs.readdirSync(d).filter(f => /\.glb$/i.test(f)).map(f => { const st = fs.statSync(path.join(d, f)); return { name: f, path: path.join(d, f), at: st.mtime.toISOString(), bytes: st.size }; }).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100);
});
ipcMain.handle('model:load', (_e, { file }) => {
  const d = path.join(USER_DIR(), 'models'), p = path.resolve(d, path.basename(String(file || '')));
  if (path.dirname(p) !== path.resolve(d) || !fs.existsSync(p)) throw new Error('That model file is gone.');
  const buf = fs.readFileSync(p); return { path: p, base64: buf.toString('base64'), bytes: buf.length };
});
ipcMain.handle('model:folder', () => { const d = path.join(USER_DIR(), 'models'); fs.mkdirSync(d, { recursive: true }); return d; });

// ---------- files ----------
ipcMain.handle('file:pickImages', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Add images or media',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
  });
  if (r.canceled) return [];
  return r.filePaths.map(p => {
    const ext = path.extname(p).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    return { name: path.basename(p), mime, base64: fs.readFileSync(p).toString('base64') };
  });
});

ipcMain.handle('file:saveImage', async (_e, { base64, name }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: name || 'atomax-image.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, Buffer.from(base64, 'base64'));
  return r.filePath;
});

ipcMain.handle('file:saveText', async (_e, { text, name }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: name || 'post.txt', filters: [{ name: 'Text', extensions: ['txt', 'md'] }] });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, text, 'utf8');
  return r.filePath;
});

// ---------- Claude (Anthropic) ----------
// every Claude call goes through here: the monthly cap check, the library (rulebook + ticked files for `who`), and the usage log
// agent working time since its last logged action, so the time lands on the job it was working on (auto timesheet lines)
const AGENT_MS = {};
async function claudeFull({ system, messages, maxTokens = 4000, model, tools, who = '', test = false, skills }) {
  const s = loadSettings();
  const useModel = model || s.claudeModel;
  let tIn = 0, tOut = 0; const t0 = Date.now();
  try {
    if (!s.anthropicKey) throw new Error('No Claude API key. Add it in Settings.');
    if (!test) usage.guard('claude', s);
    // the agent's skills (or the ones ticked for this run; false when the caller already put them in), its rulebook and ticked files
    const sys = who ? `${system || ''}${skills === false ? '' : library.skillsBlock(who, skills)}\n${library.promptBlock(who)}` : system;
    let msgs = messages, text = '', stop = '', searches = 0;
    for (let turn = 0; turn < 4; turn++) {   // server-side tools (web search) can pause a long turn: carry on where it stopped
      const res = await fetch(ANTHROPIC + '/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': s.anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: useModel, max_tokens: maxTokens, system: sys, messages: msgs, ...(tools ? { tools } : {}) })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`Claude ${res.status}: ${data?.error?.message || JSON.stringify(data)}`);
      tIn += data.usage?.input_tokens || 0; tOut += data.usage?.output_tokens || 0;
      const parts = data.content || [];
      searches += parts.filter(c => c.type === 'server_tool_use').length;
      text += (text ? '\n' : '') + parts.filter(c => c.type === 'text').map(c => c.text).join('\n');
      stop = data.stop_reason;
      if (stop !== 'pause_turn') break;
      msgs = [...msgs, { role: 'assistant', content: parts }];
    }
    usage.record({ provider: 'claude', who, model: useModel, tokensIn: tIn, tokensOut: tOut });
    if (who && !test) AGENT_MS[who] = (AGENT_MS[who] || 0) + (Date.now() - t0);
    return { text, stop, searches };
  } catch (e) {
    usage.record({ provider: 'claude', who, model: useModel, tokensIn: tIn, tokensOut: tOut, error: e.message || String(e) });
    throw e;
  }
}
async function claudeMessage(args) { return (await claudeFull(args)).text; }

function extractJson(text) {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('Claude did not return JSON:\n' + text);
  const raw = text.slice(start, text.lastIndexOf('}') + 1 || undefined);
  try { return JSON.parse(raw); } catch {}
  // reply was cut off mid-way: keep everything up to the last complete value and close the brackets
  const src = text.slice(start);
  let inStr = false, esc = false, depth = 0, lastGood = -1; const stack = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') { inStr = false; lastGood = i; } continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') { stack.push(c); depth++; }
    else if (c === '}' || c === ']') { stack.pop(); depth--; lastGood = i; }
    else if (/[0-9el]/.test(c)) lastGood = i; // numbers, true/false/null
  }
  let fixed = src.slice(0, lastGood + 1).replace(/,\s*$/, '');
  // inside an object: drop a dangling `"key"` / `"key":` that never got its value
  if (stack[stack.length - 1] === '{') fixed = fixed.replace(/(^|[{,])\s*"[^"]*"\s*(:\s*)?$/, '$1').replace(/,\s*$/, '');
  for (let i = stack.length - 1; i >= 0; i--) fixed += stack[i] === '{' ? '}' : ']';
  try { return JSON.parse(fixed); } catch (e) { throw new Error('Claude did not return JSON:\n' + text); }
}

function companyBlock(company) {
  return `COMPANY: ${company.name}
ABOUT: ${company.about}
AUDIENCE: ${company.audience}
WEBSITE: ${company.website}
RULES FOR EVERYONE: ${company.doNot}${company.knowledge ? `

WHAT THE COMPANY ACTUALLY SAYS ABOUT ITSELF (from its website; use these facts and this language, never invent beyond it):
${company.knowledge}` : ''}`;
}

// ---------- pull the company profile from its website ----------
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<nav[\s\S]*?<\/nav>/gi, ' ').replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<(br|p|div|li|h[1-6]|tr|section|article)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&[a-z]+;/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
async function fetchSitePages(startUrl) {
  const base = new URL(startUrl.startsWith('http') ? startUrl : 'https://' + startUrl);
  const seen = new Set(), pages = [];
  const queue = [base.href];
  const prefer = /about|service|what-we-do|project|case|sector|client|team|contact|expertise|capabilit|accredit|career|news/i;
  while (queue.length && pages.length < 10) {
    const url = queue.shift(); if (seen.has(url)) continue; seen.add(url);
    let html;
    try { const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 AtomaxMediaOffice' }, redirect: 'follow' }); if (!r.ok) continue; html = await r.text(); } catch { continue; }
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || url;
    const text = htmlToText(html).slice(0, 12000);
    if (text.length > 200) pages.push({ url, title, text });
    for (const mm of html.matchAll(/href=["']([^"'#?]+)["']/gi)) {
      try {
        const u = new URL(mm[1], url);
        if (u.hostname !== base.hostname || !/^https?:/.test(u.protocol)) continue;
        if (/\.(pdf|jpg|jpeg|png|gif|svg|zip|docx?|xlsx?|mp4)$/i.test(u.pathname)) continue;
        const href = u.origin + u.pathname;
        if (!seen.has(href)) (prefer.test(u.pathname) ? queue.unshift(href) : queue.push(href));
      } catch {}
    }
  }
  if (!pages.length) throw new Error(`Could not read anything from ${base.href}. Check the address, or the site may block automated requests.`);
  return pages;
}
ipcMain.handle('company:fromWebsite', async (_e, url) => {
  const s = loadSettings();
  const pages = await fetchSitePages(url);
  const corpus = pages.map(p => `=== ${p.title} (${p.url}) ===\n${p.text}`).join('\n\n').slice(0, 60000);
  const system = `You build a company profile for a social media team, using ONLY what the company's own website says. Do not invent services, clients, numbers, certifications or history that are not on the pages. Prefer the company's own phrasing. Reply with JSON only, no fences:
{
  "name": "company name as the site writes it",
  "about": "3 to 4 sentences, plain British English, what they do and for whom",
  "services": ["service 1", "..."],
  "sectors": ["sector or client type named on the site", "..."],
  "clients": ["client names ONLY if the site names them", "..."],
  "audience": "one sentence: who the posts should speak to",
  "tone": "one sentence: the voice the site uses",
  "facts": ["location, founding, accreditations, team size, anything concrete the site states", "..."],
  "knowledge": "a 300 to 500 word digest of everything useful on the site for writing posts: services in detail, how they describe their approach, sectors, any projects, locations, people, accreditations - factual, no fluff"
}`;
  const text = await claudeMessage({ system, messages: [{ role: 'user', content: `WEBSITE: ${url}\n\n${corpus}` }], maxTokens: 4000 });
  const prof = extractJson(text);
  s.company = {
    ...s.company,
    name: prof.name || s.company.name,
    about: prof.about || s.company.about,
    audience: prof.audience || s.company.audience,
    website: url,
    knowledge: [prof.knowledge || '',
      prof.services?.length ? 'Services: ' + prof.services.join('; ') : '',
      prof.sectors?.length ? 'Sectors: ' + prof.sectors.join('; ') : '',
      prof.clients?.length ? 'Clients named on the site: ' + prof.clients.join('; ') : '',
      prof.facts?.length ? 'Facts: ' + prof.facts.join('; ') : '',
      prof.tone ? 'Voice: ' + prof.tone : ''].filter(Boolean).join('\n'),
    pulledAt: new Date().toISOString(), pages: pages.map(p => p.url)
  };
  saveSettings(s);
  return { company: s.company, pages: pages.map(p => p.title) };
});

// Builds the user content: post images, then reference material (text + images), clearly labelled
function buildContent({ images = [], refText = '', refImages = [], text }) {
  const content = [];
  images.forEach((img, i) => {
    content.push({ type: 'text', text: `POST IMAGE ${i + 1} (${img.name || 'image'}) — this is the image that will be posted:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 } });
  });
  if (refText || refImages.length) {
    content.push({ type: 'text', text: `REFERENCE MATERIAL — examples of the style, tone and structure to match. Do NOT copy their wording or facts, and do NOT treat reference images as the post image.${refText ? '\n' + refText : ''}` });
    refImages.forEach((img, i) => {
      content.push({ type: 'text', text: `REFERENCE IMAGE ${i + 1} (${img.name || 'image'}):` });
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 } });
    });
  }
  content.push({ type: 'text', text });
  return content;
}
function examplesBlock(agent) {
  return agent.examples ? `\nEXAMPLES OF YOUR PAST POSTS (match this voice and structure, never reuse their content):\n${agent.examples}\n` : '';
}

// Write one post for one platform agent
ipcMain.handle('ai:writePost', async (_e, { agent, brief, images = [], extra = '', refText = '', refImages = [], imageBrief = '' }) => {
  const s = loadSettings();
  const system = `You are ${agent.name}, the ${agent.platform} content writer in the ${s.company.name} media office.
${companyBlock(s.company)}

YOUR PLATFORM: ${agent.platform}
YOUR TONE: ${agent.tone}
YOUR FORMAT RULES: ${library.skillFor(agent.id, agent.rules)}
${examplesBlock(agent)}
Write ONE post for ${agent.platform} from the brief and the POST IMAGES. Use what you can actually see in the post images; do not invent details. If reference material is given, match its style and structure but write fresh content about the brief.
${imageBrief ? `THE IMAGE THAT WILL BE POSTED WILL SHOW: ${imageBrief}\nWrite the caption to go with that picture, and make "imageIdea" a platform-specific art direction for exactly that scene (composition, crop, mood) - do not change what it shows.` : ''}
Reply with JSON only, no markdown fences, exactly this shape:
{
  "hook": "first line / headline",
  "caption": "the full post text ready to paste, including hashtags where the format rules say",
  "hashtags": ["tag1", "tag2"],
  "altText": "accessible description of the image, or an idea for one if no image was given",
  "imageIdea": "a one-paragraph image prompt for an AI image model, specific to THIS platform and THIS post (composition, crop, mood, any banner or text treatment); make it different from what another platform would want, in the company's style",
  "overlayText": "short headline to print on the post image as a banner (e.g. 'Site Commissioning for Diageo Runcorn'), max 60 characters, spelled exactly as it should appear; empty string if the post doesn't need one",
  "bestTime": "best day and time to post for this platform, UK time",
  "notes": "one short line to the human: anything to check before posting"
}`;

  const content = buildContent({ images, refText, refImages, text: `BRIEF:\n${brief}\n${extra ? '\nEXTRA INSTRUCTIONS:\n' + extra : ''}` });
  const text = await claudeMessage({ system, who: agent.id, skills: false, messages: [{ role: 'user', content }] });
  return extractJson(text);
});

// Revise an existing post ("make it shorter", "add a line about safety")
ipcMain.handle('ai:revisePost', async (_e, { agent, post, instruction }) => {
  const s = loadSettings();
  const system = `You are ${agent.name}, the ${agent.platform} content writer in the ${s.company.name} media office.
${companyBlock(s.company)}
YOUR TONE: ${agent.tone}
YOUR FORMAT RULES: ${library.skillFor(agent.id, agent.rules)}
${examplesBlock(agent)}
Revise the post as instructed. Reply with JSON only in the same shape as the original.`;
  const text = await claudeMessage({
    system,
    who: agent.id,
    skills: false,
    messages: [{ role: 'user', content: `CURRENT POST JSON:\n${JSON.stringify(post, null, 2)}\n\nINSTRUCTION: ${instruction}` }]
  });
  return extractJson(text);
});

// A reviewer bot assesses a writer's post
ipcMain.handle('ai:reviewPost', async (_e, { reviewer, agent, post, brief, images = [], refText = '', refImages = [] }) => {
  const s = loadSettings();
  const system = `You are ${reviewer.name}, a reviewer in the ${s.company.name} media office. Your job: ${reviewer.platform}.
${companyBlock(s.company)}

HOW YOU REVIEW: ${reviewer.tone}
WHAT YOU CHECK: ${library.skillFor(reviewer.id, reviewer.rules)}
${examplesBlock(reviewer)}
You are reviewing a ${agent.platform} post written by ${agent.name}.
${agent.name}'s TONE BRIEF: ${agent.tone}
${agent.name}'s FORMAT RULES: ${library.skillFor(agent.id, agent.rules)}
${agent.examples ? `${agent.name}'s EXAMPLE POSTS (the voice the post should match):\n${agent.examples}\n` : ''}
Assess whether this is a good post for ${agent.platform}. Be specific. If reference material is given, also judge whether the post matches its tone and structure without copying it. If you suggest changes, give the full corrected post text.
Reply with JSON only, no markdown fences, exactly this shape:
{
  "score": 7,
  "verdict": "pass" | "fix" | "fail",
  "summary": "one sentence overall opinion",
  "good": ["what works", "..."],
  "issues": ["what is wrong or weak, with the exact words if relevant", "..."],
  "fixedCaption": "the full improved post text ready to paste, or empty string if no changes needed"
}`;
  const content = buildContent({ images, refText, refImages, text: `ORIGINAL BRIEF:\n${brief}\n\nPOST TO REVIEW (${agent.platform}):\n${post.caption}\n\nALT TEXT: ${post.altText || ''}` });
  const text = await claudeMessage({ system, who: reviewer.id, skills: false, messages: [{ role: 'user', content }], maxTokens: 1500 });
  return extractJson(text);
});

// Look at an image and describe edits / write alt text (Claude can see, not paint)
ipcMain.handle('ai:describeImage', async (_e, { images, question }) => {
  const content = images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 } }));
  content.push({ type: 'text', text: question || 'Describe this image for a social media post and suggest 3 edits that would make it stronger.' });
  return claudeMessage({ system: 'You are an image editor in a media office. Be concrete and brief.', messages: [{ role: 'user', content }], maxTokens: 800 });
});

// ---------- image generation ----------
// size/quality rules differ per OpenAI image model
function openaiImageBody(model, prompt, size) {
  const isGpt = model.startsWith('gpt-image');
  if (isGpt) {
    const q = loadSettings().openaiImageQuality || 'high';
    // xhigh / max only exist on gpt-image-2.5 and later; older models top out at high
    const quality = /gpt-image-2\.5|gpt-image-[3-9]/.test(model) ? q : (['xhigh', 'max'].includes(q) ? 'high' : q);
    return { model, prompt, size: size || 'auto', n: 1, quality };
  }
  if (model === 'dall-e-3') {
    const map = { '1536x1024': '1792x1024', '1024x1536': '1024x1792', auto: '1024x1024' };
    return { model, prompt, size: map[size] || size || '1024x1024', n: 1, response_format: 'b64_json', quality: 'standard' };
  }
  return { model: 'dall-e-2', prompt: prompt.slice(0, 1000), size: '1024x1024', n: 1, response_format: 'b64_json' };
}
async function openaiGenerateRaw(prompt, size, model, withLogo = true) {
  const s = loadSettings();
  if (!s.openaiKey) throw new Error('No OpenAI key. Add it in Settings or switch the image provider.');
  model = model || s.openaiImageModel || 'gpt-image-1';
  const logo = withLogo && model.startsWith('gpt-image') ? logoImage() : null;
  if (logo) {
    // gpt-image can compose a brand-new image from reference images: send the logo so it comes out exact
    const fd = new FormData();
    fd.append('model', model);
    fd.append('prompt', `Create a brand-new image (do not simply reproduce the attached file): ${prompt}\n\n${LOGO_RULES}`);
    fd.append('size', size === 'auto' || !size ? '1024x1024' : size);
    const q = s.openaiImageQuality || 'high';
    fd.append('quality', /gpt-image-2\.5|gpt-image-[3-9]/.test(model) ? q : (['xhigh', 'max'].includes(q) ? 'high' : q));
    fd.append('image[]', new Blob([Buffer.from(logo.base64, 'base64')], { type: logo.mime }), logo.name);
    const res = await fetch(OPENAI + '/v1/images/edits', { method: 'POST', headers: { authorization: `Bearer ${s.openaiKey}` }, body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data?.error?.message || JSON.stringify(data)}`);
    const item = data.data?.[0] || {};
    if (item.b64_json) return item.b64_json;
    if (item.url) return await downloadBase64(item.url);
    throw new Error('OpenAI returned no image');
  }
  const res = await fetch(OPENAI + '/v1/images/generations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${s.openaiKey}` },
    body: JSON.stringify(openaiImageBody(model, prompt, size))
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data?.error?.message || JSON.stringify(data)}`);
  const item = data.data?.[0] || {};
  if (item.b64_json) return item.b64_json;
  if (item.url) return await downloadBase64(item.url);
  throw new Error('OpenAI returned no image');
}

// Brand logo: the user's own file (Settings → Brand logo) or the bundled Atomax-UK logo (transparent, upscaled)
const BUNDLED_LOGO = path.join(__dirname, 'assets', 'atomax-logo-clear.png');
const USER_LOGO = () => path.join(USER_DIR(), 'brand-logo.png');
function logoImage() {
  const p = fs.existsSync(USER_LOGO()) ? USER_LOGO() : BUNDLED_LOGO;
  if (!fs.existsSync(p)) return null;
  return { base64: fs.readFileSync(p).toString('base64'), mime: 'image/png', name: 'brand-logo.png' };
}
const LOGO_RULES = `The LAST attached image is the official company logo. Wherever the design calls for the logo or branding, reproduce that logo exactly as given: same mark, same wordmark, same proportions and colours. Never redraw, restyle, re-letter or approximate it. Brand colours: navy #0E121D, green #40BD00, white text.`;
ipcMain.handle('logo:set', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose the brand logo (PNG with transparent background works best)', properties: ['openFile'], filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (r.canceled) return null;
  fs.mkdirSync(USER_DIR(), { recursive: true }); fs.copyFileSync(r.filePaths[0], USER_LOGO());
  return { custom: true, base64: fs.readFileSync(USER_LOGO()).toString('base64') };
});
ipcMain.handle('logo:reset', () => { try { fs.unlinkSync(USER_LOGO()); } catch {} return { custom: false, base64: fs.readFileSync(BUNDLED_LOGO).toString('base64') }; });
ipcMain.handle('logo:get', () => ({ custom: fs.existsSync(USER_LOGO()), base64: (logoImage() || {}).base64 }));
async function openaiEditRaw(prompt, image, size, extraImages = [], model) {
  const s = loadSettings();
  if (!s.openaiKey) throw new Error('No OpenAI key. Image edits need OpenAI.');
  model = model || s.openaiImageModel || 'gpt-image-1';
  const fd = new FormData();
  if (model.startsWith('gpt-image')) {
    fd.append('model', model);
    fd.append('prompt', prompt);
    fd.append('size', size || 'auto');
    const q = s.openaiImageQuality || 'high';
    fd.append('quality', /gpt-image-2\.5|gpt-image-[3-9]/.test(model) ? q : (['xhigh', 'max'].includes(q) ? 'high' : q));
    fd.append('image[]', new Blob([Buffer.from(image.base64, 'base64')], { type: image.mime }), image.name || 'image.png');
    for (const x of extraImages) fd.append('image[]', new Blob([Buffer.from(x.base64, 'base64')], { type: x.mime }), x.name || 'extra.png');
  } else {
    // DALL·E: only dall-e-2 can edit, one square PNG under 4 MB, no reference images
    if (image.mime !== 'image/png') throw new Error('DALL·E 2 edits need a square PNG. Switch the image model to gpt-image-1 (or -mini) for photo edits with the logo.');
    fd.append('model', 'dall-e-2');
    fd.append('prompt', prompt.slice(0, 1000));
    fd.append('size', '1024x1024');
    fd.append('response_format', 'b64_json');
    fd.append('image', new Blob([Buffer.from(image.base64, 'base64')], { type: image.mime }), image.name || 'image.png');
  }
  const res = await fetch(OPENAI + '/v1/images/edits', {
    method: 'POST', headers: { authorization: `Bearer ${s.openaiKey}` }, body: fd
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data?.error?.message || JSON.stringify(data)}`);
  const item = data.data?.[0] || {};
  if (item.b64_json) return item.b64_json;
  if (item.url) return await downloadBase64(item.url);
  throw new Error('OpenAI returned no image');
}

// one meter for paid image and 3D calls: cap check before, usage row after (errors and pauses are logged too)
async function metered(provider, who, fn) {
  const s = loadSettings();
  try { usage.guard(provider, s); const out = await fn(); usage.record({ provider, who, units: 1 }); return out; }
  catch (e) { usage.record({ provider, who, units: 0, error: e.message || String(e) }); throw e; }
}
const openaiGenerate = (...a) => metered('openai', '', () => openaiGenerateRaw(...a));
const googleGenerate = (...a) => metered('google', '', () => googleGenerateRaw(...a));
const higgsfieldGenerate = (...a) => metered('higgsfield', '', () => higgsfieldGenerateRaw(...a));
const openaiEdit = (...a) => metered('openai', '', () => openaiEditRaw(...a));

async function downloadBase64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download failed ${r.status}`);
  return Buffer.from(await r.arrayBuffer()).toString('base64');
}

// ---------- Google (Gemini "Nano Banana") ----------
const GOOGLE_MODELS = ['gemini-nano-banana-2.1', 'gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'gemini-2.5-flash-image'];
function googleSize(quality) { return ['xhigh', 'max'].includes(quality) ? '4K' : quality === 'high' ? '2K' : '1K'; }
function findGoogleImage(d) {
  if (d?.output_image?.data) return d.output_image.data;
  for (const st of d?.steps || []) for (const c of st.content || []) if (c.type === 'image' && c.data) return c.data;
  for (const c of d?.candidates || []) for (const p of c.content?.parts || []) if (p.inlineData?.data || p.inline_data?.data) return p.inlineData?.data || p.inline_data?.data;
  return null;
}
async function googleGenerateRaw(prompt, aspect, model, refImages = []) {
  const s = loadSettings();
  if (!s.googleKey) throw new Error('No Google (Gemini) API key. Add it in Settings or switch the image provider.');
  model = model || s.googleImageModel || 'gemini-nano-banana-2.1';
  const headers = { 'content-type': 'application/json', 'x-goog-api-key': s.googleKey };
  const quality = s.openaiImageQuality || 'high';
  const size = /flash-lite/.test(model) ? '1K' : googleSize(quality);
  // current API: Interactions
  let res = await fetch(`${GOOGLE}/v1beta/interactions`, {
    method: 'POST', headers,
    body: JSON.stringify({ model, input: [{ type: 'text', text: prompt }, ...refImages.map(i => ({ type: 'image', mime_type: i.mime || 'image/png', data: i.base64 }))], response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: aspect || '1:1', image_size: size } })
  });
  let data = await res.json().catch(() => ({}));
  if (res.status === 404 || res.status === 400 && /interactions|unknown name|response_format/i.test(JSON.stringify(data))) {
    // older API surface: generateContent with image modality
    res = await fetch(`${GOOGLE}/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers,
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, ...refImages.map(i => ({ inline_data: { mime_type: i.mime || 'image/png', data: i.base64 } }))] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: aspect || '1:1' } } })
    });
    data = await res.json().catch(() => ({}));
  }
  if (!res.ok) throw new Error(`Google ${res.status}: ${data?.error?.message || JSON.stringify(data).slice(0, 300)}`);
  const b64 = findGoogleImage(data);
  if (!b64) throw new Error('Google returned no image: ' + JSON.stringify(data).slice(0, 300));
  return b64;
}

function findImageUrl(obj) {
  // Higgsfield result shapes vary by model; dig out the first image url we can find
  if (!obj) return null;
  if (typeof obj === 'string' && /^https?:\/\//.test(obj) && /\.(png|jpe?g|webp)(\?|$)/i.test(obj)) return obj;
  if (Array.isArray(obj)) { for (const x of obj) { const u = findImageUrl(x); if (u) return u; } return null; }
  if (typeof obj === 'object') {
    for (const k of ['url', 'image_url', 'images', 'image', 'output', 'result', 'results', 'data', 'outputs']) {
      if (k in obj) { const u = findImageUrl(obj[k]); if (u) return u; }
    }
    for (const v of Object.values(obj)) { const u = findImageUrl(v); if (u) return u; }
  }
  return null;
}

async function higgsfieldGenerateRaw(prompt, aspect) {
  const s = loadSettings();
  if (!s.higgsfieldKeyId || !s.higgsfieldSecret) throw new Error('No Higgsfield key ID / secret. Add them in Settings.');
  const auth = `Key ${s.higgsfieldKeyId}:${s.higgsfieldSecret}`;
  const model = (s.higgsfieldModel || 'higgsfield-ai/soul/standard').replace(/^\/+/, '');
  const res = await fetch(`https://api.higgsfield.ai/${model}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: auth },
    body: JSON.stringify({ prompt, aspect_ratio: aspect || '1:1' })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Higgsfield ${res.status}: ${JSON.stringify(data)}`);
  const statusUrl = data.status_url || `https://api.higgsfield.ai/requests/${data.request_id}/status`;
  const started = Date.now();
  while (Date.now() - started < 5 * 60 * 1000) {
    await new Promise(r => setTimeout(r, 3000));
    const sr = await fetch(statusUrl, { headers: { authorization: auth, accept: 'application/json' } });
    const sd = await sr.json();
    const st = (sd.status || '').toLowerCase();
    if (st === 'completed' || st === 'succeeded' || st === 'success') {
      const url = findImageUrl(sd);
      if (!url) throw new Error('Higgsfield finished but no image url found: ' + JSON.stringify(sd).slice(0, 500));
      return await downloadBase64(url);
    }
    if (st === 'failed' || st === 'cancelled' || st === 'error' || st === 'nsfw') throw new Error('Higgsfield job ' + st + ': ' + JSON.stringify(sd).slice(0, 500));
  }
  throw new Error('Higgsfield job timed out');
}

ipcMain.handle('image:generate', async (_e, { provider, model, prompt, size, aspect, withLogo = true }) => {
  const p = provider || loadSettings().imageProvider;
  let base64;
  if (p === 'higgsfield') base64 = await higgsfieldGenerate(prompt, aspect);
  else if (p === 'google') { const logo = withLogo ? logoImage() : null; base64 = await googleGenerate(`${prompt}${logo ? '\n\n' + LOGO_RULES : ''}`, aspect, model, logo ? [logo] : []); }
  else base64 = await openaiGenerate(prompt, size, model, withLogo);
  return { base64, mime: 'image/png', provider: p };
});
// list the image models this OpenAI key can actually use
ipcMain.handle('openai:imageModels', async () => {
  const s = loadSettings();
  if (!s.openaiKey) return [];
  const r = await fetch(OPENAI + '/v1/models', { headers: { authorization: `Bearer ${s.openaiKey}` } });
  const data = await r.json();
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${data?.error?.message || ''}`);
  return (data.data || []).map(x => x.id).filter(id => /gpt-image|dall-e/.test(id)).sort();
});

// Edit the post image. withLogo: the real Atomax-UK logo is passed as a second input image so it comes out exact.
ipcMain.handle('image:edit', async (_e, { prompt, image, size, withLogo = true, overlayText = '', model, provider, aspect }) => {
  if (provider === 'google') {
    const logo = withLogo ? logoImage() : null;
    let full = `Edit the FIRST attached photo as described, keeping its content, framing and realism: ${prompt}`;
    if (logo) full += '\n\n' + LOGO_RULES;
    if (overlayText) full += `\nAny text you add must read EXACTLY: "${overlayText}" with that exact spelling and capitalisation, crisp and legible, no other words.`;
    const base64 = await googleGenerate(full, aspect || '1:1', model, [image, ...(logo ? [logo] : [])]);
    return { base64, mime: 'image/png', provider: 'google' };
  }
  const extra = [];
  let full = prompt;
  const logo = withLogo ? logoImage() : null;
  if (logo) {
    extra.push(logo);
    full += `\n\nThe FIRST attached image is the photo to edit: keep all of its content, framing and realism. ${LOGO_RULES}`;
  }
  if (overlayText) full += `\nAny text you add must read EXACTLY: "${overlayText}" with that exact spelling and capitalisation, crisp and legible, no other words.`;
  const base64 = await openaiEdit(full, image, size, extra, model);
  return { base64, mime: 'image/png', provider: 'openai' };
});

// quick key test
ipcMain.handle('ai:test', async (_e, which) => {
  const s = loadSettings();
  if (which === 'claude') {
    const t = await claudeMessage({ system: 'Reply with the single word OK.', messages: [{ role: 'user', content: 'ping' }], maxTokens: 10, test: true, who: 'key test' });
    return 'Claude replied: ' + t.trim();
  }
  if (which === 'openai') {
    const r = await fetch(OPENAI + '/v1/models', { headers: { authorization: `Bearer ${s.openaiKey}` } });
    if (!r.ok) throw new Error('OpenAI ' + r.status);
    return 'OpenAI key works';
  }
  if (which === 'google') {
    const r = await fetch(`${GOOGLE}/v1beta/models?pageSize=1`, { headers: { 'x-goog-api-key': s.googleKey } });
    if (!r.ok) throw new Error('Google ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return 'Google key works';
  }
  if (which === 'higgsfield') {
    const r = await fetch('https://api.higgsfield.ai/v1/text2image/soul-styles', { headers: { authorization: `Key ${s.higgsfieldKeyId}:${s.higgsfieldSecret}` } });
    if (!r.ok) throw new Error('Higgsfield ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return 'Higgsfield key works';
  }
  throw new Error('unknown');
});
