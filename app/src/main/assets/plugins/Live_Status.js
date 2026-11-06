/*
 * Live Status - MatchiTOOL web-only dashboard plugin.
 * Read-only polling: modem signal/band + Android battery/thermal data.
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
  let timer=null, busy=false;
  const card=(label,value,sub='')=>`<div style="background:var(--panel2);border:1px solid var(--bd);border-radius:10px;padding:12px;min-width:0"><div class="mut" style="font-size:12px">${esc(label)}</div><div style="font-size:20px;font-weight:700;overflow-wrap:anywhere">${esc(value)}</div><div class="mut" style="font-size:11px">${esc(sub)}</div></div>`;
  function stop(){ if(timer)clearInterval(timer); timer=null; }
  async function refresh(){
    const root=document.getElementById(ID);
    if(!root||!root.classList.contains('show')){ stop(); return; }   // modal gone/closed: stop polling
    if(busy)return;                                                   // previous poll still running: don't pile up requests
    busy=true;
    try { await poll(root); } finally { busy=false; }
  }
  async function poll(root){
    const status=root.querySelector('#mls_status'); if(status)status.textContent='Updating…';
    let modem={}, android='', err='';
    try {
      const r=await api('/api/zte',{method:'POST',body:JSON.stringify({op:'get',params:{multi_data:'1',cmd:keys.join(',')}})});
      if(r.data && typeof r.data==='object')modem=r.data;
      else throw new Error('No modem data');
    } catch(e) { err='Modem unavailable: '+e.message; }
    try {
      const r=await api('/api/shell',{method:'POST',body:JSON.stringify({timeout:12000,cmd:
        `echo BATTERY; dumpsys battery 2>/dev/null | grep -E 'level:|status:|temperature:'; echo THERMAL; for f in /sys/class/thermal/thermal_zone*/temp; do [ -r "$f" ] && echo "$f=$(cat "$f" 2>/dev/null)"; done | head -12`})});
      android=r.content||'';
    } catch(e) { android=''; err+=(err?' · ':'')+'Battery/thermal unavailable: '+e.message; }
    const pick=(...v)=>v.find(x=>x!==undefined&&x!==null&&String(x).trim()!=='')??'—';
    const bat=android.match(/level:\s*(\d+)/i)?.[1];
    const st=android.match(/status:\s*(\d+)/i)?.[1];
    const temp=android.match(/temperature:\s*(\d+)/i)?.[1];
    const charge=({'1':'Unknown','2':'Charging','3':'Discharging','4':'Not charging','5':'Full'})[st]||'';
    const batteryTemp=temp?`${(Number(temp)/10).toFixed(1)} °C`:'—';
    const thermalVals=[...android.matchAll(/=(\d{4,6})\s*$/gm)].map(m=>Number(m[1])).filter(n=>n>0).map(n=>n>1000?n/1000:n);
    const systemTemp=thermalVals.length?`${Math.max(...thermalVals).toFixed(1)} °C`:'—';
    const bars=Number.parseInt(modem.signalbar,10);
    const signalBars=Number.isFinite(bars)?'▮'.repeat(Math.max(0,Math.min(5,bars)))+'▯'.repeat(Math.max(0,5-Math.max(0,Math.min(5,bars)))):'—';
    const values=[
      ['Network',pick(modem.network_type)],['Operator',pick(modem.network_provider)],
      ['Signal',signalBars],['LTE RSRP',pick(modem.lte_rsrp,modem.rssi)!=='—'?pick(modem.lte_rsrp,modem.rssi)+' dBm':'—'],
      ['LTE RSRQ',pick(modem.lte_rsrq)!=='—'?modem.lte_rsrq+' dB':'—'],
      ['LTE SINR',pick(modem.lte_snr)!=='—'?modem.lte_snr+' dB':'—'],
      ['LTE band',pick(modem.wan_active_band)],['LTE PCI / channel',`${pick(modem.lte_pci)} / ${pick(modem.wan_active_channel)}`],
      ['5G band',pick(modem.nr5g_action_band)],['5G RSRP',pick(modem.Z5g_rsrp)!=='—'?modem.Z5g_rsrp+' dBm':'—'],
      ['5G SINR',pick(modem.Z5g_SINR)!=='—'?modem.Z5g_SINR+' dB':'—'],['5G PCI / channel',`${pick(modem.nr5g_pci)} / ${pick(modem.nr5g_action_channel)}`],
      ['Battery',bat?bat+'%':'—',charge],['Battery temperature',batteryTemp],['System thermal max',systemTemp],
      ['Modem temperature',pick(modem.pm_sensor_mdm,modem.pm_modem_5g)]
    ];
    const grid=root.querySelector('#mls_grid'); if(grid)grid.innerHTML=values.map(v=>card(v[0],v[1],v[2]||'')).join('');
    const lock=root.querySelector('#mls_lock_note');
    if(lock)lock.textContent='Band-lock controls are shown as unavailable until the exact firmware-specific lock command is verified. No band settings have been changed.';
    if(status)status.textContent=(err?err+' · ':'')+'Last attempt '+new Date().toLocaleTimeString()+(timer?' · refreshes every 5 seconds':'');
  }
  function open(){
    createModal({name:ID,title:'Live device status',maxWidth:'760px',showConfirm:false,onClose:()=>{stop();return true;},
      content:`<div id="mls_status" class="mut" style="margin-bottom:10px">Connecting…</div>
      <div id="mls_grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px"></div>
      <div style="margin-top:14px;padding:12px;border:1px solid var(--bd);border-radius:10px">
        <strong>Band lock</strong><div id="mls_lock_note" class="mut" style="margin-top:6px">Checking firmware compatibility…</div>
        <button type="button" disabled title="Awaiting verified F50 firmware command" style="margin-top:8px;opacity:.55">Band lock unavailable</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px"><button type="button" id="mls_refresh">Refresh now</button><label class="mut"><input type="checkbox" id="mls_auto" checked style="width:auto"> Auto refresh (5 s)</label></div>`});
    showModal(ID);
    document.getElementById('mls_refresh').onclick=refresh;
    document.getElementById('mls_auto').onchange=e=>{stop();if(e.target.checked)timer=setInterval(refresh,5000);};
    stop();timer=setInterval(refresh,5000);refresh();
  }
  const host=document.querySelector('.actions-buttons'); if(!host)return;
  const b=document.createElement('button');b.id=BTN;b.textContent='Live Status';b.onclick=open;host.appendChild(b);
})();