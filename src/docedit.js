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
A comment that needs more than text (a re-run study, a new figure, new data not given) goes in "cannot" with why. A comment answered by a change already in the document goes in "cannot" with "already done: ...".
Reply with JSON only: {"edits":[...],"cannot":[{"comment":"...","why":"..."}],"summary":"one line of what changed"}`;

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
  const paraWith = (t) => [...doc.matchAll(paraRe)].filter(m => DR.text(m[0]).includes(String(t).trim()));
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
      } else failed.push({ e, why: 'not an edit Wren can make' });
    } catch (err) { failed.push({ e, why: String(err && err.message || err) }); }
  }
  zip.file('word/document.xml', doc);
  return { buf: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), done, failed };
}

module.exports = { SYSTEM, paragraphs, apply };
