#!/bin/bash
# Releases an Obsidian plugin through its Release workflow (obsidian-toolkit's
# reusable release.yml), from the maintainer's machine. From Lure. Run from
# the project root:
#
#   obsidian-release-dispatch 1.5.2
#
# Before it: the Unreleased entries translated into every changelog as a
# pending section (and anything else only this machine can do — a project
# wrapper checks that first). This checks the changelogs and version files
# (obsidian-release --check), that the released files are committed and that
# HEAD is origin/main, then hands the rest to GitHub — tests, changelogs,
# version files, tag, build, attestation, release, and the community
# directory's steps when the OBSIDIAN_COMMUNITY_COOKIE secret is set — and
# follows the run. Without that secret it opens the directory's
# check-release page (queueing the scan needs the owner's signed-in browser)
# and waits until the listing shows the version.
#
# devkit.config.json: "obsidian.directoryId" (else manifest.json's id),
# "obsidian.releaseFiles" (what must be committed; default below).
set -eu
TOOLKIT="$(dirname "$0")/.."
VERSION="${1:?usage: obsidian-release-dispatch <x.y.z>}"
cfg() { node -e 'let c={}; try { c=JSON.parse(require("fs").readFileSync("devkit.config.json","utf8")) } catch {} const v=('"$1"'); process.stdout.write(Array.isArray(v)?v.join(" "):String(v??""))'; }
ID=$(cfg 'c.obsidian?.directoryId ?? JSON.parse(require("fs").readFileSync("manifest.json","utf8")).id')
FILES=$(cfg 'c.obsidian?.releaseFiles'); FILES=${FILES:-CHANGELOG.md README.md docs manifest.json package.json versions.json src styles.css}

node "$TOOLKIT/bin/release.mjs" "$VERSION" --check
# shellcheck disable=SC2086
[ -z "$(git status --porcelain -- $FILES)" ] \
	|| { echo "uncommitted changes to released files — commit them first" >&2; exit 1; }
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] \
	|| { echo "HEAD is not origin/main — push (or pull) first; the workflow releases origin/main" >&2; exit 1; }

started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
gh workflow run release.yml --ref main -f version="$VERSION"
for _ in $(seq 1 30); do
	id=$(gh run list --workflow release.yml --event workflow_dispatch --limit 5 \
		--json databaseId,createdAt --jq "map(select(.createdAt >= \"$started\"))[0].databaseId // empty")
	[ -n "$id" ] && break
	sleep 2
done
[ -n "${id:-}" ] || { echo "the run did not appear" >&2; exit 1; }
echo "run $id: $(gh run view "$id" --json url --jq .url)"
gh run watch "$id" --exit-status --interval 30
git pull -q --ff-only origin main
echo
echo "Released $VERSION: $(gh release view "$VERSION" --json url --jq .url)"
# The directory has no API for this: opening the page in the browser you are
# signed in with is what queues the scan. No credentials leave that browser.
CHECK="https://community.obsidian.md/account/plugins/$ID/check-release"
if gh secret list | grep -q OBSIDIAN_COMMUNITY_COOKIE; then
	echo "The workflow queued the directory's scan and waited for the listing (see the run's summary)."
elif command -v xdg-open >/dev/null && [ -z "${RELEASE_NO_BROWSER:-}" ]; then
	xdg-open "$CHECK" >/dev/null 2>&1 &
	echo "Opened $CHECK — it queues the directory's scan; waiting for the listing (~5–10 min)."
	node "$TOOLKIT/bin/directory.mjs" confirm "$VERSION"
else
	echo "Left: open $CHECK (signed in) to queue the directory's scan."
fi
