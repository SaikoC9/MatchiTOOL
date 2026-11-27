# AT & Radio: command formats

Router goform and modem AT formats as `radio-core.js` uses them.

## Router calls

| | Router | MatchiTOOL proxy |
|---|---|---|
| Read | `GET /goform/goform_get_cmd_process?multi_data=1&cmd=a,b,c` | `POST /api/zte` `{"op":"get","params":{"multi_data":"1","cmd":"a,b,c"}}` |
| Write | `POST /goform/goform_set_cmd_process` `goformId=X&param=value` | `POST /api/zte` `{"op":"set","params":{"goformId":"X","param":"value"}}` (`ZteClient` adds the AD token) |
| Success | `{"result":"success"}` | same JSON in `data` |

All values are strings. MatchiTOOL checks `result == "success"`.

## Commands

### 1. Network mode

- goformId `SET_BEARER_PREFERENCE`, parameter `BearerPreference`
- Values: `WL_AND_5G` = 5G/4G/3G auto; `LTE_AND_5G` = 5G NSA; `Only_5G` = 5G SA; `Only_LTE` = 4G only
- Read key: `net_select`. No reboot message.

### 2. LTE band lock

- goformId `LTE_BAND_LOCK`, parameter `lte_band_lock`, bands joined by `,` e.g. `1,3,28`
- Read: `cmd=lte_band_lock` returns the same list

### 3. NR band lock

- goformId `NR_BAND_LOCK`, parameter `nr_band_lock`, **bare integers** joined by `,` e.g. `41,78` (a leading `n` is stripped, list sorted)
- Read: `cmd=nr_band_lock`. Band list: `AT+SP5GCMDS="get nr support_band"` via AT.

"Lock bands" sends BOTH `LTE_BAND_LOCK` and `NR_BAND_LOCK`, each with its ticked bands. **Both must answer `success`.** Nothing is sent if nothing is ticked. LTE values are bare integers too.

No reboot is needed: switch the network mode afterwards. Radio restart: `AT+SFUN=5` on SIM slot 0 then 1 (off), then `AT+SFUN=4` on slot 0 then 1 (on), about 100 ms apart. Unisoc: 5 = off, 4 = on. `AT+SFUN?` is unsupported on the F50 (`+CME ERROR: 3`) and `AT+CFUN?` stays `1`: afterwards `AT+CEREG?` and `AT+C5GREG?` report stat 1 again. The whole sequence runs in one root call (`CYCLE_SH` in `radio-core.js`).

### 4. Cell lock and unlock

- Lock: `CELL_LOCK`, params `pci`, `earfcn`, `rat` (`12` = 4G LTE, `16` = 5G NR)
- Unlock: `UNLOCK_ALL_CELL`, no params
- Read: `cmd=neighbor_cell_info,locked_cell_info`
  - `neighbor_cell_info`: list of `{band, earfcn, pci, rsrp, rsrq, sinr}`
  - `locked_cell_info`: list of `{earfcn, pci, rat}`; `rat == "12"` is 4G, else 5G
  - Empty list = "No neighbor cells" / "No locked cell"

Locking several cells one by one accumulates locks. A wrong cell can give no or unstable signal.

### 5. Performance mode

- goformId `PERFORMANCE_MODE_SETTING`, param `performance_mode` = `1` or `0`. Read the current value, send the opposite.
- Read key: `performance_mode`
- **Effective after reboot.** The confirm dialog must say so. Use `PERFORMANCE_MODE_SETTING` only, not `PERFORMANCE_MODE`.

### 6. AT quick buttons (no router call)

IMSI `AT+CIMI`; QoS `AT+CGEQOSRDP=1` (do not poll); modem restart `AT+SFUN=5` then `AT+SFUN=4`, slots 0 and 1. Out of scope: `SET_SIM_SLOT`.

