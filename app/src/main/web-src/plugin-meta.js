/* Plugin facts read from a plugin's source before it is added: header lines (@matchi-name ...), a text-search summary of what it does,
   and the stop declarations the Delete dialog uses. Pure functions, no DOM; scripts/test_plugin_meta.js runs them in Node. */
/* Short stable hash (FNV-1a, 8 hex digits) that keeps two different non-ASCII file names from sharing one safe name. */
function plugHash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0}return (h>>>0).toString(16).padStart(8,'0')}
const plugClean=(v,n)=>String(v==null?'':v).replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n);
/* A plain text search of the plugin's source. It is a hint for the person about to confirm, NOT a safety check: code can build commands at run time. */
function plugScan(code){
  const s=String(code),uniq=(a)=>[...new Set(a)];
  const hasRoot=/matchi\.root|matchi\.sh\b|runShellWithRoot|\/api\/shell\b/.test(s),hasUser=/matchi\.user|runShellWithUser|\/api\/user_shell\b/.test(s);
  const tools=['curl','jq','sendat','sha256','zreq'].filter(t=>new RegExp('(^|[^A-Za-z0-9_-])'+t+'([^A-Za-z0-9_]|$)').test(s));
  const riskyRx=[['deletes files (rm -r)',/\brm\s+-[a-zA-Z]*[rR]/],['raw disk access (dd / block devices)',/\bdd\s+if=|\/dev\/block\//],['mounts or remounts',/\bmount\b/],['changes system properties',/\bsetprop\b/],['reboots',/\breboot\b|\bsvc\s+power\b/],['uninstalls or disables apps',/\bpm\s+(?:uninstall|disable)/],['writes the boot script',/matchitool\/boot\.sh/],['pipes a download into a shell',/(?:curl|wget)\b[^\n]*\|\s*(?:sh|bash)\b/],['formats storage',/\bmkfs\b/],['builds code at run time (eval / new Function)',/\beval\s*\(|new\s+Function\s*\(/]];
  const risky=riskyRx.filter(([,rx])=>rx.test(s)).map(([l])=>l);
  const endpoints=uniq((s.match(/\/api\/[A-Za-z0-9_./-]+/g)||[]).map(x=>x.replace(/[./-]+$/,''))).slice(0,12);
  const hosts=uniq([...s.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)].map(m=>m[1].toLowerCase())).slice(0,8);
  const token=/matchi_token|\bTOKEN\b|x-token/.test(s),net=/\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts)\b/.test(s);
  return {root:hasRoot,user:hasUser,tools,risky,endpoints,hosts,token,net};
}
/* The stop header lines of a single .js plugin, read the way the host reads them (pluginUninstallDeclarations in PluginPaths.kt; scripts/test_plugin_meta.js runs the same cases as
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
/* Optional header in a plugin's first 40 lines (same style as @matchi-data / @matchi-localstorage):
     // @matchi-name Signal meter      // @matchi-version 1.2      // @matchi-author me
     // @matchi-description One line   // @matchi-requires root, curl, jq
   All fields are optional; values are cut to a safe length and control characters removed. */
function plugMeta(code){
  const m={name:'',version:'',author:'',description:'',requires:[]};
  const lines=String(code).split('\n',40);
  for(const ln of lines){
    const g=/^\s*(?:\/\/|\*|\/\*+)?\s*@matchi-(name|version|author|description|requires)\s+(.+?)\s*(?:\*\/)?\s*$/.exec(ln);if(!g)continue;
    const v=plugClean(g[2],g[1]==='description'?200:60);if(!v)continue;
    if(g[1]==='requires')m.requires=v.split(/[\s,;]+/).filter(x=>/^[A-Za-z0-9][A-Za-z0-9_.-]{0,23}$/.test(x)).slice(0,8);
    else if(!m[g[1]])m[g[1]]=v;
  }
  return m;
}
function plugSummary(name,scan,replaces,stop){
  const L=[];
  L.push(String(name));
  L.push('It '+(scan.root?'runs commands as ROOT':scan.user?'runs commands as the app user':'does not appear to run shell commands')+(scan.root&&scan.user?' and as the app user':'')+'.');
  if(scan.tools.length)L.push('Tools it names: '+scan.tools.join(', ')+'.');
  if(scan.risky.length)L.push('Careful: it '+scan.risky.join('; ')+'.');
  if(scan.endpoints.length)L.push('MatchiTOOL routes it calls: '+scan.endpoints.join(', ')+'.');
  if(scan.token)L.push('Careful: it mentions the sign-in token.');
  if(scan.net&&!scan.hosts.length)L.push('Makes network requests. No host named.');
  if(scan.hosts.length)L.push('Web hosts it contacts or names: '+scan.hosts.join(', ')+'.');
  /* Only given when the plugin declares them (plugin manager). Each command is cut at 120 characters and at most 10 are listed; the Delete dialog shows them in full. */
  if(stop&&(stop.commands.length||stop.check||stop.boot.length)){
    const cut=c=>c.length>120?c.slice(0,120)+'...':c,B=a=>a.map(x=>'\n\u2022 '+cut(x)).join('');
    let t='';
    if(stop.commands.length)t+='Stop runs these commands as root:'+B(stop.commands.slice(0,10));
    if(stop.check)t+=(t?'\n':'')+'Then it checks with:'+B([stop.check]);
    if(stop.boot.length)t+=(t?'\n':'')+'Boot files it creates (checked for removal):'+B(stop.boot);
    L.push(t+'\nDelete shows each command before running.');
  }
  L.push('This list comes from a text search of the source; a plugin can build commands while it runs.');
  if(replaces.length)L.push('It will REPLACE: '+replaces.join(', ')+'.');
  return L.join('\n');
}
