// One logger for every paid API call: date, provider, agent, tokens or units, estimated £, and any error.
// Kept in userData/usage.json. The £ figures are ESTIMATES from the list prices below, not billing data.
'use strict';
const fs = require('fs');
const path = require('path');

// £ per million tokens (estimate). Edit here when the list prices change.
const CLAUDE_GBP_PER_MTOK = { in: 2.4, out: 12 };
// £ per generated image or 3D model (estimate).
const UNIT_GBP = { openai: 0.12, google: 0.1, higgsfield: 0.3, higgsfield3d: 0.5, meshy: 0.5 };
const DEFAULT_CAPS = { claude: 60, openai: 30, google: 30, higgsfield: 50 };
const LABEL = { claude: 'Claude', openai: 'OpenAI', google: 'Google', higgsfield: 'Higgsfield' };
const MAX_ROWS = 5000;

let FILE = null;
function init(userDir) { FILE = path.join(userDir, 'usage.json'); }
function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } }
function save(rows) { try { fs.writeFileSync(FILE, JSON.stringify(rows.slice(-MAX_ROWS), null, 2)); } catch {} }
const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

function record({ provider, who = '', model = '', tokensIn = 0, tokensOut = 0, units = 0, gbp, error = '' }) {
  const cost = gbp != null ? gbp : provider === 'claude'
    ? (tokensIn * CLAUDE_GBP_PER_MTOK.in + tokensOut * CLAUDE_GBP_PER_MTOK.out) / 1e6
    : units * (UNIT_GBP[provider] || 0);
  const rows = load();
  rows.push({ at: new Date().toISOString(), provider, who, model, tokensIn, tokensOut, units, gbp: Math.round(cost * 1000) / 1000, error: String(error || '').slice(0, 300) });
  save(rows);
  return cost;
}

function spentThisMonth(provider, rows = load()) {
  const m = monthKey();
  return rows.filter(r => r.provider === provider && r.at.startsWith(m)).reduce((n, r) => n + (r.gbp || 0), 0);
}
function capFor(provider, settings = {}) {
  const c = settings.caps && settings.caps[provider];
  return typeof c === 'number' && c >= 0 ? c : DEFAULT_CAPS[provider];
}
// Called before every paid call. Throws a clear message when the month's cap is used up, so the agent stops and asks.
function guard(provider, settings) {
  const cap = capFor(provider, settings), spent = spentThisMonth(provider);
  if (spent >= cap) {
    const e = new Error(`${LABEL[provider] || provider} monthly cap reached: £${spent.toFixed(2)} of £${cap} used this month. The agent has paused and is asking before it spends more. Raise the cap in the Server Room to carry on.`);
    e.capReached = true; throw e;
  }
}
function failedToday(rows = load()) { const d = dayKey(); return rows.filter(r => r.error && r.at.startsWith(d)).length; }

module.exports = { init, record, guard, capFor, spentThisMonth, failedToday, load, DEFAULT_CAPS, LABEL, UNIT_GBP };
