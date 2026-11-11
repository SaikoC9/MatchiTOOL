/* Language switch (review item 21). English is the text written in the page; a language is a dictionary English text -> translated text.
   The page's fixed labels (header, sign-in, the home buttons, the popup titles, buttons and placeholders listed in TARGETS) follow the switch.
   Not translated yet: messages the code builds while it runs (toasts, results, errors), the built-in tools' windows and plugins. They stay English.
   To add a language: add its code to LANGS and a dictionary to DICT with the same English keys as 'fil' (scripts/test_i18n.js lists what is missing).
   The choice is kept in localStorage 'matchi_lang'; with none saved the browser language decides. */
(function(){
  var LANGS={en:'English',fil:'Filipino'};
  var KEY='matchi_lang';
  var DICT={fil:{
    'Sign out':'Mag-sign out','End this session':'Tapusin ang session na ito','Reboot':'I-reboot','Reboot device':'I-reboot ang device',
    'Sign in':'Mag-sign in','Admin password':'Admin password','Connect':'Kumonekta',
    'Diagnostics':'Diagnostics','Log Basket':'Basket ng log','Full diagnose':'Buong diagnosis','USB':'USB','Firmware':'Firmware','Update':'I-update',
    'Terminal':'Terminal','Plugins':'Mga plugin','Password':'Password','Close':'Isara','Back to basket':'Bumalik sa basket',
    'Device diagnostics':'Diagnostics ng device','Run diagnostics':'Patakbuhin ang diagnostics',
    'Run full diagnose':'Patakbuhin ang buong diagnosis','Copy report':'Kopyahin ang ulat','Download .txt':'I-download ang .txt',
    'USB controls':'Mga kontrol ng USB','Enable debugging':'I-on ang debugging','Disable debugging':'I-off ang debugging','Refresh status':'I-refresh ang status',
    'Restore default USB mode':'Ibalik ang default na USB mode',
    'Firmware manifest inspector':'Tagasuri ng firmware manifest','Inspect manifest':'Suriin ang manifest',
    'Update MatchiTOOL':'I-update ang MatchiTOOL','Check file':'Suriin ang file','Install update':'I-install ang update','Check for update':'Tingnan kung may update',
    'Install online':'I-install online','Download APK':'I-download ang APK',
    'Root terminal':'Root terminal','Command, press Enter to run':'Command, pindutin ang Enter para patakbuhin',
    'Console password':'Password ng console','Current password':'Kasalukuyang password',
    'New console password (10+ characters)':'Bagong password ng console (10+ character)','Repeat new password':'Ulitin ang bagong password',
    'Set password':'I-set ang password','Use router password again':'Gamitin muli ang password ng router',
    'Export all':'I-export lahat','Import backup':'I-import ang backup','Refresh list':'I-refresh ang listahan',
    'Start logging':'Simulan ang pag-log','Stop logging':'Itigil ang pag-log','Pause':'I-pause','Copy':'Kopyahin','Log basket':'Basket ng log',
    'View':'Tingnan','Delete':'Burahin',
    /* Dashboard under #home (Live device status, Radio settings, Cell lock) and the tool buttons added by the built-in tools. Exact texts;
       tech terms (CPU, PCI, band names, RSRP...) stay English on purpose. */
    'Network Diagnostics':'Diagnostics ng network','Clean memory':'Linisin ang memory','Change IP':'Palitan ang IP','Screen control':'Kontrol ng screen',
    'Plugin actions':'Mga aksyon ng plugin','Live device status':'Live na status ng device','Connecting…':'Kumokonekta…',
    'Live refresh: On':'Live refresh: Naka-on','Live refresh: Off':'Live refresh: Naka-off',
    'Battery':'Baterya','System max':'Pinakamataas ng system','Devices':'Mga device','on Wi-Fi':'sa Wi-Fi','This month':'Ngayong buwan',
    'Core usage':'Gamit ng core','CPU frequency (MHz)':'Frequency ng CPU (MHz)',
    'Source: router API + modem · tap CPU for governor':'Pinagmulan: router API + modem · pindutin ang CPU para sa governor',
    'Refresh':'I-refresh','Fast':'Mabilis','Pause below':'I-pause kapag mas mababa sa',
    '▸ Cell lock':'▸ Cell lock','▾ Cell lock':'▾ Cell lock','Unlock all cells':'I-unlock lahat ng cell',
    'Auto-unlock if not registered after 60 s':'Auto-unlock kung hindi rehistrado pagkatapos ng 60 s',
    'reading…':'binabasa…','Lock by hand':'I-lock nang mano-mano','Lock cell':'I-lock ang cell',
    'Radio settings':'Mga setting ng radio','Lock ticked bands':'I-lock ang mga naka-tick na band','Unlock all':'I-unlock lahat','Reset ticks':'I-reset ang mga tick',
    'Network mode and bands apply to the whole router, not to one SIM slot. Read when this page opens and after a change, never on the live timer.':'Ang network mode at mga band ay para sa buong router, hindi sa isang SIM slot. Binabasa kapag binuksan ang page at pagkatapos ng pagbabago, hindi sa live timer.',
    'Green = locked on the router. Yellow = ticked, not saved yet. Struck through = locked now, will be removed.':'Berde = naka-lock sa router. Dilaw = naka-tick, hindi pa na-save. May guhit = naka-lock ngayon, tatanggalin.',
    'Warning: locking the wrong cell can leave the phone with no signal or an unstable one. Read when this card is opened or on Refresh, never on the live timer.':'Babala: ang pag-lock sa maling cell ay maaaring mawalan ng signal o maging hindi stable ang telepono. Binabasa kapag binuksan ang card o sa Refresh, hindi sa live timer.'
  }};
  /* Pieces of texts that carry a changing value (a number, a band list): replaced inside the text, in this order. */
  var SUBS={fil:[
    ['Live · updated','Live · na-update'],[' s ago',' s ang nakalipas'],
    ['LTE bands · locked now:','Mga LTE band · naka-lock ngayon:'],['5G NR bands · locked now:','Mga 5G NR band · naka-lock ngayon:'],
    ['none (all bands allowed)','wala (pinapayagan ang lahat ng band)']
  ]};
  /* [selector, what to translate]: 'text' = the element's own text, otherwise the attribute name. The English comes from the page itself. */
  var TARGETS=[
    ['#logoutbtn','text'],['#logoutbtn','title'],['#rebootbtn','text'],['#rebootbtn','title'],
    ['#login .lg-title','text'],['#tok','placeholder'],['#tokbtn','text'],
    ['#home button[onclick*="\'diagnostics\'"]','text'],['#home button[onclick*="\'logbasket\'"]','text'],['#home button[onclick*="\'selftest\'"]','text'],
    ['#home button[onclick*="\'usbtools\'"]','text'],['#home button[onclick*="\'firmware\'"]','text'],['#home button[onclick*="\'appupdate\'"]','text'],
    ['#home button[onclick*="\'terminal\'"]','text'],['#home button[onclick*="\'pluginmgr\'"]','text'],['#home button[onclick*="\'conpw\'"]','text'],
    ['.card.pop .popx','text'],['#logcatcher .popfoot button:not(.popx)','text'],
    ['#diagnostics > .mut:first-child','text'],['#diagbtn','text'],
    ['#selftest > .mut:first-child','text'],['#stbtn','text'],['#stcopy','text'],['#stdl','text'],
    ['#usbtools > .mut:first-child','text'],['#adbon','text'],['#adboff','text'],['#tetheroff','text'],['#usbrefresh','text'],
    ['#firmware > .mut:first-child','text'],['#fwinspect','text'],
    ['#appupdate > .mut:first-child','text'],['#updcheck','text'],['#updinstall','text'],['#updfetch','text'],['#updonline','text'],['#upddl','text'],
    ['#terminal > .mut:first-child','text'],['#cmd','placeholder'],
    ['#conpw > .mut:first-child','text'],['#conpwcur','placeholder'],['#conpwnew','placeholder'],['#conpwnew2','placeholder'],['#conpwset','text'],['#conpwoff','text'],
    ['#pluginmgr .pm-title','text'],['#plugin_refresh','title'],['#plugin_export','text'],['#plugin_import','text'],
    ['#lcstart','text'],['#lcstop','text'],['#lccopy','text'],['#logbasket .row > strong','text'],['#lbview','text'],['#lbcopy','text'],['#lbdelete','text']
  ];
  /* pure parts (scripts/test_i18n.js runs these) */
  function pickLang(saved,navLang){
    if(saved&&LANGS[saved])return saved;
    var n=String(navLang||'').toLowerCase();
    if(/^(fil|tl)(-|$)/.test(n))return 'fil';
    return 'en';
  }
  function translate(lang,en){var d=DICT[lang];return d&&Object.prototype.hasOwnProperty.call(d,en)?d[en]:en}
  function translateText(lang,en){
    var core=en.trim();if(!core)return en;
    var lead=en.slice(0,en.indexOf(core)),trail=en.slice(en.indexOf(core)+core.length),d=DICT[lang];
    if(!d)return en;
    var out;
    if(Object.prototype.hasOwnProperty.call(d,core))out=d[core];
    else{out=core;(SUBS[lang]||[]).forEach(function(s){out=out.split(s[0]).join(s[1])})}
    return lead+out+trail;
  }
  var core={LANGS:LANGS,DICT:DICT,TARGETS:TARGETS,SUBS:SUBS,pickLang:pickLang,translate:translate,translateText:translateText};
  if(typeof module!=='undefined'&&module.exports)module.exports=core;
  if(typeof document==='undefined')return;

  var lang='en';
  function read(el,what){return what==='text'?(el.textContent||'').trim():(el.getAttribute(what)||'')}
  function write(el,what,v){if(what==='text'){if(!el.children.length)el.textContent=v}else el.setAttribute(what,v)}
  /* Each target remembers its English text (data-mt-en-*) and what this script last wrote (data-mt-cur-*). If other code changed the text since
     (a button that flips between Start and Resume), it is left alone. */
  function apply(){
    TARGETS.forEach(function(t){
      var els;try{els=document.querySelectorAll(t[0])}catch(_){return}
      Array.prototype.forEach.call(els,function(el){
        var w=t[1],ek='mtEn'+w,ck='mtCur'+w,now=read(el,w);
        if(el.dataset[ek]===undefined){if(!now)return;el.dataset[ek]=now;el.dataset[ck]=now}
        else if(now!==el.dataset[ck])return;
        var out=translate(lang,el.dataset[ek]);
        if(out!==now){write(el,w,out)}
        el.dataset[ck]=out;
      });
    });
    document.documentElement.setAttribute('lang',lang);
    var sel=document.getElementById('langsel');if(sel)sel.value=lang;
    walk();
  }
  /* The dashboard and the tool buttons under #home are built (and rebuilt every few seconds) by other scripts, so their text cannot be listed in TARGETS.
     walk() goes over the text nodes under #home, translates the ones listed in DICT / SUBS, and remembers the English of each one it changed
     (touched) so that switching back restores it. A node whose text the page changed since is treated as new English. A MutationObserver runs it
     again after the page re-renders. Nodes that TARGETS already handles, and log or code areas, are skipped. */
  var ROOT='#home',touched=new Map(),obs=null,timer=0;
  var SKIP={SCRIPT:1,STYLE:1,TEXTAREA:1,PRE:1,CODE:1,INPUT:1};
  function isTarget(el){
    for(var i=0;i<TARGETS.length;i++){if(TARGETS[i][1]!=='text')continue;try{if(el.matches(TARGETS[i][0]))return true}catch(_){}}
    return false;
  }
  function walk(){
    var root=document.querySelector(ROOT);if(!root)return;
    touched.forEach(function(r,n){if(!n.isConnected)touched.delete(n)});
    var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null),n,list=[];
    while((n=w.nextNode()))list.push(n);
    list.forEach(function(n){
      var par=n.parentNode;if(!par||SKIP[par.nodeName]||isTarget(par))return;
      var cur=n.nodeValue,rec=touched.get(n),en=(rec&&cur===rec.out)?rec.en:cur;
      var out=lang==='en'?en:translateText(lang,en);
      if(out!==cur)n.nodeValue=out;
      if(out!==en)touched.set(n,{en:en,out:out});else touched.delete(n);
    });
  }
  function watch(){
    var root=document.querySelector(ROOT);if(!root||obs||typeof MutationObserver==='undefined')return;
    obs=new MutationObserver(function(){if(lang==='en'&&!touched.size)return;clearTimeout(timer);timer=setTimeout(walk,60)});
    obs.observe(root,{childList:true,subtree:true,characterData:true});
  }
  function setLang(l){
    if(!LANGS[l])return;lang=l;
    try{localStorage.setItem(KEY,l)}catch(_){}
    apply();
  }
  function build(){
    var hd=document.querySelector('header');if(!hd||document.getElementById('langsel'))return;
    var s=document.createElement('select');s.id='langsel';s.className='hd-reboot';s.style.marginRight='6px';
    s.setAttribute('aria-label','Language / Wika');s.title='Language / Wika';
    Object.keys(LANGS).forEach(function(k){var o=document.createElement('option');o.value=k;o.textContent=LANGS[k];s.appendChild(o)});
    s.addEventListener('change',function(){setLang(s.value)});
    var before=document.getElementById('logoutbtn');hd.insertBefore(s,before||null);
  }
  var saved='';try{saved=localStorage.getItem(KEY)||''}catch(_){}
  lang=pickLang(saved,navigator.language);
  build();apply();watch();
  window.MT_i18n=Object.freeze({t:function(en){return translate(lang,en)},lang:function(){return lang},setLang:setLang,refresh:apply});
})();
