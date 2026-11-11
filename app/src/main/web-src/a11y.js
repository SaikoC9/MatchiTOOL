/* Accessibility pass: gives form controls, dialogs, toasts and icon-only buttons the names and roles a screen reader needs. It runs once and again
   (debounced) when the page changes, because plugins build their own UI. It only adds missing attributes and never changes what is shown. */
(function(){
  function txt(n){return (n&&n.textContent||'').replace(/\s+/g,' ').trim().slice(0,80)}
  function nameFor(el){
    if(el.id){try{const l=document.querySelector('label[for="'+CSS.escape(el.id)+'"]');if(l&&txt(l))return ''}catch(_){}}
    const lab=el.closest&&el.closest('label');if(lab&&txt(lab))return '';
    let n=el.getAttribute('placeholder')||el.getAttribute('title')||'';
    if(!n&&el.type==='file')n='Choose file';
    if(!n){const p=el.nextSibling,q=el.previousSibling;n=txt(p&&p.nodeType===3?p:null)||txt(q&&q.nodeType===3?q:null)||txt(el.nextElementSibling&&el.nextElementSibling.children.length===0?el.nextElementSibling:null)}
    return n;
  }
  function pass(){
    try{
      document.querySelectorAll('input:not([type=hidden]):not([aria-label]):not([aria-labelledby]),select:not([aria-label]):not([aria-labelledby]),textarea:not([aria-label]):not([aria-labelledby])').forEach(function(el){const n=nameFor(el);if(n)el.setAttribute('aria-label',n)});
      document.querySelectorAll('button:not([aria-label])').forEach(function(b){if(!txt(b)&&b.title)b.setAttribute('aria-label',b.title)});
      document.querySelectorAll('.modal:not([role])').forEach(function(m){m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');const t=txt(m.querySelector('.title'));if(t)m.setAttribute('aria-label',t)});
      const ts=document.getElementById('toasts');if(ts&&!ts.getAttribute('aria-live')){ts.setAttribute('role','status');ts.setAttribute('aria-live','polite')}
    }catch(_){}
  }
  let tm=0;
  function later(){if(tm)return;tm=setTimeout(function(){tm=0;pass()},500)}
  pass();
  try{new MutationObserver(later).observe(document.body,{childList:true,subtree:true})}catch(_){}
})();

/* Accessibility pass 2 (review item 19): dialog focus, Escape, keyboard for click-only elements, live regions and tab semantics.
   Like pass 1 it only adds behaviour and attributes; what is shown does not change. Dialogs it knows: the page's own popups (.card.pop.open,
   closed with closePop()) and plugin modals (.modal-bg.show, closed through their own .mclose button). */
(function(){
  var FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';
  var opener=null,lastTop=null,lastOutside=null;
  function visible(el){return !!(el.offsetWidth||el.offsetHeight||el.getClientRects().length)}
  function topDialog(){
    var mods=document.querySelectorAll('.modal-bg.show .modal');if(mods.length)return mods[mods.length-1];
    return document.querySelector('.card.pop.open');
  }
  function focusables(d){return Array.prototype.filter.call(d.querySelectorAll(FOCUSABLE),visible)}
  function nameCard(c){
    if(c.getAttribute('aria-label')||c.getAttribute('aria-labelledby'))return;
    var t=c.querySelector('.pm-title,.mut,strong,h3');var s=t&&(t.textContent||'').replace(/\s+/g,' ').trim();
    if(s)c.setAttribute('aria-label',s.slice(0,80));
  }
  function onDialogChange(){
    var top=topDialog();
    if(top===lastTop)return;
    var bg=document.getElementById('popbg');if(bg)bg.setAttribute('aria-hidden','true');
    /* the button that opened the dialog: the last element focused while no dialog was open (a popup may move focus itself before this runs) */
    if(top&&!lastTop){opener=lastOutside&&document.contains(lastOutside)?lastOutside:null}
    if(top){
      if(top.classList.contains('pop')){top.setAttribute('role','dialog');top.setAttribute('aria-modal','true');nameCard(top)}
      if(!top.hasAttribute('tabindex'))top.setAttribute('tabindex','-1');
      /* keep focus where the person already is when it is inside the dialog (the terminal focuses its own input) */
      if(!top.contains(document.activeElement)){
        var f=focusables(top).filter(function(e){return !e.classList.contains('popx')&&!e.classList.contains('mclose')});
        (f[0]||top).focus({preventScroll:true});
      }
    }else if(opener&&document.contains(opener)&&visible(opener)){try{opener.focus({preventScroll:true})}catch(_){}opener=null}
    else opener=null;
    lastTop=top;
  }
  document.addEventListener('focusin',function(e){if(!topDialog()&&e.target&&e.target!==document.body)lastOutside=e.target},true);
  document.addEventListener('keydown',function(e){
    var d=topDialog();
    if(e.key==='Escape'&&d){
      if(d.classList.contains('pop')){if(typeof closePop==='function'){closePop();e.preventDefault()}}
      else{var c=d.querySelector('.mclose');if(c){c.click();e.preventDefault()}}
      return;
    }
    if(e.key==='Tab'&&d){
      var f=focusables(d);if(!f.length){e.preventDefault();d.focus();return}
      var first=f[0],last=f[f.length-1],a=document.activeElement;
      if(!d.contains(a)){e.preventDefault();first.focus()}
      else if(e.shiftKey&&(a===first||a===d)){e.preventDefault();last.focus()}
      else if(!e.shiftKey&&a===last){e.preventDefault();first.focus()}
      return;
    }
    /* Enter / Space on a click-only element that pass 2 made a button */
    var t=e.target;
    if((e.key==='Enter'||e.key===' ')&&t&&t.getAttribute&&t.getAttribute('data-a11y-kb')==='1'){e.preventDefault();t.click()}
  },true);
  function pass2(){
    try{
      document.querySelectorAll('[onclick]:not(button):not(a):not(input):not(select):not(textarea):not(summary):not(label):not(#popbg):not([data-a11y-kb])').forEach(function(el){
        if(!el.hasAttribute('role'))el.setAttribute('role','button');
        if(!el.hasAttribute('tabindex'))el.setAttribute('tabindex','0');
        el.setAttribute('data-a11y-kb','1');
      });
      document.querySelectorAll('.pm-seg').forEach(function(s){
        s.setAttribute('role','tablist');
        s.querySelectorAll('button').forEach(function(b){b.setAttribute('role','tab');b.setAttribute('aria-selected',b.classList.contains('on')?'true':'false')});
      });
      ['tokerr','conpwmsg','lcbootbtnhint'].forEach(function(id){var n=document.getElementById(id);if(n&&id!=='lcbootbtnhint'&&!n.getAttribute('aria-live')){n.setAttribute('role','status');n.setAttribute('aria-live','polite')}});
      var b=document.getElementById('collapseBtn_menu'),w=b&&b.nextElementSibling;
      if(b&&w){var open=!w.hasAttribute('hidden');b.setAttribute('aria-expanded',open?'true':'false')}
      onDialogChange();
    }catch(_){}
  }
  var tm=0;function later(){if(tm)return;tm=setTimeout(function(){tm=0;pass2()},120)}
  pass2();
  try{new MutationObserver(later).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden']})}catch(_){}
  window.MT_a11y=Object.freeze({refresh:pass2});
})();
