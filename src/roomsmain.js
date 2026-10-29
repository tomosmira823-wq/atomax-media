// IPC for the two new rooms: the File Room (library) and the Server Room (spend, keys, social logins, bottom bar).
'use strict';
const fs = require('fs');
const path = require('path');
const library = require('./library');
const usage = require('./usage');

const PROVIDERS = ['claude', 'openai', 'google', 'higgsfield'];
const SOCIAL = [{ key: 'linkedin', label: 'LinkedIn' }, { key: 'facebook', label: 'Meta' }, { key: 'x', label: 'X' }];
const DAY = 86400000;
let update = { state: 'idle' };
const setUpdate = (u) => { update = { ...u, at: Date.now() }; };

function register({ ipcMain, dialog, getWin, loadSettings, saveSettings, userDir, version, getAgents }) {
  const ok = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { throw new Error(String(e.message || e)); } };

  // ---- File Room ----
  ipcMain.handle('library:cabinets', () => library.CABINETS.map(c => ({ ...c, count: library.list(c.key).length })));
  ipcMain.handle('library:items', ok((_e, { key }) => {
    if (key === 'rulebooks') return getAgents().map(a => ({ file: `${a.id}.md`, name: a.name, description: a.platform, agents: [], on: true, text: library.rulebookFor(a.id), size: 0, readable: true, rulebook: true, agentId: a.id }));
    return library.list(key);
  }));
  ipcMain.handle('library:read', ok((_e, { key, file }) => library.readText(key, file)));
  ipcMain.handle('library:save', ok((_e, { key, file, ...rest }) => library.save(key, file, rest)));
  ipcMain.handle('library:remove', ok((_e, { key, file }) => library.remove(key, file)));
  ipcMain.handle('library:drop', ok((_e, { key, files }) => library.addFiles(key, (files || []).map(f => ({ name: f.name, data: Buffer.from(f.base64, 'base64') })))));
  ipcMain.handle('library:importSkill', ok(async () => {
    const r = await dialog.showOpenDialog(getWin(), { properties: ['openDirectory'], title: 'Pick a folder that contains SKILL.md' });
    if (r.canceled || !r.filePaths[0]) return null;
    return library.importSkill(r.filePaths[0]);
  }));
  ipcMain.handle('library:newSkill', ok((_e, a) => library.newSkill(a || {})));
  ipcMain.handle('library:setRulebook', ok((_e, { agentId, text }) => library.setRulebook(agentId, text)));
  // what an agent is given from the library right now (the same functions its prompt is built from)
  ipcMain.handle('library:agentView', ok((_e, { agentId }) => ({ skill: library.skillFor(agentId, ''), rulebook: library.rulebookFor(agentId), context: library.promptBlock(agentId).length })));
  ipcMain.handle('library:correction', ok((_e, { agentId, text }) => library.addCorrection(agentId, text)));

  // ---- Server Room ----
  ipcMain.handle('server:status', ok(() => {
    const s = loadSettings(), rows = usage.load(), month = new Date().toISOString().slice(0, 7);
    const keyed = { claude: !!s.anthropicKey, openai: !!s.openaiKey, google: !!s.googleKey, higgsfield: !!(s.higgsfieldKeyId && s.higgsfieldSecret) };
    const providers = PROVIDERS.map(p => {
      const mine = rows.filter(r => r.provider === p && r.at.startsWith(month));
      const spent = mine.reduce((n, r) => n + (r.gbp || 0), 0), cap = usage.capFor(p, s);
      const byAgent = {}; mine.forEach(r => { if (r.who) byAgent[r.who] = (byAgent[r.who] || 0) + (r.gbp || 0); });
      const usedBy = Object.entries(byAgent).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
      const lastErr = [...rows].reverse().find(r => r.provider === p && r.error && r.at.startsWith(new Date().toISOString().slice(0, 10)));
      const state = !keyed[p] ? 'nokey' : spent >= cap ? 'capped' : spent >= cap * 0.8 ? 'near' : lastErr ? 'error' : 'ok';
      return { provider: p, label: usage.LABEL[p], keyed: keyed[p], spent: Math.round(spent * 100) / 100, cap, usedBy, state, lastError: lastErr ? lastErr.error : '' };
    });
    const social = SOCIAL.map(({ key, label }) => {
      const c = (s.social && s.social[key]) || {}, connected = !!(c.token || c.userToken);
      const days = c.expires ? Math.floor((c.expires - Date.now()) / DAY) : null;
      const state = !connected ? 'off' : days != null && days <= 7 ? 'expiring' : 'ok';
      return { key, label, connected, days, state, name: c.name || '' };
    });
    const failedToday = usage.failedToday(rows);
    const spendAll = providers.reduce((n, p) => n + p.spent, 0);
    return { month, providers, social, footer: { backup: null, version: version(), update, failedToday, spendAll } };
  }));
  ipcMain.handle('server:setCap', ok((_e, { provider, cap }) => {
    const n = Number(cap); if (!(n >= 0)) throw new Error('Cap must be a number of pounds');
    const s = loadSettings(); saveSettings({ ...s, caps: { ...(s.caps || {}), [provider]: n } }); return true;
  }));
  ipcMain.handle('server:usage', ok(() => usage.load().slice(-200).reverse()));
  return { setUpdate };
}

module.exports = { register, setUpdate, PROVIDERS };
