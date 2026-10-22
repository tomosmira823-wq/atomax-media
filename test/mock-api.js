// Local stand-in for the Anthropic + OpenAI endpoints so the whole app can be exercised without real keys.
// Start: node test/mock-api.js   (listens on 127.0.0.1:52900). The app routes to it when AMO_MOCK=1.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PNG = fs.readFileSync(path.join(__dirname, '..', 'src', 'icon-512.png')).toString('base64');
let calls = [];

function readBody(req) { return new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); }); }

function claudeReply(body) {
  const sys = body.system || '';
  const userText = JSON.stringify(body.messages || []);
  // reviewer?
  if (/a reviewer in the/.test(sys)) {
    const score = /LinkedIn/.test(sys) ? 6 : 8;
    return JSON.stringify({ score, verdict: score >= 7 ? 'pass' : 'fix', summary: `Mock review: ${score >= 7 ? 'good' : 'needs a stronger hook'}.`, good: ['Spelling fine', 'Length within rules'], issues: score >= 7 ? [] : ['Hook is generic', 'Doesn\'t mention commissioning'], fixedCaption: score >= 7 ? '' : 'Mock improved caption.\n\n#Fixed' });
  }
  if (/Revise the post as instructed/.test(sys)) return JSON.stringify({ hook: 'Revised hook', caption: 'Revised caption from mock.\n\n#Revised', hashtags: ['Revised'], altText: 'alt', imageIdea: 'idea', bestTime: 'Mon 9am', notes: '', overlayText: 'Revised banner' });
  if (/image editor/.test(sys)) return 'Mock image analysis: switchgear panels, three suggested edits.';
  if (/company profile for a social media team/.test(sys)) return JSON.stringify({ name: 'Atomax-UK Ltd', about: 'Mock about from site.', services: ['Electrical design', 'Document control'], sectors: ['Utilities'], clients: [], audience: 'Engineering managers', tone: 'Plain and confident', facts: ['Based in Ellesmere Port'], knowledge: 'Mock knowledge digest from the website pages.' });
  const platform = (sys.match(/YOUR PLATFORM: (.+)/) || [])[1] || 'Platform';
  const name = (sys.match(/You are (\w+),/) || [])[1] || 'Agent';
  const hasImage = /POST IMAGE 1/.test(userText);
  const imgBrief = (/THE IMAGE THAT WILL BE POSTED WILL SHOW/.test(sys) ? 'image-brief-seen ' : '');
  const ref = /REFERENCE MATERIAL/.test(userText) ? 'ref-seen ' : '';
  // deliberately long so the reply would have been cut off at the old 1500 limit
  const filler = ' Lorem ipsum dolor sit amet, consectetur adipiscing elit.'.repeat(platform === 'LinkedIn' ? 14 : 4);
  return `Sure, here is the JSON:\n` + JSON.stringify({
    hook: `${name}'s ${platform} hook`,
    caption: `[${platform}] ${imgBrief}${ref}${hasImage ? 'photo-seen ' : ''}Mock caption for ${platform} by ${name}.${filler}\n\n#Atomax #${platform.replace(/\W/g, '')}`,
    hashtags: ['Atomax', platform.replace(/\W/g, '')],
    altText: `Alt text for ${platform}`,
    imageIdea: `Platform-specific art direction for ${platform}`,
    bestTime: 'Tue 8am',
    notes: 'mock',
    overlayText: `Banner for ${platform}`
  }, null, 2);
}

http.createServer(async (req, res) => {
  const raw = await readBody(req);
  const u = req.url;
  calls.push({ url: u, method: req.method, len: raw.length });
  const json = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(o)); };
  try {
    if (u === '/__calls') return json(calls);
    if (u.startsWith('/site')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(`<html><head><title>Atomax-UK ${u}</title></head><body><nav><a href="/site/about">About</a></nav><h1>Atomax-UK Engineering Consultants</h1><p>${'We provide electrical design, instrumentation drawings and document control for industrial clients. '.repeat(8)}</p><a href="/site/services">Services</a><a href="/site/contact">Contact</a></body></html>`); }
    if (u === '/__reset') { calls = []; return json({ ok: true }); }
    if (u.startsWith('/anthropic/v1/messages')) {
      const body = JSON.parse(raw.toString());
      const text = claudeReply(body);
      // simulate an occasional cut-off reply on the Facebook writer to exercise the JSON repair
      const cut = /YOUR PLATFORM: Facebook/.test(body.system) && !/Revise/.test(body.system) && !/reviewer/.test(body.system);
      return json({ content: [{ type: 'text', text: cut ? text.slice(0, Math.floor(text.length * 0.8)) : text }], stop_reason: cut ? 'max_tokens' : 'end_turn' });
    }
    if (u.startsWith('/openai/v1/models')) return json({ data: ['gpt-image-2.5-flare', 'gpt-image-2', 'gpt-image-1', 'dall-e-3', 'gpt-4o'].map(id => ({ id })) });
    if (u.startsWith('/openai/v1/images/generations') || u.startsWith('/openai/v1/images/edits')) {
      await new Promise(r => setTimeout(r, 300));
      return json({ data: [{ b64_json: PNG }] });
    }
    // ---- social publish mocks ----
    if (u.startsWith('/li/rest/images?action=initializeUpload')) return json({ value: { uploadUrl: 'http://127.0.0.1:52900/li/upload', image: 'urn:li:image:MOCK' } });
    if (u.startsWith('/li/upload')) { res.writeHead(201); return res.end(); }
    if (u.startsWith('/li/rest/posts')) { res.writeHead(201, { 'x-restli-id': 'urn:li:share:12345' }); return res.end(); }
    if (/^\/fb\/\d+\/photos/.test(u)) return json({ id: '777', post_id: '111_222' });
    if (/^\/fb\/\d+\/feed/.test(u)) return json({ id: '111_333' });
    if (/^\/fb\/777\?fields=images/.test(u)) return json({ images: [{ source: 'http://127.0.0.1:52900/fb/cdn.png' }] });
    if (/^\/fb\/\d+\/media\?|^\/fb\/\d+\/media$/.test(u) && req.method === 'POST') return json({ id: '888' });
    if (/^\/fb\/888\?fields=status_code/.test(u)) return json({ status_code: 'FINISHED' });
    if (/^\/fb\/\d+\/media_publish/.test(u)) return json({ id: '999' });
    if (/^\/fb\/999\?fields=permalink/.test(u)) return json({ permalink: 'https://www.instagram.com/p/MOCK/' });
    if (u.startsWith('/x/2/media/upload')) return json({ data: { id: '555' } });
    if (u.startsWith('/x/2/tweets')) return json({ data: { id: '444' } });
    json({ error: { message: 'mock: unknown ' + u } }, 404);
  } catch (e) { json({ error: { message: String(e) } }, 500); }
}).listen(52900, '127.0.0.1', () => console.log('mock api on 52900'));
