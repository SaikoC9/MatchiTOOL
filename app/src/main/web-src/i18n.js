/* Language switch. English is the text written in the page; a language is a dictionary English text -> translated text.
   The page's fixed labels (header, sign-in, the home buttons, the popup titles, buttons and placeholders listed in TARGETS) follow the switch.
   Also translated (exact DICT texts only): the built-in tools' windows and the fixed toasts. Not translated: messages with a changing value built while it runs (results, errors), log / terminal output and plugins. They stay English.
   To add a language: add its code to LANGS and a dictionary to DICT with the same English keys as 'fil' (scripts/test_i18n.js lists what is missing).
   The choice is kept in localStorage 'matchi_lang'; with none saved the browser language decides. */
(function(){
  var LANGS={en:'English',fil:'Filipino'};
  var KEY='matchi_lang';
  var DICT={fil:{
    'Sign out':'Mag-sign out','End this session':'Tapusin ang session na ito','Reboot':'I-reboot','Reboot device':'I-reboot ang device',
    'Sign in':'Mag-sign in','Admin password':'Admin password','Connect':'Kumonekta',
    'Diagnostics':'Diagnostics','Log Basket':'Basket ng log','Full diagnose':'Buong diagnosis','USB':'USB','Firmware':'Firmware','Update':'I-update',
    'Clear':'Burahin','Copy output':'Kopyahin ang output','Terminal':'Terminal','Plugins':'Mga plugin','Password':'Password','Close':'Isara','Back to basket':'Bumalik sa basket',
    'Device diagnostics':'Diagnostics ng device','Run diagnostics':'Patakbuhin ang diagnostics',
    'Run full diagnose':'Patakbuhin ang buong diagnosis','Copy report':'Kopyahin ang ulat','Download .txt':'I-download ang .txt',
    'USB controls':'Mga kontrol ng USB','Enable debugging':'I-on ang debugging','Disable debugging':'I-off ang debugging','Auto':'Awtomatiko',
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
    'Core usage':'Gamit ng core','CPU frequency (MHz)':'Frequency ng CPU (MHz)','CPU frequency':'Frequency ng CPU',
    'Source: router API + modem · tap CPU for governor':'Pinagmulan: router API + modem · pindutin ang CPU para sa governor',
    'Refresh':'I-refresh','Fast':'Mabilis','Pause below':'I-pause kapag mas mababa sa',
    '▸ Cell lock':'▸ Cell lock','▾ Cell lock':'▾ Cell lock','Unlock all cells':'I-unlock lahat ng cell',
    'Auto-unlock if not registered after 60 s':'Auto-unlock kung hindi rehistrado pagkatapos ng 60 s',
    'reading…':'binabasa…','Lock by hand':'I-lock nang mano-mano','Lock cell':'I-lock ang cell',
    'Radio settings':'Mga setting ng radio','Lock ticked bands':'I-lock ang mga naka-tick na band','Unlock all':'I-unlock lahat','Reset ticks':'I-reset ang mga tick',
    'Applies to the whole router, not one SIM. Loads on open and after changes.':'Para sa buong router, hindi sa isang SIM. Binabasa pagbukas at pagkatapos ng pagbabago.',
    'Green: locked. Yellow: not saved. Strikethrough: will be removed.':'Berde: naka-lock. Dilaw: hindi pa na-save. May guhit: tatanggalin.',
    'Warning: the wrong cell can cause no signal or an unstable one.':'Babala: ang maling cell ay maaaring magdulot ng walang signal o hindi stable na signal.',
    /* Tool windows (AT & Radio, Screen control, Log basket, Diagnostics, USB, Firmware, Update, Plugins) and the Performance mode toasts. */
    'Performance mode':'Mode ng performance','Performance mode ON. Reboot to apply.':'Performance mode ON. I-reboot para ilapat.','Performance mode OFF. Reboot to apply.':'Performance mode OFF. I-reboot para ilapat.',
    'Performance mode not supported.':'Hindi suportado ang performance mode.',
    'Signal quality':'Kalidad ng signal','Registration':'Rehistrasyon','Modem info':'Impormasyon ng modem','NR bands':'Mga NR band','Restart modem':'I-restart ang modem',
    'Radio report':'Ulat ng radyo','Change IMEI':'Palitan ang IMEI','Apply':'Ilapat','AT command, e.g. AT+CSQ':'AT command, hal. AT+CSQ',
    'Back':'Bumalik','Recents':'Kamakailan','Wake':'Gisingin','Auto (smooth)':'Auto (makinis)','Low quality (fastest)':'Mababang kalidad (pinakamabilis)',
    'Medium quality':'Katamtamang kalidad','High quality (slower)':'Mataas na kalidad (mas mabagal)','Keyboard input for the device':'Keyboard input para sa device','Starting…':'Sinisimulan…',
    'Select all':'Piliin lahat','Live view':'Live view','Snapshot: before update':'Snapshot: bago mag-update','Snapshot: after update':'Snapshot: pagkatapos mag-update',
    'Hide private data in copies':'Itago ang pribadong data sa mga kopya','Full file (not just the last 500 lines)':'Buong file (hindi lang ang huling 500 linya)',
    'All':'Lahat','Errors':'Mga error','Plugins':'Mga plugin','Back to basket':'Bumalik sa basket',
    'Checks root, Android, network, storage and tools.':'Sinusuri ang root, Android, network, storage at mga tool.',
    'Tests all functions in one run. Read-only. No SMS sent. The report has no passwords or tokens.':'Sinusuri ang lahat ng function sa isang takbo. Read-only. Walang SMS na ipinapadala. Walang password o token ang ulat.',
    'USB Ethernet (tethering) mode. Same as the router\'s USB Internet Protocol setting.':'USB Ethernet (tethering) mode. Kapareho ng USB Internet Protocol na setting ng router.',
    'Unknown':'Hindi alam','Enabled':'Naka-enable','Disabled':'Naka-disable','CDC-ECM active':'Aktibo ang CDC-ECM','RNDIS active':'Aktibo ang RNDIS','No USB Ethernet mode detected':'Walang nakitang USB Ethernet mode',
    'Auto: the router chooses. Applies instantly, no restart. USB may drop briefly. Needs fresh sign-in and root.':'Auto: ang router ang pipili. Agad na inilalapat, walang restart. Maaaring maputol saglit ang USB. Kailangan ng bagong sign-in at root.',
    'Reads XML/scatter metadata and SHA-256. No flashing.':'Binabasa ang XML/scatter metadata at SHA-256. Walang flashing.',
    'Or update online.':'O mag-update online.',
    'Add plugin (.js file)':'Magdagdag ng plugin (.js file)','Search plugins':'Maghanap ng plugin','On':'Naka-on','Off':'Naka-off',
    'Cancel':'Kanselahin','Confirm':'Kumpirmahin','Next':'Susunod','Notice':'Paunawa','Network rules':'Mga network rule','Root over HTTP':'Root sa HTTP','Allow':'Payagan','Block':'I-block','Continue':'Magpatuloy',
    'Network rules…':'Mga network rule…','Root over HTTP…':'Root sa HTTP…',
    'Plugins run commands as root. Install only trusted code.':'Nagpapatakbo ng command bilang root ang mga plugin. Mag-install lang ng pinagkakatiwalaang code.'
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
    ['#usbtools > .mut:first-child','text'],['#adbon','text'],['#adboff','text'],['#tetheroff','text'],
    ['#firmware > .mut:first-child','text'],['#fwinspect','text'],
    ['#appupdate > .mut:first-child','text'],['#updcheck','text'],['#updinstall','text'],['#updfetch','text'],['#updonline','text'],['#upddl','text'],
    ['#terminal > .mut:first-child','text'],['#cmd','placeholder'],['#cmdrun','text'],['#cmdclear','text'],['#cmdcopy','text'],
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
  /* The dashboard, the tool windows (cards and modals) and the toasts are built, and rebuilt every second or so, by other scripts, so their text
     cannot be listed in TARGETS. walkTree() translates the text nodes (and placeholder / title attributes) of the nodes it is given: exact
     DICT texts everywhere; the SUBS pieces (texts with a changing number) only under #home. It remembers the English of each node it changed
     (touched) so that switching back restores it. A node whose text the page changed since is treated as new English.
     The MutationObserver translates what changed IN THE SAME MICROTASK, before the browser paints, so a text the page rewrites every second
     ("Live · updated 3 s ago") never shows its English for one frame. Its own edits are discarded with takeRecords(), so it cannot loop.
     Nodes that TARGETS already handles, and log or code areas, are skipped. */
  var touched=new Map(),atouched=new Map(),obs=null;
  var SKIP={SCRIPT:1,STYLE:1,TEXTAREA:1,PRE:1,CODE:1,INPUT:1};
  var ATTRS=['placeholder','title'];
  function isTarget(el){
    for(var i=0;i<TARGETS.length;i++){if(TARGETS[i][1]!=='text')continue;try{if(el.matches(TARGETS[i][0]))return true}catch(_){}}
    return false;
  }
  function inHome(n){var h=document.getElementById('home');return !!h&&h.contains(n)}
  function exactText(en){
    var core=en.trim();if(!core)return en;
    var d=DICT[lang];if(!d||!Object.prototype.hasOwnProperty.call(d,core))return en;
    return en.slice(0,en.indexOf(core))+d[core]+en.slice(en.indexOf(core)+core.length);
  }
  function textNode(n){
    var par=n.parentNode;if(!par||SKIP[par.nodeName]||isTarget(par))return;
    var cur=n.nodeValue,rec=touched.get(n),en=(rec&&cur===rec.out)?rec.en:cur;
    var out=lang==='en'?en:(inHome(n)?translateText(lang,en):exactText(en));
    if(out!==cur)n.nodeValue=out;
    if(out!==en)touched.set(n,{en:en,out:out});else touched.delete(n);
  }
  function attrs(el){
    if(SKIP[el.nodeName]&&el.nodeName!=='INPUT'&&el.nodeName!=='TEXTAREA')return;
    ATTRS.forEach(function(a){
      if(!el.hasAttribute(a)||(el.dataset&&el.dataset['mtEn'+a]!==undefined))return;
      var cur=el.getAttribute(a),m=atouched.get(el)||{},rec=m[a],en=(rec&&cur===rec.out)?rec.en:cur;
      var out=lang==='en'?en:exactText(en);
      if(out!==cur)el.setAttribute(a,out);
      if(out!==en){m[a]={en:en,out:out};atouched.set(el,m)}else if(rec){delete m[a];if(Object.keys(m).length)atouched.set(el,m);else atouched.delete(el)}
    });
  }
  function walkTree(root){
    if(!root)return;
    if(root.nodeType===3){textNode(root);return}
    if(root.nodeType!==1)return;
    if(SKIP[root.nodeName]&&root.nodeName!=='INPUT'&&root.nodeName!=='TEXTAREA')return;
    var w=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,null),n,list=[];
    while((n=w.nextNode()))list.push(n);
    if(root.hasAttribute)attrs(root);
    list.forEach(function(n){if(n.nodeType===3)textNode(n);else attrs(n)});
  }
  function walk(){
    touched.forEach(function(r,n){if(!n.isConnected)touched.delete(n)});
    atouched.forEach(function(r,el){if(!el.isConnected)atouched.delete(el)});
    walkTree(document.body);
    if(obs)obs.takeRecords();
  }
  function onMutations(recs){
    if(lang==='en'&&!touched.size&&!atouched.size)return;
    recs.forEach(function(r){
      if(r.type==='characterData')textNode(r.target);
      else if(r.type==='attributes')attrs(r.target);
      else Array.prototype.forEach.call(r.addedNodes,walkTree);
    });
    obs.takeRecords();
  }
  function watch(){
    if(obs||typeof MutationObserver==='undefined'||!document.body)return;
    obs=new MutationObserver(onMutations);
    obs.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:ATTRS});
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
