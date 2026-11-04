// app.js: the page's logic. It signs in to Spotify, reads playlists, and asks engine.py (running in
// Pyodide, which is Python in the browser) to plan the new playlists. Then it can create them.

// Python runtime versions to try, newest first. If one is not available, the next is used.
const PYODIDE_VERSIONS = ["v0.29.3", "v0.29.2", "v0.29.1", "v0.29.0", "v0.28.3", "v0.27.7"];
const SCOPES = [
  "playlist-read-private", "playlist-read-collaborative",   // read your playlists
  "playlist-modify-private", "playlist-modify-public",      // create playlists
  "user-library-modify",                                    // Spotify's generic endpoint for removing playlists
  "ugc-image-upload",                                       // the cover art on the playlists it creates
].join(" ");
const REQUIRED_SCOPES = ["playlist-modify-private", "playlist-modify-public"];   // cover art is optional, so an older sign-in without it keeps working
// Not called API: Pyodide 0.29 treats a global named API as its own and fails to start (it falls back to an older version).
const SPOTIFY_API = "https://api.spotify.com/v1";
const ADD_CHUNK = 100;     // songs added per request (Spotify's documented maximum; fewer requests means fewer rate limits)
const ADD_CHUNK_SMALL = 10; // what is tried instead if Spotify refuses 100
const REMOVE_CHUNK = 40;   // playlists removed per request (Spotify's maximum)

const ALL_FORMATS = "__all__";  // dropdown value that means every format
const APP_VERSION = "2026-11-03y";

// Every playlist this app creates gets this at the start of its description. That is the one way the app tells its
// own playlists from ones you made by hand, so it works on any device, and nothing is stored in this browser for it.
const APP_MARKER = "Made by Ceremony Playlist Builder";                    // change this whenever the page is updated
const REPORT_FORM_URL = "https://tally.so/r/VppLZN"; // where problem reports go
// The feedback and questions form (Tally). It collects only what someone types, so nothing is attached to its address. While this is empty,
// the section and the matching lines in Privacy stay hidden.
const FEEDBACK_FORM_URL = "https://tally.so/r/4aayDd";

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
// It is asked a few seconds after a clean start, and when the person comes back to the tab if the last time was over 10 minutes ago, which is a moment when nothing is going on.
// Newer means different, since stamps do not sort once there are more than 26 in a day. If nothing is going on, the page loads again by itself (once for each new version, so a
// half-finished upload cannot make it loop); otherwise a message in the line under the editor's bar offers it. A running page is never harmed by an upload: it keeps what it
// loaded, and the Python engine is read once, at the start. Opening the app menu asks too (at most every 30 seconds), and a newer version shows there with Update.
const versionCheck = { last: 0, everyMs: 10 * 60 * 1000, menuEveryMs: 30 * 1000, running: false, latest: "" };

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
    if (typeof editor !== "undefined" && editor.appMenu && typeof renderAppMenu === "function") renderAppMenu();   // the menu is open: its last line turns into the offer
    newerVersionFound(latest);
  } catch (err) {
    /* no connection, or the file is not there: the next time */
  } finally {
    versionCheck.running = false;
  }
}

function nothingIsGoingOn() {
  const active = document.activeElement;
  const typing = active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
  const popup = document.querySelector(".fe-overlay:not([hidden]), #backupCard.opened, #createOverlay:not([hidden]), #infoOverlay:not([hidden])");
  const menuOpen = typeof editor !== "undefined" && editor.appMenu;   // the menu offers Update itself
  return !busy && !saveState.running && !connectingScreen && !typing && !popup && !menuOpen && !(typeof notices !== "undefined" && Date.now() - notices.lastEditAt < 10000);
}

function newerVersionFound(latest) {
  let tried = false;
  try { tried = sessionStorage.getItem("versionTried") === latest; } catch (err) { tried = true; }
  if (nothingIsGoingOn() && !tried) {
    try { sessionStorage.setItem("versionTried", latest); } catch (err) { /* no storage: no second try either */ }
    reloadForNewVersion(() => offerNewVersion());
    return;
  }
  offerNewVersion();
}

function reloadForNewVersion(failed) {
  if (window.pageStart && window.pageStart.refresh) window.pageStart.refresh(failed || (() => {}));   // fresh copies of every file, then the page again
  else location.reload();
}

function offerNewVersion() {
  if (typeof showNotices === "function") showNotices([{ text: "A newer version of this app is available.", icon: "cloud", hold: true, actions: [{ label: "Reload", run: () => reloadForNewVersion(() => {}) }] }]);
}

function showStartupProblems() {
  if (!startupProblems.length) {
    try { sessionStorage.removeItem("startupRefreshed"); } catch (err) { /* nothing was kept */ }   // a clean start: the next stale copy may be tried again by itself
    return;
  }
  try { recordError("Startup: " + startupProblems.join("; ").slice(0, 300)); } catch (err) { /* the popup matters more */ }
  const link = $("startupReport");
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
  if (was && was !== page) { window.scrollTo(0, 0); requestAnimationFrame(() => window.scrollTo(0, 0)); }   // again after the new page is laid out, so the title sits where it does on the other page
}

// The welcome page's Why? next to "Requires Spotify Premium" opens a small note under it.
function showPremiumWhy(open) {
  $("premiumWhyText").hidden = !open;
  $("premiumWhy").setAttribute("aria-expanded", String(open));
}

// "recipe" in the welcome page's intro opens a note under the word, moved left if needed so it stays inside the paragraph.
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
  note.style.top = Math.round(at.bottom - box.top + 6) + "px";
  note.style.left = Math.round(Math.max(0, Math.min(at.left - box.left, box.width - note.offsetWidth))) + "px";
}

// ---------------------------------------------------------------- the connecting screen
// Back from Spotify's sign-in, the script in index.html's <head> puts up a quiet screen in place of the setup page: the app's icon and a list of what is under way
// (signing in, reading the playlists, settling the recipes with their saves, starting Python), each ticked as it is done. When all are, it fades to the editor.
// There is no time limit of its own: each step ends by finishing or by failing (a Spotify request that gets no answer fails after spotifyAnswerMs).
// A step that fails is marked for a moment, then the screen goes and the problem shows as usual. A question takes it down at once.
let connectingScreen = document.documentElement.classList.contains("connecting");
let connectingFailedMs = 1200;   // how long a failed step's mark is in view before the screen goes

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
  if (currentFlow()) { showFlow(null); window.scrollTo(0, 0); return; }
  if (history.state && history.state.page === "setup") { history.back(); return; }   // the popstate that follows does the rest
  setupLeft();
}

function setupLeft() {
  try {
    if (storedItem(sessionStorage, "setupAgain") === "1") sessionStorage.removeItem("setupAgain");
    else localStorage.setItem("setupStarted", "0");
  } catch (err) { /* private browsing */ }
  showPage();
}

function pageHistoryMoved() {
  const state = history.state;
  if (state && state.page === "setup") {
    try { if (state.again) sessionStorage.setItem("setupAgain", "1"); else localStorage.setItem("setupStarted", "1"); } catch (err) { /* private browsing */ }
    showPage();
  } else if (pageName() === "setup") {
    setupLeft();
  }
}

// About, Privacy, More options and Report a problem sit at the bottom of the welcome and setup pages. In the app they open from the menu in a
// popup: the block itself moves into it, and goes back to its place when the popup closes.
const info = { node: null, marker: null, wasOpen: false, wasHidden: false };

function openInfo(id) {
  closeInfo(true);
  const node = $(id);
  if (!node) return;
  info.node = node;
  info.wasOpen = !!node.open;
  info.marker = document.createComment(id);
  node.before(info.marker);
  $("infoSlot").appendChild(node);
  if (node.tagName === "DETAILS") node.open = true;
  info.wasHidden = node.hidden;
  node.hidden = false;
  const title = node.querySelector("summary, h3");
  $("infoDialog").setAttribute("aria-label", title ? title.textContent.trim() : "");
  $("infoTitle").textContent = title ? title.textContent.trim() : "";
  if (id === "reportBlock" || id === "moreOptions") refreshReportBox();
  $("infoOverlay").hidden = false;
  document.body.style.overflow = "hidden";
  $("infoSlot").scrollTop = 0;
  $("infoDialog").focus({ preventScroll: true });
}

function closeInfo(quiet = false) {
  if (!info.node) return;
  if (info.node.tagName === "DETAILS") info.node.open = info.wasOpen;
  info.node.hidden = info.wasHidden;
  info.marker.replaceWith(info.node);
  info.node = null;
  info.marker = null;
  $("infoOverlay").hidden = true;
  document.body.style.overflow = "";
  if (!quiet && $("feAppMenuButton")) $("feAppMenuButton").focus();
}

function startFlowChoice() {
  // The two answers on the setup page are wired first of all, for the whole page at once, so they work whatever else goes wrong.
  // The capture phase catches the click even from a script that stops it bubbling.
  document.addEventListener("click", (event) => {
    const button = event.target.closest && event.target.closest("[data-flow]");
    if (button) showFlow(button.getAttribute("data-flow"));
  }, true);
}
let py = null;          // the Python functions, once loaded
let token = null;       // Spotify access token (kept in this tab only)
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
function redirectUri() {
  // The exact address of this page. It must be added to the Spotify app's redirect URIs.
  return location.origin + location.pathname.replace(/index\.html$/, "");
}

function randomString(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function base64url(buffer) {
  let text = "";
  for (const b of new Uint8Array(buffer)) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(text) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
}

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
  $("reportLink").href = reportUrl();
}

const REPORT_HINTS = ["mainReportHint", "removeReportHint", "loginReportHint", "connectionReportHint"];

function offerReport(hintId, rawError) {
  // An unexpected problem: remember it and show a "Report this problem" link next to the message.
  recordError(rawError);
  logStep("problem: " + lastErrorText.slice(0, 60));
  const link = $(hintId).querySelector("a");
  link.href = reportUrl();
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
  for (const [id, p] of remote) {
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
    if (remote.has(f.id) || !synced[f.id]) continue;
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
    const putCover = (entry) => { if (!entry.image && !saveState.coverQueue.includes(entry)) saveState.coverQueue.push(entry); };
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
        have.name = name;
        have.description = description;
        have.save = unpackFormat(description);
        synced[fmt.id] = { rev: fmt.rev || 0, playlistId: have.id };
        putCover(have);
      } else if (unreadOfIt) {
        await spotifyRequest("PUT", `/playlists/${unreadOfIt.id}`, { json: { name, description } });
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

// The cover of a backup playlist is a picture of a cloud with a check. It is sent once, to a playlist that has none, after the save is done, and it never makes a save wait:
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
      problem = { key: "permission", text: "Your Spotify sign-in does not include permission to add cover art, so the recipe playlists have no cover. Disconnect and connect again to allow it." };
    } else {
      let cover = null;
      try { cover = await loadCover("backup-cover.jpg"); }
      catch (err) { logStep("save: cover image not loaded"); problem = { key: "file", text: "The cover image for the recipe playlists (backup-cover.jpg) could not be loaded from this site, so they have no cover." }; }
      while (cover && saveState.coverQueue.length && backupMode() === "spotify" && connection === "ready") {
        const entry = saveState.coverQueue[0];
        if (entry.image) { saveState.coverQueue.shift(); continue; }
        try {
          await spotifyRequest("PUT", `/playlists/${entry.id}/images`, { body: cover, contentType: "image/jpeg", noWait: true });
          entry.image = "set";
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
  const choices = [{ label: "Back up now", value: "backup" }, { label: "Try again", value: "retry" }];
  if (unexpected) choices.push({ label: "Report this problem", value: "report" });
  choices.push({ label: "Close", value: "close" });
  const choice = await askSyncChoice("Your recipes couldn\u2019t be saved to Spotify",
    "Your latest changes haven\u2019t been saved to Spotify yet. A backup on this device keeps them safe.", choices, { detail: `What happened: ${saveFailureDetail(message)}` });
  if (choice === "backup") downloadBackup();
  else if (choice === "retry") { saveState.error = ""; runSpotifySave(); }
  else if (choice === "report") window.open(reportUrl(), "_blank", "noopener");
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

function refreshBackupCard() {
  const card = $("backupCard");
  if (!card) return;
  card.hidden = !backupCardOpen;
  card.classList.toggle("opened", backupCardOpen);
  // opened, it is a popup: with a backdrop, no scrolling of the page behind it, and what a screen reader needs to know
  $("backupBackdrop").hidden = !backupCardOpen;
  document.body.classList.toggle("backup-card-open", backupCardOpen);
  if (backupCardOpen) { card.setAttribute("role", "dialog"); card.setAttribute("aria-modal", "true"); card.setAttribute("aria-labelledby", "backupCardTitle"); }
  else { card.removeAttribute("role"); card.removeAttribute("aria-modal"); card.removeAttribute("aria-labelledby"); }
  const mode = backupMode();
  $("backupModeManual").checked = mode === "manual";
  $("backupModeSpotify").checked = mode === "spotify";
}

function openBackupCard() {
  backupCardOpen = true;
  refreshBackupCard();
  const chosen = $("backupModeManual").checked ? $("backupModeManual") : $("backupModeSpotify");
  chosen.focus({ preventScroll: true });   // the popup is on screen as it opens, and a keyboard starts on the choice
}

// The radio buttons only mark a choice. OK saves it and closes the card; Cancel, Escape and the backdrop close it and change nothing.
async function chooseBackupMode(value) {
  const was = backupMode();
  try { localStorage.setItem("backupMode", value); } catch (err) { /* private browsing */ }
  backupCardOpen = false;
  refreshBackupCard();
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
  const choice = await askSyncChoice("Remove the saved recipes from Spotify?",
    `${many ? "There are " + saves.length + " saved recipes" : "There is 1 saved recipe"} in Spotify, in private playlists ending in (recipe). Keep ${many ? "them" : "it"}, or remove ${many ? "them" : "it"}? Another device that saves to Spotify would lose ${many ? "them" : "it"} too.`,
    [{ label: many ? "Keep them" : "Keep it", value: "keep" }, { label: many ? "Remove them" : "Remove it", value: "remove", danger: true }]);
  if (choice !== "remove") { showBackupMessage(`The ${many ? "recipes" : "recipe"} saved in Spotify ${many ? "were" : "was"} left as ${many ? "they are" : "it is"}.`, false, offer); return; }
  try {
    const ids = saves.map((p) => p.id);
    for (let i = 0; i < ids.length; i += REMOVE_CHUNK) {
      await spotifyRequest("DELETE", "/me/library", { params: { uris: ids.slice(i, i + REMOVE_CHUNK).map((id) => "spotify:playlist:" + id).join(",") } });
    }
    playlists = playlists.filter((p) => !ids.includes(p.id));
    showBackupMessage(`Removed ${plural(ids.length, "saved recipe")} from Spotify. Your recipes are now saved only in this browser.`, false, offer);
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
  // Reset app on this device: with Spotify as the way, the formats come back from Spotify, not from a file
  for (const [id, text] of [["clearRestoreHelp", "Recipes saved to Spotify stay there, and connecting to Spotify again brings them back."], ["clearConfirmHelp", "Recipes saved to Spotify stay there, and connecting to Spotify again brings them back."]]) {
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
  refreshBackupCard();
  const trigger = $("feAppMenuButton");
  if (trigger) trigger.focus({ preventScroll: true });   // back to where the person came from
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
  // Reset app on this device: what would be lost, so a backup can be made first.
  if (backupMode() === "spotify") { $("clearBackupNote").textContent = "Your recipes are saved to Spotify, and resetting the app on this device does not remove them."; return; }
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
  if (typeof showNotices === "function") showNotices([{ text, icon: warn ? "warn" : "device", warn, hold: warn || actions.length > 0, actions, transient: true }]);
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
  return [$("formats").value, selectedKeys().join(","), $("maxPlaylists").value].join("\u0000");
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

async function clearSavedData() {
  // The Client ID goes to the clipboard first (while the click still counts), so connecting again is a paste (the More options text says so).
  const savedId = localStorage.getItem("clientId");
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
  const buildAll = $("buildAll");   // a page older than this script may not have it, and that must not stop the rest
  if (buildAll) buildAll.disabled = !(!!token && connection === "ready" && !!py && formatsValid && !busy && currentFormats.length > 0);
  $("removeOld").disabled = !ready || !$("removeKey").value;
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
  if (buildAll && paused) buildAll.disabled = true;
  if (minimalActive() && (signingIn || connection === "connecting" || signInNote)) {
    $("spotifyNote").textContent = signingIn ? signInNote : connection === "connecting" ? "Connecting to Spotify. On a slow connection this can take a few seconds." : signInNote;
    $("spotifyNote").hidden = false;
  }
  refreshReconnectScreen();
}

// On the app page with no working sign-in (it ran out and could not be renewed, or Disconnect), nothing that needs Spotify works, so the app dims behind
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

// Spotify's free developer app now needs Premium on the account that owns it. Without it, Spotify refuses requests with a 403 that says so.
const PREMIUM_REQUIRED_MESSAGE = "Spotify says the account that owns this Client ID needs Premium. A free Spotify account will not work. Once that account has Premium, try again.";
const CREATE_NEEDS_SPOTIFY = "Building playlists needs a working connection to Spotify.";

function setConnection(state, message = "", kind = "retry") {
  connectionKind = kind;
  // kind says what can fix a problem: "retry" (waiting, or the network) or "reconnect" (the sign-in itself)
  connection = state;
  $("connectedSection").hidden = !(state === "connecting" || state === "ready");
  $("disconnect").hidden = state !== "ready";   // there is nothing to disconnect from unless the connection works
  $("connectionProblem").hidden = state !== "problem";
  if (state === "problem") $("connectionMessage").textContent = message;
  $("connectionRetry").hidden = state === "problem" && kind === "reconnect";
  $("connectionReconnect").hidden = state === "problem" && kind !== "reconnect";
  updateButtons();
  if (typeof applyMinimalMode === "function") applyMinimalMode();   // minimalist mode steps aside while Step 1 has a problem to show
  if (typeof renderAppMenu === "function") renderAppMenu();
  if (typeof editorPlaylistsChanged === "function") editorPlaylistsChanged();
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
let createSucceeded = false;  // the playlists were all made, so the popup may offer Donate

function setCreateStage(stage) {
  createStage = stage;
  $("confirmButtons").hidden = stage !== "question";
  $("bdBusyRow").hidden = stage !== "planning" && stage !== "creating";
  setLabel($("bdBusy"), stage === "creating" ? "Building…" : "Planning…");
  $("createCloseRow").hidden = stage !== "done";
  $("createDonate").hidden = stage !== "done" || !createSucceeded;   // only after a success, never beside an error or a problem
}

function openCreateDialog(keys) {
  // The header: one recipe shows its name, its bar and its length; several just say how many.
  $("bdTitle").textContent = keys.length === 1 ? formatLabel(keys[0]) : `Build ${plural(keys.length, "recipe")}`;
  const f = keys.length === 1 && editor.model ? editor.model.formats.find((x) => x.id === keys[0]) : null;
  const bar = $("bdShape"), info = $("bdShapeInfo");
  bar.textContent = info.textContent = "";
  bar.hidden = info.hidden = !f;
  if (f) {
    const { pieces, music, quiet } = recipeShape(f);
    for (const piece of pieces) {
      const span = Object.assign(document.createElement("span"), { className: "bd-shape-piece" + (piece.silence ? " bd-shape-silence" : "") });
      span.style.cssText = piece.style;
      bar.appendChild(span);
    }
    const silence = quiet ? ` + ${quiet < 60 ? `${quiet} sec` : lengthText(quiet / 60)} of silence` : "";
    info.append(Object.assign(document.createElement("b"), { textContent: lengthText(music) }), ` of music${silence} · ${plural(f.items.length, "segment")}`);
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
  $("planText").hidden = true;
  $("planText").textContent = "";
  $("createNotes").hidden = true;
  $("createSupport").hidden = true;
  $("createOpen").hidden = true;
}

// Small drawings, all made here so they follow the theme's colors.
const BD_ICON = {
  done: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="var(--accent)"/><path d="M4.5 8.2l2.3 2.3 4.7-4.9" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  fail: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="var(--danger)"/><path d="M5.3 5.3l5.4 5.4M10.7 5.3l-5.4 5.4" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>',
  now: '<svg class="bd-spin" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="var(--line)" stroke-width="2.2" fill="none"/><path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" stroke="var(--accent)" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>',
  wait: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="var(--muted)" stroke-width="1.5" fill="none" stroke-dasharray="2 2.4"/></svg>',
  num: (n) => `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7.2" stroke="var(--muted)" stroke-width="1.2" fill="none"/><text x="8" y="11.4" text-anchor="middle" font-size="${n > 9 ? 7.5 : 9.5}" font-family="system-ui, sans-serif" fill="var(--muted)">${n}</text></svg>`,
  warn: '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M9 1.8l7.6 13.4H1.4z" fill="#f59e0b"/><path d="M9 7v3.8" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><circle cx="9" cy="13" r="1" fill="#fff"/></svg>',
  replace: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/></svg>',
  rename: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  copy: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  shared: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/></svg>',
  music: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  err: '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="8.2" fill="var(--danger)"/><path d="M9 4.8v5" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/><circle cx="9" cy="12.9" r="1.1" fill="#fff"/></svg>',
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
  // state: a number (its place in the plan), "wait", "now", "done" or "fail". note replaces the songs and length; a playlist waiting to be built shows neither.
  const { p, ic, meta } = li.bd;
  ic.innerHTML = typeof state === "number" ? BD_ICON.num(state) : BD_ICON[state];
  li.classList.toggle("bd-wait", state === "wait");
  li.classList.toggle("bd-now", state === "now");
  meta.textContent = note || (state !== "wait" && p.songs != null ? `${plural(p.songs, "song")} · ${lengthText(p.length != null ? p.length : p.minutes)}` : "");
}

function setTally(made, total, status, now) {
  // While building, at the top of the popup: how many playlists are made, a tile for each (lit when made, breathing while under way), and what is happening.
  const count = $("bdCount");
  count.textContent = "";
  count.classList.toggle("bd-count-one", total === 1);
  if (total === 1) count.textContent = "Building your playlist";   // "0 of 1 playlist" reads oddly
  else count.append(Object.assign(document.createElement("b"), { textContent: String(made) }), Object.assign(document.createElement("span"), { textContent: `of ${total} playlists` }));
  $("bdCountNote").textContent = status;
  const tiles = $("bdTiles");
  tiles.hidden = total < 2;   // one tile alone says nothing
  while (tiles.children.length < total) tiles.appendChild(Object.assign(document.createElement("span"), { className: "bd-tile" }));
  Array.from(tiles.children).forEach((tile, i) => { tile.className = "bd-tile" + (i < made ? " bd-on" : i === made && now ? " bd-now" : ""); });
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
  // After a build: the covers fanned out with a glow behind them and confetti, how many playlists and how much music (counting up), and a tile for each
  // that ripples once. It plays once, about two seconds, then holds still; with reduced motion it simply appears.
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
  if (made > 1) {
    const tiles = el("div", "bd-tiles bd-ripple");
    tiles.setAttribute("aria-hidden", "true");
    const step = Math.min(45, 900 / made);   // the ripple crosses in under a second however many there are
    for (let i = 0; i < made; i++) {
      const tile = el("span", "bd-tile bd-on");
      tile.style.animationDelay = `${Math.round(700 + i * step)}ms`;
      tiles.appendChild(tile);
    }
    box.appendChild(tiles);
  }
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

function problemCard(title, items, className = "bd-err") {
  // A card with a title and, below it, sentences in a list. items are [bold part, rest].
  const card = Object.assign(document.createElement("div"), { className: "bd-card " + className });
  const head = Object.assign(document.createElement("div"), { className: "bd-ct" });
  head.innerHTML = className === "bd-err" ? BD_ICON.err : BD_ICON.warn;
  head.appendChild(document.createTextNode(title));
  card.appendChild(head);
  if (items.length) {
    const ul = Object.assign(document.createElement("ul"), { className: "bd-problems" });
    for (const [bold, rest] of items) {
      const li = document.createElement("li");
      if (bold) putNamed(li.appendChild(document.createElement("b")), bold);
      if (rest) putNamed(li, (bold ? " " : "") + rest);
      ul.appendChild(li);
    }
    card.appendChild(ul);
  }
  return card;
}

function showPlanProblems(items, recipes) {
  // Nothing can be built: every reason at once, each with what to do about it.
  setOutput("");
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
  const card = problemCard(problem.title, []);
  putNamed(card.appendChild(Object.assign(document.createElement("p"), { className: "bd-small" })), `${what} ${problem.advice}${again}`);
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

async function startLogin() {
  if (signingIn) return;
  const clientId = $("clientId").value.trim();
  if (!clientId) {
    setLoginMessage("Paste your Client ID first.");
    return;
  }
  localStorage.setItem("clientId", clientId);
  setSigningIn(true, "Opening Spotify. On a slow connection this can take a few seconds.");
  clearReportHints("loginReportHint");
  logStep("sign-in started");
  const verifier = randomString(96);
  const state = randomString(24);
  sessionStorage.setItem("pkceVerifier", verifier);
  sessionStorage.setItem("pkceState", state);
  let challenge;
  try { challenge = base64url(await sha256(verifier)); } catch (err) { setSigningIn(false); setLoginMessage("This browser could not start the sign-in: " + String(err && err.message || err)); return; }
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  });
  // if Spotify has not opened after this long, say so, so the buttons are not left waiting for good
  signInTimer = setTimeout(() => {
    if (!signingIn) return;
    setSigningIn(false);
    signInNote = "Spotify did not open. Check your connection, then try again.";
    setLoginMessage(signInNote);
    updateButtons();
  }, 30000);
  location.href = "https://accounts.spotify.com/authorize?" + params.toString();
}

async function finishLoginIfReturning() {
  const params = new URLSearchParams(location.search);
  if (!params.has("code") && !params.has("error")) return;
  history.replaceState({}, "", redirectUri());  // tidy the address bar

  if (params.has("error")) {
    revealLoginProblem();
    setLoginMessage("Spotify did not approve the sign-in: " + params.get("error"));
    return;
  }
  if (params.get("state") !== sessionStorage.getItem("pkceState")) {
    revealLoginProblem();
    setLoginMessage("The sign-in did not match this tab. Please try Connect again.");
    return;
  }
  const response = await fetchWithAnswerLimit("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.get("code"),
      redirect_uri: redirectUri(),
      client_id: localStorage.getItem("clientId") || "",
      code_verifier: sessionStorage.getItem("pkceVerifier") || "",
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    revealLoginProblem();
    setLoginMessage("Spotify refused the sign-in: " + (data.error_description || data.error || response.status));
    offerReport("loginReportHint", "Spotify refused the sign-in: " + (data.error || response.status));
    return;
  }
  keepToken(data);
}

// The sign-in lasts between visits. Spotify's sign-in also gives a refresh token, kept in this browser with the Client ID it belongs to, so a sign-in that
// has run out (after an hour, or when the tab was closed) is renewed in the background, without leaving the page. Disconnect and Reset remove it. When
// Spotify refuses it (access removed in Spotify, or too old), the person reconnects.
const REFRESH_KEY = "spotifyRefresh";
function storedRefresh() {
  try {
    const saved = JSON.parse(localStorage.getItem(REFRESH_KEY) || "null");
    return saved && saved.token && saved.clientId === (localStorage.getItem("clientId") || "") ? saved : null;
  } catch (err) { return null; }
}
function keepRefresh(value, scope) {
  try {
    if (value) localStorage.setItem(REFRESH_KEY, JSON.stringify({ token: value, scope: scope || "", clientId: localStorage.getItem("clientId") || "" }));
    else localStorage.removeItem(REFRESH_KEY);
  } catch (err) { /* then the next visit asks to reconnect */ }
}
function keepToken(data) {
  const scope = data.scope || (storedRefresh() || {}).scope || "";   // a renewal may leave out the permissions, which stay as they were
  sessionStorage.setItem("token", JSON.stringify({ value: data.access_token, expires: Date.now() + data.expires_in * 1000, scope }));
  if (data.refresh_token) keepRefresh(data.refresh_token, scope);   // Spotify may send a new one each time; the old one then stops working
}
let renewing = null;
function renewSignIn() {
  // Gives the new access token, or null. One renewal at a time: requests that find the sign-in expired together wait for the same one.
  const saved = storedRefresh();
  if (!saved) return Promise.resolve(null);
  if (!renewing) renewing = (async () => {
    try {
      const response = await fetchWithAnswerLimit("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: saved.token, client_id: localStorage.getItem("clientId") || "" }),
      });
      let data = {};
      try { data = await response.json(); } catch (err) { /* no body */ }
      if (!response.ok || !data.access_token) {
        if (response.status === 400 || response.status === 401) keepRefresh(null);   // refused for good: reconnecting is the only way
        logStep("sign-in renewal refused");
        return null;
      }
      keepToken(data);
      const renewed = loadStoredToken();
      logStep(renewed ? "sign-in renewed" : "sign-in renewed without every permission");
      return renewed;
    } catch (err) {
      logStep("sign-in renewal: no answer");   // the refresh token is kept, for when the connection is back
      return null;
    } finally {
      renewing = null;
    }
  })();
  return renewing;
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

function loadStoredToken() {
  try {
    const saved = JSON.parse(sessionStorage.getItem("token") || "null");
    if (saved && saved.expires > Date.now() + 30000) {
      const granted = String(saved.scope || "").split(/\s+/);
      if (REQUIRED_SCOPES.every((s) => granted.includes(s))) return saved.value;
      sessionStorage.removeItem("token");  // an older, read-only sign-in
      needsReconnect = true;
    }
  } catch (err) { /* ignore */ }
  return null;
}

// Disconnecting signs out on this device and deletes the songs the app keeps of the playlists, which are only there to make building quicker. It asks first, and says what
// is not touched, because the second part is easy to take for something worse than it is.
async function confirmDisconnect() {
  const choice = await askSyncChoice("Disconnect from Spotify?",
    "This signs you out of Spotify on this device. Your recipes are not touched. The next time you build, this app reads your playlists from Spotify again, which takes a little longer.",
    [{ label: "Disconnect", value: "yes" }, { label: "Cancel", value: "no" }], { focusLast: true });
  if (choice === "yes") await disconnect();
}

async function disconnect() {
  sessionStorage.removeItem("token");
  keepRefresh(null);
  try { localStorage.removeItem(KEPT_PLAYLISTS_KEY); } catch (err) { /* private browsing */ }
  await Promise.race([forgetAllSongs(), new Promise((r) => setTimeout(r, 1500))]);   // the songs kept from this account go with the sign-in
  location.reload();
}

// ---------------------------------------------------------------- talking to Spotify
const RETRY_BUDGET_MS = 30000;   // the most the app will spend waiting out short rate limits in one request
let addChunk = ADD_CHUNK;   // lowered for the visit if Spotify refuses that many
let retrySleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function problemKind(message) {
  if (/request quota/.test(message)) return "quota";
  if (/rate limiting/.test(message)) return "rate-limit";
  if (/Could not reach Spotify|Spotify did not answer/.test(message)) return "network";
  if (/sign-in expired|did not allow/.test(message)) return "sign-in";
  if (/needs Premium/.test(message)) return "premium";
  return "other";
}

function rateLimitError(wait, reason) {
  // wait: seconds Spotify asked for, or null when the page could not read it (browsers only show a page the headers a server lists as readable)
  const message = reason === "QUOTA_EXCEEDED"
    ? (wait ? `Spotify has reached the request quota for your developer account. Waiting is the only fix: try again in about ${waitText(wait)}.` : "Spotify has reached the request quota for your developer account. Waiting is the only fix, and Spotify did not say how long to wait.")
    : (wait ? `Spotify is rate limiting requests. Try again in about ${waitText(wait)}.` : "Spotify is rate limiting requests and did not say how long to wait. Try again in a few minutes.");
  const error = new Error(message);
  error.retryAfter = wait;
  error.reason = reason;
  return error;
}

// ---------------------------------------------------------------- a record of Spotify's limits
// Spotify does not publish its limits, and a page cannot read how long Spotify asks it to wait (the Retry-After header is not exposed to browsers). So the app keeps
// its own record, in this browser only: how many requests went out each minute (8 days kept), and each time Spotify refused, what had been sent before it, the
// last time it still refused and the first time it answered again. Nothing here leaves the browser, except that the app's owner is offered a copy (OWNER_CLIENT_HASHES).
const CALLS_KEY = "spotifyCalls";      // {minute: {kind: count}}, minute = Date.now() / 60000
const LIMITS_KEY = "spotifyLimits";    // [{at, what, kind, reason, sent30s, sent10m, sent1h, sent24h, refusedAgain, lastRefusedAt, clearedAt}] or [{at, note}]
const CALLS_KEPT_MIN = 8 * 24 * 60;
const recentCalls = [];                // times of the requests of the last minute, for the 30-second count

function readRecord(key, empty) {
  try { const v = JSON.parse(localStorage.getItem(key) || "null"); return v && typeof v === "object" ? v : empty; } catch (err) { return empty; }
}
function writeRecord(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* private browsing, or full */ }
}

function callKind(method, path) {
  const p = path.replace(SPOTIFY_API, "").split("?")[0];
  if (/\/images$/.test(p)) return "cover";
  if (/\/items$/.test(p)) return method === "GET" ? "read" : "add";
  if (method === "POST" && p === "/me/playlists") return "create";
  if (method === "DELETE") return "remove";
  if (method === "PUT") return "change";
  return "read";
}

function countCall(kind) {
  const now = Date.now();
  recentCalls.push(now);
  while (recentCalls.length && recentCalls[0] < now - 60000) recentCalls.shift();
  const calls = readRecord(CALLS_KEY, {});
  const minute = Math.floor(now / 60000);
  const slot = calls[minute] || (calls[minute] = {});
  slot[kind] = (slot[kind] || 0) + 1;
  for (const m of Object.keys(calls)) if (Number(m) < minute - CALLS_KEPT_MIN) delete calls[m];
  writeRecord(CALLS_KEY, calls);
}

function callsSince(ms) {
  const from = Math.floor((Date.now() - ms) / 60000);
  let n = 0;
  for (const [m, kinds] of Object.entries(readRecord(CALLS_KEY, {}))) if (Number(m) >= from) for (const c of Object.values(kinds)) n += c;
  return n;
}

function recordRefusal(method, path, reason) {
  const limits = readRecord(LIMITS_KEY, []);
  const open = limits.length && !limits[limits.length - 1].note && !limits[limits.length - 1].clearedAt ? limits[limits.length - 1] : null;
  const now = Date.now();
  if (open) { open.refusedAgain = (open.refusedAgain || 0) + 1; open.lastRefusedAt = now; }
  else {
    limits.push({
      at: now, what: `${method} ${path.replace(SPOTIFY_API, "").split("?")[0].replace(/\/[A-Za-z0-9]{22}(?=\/|$)/g, "/{id}")}`, kind: callKind(method, path), reason: reason || "",
      sent30s: recentCalls.filter((t) => t >= now - 30000).length, sent10m: callsSince(600000), sent1h: callsSince(3600000), sent24h: callsSince(86400000),
      refusedAgain: 0, lastRefusedAt: now, clearedAt: null,
    });
  }
  writeRecord(LIMITS_KEY, limits.slice(-100));
}

function recordAnswered() {
  const limits = readRecord(LIMITS_KEY, null);
  const last = limits && limits.length ? limits[limits.length - 1] : null;
  if (!last || last.note || last.clearedAt) return;
  last.clearedAt = Date.now();
  writeRecord(LIMITS_KEY, limits);
}

function recordNote(note) {
  const limits = readRecord(LIMITS_KEY, []);
  limits.push({ at: Date.now(), note });
  writeRecord(LIMITS_KEY, limits.slice(-100));
}

// ---------------------------------------------------------------- a long wait from Spotify
// When Spotify gives a wait of over a minute (its daily quota, say), the app keeps when it ends and sends Spotify nothing until then: whether asking
// during the wait makes it longer is not known. The line under the bar counts down (Details opens the popup), the Build button is hidden, recipes can
// still be edited (with the playlist list kept from the last visit), and when the time is up the app connects again by itself. The end is kept on the
// device with the Client ID it belongs to, so a reload or a later visit picks it up.
const PAUSE_KEY = "spotifyPausedUntil";   // {until, from, reason, clientId}: from is when the wait began, for the ring in the popup
const KEPT_PLAYLISTS_KEY = "spotifyPlaylists";   // {user, list}: the playlist list from the last time Spotify answered, for the menus during a wait
let pauseTimer = null;
let pauseOn = false;   // what the last tick saw, so the end of a wait is noticed once
function spotifyPause() {
  try {
    const p = JSON.parse(localStorage.getItem(PAUSE_KEY) || "null");
    if (p && p.until > Date.now() && p.clientId === (localStorage.getItem("clientId") || "")) {
      if (!p.from) { p.from = Date.now(); localStorage.setItem(PAUSE_KEY, JSON.stringify(p)); }   // a wait kept with no start: the ring empties from the first look at it
      return p;
    }
    if (p) localStorage.removeItem(PAUSE_KEY);
  } catch (err) { /* private browsing, or unreadable: no wait */ }
  return null;
}
function pausedSecondsLeft() {
  const p = spotifyPause();
  return p ? Math.max(1, Math.ceil((p.until - Date.now()) / 1000)) : 0;
}
function clockText(seconds) {
  // 22564 seconds is "6:16:04"
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
function startSpotifyPause(wait, reason) {
  const before = spotifyPause();
  const first = !before;
  try { localStorage.setItem(PAUSE_KEY, JSON.stringify({ until: Date.now() + wait * 1000, from: (before && before.from) || Date.now(), reason: reason || "", clientId: localStorage.getItem("clientId") || "" })); } catch (err) { /* private browsing: the wait lasts this visit */ }
  logStep(`paused for ${wait} s`);
  tickPause();
  updateButtons();
  // when a wait starts, the popup explains; not over the build popup, which says it already
  if (first && $("createOverlay").hidden && typeof showPauseDialog === "function") showPauseDialog();
}
function tickPause() {
  clearTimeout(pauseTimer);
  pauseTimer = null;
  const left = pausedSecondsLeft();
  if (typeof refreshPauseViews === "function") refreshPauseViews(left);   // the line under the bar and the popup
  if (left) {
    pauseOn = true;
    pauseTimer = setTimeout(tickPause, 1000);
    return;
  }
  if (!pauseOn) return;
  pauseOn = false;   // the time is up: connect again, and save what waited
  logStep("wait over");
  updateButtons();
  if (token && connection !== "ready" && connection !== "connecting") connectToSpotify().then(() => { if (connection === "ready") scheduleSpotifySave(500); });
  else if (connection === "ready") scheduleSpotifySave(500);
}

function keepPlaylists() {
  try {
    const list = playlists.map((p) => ({ id: p.id, name: p.name, owner: p.owner, collaborative: p.collaborative, image: p.image, count: p.count, madeByApp: p.madeByApp, isSave: p.isSave }));
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

// Spotify's wait, through the relay. A page cannot read Retry-After, so after a rate limit with no readable wait the app sends one GET through
// a small Cloudflare Worker (cloudflare/retry-after.js) that can. It carries only the sign-in and which kind of request was refused (Spotify limits
// each kind on its own: /me answered while /me/playlists was refused), and answers with only the status, the wait and the reason.
// Requests of one kind that are refused together share one ask, and an answer is reused for 30 seconds (counted down).
const WAIT_RELAY_URL = "https://spotify-wait.roncarmel.workers.dev";
let waitRelayMs = 5000;
const waitAsked = { at: 0, result: null, pending: null, path: "" };
function relayPath(url) {
  // the refused request's kind, as a read the relay may send: "/playlists/ID/items" from POST .../items?x=1, "/me" when nothing fits
  const path = url.replace(SPOTIFY_API, "").split("?")[0];
  return /^\/(me|me\/playlists|playlists\/[A-Za-z0-9]{22}(\/items|\/images)?)$/.test(path) ? path : "/me";
}
async function askSpotifyWait(url = SPOTIFY_API + "/me") {
  if (!WAIT_RELAY_URL) return null;
  const path = relayPath(url);
  if (waitAsked.path !== path) Object.assign(waitAsked, { path, at: 0, result: null, pending: null });
  if (waitAsked.pending) return waitAsked.pending;
  if (waitAsked.at && Date.now() - waitAsked.at < 30000) {   // no answer counts too: the relay is not asked again for 30 seconds
    const r = waitAsked.result;
    return r && r.wait ? { ...r, wait: Math.max(1, r.wait - Math.floor((Date.now() - waitAsked.at) / 1000)) } : r;
  }
  waitAsked.pending = (async () => {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), waitRelayMs);
    let result = null;
    try {
      countCall("relay");
      const response = await fetch(WAIT_RELAY_URL + "?path=" + encodeURIComponent(path), { headers: { Authorization: "Bearer " + token }, signal: stop.signal });
      if (response.ok) { const data = await response.json(); result = { status: data.status, wait: Number(data.retryAfter) > 0 ? Number(data.retryAfter) : null, reason: data.reason || "" }; }
    } catch (err) { /* the relay is down or slow: the message says no time, as before */ }
    finally { clearTimeout(timer); }
    logStep(result ? `wait asked: ${result.status}${result.wait ? ", " + result.wait + " s" : ""}` : "wait asked: no answer");
    const limits = readRecord(LIMITS_KEY, []);
    const open = limits.length && !limits[limits.length - 1].note && !limits[limits.length - 1].relay ? limits[limits.length - 1] : null;
    if (open) { open.relay = result ? { at: Date.now(), path: path.replace(/[A-Za-z0-9]{22}/, "{id}"), status: result.status, retryAfter: result.wait, reason: result.reason } : { at: Date.now(), status: "no answer" }; writeRecord(LIMITS_KEY, limits); }
    if (waitAsked.path === path) Object.assign(waitAsked, { at: Date.now(), result, pending: null });   // a later ask of another kind replaced this one
    return result;
  })();
  return waitAsked.pending;
}

// The owner's Client ID, as a SHA-256 hash so it is not in the page's source. Only there is the record offered for copying.
const OWNER_CLIENT_HASHES = [];
let isOwnerHere = false;
async function checkOwner() {
  try {
    const id = (localStorage.getItem("clientId") || "").trim();
    if (!id || !OWNER_CLIENT_HASHES.length || !(window.crypto && crypto.subtle)) return false;
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id)));
    isOwnerHere = OWNER_CLIENT_HASHES.includes(Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join(""));
  } catch (err) { isOwnerHere = false; }
  return isOwnerHere;
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
  catch (err) { showNotices([{ text: "The record could not be copied.", transient: true }]); return; }
  try { localStorage.setItem("spotifyRecordCopiedAt", String(Date.now())); } catch (err) { /* private browsing */ }
  if (typeof clearHeldNotice === "function") clearHeldNotice();
  showNotices([{ text: "Spotify record copied. Paste it into the chat with Claude.", transient: true }]);
}

// For the owner: once connected, a held message offers the record when Spotify has refused since the last copy, or a week has passed with requests sent.
async function offerLimitRecord() {
  if (!(await checkOwner())) return;
  if (typeof renderAppMenu === "function") renderAppMenu();
  const copiedAt = Number(localStorage.getItem("spotifyRecordCopiedAt")) || 0;
  const refusals = readRecord(LIMITS_KEY, []).filter((e) => !e.note && e.at > copiedAt).length;
  const weekOld = Date.now() - copiedAt > 7 * 86400000 && Object.keys(readRecord(CALLS_KEY, {})).some((m) => Number(m) * 60000 > copiedAt);
  if (!refusals && !weekOld) return;
  if (typeof notices !== "undefined" && notices.held) return;   // a held message (a newer version) comes first
  const text = refusals ? `Spotify refused requests ${refusals === 1 ? "once" : refusals + " times"} since the last copy of the record.` : "A week of Spotify request counts is ready to copy.";
  showNotices([{ text, icon: "copy", hold: true, actions: [{ label: "Copy", run: () => copyLimitRecord() }] }]);
}

// A request to Spotify that gets no answer at all (a stalled connection) fails after this long, instead of waiting for the browser to give up.
let spotifyAnswerMs = 30000;
const NO_ANSWER = "Spotify did not answer. Check your internet connection and try again.";

async function fetchWithAnswerLimit(url, init) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), spotifyAnswerMs);
  try {
    return await fetch(url, { ...init, signal: stop.signal });
  } catch (err) {
    if (stop.signal.aborted) throw new Error(NO_ANSWER);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function spotifyRequest(method, path, { params, json, body, contentType, noWait } = {}) {   // noWait: a rate limit is not waited out, it is an error at once
  let url = path.startsWith("http") ? path : SPOTIFY_API + path;
  if (params) url += (url.includes("?") ? "&" : "?") + new URLSearchParams(params).toString();
  const what = `${method} ${path.split("?")[0]}`;
  let waitedMs = 0;
  let lastWait = null;   // the last wait Spotify gave that could be read
  let renewedHere = false;
  const paused = spotifyPause();
  if (paused) throw rateLimitError(pausedSecondsLeft(), paused.reason);   // nothing goes to Spotify until the wait is over
  for (let attempt = 0; attempt < 5; attempt++) {
    let response;
    try {
      response = await fetchWithAnswerLimit(url, {
        method,
        headers: { Authorization: "Bearer " + token, ...(json ? { "Content-Type": "application/json" } : (contentType ? { "Content-Type": contentType } : {})) },
        body: json ? JSON.stringify(json) : body,
      });
    } catch (err) {
      throw new Error(err.message === NO_ANSWER ? NO_ANSWER : "Could not reach Spotify. Check your internet connection and try again.");
    }
    countCall(callKind(method, url));
    if (response.status === 429) {
      const header = Number(response.headers.get("Retry-After"));
      let wait = header > 0 ? header : null;
      let reason = "";
      try { const data = JSON.parse(await response.text()); reason = (data && data.error && data.error.reason) || ""; } catch (err) { /* no body, or not JSON */ }
      recordRefusal(method, url, reason);
      // the browser hides Retry-After, so Spotify is asked through the relay (not for cover uploads, which have their own limit that /me does not show)
      if (!wait && !noWait) {
        const asked = await askSpotifyWait(url);
        if (asked && asked.status === 429) { wait = asked.wait; if (!reason) reason = asked.reason; }
      }
      if (wait) lastWait = wait;
      // A quota limit, or a wait over a minute, is not worth sitting through: stop at once and say what is known.
      if (wait && wait > 60 && !noWait) startSpotifyPause(wait, reason);   // cover uploads have their own limit, which says nothing about the rest
      if (reason === "QUOTA_EXCEEDED" || (wait && wait > 60) || noWait) throw rateLimitError(wait || lastWait, reason);
      const pause = (wait || 2) * 1000 + 500;
      if (waitedMs + pause > RETRY_BUDGET_MS) break;
      await retrySleep(pause);
      waitedMs += pause;
      continue;
    }
    recordAnswered();
    if (response.status === 401) {
      if (!renewedHere) {   // the sign-in ran out: renew it in the background and send this once more
        renewedHere = true;
        const renewed = await renewSignIn();
        if (renewed) { token = renewed; attempt -= 1; continue; }
      }
      const message = "Your Spotify sign-in expired. Click Connect again.";
      if (connection === "ready") setConnection("problem", message, "reconnect");   // from here on nothing that needs Spotify is offered
      throw new Error(message);
    }
    if (response.status === 403) {   // one refused request (a playlist you cannot read, a missing permission) does not mean the connection is lost
      let body = "";
      try { body = await response.text(); } catch (err) { /* no body */ }
      if (/premium/i.test(body)) throw new Error(PREMIUM_REQUIRED_MESSAGE);   // reconnecting cannot fix this, so it gets its own message
      throw new Error(`Spotify did not allow this (${what}). Click Disconnect, then Connect again and approve every permission it asks for.`);
    }
    if (!response.ok) throw new Error(`Spotify returned ${response.status} for ${what}`);
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }
  throw rateLimitError(lastWait, "");
}

const spotify = (path) => spotifyRequest("GET", path);

function waitText(seconds) {
  // A wait as hours and minutes, rounded up to the next minute: 14689 seconds is "4 hours and 5 minutes".
  const total = Math.max(1, Math.ceil(seconds / 60));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const part = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (!hours) return part(minutes, "minute");
  return minutes ? `${part(hours, "hour")} and ${part(minutes, "minute")}` : part(hours, "hour");
}

function hasScope(name) {
  // Whether this sign-in was approved for a permission (the app asks for cover art as an extra, so older sign-ins may lack it).
  try {
    const saved = JSON.parse(sessionStorage.getItem("token") || "null");
    return !!saved && String(saved.scope || "").split(/\s+/).includes(name);
  } catch (err) { return false; }
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

async function pagedItems(path) {
  const items = [];
  let page = await spotify(path);
  for (;;) {
    items.push(...(page.items || []));
    if (!page.next) return items;
    page = await spotify(page.next);
  }
}

async function loadMyPlaylists() {
  me = await spotify("/me");
  const raw = await pagedItems("/me/playlists?limit=50");
  playlists = raw.filter(Boolean).map((p) => ({
    id: p.id,
    name: p.name,
    owner: p.owner && p.owner.id,
    collaborative: !!p.collaborative,
    image: Array.isArray(p.images) && p.images.length ? p.images[p.images.length - 1].url : null,   // Spotify lists the largest first
    count: p.tracks && typeof p.tracks.total === "number" ? p.tracks.total : (p.items && typeof p.items.total === "number" ? p.items.total : null),
    description: typeof p.description === "string" ? p.description : null,
    snapshot: typeof p.snapshot_id === "string" && p.snapshot_id ? p.snapshot_id : null,   // changes whenever the playlist does
  }));
  for (const p of playlists) p.madeByApp = typeof p.description === "string" && p.description.startsWith(APP_MARKER);
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
  const entries = await pagedItems(`/playlists/${id}/items?limit=50`);
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
  trackCache.set(id, tracks);
  await saveSongs({ id, snapshot, tracks, v: SONGS_VERSION, savedAt: Date.now() });
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
      $("pythonStatus").textContent = `Loading Python (${version}). The first time takes a little while...`;
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
      $("pythonStatus").textContent = `Ready. Python ${version} is running in your browser.`;
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
      $("removeKey").innerHTML = "";
      formatsValid = false;
      invalidatePlan();
    } else {
      fillFormatDropdown($("removeKey"), currentFormats, true);
      formatsValid = true;
    }
  } catch (err) {
    currentFormats = [];
    recordError(cleanError(err));
    $("removeKey").innerHTML = "";
    formatsValid = false;
    invalidatePlan();
  }
  updateButtons();
}

function playlistLimit() {
  const n = parseInt($("maxPlaylists").value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

let buildScope = null;   // the formats a build in progress is for, when it is not just the one being edited

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
  return choice === ALL_FORMATS ? currentFormats.map((f) => f.id) : [choice];
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---------------------------------------------------------------- actions: create, remove
async function gatherInputs() {
  // Works out which source playlists the chosen formats need and reads their songs. Returns null after showing why it cannot.
  const formatsText = $("formats").value;
  const wanted = selectedKeys();
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
  const tracks = {};
  for (const name of names) {
    if (!match.found[name]) continue;
    setOutput(`Reading songs from ${named(name)}…`);
    tracks[name] = await loadTracks(match.found[name]);
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

async function planSelected(startedWith) {
  // Works out the playlists for the chosen formats. Returns the plan, or null after saying why there isn't one.
  const inputs = await gatherInputs();
  if (!inputs) return null;
  setBuildSteps("plan");
  // Earlier playlists with names this plan uses: the ones this app made get replaced (or renamed, if the person keeps them), and the person's own get renamed
  // to "… (version a)" so the new playlists can have their names.
  const matching = JSON.parse(py.existingMatches(inputs.formatsText, JSON.stringify(inputs.keys), JSON.stringify(playlists), me.id));
  const madeByApp = new Set(playlists.filter((p) => p.madeByApp).map((p) => p.id));
  const marked = matching.filter((p) => madeByApp.has(p.id));
  setOutput("Planning…");
  const built = [];
  const problems = inputs.failedNotes.slice();
  for (const key of inputs.keys) {
    try {
      const plan = JSON.parse(py.buildPlaylists(inputs.formatsText, key, JSON.stringify(inputs.tracks), playlistLimit(), "[]"));
      if (!Array.isArray(plan.sources)) throw new Error("engine.py is out of date. Reload the page.");
      if (plan.playlists.length) built.push(plan);
      else problems.push(...shortProblems(plan, inputs.many));
    } catch (err) {
      recordError(cleanError(err));
      problems.push([`${named(formatLabel(key))} could not be planned.`, cleanError(err)]);
    }
  }
  if (planSignature() !== startedWith) {   // the user edited something while this was planning
    setOutput("");
    closeCreateDialog();
    return null;
  }
  const total = built.reduce((n, plan) => n + plan.playlists.length, 0);
  logStep(total ? `plan: ${plural(total, "playlist")} planned` : "plan: nothing can be created");
  if (!total) {
    showPlanProblems(problems, selectedKeys().length);
    return null;
  }
  setOutput("");
  const newNames = new Set(built.flatMap((b) => b.playlists.map((p) => normName(p.name))));
  const others = matching.filter((p) => !madeByApp.has(p.id) && newNames.has(normName(p.name)));   // only the ones in the way
  return { formatsText: inputs.formatsText, keys: inputs.keys, built, total, ours: marked, marked, others,
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

function showPlanRows(plan) {
  // The playlists about to be built, each with its songs and length. Ten at most; the rest are counted.
  clearResults();
  let shown = 0, hidden = 0;
  for (const b of plan.built) {
    if (plan.many) $("results").appendChild(groupRow(formatLabel(b.key), ""));
    b.playlists.forEach((p, i) => {
      if (shown < 10) { $("results").appendChild(playlistRow(p, i + 1)); shown += 1; } else hidden += 1;
    });
  }
  if (hidden) {
    const li = Object.assign(document.createElement("li"), { className: "bd-more" });
    const more = Object.assign(document.createElement("button"), { type: "button", className: "linklike", id: "bdShowAll", textContent: `and ${hidden} more` });
    more.onclick = () => {
      // the rest of the list, in its place
      li.remove();
      let n = 0;
      for (const b of plan.built) b.playlists.forEach((p, i) => { if (n++ >= 10) $("results").appendChild(playlistRow(p, i + 1)); });
    };
    li.appendChild(more);
    $("results").appendChild(li);
  }
}

function infoBox(icon, ...lines) {
  // One of the small boxes above the list of playlists: an icon, then its lines (elements or text).
  const box = Object.assign(document.createElement("div"), { className: "bd-info" });
  box.appendChild(Object.assign(document.createElement("span"), { className: "bd-info-ic", innerHTML: BD_ICON[icon] }));
  const text = document.createElement("div");
  for (const line of lines) {
    if (typeof line === "string") putNamed(text.appendChild(document.createElement("p")), line);
    else text.appendChild(line);
  }
  box.appendChild(text);
  $("bdInfo").appendChild(box);
  return text;
}

function sentence(text, link) {
  // A line of text with a link at its end.
  const p = document.createElement("p");
  putNamed(p, text + " ");
  if (link) p.appendChild(link);
  return p;
}

function linkButton(label, onClick) {
  const b = Object.assign(document.createElement("button"), { type: "button", className: "linklike", textContent: label });
  b.onclick = onClick;
  return b;
}

function detailsLink(more) {
  // "Details" opens the part of a box that is hidden at first, and "Hide details" closes it.
  more.hidden = true;
  more.classList.add("bd-info-more");
  const b = linkButton("Details", () => { revealSmoothly(more, more.hidden); b.textContent = more.hidden ? "Details" : "Hide details"; });
  return b;
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
  // What else the build does or found, each in its own box: earlier playlists, the person's own playlists in the way, songs listed more than once, songs in more than one source, and songs in more than one recording.
  $("bdInfo").textContent = "";
  if (plan.marked.length) {
    // Replacing is the usual thing, so the choice to keep them waits behind Details.
    const one = plan.marked.length === 1;
    const more = document.createElement("div");
    more.appendChild(Object.assign(document.createElement("p"), { textContent: `Replacing ${one ? "it" : "them"} is the usual choice, but you can keep the old ${one ? "one" : "ones"} if you like.` }));
    const label = document.createElement("label");
    const words = document.createElement("span");   // one piece of text beside the checkbox, so the label's gap does not split it
    putNamed(words, `Keep ${one ? "it" : "them"}, renamed to ${named(`\u2026 (version ${nextVersionLetter(plan.marked)})`)}`);
    label.append(keep, words);
    more.appendChild(label);
    infoBox("replace", sentence(`${plural(plan.marked.length, "earlier playlist")} from ${plan.many ? "these recipes" : "this recipe"} will be replaced.`, detailsLink(more)), more);
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
    infoBox("rename", sentence(one ? "One of your own playlists will be renamed to free its name." : `${plan.others.length} of your own playlists will be renamed to free their names.`, detailsLink(list)), list);
  }
  const repeats = plan.repeats || [];
  if (repeats.length) {
    const list = document.createElement("ul");
    for (const r of repeats) {
      for (const x of r.songs.slice(0, 10)) putNamed(list.appendChild(document.createElement("li")), `${x.label}: ${x.times} times${repeats.length > 1 ? ` in ${named(r.name)}` : ""}`);
      if (r.songs.length > 10) putNamed(list.appendChild(document.createElement("li")), `and ${r.songs.length - 10} more${repeats.length > 1 ? ` in ${named(r.name)}` : ""}`);
    }
    const text = repeats.length === 1
      ? `${named(repeats[0].name)} lists ${plural(repeats[0].songs.length, "song")} more than once. Each is used once.`
      : `${repeats.length} playlists list songs more than once. Each song is used once.`;
    infoBox("copy", sentence(text, detailsLink(list)), list);
  }
  const shared = Math.max(0, ...plan.built.map((b) => b.shared || 0));
  if (shared) infoBox("shared", `${plural(shared, "song")} ${shared === 1 ? "is" : "are"} in more than one of these playlists. Each is used once.`);
  const suspects = plan.suspects || [];
  if (suspects.length) {
    const more = document.createElement("div");
    more.appendChild(Object.assign(document.createElement("p"), { textContent: "Each recording (for example live and studio) counts as its own song, so more than one can be used." }));
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
    more.appendChild(list);
    infoBox("music", sentence(`${plural(suspects.length, "song")} ${suspects.length === 1 ? "has" : "have"} more than one recording.`, detailsLink(more)), more);
  }
}

function askToCreate(plan) {
  // Shows what the plan found and waits: "create", "cancel", or "stale" if something was edited meanwhile. With "create", plan.keep says whether to keep the earlier playlists.
  return new Promise((resolve) => {
    setOutput("");
    const summary = $("confirmText");
    summary.textContent = "Ready to build ";
    summary.appendChild(Object.assign(document.createElement("b"), { textContent: plural(plan.total, "playlist") }));
    summary.appendChild(document.createTextNode(plan.many ? ` for ${plural(plan.built.length, "recipe")}. ` : ". "));
    const whyLabel = plan.many ? "Why these numbers?" : `Why ${plan.total}?`;
    const why = Object.assign(document.createElement("button"), { type: "button", className: "linklike", id: "planToggle", textContent: whyLabel });
    summary.appendChild(why);
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
    const keep = Object.assign(document.createElement("input"), { type: "checkbox", id: "confirmKeepEarlier" });
    fillInfoBoxes(plan, keep);
    setLabel($("confirmYes"), `Build ${plural(plan.total, "playlist")}`);
    setLabel($("confirmNo"), "Cancel");
    showPlanRows(plan);
    fillWhyTable(plan);
    $("planText").hidden = true;
    $("confirmBox").hidden = false;
    setBuildSteps("build", false, true);
    setCreateStage("question");
    const finish = (answer) => {
      openQuestion = null;
      plan.keep = keep.checked;
      $("confirmBox").hidden = true;
      $("planText").hidden = true;
      $("planText").textContent = "";
      $("bdInfo").textContent = "";
      for (const id of ["confirmYes", "confirmNo"]) $(id).onclick = null;
      if (answer === "create") setCreateStage("creating");   // from this moment it cannot be dismissed
      resolve(answer);
    };
    openQuestion = finish;
    $("confirmYes").onclick = () => finish("create");
    $("confirmNo").onclick = () => finish("cancel");
    why.onclick = () => {
      revealSmoothly($("planText"), $("planText").hidden);
      why.textContent = $("planText").hidden ? whyLabel : "Hide";
    };
  });
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
  createSucceeded = false;
  const wanted = selectedKeys();
  openCreateDialog(wanted);
  setBuildSteps("read");
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
    setBusy(false);
    if (!$("createOverlay").hidden) setCreateStage("done");
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
  // The same list as the plan, now all of it, each row ticked off as it is made.
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
  // The count stays at the top while the list scrolls, and the list keeps the row being built in view, until the person scrolls it themselves.
  const body = $("createDialog").querySelector(".bd-body");
  let follow = true;
  const stopFollowing = () => { follow = false; };
  for (const type of ["wheel", "touchmove", "keydown"]) body.addEventListener(type, stopFollowing, { passive: true });
  const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const show = (row) => {
    if (!follow || !row.scrollIntoView) return;
    body.style.scrollPaddingTop = `${$("bdTally").offsetHeight}px`;   // so the row is not hidden behind the count
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
      const made = await spotifyRequest("POST", "/me/playlists", { json: { name: p.name, public: false, description: `${APP_MARKER} from the recipe ${p.label}. Please leave this description as it is: the app uses it to recognize the playlists it made.` } });
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
    if (coverBlocked) notes.push("The cover art was not added, because your Spotify sign-in does not include permission to upload images. Click Disconnect, then Connect again to allow it. Playlists you build after that will get the cover.");
    else if (coverUnloaded) notes.push("The cover art could not be loaded, so the playlists have Spotify's default cover.");
    else if (coverFailed) notes.push(`Spotify would not accept the cover art for ${plural(coverFailed, "playlist")}.`);
    createSucceeded = created > 0;
    if (created > 0) countEvent("playlists-created", String(created));
    await glideToTop(body);   // the finale plays at the top, so it starts once the list is back there
    showFinale(created, planned.slice(0, created).reduce((n, p) => n + (p.minutes || 0), 0));
    // The first new playlist, at its ordinary Spotify address: on a phone it opens the Spotify app when it is installed, on a computer the web player, which offers the app.
    if (createdIds.length) $("createOpenLink").href = `https://open.spotify.com/playlist/${createdIds[0]}`;
    $("createOpen").hidden = !createdIds.length;
    const showNotes = () => { $("createNotes").textContent = notes.join("\n\n"); $("createNotes").hidden = !notes.length; };
    showNotes();
    $("createSupport").hidden = donateHiddenChoice();   // someone who hid the Donate button is not asked again
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
    body.scrollTop = 0;   // the result, or what went wrong, is at the top
  }
}

function askToRemove(marked, others, label) {
  // Resolves with the playlists to remove, or null when cancelled.
  return new Promise((resolve) => {
    const box = $("removeConfirmBox");
    let include = false;
    const many = others.length !== 1;
    const draw = () => {
      const total = marked.length + (include ? others.length : 0);
      fillConfirmList("removeConfirmList", "removeConfirmText",
        marked.length ? `Remove ${plural(marked.length, "playlist")} made by this app from your library? They match the naming pattern of ${label}.` : `No playlists made by this app match the naming pattern of ${label}.`,
        marked.map((p) => p.name));
      fillConfirmList("removeConfirmMoreList", "removeConfirmMoreText",
        !others.length ? ""
          : include ? `${plural(others.length, "playlist")} with matching names ${many ? "were" : "was"} not made by this app, and will be removed too because you chose to remove ${many ? "them" : "it"}:`
          : `${plural(others.length, "playlist")} with matching names ${many ? "were" : "was"} not made by this app (older ones, or ones whose description was changed), so ${many ? "they" : "it"} will not be touched:`,
        others.map((p) => p.name));
      $("removeToggleRow").hidden = others.length === 0;
      $("removeToggle").checked = include;
      $("removeToggleLabel").textContent = `Remove ${many ? "them" : "it"} too`;
      setLabel($("removeConfirmYes"), total ? `Remove ${plural(total, "playlist")}` : "Nothing to remove");
      $("removeConfirmYes").disabled = total === 0;
      setLabel($("removeConfirmNo"), "Cancel");
    };
    const finish = (value) => {
      box.hidden = true;
      $("removeConfirmYes").onclick = null;
      $("removeConfirmNo").onclick = null;
      $("removeToggle").onchange = null;
      resolve(value);
    };
    draw();
    box.hidden = false;
    $("removeConfirmYes").onclick = () => finish(include ? marked.concat(others) : marked);
    $("removeConfirmNo").onclick = () => finish(null);
    $("removeToggle").onchange = () => { include = $("removeToggle").checked; draw(); };
  });
}

async function removeEarlier() {
  // Everything about removing, including the question and the result, stays inside the Remove section.
  setBusy(true);
  setRemoveMessage("");
  clearReportHints("removeReportHint");
  logStep("remove started");
  try {
    await loadMyPlaylists();   // what is in Spotify now, including anything changed there since this page loaded
    const formatsText = $("formats").value;
    const keys = removeKeys();
    const existing = JSON.parse(py.existingMatches(formatsText, JSON.stringify(keys), JSON.stringify(playlists), me.id));
    if (!existing.length) {
      setRemoveMessage("No playlists matching these recipes' names were found.");
      return;
    }
    const madeByApp = new Set(playlists.filter((p) => p.madeByApp).map((p) => p.id));
    const chosen = await askToRemove(existing.filter((p) => madeByApp.has(p.id)), existing.filter((p) => !madeByApp.has(p.id)), keys.map(formatLabel).join(", "));
    if (!chosen) {
      setRemoveMessage("Cancelled. Nothing was changed.");
      return;
    }
    setRemoveMessage("Removing...");
    await removePlaylists(chosen.map((p) => p.id));
    logStep(`remove finished (${plural(chosen.length, "playlist")})`);
    setRemoveMessage(`Removed ${plural(chosen.length, "playlist")} from your library.`);
    await loadMyPlaylists();
  } catch (err) {
    setRemoveMessage("Something went wrong: " + cleanError(err));
    offerReport("removeReportHint", cleanError(err));
  } finally {
    setBusy(false);
  }
}

// ---------------------------------------------------------------- start up
// ---------------------------------------------------------------- hiding the Donate button
// For people who have donated, on the honor system: one checkbox, nothing checked. The choice is kept in this browser only and never sent anywhere.
// It hides the Donate button, its note, the Donate button in the Build popup, and the thank-you line after a build.
// (An earlier version also saved "declined"; any saved value still means hidden.)
const DONATE_KEY = "donateHidden";

function donateHiddenChoice() {
  try { return localStorage.getItem(DONATE_KEY) || ""; } catch (err) { return ""; }
}

function applyDonateChoice() {
  const hidden = !!donateHiddenChoice();
  document.documentElement.classList.toggle("donate-hidden", hidden);
  $("donateHideBox").checked = hidden;
  $("donateHiddenMessage").hidden = !hidden;
}

function setDonateChoice(choice) {
  try { if (choice) localStorage.setItem(DONATE_KEY, choice); else localStorage.removeItem(DONATE_KEY); } catch (err) { /* it just stays as it was */ }
  applyDonateChoice();
}

function initDonateChoice() {
  on("donateHideBox", "change", () => setDonateChoice($("donateHideBox").checked ? "donated" : ""));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && backupCardOpen) dismissBackupCard(); });
  on("backupOk", "click", () => { const radio = document.querySelector('input[name="backupMode"]:checked'); if (radio) chooseBackupMode(radio.value); else dismissBackupCard(); });
  on("backupCancel", "click", dismissBackupCard);
  on("changeSaveMethod", "click", () => { closeInfo(true); openBackupCard(); });   // More options is a popup too, and would cover the card
  on("backupBackdrop", "click", dismissBackupCard);
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
  applyDonateChoice();
}

let openDonatePanel = () => {};   // set once the page is ready; the Create popup's Donate button uses it

function initDonatePanel() {
  // The Donate button opens Ko-fi's page in a frame above it, instead of leaving this page. Only a frame is used, so none of
  // Ko-fi's code runs here, and the frame is created only when someone first opens the panel. The link to Ko-fi in a new
  // tab stays on the button as the fallback.
  const MIN_HEIGHT = 400;   // the limits Ko-fi's own widget uses for its panel
  const MAX_HEIGHT = 690;
  const button = $("supportButton");
  const box = $("supportBox");
  const panel = $("kofiPanel");
  const dim = $("kofiDim");
  if (!button || !panel) return;
  const handle = new URL(button.href).pathname.replace(/^\//, "");
  const frameUrl = `https://ko-fi.com/${handle}/?hidefeed=true&widget=true&embed=true`;
  let frame = null;
  const place = () => {
    // It sits in the corner, over the button and its note, and takes as much of the height as Ko-fi's page needs.
    panel.style.height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, window.innerHeight - 32)) + "px";
  };
  const open = () => {
    place();
    if (!frame) {
      frame = document.createElement("iframe");
      frame.src = frameUrl;
      frame.title = "Support me on Ko-fi";
      frame.setAttribute("allow", "payment *");   // lets the page inside offer Apple Pay and Google Pay, which a frame is not allowed to otherwise
      $("kofiFrameHolder").appendChild(frame);
    }
    dim.hidden = false;
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    $("kofiClose").focus();
    logStep("donate panel opened");
    countEvent("donate-opened");
  };
  const close = () => {
    if (panel.hidden) return;
    dim.hidden = true;
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    button.focus();
  };
  openDonatePanel = () => { if (panel.hidden) open(); };
  button.addEventListener("click", (event) => {
    event.preventDefault();
    if (panel.hidden) open(); else close();
  });
  on("kofiClose", "click", close);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !panel.hidden) close(); });
  document.addEventListener("click", (event) => { if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target) && !(event.target.closest && event.target.closest("#createDonate"))) close(); });   // the Create popup's Donate button opens it, so that click must not close it again
  window.addEventListener("resize", () => { if (!panel.hidden) place(); });
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

function initThemeChooser() {
  const button = $("themeButton");
  const list = $("themeList");
  const current = chosenColors();
  const entries = THEMES.map((t) => ({ id: t.id, name: t.name, accent: t.accent }));
  if (current.custom) {
    entries.push({ id: "custom", name: "Custom colors", accent: current.accent });
    $("themeNote").textContent = "These colors came from the address (?accent and ?neutral). Choose a theme above, or add ?theme=reset to the address, to go back.";
    $("themeNote").hidden = false;
  }
  let selected = current.custom ? "custom" : current.id;

  const options = () => Array.from(list.querySelectorAll(".theme-option"));
  const close = (refocus) => { list.hidden = true; button.setAttribute("aria-expanded", "false"); if (refocus) button.focus(); };
  const show = () => {
    const entry = entries.find((e) => e.id === selected) || entries[0];
    $("themeSwatch").style.background = entry.accent;
    $("themeName").textContent = entry.name;
    for (const option of options()) option.setAttribute("aria-selected", String(option.dataset.id === selected));
  };
  const choose = (id) => {
    if (id !== "custom") {
      setTheme(id);
      selected = id;
      $("themeNote").hidden = true;
      const at = entries.findIndex((e) => e.id === "custom");
      if (at >= 0) { entries.splice(at, 1); list.querySelector('[data-id="custom"]').remove(); }
      editorThemeChanged();
    }
    show();
    close(true);
  };
  for (const entry of entries) {
    const option = document.createElement("li");
    option.className = "theme-option";
    option.setAttribute("role", "option");
    option.tabIndex = -1;
    option.dataset.id = entry.id;
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = entry.accent;
    const name = document.createElement("span");
    name.textContent = entry.name;
    option.append(swatch, name);
    option.addEventListener("click", () => choose(entry.id));
    list.appendChild(option);
  }
  const open = () => {
    list.hidden = false;
    list.classList.remove("theme-up");
    const room = list.getBoundingClientRect();
    if (room.height && room.bottom > window.innerHeight - 8 && button.getBoundingClientRect().top > room.height + 8) list.classList.add("theme-up");   // too near the bottom: open upward
    button.setAttribute("aria-expanded", "true");
    const chosen = options().find((o) => o.dataset.id === selected) || options()[0];
    if (chosen) { chosen.focus({ preventScroll: true }); if (chosen.scrollIntoView) chosen.scrollIntoView({ block: "nearest" }); }
  };
  button.addEventListener("click", () => (list.hidden ? open() : close(false)));
  button.addEventListener("keydown", (event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); if (list.hidden) open(); } });
  list.addEventListener("keydown", (event) => {
    const all = options();
    const at = all.indexOf(document.activeElement);
    if (event.key === "Escape") { event.preventDefault(); close(true); }
    else if (event.key === "ArrowDown") { event.preventDefault(); all[Math.min(all.length - 1, at + 1)].focus(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); all[Math.max(0, at - 1)].focus(); }
    else if (event.key === "Home") { event.preventDefault(); all[0].focus(); }
    else if (event.key === "End") { event.preventDefault(); all[all.length - 1].focus(); }
    else if ((event.key === "Enter" || event.key === " ") && at >= 0) { event.preventDefault(); choose(all[at].dataset.id); }
  });
  // tapping anywhere else closes the list and does nothing else
  const outsideList = (event) => !list.hidden && !(event.target.closest && event.target.closest(".theme-picker"));
  document.addEventListener("pointerdown", (event) => { if (outsideList(event)) event.stopPropagation(); }, true);
  document.addEventListener("click", (event) => { if (!outsideList(event)) return; event.stopPropagation(); event.preventDefault(); close(false); }, true);
  show();
}

async function main() {
  if (window.pageStart) window.pageStart.started = true;   // tells the page's watchdog that this script is running
  startFlowChoice();
  logStep("page opened");
  const pageVersion = (document.querySelector('meta[name="app-version"]') || {}).content;
  if (pageVersion !== APP_VERSION) startupProblems.push(`page version ${pageVersion || "unknown"} and script version ${APP_VERSION} differ`);
  guarded("report details", () => refreshReportBox());
  for (const el of document.querySelectorAll(".redirect-address")) el.textContent = redirectUri();
  $("clientId").value = localStorage.getItem("clientId") || "";
  $("formats").value = localStorage.getItem("formats") || DEFAULT_FORMATS;
  guarded("color choice", () => initThemeChooser());
  guarded("editor", () => initEditor());
  guarded("formats", () => refreshFormatKeys());
  guarded("output", () => setOutput(""));

  // Start with no flow shown. People who already saved a Client ID have an app, so open that flow for them.
  showFlow($("clientId").value ? "existing" : null);
  showPage();

  for (const button of document.querySelectorAll(".copy-redirect")) {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(redirectUri());
        setLabel(button, "Copied");
        setIcon(button, "confirm");   // the one icon change: a check shows the copy worked
      } catch (err) {
        setLabel(button, "Select and copy it by hand");
      }
      setTimeout(() => { setLabel(button, "Copy"); setIcon(button, "copy"); }, 2000);
    });
  }
  // problem reports: the link is rebuilt at the moment it is used, so it carries the latest details
  on("reportLink", "click", refreshReportBox);
  on("moreOptions", "toggle", () => { if ($("moreOptions").open) refreshReportBox(); });
  for (const id of REPORT_HINTS) {
    const link = $(id).querySelector("a");
    link.addEventListener("click", () => { link.href = reportUrl(); });
  }
  on("clearData", "click", () => {
    $("clearConfirm").hidden = false;
    $("clearData").disabled = true;    // the question is already open, so the button that opened it waits
  });
  on("clearNo", "click", () => {
    $("clearConfirm").hidden = true;
    $("clearData").disabled = false;
  });
  on("clearYes", "click", clearSavedData);
  on("connect", "click", startLogin);
  on("startSetup", "click", () => goToSetup(false));
  on("premiumWhy", "click", (event) => { event.stopPropagation(); showPremiumWhy($("premiumWhyText").hidden); });
  document.addEventListener("click", (event) => { if (!$("premiumWhyText").hidden && !$("premiumWhyText").contains(event.target)) showPremiumWhy(false); });
  on("recipeWhat", "click", (event) => { event.stopPropagation(); showRecipeWhat($("recipeWhatText").hidden); });
  document.addEventListener("click", (event) => { if (!$("recipeWhatText").hidden && !$("recipeWhatText").contains(event.target)) showRecipeWhat(false); });
  window.addEventListener("resize", placeRecipeWhat);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") { showPremiumWhy(false); showRecipeWhat(false); } });
  on("setupBack", "click", setupBack);
  window.addEventListener("popstate", pageHistoryMoved);
  on("infoClose", "click", () => closeInfo());
  on("infoOverlay", "click", (event) => { if (event.target === $("infoOverlay")) closeInfo(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && info.node && !event.defaultPrevented && !(event.target.closest && event.target.closest("#themeList"))) closeInfo(); });   // an Escape that closed something inside it (the color list) is not for the popup
  on("disconnect", "click", confirmDisconnect);
  on("connectionRetry", "click", connectToSpotify);
  on("connectionReconnect", "click", startLogin);
  on("reconnectButton", "click", startLogin);
  on("create", "click", () => startCreate());
  if (FEEDBACK_FORM_URL) {
    for (const id of ["privacyFeedback", "privacyFeedbackWho"]) $(id).hidden = false;   // the form itself opens from the app menu
  }
  $("privacyWaitRelay").hidden = !WAIT_RELAY_URL;   // Privacy says what the relay sees only once there is one
  for (const link of document.querySelectorAll(".privacy-link")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      if (pageName() === "app") { openInfo("privacySection"); return; }   // in the app, Privacy is in the menu's popup
      $("privacySection").open = true;
      $("privacySection").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  on("createClose", "click", closeCreateDialog);
  initMotion();
  smoothResize($("createDialog"), document.querySelector("#createDialog .bd-body"));
  smoothResize($("infoDialog"), $("infoSlot"));
  on("createDonate", "click", () => { closeCreateDialog(); openDonatePanel(); });
  on("createOverlay", "click", (event) => { if (event.target === $("createOverlay")) dismissCreateDialog(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("createOverlay").hidden) dismissCreateDialog(); });
  guarded("tip note", () => trackTipHeight());
  guarded("donation panel", () => initDonatePanel());
  guarded("hiding the Donate button", () => initDonateChoice());
  on("removeOld", "click", removeEarlier);
  on("removeKey", "change", updateButtons);
  on("buildAll", "click", () => startCreate(currentFormats.map((f) => f.id)));
  on("maxPlaylists", "input", () => invalidatePlan());
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
  const pythonReady = connectingScreen ? preparePython().then((ok) => { if (ok) connectingStep("Python", "done"); else connectingStepFailed("Python"); }) : null;   // behind the connecting screen Python loads alongside the sign-in, so the wait is the slower of the two
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
  if (!token) await connectingStepFailed("Signin");   // the sign-in did not work: the setup page shows what went wrong
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
    await connectToSpotify();   // and the app only calls itself connected, and offers Create, once Spotify has answered
    if (connection === "ready") connectingStep("Playlists", "done");
    else await connectingStepFailed("Playlists");   // the connection problem shows in the app
  }
  if (connectingScreen) await settleFirstSave();
  await (pythonReady || preparePython());
  if (connectingScreen) await new Promise((r) => setTimeout(r, 400));   // the last check is seen before the screen fades
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
    $("pythonNote").textContent = "Python could not start, so building is unavailable. Check your internet connection and reload the page. Details are under More options.";
    offerReport("mainReportHint", String(err.message || err));
    return false;
  }
}

main().catch(startupFailed);
