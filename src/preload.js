const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
  check: { run: call('check:run'), skill: call('check:skill'), last: call('check:last'), onProgress: (fn) => ipcRenderer.on('check:progress', (_e, p) => fn(p)) },
  biz: {
    get: call('biz:get'), jobs: call('biz:jobs'), jobSave: call('biz:jobSave'), jobDelete: call('biz:jobDelete'), parseDrawings: call('biz:parseDrawings'),
    hoursAdd: call('biz:hoursAdd'), hoursRemove: call('biz:hoursRemove'), people: call('biz:people'), decide: call('biz:decide'),
    pickFolder: call('biz:pickFolder'), pickFile: call('biz:pickFile'), issueScan: call('biz:issueScan'), issueQueue: call('biz:issueQueue'),
    docDraft: call('biz:docDraft'), docKinds: call('biz:docKinds'), briefRun: call('biz:briefRun'), routinesSet: call('biz:routinesSet'),
    onProgress: (fn) => ipcRenderer.on('biz:progress', (_e, p) => fn(p)), onBrief: (fn) => ipcRenderer.on('biz:brief', (_e, b) => fn(b))
  },
  history: { list: call('history:list'), get: call('history:get'), remove: call('history:remove') },
  dxf: { propose: call('dxf:propose'), apply: call('dxf:apply') },
  mo: { pickFolder: call('mo:pickFolder'), readFolder: call('mo:readFolder'), readFiles: call('mo:readFiles'), plan: call('mo:plan'), check: call('mo:check'), save: call('mo:save'), saveAs: call('mo:saveAs'), onProgress: (fn) => ipcRenderer.on('mo:progress', (_e, p) => fn(p)) },
  model: { generate: call('model:generate'), list: call('model:list'), load: call('model:load'), claude: call('model:claude'), saveGlb: call('model:saveGlb'), open: call('model:open'), saveAs: call('model:saveAs'), folder: call('model:folder'), onProgress: (fn) => ipcRenderer.on('model:progress', (_e, p) => fn(p)) },
  image: { generate: call('image:generate'), edit: call('image:edit'), openaiModels: call('openai:imageModels') },
  social: { connect: call('social:connect'), disconnect: call('social:disconnect'), publish: call('social:publish'), canPost: call('social:canPost') },
  openExternal: call('shell:open'),
  showItem: call('shell:showItem'),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
  update: { install: call('update:install'), check: call('update:check'), onStatus: (fn) => ipcRenderer.on('update:status', (_e, s) => fn(s)) },
  version: call('app:version'),
  companyFromWebsite: call('company:fromWebsite'),
  logo: { get: call('logo:get'), set: call('logo:set'), reset: call('logo:reset') },
  paths: call('paths:get')
});
