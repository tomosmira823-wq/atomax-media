// every source file must load: run before anything is pushed (a bad line in jobsmain broke 1.34.61 for everyone)
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const dir = path.join(__dirname, '..', 'src'); let bad = 0;
for (const f of fs.readdirSync(dir).filter(n => /\.js$/.test(n))) { try { execFileSync(process.execPath, ['--check', path.join(dir, f)], { stdio: 'pipe' }); } catch (e) { bad++; console.log('FAIL', f, String(e.stderr || e).split('\n').slice(0, 4).join(' ')); } }
if (bad) { console.log(`${bad} file(s) do not parse`); process.exit(1); } console.log('syntax ok');
