/* ===== Sandboxed plugins (Phase 4) ================================================================================================
 * A plugin the person switched to "sandbox" does not run in this page. It runs in an <iframe sandbox="allow-scripts"> (no allow-same-origin), so
 * it has an opaque origin: it cannot read this page or its DOM, has no cookie and no storage of its own, and a request it sends to this host
 * carries "Origin: null" (refused by the host) and no session. Its only way out is a MessageChannel bridge whose other end is here.
 *
 * What the bridge offers (window.matchi inside the frame; docs/PLUGIN_SANDBOX.md):
 *   always:      toast(text,color)  info()  close()  storage.get/set/remove/keys (a small private area)
 *   when granted (the file declared it with "// @matchi-needs ..." and the person approved it; the host sends the approved list as p.grant):
 *   at.read      at(command)            only pure AT reads (the same rule as the host's own: __matchiAtIsRead)
 *   router: a,b  router.get(['a','b'])  only these router fields, read-only
 *   shell: CMD   shell(command)         only this exact command, nothing added to it
 *   net: host    (no call)              the frame's own Content-Security-Policy lets it contact https://host
 *   always:      onUninstall(fn)        (Phase 2 / Step 7) registers a stop hook. The page runs it, 15 s at most, when the person chooses "Delete and stop".
 *                                       It can use only what was approved for the plugin (the same checks as any other call). Its result is never believed:
 *                                       a scan afterwards decides, and a hook that fails or does not finish keeps the plugin.
 * Every bridge call is checked here against the grant first (early, clear errors), then relayed to the host, which checks the stored approval again
 * on every call (POST /api/plugins/call, sandboxCallError in PluginSandbox.kt), so a bug here or a file changed after the page loaded cannot grant
 * more. Limits, stated plainly: the host cannot tell which page code relays a call, so a trusted plugin (already root) could name a sandboxed one
 * and use that plugin's narrow list; the page's own policy keeps the frame from navigating to another site (frame-src falls back to default-src 'self';
 * seen in Chromium, other browsers may differ); an approved "net:" host is a place data can go; a plugin that has NOT been switched to sandbox
 * is unchanged and still runs with the whole page. */
const SBX_MAX_MSG=65536,SBX_MAX_TEXT=300,SBX_MAX_FIELDS=20,SBX_STORE_ITEM=32768,SBX_STORE_TOTAL=262144,SBX_STORE_KEYS=100;
const SBX_HOST_RX=/^[a-z0-9](?:[a-z0-9.-]{0,98}[a-z0-9])?$/;
/* The approved "sbx:..." entries the host sent for a plugin -> what the bridge may do. Anything that does not parse grants nothing. */
function sbxGrants(grant){
  const g={at:false,router:new Set(),shell:new Set(),net:[]};
  for(const c of (Array.isArray(grant)?grant:[])){
    const s=String(c);
    if(s==='sbx:at.read')g.at=true;
    else if(s.startsWith('sbx:router:')){const f=s.slice(11);if(/^[A-Za-z0-9_]{1,60}$/.test(f))g.router.add(f)}
    else if(s.startsWith('sbx:shell:')){const x=s.slice(10);if(x&&x.length<=300)g.shell.add(x)}
    else if(s.startsWith('sbx:net:')){const h=s.slice(8);if(SBX_HOST_RX.test(h)&&!h.includes('..')&&g.net.indexOf(h)<0)g.net.push(h)}
  }
  return g;
}
/* Same wording as describeSandboxCap (PluginSandbox.kt), for the dialogs. */
function sbxDescribe(cap){
  const s=String(cap);
  if(s==='sbx:at.read')return 'reads the modem with read-only AT commands';
  if(s.startsWith('sbx:router:'))return 'reads router field '+s.slice(11);
  if(s.startsWith('sbx:shell:'))return 'runs this root command: '+s.slice(10);
  if(s.startsWith('sbx:net:'))return 'contacts '+s.slice(8);
  return s;
}
/* The frame's own policy. It is added to the one this page already has, so it can only narrow it: no eval, no frames, no forms, no workers, no
   connections except the approved https hosts (which must also be on the page's Network rules list). Hosts were checked by sbxGrants. */
function sbxCsp(g){
  const hosts=g.net.map(h=>'https://'+h).join(' ');
  return "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:"+(hosts?' '+hosts:'')+"; media-src data: blob:; font-src data:; connect-src "+(hosts||"'none'")+"; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
}
/* The bridge, as it runs inside the frame. Written as a function so the editor and node --check see it; its text is what goes into the frame. */
function sbxPreludeMain(){
  'use strict';
  var port=null,queue=[],seq=0,pending=new Map(),parentWin=window.parent,hookFn=null;
  function post(m){if(port)port.postMessage(m);else queue.push(m)}
  function call(op,args){return new Promise(function(resolve,reject){var id=++seq;pending.set(id,{resolve:resolve,reject:reject});post({id:id,op:op,args:args})})}
  window.addEventListener('message',function(ev){
    if(port||ev.source!==parentWin||!ev.data||ev.data.matchi!=='init'||!ev.ports||!ev.ports[0])return;
    port=ev.ports[0];
    port.onmessage=function(e){
      var d=e.data;
      if(d&&d.run==='uninstall'&&typeof d.token==='string'){runHook(d.token);return}   /* the page asks the stop hook to run (Phase 2 / Step 7) */
      if(!d||typeof d.id!=='number')return;
      var p=pending.get(d.id);if(!p)return;pending.delete(d.id);
      if(d.ok)p.resolve(d.value);else p.reject(new Error(String(d.error||'failed')));
    };
    var q=queue;queue=[];for(var i=0;i<q.length;i++)port.postMessage(q[i]);
  });
  function runHook(token){
    var ok=true,err='';
    Promise.resolve().then(function(){return hookFn?hookFn():undefined}).then(function(){},function(e){ok=false;err=String((e&&e.message)||e)}).then(function(){post({id:0,op:'hook.done',args:[token,ok,err.slice(0,200)]})});
  }
  window.addEventListener('error',function(e){post({id:0,op:'error',args:[String((e&&e.message)||'error')]})});
  window.addEventListener('unhandledrejection',function(e){post({id:0,op:'error',args:[String((e&&e.reason&&e.reason.message)||(e&&e.reason)||'rejected')]})});
  var api={
    toast:function(text,color){return call('toast',[String(text),color===undefined?'':String(color)])},
    info:function(){return call('info',[])},
    close:function(){return call('close',[])},
    onUninstall:function(fn){if(typeof fn!=='function')return Promise.reject(new Error('onUninstall needs a function'));hookFn=fn;return call('hook.register',[])},
    at:function(command){return call('at',[String(command)])},
    router:{get:function(fields){return call('router.get',[Array.isArray(fields)?fields.map(String):String(fields).split(',')])}},
    shell:function(command){return call('shell',[String(command)])},
    storage:{
      get:function(k){return call('storage.get',[String(k)])},
      set:function(k,v){return call('storage.set',[String(k),String(v)])},
      remove:function(k){return call('storage.remove',[String(k)])},
      keys:function(){return call('storage.keys',[])}
    }
  };
  Object.defineProperty(window,'matchi',{value:Object.freeze(api),enumerable:true});
}
const SBX_PRELUDE='('+sbxPreludeMain.toString()+')();';
/* Plugin code goes into a script element inside a document string: a closing script tag or an HTML comment opener in it would change how the HTML
   parser reads it. In a string, regex or comment the replacements below mean the same thing, so the code does not change. */
function sbxEscCode(code){return String(code).replace(/<\/(script)/gi,'<\\/$1').replace(new RegExp('<'+'!--','g'),'<\\!'+'--')}   // built from pieces: the page script is inline, and a literal comment opener plus a script tag in it would make the HTML parser swallow the rest of the page
function sbxSafeName(n){return String(n).replace(/[^A-Za-z0-9._-]/g,'_').slice(0,80)||'plugin'}
/* The document the frame loads (srcdoc). The policy meta comes first, then the bridge, then the plugin. theme: {fg} (a plain colour). */
function sbxDoc(code,name,g,theme){
  const col=(v)=>/^[#a-zA-Z0-9(),.% -]{1,40}$/.test(String(v||''))?String(v):'';
  const fg=col(theme&&theme.fg)||'#e8eefc';
  return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+sbxCsp(g)+'">'
    +'<meta name="viewport" content="width=device-width,initial-scale=1"><style>html{color-scheme:dark light}body{margin:8px;font:13px/1.45 system-ui,sans-serif;color:'+fg+';background:transparent}button,input,select,textarea{font:inherit}</style></head><body>'
    +'<scr'+'ipt>'+SBX_PRELUDE+'</scr'+'ipt><scr'+'ipt>'+sbxEscCode(code)+'\n//# sourceURL=matchi-sandbox/'+sbxSafeName(name)+'</scr'+'ipt></body></html>';
}
/* Decide one bridge call BEFORE anything runs. Pure: returns {ok:true,op,args} (args cleaned) or {ok:false,error}. g from sbxGrants,
   atIsRead = the page's read-only-AT test. */
function sbxAuthorize(g,op,args,atIsRead){
  args=Array.isArray(args)?args:[];
  const str=(v,max)=>typeof v==='string'&&v.length<=max;
  switch(op){
    case 'toast':{
      if(typeof args[0]!=='string')return {ok:false,error:'toast needs text'};
      const color=args[1]==='red'||args[1]==='orange'?args[1]:'';
      return {ok:true,op,args:[args[0].slice(0,SBX_MAX_TEXT),color]};
    }
    case 'info':case 'close':case 'storage.keys':return {ok:true,op,args:[]};
    case 'error':return {ok:true,op,args:[String(args[0]==null?'':args[0]).slice(0,SBX_MAX_TEXT)]};
    case 'hook.register':return {ok:true,op,args:[]};
    case 'hook.done':return str(args[0],40)?{ok:true,op,args:[args[0],args[1]===true,String(args[2]==null?'':args[2]).slice(0,200)]}:{ok:false,error:'bad hook answer'};
    case 'storage.get':case 'storage.remove':return str(args[0],64)?{ok:true,op,args:[args[0]]}:{ok:false,error:'bad storage key'};
    case 'storage.set':return str(args[0],64)&&typeof args[1]==='string'?{ok:true,op,args:[args[0],args[1]]}:{ok:false,error:'bad storage key or value'};
    case 'at':{
      if(!g.at)return {ok:false,error:'not approved: this plugin did not declare "at.read"'};
      if(typeof args[0]!=='string'||typeof atIsRead!=='function'||!atIsRead(args[0]))return {ok:false,error:'only read-only AT commands are allowed'};
      return {ok:true,op,args:[args[0].trim()]};
    }
    case 'router.get':{
      if(!g.router.size)return {ok:false,error:'not approved: this plugin did not declare any router field'};
      const f=args[0];
      if(!Array.isArray(f)||!f.length||f.length>SBX_MAX_FIELDS)return {ok:false,error:'ask for 1 to '+SBX_MAX_FIELDS+' router fields'};
      for(const x of f)if(typeof x!=='string'||!g.router.has(x.trim()))return {ok:false,error:'router field "'+String(x).slice(0,40)+'" was not approved'};
      return {ok:true,op,args:[f.map(x=>x.trim())]};
    }
    case 'shell':
      if(typeof args[0]!=='string'||!g.shell.has(args[0]))return {ok:false,error:'not approved: only the exact commands this plugin declared with "shell:" may run'};
      return {ok:true,op,args:[args[0]]};
    default:return {ok:false,error:'unknown operation'};
  }
}
/* A small private key/value area per plugin, kept in the page's localStorage (the frame has none). Keys: letters, digits . _ - (64 at most).
   storage: anything with getItem/setItem/removeItem/key/length (localStorage, or the in-memory stand-in below). */
function sbxMemStorage(){const m=new Map();return {get length(){return m.size},key:(i)=>[...m.keys()][i]??null,getItem:(k)=>m.has(k)?m.get(k):null,setItem:(k,v)=>{m.set(k,String(v))},removeItem:(k)=>{m.delete(k)}}}
function sbxStore(storage,name){
  const pre='matchi_sbx:'+name+'/';
  const okKey=(k)=>typeof k==='string'&&/^[A-Za-z0-9._-]{1,64}$/.test(k);
  const need=(k)=>{if(!okKey(k))throw new Error('storage keys use letters, digits . _ - (64 at most)')};
  const keys=()=>{const out=[];for(let i=0;i<storage.length;i++){const k=storage.key(i);if(k&&k.startsWith(pre))out.push(k.slice(pre.length))}return out.sort()};
  const total=()=>keys().reduce((n,k)=>n+k.length+String(storage.getItem(pre+k)||'').length,0);
  return {
    keys,
    get(k){need(k);const v=storage.getItem(pre+k);return v===null?null:v},
    set(k,v){
      need(k);v=String(v);
      if(v.length>SBX_STORE_ITEM)throw new Error('value too large (32 KB at most)');
      const ks=keys(),old=ks.includes(k)?String(storage.getItem(pre+k)||'').length+k.length:0;
      if(!ks.includes(k)&&ks.length>=SBX_STORE_KEYS)throw new Error('too many keys ('+SBX_STORE_KEYS+' at most)');
      if(total()-old+k.length+v.length>SBX_STORE_TOTAL)throw new Error('this plugin\'s storage is full (256 KB)');
      storage.setItem(pre+k,v);return true;
    },
    remove(k){need(k);storage.removeItem(pre+k);return true},
    purge(){for(const k of keys())storage.removeItem(pre+k)}
  };
}
function sbxStorage(){try{const s=window.localStorage;s.getItem('matchi_sbx:probe');return s}catch(_){return sbxMemStorage()}}
/* Calls per second and calls in flight, per plugin, so a plugin cannot flood the host through the bridge. */
function sbxRateOk(entry,now){
  now=now||Date.now();
  if(now-entry.rate.t>=1000){entry.rate.t=now;entry.rate.n=0}
  return ++entry.rate.n<=40;
}
const sbxEntries=new Map();
function sbxHide(entry){try{closeModal('#'+entry.modalId,300)}catch(_){}}
/* Run an authorized call. Device calls (at, router.get, shell) are only RELAYED, to POST /api/plugins/call: the host looks up the plugin's approved record
   on every call and decides again (Phase 5), and keeps the ledger of what the plugin wrote (so Delete can erase it). */
async function sbxRun(entry,a){
  const hostCall=(op,args)=>api('/api/plugins/call',{method:'POST',body:JSON.stringify({name:entry.name,op,args})});
  switch(a.op){
    case 'toast':createToast('['+entry.title+'] '+a.args[0],a.args[1]||undefined);return true;
    case 'info':return {name:entry.name,title:entry.title,granted:entry.grant.slice()};
    case 'close':sbxHide(entry);return true;
    case 'error':{const now=Date.now();console.warn('[sandbox '+entry.name+']',a.args[0]);if(now-(entry.errAt||0)>10000){entry.errAt=now;createToast('['+entry.title+'] error: '+a.args[0],'red')}return null}
    case 'hook.register':entry.hook=true;return true;
    case 'hook.done':{   /* only the answer to the run the page asked for counts; a late or invented one is ignored */
      const w=entry.hookWait;
      if(w&&w.token===a.args[0])w.done(a.args[1]?{status:'ok',ran:true}:{status:'failed',ran:true,error:a.args[2]||'the stop code threw an error'});
      return true;
    }
    case 'storage.keys':return entry.store.keys();
    case 'storage.get':return entry.store.get(a.args[0]);
    case 'storage.set':return entry.store.set(a.args[0],a.args[1]);
    case 'storage.remove':return entry.store.remove(a.args[0]);
    case 'at':
    case 'router.get':
    case 'shell':{
      if(entry.busy>=4)throw new Error('too many device calls at once');
      entry.busy++;
      try{
        if(a.op==='at')return await hostCall('at',[a.args[0]]);
        if(a.op==='router.get')return await hostCall('router.get',a.args[0]);
        const r=await hostCall('shell',[a.args[0]]);
        return {success:!!(r&&r.success),content:String((r&&r.content)??'')};
      }finally{entry.busy--}
    }
  }
  throw new Error('unknown operation');
}
function sbxOnMessage(entry,m){
  if(entry.dead||!m||typeof m!=='object'||!Number.isInteger(m.id)||typeof m.op!=='string')return;
  const reply=(ok,v)=>{if(m.id===0||entry.dead)return;try{entry.port.postMessage(ok?{id:m.id,ok:true,value:v===undefined?null:v}:{id:m.id,ok:false,error:String(v)})}catch(_){}};
  let size=0;try{size=JSON.stringify(m).length}catch(_){return}
  if(size>SBX_MAX_MSG)return reply(false,'message too large');
  if(!sbxRateOk(entry))return reply(false,'too many calls, slow down');
  const a=sbxAuthorize(entry.g,m.op,m.args,window.__matchiAtIsRead);
  if(!a.ok)return reply(false,a.error);
  sbxRun(entry,a).then((v)=>reply(true,v),(e)=>reply(false,(e&&e.message)||'failed'));
}
/* Phase 2 / Step 7: run the stop hook a sandboxed plugin registered with matchi.onUninstall. Resolves, never rejects, with {status, ran, error?}:
     none     no hook registered (or the plugin is not mounted in this session: a disabled plugin never ran, so it has no hook)
     ok       the hook finished without an error      failed   the hook threw or rejected      timeout  no answer within [ms]
     dead     the bridge is closed (the frame left its page)
   ran is true for ok and failed. NOTHING here proves that a process ended: only the scan the page runs afterwards can. [timers] is for tests. */
const SBX_HOOK_MS=15000;
function sbxHookRun(entry,ms,timers){
  const T=timers||{set:(f,n)=>setTimeout(f,n),clear:(t)=>clearTimeout(t)};
  return new Promise((resolve)=>{
    if(!entry||!entry.hook)return resolve({status:'none',ran:false});
    if(entry.dead||!entry.port)return resolve({status:'dead',ran:false,error:'its window was closed'});
    if(entry.hookWait)return resolve({status:'failed',ran:false,error:'its stop code is already running'});
    const token='h'+Date.now().toString(36)+Math.random().toString(36).slice(2,10);
    let tm=null;
    const done=(r)=>{if(!entry.hookWait||entry.hookWait.token!==token)return;T.clear(tm);entry.hookWait=null;resolve(r)};
    entry.hookWait={token,done};
    tm=T.set(()=>done({status:'timeout',ran:false,error:'no answer in '+Math.round(ms/1000)+' s'}),ms);
    try{entry.port.postMessage({run:'uninstall',token})}catch(e){done({status:'dead',ran:false,error:'the message could not be sent'})}
  });
}
function sbxTheme(){try{return {fg:getComputedStyle(document.documentElement).getPropertyValue('--fg').trim()}}catch(_){return {}}}
/* Start one sandboxed plugin (p from GET /api/plugins). It runs hidden in the background; a button in the plugin menu opens its window. */
function sbxMount(p){
  const name=p.name,title=p.title||String(name).replace(/\.js$/i,'');
  const grant=Array.isArray(p.grant)?p.grant.filter((x)=>typeof x==='string'):[];
  const g=sbxGrants(grant);
  const modalId='sbx_'+String(name).replace(/[^A-Za-z0-9_]/g,'_');
  const entry={name,title,grant,g,modalId,port:null,dead:false,loaded:false,busy:0,hook:false,hookWait:null,rate:{t:0,n:0},store:sbxStore(sbxStorage(),name)};
  const frame=document.createElement('iframe');
  frame.setAttribute('sandbox','allow-scripts');   // never allow-same-origin: that would give the plugin this page back
  frame.setAttribute('referrerpolicy','no-referrer');
  frame.setAttribute('allow','');
  frame.title=title+' (sandboxed plugin)';
  frame.style.cssText='width:100%;height:min(60vh,520px);border:1px solid var(--bd);border-radius:10px;background:transparent';
  frame.addEventListener('load',()=>{
    if(entry.loaded){   // the plugin sent its own frame elsewhere: the bridge is closed, the new page never gets a port
      entry.dead=true;try{entry.port&&entry.port.close()}catch(_){}
      createToast('['+title+'] left its sandbox page, so its bridge was closed. Reload the page to start it again.','orange',8000);return;
    }
    entry.loaded=true;
    const ch=new MessageChannel();entry.port=ch.port1;
    ch.port1.onmessage=(ev)=>sbxOnMessage(entry,ev.data);
    try{frame.contentWindow.postMessage({matchi:'init'},'*',[ch.port2])}catch(_){entry.dead=true}
  });
  frame.srcdoc=sbxDoc(p.code||'',name,g,sbxTheme());
  const m=createModal({name:modalId,title:title,maxWidth:'680px',showConfirm:false,content:'',onClose:async()=>{sbxHide(entry);return false}});
  const body=m.el.querySelector('.content');
  const note=document.createElement('p');note.className='mut';note.style.margin='0 0 8px';
  note.textContent='Sandboxed plugin. '+(grant.length?'It may: '+grant.map(sbxDescribe).join('; ')+'.':'It has no device access.')+' If this window stays empty, the plugin draws its screen in the console page, which the sandbox hides. Press Trust on its row in Plugins to run it normally.';
  body.append(note,frame);
  sbxEntries.set(name,entry);
  const box=document.querySelector('.matchi-menu-box');
  if(box){const b=document.createElement('button');b.type='button';b.textContent=title;b.dataset.sbx=name;b.onclick=()=>showModal('#'+modalId);box.appendChild(b)}
  return entry;
}
/* Delete: forget what a sandboxed plugin saved. */
function sbxPurge(name){try{sbxStore(sbxStorage(),name).purge()}catch(_){}}
/* The two confirm texts for the Sandbox / Trust button of a plugin row (p from GET /api/plugins). */
function sbxSandboxMsg(p){
  const d=Array.isArray(p.declared)?p.declared:[],bad=Array.isArray(p.sbxProblems)?p.sbxProblems:[];
  let m='Run '+p.name+' in the sandbox?\n\nIt will run in an isolated frame: it cannot read this page, your session or the console API, and it reaches the console only through a small bridge.';
  m+=d.length?'\n\nIt asked for, and will get:\n'+d.map((c)=>'\u2022 '+sbxDescribe(c)).join('\n'):'\n\nIt asked for nothing beyond toasts, its own saved data and its own window.';
  if(bad.length)m+='\n\nThese header lines are ignored and grant nothing:\n'+bad.map((x)=>'\u2022 '+x).join('\n');
  m+='\n\nA plugin that needs the page itself (matchi.root, matchi.modal, document ...) will not work here; give it the trusted mode instead. The file is approved as it is now. The sign-in password is asked next.';
  return m;
}
function sbxTrustMsg(p){
  return 'Make '+p.name+' trusted?\n\nIt will run inside the console page with your signed-in session. It can then run root commands and call every console route, like any plugin that is not sandboxed. Only do this if you trust where it came from. The file is approved as it is now. The sign-in password is asked next.';
}
/* ===== end sandboxed plugins ===== */
