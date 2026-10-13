#!/bin/bash
# Runs one suite against a sandboxed Obsidian, run from the project root:
#
#   obsidian-run-suite test-tab                       # latest Obsidian
#   OBSIDIAN_VERSION=earliest obsidian-run-suite test-tab   # the manifest's minAppVersion
#
# obsidian-launcher downloads Obsidian (cached in ~/.obsidian-cache), opens a
# copy of the test vault with its own configuration directory, installs this
# build and the neighbouring plugins, and passes the DevTools port the suites
# talk to; an Obsidian installed some other way (OBSIDIAN_COMMAND: Flatpak,
# Snap, a distribution's package, Wine, FreeBSD's Electron) is started through
# launch-alt instead. Waits for the plugin to load, prepares the window
# (obsidian-prepare), runs <suitesDir>/<suite>.mjs. Needs a display: on a
# runner that is xvfb-run (electron-template's electron-suites does it). From Lure.
#
# devkit.config.json: "id" (the plugin waited for), and under "obsidian":
#   neighbours       ["folder-notes", …]   installed for every suite
#   suitePlugins     {"test-x": ["cmdr", "iconic@darwin"]}   for that suite only; @<platform> limits one
#   testVault        ".dev/test-vault"     suitesDir ".dev"
#   prepare          a command run after obsidian-prepare (optional)
# Environment: OBSIDIAN_VERSION, OBSIDIAN_INSTALLER, OBSIDIAN_CDP_PORT,
# OBSIDIAN_EXTRA_ARGS, OBSIDIAN_COMMAND, OBSIDIAN_PATHS=wine, EXTRA_PLUGINS,
# PEER_CHANNEL=beta (neighbours at their newest pre-release), VAULT_PARENT (the
# vault copy elsewhere: another drive, a share; LURE_VAULT_PARENT also read),
# OBSIDIAN_CI_DIR, SUITE_NODE (another Node for the suite: Windows' under Wine),
# SUITE_FILTER, SLOW.
#
# Exit code is the suite's: 0 passed, 1 failed, 2 a case could not be asked
# here (development-template's harness: Skipped).
set -u
SUITE="${1:?usage: obsidian-run-suite <suite, e.g. test-tab>}"
TOOLKIT="$(cd "$(dirname "$0")/.." && pwd)"
cfg() { node -e 'const c=JSON.parse(require("fs").readFileSync("devkit.config.json","utf8")); const v=('"$1"'); process.stdout.write(Array.isArray(v)?v.join(" "):String(v??""))' 2>/dev/null || true; }
ID=$(cfg 'c.id')
TEST_VAULT=$(cfg 'c.obsidian?.testVault'); TEST_VAULT=${TEST_VAULT:-.dev/test-vault}
SUITES_DIR=$(cfg 'c.obsidian?.suitesDir'); SUITES_DIR=${SUITES_DIR:-.dev}
VERSION="${OBSIDIAN_VERSION:-latest}"
PORT="${OBSIDIAN_CDP_PORT:-9222}"
LOG="${OBSIDIAN_LOG:-obsidian-$SUITE.log}"

PLATFORM=$(node -p process.platform)
PLUGINS=(-p .)
for id in $(cfg 'c.obsidian?.neighbours') $(SUITE="$SUITE" cfg '(c.obsidian?.suitePlugins ?? {})[process.env.SUITE]') ${EXTRA_PLUGINS:-}; do
	case "$id" in
		*@*) [ "${id#*@}" = "$PLATFORM" ] && PLUGINS+=(-p "id:${id%@*}") ;;
		*) PLUGINS+=(-p "id:$id") ;;
	esac
done
if [ "${PEER_CHANNEL:-}" = beta ]; then
	mapfile -t PLUGINS < <(node "$TOOLKIT/bin/peer-betas.mjs" "${PLUGINS[@]}")
fi

# The installer (Electron) goes with the app: the newest for "latest", the
# oldest that can run it for "earliest" — which is what users on each end have.
INSTALLER="${OBSIDIAN_INSTALLER:-$([ "$VERSION" = earliest ] && echo earliest || echo latest)}"

# Obsidian is stopped on exit by where it runs from — the launcher's cache, or
# launch-alt's tag — so a system Obsidian is untouched. Waited for: Obsidian is
# single-instance, and the next suite's launch would go to the copy still
# shutting down.
CACHE="${OBSIDIAN_CACHE:-$HOME/.obsidian-cache}"
stop_obsidian() {
	pkill -f "$CACHE/" 2>/dev/null
	pkill -f "obsidian-ci-alt" 2>/dev/null
	# Under Wine the app's processes are Windows ones the patterns do not reach.
	[ "${OBSIDIAN_PATHS:-}" = wine ] && wineserver -k 2>/dev/null
	for _ in $(seq 1 20); do
		pgrep -f "$CACHE/" >/dev/null 2>&1 || return 0
		sleep 0.5
	done
	pkill -9 -f "$CACHE/" 2>/dev/null
}
trap stop_obsidian EXIT

# The vault copy goes under home, where a vault lives. Windows reads TEMP/TMP,
# not TMPDIR; left alone it copies to %TEMP%, which a runner spells with the
# 8.3 short name that never matches home's long one. VAULT_PARENT puts it
# elsewhere — only the vault: Obsidian's own settings stay local, as a user's
# do (Chromium's databases want file locks a share may not give).
VAULTS="${OBSIDIAN_CI_DIR:-$HOME/.cache/obsidian-ci}"
mkdir -p "$VAULTS"
VAULT_ARGS=(--copy "$TEST_VAULT")
PARENT="${VAULT_PARENT:-${LURE_VAULT_PARENT:-}}"
if [ -n "$PARENT" ]; then
	placed="$PARENT/test-vault-$$"
	# Git Bash copies by its own spelling of the path, Obsidian opens Windows'.
	if command -v cygpath >/dev/null; then here=$(cygpath -u "$placed"); placed=$(cygpath -w "$placed"); else here="$placed"; fi
	rm -rf "$here" && cp -r "$TEST_VAULT" "$here"
	VAULT_ARGS=("$placed")
fi
if [ -n "${OBSIDIAN_COMMAND:-}" ]; then
	[ -d node_modules/obsidian-launcher ] || npm install --no-save --no-package-lock obsidian-launcher@3 >/dev/null 2>&1
	TMPDIR="$VAULTS" OBSIDIAN_ALT_LOG="$LOG" node "$TOOLKIT/bin/launch-alt.mjs" "$VERSION" "$TEST_VAULT" "${PLUGINS[@]}" \
		-- --remote-debugging-port="$PORT" ${OBSIDIAN_EXTRA_ARGS:-} >>"$LOG" 2>&1
else
	TMPDIR="$VAULTS" TEMP="$VAULTS" TMP="$VAULTS" npx --yes obsidian-launcher@3 launch --version "$VERSION" --installer "$INSTALLER" "${PLUGINS[@]}" "${VAULT_ARGS[@]}" \
		-- --remote-debugging-port="$PORT" ${OBSIDIAN_EXTRA_ARGS:-} >"$LOG" 2>&1
fi

# The port answers before the vault has loaded: wait for a page and for the
# plugin. Longer where the machine is slow on purpose (SLOW).
ask() { OBSIDIAN_CDP_PORT="$PORT" ALLOW_SETTINGS=1 timeout 20 node --input-type=module -e "const { connect } = await import('$TOOLKIT/lib/cdp-session.mjs'); const p = await connect(); console.log(await p.evaluate(process.argv[1])); p.close();" "$1" 2>/dev/null; }
for _ in $(seq 1 $((240 * ${SLOW:-${LURE_SLOW:-1}}))); do
	if curl -s --max-time 1 "http://127.0.0.1:$PORT/json/list" | grep -q '"type": *"page"'; then
		if ask "return !!app?.plugins?.plugins?.[$(node -p 'JSON.stringify(process.argv[1])' "$ID")];" | grep -q true; then
			ready=1
			break
		fi
	fi
	sleep 1
done
if [ -z "${ready:-}" ]; then
	echo "Obsidian did not come up with $ID loaded; launcher log:" >&2
	tail -40 "$LOG" >&2
	echo "--- the page:" >&2
	curl -s --max-time 3 "http://127.0.0.1:$PORT/json/list" | head -c 600 >&2
	ask 'return JSON.stringify({ url: location.href, app: !!window.app, vault: window.app?.vault?.getName?.(), safe: window.app?.plugins?.isEnabled?.(), manifests: Object.keys(window.app?.plugins?.manifests ?? {}).length, enabled: [...(window.app?.plugins?.enabledPlugins ?? [])].length, title: document.title });' >&2
	exit 1
fi

OBSIDIAN_CDP_PORT="$PORT" node "$TOOLKIT/bin/prepare.mjs" || exit 1
PREPARE=$(cfg 'c.obsidian?.prepare')
[ -z "$PREPARE" ] || OBSIDIAN_CDP_PORT="$PORT" bash -c "$PREPARE" || exit 1
if [ -z "${SUITE_NODE:-}" ]; then
	OBSIDIAN_CDP_PORT="$PORT" node "$SUITES_DIR/$SUITE.mjs" ${SUITE_FILTER:+"$SUITE_FILTER"}
	exit $?
fi
# Windows' Node under Wine cannot write to a pipe (EBADF on its stderr): it
# writes to a file, shown when it is done.
out="$CACHE/suite-$SUITE.out"
OBSIDIAN_CDP_PORT="$PORT" $SUITE_NODE "$SUITES_DIR/$SUITE.mjs" ${SUITE_FILTER:+"$SUITE_FILTER"} >"$out" 2>&1 </dev/null
code=$?
tr -d '\r' < "$out"
exit $code
