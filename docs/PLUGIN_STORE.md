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

## UFI-TOOLS stores (read natively)

The store also reads the index format of UFI-TOOLS' own plugin store and of the self-hosted "custom plugin source" stores built for it:

```
{"download_url": "https://host/path", "res": {"data": {"content": [
  {"name": "plugin.txt", "size": 3907, "is_dir": false, "hash_info": {"md5": "...", "sha256": "..."}} ]}}}
```

(`{"data":{"content":[...]}}` and `{"content":[...]}` work too.) A file is downloaded from `download_url/name`. `hash_info.sha256` is checked against the downloaded bytes; `md5` is ignored. Only `.js` plugins and `.txt` / `.html` UFI bundles are listed. Folders and archives (`.zip`, `.tar.gz`, binaries such as `kano_ssh.zip`) need UFI-TOOLS' own installer, so they are hidden and counted in the note under the address box.

The store window has a **UFI-TOOLS plugins (community mirror)** source that fills in `https://raw.githubusercontent.com/BearHero520/UFI-TOOLS-PLUGINS/main/store.json`. UFI-TOOLS' original store server is no longer online; this is a community snapshot of its plugin files (Aug 2025, pinned to one commit), not an official MatchiTOOL or UFI-TOOLS address. Nothing is fetched until you pick it, and every install still shows the SHA-256 and the scan before you confirm. Plugins in it were written for UFI-TOOLS and some call UFI-only routes; they run here as far as MatchiTOOL provides those routes (see the README).

## What is refused

Index and plugin URLs must be `https://` with a domain name: no IP addresses, `localhost`, `.local`/`.lan`/`.internal`/`.home` names, no `user:password@`. A redirect to such an address is refused too. Downloads stop at 1 MB (index) and about 4 MB (plugin), after 20 s. Requests carry no cookies and no referrer.

## What you see before installing

The file's SHA-256, whether the store listed the same hash, whether the source calls the root or user shell, which bundled tools it names (`curl`, `jq`, `sendat`, `sha256`, `zreq`), risky patterns (`rm -r`, `dd`, `mount`, `setprop`, reboot, boot-script writes, download piped into a shell, `eval`), the MatchiTOOL routes and web hosts it mentions, and which installed plugins it would replace. The list comes from a text search of the source. **It is a hint, not a safety check**: a plugin can build a command while it runs. A plugin runs with the same power as any other plugin, including root.

Installing needs the same fresh sign-in as every other plugin upload (the server enforces it).

### What the install dialog shows about stopping (1.4.2)

The dialog is built from the store entry and a text search of the source (`storeSummary`, `plugScan`, `plugCompat` in `web-src/plugin-store-pure.js`). For a single `.js` plugin it also reads the stop header lines (`// @matchi-uninstall`, `// @matchi-check`, `// @matchi-boot`; see [`PLUGIN_HEADERS.md`](PLUGIN_HEADERS.md)) with `plugStopDecls`, which follows the same rules as the host (`pluginUninstallDeclarations`: first 400 lines, a line must start with `//`, at most 10 commands of 1 to 300 characters without control characters, duplicates dropped, one check, at most 5 boot paths). When there are any, the dialog adds:

- **"When deleted with Stop, it runs these commands as ROOT:"** and the commands, each cut at 120 characters with `...`, at most 10;
- **"Then it checks with:"** and the check command;
- **"Boot files it says it creates"** and the boot paths (they are only checked for, to see that they are gone);
- the line **"The Delete dialog shows each command in full before anything runs."**

A plugin without these lines gets no extra lines. Limits: this is a text read of the file you downloaded, not a promise; whether a command may run is decided later by the host (command filter, approval, sandbox grant), and the Delete and Turn off dialogs list the commands word for word before anything runs. A UFI-TOOLS bundle (`.txt` / `.html` blocks) is imported through the UFI importer and its dialog shows no stop lines (it is not known whether the host reads these headers inside a bundle block). The store dialog also takes name, version and author from the store index, not from the `@matchi-name`, `@matchi-version` and `@matchi-author` lines of the file. An **update** of an installed plugin that adds a new `@matchi-uninstall` command still asks again ("This update adds new abilities ... when deleted with Stop, runs this root command: ...").

## Not included

No store is loaded by default. The UFI source is a convenience button, not a built-in trusted source. Its address and the UFI index shape above come from the community mirror's `store.json` (83 entries); the old official UFI-TOOLS server address could not be confirmed.
