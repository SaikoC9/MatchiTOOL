/* Log basket (step 2): one list of every log; tick rows, then View, Copy or Delete. No polling. */
(()=>{
const $=id=>document.getElementById(id);let rows=[];const TYPE={session:'Session',export:'Export',audit:'Audit (root commands)',boot:'Boot'};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtSize=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':n>=1024?Math.round(n/1024)+' KB':n+' B';
const fmtTime=r=>r.modified?new Date(r.modified).toLocaleString():(r.modifiedText||'');
const picked=()=>[...document.querySelectorAll('#lblist input[data-id]:checked')].map(c=>rows.find(r=>r.id===c.dataset.id)).filter(Boolean);
function render(){
 const box=$('lblist');
 if(!rows.length){box.innerHTML='<div class="mut">No logs yet. Press Live view, then Start logging.</div>';return}
 box.innerHTML=rows.map(r=>'<label class="row" style="gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid rgba(128,128,128,.25)"><input type="checkbox" data-id="'+esc(r.id)+'"><span style="flex:1;min-width:0"><b>'+esc(TYPE[r.type]||r.type)+'</b>'+(r.active?' <span class="mut">(logging now)</span>':'')+(r.rootOnly?' <span class="mut">(root)</span>':'')+'<br><span style="word-break:break-all;font-size:12px">'+esc(r.name)+'</span><br><span class="mut" style="font-size:11px">'+fmtSize(r.size)+' · '+esc(fmtTime(r))+'</span></span></label>').join('');
 $('lball').checked=false;
}
async function load(){
 $('lbinfo').textContent='Loading';
 try{const d=await api('/api/logs/basket');rows=d.rows||[];$('lbnote').textContent=d.bootNote||'';$('lbinfo').textContent=rows.length+' logs'+(d.running?' · logging':'');render()}
 catch(e){$('lbinfo').textContent='Could not load';$('lbnote').textContent=String(e.message||e)}
}
/* Text of one row. Boot files use their root route (500-line pages); the others use /api/logs/basket/read. */
async function textOf(r,full){
 if(r.type==='boot'){
  const f=encodeURIComponent(r.name),first=await api('/api/logs/boot/read?file='+f+'&start=1&limit=1'),total=first.total||0;
  if(!total)return{text:'',note:'empty'};
  const start=Math.max(1,total-499),d=await api('/api/logs/boot/read?file='+f+'&start='+start+'&limit=500');
  return{text:(d.lines||[]).join('\n'),errs:(d.rows||[]).map(x=>x.lv==='ERROR'),note:'last '+(d.lines||[]).length+' of '+total+' lines'+(full?' (boot files: 500-line limit here, use Log Catcher for more)':'')};
 }
 const d=await api('/api/logs/basket/read?id='+encodeURIComponent(r.id)+(full?'&full=1':''));
 return{text:(d.lines||[]).join('\n'),note:'last '+d.shown+' lines'+(d.truncated?' (older lines not included)':'')};
}
const hide=t=>{if(!$('lbredact').checked)return{text:t,n:0};if(!window.__lcRedact)throw new Error('hiding private data is not available, so nothing was shown or copied');const x=window.__lcRedact(t);return{text:x.text,n:x.total}};
let viewLines=[],viewErr=null,viewType='',chip='all';
/* Chips read the \"[LEVEL] [tag]\" part of a session line: Errors = [ERROR], Plugins = a plugin/... tag, Root shell = plugin/shell.
   Audit rows: every line is a root command, so Root shell keeps them all. Boot rows: raw logcat, so Errors uses the level the server parsed (viewErr). */
const CHIP={all:()=>true,errors:(l,i)=>viewErr?!!viewErr[i]:l.indexOf('[ERROR]')>=0,plugins:l=>l.indexOf('[plugin/')>=0,shell:l=>viewType==='audit'?l.trim()!=='':l.indexOf('[plugin/shell]')>=0};
function chipNote(){
 if(viewType==='boot'&&(chip==='plugins'||chip==='shell'))return ' · plugin tags exist only in session logs';
 if(viewType==='audit'&&(chip==='errors'||chip==='plugins'))return ' · the audit log has no levels or plugin tags; every line is a root command';
 return '';
}
function setChip(c){chip=CHIP[c]?c:'all';for(const b of document.querySelectorAll('#lbchips button'))b.classList.toggle('on',b.dataset.chip===chip);if(viewLines.length)paint()}
for(const b of document.querySelectorAll('#lbchips button'))b.onclick=()=>setChip(b.dataset.chip);
function paint(){const q=($('lbsearch').value||'').toLowerCase(),o=$('lbout'),base=viewLines.filter((l,i)=>CHIP[chip](l,i)),out=q?base.filter(l=>l.toLowerCase().includes(q)):base;o.textContent=out.length?out.join('\n'):(viewLines.length?'No line matches.':'(empty)');$('lbmatch').textContent=((q||chip!=='all')?out.length+' of '+viewLines.length+' lines match':'')+chipNote();o.scrollTop=o.scrollHeight}
$('lbsearch').oninput=paint;
$('lbview').onclick=async()=>{
 const p=picked();if(p.length!==1){createToast(p.length?'Pick one row to view':'Pick a row first','orange');return}
 const r=p[0];$('lbviewtitle').textContent='Loading '+r.name;$('lbviewtools').style.display='block';
 try{const t=await textOf(r,$('lbfull').checked),x=hide(t.text),o=$('lbout');viewLines=x.text?x.text.split('\n'):[];viewType=r.type;viewErr=(t.errs&&t.errs.length===viewLines.length)?t.errs:null;$('lbsearch').value='';$('lbsearch').style.display='block';o.style.display='block';paint();$('lbviewtitle').textContent=r.name+' · '+t.note+(x.n?' · private data hidden in '+x.n+' line(s)':'')}
 catch(e){$('lbviewtitle').textContent='';createToast('Could not read '+r.name+': '+(e.message||e),'red')}
};
async function clip(text){try{await navigator.clipboard.writeText(text);return true}catch(_){const ta=document.createElement('textarea');ta.value=text;ta.style.cssText='position:fixed;opacity:0';document.body.appendChild(ta);ta.select();let ok=false;try{ok=document.execCommand('copy')}catch(__){}ta.remove();return ok}}
$('lbcopy').onclick=async()=>{
 const p=picked();if(!p.length){createToast('Pick a row first','orange');return}
 const parts=[];let hidden=0,failed=0;
 for(const r of p){try{const t=await textOf(r,$('lbfull').checked),x=hide(t.text);hidden+=x.n;parts.push((p.length>1?'===== '+r.name+' ('+t.note+') =====\n':'')+x.text)}catch(e){failed++}}
 if(!parts.length){createToast('Could not read the selected logs','red');return}
 const ok=await clip(parts.join('\n\n'));
 createToast(ok?'Copied '+parts.length+' log(s)'+(hidden?' (private data hidden in '+hidden+' line(s))':'')+(failed?', '+failed+' failed':''):'Automatic copy is not available here. Use View, then select the text.',ok?'':'red');
};
$('lbdelete').onclick=async()=>{
 const p=picked();if(!p.length){createToast('Pick a row first','orange');return}
 const ok=p.filter(r=>r.canDelete),skip=p.length-ok.length;
 if(!ok.length){createToast('These cannot be deleted here (the active session and the live boot files are kept)','orange');return}
 const au=ok.some(r=>r.type==='audit');if(!(await askConfirm('Delete '+ok.length+' log(s) permanently?'+(au?'\n\nThe audit log records which device ran root commands. After deleting it, a new line notes that it was cleared. Needs a root sign-in.':'')+(ok.some(r=>r.type==='boot')?'\n\nBoot capture files are removed with a root command and need a root sign-in.':'')+(skip?'\n'+skip+' selected row(s) cannot be deleted here and will stay.':''),'Delete',true)))return;
 try{const d=await api('/api/logs/basket/delete',{method:'POST',body:JSON.stringify({ids:ok.map(r=>r.id)})});const rs=d.results||[],n=rs.filter(x=>x.ok).length,why=(rs.find(x=>!x.ok&&x.reason)||{}).reason;createToast('Deleted '+n+' of '+ok.length+(why?' ('+why+')':''),n===ok.length?'':'orange');$('lbout').style.display='none';$('lbviewtitle').textContent='';$('lbviewtools').style.display='none'}
 catch(e){createToast('Delete failed: '+(e.message||e),'red')}
 load();
};
$('lball').onchange=()=>{for(const c of document.querySelectorAll('#lblist input[data-id]'))c.checked=$('lball').checked};
$('lbrefresh').onclick=load;
async function snap(label){
 try{const d=await api('/api/logs/snapshot',{method:'POST',body:JSON.stringify({label})});createToast('Snapshot saved: '+d.name+' ('+d.lines+' lines)')}
 catch(e){createToast('Snapshot failed: '+(e.message||e),'red')}
 load();
}
$('lbsnapb').onclick=()=>snap('before');
$('lbsnapa').onclick=()=>snap('after');
window.lbOpen=load;
})();
