/* Delete dialog, what the plugin left in the system. Pure text and decision helpers; the dialog itself stays in the delete handler.
   The host (/api/plugins/data) sends "undo": {items:[{kind,label}], notUndone:[...], hash}. The items are firewall chains and boot scripts the host SAW the
   plugin create (ledger), after its shared-use guard. Rules the page keeps:
   - What is listed is what is undone: the page sends back the undo hash it was shown whenever it sends stop:true (even "" when nothing is listed); the host
     answers 409 "plan-changed" when the list is different now. "Delete without stopping" sends no undoHash and the host never undoes anything for it.
   - The list comes from the ledger and does not check that the chain or file still exists, so the dialog says "if it is still there".
   - Items are listed even when the stop will not run (blocked, too many processes): then the dialog says plainly that they are NOT undone.
   - Nothing is called "undone" by the page: the host's report decides (undo script answered clean AND an independent re-check found nothing). */
function undoNorm(info){
  const u=(info&&info.undo)||{};
  return{
    items:Array.isArray(u.items)?u.items.filter(i=>i&&typeof i.label==='string'&&i.label).map(i=>({kind:String(i.kind||''),label:i.label})):[],
    notUndone:Array.isArray(u.notUndone)?u.notUndone.map(String):[],
    hash:typeof u.hash==='string'?u.hash:''
  };
}
/* True when the delete modes below run the stop, and with it the undo. 'shared' only runs it when the person picks "Delete and stop anyway". */
function undoModeRuns(mode){return mode==='stop'||mode==='sweep'||mode==='hook'}
/* The text the undo adds to the delete dialog. [noRoot]: the data probe said root is missing. */
function undoDialogText(un,mode,noRoot){
  const bullets=a=>a.map(x=>'\n\u2022 '+x).join('');
  let m='';
  if(un.items.length){
    const lines=un.items.map(i=>i.label);
    if(mode==='stop'||mode==='sweep'||mode==='hook')m+='\n\nThen it also removes what this plugin left in the system, if it is still there (run as root):'+bullets(lines);
    else if(mode==='shared')m+='\n\nIf the stop runs, it also removes what this plugin left in the system, if it is still there:'+bullets(lines);
    else m+='\n\nThe stop does not run, so these stay in the system:'+bullets(lines);
    if(undoModeRuns(mode)||mode==='shared'){
      m+='\n\nOnly firewall chains and boot scripts that this plugin\'s own commands created are listed. Each is checked again afterwards; if one is still there, the plugin is kept.';
      if(noRoot)m+='\n\nNo root. Nothing can run. Plugin is kept.';
    }
  }
  if(un.notUndone.length)m+='\n\nNot undone:'+bullets(un.notUndone);
  return m;
}
/* The retry dialog after a failed stop: what Try again would undo (the host's own report of what is still there is shown above it). */
function undoRetryText(un){
  if(!un.items.length)return '';
  return '\n\nTry again would also remove, if still there:'+un.items.map(i=>'\n\u2022 '+i.label).join('');
}
/* The "changed things deleting cannot undo" sentence. When the undo runs, what it lists is not "cannot undo" any more. */
function undoEffectsText(fx,undoRuns){
  const f=(Array.isArray(fx)?fx:[]).map(String);
  if(!f.length)return '';
  if(undoRuns)return '\n\nIt also changed: '+f.join(', ')+'. Only the items listed above are undone; the rest stays until a reboot or until you clean it by hand.';
  return '\n\nIt also changed things that deleting cannot undo: '+f.join(', ')+'. A reboot clears firewall rules, properties and background processes; check boot-script lines by hand.';
}
/* A boot file left behind runs again at every boot, so a restart is not offered for it (a restart clears processes and firewall rules only). */
function leftHasBoot(left){
  return (Array.isArray(left)?left:[]).some(x=>{const s=String(x);return s.indexOf('boot file still there')===0||/^(still there|not undone): boot script /.test(s)});
}
/* Fields added to the delete request. Only a request that stops carries the hash; the key is present even when empty, or the host runs no undo. */
function undoRequestFields(un,stop){return stop?{undoHash:(un&&un.hash)||''}:{}}
/* The toast suffix after a stop that succeeded: the host only says success when the re-check found nothing left. */
function undoToastText(un,stopped){return stopped&&un&&un.items.length?' ('+un.items.length+' item'+(un.items.length>1?'s':'')+' no longer in the system)':''}
if(typeof module!=='undefined'&&module.exports)module.exports={undoNorm,undoModeRuns,undoDialogText,undoRetryText,undoEffectsText,leftHasBoot,undoRequestFields,undoToastText};
