// app.js: the page's logic. It signs in to Spotify, reads playlists, and asks engine.py (running in
// Pyodide, which is Python in the browser) to plan the new playlists. This first version only previews.

// Python runtime versions to try, newest first. If one is not available, the next is used.
const PYODIDE_VERSIONS = ["v0.29.3", "v0.29.2", "v0.29.1", "v0.29.0", "v0.28.3", "v0.27.7"];
const SCOPES = "playlist-read-private playlist-read-collaborative";  // read-only for this preview
const API = "https://api.spotify.com/v1";

const ALL_FORMATS = "__all__";  // dropdown value that previews every format

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
const trackCache = new Map();  // playlist id -> songs, so repeat previews are fast

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
    $("loginMessage").textContent = "Spotify did not approve the sign-in: " + params.get("error");
    return;
  }
  if (params.get("state") !== sessionStorage.getItem("pkceState")) {
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
    $("loginMessage").textContent = "Spotify refused the sign-in: " + (data.error_description || data.error || response.status);
    return;
  }
  sessionStorage.setItem("token", JSON.stringify({ value: data.access_token, expires: Date.now() + data.expires_in * 1000 }));
}

function loadStoredToken() {
  try {
    const saved = JSON.parse(sessionStorage.getItem("token") || "null");
    if (saved && saved.expires > Date.now() + 30000) return saved.value;
  } catch (err) { /* ignore */ }
  return null;
}

function disconnect() {
  sessionStorage.removeItem("token");
  location.reload();
}

// ---------------------------------------------------------------- Spotify reading
async function spotify(path) {
  const url = path.startsWith("http") ? path : API + path;
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (response.status === 429) {
      await new Promise((r) => setTimeout(r, (Number(response.headers.get("Retry-After")) || 2) * 1000 + 500));
      continue;
    }
    if (response.status === 401) throw new Error("Your Spotify sign-in expired. Click Disconnect, then Connect again.");
    if (!response.ok) throw new Error(`Spotify returned ${response.status} for ${path.split("?")[0]}`);
    return response.json();
  }
  throw new Error("Spotify is rate limiting requests. Wait a minute and try again.");
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
      const source = await (await fetch("engine.py")).text();
      await pyodide.runPythonAsync(source);
      const get = (name) => pyodide.globals.get(name);
      py = {
        formatKeys: get("format_keys"),
        neededSources: get("needed_sources"),
        matchPlaylists: get("match_playlists"),
        planText: get("plan_text"),
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

// ---------------------------------------------------------------- the formats box and preview
function refreshFormatKeys() {
  if (!py) return;
  const select = $("formatKey");
  const previous = select.value;
  try {
    const keys = JSON.parse(py.formatKeys($("formats").value));
    select.innerHTML = "";
    for (const key of keys) select.add(new Option(key, key));
    select.add(new Option("All formats", ALL_FORMATS));
    if (keys.includes(previous) || previous === ALL_FORMATS) select.value = previous;
    $("formatsMessage").textContent = "";
    $("preview").disabled = !token;
  } catch (err) {
    showError($("formatsMessage"), err);
    setFormatPlaceholder("Fix the formats first");
    $("preview").disabled = true;
  }
}

async function preview() {
  $("preview").disabled = true;
  try {
    const formatsText = $("formats").value;
    const choice = $("formatKey").value;
    const keys = choice === ALL_FORMATS ? JSON.parse(py.formatKeys(formatsText)) : [choice];

    // which source playlists does each format need?
    const plans = [];
    const failed = [];
    for (const key of keys) {
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
      return;
    }
    const tracks = {};
    for (const name of names) {
      setOutput(`Reading "${name}"...`);
      tracks[name] = await loadTracks(match.found[name]);
    }

    setOutput("Planning...");
    const parts = [];
    for (const { key } of plans) {
      try {
        parts.push(py.planText(formatsText, key, JSON.stringify(tracks), 50, false));
      } catch (err) {
        parts.push(`=== ${key} ===\nCould not plan this format: ${cleanError(err)}`);
      }
    }
    setOutput([...parts, ...failed].join("\n\n") + "\n\nPreview only, nothing was created.");
  } catch (err) {
    setOutput("Something went wrong:\n\n" + cleanError(err));
  } finally {
    $("preview").disabled = false;
  }
}

// ---------------------------------------------------------------- start up
async function main() {
  $("redirect").textContent = redirectUri();
  $("clientId").value = localStorage.getItem("clientId") || "";
  $("formats").value = localStorage.getItem("formats") || DEFAULT_FORMATS;

  $("copyRedirect").addEventListener("click", async () => {
    const button = $("copyRedirect");
    try {
      await navigator.clipboard.writeText(redirectUri());
      button.textContent = "Copied";
    } catch (err) {
      button.textContent = "Select and copy it by hand";
    }
    setTimeout(() => { button.textContent = "Copy"; }, 2000);
  });
  $("connect").addEventListener("click", startLogin);
  $("disconnect").addEventListener("click", disconnect);
  $("preview").addEventListener("click", preview);
  $("resetFormats").addEventListener("click", () => {
    $("formats").value = DEFAULT_FORMATS;
    localStorage.setItem("formats", DEFAULT_FORMATS);
    refreshFormatKeys();
  });
  let timer = null;
  $("formats").addEventListener("input", () => {
    localStorage.setItem("formats", $("formats").value);
    clearTimeout(timer);
    timer = setTimeout(refreshFormatKeys, 300);
  });

  try {
    await finishLoginIfReturning();
  } catch (err) {
    $("loginMessage").textContent = String(err.message || err);
  }
  token = loadStoredToken();

  if (token) {
    $("loginSection").hidden = true;
    $("connectedSection").hidden = false;
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
