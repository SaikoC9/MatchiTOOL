/* Delete dialog, process sweep. Pure text and decision helpers for the "Delete plugin" dialog; the dialog itself stays in the delete handler.
   The host (/api/plugins/data) sends "sweep": {rootOk, candidates:[{pid,start,how,args}], notStopped, notes, found, overCap, complete, sweepHash}.
   Rules the page keeps:
   - What is listed is what is ended: the page sends back the sweepHash it was shown whenever it sends stop:true (the host scans again and answers 409
     "plan-changed" when the list is different).
   - "Delete without stopping" sends no sweepHash and the host never scans for it.
   - No list is ever guessed: when the check did not run, the dialog says so and lists nothing.
   The stop hook of a SANDBOXED plugin: the page runs the hook before the request (sbxHookRun, 15 s). The hook's answer is never
   believed. A hook that fails or times out keeps the plugin (the request is not sent). After a hook that finished, the page scans again (hookAfterScan):
   the scan must have run completely, and may only show processes that were listed before. Only then is the request sent, with the NEW sweepHash. */
function sweepNorm(info){
  const s=(info&&info.sweep)||{};
  return{
    checked:s.rootOk===true,
    cands:Array.isArray(s.candidates)?s.candidates.filter(c=>c&&Number.isFinite(Number(c.pid))):[],
    notStopped:Array.isArray(s.notStopped)?s.notStopped.map(String):[],
    notes:Array.isArray(s.notes)?s.notes.map(String):[],
    found:Number(s.found)||0,
    overCap:s.overCap===true,
    complete:s.complete!==false,
    hash:typeof s.sweepHash==='string'?s.sweepHash:''
  };
}
function sweepHowText(how){return how==='tag'?'found by tag':how==='pidfile'?'found by its pid file':how==='cmdline'?'found by command line, weakest match':'found'}
function sweepProcLine(c){return 'PID '+c.pid+(c.args?' '+c.args:'')+' ('+sweepHowText(c.how)+')'}
/* plain = nothing to stop (as before); hook = nothing declared and nothing found, but a sandboxed plugin registered a stop hook; sweep = no declared commands, but running processes were found; stop / shared / cannot = the plugin declared its own stop commands (see docs/PLUGIN_STOP.md);
   toomany = more than 50 processes found, the host refuses to end them automatically.
   [un] (plugin-undo-ui.js undoNorm) with items also makes a headerless plugin "sweep" (the stop runs the undo even when nothing is running). A refused declared command wins over everything. */
function pluginDeleteMode(sp,sw,hasHook,un){
  const cmds=(sp&&sp.commands)||[],refused=(sp&&sp.refused)||[],shared=(sp&&sp.shared)||[];
  if(refused.length)return 'cannot';
  if(sw&&sw.overCap)return 'toomany';
  if(!cmds.length)return (sw&&sw.cands.length)||(un&&un.items&&un.items.length)?'sweep':hasHook?'hook':'plain';
  return shared.length?'shared':'stop';
}
/* The text the sweep adds to the delete dialog. [noRoot]: the data probe already said root is missing (its own sentence covers it, so it is not repeated). */
function sweepDialogText(sw,mode,noRoot){
  const bullets=a=>a.map(x=>'\n\u2022 '+x).join('');
  let m='';
  if(!sw.checked){
    if(!noRoot){
      const why=(sw.notes[0]||'').replace(/^cannot be checked:\s*/,'');
      m+='\n\nIt could not be checked whether anything it started is still running'+(why?' ('+why+')':'')+'. Nothing will be listed or ended by a scan.';
    }
    return m;
  }
  const lines=sw.cands.map(sweepProcLine);
  if(mode==='toomany'){
    m+='\n\nMore than 50 running processes match what it started ('+sw.found+' found). That is too many to end automatically, so nothing will be stopped. The first ones:'+bullets(lines)+'\n\nStop them by hand, or delete without stopping.';
  }else if(lines.length){
    if(mode==='sweep')m+='\n\nThese processes are running now and match what this plugin started:'+bullets(lines)+'\n\nDeleting and stopping ends them as root, and everything they started. Forcefully, if they do not stop.';
    else if(mode==='cannot')m+='\n\nThese processes are running now and will keep running:'+bullets(lines);
    else if(mode==='shared')m+='\n\nThese processes are running now. If the stop runs, it also ends them and everything they started:'+bullets(lines);
    else m+='\n\nThen it ends these processes, which are running now, and everything they started:'+bullets(lines);
  }else if(mode==='plain'||mode==='hook'){
    m+=sw.notStopped.length?'\n\nNothing will be ended, because the processes found are used by another plugin too.':'\n\nNo running process was found for it.';
  }else if(mode==='stop'||mode==='shared'){
    m+='\n\nAfter the stop it scans for running processes it started and reports any that are left.';
  }
  if(sw.notStopped.length)m+='\n\nLeft running on purpose, because another plugin also uses their files:'+bullets(sw.notStopped);
  if(!sw.complete)m+='\n\nThe process list was cut short, so it may be incomplete.';
  if(sw.cands.length&&!sw.notStopped.length&&mode!=='cannot'&&mode!=='toomany')m+='\n\nProcesses that use files another plugin also uses are never ended.';
  return m;
}
/* The retry dialog after a failed stop: what is running right now and would be ended by "Try again". */
function sweepRetryText(sw){
  if(!sw.checked||!sw.cands.length)return '';
  return '\n\nRunning now, and ended if you try again (with everything they started):'+sw.cands.map(c=>'\n\u2022 '+sweepProcLine(c)).join('');
}
/* The dialog line for a stop hook. [granted] = what the person approved for the plugin, as sentences (sbxDescribe). Only where the stop will run. */
function hookDialogText(granted,mode){
  if(mode!=='stop'&&mode!=='sweep'&&mode!=='hook'&&mode!=='shared')return '';
  const g=(Array.isArray(granted)?granted:[]).map(String);
  let m=mode==='shared'?'\n\nIf the stop runs, it also runs its own stop code first':'\n\nIt also runs its own stop code first';
  m+=', inside its sandbox (15 s at most). That code can only do what you approved for this plugin'+(g.length?':'+g.map(x=>'\n\u2022 '+x).join(''):' (nothing beyond toasts and its own saved data)')+'.';
  m+='\nWhat it reports is not believed: a scan afterwards decides. If its code fails or does not finish, the plugin is kept.';
  return m;
}
/* True when every process of [after] was already listed in [before] (same PID, start time and command line). */
function sweepSubset(before,after){
  const key=c=>c.pid+'|'+c.start+'|'+c.args;
  const seen=new Set((before||[]).map(key));
  return (after||[]).every(c=>seen.has(key(c)));
}
/* After a hook that finished: may the request go on? {kind:'ok',sw} - yes, send sw's hash; {kind:'changed'} - something new runs, open the dialog again;
   {kind:'blind',message} - the scan could not show that the hook worked, keep the plugin. */
function hookAfterScan(before,after){
  if(!after.checked||!after.complete||after.overCap){
    const why=(after.notes[0]||'').replace(/^cannot be checked:\s*/,'');
    return{kind:'blind',message:'Its stop code ran, but the scan afterwards '+(!after.checked?'could not run'+(why?' ('+why+')':''):after.overCap?'found more than 50 processes':'was cut short')+', so nothing shows that it worked.'};
  }
  if(!sweepSubset(before.cands,after.cands))return{kind:'changed'};
  return{kind:'ok',sw:after};
}
/* The report the retry dialog shows when the hook itself did not finish (no request was sent, so nothing else ran). */
function hookFailureReport(h){
  const what=h.status==='timeout'?'did not finish in time ('+(h.error||'')+')':h.status==='dead'?'could not run ('+(h.error||'')+')':'failed'+(h.error?': '+h.error:'');
  return{log:'Its own stop code '+what+'.',leftovers:[],notChecked:['its declared stop commands and the process sweep were not run, because the plugin is kept']};
}
function hookBlindReport(message){return{log:message,leftovers:[],notChecked:['the host did not run its stop commands or end any process, because the plugin is kept']}}
/* Fields added to the delete request. Only a request that stops (not "Delete without stopping") carries the hash. */
function sweepRequestFields(sw,stop){return stop?{sweepHash:(sw&&sw.hash)||''}:{}}
/* What the host is told about the hook (for its audit line only; it never changes the outcome). Sent when a hook was tried in this dialog. */
function hookRequestFields(h){return h&&h.status&&h.status!=='none'?{hookRan:h.ran===true,hookStatus:String(h.status)}:{}}
if(typeof module!=='undefined'&&module.exports)module.exports={sweepNorm,sweepHowText,sweepProcLine,pluginDeleteMode,sweepDialogText,sweepRetryText,sweepRequestFields,hookDialogText,sweepSubset,hookAfterScan,hookFailureReport,hookBlindReport,hookRequestFields};
