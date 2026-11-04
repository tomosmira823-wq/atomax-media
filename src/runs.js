// Agent runs as the person sees them: a stage ("reading the schedule", "Dex is drawing", "writing the PDF"), a time estimate from the
// last few runs of the same kind, and a Stop button that really stops it (the Claude call is aborted, the files are left as they were).
// Also the one place errors are put into plain words with the next step.
'use strict';
const fs = require('fs');
const path = require('path');

let send = () => {}, FILE = null;
const RUNS = new Map();   // id -> { id, kind, who, jobId, no, stage, pct, t0, ac, done }
let times = null;         // kind -> [ms, ms, ...] (last 6)

function init({ sendFn, userDir }) { send = sendFn || send; FILE = path.join(userDir, 'runtimes.json'); try { times = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { times = {}; } }
const saveTimes = () => { try { fs.writeFileSync(FILE, JSON.stringify(times)); } catch {} };
// what a run of this kind usually takes (median of the last few), in ms; 0 when unknown
function estimate(kind) { const a = (times && times[kind]) || []; if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

function start({ kind = 'make', who = '', jobId = '', no = '' } = {}) {
  const id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const run = { id, kind, who, jobId, no, stage: 'starting', pct: 0, t0: Date.now(), ac: new AbortController(), done: false, estimate: estimate(kind) };
  RUNS.set(id, run); emit(run); return run;
}
function stage(id, text, pct) { const r = RUNS.get(id); if (!r || r.done) return; r.stage = text; if (pct != null) r.pct = pct; emit(r); }
function finish(id, { ok = true, error = '' } = {}) {
  const r = RUNS.get(id); if (!r || r.done) return; r.done = true; r.ok = ok; r.error = error; r.stage = ok ? 'done' : (r.ac.signal.aborted ? 'stopped' : 'failed');
  if (ok) { times[r.kind] = [...(times[r.kind] || []), Date.now() - r.t0].slice(-6); saveTimes(); }
  emit(r); setTimeout(() => RUNS.delete(id), 60e3);
}
function stop(id) { const r = RUNS.get(id); if (!r || r.done) return false; r.ac.abort(); r.stage = 'stopping'; emit(r); return true; }
function stopFor(jobId, no) { let n = 0; for (const r of RUNS.values()) if (!r.done && r.jobId === jobId && (!no || r.no === no)) { stop(r.id); n++; } return n; }
const signal = (id) => { const r = RUNS.get(id); return r ? r.ac.signal : undefined; };
const aborted = (id) => { const r = RUNS.get(id); return !!(r && r.ac.signal.aborted); };
function emit(r) { send('run:progress', { id: r.id, kind: r.kind, who: r.who, jobId: r.jobId, no: r.no, stage: r.stage, pct: r.pct, elapsed: Date.now() - r.t0, estimate: r.estimate || 0, done: r.done, ok: r.ok, error: r.error || '' }); }
const live = () => [...RUNS.values()].filter(r => !r.done).map(r => ({ id: r.id, kind: r.kind, who: r.who, jobId: r.jobId, no: r.no, stage: r.stage, pct: r.pct, elapsed: Date.now() - r.t0, estimate: r.estimate || 0 }));

// errors in plain words, with what to do next
const PLAIN = [
  [/aborted|AbortError|The operation was aborted/i, 'Stopped.'],
  [/EBUSY|EPERM|resource busy or locked|being used by another process/i, 'A file is open in another program (usually Excel or a PDF viewer). Close it and press the button again.'],
  [/ENOENT|no such file/i, 'A file the job needs has gone or moved. Check the job folder in OneDrive, then press the button again.'],
  [/EACCES|permission denied/i, 'Windows would not let the app write there. Check the folder is not read-only and OneDrive is not blocking it.'],
  [/Claude 401|invalid x-api-key|authentication/i, 'The Claude key is wrong or has expired. Put the right key in Settings.'],
  [/Claude 429|rate.?limit/i, 'Claude is rate-limited. Wait a minute and press the button again.'],
  [/Claude 5\d\d|overloaded|Claude 529/i, 'Claude is busy at their end. Wait a minute and press the button again.'],
  [/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network/i, 'No connection to Claude. Check the internet or the VPN, then press the button again.'],
  [/No Claude API key/i, 'No Claude key yet. Put it in Settings first.'],
  [/did not return JSON|cut off|max_tokens/i, 'The reply was cut off before it finished. Press the button again; it usually goes through second time.'],
  [/cables that overlap or cross/i, 'The layout could not avoid cables crossing. Press Make again; if it happens twice, tell Tom which cables it names.'],
  [/No cable schedule/i, 'There is no cable schedule to work from. Put it in the job folder (7.8 Schedules or 008) and press the button again.'],
  [/No project folder|outside your Projects/i, 'This job has no folder linked. Open it from the Projects list so the app knows where it lives.'],
  [/monthly cap|usage cap/i, 'The monthly Claude spend cap has been reached. Raise it in Settings if that is right.'],
];
function plain(e) {
  const m = String(e && e.message || e || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  for (const [re, text] of PLAIN) if (re.test(m)) return text;
  return m.length > 220 ? m.slice(0, 220) + '…' : m;
}

module.exports = { init, start, stage, finish, stop, stopFor, signal, aborted, live, estimate, plain };
