#!/usr/bin/env node
/**
 * Whether there is an Obsidian beta this machine has not tested yet. From Lure.
 *
 * The daily watch (obsidian-upstream-watch) records the newest beta newer than
 * the release in .github/upstream-versions.json — a version number only: a
 * public repository's logs are public, early access is not. This reads that
 * record from origin/main and compares it with <logs>/tested.json, which
 * obsidian-beta-local writes after a run.
 *
 *   obsidian-beta-pending   # prints the pending version and exits 0, or exits 1 with none
 *
 * Logs: "obsidian.betaLogs" in devkit.config.json (default .beta-logs; keep it
 * out of git).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

let logs = ".beta-logs";
try {
	logs = JSON.parse(readFileSync("devkit.config.json", "utf8")).obsidian?.betaLogs ?? logs;
} catch {}
try {
	execFileSync("git", ["fetch", "-q", "origin", "main"], { stdio: "ignore" });
} catch {
	// Offline: the last fetched record will do.
}
const recorded = JSON.parse(execFileSync("git", ["show", "origin/main:.github/upstream-versions.json"], { encoding: "utf8" })).obsidianBeta ?? null;
let tested = null;
try {
	tested = JSON.parse(readFileSync(`${logs}/tested.json`, "utf8")).version ?? null;
} catch {
	// Never run here.
}
if (recorded && recorded !== tested) {
	console.log(recorded);
	process.exit(0);
}
console.error(recorded ? `Obsidian beta ${recorded} already tested here` : "no Obsidian beta newer than the release");
process.exit(1);
