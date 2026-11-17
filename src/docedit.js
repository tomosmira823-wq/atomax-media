// Revise a Word document to the comments the way Dex revises a drawing: Wren is shown the document's own paragraphs and says the exact
// text edits the comments ask for; the app makes them in the .docx itself (styles, tables, pictures, fields all kept) and the rev up
// moves the revision on. Nothing else in the document changes. A comment that is not a text change (a new study, a new figure) is said,
// never guessed at.
'use strict';
const JSZip = require('jszip');
const DR = require('./docrev');

const SYSTEM = `You are Wren, the document writer at Atomax-UK, revising one of our Word documents to the client's comments. You are given the document's paragraphs (numbered, with table cells as " | " rows) and the comments.
Make ONLY the changes the comments ask for. Copy "find" text exactly as it is in the document (a whole sentence or a distinctive part of one, unique in the document). Keep our house style and British spelling. Never change numbers, results or conclusions a comment does not ask about.
Edits:
- {"do":"replace","find":"exact text in one paragraph","replace":"new text"}
- {"do":"insert","after":"exact text of the paragraph to insert after","text":"the new paragraph"}
- {"do":"delete","find":"exact text of the whole paragraph to remove"}
- a new section with a table (a glossary / list of abbreviations, a document list): {"do":"section","after":"exact text of the paragraph it goes after (the last paragraph of the section before it)","heading":"Abbreviations","columns":["Abbreviation","Meaning"],"rows":[["kV","kilovolt"],...]}. For a glossary, list every abbreviation the document actually uses, and none it does not.
- a house rule over the whole document: {"do":"rule","rule":"no-space-before-units"} (33 kV -> 33kV, 3.85 kA -> 3.85kA, 0.25 s -> 0.25s, 5 % -> 5%; never touches standards like IEC 61850 or dates)
Settings for the new revision, when the comments say so (they are not edits):
- "approval": {"prepared":"TM","checked":"CMcH/JA","approved":"DM"} (initials exactly as written; leave one out to keep it)
- "date": "YYYY-MM-DD" when the comments give the date the revision must carry
A comment that needs more than text (a re-run study, a new figure, new data not given) goes in "cannot" with why. A comment answered by a change already in the document goes in "cannot" with "already done: ...".
Reply with JSON only: {"edits":[...],"approval":{...},"date":"","cannot":[{"comment":"...","why":"..."}],"summary":"one line of what changed"}`;

// SI units written straight after their number, the Atomax way (the client asked: "do not use a space before them")
const UNIT = /(?<![A-Za-wyz0-9_.])(?<![A-Za-z][A-Za-z0-9]*-)(?<!\d-\d+-)(\d+(?:[.,]\d+)?)[ \u00A0\u2009]+(?=(kV|kA|MVA|MVAr|Mvar|MVAR|kVA|kVAr|kVAR|kW|MW|MWh|kWh|GW|mV|V|mA|A|Hz|kHz|Ω|mΩ|ohms?|mm²|mm2|mm|km|m|ms|s|%|°C|°|pu|p\.u\.|VA|W|Wh|kg|t|Nm)(?![A-Za-z0-9]))/g;
function noSpaceBeforeUnits(xml) { let n = 0; const out = xml.replace(/<w:p\b(?:(?!<w:p\b)[\s\S])*?<\/w:p>/g, (p) => { const r = DR.replaceAcrossRuns(p, UNIT, (m, d) => d); n += r.n; return r.xml; }); return { xml: out, n }; }   // paragraph by paragraph: a table cell's "3.85 kA" is not run on from the cell before it

const xmlEsc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// a heading like the document's own Heading 1 and a plain bordered table (grey header row), for a new section
function sectionXml(doc, heading, columns, rows) {
  const h = (doc.match(/<w:p\b(?:(?!<w:p\b)[\s\S])*?<w:pStyle w:val="Heading1"\/>(?:(?!<w:p\b)[\s\S])*?<\/w:p>/) || [])[0];
  let n = 0; const head = h ? h.replace(/w14:paraId="[0-9A-Fa-f]{8}"/g, '').replace(/<w:bookmark(Start|End)\b[^>]*\/>/g, '').replace(/<w:t(\s[^>]*)?>[^<]*<\/w:t>/g, () => (n++ ? '<w:t xml:space="preserve"></w:t>' : `<w:t xml:space="preserve">${xmlEsc(heading)}</w:t>`))
    : `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">${xmlEsc(heading)}</w:t></w:r></w:p>`;
  const cols = (columns && columns.length ? columns : ['Abbreviation', 'Meaning']).map(String), W = cols.length === 2 ? [2400, 6600] : cols.map(() => Math.floor(9000 / cols.length));
  const cell = (t, i, shade) => `<w:tc><w:tcPr><w:tcW w:w="${W[i]}" w:type="dxa"/>${shade ? '<w:shd w:val="clear" w:color="auto" w:fill="D9D9D9"/>' : ''}</w:tcPr><w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr><w:r>${shade ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r></w:p></w:tc>`;
  const b = '<w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
  const tr = (cells, shade) => `<w:tr><w:trPr><w:cantSplit/>${shade ? '<w:tblHeader/>' : ''}</w:trPr>${cells.map((c, i) => cell(c, i, shade)).join('')}</w:tr>`;
  const tbl = `<w:tbl><w:tblPr><w:tblW w:w="${W.reduce((a, c) => a + c, 0)}" w:type="dxa"/><w:tblBorders>${b}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${W.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${tr(cols, true)}${(rows || []).map(r => tr(cols.map((_, i) => String((r || [])[i] ?? '')), false)).join('')}</w:tbl>`;
  return head + tbl + '<w:p/>';
}

const paraRe = /<w:p\b(?:(?!<w:p\b)[\s\S])*?<\/w:p>/g;
async function paragraphs(buf) {
  const zip = await JSZip.loadAsync(buf), doc = await zip.file('word/document.xml').async('string');
  const out = []; let i = 0;
  for (const m of doc.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>|<w:p\b(?:(?!<w:p\b)[\s\S])*?<\/w:p>/g)) {
    const t = /^<w:tr/.test(m[0]) ? DR.cellsOf(m[0]).map(c => DR.text(c)).join(' | ') : DR.text(m[0]);
    if (t.trim() && !/PAGEREF|TOC \\/.test(t)) out.push(`[${++i}] ${t.trim()}`);
  }
  return out;
}

// apply the edits; each one must find its text exactly once in one paragraph, else it is reported and skipped
async function apply(buf, edits) {
  const zip = await JSZip.loadAsync(buf); let doc = await zip.file('word/document.xml').async('string');
  const done = [], failed = [];
  const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const paraWith = (t) => [...doc.matchAll(paraRe)].filter(m => !/<w:pStyle w:val="TOC/i.test(m[0]) && DR.text(m[0]).includes(String(t).trim()));   // the contents page's copy of a heading is not the heading
  for (const e of edits || []) {
    try {
      if (e.do === 'replace') {
        const hits = paraWith(e.find); if (hits.length !== 1) { failed.push({ e, why: hits.length ? `"${e.find}" is in ${hits.length} places` : `"${e.find}" is not in the document` }); continue; }
        const m = hits[0], r = DR.replaceAcrossRuns(m[0], new RegExp(escRe(String(e.find).trim())), () => String(e.replace || ''));
        if (!r.n) { failed.push({ e, why: `"${e.find}" runs across a field or break` }); continue; }
        doc = doc.slice(0, m.index) + r.xml + doc.slice(m.index + m[0].length); done.push(e);
      } else if (e.do === 'insert') {
        const hits = paraWith(e.after); if (hits.length !== 1) { failed.push({ e, why: hits.length ? `"${e.after}" is in ${hits.length} places` : `"${e.after}" is not in the document` }); continue; }
        const m = hits[0]; let n = 0;
        const copy = m[0].replace(/w14:paraId="[0-9A-Fa-f]{8}"/g, '').replace(/<w:t(\s[^>]*)?>[^<]*<\/w:t>/g, () => (n++ ? '<w:t xml:space="preserve"></w:t>' : `<w:t xml:space="preserve">${String(e.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</w:t>`))
          .replace(/<w:bookmark(Start|End)\b[^>]*\/>/g, '');
        doc = doc.slice(0, m.index + m[0].length) + copy + doc.slice(m.index + m[0].length); done.push(e);
      } else if (e.do === 'delete') {
        const hits = [...doc.matchAll(paraRe)].filter(m => DR.text(m[0]).trim() === String(e.find).trim()); if (hits.length !== 1) { failed.push({ e, why: `the paragraph "${e.find}" is ${hits.length ? 'in ' + hits.length + ' places' : 'not in the document'}` }); continue; }
        const m = hits[0]; doc = doc.slice(0, m.index) + doc.slice(m.index + m[0].length); done.push(e);
      } else if (e.do === 'rule' && e.rule === 'no-space-before-units') {
        const r = noSpaceBeforeUnits(doc); doc = r.xml; done.push({ ...e, n: r.n });
      } else if (e.do === 'section') {
        const hits = paraWith(e.after); if (hits.length !== 1) { failed.push({ e, why: hits.length ? `"${e.after}" is in ${hits.length} places` : `"${e.after}" is not in the document` }); continue; }
        if (!(e.rows || []).length) { failed.push({ e, why: 'the section has no rows' }); continue; }
        const m = hits[0]; let at = m.index + m[0].length;
        // named a heading: the new section goes after that section's content (before the next heading of the same or a higher level, or at the end), never between a heading and its text
        const lv = (x) => +((x.match(/<w:pStyle w:val="Heading(\d)"\/>/) || [])[1] || 0), L = lv(m[0]);
        if (L) { const next = [...doc.slice(at).matchAll(/<w:p\b(?:(?!<w:p\b)[\s\S])*?<\/w:p>/g)].find(n => { const l = lv(n[0]) || (/<w:pStyle w:val="AppendixHeading"\/>/.test(n[0]) ? 1 : 0); return l && l <= L; }); const end = doc.lastIndexOf('<w:sectPr'); at = next ? at + next.index : (end > at ? end : at); }
        doc = doc.slice(0, at) + sectionXml(doc, e.heading || 'Abbreviations', e.columns, e.rows) + doc.slice(at); done.push(e);
      } else failed.push({ e, why: 'not an edit Wren can make' });
    } catch (err) { failed.push({ e, why: String(err && err.message || err) }); }
  }
  zip.file('word/document.xml', doc);
  if (done.some(e => e.do === 'rule' && e.rule === 'no-space-before-units')) for (const n of Object.keys(zip.files).filter(n => /^word\/(header|footer)\d*\.xml$/.test(n))) zip.file(n, noSpaceBeforeUnits(await zip.file(n).async('string')).xml);   // the running header's title too (33kV Protection Co-ordination Study)
  return { buf: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), done, failed };
}

module.exports = { SYSTEM, paragraphs, apply, noSpaceBeforeUnits, UNIT };
