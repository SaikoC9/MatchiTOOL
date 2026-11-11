(function(){
 const $=id=>document.getElementById(id);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let lastKey='', rows=[], historyMode='', refreshBusy=false, refreshTimer=null, lastId=0, dropped=0, paused=false, filterTimer=null, renderTimer=null;
 let stream=null, streamOk=false, streamFails=0, searchMode=false, errIdx=-1, shown=[], alertCount=0, alertAt=0;
 const baseTitle=document.title;
 const BM_KEY='matchi_lc_bookmarks';
 let bookmarks=new Set(); try{bookmarks=new Set(JSON.parse(localStorage.getItem(BM_KEY)||'[]'))}catch(e){}
 const saveBM=()=>{try{localStorage.setItem(BM_KEY,JSON.stringify([...bookmarks].slice(-300)))}catch(e){}};
 const keyOf=x=>x.timestamp+'|'+x.function+'|'+x.message;
 const srcOf=x=>x.source||(String(x.function).startsWith('device/')?'device':x.function==='kernel'?'kernel':'app');
 const panelOpen=()=>!!$('logcatcher')?.classList.contains('open');
 const stamp=v=>v?v.replace('T',' '):'';
 const colorOf=l=>l==='ERROR'?'#ff6b81':l==='WARNING'?'#ffc857':l==='DEBUG'?'#8aa4c8':'#b9c9dc';
 const lineOf=x=>`${x.timestamp} ${x.pid>0?x.pid+'/'+x.tid+' ':''}[${x.level}] [${x.function}] ${x.message}`;

 /* ---- filtering: level, source, function, keyword or regex, time range, bookmarks ---- */
 function makeFilter(){
  const q=$('lcsearch').value, lq=q.toLowerCase(), useRx=$('lcregex').checked;
  let rx=null,bad=false; if(q&&useRx){try{rx=new RegExp(q,'i')}catch(e){bad=true}}
  $('lcsearch').style.outline=bad?'2px solid #ff6b81':'';
  const level=$('lclevel').value, fn=$('lcfunction').value.toLowerCase(), src=$('lcsource').value, from=stamp($('lcfrom').value), until=stamp($('lcuntil').value), bm=$('lcbm').checked;
  return x=>{
   if(level!=='ALL'&&x.level!==level)return false;
   if(fn&&!String(x.function).toLowerCase().includes(fn))return false;
   if(src!=='ALL'&&srcOf(x)!==src)return false;
   if(from||until){const t=x.timestamp||''; if(!t)return false; if(from&&t.slice(0,from.length)<from)return false; if(until&&t.slice(0,until.length)>until)return false}
   if(bm&&!bookmarks.has(keyOf(x)))return false;
   if(q){const hay=x.message+' '+x.function; if(bad)return false; if(rx){if(!rx.test(hay))return false}else if(!hay.toLowerCase().includes(lq))return false}
   return true;
  };
 }
 /* Collapse repeats: same level, function and message once digits are ignored (counters, ids, addresses). */
 function group(list){
  const out=[], idx=new Map();
  for(const x of list){
   const k=x.level+'|'+x.function+'|'+String(x.message).replace(/\d+/g,'#'), g=idx.get(k);
   if(g){g.count++;g.last=x.timestamp}else{const c={...x,count:1,last:x.timestamp};idx.set(k,c);out.push(c)}
  }
  return out;
 }
 function render(force){
  if(searchMode)return;
  const filtered0=rows.filter(makeFilter()), grouped=$('lcgroup').checked, filtered=grouped?group(filtered0):filtered0;
  $('lccount').textContent=filtered0.length+' / '+rows.length+' entries'+(grouped?' · '+filtered.length+' groups':'')+(paused?' · paused':'')+(streamOk?' · live':'')+(dropped>0?' · '+dropped+' disk writes dropped':'');
  const tail=filtered.slice(-500);
  const key=(grouped?'g':'f')+bookmarks.size+'~'+tail.map(x=>(x.id??x.timestamp+x.message)+(x.count>1?'x'+x.count:'')).join('|');
  if(!force&&key===lastKey)return;
  const out=$('lcout'), firstPaint=lastKey==='', stick=force||firstPaint||out.scrollHeight-out.scrollTop-out.clientHeight<48;
  lastKey=key; shown=tail; errIdx=-1; $('lcerrpos').textContent='';
  out.innerHTML=tail.map((x,i)=>`<span class="lcl${x.level==='ERROR'?' lcerr':''}" data-i="${i}" style="color:${colorOf(x.level)}">${bookmarks.has(keyOf(x))?'★ ':''}${esc(x.timestamp)} ${x.pid>0?esc(x.pid)+'/'+esc(x.tid)+' ':''}[${esc(x.level)}] [${esc(x.function)}] ${esc(x.message)}${x.count>1?' ×'+x.count+' (last '+esc(x.last)+')':''}</span>`).join('\n')||'No matching log entries';
  if(stick)out.scrollTop=out.scrollHeight;
 }
 function renderSoon(){if(renderTimer)return;renderTimer=setTimeout(()=>{renderTimer=null;render()},250)}

 /* ---- alerts: a toast and a count in the tab title when a new line matches ---- */
 const alertsOn=()=>$('lcalerterr').checked||$('lcalert').value.trim()!=='';
 function checkAlerts(list){
  const onErr=$('lcalerterr').checked, kw=$('lcalert').value.trim().toLowerCase(); if(!onErr&&!kw)return;
  const hit=list.filter(x=>(onErr&&x.level==='ERROR')||(kw&&(x.message+' '+x.function).toLowerCase().includes(kw)));
  if(!hit.length)return;
  alertCount+=hit.length; document.title='('+alertCount+') '+baseTitle;
  const t=Date.now(); if(t-alertAt>5000){alertAt=t;try{createToast('Log alert: '+String(hit[hit.length-1].message).slice(0,90),'orange',5000)}catch(e){}}
 }
 function clearAlerts(){alertCount=0;document.title=baseTitle}

 function addRows(list,alertOn){
  if(historyMode)return;
  const fresh=list.filter(x=>x&&x.id>lastId).sort((a,b)=>a.id-b.id); if(!fresh.length)return;
  rows=rows.concat(fresh); if(rows.length>3000)rows=rows.slice(-3000);
  lastId=fresh[fresh.length-1].id;
  if(alertOn)checkAlerts(fresh);
  renderSoon();
 }

 async function refresh(force){
  if(refreshBusy || document.hidden || !panelOpen()) return;
  refreshBusy=true;
  try{
   const status=await api('/api/logs/status'); $('lcstate').textContent=status.running?'● Logging active':'Logging stopped'; $('lcstate').style.color=status.running?'#35d6a0':'var(--muted)'; $('lcsession').textContent=status.session||'No active session'; $('lcstart').disabled=!!status.running; $('lcstop').disabled=!status.running;
   dropped=status.droppedWrites||0;
   if(!historyMode && !paused && (force===true || !streamOk)){
    const d=await api('/api/logs/entries?since='+lastId);
    if(d.reset){rows=[];lastId=0}
    const first=lastId===0;
    addRows(d.entries||[],!first);
   }
   render();
  }catch(e){$('lcstate').textContent='Log service unavailable';}
  finally{refreshBusy=false;}
 }

 /* ---- live stream (server-sent events over fetch, so the session header can be sent); polling is the fallback ---- */
 const wantStream=()=>!historyMode&&!paused&&((panelOpen()&&!document.hidden)||alertsOn());
 function handleFrame(f){
  streamOk=true; if(f.startsWith(':'))return;
  let ev='message',data=''; f.split('\n').forEach(l=>{if(l.startsWith('event:'))ev=l.slice(6).trim();else if(l.startsWith('data:'))data+=l.slice(5).trim()});
  if(ev==='reset'){rows=[];lastId=0;lastKey='';renderSoon();return}
  if(ev==='lagged'){refresh(true);return}
  try{addRows([JSON.parse(data)],true)}catch(e){}
 }
 async function openStream(){
  if(stream||!wantStream()||typeof TOKEN!=='string'||!TOKEN)return;
  const s={ctl:new AbortController(),stop:false}; stream=s; let got=false;
  const timer=setTimeout(()=>{if(!got)s.ctl.abort()},8000);
  try{
   const r=await fetch('/api/logs/stream?since='+lastId,{headers:{'x-token':TOKEN},signal:s.ctl.signal});
   if(!r.ok||!r.body)throw new Error('stream unavailable');
   const rd=r.body.getReader(), dec=new TextDecoder(); let buf='';
   for(;;){
    const {done,value}=await rd.read(); if(done)break;
    got=true; clearTimeout(timer); buf+=dec.decode(value,{stream:true});
    let i; while((i=buf.indexOf('\n\n'))>=0){const frame=buf.slice(0,i);buf=buf.slice(i+2);handleFrame(frame)}
   }
  }catch(e){}
  finally{
   clearTimeout(timer); stream=null; streamOk=false;
   if(!s.stop){if(got)streamFails=0;else streamFails++;if(wantStream()&&streamFails<3)setTimeout(openStream,got?500:2000)}
  }
 }
 function syncStream(){
  if(stream&&!wantStream()){stream.stop=true;stream.ctl.abort()}
  else if(!stream&&wantStream()&&streamFails<3)openStream();
 }

/* REDACT-BEGIN (mirror of Redactor.kt; scripts/test_page_redact.js checks both give the same results) */
const RD_SMS_AT=/\+(CMGR|CMGL|CMT|CDS|CMGS|CMGW)\s*[:=]|\bAT\+(CMGS|CMGW|CMGR|CMGL)\b\s*=?/i;
const RD_SMS_BODY=/\b(sms_?body|sms_?text|message_?body|body)\s*[=:]\s*\S/i;
const RD_BEARER=/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]{8,}/gi;
const RD_SECRET=/\b(password|passwd|pwd|passphrase|secret|token|api[_-]?key|authorization|cookie|x-token|session[_-]?id|access[_-]?key)(\s*[:=]\s*)(?:(?:Bearer|Basic)\s+)?("[^"]*"|'[^']*'|[^\s,;&"']+)/gi;
const RD_ID_KV=/\b(imei(?:sv)?|imsi|iccid|meid|msisdn|serial(?:no)?)(\s*[:=]\s*)([0-9A-Za-z]{6,})/gi;
const RD_IMEI=/(^|[^0-9A-Za-z])(\d{15})(?![0-9A-Za-z])/g;
const RD_ICCID=/(^|[^0-9A-Za-z])(89\d{17,18})(?![0-9A-Za-z])/g;
const RD_PHONE=/(^|[^\w.+])\+\d{8,15}(?!\d)/g;
const RD_HEX=/(^|[^0-9A-Fa-f])([0-9A-Fa-f]{40,})(?![0-9A-Fa-f])/g;
const RD_PDU_CTX=/pdu|sms|cmg|cmt|cds/i;
function rdLuhn(d){if(!d||/[^0-9]/.test(d))return false;let sum=0,alt=false;for(let i=d.length-1;i>=0;i--){let n=d.charCodeAt(i)-48;if(alt){n*=2;if(n>9)n-=9}sum+=n;alt=!alt}return sum%10===0}
function redactLine(line,counts){
 if(!line)return line;
 const hit=k=>{counts[k]=(counts[k]||0)+1};
 let s=line,m;
 if((m=RD_SMS_AT.exec(s))){hit('sms');return s.slice(0,m.index+m[0].length)+' [SMS redacted]'}
 if((m=RD_SMS_BODY.exec(s))){hit('sms');return s.slice(0,m.index+m[1].length)+'=[SMS redacted]'}
 s=s.replace(RD_BEARER,(a,g1)=>{hit('token');return g1+' [REDACTED]'});
 s=s.replace(RD_SECRET,(a,g1,g2)=>{hit('secret');return g1+g2+'[REDACTED]'});
 s=s.replace(RD_ID_KV,(a,g1,g2)=>{hit('identifier');return g1+g2+'[ID]'});
 s=s.replace(RD_IMEI,(a,pre,num)=>{if(rdLuhn(num)){hit('imei');return pre+'[IMEI]'}return a});
 s=s.replace(RD_ICCID,(a,pre)=>{hit('iccid');return pre+'[ICCID]'});
 s=s.replace(RD_PHONE,(a,pre)=>{hit('phone');return pre+'[PHONE]'});
 if(RD_PDU_CTX.test(s))s=s.replace(RD_HEX,(a,pre)=>{hit('hex');return pre+'[HEX redacted]'});
 return s;
}
function redactText(text){const counts={};const out=String(text).split('\n').map(l=>redactLine(l,counts)).join('\n');return{text:out,counts:counts,total:Object.values(counts).reduce((a,b)=>a+b,0)}}
/* REDACT-END */
/* Hide private data in single-file exports and copies when the box is ticked (same box as for the zips). */
function maybeRedact(text){const box=$('lcredact');if(!box||!box.checked)return{text:String(text),total:0};return redactText(text)}
 window.__lcRedact=redactText;
 /* ---- buttons ---- */
 $('lcstart').onclick=async()=>{try{const d=await api('/api/logs/start',{method:'POST'});if(!d||d.ok!==true)throw new Error('The log writer could not start a session. Check storage space and try again.');historyMode='';rows=[];lastId=0;lastKey='';searchMode=false;$('lcsearchclose').style.display='none';$('lchistory').value='';$('lcdelete').disabled=true;await loadHistory();await refresh();loadDevice();}catch(e){askNotice('Could not start logging: '+e.message)}};
 $('lcstop').onclick=async()=>{try{await api('/api/logs/stop',{method:'POST'});await refresh();loadHistory();loadDevice();}catch(e){askNotice('Could not stop logging: '+e.message)}};
 function saveBlob(blob,name){const a=document.createElement('a');const url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000)}
 function exportLogs(ext){const r=maybeRedact(rows.filter(makeFilter()).map(lineOf).join('\n'));const text=r.text;if(r.total)createToast('Private data hidden in '+r.total+' line(s)');const a=document.createElement('a');const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));a.href=url;a.download='matchitool_logs_'+new Date().toISOString().replace(/[:.]/g,'-')+'.'+ext;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000)} $('lcexport').onclick=()=>exportLogs('txt');$('lcexportlog').onclick=()=>exportLogs('log');
 async function downloadZip(path,btn){
  const old=btn.textContent; btn.disabled=true; btn.textContent='Preparing…';
  try{
   const r=await fetch(path,{headers:{'x-token':TOKEN}});
   if(!r.ok){let m='Request failed ('+r.status+')';try{m=(await r.json()).error||m}catch(e){}throw new Error(m)}
   const cd=r.headers.get('content-disposition')||'', nm=(cd.match(/filename="([^"]+)"/)||[])[1]||'matchitool_logs.zip';
   saveBlob(await r.blob(),nm);
  }catch(e){askNotice('Download failed: '+e.message)}
  finally{btn.disabled=false;btn.textContent=old}
 }
 const redactQ=()=>'&redact='+($('lcredact').checked?'1':'0');
 const confirmRaw=async()=>$('lcredact').checked||(await askConfirm('Private data (SMS text, phone numbers, IMEI, passwords, tokens) will NOT be hidden in this zip. Continue?','Continue'));
 $('lcexportall').onclick=async()=>{if(await confirmRaw())downloadZip('/api/logs/export?kind=all'+redactQ(),$('lcexportall'))};
 $('lcreport').onclick=async()=>{if(await confirmRaw())downloadZip('/api/logs/export?kind=report'+redactQ(),$('lcreport'))};
 $('lcbundle').onclick=async()=>{if(await confirmRaw())downloadZip('/api/logs/export?kind=bundle'+redactQ(),$('lcbundle'))};
 ['lclevel','lcsource','lcfunction','lcsearch','lcregex','lcfrom','lcuntil','lcgroup','lcbm'].forEach(id=>$(id).addEventListener('input',()=>{clearTimeout(filterTimer);filterTimer=setTimeout(()=>render(true),150)}));
 ['lcalerterr','lcalert'].forEach(id=>$(id).addEventListener('input',()=>{clearAlerts();syncStream()}));
 $('lcpause').onclick=()=>{paused=!paused;$('lcpause').textContent=paused?'Resume':'Pause';syncStream();if(paused)render(true);else refresh(true)};
 $('lccopy').onclick=async()=>{if(historyMode.startsWith('boot:')&&vFile){const pos=$('lcvpos'),keep=pos.textContent;try{const t=await bootWholeFile(vFile,(a,b)=>{pos.textContent='Reading '+cnum(a)+' of '+cnum(b)+' lines\u2026'});pos.textContent=keep;await copyText(t,vFile+' ('+cnum(t.split('\n').length)+' lines)')}catch(e){pos.textContent=keep;createToast('Copy failed: '+e.message,'red')}return}const rv=maybeRedact($('lcout').innerText);const text=rv.text;try{await navigator.clipboard.writeText(text);createToast('Copied the visible log'+(rv.total?' (private data hidden in '+rv.total+' line(s))':''))}catch(e){const r=document.createRange();r.selectNodeContents($('lcout'));const sel=getSelection();sel.removeAllRanges();sel.addRange(r);askNotice('Automatic copy is not available over plain HTTP. The log is selected: use your browser Copy command.')}};
 $('lcdelete').onclick=async()=>{if(!historyMode||!(await askConfirm('Delete '+historyMode+' (.log and .txt) permanently?','Delete',true)))return;try{await api('/api/logs/delete',{method:'POST',body:JSON.stringify({name:historyMode})});historyMode='';lastKey='';$('lchistory').value='';$('lcdelete').disabled=true;await loadHistory();rows=[];lastId=0;await refresh()}catch(e){askNotice('Could not delete: '+e.message)}};

 /* ---- search across every saved session ---- */
 $('lcsearchall').onclick=async()=>{
  const q=$('lcsearch').value.trim(), level=$('lclevel').value, from=stamp($('lcfrom').value), until=stamp($('lcuntil').value);
  if(!q&&level==='ALL'&&!from&&!until){askNotice('Type a keyword or regex, pick a level, or set a time range to search all saved sessions.');return}
  $('lcout').textContent='Searching all saved sessions…';
  try{
   const p=new URLSearchParams({q,regex:$('lcregex').checked?'1':'0',level:level==='ALL'?'':level,from,until,limit:'500'});
   const d=await api('/api/logs/search?'+p.toString());
   if(d.error)throw new Error(d.error);
   searchMode=true; $('lcsearchclose').style.display=''; const hits=d.hits||[];
   $('lccount').textContent=hits.length+' match(es) in '+d.scanned+' session file(s)'+(d.truncated?' · more exist, narrow the search':'');
   $('lcout').innerHTML=hits.length?hits.map(h=>`<span class="lcl lchit" data-session="${esc(h.session)}"><b>${esc(h.session)}</b> #${h.line}  ${esc(h.text)}</span>`).join('\n')+'\n\nTap a result to open that session.':'No matches in saved sessions';
  }catch(e){searchMode=false;$('lcsearchclose').style.display='none';$('lcout').textContent='Search failed: '+e.message}
 };
 $('lcsearchclose').onclick=()=>{searchMode=false;$('lcsearchclose').style.display='none';lastKey='';render(true)};

 /* ---- jump between errors; tap a line to bookmark ---- */
 function jumpErr(dir){
  const els=[...$('lcout').querySelectorAll('.lcerr')];
  if(!els.length){try{createToast('No errors in the current view')}catch(e){}return}
  $('lcout').querySelectorAll('.lccur').forEach(n=>n.classList.remove('lccur'));
  errIdx=(errIdx<0||errIdx>=els.length)?(dir>0?0:els.length-1):(errIdx+dir+els.length)%els.length;
  const el=els[errIdx]; el.classList.add('lccur'); el.scrollIntoView({block:'center'}); $('lcerrpos').textContent=(errIdx+1)+' / '+els.length;
 }
 $('lcerrprev').onclick=()=>jumpErr(-1); $('lcerrnext').onclick=()=>jumpErr(1);
 async function openSession(name){
  $('lchistory').value=name; if($('lchistory').value!==name){await loadHistory();$('lchistory').value=name}
  await $('lchistory').onchange();
 }
 $('lcout').addEventListener('click',e=>{
  clearAlerts();
  const t=e.target.closest&&e.target.closest('.lcl'); if(!t)return;
  if(t.dataset.session){openSession(t.dataset.session);return}
  if(String(getSelection()))return;
  const x=shown[+t.dataset.i]; if(!x)return;
  const k=keyOf(x); if(bookmarks.has(k))bookmarks.delete(k);else bookmarks.add(k); saveBM(); render(true);
 });

 /* ---- history ---- */
 const cnum=n=>Number(n||0).toLocaleString();
 async function loadHistory(){try{const d=await api('/api/logs/sessions');const sel=$('lchistory');const old=sel.value;
  const ss=(d.sessions||[]).slice().sort((a,b)=>(b.modified||0)-(a.modified||0));
  let html='<option value="">Current session / recent</option>'+(ss.length?'<optgroup label="App sessions (newest first)">'+ss.map(x=>`<option value="${esc(x.name)}">${esc(x.name)}</option>`).join('')+'</optgroup>':'');
  /* Boot capture files join the same list (needs root, so only asked for when the owner switched boot capture on). */
  if(d.bootEnabled){try{const b=await api('/api/logs/boot/files');const fl=(b.files||[]);
   if(fl.length)html+=bootOptions(fl,'boot:','Boot capture \u00b7 ')}catch(e){}}
  sel.innerHTML=html;if(old)sel.value=old;}catch(e){}}
 /* ---- per-source counters (in-app capture) and line counts (boot capture) ---- */
 async function loadCounters(){try{const d=await api('/api/logs/status');const c=d.counters||{};
  const line=(k)=>k+': seen '+cnum(c[k].seen)+' · shown '+cnum(c[k].passed)+' · collapsed '+cnum(c[k].collapsed)+' · dropped '+cnum(c[k].dropped)+' · gaps '+cnum(c[k].gaps);
  const parts=['app','device','kernel'].filter(k=>c[k]&&(c[k].seen>0||c[k].gaps>0)).map(line);
  if(!parts.length)parts.push('No lines counted yet in this session.');
  const extra=[];if(c.queueDropped>0)extra.push(cnum(c.queueDropped)+' lines refused by a full write queue');if(c.swallowedErrors>0)extra.push(cnum(c.swallowedErrors)+' internal errors (see quiet_* entries)');
  $('lccounters').textContent=parts.join('\n')+(extra.length?'\n'+extra.join(' · '):'')}catch(e){}}
 async function loadBootCounters(){$('lccounters').textContent='Counting boot capture lines\u2026';try{const d=await api('/api/logs/boot/counters');
  $('lccounters').textContent='boot capture (nothing filtered or collapsed): logcat '+cnum(d.logcatLines)+' lines ('+cnum(d.logcatErrors)+' errors, '+cnum(d.logcatWarnings)+' warnings) · kernel '+cnum(d.dmesgLines)+' lines · gaps '+cnum(d.gaps)}catch(e){$('lccounters').textContent=''}}
 /* ---- boot capture files in the main viewer: paged, with the original time, PID, thread, level and tag ---- */
 const VIEW_PAGE=300; let vFile='',vStart=1,vTotal=0;
 const bootEntries=(d,file)=>(d.rows||[]).map((r,i)=>({id:d.start+i,timestamp:r.t||'',level:r.lv||'INFO',function:r.tag||'boot',message:r.msg||'',pid:r.pid,tid:r.tid,source:/^dmesg/.test(file)?'kernel':'device'}));
 async function viewBoot(file,start,from){vFile=file;
  const q='/api/logs/boot/read?file='+encodeURIComponent(file)+'&start='+Math.max(1,start|0)+'&limit='+VIEW_PAGE+(from?'&from='+encodeURIComponent(from):'');
  const d=await api(q);vStart=d.start;vTotal=d.total;rows=bootEntries(d,file);lastKey='';render(true);
  $('lcvpos').textContent='Lines '+cnum(d.start)+'-'+cnum(d.end)+' of '+cnum(d.total);$('lcout').scrollTop=0;return d}
 async function viewBootLatest(file){try{const d=await viewBoot(file,1);if(d.total>VIEW_PAGE)await viewBoot(file,d.total-VIEW_PAGE+1);$('lcout').scrollTop=$('lcout').scrollHeight;loadBootCounters()}catch(e){$('lcout').textContent='Unable to read '+file+': '+e.message}}
 const viewGuard=fn=>async()=>{if(!vFile)return;try{await fn()}catch(e){$('lcout').textContent='Unable to read: '+e.message}};
 $('lcvprev').onclick=viewGuard(()=>viewBoot(vFile,Math.max(1,vStart-VIEW_PAGE)));
 $('lcvnext').onclick=viewGuard(()=>{if(vStart+VIEW_PAGE<=vTotal)return viewBoot(vFile,vStart+VIEW_PAGE)});
 $('lcvlast').onclick=viewGuard(()=>viewBoot(vFile,Math.max(1,vTotal-VIEW_PAGE+1)));
 $('lcvgo').onclick=viewGuard(()=>{const v=$('lcvjump').value.trim();if(v)return viewBoot(vFile,1,v)});
 $('lchistory').onchange=async()=>{searchMode=false;$('lcsearchclose').style.display='none';historyMode=$('lchistory').value;lastKey='';const isBoot=historyMode.startsWith('boot:');$('lcbootnav').style.display=isBoot?'flex':'none';$('lcdelete').disabled=!historyMode||isBoot;syncStream();if(isBoot){await viewBootLatest(historyMode.slice(5));return}$('lccounters').textContent='';if(!historyMode){rows=[];lastId=0;await refresh();loadCounters();return}try{const d=await api('/api/logs/session/'+encodeURIComponent(historyMode));rows=(d.lines||[]).map((line,i)=>{const m=line.match(/^(.*?) \[(.*?)\] \[(.*?)\] (.*)$/);return m?{id:i,timestamp:m[1],level:m[2],function:m[3],message:m[4]}:{id:i,timestamp:'',level:'INFO',function:'Session',message:line}});render(true)}catch(e){$('lcout').textContent='Unable to read session: '+e.message}};

 /* ---- device-wide capture (root) ---- */
 async function loadDevice(){try{const d=await api('/api/logs/device');$('lcdevlogcat').checked=!!d.logcat;$('lcdevdmesg').checked=!!d.dmesg;$('lcdevlevel').value=d.level||'W';$('lcdevkeepall').checked=!!d.keepAll;$('lcdevstate').textContent=d.active?'Running: capturing the whole device while this session logs.':(d.logcat||d.dmesg)?'Enabled: starts with the next logging session.':'Off. Captures every process on the device while a session is logging; needs root.'}catch(e){}}
 $('lcdevapply').onclick=async()=>{try{await api('/api/logs/device',{method:'POST',body:JSON.stringify({logcat:$('lcdevlogcat').checked,dmesg:$('lcdevdmesg').checked,level:$('lcdevlevel').value,keepAll:$('lcdevkeepall').checked})});createToast('Device capture settings saved');await loadDevice()}catch(e){askNotice('Could not save device capture: '+e.message)}};


 /* ---- boot files: grouped and sorted the same way in every dropdown ---- */
 const BOOT_MAXPAGE=500;
 const bootKind=n=>/^logcat\.log/.test(n)?0:/^dmesg\.log/.test(n)?1:2;
 const bootRot=n=>{const m=n.match(/\.(\d+)$/);return /^(logcat|dmesg)\.log\./.test(n)&&m?+m[1]:0};
 const bootInfo={'context.txt':'device info at boot','events.log':'script events','status':'live status','logcat.gaps':'capture gaps','magisk.log':'Magisk log (copy)','modules.txt':'Magisk modules','app_shell_audit.log':'app shell audit (copy)','updater.log':'updater log (copy)','app_events.log':'app boot tasks log (copy)'};
 const bootShort=t=>(t||'').replace(/^\d{4}-/,'').slice(0,11);
 const bootSort=a=>a.slice().sort((x,y)=>bootKind(x.name)-bootKind(y.name)||(bootKind(x.name)===2?bootInfoOrder(x.name)-bootInfoOrder(y.name):bootRot(x.name)-bootRot(y.name)));
 const bootInfoOrder=n=>{const i=Object.keys(bootInfo).indexOf(n);return i<0?9:i};
 const bootSize=b=>b>=1048576?(b/1048576).toFixed(1)+' MB':Math.max(1,Math.round(b/1024))+' KB';
 const bootLabel=f=>{const k=bootKind(f.name),r=bootRot(f.name);const tag=k===2?(bootInfo[f.name]||''):(r===0?'current':'older #'+r);return f.name+(tag?' \u2014 '+tag:'')+' \u00b7 '+bootSize(f.size)+(f.modified?' \u00b7 '+bootShort(f.modified):'')};
 const bootGroups=['Logcat (all buffers, newest first)','Kernel (dmesg, newest first)','Info and events'];
 function bootOptions(files,prefix,pre){pre=pre||'';const out=[];[0,1,2].forEach(k=>{const g=bootSort(files.filter(f=>bootKind(f.name)===k));if(g.length)out.push('<optgroup label="'+pre+bootGroups[k]+'">'+g.map(f=>'<option value="'+prefix+esc(f.name)+'">'+esc(bootLabel(f))+'</option>').join('')+'</optgroup>')});return out.join('')}
 async function copyText(text,what){const r=maybeRedact(text);text=r.text;if(r.total)what+=' (private data hidden in '+r.total+' line(s))';try{await navigator.clipboard.writeText(text);createToast('Copied '+what)}catch(e){const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();let ok=false;try{ok=document.execCommand('copy')}catch(_){}ta.remove();if(ok)createToast('Copied '+what);else askNotice('Automatic copy is not available here. Select the text and use your browser Copy command.')}}
 async function bootWholeFile(file,progress){let start=1,total=1,parts=[];while(start<=total){const d=await api('/api/logs/boot/read?file='+encodeURIComponent(file)+'&start='+start+'&limit='+BOOT_MAXPAGE);total=d.total;parts.push((d.lines||[]).join('\n'));start=d.end+1;if(!(d.lines||[]).length)break;if(progress)progress(Math.min(start-1,total),total)}return parts.join('\n')}
 /* ---- boot capture (Magisk script) ---- */
 const BOOT_PAGE=300; let bootStart=1,bootTotal=0,bootFiles=[];
 const bootNum=(n)=>Number(n||0).toLocaleString();
 async function loadBoot(){try{const d=await api('/api/logs/boot/status');
  $('lcbootkb').value=d.fileKb;$('lcbootn').value=d.files;$('lcbootfree').value=d.minFreeMb;$('lcbootdays').value=d.retainDays||0;
  let t;if(!d.installed)t='Not installed. Install it to capture logcat (all buffers) and the kernel log from boot, even when this app is stopped.';
  else{t=(d.running?'Running':'Installed but NOT running')+(d.state&&d.state!=='running'?' ('+d.state+')':'')+'. Script v'+d.installedVersion+(d.outdated?' (outdated: press Update script to get v'+d.bundledVersion+')':'')+'. Disk use '+bootNum(d.usedKb)+' KB of at most '+bootNum(d.maxTotalKb)+' KB; '+(d.freeMb==null?'':bootNum(d.freeMb)+' MB free; ')+'restarts: logcat '+d.logcatRestarts+', kernel '+d.dmesgRestarts+(d.lastRestart&&d.lastRestart!=='-'?' (last '+d.lastRestart+')':'')+'. Heartbeat '+(d.heartbeat||'none')+'.'}
  $('lcbootstate').textContent=t;
  const bi=$('lcbootinstall'),bh=$('lcbootbtnhint'),br=$('lcbootremove');
  if(!d.installed){bi.textContent='Turn on boot capture';bh.textContent='Installs the script and starts recording now. It also starts by itself at every boot.';br.disabled=true}
  else if(d.outdated){bi.textContent='Update script to v'+d.bundledVersion;bh.textContent='A newer script came with this app. Press to replace the old one (the captured files are kept).';br.disabled=false}
  else{bi.textContent='Save settings';bh.textContent='Boot capture is on and up to date. Change the numbers above and press this to apply them (it restarts the recording for a moment).';br.disabled=false}
  br.textContent='Turn off';
  await loadBootFiles()}catch(e){$('lcbootstate').textContent='Could not read boot capture: '+e.message}}
 async function loadBootFiles(){const d=await api('/api/logs/boot/files');bootFiles=d.files||[];const sel=$('lcbootfile');const old=sel.value;sel.innerHTML=bootOptions(bootFiles,'');if(old&&bootFiles.some(f=>f.name===old))sel.value=old}
 async function bootRead(start,from){const f=$('lcbootfile').value;if(!f){$('lcbootout').textContent='No capture files yet.';return}
  try{const q='/api/logs/boot/read?file='+encodeURIComponent(f)+'&start='+Math.max(1,start|0)+'&limit='+BOOT_PAGE+(from?'&from='+encodeURIComponent(from):'');const d=await api(q);
   bootStart=d.start;bootTotal=d.total;$('lcbootout').textContent=(d.lines||[]).join('\n')||'(empty)';
   $('lcbootpos').textContent='Lines '+bootNum(d.start)+'-'+bootNum(d.end)+' of '+bootNum(d.total);$('lcbootout').scrollTop=0}catch(e){$('lcbootout').textContent='Unable to read: '+e.message}}
 $('lcboot').addEventListener('toggle',()=>{if($('lcboot').open)loadBoot()});
 $('lcbootfile').onchange=()=>bootRead(1);
 $('lcbootprev').onclick=()=>bootRead(Math.max(1,bootStart-BOOT_PAGE));
 $('lcbootnext').onclick=()=>{if(bootStart+BOOT_PAGE<=bootTotal)bootRead(bootStart+BOOT_PAGE)};
 $('lcbootlast').onclick=()=>bootRead(Math.max(1,bootTotal-BOOT_PAGE+1));
 $('lcbootgo').onclick=()=>{const v=$('lcbootjump').value.trim();if(v)bootRead(1,v)};
 $('lcbootcopy').onclick=async()=>{const f=$('lcbootfile').value;if(!f){createToast('No file selected');return}
  if(!$('lcbootcopyall').checked){await copyText($('lcbootout').textContent,'this page');return}
  const pos=$('lcbootpos'),keep=pos.textContent;try{const t=await bootWholeFile(f,(a,b)=>{pos.textContent='Reading '+bootNum(a)+' of '+bootNum(b)+' lines\u2026'});pos.textContent=keep;await copyText(t,f+' ('+bootNum(t.split('\n').length)+' lines)')}catch(e){pos.textContent=keep;askNotice('Copy failed: '+e.message)}};
 $('lcvcopyall').onclick=async()=>{if(!vFile)return;const pos=$('lcvpos'),keep=pos.textContent;try{const t=await bootWholeFile(vFile,(a,b)=>{pos.textContent='Reading '+cnum(a)+' of '+cnum(b)+' lines\u2026'});pos.textContent=keep;await copyText(t,vFile+' ('+cnum(t.split('\n').length)+' lines)')}catch(e){pos.textContent=keep;askNotice('Copy failed: '+e.message)}};
 $('lcbootinstall').onclick=async()=>{$('lcbootstate').textContent='Working (about 10 s, includes a test that a test line reaches the log)\u2026';try{const d=await api('/api/logs/boot/install',{method:'POST',body:JSON.stringify({fileKb:+$('lcbootkb').value||2048,files:+$('lcbootn').value||10,minFreeMb:+$('lcbootfree').value||200,retainDays:Math.max(0,+$('lcbootdays').value||0)})});createToast(d.selftest?'Boot capture is on; self-test passed':'Boot capture is on; self-test not confirmed yet');await loadBoot()}catch(e){askNotice('Could not turn on boot capture: '+e.message);loadBoot()}};
 $('lcbootremove').onclick=async()=>{const purge=$('lcbootpurge').checked;if(!(await askConfirm(purge?'Turn off boot capture AND delete all captured files?':'Turn off boot capture? (captured files are kept)','Continue')))return;try{await api('/api/logs/boot/uninstall',{method:'POST',body:JSON.stringify({purge})});createToast('Boot capture turned off');await loadBoot()}catch(e){askNotice('Could not turn off boot capture: '+e.message)}};

 setInterval(()=>{if(panelOpen()&&!document.hidden&&!historyMode)loadCounters()},5000);
 const priorOpen=window.openPop; window.openPop=function(id){priorOpen(id);if(id==='logcatcher'){streamFails=0;loadHistory();loadDevice();refresh();syncStream();loadCounters();}};
 // Poll only while the panel is visible; never overlap requests or waste router CPU in the background.
 refreshTimer=setInterval(()=>{if(!historyMode && !document.hidden && $('logcatcher')?.classList.contains('open'))refresh()},3000);
 setInterval(()=>{if(panelOpen()||alertsOn()||stream)syncStream()},2000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){clearAlerts();if($('logcatcher')?.classList.contains('open'))refresh()}syncStream()});
})();
