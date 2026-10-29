// Milo (3D modeller) and Vera (model checker): main-process side. Reads the context folder, asks Claude for questions or an edit list,
// asks Claude to review the result. The 3D work itself happens in the renderer (moder.js) on a copy of the model.
const fs = require('fs');
const path = require('path');

const TEXT_EXT = /\.(txt|md|markdown|json|log|csv|tsv|xml|yaml|yml|ini)$/i;
const IMG_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const MODEL_EXT = /\.(glb|gltf|obj|stl)$/i;
const SKIP = /^(~\$|\.|node_modules$|thumbs\.db$)/i;
const MAX_FILES = 40, MAX_TEXT = 15000, MAX_PDF = 12 * 1048576, MAX_IMG = 5 * 1048576, MAX_MODEL = 60 * 1048576;

const MO_SYSTEM = `You are Milo, a careful 3D modeller at an engineering company. You are given a 3D model (a text description of its named parts and their positions, plus pictures of it), the engineer's request, and context (notes, drawings, photos, schedules). You change a COPY of the model to do what the engineer asked.

You never edit by hand: you reply with JSON only, in one of two shapes.

1. Questions, when you genuinely cannot do the job right without an answer (pipe size, which side, what height, ambiguous route, units unclear). At most 4, short, specific, each answerable in a few words. Do not ask for things you can read from the context or the model, and do not ask about minor details (state an assumption instead).
{"status":"questions","questions":["..."]}

2. An edit list:
{"status":"ready","summary":"one or two plain sentences of what you did","assumptions":["each assumption you made, short"],"ops":[ ... ]}

Coordinates are in the model's own units (see the overall box), Y up. Use the part positions you are given (min/max boxes) to work out real coordinates: "along the back of the rail" means next to that part's box on its back side, not somewhere guessed. Keep new parts clear of existing parts unless the request says to connect to them; leave a sensible gap (a pipe's own radius plus clearance).

Edit operations (all numbers are plain numbers, colours are hex like "#2f6fb5"):
- {"op":"add_pipe","name":"...","points":[[x,y,z],[x,y,z],...],"radius":n,"colour":"#...","flanges":true|false}  straight runs between points, joined at each point. Use several points for bends.
- {"op":"add_box","name":"...","size":[x,y,z],"position":[x,y,z] (centre),"rotation_y_deg":n,"colour":"#..."}
- {"op":"add_cylinder","name":"...","radius":n,"height":n,"axis":"x"|"y"|"z","position":[x,y,z] (centre),"colour":"#..."}
- {"op":"move","node":"existing part name","by":[x,y,z]}   or   {"op":"move","node":"...","to":[x,y,z]} (new centre)
- {"op":"rotate","node":"...","axis":"x"|"y"|"z","degrees":n}
- {"op":"scale","node":"...","factor":n or [x,y,z]}
- {"op":"delete","node":"..."}
- {"op":"recolour","node":"...","colour":"#..."}
Use the exact part names you were given. Give every new part a clear descriptive name. Only do what was asked. Never invent dimensions when they are given in the context: use the given ones. If the engineer later answers your questions, use the answers. If you are given checker findings to fix, fix those and keep everything else the same by returning the full corrected edit list.`;

const THEO_SYSTEM = `You are Theo, a practical 3D builder at an engineering company. You build a 3D model FROM SCRATCH out of simple shapes, from the engineer's prompt and the context (notes, drawings, schedules, photos, datasheets). If existing 3D models are given, build around them. You are given pictures of any existing models, the context, and the request.

You never build by hand: you reply with JSON only, in one of two shapes.

1. Questions, only when you genuinely cannot build it right without an answer (key sizes, quantities, layout, which standard). At most 4, short, specific, answerable in a few words. Do not ask for things you can read from the context, and do not ask about minor details (state an assumption instead).
{"status":"questions","questions":["..."]}

2. A build list:
{"status":"ready","summary":"one or two plain sentences of what you built","assumptions":["each assumption, short"],"ops":[ ... ]}

Use METRES, Y up, the floor at y = 0, X left-right, Z toward the viewer, unless the context clearly uses other units (then still convert to metres and say so in assumptions). Use the real sizes from the context. Lay the model out sensibly and build it in the order a person would: main bodies first, then connections, supports and details. Parts must sit on the floor or on each other, touching where they should, not floating and not overlapping each other by accident. Stay simple and accurate: real proportions matter more than detail.

Shapes (numbers are plain numbers, colours are hex like "#2f6fb5"; positions are the CENTRE of the shape unless stated):
- {"op":"add_box","name":"...","size":[x,y,z],"position":[x,y,z],"rotation_x_deg":n,"rotation_y_deg":n,"rotation_z_deg":n,"colour":"#..."}
- {"op":"add_cylinder","name":"...","radius":n,"height":n,"axis":"x"|"y"|"z","position":[x,y,z],"colour":"#..."}
- {"op":"add_sphere","name":"...","radius":n,"position":[x,y,z],"scale":[x,y,z] (optional, squashes it into a dome or ellipsoid),"colour":"#..."}
- {"op":"add_cone","name":"...","radius":n (base),"height":n,"axis":"x"|"y"|"z","position":[x,y,z],"colour":"#..."}
- {"op":"add_pipe","name":"...","points":[[x,y,z],[x,y,z],...],"radius":n,"colour":"#...","flanges":true|false}  straight runs joined at each point; use several points for bends
- {"op":"add_extrusion","name":"...","profile":[[x,z],[x,z],...] (corners of a flat outline on the floor plane, in order),"base_y":n (height of the bottom),"height":n,"colour":"#..."}  for plates, bases, walls, L-shapes, slabs
Give every part a clear descriptive name (for example "Tank T-101 shell"). Only build what was asked. If you are given checker findings to fix, return the FULL corrected build list that fixes them.`;

const VERA_SYSTEM = `You are Vera, a picky but fair 3D model checker at an engineering company. Another modeller (Milo) changed a copy of a 3D model to match the engineer's request. You check the result against the request and the context. You get the request, the context, the list of edits Milo made, results of a computed clash test (boxes overlapping), and pictures (new parts are shown in red).

Check: does the result do what was asked, in the right place and size; do the numbers match the context (sizes, heights, clearances); do new parts clash with existing parts or float in the air; are the units sensible; did Milo state sensible assumptions; is anything asked for missing; did he change anything that was not asked. If there was no existing model, the whole model was built from scratch: check it is complete against the request and context (every part asked for, real sizes, parts sitting on the floor or on each other, supports present, nothing floating or sunk into something else). Say honestly when you cannot tell from what you were given. Never invent facts.

Reply with JSON only: {"verdict":"pass"|"fix","score":1-10,"summary":"one plain sentence","findings":[{"severity":"fix"|"look","text":"short and specific"}],"good":["short things that are right"]}
"fix" = something must change before it goes out; "look" = worth a human glance. Below 6 is a fix. Keep findings short and specific.`;

function register({ ipcMain, dialog, getWin, userDir, claudeFull, checker, log }) {
  const wrap = (fn) => async (_e, a) => fn(a || {});
  const send = (p) => { try { const w = getWin(); w && w.webContents.send('mo:progress', p); } catch {} };

  async function docxText(buf) {
    const JSZip = require('jszip'); const z = await JSZip.loadAsync(buf); const f = z.file('word/document.xml'); if (!f) return '';
    const xml = await f.async('string');
    return xml.replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, '\t').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  }

  // one file -> something Claude can read (or a model for the viewer), or null
  async function readOne(full, rel) {
    const name = path.basename(full), st = fs.statSync(full), ext = path.extname(name).slice(1).toLowerCase();
    if (MODEL_EXT.test(name)) { if (st.size > MAX_MODEL) return { name, rel, kind: 'skipped', why: 'model is over 60 MB' }; return { name, rel, kind: 'model', base64: fs.readFileSync(full).toString('base64'), bytes: st.size }; }
    if (ext === 'pdf') { if (st.size > MAX_PDF) return { name, rel, kind: 'skipped', why: 'PDF is over 12 MB' }; return { name, rel, kind: 'pdf', base64: fs.readFileSync(full).toString('base64'), bytes: st.size }; }
    if (IMG_MIME[ext]) { if (st.size > MAX_IMG) return { name, rel, kind: 'skipped', why: 'image is over 5 MB' }; return { name, rel, kind: 'image', mime: IMG_MIME[ext], base64: fs.readFileSync(full).toString('base64'), bytes: st.size }; }
    if (TEXT_EXT.test(name)) return { name, rel, kind: 'text', text: fs.readFileSync(full, 'utf8').slice(0, MAX_TEXT), bytes: st.size };
    if (ext === 'docx') { try { return { name, rel, kind: 'text', text: (await docxText(fs.readFileSync(full))).slice(0, MAX_TEXT), bytes: st.size }; } catch { return { name, rel, kind: 'skipped', why: 'could not read this Word file' }; } }
    if (ext === 'xlsx' || ext === 'xlsm') { try { return { name, rel, kind: 'text', text: checker.sheetsAsText(checker.readXlsx(fs.readFileSync(full)), MAX_TEXT), bytes: st.size }; } catch { return { name, rel, kind: 'skipped', why: 'could not read this spreadsheet' }; } }
    return { name, rel, kind: 'skipped', why: 'Milo cannot read ' + (ext ? '.' + ext : 'this') + ' files (DWG/DXF/STEP: export a PDF or GLB)' };
  }

  async function readFolder(dir) {
    const root = path.resolve(String(dir || '')); if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('That is not a folder.');
    const out = [], skipped = [];
    const walk = async (d, depth) => {
      for (const ent of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (SKIP.test(ent.name)) continue;
        const full = path.join(d, ent.name), rel = path.relative(root, full);
        if (ent.isDirectory()) { if (depth < 3) await walk(full, depth + 1); continue; }
        if (out.length >= MAX_FILES) { skipped.push({ name: rel, why: 'folder has more than ' + MAX_FILES + ' files' }); continue; }
        try { const r = await readOne(full, rel); if (r.kind === 'skipped') skipped.push({ name: rel, why: r.why }); else out.push(r); } catch (e) { skipped.push({ name: rel, why: e.message }); }
      }
    };
    await walk(root, 0);
    return { dir: root, files: out, skipped };
  }

  ipcMain.handle('mo:pickFolder', wrap(async () => {
    const d = process.env.AMO_MO_DIR || (await (async () => { const r = await dialog.showOpenDialog(getWin(), { properties: ['openDirectory'] }); return r.canceled ? null : r.filePaths[0]; })());
    return d ? readFolder(d) : null;
  }));
  ipcMain.handle('mo:readFolder', wrap(async ({ dir }) => readFolder(dir)));
  ipcMain.handle('mo:readFiles', wrap(async ({ paths }) => {
    const files = [], skipped = [];
    for (const p of (Array.isArray(paths) ? paths : []).slice(0, 40)) {
      try { const full = path.resolve(String(p)); if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) continue; const r = await readOne(full, path.basename(full)); if (r.kind === 'skipped') skipped.push({ name: r.name, why: r.why }); else files.push(r); } catch (e) { skipped.push({ name: String(p), why: e.message }); }
    }
    return { files, skipped };
  }));

  // context blocks shared by Milo and Vera
  function contextBlocks(context) {
    const blocks = []; let texts = [];
    for (const c of (context || []).slice(0, 30)) {
      if (c.kind === 'text') texts.push(`--- ${c.name} ---\n${String(c.text || '').slice(0, MAX_TEXT)}`);
    }
    if (texts.length) blocks.push({ type: 'text', text: 'Context documents:\n\n' + texts.join('\n\n') });
    let pdfs = 0, imgs = 0;
    for (const c of (context || [])) {
      if (c.kind === 'pdf' && pdfs < 5) { pdfs++; blocks.push({ type: 'text', text: 'Context PDF: ' + c.name }); blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: c.base64 } }); }
      else if (c.kind === 'image' && imgs < 6) { imgs++; blocks.push({ type: 'text', text: 'Context photo: ' + c.name }); blocks.push({ type: 'image', source: { type: 'base64', media_type: c.mime || 'image/jpeg', data: c.base64 } }); }
    }
    return blocks;
  }
  const viewBlocks = (views) => (views || []).slice(0, 4).flatMap(v => [{ type: 'text', text: 'View: ' + v.label }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: v.base64 } }]);
  const parse = (t) => { const r = checker.parseJson(t); return r && r.value ? r.value : null; };

  ipcMain.handle('mo:plan', wrap(async ({ request, modelText, views, context, answers, previous, feedback, model, mode }) => {
    const build = mode === 'build';
    if (!String(request || '').trim() && !feedback) throw new Error('Tell Milo what you want changed first.');
    send({ message: (build ? 'Theo' : 'Milo') + ' is reading the request and the context' });
    const content = [...contextBlocks(context), { type: 'text', text: '3D model as it is now:\n' + String(modelText || '(no model)') }, ...viewBlocks(views)];
    let t = `The engineer's request:\n<request>${String(request || '').slice(0, 6000)}</request>`;
    if (Array.isArray(answers) && answers.length) t += '\n\nYour earlier questions and the engineer\'s answers:\n' + answers.map(a => `Q: ${a.q}\nA: ${a.a}`).join('\n');
    if (previous && previous.ops) t += `\n\nYour previous edit list (already applied to the model you can see in red):\n${JSON.stringify(previous.ops).slice(0, 8000)}`;
    if (feedback) t += `\n\nFix these before it goes out. Return the FULL corrected edit list (the previous edits that were fine, plus the corrections). The model shown above is the ORIGINAL, before your edits.\n<feedback>${String(feedback).slice(0, 4000)}</feedback>`;
    t += '\n\nReply with JSON only.';
    content.push({ type: 'text', text: t });
    send({ message: build ? 'Theo is working out how to build it' : 'Milo is working out the changes' });
    let j = null;
    for (let i = 0; i < 2 && !j; i++) {
      const r = await claudeFull({ system: build ? THEO_SYSTEM : MO_SYSTEM, model: model || undefined, maxTokens: build ? 12000 : 8000, messages: [{ role: 'user', content }] });
      j = parse(r.text);
      if (j && j.status !== 'questions' && !Array.isArray(j.ops)) j = null;
    }
    if (!j) throw new Error((build ? 'Theo' : 'Milo') + ' did not give a usable answer. Try again.');
    if (j.status === 'questions') return { status: 'questions', questions: (j.questions || []).map(String).slice(0, 4) };
    return { status: 'ready', summary: String(j.summary || ''), assumptions: (j.assumptions || []).map(String).slice(0, 12), ops: j.ops.slice(0, 200) };
  }));

  ipcMain.handle('mo:check', wrap(async ({ request, modelText, views, context, ops, lines, clashes, notes, assumptions, jobId, model, mode }) => {
    send({ message: 'Vera is checking the model' });
    const content = [...contextBlocks(context), { type: 'text', text: 'Model after the edits (as it is now):\n' + String(modelText || '') }, ...viewBlocks(views)];
    content.push({ type: 'text', text: `The engineer's request:\n<request>${String(request || '').slice(0, 6000)}</request>\n\n${mode === 'build' ? 'There was NO existing model. This model was built from scratch by Theo.\n\n' : ''}${mode === 'build' ? 'What Theo built' : 'Edits Milo made'}:\n${(lines || []).join('\n')}\n\n${mode === 'build' ? "Theo's" : "Milo's"} assumptions:\n${(assumptions || []).map(a => '- ' + a).join('\n') || '(none)'}\n\nComputed clash test (boxes overlapping, depth in model units):\n${JSON.stringify(clashes || [])}\nComputed notes: ${(notes || []).join(' ')}\n\nReply with JSON only.` });
    let j = null;
    for (let i = 0; i < 2 && !j; i++) {
      const r = await claudeFull({ system: VERA_SYSTEM, model: model || undefined, maxTokens: 3000, messages: [{ role: 'user', content }] });
      j = parse(r.text);
    }
    if (!j) throw new Error('Vera did not give a usable answer. Try again.');
    const findings = (j.findings || []).map(f => ({ severity: f.severity === 'fix' ? 'fix' : 'look', text: String(f.text || '') })).slice(0, 20);
    const score = Math.max(1, Math.min(10, Math.round(+j.score || 5)));
    const verdict = j.verdict === 'pass' && score >= 6 && !findings.some(f => f.severity === 'fix') ? 'pass' : 'fix';
    if (log) log({ who: 'Vera', action: verdict === 'pass' ? 'Passed' : 'Sent back', jobId: jobId || '', detail: `3D model check · ${score}/10 · ${String(j.summary || '').slice(0, 160)}` });
    return { verdict, score, summary: String(j.summary || ''), findings, good: (j.good || []).map(String).slice(0, 8) };
  }));

  // the finished model goes beside the other models; a copy can also go into a folder the person picks
  ipcMain.handle('mo:save', wrap(async ({ base64, name, jobId, summary, mode }) => {
    const buf = Buffer.from(String(base64 || ''), 'base64');
    if (buf.length < 20 || buf.toString('ascii', 0, 4) !== 'glTF') throw new Error('Not a GLB file.');
    const dir = path.join(userDir(), 'models'); fs.mkdirSync(dir, { recursive: true });
    const safe = String(name || 'model').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-').slice(0, 40) || 'model';
    const file = path.join(dir, `${safe}-${mode === 'build' ? 'THEO' : 'MILO'}-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}.glb`);
    fs.writeFileSync(file, buf);
    if (log) log({ who: mode === 'build' ? 'Theo' : 'Milo', action: mode === 'build' ? 'Built' : 'Modelled', jobId: jobId || '', detail: `${path.basename(file)} · ${String(summary || '').slice(0, 200)}` });
    return { path: file, bytes: buf.length };
  }));
  ipcMain.handle('mo:saveAs', wrap(async ({ from }) => {
    const r = process.env.AMO_SAVE_AS ? { canceled: false, filePath: process.env.AMO_SAVE_AS } : await dialog.showSaveDialog(getWin(), { defaultPath: path.basename(String(from || 'model.glb')), filters: [{ name: '3D model', extensions: ['glb'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.copyFileSync(String(from), r.filePath); return { path: r.filePath };
  }));
  // a script or route list for AutoCAD / Plant 3D: the person picks where it goes
  ipcMain.handle('mo:saveText', wrap(async ({ text, name, ext }) => {
    const e = String(ext || 'txt').replace(/[^a-z0-9]/gi, '').slice(0, 4) || 'txt';
    const base = String(name || 'milo').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-').slice(0, 40) || 'milo';
    const r = process.env.AMO_SAVE_AS ? { canceled: false, filePath: process.env.AMO_SAVE_AS + '.' + e } : await dialog.showSaveDialog(getWin(), { defaultPath: `${base}-MILO.${e}`, filters: [{ name: e.toUpperCase() + ' file', extensions: [e] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, String(text || ''), e === 'scr' ? 'latin1' : 'utf8');
    if (log) log({ who: 'Milo', action: 'Exported', detail: `${path.basename(r.filePath)} for AutoCAD / Plant 3D` });
    return { path: r.filePath };
  }));
  return { readFolder };
}
module.exports = { register, MO_SYSTEM, THEO_SYSTEM, VERA_SYSTEM };
