// Reads any ASCII DXF (one Dex made, or a real drawing from a job) into flat primitives in sheet units, so an agent can look at it
// (render), zoom in, and have it checked. Blocks are expanded (scale, rotation, mirroring), attributes shown, dimensions drawn from
// their blocks, and a paper-space layout is shown the way it plots: its own linework plus model space seen through each viewport.
// Pure JavaScript: works on any PC without AutoCAD or Python.
'use strict';
const fs = require('fs');

function decode(buf) {
  const head = buf.slice(0, 20000).toString('latin1'), ver = (head.match(/\$ACADVER\r?\n\s*1\r?\n\s*(AC\d+)/) || [])[1] || '';
  return (ver && ver >= 'AC1021') ? buf.toString('utf8') : buf.toString('latin1');   // AutoCAD 2007 and later write UTF-8
}
const uni = (s) => String(s).replace(/\\U\+([0-9A-Fa-f]{4})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
const special = (s) => uni(s).replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%%/g, '%').replace(/%%[uUoO]/g, '');
// MTEXT's inline formatting off: paragraphs to new lines, stacked fractions as a/b, fonts noted
function mtextPlain(raw, fonts) {
  let s = String(raw);
  s = s.replace(/\\f([^|;\\]+)[^;]*;/gi, (_m, f) => { if (fonts) fonts.add(f.trim()); return ''; });
  s = s.replace(/\\p[^;\\]*;/g, '');
  s = s.replace(/\\S([^^/#;]*)[\^/#]([^;]*);/g, '$1/$2').replace(/\\P/g, '\n').replace(/\\~/g, ' ')
    .replace(/\\[ACHQTWLlOoKkXx][^;\\]*;?/g, (m) => /^\\[LlOoKkXx]$/.test(m) ? '' : m.endsWith(';') ? '' : m.replace(/^\\[A-Za-z]/, ''))
    .replace(/\\\\/g, '\\').replace(/\\([{}])/g, '$1').replace(/[{}]/g, '');
  return special(s);
}

const ACI = { 1: '#e03131', 2: '#e8b400', 3: '#2f9e44', 4: '#0c8599', 5: '#1c4fd8', 6: '#ae3ec9', 7: '#000000', 8: '#808080', 9: '#b0b0b0', 250: '#333333', 251: '#505050', 252: '#696969', 253: '#828282', 254: '#bebebe', 255: '#ffffff' };
const aciHex = (c) => ACI[c] || (c >= 10 && c < 250 ? '#555555' : '#000000');

function parse(buf) {
  const text = typeof buf === 'string' ? buf : decode(buf);
  const L = text.split(/\r?\n/), P = [];
  for (let i = 0; i + 1 < L.length; i += 2) { const c = parseInt(L[i].trim(), 10); if (Number.isNaN(c)) throw new Error('This does not look like an ASCII DXF file (a binary DXF or a DWG cannot be read: save it as ASCII DXF).'); P.push([c, L[i + 1].replace(/\s+$/, '')]); }
  const layers = {}, styles = {}, blocks = {}, records = {}, layoutsByRecord = {}, entities = [], header = {};
  let sec = '', i = 0;
  const readEnt = (start) => {   // pairs of one entity up to the next code 0
    const pairs = []; let j = start + 1; for (; j < P.length && P[j][0] !== 0; j++) pairs.push(P[j]); return { type: P[start][1], pairs, next: j };
  };
  let curBlock = null, tableName = '';
  while (i < P.length) {
    const [c, v] = P[i];
    if (c === 0 && v === 'SECTION') { sec = (P[i + 1] && P[i + 1][0] === 2) ? P[i + 1][1] : ''; i += 2; continue; }
    if (c === 0 && v === 'ENDSEC') { sec = ''; i++; continue; }
    if (c !== 0) { if (sec === 'HEADER' && c === 9) { header[v] = P[i + 1] ? P[i + 1][1] : ''; } i++; continue; }
    const e = readEnt(i); i = e.next;
    const g = (code) => { const p = e.pairs.find(q => q[0] === code); return p ? p[1] : undefined; };
    if (sec === 'TABLES') {
      if (e.type === 'TABLE') { tableName = g(2) || ''; continue; }
      if (e.type === 'LAYER') { const col = parseInt(g(62) || '7', 10), fl = parseInt(g(70) || '0', 10); layers[g(2)] = { colour: Math.abs(col), off: col < 0, frozen: !!(fl & 1), plot: g(290) !== '0' }; }
      else if (e.type === 'STYLE') { const n = g(2); if (n != null) styles[n.toUpperCase()] = { name: n, font: g(3) || '', big: g(4) || '', width: parseFloat(g(41) || '1') || 1 }; }
      else if (e.type === 'BLOCK_RECORD') { const h = g(5); if (h) records[h] = g(2) || ''; }
      continue;
    }
    if (sec === 'BLOCKS') {
      if (e.type === 'BLOCK') { curBlock = { name: g(2) || '', bx: parseFloat(g(10) || 0), by: parseFloat(g(20) || 0), ents: [] }; blocks[curBlock.name] = curBlock; continue; }
      if (e.type === 'ENDBLK') { curBlock = null; continue; }
      if (curBlock) curBlock.ents.push(e);
      continue;
    }
    if (sec === 'ENTITIES') { entities.push(e); continue; }
    if (sec === 'OBJECTS' && e.type === 'LAYOUT') {
      const idxSub = e.pairs.findIndex(p => p[0] === 100 && p[1] === 'AcDbLayout'), name = ((idxSub >= 0 ? e.pairs.slice(idxSub) : e.pairs).find(p => p[0] === 1) || [])[1] || '';
      const rec = idxSub >= 0 ? (e.pairs.slice(idxSub).find(p => p[0] === 330) || [])[1] : '';
      const order = parseInt((e.pairs.slice(idxSub).find(p => p[0] === 71) || [0, '0'])[1], 10) || 0;
      if (rec) layoutsByRecord[rec] = { name, order };
    }
  }
  // layouts: name -> the block holding its paper-space entities (*Paper_Space is the active one; its entities sit in ENTITIES with 67=1)
  const layouts = [];
  for (const [h, rec] of Object.entries(layoutsByRecord)) { const bname = records[h] || ''; if (!/^\*Paper_Space/i.test(bname)) continue; layouts.push({ name: rec.name, order: rec.order, block: bname }); }
  layouts.sort((a, b) => a.order - b.order);
  return { header, layers, styles, blocks, entities, layouts, version: header.$ACADVER || '' };
}

// ---- geometry ----
const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
const ap = (M, x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
const ID = [1, 0, 0, 1, 0, 0];
const T = (x, y) => [1, 0, 0, 1, x, y], S = (a, b) => [a, 0, 0, b, 0, 0], R = (deg) => { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, 0, 0]; };
const scaleOf = (M) => Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) || 1;
const angleOf = (M) => Math.atan2(M[1], M[0]) * 180 / Math.PI;
const mirrored = (M) => (M[0] * M[3] - M[1] * M[2]) < 0;

function arcPts(cx, cy, r, a0, a1, n) { let e = a1; while (e <= a0) e += 360; const k = n || Math.max(8, Math.ceil((e - a0) / 8)), out = []; for (let i = 0; i <= k; i++) { const a = (a0 + (e - a0) * i / k) * Math.PI / 180; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return out; }
function bulgePts(p, q, b) {   // the arc between two polyline vertices with a bulge
  const th = 4 * Math.atan(b), c = Math.hypot(q[0] - p[0], q[1] - p[1]); if (!c || !b) return [q];
  const r = c / (2 * Math.sin(th / 2)), mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2, d = r * Math.cos(th / 2), nx = -(q[1] - p[1]) / c, ny = (q[0] - p[0]) / c;
  const cx = mx + nx * d, cy = my + ny * d, a0 = Math.atan2(p[1] - cy, p[0] - cx), out = [], n = Math.max(4, Math.ceil(Math.abs(th) / (Math.PI / 18)));
  for (let i = 1; i <= n; i++) { const a = a0 + th * i / n; out.push([cx + Math.abs(r) * Math.cos(a) * Math.sign(r), cy + Math.abs(r) * Math.sin(a) * Math.sign(r)]); }
  out[out.length - 1] = q; return out;
}

// every entity of a list as primitives, through matrix M; ctx carries the drawing tables and the block we are in
function emit(doc, ents, M, out, ctx) {
  const { layers } = doc;
  for (let k = 0; k < ents.length; k++) {
    const e = ents[k], cut = e.pairs.findIndex(q => q[0] === 101), pairs = cut >= 0 ? e.pairs.slice(0, cut) : e.pairs, g = (code, d) => { const p = pairs.find(q => q[0] === code); return p ? p[1] : d; }, f = (code, d = 0) => { const v = parseFloat(g(code, d)); return Number.isFinite(v) ? v : d; };
    if (e.type === 'SEQEND' || e.type === 'VERTEX' || e.type === 'ATTDEF' && !ctx.showAttdef) continue;
    let layer = g(8, '0'); if (layer === '0' && ctx.layer) layer = ctx.layer;   // things on layer 0 in a block take the insert's layer
    const L = layers[layer] || {}; if (L.off || L.frozen) continue;
    let col = parseInt(g(62, '256'), 10); if (col === 256) col = L.colour || 7; else if (col === 0) col = ctx.colour || 7;
    const tc = g(420); const rgbHex = tc ? '#' + (parseInt(tc, 10) & 0xffffff).toString(16).padStart(6, '0') : '';
    const base = { layer, colour: col, hex: rgbHex || aciHex(col), handle: g(5, ''), blk: ctx.top || '', type: e.type, space: ctx.space, style: '' };
    const ocsFlip = f(230, 1) < 0;   // drawn mirrored (extrusion 0,0,-1): its x runs the other way
    const W = ocsFlip ? mul(M, S(-1, 1)) : M;
    const P2 = (x, y) => ap(W, x, y);
    const t = e.type;
    if (t === 'LINE') { const [x1, y1] = ap(M, f(10), f(20)), [x2, y2] = ap(M, f(11), f(21)); out.push({ ...base, t: 'line', x1, y1, x2, y2 }); }
    else if (t === 'LWPOLYLINE') {
      const pts = [], bul = []; let cur = null;
      for (const [c, v] of pairs) { if (c === 10) { cur = [parseFloat(v), 0]; pts.push(cur); bul.push(0); } else if (c === 20 && cur) cur[1] = parseFloat(v); else if (c === 42 && cur) bul[bul.length - 1] = parseFloat(v); }
      const closed = (parseInt(g(70, '0'), 10) & 1) === 1; if (!pts.length) continue;
      const seq = [pts[0]]; const n = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; seq.push(...(bul[i] ? bulgePts(p, q, bul[i]) : [q])); }
      out.push({ ...base, t: 'pline', pts: seq.map(([x, y]) => P2(x, y)), closed: false, width: f(43, 0) * scaleOf(M) });
    }
    else if (t === 'POLYLINE') {
      const pts = [], bul = []; let j = k + 1; for (; j < ents.length && ents[j].type === 'VERTEX'; j++) { const vp = ents[j].pairs, vg = (c) => { const p = vp.find(q => q[0] === c); return p ? parseFloat(p[1]) : 0; }; pts.push([vg(10), vg(20)]); bul.push(vg(42)); }
      const closed = (parseInt(g(70, '0'), 10) & 1) === 1; if (pts.length) { const seq = [pts[0]], n = closed ? pts.length : pts.length - 1; for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; seq.push(...(bul[i] ? bulgePts(p, q, bul[i]) : [q])); } out.push({ ...base, t: 'pline', pts: seq.map(([x, y]) => P2(x, y)), closed: false }); }
    }
    else if (t === 'CIRCLE') { const pts = arcPts(f(10), f(20), f(40), 0, 360, 48).map(([x, y]) => P2(x, y)); const [cx, cy] = P2(f(10), f(20)); out.push({ ...base, t: 'pline', pts, closed: false, circle: { x: cx, y: cy, r: f(40) * scaleOf(M) } }); }
    else if (t === 'ARC') { out.push({ ...base, t: 'pline', pts: arcPts(f(10), f(20), f(40), f(50), f(51)).map(([x, y]) => P2(x, y)), closed: false }); }
    else if (t === 'ELLIPSE') {
      const cx = f(10), cy = f(20), mx = f(11), my = f(21), ratio = f(40, 1), s0 = f(41, 0), s1 = f(42, Math.PI * 2), a = Math.hypot(mx, my), rot = Math.atan2(my, mx);
      let e1 = s1; while (e1 <= s0) e1 += Math.PI * 2; const pts = []; for (let i = 0; i <= 48; i++) { const u = s0 + (e1 - s0) * i / 48, x = a * Math.cos(u), y = a * ratio * Math.sin(u); pts.push(P2(cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot))); }
      out.push({ ...base, t: 'pline', pts, closed: false });
    }
    else if (t === 'SOLID' || t === 'TRACE') { const q = [[f(10), f(20)], [f(11), f(21)], [f(13), f(23)], [f(12), f(22)]].map(([x, y]) => P2(x, y)); out.push({ ...base, t: 'fill', pts: q }); }
    else if (t === 'HATCH') {
      if (g(70, '0') !== '1' && !/SOLID/i.test(g(2, ''))) continue;   // pattern hatches left out; solid fills drawn
      const rings = []; let ring = null, inEdges = false, edgeType = 0;
      for (let j = 0; j < pairs.length; j++) {
        const [c, v] = pairs[j];
        if (c === 92) { ring = []; rings.push(ring); inEdges = !(parseInt(v, 10) & 2); edgeType = 0; continue; }
        if (!ring) continue;
        if (c === 72 && inEdges) edgeType = parseInt(v, 10);
        if (c === 10 && pairs[j + 1] && pairs[j + 1][0] === 20) {
          const x = parseFloat(v), y = parseFloat(pairs[j + 1][1]);
          if (inEdges && edgeType === 2) { const r = parseFloat((pairs[j + 2] || [])[1] || 0), a0 = parseFloat((pairs[j + 3] || [])[1] || 0), a1 = parseFloat((pairs[j + 4] || [])[1] || 0), ccw = (pairs[j + 5] || [])[1] !== '0'; ring.push(...(ccw ? arcPts(x, y, r, a0, a1) : arcPts(x, y, r, -a0, -a1).map(([px, py]) => [px, 2 * y - py]))); }
          else ring.push([x, y]);
        }
        if (c === 97 || c === 75) { if (c === 75) break; }
      }
      const rs = rings.filter(r => r.length > 2).map(r => r.map(([x, y]) => P2(x, y))); if (rs.length) out.push({ ...base, t: 'fill', pts: rs[0], rings: rs });
    }
    else if (t === 'TEXT' || t === 'ATTRIB' || t === 'ATTDEF') {
      if (t === 'ATTRIB' && (parseInt(g(70, '0'), 10) & 1)) continue;   // invisible attribute
      const h72 = parseInt(g(72, '0'), 10), v73 = parseInt(g(t === 'TEXT' ? 73 : 74, '0'), 10), useAlign = (h72 || v73) && h72 !== 3 && h72 !== 5;
      const [x, y] = useAlign ? P2(f(11), f(21)) : P2(f(10), f(20)), st = doc.styles[String(g(7, 'STANDARD')).toUpperCase()] || {};
      const h = f(40) * Math.abs(ctx.sy || 1) * (M === ID ? 1 : (ctx.vscale || 1)), raw = t === 'ATTDEF' ? g(1, '') || g(2, '') : g(1, '');
      const txt = special(raw).replace(/\\P/g, ' '); if (!txt.trim()) continue;
      out.push({ ...base, t: 'text', x, y, h: f(40) * scaleOf(M) / (ctx.textScaleFix || 1), text: txt, rot: f(50) + angleOf(M) * (mirrored(M) ? -1 : 1), align: h72 === 1 || h72 === 4 ? 'center' : h72 === 2 ? 'right' : 'left', valign: v73 === 2 || h72 === 4 ? 'middle' : v73 === 3 ? 'top' : 'base', wf: f(41, st.width || 1), style: st.name || g(7, 'STANDARD'), font: st.font || '', tag: t !== 'TEXT' ? g(2, '') : '' });
      void h;
    }
    else if (t === 'MTEXT') {
      let raw = ''; for (const [c, v] of pairs) if (c === 3 || c === 1) raw += v;   // long text comes in 250-character pieces (code 3) then the end (code 1)
      const fonts = new Set(), txt = mtextPlain(raw, fonts); if (!txt.trim()) continue;
      const [x, y] = P2(f(10), f(20)), st = doc.styles[String(g(7, 'STANDARD')).toUpperCase()] || {};
      let rot = f(50) * 180 / Math.PI; if (g(11) != null) rot = Math.atan2(f(21), f(11)) * 180 / Math.PI;
      out.push({ ...base, t: 'mtext', x, y, h: f(40) * scaleOf(M), w: f(41) * scaleOf(M), attach: parseInt(g(71, '1'), 10) || 1, text: txt, rot: rot + angleOf(M), style: st.name || g(7, 'STANDARD'), font: st.font || '', inlineFonts: [...fonts], lineSpacing: f(44, 1) });
    }
    else if (t === 'INSERT' || t === 'DIMENSION') {
      const name = g(2, ''), b = doc.blocks[name]; if (!b || (ctx.depth || 0) > 12) { if (t === 'INSERT') { const atts = []; } continue; }
      let Mi;
      if (t === 'DIMENSION') Mi = M;
      else { const sx = f(41, 1), sy = f(42, 1); Mi = mul(W, mul(T(f(10), f(20)), mul(R(f(50)), mul(S(sx, sy), T(-b.bx, -b.by))))); }
      emit(doc, b.ents, Mi, out, { ...ctx, depth: (ctx.depth || 0) + 1, top: ctx.top || (t === 'DIMENSION' ? '*DIM' : name), layer: layer, colour: col, inBlock: name, insertHandle: ctx.insertHandle || base.handle });
      if (t === 'INSERT' && parseInt(g(66, '0'), 10) === 1) {   // its attributes follow it, up to SEQEND
        const atts = []; for (let j = k + 1; j < ents.length && ents[j].type === 'ATTRIB'; j++) atts.push(ents[j]);
        emit(doc, atts, M, out, { ...ctx, top: ctx.top || name, layer, colour: col, insertHandle: ctx.insertHandle || base.handle });
      }
      if (!ctx.top && t === 'INSERT') out.push({ ...base, t: 'insertmark', name, x: ap(W, f(10), f(20))[0], y: ap(W, f(10), f(20))[1] });
    }
    else if (t === 'VIEWPORT' && ctx.space === 'paper') {
      const id = parseInt(g(69, '0'), 10), on = parseInt(g(68, '1'), 10); if (id === 1 || on === 0) continue;
      out.push({ ...base, t: 'viewport', cx: f(10), cy: f(20), w: f(40), h: f(41), vcx: f(12), vcy: f(22), vh: f(45), twist: f(51) });
    }
  }
  return out;
}

function boundsOf(prims) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; const add = (x, y) => { if (!Number.isFinite(x) || !Number.isFinite(y)) return; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  for (const p of prims) { const b = boxOf(p); if (b) { add(b[0], b[1]); add(b[2], b[3]); } }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 420, y1: 297 };
}
// an item's box (for text: an estimate from its height, length and width factor)
const CHAR = 0.72;
function boxOf(p) {
  if (p.t === 'line') return [Math.min(p.x1, p.x2), Math.min(p.y1, p.y2), Math.max(p.x1, p.x2), Math.max(p.y1, p.y2)];
  if (p.t === 'pline' || p.t === 'fill') { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [x, y] of p.pts) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); } return Number.isFinite(a) ? [a, b, c, d] : null; }
  if (p.t === 'text') {   // its box in its own direction (aligned by its justification), then turned by its rotation
    const w = String(p.text).length * p.h * CHAR * (p.wf || 1), u0 = p.align === 'center' ? -w / 2 : p.align === 'right' ? -w : 0, v0 = p.valign === 'middle' ? -p.h / 2 : p.valign === 'top' ? -p.h : 0;
    const r = (p.rot || 0) * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r), pts = [[u0, v0], [u0 + w, v0], [u0 + w, v0 + p.h], [u0, v0 + p.h]].map(([u, v]) => [p.x + u * c - v * sn, p.y + u * sn + v * c]);
    return [Math.min(...pts.map(q => q[0])), Math.min(...pts.map(q => q[1])), Math.max(...pts.map(q => q[0])), Math.max(...pts.map(q => q[1]))]; }
  if (p.t === 'mtext') { const ls = String(p.text).split('\n'), lh = p.h * 1.667 * (p.lineSpacing || 1), H = p.h + (ls.length - 1) * lh, w = p.w > 0 ? Math.min(p.w, Math.max(...ls.map(l => l.length)) * p.h * CHAR) : Math.max(...ls.map(l => l.length)) * p.h * CHAR, col = ((p.attach || 1) - 1) % 3, row = Math.floor(((p.attach || 1) - 1) / 3); const x = col === 1 ? p.x - w / 2 : col === 2 ? p.x - w : p.x, yt = row === 0 ? p.y : row === 1 ? p.y + H / 2 : p.y + H; const rot = ((p.rot || 0) % 360 + 360) % 360; if (rot < 0.5 || rot > 359.5) return [x, yt - H, x + w, yt];
    const r = rot * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r), pts = [[x, yt - H], [x + w, yt - H], [x + w, yt], [x, yt]].map(([u, v]) => [p.x + (u - p.x) * c - (v - p.y) * sn, p.y + (u - p.x) * sn + (v - p.y) * c]); return [Math.min(...pts.map(q => q[0])), Math.min(...pts.map(q => q[1])), Math.max(...pts.map(q => q[0])), Math.max(...pts.map(q => q[1]))]; }
  if (p.t === 'viewport') return [p.cx - p.w / 2, p.cy - p.h / 2, p.cx + p.w / 2, p.cy + p.h / 2];
  return null;
}

function clipSeg(x1, y1, x2, y2, B) {   // Liang-Barsky: the part of a segment inside a box, or null
  let t0 = 0, t1 = 1; const dx = x2 - x1, dy = y2 - y1;
  for (const [p, q] of [[-dx, x1 - B[0]], [dx, B[2] - x1], [-dy, y1 - B[1]], [dy, B[3] - y1]]) { if (p === 0) { if (q < 0) return null; } else { const r = q / p; if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; } } }
  return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy];
}
// model space seen through a viewport: moved and scaled onto the sheet, cut at the viewport's edge
function throughViewport(model, vp) {
  const s = vp.h / (vp.vh || vp.h), Mv = [s, 0, 0, s, vp.cx - vp.vcx * s, vp.cy - vp.vcy * s], B = [vp.cx - vp.w / 2, vp.cy - vp.h / 2, vp.cx + vp.w / 2, vp.cy + vp.h / 2], out = [];
  const inB = (x, y) => x >= B[0] && x <= B[2] && y >= B[1] && y <= B[3];
  for (const p of model) {
    if (p.t === 'line') { const [a, b] = ap(Mv, p.x1, p.y1), [c, d] = ap(Mv, p.x2, p.y2), k = clipSeg(a, b, c, d, B); if (k) out.push({ ...p, x1: k[0], y1: k[1], x2: k[2], y2: k[3], space: 'model' }); }
    else if (p.t === 'pline') { const pts = p.pts.map(([x, y]) => ap(Mv, x, y)); let run = []; for (let i = 1; i < pts.length; i++) { const k = clipSeg(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], B); if (!k) { if (run.length > 1) out.push({ ...p, pts: run, space: 'model' }); run = []; continue; } if (!run.length) run.push([k[0], k[1]]); run.push([k[2], k[3]]); if (k[2] !== pts[i][0] || k[3] !== pts[i][1]) { out.push({ ...p, pts: run, space: 'model' }); run = []; } } if (run.length > 1) out.push({ ...p, pts: run, space: 'model', circle: p.circle && inB(...ap(Mv, p.circle.x, p.circle.y)) ? { ...p.circle, x: ap(Mv, p.circle.x, p.circle.y)[0], y: ap(Mv, p.circle.x, p.circle.y)[1], r: p.circle.r * s } : undefined }); }
    else if (p.t === 'fill') { const pts = p.pts.map(([x, y]) => ap(Mv, x, y)); if (pts.every(([x, y]) => inB(x, y))) out.push({ ...p, pts, rings: p.rings && p.rings.map(r => r.map(([x, y]) => ap(Mv, x, y))), space: 'model' }); }
    else if (p.t === 'text' || p.t === 'mtext') { const [x, y] = ap(Mv, p.x, p.y); if (inB(x, y)) out.push({ ...p, x, y, h: p.h * s, w: p.w ? p.w * s : p.w, space: 'model', modelX: p.x, modelY: p.y }); }
  }
  return out;
}

// the drawing as primitives: space 'model', a layout's name, or 'auto' (the first layout that has anything on it, else model space)
function read(fileOrBuf, { space = 'auto' } = {}) {
  const doc = parse(Buffer.isBuffer(fileOrBuf) ? fileOrBuf : fs.readFileSync(fileOrBuf));
  const model = emit(doc, doc.entities.filter(e => !e.pairs.some(p => p[0] === 67 && p[1].trim() === '1')), ID, [], { space: 'model' });
  const paperOf = (lay) => {
    const ents = /^\*Paper_Space$/i.test(lay.block) ? doc.entities.filter(e => e.pairs.some(p => p[0] === 67 && p[1].trim() === '1')) : ((doc.blocks[lay.block] || {}).ents || []);
    const own = emit(doc, ents, ID, [], { space: 'paper' });
    const vps = own.filter(p => p.t === 'viewport'), seen = vps.flatMap(vp => throughViewport(model, vp));
    return { own: own.filter(p => p.t !== 'viewport' && p.t !== 'insertmark'), vps, prims: [...seen, ...own.filter(p => p.t !== 'viewport' && p.t !== 'insertmark')], marks: own.filter(p => p.t === 'insertmark') };
  };
  const layouts = doc.layouts.map(l => ({ ...l, ...paperOf(l) }));
  let chosen = null;
  if (space === 'model') chosen = null;
  else if (space && space !== 'auto') { chosen = layouts.find(l => l.name.toLowerCase() === String(space).toLowerCase()); if (!chosen) throw new Error(`No layout called "${space}". Layouts: ${layouts.map(l => l.name).join(', ') || '(none)'}`); }
  else chosen = layouts.find(l => l.own.length > 0 && l.vps.length) || layouts.find(l => l.own.length > 5) || null;
  const prims = chosen ? chosen.prims : model.filter(p => p.t !== 'insertmark');
  return { doc, prims, model: model.filter(p => p.t !== 'insertmark'), marks: model.filter(p => p.t === 'insertmark'), space: chosen ? chosen.name : 'model', layouts: layouts.map(l => ({ name: l.name, items: l.own.length, viewports: l.vps.length })), bounds: boundsOf(prims), styles: doc.styles, version: doc.version };
}

module.exports = { read, parse, emit, boundsOf, boxOf, decode, mtextPlain, aciHex, clipSeg };
