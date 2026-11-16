// service-tidal.js: TIDAL as Arc's music service (work/tidal-plan.md, stage 4), the same members as service-spotify.js over TIDAL's API
// (openapi.tidal.com/v2, JSON:API). Sign-in is PKCE from the page, with a refresh token; requests are paced at about 2 a second, and a refusal (429)
// is tried again after 2, 4, 8... seconds, since TIDAL's refusals clear in about 2 s (tested on Ron's account, 2026-11-16). Every TIDAL address and quirk
// stays in this file. TIDAL has no covers through its API and no private playlists: what Arc makes is Unlisted (anyone with the link can open it).
(globalThis.scriptVersions = globalThis.scriptVersions || {})["service-tidal.js"] = "2026-11-16u";   // this file's version, checked against the app's at startup

const TIDAL_API = "https://openapi.tidal.com/v2";
const TIDAL_AUTH_URL = "https://login.tidal.com/authorize";
const TIDAL_TOKEN_URL = "https://auth.tidal.com/v1/oauth2/token";
const TIDAL_SCOPES = "playlists.read playlists.write collection.read user.read search.read";
const TIDAL_REQUIRED_SCOPES = ["playlists.read", "playlists.write"];
const TIDAL_NO_ANSWER = "TIDAL did not answer. Check your internet connection and try again.";
const TIDAL_GAP_MS = 500;            // between requests: about 2 a second, which TIDAL answered without refusing
const TIDAL_RETRY_BUDGET_MS = 30000; // the most one request spends waiting out refusals
const TIDAL_ADD_BATCH = 50;          // songs per add (TIDAL's maximum; 51 is refused)
const TIDAL_LOOKUP_BATCH = 20;       // ISRCs per lookup

let tidalToken = null;     // TIDAL access token (kept in this tab only)
let tidalCountry = "";     // the account's country, which TIDAL wants on most requests
let tidalUserId = "";
let tidalLast = 0;         // when the last request went out, for the pace
let tidalSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- sign-in (PKCE, no server)
const TIDAL_SESSION_KEY = "tidalToken";     // sessionStorage: {value, expires, scope}
const TIDAL_REFRESH_KEY = "tidalRefresh";   // localStorage: {token, scope, clientId}

async function openTidalSignIn(clientId) {
  const verifier = randomString(96);
  const state = randomString(24);
  sessionStorage.setItem("pkceVerifier", verifier);
  sessionStorage.setItem("pkceState", state);
  const params = new URLSearchParams({
    client_id: clientId, response_type: "code", redirect_uri: redirectUri(), scope: serviceHooks.scopes || TIDAL_SCOPES,
    code_challenge_method: "S256", code_challenge: base64url(await sha256(verifier)), state,
  });
  return () => { pageWindow().location.href = TIDAL_AUTH_URL + "?" + params.toString(); };
}

async function finishTidalSignIn() {
  const params = new URLSearchParams(location.search);
  if (!params.has("code") && !params.has("error")) return null;
  history.replaceState({}, "", redirectUri());
  if (params.has("error")) return { problem: "TIDAL did not approve the sign-in: " + params.get("error") };
  if (params.get("state") !== sessionStorage.getItem("pkceState")) return { problem: "The sign-in did not match this tab. Please try Connect again." };
  const response = await fetchWithAnswerLimit(TIDAL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: params.get("code"), redirect_uri: redirectUri(),
      client_id: localStorage.getItem("clientId") || "", code_verifier: sessionStorage.getItem("pkceVerifier") || "" }),
  }, TIDAL_NO_ANSWER);
  let data = {};
  try { data = await response.json(); } catch (err) { /* no body */ }
  if (!response.ok || !data.access_token) return { problem: "TIDAL refused the sign-in: " + (data.error_description || data.error || response.status), report: "TIDAL refused the sign-in: " + (data.error || response.status) };
  keepTidalToken(data);
  tidalToken = loadTidalToken();
  return {};
}

function storedTidalRefresh() {
  try {
    const saved = JSON.parse(localStorage.getItem(TIDAL_REFRESH_KEY) || "null");
    return saved && saved.token && saved.clientId === (localStorage.getItem("clientId") || "") ? saved : null;
  } catch (err) { return null; }
}
function keepTidalToken(data) {
  const scope = data.scope || (storedTidalRefresh() || {}).scope || "";
  sessionStorage.setItem(TIDAL_SESSION_KEY, JSON.stringify({ value: data.access_token, expires: Date.now() + (data.expires_in || 0) * 1000, scope }));
  try {
    if (data.refresh_token) localStorage.setItem(TIDAL_REFRESH_KEY, JSON.stringify({ token: data.refresh_token, scope, clientId: localStorage.getItem("clientId") || "" }));
  } catch (err) { /* then the next visit asks to reconnect */ }
}
function loadTidalToken() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(TIDAL_SESSION_KEY) || "null");
    if (saved && saved.expires > Date.now() + 30000) {
      const granted = String(saved.scope || "").split(/\s+/);
      if ((serviceHooks.requiredScopes || TIDAL_REQUIRED_SCOPES).every((s) => granted.includes(s))) return saved.value;
      sessionStorage.removeItem(TIDAL_SESSION_KEY);
      serviceHooks.oldSignIn();
    }
  } catch (err) { /* ignore */ }
  return null;
}
let tidalRenewing = null;
function renewTidalSignIn() {
  // Gives the new access token, or null. One renewal at a time.
  const saved = storedTidalRefresh();
  if (!saved) return Promise.resolve(null);
  if (!tidalRenewing) tidalRenewing = (async () => {
    try {
      const response = await fetchWithAnswerLimit(TIDAL_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: saved.token, client_id: localStorage.getItem("clientId") || "" }),
      }, TIDAL_NO_ANSWER);
      let data = {};
      try { data = await response.json(); } catch (err) { /* no body */ }
      if (!response.ok || !data.access_token) {
        if (response.status === 400 || response.status === 401) { try { localStorage.removeItem(TIDAL_REFRESH_KEY); } catch (err) { /* nothing kept */ } }
        serviceHooks.log("sign-in renewal refused");
        return null;
      }
      keepTidalToken(data);
      tidalToken = loadTidalToken();
      serviceHooks.log(tidalToken ? "sign-in renewed" : "sign-in renewed without every permission");
      return tidalToken;
    } catch (err) {
      serviceHooks.log("sign-in renewal: no answer");
      return null;
    } finally {
      tidalRenewing = null;
    }
  })();
  return tidalRenewing;
}

// ---------------------------------------------------------------- requests
// A record of requests per minute and of refusals, as for Spotify, in keys of its own (Copy Spotify request log and reports include it).
const TIDAL_CALLS_KEY = "tidalCalls";
const TIDAL_LIMITS_KEY = "tidalLimits";
function tidalCount(refused, what) {
  try {
    const minute = Math.floor(Date.now() / 60000);
    const calls = readRecord(TIDAL_CALLS_KEY, {});
    calls[minute] = (calls[minute] || 0) + 1;
    for (const m of Object.keys(calls)) if (Number(m) < minute - 8 * 24 * 60) delete calls[m];
    writeRecord(TIDAL_CALLS_KEY, calls);
    if (refused) writeRecord(TIDAL_LIMITS_KEY, [...readRecord(TIDAL_LIMITS_KEY, []), { at: Date.now(), what }].slice(-50));
  } catch (err) { /* the record is only a record */ }
}
function tidalRateError() {
  return new Error("TIDAL is rate limiting requests. Try again in a minute.");
}
const tidalWithCountry = (path) => (tidalCountry ? path + (path.includes("?") ? "&" : "?") + "countryCode=" + encodeURIComponent(tidalCountry) : path);

async function tidalRequest(method, path, { json, noWait = false } = {}) {
  const url = path.startsWith("http") ? path : TIDAL_API + (path.startsWith("/v2/") ? path.slice(3) : path);
  const what = `${method} ${path.split("?")[0]}`;
  let backoff = 2000, waited = 0, renewedHere = false;
  for (;;) {
    const gap = tidalLast + TIDAL_GAP_MS - Date.now();
    if (gap > 0) await tidalSleep(gap);
    tidalLast = Date.now();
    let response;
    try {
      response = await fetchWithAnswerLimit(url, {
        method,
        headers: { Authorization: "Bearer " + tidalToken, Accept: "application/vnd.api+json", ...(json ? { "Content-Type": "application/vnd.api+json" } : {}) },
        body: json ? JSON.stringify(json) : undefined,
      }, TIDAL_NO_ANSWER);
    } catch (err) {
      throw new Error(err.message === TIDAL_NO_ANSWER ? TIDAL_NO_ANSWER : "Could not reach TIDAL. Check your internet connection and try again.");
    }
    tidalCount(response.status === 429, what);
    if (response.status === 429) {
      if (noWait || waited + backoff > TIDAL_RETRY_BUDGET_MS) throw tidalRateError();
      await tidalSleep(backoff);
      waited += backoff;
      backoff *= 2;
      continue;
    }
    if (response.status === 401 && !renewedHere) {
      renewedHere = true;
      if (await renewTidalSignIn()) continue;
    }
    if (response.status === 401) {
      const message = serviceHooks.expiredText();
      serviceHooks.signInExpired(message);
      throw new Error(message);
    }
    if (response.status === 403) throw new Error(serviceHooks.refusedText(what));
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`TIDAL returned ${response.status} for ${what}`);
      error.status = response.status;
      throw error;
    }
    return text ? JSON.parse(text) : {};
  }
}
const tidal = (path) => tidalRequest("GET", tidalWithCountry(path));

// Every page of a JSON:API list, following links.next: { data, included }. gapMs, stopped and onSongs (items read so far) as in service-spotify.js's pagedItems.
async function tidalPages(path, { onPage, onSongs = null, gapMs = 0, stopped = null } = {}) {
  const data = [], included = [];
  let next = tidalWithCountry(path), pages = 0;
  while (next) {
    if (stopped && stopped()) return null;
    const page = await tidalRequest("GET", next);
    pages += 1;
    data.push(...(page.data || []));
    included.push(...(page.included || []));
    if (onPage) onPage(pages);
    if (onSongs) onSongs(data.length);
    const n = page.links && page.links.next;
    next = n ? (n.startsWith("http") || n.startsWith("/") ? n : "/" + n) : null;
    if (next && gapMs) await tidalSleep(gapMs);
    if (pages > 500) break;
  }
  return { data, included };
}

// "PT2M31S" is 151000 ms
function tidalMs(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(iso || "");
  return m ? Math.round(((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000) : 0;
}
// A song as Arc keeps it: {id, key, ms, label, album}; the artist when TIDAL included it
function tidalSong(t, byKey) {
  const a = t.attributes || {};
  const artistRef = t.relationships && t.relationships.artists && (t.relationships.artists.data || [])[0];
  const artist = artistRef && byKey[artistRef.type + ":" + artistRef.id] ? (byKey[artistRef.type + ":" + artistRef.id].attributes || {}).name || "" : "";
  const song = { id: String(t.id), ms: tidalMs(a.duration), label: artist ? `${artist} - ${a.title || ""}` : (a.title || "") };
  if (a.isrc) song.key = "isrc:" + String(a.isrc).toUpperCase();
  return song;
}
function tidalPlaylist(p) {
  const a = p.attributes || {};
  return {
    id: p.id,
    name: a.name || "",
    owner: tidalUserId || null,   // listed by owner, so every one is this account's
    collaborative: false,
    image: null,   // covers are not read yet
    cover: null,
    count: typeof a.numberOfItems === "number" ? a.numberOfItems : null,
    description: typeof a.description === "string" ? a.description : null,
    version: a.lastModifiedAt || null,   // changes whenever the playlist does
  };
}

// ---------------------------------------------------------------- the service
const tidalService = {
  key: "tidal",
  name: "TIDAL",
  // TIDAL's mark (the four diamonds) in one color, the text's: white on dark, black on light, no circle (TIDAL's Design Guidelines). For the page to draw.
  mark: (cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 6l3 3-3 3-3-3zM12 6l3 3-3 3-3-3zM18 6l3 3-3 3-3-3zM12 12l3 3-3 3-3-3z"/></svg>`,
  problemKind(message) {
    const m = String(message || "");
    if (/rate limiting/.test(m) && m.includes("TIDAL")) return "rate-limit";
    if (m.includes(TIDAL_NO_ANSWER) || m.includes("Could not reach TIDAL")) return "network";
    return null;
  },
  requirement: null,   // TIDAL has no free accounts (one paid plan since 2024)
  limits: { description: 300, addBatch: TIDAL_ADD_BATCH },
  can: { covers: false, privatePlaylists: false, likedSongs: false },
  // Arc's silent tracks: the same album as on Spotify, Silence for Playlists by silence moments, with the same ISRCs (checked 2026-11-16)
  silence: { 30: "83423070", 60: "83423071", 180: "83423073", 300: "83423075", 600: "83423080" },

  // sign-in
  signIn: (clientId) => openTidalSignIn(clientId),
  finishSignIn: () => finishTidalSignIn(),
  renewSignIn: () => renewTidalSignIn(),
  signedIn: () => !!tidalToken,
  storedSignIn: () => (tidalToken = loadTidalToken()),
  canRenew: () => !!storedTidalRefresh(),
  coversAllowed: () => false,
  authHeader: () => (tidalToken ? "Bearer " + tidalToken : null),
  // a playlist ID is a UUID: its 16 bytes, and back
  idToBytes(id) {
    const hex = String(id || "").toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(hex)) return null;
    const digits = hex.replace(/-/g, "");
    return Array.from({ length: 16 }, (_, i) => parseInt(digits.slice(i * 2, i * 2 + 2), 16));
  },
  idFromBytes(bytes) {
    const h = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  },
  // TIDAL's refusals clear in seconds and are waited out inside each request, so there is never a long wait
  wait: () => null,
  waitLeft: () => 0,
  tick: () => {},
  waitRelay: () => false,
  requestLog: () => ({ limits: readRecord(TIDAL_LIMITS_KEY, []), callsPerMinute: readRecord(TIDAL_CALLS_KEY, {}) }),
  async me() {
    const r = await tidalRequest("GET", "/users/me");
    const a = (r.data && r.data.attributes) || {};
    tidalUserId = String((r.data && r.data.id) || "");
    tidalCountry = a.country || tidalCountry || "US";
    return { id: tidalUserId, name: a.username || tidalUserId, country: tidalCountry };
  },

  // playlists
  async listMyPlaylists({ onPage } = {}) {
    if (!tidalUserId) await tidalService.me();
    const r = await tidalPages("/playlists?filter[owners.id]=me", { onPage: onPage ? (n) => onPage(n, n) : null });
    const list = r.data.filter((p) => p && p.type === "playlists").map(tidalPlaylist);
    return Object.assign(list, { total: list.length, pages: [], hidden: [], leftOut: 0, reread: false, short: "" });
  },
  async readPlaylist(id) {
    const r = await tidal(`/playlists/${encodeURIComponent(id)}?include=owners`);
    const p = tidalPlaylist(r.data || { id, attributes: {} });
    const owner = r.data && r.data.relationships && r.data.relationships.owners && (r.data.relationships.owners.data || [])[0];
    return { id: p.id || id, name: p.name, description: p.description, owner: owner ? String(owner.id) : null, image: null };
  },
  async inLibrary(id) {
    // a playlist TIDAL still has; deleting on TIDAL removes it for good
    try { await tidal(`/playlists/${encodeURIComponent(id)}`); return [true]; } catch (err) { if (err.status === 404) return [false]; throw err; }
  },
  async readSongs(id, options = {}) {
    const r = await tidalPages(`/playlists/${encodeURIComponent(id)}/relationships/items?include=items,items.artists`, options);
    if (!r) return null;
    const byKey = {};
    for (const x of r.included) byKey[x.type + ":" + x.id] = x;
    return r.data.filter((ref) => ref.type === "tracks" && byKey["tracks:" + ref.id]).map((ref) => tidalSong(byKey["tracks:" + ref.id], byKey));
  },
  async createPlaylist({ name, description }) {
    // Unlisted: the most private TIDAL's API allows
    const r = await tidalRequest("POST", tidalWithCountry("/playlists"), { json: { data: { type: "playlists", attributes: { name, description: description || "", accessType: "UNLISTED" } } } });
    return { id: r.data.id, private: false };
  },
  updatePlaylist(id, { name, description }, { noWait = false } = {}) {
    const attributes = {};
    if (name !== undefined) attributes.name = name;
    if (description !== undefined) attributes.description = description;
    return tidalRequest("PATCH", tidalWithCountry(`/playlists/${encodeURIComponent(id)}`), { json: { data: { type: "playlists", id, attributes } }, noWait });
  },
  async addSongs(id, songIds, { onBatch } = {}) {
    for (let k = 0; k < songIds.length; k += TIDAL_ADD_BATCH) {
      if (onBatch) onBatch(k, songIds.length);
      await tidalRequest("POST", `/playlists/${encodeURIComponent(id)}/relationships/items`, { json: { data: songIds.slice(k, k + TIDAL_ADD_BATCH).map((s) => ({ type: "tracks", id: String(s) })) } });
    }
    return { version: null };   // TIDAL sends no new version: the songs are read again next time
  },
  async deletePlaylists(ids) {
    for (const id of ids) {
      try { await tidalRequest("DELETE", `/playlists/${encodeURIComponent(id)}`); } catch (err) { if (err.status !== 404) throw err; }   // already gone is done
    }
  },
  deletePlaylist: (id) => tidalService.deletePlaylists([id]),
  setCover: () => Promise.resolve(),   // TIDAL's API has no covers (can.covers)
  hasOwnCover: () => Promise.resolve(false),

  // songs
  async findByIsrc(isrcs) {
    const found = {};
    for (let i = 0; i < isrcs.length; i += TIDAL_LOOKUP_BATCH) {
      const r = await tidal("/tracks?filter[isrc]=" + isrcs.slice(i, i + TIDAL_LOOKUP_BATCH).map(encodeURIComponent).join(","));
      for (const t of r.data || []) { const isrc = String((t.attributes || {}).isrc || "").toUpperCase(); if (isrc && !found[isrc]) found[isrc] = String(t.id); }
    }
    return found;
  },
  async readSong(id) {
    const r = await tidal(`/tracks/${encodeURIComponent(id)}`);
    return r.data ? tidalSong(r.data, {}) : null;
  },
  likeSong: () => Promise.reject(new Error("Liked songs are not available on TIDAL yet.")),

  // addresses
  playlistUrl: (id) => `https://tidal.com/playlist/${encodeURIComponent(id)}`,
  songUrl: (id) => `https://tidal.com/track/${encodeURIComponent(id)}`,
};
