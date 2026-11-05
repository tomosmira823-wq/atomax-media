// Makes the folder tree test/scenario-tree.js drives: node test/tree-fixture.js <dir>
const fs = require('fs'), path = require('path');
const dir = process.argv[2]; if (!dir) { console.error('dir?'); process.exit(1); }
const mk = (p, files = []) => { fs.mkdirSync(p, { recursive: true }); for (const f of files) fs.writeFileSync(path.join(p, f), 'x'); };
const job = (p) => { for (const s of ['1. Safety', '2. Project Management', '7. Electrical', '9. Document Control', '10. Site Data']) mk(path.join(p, s)); fs.writeFileSync(path.join(p, 'notes.pdf'), 'x'); };
job(path.join(dir, 'Projects', '2026', 'Weaver Water', 'X071126 Northwich Waterworks Pumping Station'));
job(path.join(dir, 'Projects', '2025', 'United Utilities', 'X051126 Oakmere WwTW'));
job(path.join(dir, 'Oakmere WwTW Inlet Works - X051126'));
mk(path.join(dir, 'Gas mixer pipework', 'Previous project'), ['old.pdf']); mk(path.join(dir, 'Gas mixer pipework', 'Superseded'), ['older.pdf']);
mk(path.join(dir, 'Gas mixer pipework'), ['Atomax-UK Scope of Works.docx', 'Fee proposal.pdf']);
console.log(dir);
