/* "Turn off and stop". Switching a plugin OFF can also stop what it started and undo what it left in the system, WITHOUT deleting it or its data.
   It is the same host stop as Delete: POST /api/plugins/delete with stop:true and keep:true (no erase). The host runs declared commands, the process sweep and the undo,
   re-checks, and only when everything is clean switches the plugin off. A stop that does not finish keeps the plugin ON and answers {ok:false,kept:true,stop:{...}}.
   Rules the page keeps (same as Delete):
   - What is listed is what runs: sweepHash, undoHash and planHash from the dialog go with the request; the host answers 409 when any differs and the dialog opens again.
   - A plugin with nothing to stop (mode "plain") is switched off at once, with no dialog, as before.
   - "Turn off only" and every "without stopping" button switch the plugin off with the old toggle request, so a missing root or a failing stop never makes it impossible to turn a plugin off.
   - The stop hook of a sandboxed plugin is NOT run here: the hook is the plugin's uninstall code, and the plugin is not being uninstalled. */
function disableDialog(name,sp,sw,un,mode,noRoot){
  const cmds=(sp&&sp.commands)||[],refused=(sp&&sp.refused)||[],shared=(sp&&sp.shared)||[];
  const swT=sweepDialogText(sw,mode,noRoot),unT=undoDialogText(un,mode,noRoot);
  const mayRun=cmds.length>0&&mode!=='sweep'&&mode!=='toomany'&&mode!=='cannot';
  let msg='Turn off '+name+'? '+(mayRun?'File stays. Data stays unless the stop commands remove it.':'Its file and its data stay.'),okText='Turn off and stop',extra=[{text:'Turn off only',value:'skip'}];
  if(mode==='sweep')msg+='\n\nNo stop commands declared.'+swT+unT;
  else if(mode==='toomany'){msg+=swT+unT;okText='Turn off without stopping';extra=[]}
  else if(mode==='cannot'){
    msg+='\n\nStop can\'t run. Its processes keep running:\n'+refused.map(r=>'\u2022 '+r.command+' ('+r.reason+')').join('\n')+swT+unT;
    okText='Turn off without stopping';extra=[];
  }else{
    msg+='\n\nTurning off also stops its processes via uninstall commands, run as root:\n'+cmds.map(c=>'\u2022 '+c).join('\n')+swT+unT;
    if(sp&&sp.check)msg+='\n\nThen it checks with:\n\u2022 '+sp.check;
    if(mode==='shared'){msg+='\n\nWarning: '+shared.join(', ')+' shares a stop command or boot file with another plugin. Stop skipped to avoid breaking '+(shared.length>1?'them':'it')+'.';okText='Turn off, skip the stop';extra=[{text:'Turn off and stop anyway',value:'stop'}]}
  }
  return{title:'Turn off',message:msg,okText,extra};
}
/* Does this answer run the stop? [choice] is what the dialog returned. */
function disableWantsStop(mode,choice,failure){
  if(failure)return choice===true;
  return choice==='stop'||(choice===true&&(mode==='stop'||mode==='sweep'||mode==='hook'));
}
/* The dialog after a stop that did not finish (the plugin is still ON). */
function disableFailureDialog(name,failure,sw,un){
  let msg='Not turned off: '+name+'. Its processes could not be fully stopped.';
  if(failure.log)msg+='\n\n'+failure.log;
  const left=failure.leftovers||[],nc=failure.notChecked||[];
  if(left.length)msg+='\n\nStill there:\n'+left.map(x=>'\u2022 '+x).join('\n');
  if(nc.length)msg+='\n\nNot checked:\n'+nc.map(x=>'\u2022 '+x).join('\n');
  msg+=sweepRetryText(sw)+undoRetryText(un);
  const extra=[{text:'Turn off without stopping',value:'skip',danger:true}];
  if(left.length&&!leftHasBoot(left)){msg+='\n\nRestarting the device clears processes and firewall rules.';extra.unshift({text:'Restart device',value:'reboot'})}
  return{title:'Stop did not finish',message:msg,okText:'Try again',extra};
}
function disableRequestBody(name,sp,sw,un){
  return Object.assign({name,stop:true,keep:true,planHash:(sp&&sp.planHash)||''},sweepRequestFields(sw,true),undoRequestFields(un,true));
}
function disableToast(name,r,un){
  const stopped=!!(r&&r.stop&&r.stop.success===true);
  return 'Turned off '+name+(stopped?', and stopped what it started'+undoToastText(un,true):'');
}
if(typeof module!=='undefined'&&module.exports)module.exports={disableDialog,disableWantsStop,disableFailureDialog,disableRequestBody,disableToast};
