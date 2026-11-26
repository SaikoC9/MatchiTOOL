# How to protect a plugin web page (author guide, one page)

Current for MatchiTOOL 1.4.6. For a plugin that starts its own local web page (AdGuard Home, a router-style panel). MatchiTOOL puts a **gate** in front of the page, so the page's own login cookie (often 30 days) never reaches the browser.

## What the person gets

- The browser holds one **session-only** cookie that works only while the MatchiTOOL console session lives.
- The page asks for **its own login again** after: MatchiTOOL sign-out, session expiry, password change, host restart, idle timeout, and (only if you turn it on) when the last page of the tab closes.
- Nothing listens on a gate port until the first Open.

## Two things you write

**1. A header line** (first 400 lines, must start with `//`, one line per plugin):

```js
// @matchi-gate name=adguard port=3000 logout=/control/logout idle=3600 tabclose=off
```

| field | required | meaning | limits |
| --- | --- | --- | --- |
| `name` | yes | id of the gate | `a-z`, `0-9`, `-`, 1 to 32 characters; must be unique among enabled plugins |
| `port` | yes | where your page listens on `127.0.0.1` | 1024 to 65535; not the console port (2334); not 3100 to 3199 (those belong to the gates) |
| `logout` | no | path MatchiTOOL calls (GET, with the page's cookies) to end the page's login | starts with `/`, at most 200 characters, no spaces. Left out: no call, the cookies are still dropped |
| `idle` | no | seconds without a request before the login ends | 300 to 43200, default 3600 |
| `tabclose` | no | `on`: also log out when the last page of the tab closes | `on` or `off`, default `off` |

Anything else (an unknown field, a bad value, a second line) makes the declaration invalid, and the plugin is **refused at upload** with the reason. There is no option to skip the login: a plugin declares, MatchiTOOL enforces. The gate port (3100 to 3199) is chosen by MatchiTOOL and never written in the plugin.

**2. One call in your Open button:**

```js
button.onclick = async () => {          // call it straight from the click, before any await
  const err = await matchi.gate.open('adguard');
  if (err) matchi.toast(err, 'red');    // '' means the tab was opened
};
```

`matchi.gate.open(name)` opens a new tab first (so the browser allows it), asks the host for a one-time ticket, and points the tab at the gate. It never throws: it resolves to `''` on success and to a short error text otherwise (blocked pop-up, session too old, plugin not declared, too many gates open). The ticket works once, for 60 seconds, for the address of the device that pressed Open.

## What the host checks on Open

The host reads the header from the **installed, enabled** plugin file (never from the request). It refuses when the file differs from the approved one ("changed": approve it again), when two enabled plugins declare the same name, and when the sign-in is older than 4 hours. At most 4 gates are open at once. Deleting or switching off the plugin closes its gate.

## What does not work behind the gate

- **Plain HTTP only.** The gate speaks HTTP even when the console runs over HTTPS; the password still travels unencrypted on the hotspot, as before.
- **WebSockets and other `Upgrade` requests** get a clear `501`. Server-sent events and long streams are not supported either.
- **Absolute links to the original port** break. Only redirects (`Location`) are rewritten. Use relative links.
- **Chunked request bodies** get `411`; requests over 2 MB get `413`; responses are buffered and capped at 24 MB (fine for admin pages, not for downloads).
- **The page's own brute-force limit becomes global**, because every request reaches it from `127.0.0.1`: one burst of wrong passwords locks everyone out of the page.
- **Sandboxed plugins** (see `PLUGIN_SANDBOX.md`) cannot call `matchi.gate.open`; the gate is for trusted-mode plugins.
- The gate cookie is named `matchi_gate_PORT`. Do not use that name in your page.

Test list for a new gate: Open shows the page's login; reload keeps the login; sign out of MatchiTOOL in another tab and reload (403 or the login again); reopen the old link without Open (403).
