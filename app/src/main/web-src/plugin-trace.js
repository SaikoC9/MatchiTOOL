/* Plugin trace (1.4.1): every root command or upload a plugin sends carries the plugin's file name in the header x-matchi-plugin, so the
   host can remember what that plugin wrote and erase it when the plugin is deleted. The name comes from the plugin script's own stack
   frame ("matchi-plugin/NAME", set by pluginSrcUrl), so it needs no change in the plugin and also covers plugins that call fetch() directly.
   Calls the page makes for itself have no plugin frame and carry no header. Best effort: a call made from a place that has lost the
   plugin frame (some old browsers, code run through eval of a string) is not attributed. */
function pluginFromStack(stack){const m=/matchi-plugin\/([A-Za-z0-9._-]{1,80}\.(?:js|html))/.exec(String(stack||''));return m?m[1]:null}
function pluginTraceInit(url,init,stack){
  const path=String(url||'').replace(/^https?:\/\/[^/]+/,'');
  if(!/^\/api\/(shell|root_shell|user_shell|upload|upload_img)(\?|$)/.test(path))return init;
  const name=pluginFromStack(stack);if(!name)return init;
  const out=Object.assign({},init||{});const h=new Headers(out.headers||{});
  if(!h.has('x-matchi-plugin'))h.set('x-matchi-plugin',name);
  out.headers=h;return out;
}
(function(){
  if(typeof window==='undefined'||typeof window.fetch!=='function'||window.__matchiTraceFetch)return;
  const orig=window.fetch;window.__matchiTraceFetch=true;
  window.fetch=function(input,init){
    try{
      const url=typeof input==='string'?input:(input&&input.url)||'';
      /* a Request object keeps its own headers: only string URLs are traced */
      if(typeof input==='string'){const next=pluginTraceInit(url,init,new Error().stack);if(next!==init&&next!==undefined)init=next}
    }catch(_){}
    return orig.call(this,input,init);
  };
})();
