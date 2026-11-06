// The numbers in a data report come from code, not from the model's reading of a few hundred rows: the agent writes a small analysis
// (plain JavaScript), the app runs it here over the whole table(s) and gets back the tables and chart series the document needs. The
// code runs in its own sandbox with a time limit and no access to files, the network or the app.
'use strict';
const vm = require('vm');
const DT = require('./datatable');

// what the code may return
// { facts: { any: 'short value' }, tables: [{ id, title, headers, rows }], charts: [{ id, title, type, x, xLabel, yLabel, series: [{ name, values, dash, fill }] }] }
const MAX_ROWS = 2500, MAX_POINTS = 4000;

const helpers = {
  num: DT.asNum,
  date: DT.toDate,                                   // date('19/10/2026', '11:41:28') -> ms (UTC)
  ukDate: DT.ukDate,                                 // ms -> '19/10/2026'
  round: (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? +v.toFixed(d) : v),
  mean: (a) => { const v = a.filter(n => typeof n === 'number' && Number.isFinite(n)); return v.length ? v.reduce((s, n) => s + n, 0) / v.length : NaN; },
  sum: (a) => a.filter(n => typeof n === 'number' && Number.isFinite(n)).reduce((s, n) => s + n, 0),
  max: (a) => { const v = a.filter(n => typeof n === 'number' && Number.isFinite(n)); return v.length ? Math.max(...v) : NaN; },
  min: (a) => { const v = a.filter(n => typeof n === 'number' && Number.isFinite(n)); return v.length ? Math.min(...v) : NaN; },
  groupBy: (rows, key) => { const m = new Map(); for (const r of rows) { const k = typeof key === 'function' ? key(r) : r[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; },
  sortBy: (rows, key) => [...rows].sort((a, b) => { const x = typeof key === 'function' ? key(a) : a[key], y = typeof key === 'function' ? key(b) : b[key]; return x < y ? -1 : x > y ? 1 : 0; }),
  hourOf: (ms) => new Date(ms).getUTCHours(),
  dayOf: (ms) => DT.ukDate(ms),
};

// strip the output down to what the document can hold; long series are thinned evenly so a chart stays a chart
function tidy(out) {
  if (!out || typeof out !== 'object') throw new Error('the analysis returned nothing');
  const facts = {}; for (const [k, v] of Object.entries(out.facts || {})) facts[String(k).slice(0, 80)] = typeof v === 'object' ? JSON.stringify(v).slice(0, 400) : String(v).slice(0, 400);
  const tables = (out.tables || []).slice(0, 20).map((t, i) => ({ id: String(t.id || `t${i + 1}`), title: String(t.title || ''), headers: (t.headers || []).map(String).slice(0, 16), rows: (t.rows || []).slice(0, MAX_ROWS).map(r => (Array.isArray(r) ? r : [r]).slice(0, 16).map(v => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(+v.toFixed(2))) : v === null || v === undefined ? '' : String(v)))), truncated: (t.rows || []).length > MAX_ROWS ? (t.rows || []).length : 0 }));
  const thin = (arr, k) => (k <= 1 ? arr : arr.filter((_, i) => i % k === 0));
  const charts = (out.charts || []).slice(0, 40).map((c, i) => {
    const series = (c.series || []).filter(s => s && Array.isArray(s.values)).slice(0, 16);
    const n = Math.max((c.x || []).length, ...series.map(s => s.values.length)), k = Math.ceil(n / MAX_POINTS);
    return { id: String(c.id || `c${i + 1}`), title: String(c.title || ''), type: ['line', 'area', 'bar', 'step'].includes(c.type) ? c.type : 'line', x: thin(c.x || [], k), xTicks: c.xTicks ? thin(c.xTicks, k) : undefined, xLabel: c.xLabel ? String(c.xLabel) : '', yLabel: c.yLabel ? String(c.yLabel) : '', yMin: typeof c.yMin === 'number' ? c.yMin : undefined,
      series: series.map(s => ({ name: String(s.name || '').slice(0, 60), values: thin(s.values.map(v => (typeof v === 'number' && Number.isFinite(v) ? +v.toFixed(4) : null)), k), dash: !!s.dash, fill: !!s.fill, color: s.color || undefined })) };
  });
  return { facts, tables, charts };
}

// code: the body that defines `function analyse(tables, h)` (tables: { "<file name without extension>": [row objects] })
function run(code, tables, { timeoutMs = 20000 } = {}) {
  const ctx = vm.createContext({ Math, Number, String, Array, Object, Date, JSON, Map, Set, isNaN, isFinite, parseFloat, parseInt, console: { log() {} } });
  const src = `${String(code)}\n;(typeof analyse === 'function' ? analyse : (() => { throw new Error('the code must define function analyse(tables, h)'); }))(__tables, __h)`;
  ctx.__tables = JSON.parse(JSON.stringify(tables)); ctx.__h = helpers;
  let out; try { out = vm.runInContext(src, ctx, { timeout: timeoutMs, filename: 'analysis.js' }); } catch (e) { const err = new Error(`analysis failed: ${e && e.message || e}${e && e.stack ? '\n' + String(e.stack).split('\n').slice(0, 3).join('\n') : ''}`); err.analysis = true; throw err; }
  return tidy(out);
}

// a short account of the results for the model, so it writes around real numbers and refers to tables and figures by id
function describe(res) {
  const L = [];
  if (Object.keys(res.facts).length) { L.push('FACTS:'); for (const [k, v] of Object.entries(res.facts)) L.push(`  ${k}: ${v}`); }
  for (const t of res.tables) { L.push(`TABLE id=${t.id} "${t.title}" (${t.rows.length} rows${t.truncated ? ` of ${t.truncated}` : ''}): ${t.headers.join(' | ')}`); for (const r of t.rows.slice(0, 25)) L.push('  ' + r.join(' | ')); if (t.rows.length > 25) L.push(`  ... ${t.rows.length - 25} more rows (all go in the document)`); }
  for (const c of res.charts) L.push(`FIGURE id=${c.id} "${c.title}": ${c.type}, ${c.series.length} series (${c.series.map(s => s.name).slice(0, 8).join(', ')}${c.series.length > 8 ? ', ...' : ''}), ${c.x.length || Math.max(...c.series.map(s => s.values.length))} points${c.yLabel ? ', y: ' + c.yLabel : ''}`);
  return L.join('\n');
}

const GUIDE = `ANALYSIS CODE: plain JavaScript defining function analyse(tables, h) and returning {facts, tables, charts}.
- tables: an object keyed by file name (without extension); each is an array of row objects keyed by the column headers, every value a STRING as read from the file: convert with h.num(v) (number or NaN), h.date(dateStr, timeStr) (ms, dd/mm/yyyy or ISO), h.ukDate(ms), h.hourOf(ms), h.dayOf(ms).
- h also has round(v, dp), mean(arr), sum(arr), max(arr), min(arr), groupBy(rows, keyOrFn) -> Map, sortBy(rows, keyOrFn).
- return facts: { "name": "value" } short headline numbers for the text; tables: [{ id, title, headers: [], rows: [[]] }] (numbers as numbers); charts: [{ id, title, type: "line"|"area"|"bar"|"step", x: [labels in order] (or numbers), xLabel, yLabel, series: [{ name, values: [numbers or null for gaps], dash: true for a dashed line, fill: true for a light fill under the line }] }].
- Time series from loggers: align readings to the interval grid by SNAPPING each timestamp to the nearest interval (round, not floor); a logger stamped at xx:x5:01 is on the grid, not between slots. A "duplicate" next to a "gap" means the alignment is wrong, not the data. Only report gaps of a missing interval or more after snapping.
- Exception lists (gaps, duplicates, out-of-range readings) longer than about 30 rows do not go in the document as a table: give the count, the first and last, the longest, and the total time affected, in a short table or sentence.
- Tables go on a portrait A4 page: at most 10 columns. Split a wider matrix into two tables (e.g. outgoing circuits, then supplies and totals) rather than squeezing it.
- A time axis gets SHORT labels in x: the date as dd/mm for a series over days (one label per point; the app thins them), hh:mm within a day. Never full timestamps.
- Use the same series names in every chart (a circuit keeps its colour). For a per-item chart give one chart per item with two series named "<item> average" (fill: true) and "<item> peak" (dash: true), so the item keeps its colour there too. For a load duration curve x is the percentage of time (numbers 0..100).
- No file, network or require access; finish within a few seconds; do not print. Skip rows you cannot parse rather than failing.`;

module.exports = { run, describe, helpers, GUIDE };
