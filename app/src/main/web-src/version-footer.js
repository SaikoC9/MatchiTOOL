(function(){
  var got=false;
  function paint(app){
    var f=document.getElementById('verfoot'),a=document.getElementById('verapp'),w=document.getElementById('verweb');
    if(!f||!a||!w)return;
    var web=(typeof PAGE_VERSION==='string')?PAGE_VERSION:'?';
    w.textContent=web==='?'?'?':'v'+web;
    if(app){a.textContent='v'+app;var diff=(web!=='?'&&app!==web);f.classList.toggle('warn',diff);f.title=diff?'App and web page versions differ - reload the page (Ctrl+F5)':''}
    else a.textContent='-';
  }
  function tick(){
    paint('');
    if(got||typeof TOKEN!=='string'||!TOKEN||typeof api!=='function')return;
    api('/api/ping').then(function(d){if(d&&d.version){got=true;paint(d.version)}}).catch(function(){});
  }
  window.addEventListener('load',tick);
  setInterval(function(){if(!got&&!document.hidden)tick()},3000);
})();
