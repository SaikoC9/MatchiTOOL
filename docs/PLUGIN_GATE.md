# Protect a plugin web page

For 1.4.6. For plugins that start their own local web page (AdGuard Home, router-style panels). MatchiTOOL puts a **gate** in front so the page's own login cookie (often 30 days) never reaches the browser.

## Result for the user

- The browser holds one session-only cookie, valid only while the MatchiTOOL session lives.
- The page asks for its own login again after: MatchiTOOL sign-out, session expiry, password change, host restart, idle timeout, and (if enabled) closing the last page of the tab.
- Nothing listens on a gate port until the first Open.

## What you write

**1. A header line** (first 400 lines, starts with `//`, one per plugin):

```js
// @matchi-gate name=adguard port=3000 logout=/control/logout idle=3600 tabclose=off
```

| field | required | meaning | limits |
| --- | --- | --- | --- |
| `name` | yes | gate id | `a-z`, `0-9`, `-`, 1-32 chars; unique among enabled plugins |
| `port` | yes | where your page listens on `127.0.0.1` | 1024-65535; not 2334; not 3100-3199 |
| `logout` | no | path called (GET, with the page's cookies) to end the page's login | starts with `/`, max 200 chars, no spaces. Omitted: no call, cookies still dropped |
| `idle` | no | seconds without a request before login ends | 300-43200, default 3600 |
| `tabclose` | no | `on`: also log out when the last page of the tab closes | `on`/`off`, default `off` |

Any unknown field, bad value or second line makes the declaration invalid and the plugin is **refused at upload** with the reason. There is no skip-login option. The gate port (3100-3199) is chosen by MatchiTOOL.

**2. One call in your Open button:**

```js
button.onclick = async () => {          // call straight from the click, before any await
  const err = await matchi.gate.open('adguard');
  if (err) matchi.toast(err, 'red');    // '' means the tab opened
};
```

`matchi.gate.open(name)` opens a tab first (so the browser allows it), gets a one-time ticket (valid once, 60 s, for the pressing device's address) and points the tab at the gate. It never throws; it returns `''` on success or a short error (blocked pop-up, session too old, plugin not declared, too many gates).

## Host checks on Open

The host reads the header from the installed, enabled plugin file, never from the request. It refuses when the file differs from the approved one (approve again), when two enabled plugins use the same name, and when the sign-in is over 4 h old. Max 4 gates at once. Deleting or switching off the plugin closes its gate.

## What does not work

- **Plain HTTP only**, even if the console uses HTTPS. The password travels unencrypted on the hotspot.
- **WebSockets and `Upgrade` requests:** `501`. SSE and long streams: unsupported.
- **Absolute links to the original port** break. Only `Location` redirects are rewritten. Use relative links.
- **Chunked request bodies:** `411`. Bodies over 2 MB: `413`. Responses buffered, capped at 24 MB.
- **The page's own brute-force limit becomes global** (all requests come from `127.0.0.1`). One burst of wrong passwords locks everyone out.
- **Sandboxed plugins** cannot call `matchi.gate.open`.
- The gate cookie is named `matchi_gate_PORT`. Do not use that name.
