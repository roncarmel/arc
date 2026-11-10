// shared-spotify.js: talking to Spotify, shared by this repository's apps (the playlist builder, and later the tagger). Sign-in (PKCE in the browser,
// no secret, no server), the refresh token, requests with their limits and waits, and the record of those limits. It shows nothing itself: each page
// fills spotifyHooks with what to do and say, so this file names no element of any page. Loaded before the page's own script.
(globalThis.scriptVersions = globalThis.scriptVersions || {})["shared-spotify.js"] = "2026-11-09v";   // this file's version, checked against the app's at startup (checkScriptVersions in app.js)

const spotifyHooks = {
  scopes: "",                  // the permissions the sign-in asks for, space separated
  requiredScopes: [],          // a kept sign-in without all of these is not used
  log: (text) => {},           // a step, for problem reports
  oldSignIn: () => {},         // a kept sign-in was missing a required permission and was dropped
  expiredText: () => "Your Spotify sign-in expired. Connect again.",
  signInExpired: (message) => {},   // the sign-in ran out and could not be renewed
  refusedText: (what) => `Spotify did not allow this (${what}). Sign in again and approve every permission it asks for.`,
  pauseStarted: (first) => {}, // a long wait from Spotify began (first: none was running)
  pauseChanged: (secondsLeft) => {},   // every second of a wait, and once with 0 at its end
  pauseEnded: () => {},        // the wait is over: time to connect again
};

// ---------------------------------------------------------------- the basics
// Not called API: Pyodide 0.29 treats a global named API as its own and fails to start (it falls back to an older version).
const SPOTIFY_API = "https://api.spotify.com/v1";

let token = null;       // Spotify access token (kept in this tab only)

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

// Spotify's free developer app now needs Premium on the account that owns it. Without it, Spotify refuses requests with a 403 that says so.
const PREMIUM_REQUIRED_MESSAGE = "Spotify says the account that owns this Client ID needs Premium. A free Spotify account will not work. Once that account has Premium, try again.";

// the window that holds the page: itself, or, in Developer options' Phone width frame, the outer page (Spotify's sign-in will not open in a frame)
function pageWindow() {
  try { if (window.top !== window && window.top.location.origin === location.origin && window.top.document.getElementById("devPhoneFrame")) return window.top; } catch (e) {}
  return window;
}

// ---------------------------------------------------------------- sign-in (PKCE, no server)
// Readies Spotify's sign-in page for this Client ID and gives a function that goes there, so the page can get ready for leaving first.
// Spotify sends the person back to this page's address with a code, which finishSpotifySignIn turns into a sign-in. switchAccount: Spotify
// shows its page even when already signed in, where "Not you?" picks another account. Throws when this browser cannot make the sign-in's check value.
async function openSpotifySignIn(clientId, { switchAccount = false } = {}) {
  const verifier = randomString(96);
  const state = randomString(24);
  sessionStorage.setItem("pkceVerifier", verifier);
  sessionStorage.setItem("pkceState", state);
  const challenge = base64url(await sha256(verifier));
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: spotifyHooks.scopes,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  });
  if (switchAccount) params.set("show_dialog", "true");
  return () => { pageWindow().location.href = "https://accounts.spotify.com/authorize?" + params.toString(); };
}

// Back from Spotify's sign-in page: gives null when this address is not a return from Spotify, {} once signed in, or { problem, report }:
// what to tell the person, and, when it is worth a problem report, what the report says.
async function finishSpotifySignIn() {
  const params = new URLSearchParams(location.search);
  if (!params.has("code") && !params.has("error")) return null;
  history.replaceState({}, "", redirectUri());  // tidy the address bar
  if (params.has("error")) return { problem: "Spotify did not approve the sign-in: " + params.get("error") };
  if (params.get("state") !== sessionStorage.getItem("pkceState")) return { problem: "The sign-in did not match this tab. Please try Connect again." };
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
  if (!response.ok) return { problem: "Spotify refused the sign-in: " + (data.error_description || data.error || response.status), report: "Spotify refused the sign-in: " + (data.error || response.status) };
  keepToken(data);
  return {};
}

// The sign-in lasts between visits. Spotify's sign-in also gives a refresh token, kept in this browser with the Client ID it belongs to, so a sign-in that
// has run out (after an hour, or when the tab was closed) is renewed in the background, without leaving the page. Sign out and clear data removes it. When
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
        spotifyHooks.log("sign-in renewal refused");
        return null;
      }
      keepToken(data);
      const renewed = loadStoredToken();
      spotifyHooks.log(renewed ? "sign-in renewed" : "sign-in renewed without every permission");
      return renewed;
    } catch (err) {
      spotifyHooks.log("sign-in renewal: no answer");   // the refresh token is kept, for when the connection is back
      return null;
    } finally {
      renewing = null;
    }
  })();
  return renewing;
}

function loadStoredToken() {
  try {
    const saved = JSON.parse(sessionStorage.getItem("token") || "null");
    if (saved && saved.expires > Date.now() + 30000) {
      const granted = String(saved.scope || "").split(/\s+/);
      if (spotifyHooks.requiredScopes.every((s) => granted.includes(s))) return saved.value;
      sessionStorage.removeItem("token");  // an older, read-only sign-in
      spotifyHooks.oldSignIn();
    }
  } catch (err) { /* ignore */ }
  return null;
}

// ---------------------------------------------------------------- requests
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
  spotifyHooks.log(`paused for ${wait} s`);
  tickPause();
  spotifyHooks.pauseStarted(first);
}
function tickPause() {
  clearTimeout(pauseTimer);
  pauseTimer = null;
  const left = pausedSecondsLeft();
  spotifyHooks.pauseChanged(left);
  if (left) {
    pauseOn = true;
    pauseTimer = setTimeout(tickPause, 1000);
    return;
  }
  if (!pauseOn) return;
  pauseOn = false;   // the time is up: the page connects again
  spotifyHooks.log("wait over");
  spotifyHooks.pauseEnded();
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
    spotifyHooks.log(result ? `wait asked: ${result.status}${result.wait ? ", " + result.wait + " s" : ""}` : "wait asked: no answer");
    const limits = readRecord(LIMITS_KEY, []);
    const open = limits.length && !limits[limits.length - 1].note && !limits[limits.length - 1].relay ? limits[limits.length - 1] : null;
    if (open) { open.relay = result ? { at: Date.now(), path: path.replace(/[A-Za-z0-9]{22}/, "{id}"), status: result.status, retryAfter: result.wait, reason: result.reason } : { at: Date.now(), status: "no answer" }; writeRecord(LIMITS_KEY, limits); }
    if (waitAsked.path === path) Object.assign(waitAsked, { at: Date.now(), result, pending: null });   // a later ask of another kind replaced this one
    return result;
  })();
  return waitAsked.pending;
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
      const message = spotifyHooks.expiredText();
      spotifyHooks.signInExpired(message);
      throw new Error(message);
    }
    if (response.status === 403) {   // one refused request (a playlist you cannot read, a missing permission) does not mean the connection is lost
      let body = "";
      try { body = await response.text(); } catch (err) { /* no body */ }
      if (/premium/i.test(body)) throw new Error(PREMIUM_REQUIRED_MESSAGE);   // reconnecting cannot fix this, so it gets its own message
      throw new Error(spotifyHooks.refusedText(what));
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

async function pagedItems(path) {
  const items = [];
  let page = await spotify(path);
  for (;;) {
    items.push(...(page.items || []));
    if (!page.next) return items;
    page = await spotify(page.next);
  }
}
