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
  const row = [...rows.values()].sort((a, b) => b.length - a.length || a[0].ys[0] - b[0].ys[0])[0].sort((a, b) => a.xs[0] - b.xs[0]);
  const last = row[row.length - 1], pitch = row.length >= 2 ? last.xs[0] - row[row.length - 2].xs[0] : 0;
  if (!(pitch > 0)) return null;
  // the band: everything near the revision row's height (the issue box is a few text lines tall)
  const y = last.ys[0], h = last.h || 5;
  const near = ents.filter(e => e.xs.length && e.ys.every(v => v >= y - 12 * h && v <= y + 4 * h) && e.xs.every(v => v >= last.xs[0] - pitch && v < last.xs[0] + pitch));
  const left = Math.min(...near.filter(e => e.xs.every(v => v > last.xs[0] - pitch * 0.5)).map(e => Math.min(...e.xs)));
  const x0 = left - 0.5, x1 = left + pitch + 0.5;   // the last box spans one pitch from its left edge
  const inBox = ents.filter(e => e.type !== 'INSERT' && e.xs.length && e.xs.every(v => v >= x0 && v <= x1) && e.ys.every(v => v >= y - 12 * h && v <= y + 4 * h));
  const yMin = Math.min(...inBox.map(e => Math.min(...e.ys))), yMax = Math.max(...inBox.map(e => Math.max(...e.ys)));
  const box = ents.filter(e => e.type !== 'INSERT' && e.xs.length && e.xs.every(v => v >= x0 && v <= x1) && e.ys.every(v => v >= yMin - 0.5 && v <= yMax + 0.5));
  return { row, last, pitch, box, rev: last.text.toUpperCase() };
}

// opts: { to, status, drawn, checked, approved, date }
function revUp(buf, opts = {}) {
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
  // the new box: every entity of the last box shifted one pitch right, with the new values
  const clone = [];
  for (const e of ib.box) {
    let stop = e.end; while (stop < P.length && P[stop].code !== 0) stop++;   // the whole entity, embedded object included
    const np = P.slice(e.at, stop).map(p => ({ ...p })); let seenText = false;
    for (const p of np) {
      if (p.code === 5) p.val = (nextHandle++).toString(16).toUpperCase();
      else if (p.code === 10 || (p.code === 11 && e.type !== 'MTEXT')) p.val = String(+p.val + ib.pitch);   // the embedded object's insertion point moves too
      else if (p.code === 1 || (p.code === 3 && e.type === 'MTEXT')) {
        if (seenText && p.code === 1 && e.type === 'MTEXT') { p.val = ''; continue; }   // long MTEXT split over 3/1 codes: the value goes in once
        seenText = true; const t = e.text;
        if (REV.test(t)) { p.val = next; changes.rev++; }
        else if (DATE.test(t)) { p.val = opts.date || today(); changes.date++; }
        else if (STATUS.test(t) && status) { p.val = status; changes.status++; }
        else if (who.has(e)) { p.val = who.get(e); changes.people++; }
        else p.val = t;   // the same label, as plain text
      }
    }
    clone.push(...np); changes.cloned++;
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
  dxffix.parseDxf(Buffer.from(out, 'utf8'));   // it still opens as a DXF
  return { buf: Buffer.from(out, 'utf8'), from: cur, to: next, changes, pitch: ib.pitch };
}

module.exports = { revUp, issueBoxes, entities };
