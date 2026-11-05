// IPC for the job desk (see jobdesk.js).
'use strict';
const path = require('path');
const desk = require('./jobdesk');
const dxfmaker = require('./dxfmaker');

function register({ ipcMain, dialog, getWin, claudeFull, BIZ, checker, userDir, library, writeXlsx, shell }) {
  desk.init({ userDir: userDir(), BIZ, library });
  const wrap = (fn) => async (_e, a) => { try { return await fn(a || {}); } catch (e) { throw new Error(require('./runs').plain(e)); } };
  ipcMain.handle('desk:get', wrap(({ jobId }) => desk.view(jobId)));
  ipcMain.handle('desk:setRules', wrap(({ jobId, text }) => { desk.setRules(jobId, text); BIZ.log({ who: 'Tom', action: 'Updated the job rules', jobId }); return desk.view(jobId); }));
  ipcMain.handle('desk:correction', wrap(({ jobId, agent, agentName, text, scope }) => ({ saved: desk.addCorrection(jobId, { agent, agentName, text, scope }), view: desk.view(jobId) })));
  ipcMain.handle('desk:checkRegister', wrap(({ jobId }) => ({ result: desk.checkRegister(jobId, checker), view: desk.view(jobId) })));
  ipcMain.handle('desk:makeRegister', wrap(({ jobId }) => ({ path: desk.makeRegister(jobId, writeXlsx), view: desk.view(jobId) })));
  ipcMain.handle('desk:setNumber', wrap(({ jobId, from, to }) => {
    const j = BIZ.data().jobs.find(x => x.id === jobId); if (!j) throw new Error('No such job');
    const d = j.drawings.find(x => x.no === from); if (!d) throw new Error('No such drawing');
    if (j.drawings.some(x => x.no.toUpperCase() === String(to).toUpperCase() && x !== d)) throw new Error(to + ' is already on the list');
    d.no = String(to).trim().toUpperCase(); require('./business').saveJob(BIZ.data(), j, 'Tom'); BIZ.store.save(); return desk.view(jobId);
  }));
  ipcMain.handle('desk:numbering', wrap(({ jobId, area, disc }) => { desk.setNumbering(jobId, { area, disc });
    // TBC numbers on the drawing list get real ones once the area code is known
    const j = BIZ.data().jobs.find(x => x.id === jobId), taken = [];
    if (j) { let n = 0; for (const d of j.drawings.filter(x => /^TBC-/.test(x.no))) { const no = desk.proposeNumber(j, d.title, taken, jobId); if (no) { taken.push(no); d.no = no; n++; } } if (n) { require('./business').saveJob(BIZ.data(), j, 'Tom'); BIZ.store.save(); } }
    return desk.view(jobId); }));
  ipcMain.handle('desk:border', wrap(({ jobId, key, size, ng }) => { desk.setBorder(jobId, key, size, ng); return desk.view(jobId); }));
  ipcMain.handle('desk:rfi', wrap(({ jobId, rfi }) => { desk.saveRfi(jobId, rfi); return desk.view(jobId); }));
  ipcMain.handle('desk:addRfi', wrap(({ jobId, q }) => { desk.addInputs(jobId, { questions: [q] }); return desk.view(jobId); }));
  ipcMain.handle('desk:addComment', wrap(({ jobId, doc, comment, by }) => { desk.addComments(jobId, [{ doc, comment, by: by || 'Client' }]); return desk.view(jobId); }));
  ipcMain.handle('desk:crs', wrap(({ jobId, row }) => { desk.saveCrs(jobId, row); return desk.view(jobId); }));
  ipcMain.handle('desk:export', wrap(async ({ jobId, kind }) => { let p = ''; if (kind === 'rfi') { try { p = await desk.writeRfiRegister(jobId, { templateDir: BIZ.projects.templateDir() }); } catch (e) { throw new Error('RFI register: ' + String(e.message || e)); } if (!p) throw new Error('No RFIs on this job yet, or the job has no folder.'); } else p = desk.exportSheet(jobId, kind, writeXlsx); shell.showItemInFolder(p); return p; }));
  ipcMain.handle('desk:buildMaster', wrap(async ({ jobId, note }) => {
    const runs = require('./runs'); if (runs.live().some(r => r.jobId === jobId && r.no === 'MASTER')) return desk.view(jobId);   // already building: one build at a time
    const R = runs.start({ kind: 'master', who: 'Lex', jobId, no: 'MASTER' }); runs.stage(R.id, 'Lex is reading the job documents', 10);
    try { await desk.buildMaster(jobId, { claudeFull, projects: BIZ.projects, checker, parseReply: dxfmaker.parseReply, note, run: R.id, stage: (t, pct) => runs.stage(R.id, t, pct) }); runs.finish(R.id); }
    catch (e) { runs.finish(R.id, { ok: false, error: String(e && e.message || e) }); throw e; }
    return desk.view(jobId);
  }));
  ipcMain.handle('desk:exportMaster', wrap(({ jobId }) => { const p = desk.exportMaster(jobId, writeXlsx); shell.openPath(p); return { path: p, view: desk.view(jobId) }; }));
  ipcMain.handle('desk:importMaster', wrap(async ({ jobId, file }) => {
    if (!file) { if (process.env.AMO_PICK_FILE) file = process.env.AMO_PICK_FILE; else { const r = await dialog.showOpenDialog(getWin(), { properties: ['openFile'], filters: [{ name: 'Excel', extensions: ['xlsx', 'xlsm'] }] }); if (r.canceled) return desk.view(jobId); file = r.filePaths[0]; } }
    desk.importMaster(jobId, file, checker); return desk.view(jobId);
  }));
  ipcMain.handle('desk:approveMaster', wrap(({ jobId }) => { desk.approveMaster(jobId, 'Tom'); try { global.AMO_FLOW && global.AMO_FLOW.onApproved(jobId); } catch {} return desk.view(jobId); }));
  ipcMain.handle('desk:open', wrap(({ p }) => { if (p) shell.openPath(p); return true; }));
  ipcMain.handle('desk:show', wrap(({ p }) => { if (p) shell.showItemInFolder(p); return true; }));
  return desk;
}
module.exports = { register };
