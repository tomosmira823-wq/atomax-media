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
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push({ code: parseInt(lines[i].trim(), 10), raw: lines[i], val: lines[i + 1] });
  if (!pairs.length || pairs.some(p => Number.isNaN(p.code))) throw new Error('This does not look like an ASCII DXF file.');
  const ents = [], inserts = {}, layers = new Set(); let section = '', cur = null, block = '', last = null, kind = '', ver = '';
  for (let i = 0; i < pairs.length; i++) {
    const { code, val } = pairs[i];
    if (code === 0) {
      if (last) last.end = i; last = null; cur = null; kind = val;
      if (val === 'SECTION') { const n = pairs[i + 1]; section = n && n.code === 2 ? n.val : ''; }
      else if (val === 'ENDSEC') { section = ''; block = ''; }
      else if (val === 'ENDBLK') block = '';
      else if (TEXT_TYPES.has(val)) { cur = last = { type: val, section, at: i, end: pairs.length, layer: '', refs: [], block: section === 'BLOCKS' ? block : '' }; ents.push(cur); }
      continue;
    }
    if (kind === 'BLOCK' && code === 2 && section === 'BLOCKS' && !block) block = val;
    else if (kind === 'INSERT' && code === 2 && section === 'ENTITIES') inserts[val] = (inserts[val] || 0) + 1;
    else if (kind === 'LAYER' && code === 2 && section === 'TABLES') layers.add(val);
    else if (code === 9 && val === '$ACADVER' && pairs[i + 1]) ver = pairs[i + 1].val;
    if (!cur) continue;
    if (code === 8) cur.layer = val;
    else if (code === 1 || (code === 3 && cur.type === 'MTEXT')) cur.refs.push(i);
    else if (code === 10 && cur.x === undefined) cur.x = parseFloat(val);
    else if (code === 20 && cur.y === undefined) cur.y = parseFloat(val);
    else if (code === 40 && cur.h === undefined) cur.h = parseFloat(val);
  }
  for (const e of ents) e.plain = plainText(e.refs.map(r => pairs[r].val).join(''));
  return { pairs, eol, ents, lines, inserts, layers, ver };
}

function plainText(s) {
  return s.replace(/\\P/g, ' ').replace(/\\[fFHCcTQWAapx][^;]*;/g, '').replace(/\\[LlOoKk~]/g, '').replace(/\\\\/g, '\\').replace(/[{}]/g, '').replace(/%%[dDpPcC]/g, '').replace(/\s+/g, ' ').trim();
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tokenRe = (before) => new RegExp('(^|[^A-Za-z0-9])(' + esc(before) + ')(?![A-Za-z0-9])', 'g');   // whole-tag match, not a piece of a longer tag

// how many places would this fix change in this file (without changing anything). `blocks` names the symbols the text sits in and how often each is used.
function countMatches(dxf, before, ref) {
  const re = tokenRe(before); let n = 0, inBlocks = 0; const bl = new Map();
  const list = ref === undefined || ref === null ? dxf.ents : [dxf.ents[ref]].filter(Boolean);
  for (const e of list) for (const r of e.refs) { const m = dxf.pairs[r].val.match(re); if (m) { if (e.section === 'BLOCKS') { inBlocks += m.length; bl.set(e.block, (bl.get(e.block) || 0) + m.length); } else n += m.length; } }
  return { places: n, inBlocks, blocks: [...bl.keys()].map(name => ({ name, uses: dxf.inserts[name] || 0 })) };
}

// one line per text item, for Claude to read when there is no markup
function inventory(dxf, max = 1500) {
  const rows = []; let chars = 0;
  for (let i = 0; i < dxf.ents.length; i++) {
    const e = dxf.ents[i]; if (!e.plain) continue;
    const row = `${i} | ${e.type} | ${e.layer || '0'} | ${e.section === 'BLOCKS' ? 'symbol ' + (e.block || '?') : 'drawing'} | ${e.x === undefined ? '' : Math.round(e.x * 100) / 100},${e.y === undefined ? '' : Math.round(e.y * 100) / 100} | h${e.h === undefined ? '' : e.h} | ${e.plain.slice(0, 160)}`;
    chars += row.length; if (rows.length >= max || chars > 90000) { rows.push('... (list cut short)'); break; }
    rows.push(row);
  }
  return 'item | type | layer | where | x,y | height | text\n' + rows.join('\n');
}

const handleNum = (h) => { const n = parseInt(h, 16); return Number.isNaN(n) ? 0 : n; };
const printable = (t) => typeof t === 'string' && t.length > 0 && !/[^\x20-\x7E]/.test(t);

// Is this proposed edit possible on this file, and how many places does it touch?
function checkItem(dxf, it) {
  const out = { can: false, places: 0, inBlocks: 0, blocks: [], warn: '' };
  const ref = Number.isInteger(it.ref) ? it.ref : undefined;
  if (ref !== undefined && !dxf.ents[ref]) { out.warn = 'Dex could not find that text item in the drawing.'; return out; }
  if (it.action === 'replace_text') {
    if (!it.before || !it.after) { out.warn = 'No exact before and after text.'; return out; }
    if (!printable(it.after)) { out.warn = 'The new text has characters Dex will not write into a DXF.'; return out; }
    const c = countMatches(dxf, it.before, ref); Object.assign(out, c);
    out.can = c.places + c.inBlocks > 0; if (!out.can) out.warn = 'That text was not found in this DXF.';
  } else if (it.action === 'delete_text') {
    const t = findForDelete(dxf, it);
    if (t.error) { out.warn = t.error; return out; }
    out.can = true; out.places = t.ents.filter(e => e.section !== 'BLOCKS').length; out.inBlocks = t.ents.length - out.places;
    out.blocks = [...new Set(t.ents.filter(e => e.section === 'BLOCKS').map(e => e.block))].map(name => ({ name, uses: dxf.inserts[name] || 0 }));
  } else if (it.action === 'add_text') {
    if (!printable(it.text)) { out.warn = 'The new text is missing or has characters Dex will not write into a DXF.'; return out; }
    if (!Number.isFinite(+it.x) || !Number.isFinite(+it.y)) { out.warn = 'No position for the new text.'; return out; }
    if (!templateFor(dxf, it.layer) && dxf.ver > 'AC1009') { out.warn = 'There is no existing text in this DXF to copy the style from.'; return out; }
    out.can = true; out.places = 1;
  } else out.warn = out.warn || 'Nothing for Dex to change.';
  return out;
}

function findForDelete(dxf, it) {
  const ref = Number.isInteger(it.ref) ? it.ref : undefined;
  if (ref !== undefined) { const e = dxf.ents[ref]; if (!e) return { error: 'Dex could not find that text item.' }; if (e.type === 'ATTRIB') return { error: 'That text belongs to a symbol attribute. Dex will not delete those.' }; return { ents: [e] }; }
  const want = String(it.before || '').trim(); if (!want) return { error: 'No text to delete.' };
  let list = dxf.ents.filter(e => e.type !== 'ATTRIB' && e.plain === want);
  if (it.x !== undefined && it.y !== undefined && list.length > 1) { const near = list.filter(e => Math.abs(e.x - it.x) < 1 && Math.abs(e.y - it.y) < 1); if (near.length) list = near; }
  if (!list.length) return { error: 'That whole line of text was not found.' };
  if (list.length > 1 && !it.all) return { error: `That text appears ${list.length} times. Say which one, or delete them all.` };
  return { ents: list };
}

function templateFor(dxf, layer) {
  const own = dxf.ents.filter(e => e.type === 'TEXT' && e.section === 'ENTITIES' && e.refs.length === 1);
  return own.find(e => e.layer === layer) || own[0] || null;
}

// fixes: [{ id, action: replace_text|delete_text|add_text, before, after, text, x, y, layer, height, ref, editBlocks }]
// Text inside a symbol (block) is only changed when editBlocks is true, because it changes every copy of the symbol.
// Returns { buf, results: [{ id, action, places, inBlocks, status, reason }] }
function applyFixes(buf, fixes) {
  const dxf = parseDxf(buf); const results = [];
  const pairs = dxf.pairs.map(p => ({ ...p }));
  const before = dxf.pairs.map(p => p.val);
  const removed = new Set(); const added = []; let entsAdded = 0, entsRemoved = 0;
  // handles for new entities (R13+ files)
  const seedAt = pairs.findIndex((p, i) => p.code === 9 && p.val === '$HANDSEED' && pairs[i + 1] && pairs[i + 1].code === 5);
  let nextHandle = Math.max(seedAt >= 0 ? handleNum(pairs[seedAt + 1].val) : 0, 1 + pairs.reduce((m, p) => p.code === 5 ? Math.max(m, handleNum(p.val)) : m, 0));
  for (const f of fixes) {
    const action = f.action || 'replace_text';
    const res = { id: f.id, action, before: f.before, after: f.after, text: f.text, places: 0, inBlocks: 0, status: 'applied', reason: '' };
    const skip = (why) => { res.status = 'skipped'; res.reason = why; results.push(res); };
    if (action === 'replace_text') {
      if (!f.before || !f.after) { skip('No exact before and after text.'); continue; }
      if (!printable(f.after)) { skip('The new text has characters Dex will not write into a DXF.'); continue; }
      const re = tokenRe(f.before);
      const list = Number.isInteger(f.ref) ? [dxf.ents[f.ref]].filter(Boolean) : dxf.ents;
      for (const e of list) {
        if (removed.has(e.at)) continue;
        for (const r of e.refs) {
          const v = pairs[r].val; const m = v.match(re); if (!m) continue;
          if (e.section === 'BLOCKS' && !f.editBlocks) { res.inBlocks += m.length; continue; }
          res.places += m.length; pairs[r].val = v.replace(re, (_x, pre) => pre + f.after);
        }
      }
      if (!res.places) { res.status = 'not found'; res.reason = res.inBlocks ? 'Only found inside a symbol (block) definition, and changing symbols was not ticked. Left alone.' : 'The text was not found on the drawing.'; }
      results.push(res);
    } else if (action === 'delete_text') {
      const t = findForDelete(dxf, f);
      if (t.error) { res.status = 'not found'; res.reason = t.error; results.push(res); continue; }
      const ok = t.ents.filter(e => !removed.has(e.at) && (e.section !== 'BLOCKS' || f.editBlocks));
      if (!ok.length) { res.status = 'not found'; res.reason = t.ents.some(e => e.section === 'BLOCKS') ? 'That text is inside a symbol, and changing symbols was not ticked. Left alone.' : 'Already removed.'; results.push(res); continue; }
      for (const e of ok) { for (let i = e.at; i < e.end; i++) removed.add(i); entsRemoved++; res.places++; if (e.section === 'BLOCKS') res.inBlocks++; }
      res.before = t.ents[0].plain; results.push(res);
    } else if (action === 'add_text') {
      if (!printable(f.text)) { skip('The new text is missing or has characters Dex will not write into a DXF.'); continue; }
      if (!Number.isFinite(+f.x) || !Number.isFinite(+f.y)) { skip('No position for the new text.'); continue; }
      const layer = f.layer && dxf.layers.has(f.layer) ? f.layer : '';
      const tpl = templateFor(dxf, layer || f.layer);
      let h = Number(f.height) > 0 ? Number(f.height) : (tpl && tpl.h) || 2.5;
      let np;
      if (tpl) {
        np = pairs.slice(tpl.at, tpl.end).map(p => ({ ...p })); const seen = {};
        for (const p of np) {
          if (p.code === 0) continue;
          if (p.code === 5) { p.val = (nextHandle++).toString(16).toUpperCase(); }
          else if (p.code === 8 && layer) p.val = layer;
          else if (p.code === 10 && !seen[10]) { seen[10] = 1; p.val = String(+f.x); }
          else if (p.code === 20 && !seen[20]) { seen[20] = 1; p.val = String(+f.y); }
          else if (p.code === 30 && !seen[30]) { seen[30] = 1; p.val = '0.0'; }
          else if (p.code === 40 && !seen[40]) { seen[40] = 1; p.val = String(h); }
          else if (p.code === 1) p.val = f.text;
          else if (p.code === 72 || p.code === 73 || p.code === 50) p.val = '0';
        }
      } else {
        const L = layer || (dxf.layers.has('0') || !dxf.layers.size ? '0' : [...dxf.layers][0]);
        np = [[0, 'TEXT'], [8, L], [10, String(+f.x)], [20, String(+f.y)], [30, '0.0'], [40, String(h)], [1, f.text]].map(([code, val]) => ({ code, raw: String(code), val }));
      }
      added.push(...np); entsAdded++; res.places = 1; results.push(res);
    } else skip('Dex does not know that kind of change.');
  }
  if (added.length && seedAt >= 0) pairs[seedAt + 1].val = nextHandle.toString(16).toUpperCase();
  // new entities go at the end of the ENTITIES section
  let insertAt = -1;
  for (let i = 0; i < pairs.length; i++) if (pairs[i].code === 0 && pairs[i].val === 'SECTION' && pairs[i + 1] && pairs[i + 1].val === 'ENTITIES') { for (let j = i + 2; j < pairs.length; j++) if (pairs[j].code === 0 && pairs[j].val === 'ENDSEC') { insertAt = j; break; } break; }
  if (added.length && insertAt < 0) throw new Error('Dex stopped: could not find the ENTITIES section to add text to.');
  // rebuild: untouched lines stay exactly as they were
  const out = []; let changed = 0;
  pairs.forEach((p, i) => {
    if (i === insertAt) for (const a of added) { out.push(a.raw, a.val); changed++; }
    if (removed.has(i)) { changed++; return; }
    out.push(p.raw, p.val); if (p.val !== before[i]) changed++;
  });
  const outText = out.concat(dxf.lines.slice(dxf.pairs.length * 2)).join(dxf.eol);
  // check: same structure apart from what was added or removed on purpose
  const re2 = parseDxf(Buffer.from(outText, 'latin1'));
  if (re2.pairs.length !== dxf.pairs.length - removed.size + added.length || re2.ents.length !== dxf.ents.length - entsRemoved + entsAdded) throw new Error('Dex stopped: the fixed file did not keep the same structure as the original.');
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

const DEX_NOTE_SYSTEM = `You edit the text in engineering DXF drawings for an engineer. You are given, for each DXF file, a list of every text item (item number, type, layer, where it is: "drawing" or "symbol NAME", x,y, text height, text) and the engineer's instruction. Return the smallest set of edits that does exactly what they asked.
Actions:
- "replace_text": change text. Give file, ref (the item number), before (the exact piece of that item's text to change, whole tag/word) and after (the new text).
- "delete_text": remove one text item. Give file and ref.
- "add_text": add a new line of text. Give file, text, x, y (put it beside or under related items using their x,y, same height as neighbours), optionally layer and height.
- "none": the instruction cannot be done by changing text, or is too vague to do safely. Give a short why.
If the instruction covers several items (for example "change every C-1O4 to C-104"), give one item per item number, including items inside symbols (the person decides later whether to change symbols). New text must be plain printable ASCII. Never invent text the engineer did not give or clearly imply. Do not touch anything they did not ask for.
Return ONLY JSON: {"items":[{"file":"file name","ref":0,"action":"replace_text|delete_text|add_text|none","before":"","after":"","text":"","x":0,"y":0,"layer":"","height":0,"why":"short plain reason"}]}`;

function matchFile(drawing, files) {
  const k = normKey(drawing || ''); if (!k) return null;
  const byName = files.find(f => normKey(f.name.replace(/\.dxf$/i, '')).includes(k) || k.includes(normKey(f.name.replace(/\.dxf$/i, ''))));
  if (byName) return byName;
  return files.find(f => { try { return parseDxf(Buffer.from(f.base64, 'base64')).ents.some(e => normKey(e.plain) === k); } catch { return false; } }) || null;
}

module.exports = { parseDxf, applyFixes, countMatches, checkItem, inventory, proposalsFromFindings, matchFile, plainText, DEX_SYSTEM, DEX_NOTE_SYSTEM };
