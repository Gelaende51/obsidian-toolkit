/**
 * The CDP session for Obsidian: electron-template's
 * (one long-lived connection, real key presses, PAUSE/SLOW, a stuck-page
 * diagnosis) with Obsidian's window choice and refusals. Same protocol as
 * .dev/cdp.mjs, kept separate so that stays a one-shot command-line tool.
 *
 * OBSIDIAN_VAULT picks the vault's window, OBSIDIAN_CDP_PORT (or CDP_PORT) the
 * port Obsidian was started with (--remote-debugging-port), SLOW stretches
 * every wait on a slow machine.
 */
import { connect as connectApp, decodeTitle, describeKey, pressKey, PAUSE, parkPointer, isPainting, asPosix } from "electron-template/cdp-session";

export { describeKey, pressKey, PAUSE, parkPointer, isPainting, asPosix };

/**
 * Picks the Obsidian window to drive.
 *
 * With more than one vault open there is more than one page target, and
 * their order is not stable — taking the first one silently ran a whole
 * suite against whichever window happened to be listed first, which is a
 * quiet way to get meaningless results. Match on the vault name instead:
 * Obsidian titles its windows "<file> - <vault> - Obsidian".
 *
 * Set OBSIDIAN_VAULT to choose; with one window open it is optional.
 */
function pickTarget(targets, vault) {
	const pages = targets.filter((t) => t.type === "page" && !t.url.startsWith("devtools://"));
	if (!pages.length) throw new Error("No page target — is a vault open?");
	if (!vault) {
		if (pages.length > 1) {
			const names = pages.map((t) => decodeTitle(t.title)).join("\n  ");
			throw new Error(
				`${pages.length} Obsidian windows are open, so the target is ambiguous.\n` +
					`  ${names}\nSet OBSIDIAN_VAULT=<vault name> to choose one.`,
			);
		}
		return pages[0];
	}
	// A vault can have more than one window, and not all of them hold a
	// vault: Obsidian's Settings opens as a page target of its own, titled
	// "Settings - <vault> - Obsidian", with no `app` in it at all. Picking it
	// fails every evaluate with "app is not defined", which reads like the
	// plugin having broken. The window holding a file is preferred, and the
	// known windowless ones are refused outright.
	const candidates = pages.filter((t) => decodeTitle(t.title).includes(` - ${vault} - `));
	// One window of that vault by name, for the parts of the app that open in
	// a window of their own — Obsidian's settings, when they are set to. The
	// suites never want it; a probe that has to click something in there does.
	const named = process.env.OBSIDIAN_WINDOW;
	if (named) {
		const wanted = candidates.find((t) => decodeTitle(t.title).includes(named));
		if (wanted) return wanted;
		throw new Error(
			`No window of "${vault}" whose title contains "${named}". Open windows:\n  ` +
				candidates.map((t) => decodeTitle(t.title)).join("\n  "),
		);
	}
	// Titled by the settings page it is showing ("Community plugins - …"), so
	// the title alone does not give it away; the address does. A vault window
	// is served from app://, a window of Obsidian's own UI is about:blank.
	const isSettings = (t) => /^Settings - /.test(decodeTitle(t.title)) || t.url === "about:blank";
	const match = candidates.find((t) => !isSettings(t)) ?? candidates[0];
	if (!match) {
		throw new Error(
			`No window for vault "${vault}". Open windows:\n  ` +
				pages.map((t) => decodeTitle(t.title)).join("\n  "),
		);
	}
	return match;
}

export async function connect() {
	return connectApp({
		pickTarget: (pages) => pickTarget(pages, process.env.OBSIDIAN_VAULT),
		check: process.env.OBSIDIAN_WINDOW || process.env.ALLOW_SETTINGS ? undefined : obsidianSettingsInFront,
	});
}

// Obsidian's settings, open in a window of their own, sit in front of the
// vault and take the focus with them — and a suite then measures a window
// that cannot answer a click. Three suites failed sixteen assertions that
// way in one run, every one of them a dropdown that "would not open".
// Refused rather than worked around: it is the same class as a window that
// is not compositing, and the answer is the same — say so, and let the
// person close it.
//
// A probe that means to drive the settings says so with OBSIDIAN_WINDOW,
// or with ALLOW_SETTINGS for the ones that open them from the vault side.
async function obsidianSettingsInFront(evaluate) {
	const settingsOpen = await evaluate(
		`const s = window.app?.setting;
		 // Two ways for them to be up: in this window, where the container
		 // is in this document, or in one of their own, where it is not —
		 // the instance here keeps a stale container either way, so the
		 // window itself is the honest question.
		 const own = s?.win;
		 return !!(s?.containerEl?.isConnected) || !!(own && own !== window && !own.closed);`,
	).catch(() => false);
	if (!settingsOpen) return null;
	return (
		"Obsidian's settings are open, and in a window of their own they take the\n" +
		"focus this window needs — clicks land nowhere and dropdowns never open.\n" +
		"Close them and run again (ALLOW_SETTINGS=1 to drive them on purpose)."
	);
}

/**
 * Re-reads main.js from disk before a run.
 *
 * Obsidian loads a plugin's bundle once, at enable time, and holds it. Edit
 * the source, rebuild, run the suite against the window that was already
 * open, and every assertion is made against the code Obsidian booted with —
 * so a suite can report a feature working that is not in the build, or a bug
 * fixed that is not fixed. It was found the only way it can be: by breaking a
 * feature deliberately and watching its own regression test still pass.
 *
 * A disable/enable cycle is what makes the run mean what it says. It costs
 * about a second, which is nothing next to a green run that proves nothing.
 */
export async function reloadPlugin(page, id) {
	await page.evaluate(`
		await app.plugins.disablePlugin(${JSON.stringify(id)});
		await new Promise((r) => setTimeout(r, 200));
		await app.plugins.enablePlugin(${JSON.stringify(id)});
		// Enabling does not wait for an async onload: wait until it has run,
		// or a case that drives the plugin straight after finds it half-made
		// (seen on emulated x64, where loading is slow).
		for (let i = 0; i < 100; i++) {
			if (app.plugins.plugins[${JSON.stringify(id)}]?._loaded) break;
			await new Promise((r) => setTimeout(r, 100));
		}
		await new Promise((r) => setTimeout(r, 400));
		return true;
	`);
}

/** Writes plugin settings a case depends on, and saves them — a fixture that is not a file. */
export async function setSettings(page, patch, id) {
	await page.evaluate(`
		const plugin = app.plugins.plugins[${JSON.stringify(id)}];
		Object.assign(plugin.settings, ${JSON.stringify(patch)});
		await plugin.saveSettings();
		return true;
	`);
}
