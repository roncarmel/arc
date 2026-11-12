// app.js: the page's logic. It signs in to Spotify, reads playlists, and asks engine.py (running in
// Pyodide, which is Python in the browser) to plan the new playlists. Then it can create them.

// Python runtime versions to try, newest first. If one is not available, the next is used.
const PYODIDE_VERSIONS = ["v0.29.3", "v0.29.2", "v0.29.1", "v0.29.0", "v0.28.3", "v0.27.7"];
const SCOPES = [
  "playlist-read-private", "playlist-read-collaborative",   // read your playlists
  "playlist-modify-private", "playlist-modify-public",      // create playlists
  "user-library-modify",                                    // Spotify's generic library endpoint: removing playlists, and a song's menu in Music sharing saving it to Liked Songs
  "ugc-image-upload",                                       // the cover art on the playlists it creates
].join(" ");
const REQUIRED_SCOPES = ["playlist-modify-private", "playlist-modify-public"];   // cover art is optional, so an older sign-in without it keeps working
const ADD_CHUNK = 100;     // songs added per request (Spotify's documented maximum; fewer requests means fewer rate limits)
const ADD_CHUNK_SMALL = 10; // what is tried instead if Spotify refuses 100
const REMOVE_CHUNK = 40;   // playlists removed per request (Spotify's maximum)

const ALL_FORMATS = "__all__";  // dropdown value that means every format
const APP_VERSION = "2026-11-12t";

// Every playlist this app creates gets this at the start of its description. That is the one way the app tells its
// own playlists from ones you made by hand, so it works on any device, and nothing is stored in this browser for it.
const APP_MARKER = "Made by Arc";                    // change this whenever the page is updated
const OLD_APP_MARKERS = ["Made by Ceremony Playlist Builder"];   // the app's name before Arc (2026-11-08): playlists built then are still its own
function madeByAppText(text) { return typeof text === "string" && [APP_MARKER, ...OLD_APP_MARKERS].some((m) => text.startsWith(m)); }
// A playlist Arc built for a participant says so in its description ("For participant MC."). Its songs are what that participant has heard, so building a recipe never
// replaces or renames it, and Remove built playlists never lists it (decided by Ron, 2026-11-12). Returns the code, or "".
const PARTICIPANT_RE = /\bFor participant ([A-Z0-9]{1,4})\./;
function participantOf(text) { const m = typeof text === "string" && madeByAppText(text) ? text.match(PARTICIPANT_RE) : null; return m ? m[1] : ""; }
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
  document.querySelectorAll('a[href^="https://developer.spotify.com"]').forEach((a) => {
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

async function checkForNewVersion() {
  if (versionCheck.running || navigator.onLine === false) return;
  versionCheck.running = true;
  versionCheck.last = Date.now();
  try {
    const response = await fetch("version.txt?t=" + Date.now(), { cache: "no-store" });
    if (!response.ok) return;
    const latest = (await response.text()).trim();
    if (!/^[A-Za-z0-9._-]{4,40}$/.test(latest) || latest === APP_VERSION) return;   // nothing new, or not a stamp at all (an error page)
    logStep(`newer version found: ${latest}`);
    versionCheck.latest = latest;
    showUpdateCard(latest);
  } catch (err) {
    /* no connection, or the file is not there: the next time */
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
  if (token || connectingScreen) return "app";
  if (storedItem(sessionStorage, "setupAgain") === "1") return "setup";
  if (storedItem(localStorage, "connectedBefore") === "1") return "app";
  const setup = storedItem(localStorage, "setupStarted");
  if (setup === "1" || (setup === null && storedItem(localStorage, "clientId"))) return "setup";
  return "welcome";
}

function showPage() {
  if (token) { try { sessionStorage.removeItem("setupAgain"); } catch (err) { /* nothing to forget */ } }   // signed in: the setup that was opened again is done
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
const PHONE_BAR = window.matchMedia ? window.matchMedia("(max-width: 759px)") : null;
function toolName(view, phone = !!(PHONE_BAR && PHONE_BAR.matches)) { return (phone && TOOL_SHORT_NAMES[view]) || TOOL_NAMES[view] || ""; }
function nameToolInBar() { $("appToolName").textContent = toolName(appView); }
if (PHONE_BAR && PHONE_BAR.addEventListener) PHONE_BAR.addEventListener("change", () => nameToolInBar());

function showView(view, push = true) {
  if (!VIEWS.includes(view)) view = "home";
  if (view === "sharing" && !devMode()) view = "home";   // Music sharing is Coming soon outside developer mode
  if (view === appView) return;
  const was = appView;
  // from one tool to the other the tool slides half a screen and fades (sharing is below the builder), Arc's bar staying put (Ron, 2026-11-08, mockups/tool-motion.html B)
  if (was !== "home" && view !== "home" && slideTools(was, view, () => switchView(was, view, push))) return;
  // home and a tool: the whole screen slides sideways like the setup screens, a tool coming in from the right and home from the left (Ron, 2026-11-09, mockups/tool-motion.html)
  if ((was === "home" || view === "home") && slideHome(view === "home", () => switchView(was, view, push))) return;
  switchView(was, view, push);
}
function switchView(was, view, push) {
  appView = view;
  if (was === "sharing" && typeof closeSharing === "function") closeSharing();
  if (typeof editor === "object" && editor.appMenu && typeof closePanels === "function") closePanels();
  const root = document.documentElement;
  for (const v of VIEWS) root.classList.toggle("view-" + v, v === view);
  nameToolInBar();
  closeToolMenu(false);
  if (push && view !== "home") { try { history.pushState({ view }, ""); } catch (err) { /* the back button just leaves the page */ } }
  window.scrollTo(0, 0);
  if (view === "builder" && typeof renderEditor === "function") renderEditor();   // drawn while hidden, the tabs and the welcome arrow measured nothing
  if (view === "sharing") { placeSharingPage(); openSharing("find"); }
  if (view === "home") { renderHomeRecipes(); alignWelcomeIcons(); }   // drawn while hidden, the band's icon measured nothing
  placeDevPill();
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

// The DEV menu sits in <body> (fixed, so no band, bar or transform holds it), placed under the word Arc that opened it (showDevMenu in editor.js)
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
  const lines = [...page.querySelectorAll(".hp-tool .hp-tag, .hp-tool .hp-data")].filter((el) => el.offsetParent !== null);
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

// Everything else on home: a bar of icons that are tabs (decided by Ron, 2026-11-09, mockups/home-a1-iter-2.html E4). A tap lights one and opens its panel under
// the bar; a tap on the lit one, the X at the bar's end, or Escape inside it closes it. The arrow keys move between the icons.
function homeTabs() { return [...document.querySelectorAll("#homeMore .hp-ee-tab")].filter((tab) => !tab.hidden); }
function openHomeTab(panelId, scroll = true) {
  let opened = null;
  for (const tab of document.querySelectorAll("#homeMore .hp-ee-tab")) {
    const on = tab.getAttribute("aria-controls") === panelId;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on || (!panelId && tab === homeTabs()[0]) ? 0 : -1;
    $(tab.getAttribute("aria-controls")).hidden = !on;
    if (on) opened = $(panelId);
  }
  $("eeClose").hidden = !opened;
  if (panelId === "eeReport") refreshReportBox();
  if (opened && scroll && typeof bringOpenedIntoView === "function") requestAnimationFrame(() => bringOpenedIntoView(opened));
}
function closeHomeTab() {
  const lit = document.querySelector('#homeMore .hp-ee-tab[aria-selected="true"]');
  openHomeTab(null);
  if (lit) lit.focus({ preventScroll: true });
}
function initHomeMore() {
  const tabs = document.querySelectorAll("#homeMore .hp-ee-tab");
  for (const tab of tabs) {
    if (typeof feIcon === "function" && FE_ICONS[tab.dataset.icon]) tab.appendChild(feIcon(tab.dataset.icon)).className = "hp-ee-icon";
    tab.addEventListener("click", () => {
      if (tab.getAttribute("aria-selected") === "true") closeHomeTab();
      else openHomeTab(tab.getAttribute("aria-controls"));
    });
    tab.addEventListener("keydown", (event) => {
      const list = homeTabs(), at = list.indexOf(tab);
      const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: list.length - 1 }[event.key];
      if (to === undefined) return;
      event.preventDefault();
      list[(to + list.length) % list.length].focus();
    });
  }
  on("eeClose", "click", closeHomeTab);
  on("homeMore", "keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || $("eeClose").hidden) return;
    if (event.target.closest && event.target.closest("#clearConfirm")) return;   // an Escape inside the question is for it
    event.preventDefault();
    closeHomeTab();
  });
  openHomeTab(null, false);
}

// Back home: undoes the tool's step in the history when there is one, so the back button does not return to the tool
function goHome() {
  if (appView === "home") return;
  if (history.state && history.state.view) { history.back(); return; }   // the popstate that follows shows home
  showView("home", false);
}

// The tool's name in Arc's bar opens a list: both tools (the one shown ticked; Music sharing Coming soon outside developer mode) and Arc home.
// Decided by Ron, 2026-11-08 (mockups/switch-tools.html A). It closes on a choice, a click or tap anywhere else, or Escape (which returns focus to the name).
function openToolMenu() {
  const menu = $("appToolMenu"), button = $("appTool");
  if (!menu.hidden) { closeToolMenu(true); return; }
  if (typeof editor === "object" && editor.appMenu && typeof closePanels === "function") closePanels();
  for (const item of menu.querySelectorAll(".ab-mi[data-view]")) {
    const view = item.dataset.view;
    if (view !== "home") item.setAttribute("aria-checked", String(view === appView));
    item.disabled = view === "sharing" && !devMode();
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

// Developer mode went on or off (setDevMode in editor.js). Off, Music sharing is Coming soon: its page and its welcome card close, and nothing is read for it.
// On, the library is read as on a normal start.
function devModeChanged(on) {
  if (!on) {
    if (appView === "sharing") goHome();
    const head = $("wpSharingHead");
    if (head && head.getAttribute("aria-expanded") === "true") toggleWelcomeTool(head);
  }
  if (typeof renderSharingCard === "function") renderSharingCard();
  if (typeof renderBuilderHome === "function") renderBuilderHome();   // Participants, greyed outside developer mode
  if (on && pageName() === "app" && typeof loadLibrary === "function") {
    loadLibrary();
    if (connection === "ready") sharingConnected();
  }
}

// Music sharing is a page under the bar: it starts where the bar ends
function placeSharingPage() {
  if (appView !== "sharing") return;
  const bar = $("appBar");
  $("msOverlay").style.top = Math.max(0, Math.round(bar.getBoundingClientRect().bottom + 4)) + "px";
}

// The welcome page's Why? next to "Requires Spotify Premium" opens a small note under it.
function showPremiumWhy(open) {
  $("premiumWhyText").hidden = !open;
  $("premiumWhy").setAttribute("aria-expanded", String(open));
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

// The welcome page has two steps: the tools, then what the one-time setup is. Get started adds a step to the browser's history, so back returns to the tools.
function showWelcomeStep(step, push) {
  const second = step === 2;
  if ($("wpSetup").hidden === !second) return;
  $("wpFirst").hidden = second;
  $("wpSetup").hidden = !second;
  showPremiumWhy(false);
  showRecipeWhat(false);
  if (push) { try { history.pushState({ page: "welcome", step: 2 }, ""); } catch (err) { /* the back button just leaves the page */ } }
  window.scrollTo(0, 0);
  if (second) drawSetupJoint();
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
    Object.assign(joint.querySelector(".wp-spotify-name").style, { left: cx + "px", top: y + size / 2 + 6 + "px" });
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
  if (history.state && history.state.page === "welcome" && history.state.step === 2) { history.back(); return; }   // the popstate that follows shows the tools
  slideScreens(() => showWelcomeStep(1, false));
}

// Moving between the screens before the app (the tools, what setup is, the setup question, its steps) slides: forward, the screen leaves to the left as the next
// comes in from the right; back, the other way. The welcome band stays still between the two welcome steps. Drawn by the browser (View Transitions, CSS in
// index.html, vt-*; the setup line stays, fades in or fades out, wp-wire); a browser without them, reduced motion, or a back gesture the browser animates itself just changes the screen.
function screenRank() {
  const page = pageName();
  if (page === "welcome") return $("wpSetup").hidden ? 0 : 1;
  if (page === "setup") return currentFlow() ? 3 : 2;
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
  for (const head of document.querySelectorAll("#welcomePage .wp-tool-head")) alignIconToText(head.querySelector(".tool-icon"), head.querySelector(".wp-tool-lines"), head.querySelector(".wp-tool-text b"), head.querySelector(".wp-tool-tag"));
  placeTutorialTip();
}

// Each tool's card on the welcome page opens in place to its picture and text; opening one closes the other, so the page stays short.
function toggleWelcomeTool(head) {
  if (head.id === "wpSharingHead" && !devMode() && head.getAttribute("aria-expanded") !== "true") return;   // Coming soon: it does not open
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
// Until TUTORIAL_VIDEO is set, every way in opens the popup saying the video is coming soon.
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
  $("tutorialNote").textContent = TUTORIAL_VIDEO ? "From a new recipe to playlists in your Spotify, in under 2 minutes." : "The video is coming soon.";
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
  try { sessionStorage.setItem("updating", "1"); } catch (err) { /* no storage: the card shows until the reload only */ }
  updateScreen = true;
  $("updateScreen").classList.remove("us-done", "us-out", "us-failed", "us-swap");
  document.documentElement.classList.add("updating", "us-arrive");
  updateStep("Getting the new version");
  reloadForNewVersion(() => {
    try { sessionStorage.removeItem("updating"); } catch (err) { /* nothing was kept */ }
    finishUpdateScreen("failed");
  });
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

// The first save settles the recipes with their saves in Spotify (it may add or change some), so it is done before the screen goes,
// and so is the menu button's second of the cloud picture.
async function settleFirstSave() {
  connectingStep("Recipes", "active");
  await runSpotifySave();
  if (saveState.error) await connectingStepFailed("Recipes");   // the line under the bar says what went wrong
  else connectingStep("Recipes", "done");
  for (let i = 0; i < 30 && typeof savingIcon !== "undefined" && savingIcon.on; i++) await new Promise((r) => setTimeout(r, 50));
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
  if (pageName() === "welcome") showWelcomeStep(state && state.page === "welcome" && state.step === 2 ? 2 : 1, false);
}

// Blocks that open in a popup (the builder menu's Remove built playlists, Autosave or backup and the tutorial, Feedback, Report a problem, the silence ?, the DEV menu's
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
  if (id === "removeSection") removeStage("choose");
  if (id === "tutorialSection") fillTutorialPlayer();
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
  if (info.node.id === "saveMethodSection") backupCardOpen = false;
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
  else if (!under && opener && opener.closest && opener.closest("#homeMore")) opener.focus({ preventScroll: true });   // opened from Everything else on home
  else if (!under && $("feAppMenuButton")) $("feAppMenuButton").focus();
}

function startFlowChoice() {
  // The two answers on the setup page are wired first of all, for the whole page at once, so they work whatever else goes wrong.
  // The capture phase catches the click even from a script that stops it bubbling.
  document.addEventListener("click", (event) => {
    const button = event.target.closest && event.target.closest("[data-flow]");
    if (button) slideScreens(() => { showFlow(button.getAttribute("data-flow")); window.scrollTo(0, 0); });
  }, true);
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
const SONGS_VERSION = 2;   // 2: each song carries its ISRC and album; older saves are read again
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
  $("editorNote").textContent = "Songs will be read again from Spotify the next time you build.";
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

function setOutput(text) {
  // The build popup's status line: what is happening now ("Reading songs from ..."). Problems that stop a plan are cards in the same place.
  $("output").textContent = "";
  putNamed($("output"), text);
  $("output").hidden = !text;
}

function setActionMessage(text) {
  $("actionMessage").textContent = text;   // the build popup's result or problem
}

function setRemoveMessage(text) {
  $("removeMessage").textContent = text;   // progress and results of Remove, shown inside that section
}

// ---------------------------------------------------------------- problem reports
// A report carries only a few technical details. It never carries the sign-in, the Client ID, playlist names,
// song titles, or the formats text. Nothing is sent until the person submits the form in the new tab.
let pythonVersion = "";
let lastErrorText = "";
const stepLog = [];   // the last few things that happened, in plain words, kept in memory only

function logStep(text) {
  stepLog.push(text);
  if (stepLog.length > 10) stepLog.shift();
}

function scrubError(text) {
  // Anything inside quotation marks could be a name the person typed, so it is replaced. The text is also shortened.
  return String(text || "")
    .replace(/(^|[\s(\[])'[^']*'(?=[\s).,:;\]]|$)/g, "$1...")
    .replace(/"[^"]*"/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function recordError(text) {
  lastErrorText = scrubError(text);
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
    recentSteps: stepLog.length ? stepLog.join(" > ") : "none",
  };
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

// Build all recipes, in the builder's menu: only when a build could start now (the build popup asks first, as it does for one recipe)
function canBuildAll() {
  return !!token && connection === "ready" && !!py && formatsValid && !busy && currentFormats.length > 0 && !spotifyPause();
}
function buildAllRecipes() {
  if (canBuildAll()) startCreate(currentFormats.map((f) => f.id));
}

function refreshReportBox() {
  const d = reportDetails();
  $("reportPreview").textContent = [
    `Version: ${d.appVersion}`,
    `Browser: ${d.browser}`,
    `Window size: ${d.windowSize}`,
    `Python: ${d.python.replace("(Python ", "(")}`,
    `Last error: ${d.lastError}`,
    `Recent steps: ${d.recentSteps}`,
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
  if (kind === "problem") body.details = reportDetails();
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

const REPORT_HINTS = ["mainReportHint", "removeReportHint", "loginReportHint", "connectionReportHint"];

function offerReport(hintId, rawError) {
  // An unexpected problem: remember it and show a "Report this problem" link next to the message.
  recordError(rawError);
  logStep("problem: " + lastErrorText.slice(0, 60));
  $(hintId).hidden = false;
}

function clearReportHints(...ids) {
  for (const id of (ids.length ? ids : REPORT_HINTS)) $(id).hidden = true;
}

function clearResults() {
  $("results").textContent = "";
}

function showFlow(flow) {
  // flow is "new", "existing", or null (nothing chosen yet: show neither, and nothing below the choices).
  $("flowNew").hidden = flow !== "new";
  $("flowExisting").hidden = flow !== "existing";
  $("spWhat").hidden = flow === "existing";
  $("spWhatExisting").hidden = flow !== "existing";
  $("connectBlock").hidden = !flow;
  $("spAsk").hidden = !!flow;
  $("spSteps").hidden = !flow;
  $("spStepsTitle").textContent = flow === "new" ? "Create an app inside your Spotify account" : "Find your Client ID";
  currentFlowName = flow;
  if (!flow) { alignWelcomeIcons(); drawSetupJoint(); }
}

let currentFlowName = null;
function currentFlow() {
  return currentFlowName;
}


// ---------------------------------------------------------------- backing up and restoring formats
let undoText = null;   // what the formats box held before the last restore or reset

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

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^\uFEFF/, ""));
    reader.onerror = () => reject(reader.error || new Error("The file could not be read."));
    reader.readAsText(file);  // text files are read as UTF-8, so emoji in playlist names survive
  });
}

function fileStamp() {
  // Local date and 24-hour time, such as 2026-10-25_14-05-09. File names sort in the order they were made,
  // and two backups on the same day never share a name. (Colons are not allowed in file names on Windows,
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
let playlistRefreshMs = 5 * 60 * 1000;   // coming back to the page after this long, the account's playlists, and so the backups, are read again

function saveName(title) {
  return (cleanTitle(title).trim() || "Untitled").slice(0, 80) + SAVE_SUFFIX;
}

function pendingSaveDeletes() {
  try { const list = JSON.parse(localStorage.getItem("spotifyPendingDeletes") || "[]"); return Array.isArray(list) ? list : []; } catch (err) { return []; }
}

function noteFormatDeleted(id) {
  if (backupMode() !== "spotify") return;
  const list = pendingSaveDeletes();
  if (!list.includes(id)) list.push(id);
  try { localStorage.setItem("spotifyPendingDeletes", JSON.stringify(list)); } catch (err) { /* private browsing */ }
}

function scheduleSpotifySave(delay) {
  if (backupMode() !== "spotify") return;
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

// The recipe open in the editor with changes not saved yet (Save changes in the recipe panel; decided by Ron, 2026-11-12: saving is explicit). Its edits are in this
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
  for (const a of asks) {
    const label = a.title.trim() || "Untitled";
    let choice;
    if (a.kind === "conflict") {
      choice = await askSyncChoice(`${named(label)} was changed in two places`, `This device has a version from ${whenText(a.local.modified)}, and Spotify has one from ${whenText(a.remote.modified)}, probably saved from another device. Which one do you want to keep? The other one is replaced.`,
        [{ label: "Keep this device\u2019s", value: "mine" }, { label: "Use Spotify\u2019s", value: "theirs" }], { required: true });
    } else {
      choice = await askSyncChoice(`${named(label)} is no longer in Spotify`, "It was removed from your Spotify, maybe on another device. Keep it here, and it will be saved to Spotify again, or remove it from this device too?",
        [{ label: "Keep it here", value: "keep" }, { label: "Remove it here", value: "remove", danger: true }], { required: true });
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
  if (backupMode() !== "spotify") return;
  clearTimeout(saveState.timer);
  saveState.timer = null;
  if (saveState.running) { saveState.again = true; return; }
  if (busy) { saveState.timer = setTimeout(runSpotifySave, 3000); return; }   // a plan or a build is under way: wait for it to finish
  saveState.since = 0;
  if (connection !== "ready" || !me || typeof editor === "undefined" || !editor.model || spotifyPause()) { renderSaveStatus(); return; }   // after a wait, it is saved then
  saveState.running = true;
  saveState.error = "";
  renderSaveStatus();
  try {
    await mergeFromSpotify();
    const synced = readSynced();
    const tooLong = [], newer = [];
    const allIds = playlists.map((p) => p.id);
    // A backup playlist that has no cover yet is put in a queue for one. The covers are sent after the save is done and never make it wait (see uploadCovers).
    // A save written before the cover said SAVED RECIPE (its description began with the old note) is given the new cover once.
    const putCover = (entry) => { if ((!entry.image || coverDue().includes(entry.id)) && !saveState.coverQueue.includes(entry)) saveState.coverQueue.push(entry); };
    const oldCover = (entry) => { if (String(entry.description || "").startsWith(OLD_SAVE_PREFIX)) markCoverDue(entry.id, true); };
    // formats deleted here: their saves go too, unless a format with that ID is here again
    let pending = pendingSaveDeletes();
    for (const id of pending.slice()) {
      if (!editor.model.formats.some((f) => f.id === id)) {
        const save = savesInAccount().get(id);
        if (save) {
          await spotifyRequest("DELETE", "/me/library", { params: { uris: "spotify:playlist:" + save.id } });
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
        await spotifyRequest("PUT", `/playlists/${have.id}`, { json: { name, description } });
        oldCover(have);
        have.name = name;
        have.description = description;
        have.save = unpackFormat(description);
        synced[fmt.id] = { rev: fmt.rev || 0, playlistId: have.id };
        putCover(have);
      } else if (unreadOfIt) {
        await spotifyRequest("PUT", `/playlists/${unreadOfIt.id}`, { json: { name, description } });
        markCoverDue(unreadOfIt.id, true);
        unreadOfIt.description = description;
        unreadOfIt.save = unpackFormat(description);
        synced[fmt.id] = { rev: fmt.rev || 0, playlistId: unreadOfIt.id };
        putCover(unreadOfIt);
      } else {
        const made = await spotifyRequest("POST", "/me/playlists", { json: { name, public: false, description } });
        if (made.public !== false) { try { await spotifyRequest("PUT", `/playlists/${made.id}`, { json: { public: false } }); } catch (err) { logStep("save: could not make a recipe playlist private"); } }
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
  if (saveState.running) { parts.push({ text: "Saving to Spotify\u2026" }); return parts; }
  if (spotifyPause()) parts.push({ text: "Waiting to save to Spotify until it is back." });
  else if (connection !== "ready") { parts.push({ text: connection === "problem" ? "Waiting to save to Spotify: see the connection problem in the app menu." : "Waiting to save to Spotify: connect first." }); }
  else if (saveState.error) parts.push({ text: "Couldn\u2019t save to Spotify.", action: () => { saveState.error = ""; runSpotifySave(); }, label: "Try again" });
  else if (saveState.timer) parts.push({ text: "Saving to Spotify\u2026" });
  else {
    const at = saveState.savedAt || (() => { try { return localStorage.getItem("spotifySavedAt"); } catch (err) { return null; } })();
    if (at) parts.push({ text: "Last saved at " + new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + "." });
  }
  if (!full) return parts;   // the line in the page: how the saving is going, and nothing more
  // the menu keeps a record of the last news, which the line under the bar only shows for a few seconds
  if (saveState.lastNews) parts.push({ text: `${saveState.lastNews.text} (${new Date(saveState.lastNews.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})` });
  if (saveState.coverProblem) parts.push({ text: saveState.coverProblem.text });
  if (saveState.unread) parts.push({ text: `${saveState.unread === 1 ? "A recipe saved in Spotify" : saveState.unread + " recipes saved in Spotify"} could not be read, or ${saveState.unread === 1 ? "was" : "were"} saved by a newer version of this app, and ${saveState.unread === 1 ? "was" : "were"} left alone.` });
  for (const t of saveState.tooLong) {
    parts.push({ text: `${named(t.title.trim() || "Untitled")} is too long to save to Spotify. It is still saved in this browser.`, action: () => downloadOneFormat(t.id), label: "Download it" });
  }
  return parts;
}

function downloadOneFormat(id) {
  const fmt = editor.model && editor.model.formats.find((f) => f.id === id);
  if (!fmt) return;
  saveFile(`playlist-recipe-${fileStamp()}.txt`, modelToText({ formats: [fmt] }));
}

// Writes the parts into a place on the page, with their actions as pink links.
// Trouble that needs the person: it stays in the line under the editor's bar until it is fixed, or dismissed where that is all there is to do.
function attentionItems() {
  const items = [];
  if (backupMode() !== "spotify") return items;
  const name = (t) => named(String(t).trim() || "Untitled");
  if (connection === "ready" && saveState.error && !saveState.running) items.push({ key: "error", text: "Couldn\u2019t save to Spotify.", actions: [{ label: "Try again", run: () => { saveState.error = ""; runSpotifySave(); } }] });
  const n = saveState.unread;
  if (n && !saveState.dismissed.has("unread:" + n)) items.push({ key: "unread:" + n, ok: true, text: `${n === 1 ? "A recipe saved in Spotify" : n + " recipes saved in Spotify"} could not be read, or ${n === 1 ? "was" : "were"} saved by a newer version of this app, and ${n === 1 ? "was" : "were"} left alone.` });
  if (saveState.coverProblem && !saveState.dismissed.has("cover:" + saveState.coverProblem.key)) items.push({ key: "cover:" + saveState.coverProblem.key, ok: true, text: saveState.coverProblem.text });
  for (const t of saveState.tooLong) if (!saveState.dismissed.has("long:" + t.id)) items.push({ key: "long:" + t.id, ok: true, text: `${name(t.title)} is too long to save to Spotify. It is still saved in this browser.`, actions: [{ label: "Download it", run: () => downloadOneFormat(t.id) }] });
  return items;
}

// What went wrong, in words a person can read: the plain messages are kept, and the technical one ("Spotify returned 500 for PUT /playlists/…") becomes a sentence.
function saveFailureDetail(message) {
  const code = /Spotify returned (\d{3})/.exec(message);
  if (code) return `Spotify returned an error (${code[1]}) while saving.`;
  return String(message).replace(/\s*\/playlists\/[A-Za-z0-9]+/g, "").trim();
}

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

// The cover of a backup playlist is a picture of a cloud with a check above the words SAVED RECIPE, white with a pink glow on black (recipe-cover.jpg). It is sent once, to a playlist that has none, after the save is done, and it never makes a save wait:
// Spotify limits image uploads on their own, so one that is turned away for asking too often stops the rest, quietly, and they go with a later save. Anything else that goes
// wrong with a cover is said in the line under the editor's bar.
async function uploadCovers() {
  if (saveState.coverRunning) return;
  if (!saveState.coverQueue.length) {
    if (saveState.coverProblem) { saveState.coverProblem = null; renderSaveStatus(); }
    return;
  }
  saveState.coverRunning = true;
  let problem = null, stopped = false;
  try {
    if (saveState.coverBlocked || !hasScope("ugc-image-upload")) {
      problem = { key: "permission", text: "Your Spotify sign-in does not include permission to add cover art, so the recipe playlists have no cover. Sign in again with Change Spotify login in More options to allow it." };
    } else {
      let cover = null;
      try { cover = await loadCover("recipe-cover.jpg"); }
      catch (err) { logStep("save: cover image not loaded"); problem = { key: "file", text: "The cover image for the recipe playlists (recipe-cover.jpg) could not be loaded from this site, so they have no cover." }; }
      while (cover && saveState.coverQueue.length && backupMode() === "spotify" && connection === "ready") {
        const entry = saveState.coverQueue[0];
        if (entry.image && !coverDue().includes(entry.id)) { saveState.coverQueue.shift(); continue; }
        try {
          await spotifyRequest("PUT", `/playlists/${entry.id}/images`, { body: cover, contentType: "image/jpeg", noWait: true });
          entry.image = "set";
          markCoverDue(entry.id, false);
          saveState.coverQueue.shift();
        } catch (err) {
          if (problemKind(String(err && err.message || err)) === "rate-limit") { stopped = true; logStep("save: covers wait, Spotify is limiting uploads"); break; }
          logStep("save: cover not accepted");
          if (/did not allow|sign-in expired/.test(err.message)) saveState.coverBlocked = true;
          problem = { key: "refused", text: `Spotify did not accept the cover for the recipe playlists: ${String(err.message || err).replace(/\.$/, "")}. They have no cover.` };
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
  const choices = [{ label: "Back up now", value: "backup", main: true, icon: "download" }, { label: "Try again", value: "retry", icon: "retry" }, { label: "Close", value: "close" }];
  if (unexpected) choices.push({ label: "Report this problem", value: "report", link: true, icon: "flag" });
  const choice = await askSyncChoice("Your recipes couldn\u2019t be saved to Spotify",
    "Your latest changes haven\u2019t been saved to Spotify yet. A backup on this device keeps them safe.", choices, { problem: "cloud", what: saveFailureDetail(message) });
  if (choice === "backup") downloadBackup();
  else if (choice === "retry") { saveState.error = ""; runSpotifySave(); }
  else if (choice === "report") openReport();
}

function dismissAttention(key) {
  saveState.dismissed.add(key);
  renderSaveStatus();
}

// News from reading Spotify: one sentence for each kind, so a few formats added together are one message and not several.
function newsText(verb, titles) {
  const names = titles.map((t) => named(String(t).trim() || "Untitled"));
  if (names.length === 1) return `${verb} ${names[0]} from Spotify.`;
  if (names.length === 2) return `${verb} ${names[0]} and ${names[1]} from Spotify.`;
  return `${verb} ${names.length} recipes from Spotify.`;
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
  if (typeof setSavingIcon === "function") setSavingIcon(saveState.running);   // the menu button shows the cloud-save picture while a save is going on
}

// ---------------------------------------------------------------- how the formats are backed up
// "manual" is the backup file. "spotify", saving each format to Spotify by itself, is the other choice, which is not available yet. Until a choice is made
// the card asking for it is on the page, and the app behaves as it does for "manual".
let backupCardOpen = false;

// Saved to Spotify is how recipes are kept unless the person has chosen the other way: nothing is asked at the first sign-in.
function backupMode() {
  try { return localStorage.getItem("backupMode") === "manual" ? "manual" : "spotify"; } catch (err) { return "spotify"; }
}

// Autosave or backup is a popup from the menu (#saveMethodSection, Ron, 2026-11-10): the two ways, marked as they are now, and Save, pale until the mark changes
function refreshBackupCard() {
  const mode = backupMode();
  $("backupModeManual").checked = mode === "manual";
  $("backupModeSpotify").checked = mode === "spotify";
  refreshBackupSave();
}
function refreshBackupSave() {
  const radio = document.querySelector('input[name="backupMode"]:checked');
  $("backupOk").disabled = !radio || radio.value === backupMode();
}

function openBackupCard() {
  openInfo("saveMethodSection");
  backupCardOpen = true;
  refreshBackupCard();
  const chosen = $("backupModeManual").checked ? $("backupModeManual") : $("backupModeSpotify");
  chosen.focus({ preventScroll: true });   // a keyboard starts on the choice
}

// The radio buttons only mark a choice. Save keeps it and closes the popup; Cancel, the X, Escape and a tap outside close it and change nothing.
async function chooseBackupMode(value) {
  const was = backupMode();
  try { localStorage.setItem("backupMode", value); } catch (err) { /* private browsing */ }
  backupCardOpen = false;
  if (info.node && info.node.id === "saveMethodSection") closeInfo(true);
  applyBackupMode();
  // To Spotify: the first pass settles what is here against what is there, and asks only about formats that differ.
  if (value === "spotify" && was !== "spotify") scheduleSpotifySave(200);
  if (value !== "spotify" && was === "spotify") await leaveSpotifyBackups();
  if (typeof renderAppMenu === "function") renderAppMenu();
}

// Away from Spotify: nothing more is saved there, this device forgets what it knew of the backups, and the person is asked whether to keep the backups that are in
// Spotify or remove them. Keeping them is what happens unless they say otherwise, since another device may still be using them.
async function leaveSpotifyBackups() {
  clearTimeout(saveState.timer);
  saveState.timer = null;
  saveState.since = 0;
  saveState.error = ""; saveState.added = []; saveState.updated = []; saveState.tooLong = []; saveState.newer = []; saveState.unread = 0;
  try { for (const key of ["spotifySynced", "spotifyPendingDeletes", "spotifySavedAt"]) localStorage.removeItem(key); } catch (err) { /* private browsing */ }
  const saves = playlists.filter((p) => p.save && p.save.kind === "save");
  // From here the backup file is the way, so a file is offered in each case, in the message that says what happened to the backups in Spotify.
  const offer = { label: "Back up now", onClick: () => { downloadBackup(); } };
  if (!saves.length) { showBackupMessage("Your recipes are now saved only in this browser.", false, offer); return; }
  const many = saves.length > 1;
  if (connection !== "ready") { showBackupMessage(`The ${many ? "recipes" : "recipe"} saved in Spotify ${many ? "were" : "was"} left as ${many ? "they are" : "it is"}.`, false, offer); return; }
  const them = many ? "them" : "it";
  const answers = [{ label: "Keep " + them, value: "keep" }, { label: "Remove " + them, value: "remove", danger: true }];
  let choice = await askSyncChoice("Remove saved recipes from Spotify?",
    `${many ? "There are " + saves.length + " saved recipes" : "There is 1 saved recipe"} in Spotify, in private playlists ending in (recipe). Keeping ${them} is recommended. Another device that saves to Spotify would lose ${them} too.`, answers);
  // Removing asks once more, and a backup file is downloaded before anything is removed, since from here this browser holds the only copy
  if (choice === "remove") choice = await askSyncChoice("Are you sure?", `If you remove ${them}, a backup file of your recipes downloads to this device first.`, answers);
  if (choice !== "remove") { showBackupMessage(`The ${many ? "recipes" : "recipe"} saved in Spotify ${many ? "were" : "was"} left as ${many ? "they are" : "it is"}.`, false, offer); return; }
  downloadBackup();
  try {
    const ids = saves.map((p) => p.id);
    for (let i = 0; i < ids.length; i += REMOVE_CHUNK) {
      await spotifyRequest("DELETE", "/me/library", { params: { uris: ids.slice(i, i + REMOVE_CHUNK).map((id) => "spotify:playlist:" + id).join(",") } });
    }
    playlists = playlists.filter((p) => !ids.includes(p.id));
    showBackupMessage(`Removed ${plural(ids.length, "saved recipe")} from Spotify. Your recipes are now saved only in this browser, and a backup file is on this device.`);
  } catch (err) {
    showBackupMessage("The saved recipes could not be removed from Spotify: " + String(err && err.message || err), false, offer, true);
  }
}

// Only what belongs to the chosen way is on the page: the backup file's note and step for "manual", the status of the saving for "spotify".
function applyBackupMode() {
  const spotify = backupMode() === "spotify";
  if ($("savedNote")) $("savedNote").hidden = spotify;
  if ($("spotifySaveLine")) $("spotifySaveLine").hidden = !spotify;
  if ($("backupBlock")) $("backupBlock").hidden = spotify;
  document.body.classList.toggle("spotify-backup", spotify);
  // Sign out and clear data: with Spotify as the way, the formats come back from Spotify, not from a file
  for (const [id, text] of [["clearRestoreHelp", "Your recipes stay in Spotify and come back when you connect again."], ["clearConfirmHelp", "Your recipes stay in Spotify and come back when you connect again."]]) {
    const el = $(id);
    if (!el) continue;
    if (el.dataset.manual === undefined) el.dataset.manual = el.innerHTML;
    if (spotify) el.textContent = text; else el.innerHTML = el.dataset.manual;
  }
  if (typeof refreshBackupStatus === "function") refreshBackupStatus();
  renderSaveStatus();
}

function dismissBackupCard() {
  backupCardOpen = false;
  if (info.node && info.node.id === "saveMethodSection") closeInfo();
}

function backupState() {
  const text = $("formats").value;
  const backedUp = localStorage.getItem("lastBackupText");
  const at = localStorage.getItem("lastBackupAt");
  const when = at ? formatBackupTime(at) : "";
  if (backedUp === null) return { kind: text === DEFAULT_FORMATS ? "example" : "never", when };
  return { kind: text !== backedUp ? "edited" : "current", when };
}

function refreshBackupStatus() {
  const state = backupState();
  // Step 4: where the formats stand with regard to a backup.
  $("backupStatus").textContent = {
    example: "You haven't made any recipes yet, so there is nothing to back up.",
    never: "You haven't backed up to this device yet.",
    edited: "Your recipes have been edited since your last backup.",
    current: state.when ? "Last backup: " + state.when + "." : "Your recipes are backed up.",
  }[state.kind];
  // Sign out and clear data: what would be lost, so a backup can be made first.
  $("clearBackupNote").hidden = backupMode() === "spotify";   // with Spotify, the line above already says the recipes stay
  if (backupMode() === "spotify") { $("clearBackupNote").textContent = ""; return; }
  $("clearBackupNote").textContent = {
    example: "You haven't made any recipes yet, so there is nothing to lose.",
    never: "You haven't backed up to this device yet. Back up first, or they will be gone for good.",
    edited: "Your recipes have been edited since your last backup. Back up again first to keep the changes.",
    current: "Your recipes are backed up" + (state.when ? " (last backup: " + state.when + ")" : "") + ".",
  }[state.kind];
}

function markBackedUp(text, atMs) {
  localStorage.setItem("lastBackupText", text);
  localStorage.setItem("lastBackupAt", new Date(atMs || Date.now()).toISOString());
}

// What the person has just done says what happened in the line under the editor's bar, as a notice. One with something to offer (Undo, a link) or one that
// says something went wrong is held there until it is used, put away with OK, or the formats are edited.
function showBackupMessage(text, undo = false, link = null, warn = false) {
  const actions = [];
  if (link) actions.push({ label: link.label, run: link.onClick });
  if (undo) actions.push({ label: "Undo", run: undoLastChange });
  if (typeof showNotices === "function") showNotices([{ text, icon: warn ? "alert" : "device", warn, hold: warn || actions.length > 0, actions, transient: true }]);
}

let openQuestion = null;   // finishes the "create these?" question while it is showing

function closeQuestion(answer) {
  if (openQuestion) openQuestion(answer);
}

function invalidatePlan(resetOutput = !busy) {
  // Anything that could change what a plan would be closes a question that is waiting on it.
  closeQuestion("stale");
  if (resetOutput) setOutput("");
  updateButtons();
}

function planSignature() {
  // What a plan depends on. If it changes while a plan is being made, that plan is thrown away.
  return [$("formats").value, selectedKeys().join(","), String(playlistCap || "")].join("\u0000");
}

function setFormatsText(text) {
  $("formats").value = text;
  localStorage.setItem("formats", text);
  invalidatePlan();
  refreshFormatKeys();
  refreshBackupStatus();
  syncEditorFromText();
}

function undoLastChange() {
  if (undoText === null) return;
  setFormatsText(undoText);
  undoText = null;
  showBackupMessage("Undone. Your recipes are back as they were.");
}

function downloadBackup() {
  const text = $("formats").value;
  saveFile(`playlist-recipes-${fileStamp()}.txt`, text);
  markBackedUp(text);
  undoText = null;
  logStep("backup downloaded");
  showBackupMessage(BACKED_UP_MESSAGE);
  refreshBackupStatus();
}

async function restoreFromFile(file) {
  if (!file) return;
  undoText = null;
  if (file.size > 200000) {
    showBackupMessage(`${file.name} is too large to be a recipe backup, so nothing was changed.`, false, null, true);
    return;
  }
  let text;
  let formatCount;
  try {
    text = await readFileText(file);
    formatCount = textToModel(text).formats.length;
  } catch (err) {
    recordError(cleanError(err));
    logStep("restore: file rejected");
    showBackupMessage(`${file.name} doesn't look like a recipe backup, so nothing was changed. (${cleanError(err)})`, false, null, true);
    return;
  }
  const previous = $("formats").value;
  setFormatsText(text);
  markBackedUp(text, file.lastModified);   // the file matches what is now in the box
  refreshBackupStatus();
  undoText = previous;
  logStep(`restore: ${plural(formatCount, "format")} loaded`);
  showBackupMessage(`Restored ${formatCount} recipe${formatCount === 1 ? "" : "s"} from ${file.name}.`, true);
}

const BACKED_UP_MESSAGE = "Backed up to this device. Find the file in Downloads, or in the Files app on a phone.";   // after a manual backup, wherever it is made from
let reloadPage = () => location.reload();   // a separate function so tests can replace it

// Sign out and clear data (Everything else on home) erases everything and copies nothing: it is for leaving a computer that is not yours. Start over (developer options)
// does the same but puts the Client ID on the clipboard first (while the click still counts), so setting up again is a paste.
function startOver() { return clearSavedData({ copyClientId: true }); }

async function clearSavedData(options) {
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

function updateButtonsNow() {
  const ready = !!token && connection === "ready" && !!py && formatsValid && !busy && !!activeKey();
  const action = connectionAction();
  // Step 1's buttons, while a sign-in is under way
  const connectButton = $("connect");
  if (connectButton) { setLabel(connectButton, signingIn ? "Connecting\u2026" : "Connect to Spotify"); connectButton.disabled = signingIn; }
  if ($("connectionReconnect")) $("connectionReconnect").disabled = signingIn;
  const connectingNow = signingIn || connection === "connecting";
  if (connectingNow && minimalActive()) {
    // in minimalist mode Step 1 is hidden, and the Create button is the one that says what is going on
    setLabel($("create"), "Connecting\u2026");
    setIcon($("create"), "connect");
    $("create").disabled = true;
  } else if (action) {
    const again = connection === "problem";
    setLabel($("create"), again ? (connectionKind === "reconnect" ? "Connect again" : "Try again") : "Connect to Spotify");
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
  $("removeOld").disabled = !(!!token && connection === "ready" && !!py && !busy) || !$("removeKey").value || removeNone;
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
  $("removeNote").hidden = !noConnection;
  const paused = !!spotifyPause();   // the line under the bar counts down instead
  $("create").hidden = paused || (!currentFormats.length && !action && !connectingNow);   // nothing to build yet: the welcome points at New recipe instead
  document.body.classList.toggle("no-recipes", !currentFormats.length);   // and no status lines either
  if (paused) $("spotifyNote").hidden = true;
  if (minimalActive() && (signingIn || connection === "connecting" || signInNote)) {
    $("spotifyNote").textContent = signingIn ? signInNote : connection === "connecting" ? "Connecting to Spotify. On a slow connection this can take a few seconds." : signInNote;
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
  setLabel(button, signingIn ? "Connecting\u2026" : "Reconnect to Spotify");
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

const CREATE_NEEDS_SPOTIFY = "Building playlists needs a working connection to Spotify.";

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
  if (state === "ready" && typeof sharingConnected === "function" && devMode()) sharingConnected();   // Music sharing learns which shares are the person's own (sharing.js)
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
    logStep(`connected, ${plural(playlists.length, "playlist")} found`);
    offerLimitRecord();
    if (!localStorage.getItem("counted") && countEvent("first-connection")) localStorage.setItem("counted", "1");   // once per browser
    countActiveDay();
  } catch (err) {
    const message = String(err.message || err);
    recordError(message);
    logStep("connection failed");
    if (spotifyPause()) useKeptPlaylists();
    setConnection("problem", message, /sign-in expired|did not allow/.test(message) ? "reconnect" : "retry");
    countEvent("connection-problem", problemKind(message));
    // A report link is for something unexpected. A rate limit, a quota, no internet and a lapsed sign-in are known, and nothing here can fix them.
    if (!/rate limiting|request quota|Could not reach Spotify|Spotify did not answer|sign-in expired|did not allow|needs Premium/.test(message)) offerReport("connectionReportHint", message);
  }
}

function setBusy(flag) {
  busy = flag;
  updateButtons();
}

// ---------------------------------------------------------------- confirmation panels
// Create asks under the Create button (askToCreate). Remove asks inside the Remove section, at the bottom of it.

// ---------------------------------------------------------------- the popup for Create
// One popup holds everything after a click on Build: the steps along the top (read songs, plan, build, done), then the plan and its question,
// then the same list of playlists ticked off one by one, then the links. When something goes wrong the build stops, and the popup says what
// went wrong, what was built, and what to do; it never tries to repair anything. It can be dismissed while it is asking and once it is done
// (the Close button, a click outside it, or Escape), but not while the app is reading or creating.
let createStage = "closed";   // closed, planning, question, creating or done

function setCreateStage(stage) {
  createStage = stage;
  $("confirmButtons").hidden = stage !== "question";
  $("bdBusyRow").hidden = stage !== "planning" && stage !== "creating";
  setLabel($("bdBusy"), stage === "creating" ? "Building…" : "Build playlists");   // while reading, the button that will build waits, pale
  $("createCloseRow").hidden = stage !== "done";
  const closable = stage === "question" || stage === "done";   // the X stays in its place, unseen, while the popup cannot be closed (reading and building)
  $("bdClose").classList.toggle("bd-x-off", !closable);
  $("bdClose").disabled = !closable;
}

function openCreateDialog(keys) {
  // The header: one recipe shows its name (and, over the question, its length); several just say how many.
  $("bdTitle").textContent = keys.length === 1 ? formatLabel(keys[0]) : `Build ${plural(keys.length, "recipe")}`;
  const f = keys.length === 1 && editor.model ? editor.model.formats.find((x) => x.id === keys[0]) : null;
  const info = $("bdShapeInfo");
  info.hidden = !f;
  if (f) {
    const { music, quiet } = recipeShape(f);
    info.textContent = `${lengthText(music + quiet / 60)} per playlist · ${plural(f.items.length, "segment")}`;
  }
  $("createOverlay").hidden = false;
  document.body.style.overflow = "hidden";
  setCreateStage("planning");
  $("createDialog").focus();
}

function closeCreateDialog() {
  if ($("createOverlay").hidden) return;
  $("createOverlay").hidden = true;
  document.body.style.overflow = "";
  createStage = "closed";
  $("createDialog").classList.remove("bd-listing");
  closeQuestion("cancel");   // dismissing the question is the same as cancelling it
  $("create").focus();
}

function dismissCreateDialog() {
  if (createStage === "question" || createStage === "done") closeCreateDialog();
}

function fillConfirmList(listId, textId, text, list) {
  $(textId).textContent = text;
  $(textId).hidden = !text;
  const ul = $(listId);
  ul.textContent = "";
  for (const item of list.slice(0, 8)) {
    const li = document.createElement("li");
    li.textContent = item;
    ul.appendChild(li);
  }
  if (list.length > 8) {
    const li = document.createElement("li");
    li.textContent = `...and ${list.length - 8} more`;
    ul.appendChild(li);
  }
  ul.hidden = list.length === 0;
}

function resetBuildPopup() {
  setOutput("");
  setActionMessage("");
  clearResults();
  $("confirmBox").hidden = true;
  $("bdTally").hidden = true;
  $("bdTiles").textContent = "";
  $("bdInfo").textContent = "";
  $("bdRead").hidden = true;
  $("bdReadList").textContent = "";
  $("createDialog").classList.remove("bd-listing");
  $("planText").hidden = true;
  $("planText").textContent = "";
  for (const id of ["bdPickHead", "bdPick"]) $(id).hidden = true;
  $("createNotes").hidden = true;
  $("createOpen").hidden = true;
}

// Small drawings, all made here so they follow the theme's colors.
const BD_ICON = {
  done: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="var(--accent)"/><path d="M4.5 8.2l2.3 2.3 4.7-4.9" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  fail: '<svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="var(--accent)"/><path d="M10 5.3v5.7" stroke="#fff" stroke-width="2.3" stroke-linecap="round"/><circle cx="10" cy="14.5" r="1.3" fill="#fff"/></svg>',   // errors look the same everywhere: a pink ! (FE_ICONS.alert)
  now: '<svg class="bd-spin" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="var(--line)" stroke-width="2.2" fill="none"/><path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" stroke="var(--accent)" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>',
  wait: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="var(--muted)" stroke-width="1.5" fill="none" stroke-dasharray="2 2.4"/></svg>',
  num: (n) => `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7.2" stroke="var(--muted)" stroke-width="1.2" fill="none"/><text x="8" y="11.4" text-anchor="middle" font-size="${n > 9 ? 7.5 : 9.5}" font-family="system-ui, sans-serif" fill="var(--muted)">${n}</text></svg>`,
  replace: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/></svg>',
  rename: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  copy: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  shared: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/></svg>',
  music: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
};

const BD_STEPS = [["read", "Read songs"], ["plan", "Plan"], ["build", "Build"], ["done", "Done"]];
let buildStep = "read";   // the step under way, so a problem can be shown on it

function setBuildSteps(current, failed = false, waiting = false) {
  // The steps before `current` are ticked; `current` is under way, or has failed, or (waiting) has not started. "done" ticks them all.
  buildStep = current;
  const box = $("bdSteps");
  box.textContent = "";
  const at = BD_STEPS.findIndex((step) => step[0] === current);
  BD_STEPS.forEach(([, label], i) => {
    if (i) box.appendChild(Object.assign(document.createElement("span"), { className: "bd-sep" }));
    const state = current === "done" || i < at ? "done" : i === at && !waiting ? (failed ? "fail" : "now") : "";
    const step = document.createElement("span");
    step.className = "bd-step" + (state ? " bd-step-" + state : "");
    step.innerHTML = state ? BD_ICON[state] : BD_ICON.num(i + 1);
    step.appendChild(document.createTextNode(label));
    box.appendChild(step);
  });
}

function lengthText(minutes) {
  // 45 min, 2 h 16 min
  const m = Math.round(minutes), h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function builtDescription(p, number, count, when = new Date(), participant = "") {
  // The description of a built playlist: the marker the app recognizes its playlists by (it must come first), the request
  // to leave it, then which one of the set and when. No segments (decided by Ron, 2026-11-04). One built for a participant names their code.
  const date = `${when.getDate()} ${MONTHS[when.getMonth()]} ${when.getFullYear()}`;
  return `${APP_MARKER}. Please do not edit this description. The app uses it to recognize the playlists it made. `
    + (participant ? `For participant ${participant}. Built ${date}.` : count > 1 ? `Playlist ${number} of ${count}, built ${date}.` : `Built ${date}.`);
}

function playlistRow(p, icon) {
  // One playlist in the popup's list: an icon for where it stands, its name, and its songs and length (or what is under way).
  const li = document.createElement("li");
  li.className = "bd-row";
  const ic = Object.assign(document.createElement("span"), { className: "bd-ic" });
  const name = Object.assign(document.createElement("span"), { className: "bd-name", textContent: p.name });
  const meta = Object.assign(document.createElement("span"), { className: "bd-meta" });
  li.append(ic, name, meta);
  li.bd = { p, ic, name, meta };
  setRowState(li, icon);
  return li;
}

function setRowState(li, state, note) {
  // state: "wait", "now", "done" or "fail". note replaces the songs and length; a playlist waiting to be built shows neither.
  const { p, ic, meta } = li.bd;
  ic.innerHTML = BD_ICON[state];
  li.classList.toggle("bd-wait", state === "wait");
  li.classList.toggle("bd-now", state === "now");
  meta.textContent = note || (state !== "wait" && p.songs != null ? `${plural(p.songs, "song")} · ${lengthText(p.length != null ? p.length : p.minutes)}` : "");
}

function setTally(made, total, status, now) {
  // While building, at the top of the popup: how many playlists are made, what is happening, and Arc's icon for each (lit when made, breathing while under way), 8 to a row.
  const count = $("bdCount");
  count.textContent = "";
  count.classList.toggle("bd-count-one", total === 1);
  if (total === 1) count.textContent = "Building your playlist";   // "0 of 1 playlist" reads oddly
  else count.append(Object.assign(document.createElement("b"), { textContent: String(made) }), Object.assign(document.createElement("span"), { textContent: `of ${total} playlists` }));
  $("bdCountNote").textContent = status;
  const tiles = $("bdTiles");
  tiles.hidden = total < 2;   // one tile alone says nothing
  while (tiles.children.length < total) tiles.appendChild(Object.assign(document.createElement("span"), { className: "bd-arc" }));
  Array.from(tiles.children).forEach((tile, i) => { tile.className = "bd-arc" + (i < made ? " bd-on" : i === made && now ? " bd-now" : ""); });
  $("bdTally").hidden = false;
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

// Scrolls a box back to its top, easing in and out (longer for a longer way, at most about two thirds of a second). Resolves when it is there.
function glideToTop(box) {
  const from = box.scrollTop;
  const still = typeof matchMedia !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (from <= 0 || still || typeof requestAnimationFrame !== "function") { box.scrollTop = 0; return Promise.resolve(); }
  const duration = Math.min(650, 250 + from / 4);
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  return new Promise((resolve) => {
    const began = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - began) / duration);
      box.scrollTop = from * (1 - ease(t));
      if (t < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
}

function showFinale(made, minutes) {
  // After a build: the covers fanned out with a glow behind them and confetti, and how many playlists and how much music (counting up).
  // It plays once, about two seconds, then holds still; with reduced motion it simply appears.
  const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el = (tag, className, text) => Object.assign(document.createElement(tag), { className, textContent: text || "" });
  const box = el("div", "bd-finale");
  const fan = el("div", "bd-fan");
  fan.setAttribute("aria-hidden", "true");
  fan.appendChild(el("div", "bd-glow"));
  const cards = Math.min(made, 5), mid = (cards - 1) / 2;   // more than five look the same as five, and a wider fan leaves a phone's popup
  for (let i = 0; i < cards; i++) {
    const card = Object.assign(document.createElement("img"), { src: "playlist-cover.jpg", alt: "", className: "bd-card-img" });
    card.style.setProperty("--r", `${(i - mid) * 8}deg`);
    card.style.zIndex = String(10 - Math.abs(i - mid) * 2);   // the middle card on top
    fan.appendChild(card);
  }
  const hours = el("b", "", lengthText(still ? minutes : 0));
  const music = el("p", "bd-hours");
  music.append(hours, document.createTextNode(" of music"));
  box.append(fan, el("p", "bd-big", plural(made, "playlist")), music, el("p", "bd-lib", `${made === 1 ? "is" : "are"} in your Spotify library.`));
  setActionMessage("");
  $("actionMessage").appendChild(box);
  if (still || typeof requestAnimationFrame !== "function") return;
  throwConfetti(fan);
  // the music counts up over a second, slowing at the end; screen readers wait for the final number
  $("actionMessage").setAttribute("aria-busy", "true");
  const began = Date.now();
  const tick = () => {
    const t = Math.min(1, (Date.now() - began) / 1000);
    hours.textContent = lengthText(minutes * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(tick);
    else $("actionMessage").removeAttribute("aria-busy");
  };
  requestAnimationFrame(tick);
}

function groupRow(title, text) {
  // A recipe's heading when one build makes playlists for several.
  const li = document.createElement("li");
  li.className = "bd-group";
  li.appendChild(Object.assign(document.createElement("b"), { textContent: title }));
  if (text) li.appendChild(document.createTextNode(" " + text));
  return li;
}

function problemCard(title, items, text = "") {
  // The usual error box (problemBox in editor.js) with a title and, below it, sentences in a list (items are [bold part, rest]) or one sentence (text, names marked).
  const card = problemBox(title);
  card.classList.add("bd-card");
  const body = card.lastChild;
  body.firstChild.classList.add("bd-ct");
  if (text) putNamed(body.appendChild(Object.assign(document.createElement("p"), { className: "bd-small" })), text);
  if (items.length) {
    const ul = Object.assign(document.createElement("ul"), { className: "bd-problems" });
    for (const [bold, rest] of items) {
      const li = document.createElement("li");
      if (bold) putNamed(li.appendChild(document.createElement("b")), bold);
      if (rest) putNamed(li, (bold ? " " : "") + rest);
      ul.appendChild(li);
    }
    body.appendChild(ul);
  }
  return card;
}

function showPlanProblems(items, recipes) {
  // Nothing can be built: every reason at once, each with what to do about it.
  setOutput("");
  $("bdRead").hidden = true;
  $("output").appendChild(problemCard(`Nothing can be built from ${recipes > 1 ? "these recipes" : "this recipe"} yet`, items));
  $("output").hidden = false;
  setBuildSteps("plan", true);
}

// What went wrong while building, in the popup's words: a title, and what to do about it.
function buildProblem(message) {
  if (/Could not reach Spotify|Spotify did not answer/.test(message)) return { title: "Spotify stopped answering", advice: "Check your internet connection, then build again." };
  if (/rate limiting|request quota/.test(message)) return { title: "Spotify asked this app to wait", advice: message.replace(/^[^.]*\.\s*/, "") };
  if (/sign-in expired/.test(message)) return { title: "Your Spotify sign-in expired", advice: "Connect again, then build again." };
  if (/needs Premium/.test(message)) return { title: "Spotify Premium is needed", advice: message };
  if (/did not allow/.test(message)) return { title: "Spotify did not allow this", advice: message.replace(/^Spotify did not allow this \([^)]*\)\.\s*/, "") };
  const status = message.match(/^Spotify returned (\d+)/);   // the rest of that message names the request, which means nothing to a person
  return { title: "Something went wrong", advice: `${status ? `Spotify returned an error (${status[1]}).` : message.replace(/\.?$/, ".")} Try again later.`, unexpected: true };
}

function showBuildStop(err, done) {
  // done: { built, total, incomplete (a name or null), removing ("renaming" or "removing" if it stopped on earlier playlists) }, or null before building
  const message = cleanError(err);
  const problem = buildProblem(message);
  let what = "No playlists were built.";
  if (done && done.removing) what = `It stopped while ${done.removing} ${done.removing === "renaming" ? "playlists" : "earlier playlists"}, before anything new was built.`;
  else if (done && (done.built || done.incomplete)) what = `${done.built} of ${plural(done.total, "playlist")} ${done.built === 1 ? "was" : "were"} built` + (done.incomplete ? `, and ${named(done.incomplete)} is incomplete.` : ".");
  const again = done && (done.built || done.incomplete) ? " Building again replaces the ones made so far." : "";
  setActionMessage("");
  $("bdRead").hidden = true;
  const card = problemCard(problem.title, [], `${what} ${problem.advice}${again}`);
  $("actionMessage").appendChild(card);
  setBuildSteps(buildStep === "done" ? "build" : buildStep, true);
  if (problem.unexpected) offerReport("mainReportHint", message);
}

// ---------------------------------------------------------------- Spotify sign-in (PKCE, no server)
// Signing in takes a few seconds on a slow connection, in two stretches: opening Spotify, then finishing the sign-in when Spotify sends the person back. In both the
// Connect buttons say so and cannot be pressed again, since a second press would start a second sign-in over the first and spoil it.
let signingIn = new URLSearchParams(location.search).has("code");   // coming back from Spotify: on from the first moment
let signInNote = signingIn ? "Finishing the sign-in with Spotify. On a slow connection this can take a few seconds." : "";
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
function changeSpotifyLogin() { startLogin({ switchAccount: true }); }

async function startLogin(options) {
  if (signingIn) return;
  const switchAccount = !!(options && options.switchAccount === true);
  const clientId = $("clientId").value.trim();
  if (!clientId) {
    setLoginMessage("Paste your Client ID first.");
    return;
  }
  localStorage.setItem("clientId", clientId);
  setSigningIn(true, "Opening Spotify. On a slow connection this can take a few seconds.");
  clearReportHints("loginReportHint");
  logStep("sign-in started");
  let go;
  try { go = await openSpotifySignIn(clientId, { switchAccount }); } catch (err) { setSigningIn(false); setLoginMessage("This browser could not start the sign-in: " + String(err && err.message || err)); return; }
  // if Spotify has not opened after this long, say so, so the buttons are not left waiting for good
  signInTimer = setTimeout(() => {
    if (!signingIn) return;
    setSigningIn(false);
    signInNote = "Spotify did not open. Check your connection, then try again.";
    setLoginMessage(signInNote);
    updateButtons();
  }, 30000);
  go();
}

async function finishLoginIfReturning() {
  const result = await finishSpotifySignIn();
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

// ---------------------------------------------------------------- talking to Spotify (shared-spotify.js), and what this page does and says along the way
let addChunk = ADD_CHUNK;   // lowered for the visit if Spotify refuses that many
Object.assign(spotifyHooks, {
  scopes: SCOPES,
  requiredScopes: REQUIRED_SCOPES,
  log: logStep,
  oldSignIn: () => { needsReconnect = true; },
  expiredText: () => `Your Spotify sign-in expired. ${actWord(true)} Connect again.`,
  signInExpired: (message) => { if (connection === "ready") setConnection("problem", message, "reconnect"); },   // from here on nothing that needs Spotify is offered
  refusedText: (what) => `Spotify did not allow this (${what}). Sign in again with Change Spotify login in More options, and approve every permission it asks for.`,
  pauseStarted: (first) => {
    updateButtons();
    // when a wait starts, the popup explains; not over the build popup, which says it already
    if (first && $("createOverlay").hidden && typeof showPauseDialog === "function") showPauseDialog();
  },
  pauseChanged: (left) => { if (typeof refreshPauseViews === "function") refreshPauseViews(left); },   // the line under the bar and the popup
  pauseEnded: () => {   // connect again, and save what waited
    updateButtons();
    if (token && connection !== "ready" && connection !== "connecting") connectToSpotify().then(() => { if (connection === "ready") scheduleSpotifySave(500); });
    else if (connection === "ready") scheduleSpotifySave(500);
  },
});

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

// Once a day per browser, how long since this browser first connected, so returning people show apart from new ones.
// Only the span goes out; the dates stay in localStorage.
function countActiveDay() {
  try {
    const now = Date.now(), today = new Date().toDateString();
    if (localStorage.getItem("countedDay") === today) return;
    const since = Number(localStorage.getItem("countedSince")) || now;
    const days = (now - since) / 86400000;
    const span = days < 7 ? "first-week" : days < 14 ? "second-week" : days < 28 ? "weeks-3-4" : days < 90 ? "months-2-3" : "after-3-months";
    if (countEvent("active-" + span)) {
      localStorage.setItem("countedDay", today);
      if (!localStorage.getItem("countedSince")) localStorage.setItem("countedSince", String(since));
    }
  } catch (err) { /* counting must never get in the way */ }
}

// The tutorial: started each time it is opened, finished at most once for each opening (Watch again does not count twice).
let tutorialFinishCounted = true;
function countTutorialStart(where) { tutorialFinishCounted = false; countEvent("tutorial-started", where); }
function countTutorialEnd() { if (!tutorialFinishCounted) { tutorialFinishCounted = true; countEvent("tutorial-finished"); } }

function problemKind(message) {
  if (/request quota/.test(message)) return "quota";
  if (/rate limiting/.test(message)) return "rate-limit";
  if (/Could not reach Spotify|Spotify did not answer/.test(message)) return "network";
  if (/sign-in expired|did not allow/.test(message)) return "sign-in";
  if (/needs Premium/.test(message)) return "premium";
  return "other";
}

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
    limits: readRecord(LIMITS_KEY, []), callsPerMinute: readRecord(CALLS_KEY, {}),
  });
}

async function copyLimitRecord() {
  try { await navigator.clipboard.writeText(limitRecordText()); }
  catch (err) { showNotices([{ text: "The Spotify request log could not be copied.", transient: true }]); return; }
  try { localStorage.setItem("spotifyRecordCopiedAt", String(Date.now())); } catch (err) { /* private browsing */ }
  if (typeof clearHeldNotice === "function") clearHeldNotice();
  showNotices([{ text: "Spotify request log copied. Paste it into the chat with Claude.", transient: true }]);
}

// For the owner: once connected, a held message offers the record when Spotify has refused since the last copy, or a week has passed with requests sent.
async function offerLimitRecord() {
  if (!checkOwner()) return;
  if (typeof renderAppMenu === "function") renderAppMenu();
  const copiedAt = Number(localStorage.getItem("spotifyRecordCopiedAt")) || 0;
  const refusals = readRecord(LIMITS_KEY, []).filter((e) => !e.note && e.at > copiedAt).length;
  const weekOld = Date.now() - copiedAt > 7 * 86400000 && Object.keys(readRecord(CALLS_KEY, {})).some((m) => Number(m) * 60000 > copiedAt);
  if (!refusals && !weekOld) return;
  if (typeof notices !== "undefined" && notices.held) return;   // a held message (a newer version) comes first
  const text = refusals ? `Spotify refused requests ${refusals === 1 ? "once" : refusals + " times"} since the last copy of the request log.` : "A week of Spotify request counts is ready to copy.";
  showNotices([{ text, icon: "copy", hold: true, actions: [{ label: "Copy", run: () => copyLimitRecord() }] }]);
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
function forgetOtherAccount(id) {
  try {
    const was = localStorage.getItem("spotifyAccount");
    if (was && was !== id) for (const key of ["spotifySynced", "spotifyPendingDeletes", "spotifySavedAt"]) localStorage.removeItem(key);
    localStorage.setItem("spotifyAccount", id);
  } catch (err) { /* private browsing */ }
}

async function loadMyPlaylists() {
  me = await spotify("/me");
  forgetOtherAccount(me.id);
  const raw = await pagedItems("/me/playlists?limit=50");
  playlists = raw.filter(Boolean).map((p) => ({
    id: p.id,
    name: p.name,
    owner: p.owner && p.owner.id,
    collaborative: !!p.collaborative,
    image: Array.isArray(p.images) && p.images.length ? p.images[p.images.length - 1].url : null,   // Spotify lists the largest first
    cover: Array.isArray(p.images) && p.images.length ? p.images[0].url : null,   // the largest, for Music sharing
    count: p.tracks && typeof p.tracks.total === "number" ? p.tracks.total : (p.items && typeof p.items.total === "number" ? p.items.total : null),
    description: typeof p.description === "string" ? p.description : null,
    snapshot: typeof p.snapshot_id === "string" && p.snapshot_id ? p.snapshot_id : null,   // changes whenever the playlist does
  }));
  for (const p of playlists) { p.madeByApp = madeByAppText(p.description); p.participant = participantOf(p.description); }
  // A format's backup in Spotify is known by what its description decodes to, whatever the playlist is called.
  for (const p of playlists) { const u = unpackFormat(p.description); p.save = u.kind === "none" ? null : u; p.isSave = !!p.save; }
  keepPlaylists();
  // The count shown in Step 1 always matches the list, including after playlists are created or removed.
  playlistsLoadedAt = Date.now();
  $("connectedMessage").textContent = `Connected as ${me.display_name || me.id}. ${plural(playlists.length, "playlist")} found.`;
  if (typeof editorPlaylistsChanged === "function") editorPlaylistsChanged();
}

async function loadTracks(id) {
  if (trackCache.has(id)) return trackCache.get(id);
  const info = playlists.find((p) => p.id === id);
  const snapshot = info && info.snapshot ? info.snapshot : null;
  const saved = await savedSongs(id);
  // Saved songs are used when Spotify reports no snapshot to compare (the refresh control covers that case), or when the snapshot is the same.
  if (saved && saved.v === SONGS_VERSION && Array.isArray(saved.tracks) && (!snapshot || saved.snapshot === snapshot)) {
    trackCache.set(id, saved.tracks);
    return saved.tracks;
  }
  const tracks = songsFromEntries(await pagedItems(`/playlists/${id}/items?limit=50`));
  trackCache.set(id, tracks);
  await saveSongs({ id, snapshot, tracks, v: SONGS_VERSION, savedAt: Date.now() });
  return tracks;
}

// A playlist's items from Spotify, as the songs the app keeps (also used by Music sharing's slow reading, sharing.js)
function songsFromEntries(entries) {
  const tracks = [];
  for (const entry of entries) {
    const t = entry && (entry.item || entry.track);  // "item" is the 2026 field name
    if (!t || t.is_local || t.type !== "track" || !t.uri) continue;
    const artist = t.artists && t.artists[0] ? t.artists[0].name : "";
    const isrc = t.external_ids && typeof t.external_ids.isrc === "string" && t.external_ids.isrc ? t.external_ids.isrc.toUpperCase() : "";
    const song = { uri: t.uri, ms: t.duration_ms, label: `${artist} - ${t.name}` };
    if (isrc) song.key = "isrc:" + isrc;   // one recording, whichever release it came from (engine.py's song_id)
    if (t.album && t.album.name) song.album = t.album.name + (t.album.release_date ? `, ${String(t.album.release_date).slice(0, 4)}` : "");
    tracks.push(song);
  }
  return tracks;
}

async function removePlaylists(ids) {
  // Spotify's 2026 API removes playlists from a library with one generic endpoint.
  for (let i = 0; i < ids.length; i += REMOVE_CHUNK) {
    const uris = ids.slice(i, i + REMOVE_CHUNK).map((id) => "spotify:playlist:" + id).join(",");
    await spotifyRequest("DELETE", "/me/library", { params: { uris } });
  }
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
      const get = (name) => pyodide.globals.get(name);
      py = {
        formatKeys: get("format_keys"),
        neededSources: get("needed_sources"),
        sourceNeeds: get("source_needs"),
        matchPlaylists: get("match_playlists"),
        planText: get("plan_text"),
        buildPlaylists: get("build_playlists"),
        existingMatches: get("existing_matches"),
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
function fillFormatDropdown(select, formats, blankFirst) {
  const previous = select.value;
  select.innerHTML = "";
  if (blankFirst) select.add(new Option("", ""));   // nothing chosen yet: the person has to pick before Remove works
  for (const f of formats) select.add(new Option(f.title, f.id));
  select.add(new Option("All recipes", ALL_FORMATS));
  if (formats.some((f) => f.id === previous) || previous === ALL_FORMATS) select.value = previous;
  else select.value = "";
}

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
    fillRemoveKey();
  } catch (err) {
    currentFormats = [];
    recordError(cleanError(err));
    fillRemoveKey();
    formatsValid = false;
    invalidatePlan();
  }
  updateButtons();
}

// A cap on how many playlists each recipe makes, for tests only (the build popup's chooser is how people pick fewer)
let playlistCap;
function setPlaylistLimit(n) { playlistCap = n > 0 ? n : undefined; invalidatePlan(); }
function playlistLimit() { return playlistCap; }

let buildScope = null;   // the formats a build in progress is for, when it is not just the one being edited
let buildFor = "";       // a participant's code, when the build is one playlist for them (developer mode for now; Ron, 2026-11-12)

// Silent tracks: the same as engine.py's SILENCE_TRACKS. They are in every playlist and are not songs anyone heard.
const SILENCE_URIS = new Set(["spotify:track:5kiJ9x6eX37H5J9lyyXkua", "spotify:track:4iOpD4OvwCi6ndxpNYk4HG", "spotify:track:5yM42dAylwB17DomSHGcXM", "spotify:track:7depNAqAh1r9unkIRzibID", "spotify:track:3mkOlbSv5RYadx0JsjTrKq"]);

// The playlists Arc built for each participant, from the playlist list already read: [{ code, playlists (newest first), last }], the most recent first
function participantList() {
  const by = new Map();
  for (const p of playlists || []) {
    if (!p.participant || (me && p.owner !== me.id)) continue;
    if (!by.has(p.participant)) by.set(p.participant, []);
    by.get(p.participant).push(p);
  }
  const people = [...by.entries()].map(([code, list]) => {
    list.sort((a, b) => builtAtOf(b.description) - builtAtOf(a.description));
    return { code, playlists: list, last: builtAtOf(list[0].description) };
  });
  return people.sort((a, b) => b.last - a.last || a.code.localeCompare(b.code));
}
// What a participant has heard: every song in the playlists built for them, by the song's id as engine.py knows it (song_id), with when the playlist was built.
// Reads their playlists' songs (kept in this browser after the first time). { songs: {id: time}, count }
async function heardBy(code) {
  const songs = {};
  for (const p of (playlists || []).filter((q) => q.participant === code && (!me || q.owner === me.id))) {
    const at = builtAtOf(p.description) || 1;
    for (const t of await loadTracks(p.id)) {
      if (SILENCE_URIS.has(t.uri)) continue;
      const id = t.key || t.uri;
      songs[id] = Math.max(songs[id] || 0, at);
    }
  }
  return { songs, count: Object.keys(songs).length };
}
// A playlist for a participant: Deep journey · MC · 14 Nov, then (2), (3) if that is taken
function participantPlaylistName(title, code, when = new Date()) {
  const base = `${cleanTitle(title).trim() || "Untitled"} \u00b7 ${code} \u00b7 ${when.getDate()} ${MONTHS[when.getMonth()]}`;
  const taken = new Set((playlists || []).map((p) => normName(p.name)));
  let name = base, n = 2;
  while (taken.has(normName(name))) name = `${base} (${n++})`;
  return name;
}

function activeKey() {
  return typeof editor !== "undefined" && editor.activeId && currentFormats.some((f) => f.id === editor.activeId) ? editor.activeId : null;
}

function selectedKeys() {
  // The format being edited, unless the build is for all of them.
  if (buildScope) return buildScope;
  const key = activeKey();
  return key ? [key] : [];
}

function removeKeys() {
  const choice = $("removeKey").value;
  if (choice.startsWith(GONE_PREFIX)) return [];
  return choice === ALL_FORMATS ? currentFormats.map((f) => f.id) : [choice];
}

// The person's playlists whose names a recipe makes, as engine.py's existing_matches finds them, without the ones built for a participant: those are never replaced,
// renamed or removed by building or by Remove built playlists.
function recipeMatches(formatsText, keys) {
  const ours = new Set((playlists || []).filter((p) => p.participant).map((p) => p.id));
  return JSON.parse(py.existingMatches(formatsText, JSON.stringify(keys), JSON.stringify(playlists), me.id)).filter((p) => !ours.has(p.id));
}

// Playlists Arc built for recipes that no longer exist (deleted or renamed; Ron, 2026-11-10, mockups/remove-gone.html): Arc's own (its marker in the description),
// the person's, not a recipe save, and matching no recipe's names now. Grouped by the name without its number or (version x), sorted by that name.
// Empty until Python, the sign-in and the playlist list are there. Remove built playlists lists each group as <name> (no recipe).
const GONE_PREFIX = "gone:";
function goneStem(name) { return String(name).replace(/\s*\(version [a-z]+\)$/i, "").replace(/\s+\d+$/, "").trim() || String(name); }
function goneGroups() {
  if (!py || !me || !playlists) return [];
  let current = new Set();
  try {
    if (currentFormats.length) current = new Set(recipeMatches($("formats").value, currentFormats.map((f) => f.id)).map((p) => p.id));
  } catch (err) { return []; }
  const groups = new Map();
  for (const p of playlists) {
    if (!p.madeByApp || p.isSave || p.participant || p.owner !== me.id || current.has(p.id)) continue;
    const stem = goneStem(p.name);
    if (!groups.has(stem)) groups.set(stem, []);
    groups.get(stem).push({ id: p.id, name: p.name });
  }
  return [...groups.entries()].map(([stem, list]) => ({ stem, playlists: list })).sort((a, b) => a.stem.localeCompare(b.stem));
}
// The Built from list: the recipes, All recipes, then under No longer a recipe each gone one. What was chosen stays chosen while it is still there.
function fillRemoveKey() {
  const select = $("removeKey");
  if (!select) return;
  const previous = select.value;
  fillFormatDropdown(select, currentFormats, true);
  if (!currentFormats.length) select.remove(select.options.length - 1);   // no All recipes with no recipes
  const gone = goneGroups();
  if (gone.length) {
    const group = document.createElement("optgroup");
    group.label = "No longer a recipe";
    for (const g of gone) group.appendChild(new Option(`${g.stem} (no recipe)`, GONE_PREFIX + g.stem));
    select.appendChild(group);
  }
  if ([...select.options].some((o) => o.value === previous)) select.value = previous;
}
// What the chosen entry stands for now: Arc's playlists of the chosen recipes, and those of gone recipes (all of them for All recipes, one group for a gone one)
function removeTargets() {
  const key = $("removeKey").value;
  const made = new Set((playlists || []).filter((p) => p.madeByApp).map((p) => p.id));
  const gone = goneGroups();
  if (key.startsWith(GONE_PREFIX)) {
    const g = gone.find((x) => x.stem === key.slice(GONE_PREFIX.length));
    return { current: [], others: [], gone: g ? g.playlists : [] };
  }
  const keys = removeKeys();
  const existing = keys.length ? recipeMatches($("formats").value, keys) : [];
  return { current: existing.filter((p) => made.has(p.id)), others: existing.filter((p) => !made.has(p.id)), gone: key === ALL_FORMATS ? gone.flatMap((g) => g.playlists) : [] };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---------------------------------------------------------------- actions: create, remove
async function gatherInputs(opts = {}) {
  // Works out which source playlists the chosen formats need and reads their songs. Returns null after showing why it cannot; quiet (a participant's build, outside
  // the build popup) shows nothing and returns { problems } instead.
  const formatsText = $("formats").value;
  const wanted = opts.keys || selectedKeys();
  const many = wanted.length > 1;
  const problems = [];
  for (const b of blankSegmentReport(wanted)) {
    problems.push([b.count === 1 ? `A segment in ${named(b.title)} has no playlist yet.` : `${b.count} segments in ${named(b.title)} have no playlist yet.`, "Choose one in the recipe."]);
  }
  const plans = [];
  const failedNotes = [];
  for (const key of wanted) {
    try {
      plans.push({ key, names: JSON.parse(py.neededSources(formatsText, key)) });
    } catch (err) {
      failedNotes.push([`${named(formatLabel(key))} could not be planned.`, cleanError(err)]);
    }
  }
  const names = [...new Set(plans.flatMap((p) => p.names))].filter((n) => String(n).trim());
  const match = JSON.parse(py.matchPlaylists(JSON.stringify(names), JSON.stringify(playlists), me.id));
  for (const name of match.missing || []) problems.push([`${named(name)} is not in your Spotify playlists.`, "Choose another playlist in the recipe, or check its name in Spotify."]);
  for (const name of match.notMine || []) problems.push([`${named(name)} is not yours.`, "Spotify only lets this app read playlists you own. Copy its songs into a playlist of your own and use that."]);
  // Each source playlist in the reading list: waiting, then a spinner while it is read, then ticked with its songs.
  const tracks = {};
  const reading = names.filter((name) => match.found[name]).map((name) => {
    if (opts.quiet) return { bd: { p: { name } } };
    const row = playlistRow({ name }, "wait");
    $("bdReadList").appendChild(row);
    return row;
  });
  for (const row of reading) {
    const name = row.bd.p.name;
    if (!opts.quiet) setRowState(row, "now");
    tracks[name] = await loadTracks(match.found[name]);
    if (!opts.quiet) setRowState(row, "done", plural(tracks[name].length, "song"));
  }
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
    if (opts.quiet) return { problems: problems.concat(failedNotes) };
    showPlanProblems(problems.concat(failedNotes), wanted.length);
    return null;
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

async function planSelected(startedWith, opts = {}) {
  // Works out the playlists for the chosen formats. Returns the plan, or null after saying why there isn't one. With opts (keys, forWhom, quiet), for a participant's
  // build outside the build popup: shows nothing and returns { problems } when there is no playlist.
  const inputs = await gatherInputs(opts);
  if (!inputs) return null;
  if (inputs.problems) return inputs;
  if (!opts.quiet) setBuildSteps("plan");
  // Earlier playlists with names this plan uses: the ones this app made get replaced (or renamed, if the person keeps them), and the person's own get renamed
  // to "… (version a)" so the new playlists can have their names.
  const forWhom = opts.forWhom || buildFor;
  const heard = forWhom ? (await heardBy(forWhom)).songs : null;
  const matching = forWhom ? [] : recipeMatches(inputs.formatsText, inputs.keys);   // a participant's playlist replaces nothing
  const madeByApp = new Set(playlists.filter((p) => p.madeByApp).map((p) => p.id));
  const marked = matching.filter((p) => madeByApp.has(p.id));
  const built = [];
  const problems = inputs.failedNotes.slice();
  for (const key of inputs.keys) {
    try {
      const plan = JSON.parse(heard ? py.buildPlaylists(inputs.formatsText, key, JSON.stringify(inputs.tracks), 1, "[]", JSON.stringify(heard))
        : py.buildPlaylists(inputs.formatsText, key, JSON.stringify(inputs.tracks), playlistLimit(), "[]"));
      if (!Array.isArray(plan.sources)) throw new Error("engine.py is out of date. Reload the page.");
      if (heard && plan.playlists.length) {
        // one playlist, named for the participant, and how many of its songs they have heard
        const title = (currentFormats.find((f) => f.id === key) || {}).title || "";
        const p = plan.playlists[0];
        p.name = participantPlaylistName(title, forWhom);
        const idOf = new Map();
        for (const list of Object.values(inputs.tracks)) for (const t of list) idOf.set(t.uri, t.key || t.uri);
        let fresh = 0, again = 0, latest = 0;
        for (const uri of p.uris) {
          if (SILENCE_URIS.has(uri)) continue;
          const at = heard[idOf.get(uri) || uri];
          if (at) { again += 1; latest = Math.max(latest, at); } else fresh += 1;
        }
        plan.fresh = { fresh, again, latest };
      }
      if (plan.playlists.length) built.push(plan);
      else problems.push(...shortProblems(plan, inputs.many));
    } catch (err) {
      recordError(cleanError(err));
      problems.push([`${named(formatLabel(key))} could not be planned.`, cleanError(err)]);
    }
  }
  if (!opts.quiet && planSignature() !== startedWith) {   // the user edited something while this was planning
    setOutput("");
    closeCreateDialog();
    return null;
  }
  const total = built.reduce((n, plan) => n + plan.playlists.length, 0);
  logStep(total ? `plan: ${plural(total, "playlist")} planned` : "plan: nothing can be created");
  if (!total) {
    if (opts.quiet) return { problems };
    showPlanProblems(problems, selectedKeys().length);
    return null;
  }
  if (!opts.quiet) setOutput("");
  const newNames = new Set(built.flatMap((b) => b.playlists.map((p) => normName(p.name))));
  const others = matching.filter((p) => !madeByApp.has(p.id) && newNames.has(normName(p.name)));   // only the ones in the way
  const fresh = built.length && built[0].fresh ? built[0].fresh : null;
  return { formatsText: inputs.formatsText, keys: inputs.keys, built, total, ours: marked, marked, others, participant: forWhom, fresh,
    suspects: findSuspects(inputs.tracks, inputs.ids), repeats: findRepeats(inputs.tracks), problems, many: built.length > 1 || problems.length > 0 };
}

// Songs that may be one song in more than one recording, among the playlists a build draws from. The app knows a song by its ISRC (one recording, whatever release
// it is on), or its Spotify ID when there is none, so a live and a studio recording are two songs to it, and both could end up in a playlist. It does not guess which
// songs are the same: it points out the ones whose artist and title match, once case, punctuation and a remaster note are set aside, and leaves the choice to the person.
function songKey(label) {
  return String(label || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ")
    .replace(/\s*[-–]\s*(?:\d{4}\s+)?(?:digital(?:ly)?\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?\s*$/, "")
    .replace(/\s*[\(\[]\s*(?:\d{4}\s+)?(?:digital(?:ly)?\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?\s*[\)\]]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}
const songId = (t) => t.key || t.uri;   // as engine.py's song_id

function findSuspects(tracksByName, ids = {}) {
  // [{ label, versions: [{ album, lists: [{ name, id, uri }] }] }], one for each title and artist found in more than one recording
  const byKey = new Map();
  for (const [list, tracks] of Object.entries(tracksByName || {})) {
    for (const t of tracks) {
      const key = songKey(t.label);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, new Map());
      const versions = byKey.get(key);
      if (!versions.has(songId(t))) versions.set(songId(t), { label: t.label, album: t.album || "", lists: [] });
      const v = versions.get(songId(t));
      if (!v.lists.some((l) => l.name === list)) v.lists.push({ name: list, id: ids[list] || null, uri: t.uri });
    }
  }
  const out = [];
  for (const versions of byKey.values()) {
    if (versions.size < 2) continue;
    const all = Array.from(versions.values());
    out.push({ label: all[0].label, versions: all.map((v) => ({ album: v.album, lists: v.lists })) });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function findRepeats(tracksByName) {
  // Source playlists that list a song more than once: [{ name, songs: [{ label, times }] }]. The engine uses each once either way. The app only says so: changing
  // the person's playlist would mean taking every copy out and putting one back (Spotify removes a song by its ID), and a failure in between would lose the song.
  const out = [];
  for (const [name, tracks] of Object.entries(tracksByName || {})) {
    const count = new Map();
    for (const t of tracks) count.set(t.uri, { label: t.label, times: ((count.get(t.uri) || {}).times || 0) + 1 });
    const songs = Array.from(count.values()).filter((x) => x.times > 1);
    if (songs.length) out.push({ name, songs });
  }
  return out;
}

function whyLength(minutes) {
  // A length for the Why table, its units in grey: "8 hr 56 min" on a wide screen, "8 h 56 m" on a phone (CSS shows one of the two).
  const out = document.createDocumentFragment();
  for (const part of lengthText(minutes).split(/(\d+)/)) {
    if (!part) continue;
    if (/\d/.test(part)) { out.append(part); continue; }
    const unit = part.trim(), unitBox = Object.assign(document.createElement("span"), { className: "bd-unit" });
    unitBox.append(part.startsWith(" ") ? " " : "", Object.assign(document.createElement("span"), { className: "bd-wide", textContent: unit === "h" ? "hr" : "min" }),
      Object.assign(document.createElement("span"), { className: "bd-narrow", textContent: unit === "h" ? "h" : "m" }), part.endsWith(" ") ? " " : "");
    out.append(unitBox);
  }
  return out;
}

function fillWhyTable(plan) {
  // "Why 4?": for each source playlist, what one playlist uses of it, how much it has available, and how many playlists that is enough for.
  const box = $("planText");
  box.textContent = "";
  for (const b of plan.built) {
    if (plan.built.length > 1) box.appendChild(Object.assign(document.createElement("p"), { className: "bd-tablehead", textContent: `${formatLabel(b.key)}: ${plural(b.playlists.length, "playlist")}` }));
    const lowest = Math.min(...b.sources.map((r) => (r.enough == null ? Infinity : r.enough)));
    if (!b.ranOut) {
      // The cap set the number, not the songs: say so first, and how many the songs would allow. No row is marked, since none of them is the reason.
      const more = lowest !== Infinity && lowest > b.playlists.length ? ` Without it, the songs are enough for ${plural(lowest, "playlist")}.` : "";
      box.appendChild(Object.assign(document.createElement("p"), { className: "bd-note bd-capnote", textContent: `Capped at ${b.playlists.length} by “Most playlists per recipe” in More options.${more}` }));
    }
    const table = document.createElement("table");
    table.innerHTML = "<thead><tr><th>Each playlist uses</th><th>Available</th><th>Enough for</th></tr></thead>";
    const body = document.createElement("tbody");
    // every source that sets the number is marked: the one that ran out, and any other with the same count
    const ranOut = b.ranOut && b.sources.find((r) => r.name === b.ranOut.name);
    for (const r of b.sources) {
      const tr = document.createElement("tr");
      if (ranOut && (r === ranOut || (r.enough != null && r.enough === ranOut.enough))) tr.className = "bd-limit";
      const uses = Object.assign(document.createElement("td"), { title: r.name });   // a long name ends in "…"; the full name shows on hover
      uses.append(whyLength(r.per), ` of ${r.name}`);
      const length = document.createElement("td");
      length.append(whyLength(r.has));
      tr.append(uses, length, Object.assign(document.createElement("td"), { textContent: r.enough == null ? "" : plural(r.enough, "playlist") }));
      body.appendChild(tr);
    }
    table.appendChild(body);
    box.appendChild(table);
  }
}

function infoBox(icon, title, ...more) {
  // One of the rows above the Build button: an icon, a short title and a chevron. A tap opens what is behind it (elements or sentences) in place.
  const box = Object.assign(document.createElement("div"), { className: "bd-info" });
  const row = Object.assign(document.createElement("button"), { type: "button", className: "bd-info-row" });
  row.setAttribute("aria-expanded", "false");
  const text = document.createElement("span");
  putNamed(text, title);
  row.append(Object.assign(document.createElement("span"), { className: "bd-info-ic", innerHTML: BD_ICON[icon] }), text,
    Object.assign(document.createElement("span"), { className: "bd-chev", innerHTML: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>' }));
  const body = Object.assign(document.createElement("div"), { className: "bd-info-more", hidden: true });
  for (const line of more) {
    if (typeof line === "string") putNamed(body.appendChild(Object.assign(document.createElement("p"), { className: "bd-info-lead" })), line);
    else body.appendChild(line);
  }
  row.onclick = () => { revealSmoothly(body, body.hidden); row.setAttribute("aria-expanded", String(!body.hidden)); };
  box.append(row, body);
  $("bdInfo").appendChild(box);
  return box;
}

function songLink(where) {
  // A source playlist's name, opening it in Spotify at the song
  const name = Object.assign(document.createElement("i"), { textContent: where.name });
  if (!where.id) return name;
  const link = Object.assign(document.createElement("a"), { href: `https://open.spotify.com/playlist/${where.id}?highlight=${encodeURIComponent(where.uri)}`, target: "_blank", rel: "noopener noreferrer" });
  link.appendChild(name);
  return link;
}

function fillInfoBoxes(plan, keep) {
  // What else the build does or found, a row each with the rest behind it: earlier playlists replaced, the person's own playlists renamed out of the way,
  // and notes on songs (listed more than once, in more than one of these playlists, in more than one recording) gathered in one row.
  $("bdInfo").textContent = "";
  if (plan.marked.length) {
    // Replacing is the usual thing, so the choice to keep them waits behind the row.
    const one = plan.marked.length === 1;
    const label = document.createElement("label");
    const words = document.createElement("span");   // one piece of text beside the checkbox, so the label's gap does not split it
    putNamed(words, `Keep ${one ? "it" : "them"}, renamed to ${named(`\u2026 (version ${nextVersionLetter(plan.marked)})`)}`);
    label.append(keep, words);
    const why = Object.assign(document.createElement("p"), { textContent: `Replacing ${one ? "it" : "them"} is the usual choice, but you can keep the old ${one ? "one" : "ones"} if you like.` });
    infoBox("replace", one ? `Replaces ${named(plan.marked[0].name)}` : `Replaces ${plural(plan.marked.length, "earlier playlist")}`, why, label);
  }
  if (plan.others.length) {
    const letter = nextVersionLetter(plan.others);
    const list = document.createElement("ul");
    for (const p of plan.others) {
      const li = document.createElement("li");
      li.append(Object.assign(document.createElement("span"), { className: "bd-nowrap", textContent: p.name }), " → ",
        Object.assign(document.createElement("span"), { className: "bd-nowrap", textContent: `${p.name} (version ${letter})` }));
      list.appendChild(li);
    }
    const one = plan.others.length === 1;
    infoBox("rename", one ? "Renames one of your playlists" : `Renames ${plan.others.length} of your playlists`,
      one ? "It has a name a new playlist uses, so it gets a new one:" : "They have names the new playlists use, so they get new ones:", list);
  }
  const notes = [];   // [title when it is the only note, sentence, details...]
  const repeats = plan.repeats || [];
  if (repeats.length) {
    const list = document.createElement("ul");
    for (const r of repeats) {
      for (const x of r.songs.slice(0, 10)) putNamed(list.appendChild(document.createElement("li")), `${x.label}: ${x.times} times${repeats.length > 1 ? ` in ${named(r.name)}` : ""}`);
      if (r.songs.length > 10) putNamed(list.appendChild(document.createElement("li")), `and ${r.songs.length - 10} more${repeats.length > 1 ? ` in ${named(r.name)}` : ""}`);
    }
    notes.push(["Songs listed more than once", repeats.length === 1
      ? `${named(repeats[0].name)} lists ${plural(repeats[0].songs.length, "song")} more than once. Each is used once.`
      : `${repeats.length} playlists list songs more than once. Each song is used once.`, list]);
  }
  const shared = Math.max(0, ...plan.built.map((b) => b.shared || 0));
  if (shared) notes.push(["Songs in more than one playlist", `${plural(shared, "song")} ${shared === 1 ? "is" : "are"} in more than one of these playlists. Each is used once.`]);
  const suspects = plan.suspects || [];
  if (suspects.length) {
    const list = document.createElement("ul");
    for (const x of suspects.slice(0, 10)) {
      const li = Object.assign(document.createElement("li"), { textContent: `${x.label}: ` });
      const places = x.versions.flatMap((v) => v.lists.map((l) => ({ ...l, album: v.album })));
      places.forEach((l, i) => {
        if (i) li.append(", ");
        li.append("in ", songLink(l));
        if (l.album) li.append(` (${l.album})`);
      });
      list.appendChild(li);
    }
    if (suspects.length > 10) list.appendChild(Object.assign(document.createElement("li"), { textContent: `and ${suspects.length - 10} more` }));
    notes.push(["Songs in more than one recording", `${plural(suspects.length, "song")} ${suspects.length === 1 ? "has" : "have"} more than one recording. Each recording (for example live and studio) counts as its own song, so more than one can be used.`, list]);
  }
  if (notes.length) infoBox("music", notes.length === 1 ? notes[0][0] : `${notes.length} notes on songs`, ...notes.flatMap(([, line, ...more]) => [line, ...more]));
}

function askToCreate(plan) {
  // Shows what the plan found and waits: "create", "cancel", or "stale" if something was edited meanwhile. With "create", plan.keep says whether to keep the earlier playlists.
  return new Promise((resolve) => {
    setOutput("");
    const summary = $("confirmText");
    const keep = Object.assign(document.createElement("input"), { type: "checkbox", id: "confirmKeepEarlier" });
    const whyLabel = plan.many ? "Why these numbers?" : `Why ${plan.total}?`;
    const why = Object.assign(document.createElement("button"), { type: "button", className: "linklike", id: "planToggle", textContent: whyLabel });
    // One recipe that can make more than one: "How many playlists?", and Arc's icon per playlist with its number above, 8 to a row. None is chosen at first,
    // so Build does nothing until one is (decided by Ron, 2026-11-04; the popup was simplified by Ron, 2026-11-10, mockups/build-a-states.html).
    const pick = !plan.many && plan.total > 1 && !plan.participant;
    let chosen = pick ? 0 : plan.total;
    // the person's own playlists in the way: only the ones whose names the chosen playlists use
    const inWayFor = (n) => { const names = new Set(plan.built[0].playlists.slice(0, n).map((p) => normName(p.name))); return plan.others.filter((p) => names.has(normName(p.name))); };
    let shownOthers = pick ? inWayFor(0).length : plan.others.length;
    $("bdRead").hidden = true;
    $("bdPick").hidden = !pick;
    $("bdPickHead").hidden = false;
    $("bdPickHead").textContent = pick ? "How many playlists?" : `Ready to build ${plural(plan.total, "playlist")}`;
    summary.textContent = "";
    if (pick) {
      summary.append("Up to ", Object.assign(document.createElement("b"), { textContent: String(plan.total) }), ", with no song repeated across them. ", why);
      const tiles = $("bdPickTiles");
      tiles.textContent = "";
      const show = () => {
        Array.from(tiles.children).forEach((t, i) => {
          t.classList.toggle("bd-on", i < chosen);
          t.setAttribute("aria-checked", String(i + 1 === chosen));
          t.tabIndex = i + 1 === (chosen || 1) ? 0 : -1;   // one stop in the tab order; the arrows move between them
        });
        $("confirmYes").disabled = !chosen;
        setLabel($("confirmYes"), chosen ? `Build ${plural(chosen, "playlist")}` : "Build playlists");
        const inWay = inWayFor(chosen);
        if (inWay.length !== shownOthers) { shownOthers = inWay.length; fillInfoBoxes({ ...plan, others: inWay }, keep); }
      };
      const choose = (n, focus) => { chosen = n; show(); if (focus) tiles.children[n - 1].focus(); };
      for (let n = 1; n <= plan.total; n++) {
        const opt = Object.assign(document.createElement("button"), { type: "button", className: "bd-pick-opt" });
        opt.setAttribute("role", "radio");
        opt.setAttribute("aria-label", plural(n, "playlist"));
        opt.append(Object.assign(document.createElement("span"), { textContent: String(n) }), Object.assign(document.createElement("span"), { className: "bd-arc" }));
        opt.onclick = () => choose(n);
        opt.onkeydown = (event) => {
          const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 8, ArrowUp: -8 }[event.key];   // up and down move a row of 8
          if (!step) return;
          event.preventDefault();
          choose(Math.max(1, Math.min(plan.total, n + step)), true);
        };
        tiles.appendChild(opt);
      }
      show();
    } else if (plan.participant) {
      // one playlist for a participant: how many of its songs are new to them (Ron, 2026-11-12, mockups/client-builder.html C3)
      const f = plan.fresh || { fresh: 0, again: 0, latest: 0 };
      $("bdPickHead").textContent = `A playlist for ${plan.participant}`;
      const b = (n) => Object.assign(document.createElement("b"), { textContent: String(n) });
      summary.append(b(f.fresh), ` ${f.fresh === 1 ? "song" : "songs"} new to ${plan.participant}`);
      if (f.again) {
        const at = new Date(f.latest);
        summary.append(", ", b(f.again), ` heard before, the latest in ${MONTHS[at.getMonth()]} ${at.getFullYear()}`);
      }
      summary.append(".");
      $("bdPickTiles").textContent = "";
      $("confirmYes").disabled = false;
    } else {
      if (plan.many) summary.append(`For ${plural(plan.built.length, "recipe")}. `);
      summary.append(why);
      $("bdPickTiles").textContent = "";
      $("confirmYes").disabled = false;
    }
    // Recipes in this build that give nothing, and why
    $("confirmNotes").hidden = !plan.problems.length;
    const notes = $("confirmList");
    notes.textContent = "";
    for (const [bold, rest] of plan.problems) {
      const li = document.createElement("li");
      putNamed(li.appendChild(document.createElement("b")), bold);
      putNamed(li, " " + rest);
      notes.appendChild(li);
    }
    fillInfoBoxes(pick ? { ...plan, others: inWayFor(chosen) } : plan, keep);
    if (!pick) setLabel($("confirmYes"), plan.participant ? "Build playlist" : `Build ${plural(plan.total, "playlist")}`);
    clearResults();   // the plan says how many; the playlists are listed only once they are being built
    fillWhyTable(plan);
    $("planText").hidden = true;
    $("confirmBox").hidden = false;
    setBuildSteps("build", false, true);
    setCreateStage("question");
    const finish = (answer) => {
      if (answer === "create" && !chosen) return;   // nothing chosen yet: Build does nothing
      openQuestion = null;
      $("confirmYes").disabled = false;
      plan.keep = keep.checked;
      if (answer === "create" && chosen < plan.total) choosePlaylists(plan, chosen);
      $("confirmBox").hidden = true;
      $("planText").hidden = true;
      $("planText").textContent = "";
      $("bdInfo").textContent = "";
      $("confirmYes").onclick = null;
      if (answer === "create") setCreateStage("creating");   // from this moment it cannot be dismissed
      resolve(answer);
    };
    openQuestion = finish;
    $("confirmYes").onclick = () => finish("create");
    why.onclick = () => {
      revealSmoothly($("planText"), $("planText").hidden);
      why.textContent = $("planText").hidden ? whyLabel : "Hide";
    };
  });
}

function choosePlaylists(plan, count) {
  // Fewer than the plan can make: build the first ones. Earlier playlists from the recipe are still replaced as a set; only the person's own playlists
  // that have one of the names actually used are renamed.
  const b = plan.built[0];
  b.playlists = b.playlists.slice(0, count);
  plan.total = count;
  const names = new Set(b.playlists.map((p) => normName(p.name)));
  plan.others = plan.others.filter((p) => names.has(normName(p.name)));
}

async function startCreate(keys = null) {
  const connect = keys ? null : connectionAction();   // in minimalist mode, when not connected, this button connects instead
  if (connect) { connect(); return; }
  buildScope = Array.isArray(keys) && keys.length ? keys : null;
  // One button: plan, show what was found, ask, then create exactly that plan.
  setBusy(true);
  resetBuildPopup();
  clearReportHints("mainReportHint");
  $("editorNote").textContent = "";
  const wanted = selectedKeys();
  openCreateDialog(wanted);
  setBuildSteps("read");
  $("bdRead").hidden = false;
  logStep("plan started");
  invalidatePlan(false);
  const startedWith = planSignature();
  try {
    await loadMyPlaylists();   // what is in Spotify now, including anything changed there since this page loaded
    const plan = await planSelected(startedWith);
    if (!plan) return;
    const answer = await askToCreate(plan);
    if (answer === "stale" || answer === "cancel") { closeCreateDialog(); return; }
    await createFromPlan(plan);
  } catch (err) {
    setOutput("");
    showBuildStop(err, null);
  } finally {
    buildScope = null;
    buildFor = "";
    setBusy(false);
    if (!$("createOverlay").hidden) setCreateStage("done");
  }
}

// One playlist for a participant, built where it will live (Ron, 2026-11-12, mockups/build-one C): no build popup. The participant's popup opens and the new
// playlist fills in at the top of their playlists (personBuild, painted by paintPersonPanel in editor.js); when it is in Spotify a short message says so. Problems
// in the recipe and a failure show in the popup in their place. Nothing is replaced, renamed or removed. The popup can be closed meanwhile; the build goes on.
const personBuild = { code: null };   // code, state (now, done, blocked, fail), name, step, done, total, minutes, fresh, id, problems, error
function setPersonBuild(change) {
  Object.assign(personBuild, change);
  if (typeof paintPersonBuild === "function") paintPersonBuild();
}
async function buildForParticipant(id, code) {
  if (busy || !code) return;
  const f = currentFormats.find((x) => x.id === id);
  if (!f) return;
  setBusy(true);
  for (const k of Object.keys(personBuild)) delete personBuild[k];
  setPersonBuild({ code, state: "now", name: participantPlaylistName(f.title, code), step: "Reading your playlists", done: 0, total: 0 });
  if (typeof openPersonPanel === "function") openPersonPanel(code);
  logStep("participant build started");
  let made = null;
  try {
    await loadMyPlaylists();
    const plan = await planSelected(null, { keys: [id], forWhom: code, quiet: true });
    if (!plan || !plan.built) { setPersonBuild({ state: "blocked", problems: (plan && plan.problems) || [] }); return; }
    const p = plan.built[0].playlists[0];
    const songs = p.uris.filter((u) => !SILENCE_URIS.has(u)).length;
    setPersonBuild({ name: p.name, minutes: p.minutes || 0, fresh: plan.fresh, songs, step: "Making the playlist" });
    if (typeof markPlayTipDone === "function") markPlayTipDone();
    let cover = null;
    if (hasScope("ugc-image-upload")) { try { cover = await loadCover(); } catch (err) { logStep("participant build: cover image not loaded"); } }
    made = await spotifyRequest("POST", "/me/playlists", { json: { name: p.name, public: false, description: builtDescription(p, 1, 1, new Date(), code) } });
    if (made.public !== false) {
      try { await spotifyRequest("PUT", `/playlists/${made.id}`, { json: { public: false } }); } catch (err) { logStep("participant build: could not make it private"); }
    }
    const total = p.uris.length;
    for (let k = 0; k < total;) {
      setPersonBuild({ step: `Adding songs · ${Math.min(k, total)} of ${total}`, done: k, total });
      const n = addChunk;
      try { await spotifyRequest("POST", `/playlists/${made.id}/items`, { json: { uris: p.uris.slice(k, k + n) } }); }
      catch (err) {
        if (n > ADD_CHUNK_SMALL && /returned 400/.test(err.message)) { addChunk = ADD_CHUNK_SMALL; recordNote(`${n} songs per add refused (400)`); continue; }
        throw err;
      }
      k += n;
    }
    if (cover) {
      setPersonBuild({ step: "Adding the cover", done: total, total });
      try { await spotifyRequest("PUT", `/playlists/${made.id}/images`, { body: cover, contentType: "image/jpeg" }); } catch (err) { logStep("participant build: cover not accepted"); }
    }
    countEvent("playlists-created", "1");
    logStep("participant build finished");
    try { await loadMyPlaylists(); } catch (err) { /* the playlist is made; the list catches up later */ }
    setPersonBuild({ state: "done", id: made.id });
    if (typeof personBuilt === "function") personBuilt(code, plan.fresh);
  } catch (err) {
    recordError(cleanError(err));
    logStep("participant build failed");
    setPersonBuild({ state: "fail", error: cleanError(err), id: made ? made.id : null });
    try { await loadMyPlaylists(); } catch (ignore) { /* keep the error showing */ }
  } finally {
    invalidatePlan(true);
    setBusy(false);
    if (typeof paintPersonBuild === "function") paintPersonBuild(true);
  }
}

// Keeping earlier playlists instead of replacing them, and moving the person's own playlists out of the way: "Warm focus 1" becomes "Warm focus 1 (version a)". The letter
// is the first one that none of these playlists has used before ("version b" the second time, and so on, then "aa"), and they all get the same one. A renamed playlist no
// longer has a name the recipe makes, so building and "Remove earlier playlists" leave it alone.
function versionLetters(index) {
  let n = index, out = "";
  do { out = String.fromCharCode(97 + (n % 26)) + out; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return out;
}
function nextVersionLetter(earlier) {
  const used = new Set();
  for (const p of earlier) {
    const prefix = `${p.name} (version `;
    for (const q of playlists) if (q.name.startsWith(prefix) && q.name.endsWith(")")) used.add(q.name.slice(prefix.length, -1));
  }
  let i = 0;
  while (used.has(versionLetters(i))) i += 1;
  return versionLetters(i);
}
async function keepEarlierPlaylists(earlier) {
  const letter = nextVersionLetter(earlier);
  let done = 0;
  try {
    for (const p of earlier) {
      const name = `${p.name} (version ${letter})`;
      await spotifyRequest("PUT", `/playlists/${p.id}`, { json: { name } });
      const entry = playlists.find((q) => q.id === p.id);
      if (entry) entry.name = name;
      done += 1;
    }
  } catch (err) {
    throw new Error(`${done} of ${plural(earlier.length, "playlist")} were renamed before this went wrong: ${cleanError(err)}`);
  }
  logStep(`renamed ${plural(earlier.length, "playlist")} to version ${letter}`);
  return letter;
}

async function createFromPlan(plan) {
  setCreateStage("creating");
  setBuildSteps("build");
  setOutput("");
  const existing = plan.keep ? [] : plan.ours;   // removed first
  const renamed = plan.others.concat(plan.keep ? plan.ours : []);   // renamed first, so the new playlists can have their names
  const planned = plan.built.flatMap((b) => b.playlists.map((p) => ({ ...p, label: formatLabel(b.key), key: b.key })));
  logStep(`create started (${plural(planned.length, "playlist")})`);
  if (typeof markPlayTipDone === "function") markPlayTipDone();   // the tutorial tip's last step is done
  // The playlists being made, listed for the first time, each row ticked off as it is made.
  clearResults();
  let removeRow = null, renameRow = null;
  if (renamed.length) {
    renameRow = playlistRow({ name: `Renaming ${plural(renamed.length, "playlist")}` }, "now");
    $("results").appendChild(renameRow);
  }
  if (existing.length) {
    removeRow = playlistRow({ name: `Removing ${plural(existing.length, "earlier playlist")}` }, "now");
    $("results").appendChild(removeRow);
  }
  const rows = [];
  let lastKey = null;
  for (const p of planned) {
    if (plan.many && p.key !== lastKey) $("results").appendChild(groupRow(p.label, ""));
    lastKey = p.key;
    const row = playlistRow(p, "wait");
    rows.push(row);
    $("results").appendChild(row);
  }
  // The count and the icons stay above while only the list scrolls (and, when done, the finale above it), and the list keeps the row being built in view,
  // until the person scrolls it themselves.
  $("createDialog").classList.add("bd-listing");
  const body = $("results");
  let follow = true;
  const stopFollowing = () => { follow = false; };
  for (const type of ["wheel", "touchmove", "keydown"]) body.addEventListener(type, stopFollowing, { passive: true });
  const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const show = (row) => {
    if (!follow || !row.scrollIntoView) return;
    row.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
  };
  let created = 0;
  const progress = (status, building) => setTally(created, planned.length, status, building);
  progress("Keep this tab open.");
  let current = null;   // the playlist being made, if it exists in Spotify but is not finished
  let removing = renamed.length ? "renaming" : existing.length ? "removing" : null;   // what is under way before the building starts
  const createdIds = [];
  const stillPublic = [];
  let cover = null;
  let coverBlocked = !hasScope("ugc-image-upload");   // this sign-in was not approved for uploading images
  let coverUnloaded = false;
  let coverFailed = 0;
  if (!coverBlocked) {
    try { cover = await loadCover(); } catch (err) { coverUnloaded = true; logStep("create: cover image not loaded"); }
  }
  try {
    if (renamed.length) {
      progress(`Renaming ${plural(renamed.length, "playlist")}. Keep this tab open.`);
      if (plan.others.length) await keepEarlierPlaylists(plan.others);
      if (plan.keep && plan.ours.length) await keepEarlierPlaylists(plan.ours);
      renameRow.bd.name.textContent = `Renamed ${plural(renamed.length, "playlist")}`;
      setRowState(renameRow, "done");
      removing = existing.length ? "removing" : null;
    }
    if (existing.length) {
      progress(`Removing ${plural(existing.length, "earlier playlist")}. Keep this tab open.`);
      await removePlaylists(existing.map((p) => p.id));
      removeRow.bd.name.textContent = `Removed ${plural(existing.length, "earlier playlist")}`;
      setRowState(removeRow, "done");
    }
    removing = null;
    for (const [i, p] of planned.entries()) {
      const row = rows[i];
      progress("Keep this tab open.", true);
      setRowState(row, "now", "starting");
      show(row);
      const made = await spotifyRequest("POST", "/me/playlists", { json: { name: p.name, public: false, description: builtDescription(p, planned.filter((q, j) => q.key === p.key && j <= i).length, planned.filter((q) => q.key === p.key).length, new Date(), plan.participant || "") } });
      current = p.name;
      createdIds.push(made.id);
      if (made.public !== false) {   // asked to keep it off the profile; make sure
        try { await spotifyRequest("PUT", `/playlists/${made.id}`, { json: { public: false } }); }
        catch (err) { stillPublic.push(p.name); logStep("create: could not make a playlist private"); }
      }
      setRowState(row, "now", "adding songs");
      for (let k = 0; k < p.uris.length;) {
        const n = addChunk;
        try { await spotifyRequest("POST", `/playlists/${made.id}/items`, { json: { uris: p.uris.slice(k, k + n) } }); }
        catch (err) {
          // if Spotify turns out to take fewer songs at a time, the rest of the run asks with fewer (a refused request adds nothing)
          if (n > ADD_CHUNK_SMALL && /returned 400/.test(err.message)) { addChunk = ADD_CHUNK_SMALL; logStep(`create: ${n} songs at a time refused`); recordNote(`${n} songs per add refused (400)`); continue; }
          throw err;
        }
        k += n;
      }
      if (cover && !coverBlocked) {   // the app's icon as the cover; a problem here never stops the playlists
        setRowState(row, "now", "adding the cover");   // an image upload, often the slowest step for a playlist
        try { await spotifyRequest("PUT", `/playlists/${made.id}/images`, { body: cover, contentType: "image/jpeg" }); }
        catch (err) {
          coverFailed += 1;
          logStep("create: cover not accepted");
          if (/did not allow|sign-in expired/.test(err.message)) coverBlocked = true;   // no point asking again
        }
      }
      created += 1;
      current = null;
      setRowState(row, "done", "");
    }
    logStep(`create finished (${plural(created, "playlist")})`);
    invalidatePlan(true);
    $("bdTally").hidden = true;
    setBuildSteps("done");
    const notes = [];
    if (stillPublic.length) notes.push(`Spotify kept ${plural(stillPublic.length, "playlist")} on your profile and would not let this app change that. You can change that in the Spotify app.`);
    if (coverBlocked) notes.push(`The cover art was not added, because your Spotify sign-in does not include permission to upload images. Sign in again with Change Spotify login in More options to allow it. Playlists you build after that will get the cover.`);
    else if (coverUnloaded) notes.push("The cover art could not be loaded, so the playlists have Spotify's default cover.");
    else if (coverFailed) notes.push(`Spotify would not accept the cover art for ${plural(coverFailed, "playlist")}.`);
    if (created > 0) countEvent("playlists-created", String(created));
    await glideToTop(body);   // the list starts again from its first playlist under the finale
    showFinale(created, planned.slice(0, created).reduce((n, p) => n + (p.minutes || 0), 0));
    // The first new playlist, at its ordinary Spotify address: on a phone it opens the Spotify app when it is installed, on a computer the web player, which offers the app.
    if (createdIds.length) $("createOpenLink").href = `https://open.spotify.com/playlist/${createdIds[0]}`;
    $("createOpen").hidden = !createdIds.length;
    const showNotes = () => { $("createNotes").textContent = notes.join("\n\n"); $("createNotes").hidden = !notes.length; };
    showNotes();
    await loadMyPlaylists();
    // The mark in the description is how this app finds its own playlists later. If Spotify's list does not show it, say so.
    const marked = new Set(playlists.filter((p) => p.madeByApp).map((p) => p.id));
    if (createdIds.length && createdIds.every((id) => !marked.has(id))) {
      logStep("create: description mark not returned");
      notes.push("Spotify's playlist list did not show the description this app puts on its playlists (or has not updated yet), so this app may not recognize them later.");
      showNotes();
    }
  } catch (err) {
    if (created || current) invalidatePlan(true);   // some playlists exist now, so creating the plan again would duplicate them
    $("bdTally").hidden = true;
    // The row that was under way gets a cross; the ones after it stay as they were, marked "not built".
    rows.forEach((row, i) => {
      if (i < created) return;
      if (i === created && !removing) setRowState(row, "fail", current ? "incomplete" : "not built");
      else setRowState(row, "wait", "not built");
    });
    if (removing) setRowState(removing === "renaming" ? renameRow : removeRow, "fail");
    logStep(`create failed after ${created} of ${planned.length}`);
    showBuildStop(err, { built: created, total: planned.length, incomplete: current, removing });
    try { await loadMyPlaylists(); } catch (ignore) { /* keep the original error showing */ }
  } finally {
    for (const type of ["wheel", "touchmove", "keydown"]) body.removeEventListener(type, stopFollowing);
    body.scrollTop = 0;   // the list from its first playlist, under the result or what went wrong
  }
}

// Remove built playlists has three states in one popup (Ron, 2026-11-10): choosing a recipe, the question, and the result. The popup's title follows.
function removeStage(stage) {
  $("removeChoose").hidden = stage !== "choose";
  $("removeConfirmBox").hidden = stage !== "ask";
  $("removeDone").hidden = stage !== "done";
  if (stage === "choose") { setRemoveMessage(""); clearReportHints("removeReportHint"); fillRemoveKey(); refreshRemoveCount(); }
  if (info.node && info.node.id === "removeSection") {
    const total = stage === "ask" ? Number($("removeConfirmYes").dataset.total || 0) : 0;
    $("infoTitle").textContent = total ? `Remove ${plural(total, "playlist")}?` : stage === "ask" ? "Remove playlists?" : "Remove built playlists";
  }
}

// While choosing, how many of Arc's playlists from the chosen recipe are in the library now, from the list already read (the button says the number)
let removeNone = false;   // the list already read shows none of Arc's playlists from the chosen entry
function refreshRemoveCount() {
  let t = null;
  try { if (py && me && playlists && $("removeKey").value) t = removeTargets(); } catch (err) { t = null; }
  const key = $("removeKey").value, line = $("removeCount");
  const gone = key.startsWith(GONE_PREFIX), all = key === ALL_FORMATS;
  const label = all ? "all recipes" : named(gone ? key.slice(GONE_PREFIX.length) : formatLabel(key));
  const count = t ? t.current.length + t.gone.length : null;
  const are = (n) => (n === 1 ? "is" : "are");
  line.textContent = "";   // putNamed adds to what is there
  if (count === null) { /* nothing known yet */ }
  else if (!count) putNamed(line, gone ? `None of these playlists are in your library now.` : `None of Arc's playlists from ${label} are in your library.`);
  else if (all && t.gone.length) putNamed(line, `${plural(count, "playlist")} ${are(count)} in your library, ${t.gone.length} of them from ${t.gone.length === 1 ? "a recipe that no longer exists" : "recipes that no longer exist"}.`);
  else putNamed(line, `${plural(count, "playlist")} from ${label} ${are(count)} in your library.`);
  // with gone ones in All recipes the question decides how many, so the button does not say
  setLabel($("removeOld"), !count ? "Remove playlists" : all && t.gone.length && t.current.length ? "Remove\u2026" : `Remove ${count}`);
  if (removeNone !== (count === 0)) { removeNone = count === 0; updateButtons(); }
}

// The question before removing. Resolves with the playlists to remove, or null for Back. gone: playlists of recipes that no longer exist, which cannot be built again:
// alongside the recipes' own (All recipes), two choices, only those with a recipe (chosen at first) or all; alone (one gone recipe), a note above the list.
function askToRemove(marked, others, label, gone = []) {
  return new Promise((resolve) => {
    let include = false, withGone = false;
    const many = others.length !== 1;
    const choose = gone.length > 0 && marked.length > 0;
    const goneOnly = gone.length > 0 && !marked.length;
    const names = (list) => (list.length <= 4 ? list.map((p) => p.name).join(", ") : `${list.slice(0, 3).map((p) => p.name).join(", ")}, and ${list.length - 3} more`);
    const draw = () => {
      const total = marked.length + (include ? others.length : 0) + (goneOnly || withGone ? gone.length : 0);
      if (choose) {
        fillConfirmList("removeConfirmList", "removeConfirmText",
          `${marked.length} ${marked.length === 1 ? "is" : "are"} from your recipes and can be built again any time. ${gone.length} ${gone.length === 1 ? "is from a recipe that no longer exists, so once removed it" : "are from recipes that no longer exist, so once removed they"} can't be built again.`, []);
        $("removeGoneNoTitle").textContent = `Only the ${marked.length} with a recipe`;
        $("removeGoneNoNote").textContent = names(marked);
        $("removeGoneYesTitle").textContent = `All ${marked.length + gone.length}`;
        $("removeGoneYesNote").textContent = `Also ${names(gone)}, which can't be built again`;
        $("removeGoneNo").checked = !withGone;
        $("removeGoneYes").checked = withGone;
      } else if (goneOnly) {
        fillConfirmList("removeConfirmList", "removeConfirmText", "", gone.map((p) => p.name));
      } else {
        fillConfirmList("removeConfirmList", "removeConfirmText",
          marked.length ? `Remove ${plural(marked.length, "playlist")} made by this app from your library? They match the naming pattern of ${label}.` : `No playlists made by this app match the naming pattern of ${label}.`,
          marked.map((p) => p.name));
      }
      $("removeGoneChoice").hidden = !choose;
      $("removeGoneWarn").hidden = !goneOnly;
      fillConfirmList("removeConfirmMoreList", "removeConfirmMoreText",
        !others.length ? ""
          : include ? `${plural(others.length, "playlist")} with matching names ${many ? "were" : "was"} not made by this app, and will be removed too because you chose to remove ${many ? "them" : "it"}:`
          : `${plural(others.length, "playlist")} with matching names ${many ? "were" : "was"} not made by this app (older ones, or ones whose description was changed), so ${many ? "they" : "it"} will not be touched:`,
        others.map((p) => p.name));
      $("removeToggleRow").hidden = others.length === 0;
      $("removeToggle").checked = include;
      $("removeToggleLabel").textContent = `Remove ${many ? "them" : "it"} too`;
      setLabel($("removeConfirmYes"), !total ? "Nothing to remove" : choose ? `Remove ${total}` : "Remove");
      $("removeConfirmYes").disabled = total === 0;
      $("removeConfirmYes").dataset.total = choose ? "" : String(total);   // with a choice to make, the title does not give a number
      setLabel($("removeConfirmNo"), "Back");
      removeStage("ask");
    };
    const finish = (value) => {
      $("removeConfirmYes").onclick = null;
      $("removeConfirmNo").onclick = null;
      $("removeToggle").onchange = null;
      $("removeGoneNo").onchange = $("removeGoneYes").onchange = null;
      resolve(value);
    };
    draw();
    $("removeConfirmYes").onclick = () => finish(marked.concat(include ? others : [], goneOnly || withGone ? gone : []));
    $("removeConfirmNo").onclick = () => finish(null);
    $("removeToggle").onchange = () => { include = $("removeToggle").checked; draw(); };
    $("removeGoneNo").onchange = $("removeGoneYes").onchange = () => { withGone = $("removeGoneYes").checked; draw(); };
  });
}

// Delete recipe offers to remove the recipe's own built playlists too (Ron, 2026-11-10): Arc's playlists in the library that match its names now, from the list
// already read. null when that cannot be known now (not connected, Python not ready, a build or a removal running, or a Spotify pause).
function builtPlaylistsOf(id) {
  if (!token || connection !== "ready" || !py || !me || !playlists || busy || pausedSecondsLeft() > 0) return null;
  try {
    const made = new Set(playlists.filter((p) => p.madeByApp && !p.isSave).map((p) => p.id));
    return recipeMatches($("formats").value, [id]).filter((p) => made.has(p.id));
  } catch (err) { return null; }
}
// After Delete recipe with the box ticked: removes them, then says how it went on the line under the bar
async function removeBuiltOfDeleted(list, title) {
  if (!list || !list.length) return;
  setBusy(true);
  try {
    await removePlaylists(list.map((p) => p.id));
    logStep(`remove after delete (${plural(list.length, "playlist")})`);
    showNotices([{ text: `Removed ${plural(list.length, "playlist")} built from ${named(title)}.`, transient: true }]);
    await loadMyPlaylists();
  } catch (err) {
    showNotices([{ text: `The playlists built from ${named(title)} could not be removed: ${cleanError(err)} Remove built playlists in the menu can try again.`, transient: true }]);
  } finally {
    setBusy(false);
  }
}

async function removeEarlier() {
  // Everything about removing, including the question and the result, stays inside the Remove popup.
  setBusy(true);
  setRemoveMessage("");
  clearReportHints("removeReportHint");
  logStep("remove started");
  const done = (text, ok = false) => { setRemoveMessage(text); $("removeOk").hidden = !ok; removeStage("done"); };
  try {
    await loadMyPlaylists();   // what is in Spotify now, including anything changed there since this page loaded
    fillRemoveKey();   // what is gone may have changed with the list
    const t = removeTargets();
    if (!t.current.length && !t.others.length && !t.gone.length) {
      done("No playlists matching these recipes' names were found.");
      return;
    }
    const chosen = await askToRemove(t.current, t.others, removeKeys().map(formatLabel).join(", "), t.gone);
    if (!chosen) {
      removeStage("choose");   // Back: nothing was changed
      return;
    }
    setLabel($("removeConfirmYes"), "Removing\u2026");
    $("removeConfirmYes").disabled = $("removeConfirmNo").disabled = true;
    await removePlaylists(chosen.map((p) => p.id));
    logStep(`remove finished (${plural(chosen.length, "playlist")})`);
    done(`Removed ${plural(chosen.length, "playlist")} from your library.`, true);
    await loadMyPlaylists();
  } catch (err) {
    done("Something went wrong: " + cleanError(err));
    offerReport("removeReportHint", cleanError(err));
  } finally {
    $("removeConfirmNo").disabled = false;
    setBusy(false);
  }
}

// ---------------------------------------------------------------- start up
// ---------------------------------------------------------------- the backup card, sign-in returns, saving when the page is left
function initPageEvents() {
  on("backupOk", "click", () => { const radio = document.querySelector('input[name="backupMode"]:checked'); if (radio) chooseBackupMode(radio.value); else dismissBackupCard(); });
  on("backupCancel", "click", dismissBackupCard);
  on("changeSpotifyLogin", "click", () => changeSpotifyLogin());
  for (const id of ["backupModeSpotify", "backupModeManual"]) on(id, "change", refreshBackupSave);
  // Back from Spotify's page, a browser may show this page as it was left, with the buttons still waiting
  window.addEventListener("pageshow", (event) => { if (event.persisted && signingIn) { setSigningIn(false); setLoginMessage(""); } });
  // the connection coming back after a failed save: try again, without waiting to be asked
  window.addEventListener("online", () => { if (backupMode() === "spotify" && saveState.error) { saveState.error = ""; scheduleSpotifySave(500); } });
  // someone leaving the page, or switching to another app, does not wait for the pause: whatever has not been saved is saved now
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && saveState.timer && backupMode() === "spotify") runSpotifySave();
    if (document.visibilityState === "visible" && startupDone && Date.now() - versionCheck.last > versionCheck.everyMs) checkForNewVersion();
    // coming back after a while: another device may have changed a backup, so the account's playlists are read again
    if (document.visibilityState === "visible" && backupMode() === "spotify" && connection === "ready" && playlistsLoadedAt && Date.now() - playlistsLoadedAt > playlistRefreshMs && !saveState.running) loadMyPlaylists().catch(() => {});
  });
  // a window that was behind another one and comes forward counts as coming back too
  window.addEventListener("focus", () => { if (startupDone && Date.now() - versionCheck.last > versionCheck.everyMs) checkForNewVersion(); });
  refreshBackupCard();
  applyBackupMode();
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
const SCRIPT_FILES = ["theme.js", "formats.js", "editor.js", "shared-spotify.js", "sharing.js"];
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

async function main() {
  if (window.pageStart) window.pageStart.started = true;   // tells the page's watchdog that this script is running
  startFlowChoice();
  fillActWords();
  logStep("page opened");
  const pageVersion = (document.querySelector('meta[name="app-version"]') || {}).content;
  if (pageVersion !== APP_VERSION) startupProblems.push(`page version ${pageVersion || "unknown"} and script version ${APP_VERSION} differ`);
  whenScriptsLoaded(checkScriptVersions);
  guarded("report details", () => refreshReportBox());
  for (const el of document.querySelectorAll(".redirect-address")) el.textContent = redirectUri();
  $("clientId").value = localStorage.getItem("clientId") || "";
  $("formats").value = localStorage.getItem("formats") || DEFAULT_FORMATS;
  guarded("dashboard links", () => sendDashboardToSafari());
  guarded("color choice", () => initThemeChooser());
  guarded("editor", () => initEditor());
  guarded("formats", () => refreshFormatKeys());
  guarded("output", () => setOutput(""));

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
  on("clearData", "click", () => {
    $("clearConfirm").hidden = false;
    $("clearData").disabled = true;    // the question is already open, so the button that opened it waits
    // the question and its buttons can open below the bottom of the screen: bring them into view once the popup has grown (smoothResize, 0.32 s)
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if ($("clearConfirm").scrollIntoView) setTimeout(() => $("clearConfirm").scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" }), still ? 0 : 340);
  });
  on("clearNo", "click", () => {
    $("clearConfirm").hidden = true;
    $("clearData").disabled = false;
  });
  on("clearYes", "click", () => clearSavedData());
  // The DEV menu's rows (editor.js opens and closes it): each closes the menu first, so its question or message is in view
  on("devStartOver", "click", async () => {
    showDevMenu(false);
    const choice = await askSyncChoice("Clear data and start over?", "This signs you out and erases everything Arc keeps in this browser. Your Client ID is copied to the clipboard first, so setting up again is a paste.",
      [{ label: "Cancel", value: "no" }, { label: "Clear data", value: "yes", danger: true }]);
    if (choice === "yes") await startOver();
  });
  on("devCopyRecord", "click", () => { showDevMenu(false); copyLimitRecord(); });
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
  on("connect", "click", startLogin);
  on("startSetup", "click", () => slideScreens(() => goToSetup(false)));
  on("getStarted", "click", () => slideScreens(() => showWelcomeStep(2, true)));
  on("wpSetupBack", "click", welcomeStepBack);
  for (const head of document.querySelectorAll("#welcomePage .wp-tool-head")) head.addEventListener("click", () => toggleWelcomeTool(head));
  watchTutorialRows();
  alignWelcomeIcons();
  window.addEventListener("resize", () => { alignWelcomeIcons(); drawSetupJoint(); });
  if (connectingScreen) { alignWelcomeIcons(); drawSetupJoint(); }   // the connecting screen has the band and the line too
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(alignWelcomeIcons);
  on("premiumWhy", "click", (event) => { event.stopPropagation(); showPremiumWhy($("premiumWhyText").hidden); });
  document.addEventListener("click", (event) => { if (!$("premiumWhyText").hidden && !$("premiumWhyText").contains(event.target)) showPremiumWhy(false); });
  on("recipeWhat", "click", (event) => { event.stopPropagation(); showRecipeWhat($("recipeWhatText").hidden); });
  document.addEventListener("click", (event) => { if (!$("recipeWhatText").hidden && !$("recipeWhatText").contains(event.target)) showRecipeWhat(false); });
  window.addEventListener("resize", placeRecipeWhat);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") { showPremiumWhy(false); showRecipeWhat(false); } });
  on("setupBack", "click", setupBack);
  window.addEventListener("popstate", pageHistoryMoved);
  try { if (history.state && (history.state.view || history.state.step)) history.replaceState(null, ""); } catch (err) { /* nothing to forget */ }   // a reload keeps the step, but the page opens on home (and the welcome page on its first step)
  on("appHome", "click", goHome);
  initToolMenu();
  on("homeBuilder", "click", () => showView("builder"));
  // Everything else on home: each icon opens its panel in place
  initHomeMore();
  window.addEventListener("resize", fitHomeLines);
  window.addEventListener("resize", placeSharingPage);
  on("infoClose", "click", () => closeInfo());
  on("infoOverlay", "click", (event) => { if (event.target === $("infoOverlay")) closeInfo(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && info.node && !event.defaultPrevented) { event.preventDefault(); closeInfo(); } });   // an Escape that closed something inside it (the color list) is not for the popup
  on("connectionRetry", "click", connectToSpotify);
  on("connectionReconnect", "click", startLogin);
  on("reconnectButton", "click", startLogin);
  on("create", "click", () => startCreate());
  $("privacyWaitRelay").hidden = !WAIT_RELAY_URL;   // Privacy says what the relay sees only once there is one
  for (const link of document.querySelectorAll(".privacy-link")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      if (pageName() === "app" && typeof showView === "function") showView("home");   // Privacy is under Everything else on home
      openHomeTab("privacySection", false);
      $("homeMore").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  on("createClose", "click", closeCreateDialog);
  on("bdClose", "click", closeCreateDialog);
  on("confirmNo", "click", closeCreateDialog);   // Cancel, beside Build: the same as the X   // the X: cancels the question, or closes the popup once the build is done
  initMotion();
  smoothResize($("createDialog"), document.querySelector("#createDialog .bd-body"));
  smoothResize($("infoDialog"), $("infoSlot"));
  on("createOverlay", "click", (event) => { if (event.target === $("createOverlay")) dismissCreateDialog(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !event.defaultPrevented && !$("createOverlay").hidden) dismissCreateDialog(); });   // an Escape that closed the guide above it is not for the build popup
  guarded("tip note", () => trackTipHeight());
  on("updateGet", "click", getUpdate);
  on("usOk", "click", closeUpdateScreen);
  document.addEventListener("keydown", (event) => { if (updateScreen && $("updateScreen").classList.contains("us-done") && (event.key === "Escape" || event.key === "Enter")) { event.preventDefault(); closeUpdateScreen(); } });
  guarded("page events", () => initPageEvents());
  on("removeOld", "click", removeEarlier);
  on("removeKey", "change", () => { updateButtons(); refreshRemoveCount(); });
  on("backupDownload", "click", downloadBackup);
  on("backupRestore", "click", () => $("restoreFile").click());
  on("backupDownloadLink", "click", () => downloadBackup());   // the same as the menu's Back up now a backup
  on("restoreFile", "change", async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";   // so choosing the same file again still counts
    await restoreFromFile(file);
  });
  on("formats", "input", () => {
    localStorage.setItem("formats", $("formats").value);
    invalidatePlan();
    undoText = null;
    if (typeof editor === "undefined" || !editor.internal) clearHeldNotice();   // an Undo offered earlier would now overwrite new edits
    refreshBackupStatus();
    refreshFormatKeys();
  });
  refreshBackupStatus();
  guarded("a wait from Spotify", () => tickPause());

  if (signingIn) { setLoginMessage(signInNote, true); updateButtons(); }   // coming back from Spotify: say so before the sign-in is finished
  updateStep(launchScreen ? "Connecting to Spotify" : "Signing in to Spotify");
  const pythonReady = connectingScreen || updateScreen || launchScreen ? preparePython().then((ok) => { if (ok) connectingStep("Python", "done"); else connectingStepFailed("Python"); return ok; }) : null;   // behind the connecting screen (or the update card) Python loads alongside the sign-in, so the wait is the slower of the two
  try {
    await finishLoginIfReturning();
  } catch (err) {
    setLoginMessage(String(err.message || err));
    offerReport("loginReportHint", String(err.message || err));
  }
  setSigningIn(false);   // the sign-in is over, one way or the other: from here the connection itself is what the buttons follow
  token = loadStoredToken();
  if (!token && !needsReconnect && storedRefresh()) {
    setConnection("connecting");
    token = await renewSignIn();   // a sign-in from an earlier visit, renewed without leaving the page
    if (!token) setConnection("none");
  }
  if (!token) { endLaunchScreen(); await connectingStepFailed("Signin"); }   // nothing more to wait for: the app says what to do   // the sign-in did not work: the setup page shows what went wrong
  connectingStep("Signin", "done");
  if (!token && needsReconnect) {
    revealLoginProblem();
    setLoginMessage("Please connect again so this page can build playlists.");
  }

  startupDone = true;
  refreshReconnectScreen();
  showStartupProblems();
  if (!startupProblems.length) setTimeout(checkForNewVersion, 5000);   // a few seconds after a clean start, off the way of everything else
  showPage();   // signed in, or connected before: the app
  if (token) {
    document.body.classList.add("connected");
    connectingStep("Playlists", "active");
    updateStep("Reading your playlists");
    await connectToSpotify();   // and the app only calls itself connected, and offers Create, once Spotify has answered
    if (connection === "ready") connectingStep("Playlists", "done");
    else await connectingStepFailed("Playlists");   // the connection problem shows in the app
  }
  if (connectingScreen) await settleFirstSave();
  else if ((updateScreen || launchScreen) && connection === "ready" && backupMode() === "spotify") {
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
  const pause = spotifyPause();
  if (pause && sessionStorage.getItem("pauseSeen") !== String(pause.until) && $("createOverlay").hidden) showPauseDialog();
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
