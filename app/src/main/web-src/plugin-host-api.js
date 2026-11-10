/* ===== UFI-TOOLS plugin host API (Phase 2) =====================================================
 * Helpers that UFI-TOOLS plugins call as globals. Signatures and return values follow UFI-TOOLS 4.1.5
 * (utils.js, MIT, Copyright (c) 2025 Minikano; see LICENSE-UFI-TOOLS). Where MatchiTOOL differs on purpose, the comment says so.
 * Host tools call the same createModal/showModal/closeModal, so every onClose they pass returns true. */
function ufiT(key){return UFI_T[key]||key}
const UFI_T={submit_btn:'Submit',close_btn:'Close',confirm_btn:'Confirm',cancel_btn:'Cancel',copy_success:'Copied successfully!',copy_failed:'Copy failed!',uploading:'Uploading...',toast_upload_success:'Uploaded',toast_upload_failed:'Upload failed',toast_oprate_failed:'Action failed',download_ing:'Downloading',rename_failed:'Rename failed!'};
if(typeof window.t!=='function')window.t=ufiT;
const wait=(ms)=>new Promise((r)=>setTimeout(r,ms));
const debounce=(func,delay)=>{let timer;return function(...args){if(timer)clearTimeout(timer);timer=setTimeout(()=>{func.apply(this,args)},delay)}};
function escapeHtml(input){if(input==null)return '';return String(input).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
function formatBytes(bytes,needTrim=false){
  if(bytes===0)return ' 0.00 B';
  const sizes=['B','KB','MB','GB','TB','PB','EB','ZB','YB'];
  const i=Math.floor(Math.log(bytes)/Math.log(1024));
  const size=(bytes/Math.pow(1024,i)).toFixed(2);let str=String(size);
  if(needTrim){if(size<10)str='&nbsp;&nbsp;&nbsp;'+size;else if(size<100)str='&nbsp;&nbsp;'+size;else if(size<1000)str='&nbsp;'+size}
  return `${str} ${sizes[i]}`;
}
/* Root shell. Reply {success, content}; the page adds the "Cannot reach" retry and the HTTP confirmation in api(). */
async function runShellWithRoot(cmd,timeout=20000){
  return api('/api/shell',{method:'POST',body:JSON.stringify({cmd,timeout})});
}
/* No-root shell: runs as the app's own user (POST /api/user_shell). Like UFI-TOOLS the reply is {success, content: result}, where result
   is an object holding the output text as "content". A failure is returned, not thrown. */
async function runShellWithUser(cmd){
  try{
    const d=await api('/api/user_shell',{method:'POST',body:JSON.stringify({command:cmd})});
    return d&&d.error?{success:false,content:d.error}:{success:true,content:d?d.result:''};
  }catch(e){return {success:false,content:String(e&&e.message||e)}}
}
/* Modals. UFI semantics: the footer buttons are #NAME_confirm and #NAME_close; onConfirm/onClose may be async and the dialog closes only when
   they return a true value. A modal without onClose does not close from its button (as in UFI). Returns {el, id:'#NAME'}: el is the dialog box,
   or the full-screen mask when isMask is set; a MatchiTOOL dialog always has the mask (id NAME) around the box. */
function createModal({name,noBlur,isMask,title,titleI18nKey='',maxWidth,content,contentStyle,showConfirm=true,confirmBtnText=ufiT('submit_btn'),closeBtnText=ufiT('close_btn'),onClose,onConfirm}){
  document.getElementById(name)?.remove();
  const bg=document.createElement('div');bg.className='modal-bg';bg.id=name;
  const box=document.createElement('div');box.className='modal';box.style.maxWidth=maxWidth||'600px';
  box.innerHTML=`<h3 class="title"><span data-i18n="${titleI18nKey}"></span></h3><div class="content mbody" style="${contentStyle||''}"></div><div class="btn mfoot">${showConfirm?`<button id="${name}_confirm" type="button"></button>`:''}<button id="${name}_close" class="mclose" type="button"></button></div>`;
  box.querySelector('.title span').textContent=title==null?'':String(title);
  box.querySelector('.content').innerHTML=content||'';
  const cf=box.querySelector(`#${name}_confirm`),cl=box.querySelector(`#${name}_close`);
  if(cf)cf.textContent=confirmBtnText;
  cl.textContent=closeBtnText;
  const done=()=>closeModal('#'+name,300,()=>bg.remove());
  const settle=async(fn)=>{if(!fn)return;const r=await fn();if(r)done()};
  if(cf)cf.onclick=(e)=>{e.preventDefault();return settle(onConfirm)};
  cl.onclick=(e)=>{e.preventDefault();return settle(onClose)};
  bg.addEventListener('mousedown',(e)=>{if(e.target===bg&&!noBlur&&onClose)settle(onClose)});
  bg.appendChild(box);document.body.appendChild(bg);
  return {el:isMask?bg:box,id:'#'+name};
}
/* showModal(selector | id, time, opacity) and closeModal(selector | id, time, callback). A selector starts with # or . ; a bare name is an id (the
   older MatchiTOOL form). closeModal(id, fn) with a function as the second argument still works. Works for MatchiTOOL dialogs and for any element. */
function ufiModalEl(x){
  if(x&&x.nodeType===1)return x;
  const s=String(x||'');if(!s)return null;
  try{return document.querySelector(/^[#.\[]/.test(s)?s:'#'+CSS.escape(s))}catch(_){return null}
}
function showModal(id,time,opacity){
  const el=ufiModalEl(id);if(!el)return;
  if(el.classList.contains('modal-bg')){el.classList.add('show');return}
  el.style.opacity=0;el.style.display='';setTimeout(()=>{el.style.opacity=(typeof opacity==='string'||typeof opacity==='number')?opacity:'1'},10);
}
let modalTimer=null;
function closeModal(id,time,cb){
  if(typeof time==='function'){cb=time;time=300}
  const el=ufiModalEl(id);if(!el)return;
  const fin=()=>{setTimeout(()=>{if(cb)cb()},30)};
  if(el.classList.contains('modal-bg')){el.classList.remove('show');fin();return}
  el.style.opacity=0;
  if(modalTimer)clearTimeout(modalTimer);
  modalTimer=setTimeout(()=>{el.style.display='none';fin()},typeof time==='number'?time:300);
}
/* More of the host API that UFI-TOOLS plugins expect. */
function requestInterval(fn,ms){const h=setInterval(fn,ms);return()=>clearInterval(h)}
function createFixedToast(id,html,st={}){
  document.getElementById(id)?.remove();
  const el=document.createElement('div');el.id=id;
  el.style.cssText='position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#02060eea;z-index:100001;padding:12px';
  const box=document.createElement('div');
  box.style.cssText='background:var(--panel);color:var(--fg);border:1px solid var(--bd);border-radius:14px;padding:14px;max-width:96vw;max-height:92vh;overflow:auto';
  box.innerHTML=html;Object.assign(box.style,st,{zIndex:''});el.appendChild(box);document.body.appendChild(el);
  return {el:box,close:()=>el.remove()};
}
function createSwitch({text,value,className='',onChange,fontSize=14}){
  const container=document.createElement('div');container.className='Switch';container.style.fontSize=fontSize+'px';
  const label=document.createElement('label');label.style.display='flex';label.style.alignItems='center';label.style.gap='8px';label.className=`outer ${className}`;
  const span=document.createElement('span');span.className='text';span.textContent=text;
  const sw=document.createElement('div');sw.className='switch text-center p-2';if(value)sw.classList.add('active');
  const dot=document.createElement('div');dot.className='dot';sw.appendChild(dot);
  const input=document.createElement('input');input.type='checkbox';input.checked=!!value;input.className='inline-block w-5 h-5 align-sub';
  const visual=(c)=>{input.checked=c;sw.classList.toggle('active',!!c)};
  input.addEventListener('click',(e)=>{const c=e.target.checked;visual(c);if(onChange)onChange(c)});
  label.appendChild(span);label.appendChild(sw);label.appendChild(input);container.appendChild(label);
  container.update=visual;return container;
}
function setBtnLoading(ele,isLoading=false){
  if(!ele)return;
  const old=ele.querySelector('.kano_btn_is_loading');if(old)ele.removeChild(old);
  if(isLoading){const sp=document.createElement('span');sp.className='kano_btn_is_loading spin';sp.style.display='inline-block';sp.textContent='\u{1F365}';ele.appendChild(sp);ele.disabled=true}
  else ele.disabled=false;
}
const createFormToast=({title,id,fields},cb=async()=>{})=>{
  if(!fields||!Array.isArray(fields)){console.error('Invalid fields provided for createFormToast');return null}
  if(!id){console.error('ID is required for createFormToast');return null}
  const lab=(f)=>`<div style="margin-bottom:5px;">${f.label}:</div>`;
  const fieldHtml=fields.map((f,i)=>{
    if(f.type==='select'&&Array.isArray(f.options))return `<div>${lab(f)}<select class="select" style="width:100%;padding:5px;margin:0 !important;" id="${id}_input_${i}">${f.options.map((o)=>`<option value="${o.value}">${o.label}</option>`).join('')}</select></div>`;
    if(f.type==='textarea')return `<div>${lab(f)}<textarea style="width:100%;padding:5px;" id="${id}_input_${i}" placeholder="${f.placeholder||''}"></textarea></div>`;
    if(f.type==='checkbox')return `<div style="display:flex;align-items:center;"><input type="checkbox" id="${id}_input_${i}"/><label style="padding-left:5px;" for="${id}_input_${i}">${f.label}</label></div>`;
    if(f.type==='checkbox-group'){
      if(!Array.isArray(f.options)){console.error('Invalid options for checkbox-group field: '+f.name);return ''}
      return `<div>${lab(f)}<div style="display:flex;gap:5px;flex-wrap:wrap;" id="${id}_input_group_${i}">${f.options.map((o)=>`<div style="display:flex;align-items:center;"><input type="checkbox" id="${id}_input_group_item_${i}_${f.name}_${o.value}" value="${o.value}"/><label style="padding-left:5px;" for="${id}_input_group_item_${i}_${f.name}_${o.value}">${o.label}</label></div>`).join('')}</div></div>`;
    }
    return `<div>${lab(f)}<input style="width:100%;padding:5px;" type="text" id="${id}_input_${i}" placeholder="${f.placeholder||''}"/></div>`;
  }).join('');
  const {el,close}=createFixedToast(id,`<div style="pointer-events:all;width:80vw;max-width:300px;"><div class="title" style="margin:0">${ufiT(title)}</div><div class="form-group" style="display:flex;flex-direction:column;gap:6px;margin:10px 0;">${fieldHtml}</div><div style="display:flex;gap:10px"><button id="close_${id}_toast_btn" style="width:100%;margin-top:5px">${ufiT('confirm_btn')}</button><button id="close_${id}_toast_btn1" style="width:100%;margin-top:5px">${ufiT('cancel_btn')}</button></div></div>`);
  const btn=el.querySelector(`#close_${id}_toast_btn`),btn2=el.querySelector(`#close_${id}_toast_btn1`);
  const values=()=>{const out={};fields.forEach((f,i)=>{
    const inp=el.querySelector(`#${id}_input_${i}`),grp=el.querySelector(`#${id}_input_group_${i}`);
    if(inp)out[f.name]=f.type==='checkbox'?inp.checked:inp.value;
    else if(grp&&f.type==='checkbox-group')out[f.name]=Array.from(grp.querySelectorAll('input[type="checkbox"]')).filter((c)=>c.checked).map((c)=>c.value);
  });return out};
  if(!btn&&!btn2){close();return}
  btn2.onclick=()=>close();
  btn.onclick=async()=>{try{await cb(values(),close)}catch(e){console.error('Error occurred while submitting form:',e)}};
};
/* Every same-origin /api/ request from a plugin gets the session token it would not know about, and root-capable calls over plain HTTP ask the
   page's usual "not encrypted" question first. UFI's own kano-t / kano-sign / authorization headers pass through unread. */
(function(){
  const nativeFetch=window.fetch.bind(window);
  const ROOTY=/^\/api\/(?:root_shell|user_shell|one_click_shell|shell)$/;
  /* Same rule as RootGate.isReadOnlyAt (Kotlin): only pure AT reads skip the "not encrypted" question on UFI's GET /api/AT. */
  const AT_READS=['AT','ATI','AT+CSQ','AT+CESQ','AT+CGSN','AT+CIMI','AT+CCID','AT+CNUM','AT+CGMR','AT+CGMM','AT+CGMI'];
  const AT_QUERY=/^AT(\+[A-Z0-9_]+)?(\?|=\?)$/i;
  const atIsRead=c=>{c=String(c||'').trim();return !!c&&c.length<=64&&(AT_READS.indexOf(c.toUpperCase())>=0||AT_QUERY.test(c))};
  window.__matchiAtIsRead=atIsRead;
  window.fetch=async function(input,init){
    let u=null;
    try{u=new URL(typeof input==='string'?input:(input&&input.url)||'',location.href)}catch(_){}
    if(u&&u.origin===location.origin&&u.pathname.startsWith('/api/')){
      const h=new Headers((init&&init.headers)||(input&&input.headers)||undefined);
      if(!h.has('x-token')&&TOKEN)h.set('x-token',TOKEN);
      if((ROOTY.test(u.pathname)||(u.pathname==='/api/AT'&&!atIsRead(u.searchParams.get('command'))))&&insecurePage()){
        if(!(await insecureOk()))throw new Error('Root commands cancelled: the connection is not encrypted (HTTP). Reload the page to be asked again.');
        h.set('x-insecure-ok','1');
      }
      init={...(init||{}),headers:h};
    }
    return nativeFetch(input,init);
  };
})();
/* One shared compatibility object for plugins that were converted before the host had these helpers (their own block says
   window.__matchiCompat || ...). It adds what a plain root call does not: UFI-style failures, a curl wrapper at
   /data/local/matchitool/bin/curl, and background jobs for commands longer than the 120 s root limit. */
window.__matchiCompat=window.__matchiCompat||(()=>{
  const P={base:'/data/local/matchitool'};
  P.boot=`${P.base}/boot.sh`;P.uploads=`${P.base}/uploads`;P.curl=`${P.base}/bin/curl`;
  P.jobs='/data/local/matchitool/tmp/jobs';   // root-only: these .sh files are run as root
  const q=(s)=>`'${String(s).replace(/'/g,`'\\''`)}'`;
  const sleep=(ms)=>new Promise((r)=>setTimeout(r,ms));
  const MB=1048576;
  const hr=async(cmd,t=20000)=>{
    try{const r=await runShellWithRoot(cmd,t);return {success:!!(r&&r.success),content:String((r&&r.content)??'')}}
    catch(e){return {success:false,content:String(e&&e.message||e)}}
  };
  const SETUP=String.raw`mkdir -p ${P.base}/bin ${P.uploads} ${P.jobs} 2>/dev/null
chmod 700 /data/local/matchitool/tmp ${P.jobs} 2>/dev/null
[ -f ${P.boot} ] || printf '#!/system/bin/sh\n' > ${P.boot}
cat > ${P.curl} <<'MATCHI_CURL_EOF'
#!/system/bin/sh
for c in /data/local/matchitool/bin/curl.real /data/data/com.matchi.tool/files/curl /data/local/tmp/curl /system/bin/curl /system/xbin/curl /vendor/bin/curl /data/data/com.minikano.f50_sms/files/curl; do
  [ -x "$c" ] && exec "$c" "$@"
done
c=$(command -v curl 2>/dev/null)
case "$c" in ""|/data/local/matchitool/bin/curl) ;; *) exec "$c" "$@" ;; esac
echo "curl: no curl binary found on this device. MatchiTOOL normally bundles curl; if this appears, reinstall or update the app, or copy an arm64 curl to /data/local/matchitool/bin/curl.real and chmod 755 it." >&2
exit 127
MATCHI_CURL_EOF
chmod 755 ${P.curl}; chmod 700 ${P.uploads}
echo ready`;
  let prep=null;
  const prepare=()=>prep||(prep=hr(SETUP,15000).then((r)=>{if(!r.success)prep=null;return r}));
  const runJob=async(cmd,total)=>{
    const id=Date.now().toString(36)+Math.random().toString(36).slice(2,7);
    const f=`${P.jobs}/${id}`;
    const st=await hr(`mkdir -p ${P.jobs}
for d in /data/local/matchitool/tmp ${P.jobs}; do
  [ -L "$d" ] && exit 1
  [ "$(stat -c %u "$d" 2>/dev/null)" = 0 ] || exit 1
done
chmod 700 /data/local/matchitool/tmp ${P.jobs} 2>/dev/null
cat > ${f}.sh <<'MATCHI_JOB_EOF'
${cmd}
MATCHI_JOB_EOF
(sh ${f}.sh > ${f}.out 2>&1; echo $? > ${f}.rc) >/dev/null 2>&1 &
echo started`,15000);
    if(!st.success||!st.content.includes('started'))return {success:false,content:st.content||'Could not start background job'};
    const t0=Date.now();
    while(Date.now()-t0<total){
      await sleep(2000);
      const r=await hr(`if [ -f ${f}.rc ]; then echo "@@DONE:$(cat ${f}.rc)"; else echo "@@RUN"; fi; tail -c 400000 ${f}.out 2>/dev/null`,20000);
      const m=r.content.match(/^@@(?:DONE:(\d+)|RUN)\n?/);
      if(!m)continue;
      if(m[1]!==undefined){
        await hr(`rm -f ${f}.sh ${f}.out ${f}.rc`,5000);
        return {success:m[1]==='0',content:r.content.slice(m[0].length).trim()};
      }
    }
    return {success:false,content:`[no result after ${Math.round(total/1000)}s; the job may still be running: ${f}.sh]`};
  };
  const run=async(cmd,timeout=20000)=>{await prepare();return timeout>110000?runJob(cmd,timeout):hr(cmd,timeout)};
  const b64=(buf)=>{const u=new Uint8Array(buf);let s='';for(let i=0;i<u.length;i+=8192)s+=String.fromCharCode.apply(null,u.subarray(i,i+8192));return btoa(s)};
  const sizeOf=async(path)=>{
    const r=await hr(`stat -c %s ${q(path)} 2>/dev/null || wc -c < ${q(path)} 2>/dev/null`,8000);
    const n=parseInt(r.content.trim(),10);
    return r.success&&Number.isFinite(n)?n:-1;
  };
  const upload=async(file,o={})=>{
    const maxMB=o.maxMB||64,onProgress=o.onProgress||(()=>{});
    const name=String(o.name||file.name).replace(/[^A-Za-z0-9._-]/g,'_');
    await prepare();
    const dest=`${P.uploads}/${name}`;
    if(await sizeOf(dest)===file.size){onProgress(100);return name}
    if(file.size>maxMB*MB)throw new Error(`This file is larger than ${maxMB} MB, which is too slow to push through the browser. Copy it to ${dest} yourself (adb push, then su -c cp), then select the same file again; it is detected and the upload is skipped.`);
    const chk=await hr('command -v base64 >/dev/null 2>&1 && echo yes || echo no',8000);
    if(!chk.content.includes('yes'))throw new Error('This device has no base64 tool, so the browser cannot upload files. Copy the file to '+dest+' by hand.');
    const part=`${dest}.part`,CH=48*1024;
    await hr(`rm -f ${q(part)}; : > ${q(part)}`,8000);
    for(let off=0;off<file.size;off+=CH){
      const data=b64(await file.slice(off,off+CH).arrayBuffer());
      let ok=false;
      for(let a=0;a<2&&!ok;a++){
        const r=await hr(`printf %s '${data}' | base64 -d >> ${q(part)} && echo MATCHI_OK`,30000);
        ok=r.content.includes('MATCHI_OK');
        if(!ok&&a===1){
          await hr(`rm -f ${q(part)}`,5000);
          throw new Error(`Upload stopped at ${(off/MB).toFixed(1)} MB: ${r.content.trim().slice(0,160)||'write failed'}. If this is near 1 MB, the MatchiTOOL root shell file-size limit (ulimit -f) is blocking large writes.`);
        }
      }
      onProgress(Math.min(99,Math.round(((off+CH)/file.size)*100)));
    }
    const got=await sizeOf(part);
    if(got!==file.size){await hr(`rm -f ${q(part)}`,5000);throw new Error(`Upload size mismatch (${got} of ${file.size} bytes)`)}
    const mv=await hr(`mv -f ${q(part)} ${q(dest)} && chmod 600 ${q(dest)} && echo MATCHI_OK`,15000);
    if(!mv.content.includes('MATCHI_OK'))throw new Error('Could not finalize the uploaded file');
    onProgress(100);return name;
  };
  const download=async(path,saveAs,o={})=>{
    const maxMB=o.maxMB||64,onProgress=o.onProgress||(()=>{});
    const total=await sizeOf(path);
    if(total<0)throw new Error(`Cannot read ${path}`);
    if(total>maxMB*MB)throw new Error(`The file is ${(total/MB).toFixed(0)} MB, too large for a browser download. It stays on the device at ${path}; copy it with adb pull.`);
    const CH=48*1024,parts=[];
    for(let off=0,i=0;off<total;off+=CH,i++){
      const r=await hr(`dd if=${q(path)} bs=${CH} skip=${i} count=1 2>/dev/null | base64 | tr -d '\\n'`,30000);
      if(!r.success)throw new Error('Read failed at '+(off/MB).toFixed(1)+' MB');
      const bin=atob(r.content.trim()),u=new Uint8Array(bin.length);
      for(let k=0;k<bin.length;k++)u[k]=bin.charCodeAt(k);
      parts.push(u);onProgress(Math.min(99,Math.round(((off+CH)/total)*100)));
    }
    const url=URL.createObjectURL(new Blob(parts));
    const a=document.createElement('a');a.href=url;a.download=saveAs;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),4000);onProgress(100);return total;
  };
  const validIp=(v)=>/^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/.test(String(v||''));
  let lanCache='';
  const lanIp=async()=>{
    if(lanCache)return lanCache;
    try{
      const r=await api('/api/zte',{method:'POST',body:JSON.stringify({op:'get',params:{cmd:'lan_ipaddr'}})});
      const v=r&&r.data&&r.data.lan_ipaddr;
      if(validIp(v))return (lanCache=v);
    }catch(_){/* router API login may not be configured; fall back to the interface */}
    const r=await hr(String.raw`for i in br0 bridge0 wlan0; do ip -4 addr show $i 2>/dev/null | awk '/inet /{sub(/\/.*/,"",$2);print $2;exit}'; done | head -n1`,8000);
    const v=r.content.trim().split('\n')[0];
    return validIp(v)?(lanCache=v):'';
  };
  return {P,q,sleep,hr,prepare,run,runJob,showModal,closeModal,createModal,createFixedToast,requestInterval,upload,download,lanIp,validIp};
})();
/* ===== end UFI-TOOLS plugin host API ===== */