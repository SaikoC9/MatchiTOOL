const fs=require('fs');
const path=require('path');
// SMS tool, new-message count (noteMsgs): runs the page's own code against a fake localStorage. Covers C6 (first message) and C7 (a repeated text after a delete).
const html=fs.readFileSync(path.join(__dirname,'..','app/src/main/assets/web/index.html'),'utf8');
const a=html.indexOf("const SEENKEY = 'matchi_sms_seen2';");
const b=html.indexOf("const label = () =>", a);
let code=html.slice(a,b);
const store={};
const localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=v}};
const harness=`let shown=0; const showBadge=()=>{shown=unread};\n${code}\nreturn {noteMsgs, get unread(){return unread}, get seen(){return seen}};`;
// 'let emptyRuns' and lowRuns are declared in the page before SEENKEY; recreate them here
const make=()=>{for(const k in store)delete store[k];return new Function('localStorage',harness)(localStorage)};
const m=(t,n='+639171234567')=>({out:false,number:n,text:t});
let ok=0; const eq=(x,y,msg)=>{ if(x!==y){console.error('FAIL',msg,x,y);process.exit(1)} ok++; };
// the sig() line is inside `code`; check it was captured
let t=make();
t.noteMsgs([m('X'),m('Y')],false); eq(t.unread,0,'first run is read');
t.noteMsgs([m('X'),m('Y')],false); eq(t.unread,0,'same list');
// delete one X, two checks show fewer, then a new identical X arrives
t.noteMsgs([m('Y')],false); eq(t.unread,0,'after delete 1');
t.noteMsgs([m('Y')],false); eq(t.unread,0,'after delete 2 (seen lowered)');
t.noteMsgs([m('X'),m('Y')],false); eq(t.unread,1,'new identical X counts');
// a single short read must not make old messages new
t=make(); t.noteMsgs([m('X'),m('Y')],false); t.noteMsgs([m('Y')],false); t.noteMsgs([m('X'),m('Y')],false); eq(t.unread,0,'one short read does not raise a badge');
// an empty answer needs 4 in a row
t=make(); t.noteMsgs([m('X')],false);
for(let i=0;i<3;i++) t.noteMsgs([],false);
t.noteMsgs([m('X')],false); eq(t.unread,0,'3 empties then back: no badge');
for(let i=0;i<4;i++) t.noteMsgs([],false);
t.noteMsgs([m('X')],false); eq(t.unread,1,'4 empties = really empty; X is new');
// fresh SIM first message (C6) still works
t=make(); t.noteMsgs([],false); t.noteMsgs([],false); t.noteMsgs([m('Hello')],false); eq(t.unread,1,'C6 first message counts');
console.log('c7 simulation ok ('+ok+' checks)');
