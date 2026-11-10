const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron');

const call = (ch) => (payload) => ipcRenderer.invoke(ch, payload);

const DK = require('./drawkinds');

contextBridge.exposeInMainWorld('office', {
  drawKinds: { kindOf: (t) => DK.kindOf(t), kindName: (k) => DK.kindName(k), skillFit: (sk, k) => DK.skillFit(sk, k), skillKinds: (sk) => DK.skillKinds(sk) },
  settings: { get: call('settings:get'), set: call('settings:set') },
  runs: { stop: call('run:stop'), live: call('run:live'), onProgress: (fn) => ipcRenderer.on('run:progress', (_e, p) => fn(p)) },
  agents: { get: call('agents:get'), set: call('agents:set'), reset: call('agents:reset') },
  posts: { get: call('posts:get'), set: call('posts:set') },
  files: { pickImages: call('file:pickImages'), saveImage: call('file:saveImage'), saveText: call('file:saveText') },
  flow: { run: call('flow:run'), get: call('flow:get'), auto: call('flow:auto') },
  eli: { chat: call('eli:chat'), chatLog: call('eli:chatLog') },
  lead: { chat: call('lead:chat'), chatLog: call('lead:chatLog') },
  desk: { get: call('desk:get'), setRules: call('desk:setRules'), correction: call('desk:correction'), checkRegister: call('desk:checkRegister'), makeRegister: call('desk:makeRegister'), setNumber: call('desk:setNumber'), rfi: call('desk:rfi'), numbering: call('desk:numbering'), border: call('desk:border'), addRfi: call('desk:addRfi'), crs: call('desk:crs'), addComment: call('desk:addComment'), export: call('desk:export'), buildMaster: call('desk:buildMaster'), exportMaster: call('desk:exportMaster'), importMaster: call('desk:importMaster'), approveMaster: call('desk:approveMaster'), open: call('desk:open'), show: call('desk:show') },
  library: { cabinets: call('library:cabinets'), items: call('library:items'), read: call('library:read'), save: call('library:save'), remove: call('library:remove'), drop: call('library:drop'), importSkill: call('library:importSkill'), newSkill: call('library:newSkill'), newClient: call('library:newClient'), correction: call('library:correction'), setRulebook: call('library:setRulebook'), agentView: call('library:agentView') },
  server: { status: call('server:status'), setCap: call('server:setCap'), usage: call('server:usage') },
  ai: {
    writePost: call('ai:writePost'),
    revisePost: call('ai:revisePost'),
    reviewPost: call('ai:reviewPost'),
    describeImage: call('ai:describeImage'),
    test: call('ai:test')
  },
  check: { run: call('check:run'), skill: call('check:skill'), last: call('check:last'), onProgress: (fn) => ipcRenderer.on('check:progress', (_e, p) => fn(p)) },
  mail: { tell: call('mail:tell'), read: call('mail:read'), list: call('mail:list'), folders: call('mail:folders'), start: call('mail:start'), decline: call('mail:decline'), reassign: call('mail:reassign'), reread: call('mail:reread'), defaults: call('mail:defaults'), setJobsFolder: call('mail:setJobsFolder'), pickParent: call('mail:pickParent'), newJob: call('board:newJob'), engRun: call('eng:run'), open: call('mail:open') },
  dexMake: call('dex:make'),
  jobs: { gatherIssue: call('jobs:gatherIssue'), plot: call('jobs:plot'), docRequest: call('jobs:docRequest'), revUp: call('jobs:revUp'), fileIn: call('jobs:fileIn'), plan: call('jobs:plan'), overview: call('jobs:overview'), make: call('jobs:make'), makeAll: call('jobs:makeAll'), check: call('jobs:check'), revise: call('jobs:revise'), revision: call('jobs:revision'), addEmail: call('jobs:addEmail'), applyEmail: call('jobs:applyEmail'), setStatus: call('jobs:setStatus'), waiting: call('jobs:waiting'), readMarkup: call('jobs:readMarkup'), issueSent: call('jobs:issueSent') },
  o365: { excel: call('o365:excel'), word: call('o365:word'), chat: call('o365:chat'), thread: call('o365:thread'), newThread: call('o365:newThread') },
  proj: { info: call('proj:info'), suggest: call('proj:suggest'), pick: call('proj:pick'), setFolder: call('proj:setFolder'), gather: call('proj:gather'), open: call('proj:open'), sync: call('proj:sync'), tree: call('proj:tree'), openFile: call('proj:openFile'), roots: call('proj:roots'), listAt: call('proj:listAt'), search: call('proj:search'), cloud: call('cloud:status'), openAt: call('proj:openAt'), recordAt: call('proj:recordAt'), jobFor: call('proj:jobFor'), adopt: call('proj:adopt') },
  biz: {
    get: call('biz:get'), jobs: call('biz:jobs'), taskSave: call('biz:taskSave'), taskDelete: call('biz:taskDelete'), setCurrent: call('biz:setCurrent'), current: call('biz:current'), jobSave: call('biz:jobSave'), jobDelete: call('biz:jobDelete'), parseDrawings: call('biz:parseDrawings'),
    hoursAdd: call('biz:hoursAdd'), hoursRemove: call('biz:hoursRemove'), people: call('biz:people'), decide: call('biz:decide'),
    pickFolder: call('biz:pickFolder'), pickFile: call('biz:pickFile'), issueScan: call('biz:issueScan'), issueQueue: call('biz:issueQueue'),
    docDraft: call('biz:docDraft'), docKinds: call('biz:docKinds'), briefRun: call('biz:briefRun'), routinesSet: call('biz:routinesSet'),
    onProgress: (fn) => ipcRenderer.on('biz:progress', (_e, p) => fn(p)), onBrief: (fn) => ipcRenderer.on('biz:brief', (_e, b) => fn(b))
  },
  history: { list: call('history:list'), get: call('history:get'), remove: call('history:remove') },
  dxf: { propose: call('dxf:propose'), apply: call('dxf:apply') },
  pc: { run: call('pc:run'), stop: call('pc:stop'), selftest: call('pc:selftest'), mockLog: call('pc:mockLog'), decide: (m) => ipcRenderer.send('pc:decision', m) },
  mo: { pickFolder: call('mo:pickFolder'), readFolder: call('mo:readFolder'), readFiles: call('mo:readFiles'), plan: call('mo:plan'), check: call('mo:check'), save: call('mo:save'), saveAs: call('mo:saveAs'), saveText: call('mo:saveText'), onProgress: (fn) => ipcRenderer.on('mo:progress', (_e, p) => fn(p)) },
  model: { generate: call('model:generate'), list: call('model:list'), load: call('model:load'), claude: call('model:claude'), saveGlb: call('model:saveGlb'), open: call('model:open'), saveAs: call('model:saveAs'), folder: call('model:folder'), onProgress: (fn) => ipcRenderer.on('model:progress', (_e, p) => fn(p)) },
  image: { generate: call('image:generate'), edit: call('image:edit'), openaiModels: call('openai:imageModels') },
  social: { connect: call('social:connect'), disconnect: call('social:disconnect'), publish: call('social:publish'), canPost: call('social:canPost') },
  openExternal: call('shell:open'),
  showItem: call('shell:showItem'),
  setZoom: (f) => { try { webFrame.setZoomFactor(Math.max(0.75, Math.min(1.6, +f || 1))); } catch {} },
  pathForFile: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
  update: { install: call('update:install'), check: call('update:check'), onStatus: (fn) => ipcRenderer.on('update:status', (_e, s) => fn(s)) },
  version: call('app:version'),
  companyFromWebsite: call('company:fromWebsite'),
  logo: { get: call('logo:get'), set: call('logo:set'), reset: call('logo:reset') },
  paths: call('paths:get')
});
