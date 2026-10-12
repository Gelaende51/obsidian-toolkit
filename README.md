# obsidian-toolkit

The Obsidian layer of a shared toolkit, as a package. Projects start from
[obsidian-plugin-template](https://github.com/Gelaende51/obsidian-plugin-template) and
depend on this and the two layers below it:

| Package | For | Repository |
|---|---|---|
| development-template | any software project | [Gelaende51/development-template](https://github.com/Gelaende51/development-template) |
| electron-template | apps and plugins on Electron | [Gelaende51/electron-template](https://github.com/Gelaende51/electron-template) |
| **obsidian-toolkit** | Obsidian plugins | this one |

The template cannot be the package itself: its `package.json` becomes the new plugin's
own. Tooling comes from Lure (an Obsidian plugin). Licence: AGPL-3.0 (see `LICENSE`).

Install each layer as a devDependency by exact tag — npm 12 fetches URL dependencies only
for the project itself (`allow-remote=root` in `.npmrc`), so the layers do not pull each
other in:

```
npm i -D https://codeload.github.com/Gelaende51/obsidian-toolkit/tar.gz/refs/tags/v0.3.0 \
         https://codeload.github.com/Gelaende51/electron-template/tar.gz/refs/tags/v0.3.0
```

## In here so far

- `lib/cdp-session.mjs` — electron-template's CDP session with Obsidian's window choice
  (`OBSIDIAN_VAULT`; window titles are HTML-escaped; Settings windows refused as targets),
  a refusal when Obsidian's settings are open in front of the vault (`ALLOW_SETTINGS=1` to
  drive them), `reloadPlugin(page, id)` that waits for an async `onload`, and
  `setSettings(page, patch, id)`. Needs electron-template installed beside it.
- `bin/peer-betas.mjs` (`obsidian-peer-betas -p id:x …`) — obsidian-launcher plugin specs
  with each neighbour swapped for its newest pre-release where one is newer than its last
  release: a canary for what the neighbours ship next.

- `bin/upstream-watch.mjs` (`obsidian-upstream-watch [--diff]`) — Obsidian's latest release,
  its newest beta (version number only; `betaNew` on its own, to be tested privately), and
  each neighbouring plugin's released version (`obsidian.neighbours` or
  `obsidian.neighboursFrom` in devkit.config.json); `--diff` against the state file.

- `bin/beta-pending.mjs` / `bin/beta-local.sh` (`obsidian-beta-pending`, `obsidian-beta-local`) —
  Obsidian's beta tested on the maintainer's machine, not in public Actions logs: the watch
  records only the version; `beta-pending` says whether it is untested here, `beta-local` runs
  the suites on it in a memory-capped Podman/Docker container with the Insider account from
  `OBSIDIAN_EMAIL`/`OBSIDIAN_PASSWORD` (environment only), logs in `obsidian.betaLogs`.

## Coming

obsidian-launcher glue (alternative installs, platform spoof), the community directory
(review on release, preview review, listing checks), release steps.
