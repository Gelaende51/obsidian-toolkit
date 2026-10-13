#!/usr/bin/env node
/**
 * Brings a freshly launched sandboxed Obsidian into the state suites are
 * written against, before any suite runs (obsidian-run-suite calls it). From Lure.
 *
 * - obsidian-launcher enables every plugin it installs. The neighbours belong
 *   off — a suite turns each on for its own cases; left on together, one
 *   answered the clicks the plugin under test was being tested on. Kept on:
 *   the plugin itself ("id") and "obsidian.keepEnabled" in devkit.config.json.
 * - Obsidian opens a first window at 1024×800; layout cases want a desktop-sized
 *   one ("obsidian.window": [1600, 1000] by default).
 */
import { readFileSync } from "node:fs";
import { connect } from "../lib/cdp-session.mjs";

let config = {};
try { config = JSON.parse(readFileSync("devkit.config.json", "utf8")); } catch {}
const KEEP = [config.id, ...(config.obsidian?.keepEnabled ?? [])].filter(Boolean);
const [WIDTH, HEIGHT] = config.obsidian?.window ?? [1600, 1000];

const page = await connect();
const state = JSON.parse(await page.evaluate(`
	for (const id of [...app.plugins.enabledPlugins]) {
		if (!${JSON.stringify(KEEP)}.includes(id)) await app.plugins.disablePluginAndSave(id);
	}
	let resized = false;
	try {
		if (typeof electronWindow !== "undefined" && electronWindow.setSize) {
			electronWindow.setSize(${WIDTH}, ${HEIGHT});
			resized = true;
		}
	} catch {}
	await new Promise((r) => setTimeout(r, 500));
	return JSON.stringify({ enabled: [...app.plugins.enabledPlugins], resized, inner: [innerWidth, innerHeight] });
`));

// Without Obsidian's own handle on the window, the browser end of the
// DevTools protocol can resize it.
if (state.inner[0] < WIDTH - 50) {
	const origin = `http://127.0.0.1:${process.env.OBSIDIAN_CDP_PORT ?? 9222}`;
	const { webSocketDebuggerUrl } = await (await fetch(`${origin}/json/version`)).json();
	const target = (await (await fetch(`${origin}/json/list`)).json()).find((t) => t.type === "page");
	const ws = new WebSocket(webSocketDebuggerUrl);
	await new Promise((r) => ws.addEventListener("open", r, { once: true }));
	let id = 1;
	const call = (method, params) => new Promise((resolve) => {
		const me = id++;
		const on = (e) => { const m = JSON.parse(e.data); if (m.id === me) { ws.removeEventListener("message", on); resolve(m.result ?? m.error); } };
		ws.addEventListener("message", on);
		ws.send(JSON.stringify({ id: me, method, params }));
	});
	const win = await call("Browser.getWindowForTarget", { targetId: target.id });
	if (win?.windowId) await call("Browser.setWindowBounds", { windowId: win.windowId, bounds: { width: WIDTH, height: HEIGHT, windowState: "normal" } });
	ws.close();
	await new Promise((r) => setTimeout(r, 500));
	state.inner = JSON.parse(await page.evaluate(`return JSON.stringify([innerWidth, innerHeight]);`));
	state.resized = state.inner[0] >= WIDTH - 50 ? "via DevTools" : false;
}

console.log(`prepared: plugins on ${state.enabled.join(", ")}; window ${state.inner.join("×")} (resized: ${state.resized})`);
page.close();
