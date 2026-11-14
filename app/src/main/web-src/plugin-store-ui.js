/* ===== Plugin store (browser-side fetch: the app itself still makes no network request for this) ===== */
const STORE_KEY='matchi_store_url';
function storeSavedUrl(){try{return localStorage.getItem(STORE_KEY)||''}catch(_){return ''}}
function storeSaveUrl(u){try{localStorage.setItem(STORE_KEY,u)}catch(_){}}
/* Reads a response as text and stops at max bytes, so a huge or endless file cannot fill the page's memory. */
async function storeFetchText(url,max){return new TextDecoder('utf-8').decode(await storeFetchBytes(url,max))}
async function storeFetchBytes(url,max){
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),20000);
  try{
    const r=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',redirect:'follow',signal:ctl.signal});
    if(!r.ok)throw new Error('HTTP '+r.status);
    if(r.url&&!storeUrlOk(r.url))throw new Error('The server redirected to an address the store does not allow');
    const rd=r.body&&r.body.getReader?r.body.getReader():null;
    if(!rd){const t=new Uint8Array(await r.arrayBuffer());if(t.length>max)throw new Error('File is too large');return t}
    const parts=[];let n=0;
    for(;;){const {done,value}=await rd.read();if(done)break;n+=value.length;if(n>max){try{await rd.cancel()}catch(_){}throw new Error('File is over '+(max/1048576).toFixed(0)+' MB')}parts.push(value)}
    const all=new Uint8Array(n);let o=0;for(const p of parts){all.set(p,o);o+=p.length}
    return all;
  }catch(e){throw new Error(e&&e.name==='AbortError'?'Timed out after 20 s':(e&&e.message)||String(e))}
  finally{clearTimeout(timer)}
}
/* Download, check the SHA-256 against the index, show it with the scan, then install after an explicit confirm. */
async function storeInstall(item){
  const bytes=await storeFetchBytes(item.url,STORE_FILE_MAX);
  const sha=await storeSha256Bytes(bytes);   // over the raw bytes, like the index hash
  const text=new TextDecoder('utf-8').decode(bytes);
  if(item.sha256&&item.sha256!==sha)throw new Error('SHA-256 mismatch: the store lists '+item.sha256.slice(0,16)+'\u2026 but the file is '+sha.slice(0,16)+'\u2026. Nothing was installed.');
  const scan=plugScan(text),blocks=ufiParse(text);
  const isJs=!blocks.length&&/\.js(\?|#|$)/i.test(item.url);
  if(isJs){
    const stem=ufiFileName(item.name).replace(/-[0-9a-f]{8}\.html$/,'').replace(/\.html$/,'').replace(/\.js$/i,'');
    const name=(stem||'plugin').slice(0,76)+'.js';
    if(!nameRxStore.test(name)||BUILTIN.has(name))throw new Error('Cannot install under the name '+name);
    if(ufiBytes(text)>UFI_BLOCK_MAX)throw new Error('Plugin is over the 1 MB limit');
    try{new Function(text)}catch(e){throw new Error('The file is not valid JavaScript: '+e.message)}
    const replaces=pluginCache.some(p=>p.name===name)?[name]:[];
    if(!(await askConfirm('Install from the store?\n\n'+storeSummary(item,sha,scan,replaces,plugCompat(text),plugStopDecls(text))+'\n\nPlugins can run any command as root. Continue only if you trust this file.',replaces.length?'Replace and install':'Install',true)))return false;
    await api('/api/plugins',{method:'POST',body:JSON.stringify({name,code:text,title:item.name})});
    await api('/api/plugins/toggle',{method:'POST',body:JSON.stringify({name,enabled:true})});
    await refreshPluginList();createToast('Installed '+item.name);setTimeout(()=>location.reload(),500);return true;
  }
  const ptitles=(blocks.length?blocks.map(b=>b.title):[String(item.name)]),replaces=ptitles.map(t=>ufiFileName(t)).filter(n=>pluginCache.some(p=>p.name===n));
  return ufiImport(text,item.name+'.txt',storeSummary(item,sha,scan,replaces,plugCompat(text)));
}
const nameRxStore=/^[A-Za-z0-9._-]{1,80}\.js$/;
function storeOpen(){
  const bg=document.createElement('div');bg.className='modal-bg show';bg.style.zIndex='2500';
  bg.innerHTML='<div class="modal" role="dialog" aria-modal="true" style="max-width:460px;width:94vw"><div class="mhead st-head"><b>Plugin store</b></div><div class="mbody" style="display:flex;flex-direction:column;gap:8px">'
   +'<select id="st_src" aria-label="Store source" style="min-height:0;height:34px"><option value="">Custom address</option><option value="ufi">UFI-TOOLS plugins (community mirror)</option></select>'
   +'<div style="display:flex;gap:6px"><input id="st_url" type="url" inputmode="url" placeholder="https://example.com/index.json" autocomplete="off" style="flex:1;min-width:0"><button type="button" id="st_load" style="min-height:0;height:34px">Load</button></div>'
   +'<div class="pm-sub" id="st_note">Enter the address of a store index (JSON). Only https addresses with a domain name are accepted. Nothing is installed without a confirm.</div>'
   +'<input id="st_q" type="search" placeholder="Search" autocomplete="off" style="display:none"><div id="st_list" style="display:flex;flex-direction:column;gap:6px;min-height:80px;overflow:auto;flex:1 1 auto"></div>'
   +'<div id="st_pager" style="display:none;gap:8px;align-items:center;justify-content:center"><button type="button" id="st_prev" style="min-height:0;height:30px">Prev</button><span id="st_pg" class="pm-sub"></span><button type="button" id="st_next" style="min-height:0;height:30px">Next</button></div>'
   +'</div><div class="st-foot" style="display:flex;justify-content:flex-end;padding:8px 12px"><button type="button" class="ccancel">Close</button></div></div>';
  const $=(id)=>bg.querySelector('#'+id);let items=[],page=1;
  const close=()=>{document.removeEventListener('keydown',key,true);bg.remove()};
  const key=(e)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close()}};
  document.addEventListener('keydown',key,true);
  bg.querySelector('.ccancel').onclick=close;bg.addEventListener('mousedown',(e)=>{if(e.target===bg)close()});
  const src=$('st_src');
  src.onchange=()=>{if(src.value==='ufi'){$('st_url').value=STORE_UFI_SOURCE;load()}else{$('st_url').focus()}};
  const note=(t,red)=>{$('st_note').textContent=t;$('st_note').style.color=red?'#e05a70':''};
  function draw(){
    const f=storeFilter(items,$('st_q').value,page);page=f.page;const box=$('st_list');box.textContent='';
    for(const it of f.rows){
      const row=document.createElement('div');row.style.cssText='border:1px solid rgba(128,128,128,.3);border-radius:10px;padding:8px;display:flex;gap:8px;align-items:center';
      const info=document.createElement('div');info.style.cssText='flex:1;min-width:0';
      const t=document.createElement('div');t.style.fontWeight='600';const en=storeEnglish(it.name);t.textContent=en+(it.version?' '+it.version:'');if(en!==it.name)t.title=it.name;
      const d=document.createElement('div');d.className='pm-sub';d.textContent=[it.author,storeEnglish(it.description),it.size?(it.size/1024).toFixed(1)+' KB':''].filter(Boolean).join(' \u00b7 ')+(it.sha256?'':' \u00b7 no SHA-256 listed');
      info.append(t,d);
      const b=document.createElement('button');b.type='button';b.textContent=pluginCache.some(p=>p.title===it.name||p.name===it.name+'.js')?'Reinstall':'Install';b.style.cssText='min-height:0;height:32px;flex:none';
      b.onclick=async()=>{b.disabled=true;try{await storeInstall(it)}catch(e){createToast('Install failed: '+e.message,'red',7000)}finally{b.disabled=false}};
      row.append(info,b);box.appendChild(row)}
    if(!f.rows.length){const e=document.createElement('div');e.className='pm-sub';e.textContent=items.length?'No match':'';box.appendChild(e)}
    $('st_pager').style.display=f.pages>1?'flex':'none';$('st_pg').textContent='Page '+f.page+' of '+f.pages+' ('+f.total+')';
    $('st_prev').disabled=f.page<=1;$('st_next').disabled=f.page>=f.pages;
  }
  async function load(){
    const url=storeUrlOk($('st_url').value);if(!url){note('That address is not allowed. Use https://, a domain name (no IP address, localhost or .local).',true);return}
    $('st_load').disabled=true;note('Loading\u2026');
    try{const r=storeParseIndex(await storeFetchText(url,STORE_INDEX_MAX+1),url);
      if(r.error)throw new Error(r.error);
      items=r.items;page=1;storeSaveUrl(url);src.value=url===STORE_UFI_SOURCE?'ufi':'';$('st_q').style.display=items.length?'':'none';
      note(items.length+' plugin'+(items.length===1?'':'s')+(r.skipped?' ('+r.skipped+' invalid entr'+(r.skipped===1?'y':'ies')+' skipped)':'')+(r.unsupported?' ('+r.unsupported+' archive'+(r.unsupported===1?'':'s')+'/folder'+(r.unsupported===1?'':'s')+' hidden: they need the UFI-TOOLS app)':'')+'. Each install shows the file\'s SHA-256 first.');draw()}
    catch(e){items=[];draw();note('Could not load the index: '+e.message,true)}
    finally{$('st_load').disabled=false}
  }
  $('st_load').onclick=load;$('st_url').onkeydown=(e)=>{if(e.key==='Enter')load()};
  $('st_q').oninput=()=>{page=1;draw()};$('st_prev').onclick=()=>{page--;draw()};$('st_next').onclick=()=>{page++;draw()};
  document.body.appendChild(bg);$('st_url').value=storeSavedUrl();if($('st_url').value)load();else $('st_url').focus();
}
document.getElementById('plugin_store_open').onclick=storeOpen;