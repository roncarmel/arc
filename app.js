// app.js: the page's logic. It signs in to the music service, reads playlists, and asks engine.py (running in
// Pyodide, which is Python in the browser) to plan the new playlists. Then it can create them.

// The music service this browser uses (work/tidal-plan.md, "The service layer"): Spotify, or TIDAL when `arcService` says so. Each service file sets
// its own object with the same members (service-spotify.js, service-tidal.js); the rest of Arc reaches the service only through `service`.
const service = (() => {
  try { if (localStorage.getItem("arcService") === "tidal" && typeof tidalService !== "undefined") return tidalService; } catch (err) { /* no storage: Spotify */ }
  return spotifyService;
})();

// Python runtime versions to try, newest first. If one is not available, the next is used.
const PYODIDE_VERSIONS = ["v0.29.3", "v0.29.2", "v0.29.1", "v0.29.0", "v0.28.3", "v0.27.7"];
const APP_VERSION = "2026-11-16zt";

// Every playlist this app creates gets this at the start of its description. That is the one way the app tells its
// own playlists from ones you made by hand, so it works on any device, and nothing is stored in this browser for it.
const APP_MARKER = "Made by Arc";                    // change this whenever the page is updated
function madeByAppText(text) { return typeof text === "string" && text.startsWith(APP_MARKER); }   // "Made by Ceremony Playlist Builder" is no longer read (Ron, 2026-11-14)
// A playlist Arc built for a participant says so in its description ("For participant MC."). Its songs are what that participant has heard, so building a recipe never
// replaces or renames it (decided by Ron, 2026-11-12). Returns the code, or "".
const PARTICIPANT_RE = /\bFor participant ([A-Z0-9]{1,4})\./;
function participantOf(text) { const m = typeof text === "string" && madeByAppText(text) ? text.match(PARTICIPANT_RE) : null; return m ? m[1] : ""; }
// A participant's playlist ends with packed data (Ron, 2026-11-14), after "For participant MC. Built 14 Nov 2026.": the recipe it was built from, by its ID, so a renamed
// playlist or recipe changes nothing (Arc reads no data from playlist names), and their Heard before list: playlists they heard before Arc, chosen when they are added or
// later from their row (Ron, 2026-11-13). No playlist of its own: every playlist built for them carries the whole list, joined across them, so deleting one loses
// nothing and every device reads the same list. Packed as recipe saves are (formats.js: 14 bits a character from DENSE_BASE). Bytes: "P", version 1, the recipe ID's
// length (+128 when it starts "format-", which is left out) and its letters, the number of Heard before playlists and their IDs (16 bytes each), CRC-16.
// One version only: a page that meets another reads nothing. HEARD_MAX keeps the description within SAVE_LIMIT.
const HEARD_MAX = 15;
const DATA_MAGIC = 0x50, DATA_VERSION = 1, RECIPE_PREFIX = "format-";
function packData({ recipe = "", heard = [] } = {}) {
  let id = String(recipe || "");
  const prefixed = id.startsWith(RECIPE_PREFIX);
  if (prefixed) id = id.slice(RECIPE_PREFIX.length);
  if (!/^[\x20-\x7e]{0,100}$/.test(id)) id = "";
  const bytes = [DATA_MAGIC, DATA_VERSION, id.length + (prefixed && id ? 128 : 0), ...[...id].map((c) => c.charCodeAt(0)), 0];
  const count = bytes.length - 1;
  for (const h of heard) { const b = service.idToBytes(h); if (b && bytes[count] < HEARD_MAX) { bytes.push(...b); bytes[count] += 1; } }
  const crc = crc16(bytes);
  bytes.push(crc >> 8, crc & 0xff);
  return denseEncode(bytes);
}
// The packed data of a description, or null: it starts at the first packed character
function dataOf(text) {
  if (typeof text !== "string") return null;
  const at = [...text].findIndex((ch) => ch.charCodeAt(0) >= DENSE_BASE && ch.charCodeAt(0) < DENSE_BASE + 16384);
  if (at < 0) return null;
  const bytes = [];
  let acc = 0, bits = 0;
  for (const ch of [...text].slice(at)) {
    const v = ch.charCodeAt(0) - DENSE_BASE;
    if (v < 0 || v >= 16384) break;
    acc = (acc << 14) | v;
    bits += 14;
    while (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 0xff); acc &= (1 << bits) - 1; }
  }
  if (bytes[0] !== DATA_MAGIC || bytes[1] !== DATA_VERSION || bytes.length < 4) return null;
  const idLength = bytes[2] & 127, count = bytes[3 + idLength], end = 4 + idLength + (count || 0) * 16;
  if (count === undefined || bytes.length < end + 2) return null;
  if (crc16(bytes.slice(0, end)) !== ((bytes[end] << 8) | bytes[end + 1])) return null;
  const id = String.fromCharCode(...bytes.slice(3, 3 + idLength));
  const heard = [];
  for (let i = 4 + idLength; i < end; i += 16) heard.push(service.idFromBytes(bytes.slice(i, i + 16)));
  return { recipe: id ? ((bytes[2] & 128) ? RECIPE_PREFIX : "") + id : "", heard };
}
function heardOf(text) { const d = dataOf(text); return d ? d.heard : []; }
function recipeOf(text) { const d = dataOf(text); return d ? d.recipe : ""; }
// A description with its Heard before list replaced (none: taken out), the recipe kept
function withHeard(text, ids) {
  const t = String(text || ""), at = [...t].findIndex((ch) => ch.charCodeAt(0) >= DENSE_BASE && ch.charCodeAt(0) < DENSE_BASE + 16384);
  const base = (at < 0 ? t : [...t].slice(0, at).join("")).trimEnd();
  return `${base} ${packData({ recipe: recipeOf(t), heard: ids })}`;
}
// When it was built, from "Built 14 Nov 2026." in its description: a time in ms, or 0
function builtAtOf(text) {
  const m = typeof text === "string" ? text.match(/\bBuilt (\d{1,2}) ([A-Z][a-z]{2}) (\d{4})\./) : null;
  if (!m) return 0;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(m[2]);
  return month < 0 ? 0 : new Date(Number(m[3]), month, Number(m[1])).getTime();
}
// The word for pressing a button: "tap" on a touch screen, "click" with a mouse. Page text in the markup marks it with <span data-act>, filled in at startup.
function actWord(capital) {
  let touch = false;
  try { touch = window.matchMedia("(pointer: coarse)").matches; } catch (err) { /* no media queries: a mouse */ }
  const word = touch ? "tap" : "click";
  return capital ? word[0].toUpperCase() + word.slice(1) : word;
}
function fillActWords() {
  for (const el of document.querySelectorAll("[data-act]")) el.textContent = actWord(/^[A-Z]/.test(el.textContent));
}
// The music service's name in the markup's page text: <span data-service>Spotify</span>, filled in at startup (the markup's own word stays if scripts fail). Its
// requirement (Spotify Premium; none on TIDAL, where every account pays): [data-requirement] holds what says so, hidden when the service has none; inside it,
// [data-requirement-name] takes the requirement's name and [data-requirement-why] why it is needed. [data-service-mark] takes the service's mark, and
// [data-only="tidal"] shows only under that service.
function fillServiceWords() {
  for (const el of document.querySelectorAll("[data-service]")) el.textContent = service.name;
  for (const el of document.querySelectorAll("[data-service-mark]")) el.innerHTML = service.mark();   // its mark, plain (the markup's is Spotify's)
  for (const el of document.querySelectorAll("[data-only]")) el.hidden = el.dataset.only !== service.key;   // what only one service needs (its setup notes)
  const req = service.requirement;
  for (const el of document.querySelectorAll("[data-requirement]")) el.hidden = !req;
  if (!req) return;
  for (const el of document.querySelectorAll("[data-requirement-name]")) el.textContent = req.name;
  for (const el of document.querySelectorAll("[data-requirement-why]")) el.textContent = req.why;
}
// a time as H:MM:SS: 22564 seconds is "6:16:04"
function clockText(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
// Tally, only for the startup problem popup: when the scripts failed, the page's own report form (sendMessageForm) cannot run
const REPORT_FORM_URL = "https://tally.so/r/VppLZN";

const DEFAULT_FORMATS = modelToText({ formats: [] });   // a new visitor starts with no formats at all, and a big New format button

const $ = (id) => document.getElementById(id);

// Double-tapping an empty spot zooms the page on an iPhone, and the CSS rule that stops it only covers the widgets. So a second tap within 300 ms
// that does not land on a control is cancelled. Taps on controls are left alone, so tapping + or - quickly still counts every tap, and pinching still zooms.
let lastBareTap = 0;
document.addEventListener("touchend", (e) => {
  if (e.target && e.target.closest && e.target.closest("button, a, input, select, textarea, label, summary, [role='button'], [tabindex]")) return;
  const now = Date.now();
  if (now - lastBareTap < 300 && e.cancelable) e.preventDefault();
  lastBareTap = now;
}, { passive: false });

// Opened from an iPhone's Home Screen, a link to another site shows in a panel over the app, and closing it is the only way back to the setup steps.
// So there the developer dashboard links open in Safari instead (x-safari-https, iOS 17 and later; Apple does not document it), and the setup
// text says "Safari" and "this app" (data-home). Elsewhere nothing changes. Decided by Ron, 2026-11-05: only the dashboard, not other links.
function sendDashboardToSafari() {
  if (navigator.standalone !== true) return;
  document.querySelectorAll('a[href^="https://developer.spotify.com"], a[href^="https://developer.tidal.com"]').forEach((a) => {
    a.href = a.href.replace(/^https:/, "x-safari-https:");
    a.removeAttribute("target");
  });
  document.querySelectorAll("[data-home]").forEach((el) => { el.textContent = el.dataset.home; });
}

// The Home Screen app's top strip (#topEdge in index.html): there only while the page rests at its top, and put in as a new element a quarter second after
// scrolling stops there, because iOS notices a strip that is added but not one that comes back. The page scrolls the window, Music sharing its #msBody;
// other scrolling (tabs sideways, lists in popups) is left alone.
(function restStrip() {
  const standalone = navigator.standalone === true || !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  if (!standalone) return;
  let timer = 0;
  const sharingBody = () => (document.documentElement.classList.contains("view-sharing") ? document.getElementById("msBody") : null);
  const atTop = () => { const body = sharingBody(); return window.scrollY <= 2 && !(body && body.scrollTop > 2); };
  const take = () => { const old = document.getElementById("topEdge"); if (old) old.remove(); };
  const put = () => {
    take();
    if (!atTop() || !document.body) return;
    const strip = document.createElement("div");
    strip.id = "topEdge";
    strip.setAttribute("aria-hidden", "true");
    document.body.insertBefore(strip, document.body.firstChild);
  };
  document.addEventListener("scroll", (event) => {
    const t = event.target;
    if (t !== document && t !== sharingBody()) return;
    if (!atTop()) take();
    clearTimeout(timer);
    timer = setTimeout(put, 250);
  }, { capture: true, passive: true });
  put();
})();

// Things that did not start properly are collected here and shown in a banner, so a half-started page says so instead of just not responding.
const startupProblems = [];
let startupDone = false;

function on(id, type, handler) {
  const el = $(id);
  if (!el) { startupProblems.push(`missing element ${id}`); return; }
  el.addEventListener(type, handler);
}

function guarded(name, work) {
  // A step of starting up that fails must not stop the steps after it.
  try { return work(); } catch (err) { startupProblems.push(`${name}: ${String((err && err.message) || err)}`); return undefined; }
}

// Is there a newer version of the page than the one that is running? version.txt, on the site, holds only the stamp of the version uploaded last, so asking costs a few bytes.
// It is asked a few seconds after a clean start, and whenever the person comes back to the tab or the window (at most every 30 seconds), so leaving and coming back is a manual
// check. Not when the app menu opens: the card arrived behind the open menu, and the first click on it only closed the menu (changed by Ron, 2026-11-07). Newer means different, since stamps do not sort once there are more than 26 in a day. The page never loads again by itself: a card at the bottom of the screen,
// at the bottom right, says Update available with both stamps and Get it (decided by Ron, 2026-11-05: updating should feel good, so the person does it). A running page is
// never harmed by an upload: it keeps what it loaded, and the Python engine is read once, at the start.
const versionCheck = { last: 0, everyMs: 30 * 1000, running: false, latest: "" };

// Says what it found: "new", "same", "failed" (no answer, or not a stamp), or "busy" (a check already under way)
async function checkForNewVersion() {
  if (versionCheck.running) return "busy";
  if (navigator.onLine === false) return "failed";
  versionCheck.running = true;
  versionCheck.last = Date.now();
  try {
    const response = await fetch("version.txt?t=" + Date.now(), { cache: "no-store" });
    if (!response.ok) return "failed";
    const latest = (await response.text()).trim();
    if (!/^[A-Za-z0-9._-]{4,40}$/.test(latest)) return "failed";   // not a stamp at all (an error page)
    if (latest === APP_VERSION) return "same";
    logStep(`newer version found: ${latest}`);
    versionCheck.latest = latest;
    showUpdateCard(latest);
    return "new";
  } catch (err) {
    return "failed";   // no connection, or the file is not there: the next time
  } finally {
    versionCheck.running = false;
  }
}

function showUpdateCard(latest) {
  const card = $("updateCard");
  if (!card) return;
  $("updateFrom").textContent = APP_VERSION;
  $("updateTo").textContent = latest;
  card.hidden = false;
  document.documentElement.classList.add("update-ready");   // the corner, or the strip along the bottom, shows while the card does
}

function reloadForNewVersion(failed) {
  if (window.pageStart && window.pageStart.refresh) window.pageStart.refresh(failed || (() => {}));   // fresh copies of every file, then the page again
  else location.reload();
}

function showStartupProblems() {
  if (!startupProblems.length) {
    try { sessionStorage.removeItem("startupRefreshed"); } catch (err) { /* nothing was kept */ }   // a clean start: the next stale copy may be tried again by itself
    return;
  }
  closeUpdateScreen();
  endLaunchScreen();
  try { recordError("Startup: " + startupProblems.join("; ").slice(0, 300)); } catch (err) { /* the popup matters more */ }
  const link = $("startupReport");   // the startup popup keeps the Tally form: the page's own report form needs the scripts that just failed
  if (link) { try { link.href = reportUrl(); } catch (err) { /* the plain link still works */ } }
  if (window.pageStart && window.pageStart.problem) window.pageStart.problem(startupProblems[0]);
  else { const box = $("startupProblem"); if (box) box.hidden = false; }
}

function startupFailed(err) {
  startupProblems.push(`startup stopped: ${String((err && err.message) || err)}`);
  showStartupProblems();
}

// ---------------------------------------------------------------- the three pages
// One page shows at a time: "welcome" (the first visit), "setup" (making the Spotify developer app and pasting its Client ID), or "app".
// The script in index.html's <head> decides the same way before anything is drawn; showPage follows the changes after that.
// setupStarted is "1" once Start setup is pressed and "0" after going back to the welcome page. setupAgain (this tab only) is the setup page
// opened from the app menu, to change the Client ID.
const PAGES = ["welcome", "setup", "app"];

function storedItem(store, key) {
  try { return store.getItem(key); } catch (err) { return null; }
}

function pageName() {
  if (service.signedIn() || connectingScreen) return "app";
  if (storedItem(sessionStorage, "setupAgain") === "1") return "setup";
  if (storedItem(localStorage, "connectedBefore") === "1") return "app";
  const setup = storedItem(localStorage, "setupStarted");
  if (setup === "1" || (setup === null && storedItem(localStorage, "clientId"))) return "setup";
  return "welcome";
}

function showPage() {
  if (service.signedIn()) { try { sessionStorage.removeItem("setupAgain"); } catch (err) { /* nothing to forget */ } }   // signed in: the setup that was opened again is done
  const page = pageName();
  const root = document.documentElement;
  const was = PAGES.find((p) => root.classList.contains("page-" + p));
  for (const p of PAGES) root.classList.toggle("page-" + p, p === page);
  if (page === "app") {
    $("appSection").hidden = false;   // the recipes are there to edit, connected or not; Build becomes Connect while not
    document.body.classList.add("has-editor");
  }
  if (typeof applyMinimalMode === "function") applyMinimalMode();
  if (page !== "app") { alignWelcomeIcons(); drawSetupJoint(); }   // the band and the line, now that their page shows
  if (was && was !== page) { window.scrollTo(0, 0); requestAnimationFrame(() => window.scrollTo(0, 0)); }   // again after the new page is laid out, so the title sits where it does on the other page
}

// ---------------------------------------------------------------- Arc's views
// The app page has three views: home (the two tools), the playlist builder and Music sharing, chosen by a class on <html> (view-home, view-builder, view-sharing).
// It always opens on home (the <head> script adds view-home; decided by Ron, 2026-11-08). Opening a tool adds a step to the browser's history, so the back button
// (or a phone's back gesture) returns home; so do the icon and Arc in the bar at the top.
const VIEWS = ["home", "builder", "sharing"];
// the view the <head> script chose (home), or home when it did not run
let appView = VIEWS.find((v) => document.documentElement.classList.contains("view-" + v)) || "home";
document.documentElement.classList.add("view-" + appView);
const TOOL_NAMES = { builder: "Playlist builder", sharing: "Shared playlist library" };
// on phones Arc's bar has no room for the full name (Ron, 2026-11-09, mockups/bar-name-fit.png option 1)
const TOOL_SHORT_NAMES = { sharing: "Shared playlists" };
// the full name fits beside the tool's icon from 360 px; only narrower screens get the short one (Ron, 2026-11-14)
const PHONE_BAR = window.matchMedia ? window.matchMedia("(max-width: 359px)") : null;
function toolName(view, phone = !!(PHONE_BAR && PHONE_BAR.matches)) { return (phone && TOOL_SHORT_NAMES[view]) || TOOL_NAMES[view] || ""; }
function nameToolInBar() {
  $("appToolName").textContent = toolName(appView);
  // the tool's own icon beside its name, the one its row in the list shows (Ron, 2026-11-14, mockups/tool-icon-bar)
  const icon = document.querySelector('#appToolMenu .ab-mi[data-view="' + appView + '"] .ab-icon');
  if (!icon) return;
  const copy = icon.cloneNode(true);
  copy.className = "tool-icon";
  $("appToolIcon").replaceChildren(copy);
}
if (PHONE_BAR && PHONE_BAR.addEventListener) PHONE_BAR.addEventListener("change", () => nameToolInBar());

function showView(view, push = true) {
  if (!VIEWS.includes(view)) view = "home";
  if (view === appView) return;
  const was = appView;
  // from one tool to the other the tool slides half a screen and fades (sharing is below the builder), Arc's bar staying put (Ron, 2026-11-08, mockups/tool-motion.html B)
  if (was !== "home" && view !== "home" && slideTools(was, view, () => switchView(was, view, push))) return;
  // home and a tool: the whole screen slides sideways like the setup screens, a tool coming in from the right and home from the left (Ron, 2026-11-09, mockups/tool-motion.html)
  if ((was === "home" || view === "home") && slideHome(view === "home", () => switchView(was, view, push))) return;
  switchView(was, view, push);
}
// Runs something once a view is in place: a slide between tools calls switchView later, and opening Music sharing starts it afresh, so what goes on
// in the new view (Share from the builder opening the form) waits for it
let afterSwitch = null;
function showViewThen(view, then) {
  afterSwitch = then;
  showView(view);
  if (appView === view && afterSwitch === then) { afterSwitch = null; then(); }
}
function switchView(was, view, push, sharingTab = "find") {
  appView = view;
  if (was === "sharing" && typeof closeSharing === "function") closeSharing();
  if (typeof editor === "object" && editor.appMenu && typeof closePanels === "function") closePanels();
  const root = document.documentElement;
  for (const v of VIEWS) root.classList.toggle("view-" + v, v === view);
  nameToolInBar();
  if (typeof renderAppMenu === "function") renderAppMenu();   // the ⋯ sits in home's band on home, in Arc's bar in a tool
  closeToolMenu(false);
  if (push && view !== "home") { try { history.pushState({ view }, ""); } catch (err) { /* the back button just leaves the page */ } }
  window.scrollTo(0, 0);
  logLayout("view " + view, was);
  if (view === "builder" && typeof renderEditor === "function") renderEditor();   // drawn while hidden, the tabs and the welcome arrow measured nothing
  if (view === "sharing") { placeSharingPage(); openSharing(sharingTab); }
  if (view === "home") { renderHomeRecipes(); alignWelcomeIcons(); }   // drawn while hidden, the band's icon measured nothing
  placeDevPill();
  if (afterSwitch) { const then = afterSwitch; afterSwitch = null; then(); }
}
// Builder and Music sharing as if stacked: to sharing the builder goes up half a screen as it fades and sharing rises half a screen into place; back the other way.
// View Transitions with Arc's bar named (vt-tools in index.html), so only the tool below it moves. Not under reduced motion or without View Transitions.
let toolSlideCount = 0;
function slideTools(from, to, change) {
  const root = document.documentElement;
  if (typeof document.startViewTransition !== "function" || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) return false;
  const mine = ++toolSlideCount;
  root.classList.add("vt-tools");
  root.classList.toggle("vt-tools-up", to === "builder");
  let move;
  try { move = document.startViewTransition(change); }
  catch (err) { root.classList.remove("vt-tools", "vt-tools-up"); return false; }
  move.finished.finally(() => { if (toolSlideCount === mine) root.classList.remove("vt-tools", "vt-tools-up"); });
  return true;
}

// Not when the browser animates a back or forward gesture itself (uaHistorySlide, set by pageHistoryMoved for its own change).
let homeSlideCount = 0, uaHistorySlide = false;
function slideHome(back, change) {
  const root = document.documentElement;
  if (uaHistorySlide || typeof document.startViewTransition !== "function" || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) return false;
  const mine = ++homeSlideCount;
  root.classList.add("vt-home");
  root.classList.toggle("vt-home-back", back);
  let move;
  try { move = document.startViewTransition(change); }
  catch (err) { root.classList.remove("vt-home", "vt-home-back"); return false; }
  move.finished.finally(() => { if (homeSlideCount === mine) root.classList.remove("vt-home", "vt-home-back"); });
  return true;
}

// The DEV menu sits in <body> (fixed, so no band, bar or transform holds it), placed under the icon or word that opened it (showDevMenu in editor.js)
function placeDevPill() {
  const wrap = $("devWrap");
  if (!wrap) return;
  if (typeof showDevMenu === "function") showDevMenu(false);
  if (wrap.parentNode !== document.body) document.body.appendChild(wrap);
}
placeDevPill();

// The Playlist builder's card on home: a strip saying how many recipes are ready ("4 recipes ready to build"; option C, Ron, 2026-11-08)
function renderHomeRecipes() {
  const line = $("homeRecipes");
  if (!line) return;
  const model = typeof editor === "object" ? editor.model : null;
  const count = model ? model.formats.filter((f) => !f.draft).length : 0;
  if (!count) line.textContent = "";   // no recipes yet: the card shows only its first two lines
  else putCounts(line, [count, ` ${count === 1 ? "recipe" : "recipes"} ready to build`]);
  fitHomeLines();
}

// A line of text with its numbers set apart (hp-num: pink, bold, larger): parts are numbers and strings, in order
function putCounts(el, parts) {
  el.textContent = "";
  for (const part of parts) {
    if (typeof part === "number") el.appendChild(Object.assign(document.createElement("b"), { className: "hp-num", textContent: String(part) }));
    else el.appendChild(document.createTextNode(part));
  }
}

// The tool cards on home keep each line on one line (decided by Ron, 2026-11-09): the taglines and the third lines' words share one size, the CSS one unless a line
// would not fit, then all of them shrink together, a tenth of a pixel at a time, as far as needed (a phone at 360 px: about 13 px instead of 13.8).
function fitHomeLines() {
  const page = $("homePage");
  if (!page || !document.documentElement.classList.contains("view-home")) return;
  fitOnOneLine([...page.querySelectorAll(".hp-tool .hp-tag, .hp-tool .hp-data")]);
}
// Lines that must not wrap share one size, shrunk together by a tenth of a pixel only while one would not fit (home's cards, the welcome page's tool cards).
function fitOnOneLine(all) {
  const lines = all.filter((el) => el.offsetParent !== null);
  for (const el of lines) el.style.fontSize = "";
  if (!lines.length) return;
  const wide = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().width > el.clientWidth - 1;
  };
  let size = parseFloat(getComputedStyle(lines[0]).fontSize);
  if (!size || !lines.some(wide)) return;
  for (let step = 0; step < 60 && lines.some(wide); step++) {
    size -= 0.1;
    for (const el of lines) el.style.fontSize = size.toFixed(1) + "px";
  }
}

// home's ⋯ goes into its band
function initHomeMore() {
  if (typeof renderAppMenu === "function") renderAppMenu();
}

// Back home: undoes the tool's step in the history when there is one, so the back button does not return to the tool
function goHome() {
  if (appView === "home") return;
  if (history.state && history.state.view) { history.back(); return; }   // the popstate that follows shows home
  showView("home", false);
}

// The tool's name in Arc's bar opens a list: both tools (the one shown ticked) and Arc home.
// Decided by Ron, 2026-11-08 (mockups/switch-tools.html A). It closes on a choice, a click or tap anywhere else, or Escape (which returns focus to the name).
function openToolMenu() {
  const menu = $("appToolMenu"), button = $("appTool");
  if (!menu.hidden) { closeToolMenu(true); return; }
  if (typeof editor === "object" && editor.appMenu && typeof closePanels === "function") closePanels();
  for (const item of menu.querySelectorAll(".ab-mi[data-view]")) {
    const view = item.dataset.view;
    if (view !== "home") item.setAttribute("aria-checked", String(view === appView));
  }
  button.setAttribute("aria-expanded", "true");
  menu.hidden = false;
  // under the name, kept inside the bar
  const bar = $("appBar").getBoundingClientRect(), from = button.getBoundingClientRect();
  menu.style.left = Math.max(0, Math.min(from.left - bar.left, bar.width - menu.offsetWidth)) + "px";
}

function closeToolMenu(focusName) {
  const menu = $("appToolMenu");
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  $("appTool").setAttribute("aria-expanded", "false");
  if (focusName) $("appTool").focus();
}

function chooseTool(view) {
  closeToolMenu(false);
  if (view === appView) return;
  if (view === "home") { goHome(); return; }
  if (appView === "home") { showView(view); return; }
  // from one tool to the other: the other takes the tool's place in the history, so back still goes home
  showView(view, false);
  try { if (history.state && history.state.view) history.replaceState({ view }, ""); else history.pushState({ view }, ""); } catch (err) { /* the back button just leaves the page */ }
}

function initToolMenu() {
  on("appTool", "click", (event) => { event.stopPropagation(); openToolMenu(); });
  on("appToolMenu", "click", (event) => {
    const item = event.target.closest && event.target.closest(".ab-mi");
    if (item && item.id === "appDevRow") { closeToolMenu(false); showDevMenu(true, $("appTool"), true); return; }
    if (item && !item.disabled) chooseTool(item.dataset.view);
  });
  // like the editor's menus, a tap elsewhere only closes the list
  document.addEventListener("click", (event) => {
    if ($("appToolMenu").hidden || $("appToolMenu").contains(event.target) || $("appTool").contains(event.target)) return;
    event.stopPropagation(); event.preventDefault();
    closeToolMenu(false);
  }, true);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("appToolMenu").hidden) { event.preventDefault(); closeToolMenu(true); } });
}

// Developer mode went on or off (setDevMode in editor.js): on, the owner's tools are asked for (sharing.js).
function devModeChanged(on) {
  markServiceTiles();
  paintTabTitle();
  if (on && connection === "ready" && typeof askOwner === "function") askOwner();
}

// Music sharing is a page under the bar: it starts where the bar ends
function placeSharingPage() {
  if (appView !== "sharing") return;
  const bar = $("waitStrip") && !$("waitStrip").hidden ? $("waitStrip") : $("appBar");   // under the strip while Spotify asks Arc to wait
  $("msOverlay").style.top = Math.max(0, Math.round(bar.getBoundingClientRect().bottom + 4)) + "px";
  logLayout("page placed under " + (bar.id === "appBar" ? "the bar" : "the wait strip"));
}

// ---------------------------------------------------------------- page position log (the DEV menu's Copy page position log)
// Music sharing's page once showed stuck with Arc's bar half under iOS's status bar and the tabs over it (Ron, 2026-11-15, cause unknown). Each event that can move
// the page is logged with where things were (the last 150, layoutLog in localStorage); the first time a check finds it out of place, the log up to then is
// kept apart (layoutStuck, the last 3), so what came before can be read. Logging only: nothing is put right here.
const LAYOUT_LOG_KEY = "layoutLog", LAYOUT_STUCK_KEY = "layoutStuck", LAYOUT_LOG_MAX = 150;
let layoutLast = "", layoutWasOff = false;
function layoutSnap() {
  const vv = window.visualViewport, r = (id) => { const el = $(id); if (!el || el.hidden || !el.getClientRects().length) return null; const b = el.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom)]; };
  const a = document.activeElement, ov = $("msOverlay");
  return {
    view: typeof appView === "string" ? appView : "?", sY: Math.round(window.scrollY), iH: window.innerHeight, iW: window.innerWidth,
    vvTop: vv ? Math.round(vv.offsetTop) : null, vvH: vv ? Math.round(vv.height) : null, vvScale: vv ? Math.round(vv.scale * 100) / 100 : null,
    bar: r("appBar"), strip: r("waitStrip"), ovTop: ov ? ov.style.top : null, ovRect: r("msOverlay"), tabs: r("msTabsBar"),
    typing: !!($("msDialog") && $("msDialog").classList.contains("ms-typing")), typingPage: !!(ov && ov.classList.contains("ms-typing-page")),
    focus: a && a !== document.body ? (a.id || a.tagName.toLowerCase()) : null, hidden: document.hidden,
    vt: [...document.documentElement.classList].filter((c) => c.startsWith("vt-")).join(" ") || null,
  };
}
// out of place: in Music sharing, not typing, and the page panned or not under the bar
function layoutOff(n) {
  if (n.view !== "sharing" || n.typing || n.typingPage || n.hidden || n.vt) return null;
  const under = n.strip || n.bar;
  if (n.sY !== 0) return "window scrolled " + n.sY;
  if (n.vvTop > 0) return "view panned " + n.vvTop;
  if (under && n.ovRect && Math.abs(n.ovRect[0] - (under[1] + 4)) > 2) return `page top ${n.ovRect[0]}, bar foot ${under[1]}`;
  if (n.bar && n.bar[0] < 0) return "bar above the screen " + n.bar[0];
  return null;
}
function logLayout(event, detail) {
  let n;
  try { n = layoutSnap(); } catch (err) { return; }
  const off = layoutOff(n);
  const key = JSON.stringify([event, detail, n]);
  if (key === layoutLast) return;   // the same again (a scroll that moved nothing)
  layoutLast = key;
  const entry = { at: new Date().toISOString().slice(11, 23), since: Math.round(performance.now()), event, ...(detail != null ? { detail: String(detail) } : {}), ...n, ...(off ? { OFF: off } : {}) };
  let log = [];
  try { log = JSON.parse(localStorage.getItem(LAYOUT_LOG_KEY) || "[]") || []; } catch (err) { log = []; }
  log.push(entry);
  if (log.length > LAYOUT_LOG_MAX) log = log.slice(-LAYOUT_LOG_MAX);
  try { localStorage.setItem(LAYOUT_LOG_KEY, JSON.stringify(log)); } catch (err) { /* private browsing: nothing kept */ }
  if (off && !layoutWasOff) {
    let kept = [];
    try { kept = JSON.parse(localStorage.getItem(LAYOUT_STUCK_KEY) || "[]") || []; } catch (err) { kept = []; }
    kept.push({ found: new Date().toISOString(), version: APP_VERSION, browser: describeBrowser(), tab: TAB_ID, off, log });
    try { localStorage.setItem(LAYOUT_STUCK_KEY, JSON.stringify(kept.slice(-3))); } catch (err) { /* too big or private browsing */ }
  }
  layoutWasOff = !!off;
}
function watchLayout() {
  const vv = window.visualViewport;
  let scrollLogged = 0;
  const throttled = (name) => () => { const now = performance.now(); if (now - scrollLogged > 250) { scrollLogged = now; logLayout(name); } };
  window.addEventListener("scroll", throttled("window scroll"), { passive: true });
  window.addEventListener("resize", () => logLayout("window resize"));
  if (vv) { vv.addEventListener("resize", () => logLayout("viewport resize")); vv.addEventListener("scroll", throttled("viewport scroll")); }
  window.addEventListener("orientationchange", () => logLayout("orientation"));
  window.addEventListener("pageshow", (e) => logLayout("pageshow", e.persisted ? "from the back-forward cache" : "fresh"));
  window.addEventListener("pagehide", () => logLayout("pagehide"));
  document.addEventListener("visibilitychange", () => logLayout(document.hidden ? "tab hidden" : "tab shown"));
  document.addEventListener("focusin", (e) => logLayout("focus in", e.target && (e.target.id || e.target.tagName)));
  document.addEventListener("focusout", (e) => logLayout("focus out", e.target && (e.target.id || e.target.tagName)));
  // the list scrolling only checks (once a second): it is how a stuck page is noticed while nothing else happens
  let listChecked = 0;
  document.addEventListener("scroll", (e) => { if (e.target && e.target.id === "msBody") { const now = performance.now(); if (now - listChecked > 1000) { listChecked = now; logLayout("list scroll"); } } }, { capture: true, passive: true });
}
function layoutLogText() {
  let log = [], stuck = [];
  try { log = JSON.parse(localStorage.getItem(LAYOUT_LOG_KEY) || "[]"); } catch (err) { /* unreadable */ }
  try { stuck = JSON.parse(localStorage.getItem(LAYOUT_STUCK_KEY) || "[]"); } catch (err) { /* unreadable */ }
  return "Arc page position log\n" + JSON.stringify({ version: APP_VERSION, browser: describeBrowser(), copied: new Date().toISOString(), now: layoutSnap(), stuck, log });
}
async function copyLayoutLog() {
  try { await navigator.clipboard.writeText(layoutLogText()); }
  catch (err) { showDevToast("Could not copy the log"); return; }
  showDevToast("Page position log copied");   // the DEV menu's own message: the line under the bar shows only in the builder
}

// "recipe" in the welcome page's intro opens a note above the word (the text above it has been read), moved left if needed so it stays inside the paragraph.
function showRecipeWhat(open) {
  const note = $("recipeWhatText"), word = $("recipeWhat");
  note.hidden = !open;
  word.setAttribute("aria-expanded", String(open));
  if (open) placeRecipeWhat();
}
function placeRecipeWhat() {
  const note = $("recipeWhatText"), word = $("recipeWhat"), para = word.closest("p");
  if (note.hidden || !para) return;
  const box = para.getBoundingClientRect(), at = word.getBoundingClientRect();
  note.style.top = Math.round(at.top - box.top - 6 - note.offsetHeight) + "px";   // above the word, over text already read
  note.style.left = Math.round(Math.max(0, Math.min(at.left - box.left, box.width - note.offsetWidth))) + "px";
}

// The welcome page has three steps: the tools, which music service, then what the one-time setup is. Each step forward adds a step to the browser's
// history, so back returns to the one before.
function welcomeStep() { return !$("wpSetup").hidden ? 3 : !$("wpWhich").hidden ? 2 : 1; }
function showWelcomeStep(step, push) {
  document.documentElement.classList.remove("wp-at-setup");   // set by the <head> script after choosing another service reloaded the page
  if (welcomeStep() === step) return;
  $("wpFirst").hidden = step !== 1;
  $("wpWhich").hidden = step !== 2;
  $("wpSetup").hidden = step !== 3;
  showRecipeWhat(false);
  if (push) { try { history.pushState({ page: "welcome", step }, ""); } catch (err) { /* the back button just leaves the page */ } }
  window.scrollTo(0, 0);
  if (step === 3) drawSetupJoint();
}
// The music service chosen on the welcome page. The one in use goes on at once; the other is set up (switchService) and the page loads again under it,
// opening on the next step (welcomeAt in sessionStorage, read by the <head> script and by startup), with the choice still one step back.
// Only Spotify can be chosen outside developer mode: TIDAL says Coming soon, greyed (Ron, 2026-11-16). A browser already on TIDAL keeps it.
function serviceOpen(key) { return key === "spotify" || key === service.key || document.documentElement.classList.contains("dev-mode"); }
// The tiles are radio buttons (Ron, 2026-11-16): a tap chooses one, and Next goes on with it. Arrow keys move the choice; only the chosen tile (or the
// first open one) is in the tab order. A tile closed again (developer mode turned off) loses its choice.
function serviceTiles() { return [...document.querySelectorAll("#wpWhich [data-pick-service]")]; }
function chosenService() { const t = serviceTiles().find((x) => x.getAttribute("aria-checked") === "true"); return t ? t.dataset.pickService : null; }
function markServiceTiles(chosen = chosenService()) {
  if (chosen && !serviceOpen(chosen)) chosen = null;
  const tiles = serviceTiles();
  const focusable = chosen || (tiles.find((t) => serviceOpen(t.dataset.pickService)) || {}).dataset?.pickService;
  for (const tile of tiles) {
    const key = tile.dataset.pickService;
    if (serviceOpen(key)) tile.removeAttribute("aria-disabled"); else tile.setAttribute("aria-disabled", "true");
    tile.setAttribute("aria-checked", String(key === chosen));
    tile.tabIndex = key === focusable ? 0 : -1;
  }
  if ($("wpWhichNext")) $("wpWhichNext").disabled = !chosen;
}
function chooseServiceTile(key, focus = false) {
  if (!serviceOpen(key)) return;
  markServiceTiles(key);
  if (focus) { const t = serviceTiles().find((x) => x.dataset.pickService === key); if (t) t.focus(); }
}
function moveServiceChoice(step) {
  const open = serviceTiles().map((t) => t.dataset.pickService).filter(serviceOpen);
  if (!open.length) return;
  const at = open.indexOf(chosenService());
  const next = at < 0 ? (step > 0 ? 0 : open.length - 1) : (at + step + open.length) % open.length;
  chooseServiceTile(open[next], true);
}
function pickService(key) {
  if (!serviceOpen(key)) return;
  if (key === service.key) { slideScreens(() => showWelcomeStep(3, true)); return; }
  if (!switchService(key)) return;
  try { sessionStorage.setItem("welcomeAt", "3"); } catch (err) { /* it opens on the tools */ }
  pageWindow().location.reload();
}
// This browser moves to another music service (the welcome page's choice, the DEV menu's Music service). Each service keeps its own Client ID (clientId-spotify,
// clientId-tidal), swapped in as `clientId`, and what this browser knows of the old one's saves is forgotten (as for another account, forgetOtherAccount), so the
// merge does not ask about saves the new service never had. Recipes stay and are saved to the new service. The page must load again after it.
function switchService(next) {
  if (next === service.key || buildWriting()) return false;
  try {
    const current = localStorage.getItem("clientId");
    if (current) localStorage.setItem("clientId-" + service.key, current); else localStorage.removeItem("clientId-" + service.key);
    const theirs = localStorage.getItem("clientId-" + next);
    if (theirs) localStorage.setItem("clientId", theirs); else localStorage.removeItem("clientId");
    for (const key of ["spotifySynced", "spotifyPendingDeletes", "spotifySavedAt", "spotifyAccount", "spotifyPlaylists"]) localStorage.removeItem(key);
    if (next === "spotify") localStorage.removeItem("arcService"); else localStorage.setItem("arcService", next);
  } catch (e) { return false; }
  return true;
}
// The setup step's line, on the welcome page and again over the setup question: down from just under the band's icon (white while over the band; it starts
// past the icon's ring rather than behind it, since a slide's first and last frames can draw it over the icon), a turn, then right to
// Spotify's mark, which sits where it would inside the band (16 px from its right edge). The mark at the middle is a link on both (the check waits for the connection).
function drawSetupJoint() {
  for (const joint of document.querySelectorAll(".wp-joint")) {
    const band = joint.parentElement && joint.parentElement.parentElement && joint.parentElement.parentElement.querySelector(".wp-band");
    if (!band || joint.closest("[hidden]")) continue;   // not shown
    const jb = joint.getBoundingClientRect(), bb = band.getBoundingClientRect(), ib = band.querySelector(".wp-band-icon").getBoundingClientRect();
    const x0 = ib.left + ib.width / 2 - jb.left, top = ib.bottom + 3 - jb.top, y = 62, size = 74, r = 14;
    const cx = bb.right - 16 - size / 2 - jb.left, x1 = cx - size / 2;
    const d = `M${x0} ${top} V${y - r} Q${x0} ${y} ${x0 + r} ${y} H${x1}`;   // drawn from Arc; the dash offset grows, so the dashes flow back from Spotify
    // The drawing reaches up over the band, so its box does too: a slide's snapshot of it (view transitions) leaves out what lies outside its box.
    const lift = Math.max(0, jb.top - bb.top), wire = joint.querySelector(".wp-wire");
    Object.assign(wire.style, { top: -lift + "px", height: jb.height + lift + "px" });
    for (const part of wire.querySelectorAll(".wp-wire-main, .wp-wire-band")) part.setAttribute("transform", `translate(0 ${lift})`);   // the band clip moves with them (it is in their space)
    joint.querySelector(".wp-wire-main").setAttribute("d", d);
    joint.querySelector(".wp-wire-band").setAttribute("d", d);
    const rect = joint.querySelector(".wp-band-rect");
    rect.setAttribute("x", bb.left - jb.left); rect.setAttribute("y", bb.top - jb.top); rect.setAttribute("width", bb.width); rect.setAttribute("height", bb.height);
    Object.assign(joint.querySelector(".wp-ok").style, { left: (x0 + r + x1) / 2 + "px", top: y + "px" });
    Object.assign(joint.querySelector(".wp-spotify").style, { left: cx - size / 2 + "px", top: y - size / 2 + "px" });
    // its name goes just under the mark's own drawing, which fills less of its box for some services (TIDAL's diamonds)
    let foot = 24;
    try { const g = joint.querySelector(".wp-spotify path").getBBox(); if (g.height > 0) foot = g.y + g.height; } catch (err) { /* not drawn yet: under the box */ }
    Object.assign(joint.querySelector(".wp-spotify-name").style, { left: cx + "px", top: y - size / 2 + foot * size / 24 + 6 + "px" });
  }
  alignLoops();
}
// The band's drifting pink and the line's flowing dashes run on one clock: each copy (the welcome page's, the setup page's, the sticky band's) starts its loop when
// it appears, so two screens' copies were out of step and jumped as a slide passed from one to the other. Started at the clock's zero, they always agree.
function alignLoops() {
  if (typeof document.getAnimations !== "function") return;   // an old browser: the loops just run on their own
  for (const a of document.getAnimations()) if ((a.animationName === "wp-flow" || a.animationName === "wp-drift") && a.startTime !== 0) a.startTime = 0;
}
function welcomeStepBack() {
  const step = welcomeStep();
  if (history.state && history.state.page === "welcome" && history.state.step === step) { history.back(); return; }   // the popstate that follows shows the step before
  slideScreens(() => showWelcomeStep(step - 1, false));
}

// Moving between the screens before the app (the tools, what setup is, the setup question, its steps) slides: forward, the screen leaves to the left as the next
// comes in from the right; back, the other way. The welcome band stays still between the two welcome steps. Drawn by the browser (View Transitions, CSS in
// index.html, vt-*; the setup line stays, fades in or fades out, wp-wire); a browser without them, reduced motion, or a back gesture the browser animates itself just changes the screen.
function screenRank() {
  const page = pageName();
  if (page === "welcome") return welcomeStep() - 1;
  if (page === "setup") return currentFlow() ? 4 : 3;
  return -1;
}
function slideScreens(change, event) {
  const root = document.documentElement, from = screenRank();
  const still = typeof document.startViewTransition !== "function" || from < 0 || (event && event.hasUAVisualTransition)
    || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  if (still) { change(); return; }
  let to = -1;
  const mine = ++slideCount;
  const band = [...document.querySelectorAll("#welcomePage .wp-band, #loginSection .wp-band")].find((el) => el.getClientRects().length > 0);
  root.style.setProperty("--vt-cover", band ? Math.max(0, band.getBoundingClientRect().bottom) + "px" : "0px");   // #vtCover: still, from the top to the band's foot
  root.classList.add("vt-slide");
  let move;
  try {
    move = document.startViewTransition(() => {
      change();
      alignLoops();
      to = screenRank();
      root.classList.toggle("vt-back", to < from);
    });
  } catch (err) { root.classList.remove("vt-slide", "vt-back"); return; }   // change() ran, or will
  move.ready.then(() => { if (to < 0 || to === from) move.skipTransition(); }).catch(() => {});
  move.finished.finally(() => { if (slideCount === mine) root.classList.remove("vt-slide", "vt-back"); });   // not when a later slide has started
}
let slideCount = 0;

// On the welcome page an icon spans exactly from the top of the letters of the name beside it to the bottom of the letters of the tagline under it (the band's
// icon and each tool card's). The text is pulled up and down by the empty room above and below its letters, measured from the font, and the icon takes its height.
function letterBounds(el) {
  const cs = getComputedStyle(el), text = el.textContent;
  let ctx = letterBounds.ctx;
  if (!ctx) { try { ctx = letterBounds.ctx = document.createElement("canvas").getContext("2d"); } catch (err) { return null; } }
  if (!ctx || !text) return null;
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const m = ctx.measureText(text);
  if (!(m.fontBoundingBoxAscent > 0) || !(m.actualBoundingBoxAscent > 0)) return null;   // an older browser: the plain layout stays
  const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
  const baseline = (lineHeight - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;   // from the top of a line to its baseline
  const box = el.getBoundingClientRect();
  return { top: box.top + baseline - m.actualBoundingBoxAscent, bottom: box.bottom - lineHeight + baseline + m.actualBoundingBoxDescent };
}
function alignIconToText(icon, text, first, last) {
  if (!icon || !text || !text.offsetHeight) return;
  text.style.marginTop = text.style.marginBottom = "";
  for (let pass = 0; pass < 2; pass++) {   // the icon's width can rewrap the tagline, so once more with the new width
    const box = text.getBoundingClientRect(), a = letterBounds(first), b = letterBounds(last);
    if (!a || !b) return;
    const above = a.top - box.top, below = box.bottom - b.bottom;
    icon.style.width = icon.style.height = Math.round(b.bottom - a.top) + "px";
    text.style.marginTop = -above + "px";
    text.style.marginBottom = -below + "px";
  }
}
// A tap on the icon in a pink band (welcome, setup, connecting, home) shows the version at the band's top right for a second, then fades it out over another second,
// and asks at once whether a newer version is out (Ron, 2026-11-10): a card shows if so, as with any check.
document.addEventListener("click", (event) => {
  const icon = event.target.closest && event.target.closest(".wp-band-icon");
  const band = icon && icon.closest(".wp-band");
  if (!band) return;
  flashBandVersion(band);
  if (startupDone) checkForNewVersion();
});
function flashBandVersion(band) {
  let ver = band.querySelector(".wp-band-ver");
  if (!ver) { ver = document.createElement("span"); ver.className = "wp-band-ver"; ver.setAttribute("aria-hidden", "true"); band.appendChild(ver); }
  ver.textContent = APP_VERSION;
  if (!ver.animate) return;
  ver.getAnimations().forEach((a) => a.cancel());
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  ver.animate(still ? [{ opacity: 1 }, { opacity: 1, offset: 0.999 }, { opacity: 0 }] : [{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], { duration: still ? 1000 : 2000, easing: "linear" });
}

function alignWelcomeIcons() {
  for (const band of document.querySelectorAll(".wp-band")) alignIconToText(band.querySelector(".wp-band-icon"), band.querySelector(".wp-band-text"), band.querySelector(".wp-band-name"), band.querySelector(".wp-band-tag"));
  // the tool cards' names and taglines stay on one line each, so both icons come out the same size (the builder's tagline wrapped on phones, Ron, 2026-11-14)
  fitOnOneLine([...document.querySelectorAll("#welcomePage .wp-tool-text b")]);
  fitOnOneLine([...document.querySelectorAll("#welcomePage .wp-tool-tag")]);
  for (const head of document.querySelectorAll("#welcomePage .wp-tool-head")) alignIconToText(head.querySelector(".tool-icon"), head.querySelector(".wp-tool-lines"), head.querySelector(".wp-tool-text b"), head.querySelector(".wp-tool-tag"));
  placeTutorialTip();
}

// Each tool's card on the welcome page opens in place to its picture and text; opening one closes the other, so the page stays short.
function toggleWelcomeTool(head) {
  const opening = head.getAttribute("aria-expanded") !== "true";
  for (const h of document.querySelectorAll("#welcomePage .wp-tool-head")) {
    const open = h === head ? opening : false;
    if ((h.getAttribute("aria-expanded") === "true") === open) continue;
    h.setAttribute("aria-expanded", String(open));
    const more = $(h.getAttribute("aria-controls"));
    if (typeof revealSmoothly === "function") revealSmoothly(more, open); else more.hidden = !open;
  }
  // the tutorial's row under the builder's card folds away while the card is open, which has the row inside it
  const watch = $("wpWatch"), builderOpen = $("wpBuilderHead").getAttribute("aria-expanded") === "true";
  if (watch && watch.hidden !== builderOpen) { if (typeof revealSmoothly === "function") revealSmoothly(watch, !builderOpen); else watch.hidden = builderOpen; }
  if (!opening) showRecipeWhat(false);
}

// ---------------------------------------------------------------- the tutorial video
// Decided by Ron, 2026-11-11 (mockups/tutorial-video-2.png M2 and D, mockups/tutorial-welcome-w3c.png). A landscape video, a file served with the site (no third party).
// Every way in (the builder's menu, its first-recipe card, the welcome page's rows) calls watchTutorial. On a computer it opens the menu's popup, made large (most of
// the tab), playing at once, with the browser's own player and its fullscreen button; at the end, Watch again and Done over the video. On a phone it goes fullscreen at
// once and, where the browser allows (Android), turns to landscape; on an iPhone, Apple's player, and the person turns the phone (a page cannot). The end returns to
// the page. Decided by Ron, 2026-11-11.
// Until the tutorial's address is set, every way in opens the popup saying the video is coming soon.
// TUTORIAL_VIDEO, TUTORIAL_POSTER and tutorialFrame are in editor.js, which loads first and draws the menu and the first-recipe card.

// the popup's player, filled as it opens (openInfo) and emptied as it closes, so nothing plays on behind it
function fillTutorialPlayer() {
  const player = $("tutorialPlayer");
  if (!player) return;
  player.textContent = "";
  if (TUTORIAL_VIDEO) {
    const video = document.createElement("video");
    video.controls = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.preload = "metadata";
    video.poster = TUTORIAL_POSTER;
    video.src = TUTORIAL_VIDEO;
    player.appendChild(video);
    player.appendChild(tutorialEndCard(video));
    video.addEventListener("ended", () => {   // out of the browser's fullscreen, so Watch again and Done are seen
      countTutorialEnd();
      if (document.fullscreenElement === video && document.exitFullscreen) document.exitFullscreen().catch(() => {});
      player.classList.add("tv-ended");
      video.controls = false;
    });
    const playing = video.play();   // opened by a click or tap, so it may play with sound
    if (playing && playing.catch) playing.catch(() => {});
  } else {
    const img = document.createElement("img");
    img.src = TUTORIAL_POSTER;
    img.alt = "";
    player.appendChild(img);
  }
  $("tutorialNote").textContent = TUTORIAL_VIDEO ? "A 2 minute walkthrough." : "The video is coming soon.";
}
// over the video once it ends: Watch again, and Done (which closes the popup, like the Done under it)
function tutorialEndCard(video) {
  const card = document.createElement("div");
  card.className = "tv-end";
  const again = document.createElement("button");
  again.type = "button";
  again.className = "tv-again";
  again.textContent = "Watch again";
  again.addEventListener("click", () => {
    $("tutorialPlayer").classList.remove("tv-ended");
    video.controls = true;
    video.currentTime = 0;
    const playing = video.play();
    if (playing && playing.catch) playing.catch(() => {});
  });
  const done = document.createElement("button");
  done.type = "button";
  done.className = "primary tv-done";
  done.textContent = "Done";
  done.addEventListener("click", () => closeInfo());
  card.append(again, done);
  return card;
}
function emptyTutorialPlayer() {
  const video = document.querySelector("#tutorialPlayer video");
  if (video) { video.pause(); video.removeAttribute("src"); video.load(); }
  if ($("tutorialPlayer")) { $("tutorialPlayer").textContent = ""; $("tutorialPlayer").classList.remove("tv-ended"); }
}

// a phone: a touch screen whose short side is a phone's (an iPad gets the popup, like a computer)
function tutorialOnPhone() {
  const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  return coarse && Math.min(screen.width, screen.height) <= 500;
}

function watchTutorial() {
  if (TUTORIAL_VIDEO) countTutorialStart(tutorialOnPhone() ? "phone" : "computer");
  if (TUTORIAL_VIDEO && tutorialOnPhone()) playTutorialFullscreen();
  else openInfo("tutorialSection");
}

// A phone: fullscreen at once. The video is made as the page starts (watchTutorialRows), so it knows its size by the tap; an iPhone will not go
// fullscreen with a video that has not. If going fullscreen fails, the popup opens instead.
function tutorialFullVideo() {
  let video = $("tutorialFull");
  if (video || !TUTORIAL_VIDEO) return video;
  video = document.createElement("video");
  video.id = "tutorialFull";
  video.controls = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.preload = "metadata";
  video.poster = TUTORIAL_POSTER;
  video.src = TUTORIAL_VIDEO;
  video.setAttribute("aria-hidden", "true");
  document.body.appendChild(video);
  const done = () => {
    if (!video.paused) video.pause();
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (error) {}
  };
  document.addEventListener("fullscreenchange", () => { if (document.fullscreenElement !== video) done(); });
  video.addEventListener("webkitendfullscreen", done);   // an iPhone's player closed
  video.addEventListener("ended", () => {   // the end returns to the page; an iPhone does this by itself
    countTutorialEnd();
    if (document.fullscreenElement === video && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    video.currentTime = 0;
  });
  return video;
}

function playTutorialFullscreen() {
  const video = tutorialFullVideo();
  if (!video) { openInfo("tutorialSection"); return; }
  const fallBack = () => { video.pause(); openInfo("tutorialSection"); };
  try {
    if (document.fullscreenEnabled && video.requestFullscreen) {
      video.requestFullscreen()
        .then(() => { if (screen.orientation && screen.orientation.lock) return screen.orientation.lock("landscape").catch(() => {}); })   // Android; an iPhone has no lock
        .catch(fallBack);
    }
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    else { fallBack(); return; }
    const playing = video.play();
    if (playing && playing.catch) playing.catch(() => {});
  } catch (error) { fallBack(); }
}

// the triangle on the row under the builder's card points at the middle of the card's icon
function placeTutorialTip() {
  const tip = $("wpWatchTip"), icon = document.querySelector("#wpBuilderHead .tool-icon"), row = $("wpWatch");
  if (!tip || !icon || !row || row.hidden) return;
  const iconBox = icon.getBoundingClientRect(), rowBox = row.getBoundingClientRect();
  if (!iconBox.width || !rowBox.width) return;
  tip.style.left = Math.round(iconBox.left + iconBox.width / 2 - rowBox.left - 1 - 6) + "px";   // less the row's border and half the triangle
}

function watchTutorialRows() {
  document.addEventListener("click", (event) => {
    const row = event.target.closest && event.target.closest("[data-tutorial]");
    if (row) { event.preventDefault(); watchTutorial(); }
  });
  if (tutorialOnPhone()) tutorialFullVideo();
}

// ---------------------------------------------------------------- the connecting screen
// Back from Spotify's sign-in, the script in index.html's <head> puts up a screen in place of the setup page, in its look: the band, the line to Spotify with a spinner, and a list
// of what is under way (signing in, reading the playlists, settling the recipes with their saves, starting Python), each ticked as it is done. When all are, it fades to the app.
// There is no time limit of its own: each step ends by finishing or by failing (a Spotify request that gets no answer fails after spotifyAnswerMs).
// A step that fails is marked for a moment, then the screen goes and the problem shows as usual. A question takes it down at once.
let connectingScreen = document.documentElement.classList.contains("connecting");
let connectingFailedMs = 1200;   // how long a failed step's mark is in view before the screen goes
const firstConnect = connectingScreen && storedItem(localStorage, "connectedBefore") !== "1";   // the end of setup: the screen says so and waits for a click (setupComplete)

// step: "Signin", "Playlists", "Recipes" or "Python"; state: "active", "done" or "failed"
function connectingStep(step, state) {
  const item = $("cn" + step);
  if (connectingScreen && item) item.className = "cn-step cn-" + state;
}

async function connectingStepFailed(step) {
  if (!connectingScreen) return;
  connectingStep(step, "failed");
  await new Promise((r) => setTimeout(r, connectingFailedMs));
  endConnectingScreen();
}

function endConnectingScreen() {
  if (!connectingScreen) return;
  connectingScreen = false;
  const screen = $("connectingScreen");
  screen.classList.add("cn-out");
  setTimeout(() => { document.documentElement.classList.remove("connecting"); screen.classList.remove("cn-out"); }, 450);   // after the fade
  showPage();   // the app, or, if the sign-in did not work, the setup page with what went wrong
}

// The first time ever, with every step ticked, the screen says "Setup complete!" over the ticked steps and stays until Continue is used (a user test found the app
// arriving by itself left it unclear that setup was over). Continue goes to Arc's home, where the person picks a tool (Ron, 2026-11-08). Any other visit, or a step that failed, goes straight on.
function setupComplete() {
  if (!connectingScreen || !firstConnect) return Promise.resolve();
  $("connectingScreen").classList.add("cn-finished");
  return new Promise((resolve) => $("cnContinue").addEventListener("click", () => resolve(true), { once: true }));   // a plain listener: it only lets the startup go on, so nothing in it can fail
}

// ---------------------------------------------------------------- the update card
// Get it puts a card over the blurred app at once ("Unwrapping the update"), and the script in index.html's <head> puts it back up after the reload (the "updating" mark in
// sessionStorage). It shows a spinner and the step under way (a bar would not be honest: the steps differ in length and Python loads alongside), and stays until the app is
// ready, so the Build button greying and the page settling happen out of sight. Then "All set!" with confetti and OK. Anything that needs the page (a question, the pause
// popup, a startup problem) or a start that did not end ready (no sign-in, no Python) takes it down quietly, and the app shows the problem as usual. Decided by Ron, 2026-11-07.
let updateScreen = document.documentElement.classList.contains("updating");

// Reading the playlists taking longer than usual (Spotify answering slowly, or its empty pages read in pieces: 34 s once, 2026-11-16) says so on whichever
// screen shows the steps, so the wait does not look stuck (Ron, 2026-11-16)
let slowReadingMs = 10000;
function slowReading(on) {
  const text = `${service.name} is slow to answer. Still working.`;
  if (connectingScreen && $("cnSlow")) $("cnSlow").textContent = on ? text : "";
  if (on) { updateStep(text); logStep("reading the playlists is slow"); }
}

function updateStep(text) {
  if (updateScreen) $("usStep").textContent = text;
  if (launchScreen) $("lsStep").textContent = text;
}

// ---------------------------------------------------------------- the launch screen
// Opened from an iPhone's Home Screen, the script in index.html's <head> puts up a launch screen like an app's: home's pink band in the middle of the screen and the
// step under way under it (the update card's steps). It stays until signed in, playlists read, recipes settled and Python ready, so the page settles out of sight.
// Then Ready, and the band glides up to where home's own band sits while home's parts rise in under it (decided by Ron, 2026-11-09, mockups/launch-band.html B).
// A start with no sign-in ends it as soon as that is known; anything that needs the page (a question, the pause popup, a startup problem) ends it at once, by fading.
// Not in a browser tab, except from the DEV menu's Launch screen (launchTest in sessionStorage, "slow" for a third of the speed).
let launchScreen = document.documentElement.classList.contains("launching");
let launchSlow = 1;
if (launchScreen) {
  try { launchSlow = sessionStorage.getItem("launchTest") === "slow" ? 3 : 1; sessionStorage.removeItem("launchTest"); } catch (err) { /* a Home Screen app */ }
  $("launchScreen").style.setProperty("--ls-x", launchSlow);
}

// The band over home's own band (left, width, top), moved down to the middle of the screen, a little above it so the step line under it is in the middle too
function placeLaunchBand() {
  const mid = $("launchScreen").querySelector(".ls-mid"), home = $("homePage").querySelector(".hp-band");
  const rect = home.getBoundingClientRect();
  if (!rect.width) return;   // home is not shown: the band stays in the middle by CSS
  mid.classList.add("ls-placed");
  mid.style.left = rect.left + "px";
  mid.style.width = rect.width + "px";
  mid.style.top = rect.top + "px";
  mid.style.transform = `translateY(${Math.max(0, Math.round((window.innerHeight - rect.height) / 2 - 20 - rect.top))}px)`;
}
if (launchScreen) {
  placeLaunchBand();
  window.addEventListener("resize", () => { if (launchScreen) placeLaunchBand(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeLaunchBand);
}

function endLaunchScreen() {
  if (!launchScreen) return;
  launchScreen = false;
  const screen = $("launchScreen");
  screen.classList.add("ls-out");
  setTimeout(() => { document.documentElement.classList.remove("launching"); screen.classList.remove("ls-out", "ls-ready"); }, 800);   // after the fade, slower than the other screens' (Ron, 2026-11-07)
}

// Home's parts under the band, each tool's card on its own, in the order they rise
function launchParts() {
  return [...$("homePage").children].flatMap((el) => el.classList.contains("hp-tools") ? [...el.children] : [el]).filter((el) => !el.classList.contains("hp-band") && el.getClientRects().length);
}

// The band glides to home's band, the background goes and home's parts rise in one after another; then home's band takes over in the same place. Only on home, with motion.
async function glideLaunchScreen() {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!document.documentElement.classList.contains("view-home") || still) return endLaunchScreen();
  launchScreen = false;
  const screen = $("launchScreen"), root = document.documentElement;
  placeLaunchBand();   // measured again, in case the page moved under it
  let i = 0;
  for (const part of launchParts()) part.style.setProperty("--ls-i", i++);
  root.style.setProperty("--ls-x", launchSlow);
  void screen.offsetHeight;
  screen.classList.add("ls-glide");
  root.classList.add("ls-arrive");
  await new Promise((r) => setTimeout(r, 750 * launchSlow));
  root.classList.remove("launching");
  screen.classList.remove("ls-glide", "ls-ready");
  await new Promise((r) => setTimeout(r, (350 + i * 70 + 520) * launchSlow));   // the last part has risen
  root.classList.remove("ls-arrive");
  root.style.removeProperty("--ls-x");
  for (const part of launchParts()) part.style.removeProperty("--ls-i");
}

// A start that ended ready says so: a pink check and Ready for a moment, and the screen is up at least LAUNCH_MIN_MS in all, so a fast start does not
// flash it by (Ron, 2026-11-07, option A over an Open button to tap every launch). A start that did not end ready goes at once, so the problem shows.
const LAUNCH_MIN_MS = 2000, LAUNCH_READY_MS = 1050;
async function finishLaunchScreen(ready) {
  if (!launchScreen) return;
  if (!ready) return endLaunchScreen();
  $("launchScreen").classList.add("ls-ready");
  $("lsStep").textContent = "Ready";
  const shown = typeof performance !== "undefined" && performance.now ? performance.now() : 0;   // since the page began, when the screen went up
  await new Promise((r) => setTimeout(r, Math.max(LAUNCH_READY_MS * launchSlow, LAUNCH_MIN_MS - shown)));
  if (launchScreen) await glideLaunchScreen();   // a question may have taken it down meanwhile
}

function getUpdate() {
  if (buildWriting()) return;
  try { sessionStorage.setItem("updating", "1"); } catch (err) { /* no storage: the card shows until the reload only */ }
  // the page comes back where it was: the tool and its tab (Recipes or Participants, By others or By you; Ron, 2026-11-13), restored behind the card (restoreUpdateView)
  try {
    sessionStorage.setItem("updateView", JSON.stringify({ view: appView, builder: typeof builderHome === "object" ? builderHome.tab : "", sharing: typeof sharing === "object" ? sharing.tab : "" }));
  } catch (err) { /* no storage: home, as on any start */ }
  updateScreen = true;
  $("updateScreen").classList.remove("us-done", "us-out", "us-failed", "us-swap");
  document.documentElement.classList.add("updating", "us-arrive");
  updateStep("Getting the new version");
  reloadForNewVersion(() => {
    try { sessionStorage.removeItem("updating"); sessionStorage.removeItem("updateView"); } catch (err) { /* nothing was kept */ }
    finishUpdateScreen("failed");
  });
}

// After Get it's reload, the tool and tab that were open come back, without motion, under the card. Only after an update: any other start opens on home.
function restoreUpdateView() {
  let kept = null;
  try { kept = JSON.parse(sessionStorage.getItem("updateView") || "null"); sessionStorage.removeItem("updateView"); } catch (err) { return; }
  if (!kept || !updateScreen || pageName() !== "app" || appView !== "home") return;
  if (kept.view === "builder") {
    if (kept.builder === "people") builderHome.tab = "people";
    switchView("home", "builder", true);
  } else if (kept.view === "sharing") {
    switchView("home", "sharing", true, kept.sharing === "share" ? "share" : "find");
  }
}

// how: "ready" (All set!), "failed" (the new version could not be fetched: said, with OK) or anything else (taken down quietly)
function finishUpdateScreen(how) {
  if (!updateScreen) return;
  if (how !== "ready" && how !== "failed") { closeUpdateScreen(); return; }
  const screen = $("updateScreen");
  $("usTitle").textContent = how === "ready" ? "All set!" : "The update did not arrive";
  const text = $("usText");
  text.textContent = "";
  if (how === "ready") text.append("You have the newest version of the app, ", Object.assign(document.createElement("em"), { textContent: APP_VERSION }), ".");
  else text.textContent = "Check your internet connection and try again.";
  screen.classList.remove("us-swap"); void screen.offsetWidth;   // the new words fade in, every part where it was
  screen.classList.add("us-done", "us-swap");
  screen.classList.toggle("us-failed", how === "failed");
  const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (how === "ready" && !still && typeof requestAnimationFrame === "function") throwConfetti(screen.querySelector(".us-fan"));
}

function closeUpdateScreen() {
  if (!updateScreen) return;
  updateScreen = false;
  const screen = $("updateScreen");
  screen.classList.add("us-out");
  setTimeout(() => {
    if (updateScreen) return;   // Get it again meanwhile
    document.documentElement.classList.remove("updating", "us-arrive");
    screen.classList.remove("us-out", "us-done", "us-failed", "us-swap");
  }, 450);
}

// The first save settles the recipes with their saves in Spotify (it may add or change some), so it is done before the screen goes.
async function settleFirstSave() {
  connectingStep("Recipes", "active");
  await runSpotifySave();
  if (saveState.error) await connectingStepFailed("Recipes");   // the line under the bar says what went wrong
  else connectingStep("Recipes", "done");
}

// Going to the setup page adds a step to the browser's history, so the back button (or a phone's back gesture) returns to where the person was.
function goToSetup(again) {
  try { if (again) sessionStorage.setItem("setupAgain", "1"); else localStorage.setItem("setupStarted", "1"); } catch (err) { /* private browsing */ }
  try { history.pushState({ page: "setup", again: !!again }, ""); } catch (err) { /* the back button just leaves the page */ }
  closeInfo();
  showPage();
}

// Back goes up one step: from the instructions to the question, and from the question to the page before.
function setupBack() {
  if (currentFlow()) { slideScreens(() => { showFlow(null); window.scrollTo(0, 0); }); return; }
  if (history.state && history.state.page === "setup") { history.back(); return; }   // the popstate that follows does the rest
  slideScreens(setupLeft);
}

function setupLeft() {
  try {
    if (storedItem(sessionStorage, "setupAgain") === "1") sessionStorage.removeItem("setupAgain");
    else localStorage.setItem("setupStarted", "0");
  } catch (err) { /* private browsing */ }
  showPage();
}

function pageHistoryMoved(event) {
  uaHistorySlide = !!(event && event.hasUAVisualTransition);
  try { slideScreens(() => historyMoved(), event); } finally { uaHistorySlide = false; }
}
function historyMoved() {
  const state = history.state;
  if (pageName() === "app" && !(state && state.page === "setup")) { showView((state && state.view) || "home", false); return; }
  if (state && state.page === "setup") {
    try { if (state.again) sessionStorage.setItem("setupAgain", "1"); else localStorage.setItem("setupStarted", "1"); } catch (err) { /* private browsing */ }
    showPage();
  } else if (pageName() === "setup") {
    setupLeft();
  }
  if (pageName() === "welcome") showWelcomeStep(state && state.page === "welcome" && state.step >= 2 ? state.step : 1, false);
}

// Blocks that open in a popup (the builder menu's tutorial, Feedback, Report a problem, the silence ?, the DEV menu's
// tools): the block itself moves into it, and goes back to its place when the popup closes.
const info = { node: null, marker: null, wasOpen: false, wasHidden: false, opener: null };

function openInfo(id) {
  closeInfo(true);
  const node = $(id);
  if (!node) return;
  info.node = node;
  info.opener = document.activeElement;   // focus goes back there on closing
  info.wasOpen = !!node.open;
  info.marker = document.createComment(id);
  node.before(info.marker);
  $("infoSlot").appendChild(node);
  if (node.tagName === "DETAILS") node.open = true;
  info.wasHidden = node.hidden;
  node.hidden = false;
  const title = node.querySelector("summary, h3");
  $("infoDialog").setAttribute("aria-label", title ? title.textContent.trim() : "");
  // the title over a line, with a round X, as in the build popup (Ron, 2026-11-10)
  $("infoTitle").textContent = title ? title.textContent.trim() : "";
  if (id === "reportBlock") refreshReportBox();
  if (id === "tutorialSection") fillTutorialPlayer();
  if (id === "deviceChecks") setTimeout(renderDeviceChecks);   // drawn once the popup shows
  if ((id === "devMoods" || id === "devReports") && typeof sharingDevOpened === "function") sharingDevOpened(id);   // Music sharing's mood words or reports (sharing.js)
  $("infoOverlay").hidden = false;
  document.body.style.overflow = "hidden";
  $("infoSlot").scrollTop = 0;
  $("infoDialog").focus({ preventScroll: true });
}

// Cancel (and Done) at the foot of a popup from the menu closes it, like its X
document.addEventListener("click", (event) => {
  const cancel = event.target.closest && event.target.closest(".dlg-cancel");
  if (cancel && info.node && info.node.contains(cancel)) closeInfo();
});

function motionOk() {
  return !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}
function closeInfo(quiet = false) {
  if (!info.node) return;
  if (info.node.id === "tutorialSection") emptyTutorialPlayer();
  if (info.node.tagName === "DETAILS") info.node.open = info.wasOpen;
  for (const d of info.node.querySelectorAll("details")) d.open = false;   // reopened, every section starts closed again
  info.node.hidden = info.wasHidden;
  info.marker.replaceWith(info.node);
  info.node = null;
  info.marker = null;
  $("infoOverlay").hidden = true;
  const under = document.querySelector(".app-overlay:not([hidden])");   // a popup under it (the build popup, from a Report this problem link) stays open
  if (!under) document.body.style.overflow = "";
  const opener = info.opener;
  info.opener = null;
  if (quiet) return;
  if (under && opener && under.contains(opener)) opener.focus({ preventScroll: true });
  else if (!under && $("feAppMenuButton")) $("feAppMenuButton").focus();
}

function startFlowChoice() {
  // The two answers on the setup page are wired first of all, for the whole page at once, so they work whatever else goes wrong.
  // The capture phase catches the click even from a script that stops it bubbling. They are radio buttons: a tap chooses, Next goes on (Ron, 2026-11-16).
  document.addEventListener("click", (event) => {
    const button = event.target.closest && event.target.closest("[data-flow], #spNext");
    if (!button) return;
    if (button.id !== "spNext") { chooseFlow(button.getAttribute("data-flow")); return; }
    const flow = chosenFlow();
    if (flow) slideScreens(() => { showFlow(flow); window.scrollTo(0, 0); });
  }, true);
  document.addEventListener("keydown", (event) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step || !(event.target.closest && event.target.closest("[data-flow]"))) return;
    event.preventDefault();
    const flows = [...document.querySelectorAll("[data-flow]")].map((b) => b.getAttribute("data-flow"));
    const at = flows.indexOf(chosenFlow());
    chooseFlow(flows[at < 0 ? (step > 0 ? 0 : flows.length - 1) : (at + step + flows.length) % flows.length], true);
  }, true);
}
function chosenFlow() { const b = document.querySelector('[data-flow][aria-checked="true"]'); return b ? b.getAttribute("data-flow") : null; }
// The chosen answer is checked and the only one in the tab order (the first when none is), and Next is ready
function chooseFlow(flow, focus = false) {
  const answers = [...document.querySelectorAll("[data-flow]")];
  answers.forEach((b, i) => {
    const on = b.getAttribute("data-flow") === flow;
    b.setAttribute("aria-checked", String(on));
    b.tabIndex = on || (!flow && i === 0) ? 0 : -1;
    if (on && focus) b.focus();
  });
  const next = document.getElementById("spNext");
  if (next) next.disabled = !flow;
}
let py = null;          // the Python functions, once loaded
let me = null;          // the signed-in Spotify user
// Where the connection to Spotify stands: "none" (not signed in), "connecting", "ready" (the profile and playlists were read), or
// "problem" (signed in, but Spotify could not be reached or would not answer). Only "ready" allows anything that needs Spotify.
let connection = "none";
let connectionKind = "retry";   // what can fix a problem: "retry" (waiting, the network) or "reconnect" (the sign-in)
let playlists = [];     // the user's playlists
let formatsValid = false;
let currentFormats = [];   // { id, title } for each format, used by the dropdowns and messages
let busy = false;
let needsReconnect = false;
const trackCache = new Map();  // playlist id -> songs, for the life of this page

// ---------------------------------------------------------------- saved songs
// The songs of each playlist are also kept in this browser (IndexedDB), by playlist id, so a normal run does not ask Spotify for
// them again, even after the page is reloaded. A playlist's snapshot id, when Spotify gives one, says whether it has changed.
// Everything here is best effort: if the browser will not keep songs, the app simply asks Spotify, as it did before.
const SONGS_DB = "ceremony-playlist-builder";
const SONGS_STORE = "songs";
const SONGS_VERSION = 3;   // 2: each song carries its ISRC and album; 3: a song carries the service's own id, not a Spotify URI; older saves are read again
let songsDb = null;

function openSongsDb() {
  if (songsDb) return songsDb;
  songsDb = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined" || !indexedDB) return resolve(null);
      const request = indexedDB.open(SONGS_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(SONGS_STORE, { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch (err) { resolve(null); }
  });
  return songsDb;
}

async function songsStore(mode, work) {
  // Runs work(store) in one transaction and gives back its request's result, or null when nothing can be kept or read.
  const db = await openSongsDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(SONGS_STORE, mode);
      const request = work(tx.objectStore(SONGS_STORE));
      tx.oncomplete = () => resolve(request && request.result !== undefined ? request.result : null);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch (err) { resolve(null); }
  });
}

const savedSongs = (id) => songsStore("readonly", (store) => store.get(id));
const saveSongs = (entry) => songsStore("readwrite", (store) => store.put(entry));
const forgetSongs = (ids) => songsStore("readwrite", (store) => { let last; for (const id of ids) last = store.delete(id); return last; });
const forgetAllSongs = () => songsStore("readwrite", (store) => store.clear());

async function refreshSongsFor(names) {
  // For playlists whose snapshot Spotify does not report: forget the saved songs, so the next run reads them again.
  const ids = names.map((name) => (playlists.find((p) => normName(p.name) === normName(name)) || {}).id).filter(Boolean);
  for (const id of ids) trackCache.delete(id);
  await forgetSongs(ids);
  $("editorNote").textContent = `Songs will be read again from ${service.name} the next time you build.`;
}

// ---------------------------------------------------------------- small helpers
function cleanError(err) {
  // Python errors arrive with a long traceback. Keep just the last line.
  const lines = String(err && err.message ? err.message : err).split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines.length ? lines[lines.length - 1] : "Something went wrong.";
  return last.replace(/^(\w+\.)*\w*Error:\s*/, "");
}

function showError(box, err) {
  box.textContent = cleanError(err);
}

function setLabel(button, text) {
  // Buttons have an icon followed by a label. Only the label changes, so the icon stays.
  (button.querySelector(".btn-label") || button).textContent = text;
}

function setIcon(button, name) {
  // Swaps a button's icon for another file in the icons folder.
  const img = button.querySelector("img.btn-icon");
  if (img) img.setAttribute("src", `icons/${name}.svg`);
}

// ---------------------------------------------------------------- problem reports
// A report carries only a few technical details. It never carries the sign-in, the Client ID, playlist names,
// song titles, or the formats text. Nothing is sent until the person submits the form in the new tab.
let pythonVersion = "";
let lastErrorText = "";
const stepLog = [];   // the last things that happened, in plain words, with the time since the page opened, kept in memory only
const errorLog = [];   // the last errors, with their times, so one error cannot bury another in a report (a failed build did, 2026-11-15)
const STEPS_KEPT = 30, ERRORS_KEPT = 10;
function sincePageOpened() { const s = Math.round(performance.now() / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }

function logStep(text) {
  stepLog.push(`${text} (${sincePageOpened()})`);
  if (stepLog.length > STEPS_KEPT) stepLog.shift();
}

function scrubError(text) {
  // Anything inside quotation marks could be a name the person typed, so it is replaced. The text is also shortened.
  return String(text || "")
    .replace(/(^|[\s(\[])'[^']*'(?=[\s).,:;\]]|$)/g, "$1...")
    .replace(/"[^"]*"/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

function recordError(text) {
  // A short list was recorded with its counts where it was found; the bare message from a catch further up would hide them from a report (2026-11-15)
  if (String(text).startsWith(SHORT_LIST_MESSAGE) && /^Spotify listed /.test(lastErrorText || "")) return;
  lastErrorText = scrubError(text);
  errorLog.push(`${lastErrorText} (${sincePageOpened()})`);
  if (errorLog.length > ERRORS_KEPT) errorLog.shift();
}

function describeBrowser() {
  const ua = navigator.userAgent || "";
  const system = /Windows/.test(ua) ? "Windows" : /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "an unknown system";
  let browser = "an unknown browser";
  let m;
  if ((m = ua.match(/Edg\/(\d+)/))) browser = "Edge " + m[1];
  else if ((m = ua.match(/Firefox\/(\d+)/))) browser = "Firefox " + m[1];
  else if ((m = ua.match(/Chrome\/(\d+)/))) browser = "Chrome " + m[1];
  else if ((m = ua.match(/Version\/(\d+).*Safari/))) browser = "Safari " + m[1];
  return `${browser} on ${system}`;
}

function reportDetails() {
  return {
    appVersion: APP_VERSION,
    browser: describeBrowser(),
    windowSize: `${window.innerWidth}x${window.innerHeight}`,
    python: py ? `ready (Python ${pythonVersion})` : "not loaded",
    lastError: lastErrorText || "none",
    earlierErrors: errorLog.length > 1 ? errorLog.slice(0, -1).join(" | ") : "none",
    recentSteps: stepLog.length ? stepLog.join(" > ") : "none",
  };
}

// The Spotify request log goes with every problem report, as a file attached to the email (Ron, 2026-11-15, with 10 errors and 30 steps: a report is often all there is, and the log
// would have shown the short playlist list at once). Names are taken out: playlist and recipe names and descriptions become their length; IDs, counts and
// Spotify's answers stay. The report's own details and the steps and errors go in too.
const LOG_NAME_KEYS = new Set(["name", "title", "description", "names"]);
const LOG_FIRST_IS_NAME = new Set(["saveNames", "recipes"]);   // arrays of entries whose first item is a name
function reportLogText() {
  const names = new Set();
  try {
    for (const p of playlists || []) if (p && p.name) names.add(p.name);
    if (typeof editor !== "undefined" && editor.model) for (const f of editor.model.formats) if (f.title) { names.add(f.title); names.add(saveName(f.title)); }
  } catch (err) { /* names only help */ }
  const hidden = (v) => `[name, ${[...String(v)].length} chars]`;
  const known = [...names].filter((n) => n.length >= 3).sort((a, b) => b.length - a.length);
  const inText = (t) => { let out = t; for (const n of known) if (out.includes(n)) out = out.split(n).join("[name]"); return out; };
  const walk = (v, key) => {
    if (typeof v === "string") return LOG_NAME_KEYS.has(key) || names.has(v) || / \(recipe\)$/.test(v) ? hidden(v) : inText(v);
    if (Array.isArray(v)) return v.map((x, i) => (LOG_FIRST_IS_NAME.has(key) && Array.isArray(x) ? x.map((y, j) => (j === 0 && typeof y === "string" ? hidden(y) : walk(y, ""))) : walk(x, key === "names" ? "names" : "")));
    if (v && typeof v === "object") { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = walk(x, k); return o; }
    return v;
  };
  let record = {};
  try { record = JSON.parse(limitRecordText()); } catch (err) { record = { unreadable: String(err && err.message || err) }; }
  return JSON.stringify(walk({ report: reportDetails(), steps: stepLog, errors: errorLog, connection, playlistCount: (playlists || []).length, ...record }, ""), null, 1);
}

function reportUrl() {
  // The details travel in the link, so the person never copies or pastes anything.
  const details = reportDetails();
  const build = () => REPORT_FORM_URL + "?" + Object.entries(details).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  let url = build();
  while (url.length > 1800 && details.recentSteps.length > 40) {   // keep the link a safe length
    details.recentSteps = details.recentSteps.slice(0, Math.floor(details.recentSteps.length * 0.8)) + "...";
    url = build();
  }
  return url;
}


// Unexpected problems are reported by Arc itself, with the details and the request log (Ron, 2026-11-15: a report should not wait on a click). Once per kind of
// problem (its text, numbers left out) in each version, kept in localStorage, so a problem that comes back does not flood the inbox, and a new version reports
// it again, which shows whether a fix worked. Expected problems (a rate limit, no internet, a lapsed sign-in, no Premium) are never sent. The page says it
// was sent (`reportedLine` in editor.js); a send that fails (offline, the worker's daily cap) leaves the Report this problem link instead.
const AUTO_REPORTED_KEY = "autoReported";   // {v: version, kinds: [...]}
var autoReports = new Map();   // kind -> {promise, ok}; var so the tests can clear it
function autoReportKind(text) { return scrubError(text).replace(/\d+/g, "#").slice(0, 80); }
function autoReportState(text) { return autoReports.get(autoReportKind(text)) || null; }
// A list that came short leaves a mark (`shortListSince`: when it first came short, how many reads came short, the tab); the next whole list, in this visit
// or a later one, reports that it arrived and how long it took, so a report of a short list is followed by whether waiting fixed it (Ron, 2026-11-16).
const SHORT_SINCE_KEY = "shortListSince";
function noteShortList() {
  try {
    const was = JSON.parse(localStorage.getItem(SHORT_SINCE_KEY) || "null");
    localStorage.setItem(SHORT_SINCE_KEY, JSON.stringify(was ? { ...was, reads: (was.reads || 1) + 1 } : { at: Date.now(), reads: 1, tab: TAB_ID, v: APP_VERSION }));
  } catch (err) { /* private browsing */ }
}
function reportShortListArrived(list) {
  let was = null;
  try { was = JSON.parse(localStorage.getItem(SHORT_SINCE_KEY) || "null"); localStorage.removeItem(SHORT_SINCE_KEY); } catch (err) { return; }
  if (!was || !was.at) return;
  const mins = Math.max(0, Math.round((Date.now() - was.at) / 60000));
  const text = `the whole playlist list arrived (${list.length} of ${list.total}), ${mins} min after it first came short, with ${was.reads} short read${was.reads === 1 ? "" : "s"} before; ${was.tab === TAB_ID ? "the same visit" : "a later visit"}${was.v !== APP_VERSION ? `, short on ${was.v}` : ""}`;
  logStep("short playlist list arrived whole");
  autoReport(text, "Sent by Arc after a short playlist list: ");
}

// Slots of the list Spotify could not send (service-spotify.js reads an empty page in pieces; see "Spotify's empty pages" in CLAUDE.md): the playlists Arc
// needs by ID, recipe saves this device knows and the playlists in the recipes, that the list lacks are read on their own and put back, so the person
// keeps them while Spotify cannot list them (Ron, 2026-11-16). Reading by ID cannot tell a playlist removed from the library from one in an unreadable
// slot; the next whole list settles that. At most READ_BACK_MAX.
const READ_BACK_MAX = 20;
async function readBackUnreadable(list) {
  const have = new Set(list.map((p) => p.id));
  const saves = Object.values(readSynced()).map((r) => r && r.playlistId).filter(Boolean);
  const inRecipes = typeof editor !== "undefined" && editor.model ? editor.model.formats.flatMap((f) => (f.items || []).flatMap((it) => (it.lists || []).map((l) => l.id))) : [];
  const wanted = [...new Set([...saves, ...inRecipes])].filter((id) => id && !have.has(id));
  const out = { saves: 0, recipePlaylists: 0, wanted: wanted.length, found: 0, notFound: 0, failed: 0 };
  if (typeof service.readListEntry !== "function") return out;
  for (const id of wanted.slice(0, READ_BACK_MAX)) {
    try {
      const p = await service.readListEntry(id);
      const isSave = saves.includes(id);
      if (!p || (isSave && me && p.owner !== me.id)) { out.notFound += 1; continue; }
      list.push(p);
      out.found += 1;
      if (isSave) out.saves += 1; else out.recipePlaylists += 1;
    } catch (err) { out.failed += 1; }
  }
  logStep(`unreadable slots: ${out.found} of ${out.wanted} read back by ID`);
  return out;
}
// One automatic report each time the list had empty pages read in pieces, once it is all done, so working around Spotify does not hide that it happens
function reportSplitList(list, readBack) {
  const requests = list.splits.reduce((a, x) => a + x.requests, 0);
  const secs = (ms) => `${Math.round((ms || 0) / 100) / 10} s`;
  const text = `${list.unreadable.length} slot${list.unreadable.length === 1 ? "" : "s"} of ${list.total} unreadable (at ${JSON.stringify(list.unreadable.slice(0, 20))}), ${list.splits.length} empty page${list.splits.length === 1 ? "" : "s"} read in ${requests} requests in pieces in ${secs(list.splits.reduce((a, x) => a + (x.ms || 0), 0))} (slowest request ${secs(Math.max(...list.splits.map((x) => x.slowestMs || 0)))}), the whole list in ${secs(list.ms)}`
    + (readBack ? `; read back by ID: ${readBack.found} of ${readBack.wanted} (${readBack.saves} saves, ${readBack.recipePlaylists} recipe playlists, ${readBack.notFound} not found, ${readBack.failed} failed)` : "");
  logStep("empty playlist pages read in pieces");
  // the words before the numbers are the same every time, so this is one kind of report in each version (autoReportKind reads the first 80 characters)
  autoReport(`${service.name} sent empty pages of the playlist list, and Arc read them again in smaller pieces: ` + text, "Sent by Arc: ");
}

function autoReport(text, intro = "Sent by Arc when this happened: ") {
  const kind = autoReportKind(text);
  if (autoReports.has(kind)) return autoReports.get(kind).promise;
  if (problemKind(String(text)) !== "other") return Promise.resolve(false);
  if (navigator.webdriver) return Promise.resolve(false);   // a browser driven by a script (Playwright mockups and checks in Arc's own VM) never reports
  let before = false;
  try { const r = JSON.parse(localStorage.getItem(AUTO_REPORTED_KEY) || "{}"); before = r.v === APP_VERSION && (r.kinds || []).includes(kind); } catch (err) { /* private browsing */ }
  const entry = { ok: before ? true : undefined };
  entry.promise = before ? Promise.resolve(true) : sendAutoReport(text, kind, intro).then((ok) => { entry.ok = ok; if (!ok) autoReports.delete(kind); return ok; });
  autoReports.set(kind, entry);
  return entry.promise;
}
async function sendAutoReport(text, kind, intro) {
  try {
    const body = { kind: "problem", auto: true, message: intro + scrubError(text), details: reportDetails(), log: reportLogText() };
    const response = await fetchWithAnswerLimit(SHARING_URL + "/message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) { logStep(`problem not reported (${response.status})`); return false; }
    try {
      const r = JSON.parse(localStorage.getItem(AUTO_REPORTED_KEY) || "{}");
      const kinds = r.v === APP_VERSION ? r.kinds || [] : [];
      localStorage.setItem(AUTO_REPORTED_KEY, JSON.stringify({ v: APP_VERSION, kinds: [...kinds, kind].slice(-50) }));
    } catch (err) { /* private browsing: it may be sent again next visit */ }
    logStep("problem reported");
    return true;
  } catch (err) { logStep("problem not reported"); return false; }
}

function refreshReportBox() {
  const d = reportDetails();
  $("reportPreview").textContent = [
    `Version: ${d.appVersion}`,
    `Browser: ${d.browser}`,
    `Window size: ${d.windowSize}`,
    `Python: ${d.python.replace("(Python ", "(")}`,
    `Last error: ${d.lastError}`,
    `Earlier errors: ${d.earlierErrors}`,
    `Recent steps: ${d.recentSteps}`,
    `${service.name} request log: about ${Math.max(1, Math.round(reportLogText().length / 1024))} KB, attached (counts, IDs and ${service.name}\u2019s answers, no names)`,
  ].join("\n");
}

// Report a problem and Feedback: written here, sent by the Music sharing worker as an email to Ron (POST /message). Nothing is kept there.
function openReport() {
  openInfo("reportBlock");
  const text = $("reportText");
  if (text) text.focus({ preventScroll: true });
}

function resetMessageForm(form) {
  form.reset();
  form.hidden = false;
  form.nextElementSibling.hidden = true;
  form.querySelector(".mf-error").textContent = "";
  form.querySelector(".mf-send").disabled = true;
}

async function sendMessageForm(form) {
  const text = form.querySelector(".mf-text"), email = form.querySelector(".mf-email"), send = form.querySelector(".mf-send"), error = form.querySelector(".mf-error");
  const message = text.value.trim();
  if (!message) return;
  const address = email.value.trim();
  error.textContent = "";
  if (address && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) { error.append(problemBox("That email address doesn\u2019t look right.", "", [], true)); email.focus(); return; }
  const kind = form.dataset.kind;
  const body = { kind, message, email: address };
  if (kind === "problem") { body.details = reportDetails(); try { body.log = reportLogText(); } catch (err) { body.log = "The log could not be made: " + String(err && err.message || err); } }
  send.disabled = true;
  form.classList.add("mf-sending");
  try {
    let response;
    try {
      response = await fetchWithAnswerLimit(SHARING_URL + "/message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (err) { throw new Error("It didn\u2019t go through. Check the connection and try again."); }   // no answer at all
    const answer = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(answer.error || "It didn\u2019t go through. Try again in a moment.");
    form.hidden = true;
    form.nextElementSibling.hidden = false;
    logStep(kind === "problem" ? "report sent" : "feedback sent");
  } catch (err) {
    error.append(problemBox(err.message, "", [], true));
    send.disabled = false;
  } finally {
    form.classList.remove("mf-sending");
  }
}

function initMessageForms() {
  for (const form of document.querySelectorAll(".mf-form")) {
    const text = form.querySelector(".mf-text"), send = form.querySelector(".mf-send");
    text.addEventListener("input", () => { send.disabled = !text.value.trim(); });
    form.addEventListener("submit", (event) => { event.preventDefault(); sendMessageForm(form); });
    form.nextElementSibling.querySelector(".mf-again").addEventListener("click", () => { resetMessageForm(form); text.focus(); });
  }
  const toggle = $("reportSentToggle");
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    if (open) refreshReportBox();
    $("reportSent").hidden = !open;
  });
  document.addEventListener("click", (event) => {
    const link = event.target.closest && event.target.closest(".report-open");
    if (!link) return;
    event.preventDefault();
    openReport();
  });
}

const REPORT_HINTS = ["mainReportHint", "loginReportHint", "connectionReportHint"];

function offerReport(hintId, rawError) {
  // An unexpected problem: remember it and show a "Report this problem" link next to the message.
  recordError(rawError);
  logStep("problem: " + lastErrorText.slice(0, 60));
  const hint = $(hintId);
  if (!hint.dataset.ask) hint.dataset.ask = hint.innerHTML;
  hint.innerHTML = hint.dataset.ask;
  hint.hidden = false;
  autoReport(rawError).then((ok) => { if (ok) hint.textContent = "Something unexpected happened. Arc sent the details to its developer."; });
}

function clearReportHints(...ids) {
  for (const id of (ids.length ? ids : REPORT_HINTS)) $(id).hidden = true;
}

function showFlow(flow) {
  // flow is "new", "existing", or null (nothing chosen yet: show neither, and nothing below the choices).
  const tidal = service.key === "tidal";   // each service has its own steps
  $("flowNew").hidden = tidal || flow !== "new";
  $("flowExisting").hidden = tidal || flow !== "existing";
  $("flowNewTidal").hidden = !tidal || flow !== "new";
  $("flowExistingTidal").hidden = !tidal || flow !== "existing";
  $("spWhat").hidden = tidal || flow === "existing";
  $("spWhatExisting").hidden = tidal || flow !== "existing";
  $("spWhatTidal").hidden = !tidal;
  $("connectBlock").hidden = !flow;
  $("connectStep").hidden = !flow;
  $("connect").hidden = !flow;   // at the foot beside Back, where Next is on the question
  $("spAsk").hidden = !!flow;
  $("spSteps").hidden = !flow;
  if ($("spNext")) $("spNext").hidden = !!flow;   // on the steps, Back stands alone
  if (flow) chooseFlow(flow);   // back from the steps, the answer is still chosen
  $("spStepsTitle").textContent = flow === "new" ? `Create an app inside your ${service.name} account` : "Find your Client ID";
  currentFlowName = flow;
  if (!flow) { alignWelcomeIcons(); drawSetupJoint(); }
}

let currentFlowName = null;
function currentFlow() {
  return currentFlowName;
}


// ---------------------------------------------------------------- files and times
function saveFile(name, text) {
  // Hands the browser a file to download. Kept separate so tests can replace it.
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileStamp() {
  // Local date and 24-hour time, such as 2026-10-25_14-05-09. File names sort in the order they were made,
  // and two files on the same day never share a name. (Colons are not allowed in file names on Windows,
  // so the time uses hyphens.)
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function formatBackupTime(iso) {
  // The day and the time of day, in the person's own style, such as "Oct 25, 2026 at 2:05 PM".
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} at ${time}`;
}

// ---------------------------------------------------------------- automatic backup to Spotify
// Each format is kept in a private playlist of its own, named like the format and ending in (format backup). The format is packed into the description (see
// packFormat). A save is found again by what its description decodes to, so it does not matter what the playlist is called, and nothing is kept in this browser
// except which formats were deleted and still have a save to remove. This stage only writes: it creates a save for each format, brings it up to date after an
// edit, renames it with the format, and removes it when the format is deleted. A save that is newer than the format here (made on another device) is left alone.
const SAVE_SUFFIX = " (recipe)";
// Edits are saved once they have stopped for a few seconds, and at the latest this long after the first of them, so a long run of edits still gets saved from time to
// time. Spotify counts the calls an app makes in a rolling 30 seconds, so saves are not made more often than that needs, and not while a build is under way.
let spotifySaveDelayMs = 5000;
let spotifySaveMaxWaitMs = 30000;
const saveState = { running: false, again: false, timer: null, since: 0, error: "", tooLong: [], newer: [], savedAt: null, coverBlocked: false, added: [], updated: [], coverProblem: null, coverQueue: [], coverRunning: false, coverGapMs: 400, failures: 0, failureAsked: false, unread: 0, skip: new Set(), dismissed: new Set(), lastNews: null };
let playlistsLoadedAt = 0;
let playlistsTotal = null;   // how many playlists Spotify said the list holds the last time it was read (its first page's total), for the records below
let playlistLoads = 0;
// This tab, for the records: which tab wrote what, since tabs of one browser share the records (saves made twice with no list read between, 2026-11-13)
const TAB_ID = Math.random().toString(36).slice(2, 7);
const TAB_STARTED = new Date().toISOString();
// The page's state around an update, for the records: copies of the saves were made right after updates (2026-11-12)
function pageState() {
  let updating = null, refreshed = null;
  try { updating = sessionStorage.getItem("updating"); refreshed = sessionStorage.getItem("startupRefreshed"); } catch (e) { /* no storage */ }
  return { app: APP_VERSION, scripts: { ...(globalThis.scriptVersions || {}) }, updating, startupRefreshed: refreshed, updateScreen: typeof updateScreen !== "undefined" ? updateScreen : null, connection, sinceStart: Math.round(performance.now()) };
}
let playlistPages = [];   // the last list's pages as Spotify sent them: [offset, items, total, whether there was a next], for the records below   // how many times the list has started being read in this tab, so a record can tell whether it was read again during a save
let playlistsUnreadable = [];
let playlistsReadMs = null;
let playlistsAround = [];   // each run of unreadable slots with the IDs of the playlists before and after it (for the records)   // how long the last reading of the list took   // where the last list had slots Spotify sent empty even one at a time (offsets), for the records
let playlistsLeftOut = 0;   // how many the last list's pages left out the same way twice (taken as Spotify's answer), for the records
let playlistsHidden = [];   // where the last list had null items (playlists Spotify will not show this app), for the records
let playlistsLoadedBy = "";   // which code last read the playlist list, for the record kept when a save question is asked (recordSyncAsk)
var SAVE_FRESH_MS = 5000;   // a save reads the account's playlists again unless they were read this recently
let playlistRefreshMs = 5 * 60 * 1000;   // coming back to the page after this long, the account's playlists, and so the backups, are read again

function saveName(title) {
  return (cleanTitle(title).trim() || "Untitled").slice(0, 80) + SAVE_SUFFIX;
}

// Recipes always save to Spotify (backup by hand was removed by Ron, 2026-11-14). Only the tests turn it off, for checks that are not about saving (boot in tests/run.js).
function savingToSpotify() { return !window.arcTestNoSaves; }

function pendingSaveDeletes() {
  try { const list = JSON.parse(localStorage.getItem("spotifyPendingDeletes") || "[]"); return Array.isArray(list) ? list : []; } catch (err) { return []; }
}

function noteFormatDeleted(id) {
  if (!savingToSpotify()) return;
  const list = pendingSaveDeletes();
  if (!list.includes(id)) list.push(id);
  try { localStorage.setItem("spotifyPendingDeletes", JSON.stringify(list)); } catch (err) { /* private browsing */ }
}

function scheduleSpotifySave(delay) {
  if (!savingToSpotify()) return;
  clearTimeout(saveState.timer);
  const now = Date.now();
  if (!saveState.since) saveState.since = now;
  const wanted = delay === undefined ? spotifySaveDelayMs : delay;
  saveState.timer = setTimeout(runSpotifySave, Math.max(0, Math.min(wanted, saveState.since + spotifySaveMaxWaitMs - now)));
  renderSaveStatus();
}

// What this device last knew of each backup: the revision it held, and the playlist. A format with a backup that is gone is one that was backed up here before.
function readSynced() {
  try { const o = JSON.parse(localStorage.getItem("spotifySynced") || "{}"); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch (err) { return {}; }
}
function writeSynced(synced) {
  try { localStorage.setItem("spotifySynced", JSON.stringify(synced)); } catch (err) { /* private browsing */ }
}

function whenText(seconds) {
  return seconds ? formatBackupTime(new Date(seconds * 1000).toISOString()) : "a time that is not known";
}

// The recipe open in the editor with changes not saved yet (Done in the recipe panel saves; Ron, 2026-11-12 and 2026-11-13). Its edits are in this
// browser already, but nothing of it goes to Spotify, and Spotify's copy is not settled against it, until it is saved. Kept in localStorage so a closed tab
// does not save it either: it shows as Unsaved changes in the list. editor.js keeps it (recipeEditing).
function heldRecipeId() {
  try { const o = JSON.parse(localStorage.getItem("recipeEditing") || "null"); return o && o.dirty && typeof o.id === "string" ? o.id : null; } catch (err) { return null; }
}

// Reads the account's backups and settles each format against its backup. Where one side changed and the other did not, the changed one wins. Where both changed, or
// there is no record of a backup and the two differ, the person is asked. Formats found only in Spotify are added; a format whose backup has gone is asked about.
async function mergeFromSpotify() {
  saveState.skip = new Set();
  saveState.added = [];
  saveState.updated = [];
  const model = editor.model;
  const allIds = playlists.map((p) => p.id);
  const synced = readSynced();
  const pendingDeletes = pendingSaveDeletes();
  const remote = savesInAccount();
  const unread = playlists.filter((p) => p.save && p.save.kind !== "save");
  saveState.unread = unread.length;
  const readRemote = (p) => { const u = unpackFormat(p.description); if (u.kind !== "save") return null; resolveSaveTails(u.format, allIds); return u.format; };
  const asks = [];
  let changedHere = false;
  const held = heldRecipeId();
  if (held) saveState.skip.add(held);
  for (const [id, p] of remote) {
    if (id === held) continue;   // being edited: settled once it is saved or its changes are cancelled
    const r = readRemote(p);
    if (!r) continue;
    const local = model.formats.find((f) => f.id === id);
    if (!local) {
      if (pendingDeletes.includes(id)) continue;   // deleted here: its backup is about to be removed
      adoptFormat(r);
      synced[id] = { rev: r.rev || 0, playlistId: p.id };
      saveState.added.push(r.title);
      changedHere = true;
      continue;
    }
    // the place is settled on its own, before the content: the later move stands, on both copies, so it is kept whichever content wins
    const placed = laterPlace(local, r);
    if (local.place !== placed.place || (local.placeAt || 0) !== (placed.placeAt || 0)) { local.place = placed.place; local.placeAt = placed.placeAt; changedHere = true; }
    r.place = local.place; r.placeAt = local.placeAt;
    const lr = local.rev || 0, rr = r.rev || 0;
    if (contentSignature(local) === contentSignature(r)) {   // the same: only the counters may differ
      if (rr > lr) { local.rev = rr; local.modified = r.modified; changedHere = true; }
      synced[id] = { rev: Math.max(lr, rr), playlistId: p.id };
      continue;
    }
    const base = synced[id];
    if (base) {
      const localChanged = lr > (base.rev || 0), remoteChanged = rr > (base.rev || 0);
      if (remoteChanged && !localChanged) { adoptFormat(r); synced[id] = { rev: rr, playlistId: p.id }; saveState.updated.push(r.title); changedHere = true; continue; }
      if (!(localChanged && remoteChanged)) continue;   // only this device changed (it will be written), or neither did
    }
    asks.push({ kind: "conflict", id, title: local.title, local, remote: r, playlist: p });
  }
  for (const f of model.formats) {
    if (remote.has(f.id) || !synced[f.id] || f.id === held) continue;
    if (unread.some((p) => p.name === saveName(f.title))) continue;   // its backup is there, but cannot be read: it is written again below
    asks.push({ kind: "removed", id: f.id, title: f.title });
  }
  const debug = asks.length ? await recordSyncAsk(asks, synced, remote, pendingDeletes, held) : "";
  for (const a of asks) {
    const label = a.title.trim() || "Untitled";
    let choice;
    if (a.kind === "conflict") {
      choice = await askSyncChoice(`${named(label)} was changed in two places`, `This device has a version from ${whenText(a.local.modified)}, and ${service.name} has one from ${whenText(a.remote.modified)}, probably saved from another device. Which one do you want to keep? The other one is replaced.`,
        [{ label: "Keep this device\u2019s", value: "mine" }, { label: `Use ${service.name}\u2019s`, value: "theirs" }], { required: true, debug });
    } else {
      choice = await askSyncChoice(`${named(label)} is no longer in ${service.name}`, `It was removed from your ${service.name}, maybe on another device. Keep it here, and it will be saved to ${service.name} again, or remove it from this device too?`,
        [{ label: "Keep it here", value: "keep" }, { label: "Remove it here", value: "remove", danger: true }], { required: true, debug });
    }
    if (a.kind === "conflict" && choice === "theirs") { adoptFormat(a.remote); synced[a.id] = { rev: a.remote.rev || 0, playlistId: a.playlist.id }; saveState.updated.push(a.remote.title); }
    else if (a.kind === "conflict") { a.local.rev = Math.max(a.local.rev || 0, a.remote.rev || 0) + 1; a.local.modified = Math.floor(Date.now() / 1000); synced[a.id] = { rev: a.remote.rev || 0, playlistId: a.playlist.id }; }
    else if (choice === "remove") removeLocalFormat(a.id);
    if (a.kind === "removed") delete synced[a.id];
    changedHere = true;
  }
  writeSynced(synced);
  if (changedHere) { writeAdopted(); renderEditor(); }
  const news = [];
  if (saveState.added.length) news.push(newsText("Added", saveState.added));
  if (saveState.updated.length) news.push(newsText("Updated", saveState.updated));
  if (news.length) {
    saveState.lastNews = { text: news.join(" "), at: Date.now() };
    if (typeof showNotices === "function") showNotices(news);
  }
}

// When the merge has to ask about a recipe (no longer in Spotify, or changed in two places), what it saw is kept, the last 10 times, in the Spotify request log
// (limitRecordText) and behind Copy details on the question in developer mode, so a question that should not have come up can be explained afterwards.
const SYNC_ASKS_KEY = "syncAsks";
async function recordSyncAsk(asks, synced, remote, pendingDeletes, held) {
  const short = (p) => p ? { name: p.name, id: p.id, at: playlists.indexOf(p), kind: p.save ? p.save.kind : "none", recipeId: p.save && p.save.format ? p.save.format.id : null, rev: p.save && p.save.format ? p.save.format.rev || 0 : null, description: String(p.description || "").slice(0, 60) } : null;
  const entry = {
    at: new Date().toISOString(), app: APP_VERSION, tab: TAB_ID, tabStarted: TAB_STARTED, page: pageState(),
    asks: asks.map((a) => {
      const local = editor.model.formats.find((f) => f.id === a.id);
      const was = synced[a.id] || null;
      return { kind: a.kind, id: a.id, title: a.title, rev: local ? local.rev || 0 : null, remoteRev: a.remote ? a.remote.rev || 0 : null, synced: was,
        savedPlaylistInList: was && was.playlistId ? short(playlists.find((p) => p.id === was.playlistId)) : null,
        sameName: playlists.filter((p) => p.name === saveName(a.title)).map(short) };
    }),
    listReadAt: playlistsLoadedAt ? new Date(playlistsLoadedAt).toISOString() : null,
    listReadBy: playlistsLoadedBy,
    playlistCount: playlists.length, listTotal: playlistsTotal, pages: playlistPages,
    saves: [...remote].map(([id, p]) => [p.name, p.id, id, p.save.format.rev || 0]),
    otherSaveNames: playlists.filter((p) => p.name.endsWith(SAVE_SUFFIX) && !(p.save && p.save.kind === "save")).map(short),
    recipes: editor.model.formats.map((f) => [f.title, f.id, f.rev || 0]),
    synced, held: held || null, pendingDeletes,
  };
  // a save asked about as gone is read straight from Spotify too (nothing changes): still there means the list left it out
  for (const a of entry.asks) if (a.kind === "removed" && a.synced && a.synced.playlistId) a.direct = await readSaveDirectly(a.synced.playlistId);
  writeRecord(SYNC_ASKS_KEY, [...readRecord(SYNC_ASKS_KEY, []), entry].slice(-10));
  return JSON.stringify(entry);
}

// The functions that called this one, from the call stack, as "a < b < c" (no addresses or versions), for the record above.
function callerTrail() {
  // Chrome writes "at name (address)" under a line "Error", Safari and Firefox "name@address"; frames of the browser's own code and this function are left out
  const lines = String(new Error().stack || "").split("\n").map((x) => x.trim()).filter((x) => x && x !== "Error" && !/\[native code\]|^callerTrail\b|^at callerTrail\b/.test(x));
  return lines.slice(1, 5).map((x) => x.replace(/^at /, "").replace(/\s*\(?(https?|file):\/\/\S*/, "").replace(/@.*$/, "") || "?").join(" < ");
}

// Each time a save makes a new playlist for a recipe, what it saw is kept, the last 20 times, in the Spotify request log (limitRecordText): Ron found 7 saves
// of each recipe (2026-11-12), and this is to find out why the existing save was not used. Reporting only: nothing here changes what the save does.
// It also reads, without changing anything, the playlist this device last saved the recipe to, straight from Spotify, and whether it is in the library,
// to tell a list that left it out from a save that is really gone or no longer reads as one.
const SAVE_CREATES_KEY = "saveCreates";
async function recordSaveCreate(fmt, synced, saveRun) {
  const short = (p) => p ? { name: p.name, id: p.id, at: playlists.indexOf(p), owner: p.owner, kind: p.save ? p.save.kind : "none", recipeId: p.save && p.save.format ? p.save.format.id : null, rev: p.save && p.save.format ? p.save.format.rev || 0 : null, descLength: p.description == null ? null : String(p.description).length, description: p.description == null ? null : String(p.description).slice(0, 60) } : null;
  const was = synced[fmt.id] || null;
  const entry = {
    at: new Date().toISOString(), app: APP_VERSION, tab: TAB_ID, tabStarted: TAB_STARTED, page: pageState(), caller: callerTrail(),
    recipe: { id: fmt.id, title: fmt.title, rev: fmt.rev || 0, modified: fmt.modified || 0 }, synced: was,
    savedPlaylistInList: was && was.playlistId ? short(playlists.find((p) => p.id === was.playlistId)) : null,
    sameName: playlists.filter((p) => p.name === saveName(fmt.title)).map(short),
    savesOfThisRecipe: playlists.filter((p) => p.save && p.save.format && p.save.format.id === fmt.id).map(short),
    saves: [...savesInAccount()].map(([id, p]) => [p.name, p.id, id, p.save.format.rev || 0]),
    recipes: editor.model.formats.map((f) => [f.title, f.id, f.rev || 0]),
    listReadAt: playlistsLoadedAt ? new Date(playlistsLoadedAt).toISOString() : null, listReadBy: playlistsLoadedBy,
    playlistCount: playlists.length, listTotal: playlistsTotal, pages: playlistPages,
    saveStarted: new Date(saveRun.at).toISOString(), listReadAgainDuringSave: playlistLoads !== saveRun.loads, listReadBeforeSave: saveRun.listReadAt ? new Date(saveRun.listReadAt).toISOString() : null,
    held: heldRecipeId(), pendingDeletes: pendingSaveDeletes(), account: (() => { try { return localStorage.getItem("spotifyAccount") === accountKey(); } catch (e) { return null; } })(),
    direct: null,
  };
  if (was && was.playlistId) entry.direct = await readSaveDirectly(was.playlistId);
  writeRecord(SAVE_CREATES_KEY, [...readRecord(SAVE_CREATES_KEY, []), entry].slice(-20));
}

// Two or more saves of one recipe in the list: the moment the problem shows (Ron found 7 of each, 2026-11-12). Kept once per set of playlists, the last 10, in
// the Spotify request log, with where each sits in the list and the list's pages. Reporting only: nothing is removed.
const SAVE_DUPLICATES_KEY = "saveDuplicates";
function recordSaveDuplicates() {
  const byRecipe = new Map();
  playlists.forEach((p, at) => {
    if (!p.save || p.save.kind !== "save") return;
    const id = p.save.format.id;
    byRecipe.set(id, [...(byRecipe.get(id) || []), { id: p.id, name: p.name, at, rev: p.save.format.rev || 0, modified: p.save.format.modified || 0 }]);
  });
  const kept = readRecord(SAVE_DUPLICATES_KEY, []);
  let added = false;
  for (const [recipeId, list] of byRecipe) {
    if (list.length < 2) continue;
    const key = recipeId + ":" + list.map((x) => x.id).sort().join(",");
    if (kept.some((e) => e.key === key)) continue;
    kept.push({ key, at: new Date().toISOString(), app: APP_VERSION, tab: TAB_ID, recipeId, saves: list, playlistCount: playlists.length, listTotal: playlistsTotal, pages: playlistPages, listReadBy: playlistsLoadedBy });
    added = true;
  }
  if (added) writeRecord(SAVE_DUPLICATES_KEY, kept.slice(-10));
}

// Every read of the playlist list, the last 30: when, by which tab and code, how many playlists against Spotify's total, and the saves it showed. A read that
// showed none of the recipes' saves is how a burst of new saves would start. Reporting only.
const LIST_READS_KEY = "listReads";
function recordListRead(by) {
  const saves = playlists.filter((p) => p.save).map((p) => [p.save.kind === "save" ? p.save.format.id : p.save.kind, p.save.format ? p.save.format.rev || 0 : null, playlists.indexOf(p)]);
  const named = playlists.filter((p) => p.name.endsWith(SAVE_SUFFIX)).map((p) => [p.name, p.id, p.save ? p.save.kind : "none", p.description == null ? null : String(p.description).length]);
  const entry = { at: new Date().toISOString(), tab: TAB_ID, tabStarted: TAB_STARTED, page: pageState(), by, count: playlists.length, total: playlistsTotal, hidden: playlistsHidden.length, leftOut: playlistsLeftOut, unreadable: playlistsUnreadable.length, unreadableAround: playlistsAround, ms: playlistsReadMs, pages: playlistPages, saves, saveNames: named,
    recipes: typeof editor !== "undefined" && editor.model ? editor.model.formats.length : null, visible: document.visibilityState };
  writeRecord(LIST_READS_KEY, [...readRecord(LIST_READS_KEY, []), entry].slice(-30));
}

// For the records above only: a playlist as Spotify has it when read on its own, and whether it is in the person's library. Changes nothing.
async function readSaveDirectly(id) {
  const d = { id };
  try {
    const got = await service.readPlaylist(id);
    const u = unpackFormat(got.description);
    Object.assign(d, { name: got.name, owner: got.owner, kind: u.kind, recipeId: u.format ? u.format.id : null, rev: u.format ? u.format.rev || 0 : null, descLength: got.description == null ? null : String(got.description).length });
  } catch (err) { d.readError = String(err && err.message || err); }
  try { d.inLibrary = await service.inLibrary(id); }
  catch (err) { d.libraryError = String(err && err.message || err); }
  return d;
}

function savesInAccount() {
  const byFormat = new Map();
  for (const p of playlists) {
    if (!p.save || p.save.kind !== "save") continue;
    const had = byFormat.get(p.save.format.id);
    if (!had || p.save.format.rev > had.save.format.rev) byFormat.set(p.save.format.id, p);   // if there are two for one format, the newer one
  }
  return byFormat;
}

async function runSpotifySave() {
  if (!savingToSpotify()) return;
  clearTimeout(saveState.timer);
  saveState.timer = null;
  if (saveState.running) { saveState.again = true; return; }
  if (busy) { saveState.timer = setTimeout(runSpotifySave, 3000); return; }   // a plan or a build is under way: wait for it to finish
  saveState.since = 0;
  if (connection !== "ready" || !me || typeof editor === "undefined" || !editor.model || service.wait()) { renderSaveStatus(); return; }   // after a wait, it is saved then
  saveState.running = true;
  saveState.error = "";
  renderSaveStatus();
  try {
    // what is in Spotify now: with Arc open on two devices, a list read before the other one saved would make this save write over it without asking (found by
    // Device checks, 2026-11-14). Not when the list was just read, nor while the page is being left (the write must go before the page stops).
    if (document.visibilityState !== "hidden" && (!playlistsLoadedAt || Date.now() - playlistsLoadedAt > SAVE_FRESH_MS)) await loadMyPlaylists();
    const saveRun = { at: Date.now(), loads: playlistLoads, listReadAt: playlistsLoadedAt };
    await mergeFromSpotify();
    const synced = readSynced();
    const tooLong = [], newer = [];
    const allIds = playlists.map((p) => p.id);
    // A backup playlist that has no cover yet is put in a queue for one. The covers are sent after the save is done and never make it wait (see uploadCovers).
    // A save written before the cover said SAVED RECIPE (its description began with the old note) is given the new cover once.
    const putCover = (entry) => { if (service.can.covers && ((!entry.image || coverDue().includes(entry.id)) && !saveState.coverQueue.includes(entry))) saveState.coverQueue.push(entry); };   // a service with no covers (TIDAL) queues none
    const oldCover = (entry) => { if (String(entry.description || "").startsWith(OLD_SAVE_PREFIX)) markCoverDue(entry.id, true); };
    // when the cover changes (RECIPE_COVER_LOOK), every save that has a cover is given the new one once (sliders and RECIPE, Ron, 2026-11-13)
    const newLook = (() => { try { return localStorage.getItem("recipeCoverLook") !== RECIPE_COVER_LOOK; } catch (err) { return false; } })();
    if (newLook) for (const p of savesInAccount().values()) if (p.image) markCoverDue(p.id, true);
    try { localStorage.setItem("recipeCoverLook", RECIPE_COVER_LOOK); } catch (err) { /* private browsing */ }
    // formats deleted here: their saves go too, unless a format with that ID is here again
    let pending = pendingSaveDeletes();
    for (const id of pending.slice()) {
      if (!editor.model.formats.some((f) => f.id === id)) {
        const save = savesInAccount().get(id);
        if (save) {
          await service.deletePlaylist(save.id);
          playlists = playlists.filter((p) => p.id !== save.id);
        }
        const known = readSynced();
        if (known[id]) { delete known[id]; writeSynced(known); }
      }
      pending = pending.filter((x) => x !== id);
      try { localStorage.setItem("spotifyPendingDeletes", JSON.stringify(pending)); } catch (err) { /* private browsing */ }
    }
    for (const fmt of editor.model.formats) {
      if (fmt.draft) continue;   // a new recipe still being named is saved once it is created
      const description = packFormat(fmt, allIds);
      if (description.length > SAVE_LIMIT) { tooLong.push({ id: fmt.id, title: fmt.title }); continue; }
      if (saveState.skip.has(fmt.id)) continue;   // waiting for an answer to a question about it
      const name = saveName(fmt.title);
      const have = savesInAccount().get(fmt.id);
      // a backup of this name that cannot be read (damaged, or saved by a newer version) is written over only if it was this format's: it is the same name, and the format
      // was backed up from here before
      const unreadOfIt = !have && synced[fmt.id] ? playlists.find((p) => p.save && p.save.kind === "damaged" && p.name === name) : null;
      if (have) {
        if (have.save.format.rev > (fmt.rev || 0)) { newer.push(fmt.title); continue; }
        if (have.description === description && have.name === name) { synced[fmt.id] = { rev: fmt.rev || 0, playlistId: have.id }; putCover(have); continue; }   // already as it should be
        await service.updatePlaylist(have.id, { name, description });
        oldCover(have);
        have.name = name;
        have.description = description;
        have.save = unpackFormat(description);
        synced[fmt.id] = { rev: fmt.rev || 0, playlistId: have.id };
        putCover(have);
      } else if (unreadOfIt) {
        await service.updatePlaylist(unreadOfIt.id, { name, description });
        markCoverDue(unreadOfIt.id, true);
        unreadOfIt.description = description;
        unreadOfIt.save = unpackFormat(description);
        synced[fmt.id] = { rev: fmt.rev || 0, playlistId: unreadOfIt.id };
        putCover(unreadOfIt);
      } else {
        await recordSaveCreate(fmt, synced, saveRun);
        const made = await service.createPlaylist({ name, description });
        if (!made.private) logStep("save: could not make a recipe playlist private");
        const entry = { id: made.id, name, owner: me.id, collaborative: false, image: null, count: 0, description, snapshot: null, madeByApp: false };
        entry.save = unpackFormat(description);
        entry.isSave = true;
        playlists.push(entry);
        synced[fmt.id] = { rev: fmt.rev || 0, playlistId: made.id };
        putCover(entry);
      }
    }
    writeSynced(synced);
    saveState.tooLong = tooLong;
    saveState.newer = newer;
    saveState.savedAt = new Date().toISOString();
    saveState.failures = 0;
    saveState.failureAsked = false;
    try { localStorage.setItem("spotifySavedAt", saveState.savedAt); } catch (err) { /* private browsing */ }
  } catch (err) {
    saveState.error = String(err && err.message || err);
    saveState.failures += 1;
    logStep("save: " + saveState.error);
  }
  saveState.running = false;
  renderSaveStatus();
  // The first time a save fails for a known reason (no connection, a rate limit) the line under the bar says so, and it is tried again. A second failure in a row, or one
  // nobody expected, is asked about once: the formats are safe in this browser, but not for ever, so a copy on this device is offered, and a report.
  if (saveState.error && !saveState.failureAsked && (saveState.failures >= 2 || problemKind(saveState.error) === "other")) {
    saveState.failureAsked = true;
    askSaveFailure(saveState.error);
  }
  if (!saveState.error) uploadCovers();   // not waited for: the save is already done
  if (saveState.again) { saveState.again = false; scheduleSpotifySave(300); }
}

// What the saving is up to, in words, with the actions that belong to it.
function spotifySaveParts(full = true) {
  const parts = [];   // each: { text } or { text, action, label }
  if (saveState.running) { parts.push({ text: `Saving to ${service.name}\u2026` }); return parts; }
  if (service.wait()) parts.push({ text: `Waiting to save to ${service.name} until it is back.` });
  else if (connection !== "ready") { parts.push({ text: connection === "problem" ? `Waiting to save to ${service.name}: see the connection problem in the app menu.` : `Waiting to save to ${service.name}: connect first.` }); }
  else if (saveState.error) parts.push({ text: `Couldn\u2019t save to ${service.name}.`, action: () => { saveState.error = ""; runSpotifySave(); }, label: "Try again" });
  else if (saveState.timer) parts.push({ text: `Saving to ${service.name}\u2026` });
  else {
    const at = saveState.savedAt || (() => { try { return localStorage.getItem("spotifySavedAt"); } catch (err) { return null; } })();
    if (at) parts.push({ text: "Last saved at " + new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + "." });
  }
  if (!full) return parts;   // the line in the page: how the saving is going, and nothing more
  // the menu keeps a record of the last news, which the line under the bar only shows for a few seconds
  if (saveState.lastNews) parts.push({ text: `${saveState.lastNews.text} (${new Date(saveState.lastNews.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})` });
  if (saveState.coverProblem) parts.push({ text: saveState.coverProblem.text });
  if (saveState.unread) parts.push({ text: `${saveState.unread === 1 ? `A recipe saved in ${service.name}` : saveState.unread + ` recipes saved in ${service.name}`} could not be read, or ${saveState.unread === 1 ? "was" : "were"} saved by a newer version of this app, and ${saveState.unread === 1 ? "was" : "were"} left alone.` });
  for (const t of saveState.tooLong) {
    parts.push({ text: `${named(t.title.trim() || "Untitled")} is too long to save to ${service.name}. It is still saved in this browser.` });
  }
  return parts;
}

// Writes the parts into a place on the page, with their actions as pink links.
// Trouble that needs the person: it stays in the line under the editor's bar until it is fixed, or dismissed where that is all there is to do.
function attentionItems() {
  const items = [];
  const name = (t) => named(String(t).trim() || "Untitled");
  if (connection === "ready" && saveState.error && !saveState.running) items.push({ key: "error", text: `Couldn\u2019t save to ${service.name}.`, actions: [{ label: "Try again", run: () => { saveState.error = ""; runSpotifySave(); } }] });
  const n = saveState.unread;
  if (n && !saveState.dismissed.has("unread:" + n)) items.push({ key: "unread:" + n, ok: true, text: `${n === 1 ? `A recipe saved in ${service.name}` : n + ` recipes saved in ${service.name}`} could not be read, or ${n === 1 ? "was" : "were"} saved by a newer version of this app, and ${n === 1 ? "was" : "were"} left alone.` });
  if (saveState.coverProblem && !saveState.dismissed.has("cover:" + saveState.coverProblem.key)) items.push({ key: "cover:" + saveState.coverProblem.key, ok: true, text: saveState.coverProblem.text });
  for (const t of saveState.tooLong) if (!saveState.dismissed.has("long:" + t.id)) items.push({ key: "long:" + t.id, ok: true, text: `${name(t.title)} is too long to save to ${service.name}. It is still saved in this browser.` });
  return items;
}

// What went wrong, in words a person can read: the plain messages are kept, and the technical one ("Spotify returned 500 for PUT /playlists/…") becomes a sentence.
function saveFailureDetail(message) {
  const code = /Spotify returned (\d{3})/.exec(message);
  if (code) return `${service.name} returned an error (${code[1]}) while saving.`;
  return String(message).replace(/\s*\/playlists\/[A-Za-z0-9]+/g, "").trim();
}

const RECIPE_COVER_LOOK = "sliders";   // change it with recipe-cover.jpg, so saves made before get the new cover

// Saves that still have the old cover (a cloud with a check and no words) and are to get the new one: their IDs, kept until it is sent, so a cover held up by
// Spotify's limit is sent on a later visit too.
function coverDue() {
  try { const list = JSON.parse(localStorage.getItem("recipeCoverDue") || "[]"); return Array.isArray(list) ? list : []; } catch (err) { return []; }
}
function markCoverDue(id, due) {
  const list = coverDue().filter((x) => x !== id);
  if (due) list.push(id);
  try { if (list.length) localStorage.setItem("recipeCoverDue", JSON.stringify(list)); else localStorage.removeItem("recipeCoverDue"); } catch (err) { /* private browsing */ }
}

// The cover of a backup playlist is three sliders above the word RECIPE, white with a pink glow on black (recipe-cover.jpg; was a cloud with a check above SAVED RECIPE until 2026-11-13). It is sent once, to a playlist that has none, after the save is done, and it never makes a save wait:
// Spotify limits image uploads on their own, so one that is turned away for asking too often stops the rest, quietly, and they go with a later save. Anything else that goes
// wrong with a cover is said in the line under the editor's bar.
async function uploadCovers() {
  if (saveState.coverRunning) return;
  if (!service.can.covers) saveState.coverQueue = [];   // TIDAL has no covers: nothing to send and nothing to say
  if (!saveState.coverQueue.length) {
    if (saveState.coverProblem) { saveState.coverProblem = null; renderSaveStatus(); }
    return;
  }
  saveState.coverRunning = true;
  let problem = null, stopped = false;
  try {
    if (saveState.coverBlocked || !service.coversAllowed()) {
      problem = { key: "permission", text: `Your ${service.name} sign-in does not include permission to add cover art, so the recipe playlists have no cover. Sign in again with Change ${service.name} login, in the ⋯ menu on Arc's home, to allow it.` };
    } else {
      let cover = null;
      try { cover = await loadCover("recipe-cover.jpg"); }
      catch (err) { logStep("save: cover image not loaded"); problem = { key: "file", text: "The cover image for the recipe playlists (recipe-cover.jpg) could not be loaded from this site, so they have no cover." }; }
      while (cover && saveState.coverQueue.length && connection === "ready") {
        const entry = saveState.coverQueue[0];
        if (entry.image && !coverDue().includes(entry.id)) { saveState.coverQueue.shift(); continue; }
        try {
          await service.setCover(entry.id, cover, { noWait: true });
          entry.image = "set";
          markCoverDue(entry.id, false);
          saveState.coverQueue.shift();
        } catch (err) {
          if (problemKind(String(err && err.message || err)) === "rate-limit") { stopped = true; logStep("save: covers wait, Spotify is limiting uploads"); break; }
          logStep("save: cover not accepted");
          if (problemKind(err.message) === "sign-in") saveState.coverBlocked = true;
          problem = { key: "refused", text: `${service.name} did not accept the cover for the recipe playlists: ${String(err.message || err).replace(/\.$/, "")}. They have no cover.` };
          saveState.coverQueue.shift();   // the next save queues it again
        }
        if (saveState.coverGapMs) await new Promise((r) => setTimeout(r, saveState.coverGapMs));
      }
    }
  } finally {
    saveState.coverRunning = false;
  }
  if (!stopped) saveState.coverProblem = problem;
  renderSaveStatus();
}

async function askSaveFailure(message) {
  const unexpected = problemKind(message) === "other";
  if (unexpected) recordError(message);
  const choices = [{ label: "Try again", value: "retry", main: true, icon: "retry" }, { label: "Close", value: "close" }];
  const choice = await askSyncChoice(`Your recipes couldn\u2019t be saved to ${service.name}`,
    `Your latest changes haven\u2019t been saved to ${service.name} yet. They are kept in this browser until they are.`, choices, { problem: "cloud", what: saveFailureDetail(message), reported: unexpected ? reportedLine(message) : null });
  if (choice === "retry") { saveState.error = ""; runSpotifySave(); }
  else if (choice === "report") openReport();
}

function dismissAttention(key) {
  saveState.dismissed.add(key);
  renderSaveStatus();
}

// News from reading Spotify: one sentence for each kind, so a few formats added together are one message and not several.
function newsText(verb, titles) {
  const names = titles.map((t) => named(String(t).trim() || "Untitled"));
  if (names.length === 1) return `${verb} ${names[0]} from ${service.name}.`;
  if (names.length === 2) return `${verb} ${names[0]} and ${names[1]} from ${service.name}.`;
  return `${verb} ${names.length} recipes from ${service.name}.`;
}

function writeSaveParts(into, full = true) {
  into.textContent = "";
  for (const part of spotifySaveParts(full)) {
    putNamed(into, (into.childNodes.length ? " " : "") + part.text + (part.action ? " " : ""));
    if (part.action) {
      const link = document.createElement("button");
      link.type = "button"; link.className = "linklike"; link.textContent = part.label;
      link.addEventListener("click", part.action);
      into.appendChild(link);
    }
  }
}

function renderSaveStatus() {
  const slot = $("spotifySaveStatus");
  if (slot) writeSaveParts(slot, false);
  if (typeof renderAppMenu === "function") renderAppMenu();
  if (typeof refreshNoticeLine === "function") refreshNoticeLine();   // trouble that needs the person is in the line under the editor's bar
  if (typeof recipeSaveProgress === "function") recipeSaveProgress(saveState.running, !!saveState.error);   // Saving\u2026 and Saved on the row of a recipe just saved
}

function invalidatePlan() {
  updateButtons();
}

function setFormatsText(text) {
  $("formats").value = text;
  localStorage.setItem("formats", text);
  invalidatePlan();
  refreshFormatKeys();
  syncEditorFromText();
}

let reloadPage = () => location.reload();   // a separate function so tests can replace it

// Sign out and clear data (Everything else on home) erases everything and copies nothing: it is for leaving a computer that is not yours. Start over (developer options)
// does the same but puts the Client ID on the clipboard first (while the click still counts), so setting up again is a paste.
function startOver() { return clearSavedData({ copyClientId: true }); }

async function clearSavedData(options) {
  if (buildWriting()) return;
  const savedId = options && options.copyClientId === true ? localStorage.getItem("clientId") : null;
  if (savedId) { try { await Promise.race([navigator.clipboard.writeText(savedId), new Promise((r) => setTimeout(r, 1000))]); } catch (err) { /* no clipboard access: the reset goes on */ } }
  // Everything this page saves lives in this browser's storage for this address, so clearing it forgets it all.
  localStorage.clear();
  sessionStorage.clear();
  await Promise.race([forgetAllSongs(), new Promise((r) => setTimeout(r, 1500))]);
  reloadPage();
}

function updateButtons() {
  try { updateButtonsNow(); } catch (err) { startupProblems.push(`buttons: ${String((err && err.message) || err)}`); if (startupDone) showStartupProblems(); }
}

// While a build is making playlists in Spotify, nothing may leave or reload the page or change the account: it would stop the build halfway.
// Closing or reloading the tab asks first (the browser's own Leave site?), and the buttons that would leave are greyed.
function buildWriting() { return personBuild.state === "now"; }
window.addEventListener("beforeunload", (e) => { if (buildWriting()) { e.preventDefault(); e.returnValue = ""; } });

function updateButtonsNow() {
  const writing = buildWriting();
  for (const id of ["updateGet", "changeSpotifyLogin", "clearYes"]) { const b = $(id); if (b) b.disabled = writing; }
  const ready = !!service.signedIn() && connection === "ready" && !!py && formatsValid && !busy && !!activeKey();
  const action = connectionAction();
  // Step 1's buttons, while a sign-in is under way
  const connectButton = $("connect");
  if (connectButton) { setLabel(connectButton, signingIn ? "Connecting\u2026" : `Connect to ${service.name}`); connectButton.disabled = signingIn; }
  if ($("connectionReconnect")) $("connectionReconnect").disabled = signingIn;
  const connectingNow = signingIn || connection === "connecting";
  if (connectingNow && minimalActive()) {
    // in minimalist mode Step 1 is hidden, and the Create button is the one that says what is going on
    setLabel($("create"), "Connecting\u2026");
    setIcon($("create"), "connect");
    $("create").disabled = true;
  } else if (action) {
    const again = connection === "problem";
    setLabel($("create"), again ? (connectionKind === "reconnect" ? "Connect again" : "Try again") : `Connect to ${service.name}`);
    setIcon($("create"), again && connectionKind !== "reconnect" ? "retry" : "connect");
    $("create").disabled = busy;
  } else {
    // Build playlists, followed by the name of the format being edited, which is cut short if it does not fit
    const label = $("create").querySelector(".btn-label");
    label.textContent = "";
    const verb = document.createElement("span");
    verb.className = "build-verb";
    verb.textContent = "Build playlists";
    label.appendChild(verb);
    const active = currentFormats.find((f) => f.id === activeKey());
    if (active) {
      label.appendChild(document.createTextNode(" "));   // so screen readers, and the text itself, read "Build playlists for ..."
      const name = document.createElement("span");
      name.className = "build-name";
      putNamed(name, `for ${named(active.title)}`);
      label.appendChild(name);
    }
    setIcon($("create"), "build");
    $("create").disabled = !ready;
  }
  // The notes appear when Create cannot work because there is no connection, not while the app is still connecting.
  const noConnection = !$("appSection").hidden && (connection === "problem" || connection === "none");
  if (noConnection && minimalActive()) {
    // The button says what to do; the note says what went wrong.
    $("spotifyNote").textContent = connection === "problem" ? $("connectionMessage").textContent : CREATE_NEEDS_SPOTIFY;
    $("spotifyNote").hidden = connection !== "problem";
  } else {
    $("spotifyNote").textContent = CREATE_NEEDS_SPOTIFY;
    $("spotifyNote").hidden = !noConnection;
  }
  const paused = !!service.wait();   // the line under the bar counts down instead
  $("create").hidden = paused || (!currentFormats.length && !action && !connectingNow);   // nothing to build yet: the welcome points at New recipe instead
  document.body.classList.toggle("no-recipes", !currentFormats.length);   // and no status lines either
  if (paused) $("spotifyNote").hidden = true;
  if (minimalActive() && (signingIn || connection === "connecting" || signInNote)) {
    $("spotifyNote").textContent = signingIn ? signInNote : connection === "connecting" ? `Connecting to ${service.name}. On a slow connection this can take a few seconds.` : signInNote;
    $("spotifyNote").hidden = false;
  }
  refreshReconnectScreen();
  if (typeof refreshBuildButtons === "function") refreshBuildButtons();   // the landing's Build buttons (editor.js)
}

// On the app page with no working sign-in (it ran out and could not be renewed), nothing that needs Spotify works, so the app dims behind
// one button that goes through Spotify's sign-in again. A network problem is not this: the page's own Try again is for that.
function refreshReconnectScreen() {
  const screen = $("reconnectScreen");
  if (!screen) return;
  const show = startupDone && pageName() === "app" && !!localStorage.getItem("clientId")
    && (connection === "none" || (connection === "problem" && connectionKind === "reconnect"));
  screen.hidden = !show;
  const main = document.querySelector("main");
  if (main) main.inert = show;
  if (!show) return;
  const button = $("reconnectButton");
  button.disabled = signingIn;
  setLabel(button, signingIn ? "Connecting\u2026" : `Reconnect to ${service.name}`);
  const problem = $("loginMessage").className === "error" ? $("loginMessage").textContent : "";
  $("reconnectNote").textContent = problem;
  $("reconnectNote").hidden = !problem;
}

function connectionAction() {
  // In minimalist mode Step 1 is hidden, so while Spotify is not connected the Create button becomes the way to connect.
  if (!minimalActive() || connection === "ready" || connection === "connecting") return null;
  if (connection === "problem") return connectionKind === "reconnect" ? startLogin : connectToSpotify;
  return localStorage.getItem("clientId") ? startLogin : null;
}

const CREATE_NEEDS_SPOTIFY = `Building playlists needs a working connection to ${service.name}.`;

function setConnection(state, message = "", kind = "retry") {
  connectionKind = kind;
  // kind says what can fix a problem: "retry" (waiting, or the network) or "reconnect" (the sign-in itself)
  connection = state;
  $("connectedSection").hidden = !(state === "connecting" || state === "ready");
  $("connectionProblem").hidden = state !== "problem";
  if (state === "problem") $("connectionMessage").textContent = message;
  $("connectionRetry").hidden = state === "problem" && kind === "reconnect";
  $("connectionReconnect").hidden = state === "problem" && kind !== "reconnect";
  updateButtons();
  if (typeof applyMinimalMode === "function") applyMinimalMode();   // minimalist mode steps aside while Step 1 has a problem to show
  if (typeof renderAppMenu === "function") renderAppMenu();
  if (typeof editorPlaylistsChanged === "function") editorPlaylistsChanged();
  if (state === "ready" && typeof sharingConnected === "function") sharingConnected();   // Music sharing learns which shares are the person's own (sharing.js)
}

async function connectToSpotify() {
  // Reads the profile and the playlists. Until that works the app does not present itself as connected.
  setConnection("connecting");
  $("connectedMessage").textContent = "Connecting...";
  clearReportHints("connectionReportHint");
  try {
    await loadMyPlaylists();
    localStorage.setItem("connectedBefore", "1");   // from now on minimalist mode is available
    setConnection("ready");
    endLimitWait();
    logStep(`connected, ${plural(playlists.length, "playlist")} found`);
    if (!localStorage.getItem("counted") && countEvent(serviceCount("first-connection"))) localStorage.setItem("counted", "1");   // once per browser
    countActiveDay();
  } catch (err) {
    const message = String(err.message || err);
    const short = message === SHORT_LIST_MESSAGE;
    if (!short) recordError(message);   // a short list was recorded with its counts
    logStep("connection failed");
    if (service.wait()) useKeptPlaylists();
    const kind = problemKind(message);
    setConnection("problem", message, kind === "sign-in" ? "reconnect" : "retry");
    if (short) startLimitWait("short");
    else if ((kind === "rate-limit" || kind === "quota") && !service.wait()) startLimitWait(); else endLimitWait();
    countEvent("connection-problem", kind);
    // A report link is for something unexpected. A rate limit, a quota, no internet and a lapsed sign-in are known, and nothing here can fix them.
    if (!short && kind === "other") offerReport("connectionReportHint", message);
  }
}

function setBusy(flag) {
  busy = flag;
  updateButtons();
}

// ---------------------------------------------------------------- confirmation panels
// Create asks under the Create button (askToCreate). Remove asks inside the Remove section, at the bottom of it.

function lengthText(minutes) {
  // 45 min, 2 h 16 min
  const m = Math.round(minutes), h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function builtDescription(p, number, count, when = new Date(), participant = "", heard = [], recipe = "") {
  // The description of a built playlist: the marker the app recognizes its playlists by (it must come first), the request
  // to leave it, then which one of the set and when. No segments (decided by Ron, 2026-11-04). One built for a participant names their code and the day in words, then
  // its packed data: the recipe it came from and their Heard before list (packData). The opening was shortened by Ron, 2026-11-14.
  const date = `${when.getDate()} ${MONTHS[when.getMonth()]} ${when.getFullYear()}`;
  return `${APP_MARKER}. Do not edit this description. `
    + (participant ? `For participant ${participant}. Built ${date}. ${packData({ recipe, heard })}` : count > 1 ? `Playlist ${number} of ${count}, built ${date}.` : `Built ${date}.`);
}

// Confetti thrown from behind the covers: paper bits of a few shapes and shades that burst up in two puffs, slow in the air, then flutter down, turning over
// as they fall (a flat bit seen edge on all but disappears), each at its own pace, fading near the end. Moved by hand each frame, so each one has its own path.
function throwConfetti(fan) {
  const kinds = [["bd-strip", 4, 11], ["bd-strip", 3, 9], ["bd-square", 7, 7], ["bd-square", 5, 5], ["bd-dot", 6, 6]];
  const shades = ["var(--accent)", "var(--accent)", "color-mix(in srgb, var(--accent) 55%, #fff)", "color-mix(in srgb, var(--accent) 22%, #fff)", "color-mix(in srgb, var(--accent) 80%, #000)"];
  const any = (list) => list[Math.floor(Math.random() * list.length)];
  const span = (low, high) => low + Math.random() * (high - low);
  const bits = [];
  for (let i = 0; i < 38; i++) {
    const [kind, w, h] = any(kinds);
    const node = Object.assign(document.createElement("span"), { className: "bd-spark " + kind });
    node.style.cssText = `width: ${w}px; height: ${h}px; margin: ${-h / 2}px 0 0 ${-w / 2}px; background: ${any(shades)}`;
    fan.appendChild(node);
    const angle = (-90 + span(-68, 68)) * Math.PI / 180, speed = span(440, 780);
    bits.push({
      node, x: span(-24, 24), y: span(-10, 10), vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      start: i < 26 ? span(80, 160) : span(260, 340),   // most in the first puff, a few in a smaller second one
      life: span(1700, 2500), drag: span(3.8, 4.8),     // lighter bits slow sooner and fall slower
      turn: span(-1, 1) * 420, flip: span(5, 13) * (Math.random() < 0.5 ? -1 : 1), phase: span(0, 6.3),
      sway: span(10, 26), swayRate: span(3, 6), z: span(0, 360),
    });
  }
  const began = performance.now();
  let last = began;
  const frame = (now) => {
    if (!fan.isConnected) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    let left = 0;
    for (const b of bits) {
      const age = now - began - b.start;
      if (age < 0) { left++; continue; }
      if (age > b.life) { if (b.node.parentNode) b.node.remove(); continue; }
      left++;
      const slow = Math.exp(-b.drag * dt);
      b.vy += 480 * dt;
      b.vx *= slow;
      b.vy *= slow;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const s = age / 1000;
      const settled = Math.min(1, s / 0.7);   // the sway grows as the burst dies down
      const sway = Math.sin(b.phase + s * b.swayRate) * b.sway * settled;
      const fade = Math.min(1, age / 60, (b.life - age) / (b.life * 0.35));
      b.node.style.opacity = fade.toFixed(3);
      b.node.style.transform = `translate3d(${(b.x + sway).toFixed(1)}px, ${b.y.toFixed(1)}px, 0) rotate(${(b.z + b.turn * s + sway * 2).toFixed(1)}deg) rotateX(${(b.phase * 57 + b.flip * s * 60).toFixed(1)}deg)`;
    }
    if (left) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- Spotify sign-in (PKCE, no server)
// Signing in takes a few seconds on a slow connection, in two stretches: opening Spotify, then finishing the sign-in when Spotify sends the person back. In both the
// Connect buttons say so and cannot be pressed again, since a second press would start a second sign-in over the first and spoil it.
let signingIn = new URLSearchParams(location.search).has("code");   // coming back from Spotify: on from the first moment
let signInNote = signingIn ? `Finishing the sign-in with ${service.name}. On a slow connection this can take a few seconds.` : "";
let signInTimer = null;

function setSigningIn(flag, note = "") {
  signingIn = flag;
  signInNote = note;
  clearTimeout(signInTimer);
  if (flag) setLoginMessage(note, true);
  updateButtons();
}

// Change Spotify login: the usual sign-in, but Spotify shows its page even when it is already signed in, where "Not you?" picks another account.
// The current sign-in stays until a new one arrives, so going back from Spotify's page changes nothing.
function changeSpotifyLogin() { if (buildWriting()) return; startLogin({ switchAccount: true }); }

async function startLogin(options) {
  if (signingIn) return;
  const switchAccount = !!(options && options.switchAccount === true);
  const clientId = $("clientId").value.trim();
  if (!clientId) {
    setLoginMessage("Paste your Client ID first.");
    return;
  }
  localStorage.setItem("clientId", clientId);
  setSigningIn(true, `Opening ${service.name}. On a slow connection this can take a few seconds.`);
  clearReportHints("loginReportHint");
  logStep("sign-in started");
  let go;
  try { go = await service.signIn(clientId, { switchAccount }); } catch (err) { setSigningIn(false); setLoginMessage("This browser could not start the sign-in: " + String(err && err.message || err)); return; }
  // if Spotify has not opened after this long, say so, so the buttons are not left waiting for good
  signInTimer = setTimeout(() => {
    if (!signingIn) return;
    setSigningIn(false);
    signInNote = `${service.name} did not open. Check your connection, then try again.`;
    setLoginMessage(signInNote);
    updateButtons();
  }, 30000);
  go();
}

async function finishLoginIfReturning() {
  const result = await service.finishSignIn();
  if (!result || !result.problem) return;
  revealLoginProblem();
  setLoginMessage(result.problem);
  if (result.report) offerReport("loginReportHint", result.report);
}

function setLoginMessage(text, info = false) {
  // The message shows next to the Connect button. Something that went wrong is in the error color; something that is just happening (Spotify is opening) is not.
  $("loginMessage").textContent = text;
  $("loginMessage").className = info ? "muted" : "error";
  refreshReconnectScreen();
}

function revealLoginProblem() {
  // Open the setup steps so the fix (such as the redirect address help) is in view.
  if (!currentFlow()) showFlow("existing");
}

// ---------------------------------------------------------------- talking to Spotify (service-spotify.js), and what this page does and says along the way
Object.assign(serviceHooks, {
  log: logStep,
  oldSignIn: () => { needsReconnect = true; },
  expiredText: () => `Your ${service.name} sign-in expired. ${actWord(true)} Connect again.`,
  signInExpired: (message) => { if (connection === "ready") setConnection("problem", message, "reconnect"); },   // from here on nothing that needs Spotify is offered
  refusedText: (what) => `${service.name} did not allow this (${what}). Sign in again with Change ${service.name} login, in the ⋯ menu on Arc's home, and approve every permission it asks for.`,
  pauseStarted: (first) => {
    updateButtons();
    // when a wait starts, the popup explains; not over the build popup, which says it already
    if (first && typeof showPauseDialog === "function") { closeLimitDialog(); showPauseDialog(); }
  },
  pauseChanged: (left) => { if (typeof refreshPauseViews === "function") refreshPauseViews(left); paintWaitStrip(); },   // the strip under Arc's bar and the popup
  pauseEnded: () => {   // connect again, and save what waited
    updateButtons();
    if (service.signedIn() && connection !== "ready" && connection !== "connecting") connectToSpotify().then(() => { if (connection === "ready") scheduleSpotifySave(500); });
    else if (connection === "ready") scheduleSpotifySave(500);
  },
});

// ---------------------------------------------------------------- Spotify asked Arc to wait (Ron, 2026-11-12, mockups/rate-limit B solid)
// A wait of over a minute is a pause (service-spotify.js). A refusal with no readable wait, or a short one that outlasted the retries, used to leave only a grey line
// and Try again on the Build buttons. Now connecting that is refused that way opens a popup once (showLimitDialog in editor.js) and Arc connects again by itself
// every 5 minutes. Either kind shows the strip under Arc's bar on every view (#waitStrip), with the time to go, until it is over; the strip opens the popup.
const LIMIT_RETRY_MS = 5 * 60 * 1000;
var BUILD_LIST_FRESH_MS = 3 * 60 * 1000;   // a build uses a list read this recently instead of reading it again (var: the tests set it)
const SHORT_LIST_MESSAGE = `${service.name} didn\u2019t send all your playlists.`;
let SHORT_LIST_RETRY_MS = [30000, 120000, 600000];   // a short list is read again after these, then every 10 minutes for as long as it takes
const limitWait = { active: false, retryAt: 0, timer: null, shown: false, reason: "limit", tries: 0 };
function startLimitWait(reason = "limit") {
  if (limitWait.active && limitWait.reason !== reason) limitWait.shown = false;
  if (!limitWait.active || limitWait.reason !== reason) limitWait.tries = 0;
  limitWait.active = true;
  limitWait.reason = reason;
  limitWait.retryAt = Date.now() + (reason === "short" ? SHORT_LIST_RETRY_MS[Math.min(limitWait.tries, SHORT_LIST_RETRY_MS.length - 1)] : LIMIT_RETRY_MS);
  limitWait.tries += 1;
  clearInterval(limitWait.timer);
  limitWait.timer = setInterval(tickLimitWait, 1000);
  paintWaitStrip();
  if (!limitWait.shown) { limitWait.shown = true; if (reason === "short") showShortListDialog(); else if (typeof showLimitDialog === "function") showLimitDialog(); }   // once a wait: the retries say nothing more
  if (typeof refreshBuildButtons === "function") refreshBuildButtons();
}
function endLimitWait() {
  if (!limitWait.active) return;
  const wasShort = limitWait.reason === "short";
  Object.assign(limitWait, { active: false, retryAt: 0, shown: false, reason: "limit", tries: 0 });
  if (wasShort) showNotices([{ text: "All your playlists arrived.", transient: true }]);
  if (typeof refreshBuildButtons === "function") refreshBuildButtons();
  clearInterval(limitWait.timer);
  limitWait.timer = null;
  if (typeof closeLimitDialog === "function") closeLimitDialog();
  paintWaitStrip();
}
function tickLimitWait() {
  if (limitWait.retryAt && Date.now() >= limitWait.retryAt && connection === "problem" && service.signedIn() && !service.wait()) { limitWait.retryAt = 0; retryAfterLimit(); }
  paintWaitStrip();
}
function retryAfterLimit() {
  // Try again now, or the 5 minutes are up: connect, and save what waited
  if (connection === "connecting") return;
  limitWait.retryAt = 0;
  paintWaitStrip();
  connectToSpotify().then(() => { if (connection === "ready") scheduleSpotifySave(500); });
}
function waitStripState() {
  // what the strip shows: { text, open } or null
  const left = service.waitLeft();
  if (left) return { text: `${service.name} asked Arc to wait \u00b7 ${clockText(left)}`, open: () => showPauseDialog() };
  if (!limitWait.active) return null;
  const ms = limitWait.retryAt - Date.now();
  const s = Math.max(0, Math.ceil(ms / 1000));
  const short = limitWait.reason === "short";
  return { text: (short ? "Waiting for all your playlists \u00b7 " : `${service.name} asked Arc to wait \u00b7 `) + (connection === "connecting" || ms <= 0 ? "trying again" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`), open: () => (short ? showShortListDialog() : showLimitDialog()) };
}
function paintWaitStrip() {
  const strip = $("waitStrip");
  if (!strip) return;
  const state = waitStripState();
  const was = !strip.hidden;
  strip.hidden = !state;
  document.documentElement.classList.toggle("spotify-waiting", !!state);
  if (state) { $("waitStripText").textContent = state.text; strip.onclick = state.open; }
  if (was !== !!state && typeof placeSharingPage === "function") placeSharingPage();   // Music sharing's page starts under the strip
}

// ---------------------------------------------------------------- anonymous counts (see Privacy)
function countEvent(name, title) {
  // Sends GoatCounter an event name and, at most, a number or a short kind. Never a name, a format, a song, or an ID.
  // Returns whether it was sent: nothing is sent when the counter is blocked or has not loaded.
  try {
    if (window.goatcounter && typeof window.goatcounter.count === "function") {
      window.goatcounter.count({ path: name, title: title || name, event: true });
      return true;
    }
  } catch (err) { /* counting must never get in the way */ }
  return false;
}

// The service goes into the name (GoatCounter counts by name): first-connection-spotify, active-first-week-tidal (Ron, 2026-11-16)
function serviceCount(name) { return name + "-" + service.key; }

// Once a day per browser, how long since this browser first connected, so returning people show apart from new ones.
// Only the span goes out; the dates stay in localStorage.
function countActiveDay() {
  try {
    const now = Date.now(), today = new Date().toDateString();
    if (localStorage.getItem("countedDay") === today) return;
    const since = Number(localStorage.getItem("countedSince")) || now;
    const days = (now - since) / 86400000;
    const span = days < 7 ? "first-week" : days < 14 ? "second-week" : days < 28 ? "weeks-3-4" : days < 90 ? "months-2-3" : "after-3-months";
    if (countEvent(serviceCount("active-" + span))) {
      localStorage.setItem("countedDay", today);
      if (!localStorage.getItem("countedSince")) localStorage.setItem("countedSince", String(since));
    }
  } catch (err) { /* counting must never get in the way */ }
}

// The tutorial: started each time it is opened, finished at most once for each opening (Watch again does not count twice).
let tutorialFinishCounted = true;
function countTutorialStart(where) { tutorialFinishCounted = false; countEvent("tutorial-started", where); }
function countTutorialEnd() { if (!tutorialFinishCounted) { tutorialFinishCounted = true; countEvent("tutorial-finished"); } }

// The kind of a problem from its message: the sign-in's messages are the page's own (serviceHooks), the rest the service's, which knows its own wording
function problemKind(message) {
  if (/sign-in expired|did not allow/.test(message)) return "sign-in";
  if (message.includes("Could not load the Python runtime from")) return "network";   // the CDN's script did not arrive: the connection or a blocker, not Arc
  return service.problemKind(message) || "other";
}

// What this device knows of the account's playlists, for telling an empty list from a wrong one (loadMyPlaylists)
function knownPlaylistCounts() {
  let kept = 0;
  try { const k = JSON.parse(localStorage.getItem(KEPT_PLAYLISTS_KEY) || "null"); if (k && me && k.user === me.id && Array.isArray(k.list)) kept = k.list.length; } catch (err) { /* none kept */ }
  return { saves: Object.keys(readSynced()).length, kept, visit: playlists.length };
}
function knowsPlaylistsHere() { const k = knownPlaylistCounts(); return !!(k.saves || k.kept || k.visit); }
function knownPlaylistsText() { const k = knownPlaylistCounts(); return `${k.saves} saves, ${k.kept} kept playlists, ${k.visit} read this visit`; }

const KEPT_PLAYLISTS_KEY = "spotifyPlaylists";   // {user, list}: the playlist list from the last time Spotify answered, for the menus during a wait
function keepPlaylists() {
  try {
    const list = playlists.map((p) => ({ id: p.id, name: p.name, owner: p.owner, collaborative: p.collaborative, image: p.image, count: p.count, madeByApp: p.madeByApp, participant: p.participant || "", isSave: p.isSave }));
    localStorage.setItem(KEPT_PLAYLISTS_KEY, JSON.stringify({ user: me && me.id, list }));
  } catch (err) { /* private browsing, or too big: the menus are empty during a wait */ }
}
function useKeptPlaylists() {
  // during a wait with no list from this visit, the menus show the one kept from the last
  if (playlists.length) return;
  try {
    const kept = JSON.parse(localStorage.getItem(KEPT_PLAYLISTS_KEY) || "null");
    if (!kept || !Array.isArray(kept.list) || !kept.list.length) return;
    playlists = kept.list.map((p) => ({ ...p, description: null, snapshot: null, save: null }));
  } catch (err) { return; }
  if (typeof editorPlaylistsChanged === "function") editorPlaylistsChanged();
}

// The DEV menu just opened (showDevMenu in editor.js): Phone width shows what is kept, and the owner's Music sharing rows are brought up to date
function devMenuOpened() {
  let width = ""; try { width = localStorage.getItem("devPhoneWidth") || ""; } catch (e) {}
  for (const button of document.querySelectorAll("#devMenu [data-width]")) button.setAttribute("aria-pressed", String(button.dataset.width === width));
  for (const button of document.querySelectorAll("#devMenu [data-pick-service]")) button.setAttribute("aria-pressed", String(button.dataset.pickService === service.key));
  if (typeof sharingDevMenu === "function") sharingDevMenu();
}

// The owner is whoever the Music sharing worker says is (its OWNER_SPOTIFY_IDS), asked in developer mode only and kept per Spotify account (askOwner in
// sharing.js), so nothing in the page names the owner. Only there are the DEV menu's Music sharing tools shown and the log offered for copying.
const OWNER_KEY = "sharingOwner";
function checkOwner() {
  try {
    const kept = JSON.parse(localStorage.getItem(OWNER_KEY) || "null");
    return !!(kept && kept.owner && kept.account && kept.account === localStorage.getItem("spotifyAccount"));
  } catch (err) { return false; }
}

function limitRecordText() {
  return JSON.stringify({
    app: APP_VERSION, copiedAt: new Date().toISOString(), timezoneOffsetMin: new Date().getTimezoneOffset(),
    previousCopy: Number(localStorage.getItem("spotifyRecordCopiedAt")) || null,
    ...service.requestLog(), syncAsks: readRecord(SYNC_ASKS_KEY, []), saveCreates: readRecord(SAVE_CREATES_KEY, []), saveDuplicates: readRecord(SAVE_DUPLICATES_KEY, []), listReads: readRecord(LIST_READS_KEY, []), tab: TAB_ID,
  });
}

async function copyLimitRecord() {
  try { await navigator.clipboard.writeText(limitRecordText()); }
  catch (err) { showNotices([{ text: `The ${service.name} request log could not be copied.`, transient: true }]); return; }
  try { localStorage.setItem("spotifyRecordCopiedAt", String(Date.now())); } catch (err) { /* private browsing */ }
  showNotices([{ text: `${service.name} request log copied. Paste it into the chat with Claude.`, transient: true }]);
}

// ---------------------------------------------------------------- Device checks (the DEV menu; Ron, 2026-11-14, mockups/device-checks A)
// What the tests can't show, checked on a real device and account. Automatic checks write only to playlists named Arc device check and remove them afterwards,
// even when a check fails; guided checks are steps the person follows and answers, opened in place in the list. Results stay on this device (deviceChecks in
// localStorage, with which guided check is open and how far its steps went, so leaving Arc and coming back finds it there). Copy results gives them as text.
const DC_NAME = "Arc device check";
function dcState() { try { return JSON.parse(localStorage.getItem("deviceChecks") || "{}") || {}; } catch (err) { return {}; } }
function dcKeep(s) { try { localStorage.setItem("deviceChecks", JSON.stringify(s)); } catch (err) { /* private browsing */ } }
function dcStandalone() { return navigator.standalone === true || !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches); }
function dcTouch() { try { return window.matchMedia("(pointer: coarse)").matches; } catch (err) { return false; } }
function dcIOS() { return /iPhone|iPad/.test(navigator.userAgent || "") || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }
function dcDevice() { return [describeBrowser(), dcStandalone() ? "Home Screen app" : null, APP_VERSION].filter(Boolean).join(" · "); }
var dcPace = 1;   // the tests make the waits for Spotify short (var: the tests reach it)
function dcWait(ms) { return new Promise((resolve) => setTimeout(resolve, ms * dcPace)); }
function dcRandomId() { return service.idFromBytes(Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))); }   // a Spotify ID is a 128-bit number
// the person's own playlists with songs, not Arc's and not saves
function dcOwnPlaylists() { return (playlists || []).filter((p) => (!me || p.owner === me.id) && !p.isSave && !p.madeByApp && (p.count == null || p.count > 0)); }

const DC_AUTO = [
  { key: "renew", name: "Sign-in renewal", what: "Renews the sign-in in the background, then uses it", run: async () => {
    if (!service.canRenew()) return { ok: false, note: "This device keeps no refresh token, so the sign-in can't be renewed." };
    const started = performance.now();
    const renewed = await service.renewSignIn();
    if (!renewed) return { ok: false, note: "Spotify refused the renewal, or did not answer." };
    await service.me();
    return { ok: true, detail: `${((performance.now() - started) / 1000).toFixed(1)} s` };
  } },
  { key: "save", name: "Recipe save at full length", what: `Writes ${SAVE_LIMIT} characters to a description, reads them back`, run: async (ctx) => {
    const id = await ctx.playlist();
    const bytes = Array.from({ length: 600 }, () => Math.floor(Math.random() * 256));
    const text = (`${DC_NAME}. ` + denseEncode(bytes)).slice(0, SAVE_LIMIT);
    await service.updatePlaylist(id, { description: text });
    await dcWait(1500);
    const got = String((await service.readPlaylist(id)).description || "");
    if (got === text) return { ok: true, detail: `${got.length} of ${SAVE_LIMIT}` };
    let at = 0;
    while (at < Math.min(got.length, text.length) && got[at] === text[at]) at++;
    return { ok: false, detail: `${got.length} of ${SAVE_LIMIT}`, note: `Spotify sent back ${got.length} characters, differing from character ${at + 1} on.` };
  } },
  { key: "packed", name: "Participant details", what: "A code, a day and Heard before survive in a description", run: async (ctx) => {
    const id = await ctx.playlist();
    const heard = Array.from({ length: HEARD_MAX }, dcRandomId);
    const text = `${DC_NAME}. For participant ZQ9X. Built 14 Nov 2026. ${packData({ recipe: "format-check123", heard })}`;
    await service.updatePlaylist(id, { description: text });
    await dcWait(1500);
    const got = String((await service.readPlaylist(id)).description || "");
    const data = dataOf(got), code = (got.match(PARTICIPANT_RE) || [])[1], day = new Date(builtAtOf(got));
    const fine = data && data.recipe === "format-check123" && data.heard.length === heard.length && data.heard.every((x, i) => x === heard[i]) && code === "ZQ9X" && day.getDate() === 14;
    return fine ? { ok: true, detail: `${text.length} characters` }
      : { ok: false, note: !data ? "The packed part did not read back." : code !== "ZQ9X" ? "The participant's code did not read back." : "Part of it came back changed." };
  } },
  { key: "cover", name: "Cover upload", what: "On an empty test playlist, then one with songs", run: async (ctx) => {
    if (!service.coversAllowed()) return { ok: false, note: "This sign-in has no permission to upload covers." };
    const cover = await loadCover();
    const custom = async (id) => {
      for (let i = 0; i < 4; i++) {
        await dcWait(2000);
        if (await service.hasOwnCover(id)) return true;
      }
      return false;
    };
    const empty = await ctx.playlist();
    await service.setCover(empty, cover);
    const emptyOk = await custom(empty);
    const source = dcOwnPlaylists()[0];
    if (!source) return { ok: emptyOk, detail: emptyOk ? "empty only" : "", note: emptyOk ? "" : "The empty playlist kept no uploaded cover. No playlist of yours had songs to try a full one." };
    const songs = (await loadTracks(source.id)).slice(0, 4).map((t) => t.id);
    const full = await ctx.playlist();
    if (songs.length) await service.addSongs(full, songs);
    await service.setCover(full, cover);
    const fullOk = await custom(full);
    if (emptyOk && fullOk) return { ok: true, detail: "both" };
    return { ok: false, note: `${emptyOk ? "The empty playlist took the cover" : "The empty playlist kept Spotify's own cover"}. ${fullOk ? "The one with songs took it." : "The one with songs kept Spotify's own cover."}` };
  } },
  { key: "isrc", name: "Song codes", what: "Your playlists' songs carry an ISRC", run: async () => {
    let all = 0, coded = 0;
    for (const p of dcOwnPlaylists().slice(0, 3)) {
      for (const t of await loadTracks(p.id)) { all++; if (String(t.key || "").startsWith("isrc:")) coded++; }
    }
    if (!all) return { ok: false, note: "None of your playlists had songs to look at." };
    const pct = Math.round((coded / all) * 100);
    return { ok: pct >= 90, detail: `${pct}%`, note: pct >= 90 ? "" : `Only ${coded} of ${all} songs carry an ISRC.` };
  } },
  { key: "silence", name: "Silence tracks", what: "Arc's silences have the same ISRCs as the ones found on TIDAL", run: async () => {
    // the same album, Silence for Playlists by silence moments, is on TIDAL (work/tidal-plan.md, decision 1); a match lets one silence serve both services
    const tidal = { 30: "DEAR41889211", 60: "DEAR41877634", 180: "DEAR41854451", 300: "DEAR41825110", 600: "DEAR41862465" };
    const off = [];
    for (const [secs, isrc] of Object.entries(tidal)) {
      const song = await service.readSong(service.silence[secs]);
      const got = song && song.key ? song.key.replace("isrc:", "") : "none";
      const length = song ? Math.round(song.ms / 1000) : 0;
      if (got !== isrc || Math.abs(length - Number(secs)) > 1) off.push(`${secs < 60 ? secs + " s" : secs / 60 + " min"}: ${got}, ${length} s (TIDAL: ${isrc})`);
    }
    return off.length ? { ok: false, note: `Differs: ${off.join("; ")}.` } : { ok: true, detail: "5 of 5" };
  } },
  { key: "playable", name: "Which songs play here", what: "Reads up to 3 of your playlists the way Arc checks a copy after Get", run: async () => {
    // stage 6 of work/tidal-plan.md: does the service say, song by song, what plays for this person in their country?
    let all = 0, yes = 0, no = 0, unknown = 0, swapped = 0;
    const notes = [];
    for (const p of dcOwnPlaylists().slice(0, 3)) {
      for (const t of await service.readPlayable(p.id)) {
        all++;
        if (t.playable === true) yes++; else if (t.playable === false) no++; else unknown++;
        if (t.from) swapped++;
        if (t.playable === false && notes.length < 5) notes.push(`${t.id}${t.key ? " " + t.key.slice(5) : ""}${t.why ? " (" + t.why + ")" : ""}`);
      }
    }
    if (!all) return { ok: false, note: "None of your playlists had songs to look at." };
    const detail = `${all} songs: ${yes} play, ${no} don't, ${unknown} unsaid, ${swapped} swapped`;
    return { ok: unknown <= all * 0.1, detail, note: [unknown > all * 0.1 ? `${service.name} said nothing about ${unknown} of ${all}.` : "", notes.length ? `Don't play: ${notes.join("; ")}.` : ""].filter(Boolean).join(" ") };
  } },
  { key: "byisrc", name: "Finding songs by ISRC", what: "Looks up Arc's five silences by their ISRCs", run: async () => {
    const isrcs = ["DEAR41889211", "DEAR41877634", "DEAR41854451", "DEAR41825110", "DEAR41862465"];
    // their titles and artists, as Music sharing has them for a share's songs, for a service that finds songs by name
    const names = {};
    for (const [secs, isrc] of [[30, isrcs[0]], [60, isrcs[1]], [180, isrcs[2]], [300, isrcs[3]], [600, isrcs[4]]]) {
      const song = await service.readSong(service.silence[secs]);
      const [artist, ...title] = String((song && song.label) || "").split(" - ");
      names[isrc] = [title.join(" - "), artist];
    }
    const found = await service.findByIsrc(isrcs, { names });
    // which forms of search the service allows, and the one in use (Spotify refused some to Arc, 2026-11-16)
    const forms = service.searchProbe ? `Searches: ${await service.searchProbe()}.` : "";
    if (found.stopped) return { ok: false, note: `${found.stopped && found.stopped.message || found.stopped} ${forms}`.trim() };
    const off = [], other = [];
    for (const isrc of isrcs) {
      if (!found[isrc]) { off.push(`${isrc} not found`); continue; }
      const song = await service.readSong(found[isrc]);
      if (!song || song.key !== "isrc:" + isrc) off.push(`${isrc} gave ${found[isrc]}, another recording`);
      if (!Object.values(service.silence).includes(found[isrc])) other.push(`${isrc}: ${found[isrc]}`);
    }
    const n = isrcs.length - off.length;
    return { ok: !off.length, detail: `${n} of ${isrcs.length}`, note: [off.join("; "), other.length ? `Other IDs than Arc's own: ${other.join("; ")}.` : "", forms].filter(Boolean).join(" ") };
  } },
  { key: "list", name: "Your playlist list", what: "Every page arrives, none short", run: async () => {
    await loadMyPlaylists();   // a short page is read again, and a list still short throws
    return { ok: true, detail: `${playlists.length} playlists` };
  } },
];

// a song from one of the person's playlists, for the Song link check
function dcSongLink() {
  for (const p of dcOwnPlaylists()) {
    const kept = trackCache.get(p.id);
    const t = kept && kept[0];
    if (t) return service.playlistUrl(p.id, { song: t.id });
  }
  return "";
}
const DC_GUIDED = [
  { key: "devices", name: "Two devices", what: "Edit a recipe here and on another device", yes: "It asked", no: "It didn't ask", steps: [
    "Open the Playlist builder here and on your other device.",
    "Here, change the minutes of a recipe's first segment and tap Done.",
    "On the other device, without reloading, change the same segment to a different number and tap Done.",
    "The other device should ask which version to keep."] },
  { key: "back", name: "Back and forward", what: "Leave Arc, then come back with Back", yes: "Looked right", no: "Something was wrong", steps: [
    "Open the Playlist builder.",
    "Leave Arc with the browser's Back (or open another site), then come back with Forward.",
    "Arc should show the builder as you left it, nothing blank or out of date."] },
  { key: "touch", name: "Double tap and selecting text", what: "Nothing zooms, text can be selected", applies: dcTouch, yes: "Both right", no: "Something was off", steps: [
    "Double-tap a recipe's Build button quickly, then close what opens.",
    "Press and hold a word in a recipe's name until it is selected.",
    "Nothing should have zoomed in, and the word should be selected."] },
  { key: "song", name: "Song link", what: "Opens Spotify at the song", yes: "It showed the song", no: "It didn't", link: () => ({ label: "Open the song link", href: dcSongLink() }), steps: [
    "Tap Open the song link.",
    "Spotify should open the playlist with that song picked out."] },
  { key: "dashboard", name: "Dashboard links", what: "Open in Safari, from a Home Screen app", applies: () => dcStandalone() && dcIOS(), yes: "Safari opened", no: "It didn't", link: () => ({ label: "Open the dashboard", href: "x-safari-https://developer.spotify.com/dashboard", same: true }), steps: [
    "Tap Open the dashboard.",
    "It should open in Safari, not in a panel over Arc."] },
];
function dcApplies(g) { return !g.applies || g.applies(); }

var dcRunning = false;   // var: the tests read it
async function runDeviceChecks() {
  if (dcRunning || busy || connection !== "ready" || service.wait()) return;
  dcRunning = true;
  const state = dcState();
  state.auto = {};
  state.autoAt = Date.now();
  delete state.cleanup;
  dcKeep(state);
  const made = [];
  const ctx = { playlist: async () => {
    const p = await service.createPlaylist({ name: DC_NAME, description: `${DC_NAME}. Removed after the check.` });
    made.push(p.id);
    return p.id;
  } };
  logStep("device checks started");
  try {
    for (const c of DC_AUTO) {
      state.auto[c.key] = { running: true };
      dcKeep(state);
      renderDeviceChecks();
      let result;
      try { result = await c.run(ctx); } catch (err) { result = { ok: false, note: cleanError(err) }; }
      state.auto[c.key] = { ok: !!result.ok, detail: result.detail || "", note: result.note || "", at: Date.now() };
      dcKeep(state);
      renderDeviceChecks();
    }
  } finally {
    // the test playlists go, even when a check failed
    try { if (made.length) await service.deletePlaylists(made); } catch (err) { state.cleanup = `The test playlists could not all be removed: ${cleanError(err)}`; dcKeep(state); }
    try { await loadMyPlaylists(); } catch (err) { /* the list is read again on the next connection */ }
    dcRunning = false;
    logStep("device checks done");
    renderDeviceChecks();
  }
}
function setGuided(key, ok) {
  const state = dcState();
  state.guided = state.guided || {};
  state.guided[key] = { ok, at: Date.now() };
  if (state.open === key) state.open = null;
  dcKeep(state);
  renderDeviceChecks();
}
function dcResultsText() {
  const state = dcState(), auto = state.auto || {}, guided = state.guided || {}, steps = state.steps || {};
  const lines = ["Arc device checks", `Device: ${dcDevice()}`, `Copied: ${new Date().toISOString()}`, "", "Automatic" + (state.autoAt ? ` (run ${new Date(state.autoAt).toISOString()})` : "")];
  for (const c of DC_AUTO) {
    const r = auto[c.key];
    lines.push(`- ${c.name}: ${!r || r.running ? "not run" : r.ok ? "passed" : "FAILED"}${r && r.detail ? ` (${r.detail})` : ""}${r && r.note ? `: ${r.note}` : ""}`);
  }
  if (state.cleanup) lines.push(`- Cleanup: ${state.cleanup}`);
  lines.push("", "With you");
  for (const g of DC_GUIDED) {
    const r = guided[g.key];
    lines.push(`- ${g.name}: ${!dcApplies(g) ? "not here" : !r ? `not done${steps[g.key] ? ` (${steps[g.key]} of ${g.steps.length} steps)` : ""}` : r.ok ? `passed (${g.yes})` : `FAILED (${g.no})`}`);
  }
  return lines.join("\n");
}
async function copyDeviceChecks(button) {
  try { await navigator.clipboard.writeText(dcResultsText()); }
  catch (err) { button.textContent = "Couldn't copy"; setTimeout(renderDeviceChecks, 2000); return; }
  button.textContent = "Copied";
  setTimeout(renderDeviceChecks, 2000);
}

const DC_MARKS = {
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  fail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 7v6"/><path d="M12 17.2v.1"/></svg>',
  hand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12"/><path d="M11 11.5v-2a1.5 1.5 0 0 1 3 0V12"/><path d="M14 10.5a1.5 1.5 0 0 1 3 0V12"/><path d="M17 11.5a1.5 1.5 0 0 1 3 0V16a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L4.3 15a1.5 1.5 0 0 1 2.4-1.8L8 15"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
};
function dcSvg(name) { const s = document.createElement("span"); s.className = "dc-svg"; s.innerHTML = DC_MARKS[name]; return s; }
function renderDeviceChecks() {
  const body = $("dcBody");
  if (!body || $("deviceChecks").hidden) return;
  const state = dcState(), auto = state.auto || {}, guided = state.guided || {}, steps = state.steps || {};
  body.textContent = "";
  body.appendChild(feEl("p", { class: "dc-device", id: "dcDevice", text: dcDevice() }));
  // Automatic
  const done = DC_AUTO.filter((c) => auto[c.key] && !auto[c.key].running);
  const failed = done.filter((c) => !auto[c.key].ok).length;
  body.appendChild(feEl("div", { class: "dc-sec" }, feEl("b", { text: "Automatic" }),
    feEl("span", { id: "dcAutoSum", text: dcRunning ? `${done.length} of ${DC_AUTO.length}` : done.length ? (failed ? `${done.length - failed} passed, ${failed} failed` : `${done.length} passed`) : "Not run on this device" })));
  const autoList = feEl("div", { class: "dc-list", id: "dcAuto" });
  for (const c of DC_AUTO) {
    const r = auto[c.key];
    const mark = !r ? feEl("span", { class: "dc-mark dc-wait" }) : r.running ? feEl("span", { class: "dc-mark dc-run" }) : feEl("span", { class: "dc-mark " + (r.ok ? "dc-ok" : "dc-fail") }, dcSvg(r.ok ? "ok" : "fail"));
    autoList.appendChild(feEl("div", { class: "dc-row", "data-check": c.key },
      mark, feEl("span", { class: "dc-text" }, feEl("span", { class: "dc-name", text: c.name }), feEl("span", { class: "dc-what", text: c.what })),
      feEl("span", { class: "dc-right" + (r && !r.running && !r.ok ? " dc-bad" : "") }, r && r.running ? "Checking…" : r && !r.ok ? "Failed" : r ? r.detail : ""),
      r && !r.running && !r.ok && r.note ? feEl("div", { class: "dc-err", text: r.note }) : null));
  }
  body.appendChild(autoList);
  if (state.cleanup) body.appendChild(problemBox(state.cleanup, "", [], true));
  // With you
  const here = DC_GUIDED.filter(dcApplies);
  body.appendChild(feEl("div", { class: "dc-sec" }, feEl("b", { text: "With you" }), feEl("span", { id: "dcGuidedSum", text: `${here.filter((g) => guided[g.key]).length} of ${here.length} done` })));
  const guidedList = feEl("div", { class: "dc-list", id: "dcGuided" });
  for (const g of DC_GUIDED) {
    const r = guided[g.key], applies = dcApplies(g), open = applies && state.open === g.key;
    const right = !applies ? feEl("span", { class: "dc-right", text: "Not here" }) : r ? feEl("span", { class: "dc-right " + (r.ok ? "dc-pass" : "dc-bad"), text: r.ok ? "Passed" : "Failed" })
      : feEl("span", { class: "dc-right dc-chev" + (open ? " dc-open" : "") }, dcSvg("chev"));
    guidedList.appendChild(feEl(applies ? "button" : "div", { class: "dc-row dc-ghead", type: applies ? "button" : undefined, "data-check": g.key, "aria-expanded": applies ? String(open) : undefined,
      onClick: applies ? () => { const s = dcState(); s.open = s.open === g.key ? null : g.key; dcKeep(s); renderDeviceChecks(); } : undefined },
      feEl("span", { class: "dc-mark dc-hand" }, dcSvg("hand")), feEl("span", { class: "dc-text" }, feEl("span", { class: "dc-name", text: g.name }), feEl("span", { class: "dc-what", text: g.what })), right));
    if (!open) continue;
    // the steps: a tap marks one done (struck through), the next is in bold; then the two answers
    const n = steps[g.key] || 0;
    const list = feEl("ol", { class: "dc-steps" }, ...g.steps.map((text, i) => feEl("li", { class: i < n ? "dc-done" : i === n ? "dc-now" : "", onClick: () => {
      const s = dcState(); s.steps = s.steps || {}; s.steps[g.key] = i < n ? i : i + 1; dcKeep(s); renderDeviceChecks(); } }, text)));
    const link = g.link ? g.link() : null;
    guidedList.appendChild(feEl("div", { class: "dc-step", id: "dcStep-" + g.key }, list,
      link && link.href ? feEl("a", { class: "dc-link", id: "dcLink-" + g.key, href: link.href, target: link.same ? undefined : "_blank", rel: "noopener" }, link.label)
        : link ? feEl("p", { class: "dc-what", text: "Open one of your recipes in the builder first, so Arc knows a song to link to." }) : null,
      feEl("div", { class: "dc-btns" },
        feEl("button", { type: "button", id: "dcNo-" + g.key, onClick: () => setGuided(g.key, false) }, g.no),
        feEl("button", { type: "button", class: "dc-yes", id: "dcYes-" + g.key, onClick: () => setGuided(g.key, true) }, g.yes))));
  }
  body.appendChild(guidedList);
  body.appendChild(feEl("p", { class: "dc-note", text: `Test playlists are named ${DC_NAME} and are removed after each run, even when a check fails. Results stay on this device.` }));
  if (connection !== "ready") body.appendChild(feEl("p", { class: "dc-note", text: `Connect to ${service.name} to run the automatic checks.` }));
  const ready = !dcRunning && !busy && connection === "ready" && !service.wait();
  const copy = feEl("button", { type: "button", class: "dlg-quiet", id: "dcCopy", onClick: () => copyDeviceChecks(copy) }, "Copy results");
  body.appendChild(feEl("div", { class: "dlg-foot" }, copy,
    feEl("button", { type: "button", id: "dcRun", disabled: !ready, onClick: runDeviceChecks }, feEl("span", { class: "btn-label", text: dcRunning ? "Running…" : state.autoAt ? "Run again" : "Run checks" }))));
}

const coverImages = {};   // each cover file as a JPEG in base64, which is how Spotify takes cover art
async function loadCover(file = "playlist-cover.jpg") {
  if (coverImages[file]) return coverImages[file];
  const response = await fetch(file);
  if (!response.ok) throw new Error("The cover image could not be loaded.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  coverImages[file] = btoa(binary);
  return coverImages[file];
}

// What this device knows of the recipe saves belongs to one Spotify account. Signed in to a different one (Change Spotify login), it is forgotten, so the new account's
// saves are read as new and this device's recipes are saved there, instead of each old save looking removed. A device from before this record just starts it.
// whose saves this browser knows (spotifyAccount): the account's ID, with the service before it for any but Spotify, so one service's account never passes for another's
function accountKey() { return me && me.id ? (service.key === "spotify" ? me.id : service.key + ":" + me.id) : null; }
function forgetOtherAccount(id) {
  try {
    const was = localStorage.getItem("spotifyAccount");
    if (was && was !== id) for (const key of ["spotifySynced", "spotifyPendingDeletes", "spotifySavedAt"]) localStorage.removeItem(key);
    localStorage.setItem("spotifyAccount", id);
  } catch (err) { /* private browsing */ }
}

// options.onPage(n, of) follows the reading, page by page (a build shows it: 943 playlists are 19 requests). options.keepIfShort: a list still short does not
// put Arc in the short-list wait when a whole list from this visit is in hand; it throws SHORT_LIST_MESSAGE and the caller goes on with that list (a build).
async function loadMyPlaylists(options = {}) {
  const by = callerTrail();   // before the first wait: after it Safari's stack no longer shows the caller (the record came out blank, 2026-11-13)
  me = await service.me();
  forgetOtherAccount(accountKey());
  playlistLoads += 1;
  // short and empty pages are read again by the service (service-spotify.js); what it found comes with the list
  const list = await service.listMyPlaylists({ onPage: options.onPage });
  playlistsTotal = list.total;
  playlistPages = list.pages;
  playlistsHidden = list.hidden;
  playlistsLeftOut = list.leftOut;
  playlistsUnreadable = list.unreadable || [];
  playlistsReadMs = list.ms;
  playlistsAround = list.unreadableAround || [];
  // Spotify once sent the whole list as 0 of 0 for an account of 81 (Ron, 2026-11-16): Arc took it as true, asked about both saves as gone and made
  // a new one. An empty list while this device knows playlists of this account (saves, the kept list, or this visit's) counts as short instead.
  if (!list.short && !list.length && knowsPlaylistsHere()) list.short = `${service.name} listed 0 of ${list.total || 0} playlists, while this device knows ${knownPlaylistsText()}`;
  if (list.short) {
    // Still short: the list is not used, so nothing works from a half-known state. Arc waits as if not connected (startLimitWait("short")) and keeps
    // the playlists it already had (or the kept list), and reads it again by itself (Ron, 2026-11-13).
    recordError(list.short);
    autoReport(lastErrorText);
    noteShortList();
    if (options.keepIfShort && playlistsLoadedAt) { logStep("playlist list short, the one read earlier kept"); throw new Error(SHORT_LIST_MESSAGE); }
    useKeptPlaylists();
    if (connection === "ready") { setConnection("problem", SHORT_LIST_MESSAGE); startLimitWait("short"); }
    throw new Error(SHORT_LIST_MESSAGE);
  }
  playlistsLoadedBy = by;
  const readBack = playlistsUnreadable.length ? await readBackUnreadable(list) : null;
  playlists = list.map((p) => ({
    id: p.id, name: p.name, owner: p.owner, collaborative: p.collaborative, image: p.image, cover: p.cover, count: p.count, description: p.description,
    snapshot: p.version,   // changes whenever the playlist does
  }));
  for (const p of playlists) { p.madeByApp = madeByAppText(p.description); p.participant = participantOf(p.description); }
  // A format's backup in Spotify is known by what its description decodes to, whatever the playlist is called.
  for (const p of playlists) { const u = unpackFormat(p.description); p.save = u.kind === "none" ? null : u; p.isSave = !!p.save; }
  recordSaveDuplicates();
  recordListRead(by);
  keepPlaylists();
  reportShortListArrived(list);
  if (list.splits && list.splits.length) reportSplitList(list, readBack);
  if (list.reread && devMode()) showNotices([{ text: "Spotify sent a short list. Read again, all there.", transient: true }]);
  // The count shown in Step 1 always matches the list, including after playlists are created or removed.
  playlistsLoadedAt = Date.now();
  $("connectedMessage").textContent = `Connected as ${me.name}. ${plural(playlists.length, "playlist")} found.`;
  if (typeof editorPlaylistsChanged === "function") editorPlaylistsChanged();
}

// The popup when Spotify's list stays short: once a wait, and again from the strip's Details. Ron, 2026-11-13: plain words, OK and a report link.
function showShortListDialog() {
  askSyncChoice(`${service.name} didn\u2019t send all your playlists`,
    "This happens now and then. Arc will keep trying. Until then you can edit your recipes, and building waits.",
    [{ label: "OK", value: "ok", main: true }], { problem: "cloud", reported: reportedLine(lastErrorText) });
}

// Reading the songs for a build, counted so its step moves as it goes (Ron, 2026-11-16: it sat still, then jumped): every playlist the build will read is
// expected first (expectReading), weighed by its song count, and each page read moves it on. songReading is { want, got: Map id -> songs, onChange } while it runs.
let songReading = null;
function expectReading(ids) {
  if (!songReading) return;
  for (const id of ids) {
    if (songReading.want.has(id)) continue;
    const info = (playlists || []).find((p) => p.id === id);
    songReading.want.set(id, Math.max(1, info && typeof info.count === "number" ? info.count : 100));   // a Heard before playlist not in the library: a guess
  }
  songReading.onChange();
}
function songsRead(id, n) {
  if (!songReading || !songReading.want.has(id)) return;
  songReading.got.set(id, Math.min(n, songReading.want.get(id)));
  songReading.onChange();
}
function readingShare() {
  if (!songReading) return null;
  let want = 0, got = 0, done = 0;
  for (const [id, n] of songReading.want) { want += n; const g = songReading.got.get(id) || 0; got += g; if (g >= n) done += 1; }
  return { share: want ? got / want : 0, done, of: songReading.want.size };
}

async function loadTracks(id) {
  if (trackCache.has(id)) { songsRead(id, Infinity); return trackCache.get(id); }
  const info = playlists.find((p) => p.id === id);
  const snapshot = info && info.snapshot ? info.snapshot : null;
  const saved = await savedSongs(id);
  // Saved songs are used when Spotify reports no snapshot to compare (the refresh control covers that case), or when the snapshot is the same.
  if (saved && saved.v === SONGS_VERSION && Array.isArray(saved.tracks) && (!snapshot || saved.snapshot === snapshot)) {
    trackCache.set(id, saved.tracks);
    songsRead(id, Infinity);
    return saved.tracks;
  }
  const tracks = await service.readSongs(id, songReading ? { onSongs: (n) => songsRead(id, n) } : {});
  trackCache.set(id, tracks);
  songsRead(id, Infinity);
  await saveSongs({ id, snapshot, tracks, v: SONGS_VERSION, savedAt: Date.now() });
  return tracks;
}

// ---------------------------------------------------------------- Python (Pyodide)
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error("Could not load the Python runtime from " + src));
    document.head.appendChild(el);
  });
}

async function startPython() {
  let lastError = null;
  for (const version of PYODIDE_VERSIONS) {
    const base = `https://cdn.jsdelivr.net/pyodide/${version}/full/`;
    try {
      $("pythonStatus").textContent = `Loading Pyodide ${version.replace(/^v/, "")}...`;
      await loadScript(base + "pyodide.js");
      const pyodide = await loadPyodide({ indexURL: base });
      const source = await (await fetch("engine.py", { cache: "no-cache" })).text();
      await pyodide.runPythonAsync(source);
      await pyodide.runPythonAsync(`set_silence(${JSON.stringify(JSON.stringify(service.silence))})`);   // the service's silent tracks
      const get = (name) => pyodide.globals.get(name);
      py = {
        formatKeys: get("format_keys"),
        neededSources: get("needed_sources"),
        sourceNeeds: get("source_needs"),
        matchPlaylists: get("match_playlists"),
        buildPlaylists: get("build_playlists"),
      };
      let pythonNumber = "";
      try { pythonNumber = await pyodide.runPythonAsync("import sys; sys.version.split()[0]"); } catch (err) { /* the version is only for the DEV menu's foot */ }
      $("pythonStatus").textContent = `${typeof pythonNumber === "string" && pythonNumber ? `Python ${pythonNumber} · ` : ""}Pyodide ${version.replace(/^v/, "")} ready`;
      pythonVersion = version;
      logStep("python ready");
      return;
    } catch (err) {
      console.error("Python runtime " + version + " failed:", err);
      lastError = err;
    }
  }
  throw new Error("Could not load Python from the internet. Check your connection, then reload. Details are in the browser console. (" + (lastError && lastError.message ? lastError.message.split("\n")[0] : "unknown error") + ")");
}

// ---------------------------------------------------------------- the formats box
function formatLabel(key) {
  const f = currentFormats.find((x) => x.id === key);
  return f ? f.title : key;
}

function refreshFormatKeys() {
  try {
    const model = textToModel($("formats").value, true);
    currentFormats = model.formats.map((f) => ({ id: f.id, title: f.title.trim() || "Untitled" }));
    if (!currentFormats.length) {
      formatsValid = false;
      invalidatePlan();
    } else {
      formatsValid = true;
    }
  } catch (err) {
    currentFormats = [];
    recordError(cleanError(err));
    formatsValid = false;
    invalidatePlan();
  }
  updateButtons();
}

// Silent tracks: the service's (engine.py's SILENCE_TRACKS are set from them). They are in every playlist and are not songs anyone heard.
const SILENCE_IDS = new Set(Object.values(service.silence));

// When each participant playlist was built in this tab (sessionStorage, so a reload keeps it): the description has only the day, so this keeps the order
// exact through a session. Other tabs and devices sort by the day and Spotify's order. Nothing else reads it.
function builtThisSession() {
  try { return JSON.parse(sessionStorage.getItem("participantBuiltAt") || "{}") || {}; } catch (err) { return {}; }
}
function noteBuiltNow(id) {
  const all = builtThisSession();
  all[id] = Date.now();
  try { sessionStorage.setItem("participantBuiltAt", JSON.stringify(all)); } catch (err) { /* private browsing */ }
}
// The playlists Arc built for each participant, from the playlist list already read: [{ code, playlists (newest first), last }], the most recent first
function participantList() {
  const by = new Map(), place = new Map();
  (playlists || []).forEach((p, i) => {
    if (!p.participant || (me && p.owner !== me.id)) return;
    if (!by.has(p.participant)) by.set(p.participant, []);
    by.get(p.participant).push(p);
    place.set(p, i);
  });
  // The description has the day only: on the same day, ones built in this tab first, by their time, then Spotify's order (its newest first)
  const at = builtThisSession();
  const newer = (a, b) => builtAtOf(b.description) - builtAtOf(a.description) || (at[b.id] || 0) - (at[a.id] || 0) || place.get(a) - place.get(b);
  const people = [...by.entries()].map(([code, list]) => {
    list.sort(newer);
    // Heard before: every list their playlists carry, joined (a playlist written by an older page, or edited, may carry less)
    const heard = [];
    for (const p of list) for (const id of heardOf(p.description)) if (!heard.includes(id)) heard.push(id);
    return { code, playlists: list, last: builtAtOf(list[0].description), latest: list[0], heard };
  });
  return people.sort((a, b) => newer(a.latest, b.latest) || a.code.localeCompare(b.code));
}
// What a participant has heard: every song in the playlists built for them, by the song's id as engine.py knows it (song_id), with when the playlist was built.
// Reads their playlists' songs (kept in this browser after the first time). { songs: {id: time}, count, recent: [ids in their most recent playlist] }
// The playlists heardBy reads: those built for them, then their Heard before
function heardReads(code) {
  const person = participantList().find((p) => p.code === code);
  return { person, built: (playlists || []).filter((q) => q.participant === code && (!me || q.owner === me.id)),
    before: [...new Set([...(person ? person.heard : []), ...pendingHeard(code)])] };
}
async function heardBy(code) {
  const songs = {}, recent = [];
  const { person, built, before } = heardReads(code);
  for (const p of built) {
    const at = builtAtOf(p.description) || 1;
    for (const t of await loadTracks(p.id)) {
      if (SILENCE_IDS.has(t.id)) continue;
      const id = t.key || t.id;
      songs[id] = Math.max(songs[id] || 0, at);
      if (person && person.latest && p.id === person.latest.id) recent.push(id);
    }
  }
  // Heard before: heard longest ago of all (0). A playlist no longer in the library is still read by its ID; one Spotify no longer has is skipped.
  for (const id of before) {
    let tracks = [];
    try { tracks = await loadTracks(id); } catch (err) { songsRead(id, Infinity); logStep("heard before: a playlist could not be read"); continue; }
    for (const t of tracks) {
      if (SILENCE_IDS.has(t.id)) continue;
      const key = t.key || t.id;
      if (!(key in songs)) songs[key] = 0;
    }
  }
  return { songs, count: Object.keys(songs).length, recent };
}
// Heard before chosen for a new participant, kept in this tab until their first playlist is built and carries it (sessionStorage pendingHeard: {code: [ids]})
function pendingHeard(code) {
  try { const all = JSON.parse(sessionStorage.getItem("pendingHeard") || "{}") || {}; return code ? all[code] || [] : all; } catch (err) { return code ? [] : {}; }
}
function setPendingHeard(code, ids) {
  const all = pendingHeard();
  if (ids && ids.length) all[code] = ids.slice(0, HEARD_MAX); else delete all[code];
  try { sessionStorage.setItem("pendingHeard", JSON.stringify(all)); } catch (err) { /* private browsing */ }
}
// Saves a participant's Heard before list (Ron, 2026-11-13: a real edit, once, on Done). Their playlists' lists are joined, so a playlist taken out has to leave
// every one that carries it: those are rewritten, and the newest is rewritten when it differs, so the joined list is exactly ids. A failure partway leaves the
// rest as they were; saving again finishes them.
async function saveHeardBefore(code, ids) {
  const person = participantList().find((p) => p.code === code);
  if (!person || !person.latest) throw new Error("No playlist was found for " + code + ".");
  ids = ids.slice(0, HEARD_MAX);
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  let done = 0;
  for (const p of person.playlists) {
    const now = heardOf(p.description);
    if (p === person.latest ? same(now, ids) : now.every((id) => ids.includes(id))) continue;
    const description = withHeard(p.description, p === person.latest ? ids : now.filter((id) => ids.includes(id)));
    await service.updatePlaylist(p.id, { description });
    p.description = description;
    const entry = playlists.find((q) => q.id === p.id);
    if (entry) entry.description = description;
    done += 1;
  }
  keepPlaylists();
  logStep(`heard before: saved, ${done} rewritten`);
}
// A playlist for a participant: MC · Deep journey · 14 Nov, the code first so Spotify's order by name keeps theirs together; then · 2, · 3 when that is taken
// (Ron, 2026-11-14). Only for people to read: the code, the day and the recipe are read from the description, so a renamed playlist changes nothing.
function participantPlaylistName(title, code, when = new Date()) {
  const base = `${code} \u00b7 ${cleanTitle(title).trim() || "Untitled"} \u00b7 ${when.getDate()} ${MONTHS[when.getMonth()]}`;
  const taken = new Set((playlists || []).map((p) => normName(p.name)));
  let name = base, n = 2;
  while (taken.has(normName(name))) name = `${base} \u00b7 ${n++}`;
  return name;
}

function activeKey() {
  return typeof editor !== "undefined" && editor.activeId && currentFormats.some((f) => f.id === editor.activeId) ? editor.activeId : null;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---------------------------------------------------------------- actions: create, remove
async function gatherInputs(keys) {
  // Works out which source playlists the chosen recipes need and reads their songs. Returns { problems } when it cannot.
  const formatsText = $("formats").value;
  const many = keys.length > 1;
  const problems = [];
  for (const b of blankSegmentReport(keys)) {
    problems.push([b.count === 1 ? `A segment in ${named(b.title)} has no playlist yet.` : `${b.count} segments in ${named(b.title)} have no playlist yet.`, "Choose one in the recipe."]);
  }
  const plans = [];
  const failedNotes = [];
  for (const key of keys) {
    try {
      plans.push({ key, names: JSON.parse(py.neededSources(formatsText, key)) });
    } catch (err) {
      failedNotes.push([`${named(formatLabel(key))} could not be planned.`, cleanError(err)]);
    }
  }
  const names = [...new Set(plans.flatMap((p) => p.names))].filter((n) => String(n).trim());
  const match = JSON.parse(py.matchPlaylists(JSON.stringify(names), JSON.stringify(playlists), me.id));
  for (const name of match.missing || []) problems.push([`${named(name)} is not in your ${service.name} playlists.`, `Choose another playlist in the recipe, or check its name in ${service.name}.`]);
  for (const name of match.notMine || []) problems.push([`${named(name)} is not yours.`, `${service.name} only lets this app read playlists you own. Copy its songs into a playlist of your own and use that.`]);
  const tracks = {};
  expectReading(names.filter((n) => match.found[n]).map((n) => match.found[n]));
  for (const name of names.filter((n) => match.found[n])) tracks[name] = await loadTracks(match.found[name]);
  if (problems.length) {
    // The recipe cannot be planned as it is. Playlists that are too short are found from their minutes alone, so they are listed too, all at once.
    for (const p of plans) {
      let needs = {};
      try { needs = JSON.parse(py.sourceNeeds(formatsText, p.key)); } catch (err) { /* already listed as not planned */ }
      const short = Object.entries(needs).filter(([name]) => tracks[name])
        .map(([name, need]) => ({ name, need, has: tracks[name].reduce((n, t) => n + t.ms, 0) / 60000 }))
        .filter((x) => x.has < x.need * 0.9);
      problems.push(...shortProblems({ key: p.key, short }, many));
    }
    recordError(`Build blocked: ${plural(problems.length, "problem")} in the recipe`);
    logStep("plan blocked: recipe problems");
    return { problems: problems.concat(failedNotes) };
  }
  return { formatsText, keys: plans.map((p) => p.key), failedNotes, tracks, ids: match.found, many };
}

function shortProblems(plan, many) {
  // Why a recipe gave no playlists: each source playlist that is too short for even one, in words.
  const where = many ? `In ${named(formatLabel(plan.key))}, ` : "";
  return (plan.short || []).map((s) => s.fit
    ? [`${where}The songs in ${named(s.name)} don\u2019t add up to ${lengthText(s.need)}.`, `A segment has to come within 10% of its length. Make the segment a little longer or shorter, or add a few shorter songs to ${named(s.name)}.`]
    : s.has <= 0
    ? [`${where}${named(s.name)} has no songs this app can use.`, "Local files and podcast episodes are skipped. Add songs to it, or choose another playlist."]
    : [`${where}${named(s.name)} is too short.`, `This recipe uses ${lengthText(s.need)} of it, and it has ${lengthText(s.has)} of songs. Add ${lengthText(Math.max(1, Math.ceil(s.need - s.has)))} of songs to it, or shorten its segments.`]);
}

// A participant's playlist whose repeat share the songs cannot come within 5 points of: too few of their songs in this recipe's playlists, or too few new ones
function repeatProblem(r, asked) {
  const from = asked && asked.from === "all" ? "their previous playlists" : "their most recent playlist";
  if (r.got < r.wanted) return [`Only about ${r.most}% can repeat with this recipe.`, `Few songs from ${from} are in this recipe’s playlists. ${r.most >= 10 ? `Choose ${Math.floor(r.most / 10) * 10}% or less, or another recipe.` : "Choose another recipe, or no repeats."}`];
  return [`Too few new songs for ${r.wanted}% repeats.`, `This recipe’s playlists have few songs they have not heard, so about ${r.got}% would repeat. Choose ${Math.min(100, Math.ceil((r.got - 5) / 10) * 10)}% or more, or add songs to them.`];
}

async function planSelected(opts) {
  // Works out a participant's next playlist (opts: keys, forWhom, repeat). Returns the plan, or { problems } when there is no playlist.
  if (songReading) { const h = heardReads(opts.forWhom); expectReading([...h.built.map((p) => p.id), ...h.before]); }   // so the count is whole before the first read
  const inputs = await gatherInputs(opts.keys);
  if (inputs.problems) return inputs;
  const forWhom = opts.forWhom;
  const heardAll = await heardBy(forWhom);
  const heard = heardAll.songs;
  // Repeat songs (Ron, 2026-11-13): opts.repeat { share: 0 to 100, from: "recent" or "all" }, about that share of the minutes from their most recent playlist or everything heard
  const repeat = opts.repeat && opts.repeat.share > 0
    ? { share: opts.repeat.share / 100, songs: opts.repeat.from === "all" ? Object.keys(heard) : heardAll.recent } : null;
  const built = [];
  const problems = inputs.failedNotes.slice();
  for (const key of inputs.keys) {
    try {
      const plan = JSON.parse(py.buildPlaylists(inputs.formatsText, key, JSON.stringify(inputs.tracks), 1, "[]", JSON.stringify(heard), JSON.stringify(repeat || {})));
      if (!Array.isArray(plan.sources)) throw new Error("engine.py is out of date. Reload the page.");
      if (plan.playlists.length) {
        // one playlist, named for the participant, and how many of its songs they have heard
        const title = (currentFormats.find((f) => f.id === key) || {}).title || "";
        const p = plan.playlists[0];
        p.name = participantPlaylistName(title, forWhom);
        const idOf = new Map();
        for (const list of Object.values(inputs.tracks)) for (const t of list) idOf.set(t.id, t.key || t.id);
        let fresh = 0, again = 0, latest = 0;
        for (const songId of p.ids) {
          if (SILENCE_IDS.has(songId)) continue;
          const at = heard[idOf.get(songId) || songId];
          if (at) { again += 1; latest = Math.max(latest, at); } else fresh += 1;
        }
        plan.fresh = { fresh, again, latest };
        built.push(plan);
      }
      else if (plan.repeat) problems.push(repeatProblem(plan.repeat, opts.repeat));
      else problems.push(...shortProblems(plan, inputs.many));
    } catch (err) {
      recordError(cleanError(err));
      problems.push([`${named(formatLabel(key))} could not be planned.`, cleanError(err)]);
    }
  }
  logStep(built.length ? "plan: 1 playlist planned" : "plan: nothing can be created");
  if (!built.length) return { problems };
  return { built, fresh: built[0].fresh };
}

// One playlist for a participant, built where it will live (Ron, 2026-11-12, mockups/build-one C): no build popup. The participant's row opens on Participants
// and the new playlist fills in at the top of their playlists (personBuild, painted by paintPersonBuild in editor.js); done, a check and rings play over it.
// Problems in the recipe and a failure show in the row in its place. Nothing is replaced, renamed or removed. The row can be folded meanwhile; the build goes on.
const personBuild = { code: null };   // code, state (now, done, blocked, fail), name, step, progress (0 to 1, every phase moves it), minutes, fresh, id, problems, error
function setPersonBuild(change) {
  const was = personBuild.state;
  Object.assign(personBuild, change);
  if (personBuild.state !== was) updateButtons();
  if (typeof paintPersonBuild === "function") paintPersonBuild();
}
async function buildForParticipant(id, code, repeat = null) {
  if (busy || !code) return;
  const f = currentFormats.find((x) => x.id === id);
  if (!f) return;
  setBusy(true);
  for (const k of Object.keys(personBuild)) delete personBuild[k];
  setPersonBuild({ code, state: "now", name: participantPlaylistName(f.title, code), step: "Reading your playlists", progress: 0.03 });
  if (typeof openPersonPanel === "function") openPersonPanel(code);
  logStep("participant build started");
  let made = null;
  try {
    // The list read when connecting (or by a save) is used if it is this fresh: reading it again took 19 requests for 943 playlists and a minute on short
    // pages. Read again, a list that comes short leaves the build on the whole one already held; the strict rule stays for saving and merging (2026-11-15).
    if (!playlistsLoadedAt || Date.now() - playlistsLoadedAt > BUILD_LIST_FRESH_MS) {
      try {
        await loadMyPlaylists({ keepIfShort: true, onPage: (n, of) => { if (of > 3) setPersonBuild({ step: `Reading your playlists \u00b7 ${n} of ${of}`, progress: 0.03 + 0.12 * (n / of) }); } });
      } catch (err) {
        if (String(err.message || err) !== SHORT_LIST_MESSAGE || !playlistsLoadedAt) throw err;
      }
    }
    setPersonBuild({ step: "Reading the songs", progress: 0.15 });
    songReading = { want: new Map(), got: new Map(), onChange: () => {
      const r = readingShare();
      if (r && r.of) setPersonBuild({ step: r.of > 1 ? `Reading the songs \u00b7 ${Math.min(r.done + 1, r.of)} of ${r.of}` : "Reading the songs", progress: 0.15 + 0.23 * r.share });
    } };
    let plan;
    try { plan = await planSelected({ keys: [id], forWhom: code, repeat }); } finally { songReading = null; }
    if (!plan || !plan.built) { setPersonBuild({ state: "blocked", problems: (plan && plan.problems) || [] }); return; }
    const p = plan.built[0].playlists[0];
    const songs = p.ids.filter((x) => !SILENCE_IDS.has(x)).length;
    setPersonBuild({ name: p.name, minutes: p.minutes || 0, fresh: plan.fresh, songs, step: "Making the playlist", progress: 0.4 });
    if (typeof markPlayTipDone === "function") markPlayTipDone();
    let cover = null;
    if (service.coversAllowed()) { try { cover = await loadCover(); } catch (err) { logStep("participant build: cover image not loaded"); } }
    // Heard before rides along: what their playlists carry and what was chosen as they were added
    const known = participantList().find((x) => x.code === code);
    const heard = [...new Set([...(known ? known.heard : []), ...pendingHeard(code)])];
    made = await service.createPlaylist({ name: p.name, description: builtDescription(p, 1, 1, new Date(), code, heard, id) });
    setPendingHeard(code, null);
    noteBuiltNow(made.id);
    if (!made.private) logStep("participant build: could not make it private");
    const songsFrom = 0.5, songsTo = cover ? 0.85 : 0.95;
    await service.addSongs(made.id, p.ids, { onBatch: (k, total) => setPersonBuild({ step: `Adding songs · ${Math.min(k, total)} of ${total}`, progress: songsFrom + (songsTo - songsFrom) * (k / total) }) });
    if (cover) {
      setPersonBuild({ step: "Adding the cover", progress: songsTo });
      try { await service.setCover(made.id, cover); } catch (err) { logStep("participant build: cover not accepted"); }
    }
    countEvent("playlists-created", "1");
    logStep("participant build finished");
    setPersonBuild({ step: "Finishing", progress: 0.95 });
    try { await loadMyPlaylists({ keepIfShort: true }); } catch (err) { /* the playlist is made; the list catches up later */ }
    setPersonBuild({ progress: 1 });
    setPersonBuild({ state: "done", id: made.id, celebrate: true });   // played once by renderParticipantList
  } catch (err) {
    recordError(cleanError(err));
    logStep("participant build failed");
    autoReport(lastErrorText);
    setPersonBuild({ state: "fail", error: cleanError(err), id: made ? made.id : null });
    try { await loadMyPlaylists({ keepIfShort: true }); } catch (ignore) { /* keep the error showing */ }
  } finally {
    invalidatePlan();
    setBusy(false);
    if (typeof paintPersonBuild === "function") paintPersonBuild(true);
  }
}

// Delete on a participant's row: removes the playlists Arc built for them, which is what makes them a participant, then says how it went
async function deleteParticipant(code, list) {
  if (!list || !list.length || busy) return;
  setBusy(true);
  try {
    // shared ones stop being shared first; if that fails, nothing is deleted, so the library never points at a playlist that is gone (Ron, 2026-11-14)
    if (typeof loadMine === "function" && typeof sharedFor === "function") {
      await loadMine();
      if (sharing.mineError) throw new Error(`Arc could not check which of ${code}'s playlists are shared: ${sharing.mineError}`);
      for (const p of list) { const m = sharedFor(p); if (m) { await sharingFetch("DELETE", "/share/" + m.id); ownShareChanged(m.id, null); } }
      if (list.some((p) => sharedFor(p))) loadMine();
    }
    await service.deletePlaylists(list.map((p) => p.id));
    logStep(`participant deleted (${plural(list.length, "playlist")})`);
    if (builderHome.person === code) builderHome.person = null;
    showNotices([{ text: `Deleted ${code} and ${plural(list.length, "playlist")}.`, transient: true }]);
  } catch (err) {
    showNotices([{ text: `${code}'s playlists could not all be removed: ${cleanError(err)}`, transient: true }]);
  } finally {
    try { await loadMyPlaylists(); } catch (err) {}
    setBusy(false);
    if (typeof renderBuilderHome === "function") renderBuilderHome();
  }
}

// ---------------------------------------------------------------- start up
// ---------------------------------------------------------------- sign-in returns, saving when the page is left
function initPageEvents() {
  on("changeSpotifyLogin", "click", () => changeSpotifyLogin());
  // Back from Spotify's page, a browser may show this page as it was left, with the buttons still waiting
  window.addEventListener("pageshow", (event) => { if (event.persisted && signingIn) { setSigningIn(false); setLoginMessage(""); } });
  // the connection coming back after a failed save: try again, without waiting to be asked
  window.addEventListener("online", () => { if (saveState.error) { saveState.error = ""; scheduleSpotifySave(500); } });
  // someone leaving the page, or switching to another app, does not wait for the pause: whatever has not been saved is saved now
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && saveState.timer) runSpotifySave();
    if (document.visibilityState === "visible" && startupDone && Date.now() - versionCheck.last > versionCheck.everyMs) checkForNewVersion();
    // coming back after a while: another device may have changed a backup, so the account's playlists are read again
    if (document.visibilityState === "visible" && connection === "ready" && playlistsLoadedAt && Date.now() - playlistsLoadedAt > playlistRefreshMs && !saveState.running) loadMyPlaylists().catch(() => {});
  });
  // a window that was behind another one and comes forward counts as coming back too
  window.addEventListener("focus", () => { if (startupDone && Date.now() - versionCheck.last > versionCheck.everyMs) checkForNewVersion(); });
  renderSaveStatus();
}

function trackTipHeight() {
  // In the bottom strip the page needs exactly that much room at its end, so nothing is hidden behind it and nothing more is left empty.
  const box = $("supportBox");
  if (!box) return;
  const set = () => document.documentElement.style.setProperty("--tip-h", box.offsetHeight + "px");
  set();
  window.addEventListener("resize", set);
  if (window.ResizeObserver) new ResizeObserver(set).observe(box);
}

// Color, under Everything else on home: every theme as a swatch, the chosen one ringed, no name shown (decided by Ron, 2026-11-09; names are their labels for screen readers).
// A tap chooses at once. The swatches are a radio group: the arrow keys move and choose, as radio buttons do.
function initThemeChooser() {
  const grid = $("themeSwatches");
  const current = chosenColors();
  const entries = THEMES.map((t) => ({ id: t.id, name: t.name, accent: t.accent }));
  if (current.custom) {
    entries.push({ id: "custom", name: "Custom colors", accent: current.accent });
    $("themeNote").textContent = "These colors came from the address (?accent and ?neutral). Choose a color above, or add ?theme=reset to the address, to go back.";
    $("themeNote").hidden = false;
  }
  let selected = current.custom ? "custom" : current.id;
  const swatches = () => Array.from(grid.querySelectorAll(".theme-swatch"));
  const show = () => {
    for (const swatch of swatches()) {
      const on = swatch.dataset.id === selected;
      swatch.setAttribute("aria-checked", String(on));
      swatch.tabIndex = on ? 0 : -1;
    }
  };
  const choose = (id) => {
    if (id !== "custom") {
      setTheme(id);
      selected = id;
      $("themeNote").hidden = true;
      const at = entries.findIndex((e) => e.id === "custom");
      if (at >= 0) { entries.splice(at, 1); grid.querySelector('[data-id="custom"]').remove(); }
      editorThemeChanged();
    }
    show();
  };
  for (const entry of entries) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "theme-swatch";
    swatch.setAttribute("role", "radio");
    swatch.setAttribute("aria-label", entry.name);
    swatch.title = entry.name;
    swatch.dataset.id = entry.id;
    swatch.style.background = entry.accent;
    swatch.addEventListener("click", () => choose(entry.id));
    grid.appendChild(swatch);
  }
  grid.addEventListener("keydown", (event) => {
    const all = swatches(), at = all.indexOf(document.activeElement);
    const to = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 }[event.key];
    if (to === undefined || at < 0) return;
    event.preventDefault();
    const next = all[(to + all.length) % all.length];
    next.focus();
    choose(next.dataset.id);
  });
  show();
}

// Every other script names its own version in scriptVersions. An old copy of one, kept by a browser or a phone's Home Screen app while the rest is new,
// is a startup problem like any other: fresh copies are fetched and the page loads again by itself, then the popup if it is still there.
const SCRIPT_FILES = ["theme.js", "formats.js", "editor.js", "shared-service.js", "service-spotify.js", "service-tidal.js", "sharing.js"];
function checkScriptVersions() {
  const versions = globalThis.scriptVersions || {};
  const old = SCRIPT_FILES.filter((file) => versions[file] !== APP_VERSION);
  if (!old.length) return;
  startupProblems.push(old.map((file) => `${file} is version ${versions[file] || "unknown"}, the app ${APP_VERSION}`).join("; "));
  showStartupProblems();
}
// sharing.js loads after this file, so the check waits until every script has run
function whenScriptsLoaded(work) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => guarded("script versions", work));
  else guarded("script versions", work);
}
// The browser tab's title: Arc, and in developer mode the music service in use after it, Arc (Spotify) (Ron, 2026-11-16). Built from TAB_TITLE, never
// read back from document.title, so the service is never added twice. The <title> tag and apple-mobile-web-app-title stay Arc (the Home Screen name).
const TAB_TITLE = "Arc";
function paintTabTitle() {
  document.title = document.documentElement.classList.contains("dev-mode") ? `${TAB_TITLE} (${service.name})` : TAB_TITLE;
}

async function main() {
  if (window.pageStart) window.pageStart.started = true;   // tells the page's watchdog that this script is running
  startFlowChoice();
  fillActWords();
  fillServiceWords();
  paintTabTitle();
  logStep("page opened");
  const pageVersion = (document.querySelector('meta[name="app-version"]') || {}).content;
  if (pageVersion !== APP_VERSION) startupProblems.push(`page version ${pageVersion || "unknown"} and script version ${APP_VERSION} differ`);
  whenScriptsLoaded(checkScriptVersions);
  whenScriptsLoaded(restoreUpdateView);   // sharing.js loads after this file
  guarded("report details", () => refreshReportBox());
  for (const el of document.querySelectorAll(".redirect-address")) el.textContent = redirectUri();
  $("clientId").value = localStorage.getItem("clientId") || "";
  $("formats").value = localStorage.getItem("formats") || DEFAULT_FORMATS;
  guarded("dashboard links", () => sendDashboardToSafari());
  guarded("color choice", () => initThemeChooser());
  guarded("editor", () => initEditor());
  guarded("formats", () => refreshFormatKeys());

  // Start with no flow shown. People who already saved a Client ID have an app, so open that flow for them.
  showFlow($("clientId").value ? "existing" : null);
  showPage();

  // each Copy button copies the text in the box beside it (the redirect address is filled in at startup)
  for (const button of document.querySelectorAll(".copy-field")) {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.parentNode.querySelector("code").textContent);
        setLabel(button, "Copied");
        setIcon(button, "confirm");   // the one icon change: a check shows the copy worked
      } catch (err) {
        setLabel(button, "Select and copy it by hand");
      }
      setTimeout(() => { setLabel(button, "Copy"); setIcon(button, "copy"); }, 2000);
    });
  }
  initMessageForms();
  on("clearYes", "click", () => clearSavedData());
  // The DEV menu's rows (editor.js opens and closes it): each closes the menu first, so its question or message is in view
  on("devStartOver", "click", async () => {
    showDevMenu(false);
    const choice = await askSyncChoice("Clear data and start over?", "This signs you out and erases everything Arc keeps in this browser. Your Client ID is copied to the clipboard first, so setting up again is a paste.",
      [{ label: "Cancel", value: "no" }, { label: "Clear data", value: "yes", danger: true }]);
    if (choice === "yes") await startOver();
  });
  on("devChecks", "click", () => { showDevMenu(false); openInfo("deviceChecks"); });
  on("devCopyRecord", "click", () => { showDevMenu(false); copyLimitRecord(); });
  on("devCopyLayout", "click", () => { showDevMenu(false); copyLayoutLog(); });
  // Launch screen: the page again with the launch screen, as a Home Screen app starts (Slow: a third of the speed)
  for (const button of document.querySelectorAll("#devMenu [data-launch]")) {
    button.addEventListener("click", () => {
      try { sessionStorage.setItem("launchTest", button.dataset.launch); } catch (e) {}
      pageWindow().location.reload();
    });
  }
  // Phone width: kept in this browser; the outer page reloads to put the page in its frame, or out of it
  for (const button of document.querySelectorAll("#devMenu [data-width]")) {
    button.addEventListener("click", () => {
      try { if (button.dataset.width) localStorage.setItem("devPhoneWidth", button.dataset.width); else localStorage.removeItem("devPhoneWidth"); } catch (e) {}
      pageWindow().location.reload();
    });
  }
  // Music service (TIDAL plan, stage 4): this browser uses Spotify or TIDAL. Each keeps its own Client ID (clientId-spotify, clientId-tidal), swapped in as
  // `clientId` (switchService); the page reloads under the other service.
  for (const button of document.querySelectorAll("#devMenu [data-pick-service]")) {
    button.addEventListener("click", () => {
      if (switchService(button.dataset.pickService)) pageWindow().location.reload();
    });
  }
  on("connect", "click", startLogin);
  on("startSetup", "click", () => slideScreens(() => goToSetup(false)));
  on("getStarted", "click", () => slideScreens(() => showWelcomeStep(2, true)));
  on("wpWhichBack", "click", welcomeStepBack);
  for (const tile of serviceTiles()) {
    tile.addEventListener("click", () => chooseServiceTile(tile.dataset.pickService));
    tile.addEventListener("keydown", (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (step) { e.preventDefault(); moveServiceChoice(step); }
    });
  }
  on("wpWhichNext", "click", () => { const key = chosenService(); if (key) pickService(key); });
  markServiceTiles(service.key !== "spotify" ? service.key : null);   // back from a service chosen before the page loaded again, it is still chosen
  on("wpSetupBack", "click", welcomeStepBack);
  for (const head of document.querySelectorAll("#welcomePage .wp-tool-head")) head.addEventListener("click", () => toggleWelcomeTool(head));
  watchTutorialRows();
  alignWelcomeIcons();
  window.addEventListener("resize", () => { alignWelcomeIcons(); drawSetupJoint(); });
  if (connectingScreen) { alignWelcomeIcons(); drawSetupJoint(); }   // the connecting screen has the band and the line too
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(alignWelcomeIcons);
  on("recipeWhat", "click", (event) => { event.stopPropagation(); showRecipeWhat($("recipeWhatText").hidden); });
  document.addEventListener("click", (event) => { if (!$("recipeWhatText").hidden && !$("recipeWhatText").contains(event.target)) showRecipeWhat(false); });
  window.addEventListener("resize", placeRecipeWhat);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") showRecipeWhat(false); });
  on("setupBack", "click", setupBack);
  window.addEventListener("popstate", pageHistoryMoved);
  try { if (history.state && (history.state.view || history.state.step)) history.replaceState(null, ""); } catch (err) { /* nothing to forget */ }   // a reload keeps the step, but the page opens on home (and the welcome page on its first step)
  // just moved to another music service from the welcome page's choice (pickService): on to its setup step, with the choice one step back
  try {
    if (sessionStorage.getItem("welcomeAt") === "3") {
      sessionStorage.removeItem("welcomeAt");
      if (pageName() === "welcome") { history.replaceState({ page: "welcome", step: 2 }, ""); showWelcomeStep(3, true); }
    }
  } catch (err) { /* it opens on the tools */ }
  initToolMenu();
  on("homeBuilder", "click", () => showView("builder"));
  // Everything else on home: each icon opens its panel in place
  initHomeMore();
  window.addEventListener("resize", fitHomeLines);
  window.addEventListener("resize", placeSharingPage);
  watchLayout();
  on("infoClose", "click", () => closeInfo());
  on("infoOverlay", "click", (event) => { if (event.target === $("infoOverlay")) closeInfo(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && info.node && !event.defaultPrevented) { event.preventDefault(); closeInfo(); } });   // an Escape that closed something inside it (the color list) is not for the popup
  on("connectionRetry", "click", connectToSpotify);
  on("connectionReconnect", "click", startLogin);
  on("reconnectButton", "click", startLogin);
  for (const link of document.querySelectorAll(".privacy-link")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openInfo("privacySection");   // Privacy is a popup from the ⋯ menu
    });
  }
  initMotion();
  smoothResize($("infoDialog"), $("infoSlot"));
  guarded("tip note", () => trackTipHeight());
  on("updateGet", "click", getUpdate);
  on("usOk", "click", closeUpdateScreen);
  document.addEventListener("keydown", (event) => { if (updateScreen && $("updateScreen").classList.contains("us-done") && (event.key === "Escape" || event.key === "Enter")) { event.preventDefault(); closeUpdateScreen(); } });
  guarded("page events", () => initPageEvents());
  on("formats", "input", () => {
    localStorage.setItem("formats", $("formats").value);
    invalidatePlan();
    if (typeof editor === "undefined" || !editor.internal) clearHeldNotice();
    refreshFormatKeys();
  });
  guarded(`a wait from ${service.name}`, () => service.tick());

  if (signingIn) { setLoginMessage(signInNote, true); updateButtons(); }   // coming back from Spotify: say so before the sign-in is finished
  updateStep(launchScreen ? `Connecting to ${service.name}` : `Signing in to ${service.name}`);
  const pythonReady = connectingScreen || updateScreen || launchScreen ? preparePython().then((ok) => { if (ok) connectingStep("Python", "done"); else connectingStepFailed("Python"); return ok; }) : null;   // behind the connecting screen (or the update card) Python loads alongside the sign-in, so the wait is the slower of the two
  try {
    await finishLoginIfReturning();
  } catch (err) {
    setLoginMessage(String(err.message || err));
    offerReport("loginReportHint", String(err.message || err));
  }
  setSigningIn(false);   // the sign-in is over, one way or the other: from here the connection itself is what the buttons follow
  service.storedSignIn();
  if (!service.signedIn() && !needsReconnect && service.canRenew()) {
    setConnection("connecting");
    await service.renewSignIn();   // a sign-in from an earlier visit, renewed without leaving the page
    if (!service.signedIn()) setConnection("none");
  }
  if (!service.signedIn()) { endLaunchScreen(); await connectingStepFailed("Signin"); }   // nothing more to wait for: the app says what to do   // the sign-in did not work: the setup page shows what went wrong
  connectingStep("Signin", "done");
  if (!service.signedIn() && needsReconnect) {
    revealLoginProblem();
    setLoginMessage("Please connect again so this page can build playlists.");
  }

  startupDone = true;
  refreshReconnectScreen();
  showStartupProblems();
  if (!startupProblems.length) setTimeout(checkForNewVersion, 5000);   // a few seconds after a clean start, off the way of everything else
  showPage();   // signed in, or connected before: the app
  if (service.signedIn()) {
    document.body.classList.add("connected");
    connectingStep("Playlists", "active");
    updateStep("Reading your playlists");
    const slowTimer = setTimeout(() => slowReading(true), slowReadingMs);
    try { await connectToSpotify(); }   // and the app only calls itself connected, and offers Create, once Spotify has answered
    finally { clearTimeout(slowTimer); slowReading(false); }
    if (connection === "ready") connectingStep("Playlists", "done");
    else await connectingStepFailed("Playlists");   // the connection problem shows in the app
  }
  if (connectingScreen) await settleFirstSave();
  else if ((updateScreen || launchScreen) && connection === "ready") {
    updateStep("Loading your recipes");
    await runSpotifySave();
    while (saveState.running) await new Promise((r) => setTimeout(r, 100));   // a save already under way (the connection starts one) is waited for too
  }
  updateStep("Starting the playlist builder");
  const pythonOk = await (pythonReady || preparePython());
  if (updateScreen) {
    await new Promise((r) => setTimeout(r, 300));   // the page settles behind the card first
    finishUpdateScreen(pythonOk && connection === "ready" && !startupProblems.length && !saveState.error && $("reconnectScreen").hidden ? "ready" : "");
  }
  if (connectingScreen) await new Promise((r) => setTimeout(r, 100));   // the last check is seen before the screen fades
  if (launchScreen) {
    await new Promise((r) => setTimeout(r, 300));   // the page settles behind the launch screen first
    await finishLaunchScreen(pythonOk && connection === "ready" && !startupProblems.length && !saveState.error && $("reconnectScreen").hidden);
  }
  await setupComplete();   // Continue leaves Arc's home, where the page always opens, in view
  endConnectingScreen();
  // A visit that starts during a wait (the tab was closed, the wait forgotten) opens the popup once, so the missing Build button is explained. A reload does not.
  const pause = service.wait();
  if (pause && sessionStorage.getItem("pauseSeen") !== String(pause.until)) showPauseDialog();
}

async function preparePython() {
  $("pythonNote").textContent = "Getting Python ready. The first time takes a little while...";
  try {
    await startPython();
    $("pythonNote").textContent = "";
    refreshFormatKeys();
    return true;
  } catch (err) {
    $("pythonStatus").textContent = String(err.message || err);
    $("pythonNote").textContent = "Python could not start, so building is unavailable. Check your internet connection and reload the page.";
    $("pythonNote").className = "error";   // the usual small error box
    offerReport("mainReportHint", String(err.message || err));
    return false;
  }
}

main().catch(startupFailed);
