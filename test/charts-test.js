// Report charts: every point inside the plot whatever the maximum is, labels that never collide, one colour per circuit
'use strict';
const assert = require('assert'); const CH = require('../src/charts');
const inside = (svg) => { const ys = [...svg.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(m => +m[2]); const ax = svg.match(/<line x1="([\d.]+)" y1="([\d.]+)" x2="\1" y2="([\d.]+)" stroke="#999"/); return Math.min(...ys) >= +ax[2] - 0.01 && Math.max(...ys) <= +ax[3] + 0.01; };
for (const max of [1776, 1499, 1501, 2000, 7.3, 0.42, 99.9, 12345]) {
  const c = { type: 'line', x: ['a', 'b', 'c'], yLabel: 'kVA', series: [{ name: 'X', values: [max * 0.3, max, max * 0.6] }] };
  assert.ok(inside(CH.svg(c, CH.palette([c]))), `max ${max} drawn inside the plot`);
}
// a filled + dashed pair and a plain series of the same circuit share a colour
const m = CH.palette([{ series: [{ name: 'CHP' }] }, { series: [{ name: 'CHP average' }, { name: 'CHP peak' }, { name: 'No.1 Incomer' }] }]);
assert.strictEqual(m.get('CHP'), m.get('CHP average')); assert.strictEqual(m.get('CHP'), m.get('CHP peak')); assert.notStrictEqual(m.get('CHP'), m.get('No.1 Incomer'));
// long x labels are thinned so none overlap
const x = Array.from({ length: 2590 }, (_, i) => `19/10/2026 ${String(i % 24).padStart(2, '0')}:00`);
const svg = CH.svg({ type: 'line', x, series: [{ name: 'A', values: x.map((_, i) => i % 7) }] }, new Map([['A', '#000']]));
const labels = [...svg.matchAll(/<text x="([\d.]+)" y="[\d.]+" text-anchor="(start|middle|end)" fill="#444">([^<]+)</g)].filter(l => /\//.test(l[3]));
for (let i = 1; i < labels.length; i++) assert.ok(+labels[i][1] - +labels[i - 1][1] > labels[i][3].length * 6.1 * 2, 'x labels spaced');
console.log('charts ok');
