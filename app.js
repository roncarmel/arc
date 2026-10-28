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
const APP_VERSION = "2026-10-26v";

// Every playlist this app creates gets this at the start of its description. That is the one way the app tells its
// own playlists from ones you made by hand, so it works on any device, and nothing is stored in this browser for it.
const APP_MARKER = "Made by Ceremony Playlist Builder";                    // change this whenever the page is updated
const REPORT_FORM_URL = "https://tally.so/r/VppLZN"; // where problem reports go

const DEFAULT_FORMATS = modelToText(defaultModel());   // one format with one segment waiting for a playlist

const $ = (id) => document.getElementById(id);
let py = null;          // the Python functions, once loaded
let token = null;       // Spotify access token (kept in this tab only)
let me = null;          // the signed-in Spotify user
// Where the connection to Spotify stands: "none" (not signed in), "connecting", "ready" (the profile and playlists were read), or
// "problem" (signed in, but Spotify could not be reached or would not answer). Only "ready" allows anything that needs Spotify.
let connection = "none";
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
  $("editorNote").textContent = "Songs will be read again from Spotify the next time you create.";
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
  const row = document.createElement("div");
  row.className = "support-prompt";
  row.textContent = "If you're finding this app helpful, you can donate any amount that feels good to you as a way of saying thanks. And you\u2019re welcome regardless!";
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
    example: "You haven't made any formats yet, so there is nothing to back up.",
    never: "You haven't downloaded a backup of your formats yet.",
    edited: "Your formats have been edited since your last backup.",
    current: state.when ? "Last backup: " + state.when + "." : "Your formats are backed up.",
  }[state.kind];
  // Clear saved data: what would be lost, so a backup can be made first.
  $("clearBackupNote").textContent = {
    example: "You haven't made any formats yet, so there is nothing to lose.",
    never: "You haven't downloaded a backup of your formats yet. Download one first, or they will be gone for good.",
    edited: "Your formats have been edited since your last backup. Download a new backup first to keep the changes.",
    current: "Your formats are backed up" + (state.when ? " (last backup: " + state.when + ")" : "") + ".",
  }[state.kind];
}

function markBackedUp(text, atMs) {
  localStorage.setItem("lastBackupText", text);
  localStorage.setItem("lastBackupAt", new Date(atMs || Date.now()).toISOString());
}

function showBackupMessage(text, undo = false) {
  const box = $("backupMessage");
  box.textContent = text;
  if (undo) {
    box.appendChild(document.createTextNode(" "));
    const button = document.createElement("button");
    button.type = "button";
    button.className = "linklike";
    button.textContent = "Undo";
    button.addEventListener("click", undoLastChange);
    box.appendChild(button);
  }
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
  return [$("formats").value, $("formatKey").value, $("maxPlaylists").value].join("\u0000");
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
  showBackupMessage("Undone. Your formats are back as they were.");
}

function downloadBackup() {
  const text = $("formats").value;
  saveFile(`playlist-formats-${fileStamp()}.txt`, text);
  markBackedUp(text);
  undoText = null;
  logStep("backup downloaded");
  $("downloadMessage").textContent = "Backup downloaded. Look for it in your Downloads folder.";
  refreshBackupStatus();
}

async function restoreFromFile(file) {
  if (!file) return;
  undoText = null;
  if (file.size > 200000) {
    showBackupMessage(`${file.name} is too large to be a formats backup, so nothing was changed.`);
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
    showBackupMessage(`${file.name} doesn't look like a formats backup, so nothing was changed. (${cleanError(err)})`);
    return;
  }
  const previous = $("formats").value;
  setFormatsText(text);
  markBackedUp(text, file.lastModified);   // the file matches what is now in the box
  refreshBackupStatus();
  undoText = previous;
  logStep(`restore: ${plural(formatCount, "format")} loaded`);
  showBackupMessage(`Restored ${formatCount} format${formatCount === 1 ? "" : "s"} from ${file.name}.`, true);
}

let reloadPage = () => location.reload();   // a separate function so tests can replace it

async function clearSavedData() {
  // Everything this page saves lives in this browser's storage for this address, so clearing it forgets it all.
  localStorage.clear();
  sessionStorage.clear();
  await Promise.race([forgetAllSongs(), new Promise((r) => setTimeout(r, 1500))]);
  reloadPage();
}

function updateButtons() {
  const ready = !!token && connection === "ready" && !!py && formatsValid && !busy;
  $("create").disabled = !ready;
  $("removeOld").disabled = !ready;
  // The notes appear when Create cannot work because there is no connection, not while the app is still connecting.
  const noConnection = !$("appSection").hidden && (connection === "problem" || connection === "none");
  $("spotifyNote").hidden = !noConnection;
  $("removeNote").hidden = !noConnection;
}

function setConnection(state, message = "", kind = "retry") {
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
    setConnection("ready");
    logStep(`connected, ${plural(playlists.length, "playlist")} found`);
  } catch (err) {
    const message = String(err.message || err);
    recordError(message);
    logStep("connection failed");
    setConnection("problem", message, /sign-in expired|did not allow/.test(message) ? "reconnect" : "retry");
    // A report link is for something unexpected. A rate limit, a quota, no internet and a lapsed sign-in are known, and nothing here can fix them.
    if (!/rate limiting|request quota|Could not reach Spotify|sign-in expired|did not allow/.test(message)) offerReport("connectionReportHint", message);
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
async function startLogin() {
  const clientId = $("clientId").value.trim();
  if (!clientId) {
    setLoginMessage("Paste your Client ID first.");
    return;
  }
  localStorage.setItem("clientId", clientId);
  clearReportHints("loginReportHint");
  logStep("sign-in started");
  const verifier = randomString(96);
  const state = randomString(24);
  sessionStorage.setItem("pkceVerifier", verifier);
  sessionStorage.setItem("pkceState", state);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: base64url(await sha256(verifier)),
    state,
  });
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

function setLoginMessage(text) {
  // The message shows next to whichever Connect button is on screen.
  $("loginMessage").textContent = text;
  $("welcomeMessage").textContent = text;
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

async function disconnect() {
  sessionStorage.removeItem("token");
  await Promise.race([forgetAllSongs(), new Promise((r) => setTimeout(r, 1500))]);   // the songs kept from this account go with the sign-in
  location.reload();
}

// ---------------------------------------------------------------- talking to Spotify
const RETRY_BUDGET_MS = 30000;   // the most the app will spend waiting out short rate limits in one request
let retrySleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

let coverImage = null;   // the app's icon as a JPEG in base64, which is how Spotify takes cover art
async function loadCover() {
  if (coverImage) return coverImage;
  const response = await fetch("playlist-cover.jpg");
  if (!response.ok) throw new Error("The cover image could not be loaded.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  coverImage = btoa(binary);
  return coverImage;
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
  // The count shown in Step 1 always matches the list, including after playlists are created or removed.
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

function setFormatPlaceholder(text) {
  const select = $("formatKey");
  select.innerHTML = "";
  select.add(new Option(text, ""));
}

async function startPython() {
  setFormatPlaceholder("Loading Python...");
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
  setFormatPlaceholder("Python did not load");
  throw new Error("Could not load Python from the internet. Check your connection, then reload. Details are in the browser console. (" + (lastError && lastError.message ? lastError.message.split("\n")[0] : "unknown error") + ")");
}

// ---------------------------------------------------------------- the formats box
function fillFormatDropdown(select, formats, defaultToAll) {
  const previous = select.value;
  select.innerHTML = "";
  for (const f of formats) select.add(new Option(f.title, f.id));
  select.add(new Option("All formats", ALL_FORMATS));
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
      setFormatPlaceholder("No formats yet");
      $("removeKey").innerHTML = "";
      formatsValid = false;
      invalidatePlan();
    } else {
      fillFormatDropdown($("formatKey"), currentFormats, false);
      fillFormatDropdown($("removeKey"), currentFormats, true);
      formatsValid = true;
    }
  } catch (err) {
    currentFormats = [];
    recordError(cleanError(err));
    setFormatPlaceholder("Fix the formats first");
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

function selectedKeys() {
  const choice = $("formatKey").value;
  return choice === ALL_FORMATS ? currentFormats.map((f) => f.id) : [choice];
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
    recordError("Create blocked: a segment has no playlist chosen");
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
      failed.push(`=== ${formatLabel(key)} ===\nCould not plan this format: ${cleanError(err)}`);
      failedNotes.push(`${formatLabel(key)} could not be planned: ${cleanError(err)}`);
    }
  }
  const names = [...new Set(plans.flatMap((p) => p.names))];
  const match = JSON.parse(py.matchPlaylists(JSON.stringify(names), JSON.stringify(playlists), me.id));
  if (match.problems.length) {
    recordError(`Create blocked: ${plural(match.problems.length, "source playlist")} not found or not owned`);
    logStep("plan blocked: source playlists");
    setOutput("Cannot plan yet:\n\n" + match.problems.map((p) => "- " + p).join("\n")
      + "\n\nCheck the playlist names in your formats against your Spotify playlists. Each name must match a playlist you own.");
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
      parts.push(`=== ${formatLabel(key)} ===\nCould not plan this format: ${cleanError(err)}`);
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
    setOutput(parts.join("\n\n") + "\n\nNothing can be created from this plan.");
    return null;
  }
  setOutput("");
  return { formatsText: inputs.formatsText, keys: inputs.keys, built, total, ours, marked, others, includeOthers, text: parts.join("\n\n") + "\n\nNothing has been created yet.", problems };
}

function askToCreate(plan) {
  // Shows what the plan found and waits: "create", "cancel", "include"/"exclude" (the switch for playlists the app did not mark), or "stale" if something was edited meanwhile.
  return new Promise((resolve) => {
    // A plan with nothing to warn about is one sentence. Playlists that would be replaced or left alone, and formats that could not be planned, get lines of their own.
    const problems = plan.problems.map((n) => "Note: " + n);
    fillConfirmList("confirmList", "confirmText", `Ready to create ${plural(plan.total, "playlist")}.`, problems);
    const replacing = plan.ours.length > 0;
    const many = plan.others.length !== 1;
    fillConfirmList("confirmMoreList", "confirmMoreText",
      plan.marked.length ? `Replace ${plural(plan.marked.length, "earlier playlist")} made by this app? These match the names this plan uses, and will be removed from your library first:` : "",
      plan.marked.map((p) => p.name));
    fillConfirmList("confirmKeepList", "confirmKeepText",
      !plan.others.length ? ""
        : plan.includeOthers ? `${plural(plan.others.length, "playlist")} with matching names ${many ? "were" : "was"} not made by this app, and will be removed too because you chose to replace ${many ? "them" : "it"}:`
        : `${plural(plan.others.length, "playlist")} with matching names ${many ? "were" : "was"} not made by this app, so ${many ? "they" : "it"} will not be touched, and the new playlists skip ${many ? "those names" : "that name"}:`,
      plan.others.map((p) => p.name));
    $("confirmKeepToggleRow").hidden = plan.others.length === 0;
    $("confirmKeepToggle").checked = plan.includeOthers;
    $("confirmKeepToggleLabel").textContent = `Replace ${many ? "them" : "it"} too`;
    setLabel($("confirmYes"), replacing ? `Remove them and create ${plural(plan.total, "playlist")}` : `Create ${plural(plan.total, "playlist")}`);
    setLabel($("confirmNo"), "Cancel");
    $("planText").textContent = plan.text;
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

async function startCreate() {
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
      setActionMessage(`Creating ${created + 1} of ${planned.length}: ${p.name}`);
      const made = await spotifyRequest("POST", "/me/playlists", { json: { name: p.name, public: false, description: `${APP_MARKER} from the format "${p.label}". Please leave this description as it is: the app uses it to recognize the playlists it made.` } });
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
    if (coverBlocked) notes.push("Note: the cover art was not added, because your Spotify sign-in does not include permission to upload images. Click Disconnect, then Connect again to allow it. Playlists you create after that will get the cover.");
    else if (coverUnloaded) notes.push("Note: the cover art could not be loaded, so the playlists have Spotify's default cover.");
    else if (coverFailed) notes.push(`Note: Spotify would not accept the cover art for ${plural(coverFailed, "playlist")}.`);
    createSucceeded = created > 0;
    const doneText = `Done. Created ${plural(created, "playlist")} in your Spotify account.` + (notes.length ? "\n\n" + notes.join("\n\n") : "");
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
    setActionMessage((created ? `Stopped after creating ${created} of ${planned.length} playlists.\n\n` : "Something went wrong:\n\n") + cleanError(err));
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
      setRemoveMessage("No playlists matching these formats' names were found.");
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
  $("kofiClose").addEventListener("click", close);
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
  document.addEventListener("click", (event) => { if (!list.hidden && !(event.target.closest && event.target.closest(".theme-picker"))) close(false); });
  show();
}

async function main() {
  logStep("page opened");
  $("appVersionLabel").textContent = APP_VERSION;
  refreshReportBox();
  for (const el of document.querySelectorAll(".redirect-address")) el.textContent = redirectUri();
  $("clientId").value = localStorage.getItem("clientId") || "";
  $("formats").value = localStorage.getItem("formats") || DEFAULT_FORMATS;
  initThemeChooser();
  initEditor();
  refreshFormatKeys();
  setOutput("");

  // Start with no flow shown. People who already saved a Client ID have an app, so open that flow for them.
  showFlow($("clientId").value ? "existing" : null);
  $("welcomeBack").hidden = !$("clientId").value;   // someone with a saved Client ID only needs to reconnect
  $("setupDetails").open = !$("clientId").value;     // the setup steps stay one click away
  for (const radio of document.querySelectorAll('input[name="flow"]')) {
    radio.addEventListener("change", () => showFlow(radio.value));
  }

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
  $("reportLink").addEventListener("click", refreshReportBox);
  $("moreOptions").addEventListener("toggle", () => { if ($("moreOptions").open) refreshReportBox(); });
  for (const id of REPORT_HINTS) {
    const link = $(id).querySelector("a");
    link.addEventListener("click", () => { link.href = reportUrl(); });
  }
  $("clearData").addEventListener("click", () => {
    $("clearConfirm").hidden = false;
    $("clearData").disabled = true;    // the question is already open, so the button that opened it waits
  });
  $("clearNo").addEventListener("click", () => {
    $("clearConfirm").hidden = true;
    $("clearData").disabled = false;
  });
  $("clearYes").addEventListener("click", clearSavedData);
  $("connect").addEventListener("click", startLogin);
  $("connectReturning").addEventListener("click", startLogin);
  $("disconnect").addEventListener("click", disconnect);
  $("connectionRetry").addEventListener("click", connectToSpotify);
  $("connectionReconnect").addEventListener("click", startLogin);
  $("create").addEventListener("click", startCreate);
  $("createClose").addEventListener("click", closeCreateDialog);
  $("createDonate").addEventListener("click", () => { closeCreateDialog(); openDonatePanel(); });
  $("createOverlay").addEventListener("click", (event) => { if (event.target === $("createOverlay")) dismissCreateDialog(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("createOverlay").hidden) dismissCreateDialog(); });
  trackTipHeight();
  initDonatePanel();
  $("removeOld").addEventListener("click", removeEarlier);
  $("formatKey").addEventListener("change", () => invalidatePlan());
  $("maxPlaylists").addEventListener("input", () => invalidatePlan());
  $("backupDownload").addEventListener("click", downloadBackup);
  $("backupRestore").addEventListener("click", () => $("restoreFile").click());
  $("restoreFile").addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";   // so choosing the same file again still counts
    await restoreFromFile(file);
  });
  $("formats").addEventListener("input", () => {
    localStorage.setItem("formats", $("formats").value);
    invalidatePlan();
    undoText = null;
    $("backupMessage").textContent = "";   // an Undo offered earlier would now overwrite new edits
    refreshBackupStatus();
    refreshFormatKeys();
  });
  refreshBackupStatus();

  try {
    await finishLoginIfReturning();
  } catch (err) {
    setLoginMessage(String(err.message || err));
    offerReport("loginReportHint", String(err.message || err));
  }
  token = loadStoredToken();
  if (!token && needsReconnect) {
    if ($("welcomeBack").hidden) revealLoginProblem();
    setLoginMessage("Please connect again so this page can create playlists.");
  }

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
    updateButtons();
  }

  $("pythonNote").textContent = "Getting Python ready. The first time takes a little while...";
  try {
    await startPython();
    $("pythonNote").textContent = "";
    refreshFormatKeys();
  } catch (err) {
    $("pythonStatus").textContent = String(err.message || err);
    $("pythonNote").textContent = "Python could not start, so creating is unavailable. Check your internet connection and reload the page. Details are under More options.";
    offerReport("mainReportHint", String(err.message || err));
  }
}

main();
