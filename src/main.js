// Atomax Media Office - Electron main process
// All API keys live here (encrypted on disk) and every outside call is made from here,
// so the 3D page never sees a key.

const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, protocol, net } = require('electron');
const { pathToFileURL } = require('url');
const { autoUpdater } = require('electron-updater');
const social = require('./social');
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
  openaiImageModel: 'gpt-image-2',
  openaiImageModels: [],
  openaiImageQuality: 'high',
  higgsfieldModel: 'higgsfield-ai/soul/standard',
  imageProvider: 'openai',
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

const SECRET_FIELDS = ['anthropicKey', 'openaiKey', 'googleKey', 'higgsfieldKeyId', 'higgsfieldSecret'];
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
      if (process.env.AMO_SCENARIO === 'run') {
        const script = fs.readFileSync(path.join(__dirname, '..', 'test', 'scenario-run.js'), 'utf8');
        await win.webContents.executeJavaScript(`window.__variant = ${JSON.stringify(process.env.AMO_VARIANT || '')}`);
        const out = await win.webContents.executeJavaScript(script);
        console.error('[scenario]', JSON.stringify(out));
      }
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
    autoUpdater.on('update-available', (i) => win?.webContents.send('update:status', { state: 'downloading', version: i.version }));
    autoUpdater.on('download-progress', (p) => win?.webContents.send('update:status', { state: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (i) => win?.webContents.send('update:status', { state: 'ready', version: i.version }));
    autoUpdater.on('error', (e) => win?.webContents.send('update:status', { state: 'error', message: String(e?.message || e) }));
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
ipcMain.handle('agents:get', () => readJson(AGENTS_FILE(), DEFAULT_AGENTS));
ipcMain.handle('agents:set', (_e, a) => { writeJson(AGENTS_FILE(), a); return true; });
ipcMain.handle('agents:reset', () => { writeJson(AGENTS_FILE(), DEFAULT_AGENTS); return DEFAULT_AGENTS; });
ipcMain.handle('posts:get', () => readJson(POSTS_FILE(), []));
ipcMain.handle('posts:set', (_e, p) => { writeJson(POSTS_FILE(), p); return true; });
ipcMain.handle('paths:get', () => ({ userData: USER_DIR() }));
ipcMain.handle('shell:open', (_e, url) => shell.openExternal(url));

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
async function claudeMessage({ system, messages, maxTokens = 4000 }) {
  const s = loadSettings();
  if (!s.anthropicKey) throw new Error('No Claude API key. Add it in Settings.');
  const res = await fetch(ANTHROPIC + '/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': s.anthropicKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model: s.claudeModel, max_tokens: maxTokens, system, messages })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Claude ${res.status}: ${data?.error?.message || JSON.stringify(data)}`);
  return (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
}

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
YOUR FORMAT RULES: ${agent.rules}
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
  const text = await claudeMessage({ system, messages: [{ role: 'user', content }] });
  return extractJson(text);
});

// Revise an existing post ("make it shorter", "add a line about safety")
ipcMain.handle('ai:revisePost', async (_e, { agent, post, instruction }) => {
  const s = loadSettings();
  const system = `You are ${agent.name}, the ${agent.platform} content writer in the ${s.company.name} media office.
${companyBlock(s.company)}
YOUR TONE: ${agent.tone}
YOUR FORMAT RULES: ${agent.rules}
${examplesBlock(agent)}
Revise the post as instructed. Reply with JSON only in the same shape as the original.`;
  const text = await claudeMessage({
    system,
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
WHAT YOU CHECK: ${reviewer.rules}
${examplesBlock(reviewer)}
You are reviewing a ${agent.platform} post written by ${agent.name}.
${agent.name}'s TONE BRIEF: ${agent.tone}
${agent.name}'s FORMAT RULES: ${agent.rules}
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
  const text = await claudeMessage({ system, messages: [{ role: 'user', content }], maxTokens: 1500 });
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
async function openaiGenerate(prompt, size, model, withLogo = true) {
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
async function openaiEdit(prompt, image, size, extraImages = [], model) {
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
async function googleGenerate(prompt, aspect, model, refImages = []) {
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

async function higgsfieldGenerate(prompt, aspect) {
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
    const t = await claudeMessage({ system: 'Reply with the single word OK.', messages: [{ role: 'user', content: 'ping' }], maxTokens: 10 });
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
