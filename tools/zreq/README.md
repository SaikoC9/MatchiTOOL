# zreq (own build)

A small HTTP client for the router's `goform` API. Written for MatchiTOOL from scratch: it is **not** the UFI-TOOLS binary
and does not promise identical output. It keeps the flag names, so most plugin calls work unchanged.

    zreq -params 'cmd=LD&multi_data=1'                       # GET  /goform/goform_get_cmd_process
    zreq -body 'goformId=SET_X&isTest=false'                 # POST /goform/goform_set_cmd_process
    zreq -pwd-file /data/local/matchitool/router.pw -params 'cmd=wan_ipaddr'    # sign in first, then GET

Flags: `-ip` (default 192.168.0.1, optional `:port`), `-method`, `-params`, `-body`, `-pwd`, `-pwd-file`, `-enc auto|ld|b64|raw`,
`-cookie`, `-path`, `-json`, `-v`, `-t` (seconds, default 10), `-version`.
Env: `ZREQ_PWD` (password), `ZREQ_COOKIE` (session cookie).

Output: the reply body exactly as received (`-json`: indented). Exit codes: 0 ok, 1 usage, 2 network, 3 sign-in refused,
4 HTTP status not 2xx, 5 reply not JSON (with `-json`).

## Differences from the UFI-TOOLS zreq (on purpose)
- No built-in default password. No `-pwd`/`-pwd-file`/`ZREQ_PWD` means the request is sent unauthenticated.
- Only a private, loopback or link-local IPv4 address is accepted for `-ip`.
- A wrong password is tried once, never retried (routers lock the login after a few failures).
- `-v` prints method, path and status only. Query, body, password and cookie never reach stderr, and network errors have the URL removed.
- GET adds `isTest=false` in front when `-params` does not name `isTest`.
- Redirects are reported, not followed. No proxy is used.

## Put it in the repo
    tools/zreq/{go.mod,main.go,main_test.go,README.md}
    .github/workflows/build-zreq.yml
Run the workflow, download `matchitool-zreq-arm64`, then do the device test below **before** copying `zreq` over
`app/src/main/assets/bin/zreq` and writing the new SHA-256 into `NOTICE.md` and `docs/BINARIES.md`
(`scripts/validate.sh` fails until it is there).

## Test on the F50
Tested on the F50 (see MatchiTOOL_Binaries_test_todo.txt): hash matches, `-version` = zreq 1.1, `cmd=LD` with no port finds 8080,
an explicit `:80` is refused, one sign-in with `-enc auto` worked and `cmd=modem_main_state` returned 200. The steps below stay as the
recipe for a new build.

    adb push zreq /data/local/tmp/ && adb shell chmod 755 /data/local/tmp/zreq
    /data/local/tmp/zreq -v -params 'cmd=LD'                       # unauthenticated GET, expect JSON
    /data/local/tmp/zreq -v -pwd-file /data/local/tmp/pw -params 'cmd=modem_main_state'
Open points (1 is confirmed on the F50; 2 and 3 were not checked):
1. Password encoding. Default `-enc auto` asks `cmd=LD` first: with an `LD` it sends `SHA256(SHA256(pw)+LD)` (upper-case hex, the F50 form,
   same as the app's ZteClient), without one it sends base64 (older firmware). `-enc ld|b64|raw` force one form. If sign-in returns
   `result=1` with the right password, look at what the router's own login page sends. **Do not loop on a failing sign-in: it can lock the login.**
   On the F50 run `scripts/zreq_f50_test.sh` (it also finds the web port).
2. Whether the get endpoint needs a cookie for the commands your plugins use.
3. Compare with the old binary on the calls your plugins make (`./zreq-old ...` vs `./zreq ...`) and note any difference in the output.
