# Plugin store (1.4.0)

The Plugins card has a **Plugin store…** button. The page (your browser) downloads the index and the plugin files; the app itself makes no network request for this. The console therefore needs a browser with a route to the internet, which a device on the hotspot may not have.

## Index format

A JSON array, or `{"plugins": [...]}`. At most 500 entries and 1 MB. Each entry:

| field | required | notes |
| --- | --- | --- |
| `name` | yes | shown in the list, at most 80 characters |
| `url` (or `file`) | yes | `https://` only; a relative URL resolves against the index URL |
| `sha256` | recommended | 64 hex characters of the exact file bytes (UTF-8 text). If present and different from the downloaded file, nothing is installed |
| `description`, `author`, `version` | no | shown in the list |
| `size` | no | informational |

A plugin file is either a UFI-TOOLS `.txt` bundle (`<!-- [KANO_PLUGIN_START] name -->` blocks, up to 4 MB, 1 MB per block) or a single `.js` file (1 MB). A `.js` URL ends in `.js`.

Example: `{"plugins":[{"name":"Signal meter","url":"signal.js","sha256":"<hex>","author":"me","version":"1.0"}]}`

Make the hash with `sha256sum signal.js`.

## What is refused

Index and plugin URLs must be `https://` with a domain name: no IP addresses, `localhost`, `.local`/`.lan`/`.internal`/`.home` names, no `user:password@`. A redirect to such an address is refused too. Downloads stop at 1 MB (index) and about 4 MB (plugin), after 20 s. Requests carry no cookies and no referrer.

## What you see before installing

The file's SHA-256, whether the store listed the same hash, whether the source calls the root or user shell, which bundled tools it names (`curl`, `jq`, `sendat`, `sha256`, `zreq`), risky patterns (`rm -r`, `dd`, `mount`, `setprop`, reboot, boot-script writes, download piped into a shell, `eval`), the MatchiTOOL routes and web hosts it mentions, and which installed plugins it would replace. The list comes from a text search of the source. **It is a hint, not a safety check**: a plugin can build a command while it runs. A plugin runs with the same power as any other plugin, including root.

Installing needs the same fresh sign-in as every other plugin upload (the server enforces it).

## Not included

No default store address is built in: UFI-TOOLS' own store address and reply shape were not confirmed (`/plugins_store` is only a route name seen in its code), so this store reads the format above, not UFI's.
