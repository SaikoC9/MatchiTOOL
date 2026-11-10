# AT & Radio: router command formats (Phase 0)

Source: UFI-TOOLS 4.1.5 APK (`assets/script/main.js` and `requests.js`), de-obfuscated
(string table decoded; names and parameters read from the real call sites).
Nothing here was guessed. Where something could NOT be read from the code it says
**CAPTURE ON F50** and Phase 0 is not finished for that line until it is filled in.

## How the router is called

| | Router | MatchiTOOL (existing proxy) |
|---|---|---|
| Read | `GET /goform/goform_get_cmd_process?multi_data=1&cmd=a,b,c` | `POST /api/zte` `{"op":"get","params":{"multi_data":"1","cmd":"a,b,c"}}` |
| Write | `POST /goform/goform_set_cmd_process` form body `goformId=X&param=value` | `POST /api/zte` `{"op":"set","params":{"goformId":"X","param":"value"}}` (AD token added by `ZteClient`) |
| Success | JSON `{"result":"success"}` | same JSON in `data` |

All values are strings. UFI checks `result == "success"`.

## Commands confirmed from UFI's code

### 1. Network mode

| | |
|---|---|
| goformId | `SET_BEARER_PREFERENCE` |
| parameter | `BearerPreference` |
| values | `WL_AND_5G` = 5G/4G/3G (auto) · `LTE_AND_5G` = 5G NSA · `Only_5G` = 5G SA · `Only_LTE` = 4G only |
| read key | `net_select` (UFI marks the dropdown option whose value equals it) |
| UFI note | none; no reboot message |

Read key source: see "Read keys not yet confirmed" below.

### 2. LTE band lock

| | |
|---|---|
| goformId | `LTE_BAND_LOCK` |
| parameter | `lte_band_lock` |
| value | bands joined by `,` e.g. `1,3,28` |
| read | `cmd=lte_band_lock` returns the same comma list; UFI ticks the boxes by splitting on `,` |

### 3. NR band lock

| | |
|---|---|
| goformId | `NR_BAND_LOCK` |
| parameter | `nr_band_lock` |
| value | bands joined by `,` as **bare integers**, no `n` prefix, e.g. `41,78` (UFI strips a leading `n` and sorts) |
| read | `cmd=nr_band_lock` |
| band list | UFI's own `/getSupportNrBandList?slot=N` (AT-based); MatchiTOOL already has the AT equivalent |

How UFI sends them: one click on "Lock bands" posts BOTH `LTE_BAND_LOCK` and `NR_BAND_LOCK`
at the same time, each with the ticked bands of its own type (an empty string when none of
that type is ticked). It reports success if EITHER answer is `success`. **Phase 2 must
require BOTH to be `success`** and must refuse to send when nothing is ticked.

LTE values are bare integers too (UFI matches `data-band="1"` against the read list), but
this is inferred from the read side, not seen in a send. Confirm on the F50.

UFI's own note: "does not require reboot, just switch the network mode afterwards".
After a successful set UFI also runs an `AT+SFUN=4` / `AT+SFUN=5` sequence on SIM slots 0
and 1; the exact order is hidden by the obfuscation and one helper looks like it can do
nothing, so do NOT copy it. Phase 2 uses "re-apply network mode" instead, and the F50
test decides whether that is enough.

### 4. Cell lock and unlock

| | |
|---|---|
| lock goformId | `CELL_LOCK` |
| parameters | `pci`, `earfcn`, `rat` |
| `rat` | `12` = 4G (LTE), `16` = 5G (NR). UFI's own hint text: "lock 5G = 16, lock 4G = 12" |
| example in UFI | `pci=912`, `earfcn=504990` (a sample from its macro list, not a recommendation) |
| unlock goformId | `UNLOCK_ALL_CELL`, no parameters |
| read | `cmd=neighbor_cell_info,locked_cell_info` |

`neighbor_cell_info`: list of objects `{band, earfcn, pci, rsrp, rsrq, sinr}`.
`locked_cell_info`: list of objects `{earfcn, pci, rat}`; UFI shows 4G when `rat == "12"`, otherwise 5G.
Empty list means "No neighbor cells" / "No locked cell".

UFI tip: with refresh paused you can lock several cells one by one (so locks accumulate).
UFI warning text: "Locking wrong cell may cause no or unstable signal".

### 5. Performance mode

| | |
|---|---|
| goformId | `PERFORMANCE_MODE_SETTING` |
| parameter | `performance_mode` = `1` (on) or `0` (off) |
| UFI logic | reads the current value and sends the opposite |
| read key | `performance_mode` |
| UFI note | success toast is **"Success! Effective after reboot"** |

DIFFERENCE FROM THE PLAN: the plan treated this as an instant switch. UFI says it needs a
reboot. Phase 1 must say so in the confirm dialog and must not claim the change is live.
UFI's script-macro list also contains a different id, `PERFORMANCE_MODE`; the switch itself
uses `PERFORMANCE_MODE_SETTING`. Use only that one.

### 6. AT quick buttons (no router call)

Through the existing AT path: IMSI `AT+CIMI` · QoS `AT+CGEQOSRDP=1` (UFI itself re-polls it
every 10 s on screen; do not poll) · modem reboot `AT+SFUN=4` then `AT+SFUN=5`.

Not in scope: `SET_SIM_SLOT` (removed from the plan).

## Read keys not yet confirmed (CAPTURE ON F50)

UFI's main status poll (`goform_get_cmd_process`) does not request `net_select` or
`performance_mode`. UFI gets them from its own `/api/baseDeviceInfo`, so the router key behind
them could not be read from the app code. `lte_band_lock`, `nr_band_lock`,
`neighbor_cell_info`, `locked_cell_info` ARE read straight from the router, as shown above.

## Phase 0 on-device checklist (only the F50 can finish this)

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
| 7 | Find what "Unlock bands" sends (UFI's handler was not recoverable) | probably every supported band | |
| 8 | Note the value of the unlocked state in step 3 after step 7 | this is what "restore" must reproduce | |

Done when lines 1 to 8 are filled in. Until 1, 2, 3 and 7 are known, Phase 1 and 2 must
hide or disable the matching control instead of guessing.
