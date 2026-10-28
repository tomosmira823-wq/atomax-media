// Local stand-in for the Anthropic + OpenAI endpoints so the whole app can be exercised without real keys.
// Start: node test/mock-api.js   (listens on 127.0.0.1:52900). The app routes to it when AMO_MOCK=1.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PNG = fs.readFileSync(path.join(__dirname, '..', 'src', 'icon-512.png')).toString('base64');
let calls = [];
let meshyPolls = 0;

function readBody(req) { return new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); }); }

function claudeReply(body) {
  const sys = body.system || '';
  const userText = JSON.stringify(body.messages || []);
  // ---- Milo (3D modeller) and Vera (model checker) ----
  if (/You are Milo/.test(sys)) {
    if (/pipe/i.test(userText) && !/Your earlier questions/.test(userText)) return JSON.stringify({ status: 'questions', questions: ['What diameter should the pipe be?', 'Which side of the rail is the back?'] });
    const fixing = /Vera \(model checker\) sent it back/.test(userText);
    const ops = [{ op: 'add_pipe', name: 'New pipe', points: [[0.5, 0.35, -0.6], [9.5, 0.35, -0.6], [9.5, 0.35, 2]], radius: 0.075, colour: '#2f6fb5', flanges: true }, { op: 'recolour', node: 'Rail', colour: '#888888' }, { op: 'move', node: 'Nothing here', by: [1, 0, 0] }];
    if (fixing) ops.push({ op: 'add_box', name: 'Pipe support', size: [0.2, 0.3, 0.2], position: [5, 0.15, -0.6], colour: '#444444' });
    return JSON.stringify({ status: 'ready', summary: fixing ? 'Added a support under the pipe.' : 'Ran a 150 mm pipe behind the rail.', assumptions: ['Back of the rail is the -Z side', 'Pipe centre 350 mm above the floor'], ops });
  }
  if (/You are Vera/.test(sys)) {
    const hasSupport = /Pipe support/.test(userText);
    return JSON.stringify(hasSupport ? { verdict: 'pass', score: 9, summary: 'Pipe is in the right place and supported.', findings: [], good: ['Pipe size matches the notes', 'No clashes'] } : { verdict: 'fix', score: 5, summary: 'The pipe has no support.', findings: [{ severity: 'fix', text: 'A pipe this long needs a support under it.' }], good: ['Route is right'] });
  }
  // ---- Cal (drawing checker) ----
  if (/map the columns/.test(sys)) return JSON.stringify({ sheets: [{ sheet: 'CSV', isSchedule: true, headerRow: 1, firstDataRow: 2, cols: { tag: 'A', from: 'B', to: 'C', type: 'D', drawing: 'E' } }] });
  if (/reading ONE source document/.test(sys)) {
    const name = (userText.match(/Document file name: ([^\\]+?)\\n/) || [])[1];
    const note = /ENGINEER:/.test(sys) ? 'note-seen' : '';
    return 'Here you go:\n' + JSON.stringify({ docType: 'loop', sheets: [{ page: 1, drawingNumber: 'DRG-001', title: note, status: 'live', cables: [{ tag: 'C_101', from: 'JB-1', to: 'PLC-RIO1', type: '2C 1.5mm SWA' }, { tag: 'C-102', from: 'JB-2', to: 'PLC/RIO1', type: 'Instrument 2PR' }, { tag: 'C-105', from: 'JB-5', to: 'PLC/RIO1', type: '' }], interfaceCables: [], typos: [] }] });
  }
  if (/judge possible mismatches/.test(sys)) { const items = JSON.parse(body.messages[0].content[0].text); return JSON.stringify({ verdicts: items.map(i => ({ id: i.id, real: !/1\.5mm/.test(i.drawing) && i.schedule !== i.drawing, confirm: false, reason: '' })) }); }
  if (/left you a note/.test(sys)) return JSON.stringify({ answer: 'Mock answer to your note.', extra: [] });
  if (/ONE engineering drawing PDF/.test(sys)) {
    const name = (userText.match(/\(file: ([^)]+)\)/) || [])[1] || '';
    const no = (name.match(/X\d{6}-\d{2}-\d{2}-\d{4}/) || [''])[0]; const rev = (name.match(/_([A-Z]\d{2})\./) || [])[1] || '';
    return JSON.stringify({ no, title: 'Mock title', rev: /_P00/.test(name) ? 'P01' : rev, dead: /_C02/.test(name), deadWhy: /_C02/.test(name) ? 'SUPERSEDED stamp' : '' });
  }
  if (/drawing transmittal \/ drawing register/.test(sys)) return JSON.stringify({ rows: [{ no: 'X123456-10-20-0042', rev: 'P02', title: 'Loop' }, { no: 'X123456-10-20-0043', rev: 'P01', title: 'Cable' }] });
  if (/You write the body of an engineering consultancy document/.test(sys)) return JSON.stringify({ documentTitle: 'Mock RAMS', projectDetails: [{ label: 'Site', value: 'TBC' }], sections: [{ content: [{ type: 'heading1', text: 'Scope of Works' }, { type: 'paragraph', text: 'Mock scope from: ' + userText.slice(0, 40).replace(/[^\w ]/g, '') }, { type: 'dataTable', headers: ['Step', 'Activity'], rows: [['1', 'Isolate'], ['2', 'Test']] }] }] });
  if (/You edit the text in engineering DXF/.test(sys)) {
    const msg = body.messages[0].content; const rows = String(typeof msg === 'string' ? msg : msg[0].text).split('\n').filter(l => /^\d+ \| /.test(l)).map(l => l.split(' | '));
    const file = (String(typeof msg === 'string' ? msg : msg[0].text).match(/FILE: (.+)/) || [])[1];
    const items = [];
    for (const r of rows) { if (/Dyn1l/.test(r[6])) items.push({ file, ref: +r[0], action: 'replace_text', before: 'Dyn1l', after: 'Dyn11', why: 'Vector group typo' }); if (/SAMPLE ONLY/.test(r[6])) items.push({ file, ref: +r[0], action: 'delete_text', why: 'Asked to remove it' }); }
    if (/add rev c/i.test(JSON.stringify(body.messages))) items.push({ file, action: 'add_text', text: 'REV C', x: 10, y: 20, layer: 'ANNOT', height: 2.5, why: 'Asked to add it' });
    return JSON.stringify({ items });
  }
  if (/red CHECK NOTES/.test(sys)) return JSON.stringify({ items: [{ drawing: 'DRG-001', note: 'Typo on the drawing', action: 'replace_text', before: 'C-1O1', after: 'C-101', why: 'typo' }, { drawing: 'DRG-001', note: 'Schedule says 2C', action: 'none', why: 'Schedule change' }] });
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
    if (u === '/__reset') { calls = []; meshyPolls = 0; return json({ ok: true }); }
    if (u.startsWith('/anthropic/v1/messages')) {
      const body = JSON.parse(raw.toString());
      const text = claudeReply(body);
      // simulate an occasional cut-off reply on the Facebook writer to exercise the JSON repair
      const cut = /YOUR PLATFORM: Facebook/.test(body.system) && !/Revise/.test(body.system) && !/reviewer/.test(body.system);
      return json({ content: [{ type: 'text', text: cut ? text.slice(0, Math.floor(text.length * 0.8)) : text }], stop_reason: cut ? 'max_tokens' : 'end_turn' });
    }
    if (u.startsWith('/google/v1beta/interactions')) { const b = JSON.parse(raw.toString()); calls[calls.length - 1].refs = (b.input || []).filter(x => x.type === 'image').length; return json({ id: 'int_1', steps: [{ type: 'model_output', content: [{ type: 'image', mime_type: 'image/png', data: PNG }] }], output_image: { data: PNG } }); }
    if (u.startsWith('/google/v1beta/models'))  return json({ models: [{ name: 'models/gemini-nano-banana-2.1' }] });
    if (u.startsWith('/openai/v1/models')) return json({ data: ['gpt-image-2.5-flare', 'gpt-image-2', 'gpt-image-1', 'dall-e-3', 'gpt-4o'].map(id => ({ id })) });
    if (u.startsWith('/openai/v1/images/generations') || u.startsWith('/openai/v1/images/edits')) {
      await new Promise(r => setTimeout(r, 300));
      return json({ data: [{ b64_json: PNG }] });
    }
    // ---- modeling room: photo -> GLB (Meshy-style and Higgsfield-style) ----
    if (u === '/files/model.glb') { res.writeHead(200, { 'content-type': 'model/gltf-binary' }); return res.end(fs.readFileSync(path.join(__dirname, '..', 'src', 'assets', 'models', (process.env.MOCK_GLB || 'bookcase') + '.glb'))); }
    if (u === '/meshy/openapi/v1/image-to-3d' && req.method === 'POST') { const b = JSON.parse(raw.toString()); calls[calls.length - 1].dataUri = /^data:image\/(jpeg|png);base64,/.test(b.image_url || ''); calls[calls.length - 1].auth = req.headers.authorization; return json({ result: 'task1' }); }
    if (u === '/meshy/openapi/v1/image-to-3d/task1') { meshyPolls++; return json(meshyPolls < 2 ? { status: 'IN_PROGRESS', progress: 40 } : { status: 'SUCCEEDED', progress: 100, model_urls: { glb: 'http://127.0.0.1:52900/files/model.glb' } }); }
    if (u.startsWith('/higgsfield/requests/')) return json({ status: 'completed', result: { model: { url: 'http://127.0.0.1:52900/files/model.glb' } } });
    if (u.startsWith('/higgsfield/') && req.method === 'POST') { const b = JSON.parse(raw.toString()); calls[calls.length - 1].dataUri = /^data:image\//.test(b.image_url || ''); calls[calls.length - 1].auth = req.headers.authorization; return json({ request_id: 'r1', status_url: 'http://127.0.0.1:52900/higgsfield/requests/r1/status' }); }
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
