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
const API = "https://api.spotify.com/v1";
const ADD_CHUNK = 10;      // songs added per request (kept small; Spotify tightened some limits in 2026)
const REMOVE_CHUNK = 40;   // playlists removed per request (Spotify's maximum)

const ALL_FORMATS = "__all__";  // dropdown value that means every format
const APP_VERSION = "2026-10-31c";

// Every playlist this app creates gets this at the start of its description. That is the one way the app tells its
// own playlists from ones you made by hand, so it works on any device, and nothing is stored in this browser for it.
const APP_MARKER = "Made by Ceremony Playlist Builder";                    // change this whenever the page is updated
const REPORT_FORM_URL = "https://tally.so/r/VppLZN"; // where problem reports go
// The questions and feedback form (Tally). It collects only what someone types, so nothing is attached to its address. While this is empty,
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

function startFlowChoice() {
  // The two choices at the top of Step 1 are wired first of all, for the whole page at once, so they work whatever else goes wrong.
  // The capture phase catches the change even from a browser or a script that does not let it bubble, and the click covers a browser that
  // reports a radio button's choice only that way.
  const choose = (event) => {
    const radio = event.target;
    if (radio && radio.type === "radio" && radio.name === "flow") showFlow(radio.value);
  };
  document.addEventListener("change", choose, true);
  document.addEventListener("click", choose, true);
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
  // The box exists only while there is something to show: progress, a plan, or a problem.
  $("output").textContent = text;
  $("output").hidden = !text;
}

function setActionMessage(text) {
  $("actionMessage").textContent = text;   // progress and results of Create
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

function addResult(name, url, detail) {
  const row = document.createElement("div");
  if (url) {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = name;
    row.appendChild(link);
  } else {
    row.appendChild(document.createTextNode(name));
  }
  if (detail) row.appendChild(document.createTextNode("  " + detail));
  $("results").appendChild(row);
}

function showFlow(flow) {
  // flow is "new", "existing", or null (nothing chosen yet: show neither, and nothing below the choices).
  $("flowNew").hidden = flow !== "new";
  $("flowExisting").hidden = flow !== "existing";
  $("connectBlock").hidden = !flow;
  for (const radio of document.querySelectorAll('input[name="flow"]')) radio.checked = radio.value === flow;
}

function currentFlow() {
  const checked = document.querySelector('input[name="flow"]:checked');
  return checked ? checked.value : null;
}


function addSupportPrompt() {
  // A thank-you line after the playlists are made. No link: the Donate button is right there.
  if (donateHiddenChoice()) return;   // someone who hid the Donate button is not asked again
  const row = document.createElement("div");
  row.className = "support-prompt";
  row.textContent = "If you're finding this app helpful, you can donate any amount that feels good to you as a way of saying thanks.";
  $("results").appendChild(row);
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
const saveState = { running: false, again: false, timer: null, since: 0, error: "", tooLong: [], newer: [], savedAt: null, coverBlocked: false, added: [], updated: [], coverProblem: null, failures: 0, failureAsked: false, unread: 0, skip: new Set(), dismissed: new Set(), lastNews: null };
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
      choice = await askSyncChoice(`\u201c${label}\u201d was changed in two places`, `This device has a version from ${whenText(a.local.modified)}, and Spotify has one from ${whenText(a.remote.modified)}, probably saved from another device. Which one do you want to keep? The other one is replaced.`,
        [{ label: "Keep this device\u2019s", value: "mine" }, { label: "Use Spotify\u2019s", value: "theirs" }], { required: true });
    } else {
      choice = await askSyncChoice(`\u201c${label}\u201d is no longer in Spotify`, "Its backup was removed from your Spotify, maybe on another device. Keep it here, and it will be saved to Spotify again, or remove it from this device too?",
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
  if (connection !== "ready" || !me || typeof editor === "undefined" || !editor.model) { renderSaveStatus(); return; }
  saveState.running = true;
  saveState.error = "";
  renderSaveStatus();
  try {
    await mergeFromSpotify();
    const synced = readSynced();
    const tooLong = [], newer = [];
    const allIds = playlists.map((p) => p.id);
    // The cover of a backup playlist is the app's icon, dimmed, with a cloud: a playlist that has no cover yet gets it, once. (Spotify limits image uploads on their own,
    // so it is never sent again, and a problem with it never stops a save.)
    let cover;   // loaded when it is first needed
    let coverFailed = null;   // why a cover could not be put on a backup, if one could not: said in the line under the editor's bar, since otherwise nothing says why there is none
    const putCover = async (entry) => {
      if (entry.image) return;
      if (saveState.coverBlocked || !hasScope("ugc-image-upload")) {
        coverFailed = { key: "permission", text: "Your Spotify sign-in does not include permission to add cover art, so the backup playlists have no cover. Disconnect and connect again to allow it." };
        return;
      }
      try {
        if (cover === undefined) {
          try { cover = await loadCover("backup-cover.jpg"); }
          catch (err) { cover = null; logStep("save: cover image not loaded"); coverFailed = { key: "file", text: "The cover image for the backup playlists (backup-cover.jpg) could not be loaded from this site, so they have no cover." }; }
        }
        if (!cover) return;
        await spotifyRequest("PUT", `/playlists/${entry.id}/images`, { body: cover, contentType: "image/jpeg" });
        entry.image = "set";
      } catch (err) {
        logStep("save: cover not accepted");
        if (/did not allow|sign-in expired/.test(err.message)) saveState.coverBlocked = true;
        coverFailed = { key: "refused", text: `Spotify did not accept the cover for the backup playlists: ${String(err.message || err).replace(/\.$/, "")}. They have no cover.` };
      }
    };
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
        if (have.description === description && have.name === name) { synced[fmt.id] = { rev: fmt.rev || 0, playlistId: have.id }; await putCover(have); continue; }   // already as it should be
        await spotifyRequest("PUT", `/playlists/${have.id}`, { json: { name, description } });
        have.name = name;
        have.description = description;
        have.save = unpackFormat(description);
        synced[fmt.id] = { rev: fmt.rev || 0, playlistId: have.id };
        await putCover(have);
      } else if (unreadOfIt) {
        await spotifyRequest("PUT", `/playlists/${unreadOfIt.id}`, { json: { name, description } });
        unreadOfIt.description = description;
        unreadOfIt.save = unpackFormat(description);
        synced[fmt.id] = { rev: fmt.rev || 0, playlistId: unreadOfIt.id };
        await putCover(unreadOfIt);
      } else {
        const made = await spotifyRequest("POST", "/me/playlists", { json: { name, public: false, description } });
        if (made.public !== false) { try { await spotifyRequest("PUT", `/playlists/${made.id}`, { json: { public: false } }); } catch (err) { logStep("save: could not make a backup playlist private"); } }
        const entry = { id: made.id, name, owner: me.id, collaborative: false, image: null, count: 0, description, snapshot: null, madeByApp: false };
        entry.save = unpackFormat(description);
        entry.isSave = true;
        playlists.push(entry);
        synced[fmt.id] = { rev: fmt.rev || 0, playlistId: made.id };
        await putCover(entry);
      }
    }
    writeSynced(synced);
    saveState.coverProblem = coverFailed;
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
  if (saveState.again) { saveState.again = false; scheduleSpotifySave(300); }
}

// What the saving is up to, in words, with the actions that belong to it.
function spotifySaveParts(full = true) {
  const parts = [];   // each: { text } or { text, action, label }
  if (saveState.running) { parts.push({ text: "Saving to Spotify\u2026" }); return parts; }
  if (connection !== "ready") { parts.push({ text: connection === "problem" ? "Waiting to save to Spotify: see the problem in Step 1." : "Waiting to save to Spotify: connect first." }); }
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
  if (saveState.unread) parts.push({ text: `${saveState.unread === 1 ? "A backup in Spotify" : saveState.unread + " backups in Spotify"} could not be read, or ${saveState.unread === 1 ? "was" : "were"} saved by a newer version of the app, and ${saveState.unread === 1 ? "was" : "were"} left alone.` });
  for (const t of saveState.tooLong) {
    parts.push({ text: `\u201c${t.title.trim() || "Untitled"}\u201d is too long to back up to Spotify. It is still saved in this browser.`, action: () => downloadOneFormat(t.id), label: "Download it" });
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
  const name = (t) => `\u201c${String(t).trim() || "Untitled"}\u201d`;
  if (connection === "ready" && saveState.error && !saveState.running) items.push({ key: "error", text: "Couldn\u2019t save to Spotify.", actions: [{ label: "Try again", run: () => { saveState.error = ""; runSpotifySave(); } }] });
  const n = saveState.unread;
  if (n && !saveState.dismissed.has("unread:" + n)) items.push({ key: "unread:" + n, ok: true, text: `${n === 1 ? "A backup in Spotify" : n + " backups in Spotify"} could not be read, or ${n === 1 ? "was" : "were"} saved by a newer version of the app, and ${n === 1 ? "was" : "were"} left alone.` });
  if (saveState.coverProblem && !saveState.dismissed.has("cover:" + saveState.coverProblem.key)) items.push({ key: "cover:" + saveState.coverProblem.key, ok: true, text: saveState.coverProblem.text });
  for (const t of saveState.tooLong) if (!saveState.dismissed.has("long:" + t.id)) items.push({ key: "long:" + t.id, ok: true, text: `${name(t.title)} is too long to back up to Spotify. It is still saved in this browser.`, actions: [{ label: "Download it", run: () => downloadOneFormat(t.id) }] });
  return items;
}

// What went wrong, in words a person can read: the plain messages are kept, and the technical one ("Spotify returned 500 for PUT /playlists/…") becomes a sentence.
function saveFailureDetail(message) {
  const code = /Spotify returned (\d{3})/.exec(message);
  if (code) return `Spotify returned an error (${code[1]}) while saving.`;
  return String(message).replace(/\s*\/playlists\/[A-Za-z0-9]+/g, "").trim();
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
  const names = titles.map((t) => `\u201c${String(t).trim() || "Untitled"}\u201d`);
  if (names.length === 1) return `${verb} ${names[0]} from Spotify.`;
  if (names.length === 2) return `${verb} ${names[0]} and ${names[1]} from Spotify.`;
  return `${verb} ${names.length} recipes from Spotify.`;
}

function writeSaveParts(into, full = true) {
  into.textContent = "";
  for (const part of spotifySaveParts(full)) {
    into.appendChild(document.createTextNode((into.childNodes.length ? " " : "") + part.text + (part.action ? " " : "")));
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

// Picking one of the two is the whole interaction: it is saved and the card goes away. Picking the one already chosen just closes it.
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
  if (connection !== "ready") { showBackupMessage(`The ${many ? "backups" : "backup"} in Spotify ${many ? "were" : "was"} left as ${many ? "they are" : "it is"}.`, false, offer); return; }
  const choice = await askSyncChoice("Remove the backups from Spotify?",
    `${many ? "There are " + saves.length + " backups" : "There is 1 backup"} of your recipes in Spotify, in private playlists ending in (recipe). Keep ${many ? "them" : "it"}, or remove ${many ? "them" : "it"}? Another device that backs up to Spotify would lose ${many ? "them" : "it"} too.`,
    [{ label: many ? "Keep them" : "Keep it", value: "keep" }, { label: many ? "Remove them" : "Remove it", value: "remove", danger: true }]);
  if (choice !== "remove") { showBackupMessage(`The ${many ? "backups" : "backup"} in Spotify ${many ? "were" : "was"} left as ${many ? "they are" : "it is"}.`, false, offer); return; }
  try {
    const ids = saves.map((p) => p.id);
    for (let i = 0; i < ids.length; i += REMOVE_CHUNK) {
      await spotifyRequest("DELETE", "/me/library", { params: { uris: ids.slice(i, i + REMOVE_CHUNK).map((id) => "spotify:playlist:" + id).join(",") } });
    }
    playlists = playlists.filter((p) => !ids.includes(p.id));
    showBackupMessage(`Removed ${plural(ids.length, "backup")} from Spotify. Your recipes are now saved only in this browser.`, false, offer);
  } catch (err) {
    showBackupMessage("The backups could not be removed from Spotify: " + String(err && err.message || err), false, offer, true);
  }
}

// Only what belongs to the chosen way is on the page: the backup file's note and step for "manual", the status of the saving for "spotify".
function applyBackupMode() {
  const spotify = backupMode() === "spotify";
  if ($("savedNote")) $("savedNote").hidden = spotify;
  if ($("spotifySaveLine")) $("spotifySaveLine").hidden = !spotify;
  if ($("backupBlock")) $("backupBlock").hidden = spotify;
  document.body.classList.toggle("spotify-backup", spotify);
  // Clear saved data: with Spotify as the way, the formats come back from Spotify, not from a file
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
  // Clear saved data: what would be lost, so a backup can be made first.
  if (backupMode() === "spotify") { $("clearBackupNote").textContent = "Your recipes are saved to Spotify, and clearing the saved data does not remove them."; return; }
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
  if (connectButton) { setLabel(connectButton, signingIn ? "Connecting\u2026" : "Connect Spotify"); connectButton.disabled = signingIn; }
  if ($("connectionReconnect")) $("connectionReconnect").disabled = signingIn;
  const connectingNow = signingIn || connection === "connecting";
  if (connectingNow && minimalActive()) {
    // in minimalist mode Step 1 is hidden, and the Create button is the one that says what is going on
    setLabel($("create"), "Connecting\u2026");
    setIcon($("create"), "connect");
    $("create").disabled = true;
  } else if (action) {
    const again = connection === "problem";
    setLabel($("create"), again ? (connectionKind === "reconnect" ? "Connect again" : "Try again") : "Connect Spotify");
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
      name.textContent = `for \u201c${active.title}\u201d`;
      label.appendChild(name);
    }
    setIcon($("create"), "build");
    $("create").disabled = !ready;
  }
  const buildAll = $("buildAll");   // a page older than this script may not have it, and that must not stop the rest
  if (buildAll) buildAll.disabled = !(!!token && connection === "ready" && !!py && formatsValid && !busy && currentFormats.length > 0);
  $("removeOld").disabled = !ready;
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
  if (minimalActive() && (signingIn || connection === "connecting" || signInNote)) {
    $("spotifyNote").textContent = signingIn ? signInNote : connection === "connecting" ? "Connecting to Spotify. On a slow connection this can take a few seconds." : signInNote;
    $("spotifyNote").hidden = false;
  }
}

function connectionAction() {
  // In minimalist mode Step 1 is hidden, so while Spotify is not connected the Create button becomes the way to connect.
  if (!minimalActive() || connection === "ready" || connection === "connecting") return null;
  if (connection === "problem") return connectionKind === "reconnect" ? startLogin : connectToSpotify;
  return localStorage.getItem("clientId") ? startLogin : null;
}

// Spotify's free developer app now needs Premium on the account that owns it. Without it, Spotify refuses requests with a 403 that says so.
const PREMIUM_REQUIRED_MESSAGE = "Spotify says the account that owns this Client ID needs Premium. A free Spotify account will not work. Once that account has Premium, try again.";
const CREATE_NEEDS_SPOTIFY = "Building playlists needs a working connection to Spotify. See Step 1.";

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
    if (!localStorage.getItem("counted") && countEvent("first-connection")) localStorage.setItem("counted", "1");   // once per browser
  } catch (err) {
    const message = String(err.message || err);
    recordError(message);
    logStep("connection failed");
    setConnection("problem", message, /sign-in expired|did not allow/.test(message) ? "reconnect" : "retry");
    countEvent("connection-problem", problemKind(message));
    // A report link is for something unexpected. A rate limit, a quota, no internet and a lapsed sign-in are known, and nothing here can fix them.
    if (!/rate limiting|request quota|Could not reach Spotify|sign-in expired|did not allow|needs Premium/.test(message)) offerReport("connectionReportHint", message);
  }
}

function setBusy(flag) {
  busy = flag;
  updateButtons();
}

// ---------------------------------------------------------------- confirmation panels
// Create asks under the Create button (askToCreate). Remove asks inside the Remove section, at the bottom of it.

// ---------------------------------------------------------------- the popup for Create
// One popup holds everything after a click on Create, and each step replaces the one before it:
// planning, then the question, then the progress, then the result. It can be dismissed while it
// is asking and once it is done (the Close button, a click outside it, or Escape), but not while
// the app is reading or creating.
let createStage = "closed";   // closed, planning, question, creating or done
let createSucceeded = false;  // the playlists were all made, so the popup may offer Donate

function setCreateStage(stage) {
  createStage = stage;
  $("createCloseRow").hidden = stage !== "done";
  $("createDonate").hidden = stage !== "done" || !createSucceeded;   // only after a success, never beside an error or a problem
}

function openCreateDialog() {
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
    $("redirectHelp").open = true;
    return;
  }
  if (params.get("state") !== sessionStorage.getItem("pkceState")) {
    revealLoginProblem();
    setLoginMessage("The sign-in did not match this tab. Please try Connect again.");
    return;
  }
  const response = await fetch("https://accounts.spotify.com/api/token", {
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
  sessionStorage.setItem("token", JSON.stringify({
    value: data.access_token,
    expires: Date.now() + data.expires_in * 1000,
    scope: data.scope || "",
  }));
}

function setLoginMessage(text, info = false) {
  // The message shows next to whichever Connect button is on screen. Something that went wrong is in the error color; something that is just happening (Spotify is opening) is not.
  for (const id of ["loginMessage", "welcomeMessage"]) {
    $(id).textContent = text;
    $(id).className = info ? "muted" : "error";
  }
}

function revealLoginProblem() {
  // Open the setup steps so the fix (such as the redirect address help) is in view.
  if (!currentFlow()) showFlow("existing");
  $("setupDetails").open = true;
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
    "This signs you out of Spotify on this device. Your recipes and your backups are not touched. The next time you build, the app reads your playlists from Spotify again, which takes a little longer.",
    [{ label: "Disconnect", value: "yes" }, { label: "Cancel", value: "no" }], { focusLast: true });
  if (choice === "yes") await disconnect();
}

async function disconnect() {
  sessionStorage.removeItem("token");
  await Promise.race([forgetAllSongs(), new Promise((r) => setTimeout(r, 1500))]);   // the songs kept from this account go with the sign-in
  location.reload();
}

// ---------------------------------------------------------------- talking to Spotify
const RETRY_BUDGET_MS = 30000;   // the most the app will spend waiting out short rate limits in one request
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
  if (/Could not reach Spotify/.test(message)) return "network";
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

async function spotifyRequest(method, path, { params, json, body, contentType } = {}) {
  let url = path.startsWith("http") ? path : API + path;
  if (params) url += (url.includes("?") ? "&" : "?") + new URLSearchParams(params).toString();
  const what = `${method} ${path.split("?")[0]}`;
  let waitedMs = 0;
  let lastWait = null;   // the last wait Spotify gave that could be read
  for (let attempt = 0; attempt < 5; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: { Authorization: "Bearer " + token, ...(json ? { "Content-Type": "application/json" } : (contentType ? { "Content-Type": contentType } : {})) },
        body: json ? JSON.stringify(json) : body,
      });
    } catch (err) {
      throw new Error("Could not reach Spotify. Check your internet connection and try again.");
    }
    if (response.status === 429) {
      const header = Number(response.headers.get("Retry-After"));
      const wait = header > 0 ? header : null;
      if (wait) lastWait = wait;
      let reason = "";
      try { const data = JSON.parse(await response.text()); reason = (data && data.error && data.error.reason) || ""; } catch (err) { /* no body, or not JSON */ }
      // A quota limit, or a wait over a minute, is not worth sitting through: stop at once and say what is known.
      if (reason === "QUOTA_EXCEEDED" || (wait && wait > 60)) throw rateLimitError(wait || lastWait, reason);
      const pause = (wait || 2) * 1000 + 500;
      if (waitedMs + pause > RETRY_BUDGET_MS) break;
      await retrySleep(pause);
      waitedMs += pause;
      continue;
    }
    if (response.status === 401) {
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
  if (saved && Array.isArray(saved.tracks) && (!snapshot || saved.snapshot === snapshot)) {
    trackCache.set(id, saved.tracks);
    return saved.tracks;
  }
  const entries = await pagedItems(`/playlists/${id}/items?limit=50`);
  const tracks = [];
  for (const entry of entries) {
    const t = entry && (entry.item || entry.track);  // "item" is the 2026 field name
    if (!t || t.is_local || t.type !== "track" || !t.uri) continue;
    const artist = t.artists && t.artists[0] ? t.artists[0].name : "";
    tracks.push({ uri: t.uri, ms: t.duration_ms, label: `${artist} - ${t.name}` });
  }
  trackCache.set(id, tracks);
  await saveSongs({ id, snapshot, tracks, savedAt: Date.now() });
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
function fillFormatDropdown(select, formats, defaultToAll) {
  const previous = select.value;
  select.innerHTML = "";
  for (const f of formats) select.add(new Option(f.title, f.id));
  select.add(new Option("All recipes", ALL_FORMATS));
  if (formats.some((f) => f.id === previous) || previous === ALL_FORMATS) select.value = previous;
  else if (defaultToAll) select.value = ALL_FORMATS;
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
  // Works out which source playlists the chosen formats need and reads their songs.
  const formatsText = $("formats").value;
  const wanted = selectedKeys();
  const blanks = blankSegmentReport(wanted);
  if (blanks.length) {
    recordError("Build blocked: a segment has no playlist chosen");
    logStep("plan blocked: empty segment");
    setOutput("Choose a playlist for every segment first:\n\n"
      + blanks.map((b) => `- ${b.title}: ${b.count === 1 ? "1 segment has" : b.count + " segments have"} no playlist yet`).join("\n"));
    return null;
  }
  const plans = [];
  const failed = [];
  const failedNotes = [];
  for (const key of wanted) {
    try {
      plans.push({ key, names: JSON.parse(py.neededSources(formatsText, key)) });
    } catch (err) {
      failed.push(`=== ${formatLabel(key)} ===\nCould not plan this recipe: ${cleanError(err)}`);
      failedNotes.push(`${formatLabel(key)} could not be planned: ${cleanError(err)}`);
    }
  }
  const names = [...new Set(plans.flatMap((p) => p.names))];
  const match = JSON.parse(py.matchPlaylists(JSON.stringify(names), JSON.stringify(playlists), me.id));
  if (match.problems.length) {
    recordError(`Build blocked: ${plural(match.problems.length, "source playlist")} not found or not owned`);
    logStep("plan blocked: source playlists");
    setOutput("Cannot plan yet:\n\n" + match.problems.map((p) => "- " + p).join("\n")
      + "\n\nCheck the playlist names in your recipes against your Spotify playlists. Each name must match a playlist you own.");
    return null;
  }
  const tracks = {};
  for (const name of names) {
    setOutput(`Reading "${name}"...`);
    tracks[name] = await loadTracks(match.found[name]);
  }
  return { formatsText, keys: plans.map((p) => p.key), failed, failedNotes, tracks };
}

async function planSelected(startedWith, includeOthers = false) {
  // Works out the playlists for the chosen formats. Returns the plan, or null after saying why there isn't one.
  const inputs = await gatherInputs();
  if (!inputs) return null;
  // Earlier playlists with names this plan would use: the ones this app made get replaced, the others are left alone and their names skipped.
  const matching = JSON.parse(py.existingMatches(inputs.formatsText, JSON.stringify(inputs.keys), JSON.stringify(playlists), me.id));
  const madeByApp = new Set(playlists.filter((p) => p.madeByApp).map((p) => p.id));
  const marked = matching.filter((p) => madeByApp.has(p.id));
  const others = matching.filter((p) => !madeByApp.has(p.id));
  const ours = includeOthers ? matching : marked;   // what gets removed first
  const reserved = JSON.stringify(includeOthers ? [] : others.map((p) => p.name));
  setOutput("Planning...");
  const built = [];
  const parts = [];
  const problems = [];
  for (const key of inputs.keys) {
    try {
      const plan = JSON.parse(py.buildPlaylists(inputs.formatsText, key, JSON.stringify(inputs.tracks), playlistLimit(), reserved));
      if (typeof plan.text !== "string") throw new Error("engine.py is out of date. Upload the newest engine.py, then reload the page.");
      built.push(plan);
      parts.push(plan.text);
    } catch (err) {
      recordError(cleanError(err));
      parts.push(`=== ${formatLabel(key)} ===\nCould not plan this recipe: ${cleanError(err)}`);
      problems.push(`${formatLabel(key)} could not be planned: ${cleanError(err)}`);
    }
  }
  if (planSignature() !== startedWith) {   // the user edited something while this was planning
    setOutput("");
    return null;
  }
  parts.push(...inputs.failed);
  problems.push(...inputs.failedNotes);
  const total = built.reduce((n, plan) => n + plan.playlists.length, 0);
  logStep(total ? `plan: ${plural(total, "playlist")} planned` : "plan: nothing can be created");
  if (!total) {
    setOutput(parts.join("\n\n") + "\n\nNothing can be built from this plan.");
    return null;
  }
  setOutput("");
  return { formatsText: inputs.formatsText, keys: inputs.keys, built, total, ours, marked, others, includeOthers, text: parts.join("\n\n") + "\n\nNothing has been built yet.", problems };
}

function setPlanText(text) {
  // One block per line, so a line that has to wrap hangs under its own start and the lines stay easy to tell apart.
  // The text itself is exactly what it was: each block ends with the line break that was there.
  const box = $("planText");
  box.textContent = "";
  const lines = String(text).split("\n");
  lines.forEach((line, i) => {
    const row = document.createElement("div");
    row.className = "pl";
    row.textContent = line + (i < lines.length - 1 ? "\n" : "");
    box.appendChild(row);
  });
}

function askToCreate(plan) {
  // Shows what the plan found and waits: "create", "cancel", "include"/"exclude" (the switch for playlists the app did not mark), or "stale" if something was edited meanwhile.
  return new Promise((resolve) => {
    // A plan with nothing to warn about is one sentence. Playlists that would be replaced or left alone, and formats that could not be planned, get lines of their own.
    const problems = plan.problems.map((n) => "Note: " + n);
    const names = plan.keys.map((k) => (currentFormats.find((f) => f.id === k) || {}).title).filter(Boolean);
    const forWhat = names.length === 1 ? ` for \u201c${names[0]}\u201d` : names.length > 1 ? ` for ${plural(names.length, "recipe")}` : "";
    fillConfirmList("confirmList", "confirmText", `Ready to build ${plural(plan.total, "playlist")}${forWhat}.`, problems);
    const replacing = plan.ours.length > 0;
    const many = plan.others.length !== 1;
    fillConfirmList("confirmMoreList", "confirmMoreText",
      plan.marked.length ? `Replace ${plural(plan.marked.length, "earlier playlist")} made by this app? They share names with the playlists about to be built, and will be removed from your library first:` : "",
      plan.marked.map((p) => p.name));
    fillConfirmList("confirmKeepList", "confirmKeepText",
      !plan.others.length ? ""
        : plan.includeOthers ? `${plural(plan.others.length, "playlist")} with matching names ${many ? "were" : "was"} not made by this app, and will be removed too because you chose to replace ${many ? "them" : "it"}:`
        : `${plural(plan.others.length, "playlist")} with matching names ${many ? "were" : "was"} not made by this app, so ${many ? "they" : "it"} will not be touched, and the new playlists skip ${many ? "those names" : "that name"}:`,
      plan.others.map((p) => p.name));
    $("confirmKeepToggleRow").hidden = plan.others.length === 0;
    $("confirmKeepToggle").checked = plan.includeOthers;
    $("confirmKeepToggleLabel").textContent = `Replace ${many ? "them" : "it"} too`;
    setLabel($("confirmYes"), replacing ? `Remove them and build ${plural(plan.total, "playlist")}` : `Build ${plural(plan.total, "playlist")}`);
    setLabel($("confirmNo"), "Cancel");
    setPlanText(plan.text);
    $("planText").hidden = true;
    $("planToggle").textContent = "See the full plan";
    const box = $("confirmBox");
    box.hidden = false;
    setCreateStage("question");
    const finish = (answer) => {
      openQuestion = null;
      box.hidden = true;
      $("planText").textContent = "";
      for (const id of ["confirmYes", "confirmNo", "planToggle"]) $(id).onclick = null;
      $("confirmKeepToggle").onchange = null;
      if (answer === "create") setCreateStage("creating");   // from this moment it cannot be dismissed
      else if (answer === "include" || answer === "exclude") setCreateStage("planning");
      resolve(answer);
    };
    openQuestion = finish;
    $("confirmYes").onclick = () => finish("create");
    $("confirmNo").onclick = () => finish("cancel");
    $("confirmKeepToggle").onchange = () => finish($("confirmKeepToggle").checked ? "include" : "exclude");
    $("planToggle").onclick = () => {
      $("planText").hidden = !$("planText").hidden;
      $("planToggle").textContent = $("planText").hidden ? "See the full plan" : "Hide the full plan";
    };
  });
}

async function startCreate(keys = null) {
  const connect = keys ? null : connectionAction();   // in minimalist mode, when not connected, this button connects instead
  if (connect) { connect(); return; }
  buildScope = Array.isArray(keys) && keys.length ? keys : null;
  // One button: plan, show what was found, ask, then create exactly that plan.
  setBusy(true);
  clearResults();
  setActionMessage("");
  clearReportHints("mainReportHint");
  setOutput("");
  $("editorNote").textContent = "";
  createSucceeded = false;
  openCreateDialog();
  logStep("plan started");
  invalidatePlan(false);
  const startedWith = planSignature();
  try {
    await loadMyPlaylists();   // what is in Spotify now, including anything changed there since this page loaded
    let includeOthers = false;
    let plan = await planSelected(startedWith, includeOthers);
    while (plan) {
      const answer = await askToCreate(plan);
      if (answer === "stale") { closeCreateDialog(); return; }
      if (answer === "cancel") {
        setActionMessage("Cancelled. Nothing was changed.");
        closeCreateDialog();
        return;
      }
      if (answer === "include" || answer === "exclude") {
        includeOthers = answer === "include";
        logStep(`plan: ${includeOthers ? "replacing" : "keeping"} playlists the app did not mark`);
        plan = await planSelected(startedWith, includeOthers);
        continue;
      }
      await createFromPlan(plan);
      return;
    }
  } catch (err) {
    setOutput("Something went wrong:\n\n" + cleanError(err));
    offerReport("mainReportHint", cleanError(err));
  } finally {
    buildScope = null;
    setBusy(false);
    if (!$("createOverlay").hidden) setCreateStage("done");
  }
}

async function createFromPlan(plan) {
  setCreateStage("creating");
  const existing = plan.ours;
  const planned = plan.built.flatMap((b) => b.playlists.map((p) => ({ ...p, label: formatLabel(b.key) })));
  logStep(`create started (${plural(planned.length, "playlist")})`);
  let created = 0;
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
    if (existing.length) {
      setActionMessage(`Removing ${plural(existing.length, "earlier playlist")}...`);
      await removePlaylists(existing.map((p) => p.id));
    }
    for (const p of planned) {
      setActionMessage(`Building ${created + 1} of ${planned.length}: ${p.name}`);
      const made = await spotifyRequest("POST", "/me/playlists", { json: { name: p.name, public: false, description: `${APP_MARKER} from the recipe "${p.label}". Please leave this description as it is: the app uses it to recognize the playlists it made.` } });
      createdIds.push(made.id);
      if (made.public !== false) {   // asked to keep it off the profile; make sure
        try { await spotifyRequest("PUT", `/playlists/${made.id}`, { json: { public: false } }); }
        catch (err) { stillPublic.push(p.name); logStep("create: could not make a playlist private"); }
      }
      for (let i = 0; i < p.uris.length; i += ADD_CHUNK) {
        await spotifyRequest("POST", `/playlists/${made.id}/items`, { json: { uris: p.uris.slice(i, i + ADD_CHUNK) } });
      }
      if (cover && !coverBlocked) {   // the app's icon as the cover; a problem here never stops the playlists
        try { await spotifyRequest("PUT", `/playlists/${made.id}/images`, { body: cover, contentType: "image/jpeg" }); }
        catch (err) {
          coverFailed += 1;
          logStep("create: cover not accepted");
          if (/did not allow|sign-in expired/.test(err.message)) coverBlocked = true;   // no point asking again
        }
      }
      created += 1;
      addResult(p.name, made.external_urls && made.external_urls.spotify, `${p.songs} songs, ${p.minutes} min`);
    }
    logStep(`create finished (${plural(created, "playlist")})`);
    invalidatePlan(true);
    const notes = [];
    if (stillPublic.length) notes.push(`Note: Spotify kept ${plural(stillPublic.length, "playlist")} on your profile and would not let this app change that. You can change that in the Spotify app.`);
    if (coverBlocked) notes.push("Note: the cover art was not added, because your Spotify sign-in does not include permission to upload images. Click Disconnect, then Connect again to allow it. Playlists you build after that will get the cover.");
    else if (coverUnloaded) notes.push("Note: the cover art could not be loaded, so the playlists have Spotify's default cover.");
    else if (coverFailed) notes.push(`Note: Spotify would not accept the cover art for ${plural(coverFailed, "playlist")}.`);
    createSucceeded = created > 0;
    if (created > 0) countEvent("playlists-created", String(created));
    const doneText = `Done. Built ${plural(created, "playlist")} in your Spotify account.` + (notes.length ? "\n\n" + notes.join("\n\n") : "");
    setActionMessage(doneText);
    addSupportPrompt();
    await loadMyPlaylists();
    // The mark in the description is how this app finds its own playlists later. If Spotify's list does not show it, say so.
    const marked = new Set(playlists.filter((p) => p.madeByApp).map((p) => p.id));
    if (createdIds.length && createdIds.every((id) => !marked.has(id))) {
      logStep("create: description mark not returned");
      setActionMessage(doneText + "\n\nNote: Spotify's playlist list did not show the description this app puts on its playlists (or has not updated yet), so the app may not recognize them later.");
    }
  } catch (err) {
    if (created) invalidatePlan(true);   // some playlists exist now, so creating the plan again would duplicate them
    setActionMessage((created ? `Stopped after building ${created} of ${planned.length} playlists.\n\n` : "Something went wrong:\n\n") + cleanError(err));
    logStep(`create failed after ${created} of ${planned.length}`);
    offerReport("mainReportHint", cleanError(err));
    try { await loadMyPlaylists(); } catch (ignore) { /* keep the original error showing */ }
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
  for (const radio of document.querySelectorAll('input[name="backupMode"]')) {
    radio.addEventListener("click", () => { if (!radio.disabled) chooseBackupMode(radio.value); });
    radio.addEventListener("change", () => { if (!radio.disabled && radio.checked) chooseBackupMode(radio.value); });
  }
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && backupCardOpen) dismissBackupCard(); });
  on("backupDone", "click", dismissBackupCard);
  on("changeSaveMethod", "click", openBackupCard);
  on("backupBackdrop", "click", dismissBackupCard);
  // Back from Spotify's page, a browser may show this page as it was left, with the buttons still waiting
  window.addEventListener("pageshow", (event) => { if (event.persisted && signingIn) { setSigningIn(false); setLoginMessage(""); } });
  // the connection coming back after a failed save: try again, without waiting to be asked
  window.addEventListener("online", () => { if (backupMode() === "spotify" && saveState.error) { saveState.error = ""; scheduleSpotifySave(500); } });
  // someone leaving the page, or switching to another app, does not wait for the pause: whatever has not been saved is saved now
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && saveState.timer && backupMode() === "spotify") runSpotifySave();
    // coming back after a while: another device may have changed a backup, so the account's playlists are read again
    if (document.visibilityState === "visible" && backupMode() === "spotify" && connection === "ready" && playlistsLoadedAt && Date.now() - playlistsLoadedAt > playlistRefreshMs && !saveState.running) loadMyPlaylists().catch(() => {});
  });
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
      frame.title = "Donate on Ko-fi";
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
  $("appVersionLabel").textContent = APP_VERSION;
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
  $("welcomeBack").hidden = !$("clientId").value;   // someone with a saved Client ID only needs to reconnect
  $("setupDetails").open = !$("clientId").value;     // the setup steps stay one click away

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
  on("connectReturning", "click", startLogin);
  on("disconnect", "click", confirmDisconnect);
  on("connectionRetry", "click", connectToSpotify);
  on("connectionReconnect", "click", startLogin);
  on("create", "click", () => startCreate());
  // Both lines about Premium are for people who have not made their developer app yet: no saved Client ID. Connecting needs one, so this also means
  // not connected. Someone with a Client ID who is refused gets the Premium message instead, where it matters.
  for (const id of ["premiumNotice", "taglinePremium"]) $(id).hidden = !!localStorage.getItem("clientId");
  if (FEEDBACK_FORM_URL) {
    $("feedbackLink").href = FEEDBACK_FORM_URL;
    for (const id of ["feedbackSection", "privacyFeedback", "privacyFeedbackWho"]) $(id).hidden = false;
  }
  for (const link of document.querySelectorAll(".privacy-link")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      $("privacySection").open = true;
      $("privacySection").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  on("createClose", "click", closeCreateDialog);
  on("createDonate", "click", () => { closeCreateDialog(); openDonatePanel(); });
  on("createOverlay", "click", (event) => { if (event.target === $("createOverlay")) dismissCreateDialog(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("createOverlay").hidden) dismissCreateDialog(); });
  guarded("tip note", () => trackTipHeight());
  guarded("donation panel", () => initDonatePanel());
  guarded("hiding the Donate button", () => initDonateChoice());
  on("removeOld", "click", removeEarlier);
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

  if (signingIn) { setLoginMessage(signInNote, true); updateButtons(); }   // coming back from Spotify: say so before the sign-in is finished
  try {
    await finishLoginIfReturning();
  } catch (err) {
    setLoginMessage(String(err.message || err));
    offerReport("loginReportHint", String(err.message || err));
  }
  setSigningIn(false);   // the sign-in is over, one way or the other: from here the connection itself is what the buttons follow
  token = loadStoredToken();
  if (!token && needsReconnect) {
    if ($("welcomeBack").hidden) revealLoginProblem();
    setLoginMessage("Please connect again so this page can build playlists.");
  }

  startupDone = true;
  showStartupProblems();
  const hasOwnFormats = localStorage.getItem("formats") !== null && localStorage.getItem("formats") !== DEFAULT_FORMATS;
  if (token) {
    $("loginSection").hidden = true;
    $("appSection").hidden = false;  // the formats are there to edit from the moment someone is signed in
    document.body.classList.add("connected", "has-editor");   // lets minimalist mode drop the title only when the editor is there to take its place
    await connectToSpotify();   // and the app only calls itself connected, and offers Create, once Spotify has answered
  } else if (hasOwnFormats) {
    // Someone who has been here before has formats worth editing, and a backup worth restoring, whether or not Spotify is connected yet.
    $("appSection").hidden = false;
    document.body.classList.add("has-editor");
    applyMinimalMode();   // and updates the buttons
  }

  $("pythonNote").textContent = "Getting Python ready. The first time takes a little while...";
  try {
    await startPython();
    $("pythonNote").textContent = "";
    refreshFormatKeys();
  } catch (err) {
    $("pythonStatus").textContent = String(err.message || err);
    $("pythonNote").textContent = "Python could not start, so building is unavailable. Check your internet connection and reload the page. Details are under More options.";
    offerReport("mainReportHint", String(err.message || err));
  }
}

main().catch(startupFailed);
