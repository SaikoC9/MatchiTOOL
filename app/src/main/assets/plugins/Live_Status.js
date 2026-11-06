/*
 * Live Status - MatchiTOOL web-only dashboard plugin (read-only).
 * Sources, merged in this order of preference:
 *   1. Router web API (/api/zte) - skipped for 60 s after a connection failure
 *   2. Android telephony (dumpsys telephony.registry) + battery/thermal via root shell
 *   3. Modem AT commands (COPS / CSQ / CESQ / CEREG) via /api/at
 * Band-lock writes are intentionally not enabled until the exact F50 firmware
 * command and rollback path are verified.
 */
(() => {
  'use strict';
  const ID='matchi_live_status', BTN='matchi_live_status_btn';
  if(document.getElementById(BTN)) return;
  const esc=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const keys=[
    'network_type','network_provider','signalbar','rssi','lte_rsrp','lte_rsrq',
    'lte_snr','lte_pci','wan_active_band','wan_active_channel',
    'Z5g_rsrp','Z5g_rsrq','Z5g_SINR','nr5g_pci','nr5g_action_band','nr5g_action_channel',
    'pm_sensor_mdm','pm_modem_5g'
  ];
  const ACT={'0':'2G','1':'2G','2':'3G','3':'2G EDGE','4':'3G HSDPA','5':'3G HSUPA','6':'3G HSPA','7':'4G LTE','10':'4G (5GC)','11':'5G SA','12':'5G (NG-RAN)','13':'5G NSA'};
  const PLMN={'51502':'Globe','51503':'Smart','51566':'DITO'};
  const REG={'0':'Not registered','1':'Registered (home)','2':'Searching','3':'Denied','4':'Unknown','5':'Registered (roaming)'};
  let timer=null, busy=false, zteSkipUntil=0, zteNote='';
  const card=(label,value,sub='')=>`<div style="background:var(--panel2);border:1px solid var(--bd);border-radius:10px;padding:12px;min-width:0"><div class="mut" style="font-size:12px">${esc(label)}</div><div style="font-size:20px;font-weight:700;overflow-wrap:anywhere">${esc(value)}</div><div class="mut" style="font-size:11px">${esc(sub)}</div></div>`;
  const has=v=>v!==undefined&&v!==null&&String(v).trim()!==''&&String(v).trim()!=='—';
  const pick=(...v)=>{const x=v.find(has);return x===undefined?'—':x;};
  const withUnit=(v,u)=>has(v)?v+' '+u:'—';
  const range=(v,lo,hi)=>{const n=Number(v);return Number.isFinite(n)&&n>=lo&&n<=hi?n:undefined;};
  const grab=(re,t)=>{const m=String(t).match(re);return m?m[1]:undefined;};
  const atRun=async c=>{try{const r=await api('/api/at',{method:'POST',body:JSON.stringify({command:c,slot:0})});return String(r.result||'');}catch(e){return '';}};
  function stop(){ if(timer)clearInterval(timer); timer=null; }
  async function refresh(){
    const root=document.getElementById(ID);
    if(!root||!root.classList.contains('show')){ stop(); return; }   // modal gone/closed: stop polling
    if(busy)return;                                                   // previous poll still running
    busy=true;
    try { await poll(root); } finally { busy=false; }
  }
  async function poll(root){
    const status=root.querySelector('#mls_status'); if(status)status.textContent='Updating…';
    let zte={}, errs=[], sh='', tele='';
    // 1. Router web API (backs off after a connection failure so it can't stall every poll)
    if(Date.now()>=zteSkipUntil){
      try{
        const r=await api('/api/zte',{method:'POST',body:JSON.stringify({op:'get',params:{multi_data:'1',cmd:keys.join(',')}})});
        if(r.data&&typeof r.data==='object'){zte=r.data;zteNote='';} else throw new Error('No modem data');
      }catch(e){ zteSkipUntil=Date.now()+60000; zteNote='Router web API unreachable ('+e.message+') - using Android telephony + AT instead; retrying it every minute.'; }
    }
    // 2. Battery, thermal zones, Android telephony (one root shell call)
    try{
      const r=await api('/api/shell',{method:'POST',body:JSON.stringify({timeout:12000,cmd:
        'echo BATTERY; dumpsys battery 2>/dev/null | grep -E "level:|status:|temperature:"; echo THERMAL; for z in /sys/class/thermal/thermal_zone*; do [ -r "$z/temp" ] && echo "Z:$(cat "$z/type" 2>/dev/null)=$(cat "$z/temp" 2>/dev/null)"; done; echo TELEPHONY; dumpsys telephony.registry 2>/dev/null | grep -E "mSignalStrength|mServiceState|mCellIdentity|mCellInfo" | head -30'})});
      sh=String(r.content||'');
      tele=sh.split('TELEPHONY')[1]||'';
    }catch(e){ errs.push('Shell unavailable: '+e.message); }
    // 3. Modem AT commands
    const cops=await atRun('AT+COPS?'), csq=await atRun('AT+CSQ'), cesq=await atRun('AT+CESQ'), cereg=await atRun('AT+CEREG?');
    const cm=cops.match(/\+COPS:\s*\d+,\d+,"([^"]*)",(\d+)/);
    const plmn=cm?cm[1]:undefined, act=cm?ACT[cm[2]]:undefined;
    const q=csq.match(/\+CSQ:\s*(\d+),/); const csqN=q?Number(q[1]):NaN;
    const csqDbm=(csqN>=0&&csqN<=31)?(-113+2*csqN):undefined;
    const e=cesq.match(/\+CESQ:\s*(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/);
    const cesqRsrq=e&&Number(e[5])<=34?(-19.5+0.5*Number(e[5])):undefined;
    const cesqRsrp=e&&Number(e[6])<=97?(-140+Number(e[6])):undefined;
    const regStat=grab(/\+CEREG:\s*\d+,(\d)/,cereg);
    // Android telephony fields (2147483647 / out-of-range = unavailable)
    const tLteRsrp=range(grab(/CellSignalStrengthLte[^\n]*?\brsrp\s*=\s*(-?\d+)/,tele),-140,-40);
    const tLteRsrq=range(grab(/CellSignalStrengthLte[^\n]*?\brsrq\s*=\s*(-?\d+)/,tele),-34,3);
    const tLteSnr=range(grab(/CellSignalStrengthLte[^\n]*?\brssnr\s*=\s*(-?\d+)/,tele),-23,40);
    const tNrRsrp=range(grab(/\bssRsrp\s*=\s*(-?\d+)/,tele),-140,-40);
    const tNrSinr=range(grab(/\bssSinr\s*=\s*(-?\d+)/,tele),-23,40);
    const tNrRsrq=range(grab(/\bssRsrq\s*=\s*(-?\d+)/,tele),-43,20);
    const tBands=grab(/\bbands\s*=\s*\[([^\]]*)\]/i,tele);
    const tPci=grab(/\bmPci\s*=\s*(\d+)/,tele), tChan=grab(/\bm(?:Nr)?(?:Arfcn|Earfcn)\s*=\s*(\d+)/i,tele);
    // battery / thermal
    const bat=grab(/level:\s*(\d+)/i,sh), st=grab(/status:\s*(\d+)/i,sh), temp=grab(/temperature:\s*(\d+)/i,sh);
    const charge=({'1':'Unknown','2':'Charging','3':'Discharging','4':'Not charging','5':'Full'})[st]||'';
    const zones=[...sh.matchAll(/^Z:([^=\n]*)=(-?\d+)\s*$/gm)].map(m=>({t:m[1].trim(),v:Number(m[2])>1000?Number(m[2])/1000:Number(m[2])})).filter(z=>z.v>0&&z.v<150);
    const sysMax=zones.length?Math.max(...zones.map(z=>z.v)):undefined;
    const mz=zones.filter(z=>/nr|mdm|modem/i.test(z.t)); const modemTemp=mz.length?Math.max(...mz.map(z=>z.v)):undefined;
    const bars=Number.parseInt(zte.signalbar,10);
    const signalBars=Number.isFinite(bars)?'▮'.repeat(Math.max(0,Math.min(5,bars)))+'▯'.repeat(5-Math.max(0,Math.min(5,bars))):(has(csqDbm)?csqDbm+' dBm':'—');
    const values=[
      ['Network',pick(zte.network_type,act)],['Operator',pick(zte.network_provider,PLMN[plmn],plmn)],
      ['Registration',pick(REG[regStat])],['Signal',signalBars],
      ['LTE RSRP',withUnit(pick(zte.lte_rsrp,tLteRsrp,cesqRsrp,zte.rssi),'dBm')],
      ['LTE RSRQ',withUnit(pick(zte.lte_rsrq,tLteRsrq,cesqRsrq),'dB')],
      ['LTE SINR',withUnit(pick(zte.lte_snr,tLteSnr),'dB')],
      ['LTE band',pick(zte.wan_active_band,tBands)],['LTE PCI / channel',`${pick(zte.lte_pci,tPci)} / ${pick(zte.wan_active_channel,tChan)}`],
      ['5G band',pick(zte.nr5g_action_band)],['5G RSRP',withUnit(pick(zte.Z5g_rsrp,tNrRsrp),'dBm')],
      ['5G RSRQ',withUnit(pick(zte.Z5g_rsrq,tNrRsrq),'dB')],['5G SINR',withUnit(pick(zte.Z5g_SINR,tNrSinr),'dB')],
      ['5G PCI / channel',`${pick(zte.nr5g_pci)} / ${pick(zte.nr5g_action_channel)}`],
      ['Battery',bat?bat+'%':'—',charge],['Battery temperature',temp?`${(Number(temp)/10).toFixed(1)} °C`:'—'],
      ['System thermal max',has(sysMax)?sysMax.toFixed(1)+' °C':'—'],
      ['Modem temperature',has(modemTemp)?modemTemp.toFixed(1)+' °C':pick(zte.pm_sensor_mdm,zte.pm_modem_5g)]
    ];
    const grid=root.querySelector('#mls_grid'); if(grid)grid.innerHTML=values.map(v=>card(v[0],v[1],v[2]||'')).join('');
    const raw=root.querySelector('#mls_raw');
    if(raw)raw.textContent=[zteNote||'Router web API: used','AT+COPS?: '+cops.trim(),'AT+CSQ: '+csq.trim(),'AT+CESQ: '+cesq.trim(),'AT+CEREG?: '+cereg.trim(),'','telephony.registry:',tele.trim()||'(no output)'].join('\n');
    const lock=root.querySelector('#mls_lock_note');
    if(lock)lock.textContent='Band-lock controls are shown as unavailable until the exact firmware-specific lock command is verified. No band settings have been changed.';
    const msg=errs.filter(Boolean).join(' · ');
    if(status)status.textContent=(msg?msg+' · ':'')+'Last attempt '+new Date().toLocaleTimeString()+(zteNote?' · source: modem AT + Android telephony':'')+(timer?' · refreshes every 5 seconds':'');
  }
  function open(){
    createModal({name:ID,title:'Live device status',maxWidth:'760px',showConfirm:false,onClose:()=>{stop();return true;},
      content:`<div id="mls_status" class="mut" style="margin-bottom:10px">Connecting…</div>
      <div id="mls_grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px"></div>
      <div style="margin-top:14px;padding:12px;border:1px solid var(--bd);border-radius:10px">
        <strong>Band lock</strong><div id="mls_lock_note" class="mut" style="margin-top:6px">Checking firmware compatibility…</div>
        <button type="button" disabled title="Awaiting verified F50 firmware command" style="margin-top:8px;opacity:.55">Band lock unavailable</button>
      </div>
      <details style="margin-top:12px"><summary class="mut">Raw modem / telephony output</summary><pre id="mls_raw" class="mut" style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;max-height:220px;overflow:auto"></pre></details>
      <div style="display:flex;gap:8px;margin-top:12px"><button type="button" id="mls_refresh">Refresh now</button><label class="mut"><input type="checkbox" id="mls_auto" checked style="width:auto"> Auto refresh (5 s)</label></div>`});
    showModal(ID);
    document.getElementById('mls_refresh').onclick=refresh;
    document.getElementById('mls_auto').onchange=e=>{stop();if(e.target.checked)timer=setInterval(refresh,5000);};
    stop();timer=setInterval(refresh,5000);refresh();
  }
  const host=document.querySelector('.actions-buttons'); if(!host)return;
  const b=document.createElement('button');b.id=BTN;b.textContent='Live Status';b.onclick=open;host.appendChild(b);
})();
