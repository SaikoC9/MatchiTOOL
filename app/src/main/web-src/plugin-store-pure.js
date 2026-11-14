/* UFISTORE-BEGIN */
/* Plugin store, pure parts (no DOM): URL rules, index parsing, search and paging, SHA-256 and the "what will this plugin do" scan. */
const STORE_INDEX_MAX=1024*1024,STORE_FILE_MAX=4*1024*1024+4096,STORE_MAX_ITEMS=500,STORE_PER_PAGE=8;
function sha256Pure(u8){
  const K=new Uint32Array(64);{let n=2,i=0;while(i<64){let p=true;for(let d=2;d*d<=n;d++)if(n%d===0){p=false;break}
    if(p){K[i++]=(Math.pow(n,1/3)%1)*4294967296>>>0}n++}}
  const H=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const len=u8.length,pad=((len+9+63)>>6)<<6,buf=new Uint8Array(pad);buf.set(u8);buf[len]=0x80;
  const dv=new DataView(buf.buffer);dv.setUint32(pad-8,Math.floor(len/536870912));dv.setUint32(pad-4,(len<<3)>>>0);
  const w=new Uint32Array(64),r=(x,n)=>(x>>>n)|(x<<(32-n));
  for(let o=0;o<pad;o+=64){
    for(let i=0;i<16;i++)w[i]=dv.getUint32(o+i*4);
    for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=(w[i-16]+(r(a,7)^r(a,18)^(a>>>3))+w[i-7]+(r(b,17)^r(b,19)^(b>>>10)))>>>0}
    let [a,b,c,d,e,f,g,h]=H;
    for(let i=0;i<64;i++){
      const t1=(h+(r(e,6)^r(e,11)^r(e,25))+((e&f)^(~e&g))+K[i]+w[i])>>>0,t2=((r(a,2)^r(a,13)^r(a,22))+((a&b)^(a&c)^(b&c)))>>>0;
      h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0}
    H[0]+=a;H[1]+=b;H[2]+=c;H[3]+=d;H[4]+=e;H[5]+=f;H[6]+=g;H[7]+=h}
  return Array.from(H).map(x=>(x>>>0).toString(16).padStart(8,'0')).join('');
}
/* SHA-256 of the text's UTF-8 bytes. crypto.subtle only exists on https or localhost, and the console is plain http on the LAN, so there is a pure fallback. */
async function storeSha256(text){return storeSha256Bytes(new TextEncoder().encode(String(text)))}
/* Same, over the exact downloaded bytes (what an index hash is computed from; a BOM or odd bytes would change a hash taken over decoded text). */
async function storeSha256Bytes(u8){
  try{if(typeof crypto!=='undefined'&&crypto.subtle){const h=new Uint8Array(await crypto.subtle.digest('SHA-256',u8));return Array.from(h).map(x=>x.toString(16).padStart(2,'0')).join('')}}catch(_){}
  return sha256Pure(u8);
}
/* Returns the absolute https URL, or null. Refused: other schemes, user:pass@, IP literals, localhost and *.local/*.lan/*.internal names (the store must never point the page at the LAN or at MatchiTOOL itself). */
function storeUrlOk(raw,base){
  if(!String(raw).trim())return null;
  let u;try{u=new URL(String(raw).trim(),base||undefined)}catch(_){return null}
  if(u.protocol!=='https:'||u.username||u.password||u.href.length>2000)return null;
  const h=u.hostname.toLowerCase();
  if(!h||h==='localhost'||/^[0-9.]+$/.test(h)||h.includes(':')||h.startsWith('[')||!h.includes('.')||/\.(local|lan|internal|localhost|home|intranet)$/.test(h))return null;
  return u.href;
}
const STORE_UFI_SOURCE='https://raw.githubusercontent.com/BearHero520/UFI-TOOLS-PLUGINS/main/store.json';
const storeClean=(v,n)=>String(v==null?'':v).replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n);
/* Index: a JSON array, or {plugins:[...]}. Entry: {name, url, description?, author?, version?, sha256?, size?}. Relative urls resolve against the index url. Bad entries are skipped and counted. */
function storeParseIndex(text,baseUrl){
  if(String(text).length>STORE_INDEX_MAX)return {items:[],skipped:0,error:'The index is over 1 MB'};
  let data;try{data=JSON.parse(String(text))}catch(_){return {items:[],skipped:0,error:'The index is not valid JSON'}}
  const ufi=data&&typeof data==='object'&&!Array.isArray(data)?((data.res&&data.res.data&&data.res.data.content)||(data.data&&data.data.content)||data.content||null):null;
  if(Array.isArray(ufi))return storeParseUfi(data,ufi,baseUrl);
  const arr=Array.isArray(data)?data:(data&&Array.isArray(data.plugins)?data.plugins:null);
  if(!arr)return {items:[],skipped:0,error:'The index must be a JSON array, {"plugins":[...]} or a UFI-TOOLS store index'};
  const items=[];let skipped=0;
  for(const e of arr.slice(0,STORE_MAX_ITEMS)){
    if(!e||typeof e!=='object'){skipped++;continue}
    const name=storeClean(e.name,80),url=storeUrlOk(e.url||e.file||'',baseUrl);
    const sha=e.sha256==null?'':String(e.sha256).trim().toLowerCase();
    if(!name||!url||(sha&&!/^[0-9a-f]{64}$/.test(sha))){skipped++;continue}
    items.push({name,url,sha256:sha,description:storeClean(e.description,300),author:storeClean(e.author,60),version:storeClean(e.version,30),size:Number.isFinite(e.size)&&e.size>0?Math.floor(e.size):0});
  }
  if(arr.length>STORE_MAX_ITEMS)skipped+=arr.length-STORE_MAX_ITEMS;
  return {items,skipped,error:''};
}
/* UFI-TOOLS store index: {download_url, res:{data:{content:[{name,size,is_dir,hash_info:{md5,sha256}}]}}} (also {data:{content}} or {content}).
   A file lives at download_url + "/" + name. Only plain-text plugins (.js, and .txt/.html UFI bundles) can be installed here: folders,
   archives (.zip, .tar.gz) and binaries need UFI-TOOLS' own installer and are counted in `unsupported`, not listed. md5 is ignored; sha256 is checked. */
function storeParseUfi(data,content,baseUrl){
  const root=storeUrlOk(data.download_url||data.downloadUrl||'',baseUrl);
  if(!root)return {items:[],skipped:0,unsupported:0,error:'The UFI-TOOLS index has no usable download_url (https address with a domain name needed)'};
  const items=[];let skipped=0,unsupported=0;
  for(const e of content.slice(0,STORE_MAX_ITEMS)){
    if(!e||typeof e!=='object'){skipped++;continue}
    if(e.is_dir===true){unsupported++;continue}
    const file=storeClean(e.name,160);
    if(!file||file.includes('..')||file.startsWith('/')){skipped++;continue}
    if(!/\.(js|txt|html?)$/i.test(file)){unsupported++;continue}
    const url=storeUrlOk(root.replace(/\/+$/,'')+'/'+file.split('/').map(encodeURIComponent).join('/'));
    const h=e.hash_info&&e.hash_info.sha256!=null?String(e.hash_info.sha256).trim().toLowerCase():'';
    if(!url||(h&&!/^[0-9a-f]{64}$/.test(h))){skipped++;continue}
    const size=Number(e.size);
    items.push({name:storeClean(file.replace(/\.(js|txt|html?)$/i,''),80)||file.slice(0,80),url,sha256:h,description:'',author:'',version:'',size:Number.isFinite(size)&&size>0?Math.floor(size):0,source:'ufi'});
  }
  if(content.length>STORE_MAX_ITEMS)skipped+=content.length-STORE_MAX_ITEMS;
  return {items,skipped,unsupported,error:''};
}
/* Display only: shows Chinese plugin names and descriptions in English. It never changes item.name (that is the file name used to install,
   replace and delete). Phrases are matched longest first; words not in the list stay as they are. Offline on purpose: the page may not send plugin names anywhere. */
const STORE_ZH=new Map([
  ['可多卡','Multi-SIM'],['多卡','multi-SIM'],['双卡','dual-SIM'],['单卡','single-SIM'],['字母卡','Letter card'],['小鲸卡','Xiaojing card'],['小鲸','Xiaojing'],
  ['卡片','card'],['简洁','simple'],['简约','minimal'],['进度条','progress bar'],['后台','backend'],['本地代理','local proxy'],['流量','data'],['新','New '],
  ['版本','version'],['增强版','enhanced edition'],['精简版','lite edition'],['完整版','full edition'],['经典版','classic edition'],['版','edition'],
  ['一键解控','one-click unlock'],['一键','one-click'],['解控','unlock'],['解锁','unlock'],['插件','plugin'],['工具箱','toolbox'],['工具','tool'],
  ['管理器','manager'],['管理','management'],['控制','control'],['设置','settings'],['高级','advanced'],['增强','enhanced'],['优化','optimization'],['加速','boost'],
  ['修复','fix'],['清理','cleanup'],['内存','memory'],['存储','storage'],['日志','log'],['备份','backup'],['恢复','restore'],['升级','upgrade'],['更新','update'],
  ['下载','download'],['上传','upload'],['文件','file'],['代理','proxy'],['内网穿透','intranet tunnel'],['穿透','tunnel'],['远程','remote'],['组网','networking'],
  ['去广告','ad blocking'],['广告','ads'],['拦截','blocking'],['防火墙','firewall'],['路由器','router'],['路由','router'],['热点','hotspot'],['无线','wireless'],
  ['设备','device'],['连接数','connections'],['连接','connection'],['限速','speed limit'],['限制','limit'],['套餐','plan'],['剩余','remaining'],['已用','used'],['总量','total'],
  ['短信转发','SMS forwarding'],['短信','SMS'],['转发','forwarding'],['统计','statistics'],['监控','monitor'],['温度','temperature'],['温控','thermal control'],
  ['电池','battery'],['电量','battery level'],['充电','charging'],['省电','power saving'],['风扇','fan'],['散热','cooling'],['信号','signal'],['锁频','band lock'],
  ['锁定','lock'],['频段','band'],['小区','cell'],['网络','network'],['网速','network speed'],['测速','speed test'],['速度','speed'],['重启','reboot'],['定时','scheduled'],
  ['自动','auto'],['开机','startup'],['启动','start'],['关机','shutdown'],['屏幕','screen'],['主题','theme'],['美化','styling'],['皮肤','skin'],['背景','background'],
  ['壁纸','wallpaper'],['状态','status'],['显示','display'],['悬浮窗','floating window'],['悬浮','floating'],['面板','panel'],['仪表盘','dashboard'],['首页','home page'],
  ['中国移动','China Mobile'],['中国联通','China Unicom'],['中国电信','China Telecom'],['中国广电','China Broadcasting'],['移动','Mobile'],['联通','Unicom'],['电信','Telecom'],
  ['广电','Broadcasting'],['运营商','carrier'],['漫游','roaming'],['手机号','phone number'],['号码','number'],['微信','WeChat'],['钉钉','DingTalk'],['邮件','email'],
  ['推送','push'],['通知','notification'],['告警','alert'],['测试','test'],['实验','experimental'],['中文','Chinese'],['汉化','localization'],['时间','time'],['天气','weather'],
  ['网页','web page'],['终端','terminal'],['脚本','script'],['命令','command'],['权限','permissions'],['密码','password'],['登录','login'],['隐藏','hide'],
]);
const STORE_ZH_MAX=Math.max(...[...STORE_ZH.keys()].map(k=>k.length));
const STORE_ZH_PUNCT={'（':'(','）':')','【':'[','】':']','：':': ','，':', ','、':', ','；':'; ','！':'!','？':'?','。':'. '};
function storeEnglish(text){
  const s=String(text==null?'':text);
  if(!/[\u3000-\u9fff\uff00-\uffef]/.test(s))return s;
  let out='';
  for(let i=0;i<s.length;){
    let hit=null,len=0;
    for(let n=Math.min(STORE_ZH_MAX,s.length-i);n>0;n--){const w=STORE_ZH.get(s.substr(i,n));if(w!==undefined){hit=w;len=n;break}}
    if(hit!==null){out+=' '+hit+' ';i+=len}
    else{const c=s[i];out+=Object.prototype.hasOwnProperty.call(STORE_ZH_PUNCT,c)?STORE_ZH_PUNCT[c]:c;i++}
  }
  out=out.replace(/\(\s+/g,'(').replace(/\s+\)/g,')').replace(/\s+([,:;.!?])/g,'$1').replace(/([)\]])(?=[^\s,:;.!?)\]])/g,'$1 ').replace(/\s{2,}/g,' ').trim();
  return out.replace(/(^|[(\[]|[)\]] )([a-z])/g,(m,a,b)=>a+b.toUpperCase());
}
function storeFilter(items,query,page,per){
  per=per||STORE_PER_PAGE;const q=String(query||'').trim().toLowerCase();
  const all=q?items.filter(i=>(i.name+' '+i.description+' '+i.author+' '+storeEnglish(i.name+' '+i.description)).toLowerCase().includes(q)):items;
  const pages=Math.max(1,Math.ceil(all.length/per)),p=Math.min(Math.max(1,page|0||1),pages);
  return {rows:all.slice((p-1)*per,p*per),page:p,pages,total:all.length};
}
/* A plain text search of the plugin's source. It is a hint for the person about to confirm, NOT a safety check: code can build commands at run time. */
function plugScan(code){
  const s=String(code),uniq=(a)=>[...new Set(a)];
  const hasRoot=/runShellWithRoot|\/api\/(?:shell|root_shell|one_click_shell)\b/.test(s),hasUser=/runShellWithUser|\/api\/user_shell\b/.test(s);
  const tools=['curl','jq','sendat','sha256','zreq'].filter(t=>new RegExp('(^|[^A-Za-z0-9_-])'+t+'([^A-Za-z0-9_]|$)').test(s));
  const riskyRx=[['deletes files (rm -r)',/\brm\s+-[a-zA-Z]*[rR]/],['raw disk access (dd / block devices)',/\bdd\s+if=|\/dev\/block\//],['mounts or remounts',/\bmount\b/],['changes system properties',/\bsetprop\b/],['reboots',/\breboot\b|\bsvc\s+power\b/],['uninstalls or disables apps',/\bpm\s+(?:uninstall|disable)/],['writes the boot script',/ufi_tools_boot\.sh|matchitool\/boot\.sh/],['pipes a download into a shell',/(?:curl|wget)\b[^\n]*\|\s*(?:sh|bash)\b/],['formats storage',/\bmkfs\b/],['builds code at run time (eval / new Function)',/\beval\s*\(|new\s+Function\s*\(/]];
  const risky=riskyRx.filter(([,rx])=>rx.test(s)).map(([l])=>l);
  const endpoints=uniq((s.match(/\/api\/[A-Za-z0-9_./-]+/g)||[]).map(x=>x.replace(/[./-]+$/,''))).slice(0,12);
  const hosts=uniq([...s.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)].map(m=>m[1].toLowerCase())).slice(0,8);
  const token=/matchi_token|\bTOKEN\b|x-token/.test(s),net=/\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts)\b/.test(s);
  return {root:hasRoot,user:hasUser,tools,risky,endpoints,hosts,token,net};
}
/* The stop header lines of a single .js plugin, read the way the host reads them (pluginUninstallDeclarations in PluginPaths.kt; scripts/test_ufi_store.js runs the same cases as
   PluginUninstallTest.kt). First 400 lines; a line must START with "//", so text inside code is no header. At most 10 commands (1-300 characters, no control characters,
   duplicates dropped), one check (the first valid), at most 5 boot paths (plain absolute path, 200 characters at most, duplicates dropped). A line that breaks a rule is
   dropped and does not use up a limit. Java's \s, \S and "." differ from JavaScript's, so they are written out here: \s = [ \t\n\x0B\f\r]; "." does not match \n \r \u0085 \u2028 \u2029;
   one such character at the very end of a line counts as a line end for "$" in Java, so it is cut off first. Display only: whether a command may run is decided by the host. */
const STOP_WS='[ \\t\\n\\x0B\\f\\r]',STOP_NWS='[^ \\t\\n\\x0B\\f\\r]',STOP_DOT='[^\\n\\r\\u0085\\u2028\\u2029]';
const STOP_UNINSTALL_RX=new RegExp('^'+STOP_WS+'*//'+STOP_WS+'*@matchi-uninstall'+STOP_WS+'+('+STOP_NWS+STOP_DOT+'*?)'+STOP_WS+'*$');
const STOP_CHECK_RX=new RegExp('^'+STOP_WS+'*//'+STOP_WS+'*@matchi-check'+STOP_WS+'+('+STOP_NWS+STOP_DOT+'*?)'+STOP_WS+'*$');
const STOP_BOOT_RX=new RegExp('^'+STOP_WS+'*//'+STOP_WS+'*@matchi-boot'+STOP_WS+'+('+STOP_NWS+'+)'+STOP_WS+'*$');
const STOP_MAX_COMMANDS=10,STOP_MAX_LEN=300,STOP_MAX_BOOT=5,STOP_BOOT_PATH_MAX=200;
const stopCmdOk=c=>c.length>0&&c.length<=STOP_MAX_LEN&&!/[\u0000-\u001f\u007f]/.test(c);
const stopBootOk=p=>p.length<=STOP_BOOT_PATH_MAX&&/^\/[A-Za-z0-9._\/-]+$/.test(p)&&p.split('/').slice(1).every(x=>x!==''&&x!=='.'&&x!=='..');
function plugStopDecls(code){
  const commands=[],boot=[];let check=null;
  /* Kotlin's lineSequence splits on \n, \r\n and \r only. */
  for(let line of String(code).split(/\r\n|\n|\r/).slice(0,400)){
    line=line.replace(/[\u0085\u2028\u2029]$/,'');
    let m=STOP_UNINSTALL_RX.exec(line);
    if(m){const c=m[1];if(stopCmdOk(c)&&commands.length<STOP_MAX_COMMANDS&&!commands.includes(c))commands.push(c);continue}
    m=STOP_CHECK_RX.exec(line);
    if(m){if(check===null&&stopCmdOk(m[1]))check=m[1];continue}
    m=STOP_BOOT_RX.exec(line);
    if(m&&stopBootOk(m[1])&&boot.length<STOP_MAX_BOOT&&!boot.includes(m[1]))boot.push(m[1]);
  }
  return {commands,check,boot};
}
/* Routes the host really serves (kept in step with WebServer.kt by scripts/test_ufi_store.js). A plugin that calls any other /api path gets a 404. */
const MATCHI_ROUTES=new Set(["/api/AT","/api/at","/api/at/batch","/api/console/password","/api/diagnostics","/api/firmware/inspect","/api/get_cookie","/api/imei/apply","/api/login","/api/logout","/api/logs/basket","/api/logs/basket/delete","/api/logs/basket/read","/api/logs/boot/counters","/api/logs/boot/files","/api/logs/boot/install","/api/logs/boot/read","/api/logs/boot/status","/api/logs/boot/uninstall","/api/logs/clienterror","/api/logs/delete","/api/logs/device","/api/logs/entries","/api/logs/export","/api/logs/search","/api/logs/sessions","/api/logs/snapshot","/api/logs/start","/api/logs/status","/api/logs/stop","/api/logs/stream","/api/net/whoami","/api/one_click_shell","/api/ping","/api/plugins","/api/plugins/approve","/api/plugins/call","/api/plugins/data","/api/plugins/delete","/api/plugins/mode","/api/plugins/order","/api/plugins/scan","/api/security/http","/api/security/net","/api/plugins/toggle","/api/root/status","/api/root_shell","/api/screen/frame","/api/screen/input","/api/set_cookie","/api/shell","/api/update/check","/api/update/fetch","/api/update/install","/api/update/stage","/api/update/status","/api/upload","/api/upload_img","/api/uploads/delete","/api/usb/control","/api/usb/status","/api/user_shell","/api/zte","/api/zte/config","/api/zte/page"]);
const MATCHI_ROUTE_PREFIXES=["/api/goform/","/api/logs/session/","/api/proxy/","/api/uploads/"];
/* Files MatchiTOOL ships under UFI's files folder; any other UFI file a plugin names is missing. Tools UFI ships that MatchiTOOL does not: */
const MATCHI_BUNDLED_FILES=new Set(['curl','jq','sendat','sha256','zreq']);
const MATCHI_MISSING_TOOLS=['socat','ttyd','iperf3','imei_reader','ufi_req'];
/* Optional header in a plugin's first 40 lines (same style as @matchi-data / @matchi-localstorage):
     // @matchi-name Signal meter      // @matchi-version 1.2      // @matchi-author me
     // @matchi-description One line   // @matchi-requires root, curl, jq
   All fields are optional; values are cut to a safe length and control characters removed. */
function plugMeta(code){
  const m={name:'',version:'',author:'',description:'',requires:[]};
  const lines=String(code).split('\n',40);
  for(const ln of lines){
    const g=/^\s*(?:\/\/|\*|\/\*+)?\s*@matchi-(name|version|author|description|requires)\s+(.+?)\s*(?:\*\/)?\s*$/.exec(ln);if(!g)continue;
    const v=storeClean(g[2],g[1]==='description'?200:60);if(!v)continue;
    if(g[1]==='requires')m.requires=v.split(/[\s,;]+/).filter(x=>/^[A-Za-z0-9][A-Za-z0-9_.-]{0,23}$/.test(x)).slice(0,8);
    else if(!m[g[1]])m[g[1]]=v;
  }
  return m;
}
/* Static compatibility check of a plugin's source (a hint, like plugScan). Lists what the plugin needs that MatchiTOOL does not provide. */
function plugCompat(code){
  const s=String(code),sc=plugScan(s),issues=[];
  const routes=sc.endpoints.filter(e=>e!=='/api'&&!MATCHI_ROUTES.has(e)&&!MATCHI_ROUTE_PREFIXES.some(p=>(e+'/').startsWith(p)));
  if(routes.length)issues.push('calls routes MatchiTOOL does not have (they answer 404): '+routes.join(', '));
  const defines=(n)=>new RegExp('(function\\s+'+n+'\\b|(?:const|let|var)\\s+'+n+'\\b|window\\.'+n+'\\s*=)').test(s);
  const globals=['getCookie','setCookie'].filter(g=>new RegExp('(^|[^A-Za-z0-9_$.])'+g+'\\s*\\(').test(s)&&!defines(g));
  if(globals.length)issues.push('uses '+globals.join(', ')+', which the page does not define');
  const tools=MATCHI_MISSING_TOOLS.filter(t=>new RegExp('(^|[^A-Za-z0-9_-])'+t+'([^A-Za-z0-9_]|$)').test(s));
  if(tools.length)issues.push('names tools MatchiTOOL does not ship: '+tools.join(', '));
  const files=[...new Set([...s.matchAll(/\/data\/data\/com\.minikano\.f50_sms\/files\/([A-Za-z0-9._-]+)/g)].map(x=>x[1]))].filter(f=>!MATCHI_BUNDLED_FILES.has(f)&&!/\.(sh|json|txt|log|conf|pid)$/i.test(f));
  if(files.length)issues.push('expects UFI-TOOLS files that are not shipped: '+files.slice(0,6).join(', '));
  return {issues,ok:issues.length===0};
}
function storeSummary(item,sha,scan,replaces,compat,stop){
  const L=[];
  L.push(item.name+(item.version?' '+item.version:'')+(item.author?' by '+item.author:''));
  L.push('SHA-256 (of the file you downloaded):\n'+sha);
  if(item.sha256)L.push('The store lists the same SHA-256 (checked).');else L.push('The store lists NO SHA-256 for this file, so nothing can confirm it is the file the author published.');
  L.push('It '+(scan.root?'runs commands as ROOT':scan.user?'runs commands as the app user':'does not appear to run shell commands')+(scan.root&&scan.user?' and as the app user':'')+'.');
  if(scan.tools.length)L.push('Tools it names: '+scan.tools.join(', ')+'.');
  if(scan.risky.length)L.push('Careful: it '+scan.risky.join('; ')+'.');
  if(scan.endpoints.length)L.push('MatchiTOOL routes it calls: '+scan.endpoints.join(', ')+'.');
  if(scan.token)L.push('Careful: it mentions the sign-in token.');
  if(scan.net&&!scan.hosts.length)L.push('It makes network requests (no host named in the text).');
  if(scan.hosts.length)L.push('Web hosts it contacts or names: '+scan.hosts.join(', ')+'.');
  if(compat)L.push(compat.ok?'Compatibility check: no known problems.':'Compatibility: this plugin '+compat.issues.join('; ')+'. It may not work here.');
  /* Only given for a single .js plugin (plugin-store-ui.js). Each command is cut at 120 characters and at most 10 are listed; the Delete dialog shows them in full. */
  if(stop&&(stop.commands.length||stop.check||stop.boot.length)){
    const cut=c=>c.length>120?c.slice(0,120)+'...':c,B=a=>a.map(x=>'\n\u2022 '+cut(x)).join('');
    let t='';
    if(stop.commands.length)t+='When deleted with Stop, it runs these commands as ROOT:'+B(stop.commands.slice(0,10));
    if(stop.check)t+=(t?'\n':'')+'Then it checks with:'+B([stop.check]);
    if(stop.boot.length)t+=(t?'\n':'')+'Boot files it says it creates (only checked for, to see they are gone):'+B(stop.boot);
    L.push(t+'\nThe Delete dialog shows each command in full before anything runs.');
  }
  L.push('This list comes from a text search of the source; a plugin can build commands while it runs.');
  if(replaces.length)L.push('It will REPLACE: '+replaces.join(', ')+'.');
  return L.join('\n');
}
/* UFISTORE-END */