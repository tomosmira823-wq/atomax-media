const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (payload) => ipcRenderer.invoke(ch, payload);

contextBridge.exposeInMainWorld('office', {
  settings: { get: call('settings:get'), set: call('settings:set') },
  agents: { get: call('agents:get'), set: call('agents:set'), reset: call('agents:reset') },
  posts: { get: call('posts:get'), set: call('posts:set') },
  files: { pickImages: call('file:pickImages'), saveImage: call('file:saveImage'), saveText: call('file:saveText') },
  ai: {
    writePost: call('ai:writePost'),
    revisePost: call('ai:revisePost'),
    reviewPost: call('ai:reviewPost'),
    describeImage: call('ai:describeImage'),
    test: call('ai:test')
  },
  image: { generate: call('image:generate'), edit: call('image:edit'), openaiModels: call('openai:imageModels') },
  social: { connect: call('social:connect'), disconnect: call('social:disconnect'), publish: call('social:publish'), canPost: call('social:canPost') },
  openExternal: call('shell:open'),
  update: { install: call('update:install'), check: call('update:check'), onStatus: (fn) => ipcRenderer.on('update:status', (_e, s) => fn(s)) },
  version: call('app:version'),
  paths: call('paths:get')
});
