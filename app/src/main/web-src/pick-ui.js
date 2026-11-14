/* Popup pickers. The phone's own dropdown list and date/time wheel take over the whole screen; this shows the same choices in a popup in the page's own style.
   The real <select> / <input type="datetime-local"> stay in the page (hidden), so every handler that reads .value or listens for input/change keeps working.
   Covers selects and date-time fields inside pop-up dialogs (not the Plugins window) and the header. Controls added later are picked up too. */
(()=>{
'use strict';
if(window.MT_pick)return;
const doc=document,pad=n=>String(n).padStart(2,'0');
const el=(tag,cls,text)=>{const e=doc.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e};
const css=`
.mt-pick{display:inline-flex;align-items:center;justify-content:space-between;gap:6px;box-sizing:border-box;min-width:7em;max-width:100%;height:26px;padding:0 8px;border-radius:6px;border:1px solid var(--bd,#24466e);background:#080f1c;color:var(--fg,#e8f0ff);font-size:11.5px;line-height:1;cursor:pointer;-webkit-tap-highlight-color:transparent;user-select:none}
.mt-pick:focus-visible{outline:2px solid var(--acc2,#7fb2ff);outline-offset:1px}
.mt-pick.mt-off{opacity:.5;pointer-events:none}
.mt-pick-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
.mt-pick-c{opacity:.7;font-size:10px}
.mt-pick.mt-wide{flex:1 1 12em}
.mt-bg{position:fixed;inset:0;z-index:1100;display:flex;align-items:center;justify-content:center;padding:12px;background:rgba(2,6,14,.78);-webkit-tap-highlight-color:transparent}
.mt-sheet{width:min(420px,100%);max-height:min(80vh,580px);display:flex;flex-direction:column;overflow:hidden;color:var(--fg,#e8f0ff);background:linear-gradient(150deg,#0f1b2e,#0a1321);border:1px solid rgba(255,255,255,.12);border-radius:16px;box-shadow:0 20px 60px #000c}
.mt-title{padding:12px 16px 8px;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--acc2,#7fb2ff)}
.mt-body{min-height:0;overflow:auto;padding:0 8px 6px;-webkit-overflow-scrolling:touch}
.mt-grp{padding:10px 10px 4px;font-size:11px;font-weight:800;color:var(--acc2,#7fb2ff)}
.mt-opt{display:flex;align-items:center;gap:10px;min-height:40px;padding:8px 10px;border-radius:10px;font-size:13px;line-height:1.35;cursor:pointer}
.mt-opt:hover{background:rgba(255,255,255,.06)}
.mt-opt.on{background:rgba(77,163,255,.16)}
.mt-opt.off{opacity:.45;cursor:default}
.mt-opt-t{flex:1;min-width:0;overflow-wrap:anywhere}
.mt-ck{width:1em;text-align:center;font-weight:800;color:#4da3ff}
.mt-foot{display:flex;justify-content:flex-end;gap:8px;padding:8px 12px 12px;border-top:1px solid rgba(255,255,255,.08)}
.mt-foot .mt-left{margin-right:auto}
.mt-foot button{min-height:34px;height:34px;padding:0 16px;font-size:13px}
.mt-foot button.mt-go{background:linear-gradient(180deg,#1f7ae0,#1560b8);border-color:#4da3ff;color:#fff}
.mt-cal-h{display:flex;align-items:center;justify-content:space-between;padding:2px 6px 6px}
.mt-cal-t{font-size:14px;font-weight:700}
.mt-nav{display:flex;align-items:center;justify-content:center;width:40px;height:36px;border-radius:10px;font-size:18px;cursor:pointer}
.mt-nav:hover{background:rgba(255,255,255,.08)}
.mt-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;padding:0 4px}
.mt-wd{padding:4px 0;text-align:center;font-size:10.5px;color:var(--mut,#8aa4c8)}
.mt-day{display:flex;align-items:center;justify-content:center;height:38px;border-radius:10px;font-size:13px;cursor:pointer}
.mt-day:hover{background:rgba(255,255,255,.08)}
.mt-day.now{outline:1px solid rgba(255,255,255,.35)}
.mt-day.on{background:#1f7ae0;color:#fff;font-weight:700}
.mt-time{display:flex;align-items:center;gap:8px;padding:10px 10px 4px;font-size:12px;color:var(--mut,#8aa4c8)}
.mt-time input{width:4.5em;min-height:36px;text-align:center;font-size:15px}
@media(max-width:600px){.mt-pick{height:34px;font-size:13px}.mt-opt{min-height:44px;font-size:14px}}
`;
const st=el('style');st.id='mt-pick-style';st.textContent=css;doc.head.appendChild(st);

let cur=null;
function close(){
 if(!cur)return;const c=cur;cur=null;
 c.bg.remove();window.removeEventListener('keydown',c.key,true);
 try{if(c.anchor&&c.anchor.focus)c.anchor.focus({preventScroll:true})}catch(e){}
}
/* One popup at a time, centred over the page, above every dialog. Tap outside or press Escape to close. */
function sheet(title,anchor,build){
 close();
 const bg=el('div','mt-bg'),box=el('div','mt-sheet'),body=el('div','mt-body');
 box.tabIndex=-1;box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-label',title);
 box.append(el('div','mt-title',title),body);bg.appendChild(box);
 bg.addEventListener('click',e=>{if(e.target===bg)close()});
 const key=e=>{
  if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();return}
  if(e.key==='Tab'){
   e.preventDefault();e.stopImmediatePropagation();
   const f=[...box.querySelectorAll('[tabindex="0"],button,input')].filter(x=>x.offsetWidth||x.offsetHeight);
   if(!f.length){box.focus();return}
   const i=f.indexOf(doc.activeElement),n=e.shiftKey?(i<=0?f.length-1:i-1):(i<0||i===f.length-1?0:i+1);
   f[n].focus();
  }
 };
 window.addEventListener('keydown',key,true);doc.body.appendChild(bg);cur={bg,key,anchor};
 build(body,box);
 box.focus({preventScroll:true});
 return box;
}
function foot(box,items){
 const f=el('div','mt-foot');
 for(const it of items){const b=el('button',it.cls||'',it.text);b.type='button';b.addEventListener('click',it.fn);f.appendChild(b)}
 box.appendChild(f);return f;
}
function labelOf(c){
 const clean=t=>(t||'').replace(/\s+/g,' ').replace(/:$/,'').trim();
 const l=c.closest('label');
 if(l){const sp=l.querySelector(':scope > span');const t=clean(sp?sp.textContent:[...l.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(' '));if(t)return t}
 if(c.id){const f=doc.querySelector('label[for="'+c.id+'"]');if(f&&clean(f.textContent))return clean(f.textContent)}
 return clean(c.getAttribute('aria-label')||c.title)||'Choose';
}
/* A trigger that looks like the control it replaces. The real control keeps its place in the page, hidden. */
function trigger(real,wide){
 const t=el('div','mt-pick'+(wide?' mt-wide':'')),tx=el('span','mt-pick-t'),ca=el('span','mt-pick-c','▾');
 t.tabIndex=0;t.setAttribute('role','button');t.setAttribute('aria-haspopup','dialog');t.setAttribute('aria-label',labelOf(real));
 t.append(tx,ca);
 if(real.closest('header')){if(real.className)t.className+=' '+real.className;t.style.cssText+=real.style.cssText}
 real.parentNode.insertBefore(t,real.nextSibling);real.style.setProperty('display','none','important');
 return{t,tx};
}
function hook(real,proto,props,sync){
 for(const p of props){
  const d=Object.getOwnPropertyDescriptor(proto,p);if(!d||!d.set)continue;
  Object.defineProperty(real,p,{configurable:true,get(){return d.get.call(real)},set(v){d.set.call(real,v);sync()}});
 }
}
function activate(t,fn){
 t.addEventListener('click',fn);
 t.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fn()}});
}
function fire(real){real.dispatchEvent(new Event('input',{bubbles:true}));real.dispatchEvent(new Event('change',{bubbles:true}))}

function enhanceSelect(s){
 if(s.multiple||s.size>1)return;
 const{t,tx}=trigger(s,s.dataset.pick==='wide');
 const sync=()=>{const o=s.options[s.selectedIndex];tx.textContent=o?o.text.replace(/\s+/g,' ').trim():'';t.classList.toggle('mt-off',s.disabled)};
 hook(s,HTMLSelectElement.prototype,['value','selectedIndex'],sync);
 new MutationObserver(sync).observe(s,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
 sync();
 activate(t,()=>{
  if(s.disabled)return;
  sheet(labelOf(s),t,(body,box)=>{
   let on=null;
   const add=o=>{
    const r=el('div','mt-opt'+(o.selected?' on':'')+(o.disabled?' off':''));
    r.setAttribute('role','option');if(!o.disabled){r.tabIndex=0;r.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();r.click()}})}r.append(el('span','mt-opt-t',o.text.replace(/\s+/g,' ').trim()),el('span','mt-ck',o.selected?'✓':''));
    if(!o.disabled)r.addEventListener('click',()=>{const was=s.selectedIndex;close();if(o.index!==was){s.selectedIndex=o.index;fire(s)}});
    body.appendChild(r);if(o.selected)on=r;
   };
   for(const n of s.children){
    if(n.tagName==='OPTGROUP'){body.appendChild(el('div','mt-grp',n.label));for(const o of n.children)add(o)}
    else if(n.tagName==='OPTION')add(n);
   }
   foot(box,[{text:'Cancel',fn:close}]);
   if(on)on.scrollIntoView({block:'center'});
  });
 });
}

const parse=v=>{const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v||'');return m?{y:+m[1],mo:+m[2]-1,d:+m[3],h:+m[4],mi:+m[5]}:null};
function enhanceDate(inp){
 const{t,tx}=trigger(inp,false);
 const sync=()=>{const v=inp.value;tx.textContent=v?v.replace('T',' '):'Any time';tx.style.opacity=v?'':'.6'};
 hook(inp,HTMLInputElement.prototype,['value'],sync);
 sync();
 activate(t,()=>{
  const n=new Date(),p=parse(inp.value)||{y:n.getFullYear(),mo:n.getMonth(),d:n.getDate(),h:n.getHours(),mi:n.getMinutes()};
  let vy=p.y,vm=p.mo;
  sheet(labelOf(inp),t,(body,box)=>{
   const head=el('div','mt-cal-h'),prev=el('div','mt-nav','‹'),next=el('div','mt-nav','›'),title=el('div','mt-cal-t'),grid=el('div','mt-grid');
   prev.setAttribute('role','button');next.setAttribute('role','button');prev.setAttribute('aria-label','Previous month');next.setAttribute('aria-label','Next month');
   head.append(prev,title,next);
   const draw=()=>{
    title.textContent=new Date(vy,vm,1).toLocaleDateString(undefined,{month:'long',year:'numeric'});
    grid.textContent='';
    for(const w of ['S','M','T','W','T','F','S'])grid.appendChild(el('div','mt-wd',w));
    const first=new Date(vy,vm,1).getDay(),days=new Date(vy,vm+1,0).getDate(),today=new Date();
    for(let i=0;i<first;i++)grid.appendChild(el('div'));
    for(let d=1;d<=days;d++){
     const isNow=today.getFullYear()===vy&&today.getMonth()===vm&&today.getDate()===d;
     const c=el('div','mt-day'+(p.y===vy&&p.mo===vm&&p.d===d?' on':'')+(isNow?' now':''),String(d));
     c.setAttribute('role','button');c.tabIndex=0;
     c.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();c.click()}});
     c.addEventListener('click',()=>{p.y=vy;p.mo=vm;p.d=d;draw()});
     grid.appendChild(c);
    }
   };
   const move=k=>{vm+=k;if(vm<0){vm=11;vy--}else if(vm>11){vm=0;vy++}draw()};
   prev.addEventListener('click',()=>move(-1));next.addEventListener('click',()=>move(1));
   const time=el('div','mt-time'),hh=el('input'),mm=el('input');
   for(const [i,max,v,lab] of [[hh,23,p.h,'Hour'],[mm,59,p.mi,'Minute']]){i.type='number';i.min='0';i.max=String(max);i.value=pad(v);i.setAttribute('inputmode','numeric');i.setAttribute('aria-label',lab)}
   time.append(el('span','','Time (24 h)'),hh,el('span','',':'),mm);
   body.append(head,grid,time);draw();
   const num=(i,max)=>Math.min(max,Math.max(0,parseInt(i.value,10)||0));
   foot(box,[
    {text:'Clear',cls:'mt-left',fn:()=>{close();if(inp.value){inp.value='';fire(inp)}}},
    {text:'Cancel',fn:close},
    {text:'Set',cls:'mt-go',fn:()=>{const v=p.y+'-'+pad(p.mo+1)+'-'+pad(p.d)+'T'+pad(num(hh,23))+':'+pad(num(mm,59));close();if(inp.value!==v){inp.value=v;fire(inp)}}}
   ]);
  });
 });
}

const inScope=c=>!!c.closest&&!!c.closest('.card.pop, header')&&!c.closest('#pluginmgr')&&!c.closest('.mt-bg');
function scan(root){
 if(!root||root.nodeType!==1)return;
 const list=[];if(root.matches('select,input[type="datetime-local"]'))list.push(root);
 root.querySelectorAll('select,input[type="datetime-local"]').forEach(c=>list.push(c));
 for(const c of list){
  if(c.dataset.mtPick||!inScope(c)||!c.parentNode)continue;
  c.dataset.mtPick='1';
  try{c.tagName==='SELECT'?enhanceSelect(c):enhanceDate(c)}catch(e){delete c.dataset.mtPick}
 }
}
function init(){
 scan(doc.body);
 let q=[],timer=0;
 const flush=()=>{timer=0;const l=q;q=[];for(const n of l)if(n.isConnected)scan(n)};
 new MutationObserver(ms=>{
  for(const m of ms)for(const n of m.addedNodes)if(n.nodeType===1&&(n.tagName==='SELECT'||n.tagName==='INPUT'||n.firstElementChild))q.push(n);
  if(q.length&&!timer)timer=setTimeout(flush,60);
 }).observe(doc.body,{childList:true,subtree:true});
}
window.MT_pick=Object.freeze({scan,close});
if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',init);else init();
})();
