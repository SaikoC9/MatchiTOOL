/* Delete dialog, process sweep (Phase 2 / Step 6). Pure text and decision helpers for the "Delete plugin" dialog; the dialog itself stays in the delete handler.
   The host (/api/plugins/data) sends "sweep": {rootOk, candidates:[{pid,start,how,args}], notStopped, notes, found, overCap, complete, sweepHash}.
   Rules the page keeps:
   - What is listed is what is ended: the page sends back the sweepHash it was shown whenever it sends stop:true (the host scans again and answers 409
     "plan-changed" when the list is different).
   - "Delete without stopping" sends no sweepHash and the host never scans for it.
   - No list is ever guessed: when the check did not run, the dialog says so and lists nothing. */
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
/* plain = nothing to stop (as before); sweep = no declared commands, but running processes were found; stop / shared / cannot = Phase 1;
   toomany = more than 50 processes found, the host refuses to end them automatically. A refused declared command wins over everything. */
function pluginDeleteMode(sp,sw){
  const cmds=(sp&&sp.commands)||[],refused=(sp&&sp.refused)||[],shared=(sp&&sp.shared)||[];
  if(refused.length)return 'cannot';
  if(sw&&sw.overCap)return 'toomany';
  if(!cmds.length)return sw&&sw.cands.length?'sweep':'plain';
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
  }else if(mode==='plain'){
    m+='\n\nNo running process was found for it.';
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
/* Fields added to the delete request. Only a request that stops (not "Delete without stopping") carries the hash. */
function sweepRequestFields(sw,stop){return stop?{sweepHash:(sw&&sw.hash)||''}:{}}
if(typeof module!=='undefined'&&module.exports)module.exports={sweepNorm,sweepHowText,sweepProcLine,pluginDeleteMode,sweepDialogText,sweepRetryText,sweepRequestFields};
