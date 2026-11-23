// Edits to a real DXF, entity by entity: find things, move / copy / delete them, change any text or attribute, put in a block the
// drawing already has (with its attributes), add text and lines, change layers. The file is read and written byte for byte
// (latin1 both ways) and only the edited entities change. The result is ALWAYS a new file: the original is never written to.
'use strict';
const fs = require('fs'), path = require('path');
const R = require('./dxfread');

const uni = (s) => String(s).replace(/[^\x00-\x7F]/g, (c) => '\\U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'));
const num = (v) => { const r = Math.round(v * 1e6) / 1e6; return String(Object.is(r, -0) ? 0 : r); };

function load(buf) {
  const text = buf.toString('latin1'), eol = /\r\n/.test(text.slice(0, 4000)) ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/); if (lines[lines.length - 1] === '') lines.pop();
  const P = []; for (let i = 0; i + 1 < lines.length; i += 2) P.push({ c: parseInt(lines[i].trim(), 10), raw: lines[i], v: lines[i + 1] });
  if (P.some(p => Number.isNaN(p.c))) throw new Error('Not an ASCII DXF (a DWG or binary DXF cannot be edited: save it as an ASCII DXF).');
  return { P, eol };
}
const save = (doc) => Buffer.from(doc.P.map(p => `${p.raw}${doc.eol}${p.v}`).join(doc.eol) + doc.eol, 'latin1');
const code = (c) => String(c).padStart(3, ' ');

// every entity (in ENTITIES and in BLOCKS): its pair range, with the attributes / vertices that belong to it
function index(doc) {
  const P = doc.P, out = []; let sec = '', block = '';
  for (let i = 0; i < P.length; i++) {
    if (P[i].c !== 0) continue; const v = P[i].v.trim();
    if (v === 'SECTION') { sec = (P[i + 1] && P[i + 1].c === 2) ? P[i + 1].v.trim() : ''; continue; }
    if (v === 'ENDSEC' || v === 'EOF') { sec = ''; continue; }
    if (sec === 'BLOCKS' && v === 'BLOCK') { const n = P.slice(i + 1, i + 40).find(p => p.c === 2); block = n ? n.v.trim() : ''; continue; }
    if (sec === 'BLOCKS' && v === 'ENDBLK') { block = ''; continue; }
    if (sec !== 'ENTITIES' && !(sec === 'BLOCKS' && block)) continue;
    let end = i + 1; while (end < P.length && P[end].c !== 0) end++;
    const ent = { type: v, at: i, end, block: sec === 'BLOCKS' ? block : '', handle: '' };
    for (let j = i + 1; j < end; j++) if (P[j].c === 5) { ent.handle = P[j].v.trim().toUpperCase(); break; }
    if (v === 'ATTRIB' || v === 'VERTEX' || v === 'SEQEND') { const parent = [...out].reverse().find(e => !e.child); if (parent && (parent.type === 'INSERT' || parent.type === 'POLYLINE') && parent.groupEnd === i) { parent.groupEnd = end; ent.child = parent; } }
    ent.groupEnd = end;
    out.push(ent);
  }
  return out;
}
const vals = (doc, e) => doc.P.slice(e.at + 1, e.end);
const get = (doc, e, c) => { const p = vals(doc, e).find(q => q.c === c); return p ? p.v.trim() : undefined; };
function handleSeed(doc) {
  let max = 0; for (const p of doc.P) if (p.c === 5 || p.c === 105) { const n = parseInt(p.v.trim(), 16); if (n > max) max = n; }
  const i = doc.P.findIndex((p, k) => p.c === 9 && p.v.trim() === '$HANDSEED'); if (i >= 0) { const s = parseInt(doc.P[i + 1].v.trim(), 16); if (s > max) max = s - 1; }
  return { next: () => (++max).toString(16).toUpperCase(), done: () => { if (i >= 0) doc.P[i + 1].v = (max + 1).toString(16).toUpperCase(); } };
}
function find(doc, handle) { const h = String(handle || '').toUpperCase().trim(); const e = index(doc).find(x => x.handle === h); if (!e) throw new Error(`No entity with handle ${handle} (use find_entities to get handles)`); return e; }

// shifting an entity's points: which x/y codes are positions for each type
function shift(doc, e, dx, dy) {
  const P = doc.P; let afterEmbedded = false, firstHatchPt = e.type === 'HATCH';
  for (let j = e.at + 1; j < e.end; j++) {
    const p = P[j]; if (p.c === 101) { afterEmbedded = true; continue; }
    let axis = '';
    if (e.type === 'MTEXT') { if (!afterEmbedded && (p.c === 10 || p.c === 20)) axis = p.c === 10 ? 'x' : 'y'; else if (afterEmbedded && (p.c === 11 || p.c === 21)) axis = p.c === 11 ? 'x' : 'y'; }
    else if (e.type === 'HATCH') { if (p.c === 10 || p.c === 20 || p.c === 11 || p.c === 21) { if (firstHatchPt && p.c === 10) { firstHatchPt = 'y'; continue; } if (firstHatchPt === 'y' && p.c === 20) { firstHatchPt = false; continue; } axis = (p.c === 10 || p.c === 11) ? 'x' : 'y'; } }
    else if ((p.c >= 10 && p.c <= 18)) axis = 'x'; else if (p.c >= 20 && p.c <= 28) axis = 'y';
    if (e.type === 'ELLIPSE' && (p.c === 11 || p.c === 21)) axis = '';   // the major axis is a direction, not a point
    if (!axis) continue;
    const v = parseFloat(p.v); if (Number.isFinite(v)) p.v = num(v + (axis === 'x' ? dx : dy));
  }
}

function setText(doc, e, text) {
  const P = doc.P, t = uni(text);
  if (e.type === 'MTEXT') {
    const parts = vals(doc, e).filter(p => p.c === 1 || p.c === 3); if (!parts.length) throw new Error('That MTEXT has no text to change');
    const firstAt = P.indexOf(parts[0]), body = t.replace(/\r?\n/g, '\\P'), chunks = []; for (let i = 0; i < body.length; i += 250) chunks.push(body.slice(i, i + 250)); if (!chunks.length) chunks.push('');
    const repl = chunks.map((c, i) => ({ c: i === chunks.length - 1 ? 1 : 3, raw: code(i === chunks.length - 1 ? 1 : 3), v: c }));
    for (const p of parts.slice(1)) P.splice(P.indexOf(p), 1);
    P.splice(firstAt, 1, ...repl);
  } else if (e.type === 'TEXT' || e.type === 'ATTRIB' || e.type === 'ATTDEF') {
    const p = vals(doc, e).find(q => q.c === 1); if (!p) throw new Error('That text has no value to change'); p.v = t.replace(/\r?\n/g, ' ');
  } else throw new Error(`${e.handle} is a ${e.type}, not text`);
}

// owners: model space / paper space block records
function spaceRecord(doc, space) { const P = doc.P; for (let i = 0; i < P.length; i++) if (P[i].c === 0 && P[i].v.trim() === 'BLOCK_RECORD') { let h = '', n = ''; for (let j = i + 1; j < P.length && P[j].c !== 0; j++) { if (P[j].c === 5) h = P[j].v.trim(); if (P[j].c === 2) n = P[j].v.trim(); } if (new RegExp(`^\\*${space === 'paper' ? 'Paper' : 'Model'}_Space$`, 'i').test(n)) return h; } return space === 'paper' ? '1B' : '1F'; }
function entitiesEnd(doc) { const P = doc.P; let sec = ''; for (let i = 0; i < P.length; i++) { if (P[i].c !== 0) continue; const v = P[i].v.trim(); if (v === 'SECTION') sec = P[i + 1] && P[i + 1].v.trim(); else if (v === 'ENDSEC' && sec === 'ENTITIES') return i; } throw new Error('No ENTITIES section'); }
const pairs = (list) => list.map(([c, v]) => ({ c, raw: code(c), v: String(v) }));
function head(doc, hs, type, layer, space) { return [[0, type], [5, hs.next()], [330, spaceRecord(doc, space)], [100, 'AcDbEntity'], ...(space === 'paper' ? [[67, 1]] : []), [8, layer || '0']]; }

function insertBlock(doc, hs, op) {
  const ents = index(doc), name = String(op.name || ''), defStart = doc.P.findIndex((p, i) => p.c === 0 && p.v.trim() === 'BLOCK' && doc.P.slice(i + 1, i + 30).some(q => q.c === 2 && q.v.trim() === name));
  if (defStart < 0) { const names = [...new Set(ents.filter(e => e.block).map(e => e.block))].filter(n => !n.startsWith('*')).slice(0, 80); throw new Error(`The drawing has no block called "${name}". Blocks in it: ${names.join(', ')}`); }
  const bx = parseFloat((doc.P.slice(defStart + 1, defStart + 40).find(p => p.c === 10) || { v: 0 }).v) || 0, by = parseFloat((doc.P.slice(defStart + 1, defStart + 40).find(p => p.c === 20) || { v: 0 }).v) || 0;
  const k = op.scale || 1, rot = op.rotation || 0, defs = ents.filter(e => e.block === name && e.type === 'ATTDEF'), at = entitiesEnd(doc), sp = op.space === 'paper' ? 'paper' : 'model';
  const ins = head(doc, hs, 'INSERT', op.layer, sp), insH = ins[1][1];
  const list = [...ins, [100, 'AcDbBlockReference'], ...(defs.length ? [[66, 1]] : []), [2, name], [10, num(op.x)], [20, num(op.y)], [30, 0], ...(k !== 1 ? [[41, num(k)], [42, num(k)], [43, num(k)]] : []), ...(rot ? [[50, num(rot)]] : [])];
  const r = rot * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), tf = (x, y) => [op.x + ((x - bx) * c - (y - by) * s) * k, op.y + ((x - bx) * s + (y - by) * c) * k];
  const attrs = op.attribs || {};
  for (const d of defs) {
    const tag = get(doc, d, 2) || '', [x, y] = tf(parseFloat(get(doc, d, 10) || 0), parseFloat(get(doc, d, 20) || 0)), h72 = get(doc, d, 72), v74 = get(doc, d, 74);
    const [ax, ay] = get(doc, d, 11) != null ? tf(parseFloat(get(doc, d, 11)), parseFloat(get(doc, d, 21))) : [x, y];
    const value = attrs[tag] != null ? attrs[tag] : (attrs[tag.toUpperCase()] != null ? attrs[tag.toUpperCase()] : (get(doc, d, 1) || ''));
    list.push(...[[0, 'ATTRIB'], [5, hs.next()], [330, insH], [100, 'AcDbEntity'], ...(sp === 'paper' ? [[67, 1]] : []), [8, get(doc, d, 8) === '0' ? (op.layer || '0') : get(doc, d, 8) || '0'], [100, 'AcDbText'], [10, num(x)], [20, num(y)], [30, 0], [40, num(parseFloat(get(doc, d, 40) || 2) * k)], [1, uni(value)], ...(rot || get(doc, d, 50) ? [[50, num(rot + parseFloat(get(doc, d, 50) || 0))]] : []), ...(get(doc, d, 41) ? [[41, get(doc, d, 41)]] : []), [7, get(doc, d, 7) || 'STANDARD'], ...(h72 && h72 !== '0' ? [[72, h72], [11, num(ax)], [21, num(ay)], [31, 0]] : []), [100, 'AcDbAttribute'], [2, tag], [70, get(doc, d, 70) || 0], ...(v74 && v74 !== '0' ? [[74, v74]] : [])]);
  }
  if (defs.length) list.push([0, 'SEQEND'], [5, hs.next()], [330, insH], [100, 'AcDbEntity'], [8, op.layer || '0']);
  doc.P.splice(at, 0, ...pairs(list));
  return insH;
}

function addText(doc, hs, op) {
  const sp = op.space === 'paper' ? 'paper' : 'model', h = op.h || op.height || 2, t = String(op.text || ''), at = entitiesEnd(doc), style = op.style || 'STANDARD';
  let list;
  if (op.mtext || /\n/.test(t)) { const H = head(doc, hs, 'MTEXT', op.layer, sp); list = [...H, [100, 'AcDbMText'], [10, num(op.x)], [20, num(op.y)], [30, 0], [40, num(h)], [41, num(op.width || 0)], [71, op.attach || 1], [72, 5], [1, uni(t).replace(/\r?\n/g, '\\P')], [7, style]]; }
  else { const H = head(doc, hs, 'TEXT', op.layer, sp), al = op.align === 'center' ? 1 : op.align === 'right' ? 2 : 0; list = [...H, [100, 'AcDbText'], [10, num(op.x)], [20, num(op.y)], [30, 0], [40, num(h)], [1, uni(t)], ...(op.rotation ? [[50, num(op.rotation)]] : []), [7, style], ...(al ? [[72, al], [11, num(op.x)], [21, num(op.y)], [31, 0]] : []), [100, 'AcDbText']]; }
  doc.P.splice(at, 0, ...pairs(list)); return list[1][1];
}
function addLine(doc, hs, op) {
  const sp = op.space === 'paper' ? 'paper' : 'model', at = entitiesEnd(doc), H = head(doc, hs, 'LINE', op.layer, sp);
  const list = [...H, [100, 'AcDbLine'], [10, num(op.x1)], [20, num(op.y1)], [30, 0], [11, num(op.x2)], [21, num(op.y2)], [31, 0]];
  doc.P.splice(at, 0, ...pairs(list)); return list[1][1];
}

function apply(buf, ops) {
  const doc = load(buf), hs = handleSeed(doc), done = [];
  for (const op of ops || []) {
    const kind = String(op.op || '').toLowerCase(), handles = [].concat(op.handles || op.handle || []).map(h => String(h).toUpperCase());
    try {
      if (kind === 'replace_text') {
        const before = uni(op.before || ''), after = uni(op.after || ''); if (!before) throw new Error('replace_text needs the exact text to find (before)');
        let n = 0; for (const e of index(doc)) { if (!/^(TEXT|MTEXT|ATTRIB|ATTDEF)$/.test(e.type)) continue; for (let j = e.at + 1; j < e.end; j++) { const p = doc.P[j]; if ((p.c === 1 || p.c === 3) && p.v.includes(before)) { p.v = p.v.split(before).join(after); n++; } } }
        if (!n) throw new Error(`"${op.before}" was not found in any text (it may be split by formatting: use set_text on the item's handle)`);
        done.push(`replaced "${op.before}" with "${op.after}" in ${n} place${n > 1 ? 's' : ''}`);
      } else if (kind === 'set_text') { const e = find(doc, handles[0]); setText(doc, e, op.text); done.push(`${e.handle} (${e.type}${e.block ? ' in block ' + e.block + ': every copy of the block changes' : ''}) now reads "${String(op.text).slice(0, 60)}"`); }
      else if (kind === 'set_attrib') {
        const e = find(doc, handles[0]); if (e.type !== 'INSERT') throw new Error(`${e.handle} is a ${e.type}; set_attrib needs the INSERT's handle`);
        const ents = index(doc), atts = ents.filter(x => x.child && x.child.at === e.at && x.type === 'ATTRIB'), a = atts.find(x => String(get(doc, x, 2) || '').toUpperCase() === String(op.tag || '').toUpperCase());
        if (!a) throw new Error(`Block ${get(doc, e, 2)} (${e.handle}) has no attribute ${op.tag}. Its attributes: ${atts.map(x => get(doc, x, 2)).join(', ') || '(none)'}`);
        setText(doc, a, op.value); done.push(`${get(doc, e, 2)} ${e.handle}: ${op.tag} = "${op.value}"`);
      }
      else if (kind === 'move' || kind === 'copy') {
        const dx = +op.dx || 0, dy = +op.dy || 0; if (!handles.length) throw new Error(`${kind} needs handles`);
        for (const h of handles) {
          const e = find(doc, h), group = index(doc).filter(x => x.at === e.at || (x.child && x.child.at === e.at));
          if (kind === 'move') { group.forEach(g => shift(doc, g, dx, dy)); done.push(`moved ${e.type} ${h} by ${dx},${dy}`); continue; }
          const span = doc.P.slice(e.at, e.groupEnd).map(p => ({ ...p })), map = {};
          for (const p of span) if (p.c === 5) { const nh = hs.next(); map[p.v.trim().toUpperCase()] = nh; p.v = nh; }
          for (const p of span) if (p.c === 330 && map[p.v.trim().toUpperCase()]) p.v = map[p.v.trim().toUpperCase()];
          // shift the copy: work on it as its own little document
          const mini = { P: [{ c: 0, raw: '  0', v: 'SECTION' }, { c: 2, raw: '  2', v: 'ENTITIES' }, ...span] }; index(mini).forEach(g => shift(mini, g, dx, dy));
          doc.P.splice(e.groupEnd, 0, ...mini.P.slice(2));
          done.push(`copied ${e.type} ${h} to ${map[h] || '?'} (offset ${dx},${dy})`);
        }
      }
      else if (kind === 'delete') {
        const ents = index(doc), gone = handles.map(h => { const e = ents.find(x => x.handle === h); if (!e) throw new Error(`No entity with handle ${h}`); return e; }).sort((a, b) => b.at - a.at);
        for (const e of gone) doc.P.splice(e.at, e.groupEnd - e.at);
        done.push(`removed ${gone.map(e => e.type + ' ' + e.handle).join(', ')}`);
      }
      else if (kind === 'set_layer') { for (const h of handles) { const e = find(doc, h); const p = vals(doc, e).find(q => q.c === 8); if (p) p.v = String(op.layer); } done.push(`put ${handles.join(', ')} on layer ${op.layer}`); }
      else if (kind === 'insert_block') { const h = insertBlock(doc, hs, op); done.push(`inserted block ${op.name} at ${op.x},${op.y} (handle ${h})`); }
      else if (kind === 'add_text') { const h = addText(doc, hs, op); done.push(`added text "${String(op.text).slice(0, 40)}" at ${op.x},${op.y} (handle ${h})`); }
      else if (kind === 'add_line') { const h = addLine(doc, hs, op); done.push(`added a line ${op.x1},${op.y1} to ${op.x2},${op.y2} (handle ${h})`); }
      else throw new Error(`Unknown edit "${op.op}". Edits: replace_text, set_text, set_attrib, move, copy, delete, set_layer, insert_block, add_text, add_line`);
    } catch (err) { done.push(`NOT DONE (${op.op}): ${err.message}`); }
  }
  hs.done();
  return { buf: save(doc), done };
}

// entities to edit, with their handles: by text, layer, type, block name or a region of the drawing (model or sheet units)
function findEntities(buf, { text = '', layer = '', type = '', block = '', region = null, max = 150 } = {}) {
  const doc = R.parse(buf), out = [];
  const space = (e) => e.pairs.some(p => p[0] === 67 && p[1].trim() === '1') ? 'paper' : 'model';
  const ents = [...doc.entities.map(e => ({ e, block: '' })), ...Object.values(doc.blocks).filter(b => !b.name.startsWith('*')).flatMap(b => b.ents.map(e => ({ e, block: b.name })))];
  const T = String(text || '').toUpperCase();
  for (const { e, block: inBlock } of ents) {
    const g = (c) => { const p = e.pairs.find(q => q[0] === c); return p ? p[1] : ''; };
    const plain = e.type === 'MTEXT' ? R.mtextPlain(e.pairs.filter(p => p[0] === 3 || p[0] === 1).map(p => p[1]).join('')) : /TEXT|ATTRIB|ATTDEF/.test(e.type) ? g(1) : '';
    if (T && !plain.toUpperCase().includes(T) && !(e.type === 'INSERT' && g(2).toUpperCase().includes(T))) continue;
    if (layer && !new RegExp(layer, 'i').test(g(8))) continue;
    if (type && !new RegExp(`^(${type})$`, 'i').test(e.type)) continue;
    if (block && inBlock.toUpperCase() !== block.toUpperCase() && !(e.type === 'INSERT' && g(2).toUpperCase() === block.toUpperCase())) continue;
    const x = parseFloat(g(10)), y = parseFloat(g(20));
    if (region && !inBlock && !(x >= region.x0 && x <= region.x1 && y >= region.y0 && y <= region.y1)) continue;
    if (region && inBlock) continue;
    out.push(`${g(5)} | ${e.type}${e.type === 'INSERT' ? ' ' + g(2) : ''} | layer ${g(8) || '0'} | ${inBlock ? 'inside block ' + inBlock : space(e) + ' space'} | ${Number.isFinite(x) ? Math.round(x * 100) / 100 + ',' + Math.round(y * 100) / 100 : ''}${g(40) ? ' | h' + g(40) : ''}${e.type === 'ATTRIB' ? ' | tag ' + g(2) : ''}${plain ? ' | "' + plain.replace(/\n/g, '\\n').slice(0, 120) + '"' : ''}`);
    if (out.length >= max) { out.push(`... more not listed: narrow the search`); break; }
  }
  return out;
}

module.exports = { apply, findEntities, index, load, save };
