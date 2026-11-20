# AT & Radio: router command formats

Formats of the router web API (goform) and of the modem's AT commands, as `radio-core.js` uses them.
Where a format is not confirmed it says **CAPTURE ON F50**, and that line is not final until it is filled in.

## How the router is called

| | Router | MatchiTOOL (existing proxy) |
|---|---|---|
| Read | `GET /goform/goform_get_cmd_process?multi_data=1&cmd=a,b,c` | `POST /api/zte` `{"op":"get","params":{"multi_data":"1","cmd":"a,b,c"}}` |
| Write | `POST /goform/goform_set_cmd_process` form body `goformId=X&param=value` | `POST /api/zte` `{"op":"set","params":{"goformId":"X","param":"value"}}` (AD token added by `ZteClient`) |
| Success | JSON `{"result":"success"}` | same JSON in `data` |

All values are strings. MatchiTOOL checks `result == "success"`.

## Commands

### 1. Network mode

| | |
|---|---|
| goformId | `SET_BEARER_PREFERENCE` |
| parameter | `BearerPreference` |
| values | `WL_AND_5G` = 5G/4G/3G (auto) · `LTE_AND_5G` = 5G NSA · `Only_5G` = 5G SA · `Only_LTE` = 4G only |
| read key | `net_select` |
| note | none; no reboot message |

Read key source: see "Read keys not yet confirmed" below.

### 2. LTE band lock

| | |
|---|---|
| goformId | `LTE_BAND_LOCK` |
| parameter | `lte_band_lock` |
| value | bands joined by `,` e.g. `1,3,28` |
| read | `cmd=lte_band_lock` returns the same comma list |

### 3. NR band lock

| | |
|---|---|
| goformId | `NR_BAND_LOCK` |
| parameter | `nr_band_lock` |
| value | bands joined by `,` as **bare integers**, no `n` prefix, e.g. `41,78` (a leading `n` is stripped and the list is sorted) |
| read | `cmd=nr_band_lock` |
| band list | `AT+SP5GCMDS="get nr support_band"` through the AT path |

"Lock bands" sends BOTH `LTE_BAND_LOCK` and `NR_BAND_LOCK`, each with the ticked bands of its own
type. **Both answers must be `success`**, and nothing is sent when nothing is ticked.

LTE values are bare integers too; this is inferred from the read side. Confirm on the F50.

A band lock needs no reboot: switch the network mode afterwards. The radio restart sequence
is `AT+SFUN=5` on SIM slot 0, then slot 1 (radio OFF), then
`AT+SFUN=4` on slot 0, then slot 1 (radio ON), about 100 ms apart. Meaning on this modem
(Unisoc): 5 = off, 4 = on. `AT+SFUN?` is not supported on the F50 (`+CME ERROR: 3`) and
`AT+CFUN?` stays `1` through the sequence, so the meaning is confirmed only indirectly:
after the sequence `AT+CEREG?` and `AT+C5GREG?` both report stat 1 again. MatchiTOOL runs
the whole sequence on the device in one root call (`CYCLE_SH` in `radio-core.js`).

### 4. Cell lock and unlock

| | |
|---|---|
| lock goformId | `CELL_LOCK` |
| parameters | `pci`, `earfcn`, `rat` |
| `rat` | `12` = 4G (LTE), `16` = 5G (NR) |
| unlock goformId | `UNLOCK_ALL_CELL`, no parameters |
| read | `cmd=neighbor_cell_info,locked_cell_info` |

`neighbor_cell_info`: list of objects `{band, earfcn, pci, rsrp, rsrq, sinr}`.
`locked_cell_info`: list of objects `{earfcn, pci, rat}`; `rat == "12"` is 4G, otherwise 5G.
Empty list means "No neighbor cells" / "No locked cell".

Locking several cells one by one makes the locks accumulate. Locking a wrong cell may cause no or unstable signal.

### 5. Performance mode

| | |
|---|---|
| goformId | `PERFORMANCE_MODE_SETTING` |
| parameter | `performance_mode` = `1` (on) or `0` (off) |
| logic | read the current value and send the opposite |
| read key | `performance_mode` |
| note | **effective after reboot** |

This is not an instant switch: it needs a reboot. The confirm dialog must say so and must not claim the change is live.
Use `PERFORMANCE_MODE_SETTING` only (not `PERFORMANCE_MODE`).

### 6. AT quick buttons (no router call)

Through the existing AT path: IMSI `AT+CIMI` · QoS `AT+CGEQOSRDP=1` (do not poll it) · modem restart `AT+SFUN=5` (off) then `AT+SFUN=4` (on), slots 0 and 1.

Not in scope: `SET_SIM_SLOT`.

## Read keys not yet confirmed (CAPTURE ON F50)

`net_select` and `performance_mode` are not part of the router's usual status poll, so the router key behind
them is not confirmed (see the checklist below). `lte_band_lock`, `nr_band_lock`,
`neighbor_cell_info`, `locked_cell_info` are read straight from the router, as shown above.

## On-device checklist (only the F50 can finish this)

Do this with MatchiTOOL's own `/api/zte` get or the router page, change nothing.
Paste the raw JSON in the Result column.

| # | Request | Expect | Result |
|---|---|---|---|
| 1 | get `cmd=net_select` | a value like `WL_AND_5G`. If empty, try `cmd=BearerPreference`, then hide the control | |
| 2 | get `cmd=performance_mode` | `0` or `1`. If empty, hide the control | |
| 3 | get `cmd=lte_band_lock,nr_band_lock` | comma lists, or "all"/empty when unlocked. Note exactly what "no lock" looks like | |
| 4 | get `cmd=neighbor_cell_info,locked_cell_info` | lists as described above | |
| 5 | On the router page set network mode to the current value, copy the POST body | `goformId=SET_BEARER_PREFERENCE&BearerPreference=...` | |
| 6 | Same for one band: re-save the CURRENT band list, copy both POST bodies | bare integers, comma joined | |
| 7 | Find what "Unlock bands" sends on the router page | probably every supported band | |
| 8 | Note the value of the unlocked state in step 3 after step 7 | this is what "restore" must reproduce | |

Done when lines 1 to 8 are filled in. Until 1, 2, 3 and 7 are known, the matching control must
be hidden or disabled instead of guessing.
