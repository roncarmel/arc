// app.js: the page's logic. It signs in to Spotify, reads playlists, and asks engine.py (running in
// Pyodide, which is Python in the browser) to plan the new playlists. Then it can create them.

// Python runtime versions to try, newest first. If one is not available, the next is used.
const PYODIDE_VERSIONS = ["v0.29.3", "v0.29.2", "v0.29.1", "v0.29.0", "v0.28.3", "v0.27.7"];
const SCOPES = [
  "playlist-read-private", "playlist-read-collaborative",   // read your playlists
  "playlist-modify-private", "playlist-modify-public",      // create playlists
  "user-library-modify",                                    // Spotify's generic endpoint for removing playlists
].join(" ");
const REQUIRED_SCOPES = ["playlist-modify-private", "playlist-modify-public"];
const API = "https://api.spotify.com/v1";
const ADD_CHUNK = 10;      // songs added per request (kept small; Spotify tightened some limits in 2026)
const REMOVE_CHUNK = 40;   // playlists removed per request (Spotify's maximum)

const ALL_FORMATS = "__all__";  // dropdown value that means every format

const DEFAULT_FORMATS = `FORMATS = {
    "b1-evocative": {
        "name": "📕 evocative {n}",
        "silence between segments": "30 sec",
        "segments": [
            ("☘️ intro / outro (soothing, familiar)", 30),
            ("💗 spacious + gentle", 60),
            ("💗💗 evocative", 60),
            ("💗 spacious + gentle", 60),
            ("☘️ intro / outro (soothing, familiar)", 30),
            ("silence", "2 min"),
            ("🛋 rest", 60),
        ],
    },
    # Add more formats here, following the same pattern.
}`;

const $ = (id) => document.getElementById(id);
let py = null;          // the Python functions, once loaded
let token = null;       // Spotify access token (kept in this tab only)
let me = null;          // the signed-in Spotify user
let playlists = [];     // the user's playlists
let formatsValid = false;
let busy = false;
let needsReconnect = false;
const trackCache = new Map();  // playlist id -> songs, so repeat runs are fast

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

function setOutput(text) {
  $("output").textContent = text;
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

const KOFI_URL = "https://ko-fi.com/roncarmel";

function addSupportPrompt() {
  const row = document.createElement("div");
  row.className = "support-prompt";
  row.appendChild(document.createTextNode("If this saved you time, you can say thanks here: "));
  const link = document.createElement("a");
  link.href = KOFI_URL;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Tip me";
  row.appendChild(link);
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

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function refreshBackupStatus() {
  const text = $("formats").value;
  const backedUp = localStorage.getItem("lastBackupText");
  const when = localStorage.getItem("lastBackupAt");
  let message = "";
  if (backedUp === null) {
    if (text !== DEFAULT_FORMATS) message = "You haven't downloaded a backup of your formats yet.";
  } else if (text !== backedUp) {
    message = "Your formats have been edited since your last backup.";
  } else if (when) {
    message = "Last backup: " + new Date(when).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) + ".";
  }
  $("backupStatus").textContent = message;
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

let currentPlan = null;   // the plan from the last Preview: exactly what Create will make

function invalidatePlan() {
  // Anything that changes what a plan would be hides Create until the user previews again.
  currentPlan = null;
  $("createRow").hidden = true;
}

function setFormatsText(text) {
  $("formats").value = text;
  localStorage.setItem("formats", text);
  invalidatePlan();
  refreshFormatKeys();
  refreshBackupStatus();
}

function undoLastChange() {
  if (undoText === null) return;
  setFormatsText(undoText);
  undoText = null;
  showBackupMessage("Undone. Your formats are back as they were.");
}

function downloadBackup() {
  const text = $("formats").value;
  saveFile(`playlist-formats-${today()}.txt`, text);
  markBackedUp(text);
  undoText = null;
  showBackupMessage("Backup downloaded. Look for it in your Downloads folder.");
  refreshBackupStatus();
}

async function restoreFromFile(file) {
  if (!file) return;
  undoText = null;
  if (file.size > 200000) {
    showBackupMessage(`${file.name} is too large to be a formats backup, so nothing was changed.`);
    return;
  }
  if (!py) {
    showBackupMessage("The page is still getting ready. Try again in a moment.");
    return;
  }
  let text;
  let keys;
  try {
    text = await readFileText(file);
    keys = JSON.parse(py.formatKeys(text));
  } catch (err) {
    showBackupMessage(`${file.name} doesn't look like a formats backup, so nothing was changed. (${cleanError(err)})`);
    return;
  }
  const previous = $("formats").value;
  setFormatsText(text);
  markBackedUp(text, file.lastModified);   // the file matches what is now in the box
  refreshBackupStatus();
  undoText = previous;
  showBackupMessage(`Restored ${keys.length} format${keys.length === 1 ? "" : "s"} from ${file.name}.`, true);
}

function resetToExample() {
  const previous = $("formats").value;
  if (previous === DEFAULT_FORMATS) {
    showBackupMessage("Your formats already match the example.");
    return;
  }
  setFormatsText(DEFAULT_FORMATS);
  undoText = previous;
  showBackupMessage("Reset to the example format.", true);
}

let reloadPage = () => location.reload();   // a separate function so tests can replace it

function clearSavedData() {
  // Everything this page saves lives in this browser's storage for this address, so clearing it forgets it all.
  localStorage.clear();
  sessionStorage.clear();
  reloadPage();
}

function updateButtons() {
  const ready = !!token && !!py && formatsValid && !busy;
  for (const id of ["preview", "removeOld"]) $(id).disabled = !ready;
  $("create").disabled = busy;
  $("previewAgain").disabled = !ready;
}

function setBusy(flag) {
  busy = flag;
  updateButtons();
}

// ---------------------------------------------------------------- confirmation panel
function confirmAction({ message, items = [], moreMessage = "", moreItems = [], yes, no = "Cancel" }) {
  return new Promise((resolve) => {
    const fill = (listId, textId, text, list) => {
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
    };
    fill("confirmList", "confirmText", message, items);
    fill("confirmMoreList", "confirmMoreText", moreMessage, moreItems);
    $("confirmYes").textContent = yes;
    $("confirmNo").textContent = no;
    const box = $("confirmBox");
    box.hidden = false;
    if (box.scrollIntoView) box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const finish = (answer) => {
      box.hidden = true;
      $("confirmYes").onclick = null;
      $("confirmNo").onclick = null;
      resolve(answer);
    };
    $("confirmYes").onclick = () => finish(true);
    $("confirmNo").onclick = () => finish(false);
  });
}

// ---------------------------------------------------------------- Spotify sign-in (PKCE, no server)
async function startLogin() {
  const clientId = $("clientId").value.trim();
  if (!clientId) {
    $("loginMessage").textContent = "Paste your Client ID first.";
    return;
  }
  localStorage.setItem("clientId", clientId);
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
    $("loginMessage").textContent = "Spotify did not approve the sign-in: " + params.get("error");
    $("redirectHelp").open = true;
    return;
  }
  if (params.get("state") !== sessionStorage.getItem("pkceState")) {
    revealLoginProblem();
    $("loginMessage").textContent = "The sign-in did not match this tab. Please try Connect again.";
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
    $("loginMessage").textContent = "Spotify refused the sign-in: " + (data.error_description || data.error || response.status);
    return;
  }
  sessionStorage.setItem("token", JSON.stringify({
    value: data.access_token,
    expires: Date.now() + data.expires_in * 1000,
    scope: data.scope || "",
  }));
}

function revealLoginProblem() {
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

function disconnect() {
  sessionStorage.removeItem("token");
  location.reload();
}

// ---------------------------------------------------------------- talking to Spotify
async function spotifyRequest(method, path, { params, json } = {}) {
  let url = path.startsWith("http") ? path : API + path;
  if (params) url += (url.includes("?") ? "&" : "?") + new URLSearchParams(params).toString();
  const what = `${method} ${path.split("?")[0]}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url, {
      method,
      headers: { Authorization: "Bearer " + token, ...(json ? { "Content-Type": "application/json" } : {}) },
      body: json ? JSON.stringify(json) : undefined,
    });
    if (response.status === 429) {
      await new Promise((r) => setTimeout(r, (Number(response.headers.get("Retry-After")) || 2) * 1000 + 500));
      continue;
    }
    if (response.status === 401) throw new Error("Your Spotify sign-in expired. Click Disconnect, then Connect again.");
    if (response.status === 403) {
      throw new Error(`Spotify did not allow this (${what}). Click Disconnect, then Connect again and approve every permission it asks for.`);
    }
    if (!response.ok) throw new Error(`Spotify returned ${response.status} for ${what}`);
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }
  throw new Error("Spotify is rate limiting requests. Wait a minute and try again.");
}

const spotify = (path) => spotifyRequest("GET", path);

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
  }));
}

async function loadTracks(id) {
  if (trackCache.has(id)) return trackCache.get(id);
  const entries = await pagedItems(`/playlists/${id}/items?limit=50`);
  const tracks = [];
  for (const entry of entries) {
    const t = entry && (entry.item || entry.track);  // "item" is the 2026 field name
    if (!t || t.is_local || t.type !== "track" || !t.uri) continue;
    const artist = t.artists && t.artists[0] ? t.artists[0].name : "";
    tracks.push({ uri: t.uri, ms: t.duration_ms, label: `${artist} - ${t.name}` });
  }
  trackCache.set(id, tracks);
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
      $("pythonStatus").textContent = `Loading Python ${version} (the first time takes a little while)...`;
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
      $("pythonStatus").textContent = `Python is ready (${version}).`;
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
function fillFormatDropdown(select, keys, defaultToAll) {
  const previous = select.value;
  select.innerHTML = "";
  for (const key of keys) select.add(new Option(key, key));
  select.add(new Option("All formats", ALL_FORMATS));
  if (keys.includes(previous) || previous === ALL_FORMATS) select.value = previous;
  else if (defaultToAll) select.value = ALL_FORMATS;
}

function refreshFormatKeys() {
  if (!py) return;
  try {
    const keys = JSON.parse(py.formatKeys($("formats").value));
    fillFormatDropdown($("formatKey"), keys, false);
    fillFormatDropdown($("removeKey"), keys, true);
    $("formatsMessage").textContent = "";
    formatsValid = true;
  } catch (err) {
    showError($("formatsMessage"), err);
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
  return choice === ALL_FORMATS ? JSON.parse(py.formatKeys($("formats").value)) : [choice];
}

function removeKeys() {
  const choice = $("removeKey").value;
  return choice === ALL_FORMATS ? JSON.parse(py.formatKeys($("formats").value)) : [choice];
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---------------------------------------------------------------- actions: preview, create, remove
async function gatherInputs() {
  // Works out which source playlists the chosen formats need and reads their songs.
  const formatsText = $("formats").value;
  const plans = [];
  const failed = [];
  for (const key of selectedKeys()) {
    try {
      plans.push({ key, names: JSON.parse(py.neededSources(formatsText, key)) });
    } catch (err) {
      failed.push(`=== ${key} ===\nCould not plan this format: ${cleanError(err)}`);
    }
  }
  const names = [...new Set(plans.flatMap((p) => p.names))];
  const match = JSON.parse(py.matchPlaylists(JSON.stringify(names), JSON.stringify(playlists), me.id));
  if (match.problems.length) {
    setOutput("Cannot plan yet:\n\n" + match.problems.map((p) => "- " + p).join("\n"));
    return null;
  }
  const tracks = {};
  for (const name of names) {
    setOutput(`Reading "${name}"...`);
    tracks[name] = await loadTracks(match.found[name]);
  }
  return { formatsText, keys: plans.map((p) => p.key), failed, tracks };
}

async function preview() {
  // Plans the playlists and shows the plan. Create then makes exactly this plan, with these songs.
  setBusy(true);
  clearResults();
  invalidatePlan();
  try {
    const inputs = await gatherInputs();
    if (!inputs) return;
    setOutput("Planning...");
    const built = [];
    const parts = [];
    for (const key of inputs.keys) {
      try {
        const plan = JSON.parse(py.buildPlaylists(inputs.formatsText, key, JSON.stringify(inputs.tracks), playlistLimit()));
        if (typeof plan.text !== "string") throw new Error("engine.py is out of date. Upload the newest engine.py, then reload the page.");
        built.push(plan);
        parts.push(plan.text);
      } catch (err) {
        parts.push(`=== ${key} ===\nCould not plan this format: ${cleanError(err)}`);
      }
    }
    parts.push(...inputs.failed);
    const total = built.reduce((n, plan) => n + plan.playlists.length, 0);
    setOutput(parts.join("\n\n") + "\n\n" + (total ? "Nothing has been created yet." : "Nothing can be created from this plan."));
    if (total) {
      currentPlan = { formatsText: inputs.formatsText, keys: inputs.keys, built, total };
      $("create").textContent = `Create ${plural(total, "playlist")}`;
      $("createRow").hidden = false;
    }
  } catch (err) {
    setOutput("Something went wrong:\n\n" + cleanError(err));
  } finally {
    setBusy(false);
  }
}

async function createPlaylists() {
  const plan = currentPlan;
  if (!plan) return;
  setBusy(true);
  clearResults();
  const planned = plan.built.flatMap((b) => b.playlists);
  let created = 0;
  try {
    // Only ask when something would be deleted: earlier playlists that match these formats' names.
    const existing = JSON.parse(py.existingMatches(plan.formatsText, JSON.stringify(plan.keys), JSON.stringify(playlists), me.id));
    if (existing.length) {
      const go = await confirmAction({
        message: `Replace ${plural(existing.length, "earlier playlist")}? These match the names this plan uses, and will be removed from your library first:`,
        items: existing.map((p) => p.name),
        moreMessage: `Then ${plural(planned.length, "new playlist")} will be created:`,
        moreItems: planned.map((p) => `${p.name} (${p.songs} songs, ${p.minutes} min)`),
        yes: `Remove them and create ${plural(planned.length, "playlist")}`,
      });
      if (!go) {
        setOutput("Cancelled. Nothing was changed.");
        return;
      }
      setOutput(`Removing ${plural(existing.length, "earlier playlist")}...`);
      await removePlaylists(existing.map((p) => p.id));
    }
    for (const p of planned) {
      setOutput(`Creating ${created + 1} of ${planned.length}: ${p.name}`);
      const made = await spotifyRequest("POST", "/me/playlists", { json: { name: p.name, public: false } });
      for (let i = 0; i < p.uris.length; i += ADD_CHUNK) {
        await spotifyRequest("POST", `/playlists/${made.id}/items`, { json: { uris: p.uris.slice(i, i + ADD_CHUNK) } });
      }
      created += 1;
      addResult(p.name, made.external_urls && made.external_urls.spotify, `${p.songs} songs, ${p.minutes} min`);
    }
    const notes = plan.built.filter((b) => b.stopped).map((b) => `${b.key}: ${b.stopped}`);
    setOutput(`Done. Created ${plural(created, "playlist")} in your Spotify account.` + (notes.length ? "\n\n" + notes.join("\n") : ""));
    invalidatePlan();   // so a second click cannot make duplicates; preview again to run again
    addSupportPrompt();
    await loadMyPlaylists();
  } catch (err) {
    if (created) invalidatePlan();   // some playlists exist now, so creating the plan again would duplicate them
    setOutput((created ? `Stopped after creating ${created} of ${planned.length} playlists.\n\n` : "Something went wrong:\n\n") + cleanError(err));
    try { await loadMyPlaylists(); } catch (ignore) { /* keep the original error showing */ }
  } finally {
    setBusy(false);
  }
}

async function removeEarlier() {
  setBusy(true);
  clearResults();
  try {
    const formatsText = $("formats").value;
    const keys = removeKeys();
    const existing = JSON.parse(py.existingMatches(formatsText, JSON.stringify(keys), JSON.stringify(playlists), me.id));
    if (!existing.length) {
      setOutput("No playlists matching these formats' names were found.");
      return;
    }
    const go = await confirmAction({
      message: `Remove ${plural(existing.length, "playlist")} from your library? They match the naming pattern of ${keys.join(", ")}.`,
      items: existing.map((p) => p.name),
      yes: `Remove ${plural(existing.length, "playlist")}`,
    });
    if (!go) {
      setOutput("Cancelled. Nothing was changed.");
      return;
    }
    setOutput("Removing...");
    await removePlaylists(existing.map((p) => p.id));
    setOutput(`Removed ${plural(existing.length, "playlist")} from your library.`);
    await loadMyPlaylists();
  } catch (err) {
    setOutput("Something went wrong:\n\n" + cleanError(err));
  } finally {
    setBusy(false);
  }
}

// ---------------------------------------------------------------- start up
async function main() {
  for (const el of document.querySelectorAll(".redirect-address")) el.textContent = redirectUri();
  $("clientId").value = localStorage.getItem("clientId") || "";
  $("formats").value = localStorage.getItem("formats") || DEFAULT_FORMATS;

  // Start with no flow shown. People who already saved a Client ID have an app, so open that flow for them.
  showFlow($("clientId").value ? "existing" : null);
  for (const radio of document.querySelectorAll('input[name="flow"]')) {
    radio.addEventListener("change", () => showFlow(radio.value));
  }

  for (const button of document.querySelectorAll(".copy-redirect")) {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(redirectUri());
        button.textContent = "Copied";
      } catch (err) {
        button.textContent = "Select and copy it by hand";
      }
      setTimeout(() => { button.textContent = "Copy"; }, 2000);
    });
  }
  $("clearData").addEventListener("click", () => { $("clearConfirm").hidden = false; });
  $("clearNo").addEventListener("click", () => { $("clearConfirm").hidden = true; });
  $("clearYes").addEventListener("click", clearSavedData);
  $("connect").addEventListener("click", startLogin);
  $("disconnect").addEventListener("click", disconnect);
  $("preview").addEventListener("click", preview);
  $("previewAgain").addEventListener("click", preview);
  $("create").addEventListener("click", createPlaylists);
  $("removeOld").addEventListener("click", removeEarlier);
  $("formatKey").addEventListener("change", invalidatePlan);
  $("maxPlaylists").addEventListener("input", invalidatePlan);
  $("resetFormats").addEventListener("click", resetToExample);
  $("backupDownload").addEventListener("click", downloadBackup);
  $("backupRestore").addEventListener("click", () => $("restoreFile").click());
  $("restoreFile").addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";   // so choosing the same file again still counts
    await restoreFromFile(file);
  });
  let timer = null;
  $("formats").addEventListener("input", () => {
    localStorage.setItem("formats", $("formats").value);
    invalidatePlan();
    undoText = null;
    $("backupMessage").textContent = "";   // an Undo offered earlier would now overwrite new edits
    refreshBackupStatus();
    clearTimeout(timer);
    timer = setTimeout(refreshFormatKeys, 300);
  });
  refreshBackupStatus();

  try {
    await finishLoginIfReturning();
  } catch (err) {
    $("loginMessage").textContent = String(err.message || err);
  }
  token = loadStoredToken();
  if (!token && needsReconnect) {
    revealLoginProblem();
    $("loginMessage").textContent = "Please connect again so this page can create playlists.";
  }

  if (token) {
    $("loginSection").hidden = true;
    $("connectedSection").hidden = false;
    $("appSection").hidden = false;  // the formats and the Preview / Create buttons appear once connected
    try {
      await loadMyPlaylists();
      $("connectedMessage").textContent = `Connected as ${me.display_name || me.id}. ${playlists.length} playlists found.`;
    } catch (err) {
      $("connectedMessage").textContent = String(err.message || err);
    }
  }

  try {
    await startPython();
    refreshFormatKeys();
  } catch (err) {
    $("pythonStatus").textContent = String(err.message || err);
  }
}

main();
