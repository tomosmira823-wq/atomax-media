// The agents' eyes and hands on drawings, as tools in an in-process MCP server for the Claude Agent SDK:
// render_drawing, zoom, run_checks, compare, find_entities, edit_dxf, make_drawing (Dex's engine as one tool among the others), ask_tom.
// Every file a tool writes goes in this run's own work folder; originals are only ever read.
'use strict';
const fs = require('fs'), path = require('path');
const R = require('./dxfread'), D = require('./drawrender'), C = require('./drawcheck'), E = require('./dxfedit');

const img = (buf) => ({ type: 'image', data: buf.toString('base64'), mimeType: 'image/png' });
const txt = (t) => ({ type: 'text', text: String(t) });
const fail = (e) => ({ content: [txt('ERROR: ' + (e && e.message || e))], isError: true });
const inside = (p, dir) => { const r = path.relative(path.resolve(dir), path.resolve(p)); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

function toolsFor(ctx, { tool, z }) {
  // ctx: { jobDir, workDir, readDirs: [], cables: [], makeDrawing(spec) -> { files:[dxf...], note }, onQuestion(q), log(line) }
  const roots = [ctx.workDir, ctx.jobDir, ...(ctx.readDirs || [])].filter(Boolean);
  const resolve = (f) => {
    const s = String(f || '').trim(); if (!s) throw new Error('Give the file');
    const cands = path.isAbsolute(s) ? [s] : roots.map(r => path.join(r, s));
    const hit = cands.find(p => fs.existsSync(p)); if (!hit) throw new Error(`No such file: ${s}`);
    if (!roots.some(r => inside(hit, r))) throw new Error(`${s} is outside the job folder: not allowed`);
    return hit;
  };
  const newOut = (want, ext) => {   // a new file in the work folder, never over an existing one
    fs.mkdirSync(ctx.workDir, { recursive: true });
    const stem = path.basename(String(want || 'drawing'), path.extname(String(want || ''))).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 90) || 'drawing';
    let p = path.join(ctx.workDir, stem + ext), i = 2; while (fs.existsSync(p)) p = path.join(ctx.workDir, `${stem}_${i++}${ext}`); return p;
  };
  const cache = new Map();
  const drawingOf = (file, layout) => { const p = resolve(file), k = p + '|' + (layout || '') + '|' + fs.statSync(p).mtimeMs; if (!cache.has(k)) cache.set(k, R.read(p, { space: layout || 'auto' })); return { p, d: cache.get(k) }; };
  const picOf = async (file, opts = {}) => {
    const p = resolve(file);
    if (/\.pdf$/i.test(p)) { const pg = await D.pdfPage(p, { px: 2400 }); if (!opts.region) return { ...pg, info: `${path.basename(p)} (PDF page 1)` }; const b = D.regionOf(opts.region, { x0: 0, y0: 0, x1: 1, y1: 1 }); return { ...D.cropPng(pg.png, b), info: `${path.basename(p)} region ${opts.region}` }; }
    if (/\.png$/i.test(p)) { const buf = fs.readFileSync(p); return { png: buf, ...D.pngSize(buf), info: path.basename(p) }; }
    const { d } = drawingOf(p, opts.layout); const pic = D.picture(d, { region: opts.region, px: opts.px || 2000 });
    return { ...pic, info: `${path.basename(p)} · ${d.space === 'model' ? 'model space' : 'layout ' + d.space} · sheet ${r(pic.sheet.x0)},${r(pic.sheet.y0)} to ${r(pic.sheet.x1)},${r(pic.sheet.y1)}${opts.region ? ` · showing ${r(pic.bounds.x0)},${r(pic.bounds.y0)} to ${r(pic.bounds.x1)},${r(pic.bounds.y1)}` : ''} · layouts: ${d.layouts.map(l => l.name).join(', ') || '(none)'}` };
  };
  const r = (v) => Math.round(v * 10) / 10;
  const log = (s) => { try { ctx.log && ctx.log(s); } catch {} };
  const T = [];
  const layout = z.string().optional().describe('a paper-space layout name, or "model"; default: the sheet as it plots');

  T.push(tool('render_drawing', 'Look at a whole drawing (DXF, PDF or PNG) as a picture. DXFs show with a faint A-H / 1-6 grid you can name in zoom. Use it after every change.', { file: z.string(), layout }, async (a) => {
    try { const p = await picOf(a.file, { layout: a.layout }); log(`looked at ${path.basename(a.file)}`); return { content: [img(p.png), txt(p.info + (/\.dxf$/i.test(a.file) ? '\nGrid: columns A-H left to right, rows 1-6 top to bottom. Zoom with a cell (C4), a span (B2:D4), a name (title block, revision box, notes) or x0,y0,x1,y1.' : ''))] }; } catch (e) { return fail(e); }
  }));
  T.push(tool('zoom', 'Look closely at part of a drawing: a grid cell like C4, a span like B2:D4, "title block", "revision box", "notes", "top left"..., or x0,y0,x1,y1 in drawing units.', { file: z.string(), region: z.string(), layout }, async (a) => {
    try { const p = await picOf(a.file, { region: a.region, layout: a.layout }); log(`zoomed into ${a.region} of ${path.basename(a.file)}`); return { content: [img(p.png), txt(p.info)] }; } catch (e) { return fail(e); }
  }));
  T.push(tool('run_checks', 'Run the house checks on a DXF: cable runs clashing, text overlaps, text height 2, multi-line labels as MTEXT, fonts the same, labels aligned, spares shown, every schedule cable present, symbols joined. Returns a plain list with coordinates.', { file: z.string(), schedule: z.string().optional().describe('a cable schedule .xlsx/.csv to check cables and spares against (default: the job\'s schedule if known)'), layout }, async (a) => {
    try {
      const { d } = drawingOf(a.file, a.layout); let cables = ctx.cables || [];
      if (a.schedule) { const K = require('./checker'), sp = resolve(a.schedule), b = fs.readFileSync(sp); cables = C.cablesFromWorkbook(/\.csv$/i.test(sp) ? K.readCsv(b.toString('utf8')) : K.readXlsx(b)); }
      const res = C.run(d, { cables }); log(`checked ${path.basename(a.file)}: ${res.problems} problem${res.problems === 1 ? '' : 's'}`); ctx.lastCheck = { file: a.file, ...res };
      return { content: [txt(`${path.basename(a.file)}: ${res.problems} problem${res.problems === 1 ? '' : 's'}\n${res.text}`)] };
    } catch (e) { return fail(e); }
  }));
  T.push(tool('compare', 'Show a drawing next to a reference (an earlier revision, the client\'s drawing, the drawing you are copying the style of) side by side, optionally the same region of both.', { file: z.string(), reference: z.string(), region: z.string().optional() }, async (a) => {
    try { const x = await picOf(a.file, { region: a.region }), y = await picOf(a.reference, { region: a.region }); const s = D.sideBySide(x, y, { labels: [path.basename(a.file), path.basename(a.reference)] }); log(`compared ${path.basename(a.file)} with ${path.basename(a.reference)}`); return { content: [img(s.png), txt(`left: ${x.info}\nright: ${y.info}`)] }; } catch (e) { return fail(e); }
  }));
  T.push(tool('find_entities', 'List entities in a DXF with their handles (for edit_dxf): filter by text, layer, type (TEXT|MTEXT|INSERT|LINE...), block name, or region x0,y0,x1,y1 in MODEL or paper coordinates of the entity.', { file: z.string(), text: z.string().optional(), layer: z.string().optional(), type: z.string().optional(), block: z.string().optional(), region: z.string().optional() }, async (a) => {
    try { const p = resolve(a.file); let reg = null; if (a.region) { const n = a.region.split(/[\s,]+/).map(Number); if (n.length === 4 && n.every(Number.isFinite)) reg = { x0: Math.min(n[0], n[2]), y0: Math.min(n[1], n[3]), x1: Math.max(n[0], n[2]), y1: Math.max(n[1], n[3]) }; }
      const rows = E.findEntities(fs.readFileSync(p), { text: a.text, layer: a.layer, type: a.type, block: a.block, region: reg }); return { content: [txt(rows.length ? 'handle | type | layer | where | x,y | height | text\n' + rows.join('\n') : 'Nothing matched.')] }; } catch (e) { return fail(e); }
  }));
  T.push(tool('edit_dxf', 'Edit a DXF and save the result as a NEW file in your work folder (the original is never changed). ops is a list, each one of: {op:"replace_text",before,after} | {op:"set_text",handle,text} | {op:"set_attrib",handle(of the INSERT),tag,value} | {op:"move",handles,dx,dy} | {op:"copy",handles,dx,dy} | {op:"delete",handles} | {op:"set_layer",handles,layer} | {op:"insert_block",name,x,y,scale?,rotation?,layer?,attribs?:{TAG:value},space?:"model"|"paper"} | {op:"add_text",x,y,text,h?(default 2),layer?,mtext?,width?,align?,space?} | {op:"add_line",x1,y1,x2,y2,layer?,space?}. Coordinates are in the entity\'s own space (model or paper) as find_entities shows them.', { file: z.string(), ops: z.array(z.record(z.string(), z.any())), out: z.string().optional().describe('name for the new file (default: the source name with _edit)') }, async (a) => {
    try { const p = resolve(a.file), res = E.apply(fs.readFileSync(p), a.ops), out = newOut(a.out || path.basename(p, '.dxf') + '_edit', '.dxf'); fs.writeFileSync(out, res.buf); log(`edited ${path.basename(p)} → ${path.basename(out)} (${res.done.filter(x => !/^NOT DONE/.test(x)).length} of ${a.ops.length} edits)`); (ctx.made = ctx.made || []).push(out);
      return { content: [txt(`Saved ${path.basename(out)} (full path ${out}).\n${res.done.map(x => '- ' + x).join('\n')}\nNow look at it (render_drawing / zoom) and run_checks.`)] }; } catch (e) { return fail(e); }
  }));
  if (ctx.makeDrawing) T.push(tool('make_drawing', 'Lay out a drawing from a spec with the drawing engine (the same JSON spec Dex has always written: kind, title, boards/busbars or nodes/cables, notes, references...). Returns the DXF it made in your work folder. Use it to start a new drawing; then look, check and fix (again with make_drawing, or with edit_dxf for small fixes).', { spec: z.record(z.string(), z.any()) }, async (a) => {
    try { const r0 = await ctx.makeDrawing(a.spec); (ctx.made = ctx.made || []).push(...r0.files); ctx.lastSpec = a.spec; log(`made ${r0.files.map(f => path.basename(f)).join(', ')}`); return { content: [txt(`Made ${r0.files.map(f => path.basename(f) + ' (' + f + ')').join(', ')}${r0.note ? '\n' + r0.note : ''}\nNow look at it (render_drawing, zoom into the title block and the busiest parts) and run_checks.`)] }; } catch (e) { return fail(e); }
  }));
  T.push(tool('ask_tom', 'Ask Tom (the engineer) a question you cannot answer from the job\'s files. He answers in the app; after asking, finish with what you have and list the question in your final reply.', { question: z.string() }, async (a) => { (ctx.questions = ctx.questions || []).push(String(a.question)); try { ctx.onQuestion && ctx.onQuestion(a.question); } catch {} log('asked Tom: ' + String(a.question).slice(0, 120)); return { content: [txt('Question passed to Tom. Finish now: hand over what you have and list the question in your final reply.')] }; }));
  return T;
}

module.exports = { toolsFor, inside };
