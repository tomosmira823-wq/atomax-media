const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pcOverlay', {
  onState: (fn) => ipcRenderer.on('pc:state', (_e, s) => fn(s)),
  send: (m) => ipcRenderer.send('pc:decision', m)
});
