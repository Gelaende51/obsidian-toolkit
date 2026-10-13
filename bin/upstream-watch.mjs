#!/usr/bin/env node
/**
 * The versions a plugin is tested against that can change without a commit:
 * Obsidian's latest release, its newest beta (version number only), and the
 * latest release of every neighbouring plugin the suites install. From Lure
 * (scripts/upstream-versions.mjs). The neighbours come from devkit.config.json:
 *
 *   "obsidian": { "neighbours": ["folder-notes"], "suitePlugins": { "test-x": ["cmdr"] } }
 *   "obsidian": { "neighboursFrom": ".dev/ci-run.sh" }   // its `-p id:x` specs, one list
 *
 *   obsidian-upstream-watch          # print them as JSON
 *   obsidian-upstream-watch --diff   # against the state file → { changed, changes, betaNew, now }
 *   --config devkit.config.json  --state .github/upstream-versions.json
 *
 * A new beta is reported on its own (`betaNew`) and should start no public test
 * run: early-access results are not to be published, so test it on the
 * maintainer's machine. GITHUB_TOKEN, when set, lifts the API's rate limit.
 */
import { readFileSync } from "node:fs";

const arg = (name, fallback) => {
	const i = process.argv.indexOf(name);
	return i > 0 ? process.argv[i + 1] : fallback;
};
const config = JSON.parse(readFileSync(arg("--config", "devkit.config.json"), "utf8"));
const statePath = arg("--state", ".github/upstream-versions.json");
const RAW = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD";
const headers = { accept: "application/vnd.github+json", "user-agent": `obsidian-upstream-watch (github.com/${config.repository ?? "unknown"})` };
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
const json = async (url) => {
	const res = await fetch(url, { headers });
	if (!res.ok) throw new Error(`${res.status} ${url}`);
	return res.json();
};

const ob = config.obsidian ?? {};
const ids = ob.neighboursFrom
	? [...readFileSync(ob.neighboursFrom, "utf8").matchAll(/-p id:([\w-]+)/g)].map((m) => m[1])
	: [...new Set([...(ob.neighbours ?? []), ...Object.values(ob.suitePlugins ?? {}).flat()].map((id) => id.replace(/@.*/, "")))];
const [desktop, plugins] = await Promise.all([json(`${RAW}/desktop-releases.json`), json(`${RAW}/community-plugins.json`)]);
const repoOf = Object.fromEntries(plugins.map((p) => [p.id, p.repo]));

// Obsidian's newest beta (early access) when it is newer than the release —
// recorded here, in public, as a version number only; it is tested on the
// maintainer's machine, since Actions logs of a public repository are public.
const newer = (a, b) => a.localeCompare(b, "en", { numeric: true }) > 0;
let beta = null;
try {
	const list = await json("https://raw.githubusercontent.com/jesse-r-s-hines/wdio-obsidian-service/HEAD/obsidian-versions.json");
	const newest = (list.versions ?? []).filter((v) => v.isBeta).map((v) => v.version).sort((a, b) => a.localeCompare(b, "en", { numeric: true })).at(-1);
	if (newest && newer(newest, desktop.latestVersion)) beta = newest;
} catch {
	beta = undefined; // unreadable: keep what was recorded
}
const now = { obsidian: desktop.latestVersion, obsidianBeta: beta, plugins: {} };
for (const id of ids.sort()) {
	const repo = repoOf[id];
	if (!repo) { now.plugins[id] = "not in the directory"; continue; }
	// The version installers read: the manifest on the repo's default branch,
	// which is also what obsidian-launcher resolves "latest" to.
	try {
		now.plugins[id] = (await json(`https://raw.githubusercontent.com/${repo}/HEAD/manifest.json`)).version;
	} catch (err) {
		now.plugins[id] = `unreadable (${err.message.split(" ")[0]})`;
	}
}

if (!process.argv.includes("--diff")) {
	console.log(JSON.stringify(now, null, "\t"));
	process.exit(0);
}
let before = { obsidian: null, plugins: {} };
try { before = JSON.parse(readFileSync(statePath, "utf8")); } catch {}
if (now.obsidianBeta === undefined) now.obsidianBeta = before.obsidianBeta ?? null;
// A new beta is reported on its own: it starts no public test run.
const betaNew = now.obsidianBeta && now.obsidianBeta !== before.obsidianBeta ? now.obsidianBeta : null;
const changes = [];
if (before.obsidian !== now.obsidian) changes.push(`Obsidian ${before.obsidian ?? "—"} → ${now.obsidian}`);
for (const [id, v] of Object.entries(now.plugins)) if (before.plugins?.[id] !== v) changes.push(`${id} ${before.plugins?.[id] ?? "—"} → ${v}`);
// For the workflow: whether to test, what changed, and the new state.
console.log(JSON.stringify({ changed: changes.length > 0, changes, betaNew, now }));
