// Dex's tools: read the text out of an ASCII DXF and change exact pieces of it. The original is never touched:
// the fixed copy is a new file, byte-for-byte the same apart from the text values that were changed.
'use strict';
const { normKey } = require('./checker');

const TEXT_TYPES = new Set(['TEXT', 'MTEXT', 'ATTRIB']);

function decode(buf) {
  const head = buf.slice(0, 22).toString('latin1');
  if (/^AutoCAD Binary DXF/.test(head)) throw new Error('This is a binary DXF. Save it as an ASCII DXF and try again.');
  if (buf.slice(0, 2).toString('latin1') === 'AC' && /^AC10\d\d/.test(buf.slice(0, 6).toString('latin1'))) throw new Error('This is a DWG, not a DXF. Save it as a DXF first.');
  return buf.toString('latin1');   // latin1 both ways keeps every byte exactly as it was
}

function parseDxf(buf) {
  const text = decode(buf);
  const eol = /\r\n/.test(text.slice(0, 4000)) ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push({ code: parseInt(lines[i].trim(), 10), val: lines[i + 1] });
  if (!pairs.length || pairs.some(p => Number.isNaN(p.code))) throw new Error('This does not look like an ASCII DXF file.');
  const ents = []; let section = '', cur = null;
  for (let i = 0; i < pairs.length; i++) {
    const { code, val } = pairs[i];
    if (code === 0) {
      cur = null;
      if (val === 'SECTION') { const n = pairs[i + 1]; section = n && n.code === 2 ? n.val : ''; }
      else if (val === 'ENDSEC') section = '';
      else if (TEXT_TYPES.has(val)) { cur = { type: val, section, at: i, layer: '', refs: [] }; ents.push(cur); }
      continue;
    }
    if (!cur) continue;
    if (code === 8) cur.layer = val;
    else if (code === 1 || (code === 3 && cur.type === 'MTEXT')) cur.refs.push(i);
    else if (code === 10 && cur.x === undefined) cur.x = parseFloat(val);
    else if (code === 20 && cur.y === undefined) cur.y = parseFloat(val);
  }
  for (const e of ents) e.plain = plainText(e.refs.map(r => pairs[r].val).join(''));
  return { pairs, eol, ents, lines };
}

function plainText(s) {
  return s.replace(/\\P/g, ' ').replace(/\\[fFHCcTQWAapx][^;]*;/g, '').replace(/\\[LlOoKk~]/g, '').replace(/\\\\/g, '\\').replace(/[{}]/g, '').replace(/%%[dDpPcC]/g, '').replace(/\s+/g, ' ').trim();
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tokenRe = (before) => new RegExp('(^|[^A-Za-z0-9])(' + esc(before) + ')(?![A-Za-z0-9])', 'g');   // whole-tag match, not a piece of a longer tag

// how many places would this fix change in this file (without changing anything)
function countMatches(dxf, before) {
  const re = tokenRe(before); let n = 0, inBlocks = 0;
  for (const e of dxf.ents) for (const r of e.refs) { const m = dxf.pairs[r].val.match(re); if (m) { if (e.section === 'BLOCKS') inBlocks += m.length; else n += m.length; } }
  return { places: n, inBlocks };
}

// fixes: [{ id, before, after }]. Returns { buf, results: [{ id, places, inBlocks, status, reason }] }
function applyFixes(buf, fixes) {
  const dxf = parseDxf(buf); const results = [];
  const before = dxf.pairs.map(p => p.val);
  for (const f of fixes) {
    const res = { id: f.id, before: f.before, after: f.after, places: 0, inBlocks: 0, status: 'applied', reason: '' };
    if (!f.before || !f.after) { res.status = 'skipped'; res.reason = 'No exact before and after text.'; results.push(res); continue; }
    if (/[^\x20-\x7E]/.test(f.after) || /[\r\n]/.test(f.after)) { res.status = 'skipped'; res.reason = 'The new text has characters Dex will not write into a DXF.'; results.push(res); continue; }
    const re = tokenRe(f.before);
    for (const e of dxf.ents) { if (e.section === 'BLOCKS') { for (const r of e.refs) { const m = dxf.pairs[r].val.match(re); if (m) res.inBlocks += m.length; } continue; }
      for (const r of e.refs) { const v = dxf.pairs[r].val; const m = v.match(re); if (m) { res.places += m.length; dxf.pairs[r].val = v.replace(re, (_x, pre) => pre + f.after); } } }
    if (!res.places) { res.status = 'not found'; res.reason = res.inBlocks ? 'Only found inside a symbol (block) definition, which would change every copy of it. Left alone.' : 'The text was not found on the drawing.'; }
    results.push(res);
  }
  // rebuild: untouched lines stay exactly as they were
  const out = dxf.lines.slice();
  let changed = 0;
  dxf.pairs.forEach((p, i) => { if (p.val !== before[i]) { out[i * 2 + 1] = p.val; changed++; } });
  const outText = out.join(dxf.eol);
  // check: same structure, only the value lines we meant to change differ
  const re2 = parseDxf(Buffer.from(outText, 'latin1'));
  if (re2.pairs.length !== dxf.pairs.length || re2.ents.length !== dxf.ents.length) throw new Error('Dex stopped: the fixed file did not keep the same structure as the original.');
  return { buf: Buffer.from(outText, 'latin1'), results, linesChanged: changed };
}

// ---- turning markups into proposed fixes ----
// From Cal's last check. Only a typo on the drawing is a text change on the drawing itself; everything else is a schedule change or needs a person.
function proposalsFromFindings(findings) {
  return findings.map((f, i) => {
    const base = { id: 'F' + (i + 1), drawing: f.group, note: f.text, kind: f.kind };
    if (f.kind === 'typo' && f.before && f.after) return { ...base, action: 'replace_text', before: f.before, after: f.after, why: 'Typo printed on the drawing' };
    if (f.kind === 'typo') return { ...base, action: 'none', why: 'The note does not say what the text should be' };
    if (f.kind === 'add' || f.kind === 'missing_on_dwg') return { ...base, action: 'none', why: 'Needs a person: it means adding or moving a cable on the drawing' };
    return { ...base, action: 'none', why: 'Schedule change, nothing to change in the DXF' };
  });
}

const DEX_SYSTEM = `You read the red CHECK NOTES printed on marked-up engineering drawing PDFs. Each marked-up PDF has a strip of numbered red notes on the right of the page, headed with the drawing number.
For EVERY numbered note, return one item. Decide whether the note says that a piece of TEXT PRINTED ON THE DRAWING ITSELF is wrong and gives the exact correct text (typically a typo note such as: Typo on the drawing: "C-1O4" should be "C-104"). Only then use action "replace_text" with the exact before and after text.
Notes that say the SCHEDULE should change (BEFORE/AFTER of a schedule value), that a cable is missing from the schedule, that a schedule row is not on the drawing, struck rows, duplicates, or anything that needs a person to decide, are action "none" with a short why.
Never guess the after text. If the note does not give it, use "none".
Return ONLY JSON: {"items":[{"drawing":"drawing number","note":"the note text, shortened","action":"replace_text"|"none","before":"","after":"","why":"short reason"}]}`;

function matchFile(drawing, files) {
  const k = normKey(drawing || ''); if (!k) return null;
  const byName = files.find(f => normKey(f.name.replace(/\.dxf$/i, '')).includes(k) || k.includes(normKey(f.name.replace(/\.dxf$/i, ''))));
  if (byName) return byName;
  return files.find(f => { try { return parseDxf(Buffer.from(f.base64, 'base64')).ents.some(e => normKey(e.plain) === k); } catch { return false; } }) || null;
}

module.exports = { parseDxf, applyFixes, countMatches, proposalsFromFindings, matchFile, plainText, DEX_SYSTEM };
