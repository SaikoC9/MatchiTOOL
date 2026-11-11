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
    'View':'Tingnan','Delete':'Burahin'
  }};
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
  var core={LANGS:LANGS,DICT:DICT,TARGETS:TARGETS,pickLang:pickLang,translate:translate};
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
  build();apply();
  window.MT_i18n=Object.freeze({t:function(en){return translate(lang,en)},lang:function(){return lang},setLang:setLang,refresh:apply});
})();
