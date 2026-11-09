// Rev up an existing DXF sheet, title block only: a NEW issue box is added beside the last one (P04 next to P01 P02 P03, with today's
// date, the initials and the issue status), the ISSUE field in the title block goes to the new rev, and nothing in the drawing itself
// is touched. The issue boxes are found from the sheet: the texts that read like a revision (P03) in the ENTITIES section, in a row along
// the bottom; the box is the lines and texts around the last of them; the pitch is the distance between boxes.
'use strict';
const dxffix = require('./dxffix');

const REV = /^[PCAX]\d{2}$/i;
const DATE = /^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/;
const STATUS = /^(ISSUED? FOR [A-Z ]+|PRELIMINARY|FOR CONSTRUCTION|FOR APPROVAL|FOR INFORMATION|FOR COMMENT|FOR TENDER|AS BUILT)$/i;
const today = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`; };
const nextOf = (rev) => String(rev).replace(/\d+$/, (n) => String(+n + 1).padStart(n.length, '0'));

// every entity in the ENTITIES section with its pair range and the x / y values it carries
function entities(P) {
  let sec = ''; const out = [];
  for (let i = 0; i < P.length; i++) { const p = P[i]; if (p.code !== 0) continue; if (p.val === 'SECTION') sec = (P[i + 1] || {}).val || ''; else if (p.val === 'ENDSEC') sec = ''; else if (sec === 'ENTITIES') out.push({ type: p.val, at: i }); }
  for (let k = 0; k < out.length; k++) { const e = out[k]; e.end = k + 1 < out.length ? out[k + 1].at : P.length; const xs = [], ys = []; let text = ''; for (let j = e.at + 1; j < e.end; j++) { const p = P[j]; if (p.code === 0) { e.end = j; break; } if (p.code === 101) { for (let m = j; m < e.end; m++) if (P[m].code === 0) { e.end = m; break; } break; } /* an embedded object (2018 MTEXT) has its own 10/11 codes: not geometry */ const dir = e.type === 'MTEXT' && (p.code === 11 || p.code === 21);   /* an MTEXT's 11/21 is its direction, not a point */ if (!dir && (p.code === 10 || p.code === 11)) xs.push(+p.val); if (!dir && (p.code === 20 || p.code === 21)) ys.push(+p.val); if (p.code === 1 || (p.code === 3 && e.type === 'MTEXT')) text += p.val; } e.xs = xs; e.ys = ys; e.text = dxffix.plainText(text).trim(); }
  return out;
}
const handleNum = (h) => { const n = parseInt(h, 16); return Number.isNaN(n) ? 0 : n; };

// what the sheet's issue boxes look like: the row of revision texts, the pitch and the rectangle of the last box
function issueBoxes(P, ents) {
  const texts = ents.filter(e => (e.type === 'TEXT' || e.type === 'MTEXT') && REV.test(e.text) && e.xs.length && e.ys.length);
  if (!texts.length) return null;
  // the row: the y that holds the most revision texts (the title block's own ISSUE field sits elsewhere)
  const rows = new Map(); for (const t of texts) { const k = Math.round(t.ys[0]); rows.set(k, [...(rows.get(k) || []), t]); }
  // a revision row climbs left to right (P01 P02 P03) with no repeats: a row of the same text over and over (A70 A70 A70 down a cable
  // list) is not one, nor is a row whose texts are out of order
  const climbs = (r) => { const v = r.slice().sort((a, b) => a.xs[0] - b.xs[0]).map(t => t.text.toUpperCase()); return new Set(v).size === v.length && v.every((x, i) => !i || (x[0] === v[i - 1][0] ? +x.slice(1) > +v[i - 1].slice(1) : 'PACX'.indexOf(x[0]) > 'PACX'.indexOf(v[i - 1][0]))); };
  const cands = [...rows.values()].filter(climbs); if (!cands.length) return null;
  // with one box only (a P01 sheet) the title block's own ISSUE field is a row of one too: the box row is the one with an ISSUE label just to its left
  const labelled = (r) => r.some(t => ents.some(e => /^ISSUE$/i.test(e.text) && e.xs.length && Math.abs(e.ys[0] - t.ys[0]) < 3 * (t.h || 5) && e.xs[0] < t.xs[0] && t.xs[0] - e.xs[0] < 80)) ? 1 : 0;
  const row = cands.sort((a, b) => b.length - a.length || labelled(b) - labelled(a) || a[0].ys[0] - b[0].ys[0])[0].sort((a, b) => a.xs[0] - b.xs[0]);
  const last = row[row.length - 1]; let pitch = row.length >= 2 ? last.xs[0] - row[row.length - 2].xs[0] : 0;
  // a sheet at its first issue has one box: the pitch is that box's width, read off the horizontal line that runs under or over it
  if (!(pitch > 0)) { const hh = last.h || 5, lx = last.xs[0], ly = last.ys[0];
    const spans = ents.filter(e => (e.type === 'LINE' || e.type === 'LWPOLYLINE') && e.ys.length >= 2 && Math.max(...e.ys) - Math.min(...e.ys) < 0.01 && Math.abs(e.ys[0] - ly) < 12 * hh && Math.min(...e.xs) < lx && Math.max(...e.xs) > lx).map(e => Math.max(...e.xs) - Math.min(...e.xs)).filter(w => w > 4 * hh).sort((a, b) => a - b);
    pitch = spans[0] || 0; }
  if (!(pitch > 0)) return null;
  // the band: everything near the revision row's height (the issue box is a few text lines tall)
  const y = last.ys[0], h = last.h || 5;
  const near = ents.filter(e => e.xs.length && e.ys.every(v => v >= y - 12 * h && v <= y + 4 * h) && e.xs.every(v => v >= last.xs[0] - pitch && v < last.xs[0] + pitch));
  const left = Math.min(...near.filter(e => e.xs.every(v => v > last.xs[0] - pitch * 0.5) || (row.length === 1 && e.xs.every(v => v < last.xs[0] + pitch) && Math.min(...e.xs) > last.xs[0] - pitch)).map(e => Math.min(...e.xs)));
  const x0 = left - 0.5, x1 = left + pitch + 0.5;   // the last box spans one pitch from its left edge
  const inBox = ents.filter(e => e.type !== 'INSERT' && e.xs.length && e.xs.every(v => v >= x0 && v <= x1) && e.ys.every(v => v >= y - 12 * h && v <= y + 4 * h));
  const yMin = Math.min(...inBox.map(e => Math.min(...e.ys))), yMax = Math.max(...inBox.map(e => Math.max(...e.ys)));
  let box = ents.filter(e => e.type !== 'INSERT' && e.xs.length && e.xs.every(v => v >= x0 && v <= x1) && e.ys.every(v => v >= yMin - 0.5 && v <= yMax + 0.5));
  // the box's own height is set by its vertical dividers (the tallest ones): anything reaching below or above them is the sheet's, not the
  // box's. The frame's centre mark hangs just under the P02 box and was copied across with it (Five Fords P03, 9 Nov)
  const vert = (e) => (e.type === 'LINE' || e.type === 'LWPOLYLINE') && e.xs.length >= 2 && Math.max(...e.xs) - Math.min(...e.xs) < 0.01;
  const posts = box.filter(vert), tall = posts.length ? Math.max(...posts.map(e => Math.max(...e.ys) - Math.min(...e.ys))) : 0;
  const frame = posts.filter(e => Math.max(...e.ys) - Math.min(...e.ys) > tall * 0.9);
  const yLo = frame.length ? Math.min(...frame.map(e => Math.min(...e.ys))) : yMin, yHi = frame.length ? Math.max(...frame.map(e => Math.max(...e.ys))) : yMax;
  box = box.filter(e => e.ys.every(v => v >= yLo - 0.5 && v <= yHi + 0.5));
  // where the row of boxes ends: the horizontal rules along the top or bottom of the boxes run on to the title block. A new box one pitch
  // along that would stop short of it (P03 ended at 320 with the title block at 322: a thin double line) is stretched to meet it; one
  // that would run past it has no room, and Tom has to say what he wants
  const right = Math.max(...box.map(e => Math.max(...e.xs)));
  const flat = (e) => (e.type === 'LINE' || e.type === 'LWPOLYLINE') && e.ys.length >= 2 && Math.max(...e.ys) - Math.min(...e.ys) < 0.01;
  const rules = ents.filter(e => flat(e) && [yLo, yHi].some(v => Math.abs(e.ys[0] - v) < 0.5) && Math.min(...e.xs) <= x0 + 0.5 && Math.max(...e.xs) > right + 0.5);
  const rowEnd = rules.length ? Math.max(...rules.map(e => Math.max(...e.xs))) : null;
  return { row, last, pitch, box, right, rowEnd, rev: last.text.toUpperCase() };
}

// opts: { to, status, drawn, checked, approved, date }
function revUp(buf, opts = {}) {
  buf = repairBoxes(buf).buf;   // a sheet revved up by an earlier version: its skewed box texts put right first
  const dxf = dxffix.parseDxf(buf), P = dxf.pairs.map(p => ({ ...p })), ents = entities(P);
  const ib = issueBoxes(P, ents); if (!ib) throw new Error('no issue boxes found on the sheet (no row of revision texts such as P01 P02 P03)');
  const cur = ib.rev, next = (opts.to && REV.test(opts.to) ? opts.to.toUpperCase() : nextOf(cur));
  if (next === cur) throw new Error(`the sheet is already at ${cur}`);
  const seedAt = P.findIndex((p, i) => p.code === 9 && p.val === '$HANDSEED' && P[i + 1] && P[i + 1].code === 5);
  let nextHandle = Math.max(seedAt >= 0 ? handleNum(P[seedAt + 1].val) : 0, 1 + P.reduce((m, p) => p.code === 5 ? Math.max(m, handleNum(p.val)) : m, 0));
  const status = opts.status ? String(opts.status).toUpperCase() : '';
  const changes = { rev: 0, date: 0, status: 0, people: 0, cloned: 0, titleRev: 0 };
  // initials: the DRAWN / CHECKED / APPROVED values of the last box are its two-or-three-letter MTEXTs, top to bottom; new ones when given
  const initials = ib.box.filter(e => (e.type === 'MTEXT' || e.type === 'TEXT') && /^[A-Z]{2,3}$/.test(e.text) && !/^(TBC|NG|ISO|CAD)$/.test(e.text)).sort((a, b) => b.ys[0] - a.ys[0]);
  const who = new Map(); [opts.drawn, opts.checked, opts.approved].forEach((v, i) => { if (v && initials[i]) who.set(initials[i], String(v).toUpperCase().slice(0, 3)); });
  // the new box's right edge: one pitch along, or onto the end of the row when that is a little further (see issueBoxes)
  const edge = ib.right + ib.pitch;
  if (ib.rowEnd != null && ib.rowEnd < edge - 0.5) throw new Error(`no room for another issue box: the row ends at ${ib.rowEnd.toFixed(1)}, the new box would run to ${edge.toFixed(1)}`);
  const snapTo = ib.rowEnd != null && ib.rowEnd - edge > 0.01 && ib.rowEnd - edge <= ib.pitch * 0.15 ? ib.rowEnd : null;
  changes.stretched = snapTo != null ? +(snapTo - edge).toFixed(3) : 0;
  // the Remarks cell: the label stays, the last box's own remark lines are not carried into the new box (the block diagram's P02 remark
  // would have been repeated on P03), and the new box gets opts.remarks under its label the way the sheet writes them (Tom 9 Nov)
  const isText = (e) => e.type === 'TEXT' || e.type === 'MTEXT';
  const label = ib.box.find(e => isText(e) && /^remarks?:?$/i.test(e.text.trim()));
  const dateY = Math.max(-Infinity, ...ib.box.filter(e => isText(e) && (DATE.test(e.text) || /^date$/i.test(e.text.trim()))).map(e => e.ys[0]));
  const oldRemarks = label ? ib.box.filter(e => isText(e) && e !== label && e.xs[0] >= label.xs[0] - 0.5 && e.xs[0] <= label.xs[0] + 3 && e.ys[0] < label.ys[0] - 0.5 && e.ys[0] > dateY + 0.5 && !REV.test(e.text) && !DATE.test(e.text) && !/^[A-Z]{2,3}$/.test(e.text.trim())) : [];   /* lines written under the label, not the box's own fields */
  changes.remarksDropped = oldRemarks.length;
  let labelCopy = null;
  // the new box: every entity of the last box shifted one pitch right, with the new values
  const clone = [];
  for (const e of ib.box) {
    if (oldRemarks.includes(e)) continue;
    let stop = e.end; while (stop < P.length && P[stop].code !== 0) stop++;   // the whole entity, embedded object included
    const np = P.slice(e.at, stop).map(p => ({ ...p })); let seenText = false, embedded = false;
    for (const p of np) {
      if (p.code === 101) embedded = true;   // an MTEXT's embedded object (AutoCAD 2018+): there 10 is the DIRECTION and 11 the insertion point, the other way round from the entity itself
      if (p.code === 5) p.val = (nextHandle++).toString(16).toUpperCase();
      else if (e.type === 'MTEXT' ? (embedded ? p.code === 11 : p.code === 10) : (p.code === 10 || p.code === 11)) p.val = String(snapTo != null && (e.type === 'LINE' || e.type === 'LWPOLYLINE') && Math.abs(+p.val - ib.right) < 0.01 ? snapTo : +p.val + ib.pitch);   /* a line on the box's right edge lands on the end of the row */   // every insertion point one pitch right; direction vectors untouched (Tom 9 Nov: the new box's texts came out skewed off the sheet)
      else if (p.code === 1 || (p.code === 3 && e.type === 'MTEXT')) {
        if (seenText && p.code === 1 && e.type === 'MTEXT') { p.val = ''; continue; }   // long MTEXT split over 3/1 codes: the value goes in once
        seenText = true; const t = e.text;
        if (REV.test(t)) { p.val = next; changes.rev++; }
        else if (DATE.test(t)) { p.val = opts.date || require('./docrev').todayLike(t); changes.date++; }   // today, written the way the sheet's earlier boxes write dates (30/09/2026 -> 09/11/2026, not 09/11/26)
        else if (STATUS.test(t) && status) { p.val = status; changes.status++; }
        else if (who.has(e)) { p.val = who.get(e); changes.people++; }
        else p.val = t;   // the same label, as plain text
      }
    }
    clone.push(...np); changes.cloned++;
    if (e === label) labelCopy = { np, type: e.type };
  }
  if (opts.remarks && String(opts.remarks).trim()) {
    if (!labelCopy) throw new Error('the issue box has no Remarks label to write the remark under');
    const hAt = labelCopy.np.find(p => p.code === 40), h = hAt ? +hAt.val || 2 : 2;
    const cellRight = snapTo != null ? snapTo : edge, room = Math.max(10, Math.floor((cellRight - (label.xs[0] + ib.pitch) - h) / (h * 0.95)));
    const words = String(opts.remarks).trim().split(/\s+/), lines = [];
    for (const w of words) { const l = lines.length ? lines[lines.length - 1] : null; if (l !== null && (l + ' ' + w).length <= room) lines[lines.length - 1] = l + ' ' + w; else lines.push(w); }
    lines.forEach((text, i) => {
      const dy = h * 2 + i * h * 1.75; let emb = false, seen = false;   // first line 4 below the label, then 3.5 apart at height 2 (the block diagram's P02)
      const np = labelCopy.np.map(p => ({ ...p }));
      for (const p of np) {
        if (p.code === 101) emb = true;
        if (p.code === 5) p.val = (nextHandle++).toString(16).toUpperCase();
        else if (labelCopy.type === 'MTEXT' ? (emb ? p.code === 21 : p.code === 20) : (p.code === 20 || p.code === 21)) p.val = String(+p.val - dy);
        else if (p.code === 1 && !seen) { p.val = text; seen = true; }
        else if (p.code === 1 || (p.code === 3 && labelCopy.type === 'MTEXT')) p.val = '';
      }
      clone.push(...np);
    });
    changes.remarks = lines.length;
  }
  // the title block's own ISSUE field (an ATTRIB or text outside the issue boxes reading the current rev) goes to the new rev
  for (const e of ents) { if (!REV.test(e.text) || e.text.toUpperCase() !== cur || ib.row.includes(e)) continue; for (let j = e.at + 1; j < e.end; j++) if (P[j].code === 1 || (P[j].code === 3 && e.type === 'MTEXT')) { P[j].val = P[j].code === 1 ? next : ''; changes.titleRev++; } }
  // new entities go at the end of the ENTITIES section
  let insertAt = -1;
  for (let i = 0; i < P.length; i++) if (P[i].code === 0 && P[i].val === 'SECTION' && P[i + 1] && P[i + 1].val === 'ENTITIES') { for (let j = i + 2; j < P.length; j++) if (P[j].code === 0 && P[j].val === 'ENDSEC') { insertAt = j; break; } break; }
  if (insertAt < 0) throw new Error('no ENTITIES section');
  P.splice(insertAt, 0, ...clone);
  if (seedAt >= 0) P[seedAt + 1].val = nextHandle.toString(16).toUpperCase();
  const out = P.map(p => `${p.raw}${dxf.eol}${p.val}`).join(dxf.eol) + dxf.eol;
  // latin1 back out, byte for byte, the way the file was read: writing utf8 turned every ² in "2.5mm²" into Ã‚Â² (Tom 9 Nov)
  dxffix.parseDxf(Buffer.from(out, 'latin1'));   // it still opens as a DXF
  return { buf: Buffer.from(out, 'latin1'), from: cur, to: next, changes, pitch: ib.pitch };
}

// repair for sheets revved up before 9 Nov 2026: the cloned MTEXTs had their embedded object's direction vector shifted (10 = 131,0 instead
// of 1,0) and the embedded insertion point left behind, so the new box's texts drew skewed off the sheet. Puts the direction back to (1,0)
// and the embedded insertion point on the entity's own. Idempotent; returns { buf, fixed }.
function repairBoxes(buf) {
  // text written back as utf8 by a version before 9 Nov (a ² became Ã‚Â²): one level of that undone, only when its fingerprint is there
  // only the exact doubled sequence is undone (C3 82 C2 B2 -> C2 B2): decoding the whole file as utf8 would have mangled any other ° or ±
  let mojibake = 0; { const t0 = buf.toString('latin1'); const t1 = t0.replace(/\xC3([\x82\x83])\xC2([\x80-\xBF])/g, (_m, a, b) => { mojibake++; return String.fromCharCode(0xC0 | (a.charCodeAt(0) & 0x3F)) + b; }); if (mojibake) buf = Buffer.from(t1, 'latin1'); }
  const text = buf.toString('latin1'), eol = /\r\n/.test(text.slice(0, 2000)) ? '\r\n' : '\n', L = text.split(/\r?\n/); let fixed = 0;
  const pairs = []; for (let i = 0; i + 1 < L.length; i += 2) pairs.push({ code: parseInt(L[i], 10), raw: L[i], val: L[i + 1] });
  for (let i = 0; i < pairs.length; i++) {
    if (!(pairs[i].code === 0 && pairs[i].val === 'MTEXT')) continue;
    let j = i + 1, ix = null, iy = null, emb = -1; while (j < pairs.length && pairs[j].code !== 0) { const p = pairs[j]; if (emb < 0 && p.code === 10) ix = p.val; if (emb < 0 && p.code === 20) iy = p.val; if (p.code === 101) emb = j; j++; }
    if (emb < 0 || ix === null) continue;
    let d10 = -1, d20 = -1, e11 = -1, e21 = -1; for (let k = emb + 1; k < j; k++) { const c = pairs[k].code; if (c === 10 && d10 < 0) d10 = k; else if (c === 20 && d20 < 0) d20 = k; else if (c === 11 && e11 < 0) e11 = k; else if (c === 21 && e21 < 0) e21 = k; }
    if (d10 < 0 || e11 < 0) continue;
    const dx = +pairs[d10].val, dy = d20 >= 0 ? +pairs[d20].val : 0, skew = Math.abs(Math.hypot(dx, dy) - 1) > 0.01, adrift = Math.abs(+pairs[e11].val - +ix) > 0.01 || (e21 >= 0 && iy !== null && Math.abs(+pairs[e21].val - +iy) > 0.01);
    if (!skew) continue;   // the old bug always left a non-unit direction; an MTEXT whose embedded point merely differs is AutoCAD's own and left alone
    if (skew) { const n = Math.hypot(dx, dy) || 1; pairs[d10].val = String(dx / n); if (d20 >= 0) pairs[d20].val = String(dy / n); }
    pairs[e11].val = ix; if (e21 >= 0 && iy !== null) pairs[e21].val = iy; fixed++;
  }
  return { buf: fixed ? Buffer.from(pairs.map(p => p.raw + eol + p.val).join(eol) + eol, 'latin1') : buf, fixed: fixed + (mojibake ? 1 : 0) };
}
module.exports = { repairBoxes, nextOf, revUp, issueBoxes, entities };
