// jobFor / listAt / adopt on a folder of NG jobs that already has a stray record (as on Tom's PC)
const path=require('path'),fs=require('fs'),os=require('os');
const T=fs.mkdtempSync(path.join(os.tmpdir(),'ng-')), R=path.join(T,'Projects'), NG=path.join(R,'BGEN','National Grid');
for (const j of ['001 - Telford 132kV','002 - Telford 400kV','003 - Bustleholm']) for (const s of ['001 Incoming Correspondence','002 Outgoing Correspondence','006 Atomax-UK Drawings','020 Issued']) fs.mkdirSync(path.join(NG,j,s),{recursive:true});
fs.mkdirSync(path.join(NG,'003 - Bustleholm','006 Atomax-UK Drawings','CLAUDE'),{recursive:true});
const H={}; const ipcMain={handle:(c,f)=>H[c]=f,on:()=>{}};
const settings={projectRoots:[R]}; process.env.AMO_USERDATA=path.join(T,'u');
const projects=require('../src/projects.js'); projects.init(path.join(T,'u'),()=>settings); require('../src/runs.js').init({sendFn:()=>{},userDir:path.join(T,'u')});
const B=require('../src/bizmain.js').register({ipcMain,dialog:{},shell:{},Notification:function(){},getWin:()=>null,userDir:()=>path.join(T,'u'),getSettings:()=>settings,claudeFull:async()=>({text:'{}'}),checker:{},library:{}});
const biz=require('../src/business.js'); biz.saveJob(B.data(),{number:'NATIONAL GRID',name:'National Grid',folder:NG},'Tom'); B.store.save();
const call=(c,a)=>H[c]({},a);
(async()=>{
  const a=await call('proj:jobFor',{path:NG}), b=await call('proj:jobFor',{path:path.join(NG,'003 - Bustleholm')}), c=await call('proj:jobFor',{path:path.join(NG,'003 - Bustleholm','006 Atomax-UK Drawings','CLAUDE')});
  const L=await call('proj:listAt',{path:path.join(R,'BGEN')}); let ad=''; try{await call('proj:adopt',{path:NG});ad='adopted!'}catch(e){ad='refused: '+e.message}
  console.log('NG ->',a&&a.folder&&path.basename(a.folder)); console.log('Bustleholm ->',b&&path.basename(b.folder)); console.log('inside Bustleholm ->',c&&path.basename(c.folder));
  console.log('BGEN list:',JSON.stringify(L.entries.map(e=>[e.name,e.isJob,!!e.job]))); console.log('adopt NG:',ad);
  const ok=!a && b && /Bustleholm/.test(b.folder) && c && /Bustleholm$/.test(c.folder) && !L.entries[0].isJob && !L.entries[0].job && /refused/.test(ad);
  console.log(ok?'NG OK':'NG FAIL'); process.exit(ok?0:1);
})().catch(e=>{console.error(e);process.exit(1)});
