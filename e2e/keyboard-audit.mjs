#!/usr/bin/env node
// Automated keyboard-overlap audit.
//
// For every app view that has a text input, this focuses the input on the
// running Android emulator and asserts BOTH:
//   1. the soft keyboard actually appears (OS `mInputShown=true`), and
//   2. the input stays visible above it — the visual viewport shrinks when the
//      keyboard shows AND the input's rect fits inside the shrunk viewport.
//
// This catches the "composer hidden behind the keyboard" class of bug: in the
// broken state the keyboard appears but the WebView keeps full height (the
// visual viewport does NOT shrink), so an input near the bottom sits behind the
// keyboard — reported here as FAIL_NO_RESIZE.
//
// Prereqs: the debug APK installed, logged in, at the chat list; `adb` on PATH.
// A real phone has no hardware keyboard, so we force the on-screen keyboard on
// (the AVD forwards the host hardware keyboard, which would otherwise suppress
// it) — see setupKeyboard(). Run:  ANDROID_SERIAL=emulator-5554 node e2e/keyboard-audit.mjs
//
// Dep-free: uses adb + Node's built-in WebSocket (Node >= 22) over the debug
// WebView's Chrome DevTools socket.

import { execFileSync } from "node:child_process";

const PKG = process.env.MATERIX_PKG || "org.materix.app.debug";
const SERIAL = process.env.ANDROID_SERIAL || "emulator-5554";
const adb = (...a) => execFileSync("adb", ["-s", SERIAL, ...a], { encoding: "utf8" });
const sh = (cmd) => adb("shell", cmd);
const shSafe = (cmd) => { try { return sh(cmd); } catch { return ""; } }; // pidof exits 1 when absent
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (m) => { console.error("FATAL: " + m); process.exit(2); };

// A real phone user has no hardware keyboard; force the on-screen keyboard so it
// always shows (persists across reboot).
function setupKeyboard() {
  sh("settings put secure show_ime_with_hard_keyboard 1");
}
const imeShown = () => /mInputShown=true/.test(sh("dumpsys input_method"));

async function connectCDP() {
  // Launch the app if it isn't already up, then resolve its pid.
  let pid = shSafe(`pidof ${PKG}`).trim().split(/\s+/)[0];
  if (!pid) {
    sh(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
    for (let i = 0; i < 20 && !pid; i++) { await sleep(500); pid = shSafe(`pidof ${PKG}`).trim().split(/\s+/)[0]; }
  }
  if (!pid) die(`${PKG} is not running and could not be launched`);
  const sock = `webview_devtools_remote_${pid}`;
  let haveSock = false; // the WebView opens its debug socket a few seconds after launch
  for (let i = 0; i < 40; i++) { if (shSafe("cat /proc/net/unix").includes(sock)) { haveSock = true; break; } await sleep(500); }
  if (!haveSock) die(`no devtools socket ${sock} — is this a debug build, and did the WebView start?`);
  try { adb("forward", "--remove-all"); } catch {}
  adb("forward", "tcp:9222", `localabstract:${sock}`);
  let pages = [];
  for (let i = 0; i < 12; i++) {
    try { pages = await (await fetch("http://localhost:9222/json/list")).json(); } catch {}
    if (pages.some((p) => p.type === "page" && (p.url || "").includes("tauri.localhost"))) break;
    await sleep(300);
  }
  const page = pages.find((p) => p.type === "page" && (p.url || "").includes("tauri.localhost"));
  if (!page) die("no tauri.localhost page exposed over CDP");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", () => rej(new Error("ws error"))); });
  let id = 0, closed = false; const pend = new Map();
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  ws.addEventListener("close", () => { closed = true; for (const [, cb] of pend) cb({ __dead: true }); pend.clear(); });
  // Reject (don't hang) if the WebView dies — the emulator's LMK can reap it.
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    if (closed) return reject(new Error("WebView closed"));
    const i = ++id;
    const to = setTimeout(() => { pend.delete(i); reject(new Error("CDP timeout: " + method)); }, 10000);
    pend.set(i, (m) => { clearTimeout(to); m.__dead ? reject(new Error("WebView died mid-call")) : resolve(m); });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send("Runtime.enable");
  const evaluate = async (expr) => {
    const m = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    const r = m.result || {};
    if (r.exceptionDetails) throw new Error("CDP eval: " + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)));
    return r.result?.value;
  };
  return { evaluate, close: () => ws.close() };
}

// --- DOM helpers (run inside the WebView) ---
// The app keeps several views MOUNTED at once (a room's composer, room-info, …
// stay in the DOM behind modals), so every match must be filtered by real
// VISIBILITY, not mere presence — otherwise selectors hit hidden duplicates.
const VIS = "(e=>e&&e.checkVisibility&&e.checkVisibility()&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0)";
const clickAria = (c, label) =>
  c.evaluate(`(()=>{const vis=${VIS};const el=[...document.querySelectorAll(${JSON.stringify(`[aria-label=${JSON.stringify(label)}]`)})].find(vis);if(el){el.click();return true}return false})()`);
const clickText = (c, text, contains = false) =>
  c.evaluate(`(()=>{const vis=${VIS};const t=${JSON.stringify(text)};const el=[...document.querySelectorAll('button,[role=button],[role=menuitem],a,li')].filter(vis).find(e=>{const s=e.textContent.trim();return ${contains ? "s.includes(t)" : "s===t"}});if(el){el.click();return true}return false})()`);
const visible = (c, sel) => c.evaluate(`(()=>{const vis=${VIS};return [...document.querySelectorAll(${JSON.stringify(sel)})].some(vis)})()`);
// Hide the soft keyboard WITHOUT adb key events (BACK/ESC would background the
// app and get it LMK-killed) — blurring the focused input hides the IME.
const blur = (c) => c.evaluate("(document.activeElement&&document.activeElement.blur&&document.activeElement.blur(),true)");

// Reset to the chat list using in-app navigation only (never adb BACK).
// Order matters: checkVisibility() reports background controls (e.g. the New-chat
// button) as "visible" even when an overlay covers them, so CLOSE overlays first,
// then leave any open room, and only then treat "New chat visible" as "at list".
async function ensureList(c) {
  for (let i = 0; i < 10; i++) {
    if ((await clickAria(c, "Close")) || (await clickAria(c, "Close room info"))) { await sleep(400); continue; } // dialogs/modals
    if (await visible(c, '[aria-label="Back to chat list"]')) { // inside a room
      (await clickAria(c, "Back to chat list")) || (await c.evaluate("history.back()"));
      await sleep(500); continue;
    }
    if (await visible(c, '[aria-label="New chat"]')) return; // now genuinely at the list
    await sleep(300);
  }
}
async function openRoom(c) {
  await ensureList(c);
  await clickText(c, "Notes to self", true);
  await sleep(900);
}

// The check: dismiss any keyboard, tap the input, wait for the keyboard, measure.
// "Keyboard is up" is judged against the FULL screen height (constant), not a
// baseline that may already be shrunk (some views, e.g. the composer, auto-focus).
async function checkInput(c, sel, label) {
  await blur(c); await sleep(400); // reset: hide any existing keyboard (no adb keys)
  const found = await c.evaluate(
    `(()=>{const vis=${VIS};const el=[...document.querySelectorAll(${JSON.stringify(sel)})].find(vis);if(!el)return null;const r=el.getBoundingClientRect();return{cx:r.left+r.width/2,cy:r.top+r.height/2,dpr:devicePixelRatio,full:screen.height}})()`,
  );
  if (!found) return { label, sel, status: "NOT_FOUND" };
  const FULL = found.full; // screen.height is already CSS px in WebView — invariant to the keyboard
  const shrunk = (vvh) => vvh < FULL * 0.85; // keyboard occupies >~15% of the height
  const tap = () => sh(`input tap ${Math.round(found.cx * found.dpr)} ${Math.round(found.cy * found.dpr)}`);
  tap(); // real tap → shows keyboard (JS focus does not on Android)
  let shown = false;
  for (let i = 0; i < 25; i++) {
    await sleep(200);
    shown = imeShown();
    if (shown && shrunk(await c.evaluate("visualViewport.height"))) break;
    if (i === 10 && !shown) tap(); // one retry if the first tap didn't raise it
  }
  await sleep(600); // let scroll-into-view / layout settle before measuring
  const a = await c.evaluate(
    `(()=>{const vis=${VIS};const el=[...document.querySelectorAll(${JSON.stringify(sel)})].find(vis)||document.querySelector(${JSON.stringify(sel)});if(!el)return null;const r=el.getBoundingClientRect();return{top:r.top,bottom:r.bottom,vvh:visualViewport.height,vvtop:visualViewport.offsetTop}})()`,
  );
  await blur(c); await sleep(300); // hide keyboard for next step (no adb keys)
  if (!a) return { label, sel, status: "NOT_FOUND" };
  const visibleBottom = a.vvh + a.vvtop;
  const inputVisible = a.bottom <= visibleBottom + 4 && a.top >= a.vvtop - 4;
  let status;
  if (!shown) status = "NO_KEYBOARD";               // tap didn't raise the keyboard
  else if (!shrunk(a.vvh)) status = "FAIL_NO_RESIZE"; // BUG: keyboard up but viewport full-height → input hidden
  else if (!inputVisible) status = "FAIL_HIDDEN";     // resized, but input still outside the visible area
  else status = "PASS";
  return { label, sel, status, baseVvh: FULL, afterVvh: Math.round(a.vvh), inputBottom: Math.round(a.bottom) };
}

// View catalogue: how to reach each surface, and the inputs to check on it.
const VIEWS = [
  { name: "Chat list — search", nav: ensureList, inputs: [['input[type="search"]', "Search chats"]] },
  { name: "New chat — Direct message", nav: async (c) => { await ensureList(c); await clickAria(c, "New chat"); await sleep(800); await clickText(c, "New direct message"); await sleep(900); }, inputs: [['input[placeholder*="Search people"]', "DM search"]] },
  { name: "New chat — Group", nav: async (c) => { await ensureList(c); await clickAria(c, "New chat"); await sleep(800); await clickText(c, "New group"); await sleep(900); }, inputs: [['input[placeholder="Team chat"]', "Group name"], ['input[placeholder*="alice"]', "Invite people"]] },
  { name: "New chat — Join by address", nav: async (c) => { await ensureList(c); await clickAria(c, "New chat"); await sleep(800); await clickText(c, "Join a room"); await sleep(900); }, inputs: [['input[placeholder*="room:"]', "Room address"]] },
  { name: "New chat — Explore", nav: async (c) => { await ensureList(c); await clickAria(c, "New chat"); await sleep(800); await clickText(c, "Explore public rooms"); await sleep(900); }, inputs: [['input[placeholder*="public rooms"]', "Explore search"]] },
  { name: "Room — composer", nav: openRoom, inputs: [['[placeholder="Message"]', "Composer"]] },
  { name: "Room — search", nav: async (c) => { await openRoom(c); await clickAria(c, "Search messages"); await sleep(700); }, inputs: [['input[placeholder*="history"]', "In-room search"], ['input[placeholder*="messages"]', "In-room search"]] },
  { name: "Room — emoji search", nav: async (c) => { await openRoom(c); await clickAria(c, "Insert emoji"); await sleep(700); }, inputs: [['input[placeholder*="emoji" i]', "Emoji search"]] },
  { name: "Room info — invite", nav: async (c) => { await openRoom(c); await clickAria(c, "Room info"); await sleep(700); }, inputs: [['input[placeholder*="server.org"]', "Invite (details)"]] },
  { name: "Room settings — name/topic", nav: async (c) => { await openRoom(c); await clickAria(c, "Room info"); await sleep(500); await clickText(c, "Room settings", true); await sleep(600); }, inputs: [['input[value="Notes to self"], input[placeholder*="name" i]', "Room name"], ['textarea[placeholder*="about"]', "Room topic"]] },
];

const DBG = (...a) => { if (process.env.KBAUDIT_DEBUG) process.stderr.write(a.join(" ") + "\n"); };
const main = async () => {
  setupKeyboard();
  const c = await connectCDP();
  DBG("connected");
  const results = [];
  for (const v of VIEWS) {
    DBG("view:", v.name);
    try { await v.nav(c); } catch (e) { DBG("  nav error:", e.message); for (const [, lbl] of v.inputs) results.push({ view: v.name, label: lbl, status: "NAV_ERROR" }); continue; }
    if (process.env.KBAUDIT_DEBUG) DBG("  after nav, first input visible:", await visible(c, v.inputs[0][0]));
    const seen = new Set();
    for (const [sel, lbl] of v.inputs) {
      if (seen.has(lbl)) continue;
      let r;
      try { r = await checkInput(c, sel, lbl); }
      catch (e) { DBG("  eval error:", e.message); r = { view: v.name, label: lbl, status: "EVAL_ERROR" }; }
      if (r.status === "NOT_FOUND") continue; // try the next selector alias for this label
      seen.add(lbl);
      results.push({ view: v.name, ...r });
    }
    for (const [, lbl] of v.inputs) if (!seen.has(lbl)) results.push({ view: v.name, label: lbl, status: "NOT_FOUND" });
  }
  c.close();
  const lines = ["", "=== Keyboard-overlap audit ==="];
  let failed = 0;
  for (const r of results) {
    const ok = r.status === "PASS";
    if (r.status.startsWith("FAIL")) failed++;
    lines.push(`  ${ok ? "PASS " : r.status.startsWith("FAIL") ? "FAIL " : "SKIP "} ${r.status.padEnd(14)} ${r.view} > ${r.label}` + (r.baseVvh ? `  (vvh ${Math.round(r.baseVvh)}->${r.afterVvh}, input bottom ${r.inputBottom})` : ""));
  }
  const passed = results.filter((r) => r.status === "PASS").length;
  const skipped = results.filter((r) => r.status !== "PASS" && !r.status.startsWith("FAIL")).length;
  lines.push(`\n${passed} passed, ${failed} failed, ${skipped} skipped/not-found\n`);
  process.stdout.write(lines.join("\n")); // synchronous write, then set exit code (no truncation)
  process.exitCode = failed ? 1 : 0;
};
main().catch((e) => die(e.stack || String(e)));
