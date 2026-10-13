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
npm i -D https://codeload.github.com/Gelaende51/obsidian-toolkit/tar.gz/refs/tags/v0.13.0 \
         https://codeload.github.com/Gelaende51/electron-template/tar.gz/refs/tags/v0.13.0
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

- `bin/launch-alt.mjs` (`obsidian-launch-alt <version> <vault> -p … -- <args>`) — starts an
  Obsidian obsidian-launcher did not download (Flatpak, Snap, a distribution's package,
  Wine, FreeBSD's Electron) the way the launcher starts its own: vault copy with plugins,
  a configuration directory with the app version asked for. `OBSIDIAN_COMMAND`,
  `OBSIDIAN_PATHS=wine`, `OBSIDIAN_PLATFORM_AS=linux` (FreeBSD). Needs obsidian-launcher.

- `.github/workflows/freebsd.yml`, `alpine.yml` — reusable: Obsidian's own app (app.asar from
  the Linux tarball) on FreeBSD's Electron in a FreeBSD VM, and on Alpine edge's Electron
  (musl) in a container; `suites`, `versions`, `run`.

- `.github/workflows/electron-next.yml` — reusable canary: Obsidian's app on `electron@beta`.

- `bin/run-suite.sh` (`obsidian-run-suite <suite>`) — one suite against a sandboxed Obsidian:
  obsidian-launcher (or launch-alt for `OBSIDIAN_COMMAND`), the test vault copied (or put under
  `VAULT_PARENT`), the plugin and its neighbours installed (`obsidian.neighbours`,
  `obsidian.suitePlugins` with `id@platform`), waits for the plugin, prepares, runs
  `<suitesDir>/<suite>.mjs` (on `SUITE_NODE` under Wine). Use it as electron-suites' `RUN_SUITE`.
- `bin/prepare.mjs` (`obsidian-prepare`) — neighbours off but the plugin and
  `obsidian.keepEnabled`, window at `obsidian.window`.

- `.github/workflows/suites.yml` — reusable: the test suites — those that connect to Obsidian one
  job per suite × Obsidian version × system (Linux; Windows, Windows on Arm, macOS, Intel macOS
  by name), the rest as unit suites — with a case filter, Obsidian cached, deliberate pictures
  (shots/look) and failure logs and screenshots kept.

- `bin/directory.mjs` (`obsidian-directory review <sha> | request|confirm|released <x.y.z>`) — the
  community directory's side of a release, which has no API: a preview scan of a commit
  compared with the last release (fails on a new Warning), queueing the release scan,
  waiting for the public listing, reading and recording the release's review. Signs in with
  the session cookie in `COOKIE` (headless Chrome, playwright-core).
- `bin/directory-session.mjs` (`obsidian-directory-session [--install|--remove]`) — keeps that
  cookie alive as the repository secret `OBSIDIAN_COMMUNITY_COOKIE`: its own Chrome profile,
  a silent renewal, a headless sign-in with the account a wrapper hands over (never in the
  environment of child processes), a desktop prompt as the last resort; daily by systemd timer.

- `bin/check-listing.mjs` (`obsidian-check-listing [--remote]`) — validates listing.json (the
  fields the directory keeps that manifest.json has no place for: tags, pricing, icon…) and,
  with `--remote`, compares it with the live listing; exit 2 when only the site is behind.
- `bin/listing-tags.mjs` (`obsidian-listing-tags [--refresh]`; `import { TAGS } from "obsidian-toolkit/listing-tags"`) — the directory's tag table,
  and whether the site's has changed.
- `bin/release.mjs` (`obsidian-release <x.y.z> [--check]`) — the mechanical half of a release:
  the changelog's Unreleased section and every translation's pending one become the
  version's (heading, date, compare-link footnote in each file's own wording), and
  manifest.json, package.json and versions.json take the version.

- `bin/release.mjs` also handles a first release (no version heading yet): the heading is
  the version and date, the footnote the release page; it may be the manifest's own version.
- `bin/release-dispatch.sh` (`obsidian-release-dispatch <x.y.z>`) — releases from the
  maintainer's machine: checks readiness, a clean tree and HEAD = origin/main, starts the
  Release workflow and follows it; without the directory secret, opens the check-release
  page in the signed-in browser and waits for the listing.
- `.github/workflows/release.yml` — reusable: preview scan, release commit (changelogs, version
  files, optional after-commit step), tag, build, attested release, then the directory's
  release scan, listing and recorded review.
- `bin/i18n-stamp.mjs` (`obsidian-i18n-stamp [--freshness [--check] [--only README,CHANGELOG]]`)
  — writes each document's language row (README, usage guide, changelog; only the languages
  that document is translated into, an invisible placeholder while there are none), and with
  `--freshness` claims a translation current by the English commit it reflects.
- `bin/i18n-selector.mjs` (`obsidian-i18n-selector <doc> <lang> [langs…]`;
  `import { selector, LANGUAGES } from "obsidian-toolkit/i18n-selector"`) — the language row,
  in Obsidian's own language list.
