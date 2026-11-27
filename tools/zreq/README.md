# zreq

Small HTTP client for the router's `goform` API. Written from scratch for MatchiTOOL, **not** the UFI-TOOLS binary; output may differ. Flag names are kept, so most plugin calls work unchanged.

    zreq -params 'cmd=LD&multi_data=1'                      # GET  /goform/goform_get_cmd_process
    zreq -body 'goformId=SET_X&isTest=false'                # POST /goform/goform_set_cmd_process
    zreq -pwd-file /data/local/matchitool/router.pw -params 'cmd=wan_ipaddr'   # sign in, then GET

Flags: `-ip` (default 192.168.0.1, optional `:port`), `-method`, `-params`, `-body`, `-pwd`, `-pwd-file`, `-enc auto|ld|b64|raw`, `-cookie`, `-path`, `-json`, `-v`, `-t` (s, default 10), `-version`. Env: `ZREQ_PWD`, `ZREQ_COOKIE`.

Output: reply body as received (`-json`: indented). Exit: 0 ok, 1 usage, 2 network, 3 sign-in refused, 4 HTTP not 2xx, 5 reply not JSON (`-json`).

## Differences from the UFI-TOOLS zreq (on purpose)

- No built-in password. Without `-pwd`, `-pwd-file` or `ZREQ_PWD` the request is unauthenticated.
- `-ip` accepts only private, loopback or link-local IPv4.
- A wrong password is tried once, never retried (routers lock login after a few failures).
- `-v` prints method, path, status only. Query, body, password and cookie never reach stderr; network errors have the URL removed.
- GET adds `isTest=false` first unless `-params` names `isTest`.
- Redirects are reported, not followed. No proxy.

## Put it in the repo

    tools/zreq/{go.mod,main.go,main_test.go,README.md}
    .github/workflows/build-zreq.yml

Run the workflow, download `matchitool-zreq-arm64`, copy to `app/src/main/assets/bin/zreq` and writing the SHA-256 into `NOTICE.md` and `docs/BINARIES.md` (`validate.sh` fails until it is there).
