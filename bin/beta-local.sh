#!/bin/bash
# Obsidian's beta, tested on this machine instead of on GitHub: a public
# repository's Actions logs are public, and early-access results are not to be
# published. Same scripts as the CI jobs, in a Debian container (Podman or
# Docker), one suite after another, memory capped. From Lure.
#
#   obsidian-beta-local                        # devkit.config.json's suites, when a beta is newer than the release
#   obsidian-beta-local test-tab test-links    # just these
#   BETA_FORCE=1 obsidian-beta-local test-blank   # run even with no beta out (to try the setup)
#
# Run from the project root. The Insider account comes from OBSIDIAN_EMAIL and
# OBSIDIAN_PASSWORD (no 2FA; obsidian-launcher only prompts interactively) and
# reaches the container through the environment, never a command line; it is
# never printed. devkit.config.json: "suites", and under "obsidian":
# "betaLogs" (default .beta-logs — keep it out of git) and "suiteRunner" (the
# script that runs $SUITES on $VERSIONS, default .dev/ci-suites.sh).
set -euo pipefail
cfg() { node -e 'const c=JSON.parse(require("fs").readFileSync("devkit.config.json","utf8")); const v=('"$1"'); process.stdout.write(Array.isArray(v)?v.join(" "):String(v??""))' 2>/dev/null || true; }
SUITES="${*:-$(cfg 'c.suites')}"
[ -n "$SUITES" ] || { echo "no suites (arguments or \"suites\" in devkit.config.json)" >&2; exit 1; }
BASE=$(cfg 'c.obsidian?.betaLogs'); BASE=${BASE:-.beta-logs}
RUNNER=$(cfg 'c.obsidian?.suiteRunner'); RUNNER=${RUNNER:-.dev/ci-suites.sh}
LOGS="$BASE/$(date +%F-%H%M)"
mkdir -p "$LOGS"
[ -n "${OBSIDIAN_EMAIL:-}" ] && [ -n "${OBSIDIAN_PASSWORD:-}" ] || { echo "no Insider credentials (OBSIDIAN_EMAIL / OBSIDIAN_PASSWORD)" >&2; exit 1; }
export OBSIDIAN_EMAIL OBSIDIAN_PASSWORD

# Docker if its daemon runs, else Podman (no daemon, rootless).
if docker info >/dev/null 2>&1; then engine=docker; elif command -v podman >/dev/null; then engine=podman; else echo "neither docker nor podman" >&2; exit 1; fi

"$engine" run --rm --memory=3g --shm-size=1g \
	-e OBSIDIAN_EMAIL -e OBSIDIAN_PASSWORD -e SUITES="$SUITES" -e BETA_FORCE="${BETA_FORCE:-}" -e RUNNER="$RUNNER" -e BASE="$BASE" \
	-v "$PWD:/src:ro" -v "$PWD/$LOGS:/logs" \
	docker.io/library/node:24-bookworm bash -c '
		set -e
		mkdir /repo && tar -C /src --exclude=./node_modules --exclude=./.personal --exclude=./.git --exclude="./$BASE" -cf - . | tar -C /repo -xf - && cd /repo
		npm ci >/logs/setup.log 2>&1
		sh node_modules/electron-template/bin/electron-distro-deps.sh >>/logs/setup.log 2>&1
		node esbuild.config.mjs production >>/logs/setup.log 2>&1
		npm install --no-save --no-package-lock obsidian-launcher@3 >>/logs/setup.log 2>&1
		read -r beta stable < <(node --input-type=module -e "const { default: L } = await import(\"obsidian-launcher\"); const l = new L(); const [b] = await l.resolveVersion(\"latest-beta\"); const [s] = await l.resolveVersion(\"latest\"); console.log(b + \" \" + s);")
		echo "beta $beta, release $stable" | tee /logs/versions.txt
		if [ "$beta" = "$stable" ] && [ -z "$BETA_FORCE" ]; then echo "no beta newer than $stable: nothing to test"; exit 0; fi
		VERSIONS=latest-beta OBSIDIAN_EXTRA_ARGS=--no-sandbox bash "$RUNNER" 2>&1 | tee /logs/suites.log
		cp obsidian-*.log /logs/ 2>/dev/null || true
	' 2>&1 | tee "$LOGS/run.log"
# What was tested, for obsidian-beta-pending: the beta the launcher resolved,
# and whether the suites passed. Not when there was nothing to test.
if [ -f "$LOGS/suites.log" ]; then
	version=$(awk '/^beta /{print $2}' "$LOGS/versions.txt" | tr -d ,)
	failed=$(grep -c "::error::" "$LOGS/suites.log" || true)
	printf '{"version": "%s", "at": "%s", "failedSuites": %s, "logs": "%s"}\n' "$version" "$(date -Iseconds)" "${failed:-0}" "$LOGS" > "$BASE/tested.json"
fi
echo "logs: $LOGS"
