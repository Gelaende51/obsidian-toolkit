#!/usr/bin/env node
/**
 * Keeps the Release workflow's community-directory session alive: the
 * repository secret OBSIDIAN_COMMUNITY_COOKIE that obsidian-directory signs
 * in with (the directory has no API or token). From Lure. Run from the
 * project root.
 *
 *   obsidian-directory-session            # renew now
 *   obsidian-directory-session --install  # renew now, then daily (systemd user timer)
 *   obsidian-directory-session --remove   # stop the daily run
 *
 * It uses a Chrome profile of its own (~/.local/share/obsidian-directory/<id>
 * /profile, or DIRECTORY_DATA), never the everyday one. The directory signs
 * in through the Obsidian account, so while that profile is still signed in
 * to obsidian.md a visit renews the directory's session silently: headless,
 * and the new session is stored as the secret without a word. When the
 * Obsidian account session has run out too, it signs in headless with the
 * account — typed into obsidian.md's form only, never printed, logged or
 * passed on to a child process. A wrapper of the project's sets
 * `globalThis.obsidianDirectoryCredentials = () => ({ usr, pw })`, reading
 * them from wherever it keeps them, and imports this module; or they come
 * from OBSIDIAN_EMAIL / OBSIDIAN_PASSWORD. Only when that fails (none given, a rejected password, a two-factor
 * code asked for) does it send a desktop notification and open that
 * profile's window on the login page; once signed in there, it stores the
 * session and closes the window.
 *
 * The cookie value is piped from the browser straight into `gh secret set`;
 * it is never printed or written to disk outside the profile. A hash of the
 * last upload (<state>/uploaded) skips unchanged ones.
 *
 * devkit.config.json: "repository" (owner/name, where the secret goes),
 * "name", "obsidian.directoryId" (else manifest.json's id). Environment:
 * DIRECTORY_DATA, DIRECTORY_STATE, DIRECTORY_UNIT (systemd unit name),
 * DIRECTORY_EXEC (the command the timer runs; default: this process's).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

let config = {};
try { config = JSON.parse(readFileSync("devkit.config.json", "utf8")); } catch {}
const ID = config.obsidian?.directoryId ?? JSON.parse(readFileSync("manifest.json", "utf8")).id;
const NAME = config.name ?? ID;
const SITE = "https://community.obsidian.md";
const PAGE = `${SITE}/account/plugins/${ID}`;
const REPO = config.repository;
if (!REPO) { console.error("devkit.config.json has no \"repository\" (owner/name) to store the secret in"); process.exit(2); }
const SECRET = "OBSIDIAN_COMMUNITY_COOKIE";
const DATA = process.env.DIRECTORY_DATA ?? join(homedir(), ".local/share/obsidian-directory", ID);
const STATE = process.env.DIRECTORY_STATE ?? join(homedir(), ".local/state/obsidian-directory", ID);
const PROFILE = join(DATA, "profile");
const UNIT = process.env.DIRECTORY_UNIT ?? `obsidian-directory-session-${ID}`;
// Read once and taken out of the environment, so no child process (gh, npm,
// systemctl, notify-send) inherits the password.
const ENV_CREDENTIALS = process.env.OBSIDIAN_EMAIL && process.env.OBSIDIAN_PASSWORD
	? { usr: process.env.OBSIDIAN_EMAIL, pw: process.env.OBSIDIAN_PASSWORD } : null;
delete process.env.OBSIDIAN_EMAIL;
delete process.env.OBSIDIAN_PASSWORD;
const LOGIN_MINUTES = 15;

const log = (m) => console.log(`${new Date().toISOString().slice(0, 16).replace("T", " ")} ${m}`);
const notify = (title, body) => spawnSync("notify-send", ["-a", `${NAME} release`, "-u", "critical", title, body]);

if (process.argv.includes("--remove")) {
	spawnSync("systemctl", ["--user", "disable", "--now", `${UNIT}.timer`], { stdio: "inherit" });
	for (const f of [`${UNIT}.service`, `${UNIT}.timer`]) rmSync(join(homedir(), ".config/systemd/user", f), { force: true });
	spawnSync("systemctl", ["--user", "daemon-reload"]);
	log("daily renewal removed");
	process.exit(0);
}

// systemd splits ExecStart at spaces: a project in "my plugins/x" ran
// "/home/…/my" and failed every day without a word. Quoted, it holds.
const quote = (path) => `"${path.replace(/(["\\])/g, "\\$1")}"`;
if (process.argv.includes("--install")) {
	const dir = join(homedir(), ".config/systemd/user");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${UNIT}.service`), `[Unit]
Description=Renew the ${NAME} Release workflow's community-directory session

[Service]
Type=oneshot
WorkingDirectory=${process.cwd()}
ExecStart=${process.env.DIRECTORY_EXEC ?? `${quote(process.execPath)} ${quote(resolve(process.argv[1]))}`}
`);
	writeFileSync(join(dir, `${UNIT}.timer`), `[Unit]
Description=Renew the ${NAME} Release workflow's community-directory session daily

[Timer]
OnCalendar=daily
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
`);
	spawnSync("systemctl", ["--user", "daemon-reload"]);
	spawnSync("systemctl", ["--user", "enable", "--now", `${UNIT}.timer`], { stdio: "inherit" });
	log(`daily renewal installed (systemctl --user list-timers ${UNIT}.timer; journalctl --user -u ${UNIT})`);
}

// playwright-core, kept out of the project's dependencies.
const DEPS = join(DATA, "deps");
if (!existsSync(join(DEPS, "node_modules/playwright-core"))) {
	mkdirSync(DEPS, { recursive: true });
	execFileSync("npm", ["install", "--silent", "--no-save", "--no-package-lock", "--prefix", DEPS, "playwright-core@1"], { stdio: "inherit" });
}
const { chromium } = createRequire(join(DEPS, "package.json"))("playwright-core");

/** Opens the admin page with the profile; true when it ends there signed in. */
async function visit(context) {
	const page = context.pages()[0] ?? await context.newPage();
	await page.goto(PAGE, { waitUntil: "domcontentloaded" }).catch(() => {});
	// The directory's /auth/login hands over to obsidian.md and back; give the
	// silent round trip time to finish.
	await page.waitForURL((u) => u.href.startsWith(PAGE), { timeout: 20_000 }).catch(() => {});
	return page;
}
const signedIn = (page) => page.url().startsWith(PAGE);

/**
 * { usr, pw }, or null: from a wrapper's `globalThis.obsidianDirectoryCredentials()`
 * (read where the project keeps them, only when needed), else from the
 * environment as read at start.
 */
function saved() {
	const given = globalThis.obsidianDirectoryCredentials?.();
	if (given?.usr && given?.pw) return given;
	return ENV_CREDENTIALS;
}

/** On obsidian.md's sign-in form: fills in the saved credentials. */
async function signInWithSaved(page) {
	const creds = saved();
	if (!creds) { log("no credentials (OBSIDIAN_EMAIL / OBSIDIAN_PASSWORD)"); return false; }
	const email = page.locator("#labeled-input-email");
	if (!await email.waitFor({ timeout: 15_000 }).then(() => true, () => false)) { log("no sign-in form where one was expected"); return false; }
	await email.fill(creds.usr);
	await page.locator("#labeled-input-password").fill(creds.pw);
	await page.getByRole("button", { name: "Sign in", exact: true }).click();
	await page.waitForURL((u) => u.href.startsWith(PAGE), { timeout: 45_000 }).catch(() => {});
	if (signedIn(page)) { log("signed in with the saved credentials"); return true; }
	const mfa = await page.locator("#labeled-input-mfa").isVisible().catch(() => false);
	log(mfa ? "the account asks for a two-factor code" : "the saved credentials did not sign in");
	return false;
}

async function store(context) {
	const cookies = await context.cookies(SITE);
	if (!cookies.length) throw new Error("no cookies for the directory after signing in");
	const header = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
	const hash = createHash("sha256").update(header).digest("hex");
	const seen = join(STATE, "uploaded");
	if (existsSync(seen) && readFileSync(seen, "utf8") === hash) { log("session unchanged; the secret is current"); return; }
	const done = spawnSync("gh", ["secret", "set", SECRET, "--repo", REPO], { input: header, stdio: ["pipe", "ignore", "inherit"] });
	if (done.status !== 0) throw new Error("gh secret set failed (is gh signed in?)");
	mkdirSync(STATE, { recursive: true });
	writeFileSync(seen, hash);
	const until = Math.min(...cookies.filter((c) => c.expires > 0).map((c) => c.expires));
	log(`renewed ${SECRET}${Number.isFinite(until) ? ` (valid until ${new Date(until * 1000).toISOString().slice(0, 10)})` : ""}`);
}

mkdirSync(PROFILE, { recursive: true });
let context = await chromium.launchPersistentContext(PROFILE, { channel: "chrome", headless: true });
let renewed = false;
try {
	const page = await visit(context);
	if (signedIn(page) || await signInWithSaved(page)) {
		await store(context);
		renewed = true;
	}
} finally {
	await context.close();
}
if (renewed) process.exit(0);

// Neither the profile nor the saved credentials got in: this needs a person.
log("could not sign in by itself; asking for a sign-in");
notify(`${NAME}: sign in to the Obsidian community site`, `A window is open for it. The Release workflow needs the session to scan and publish releases (${LOGIN_MINUTES} minutes).`);
context = await chromium.launchPersistentContext(PROFILE, { channel: "chrome", headless: false, viewport: null });
try {
	const page = await visit(context);
	await page.bringToFront().catch(() => {});
	await page.waitForURL((u) => u.href.startsWith(PAGE), { timeout: LOGIN_MINUTES * 60_000 });
	await store(context);
	notify(`${NAME}: directory session renewed`, "Thanks — the Release workflow can sign in again.");
} catch (e) {
	log(`not renewed: ${e.message.split("\n")[0]}`);
	notify(`${NAME}: directory session not renewed`, "Run the directory session renewal again to retry.");
	process.exitCode = 1;
} finally {
	await context.close().catch(() => {});
}
