// handed-over documents issued under the job's own numbers (Gwrhyd 10 Nov): titles matched, numbers, ranges and shorthand mapped
'use strict';
const assert = require('assert'), path = require('path'), C = require(path.join(__dirname, '..', 'src', 'carryover.js'));
const map = { 'X281026-0000-06-09-0001': 'X101126-0000-06-08-0001', 'X281026-0000-06-09-0002': 'X101126-0000-06-08-0002', 'X281026-0000-06-09-0006': 'X101126-0000-06-74-0001', 'X281026-0000-06-09-0007': 'X101126-0000-06-08-0006' };
let t = 'Documents X281026-0000-06-09-0001 to -0002; affects 06-09-0001/2/7; see X281026-0000-06-09-0006; Atomax Job No. X281026 (provisional); unknown 06-09-0009/3.';
for (const [re, fn] of C.replacements(map)) t = t.replace(re, fn);
assert.strictEqual(t, 'Documents X101126-0000-06-08-0001, 06-08-0002; affects 06-08-0001, 06-08-0002, 06-08-0006; see X101126-0000-06-74-0001; Atomax Job No. X101126; unknown 06-09-0009/3.');
const files = ['X281026-0000-06-09-0003 P01 Harmonic Assessment to EREC G5-5.docx', 'X281026-0000-06-22-0001_P01 RFI Register.xlsx', 'X281026-0000-06-05-0001 P01 Intertripping Scheme Functional Design Specification.docx', '04_Superseded/X281026-0000-06-09-0001 P01 Short Circuit Study.docx']
  .map(rel => ({ rel, name: rel.split('/').pop(), abs: rel }));
assert.ok(C.earlierVersion({ no: 'X101126-0000-06-08-0003', title: 'Harmonic Assessment to EREC G5/5' }, files));
assert.ok(C.earlierVersion({ no: 'X101126-0000-06-01-0001', title: 'Request for Information Register' }, files));
assert.ok(C.earlierVersion({ no: 'X101126-0000-06-05-0001', title: 'Intertripping Scheme Functional Design Specification (Gwrhyd, NGED 33 kV source to site incomer)' }, files));
assert.strictEqual(C.earlierVersion({ no: 'X101126-0000-06-08-0001', title: 'Short Circuit Study' }, files), null, 'never from a Superseded folder');
assert.strictEqual(C.earlierVersion({ no: 'X281026-0000-06-09-0003', title: 'Harmonic Assessment to EREC G5/5' }, files), null, 'not itself');
console.log('carry ok');
// page breaks: a small table is kept on one page (every row but the last kept with the next), its "Table n" caption with it
{ const row = (t) => `<w:tr><w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc></w:tr>`;
  const doc = `<w:body><w:p><w:pPr><w:pStyle w:val="Caption"/></w:pPr><w:r><w:t>Table 2 - Revision History</w:t></w:r></w:p><w:tbl>${row('Rev')}${row('P01')}${row('')}${row('')}</w:tbl><w:p><w:r><w:t>after</w:t></w:r></w:p></w:body>`;
  const out = C.tidyPagination(doc); const rows = out.match(/<w:tr>[\s\S]*?<\/w:tr>/g);
  assert.deepStrictEqual(rows.map(r => /keepNext/.test(r)), [true, true, true, false], 'rows kept with the next, not the last');
  assert.ok(/<w:pStyle w:val="Caption"\/><w:keepNext\/>/.test(out), 'caption kept with its table, after its style');
  assert.ok(/<w:p><w:r><w:t>after/.test(out), 'the paragraph after is left alone');
  const long = `<w:tbl>${Array.from({ length: 30 }, (_, i) => row(i)).join('')}</w:tbl>`; assert.strictEqual(C.tidyPagination(long), long, 'a long table may run on'); }
console.log('pagination ok');
// Document Approval: the revision's row takes the initials given, a blank one is left as it was
{ const cell = (t) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`, row = (...c) => `<w:tr>${c.map(cell).join('')}</w:tr>`;
  const doc = `<w:tbl>${row('Rev', 'Prepared by', 'Checked By', 'Approved by')}${row('P01', 'D. Mira', '', '')}${row('', '', '', '')}</w:tbl>`;
  const out = C.setApproval(doc, 'P01', { drawn: 'DM', checked: 'TM' }); const DR = require('../src/docrev');
  const cells = (out.match(/<w:tr>[\s\S]*?<\/w:tr>/g)[1].match(/<w:tc>[\s\S]*?<\/w:tc>/g)).map(c => DR.text(c));
  assert.deepStrictEqual(cells, ['P01', 'DM', 'TM', ''], JSON.stringify(cells)); }
console.log('approval ok');
// a follow-up email's title for a deliverable already on the list is not a second row; a set's other sheet or another phase is
{ const D = require('../src/jobdesk');
  for (const [a, b] of [['Harmonic Assessment to EREC G5/5', 'G5/5 harmonic study'], ['33 kV Protection Co-ordination Study', 'Protection Co-Ordination'], ['Load Flow and Reactive Power Capability Study', 'Load Flow & Reactive Power Capability Studies']]) assert.ok(D.sameDeliverable(a, b), a + ' / ' + b);
  for (const [a, b] of [['SLD sheet 1', 'SLD sheet 2'], ['Block cable diagram - RIO1', 'Block cable diagram - RIO2'], ['LV board SLD - Phase 1', 'LV board SLD - Phase 2'], ['Cable schedule', 'Cable calculations'], ['LV SLD', 'HV SLD']]) assert.ok(!D.sameDeliverable(a, b), a + ' / ' + b); }
console.log('same deliverable ok');
