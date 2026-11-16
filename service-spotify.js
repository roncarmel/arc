// service-spotify.js: Spotify as Arc's music service, also used by this repository's other apps (later the tagger). Sign-in (PKCE in the browser, no secret,
// no server), the refresh token, requests with their limits and waits, and the record of those limits; at its end the `service` object, the only way the rest
// of Arc talks to Spotify (work/tidal-plan.md, "The service layer"): every Spotify address, URI and quirk stays in this file. It shows nothing itself: each page
// fills serviceHooks with what to do and say, so this file names no element of any page. Loaded before the page's own script.
(globalThis.scriptVersions = globalThis.scriptVersions || {})["service-spotify.js"] = "2026-11-16zj";   // this file's version, checked against the app's at startup (checkScriptVersions in app.js)

// The permissions Arc's sign-in asks for. Another page of this repository (the tagger) may set its own in serviceHooks (shared-service.js).
const SCOPES = [
  "playlist-read-private", "playlist-read-collaborative",   // read your playlists
  "playlist-modify-private", "playlist-modify-public",      // create playlists
  "user-library-modify",                                    // Spotify's generic library endpoint: removing playlists, and a song's menu in Music sharing saving it to Liked Songs
  "ugc-image-upload",                                       // the cover art on the playlists it creates
].join(" ");
const REQUIRED_SCOPES = ["playlist-modify-private", "playlist-modify-public"];   // cover art is optional, so an older sign-in without it keeps working


// ---------------------------------------------------------------- the basics
// Not called API: Pyodide 0.29 treats a global named API as its own and fails to start (it falls back to an older version).
const SPOTIFY_API = "https://api.spotify.com/v1";

let token = null;       // Spotify access token (kept in this tab only)





// Spotify's free developer app now needs Premium on the account that owns it. Without it, Spotify refuses requests with a 403 that says so.
const PREMIUM_REQUIRED_MESSAGE = "Spotify says the account that owns this Client ID needs Premium. A free Spotify account will not work. Once that account has Premium, try again.";


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
    scope: serviceHooks.scopes || SCOPES,
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
  }, NO_ANSWER);
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
      }, NO_ANSWER);
      let data = {};
      try { data = await response.json(); } catch (err) { /* no body */ }
      if (!response.ok || !data.access_token) {
        if (response.status === 400 || response.status === 401) keepRefresh(null);   // refused for good: reconnecting is the only way
        serviceHooks.log("sign-in renewal refused");
        return null;
      }
      keepToken(data);
      const renewed = loadStoredToken();
      serviceHooks.log(renewed ? "sign-in renewed" : "sign-in renewed without every permission");
      return renewed;
    } catch (err) {
      serviceHooks.log("sign-in renewal: no answer");   // the refresh token is kept, for when the connection is back
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
      if ((serviceHooks.requiredScopes || REQUIRED_SCOPES).every((s) => granted.includes(s))) return saved.value;
      sessionStorage.removeItem("token");  // an older, read-only sign-in
      serviceHooks.oldSignIn();
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
function startSpotifyPause(wait, reason) {
  const before = spotifyPause();
  const first = !before;
  try { localStorage.setItem(PAUSE_KEY, JSON.stringify({ until: Date.now() + wait * 1000, from: (before && before.from) || Date.now(), reason: reason || "", clientId: localStorage.getItem("clientId") || "" })); } catch (err) { /* private browsing: the wait lasts this visit */ }
  serviceHooks.log(`paused for ${wait} s`);
  tickPause();
  serviceHooks.pauseStarted(first);
}
function tickPause() {
  clearTimeout(pauseTimer);
  pauseTimer = null;
  const left = pausedSecondsLeft();
  serviceHooks.pauseChanged(left);
  if (left) {
    pauseOn = true;
    pauseTimer = setTimeout(tickPause, 1000);
    return;
  }
  if (!pauseOn) return;
  pauseOn = false;   // the time is up: the page connects again
  serviceHooks.log("wait over");
  serviceHooks.pauseEnded();
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
    serviceHooks.log(result ? `wait asked: ${result.status}${result.wait ? ", " + result.wait + " s" : ""}` : "wait asked: no answer");
    const limits = readRecord(LIMITS_KEY, []);
    const open = limits.length && !limits[limits.length - 1].note && !limits[limits.length - 1].relay ? limits[limits.length - 1] : null;
    if (open) { open.relay = result ? { at: Date.now(), path: path.replace(/[A-Za-z0-9]{22}/, "{id}"), status: result.status, retryAfter: result.wait, reason: result.reason } : { at: Date.now(), status: "no answer" }; writeRecord(LIMITS_KEY, limits); }
    if (waitAsked.path === path) Object.assign(waitAsked, { at: Date.now(), result, pending: null });   // a later ask of another kind replaced this one
    return result;
  })();
  return waitAsked.pending;
}

const NO_ANSWER = "Spotify did not answer. Check your internet connection and try again.";


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
      }, NO_ANSWER);
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
      const message = serviceHooks.expiredText();
      serviceHooks.signInExpired(message);
      throw new Error(message);
    }
    if (response.status === 403) {   // one refused request (a playlist you cannot read, a missing permission) does not mean the connection is lost
      let body = "";
      try { body = await response.text(); } catch (err) { /* no body */ }
      if (/premium/i.test(body)) throw new Error(PREMIUM_REQUIRED_MESSAGE);   // reconnecting cannot fix this, so it gets its own message
      throw Object.assign(new Error(serviceHooks.refusedText(what)), { status: 403 });
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

// ---------------------------------------------------------------- the service: what the rest of Arc uses (work/tidal-plan.md, "The service layer")
// Every service file sets `service` with the same members, so the page never names Spotify's addresses, URIs or limits. A song outside this file is
// { id, key, ms, label, album }: id is Spotify's track ID, key "isrc:..." when Spotify gives one (engine.py's song_id).
const ADD_CHUNK = 100;     // songs added per request (Spotify's documented maximum; fewer requests means fewer rate limits)
const ADD_CHUNK_SMALL = 10; // what is tried instead if Spotify refuses 100
const REMOVE_CHUNK = 40;   // playlists removed per request (Spotify's maximum)
let addChunk = ADD_CHUNK;   // lowered for the visit if Spotify refuses that many
const LIST_RETRY_MS = 10000;   // reading short pages of the playlist list again stops after this, in all
const SPLIT_MAX = 60;   // requests one reading of the list may spend reading empty pages in pieces
const SPLIT_GAP_MS = 100;   // between those requests: a burst of them has never been refused, but a refusal can mean hours of waiting (Ron, 2026-11-16)
const trackUri = (id) => "spotify:track:" + id;
const playlistUri = (id) => "spotify:playlist:" + id;

// A playlist's items from Spotify, as the songs the app keeps
function songsFromEntries(entries) {
  const tracks = [];
  for (const entry of entries) {
    const t = entry && (entry.item || entry.track);  // "item" is the 2026 field name
    if (!t || t.is_local || t.type !== "track" || !t.uri) continue;
    const artist = t.artists && t.artists[0] ? t.artists[0].name : "";
    const isrc = t.external_ids && typeof t.external_ids.isrc === "string" && t.external_ids.isrc ? t.external_ids.isrc.toUpperCase() : "";
    const song = { id: String(t.uri).replace("spotify:track:", ""), ms: t.duration_ms, label: `${artist} - ${t.name}` };
    if (isrc) song.key = "isrc:" + isrc;   // one recording, whichever release it came from (engine.py's song_id)
    if (t.album && t.album.name) song.album = t.album.name + (t.album.release_date ? `, ${String(t.album.release_date).slice(0, 4)}` : "");
    tracks.push(song);
  }
  return tracks;
}

// The person's playlists, every page. Spotify sometimes sends a page empty or short though its total says there is more (the first page came with 0 of 98,
// 2026-11-13, and the merge then asked about saves that were there). A short page is read again, up to 3 times, a moment apart. Gives the playlists, with
// what the reading found on the array: total (Spotify's count), pages ([offset, items, total, next, note] as read), hidden (where Spotify sent null),
// leftOut (counted but never sent), unreadable (offsets of slots Spotify sent empty even alone), splits (each empty page read in pieces), reread (a short
// page came right when read again), and short: the error a report carries when the list is still short.
async function listSpotifyPlaylists({ onPage } = {}) {
  const raw = [];
  const short = (pg) => { const n = (pg.items || []).length; if (typeof pg.total !== "number" || typeof pg.offset !== "number") return false; return n < Math.min(pg.limit || 50, pg.total - pg.offset); };
  // A page that comes short twice with the same playlists is Spotify's answer, not a slip: it leaves out playlists it will not show an app in development
  // mode (its own, as Discover Weekly or editorial ones) though its total counts them. Those are taken as all there is (`steady`); an empty page never is.
  // An account following 4 of them never connected, 4 short every time (937 of 941, then 939 of 943; the first user report, 2026-11-15).
  // The same playlists in any order (Spotify's order may differ between reads). Reads that differ are joined: every playlist in any of them is in the library,
  // so a page whose reads together come to its full count is whole (`joined`).
  const idsOf = (pg) => (pg.items || []).map((p) => (p ? p.id : "")).sort().join();
  const expected = (pg) => Math.min(pg.limit || 50, pg.total - pg.offset);
  let steady = 0;
  // Reading short pages again stops after 10 s in all, however many came short: a build sat a minute or more on Reading your playlists, then failed (2026-11-15)
  const retryUntil = Date.now() + LIST_RETRY_MS;
  const readPage = async (url) => {
    let pg = await spotify(url);
    if (emptyPage(pg)) return splitPage(pg);
    const seen = new Map();
    const join = (q) => (q.items || []).forEach((p, i) => { if (p && !seen.has(p.id)) seen.set(p.id, p); else if (!p) seen.set("null:" + i, null); });
    join(pg);
    for (let tries = 0; tries < 3 && short(pg) && Date.now() < retryUntil; tries++) {
      pages.push([pg.offset, (pg.items || []).length, pg.total, !!pg.next, "short, read again"]);
      await new Promise((r) => setTimeout(r, 700 * (tries + 1)));
      const again = await spotify(url);
      const same = short(again) && (again.items || []).length > 0 && idsOf(pg) === idsOf(again);
      join(again);
      pg = again;
      if (!short(pg)) break;
      if (typeof pg.total === "number" && typeof pg.offset === "number" && seen.size >= expected(pg)) { pg = { ...pg, items: [...seen.values()] }; pages.push([pg.offset, pg.items.length, pg.total, !!pg.next, "short, joined from reads"]); break; }
      if (same) { steady += expected(pg) - pg.items.length; pages.push([pg.offset, pg.items.length, pg.total, !!pg.next, "short, the same again: taken"]); break; }
    }
    return pg;
  };
  // A page that comes empty is read at once in smaller pieces, 10, then 2, then 1, with no reading again first (Ron, 2026-11-16): for a while Spotify cannot
  // produce certain entries of the list, and sends every page holding one empty, at any size, while the rest reads fine in pieces; reading the same page
  // again seconds later never helped (see "Spotify's empty pages" in CLAUDE.md). A slot still empty alone is left out (`unreadable`, its offset kept).
  // A level whose pieces all come empty stops there (everything is failing, splitting further would only spend requests), and so does a list that has
  // spent SPLIT_MAX requests: what is left unread leaves the list short, and Arc waits as before.
  const emptyPage = (pg) => !!pg && Array.isArray(pg.items) && !pg.items.length && typeof pg.total === "number" && typeof pg.offset === "number" && pg.offset < pg.total;
  const unreadable = [];
  const splits = [];   // per page split: {offset, requests, unreadable: [offsets]}
  let splitRequests = 0;
  const readRange = async (offset, count, sizes, split) => {
    // the playlists from offset to offset + count, in order; null for a slot left unread (a level all empty, or the budget spent)
    const size = sizes[0];
    const pieces = [];
    for (let o = offset; o < offset + count; o += size) pieces.push([o, Math.min(size, offset + count - o)]);
    const got = [];
    for (const [o, n] of pieces) {
      if (splitRequests >= SPLIT_MAX) { got.push({ o, n, items: null, skipped: true }); continue; }
      await retrySleep(SPLIT_GAP_MS);
      splitRequests += 1; split.requests += 1;
      const q = await spotify(`/me/playlists?offset=${o}&limit=${n}`);
      got.push({ o, n, items: (q.items || []).length ? q.items : null });
    }
    if (size > 1 && pieces.length > 1 && got.every((g) => !g.items)) return { items: [], unread: got.reduce((a, g) => a + g.n, 0) };   // all empty: stop here
    const items = [];
    let unread = 0;
    for (const g of got) {
      if (g.items) { items.push(...g.items); if (g.items.length < g.n) { steady += g.n - g.items.length; split.leftOut += g.n - g.items.length; } continue; }   // short, not empty: Spotify left some out, as on whole pages
      if (g.skipped) { unread += g.n; continue; }
      if (g.n === 1) { unreadable.push(g.o); split.unreadable.push(g.o); continue; }
      if (sizes.length > 1) { const r = await readRange(g.o, g.n, sizes.slice(1), split); items.push(...r.items); unread += r.unread; continue; }
      unread += g.n;
    }
    return { items, unread };
  };
  const splitPage = async (pg) => {
    const count = Math.min(pg.limit || 50, pg.total - pg.offset);
    const split = { offset: pg.offset, requests: 0, unreadable: [], leftOut: 0 };
    const r = await readRange(pg.offset, count, [10, 2, 1], split);
    if (split.unreadable.length * 2 > count) {   // most of the page unreadable is everything failing, not a few slots: left unread, so the list stays short
      r.unread += split.unreadable.length;
      for (const o of split.unreadable) unreadable.splice(unreadable.indexOf(o), 1);
      split.unreadable = [];
    }
    split.unread = r.unread;
    splits.push(split);
    pages.push([pg.offset, 0, pg.total, !!pg.next, `empty, split: ${r.items.length} arrived in ${split.requests} requests, ${split.unreadable.length} unreadable, ${split.leftOut} left out, ${r.unread} unread`]);
    return { ...pg, items: r.items };
  };
  const pages = [];
  let page = await readPage("/me/playlists?limit=50");
  const total = typeof page.total === "number" ? page.total : null;
  const pageCount = total ? Math.ceil(total / (page.limit || 50)) : 1;
  for (let n = 1; ; n++) {
    pages.push([page.offset, (page.items || []).length, page.total, !!page.next]);
    raw.push(...(page.items || []));
    if (onPage) onPage(n, pageCount);
    if (!page.next) break;
    page = await readPage(page.next);
  }
  // Spotify sends null in place of a playlist it will not show to an app in development mode (its own, as Discover Weekly or editorial ones, since 2024).
  // Those count as arrived: Arc can never read them, so leaving them out of the count kept an account that follows some from ever connecting (937 of 941,
  // a report of 2026-11-15). Where they sat is kept for the records.
  const hidden = raw.map((p, i) => (p ? null : i)).filter((i) => i !== null);
  if (hidden.length) recordNote(`playlist list: ${hidden.length} hidden by Spotify (null items) at ${JSON.stringify(hidden.slice(0, 20))}`);
  if (steady) recordNote(`playlist list: ${steady} left out by Spotify (pages short the same way twice), pages [offset, items, total, next] ${JSON.stringify(pages)}`);
  const got = raw.length;
  let shortError = "";
  if (total !== null && raw.length !== total) recordNote(`playlist list: ${raw.length} items, Spotify's total ${total}, pages [offset, items, total, next] ${JSON.stringify(pages)}`);
  if (unreadable.length) recordNote(`playlist list: ${unreadable.length} unreadable by Spotify at ${JSON.stringify(unreadable.slice(0, 20))}, splits ${JSON.stringify(splits)}`);
  if (total !== null && got + steady + unreadable.length < total) {
    // the short reads go into the report too ([offset, items], each read), since a report is often all there is (2026-11-15)
    const reads = pages.filter((x) => x[4] || (typeof x[2] === "number" && x[1] < Math.min(50, x[2] - x[0]))).map((x) => [x[0], x[1]]).slice(0, 12);
    shortError = `Spotify listed ${got} of ${total} playlists, after reading again${hidden.length ? ` (${hidden.length} of them hidden)` : ""}${steady ? ` (${steady} left out the same way twice)` : ""}; short reads [offset, items] ${JSON.stringify(reads)}${splits.length ? `; empty pages read in pieces ${JSON.stringify(splits)}` : ""}`;
  }
  const list = raw.filter(Boolean).map(listEntry);
  return Object.assign(list, { total, pages, hidden, leftOut: steady, unreadable, splits, reread: pages.some((x) => x[4] && !/^empty, split/.test(x[4])), short: shortError });
}
// A playlist as the list gives it to Arc, from the list or read on its own (`readListEntry`)
function listEntry(p) {
  return {
    id: p.id,
    name: p.name,
    owner: p.owner && p.owner.id,
    collaborative: !!p.collaborative,
    image: Array.isArray(p.images) && p.images.length ? p.images[p.images.length - 1].url : null,   // Spotify lists the largest first
    cover: Array.isArray(p.images) && p.images.length ? p.images[0].url : null,   // the largest, for Music sharing
    count: p.tracks && typeof p.tracks.total === "number" ? p.tracks.total : (p.items && typeof p.items.total === "number" ? p.items.total : null),
    description: typeof p.description === "string" ? p.description : null,
    version: typeof p.snapshot_id === "string" && p.snapshot_id ? p.snapshot_id : null,   // changes whenever the playlist does
  };
}

let spotifyIsrcRefused = false;   // Spotify refused the isrc: search filter this visit: songs are found by title and artist instead (findByIsrc)
async function pagedItems(path, { gapMs = 0, stopped = null, onSongs = null } = {}) {
  // gapMs and stopped: read gently (Music sharing's slow reading), a rate limit an error at once; null when stopped partway. onSongs(n): n items read so far, after each page
  const slow = !!(gapMs || stopped);
  const items = [];
  while (path) {
    if (stopped && stopped()) return null;
    if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
    const page = await spotifyRequest("GET", path, slow ? { noWait: true } : {});
    items.push(...(page.items || []));
    if (onSongs) onSongs(items.length);
    path = page.next || null;
  }
  if (stopped && stopped()) return null;
  return items;
}

// A Spotify ID is a 128-bit number in 22 base-62 digits. Saves and participants' playlists pack playlist IDs as its 16 bytes (TIDAL's are UUIDs, 16 bytes too).
const SPOTIFY_ID_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function spotifyIdToBytes(id) {
  if (!/^[0-9A-Za-z]{22}$/.test(id)) return null;
  let n = 0n;
  for (const ch of id) n = n * 62n + BigInt(SPOTIFY_ID_DIGITS.indexOf(ch));
  if (n >= (1n << 128n)) return null;
  const out = [];
  for (let i = 0; i < 16; i++) { out.unshift(Number(n & 0xffn)); n >>= 8n; }
  return out;
}

function bytesToSpotifyId(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let id = "";
  for (let i = 0; i < 22; i++) { id = SPOTIFY_ID_DIGITS[Number(n % 62n)] + id; n /= 62n; }
  return id;
}

const spotifyService = {
  key: "spotify",
  name: "Spotify",
  // Spotify's mark in one color (the text's), the bars cut out, as Spotify's brand rules ask: no circle of another color, no effects. For the page to draw.
  mark: (cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M12 0a12 12 0 1 0 0 24a12 12 0 1 0 0-24zM17.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>`,
  // the kind of a problem from a message this file wrote (quota, rate-limit, network, premium), or null; the page keeps the sign-in's own
  problemKind(message) {
    const m = String(message || "");
    if (/request quota/.test(m)) return "quota";
    if (/rate limiting/.test(m)) return "rate-limit";
    if (m.includes(NO_ANSWER) || m.includes("Could not reach Spotify")) return "network";
    if (m.includes(PREMIUM_REQUIRED_MESSAGE)) return "premium";
    return null;
  },
  // what an account needs to use Arc, for page text; null when any account will do
  requirement: { name: "Spotify Premium", why: "Arc relies on a feature that is not available in Spotify Free accounts." },
  limits: { description: 300, addBatch: ADD_CHUNK },
  can: { covers: true, privatePlaylists: true, likedSongs: true },
  // Arc's silent tracks by length in seconds (engine.py combines them): Silence for Playlists, by silence moments
  silence: { 30: "5kiJ9x6eX37H5J9lyyXkua", 60: "4iOpD4OvwCi6ndxpNYk4HG", 180: "5yM42dAylwB17DomSHGcXM", 300: "7depNAqAh1r9unkIRzibID", 600: "3mkOlbSv5RYadx0JsjTrKq" },

  // sign-in
  signIn: (clientId, options) => openSpotifySignIn(clientId, options),
  finishSignIn: () => finishSpotifySignIn(),
  renewSignIn: async () => { const renewed = await renewSignIn(); if (renewed) token = renewed; return renewed; },   // gives the new sign-in, or null
  signedIn: () => !!token,
  // a playlist ID as 16 bytes (null when it is not one), and back, for packing into descriptions
  idToBytes: (id) => spotifyIdToBytes(id),
  idFromBytes: (bytes) => bytesToSpotifyId(bytes),
  // a wait Spotify asked for: {until, from, reason} while it lasts, else null; waitLeft is its seconds left, 0 when none
  wait: () => spotifyPause(),
  waitLeft: () => pausedSecondsLeft(),
  tick: () => tickPause(),   // every second: counts a wait down, and notices its end
  waitRelay: () => !!WAIT_RELAY_URL,   // a refusal with no readable wait is asked about through Arc's relay (Privacy says so)
  requestLog: () => ({ limits: readRecord(LIMITS_KEY, []), callsPerMinute: readRecord(CALLS_KEY, {}) }),   // the record of requests and refusals, for reports
  authHeader: () => (token ? "Bearer " + token : null),   // for Arc's own worker, which asks Spotify who this is
  storedSignIn: () => (token = loadStoredToken()),   // this tab's sign-in, if it is still good
  canRenew: () => !!storedRefresh(),       // a sign-in from an earlier visit is kept
  coversAllowed: () => hasScope("ugc-image-upload"),   // the sign-in was approved for cover art (an optional permission)
  async me() {
    const r = await spotify("/me");
    return { id: r.id, name: r.display_name || r.id, country: r.country || "" };
  },

  // playlists
  listMyPlaylists: (options) => listSpotifyPlaylists(options),
  async readPlaylist(id) {
    const r = await spotify(`/playlists/${id}?fields=id,name,owner(id),description,images`);
    return { id: r.id || id, name: r.name, description: r.description, owner: r.owner && r.owner.id, image: Array.isArray(r.images) && r.images.length ? r.images[r.images.length - 1].url : null };
  },
  // one playlist read by its ID in the list's shape, for one the list could not send (an unreadable slot); null when Spotify has none by that ID
  async readListEntry(id) {
    const r = await spotify(`/playlists/${id}?fields=id,name,owner(id),collaborative,description,images,snapshot_id,items(total)`);
    return r && r.id ? listEntry(r) : null;
  },
  inLibrary: (id) => spotify(`/me/library/contains?uris=${encodeURIComponent(playlistUri(id))}`),
  async readSongs(id, options) {
    const items = await pagedItems(`/playlists/${id}/items?limit=50`, options);
    return items ? songsFromEntries(items) : null;
  },
  async readPlayable(id) {
    // which of a playlist's songs play for this person, in their country (market=from_token): [{id, key, playable (true, false, or null when Spotify
    // says nothing), from (the ID asked for, when Spotify plays another version there: linked_from), why (Spotify's restriction reason)}]
    const items = await pagedItems(`/playlists/${id}/items?limit=50&market=from_token`);
    return items.map((e) => e && (e.item || e.track)).filter((t) => t && !t.is_local && t.type === "track" && t.id).map((t) => {
      const isrc = t.external_ids && typeof t.external_ids.isrc === "string" ? t.external_ids.isrc.toUpperCase() : "";
      return { id: t.id, key: isrc ? "isrc:" + isrc : "", playable: typeof t.is_playable === "boolean" ? t.is_playable : null,
        from: (t.linked_from && t.linked_from.id && t.linked_from.id !== t.id) ? t.linked_from.id : null, why: (t.restrictions && t.restrictions.reason) || "" };
    });
  },
  async createPlaylist({ name, description }) {
    // private: Spotify may ignore public: false, so it is asked again; private false when even that failed
    const made = await spotifyRequest("POST", "/me/playlists", { json: { name, public: false, description } });
    let isPrivate = true;
    if (made.public !== false) { try { await spotifyRequest("PUT", `/playlists/${made.id}`, { json: { public: false } }); } catch (err) { isPrivate = false; } }
    return { id: made.id, private: isPrivate };
  },
  updatePlaylist: (id, { name, description }, { noWait = false } = {}) => spotifyRequest("PUT", `/playlists/${id}`, { json: { name, description }, ...(noWait ? { noWait } : {}) }),
  async addSongs(id, songIds, { onBatch } = {}) {
    // onBatch(done, total) before each request. Gives { version }: the playlist's new snapshot
    let version = null;
    for (let k = 0; k < songIds.length;) {
      if (onBatch) onBatch(k, songIds.length);
      const n = addChunk;
      let res;
      try { res = await spotifyRequest("POST", `/playlists/${id}/items`, { json: { uris: songIds.slice(k, k + n).map(trackUri) } }); }
      catch (err) {
        if (n > ADD_CHUNK_SMALL && /returned 400/.test(err.message)) { addChunk = ADD_CHUNK_SMALL; recordNote(`${n} songs per add refused (400)`); continue; }
        throw err;
      }
      if (res && res.snapshot_id) version = res.snapshot_id;
      k += n;
    }
    return { version };
  },
  async deletePlaylists(ids) {
    // Spotify's 2026 API removes playlists from a library with one generic endpoint
    for (let i = 0; i < ids.length; i += REMOVE_CHUNK) {
      await spotifyRequest("DELETE", "/me/library", { params: { uris: ids.slice(i, i + REMOVE_CHUNK).map(playlistUri).join(",") } });
    }
  },
  deletePlaylist: (id) => spotifyService.deletePlaylists([id]),
  setCover: (id, jpegBase64, { noWait = false } = {}) => spotifyRequest("PUT", `/playlists/${id}/images`, { body: jpegBase64, contentType: "image/jpeg", ...(noWait ? { noWait } : {}) }),
  async hasOwnCover(id) {
    // whether the playlist shows an uploaded cover, not Spotify's own of four albums (Device checks)
    const images = await spotify(`/playlists/${id}/images`);
    return Array.isArray(images) && images.some((im) => im && im.url && !/mosaic/.test(im.url));
  },

  // songs
  async findByIsrc(isrcs, { names = {}, skip = {}, gapMs = 0, onEach } = {}) {
    // one search per song on Spotify; gives {isrc: songId} for those found, one that plays in the person's country first (market=from_token).
    // Spotify refuses the isrc: filter to apps like Arc's (Device checks, 2026-11-16: 403, a plain search allowed), so once refused, a song is
    // searched by its title and artist (names: {ISRC: [title, artist]}) and only a result with the same ISRC is taken: the same recording, never a look-alike.
    // skip: {ISRC: [IDs]} not to give again (they did not play). Searches are gapMs apart, and a refusal or a failure stops them quietly, never
    // starting Arc's long wait (noWait): what was found so far comes back, with searched (the ISRCs asked about) and stopped (the error).
    const found = {}, unsearched = [], searched = [];
    Object.defineProperty(found, "unsearched", { value: unsearched });   // songs it could not look for (no name once the isrc: filter is refused)
    Object.defineProperty(found, "searched", { value: searched });
    const search = async (q, limit) => ((await spotifyRequest("GET", `/search?type=track&limit=${limit}&market=from_token&q=${encodeURIComponent(q)}`, { noWait: true })).tracks || {}).items || [];
    for (const isrc of isrcs) {
      try {
        if (gapMs && searched.length) await retrySleep(gapMs);
        let items = null;
        if (!spotifyIsrcRefused) {
          try { items = await search("isrc:" + isrc, 10); }
          catch (err) { if (err.status !== 403) throw err; spotifyIsrcRefused = true; }
        }
        if (!items) {
          const [title, artist] = names[isrc] || [];
          if (!title) { unsearched.push(isrc); continue; }   // not looked for, so never counted as not found
          items = await search(`${title} ${artist || ""}`.replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 100), 10);
        }
        searched.push(isrc);
        const not = new Set(skip[isrc] || []);
        const same = items.filter((x) => x && x.id && !not.has(x.id) && x.external_ids && String(x.external_ids.isrc || "").toUpperCase() === isrc);
        const t = same.find((x) => x.is_playable !== false) || same[0];
        if (t) found[isrc] = t.id;
      } catch (err) { Object.defineProperty(found, "stopped", { value: err }); break; }
      if (onEach) onEach(searched.length + unsearched.length, isrcs.length);
    }
    return found;
  },

  // Device checks: whether a plain search (no isrc: filter) is allowed, when the search by ISRC was refused
  searchProbe: () => spotify("/search?type=track&limit=1&q=silence").then(() => "allowed", (err) => String(err && err.message || err)),
  async readSong(id) {
    // one song by its ID, as {id, key, ms, label, album}, or null
    const t = await spotify(`/tracks/${encodeURIComponent(id)}`);
    return songsFromEntries([{ track: t }])[0] || null;
  },
  likeSong: (id) => spotifyRequest("PUT", "/me/library", { params: { uris: trackUri(id) } }),

  // addresses: song picks it out in the playlist (Spotify's ?highlight=)
  playlistUrl: (id, { song } = {}) => `https://open.spotify.com/playlist/${id}` + (song ? `?highlight=${encodeURIComponent(trackUri(song))}` : ""),
  songUrl: (id) => `https://open.spotify.com/track/${encodeURIComponent(id)}`,
};
