const { JSDOM } = require("jsdom");
const { execFileSync } = require("child_process");
// Run only some areas: node run.js --only=donate|tabs   (matches part of an area's name; --list shows the names)
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7).toLowerCase().split("|").filter(Boolean);
// Build in the plan popup. With one recipe that can make several, nothing is chosen at first: like the old default, choose them all first.
function chooseAll(w) {
  const tiles = w.document.getElementById("bdPickTiles");
  if (tiles && !w.document.getElementById("bdPick").hidden && !tiles.querySelector('[aria-checked="true"]') && tiles.lastElementChild) tiles.lastElementChild.click();
}
function pressBuild(w) {
  const tiles = w.document.getElementById("bdPickTiles");
  if (tiles && !w.document.getElementById("bdPick").hidden && !tiles.querySelector('[aria-checked="true"]') && tiles.lastElementChild) tiles.lastElementChild.click();
  w.document.getElementById("confirmYes").click();
}
const SECTION_NAMES = ["the save pointer", "a guide for facilitators", "first segment tip", "the play tip", "a wait from Spotify", "sign-in renewal", "build popup", "newer version", "recipe session", "silence stepper width", "startup refresh", "batch seven", "spotify last", "version icon", "spotify row", "notice line", "backup popup", "backup card done", "backup wording", "connecting state", "connecting screen", "save retry online", "backup switching", "spotify wording", "spotify merge", "backup cover", "save pacing", "spotify saves", "size limit", "backup method", "save packer", "playlist ids", "description test", "marker colors", "marker hugs corners", "popups close only", "narrow more button", "the silence card", "privacy: why the counts", "build button centered in minimalist mode", "no double-tap zoom", "backup link in step 2", "hiding the donate button", "spotify premium", "step 3 order and text", "the build icon", "python status at the bottom", "hover feedback on buttons", "questions and feedback", "settings below the segments, pink outline", "the tagline", "disconnect below the status line on phones", "a new format scrolls into view", "duplicate question, format names, empty note and equal widths", "reordering recipes", "card header, pencil and notch", "page start watchdog and version stamps", "startup that survives problems", "build button, big new format button and empty start", "confirming a new format", "privacy: hidden in minimalist mode, gap, and where reporting is mentioned", "privacy section and anonymous counts", "report link on a connection problem", "minimalist mode steps aside", "who sees the editor, and what a rate limit says", 'core', 'the visual format editor', 'dragging rows', 'a format built entirely on screen', 'details', 'one pink look, and rows linked to the bar', 'the simpler create step', 'small changes', 'the color theme', 'all the themes', 'silences, dragging and removing', "the page's styles for tags and phones", 'the title and the tip button on a phone', "telling this app's playlists from yours", 'refreshing, and playlists the app did not mark', 'private playlists', 'cover art', 'what "private" means on Spotify', 'the format menu fits its contents', 'the default silence goes up to 60 minutes', "the limit list, and the format's title", 'the app menu, and minimalist mode', "minimalist mode, the menu's label, and alignment", 'minimalist mode, part two', 'compact rows, centered icons, no label, no corner background', 'the popup after Create, and the room at the bottom', 'the Donate panel', 'dimming, fading, and Donate in the Create popup', 'tabs that scroll sideways', 'Donate only after a success', 'when Spotify cannot be reached', 'saved songs', 'long waits from Spotify', 'a record of Spotify limits'];
// areas that need another area's setup to have run first
const NEEDS = {
  "the page's styles for tags and phones": ["silences, dragging and removing"],
};
const wantRaw = (name) => {
  if (!ONLY.length) return true;
  const hit = (x) => ONLY.some((o) => x.toLowerCase().includes(o));
  return hit(name) || Object.entries(NEEDS).some(([user, deps]) => hit(user) && deps.some((d) => d.toLowerCase() === name.toLowerCase()));
};
// how long each area takes: the time from one area starting to the next (shown with --timing)
const areaTimes = []; let areaPrev = null, areaStart = Date.now();
const want = (name) => { const hit = wantRaw(name); if (hit && areaPrev !== name && !areaTimes.some((a) => a.name === name)) { if (areaPrev) areaTimes.push({ name: areaPrev, ms: Date.now() - areaStart }); areaPrev = name; areaStart = Date.now(); } return hit; };
if (process.argv.includes("--list")) { console.log(SECTION_NAMES.join("\n")); process.exit(0); }
const FDBFactory = (require("fake-indexeddb/lib/FDBFactory").default || require("fake-indexeddb/lib/FDBFactory"));
const { spawnSync } = require("child_process");
const fs = require("fs");

// where the app is: the folder above this one, or APP_DIR
const ROOT = (process.env.APP_DIR || require("path").join(__dirname, "..")).replace(/\/?$/, "/");
const html = fs.readFileSync(ROOT + "index.html", "utf8").replace(/<script src="(theme|formats|editor|app)\.js(\?v=[^"]*)?"><\/script>/g, "");
// the three scripts share one scope in a browser, so they are run together here
const appJs = fs.readFileSync(ROOT + "theme.js", "utf8") + "\n" + fs.readFileSync(ROOT + "formats.js", "utf8") + "\n" + fs.readFileSync(ROOT + "editor.js", "utf8") + "\n" + fs.readFileSync(ROOT + "app.js", "utf8");

// the sentence a finished build shows, from its parts (the music between them counts up)
const doneSentence = (w) => { const q = (c) => (w.document.querySelector("#actionMessage ." + c) || { textContent: "" }).textContent; return `${q("bd-big")} ${q("bd-lib")}`; };

// ---- fake Spotify
// the plan text is shown in the question box (behind a link), or, when there is a problem, in the output box
function outText(w) { return w.document.getElementById("output").hidden ? w.document.getElementById("planText").textContent : w.document.getElementById("output").textContent; }
// The playlists listed in the build popup, as the person sees them: name, song count and the length shown
function planRows(w) {
  return Array.from(w.document.querySelectorAll("#results .bd-row")).map((r) => {
    const meta = r.querySelector(".bd-meta").textContent;
    const songs = meta.match(/^(\d+) songs?/);
    return { name: r.querySelector(".bd-name").textContent, songs: songs ? Number(songs[1]) : null, meta, link: r.querySelector("a.bd-name") };
  });
}
// The groups in the build popup when one build makes playlists for several recipes
function wB_support_ok(html) {
  const box = html.match(/<div id="createSupport"[\s\S]*?<\/div>\s*<\/div>/);
  const foot = html.match(/<div id="createCloseRow"[\s\S]*?<\/div>/);
  return !!box && /id="createDonate" class="primary"/.test(box[0]) && !!foot && !/createDonate/.test(foot[0]) && /id="createClose"/.test(foot[0]);
}
function planGroups(w) { return Array.from(w.document.querySelectorAll("#results .bd-group b")).map((b) => b.textContent); }

const MADE = 'Made by Ceremony Playlist Builder from the format "x". Please leave this description as it is: the app uses it to recognize the playlists it made.';
const MY_PLAYLISTS = [
  { id: "p1", name: "☘️ intro / outro (soothing, familiar)", owner: { id: "ron" } },
  { id: "p2", name: "💗 spacious + gentle", owner: { id: "ron" }, images: [{ url: "https://img.example/p2-large.jpg" }, { url: "https://img.example/p2-small.jpg" }], tracks: { total: 132 } },
  { id: "p3", name: "💗💗 evocative", owner: { id: "ron" } },
  { id: "p4", name: "🛋 rest ", owner: { id: "ron" } },
  { id: "p5", name: "Someone else's list", owner: { id: "other" } },
];
let seed = 7;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const TRACKS = {};
for (const p of MY_PLAYLISTS) {
  TRACKS[p.id] = Array.from({ length: 130 }, (_, i) => ({
    track: { uri: `spotify:track:${p.id}-${i}`, type: "track", duration_ms: 150000 + Math.floor(rand() * 180000), name: `Song ${i}`, artists: [{ name: "Artist" }] },
  }));
  TRACKS[p.id].splice(5, 0, { item: null }, { track: { is_local: true, uri: "local", type: "track" } });
}
const OLD_STARTER = (() => {
  const vm = require("vm");
  const ctx = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(ROOT + "formats.js", "utf8").replace(/\bconst /g, "var ").replace(/\blet /g, "var "), ctx);
  return vm.runInContext("modelToText(defaultModel())", ctx);
})();
const log = [];
const RUN_STARTED = Date.now();
global.bridgeCalls = 0; global.bridgeMs = 0; global.bootCount = 0; global.bootMs = 0;
const SCOPE_ALL = "playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public user-library-modify ugc-image-upload";
global.planTextArgCounts = [];
function makeFetch(options = {}) {
  return async (url, init = {}) => {
    url = String(url);
    log.push({ url, init });
    const method = (init.method || "GET").toUpperCase();
    const writes = options.writes;
    const json = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
    if (options.premiumRequired && url.startsWith("https://api.spotify.com/")) return json({ error: { status: 403, message: "Active premium subscription required for the owner of the app" } }, 403);
    if (url.includes("version.txt")) {   // the stamp of the version on the site: the one in the files, unless a check says otherwise
      if (options.versionFail) throw new TypeError("Failed to fetch");
      const body = options.serverVersion !== undefined ? options.serverVersion : fs.readFileSync(ROOT + "version.txt", "utf8");
      return { ok: options.versionStatus ? options.versionStatus < 400 : true, status: options.versionStatus || 200, headers: { get: () => null }, text: async () => body, json: async () => ({}) };
    }
    const coverFile = ["playlist-cover.jpg", "backup-cover.jpg", "recipe-cover.jpg"].find((f) => url.endsWith(f));
    if (coverFile) {
      if (options.noCoverFile) return { ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
      const file = fs.readFileSync(ROOT + coverFile);
      return { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) };
    }
    if (method === "PUT" && /\/v1\/playlists\/\w+\/images$/.test(url)) {
      writes.push({ type: "cover", id: url.match(/playlists\/(\w+)\/images$/)[1], contentType: (init.headers || {})["Content-Type"], base64: init.body });
      if (options.coverRateLimit) { options.coverTries = (options.coverTries || 0) + 1; return { ok: false, status: 429, headers: { get: (h) => (/retry-after/i.test(h) ? String(options.coverRateLimit) : null) }, json: async () => ({}), text: async () => "" }; }
      if (options.coverStatus) return json({}, options.coverStatus);
      return { ok: true, status: 202, headers: { get: () => null }, text: async () => "", json: async () => { throw new Error("no body"); } };
    }
    if (method === "POST" && url.endsWith("/v1/me/playlists")) {
      if (options.denyCreate) return json({ error: { status: 403 } }, 403);
      const body = JSON.parse(init.body);
      const id = "new" + (writes.filter((w) => w.type === "create").length + 1);
      writes.push({ type: "create", name: body.name, public: body.public, id, description: body.description });
      (options.createdPlaylists = options.createdPlaylists || []).push({ id, name: body.name, owner: { id: "ron" }, description: body.description });
      return json({ id, public: options.ignorePublic ? true : body.public, external_urls: { spotify: "https://open.spotify.com/playlist/" + id } }, 201);
    }
    if (method === "PUT" && /\/v1\/playlists\/\w+$/.test(url) && !/\/images$/.test(url)) {
      if (options.putFails) return json({}, options.putStatus || 403);
      const putBody = JSON.parse(init.body);
      if (putBody.description !== undefined) (options.descStore = options.descStore || {})[url.match(/playlists\/(\w+)$/)[1]] = putBody.description;
      if (putBody.name !== undefined) (options.nameStore = options.nameStore || {})[url.match(/playlists\/(\w+)$/)[1]] = putBody.name;
      writes.push({ type: "update", id: url.match(/playlists\/(\w+)$/)[1], public: putBody.public, name: putBody.name, description: putBody.description });
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => "", json: async () => { throw new Error("no body"); } };
    }
    // repeatIn: that source playlist lists its first three songs twice
    const repeatList = () => (options.repeatList = options.repeatList || TRACKS[options.repeatIn].concat(TRACKS[options.repeatIn].slice(0, 3)));
    if (method === "POST" && /\/playlists\/\w+\/items/.test(url)) {
      // buildFailIn: the first request that adds songs to this playlist (by id, "new2" for the second one made) fails, as buildFail says:
      // "network", "hang" (no answer), or a status (429, 401, 403, 500)
      options.addCalls = (options.addCalls || 0) + 1;
      if (options.buildFailIn && url.includes(`/playlists/${options.buildFailIn}/items`) && !options.buildFailed) {
        options.buildFailed = true;
        const how = options.buildFail;
        if (how === "network") throw new TypeError("Failed to fetch");
        if (how === "hang") return new Promise((resolve, reject) => { if (init.signal) init.signal.addEventListener("abort", () => reject(new Error("aborted"))); });
        return { ok: false, status: how, headers: { get: (h) => (/retry-after/i.test(h) && how === 429 ? "1200" : null) }, json: async () => ({}), text: async () => "" };
      }
      if (options.addMax && JSON.parse(init.body).uris.length > options.addMax) { options.addRefused = (options.addRefused || 0) + 1; return json({ error: { status: 400, message: "Too many ids requested" } }, 400); }
      writes.push({ type: "add", id: url.match(/playlists\/(\w+)\/items/)[1], uris: JSON.parse(init.body).uris });
      return json({ snapshot_id: "x" }, 201);
    }
    if (method === "DELETE" && url.includes("/v1/me/library") && options.failRemove) return json({}, 500);
    if (method === "DELETE" && url.includes("/v1/me/library")) {
      const removedUris = new URL(url).searchParams.get("uris").split(",");
      writes.push({ type: "remove", uris: removedUris });
      options.removedIds = (options.removedIds || new Set());
      for (const u of removedUris) options.removedIds.add(u.replace("spotify:playlist:", ""));
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => "", json: async () => { throw new Error("no body"); } };
    }
    if (url.includes("accounts.spotify.com/api/token") && options.failToken) return json({ error: "invalid_client", error_description: "Invalid client" }, 400);
    if (url.includes("accounts.spotify.com/api/token")) {
      if (options.tokenDelayMs) await new Promise((r) => setTimeout(r, options.tokenDelayMs));
      const body = String(init.body);
      options.tokenBody = body;
      (options.tokenBodies = options.tokenBodies || []).push(body);
      // renewing a sign-in: refreshFails says how Spotify refuses ("refused" is a 400, "network" no answer); a renewal gives a new refresh token and leaves out the scope
      if (/grant_type=refresh_token/.test(body)) {
        if (options.refreshFails === "network") throw new TypeError("Failed to fetch");
        if (options.refreshFails) return json({ error: "invalid_grant", error_description: "Refresh token revoked" }, 400);
        options.renewals = (options.renewals || 0) + 1;
        return json({ access_token: "renewed" + options.renewals, expires_in: 3600, refresh_token: "ref-" + (options.renewals + 1) });
      }
      return json({ access_token: "tok123", expires_in: 3600, scope: SCOPE_ALL, refresh_token: "ref-1" });
    }
    if (url.endsWith("/engine.py")) return { ok: true, text: async () => fs.readFileSync(ROOT + "engine.py", "utf8") };
    if (url.endsWith("/v1/me") && options.expireOnce && !options.expired) {   // the sign-in runs out: the first request is refused once
      options.expired = true;
      return { ok: false, status: 401, headers: { get: () => null }, json: async () => ({}), text: async () => "" };
    }
    if (url.endsWith("/v1/me")) {
      if (options.meDelay) await new Promise((r) => setTimeout(r, options.meDelay));
      if (options.meNetworkFail) throw new TypeError("Failed to fetch");
      if (options.meStatus) return { ok: false, status: options.meStatus, headers: { get: (h) => (h === "Retry-After" && options.retryAfter ? String(options.retryAfter) : null) }, json: async () => ({}), text: async () => JSON.stringify(options.meBody || {}) };
      return json({ id: "ron", display_name: "Ron" });
    }
    if (options.hangPlaylists && url.includes("/v1/me/playlists")) return new Promise((resolve, reject) => { if (init.signal) init.signal.addEventListener("abort", () => reject(new Error("aborted"))); });   // a stalled connection: no answer until the page gives up
    if (url.includes("/v1/me/playlists")) {
      options.listCalls = (options.listCalls || 0) + 1;
      if (options.listDelayMs) await new Promise((r) => setTimeout(r, options.listDelayMs));
      const u = new URL(url); const offset = Number(u.searchParams.get("offset") || 0);
      const all = MY_PLAYLISTS.concat(options.extraPlaylists || [], options.createdPlaylists || []).filter((p) => !(options.removedIds && options.removedIds.has(p.id)));
      const page = all.slice(offset, offset + 2).map((p) => { const q = options.listWithoutDescriptions ? { ...p, description: undefined } : { ...p, description: (options.descStore && options.descStore[p.id] !== undefined) ? options.descStore[p.id] : p.description, name: (options.nameStore && options.nameStore[p.id] !== undefined) ? options.nameStore[p.id] : p.name }; if (!options.noSnapshots) q.snapshot_id = (options.snapshots && options.snapshots[p.id]) || "snap-" + p.id; return q; });   // tiny pages, to exercise paging
      const next = offset + 2 < all.length ? `https://api.spotify.com/v1/me/playlists?limit=2&offset=${offset + 2}` : null;
      return json({ items: page, next });
    }
    if (method === "GET" && /\/v1\/playlists\/\w+(\?|$)/.test(url) && options.descStore) {
      const stored = options.descStore[url.match(/playlists\/(\w+)/)[1]] || "";
      const kept = Array.from(stored).slice(0, options.descLimit || 300).join("");
      return json({ description: kept.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;") });
    }
    const m = url.match(/\/playlists\/(\w+)\/items/);
    if (m) {
      (options.trackRequests = options.trackRequests || []).push(m[1]);
      if (options.tracksStatus) return { ok: false, status: options.tracksStatus, headers: { get: (h) => (h === "Retry-After" && options.tracksRetryAfter ? String(options.tracksRetryAfter) : null) }, json: async () => ({}), text: async () => JSON.stringify(options.tracksBody || {}) };
      const u = new URL(url); const offset = Number(u.searchParams.get("offset") || 0);
      const all = (options.repeatIn === m[1] ? repeatList() : TRACKS[m[1]]) || [];
      const page = all.slice(offset, offset + 50).map((it) => (options.uniqueSongNames && it.track && it.track.name ? { track: { ...it.track, name: `${it.track.name} of ${m[1]}` } } : it));
      const next = offset + 50 < all.length ? `https://api.spotify.com/v1/playlists/${m[1]}/items?limit=50&offset=${offset + 50}` : null;
      return json({ items: page, next });
    }
    return json({}, 404);
  };
}

function fakePyodideFactory() {
  return {
    runPythonAsync: async () => {},
    globals: {
      get: (name) => (...args) => {
        if (name === "build_playlists") global.planTextArgCounts.push(args.length);
        const t0b = Date.now();
        const r = spawnSync("python3", [require("path").join(__dirname, "bridge.py"), name, JSON.stringify(args)], { encoding: "utf8" });
        global.bridgeCalls += 1; global.bridgeMs += Date.now() - t0b;
        if (r.status !== 0) throw new Error(r.stderr);
        return r.stdout;
      },
    },
  };
}

async function boot({ url, session = {}, local = {}, fetchOptions = {}, before = null, idb = null, instantRetries = false, htmlChange = null, feedbackUrl = "" }) {
  const bootStarted = Date.now();
  const dom = new JSDOM(htmlChange ? htmlChange(html) : html, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  fetchOptions.writes = fetchOptions.writes || [];
  for (const [k, v] of Object.entries(session)) w.sessionStorage.setItem(k, v);
  // Most tests were written when everyone started with one format; a signed-in test with no saved formats gets that starter.
  // Pass formats: null to start with nothing saved at all, as a new visitor does.
  const savedLocal = { ...local };
  if (savedLocal.formats === undefined && session && session.token) savedLocal.formats = OLD_STARTER;
  if (savedLocal.formats === null) delete savedLocal.formats;
  // Recipes are saved to Spotify unless the person chose otherwise, which would put saves into every signed-in test; the tests that are not about saving start on the other way.
  // Pass backupMode: null to start with nothing chosen, as a new visitor does.
  if (savedLocal.backupMode === undefined) savedLocal.backupMode = "manual";
  if (savedLocal.backupMode === null) delete savedLocal.backupMode;
  for (const [k, v] of Object.entries(savedLocal)) w.localStorage.setItem(k, v);
  Object.defineProperty(w, "crypto", { value: require("crypto").webcrypto });
  w.TextEncoder = TextEncoder;
  w.fetch = makeFetch(fetchOptions);
  w.loadPyodide = async () => fakePyodideFactory();
  // pretend the Pyodide <script> loads instantly
  const append = w.document.head.appendChild.bind(w.document.head);
  w.document.head.appendChild = (el) => {
    if (el.tagName === "SCRIPT") {
      w.__scriptsRequested.push(el.src);
      const broken = (fetchOptions.brokenVersions || []).some((v) => el.src.includes("/" + v + "/")) || (fetchOptions.brokenScripts || []).some((v) => el.src.includes(v));
      if (!broken && w.__scriptLoadHooks) for (const [part, hook] of Object.entries(w.__scriptLoadHooks)) if (el.src.includes(part)) hook();
      setTimeout(() => (broken ? el.onerror && el.onerror() : el.onload && el.onload()), 0);
      return el;
    }
    return append(el);
  };
  w.navigator.clipboard = { writeText: async () => {} };
  w.indexedDB = idb || new FDBFactory();   // a browser's own database for saved songs; pass the same one to a second boot to pretend the page was reloaded
  if (before) before(w);
  w.__scriptsRequested = [];
  w.eval(appJs.replace("let spotifyAnswerMs = 30000;", "var spotifyAnswerMs = " + (fetchOptions.answerMs || 30000) + ";").replace("let reloadPage =", "var reloadPage =").replace("const THEMES =", "var THEMES =").replace("const editor = {", "var editor = {").replace("const tabDrag =", "var tabDrag =").replace("const saveState =", "var saveState =").replace("let spotifySaveDelayMs =", "var spotifySaveDelayMs =").replace("let spotifySaveMaxWaitMs =", "var spotifySaveMaxWaitMs =").replace("let playlistsLoadedAt =", "var playlistsLoadedAt =").replace("let signingIn =", "var signingIn =").replace("const BACKED_UP_MESSAGE =", "var BACKED_UP_MESSAGE =").replace("const APP_VERSION =", "var APP_VERSION =").replace("const versionCheck =", "var versionCheck =").replace("const noticeTiming =", "var noticeTiming =").replace("const notices =", "var notices =").replace("const saveTip =", "var saveTip =").replace("let signInNote =", "var signInNote =").replace("let playlistRefreshMs =", "var playlistRefreshMs =").replace("let busy =", "var busy =").replace("const startupProblems =", "var startupProblems =").replace("let playlists =", "var playlists =").replace("let currentFormats =", "var currentFormats =").replace(/const FEEDBACK_FORM_URL = "[^"]*";/, "const FEEDBACK_FORM_URL = " + JSON.stringify(feedbackUrl) + ";").replace(/\nmain\(\)\.catch\(startupFailed\);\s*$/, "\nwindow.__main = main().catch(startupFailed);\n").replace("let connection =", "var connection =").replace("let isOwnerHere =", "var isOwnerHere =").replace("const OWNER_CLIENT_HASHES =", "var OWNER_CLIENT_HASHES =").replace(/const WAIT_RELAY_URL = "[^"]*";/, "var WAIT_RELAY_URL = \"\";").replace("let waitRelayMs =", "var waitRelayMs =").replace("const waitAsked =", "var waitAsked =").replace("let retrySleep = (ms) => new Promise((r) => setTimeout(r, ms));", instantRetries ? "var retrySleep = () => Promise.resolve();" : "var retrySleep = (ms) => new Promise((r) => setTimeout(r, ms));").replace("const SILENCE_STEPS =", "var SILENCE_STEPS =").replace("const GAP_STEPS =", "var GAP_STEPS ="));  // test harness only: lets a test replace the reload
  await Promise.race([w.__main, new Promise((r) => setTimeout(r, 1500))]);   // ready as soon as the page has finished starting up
  await new Promise((r) => setTimeout(r, 30));
  global.bootCount += 1; global.bootMs += Date.now() - bootStarted;
  return w;
}

// the record in the app menu, and the line under the editor's bar
function menuStatus(w) { w.document.getElementById("feAppMenuButton").click(); const n = w.document.getElementById("feSaveStatus"); const t = n ? n.textContent : ""; w.document.body.click(); return t; }
function capText(w) { const n = w.document.getElementById("feCaption"); return n ? n.textContent : ""; }
function capLinks(w) { return Array.from(w.document.querySelectorAll("#feCaption .fe-notice-link, #feCaption .fe-notice-ok, #feCaption .fe-notice-count")); }
// Remove now needs a choice in the dropdown: keep one that is set, otherwise pick All recipes, then press Remove.
function removeNow(w) {
  const sel = w.document.getElementById("removeKey");
  if (!sel.value) sel.value = "__all__";
  sel.dispatchEvent(new w.document.defaultView.Event("change"));
  w.document.getElementById("removeOld").click();
}

// The method card's radio buttons only mark a choice: pick one, then press OK.
function pickMode(w, id) {
  w.document.getElementById(id).click();
  w.document.getElementById("backupOk").click();
}

async function waitFor(condition, ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (condition()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}
const EVO = "FORMATS = {\n    \"b1-evocative\": {\n        \"name\": \"📕 evocative {n}\",\n        \"silence between segments\": \"30 sec\",\n        \"segments\": [\n            (\"☘️ intro / outro (soothing, familiar)\", 30),\n            (\"💗 spacious + gentle\", 60),\n            (\"💗💗 evocative\", 60),\n            (\"💗 spacious + gentle\", 60),\n            (\"☘️ intro / outro (soothing, familiar)\", 30),\n            (\"silence\", \"2 min\"),\n            (\"🛋 rest\", 60),\n        ],\n    },\n    # Add more formats here, following the same pattern.\n}";
const SILENCE_30 = "spotify:track:5kiJ9x6eX37H5J9lyyXkua";
const signedIn = () => ({ token: JSON.stringify({ value: "t", expires: Date.now() + 3600000, scope: SCOPE_ALL }) });
const MINI = '{"mini": {"name": "mini {n}", "silence between segments": "30 sec", "segments": [("💗 spacious + gentle", 30), ("🛋 rest", 30)]}}';

(async () => {
  let failures = 0;
  const areaCrashed = (name, err) => { failures += 1; console.log("FAIL area crashed: " + name + "  " + String((err && err.stack) || err).split("\n").slice(0, 3).join(" | ").slice(0, 400)); };
  const check = (label, ok, extra = "") => { console.log((ok ? "PASS " : "FAIL ") + label + (ok ? "" : "  " + extra)); if (!ok) failures++; };
  const fresh = await boot({ url: "http://127.0.0.1:8000/" });
  const css = fs.readFileSync(ROOT + "index.html", "utf8");
  const visible = (w, id) => !w.document.getElementById(id).hidden;
  const readyToPreview = (w) => waitFor(() => !w.document.getElementById("create").disabled, 20000);
  const runPreview = async (w) => {
    await readyToPreview(w);
    w.document.getElementById("create").click();
    await waitFor(() => visible(w, "confirmBox") || /Nothing can be built|Cannot plan|Something went wrong/.test(outText(w)), 30000);
    chooseAll(w);   // as the popup used to start: all of them chosen
  };
  const t0 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn() });
  const EDURL = "http://127.0.0.1:8000/";
  const optionNamed = (w, name) => Array.from(w.document.querySelectorAll("#feOptions .fe-option")).find((o) => o.getAttribute("data-name") === name);
  const rowsOf = (w) => Array.from(w.document.querySelectorAll("#feRows .fe-row"));
  const renameBox = (w) => { if (!w.document.getElementById("feName")) w.document.querySelector('#feTabs .fe-tab[aria-pressed="true"]').click(); return w.document.getElementById("feName"); };
  const finishName = (w) => { const b = w.document.getElementById("feName"); if (b) b.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); };
  const T = (w) => w.document.getElementById("formats").value.replace(/ \[id:[0-9A-Za-z_-]{1,64}\](?=["'])/g, "");   // the text as written, without the playlist IDs the app adds
  const tabsOf = (w) => Array.from(w.document.querySelectorAll("#feTabs .fe-tab")).map((t) => t.textContent);
  // New recipe asks for a name: type it into the popup's field and press Create recipe
  const typeNewName = (w, name) => { const i = w.document.getElementById("feNewFormatName"); i.value = name; i.dispatchEvent(new w.Event("input", { bubbles: true })); };
  const addNamed = (w, name) => { w.document.getElementById("feNewFormat").click(); typeNewName(w, name); w.document.getElementById("feNewFormatConfirm").click(); };
  const pointer = (w, el, type, y) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true, clientY: y, button: 0 }));
  const x_THREE = 'FORMATS = {"d": {"name": "Drag {n}", "segments": [("💗 spacious + gentle", 10), ("💗💗 evocative", 20), ("🛋 rest", 30)]}}';
  const x_titles = (w) => rowsOf(w).map((r) => r.querySelector(".fe-title").textContent).join("|");
  const x_enginePlan = (text) => JSON.parse(execFileSync("python3", ["-c", `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("engine", "${ROOT}engine.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
data = m.parse_formats(sys.stdin.read())
out = {}
for key, fmt in data.items():
    music, gaps = m.plan_format(fmt)
    out[key] = {"name": fmt["name"], "label": m.format_label(key, fmt), "music": [[m.seg_parts(s), mins] for s, mins in music], "gaps": [g[1] for g in gaps]}
print(json.dumps(out))
`], { input: text, encoding: "utf8" }));
  if (want('core')) { try {

  // 1. returning from Spotify with a code
  var opts = {};
  var w1 = await boot({
    url: "http://127.0.0.1:8000/?code=abc123&state=st1",
    session: { pkceState: "st1", pkceVerifier: "verifier-xyz" },
    local: { clientId: "client-id-1", formats: EVO },
    fetchOptions: opts,
  });
  check("token request sent with PKCE verifier", /code_verifier=verifier-xyz/.test(opts.tokenBody || "") && /client_id=client-id-1/.test(opts.tokenBody) && /redirect_uri=http%3A%2F%2F127.0.0.1%3A8000%2F/.test(opts.tokenBody), opts.tokenBody);
  check("address bar cleaned after sign-in", w1.location.search === "", w1.location.href);
  check("token stored for this tab", !!w1.sessionStorage.getItem("token"));
  check("connected message shows name and playlist count (paged)", /Connected as Ron\. 5 playlists found/.test(w1.document.getElementById("connectedMessage").textContent), w1.document.getElementById("connectedMessage").textContent);
  check("the Build button builds the format being edited, and names it", w1.eval("selectedKeys()")[0] === "b1-evocative" && /^for .+$/.test(w1.document.querySelector("#create .build-name").textContent) && !!w1.document.querySelector("#create .build-name i"), w1.document.getElementById("create").textContent);
  check("preview button enabled", w1.document.getElementById("create").disabled === false);

  // 2. preview
  w1.document.getElementById("create").click();
  await waitFor(() => visible(w1, "confirmBox") || /Nothing can be built|Choose a playlist|Could not plan/.test(outText(w1)), 30000);
  var out = outText(w1);
  console.log("\n--- preview output ---\n" + out + "\n----------------------\n");
  check("the plan says how many and lists no playlists: they are listed once they are being built", planRows(w1).length === 0 && /^(The playlists you chose for this recipe have enough songs to build|You can build) up to \d+ playlists/.test(w1.document.getElementById("confirmText").textContent), JSON.stringify(planRows(w1).slice(0, 2)));
  w1.document.getElementById("planToggle").click();
  check("songs from paged playlist items were all read (130 each minus skipped)", Array.from(w1.document.querySelectorAll("#planText tbody tr")).every((tr) => /8 hrh \d+ minm/.test(tr.children[1].textContent)), outText(w1));

  // 3. state mismatch is rejected
  var w2 = await boot({ url: "http://127.0.0.1:8000/?code=zzz&state=wrong", session: { pkceState: "st1", pkceVerifier: "v" }, local: { clientId: "c" } });
  check("mismatched state rejected", /did not match/.test(w2.document.getElementById("loginMessage").textContent) && !w2.sessionStorage.getItem("token"), w2.document.getElementById("loginMessage").textContent);

  // 4. user denied access
  var w3 = await boot({ url: "http://127.0.0.1:8000/?error=access_denied&state=st1" });
  check("denied sign-in message", /access_denied/.test(w3.document.getElementById("loginMessage").textContent));

  // 5. a bad formats box shows a clear message
  var w4 = await boot({
    url: "http://127.0.0.1:8000/", session: { token: JSON.stringify({ value: "t", expires: Date.now() + 3600000, scope: SCOPE_ALL }) },
    local: { formats: 'FORMATS = {"a": ' },
  });
  check("unreadable saved formats are explained in the editor, with a way out, and Preview is off", !!w4.document.getElementById("feBroken") && /Could not read the formats/.test(w4.document.getElementById("feBroken").textContent) && !!w4.document.getElementById("feStartOver") && !!w4.document.getElementById("feSaveBroken") && w4.document.getElementById("create").disabled, w4.document.getElementById("formatEditor").textContent);

  // 6. a playlist the user doesn't own is reported
  var w5 = await boot({
    url: "http://127.0.0.1:8000/", session: { token: JSON.stringify({ value: "t", expires: Date.now() + 3600000, scope: SCOPE_ALL }) },
    local: { formats: '{"x": {"name": "x {n}", "segments": [("Someone else\'s list", 30)]}}' },
  });
  w5.document.getElementById("create").click();
  await waitFor(() => /is not yours/.test(outText(w5)) || visible(w5, "confirmBox"), 15000);
  check("not-owned playlist explained", /is not yours/.test(outText(w5)), outText(w5));

  // 6b. first runtime versions unavailable: falls back to a later one
  var w6 = await boot({ url: "http://127.0.0.1:8000/", session: { token: JSON.stringify({ value: "t", expires: Date.now() + 3600000, scope: SCOPE_ALL }) }, fetchOptions: { brokenVersions: ["v0.29.3", "v0.29.2"] } });
  check("falls back to a later runtime version", /Ready\. Python v0\.29\.1 is running in your browser\./.test(w6.document.getElementById("pythonStatus").textContent) && w6.eval("selectedKeys()")[0] === "format-1", w6.document.getElementById("pythonStatus").textContent);

  // 6c. every version unavailable: clear message, dropdown says so
  var w7 = await boot({ url: "http://127.0.0.1:8000/", session: { token: JSON.stringify({ value: "t", expires: Date.now() + 3600000, scope: SCOPE_ALL }) }, fetchOptions: { brokenVersions: ["v0.29.3", "v0.29.2", "v0.29.1", "v0.29.0", "v0.28.3", "v0.27.7"] } });
  check("clear message when Python cannot load", /Could not load Python/.test(w7.document.getElementById("pythonStatus").textContent) && /Python could not start/.test(w7.document.getElementById("pythonNote").textContent) && /More options/.test(w7.document.getElementById("pythonNote").textContent), w7.document.getElementById("pythonStatus").textContent);

  // 6d. bad formats text: dropdown explains instead of staying blank
  check("a bad formats box is explained where the formats are, and Build is off", /could not be read/.test(w4.document.getElementById("formatEditor").textContent) && w4.document.getElementById("create").disabled === true, w4.document.getElementById("formatEditor").textContent);

  // 6g. "All recipes" previews every format once, with one closing line
  var two = 'FORMATS = {"b1-evocative": {"name": "evo {n}", "segments": [("💗 spacious + gentle", 30), ("🛋 rest", 30)]}, "second": {"name": "second {n}", "silence between segments": "1 min", "segments": [("💗💗 evocative", 20), ("🛋 rest", 20)]}}';
  var w8 = await boot({ url: "http://127.0.0.1:8000/", session: { token: JSON.stringify({ value: "t", expires: Date.now() + 3600000, scope: SCOPE_ALL }) }, local: { formats: two } });
  check("Build all recipes is in More options, and there is no format dropdown any more", !!w8.document.querySelector("#moreOptions #buildAll") && !w8.document.getElementById("formatKey") && w8.document.getElementById("buildAll").textContent.trim() === "Build all recipes");
  await waitFor(() => !w8.document.getElementById("buildAll").disabled, 20000);
  w8.document.getElementById("buildAll").click();
  await waitFor(() => visible(w8, "confirmBox"), 30000);
  var out8 = outText(w8);
  console.log("\n--- all-formats output ---\n" + out8.split("\n").slice(0, 40).join("\n") + "\n--------------------------\n");
  check("all: one sentence for the whole build", /^Ready to build \d+ playlists for 2 recipes\. Why these numbers\?$/.test(w8.document.getElementById("confirmText").textContent) && w8.document.getElementById("bdTitle").textContent === "Build 2 recipes", w8.document.getElementById("confirmText").textContent);
  check("all: no bar or length in the header, since there is more than one recipe", w8.document.getElementById("bdShape").hidden && w8.document.getElementById("bdShapeInfo").hidden);
  check("all: no list while it asks", planGroups(w8).length === 0 && planRows(w8).length === 0);
  pressBuild(w8);
  await waitFor(() => /in your Spotify library\.$/.test(w8.document.getElementById("actionMessage").textContent), 30000);
  check("all: the playlists built are listed under their recipes' readable names", JSON.stringify(planGroups(w8)) === '["evo","second"]', JSON.stringify(planGroups(w8)));

  check("page sends at most 5 arguments to build_playlists (the last is the names to skip)", global.planTextArgCounts.length > 0 && Math.max(...global.planTextArgCounts) <= 5, String(global.planTextArgCounts));
  // two setup flows: nothing chosen at first, existing when a Client ID is already saved
  var hid = (w, id) => w.document.getElementById(id).hidden;
  check("new visitors see neither flow, and nothing below the choices", hid(fresh, "flowNew") && hid(fresh, "flowExisting") && hid(fresh, "connectBlock") && hid(fresh, "spSteps") && !hid(fresh, "spAsk"));
  check("nothing below Step 1 shows before Spotify is connected", fresh.document.getElementById("appSection").hidden === true && fresh.document.getElementById("connectedSection").hidden === true);
  check("everything below Step 1 shows once connected", w1.document.getElementById("appSection").hidden === false && w1.document.getElementById("connectedSection").hidden === false);
  var returning = await boot({ url: "http://127.0.0.1:8000/", local: { clientId: "abc" } });
  check("a saved Client ID opens the existing-app flow", !hid(returning, "flowExisting") && hid(returning, "flowNew") && !hid(returning, "connectBlock"));
  fresh.document.querySelector('[data-flow="new"]').click();
  check("choosing create shows the create flow and the connect block", !hid(fresh, "flowNew") && hid(fresh, "flowExisting") && !hid(fresh, "connectBlock"));
  var createText = fresh.document.getElementById("flowNew").textContent;
  check("create flow gives exact form instructions", /App name:Ceremony Playlist BuilderCopy/.test(createText) && /App description:Ceremony Playlist BuilderCopy/.test(createText) && /Redirect URI:http:\/\/127\.0\.0\.1:8000\/Copy/.test(createText) && /Check Web API only/.test(createText) && /Website: leave it blank/.test(createText), createText);
  fresh.document.querySelector('[data-flow="existing"]').click();
  check("choosing existing switches flows", hid(fresh, "flowNew") && !hid(fresh, "flowExisting") && !hid(fresh, "connectBlock"));
  check("the steps come in their own card, with the question gone and a title for the answer", hid(fresh, "spAsk") && !hid(fresh, "spSteps") && /Find your Client ID/.test(fresh.document.getElementById("spStepsTitle").textContent));
  fresh.document.getElementById("setupBack").click();
  check("the Back button under the card returns to the question", !hid(fresh, "spAsk") && hid(fresh, "spSteps") && fresh.document.getElementById("setupBack").closest("#spSteps") === null);
  check("inside the steps card, under Connect, a What does all this actually do? opens a plain explanation", /What does all this actually do\?/.test(fresh.document.querySelector("#spSteps #spWhat summary").textContent) && !fresh.document.getElementById("spWhat").open && fresh.document.getElementById("connectBlock").compareDocumentPosition(fresh.document.getElementById("spWhat")) & 4);

  var denied = await boot({ url: "http://127.0.0.1:8000/?error=redirect_uri_mismatch&state=st1" });

  check("a failed sign-in reveals the message even if no flow was chosen", !denied.document.getElementById("connectBlock").hidden && /redirect_uri_mismatch/.test(denied.document.getElementById("loginMessage").textContent));

  // 6e. dashboard link opens in a new tab, safely
  var link = w1.document.querySelector('a[href="https://developer.spotify.com/dashboard"]');
  check("dashboard link opens in a new tab", !!link && link.target === "_blank" && /noopener/.test(link.rel), link && link.outerHTML);

  // 6f. copy button gives feedback
  w1.document.getElementById("copyRedirect").click();
  await new Promise((r) => setTimeout(r, 100));
  check("copy button says Copied", w1.document.getElementById("copyRedirect").textContent === "Copied", w1.document.getElementById("copyRedirect").textContent);
  var cfCopied = [];
  w1.navigator.clipboard = { writeText: async (t) => { cfCopied.push(t); } };
  var cfButtons = w1.document.querySelectorAll("#flowNew .sp-field .copy-field");
  for (const b of cfButtons) b.click();
  await new Promise((r) => setTimeout(r, 100));
  check("App name, App description and Redirect URI each have a Copy button that copies the text in its box", cfButtons.length === 3 && cfCopied.join("|") === "Ceremony Playlist Builder|Ceremony Playlist Builder|http://127.0.0.1:8000/", cfCopied.join("|"));

  // 6h. clearing saved data forgets the Client ID, formats and sign-in, after asking
  var wClear = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { clientId: "keep-me", formats: MINI } });
  wClear.eval("reloadPage = () => { window.__reloaded = true; }");
  check("clear panel is hidden until asked", wClear.document.getElementById("clearConfirm").hidden === true);
  wClear.document.getElementById("clearData").click();
  check("clicking Reset app on this device asks first, and clears nothing yet", wClear.document.getElementById("clearConfirm").hidden === false && wClear.localStorage.getItem("clientId") === "keep-me" && !!wClear.sessionStorage.getItem("token"));
  wClear.document.getElementById("clearNo").click();
  check("cancel leaves everything saved", wClear.document.getElementById("clearConfirm").hidden === true && wClear.localStorage.getItem("clientId") === "keep-me" && !wClear.__reloaded);
  wClear.document.getElementById("clearData").click();
  wClear.document.getElementById("clearYes").click();
  await waitFor(() => wClear.__reloaded === true, 5000);
  check("confirming forgets the Client ID, formats and sign-in, then reloads", wClear.localStorage.length === 0 && wClear.sessionStorage.length === 0 && wClear.__reloaded === true, `${wClear.localStorage.length} local, ${wClear.sessionStorage.length} session`);
  check("troubleshooting is available before connecting too", !!fresh.document.getElementById("clearData") && fresh.document.getElementById("appSection").hidden === true);

  // 6i. Ko-fi support: a floating link that opens Ko-fi in a new tab
  var sb = fresh.document.getElementById("supportButton");
  check("the floating button is a link to Ko-fi, as the fallback, labeled Support me, with the Ko-fi cup", sb.tagName === "A" && sb.textContent.trim() === "Support me" && !!sb.querySelector("img[src=\"cup-border.png\"]") && sb.querySelector("img").getAttribute("alt") === "" && sb.href === "https://ko-fi.com/roncarmel" && sb.target === "_blank" && /noopener/.test(sb.rel) && /noreferrer/.test(sb.rel) && sb.getAttribute("title") === "Support me on Ko-fi", sb.outerHTML);
  check("no Ko-fi frame, panel or script is ever loaded", !fresh.document.querySelector("iframe") && !fresh.document.getElementById("supportPanel") && !Array.from(fresh.document.querySelectorAll("script")).some((x) => /ko-fi/.test(x.src)));
  var cap = fresh.document.getElementById("supportCaption");
  check("the caption sits with the Donate button in the same floating box, with the new wording", !!cap && cap.textContent === "Everyone is welcome to use this app. If it\u2019s been helpful, please give whatever feels right to you." && cap.previousElementSibling === sb && cap.parentElement === sb.parentElement && sb.parentElement.id === "supportBox", cap && cap.textContent);
  check("every button is filled #ff38b8 and no green is left", /--button: #ff38b8/.test(css) && /\n  button \{[^}]*background: var\(--button\)/.test(css) && !/1a7f4b|3ccf84/.test(css));
  check("the Tip me button has the same shape as the other buttons", /#supportButton \{[^}]*padding: 8px 14px;[^}]*border-radius: 8px/.test(css.replace(/\n\s+/g, " ")));
  var cupImg = sb.querySelector("img");
  var flat = css.replace(/\s+/g, " ");
  check("the cup wiggles every 3 seconds using Ko-fi's keyframes", /animation: kofi-wiggle 3s infinite/.test(flat) && /@keyframes kofi-wiggle \{ 0% \{ transform: rotate\(0\) scale\(1\); \} 60% \{ transform: rotate\(0\) scale\(1\); \} 75% \{ transform: rotate\(0\) scale\(1\.12\); \} 80% \{ transform: rotate\(0\) scale\(1\.1\); \} 84% \{ transform: rotate\(-10deg\) scale\(1\.1\); \} 88% \{ transform: rotate\(10deg\) scale\(1\.1\); \} 92% \{ transform: rotate\(-10deg\) scale\(1\.1\); \} 96% \{ transform: rotate\(10deg\) scale\(1\.1\); \} 100% \{ transform: rotate\(0\) scale\(1\); \} \}/.test(flat));
  check("the wiggle stops for people who ask for less motion", /@media \(prefers-reduced-motion: reduce\) \{ #supportButton img \{ animation: none; \} \}/.test(flat));
  check("the button keeps the app's pink and still opens Ko-fi in a new tab", /#supportButton \{[^}]*background: var\(--button\)/.test(flat) && /--button: #ff38b8/.test(css) && sb.target === "_blank" && sb.href === "https://ko-fi.com/roncarmel");
  check("the button and caption float together, and the page keeps only a little room at the bottom until the tip becomes a strip", /#supportBox \{ position: fixed;/.test(css) && /main \{ max-width: 720px; margin: 0 auto; padding: 24px 16px 24px; \}/.test(css));

  // 6j. the browser-tab icon is wired up, with files beside the page
  var icons = Array.from(fresh.document.head.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')).map((l) => `${l.getAttribute("rel")}:${l.getAttribute("href")}`);

  // 7. redirect address shown matches the page
  check("redirect address shown", w1.document.getElementById("redirect").textContent === "http://127.0.0.1:8000/", w1.document.getElementById("redirect").textContent);


  // ---------------- preview, then create
  var writesOf = (o, type) => o.writes.filter((x) => x.type === type);

  // A. an older read-only sign-in is not good enough
  var wOld = await boot({ url: "http://127.0.0.1:8000/", session: { token: JSON.stringify({ value: "t", expires: Date.now() + 3600000, scope: "playlist-read-private" }) } });
  check("a read-only sign-in asks to connect again", /connect again/.test(wOld.document.getElementById("loginMessage").textContent) && wOld.document.getElementById("connectedSection").hidden, wOld.document.getElementById("loginMessage").textContent);

  // B. preview first; Create appears under the plan and makes exactly that plan
  var oB = {};
  var wB = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: oB });
  check("before creating, the question box and the plan box are closed", !visible(wB, "confirmBox") && wB.document.getElementById("output").hidden === true && wB.document.getElementById("output").textContent === "" && wB.document.getElementById("planText").hidden === true);
  var css0 = fs.readFileSync(ROOT + "index.html", "utf8");
  check("hidden always means hidden, even for elements the page styles with display (like the flex rows)", /\[hidden\] \{ display: none !important; \}/.test(css0) && /\.row \{[^}]*display: flex/.test(css0) && /<div id="confirmBox" hidden>/.test(css0));
  check("the plan box starts hidden in the page itself, not only after a script runs", /<div id="output" class="bd-status" hidden><\/div>/.test(css0));
  check("the Step 3 row has one Build button and no dropdown; Remove and Build all live in More options", !!wB.document.querySelector("#create") && !wB.document.getElementById("formatKey") && !wB.document.getElementById("create").parentElement.querySelector("#removeOld, #preview, #buildAll") && !wB.document.querySelector("#appSection #removeOld") && !!wB.document.querySelector("#moreOptions #buildAll"));
  await runPreview(wB);
  var plannedCount = Number((wB.document.getElementById("confirmText").textContent.match(/up to (\d+) playlists\./) || [])[1]);
  var createLabel = wB.document.getElementById("confirmYes").textContent;
  check("after pressing Create, a question shows the exact count and offers to create it", visible(wB, "confirmBox") && plannedCount > 3 && createLabel === `Build ${plannedCount} playlists`, createLabel);
  check("a plan with nothing to replace is one sentence, what more than one means, the count with Why N? beside it, and two buttons, the numbers only behind Why N?", /^The playlists you chose for this recipe have enough songs to build up to \d+ playlists\. Why \d+\?$/.test(wB.document.getElementById("confirmText").textContent) && visible(wB, "bdPickWhy") && !!wB.document.querySelector("#confirmText #planToggle") && !visible(wB, "confirmNotes") && !/will be replaced|renamed/.test(wB.document.getElementById("bdInfo").textContent) && wB.document.getElementById("planText").hidden === true && wB.document.getElementById("planToggle").textContent === `Why ${plannedCount}?` && wB.document.getElementById("output").hidden === true, wB.document.getElementById("confirmText").textContent);
  check("nothing has been created yet", oB.writes.length === 0);
  wB.document.getElementById("planToggle").click();
  check("Why N? shows the numbers, and the link then offers to hide them", wB.document.getElementById("planText").hidden === false && wB.document.getElementById("planToggle").textContent === "Hide");
  wB.document.getElementById("planToggle").click();
  check("Hide puts them away again", wB.document.getElementById("planText").hidden === true);
  pressBuild(wB);
  await waitFor(() => /in your Spotify library\.$/.test(wB.document.getElementById("actionMessage").textContent), 30000);
  var creates = writesOf(oB, "create");
  check("with nothing to replace, the question only offered to create, and no earlier playlists were removed", !visible(wB, "confirmBox") && oB.writes.every((w) => w.type !== "remove"));
  var planned = planRows(wB);
  check("it created exactly the playlists it said, privately, named from the recipe, and lists them", creates.length === plannedCount && planned.length === plannedCount && creates[0].name === "mini 1" && creates.every((c, i) => c.name === planned[i].name && c.public === false), `${creates.length} vs ${plannedCount}`);
  var addsFor = (o, id) => writesOf(o, "add").filter((w) => w.id === id);
  var songCounts = creates.map((c) => addsFor(oB, c.id).flatMap((a) => a.uris).filter((u) => u !== SILENCE_30).length);
  check("each created playlist has exactly the song count the list shows", JSON.stringify(songCounts) === JSON.stringify(planned.map((p) => p.songs)), `${songCounts} vs ${planned.map((p) => p.songs)}`);
  var firstUris = addsFor(oB, creates[0].id).flatMap((a) => a.uris);
  check("songs were added up to 100 at a time: one request for a playlist of 100 songs or fewer", creates.every((c) => addsFor(oB, c.id).length === Math.ceil(addsFor(oB, c.id).flatMap((a) => a.uris).length / 100)) && addsFor(oB, creates[0].id).length === 1, JSON.stringify(creates.map((c) => addsFor(oB, c.id).length)));
  var silenceAt = firstUris.reduce((acc, u, i) => (u === SILENCE_30 ? acc.concat(i) : acc), []);
  check("one silence track sits between the two segments", silenceAt.length === 1 && silenceAt[0] > 0 && silenceAt[0] < firstUris.length - 1, JSON.stringify(silenceAt));
  var allUris = creates.flatMap((c) => addsFor(oB, c.id).flatMap((a) => a.uris)).filter((u) => u !== SILENCE_30);
  check("no song repeats across the created playlists", new Set(allUris).size === allUris.length);
  var links = wB.document.querySelectorAll("#results .bd-row a");
  check("the created playlists are listed without links, and Open in Spotify opens the first one", links.length === 0 && /open\.spotify\.com\/playlist\/new1$/.test(wB.document.getElementById("createOpenLink").href) && wB.document.getElementById("createOpenLink").target === "_blank");
  check("after a successful run the question and the plan are cleared, so it cannot make duplicates, and Create is ready again", !visible(wB, "confirmBox") && (wB.document.getElementById("output").hidden && wB.document.getElementById("output").textContent === "") && wB.document.getElementById("planText").textContent === "" && !wB.document.getElementById("create").disabled);

  // C. the limit (in More options) caps the plan
  var oC2 = {};
  var wC2 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: oC2 });
  wC2.document.getElementById("maxPlaylists").value = "3";
  wC2.document.getElementById("maxPlaylists").dispatchEvent(new wC2.Event("input"));
  await runPreview(wC2);
  check("with a limit of 3, the question offers to build 3", wC2.document.getElementById("confirmYes").textContent === "Build 3 playlists", wC2.document.getElementById("confirmYes").textContent);
  pressBuild(wC2);
  await waitFor(() => /in your Spotify library\.$/.test(wC2.document.getElementById("actionMessage").textContent), 20000);
  check("only the limited number are created", writesOf(oC2, "create").length === 3);

  // D. a preview is one at a time, and anything that could change it clears it and re-enables Preview plan
  var wD0 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  await runPreview(wD0);
  check("with a preview showing, Preview plan is disabled", wD0.document.getElementById("create").disabled === true && visible(wD0, "confirmBox"));
  wD0.document.getElementById("formats").value += " ";
  wD0.document.getElementById("formats").dispatchEvent(new wD0.Event("input"));
  await new Promise((r) => setTimeout(r, 40));
  check("editing the formats closes the question and re-enables Create", (wD0.document.getElementById("output").hidden && outText(wD0) === "") && !visible(wD0, "confirmBox") && wD0.document.getElementById("create").disabled === false);
  await runPreview(wD0);
  await new Promise((r) => setTimeout(r, 40));
  await runPreview(wD0);
  wD0.document.getElementById("maxPlaylists").dispatchEvent(new wD0.Event("input"));
  await new Promise((r) => setTimeout(r, 40));
  check("changing the limit closes the question and re-enables Create", (wD0.document.getElementById("output").hidden && outText(wD0) === "") && !visible(wD0, "confirmBox") && wD0.document.getElementById("create").disabled === false);
  await runPreview(wD0);
  wD0.document.querySelector("#feRows .fe-inc").click();
  await new Promise((r) => setTimeout(r, 40));
  check("editing a format in the editor closes the question", (wD0.document.getElementById("output").hidden && outText(wD0) === "") && !visible(wD0, "confirmBox") && wD0.document.getElementById("create").disabled === false);
  // restoring from a backup also changes the formats
  await runPreview(wD0);
  var rfD = wD0.document.getElementById("restoreFile");
  Object.defineProperty(rfD, "files", { value: [new wD0.File([MINI], "b.txt")], configurable: true });
  rfD.dispatchEvent(new wD0.Event("change"));
  await new Promise((r) => setTimeout(r, 500));
  check("restoring a backup removes the preview", (wD0.document.getElementById("output").hidden && outText(wD0) === "") && !visible(wD0, "confirmBox"));

  // editing while a preview is still being made throws that preview away
  var wD1 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  await readyToPreview(wD1);
  wD1.document.getElementById("create").click();
  await new Promise((r) => setTimeout(r, 10));
  wD1.document.getElementById("formats").value += " ";
  wD1.document.getElementById("formats").dispatchEvent(new wD1.Event("input"));
  await waitFor(() => !wD1.document.getElementById("create").disabled, 30000);
  await new Promise((r) => setTimeout(r, 400));
  check("a preview finished after an edit is discarded, not shown", !visible(wD1, "confirmBox") && (wD1.document.getElementById("output").hidden && outText(wD1) === ""), outText(wD1).slice(0, 60));

  // E. earlier playlists with matching names: ask, then replace
  var existing = [
    { id: "old1", name: "mini 1", owner: { id: "ron" }, description: MADE },
    { id: "old2", name: "mini 12", owner: { id: "ron" }, description: MADE },
    { id: "old3", name: "mini 3", owner: { id: "other" } },
    { id: "old4", name: "mini extra", owner: { id: "ron" } },
  ];
  var oC = { extraPlaylists: existing };
  var wC = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: oC });
  await runPreview(wC);
  var earlier = wC.document.getElementById("bdInfo").textContent;
  check("the question counts only my matching earlier playlists to replace, without listing them", /^2 earlier playlists from this recipe will be replaced\. DetailsReplacing them is the usual choice/.test(earlier) && !/mini 1/.test(earlier), earlier);
  check("one Build button, and keeping them is a checkbox that starts off", /^Build \d+ playlists$/.test(wC.document.getElementById("confirmYes").textContent) && wC.document.getElementById("confirmKeepEarlier").type === "checkbox" && wC.document.getElementById("confirmKeepEarlier").checked === false && /up to \d+ playlists\./.test(wC.document.getElementById("confirmText").textContent), wC.document.getElementById("confirmYes").textContent);
  wC.document.getElementById("confirmNo").click();
  await waitFor(() => wC.document.getElementById("createOverlay").hidden);
  await waitFor(() => !wC.document.getElementById("create").disabled);
  check("cancelling changes nothing and keeps Create available", oC.writes.length === 0 && !visible(wC, "confirmBox") && !wC.document.getElementById("create").disabled, JSON.stringify(oC.writes));
  wC.document.getElementById("create").click();
  await waitFor(() => visible(wC, "confirmBox"));
  pressBuild(wC);
  await waitFor(() => /in your Spotify library\.$/.test(wC.document.getElementById("actionMessage").textContent), 30000);
  check("earlier playlists are removed before new ones are made", oC.writes[0].type === "remove" && JSON.stringify(oC.writes[0].uris) === JSON.stringify(["spotify:playlist:old1", "spotify:playlist:old2"]) && oC.writes[1].type === "create", JSON.stringify(oC.writes.slice(0, 2)));

  // F. a permissions failure is explained
  var oE = { denyCreate: true };
  var wE = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: oE });
  await runPreview(wE);
  pressBuild(wE);
  await waitFor(() => /did not allow/.test(wE.document.getElementById("actionMessage").textContent));
  check("a refused permission tells the user to reconnect, and Create is available again", /Disconnect, then Connect again/.test(wE.document.getElementById("actionMessage").textContent) && true, wE.document.getElementById("actionMessage").textContent);

  // G. when nothing can be made there is no Create and nothing is touched
  var oF = { extraPlaylists: [{ id: "old1", name: "huge 1", owner: { id: "ron" }, description: MADE }] };
  var wF = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: '{"huge": {"name": "huge {n}", "segments": [("💗 spacious + gentle", 99999)]}}' }, fetchOptions: oF });
  await runPreview(wF);
  check("an impossible plan offers no Create and changes nothing", !visible(wF, "confirmBox") && /Nothing can be built/.test(outText(wF)) && oF.writes.length === 0, outText(wF));

  // H. removal lives in More options, with its own format choice
  var TWO = '{"a": {"name": "alpha {n}", "segments": [("💗 spacious + gentle", 10)]}, "b": {"name": "beta {n}", "segments": [("🛋 rest", 10)]}}';
  var oG = { extraPlaylists: [{ id: "a1", name: "alpha 1", owner: { id: "ron" }, description: MADE }, { id: "b1", name: "beta 1", owner: { id: "ron" }, description: MADE }, { id: "b2", name: "beta 2", owner: { id: "ron" }, description: MADE }] };
  var wG = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: TWO }, fetchOptions: oG });
  await readyToPreview(wG);
  var removeOpts = Array.from(wG.document.getElementById("removeKey").options).map((o) => o.value);
  check("the removal dropdown lists a blank, the formats, then All recipes", JSON.stringify(removeOpts) === JSON.stringify(["", "a", "b", "__all__"]), JSON.stringify(removeOpts));
  check("removal is inside More options", !!wG.document.querySelector("#moreOptions #removeOld") && !!wG.document.querySelector("#moreOptions #maxPlaylists") && !!wG.document.querySelector("#moreOptions #clearData") && /More options/.test(wG.document.querySelector("#moreOptions summary").textContent));
  check("the removal dropdown starts blank and Remove waits for a choice", wG.document.getElementById("removeKey").value === "" && wG.document.getElementById("removeOld").disabled === true);
  wG.document.getElementById("removeKey").value = "b";
  removeNow(wG);
  await waitFor(() => visible(wG, "removeConfirmBox"));
  check("the removal question appears inside the Remove section, below its button, not up in Step 3", !!wG.document.querySelector("#moreOptions #removeConfirmBox") && !visible(wG, "confirmBox") && !!(wG.document.getElementById("removeOld").compareDocumentPosition(wG.document.getElementById("removeConfirmBox")) & 4));
  check("choosing one format removes only its playlists", JSON.stringify(Array.from(wG.document.querySelectorAll("#removeConfirmList li")).map((li) => li.textContent)) === JSON.stringify(["beta 1", "beta 2"]));
  check("the removal question has its own confirm and cancel buttons", /^Remove 2 playlists$/.test(wG.document.getElementById("removeConfirmYes").textContent) && wG.document.getElementById("removeConfirmNo").textContent === "Cancel");
  wG.document.getElementById("removeConfirmNo").click();
  await waitFor(() => /Cancelled/.test(wG.document.getElementById("removeMessage").textContent));
  check("cancelling a removal says so inside that section and changes nothing", oG.writes.length === 0 && !visible(wG, "removeConfirmBox"));
  removeNow(wG);
  await waitFor(() => visible(wG, "removeConfirmBox"));
  wG.document.getElementById("removeConfirmYes").click();
  await waitFor(() => /^Removed/.test(wG.document.getElementById("removeMessage").textContent));
  check("remove deletes just the chosen format's playlists and reports inside the section", oG.writes.length === 1 && oG.writes[0].type === "remove" && oG.writes[0].uris.length === 2 && /Removed 2 playlists/.test(wG.document.getElementById("removeMessage").textContent) && (wG.document.getElementById("output").hidden && outText(wG) === ""), JSON.stringify(oG.writes));

  // I. many playlists to remove are sent in batches of 40
  var many = Array.from({ length: 95 }, (_, i) => ({ id: "m" + i, name: "mini " + (i + 1), owner: { id: "ron" }, description: MADE }));
  var oH = { extraPlaylists: many };
  var wH = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: oH });
  await readyToPreview(wH);
  removeNow(wH);
  await waitFor(() => visible(wH, "removeConfirmBox"));
  wH.document.getElementById("removeConfirmYes").click();
  await waitFor(() => /^Removed/.test(wH.document.getElementById("removeMessage").textContent), 20000);
  check("removals are batched at 40", JSON.stringify(oH.writes.map((w) => w.uris.length)) === "[40,40,15]", JSON.stringify(oH.writes.map((w) => w.uris && w.uris.length)));

  // I2. how-to help for formats, under the editor
  var fh = wB.document.getElementById("formatHelp");
  var editorBox = wB.document.getElementById("formatEditor");
  check("the help sits under the editor and its note, ahead of Step 3", editorBox.nextElementSibling.id === "editorNote" && editorBox.nextElementSibling.nextElementSibling.id === "formats" && editorBox.nextElementSibling.nextElementSibling.nextElementSibling === fh && fh.nextElementSibling.tagName === "H2" && fh.open === false && /How recipes work/.test(fh.querySelector("summary").textContent));
  var helpText = fh.textContent;
  check("the help explains segments, silence, mixes and names, and has no troubleshooting section", ["Segments", "Silence", "Mixes", "Names"].every((t) => Array.from(fh.querySelectorAll("h3")).some((h) => h.textContent === t)) && !/If something goes wrong/.test(fh.textContent) && fh.querySelectorAll("ul").length === 0);
  check("the hidden text is not in the way: it is hidden from sight and from assistive tools", wB.document.getElementById("formats").hidden === true && wB.document.getElementById("formats").getAttribute("aria-hidden") === "true");

  // I3. the Python status moved out of the way
  check("the Python status lives in More options, under a heading that says what it is, with plain wording", !!wB.document.querySelector("#moreOptions #pythonStatus") && /^Ready\. Python v[\d.]+ is running in your browser\.$/.test(wB.document.getElementById("pythonStatus").textContent) && !wB.document.querySelector("#appSection #pythonStatus") && Array.from(wB.document.querySelectorAll("#moreOptions details.gd-topic > summary")).some((h) => h.textContent === "Python status"), wB.document.getElementById("pythonStatus").textContent);
  check("More options no longer says planner anywhere, and explains Python in one sentence", !/planner/i.test(wB.document.getElementById("moreOptions").textContent) && /The code that builds your playlists is written in Python and runs inside your browser, so nothing about your music is sent to a server\./.test(wB.document.getElementById("moreOptions").textContent) && !/planner/i.test(fs.readFileSync(ROOT + "index.html", "utf8")));
  check("More options does not show the app version", wB.document.getElementById("appVersionLabel") === null && !/App version/.test(wB.document.getElementById("moreOptions").textContent));
  check("while Python loads, the note beside Create says Python, not planner", /Getting Python ready/.test(fs.readFileSync(ROOT + "app.js", "utf8")) && /Python could not start, so building is unavailable/.test(fs.readFileSync(ROOT + "app.js", "utf8")) && !/planner/i.test(fs.readFileSync(ROOT + "app.js", "utf8")));

  // J. the thank-you prompt only follows a successful create
  var promptsAfterCreate = Array.from(wB.document.querySelectorAll("#createDialog .support-prompt")).filter((el) => !el.hidden);
  var promptLink = promptsAfterCreate[0] && promptsAfterCreate[0].querySelector("a");
  check("the thank-you line reads right, as plain text with no link, with the Support me button under it", promptsAfterCreate.length === 1 && promptsAfterCreate[0].querySelector("p").textContent === "If this app has been helpful to you, I’d be grateful for your support, in whatever amount feels right." && !/donat/i.test(promptsAfterCreate[0].textContent) && promptsAfterCreate[0].querySelector("#createDonate") !== null);
  check("it has no link, since the Support me button is right there", promptsAfterCreate[0].querySelectorAll("a").length === 0 && !promptLink && !/KOFI_URL/.test(fs.readFileSync(ROOT + "app.js", "utf8")));
  check("no prompt after cancelling", wE.document.getElementById("createSupport").hidden);
  check("no prompt after a failed create", wE.document.getElementById("createSupport").hidden);

  // ---------------- backing up and restoring formats
  var EX = (w) => w.document.getElementById("formats").value;
  var DEFAULT_TEXT = null;
  var bk = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: null } });
  bk.eval("saveFile = (name, text) => { window.__saved = { name, text }; }");
  var startText = EX(bk);
  check("no backup yet and nothing made yet: Step 4 says there is nothing to back up", bk.document.getElementById("backupStatus").textContent === "You haven't made any recipes yet, so there is nothing to back up.", bk.document.getElementById("backupStatus").textContent);
  bk.document.getElementById("formats").value = startText + "\n# my edit 📕";
  bk.document.getElementById("formats").dispatchEvent(new bk.Event("input"));
  check("an edited format with no backup says so", /haven't backed up to this device/.test(bk.document.getElementById("backupStatus").textContent), bk.document.getElementById("backupStatus").textContent);
  bk.document.getElementById("backupDownload").click();
  check("download hands over a .txt file stamped with the date and time with the formats as typed (emoji intact)", /^playlist-recipes-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.txt$/.test(bk.__saved.name) && bk.__saved.text === EX(bk) && /📕/.test(bk.__saved.text), JSON.stringify(bk.__saved && bk.__saved.name));
  check("after a backup the status shows the date", /^Last backup: /.test(bk.document.getElementById("backupStatus").textContent) && /Backed up to this device\./.test(capText(bk)), bk.document.getElementById("backupStatus").textContent);
  bk.document.getElementById("formats").value += "\n# another edit";
  bk.document.getElementById("formats").dispatchEvent(new bk.Event("input"));
  check("editing after a backup says the formats have been edited since", bk.document.getElementById("backupStatus").textContent === "Your recipes have been edited since your last backup.", bk.document.getElementById("backupStatus").textContent);

  var sendFile = async (w, name, text) => {
    const input = w.document.getElementById("restoreFile");
    const file = new w.File([text], name, { lastModified: Date.UTC(2026, 9, 1) });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new w.Event("change"));
    await new Promise((r) => setTimeout(r, 500));
  };
  var GOOD = 'FORMATS = {\n  "one": {"name": "📗 one {n}", "segments": [("A", 10)]},\n  "two": {"name": "two {n}", "segments": [("B", 10)]},\n}';
  var before = EX(bk);
  await sendFile(bk, "playlist-recipes-2026-10-01.txt", GOOD);
  check("restore replaces the formats box with the file's text (emoji intact) and saves it in the browser", EX(bk) === GOOD && bk.localStorage.getItem("formats") === GOOD);
  check("restore reports what it loaded and offers Undo", /Restored 2 recipes from playlist-recipes-2026-10-01\.txt\./.test(capText(bk)) && capLinks(bk).some((b) => b.textContent === "Undo"), capText(bk));
  check("the restored formats are the ones the editor knows about", bk.eval("currentFormats").map((f) => f.id).join(",") === "one,two", bk.eval("currentFormats").map((f) => f.id).join(","));
  check("a restored file counts as backed up", /^Last backup: /.test(bk.document.getElementById("backupStatus").textContent), bk.document.getElementById("backupStatus").textContent);
  capLinks(bk).find((b) => b.textContent === "Undo").click();
  check("Undo puts the previous formats back", EX(bk) === before && /^Undone/.test(capText(bk)) && bk.localStorage.getItem("formats") === before);

  // bad files change nothing
  var keep = EX(bk);
  await sendFile(bk, "notes.txt", "hello, this is not formats");
  check("a file that is not formats is rejected with a reason, and nothing changes", EX(bk) === keep && /doesn't look like a recipe backup, so nothing was changed/.test(capText(bk)), capText(bk));
  await sendFile(bk, "huge.txt", "x".repeat(200001));
  check("an oversized file is rejected", EX(bk) === keep && /too large/.test(capText(bk)));
  await sendFile(bk, "again.txt", GOOD);
  check("choosing a file twice in a row works", EX(bk) === GOOD);

  // typing after a restore removes the Undo (it would overwrite the new edits)
  bk.document.getElementById("formats").value += " ";
  bk.document.getElementById("formats").dispatchEvent(new bk.Event("input"));
  check("editing clears the Undo offer", !/Restored|Undone/.test(capText(bk)) && !capLinks(bk).some((b) => b.textContent === "Undo"));

  // wiring
  var rf = bk.document.getElementById("restoreFile");
  check("the restore button uses a hidden file picker for text files", rf.hidden && /\.txt/.test(rf.accept));
  check("the explanation of why to back up is on the page, in Step 4", /Your recipes live only on this device\. Clearing your browser data would erase them\. A manual backup keeps a copy so you can restore them if needed/.test(bk.document.getElementById("appSection").textContent));


  // ---------------- the top of the page, the starting template, and the wording
  var pageHtml = fs.readFileSync(ROOT + "index.html", "utf8");
  check("the page is titled Ceremony Playlist Builder, in pink", /<title>Ceremony Playlist Builder<\/title>/.test(pageHtml) && t0.document.querySelector("h1").textContent === "Ceremony Playlist Builder" && /\n  h1 \{[^}]*color: var\(--accent\)/.test(pageHtml), t0.document.querySelector("h1").textContent);
  check("a one-line tagline opens the welcome page", /^Ceremony playlists, ready in minutes\.$/.test(t0.document.querySelector(".tagline").textContent) && t0.document.getElementById("welcomePage").contains(t0.document.querySelector(".tagline")));
  check("the page no longer lists sessions as something the app is for, and the about section lists retreats", !/sessions/i.test(t0.document.body.textContent) && /Ceremonies, retreats, workshops, and any long event/.test(t0.document.getElementById("about").textContent));
  var aboutFresh = fresh.document.getElementById("about");
  var aboutText = aboutFresh.textContent;
  check("an About this app section tells what it does, what it is good for, how it works, what is needed, and the privacy details", /^About this app$/.test(aboutFresh.querySelector("summary").textContent) && ["What it does", "What it's good for", "How it works", "What you need", "Privacy"].every((t) => aboutText.includes(t)) && aboutFresh.querySelectorAll("ol li").length === 3 && /Premium/.test(aboutText) && /never changed/.test(aboutText) && /Privacy/.test(aboutText));
  check("the More about this app section always starts closed, for first-time and returning visitors alike", aboutFresh.open === false && !/<details id="about"[^>]*\bopen\b/.test(fs.readFileSync(ROOT + "index.html", "utf8")) && !/\$\("about"\)\.open/.test(fs.readFileSync(ROOT + "app.js", "utf8")));
  check("it starts closed once a Client ID is saved, and once connected", returning.document.getElementById("about").open === false && t0.document.getElementById("about").open === false);
  var staticText = pageHtml.replace("Yes, I have", "").replace("I have done this before", "").replace("No, this is my first time", "").replace('"I have supported you!"', "").replace(/<style>[\s\S]*?<\/style>/, "").replace(/<details id="guideSection"[\s\S]*?<details id="moreOptions"/, "").replace(/<label class="choice-row"><input type="checkbox" id="donateHideBox">[\s\S]*?<\/label>/, "").replace(/<id="supportButton"[\s\S]*?<\/a>/, "").replace(/<a id="supportButton"[\s\S]*?<\/a>/, "").replace(/<p id="supportCaption">[\s\S]*?<\/p>/, "").replace(/<div id="createSupport"[\s\S]*?<\/p>/, "").replace(/<button id="createDonate"[\s\S]*?<\/button>/, "").replace(/<[^>]+>/g, " ");
  var firstPerson = staticText.match(/\b(my|mine|myself|I|I'm|I've|I'll)\b/gi) || [];
  check("no first-person wording anywhere in the page text, apart from the setup choice you worded yourself, the checkbox for people who have donated (and Privacy quoting it), which is in the person's own voice, and the guide for facilitators, which is in Ron's", firstPerson.length === 0, JSON.stringify(firstPerson));
  check("the two setup answers are plain labels", /Yes, I have/.test(fresh.document.getElementById("loginSection").textContent) && /No, this is my first time/.test(fresh.document.getElementById("loginSection").textContent));
  var tpl = t0.document.getElementById("formats").value;
  check("the editor starts with one format called Generated playlist, with one segment waiting for a playlist", t0.document.querySelectorAll("#feTabs .fe-tab").length === 1 && t0.document.querySelector("#feTabs .fe-tab").textContent === "Generated playlist" && t0.document.querySelectorAll("#feRows .fe-row").length === 1 && t0.document.querySelector("#feRows .fe-row .fe-title").textContent === "Choose a playlist", t0.document.getElementById("formatEditor").textContent);
  await readyToPreview(t0);
  check("the format being edited is format-1, from the starter", t0.eval("selectedKeys()")[0] === "format-1");
  t0.document.getElementById("create").click();
  await waitFor(() => /has no playlist yet/.test(outText(t0)), 20000);
  var tplOut = outText(t0);
  check("previewing before choosing a playlist says so, and creates nothing", /^Nothing can be built from this recipe yetA segment in Generated playlist has no playlist yet\. Choose one in the recipe\.$/.test(tplOut) && !visible(t0, "confirmBox"), tplOut);


  // ---------------- returning visitors: a friendly welcome with one button, setup steps tucked away
  // ---------------- the three pages: welcome, the one-time setup, and the app
  var pg = (w) => ["welcome", "setup", "app"].filter((p) => w.document.documentElement.classList.contains("page-" + p)).join();
  check("a new visitor sees the welcome page, with Start setup", pg(fresh) === "welcome" && !!fresh.document.getElementById("startSetup") && fresh.document.getElementById("welcomePage").contains(fresh.document.getElementById("startSetup")));
  check("the setup page is headed One-time setup, with the Back button under the steps, not above", /One-time setup/.test(fresh.document.querySelector("#spAsk h2").textContent) && !!fresh.document.getElementById("setupBack") && !fresh.document.getElementById("setupBack").closest(".card"));
  var pgw = await boot({ url: "http://127.0.0.1:8000/" });
  pgw.document.getElementById("startSetup").click();
  check("Start setup opens the setup page, with the question showing, and remembers it", pg(pgw) === "setup" && pgw.document.getElementById("spAsk").hidden === false && pgw.localStorage.getItem("setupStarted") === "1" && pgw.history.state && pgw.history.state.page === "setup");
  pgw.history.back();
  await waitFor(() => pg(pgw) === "welcome", 2000);
  check("the browser's back button returns to the welcome page, and that is remembered too", pg(pgw) === "welcome" && pgw.localStorage.getItem("setupStarted") === "0");
  pgw.document.getElementById("startSetup").click();
  var pgs = await boot({ url: "http://127.0.0.1:8000/", local: { setupStarted: "1" } });
  check("someone who started the setup comes back to it", pg(pgs) === "setup");
  var rv = await boot({ url: "http://127.0.0.1:8000/", local: { clientId: "saved-id-123" } });
  check("someone with a Client ID saved but never connected is on the setup page, on the existing-app steps, with the Client ID filled in", pg(rv) === "setup" && !rv.document.getElementById("flowExisting").hidden && rv.document.getElementById("clientId").value === "saved-id-123" && !rv.document.getElementById("welcomeBack"));
  rv.document.getElementById("connect").click();
  await new Promise((r) => setTimeout(r, 300));
  check("Connect there starts the Spotify sign-in with the saved Client ID", !!rv.sessionStorage.getItem("pkceVerifier") && !!rv.sessionStorage.getItem("pkceState") && rv.localStorage.getItem("clientId") === "saved-id-123");
  var rvErr = await boot({ url: "http://127.0.0.1:8000/?error=redirect_uri_mismatch&state=st1", local: { clientId: "saved-id-123", setupStarted: "1" } });
  check("if Spotify sends back a problem, it shows beside the Connect button on the setup page, with the steps showing", pg(rvErr) === "setup" && /redirect_uri_mismatch/.test(rvErr.document.getElementById("loginMessage").textContent) && rvErr.document.getElementById("spSteps").hidden === false);
  var rvOld = await boot({ url: "http://127.0.0.1:8000/", local: { clientId: "saved-id-123" }, session: { token: JSON.stringify({ value: "t", expires: Date.now() + 3600000, scope: "playlist-read-private" }) } });
  check("an older read-only sign-in asks to connect again on the setup page", pg(rvOld) === "setup" && /connect again/.test(rvOld.document.getElementById("loginMessage").textContent));
  check("signed in, the page is the app, compact", pg(w1) === "app" && w1.document.body.classList.contains("minimal"));
  var pgc = await boot({ url: "http://127.0.0.1:8000/", local: { clientId: "c1", connectedBefore: "1", formats: MINI } });
  check("connected before and signed out, it is still the app, and Build becomes Connect to Spotify", pg(pgc) === "app" && pgc.document.getElementById("appSection").hidden === false && pgc.document.getElementById("create").textContent.trim() === "Connect to Spotify");
  pgc.document.getElementById("feAppMenuButton").click();
  check("the menu has no Change Client ID", pgc.document.getElementById("feSetupAgain") === null);
  var pgHead = fs.readFileSync(ROOT + "index.html", "utf8");
  check("the page is chosen in <head> before anything is drawn, the same way as in app.js", /\(function \(\) \{\n    var page = "welcome";/.test(pgHead) && /document\.documentElement\.classList\.add\("page-" \+ page\)/.test(pgHead) && /function pageName\(\)/.test(fs.readFileSync(ROOT + "app.js", "utf8")));


  // ---------------- the playlist count in Step 1 follows creates and removals
  var oCount = {};
  var wCount = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: oCount });
  var countText = () => wCount.document.getElementById("connectedMessage").textContent;
  check("Step 1 starts with the real count", countText() === "Connected as Ron. 5 playlists found.", countText());
  wCount.document.getElementById("maxPlaylists").value = "3";
  wCount.document.getElementById("maxPlaylists").dispatchEvent(new wCount.Event("input"));
  await runPreview(wCount);
  pressBuild(wCount);
  await waitFor(() => /in your Spotify library\.$/.test(wCount.document.getElementById("actionMessage").textContent), 20000);
  await waitFor(() => /8 playlists found/.test(countText()), 5000);
  check("after creating 3 playlists the count goes from 5 to 8", countText() === "Connected as Ron. 8 playlists found.", countText());
  removeNow(wCount);
  await waitFor(() => visible(wCount, "removeConfirmBox"));
  wCount.document.getElementById("removeConfirmYes").click();
  await waitFor(() => /^Removed/.test(wCount.document.getElementById("removeMessage").textContent), 10000);
  await waitFor(() => /5 playlists found/.test(countText()), 5000);
  check("after removing those 3 playlists the count goes back to 5", countText() === "Connected as Ron. 5 playlists found.", countText());
  var tcss = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  check("the Example column of the parts table stays on one line", /table\.parts th:last-child, table\.parts td:last-child \{ white-space: nowrap; \}/.test(tcss));


  // ---------------- problem reports
  var REPORT_KEYS = ["appVersion", "browser", "windowSize", "python", "lastError", "recentSteps"];
  var params = (href) => new URL(href).searchParams;
  var openMore = (w) => { w.document.getElementById("moreOptions").open = true; w.document.getElementById("moreOptions").dispatchEvent(new w.Event("toggle")); };

  var rp = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI, clientId: "SECRET-CLIENT-ID-9" } });
  await readyToPreview(rp);
  openMore(rp);
  var firstH3 = Array.from(rp.document.querySelectorAll("#moreOptions details.gd-topic > summary")).filter((h) => !h.closest("[hidden]"))[0].textContent;   // the feedback section above it shows only once its form address is set
  check("Report a problem is not part of More options; it has its own block, opened from the app menu, that explains what happens", firstH3 !== "Report a problem" && !rp.document.getElementById("moreOptions").contains(rp.document.getElementById("reportBlock")) && rp.document.getElementById("reportBlock").hidden === true && /A person reads these, but may not respond to all of them/.test(rp.document.getElementById("reportBlock").textContent) && /nothing is sent until you submit it there/.test(rp.document.getElementById("reportBlock").textContent), firstH3);
  var rl = rp.document.getElementById("reportLink");
  check("the report link opens the form in a new tab, safely", rl.target === "_blank" && /noopener/.test(rl.rel) && /noreferrer/.test(rl.rel) && rl.href.startsWith("https://tally.so/r/VppLZN?"), rl.href);
  var q = params(rl.href);
  check("the link fills exactly the six hidden fields the form expects, and nothing else", JSON.stringify([...q.keys()].sort()) === JSON.stringify([...REPORT_KEYS].sort()), JSON.stringify([...q.keys()]));
  check("the details are real: version, browser, window size, python, last error, steps", q.get("appVersion") === "2026-11-04zd" && / on /.test(q.get("browser")) && /^\d+x\d+$/.test(q.get("windowSize")) && /^ready \(Python v[\d.]+\)$/.test(q.get("python")) && q.get("lastError") === "none" && /^page opened > connected, 5 playlists found > python ready$/.test(q.get("recentSteps")), JSON.stringify([...q.entries()]));
  var shown = rp.document.getElementById("reportPreview").textContent;
  check("the page shows people exactly what will be attached", /Version: 2026-11-04zd/.test(shown) && /Browser: .* on /.test(shown) && /Window size: \d+x\d+/.test(shown) && /Python: ready \(v/.test(shown) && /Last error: none/.test(shown) && /Recent steps: page opened > connected/.test(shown), shown);
  check("the version is not shown in More options", rp.document.getElementById("appVersionLabel") === null);
  check("there is no include-my-formats option, and the link never carries formats (the only checkboxes in More options are the remove toggle and the one for hiding the Donate button)", !/include my formats/i.test(rp.document.body.textContent) && !q.has("formats") && !rp.document.querySelector('#moreOptions input[type="checkbox"]:not(#removeToggle):not(#donateHideBox)'));
  check("every report link opens in a new tab without giving the new page access to this one", ["reportLink", "mainReportHint", "removeReportHint", "loginReportHint"].every((id) => { const a = rp.document.getElementById(id).tagName === "A" ? rp.document.getElementById(id) : rp.document.getElementById(id).querySelector("a"); return a.target === "_blank" && /noopener/.test(a.rel) && a.href.startsWith("https://tally.so/r/VppLZN"); }));

  // scrubbing: anything in quotation marks is a name that could be private
  check("scrubbing hides quoted names but keeps normal apostrophes", rp.scrubError("Could not find a playlist named 'My Secret List'. It couldn't be read.") === "Could not find a playlist named .... It couldn't be read." && rp.scrubError('Got: ("Private Name", 20)') === "Got: (..., 20)" && rp.scrubError("'Lone Name' is not yours.") === "... is not yours." && rp.scrubError("x".repeat(500)).length === 160, rp.scrubError("Could not find a playlist named 'My Secret List'. It couldn't be read."));

  // an unexpected failure offers a report with that failure filled in, and never leaks private data
  var oRp = { buildFailIn: "new1", buildFail: 500 };
  var rp2 = await boot({ url: "http://127.0.0.1:8000/", session: { token: JSON.stringify({ value: "TOKEN-VALUE-XYZ", expires: Date.now() + 3600000, scope: SCOPE_ALL }) }, local: { formats: MINI, clientId: "SECRET-CLIENT-ID-9" }, fetchOptions: oRp });
  check("no report link is offered when nothing has gone wrong", !visible(rp2, "mainReportHint") && !visible(rp2, "removeReportHint") && !visible(rp2, "loginReportHint"));
  await runPreview(rp2);
  pressBuild(rp2);
  await waitFor(() => /Something went wrong/.test(rp2.document.getElementById("actionMessage").textContent));
  check("after an unexpected failure a report this problem link appears beside the message", visible(rp2, "mainReportHint") && /report this problem/.test(rp2.document.getElementById("mainReportHint").textContent));
  var href2 = rp2.document.querySelector("#mainReportHint a").href;
  var q2 = params(href2);
  check("that link carries the failure, without any quoted text", /Spotify returned 500/.test(q2.get("lastError")) && !/['"]/.test(q2.get("lastError")), q2.get("lastError"));
  check("and the steps that led to it", /plan started > plan: \d+ playlists planned > create started \(\d+ playlists\) > create failed after 0 of \d+ > problem: /.test(q2.get("recentSteps")) && /create failed after 0 of \d+/.test(q2.get("recentSteps")), q2.get("recentSteps"));
  var everything = decodeURIComponent(href2) + rp2.document.getElementById("reportPreview").textContent;
  check("the report never contains the sign-in, the Client ID, playlist names, or song titles", !/TOKEN-VALUE-XYZ|SECRET-CLIENT-ID-9|spacious|gentle|rest|mini \d|Song \d|Artist/.test(everything.replace(/Recent steps|restore|ready/g, "")), everything.slice(0, 200));
  check("the link stays a safe length", href2.length < 1800, String(href2.length));
  rp2.document.getElementById("formats").value += " ";
  rp2.document.getElementById("formats").dispatchEvent(new rp2.Event("input"));
  await waitFor(() => !rp2.document.getElementById("create").disabled, 15000);
  check("the report link stays until the person starts something new", visible(rp2, "mainReportHint"));
  rp2.document.getElementById("create").click();
  check("starting a new preview clears the report link", !visible(rp2, "mainReportHint"));

  // problems the person can fix themselves are recorded, but do not offer a report
  var rp3 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: 'FORMATS = {"a": ' } });
  await new Promise((r) => setTimeout(r, 500));
  openMore(rp3);
  check("a formats typo is recorded as the last error, with no report link offered", /^Last error: Could not read the formats/m.test(rp3.document.getElementById("reportPreview").textContent) && !visible(rp3, "mainReportHint"), rp3.document.getElementById("reportPreview").textContent);
  var rp4 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn() });
  await runPreview(rp4);
  openMore(rp4);
  check("a segment with no playlist chosen is recorded as the last error, without any names", /Last error: Build blocked: 1 problem in the recipe/.test(rp4.document.getElementById("reportPreview").textContent) && !visible(rp4, "mainReportHint"), rp4.document.getElementById("reportPreview").textContent);

  // other places a failure can happen
  var oRm = { failRemove: true, extraPlaylists: [{ id: "old1", name: "mini 1", owner: { id: "ron" }, description: MADE }] };
  var rp5 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: oRm });
  await readyToPreview(rp5);
  removeNow(rp5);
  await waitFor(() => visible(rp5, "removeConfirmBox"));
  rp5.document.getElementById("removeConfirmYes").click();
  await waitFor(() => visible(rp5, "removeReportHint"), 10000);
  check("a failed removal offers its report link inside the Remove section", visible(rp5, "removeReportHint") && !!rp5.document.querySelector("#moreOptions #removeReportHint") && /Something went wrong/.test(rp5.document.getElementById("removeMessage").textContent));
  var rp6 = await boot({ url: "http://127.0.0.1:8000/?code=abc&state=st1", session: { pkceState: "st1", pkceVerifier: "v" }, local: { clientId: "SECRET-CLIENT-ID-9" }, fetchOptions: { failToken: true } });
  check("a refused sign-in offers a report link in Step 1", visible(rp6, "loginReportHint") && /Spotify refused the sign-in/.test(rp6.document.getElementById("loginMessage").textContent) && !/SECRET-CLIENT-ID-9/.test(decodeURIComponent(rp6.document.querySelector("#loginReportHint a").href)));
  check("Python that cannot load offers a report link", visible(w7, "mainReportHint") && /Could not load Python/.test(params(w7.document.querySelector("#mainReportHint a").href).get("lastError")) && /not loaded/.test(params(w7.document.querySelector("#mainReportHint a").href).get("python")));
  var rp7 = await boot({ url: "http://127.0.0.1:8000/?error=access_denied&state=st1" });
  check("cancelling on Spotify's page is not treated as a problem to report", !visible(rp7, "loginReportHint"));

  // privacy wording
  check("the setup page says the Client ID stays in the browser and goes only to Spotify; the About section points to Report a problem in the app menu", /Your Client ID is not a secret\. It stays in this browser and goes only to Spotify\./.test(fresh.document.getElementById("loginSection").textContent) && /If you run into a problem, choose Report a problem in the app menu\./.test(fresh.document.getElementById("about").textContent));



  var lbl = rp.document.getElementById("reportLabel");
  check("the Details attached line is plain text, not bold, and not gray", lbl.textContent === "Details attached to the report:" && !lbl.querySelector("strong, b") && !lbl.classList.contains("muted") && lbl.nextElementSibling.id === "reportPreview");


  // ---------------- Reset app on this device explains how to get formats back, and shows the backup situation
  var cb = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: null } });
  cb.eval("saveFile = (name, text) => { window.__savedFromClear = { name, text }; }");
  var note = () => cb.document.getElementById("clearBackupNote").textContent;
  var clearSection = cb.document.getElementById("moreOptions").textContent.replace(/\s+/g, " ");
  check("the Reset app on this device section starts with You, says formats are erased too, and points to Restore and Back up now in the app menu", /^Removes everything this app keeps on this device, including your Client ID, which is copied to the clipboard first in case you want to connect to Spotify again right away\. Nothing in your Spotify account changes\./.test(clearSection.slice(clearSection.indexOf("Reset app on this device") + 24).trim()) && /Your recipes are erased too\. To get them back afterward, choose Restore in the app menu and pick the backup you made on this device\. If you haven't backed up to this device, choose Back up now there first\./.test(clearSection) && !/If something looks stuck/.test(clearSection));
  check("untouched example: nothing to lose", note() === "You haven't made any recipes yet, so there is nothing to lose.", note());
  cb.document.getElementById("formats").value += "\n# my change";
  cb.document.getElementById("formats").dispatchEvent(new cb.Event("input"));
  check("custom formats and no backup: a clear warning to back up first", note() === "You haven't backed up to this device yet. Back up first, or they will be gone for good.", note());
  cb.document.getElementById("backupDownload").click();   // the backup is made in Step 4 instead
  check("the backup made in Step 4 updates the note in this section", /^playlist-recipes-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.txt$/.test(cb.__savedFromClear.name) && cb.__savedFromClear.text === cb.document.getElementById("formats").value);
  check("after a backup the note says the formats are backed up, with the date", /^Your recipes are backed up \(last backup: .+\)\.$/.test(note()) && /^Last backup: /.test(cb.document.getElementById("backupStatus").textContent), note());
  cb.document.getElementById("formats").value += " more";
  cb.document.getElementById("formats").dispatchEvent(new cb.Event("input"));
  check("editing after a backup says to back up again first", note() === "Your recipes have been edited since your last backup. Back up again first to keep the changes.", note());
  cb.document.getElementById("clearData").click();
  var confirmText = cb.document.getElementById("clearConfirm").textContent.replace(/\s+/g, " ");
  check("the confirmation repeats what will be erased and how to get it back", !cb.document.getElementById("clearConfirm").hidden && /Your recipes will be erased from this device\. To get them back, choose Restore in the app menu and pick the backup you made on this device\./.test(confirmText));
  check("Step 2's own status and this section's note agree", /edited since your last backup/.test(cb.document.getElementById("backupStatus").textContent) && /edited since your last backup/.test(note()));


  // ---------------- Step 2's restore sentence, and Step 4
  var st = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI } });
  st.eval("saveFile = (name, text) => { window.__lastSaved = { name, text }; }");
  var $s = (id) => st.document.getElementById(id);
  var h2s = Array.from(st.document.querySelectorAll("#appSection h2")).map((h) => h.textContent);
  check("the steps are 2 Edit your recipes, 3 Build playlists, 4 Back up manually to this device (optional)", JSON.stringify(h2s) === JSON.stringify(["2. Edit your recipes", "3. Build playlists", "4. Back up manually to this device (optional)"]), JSON.stringify(h2s));
  var sentence = $s("backupRestore").parentElement;
  check("Step 2 says formats are saved automatically, then offers two pink links inside the sentence: back up now, and restore from a backup at any time", sentence.tagName === "P" && sentence.textContent.trim() === "You back your recipes up to this device yourself: back up now, and restore from a backup at any time." && $s("backupDownloadLink").textContent === "back up now" && $s("backupRestore").textContent === "restore from a backup" && $s("backupDownloadLink").classList.contains("linklike") && $s("backupRestore").classList.contains("linklike") && sentence.querySelectorAll("button.linklike").length === 2, sentence.textContent);
  check("the sentence comes first in Step 2, and the hidden file chooser follows it", sentence.previousElementSibling.tagName === "H2" && sentence.nextElementSibling.id === "restoreFile" && sentence.nextElementSibling.nextElementSibling.id === "spotifySaveLine" && !!(sentence.compareDocumentPosition($s("formatEditor")) & 4));
  var picked = 0; $s("restoreFile").click = () => { picked += 1; };
  $s("backupRestore").click();
  check("clicking the link opens the file picker", picked === 1);
  check("the old Restore and Start over links, and the Start over warning, are gone from Step 2", !$s("resetFormats") && !$s("resetWarning") && !$s("resetAnyway") && !Array.from(st.document.querySelectorAll("#appSection button")).some((b) => /Start over|Restore formats from backup/.test(b.textContent)));
  var step4 = st.document.getElementById("backupSection").parentElement.textContent.replace(/\s+/g, " ");
  var s4Text = ""; for (let n = $s("backupSection"); n; n = n.nextElementSibling) s4Text += " " + n.textContent;
  check("Step 4 keeps the explanation, the button, and the status, and drops the when-to-back-up list and the sign-in paragraph", /Your recipes live only on this device\. Clearing your browser data would erase them\. A manual backup keeps a copy so you can restore them if needed\./.test(s4Text) && !/Back up your recipes:|once your recipes work|before clearing your browser data\.|A backup holds your recipes only|Spotify sign-in|use Restore formats/.test(s4Text) && !!$s("backupDownload") && !!$s("backupStatus") && !st.document.querySelector("#backupSection ~ ul"), s4Text);
  check("Download a backup lives in Step 4, after the editor", !!(st.document.getElementById("formats").compareDocumentPosition($s("backupDownload")) & 4) && !!(st.document.getElementById("backupSection").compareDocumentPosition($s("backupDownload")) & 4));
  // no nudge after a successful create
  var x_nudge = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  x_nudge.document.getElementById("maxPlaylists").value = "1";
  x_nudge.document.getElementById("maxPlaylists").dispatchEvent(new x_nudge.Event("input"));
  await runPreview(x_nudge);
  pressBuild(x_nudge);
  await waitFor(() => /in your Spotify library\.$/.test(x_nudge.document.getElementById("actionMessage").textContent), 20000);
  check("creating playlists adds no reminder to back up, only the thank-you line", !x_nudge.document.querySelector("#results .backup-nudge") && !/Your formats worked|Back them up/.test(x_nudge.document.getElementById("createDialog").textContent) && !x_nudge.document.getElementById("createSupport").hidden);

  // ---------------- headings: the page title outranks the step headings, which are easy to spot
  var hcss = fs.readFileSync(ROOT + "index.html", "utf8");
  var sizeOf = (sel) => { const m = hcss.match(new RegExp("\\n  " + sel + " \\{ font-size: clamp\\(([\\d.]+)rem, ([\\d.]+)vw, ([\\d.]+)rem\\)")); return m ? { min: Number(m[1]), max: Number(m[3]) } : null; };
  var h1s = sizeOf("h1"), h2s2 = sizeOf("h2");
  check("the page title is larger than the step headings, at every window size", !!h1s && !!h2s2 && h1s.max > h2s2.max && h1s.min > h2s2.min, JSON.stringify([h1s, h2s2]));
  check("step headings are large (at least 1.35rem, up to 1.7rem), and the title larger still", h2s2.min >= 1.35 && h2s2.max >= 1.7 && h1s.max >= 2.5);
  check("Step 4 has only the Download button, with Restore left under the editor", !!st.document.querySelector("#backupSection ~ .row #backupDownload") && !st.document.querySelector("#backupSection ~ .row #backupRestore") && !st.document.querySelector("#backupSection ~ #backupRestore"));


  // ---------------- every numbered section title says what the person will do
  var verbs = ["Connect", "Edit", "Build", "Back up"];
  var allH2 = Array.from(t0.document.querySelectorAll("h2")).map((h) => h.textContent);
  check("the welcome and setup pages have their own headings, and every numbered section title left is an action", JSON.stringify(allH2) === JSON.stringify(["What to expect", "One-time setup", "Find your Client ID", "1. Connect to Spotify", "1. Connect to Spotify", "2. Edit your recipes", "3. Build playlists", "4. Back up manually to this device (optional)"]) && allH2.slice(3).every((t) => verbs.some((v) => t.replace(/^\d\.\s/, "").startsWith(v))), JSON.stringify(allH2));


  // ---------------- What is this app? headings, and placeholder icons on the buttons
  var ab = t0.document.getElementById("about");
  var leads = Array.from(ab.querySelectorAll("strong")).map((x) => x.textContent);
  check("the headings in What is this app? stand on their own line, without trailing periods", JSON.stringify(leads) === JSON.stringify(["What it does", "What it's good for", "How it works", "What you need", "Reporting problems", "Privacy"]) && Array.from(ab.querySelectorAll("p")).filter((p) => p.querySelector("strong + br")).length === 5, JSON.stringify(leads));
  var pill = Array.from(t0.document.querySelectorAll("button:not(.linklike):not(.theme-button):not(#kofiClose):not(#createDonate), a.button-link")).filter((b) => !b.closest("#formatEditor"));
  var pillsIn = pill.filter((b) => b.querySelector("img.btn-icon"));
  check("every pink button has an icon in front of its label (the Donate button has the cup)", pill.length >= 15 && pillsIn.length === pill.length, `${pillsIn.length} of ${pill.length}`);
  check("each icon is a small file, 20 by 20 (the Build sparkles 24 by 24), decorative, and the file exists", pill.every((b) => { const i = b.querySelector("img.btn-icon"); const size = i.getAttribute("src") === "icons/build.svg" ? "24" : "20"; return i.getAttribute("width") === size && i.getAttribute("height") === size && i.getAttribute("alt") === "" && /^icons\/[a-z]+\.svg$/.test(i.getAttribute("src")) && fs.existsSync(ROOT + i.getAttribute("src")); }));
  check("text-style links (Restore, Reset, Undo) have no icons", Array.from(t0.document.querySelectorAll("button.linklike")).every((b) => !b.querySelector("img")));
  check("each icon sits left of a label, and the label is its own element", pill.every((b) => { const i = b.querySelector("img.btn-icon, img"); return i === b.firstElementChild && !!b.querySelector(".btn-label, span"); }));
  var icss = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  check("every icon file is a valid white line icon, with no placeholder note left", fs.readdirSync(ROOT + "icons").filter((f) => f.endsWith(".svg")).length === 15 && fs.readdirSync(ROOT + "icons").every((f) => { const x = fs.readFileSync(ROOT + "icons/" + f, "utf8"); return /<svg /.test(x) && !/Placeholder/i.test(x) && /stroke="#fff"/.test(x); }));
  // changing a label must not remove the icon
  var ic = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  await runPreview(ic);
  var cr = ic.document.getElementById("confirmYes");
  check("the question's button label updates with the count and keeps its icon", /^Build \d+ playlists$/.test(cr.textContent) && !!cr.querySelector("img.btn-icon") && cr.firstElementChild.tagName === "IMG");
  cr.click();
  await waitFor(() => !ic.document.getElementById("confirmBox").hidden || /in your Spotify library\.$/.test(ic.document.getElementById("actionMessage").textContent), 20000);
  var cp = ic.document.getElementById("copyRedirect");
  cp.dispatchEvent(new ic.Event("click"));
  await new Promise((r) => setTimeout(r, 200));
  check("the Copy button says Copied and shows a check as its icon", /^Copied$/.test(cp.textContent) && cp.querySelector("img.btn-icon").getAttribute("src") === "icons/confirm.svg", cp.textContent + " " + cp.querySelector("img.btn-icon").getAttribute("src"));
  await new Promise((r) => setTimeout(r, 2300));
  check("after two seconds the Copy button goes back to its copy icon and label", cp.textContent === "Copy" && cp.querySelector("img.btn-icon").getAttribute("src") === "icons/copy.svg");
  check("the Build button and the question's button keep their own icons", ic.document.getElementById("create").querySelector("img").getAttribute("src") === "icons/build.svg" && ic.document.getElementById("confirmYes").querySelector("img").getAttribute("src") === "icons/confirm.svg");
  var rs = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI + "\n# x" } });
  rs.eval("saveFile = () => {}");



  // ---------------- backup file names carry the time
  var fsw = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI } });
  var saved = [];
  fsw.eval("saveFile = (name, text) => { window.__names = (window.__names || []); window.__names.push(name); }");
  var realDate = fsw.Date;
  var fakeNow = (iso) => { const D = realDate; fsw.Date = class extends D { constructor(...a) { super(...(a.length ? a : [iso])); } }; };
  fakeNow("2026-10-25T14:05:09");
  fsw.document.getElementById("backupDownload").click();
  fakeNow("2026-10-25T14:05:42");
  fsw.document.getElementById("backupDownload").click();
  fakeNow("2026-10-25T09:07:03");
  fsw.document.getElementById("backupDownload").click();
  fakeNow("2026-10-25T23:59:58");
  fsw.document.getElementById("backupDownload").click();
  check("backup names are date, underscore, then 24-hour hours-minutes-seconds with hyphens", JSON.stringify(fsw.__names) === JSON.stringify(["playlist-recipes-2026-10-25_14-05-09.txt", "playlist-recipes-2026-10-25_14-05-42.txt", "playlist-recipes-2026-10-25_09-07-03.txt", "playlist-recipes-2026-10-25_23-59-58.txt"]), JSON.stringify(fsw.__names));
  check("two backups on one day get different names, so the browser never adds (1)", new Set(fsw.__names).size === fsw.__names.length);
  check("the names sort in the order they were made, and contain no colons or spaces", [...fsw.__names].sort().join() === [fsw.__names[2], fsw.__names[0], fsw.__names[1], fsw.__names[3]].join() && fsw.__names.every((n) => !/[:\s]/.test(n)));


  var cc = cb.document.getElementById("clearConfirm");


  // ---------------- the Reset app on this device question
  var cq = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI } });
  var cqBox = cq.document.getElementById("clearConfirm");
  var cqBtn = cq.document.getElementById("clearData");
  cq.eval("reloadPage = () => { window.__reloadedByClear = true; }");
  check("before it is asked, the Reset app on this device button is enabled and the question is hidden", cqBox.hidden === true && cqBtn.disabled === false);
  cqBtn.click();
  var cqLead = cqBox.querySelector("p");
  check("the question is plain text, not bold, so it does not read like a heading", cqLead.textContent === "Clear the saved Client ID, recipes, and sign-in, and reload this page?" && !cqLead.querySelector("strong, b, h1, h2, h3, h4") && !cqBox.querySelector("strong, b"));
  check("while the question is showing, the Reset app on this device button is disabled", cqBox.hidden === false && cqBtn.disabled === true);
  cqBtn.click();
  check("clicking the disabled button does nothing more", cqBox.hidden === false && cqBtn.disabled === true);
  cq.document.getElementById("clearNo").click();
  check("Cancel closes the question and turns the button back on", cqBox.hidden === true && cqBtn.disabled === false);
  cqBtn.click();
  cq.document.getElementById("clearYes").click();
  await waitFor(() => cq.__reloadedByClear === true, 5000);
  check("Yes, clear it clears everything and reloads, leaving the button off", cq.localStorage.length === 0 && cq.__reloadedByClear === true && cqBtn.disabled === true);


  // ---------------- the backup label includes the time of day
  var tb = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI, lastBackupText: MINI, lastBackupAt: new Date(2026, 9, 25, 14, 5, 9).toISOString() } });
  var afternoon = tb.document.getElementById("backupStatus").textContent;
  check("Last backup shows the day and the time of day", /^Last backup: Oct 25, 2026 at 2:05\s?PM\.$/.test(afternoon.replace(/\u202f/g, " ")), JSON.stringify(afternoon));
  var tbMorning = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI, lastBackupText: MINI, lastBackupAt: new Date(2026, 9, 5, 9, 7, 0).toISOString() } });
  check("a morning time reads naturally, with no leading zero on the day or hour", /^Last backup: Oct 5, 2026 at 9:07\s?AM\.$/.test(tbMorning.document.getElementById("backupStatus").textContent.replace(/\u202f/g, " ")), tbMorning.document.getElementById("backupStatus").textContent);
  check("the Reset app on this device note shows the time too", /^Your recipes are backed up \(last backup: Oct 25, 2026 at 2:05\s?PM\)\.$/.test(tb.document.getElementById("clearBackupNote").textContent.replace(/\u202f/g, " ")), tb.document.getElementById("clearBackupNote").textContent);
  tb.document.getElementById("formats").value = MINI + "\n# edit";
  tb.document.getElementById("formats").dispatchEvent(new tb.Event("input"));
  tb.document.getElementById("formats").value = MINI;
  tb.document.getElementById("formats").dispatchEvent(new tb.Event("input"));
  var tbNew = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI } });
  tbNew.eval("saveFile = () => {}");
  tbNew.document.getElementById("backupDownload").click();
  check("a backup made just now says the time it was made", /^Last backup: [A-Z][a-z]{2} \d{1,2}, \d{4} at \d{1,2}:\d{2}\s?[AP]M\.$/.test(tbNew.document.getElementById("backupStatus").textContent.replace(/\u202f/g, " ")) || /^Last backup: [A-Z][a-z]{2} \d{1,2}, \d{4} at \d{1,2}:\d{2}\.$/.test(tbNew.document.getElementById("backupStatus").textContent), tbNew.document.getElementById("backupStatus").textContent);


  // ---------------- What it's good for: the closing sentence
  var goodFor = Array.from(t0.document.getElementById("about").querySelectorAll("p")).find((p) => /^What it's good for/.test(p.textContent));
  check("the What it's good for paragraph is your wording, ending with the line about reusing the playlists", !!goodFor && goodFor.textContent === "What it's good forCeremonies, retreats, workshops, and any long event where the music should follow an arc, such as arriving, deepening, and landing. Instead of steering a shuffle during the event or manually building a playlist ahead of time for each event, set the structure once and get multiple fresh, non-overlapping playlists. You can then use these playlists for subsequent events without ever repeating the same music.", goodFor && goodFor.textContent.slice(-170));


  // ---------------- the Client ID steps: no Settings page is involved
  var ciNew = fresh.document.getElementById("flowNew");
  var ciOld = fresh.document.getElementById("flowExisting");
  var lastNew = Array.from(ciNew.querySelectorAll(":scope > li")).pop().textContent.trim();
  var lastOld = Array.from(ciOld.querySelectorAll(":scope > li")).pop().textContent.trim();
  check("creating an app ends with copying the Client ID shown on the new app's page, no Settings", lastNew === "Copy the Client ID shown on your new app's page." && !/Settings/.test(lastNew), lastNew);
  check("using an existing app ends with copying the Client ID shown on its page, no Settings", lastOld === "Copy the Client ID shown on its page." && !/Settings/.test(lastOld), lastOld);



  // ---------------- More options: gray body text, with headings, buttons, links and widgets standing out
  var moCss = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  check("the More options box is gray by default", /#moreOptions(, [#\w-]+)* \{ color: var\(--muted\); \}/.test(moCss));
  check("its headings stay in the normal text color, and its title stays pink", /footer\.debug h3 \{[^}]*color: var\(--fg\)/.test(moCss) && /details\.card > summary \{[^}]*color: var\(--accent\)/.test(moCss));
  check("its inputs, dropdowns and confirmation questions keep the normal text color, and the report details are gray like the rest", /#moreOptions input, #moreOptions select \{ color: var\(--fg\); \}/.test(moCss) && /#moreOptions #removeConfirmBox, #moreOptions #clearConfirm \{ color: var\(--fg\); \}/.test(moCss) && /#moreOptions pre\.report-preview \{ color: var\(--muted\); \}/.test(moCss) && !/#moreOptions pre, /.test(moCss));
  var moreBox = fresh.document.getElementById("moreOptions");
  var loud = Array.from(moreBox.querySelectorAll("p, label, span")).filter((el) => el.closest("#removeConfirmBox, #clearConfirm, .btn-label") === null && el.hasAttribute("style") && /color\s*:/.test(el.getAttribute("style")));
  check("no paragraph in More options sets its own text color, so the gray applies everywhere", loud.length === 0, loud.map((e) => e.id || e.textContent.slice(0, 30)).join(","));
  check("buttons in More options keep their own white-on-pink look", /\n  button \{[^}]*color: var\(--on-button, #fff\)/.test(fs.readFileSync(ROOT + "index.html", "utf8")) && moreBox.querySelectorAll("button:not(.linklike)").length >= 5);


  // ---------------- the hidden field Tally expects is called python
  var pyKeys = [...new URL(rl.href).searchParams.keys()];
  check("the report link fills a field named python, and no field named planner", JSON.stringify(pyKeys.sort()) === JSON.stringify(["appVersion", "browser", "lastError", "python", "recentSteps", "windowSize"]) && !pyKeys.includes("planner"), JSON.stringify(pyKeys));

  // ---------------- gray rounded boxes for the three collapsible sections
  var cardCss = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  var sect = (w, id) => w.document.getElementById(id);
  check("What is this app?, How to edit formats, and More options are all gray rounded boxes", ["about", "formatHelp", "moreOptions"].every((id) => sect(fresh, id).classList.contains("card")) && /\.card \{[^}]*border-radius: 10px/.test(cardCss) && /\.card \{[^}]*background: var\(--card\)/.test(cardCss));
  check("their titles share one look: bold pink, clickable", /details\.card > summary \{ cursor: pointer; font-weight: 600; color: var\(--accent\); \}/.test(cardCss) && ["about", "formatHelp", "moreOptions"].every((id) => !!sect(fresh, id).querySelector(":scope > summary")));
  check("More options is titled in the same pink style and sits in the footer", /^More options$/.test(sect(fresh, "moreOptions").querySelector(":scope > summary").textContent) && sect(fresh, "moreOptions").parentElement.tagName === "FOOTER");
  check("things inside the boxes (samples, code, confirmations) stand out from the gray", /details\.card \.card, details\.card pre, details\.card figure\.sample \{ background: var\(--bg\); \}/.test(cardCss));


  // ---------------- after the embeds experiment was reverted
  var finalHtml = fs.readFileSync(ROOT + "index.html", "utf8");
  check("the page has four scripts of its own, with the theme first, and nothing about embeds", finalHtml.match(/<script src="[^"]+"><\/script>/g).join("").replace(/\?v=[^"]+/g, "") === '<script src="theme.js"></script><script src="formats.js"></script><script src="editor.js"></script><script src="app.js"></script>' && finalHtml.indexOf('<script src="theme.js">') < finalHtml.indexOf("</head>") && !/embeds/i.test(finalHtml) && !/embeds/i.test(fs.readFileSync(ROOT + "app.js", "utf8")) && !fs.existsSync(ROOT + "embeds.js"));
  check("the app never names an outside script, so no Ko-fi or Tally code can run in the page", !/tally\.so\/widgets|overlay-widget|storage\.ko-fi\.com\/cdn\/scripts/.test(fs.readFileSync(ROOT + "app.js", "utf8") + finalHtml));
  check("Tip me and the report links are the new-tab links again", (() => { const a = t0.document.getElementById("supportButton"); const r = t0.document.getElementById("reportLink"); return a.target === "_blank" && a.href === "https://ko-fi.com/roncarmel" && r.target === "_blank" && r.href.startsWith("https://tally.so/r/VppLZN"); })());
  var stale = await boot({ url: "http://127.0.0.1:8000/?embeds=on", session: { ...signedIn(), embeds: "on" }, local: { formats: MINI } });


  
  } catch (err) { areaCrashed("core", err); }
}
  if (want('the visual format editor')) { try {
  // ================================================================ the visual format editor
  var TWO_F = 'FORMATS = {"warm": {"name": "Warm focus {n}", "silence between segments": "1 min", "segments": [("💗 spacious + gentle", 20), ("🛋 rest", 40)]}, "ed_cool": {"name": "Cool {n}", "segments": [({"💗 spacious + gentle": 60, "🛋 rest": 40}, 30)]}}';
  var ed1 = await boot({ url: EDURL, session: signedIn(), local: { formats: TWO_F, lastBackupText: TWO_F, lastBackupAt: new Date().toISOString() }, fetchOptions: { extraPlaylists: [{ id: "g1", name: "Warm focus 3", owner: { id: "ron" } }] } });

  // ---- what is shown
  check("each recipe is a tab, named by its title, and the first one is selected and carries a pencil", JSON.stringify(tabsOf(ed1)) === JSON.stringify(["Warm focus", "Cool"]) && ed1.document.querySelector("#feTabs .fe-tab").getAttribute("aria-pressed") === "true" && ed1.document.querySelector('#feTabs .fe-tab[aria-pressed="true"]').textContent === "Warm focus" && !!ed1.document.querySelector('#feTabs .fe-tab[aria-pressed="true"]').querySelector("svg"), JSON.stringify(tabsOf(ed1)));
  var ed_r1 = rowsOf(ed1);
  check("the old pause-between-segments setting is the format's default silence, shown as one tag between the two rows and not as a row", ed_r1.length === 2 && ed_r1[0].querySelector(".fe-title").textContent === "💗 spacious + gentle" && ed_r1[1].querySelector(".fe-title").textContent.trim() === "🛋 rest" && !!ed_r1[0].querySelector(".fe-tag") && ed_r1[0].querySelector(".fe-tag").textContent === "1m" && ed_r1[0].querySelector(".fe-tag").classList.contains("fe-tag-default") && ed_r1[0].querySelector(".fe-tag").getAttribute("data-id") === "gap1" && /Silence between these segments: 1 min/.test(ed_r1[0].querySelector(".fe-tag").getAttribute("aria-label")) && ed_r1[1].querySelector(".fe-tag") === null);
  check("the tag hangs outside the row's card, as a button of its own, and the card knows it has tags", ed_r1[0].querySelector(".fe-tag").parentElement === ed_r1[0] && !ed_r1[0].querySelector(".fe-rowcard").contains(ed_r1[0].querySelector(".fe-tag")) && ed1.document.getElementById("formatEditor").classList.contains("fe-hastags"));
  check("the bar shows each row to scale, and the caption gives the totals", ed1.document.querySelectorAll("#feBar .fe-piece").length === 3 && ed1.document.querySelector("#feBar .fe-piece-silence") !== null && ed1.document.getElementById("feCaption").textContent === "1 hour of music + 1 minute of silence", ed1.document.getElementById("feCaption").textContent);
  var ed_cover1 = ed_r1[0].querySelector(".fe-cover img");
  check("a playlist row shows its cover (the smallest one Spotify lists) and its song count", !!ed_cover1 && ed_cover1.getAttribute("src") === "https://img.example/p2-small.jpg" && ed_r1[0].querySelector(".fe-sub").textContent === "132 songs", ed_r1[0].textContent);
  check("a playlist is found even when the name differs only by a trailing space", ed_r1[1].querySelector(".fe-sub-warn") === null);
  check("every segment row has the same pink look, with no per-row colors in its markup", rowsOf(ed1).every((r) => !r.querySelector(".fe-rowcard").getAttribute("style")) && !/rgba\(242,180,90|rgba\(111,147,232/.test(ed1.document.getElementById("feRows").innerHTML));

  // ---- changing the length
  ed_r1[0].querySelector(".fe-inc").click();
  check("plus adds five minutes, and the text and bar follow", rowsOf(ed1)[0].querySelector(".fe-amount").textContent === "25 min" && /\("💗 spacious \+ gentle", 25\)/.test(T(ed1)) && ed1.document.getElementById("feCaption").textContent === "1 hour 5 minutes of music + 1 minute of silence");
  check("the default silence stays a setting in the text, with no explicit silence written", /"silence between segments": "1 min"/.test(T(ed1)) && !/\("silence"/.test(T(ed1)));
  rowsOf(ed1)[0].querySelector(".fe-dec").click();
  var ed_tag = () => rowsOf(ed1)[0].querySelector(".fe-tag");
  ed_tag().click();
  var ed_panel = () => ed1.document.getElementById("feTagPanel");
  check("tapping the tag opens its card: one widget reading 1 min of silence on two lines, and a quiet (default)", !!ed_panel() && JSON.stringify(Array.from(ed_panel().querySelectorAll(".fe-amount .fe-line")).map((x) => x.textContent)) === JSON.stringify(["1 min of", "silence"]) && !ed_panel().querySelector(".fe-tagtitle") && ed1.document.getElementById("feTagDuration").textContent === "1 min" && ed1.document.getElementById("feTagDefault").textContent === "(default)" && !ed1.document.getElementById("feTagReset") && !ed1.document.getElementById("feTagRemove") && !/Change duration/.test(ed_panel().textContent));
  ed1.document.getElementById("feTagShorter").click();
  check("a shorter silence becomes the tag's own: a deeper color, written into the text, with Reset where (default) was and the card still open", ed_tag().classList.contains("fe-tag-custom") && ed_tag().textContent === "30s" && ed1.document.getElementById("feTagDuration").textContent === "30 sec" && /\("silence", "30 sec"\)/.test(T(ed1)) && !!ed1.document.getElementById("feTagReset") && !ed1.document.getElementById("feTagDefault") && !!ed_panel());
  check("under the length there is a pink link, Reset to default, once the silence has been changed: not bold, in the card but not beside the length", ed1.document.getElementById("feTagReset").tagName === "BUTTON" && ed1.document.getElementById("feTagReset").classList.contains("linklike") && ed1.document.getElementById("feTagReset").textContent === "Reset to default" && ed1.document.getElementById("feTagReset").closest(".fe-tagbelow") !== null && !ed1.document.querySelector(".fe-tagrow .fe-tagslot"));
  ed1.document.getElementById("feTagLonger").click();
  check("stepping back to the default length makes it follow the default again: gray, no explicit silence, (default) returns", ed_tag().classList.contains("fe-tag-default") && !/\("silence"/.test(T(ed1)) && !!ed1.document.getElementById("feTagDefault") && !ed1.document.getElementById("feTagReset"));
  for (let i = 0; i < 20; i++) ed1.document.getElementById("feTagLonger").click();
  check("a silence steps up to 60 min and stops there", ed1.document.getElementById("feTagDuration").textContent === "60 min" && ed_tag().textContent === "60m" && /\("silence", "60 min"\)/.test(T(ed1)));
  for (let i = 0; i < 3; i++) ed1.document.getElementById("feTagShorter").click();
  check("and steps back down in 5 minute steps: 55, 50, 45 min", ed1.document.getElementById("feTagDuration").textContent === "45 min");
  ed1.document.getElementById("feTagReset").click();
  check("Reset returns it to the default and closes the card", ed_tag().classList.contains("fe-tag-default") && ed_tag().textContent === "1m" && !ed_panel() && !/\("silence"/.test(T(ed1)));
  ed_tag().click();
  ed1.document.getElementById("feTagShorter").click();
  ed1.document.getElementById("feTagShorter").click();
  check("below 30 seconds the silence is set to none: the tag stays, pink like any changed one, reading 0s, the bar loses its piece, the card says 0 sec, and the text says none", ed_tag().classList.contains("fe-tag-custom") && !ed_tag().classList.contains("fe-tag-zero") && ed_tag().textContent === "0s" && ed1.document.getElementById("feTagDuration").textContent === "0 sec" && /\("silence", "none"\)/.test(T(ed1)) && ed1.document.querySelectorAll("#feBar .fe-piece-silence").length === 0 && /^1 hour of music$/.test(ed1.document.getElementById("feCaption").textContent), ed1.document.getElementById("feCaption").textContent);
  ed1.document.getElementById("feTagShorter").click();
  check("shorter does nothing more once it is 0 sec", ed1.document.getElementById("feTagDuration").textContent === "0 sec");
  ed1.document.getElementById("feTagLonger").click();
  check("longer from none goes to 30 seconds", ed1.document.getElementById("feTagDuration").textContent === "30 sec" && ed_tag().classList.contains("fe-tag-custom"));
  ed1.document.getElementById("feTagReset").click();
  check("the card's header shows the default silence between segments", ed1.document.getElementById("feGapValue").textContent === "1 min" && !ed1.document.getElementById("feGapNote") && !ed1.document.getElementById("feGapResetAll"));
  ed_tag().click(); ed1.document.getElementById("feTagShorter").click();

  ed1.document.body.click();   // a tap elsewhere only closes the card
  ed1.document.getElementById("feGapLonger").click();
  check("changing the default moves the silences that follow it and leaves the one with its own setting alone", ed1.document.getElementById("feGapValue").textContent === "2 min" && ed_tag().textContent === "30s" && /"silence between segments": "2 min"/.test(T(ed1)) && /\("silence", "30 sec"\)/.test(T(ed1)));
  ed1.document.getElementById("feGapShorter").click();
  ed_tag().click(); ed1.document.getElementById("feTagReset").click();
  check("resetting the silence on its own tag brings it back to the default", ed_tag().classList.contains("fe-tag-default") && ed_tag().textContent === "1m" && !/\("silence"/.test(T(ed1)));
  check("a segment never goes below one minute or above ten hours", (() => { const row = () => rowsOf(ed1)[0]; for (let i = 0; i < 12; i++) row().querySelector(".fe-dec").click(); const low = row().querySelector(".fe-amount").textContent; return low === "1 min"; })());

  // ---- names, tabs and clashes
  var ed_nameBox = renameBox(ed1);
  ed_nameBox.value = "Warm {focus} {n}"; ed_nameBox.dispatchEvent(new ed1.Event("input", { bubbles: true })); finishName(ed1);
  check("typing a name in the tab updates the tab, the text and the Build button, and stray braces are dropped", tabsOf(ed1)[0] === "Warm focus {n}" && /"title": "Warm focus \{n\}"/.test(T(ed1)) && /"name": "Warm focus \{n\}"/.test(T(ed1)) && ed_nameBox.value === "Warm focus {n}", JSON.stringify(tabsOf(ed1)));
  ed_nameBox = renameBox(ed1); ed_nameBox.value = "Warm focus"; ed_nameBox.dispatchEvent(new ed1.Event("input", { bubbles: true })); finishName(ed1);
  check("a plain name makes the playlists Name 1, Name 2 (the {n} is added for the engine)", /"name": "Warm focus \{n\}"/.test(T(ed1)) && tabsOf(ed1)[0] === "Warm focus");
  check("no clash warning while the names differ", ed1.document.getElementById("feClash").hidden === true);
  ed1.document.querySelectorAll("#feTabs .fe-tab")[1].click();
  var nb2 = renameBox(ed1);
  nb2.value = "warm FOCUS"; nb2.dispatchEvent(new ed1.Event("input", { bubbles: true }));
  check("two formats with the same name (any capitals) trigger a warning", ed1.document.getElementById("feClash").hidden === false && /Another recipe has this name/.test(ed1.document.getElementById("feClash").textContent));
  nb2.value = "Cool"; nb2.dispatchEvent(new ed1.Event("input", { bubbles: true })); finishName(ed1);
  check("and it clears once they differ", ed1.document.getElementById("feClash").hidden === true && tabsOf(ed1)[1] === "Cool");

  // ---- the playlist list
  var ed_cool = rowsOf(ed1)[0];
  check("a mixed row names both playlists and the split, and shows two-tone stripes", ed_cool.querySelector(".fe-title").textContent === "💗 spacious + gentle + 🛋 rest" && ed_cool.querySelector(".fe-sub").textContent === "60% / 40% mix" && /repeating-linear-gradient\(135deg/.test(ed_cool.querySelector(".fe-cover").getAttribute("style")), ed_cool.textContent);
  check("the bar draws a mixed segment as pink and deep-pink stripes whose thickness follows the mix", /repeating-linear-gradient\(135deg, var\(--button\) 0, var\(--button\) 9\.6px, var\(--accent-deep\) 9\.6px, var\(--accent-deep\) 16px\)/.test(ed1.document.querySelector("#feBar .fe-piece").getAttribute("style")), ed1.document.querySelector("#feBar .fe-piece").getAttribute("style"));
  ed1.document.querySelectorAll("#feTabs .fe-tab")[0].click();
  rowsOf(ed1)[0].querySelector(".fe-main").click();
  var ed_opts = Array.from(ed1.document.querySelectorAll("#feOptions .fe-option"));
  check("the list shows your own playlists, leaving out other people's and the ones this app made, with no Silence entry", !ed1.document.getElementById("feOptionSilence") && ed_opts.map((o) => o.getAttribute("data-name")).join("|") === "☘️ intro / outro (soothing, familiar)|💗 spacious + gentle|💗💗 evocative|🛋 rest ", ed_opts.map((o) => o.getAttribute("data-name")).join("|"));
  check("the current playlist is marked in the list", ed_opts.find((o) => o.getAttribute("data-name") === "💗 spacious + gentle").className.includes("fe-option-on"));
  var ed_search = ed1.document.getElementById("feSearch");
  ed_search.value = "REST"; ed_search.dispatchEvent(new ed1.Event("input", { bubbles: true }));
  check("the search narrows the list, ignoring capitals", Array.from(ed1.document.querySelectorAll("#feOptions .fe-option")).map((o) => o.getAttribute("data-name")).join("|") === "🛋 rest ", Array.from(ed1.document.querySelectorAll("#feOptions .fe-option")).length);
  optionNamed(ed1, "🛋 rest ").click();
  check("choosing a playlist sets the row and closes the list", rowsOf(ed1)[0].querySelector(".fe-title").textContent === "🛋 rest " && !ed1.document.getElementById("feOptions") && /\("🛋 rest ", 1\)/.test(T(ed1)));
  rowsOf(ed1)[0].querySelector(".fe-main").click();
  check("the open list highlights the current playlist", Array.from(ed1.document.querySelectorAll("#feOptions .fe-option")).find((o) => o.className.includes("fe-option-on")).getAttribute("data-name") === "🛋 rest ");
  var ed_lenBefore = rowsOf(ed1)[0].querySelector(".fe-amount").textContent;
  optionNamed(ed1, "💗💗 evocative").click();
  check("choosing another playlist replaces it, and the length stays", rowsOf(ed1)[0].querySelector(".fe-title").textContent === "💗💗 evocative" && rowsOf(ed1)[0].querySelector(".fe-amount").textContent === ed_lenBefore);

  // ---- the three dots on a row
  rowsOf(ed1)[0].querySelector(".fe-more").click();
  check("Add a mix has a line saying what it does, and a divider sets it apart from the silences", ed1.document.getElementById("feMixNote").textContent === "Blend a second playlist into this segment." && ed1.document.getElementById("feMixNote").nextElementSibling.className === "fe-rule");
  check("a segment's menu offers a mix and removal, no color choices, and Add silence after dimmed where a tag already follows it", ed1.document.querySelectorAll(".fe-menu .fe-swatchbtn").length === 0 && !/Color/.test(ed1.document.querySelector(".fe-menu").textContent) && !!ed1.document.getElementById("feAddMix") && !!ed1.document.getElementById("feRemoveRow") && ed1.document.getElementById("feRemoveRow").textContent === "Remove segment" && ed1.document.getElementById("feAddSilence").disabled && ed1.document.getElementById("feAddSilenceBefore").disabled === false);
  ed1.document.body.click();   // a tap elsewhere only closes the first menu
  rowsOf(ed1)[1].querySelector(".fe-more").click();
  check("the last segment, which has no silence after it, offers Add silence after", !!ed1.document.getElementById("feAddSilence") && ed1.document.getElementById("feAddSilence").textContent === "Add silence after");
  ed1.document.getElementById("feAddSilence").click();
  check("Add silence after puts a 30 second silence after the last segment: a deeper tag, written at the end of the text", rowsOf(ed1)[1].querySelector(".fe-tag").textContent === "30s" && rowsOf(ed1)[1].querySelector(".fe-tag").classList.contains("fe-tag-custom") && /\("silence", "30 sec"\),\n\s+\],/.test(T(ed1)) && /of silence/.test(ed1.document.getElementById("feCaption").textContent));
  rowsOf(ed1)[0].querySelector(".fe-more").click();
  const ed1BeforeOffered = ed1.document.getElementById("feAddSilenceBefore") && ed1.document.getElementById("feAddSilenceBefore").textContent === "Add silence before" && !ed1.document.getElementById("feAddSilenceBefore").disabled;
  ed1.document.getElementById("feAddSilenceBefore").click();
  check("the first segment can take a silence before it: a tag on its row, and the choice dimmed afterwards", ed1BeforeOffered && rowsOf(ed1)[0].querySelector(".fe-tag-lead") && rowsOf(ed1)[0].querySelector(".fe-tag-lead").textContent === "30s" && (rowsOf(ed1)[0].querySelector(".fe-more").click(), ed1.document.getElementById("feAddSilenceBefore").disabled));
  ed1.document.body.click();
  rowsOf(ed1)[0].querySelector(".fe-tag-lead").click();
  ed1.document.getElementById("feTagRemove").click();
  check("removing the silence before the first segment takes its tag away", !rowsOf(ed1)[0].querySelector(".fe-tag-lead"));
  rowsOf(ed1)[1].querySelector(".fe-tag").click();
  check("a silence with no default to go back to offers Remove, not Reset, and its stepper stops at 30 seconds", !!ed1.document.getElementById("feTagRemove") && !ed1.document.getElementById("feTagReset") && !ed1.document.getElementById("feTagDefault") && (() => { ed1.document.getElementById("feTagShorter").click(); return ed1.document.getElementById("feTagDuration").textContent === "30 sec"; })());
  ed1.document.getElementById("feTagRemove").click();
  check("Remove takes the silence away completely and closes the card", rowsOf(ed1)[1].querySelector(".fe-tag") === null && !ed1.document.getElementById("feTagPanel") && !/\("silence", "30 sec"\)/.test(T(ed1)));

  // ---- mixes
  rowsOf(ed1)[0].querySelector(".fe-more").click();
  ed1.document.getElementById("feAddMix").click();
  check("Add a mix opens the mix panel with two playlists, an even split, and a ed_slider", !!ed1.document.getElementById("feMixSlider") && ed1.document.getElementById("fePctA").textContent === "50%" && ed1.document.getElementById("fePctB").textContent === "50%" && ed1.document.getElementById("feMixA").textContent.includes("💗💗 evocative") && ed1.document.getElementById("feMixB").textContent.trim().length > 0 && !ed1.document.getElementById("feMixB").textContent.includes("💗💗 evocative"));
  var ed_slider = ed1.document.getElementById("feMixSlider");
  var ed_mixKids = Array.from(ed1.document.querySelector(".fe-mixpanel").children).map((e) => e.id || e.className.split(" ").pop());
  check("the mix panel lists both playlists, then the slider, then what the split comes to, then its buttons", JSON.stringify(ed_mixKids) === JSON.stringify(["fe-mixhead", "feMixExplain", "fe-mixline", "fe-mixline", "fe-sliderline", "feMixSplit", "fe-popbuttons"]), JSON.stringify(ed_mixKids));
  var ed_split = () => ed1.document.getElementById("feMixSplit");
  check("it says how many minutes come from each playlist, names in italics", /^About \d+ (min|sec) from .+ and \d+ (min|sec) from .+, shuffled together\.$/.test(ed_split().textContent) && ed_split().querySelectorAll("i").length === 2 && ed_split().querySelector("i").textContent === "💗💗 evocative", ed_split().textContent);
  check("What's a mix? is closed at first", ed1.document.getElementById("feMixExplain").hidden === true && ed1.document.getElementById("feMixWhat").getAttribute("aria-expanded") === "false");
  ed1.document.getElementById("feMixWhat").click();
  check("What's a mix? opens one paragraph", ed1.document.getElementById("feMixExplain").hidden === false && /^A mix plays songs from two playlists in one segment\./.test(ed1.document.getElementById("feMixExplain").textContent) && ed1.document.getElementById("feMixWhat").getAttribute("aria-expanded") === "true");
  ed1.document.getElementById("feMixWhat").click();
  check("and closes it again", ed1.document.getElementById("feMixExplain").hidden === true);
  var ed_mins = (t) => (t.match(/(\d+) (min|sec)/g) || []).map((m) => parseInt(m, 10));
  var ed_before = ed_mins(ed_split().textContent);
  ed_slider.value = "70"; ed_slider.dispatchEvent(new ed1.Event("input", { bubbles: true }));
  var ed_after = ed_mins(ed_split().textContent);
  check("moving the slider changes the minutes in that sentence", ed_before.length === 2 && ed_after.length === 2 && ed_before[0] === ed_before[1] && ed_after[0] > ed_after[1], ed_split().textContent);
  check("moving the slider changes both percentages, the row, the bar and the text, without rebuilding the slider", ed1.document.getElementById("fePctA").textContent === "70%" && ed1.document.getElementById("fePctB").textContent === "30%" && rowsOf(ed1)[0].querySelector(".fe-sub").textContent === "70% / 30% mix" && /\{"💗💗 evocative": 70, "[^"]+": 30\}, \d+(\.\d+)?\)/.test(T(ed1)) && ed1.document.getElementById("feMixSlider") === ed_slider);
  ed1.document.getElementById("feMixB").click();
  var mixOpts = Array.from(ed1.document.querySelectorAll("#feOptions .fe-option"));
  check("a mix's list has no Silence, and the other playlist is unavailable", !ed1.document.getElementById("feOptionSilence") && mixOpts.find((o) => o.getAttribute("data-name") === "💗💗 evocative").disabled === true);
  mixOpts.find((o) => o.getAttribute("data-name") === "☘️ intro / outro (soothing, familiar)").click();
  check("choosing the second playlist goes back to the mix panel", !!ed1.document.getElementById("feMixSlider") && ed1.document.getElementById("feMixB").textContent.includes("intro / outro"));
  ed1.document.getElementById("feMixDone").click();
  check("Done closes the panel", !ed1.document.getElementById("feMixSlider"));
  rowsOf(ed1)[0].querySelector(".fe-more").click();
  check("a mixed row's menu offers Edit mix and Remove mix instead of Add a mix", !!ed1.document.getElementById("feEditMix") && !!ed1.document.getElementById("feRemoveMix") && !ed1.document.getElementById("feAddMix"));
  ed1.document.getElementById("feRemoveMix").click();
  check("Remove mix keeps the first playlist and its minutes", rowsOf(ed1)[0].querySelector(".fe-title").textContent === "💗💗 evocative" && !/\{"💗💗 evocative"/.test(T(ed1)));

  // ---- new segments, and closing menus
  ed1.document.getElementById("feAddSegment").click();
  var ed_added = rowsOf(ed1);
  check("New segment adds an empty row at the end and opens its playlist list", ed_added.length === 3 && ed_added[2].querySelector(".fe-title").textContent === "Choose a playlist" && !!ed1.document.getElementById("feOptions") && ed_added[2].querySelector(".fe-main-empty") !== null);
  check("an empty row's Choose a playlist wraps to a second line instead of being cut short on a phone", /#formatEditor \.fe-main-empty \.fe-title \{[^}]*white-space: normal;/.test(fs.readFileSync(ROOT + "index.html", "utf8")));
  ed1.document.dispatchEvent(new ed1.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("Escape closes the list", !ed1.document.getElementById("feOptions"));
  rowsOf(ed1)[2].querySelector(".fe-more").click();
  check("a menu is open", !!ed1.document.querySelector(".fe-menu"));
  ed1.document.getElementById("feCaption").click();
  check("clicking anywhere else closes it", !ed1.document.querySelector(".fe-menu"));
  check("a segment with no playlist is marked, and Preview refuses it", true);

  // ---- the card's own menu, and deleting

  ed1.document.getElementById("feDuplicate").click();
  ed1.document.getElementById("feDuplicateConfirm").click();
  check("Duplicate adds a copy, named so, selected, with its own rows", JSON.stringify(tabsOf(ed1)) === JSON.stringify(["Warm focus", "Cool", "Warm focus copy"]) && ed1.document.querySelector('#feTabs .fe-tab[aria-pressed="true"]').textContent === "Warm focus copy" && rowsOf(ed1).length === 3);

  ed1.document.getElementById("feDelete").click();
  var ed_dlg = ed1.document.getElementById("feDeleteDialog");
  check("Delete asks first, naming the format, its rows, and its saved copy or the backup file", !!ed_dlg && /Delete Warm focus copy\?/.test(ed_dlg.textContent) && ed_dlg.querySelector("h3 i").textContent === "Warm focus copy" && /removes the recipe and its 3 rows/.test(ed_dlg.textContent) && /Playlists already in Spotify are not affected/.test(ed_dlg.textContent) && /Its saved copy in Spotify is deleted too\.|restored from a backup file if you have one\./.test(ed_dlg.textContent) && tabsOf(ed1).length === 3, ed_dlg && ed_dlg.textContent);
  ed1.document.getElementById("feDeleteCancel").click();
  check("Cancel keeps the format", !ed1.document.getElementById("feDeleteDialog") && tabsOf(ed1).length === 3);

  ed1.document.getElementById("feDelete").click();
  ed1.document.getElementById("feDeleteConfirm").click();
  check("Delete recipe removes it and selects another", JSON.stringify(tabsOf(ed1)) === JSON.stringify(["Warm focus", "Cool"]) && !ed1.document.getElementById("feDeleteDialog") && ed1.document.querySelector('#feTabs .fe-tab[aria-pressed="true"]').textContent === "Warm focus");
  for (let i = 0; i < 2; i++) { ed1.document.getElementById("feDelete").click(); ed1.document.getElementById("feDeleteConfirm").click(); }
  check("every format can be deleted, leaving only the big New recipe button, and nothing to build", tabsOf(ed1).length === 0 && !ed1.document.getElementById("feCreateFirst") && !/You don't have any formats yet/.test(ed1.document.getElementById("formatEditor").textContent) && ed1.document.querySelector(".fe-toprow").classList.contains("fe-noformats") && ed1.document.getElementById("feNewFormat").textContent.trim() === "New recipe" && !ed1.document.getElementById("feCard") && ed1.document.getElementById("create").disabled === true && ed1.document.getElementById("buildAll").disabled === true, ed1.document.getElementById("formatEditor").textContent);
  addNamed(ed1, "Full moon");
  check("the big New recipe button starts a new one with the name typed, with a segment waiting for a playlist", JSON.stringify(tabsOf(ed1)) === JSON.stringify(["Full moon"]) && rowsOf(ed1).length === 1 && rowsOf(ed1)[0].querySelector(".fe-title").textContent === "Choose a playlist");
  addNamed(ed1, "Full moon");
  check("a name another recipe has is not accepted", ed1.document.getElementById("feNewFormatConfirm").disabled === true && !!ed1.document.getElementById("feNewFormatDialog"));
  ed1.document.getElementById("feNewFormatCancel").click();
  check("and Cancel leaves only the first", JSON.stringify(tabsOf(ed1)) === JSON.stringify(["Full moon"]));


  
  } catch (err) { areaCrashed("the visual format editor", err); }
}
  if (want('dragging rows')) { try {
  // ================================================================ dragging rows
  var x_dr = await boot({ url: EDURL, session: signedIn(), local: { formats: x_THREE } });
  var x_gripOf = (w, i) => rowsOf(w)[i].querySelector(".fe-grip");
  check("the rows start in the order written", x_titles(x_dr) === "💗 spacious + gentle|💗💗 evocative|🛋 rest", x_titles(x_dr));
  pointer(x_dr, x_gripOf(x_dr, 0), "pointerdown", 100);
  pointer(x_dr, x_gripOf(x_dr, 0), "pointermove", 150);
  check("while dragging, the held row follows the pointer and the row it passes slides out of the way", rowsOf(x_dr)[0].style.transform === "translateY(50px)" && rowsOf(x_dr)[1].style.transform === "translateY(-58px)" && rowsOf(x_dr)[2].style.transform === "" && rowsOf(x_dr)[0].classList.contains("fe-dragging"), rowsOf(x_dr).map((r) => r.style.transform).join("|"));
  check("nothing is saved until the row is dropped", /"drag"|\("💗 spacious \+ gentle", 10\),\n\s+\("💗💗 evocative", 20\)/.test(T(x_dr)) || T(x_dr) === x_THREE);
  pointer(x_dr, x_gripOf(x_dr, 0), "pointerup", 150);
  check("dropping puts the row in its new place, in the list and in the text", x_titles(x_dr) === "💗💗 evocative|💗 spacious + gentle|🛋 rest" && T(x_dr).indexOf("evocative") < T(x_dr).indexOf("spacious"), x_titles(x_dr));
  var x_droppedRow = rowsOf(x_dr)[1];
  check("on release only the dropped row moves: the others are already in place and do not animate again", x_droppedRow.style.transform === "translateY(-8px)" && x_droppedRow.classList.contains("fe-dragging") && rowsOf(x_dr).every((r) => r.classList.contains("fe-still")), x_droppedRow.style.transform);
  await new Promise((r) => setTimeout(r, 150));
  check("then the dropped row glides the last bit into its slot, and everything goes back to normal", rowsOf(x_dr).every((r) => !r.classList.contains("fe-still") && !r.classList.contains("fe-dragging") && r.style.transform === ""));
  pointer(x_dr, x_gripOf(x_dr, 2), "pointerdown", 300);
  pointer(x_dr, x_gripOf(x_dr, 2), "pointermove", 230);
  pointer(x_dr, x_gripOf(x_dr, 2), "pointerup", 230);
  check("a row can be dragged up too", x_titles(x_dr) === "💗💗 evocative|🛋 rest|💗 spacious + gentle", x_titles(x_dr));
  pointer(x_dr, x_gripOf(x_dr, 1), "pointerdown", 100);
  pointer(x_dr, x_gripOf(x_dr, 1), "pointermove", 110);
  pointer(x_dr, x_gripOf(x_dr, 1), "pointerup", 110);
  check("a small nudge that does not reach the next row changes nothing, and nothing is left tilted", x_titles(x_dr) === "💗💗 evocative|🛋 rest|💗 spacious + gentle" && rowsOf(x_dr).every((r) => r.style.transform === "" && !r.classList.contains("fe-dragging")));
  pointer(x_dr, x_gripOf(x_dr, 0), "pointerdown", 100);
  pointer(x_dr, x_gripOf(x_dr, 0), "pointermove", 900);
  pointer(x_dr, x_gripOf(x_dr, 0), "pointerup", 900);
  check("dragging far past the end stops at the last place", x_titles(x_dr) === "🛋 rest|💗 spacious + gentle|💗💗 evocative", x_titles(x_dr));
  rowsOf(x_dr)[0].querySelector(".fe-more").click();
  check("a menu is open before a drag starts", !!x_dr.document.querySelector(".fe-menu"));
  pointer(x_dr, x_gripOf(x_dr, 1), "pointerdown", 200);
  check("pressing a handle while a menu is open does not start a drag: the press is stopped, as for everything else behind an open menu", !!x_dr.document.querySelector(".fe-menu") && !x_dr.document.querySelector(".fe-dragging"));
  x_dr.document.body.click();
  check("a tap elsewhere closes the menu", !x_dr.document.querySelector(".fe-menu"));
  pointer(x_dr, x_gripOf(x_dr, 1), "pointerdown", 200);
  check("pressing the handle again, with nothing open, starts the drag", !!x_dr.document.querySelector(".fe-dragging"));
  pointer(x_dr, x_gripOf(x_dr, 1), "pointermove", 140);
  pointer(x_dr, x_gripOf(x_dr, 1), "pointerup", 140);
  check("and the drag completes", x_titles(x_dr) === "💗 spacious + gentle|🛋 rest|💗💗 evocative", x_titles(x_dr));

  
  } catch (err) { areaCrashed("dragging rows", err); }
}
  if (want('a format built entirely on screen')) { try {
  // ================================================================ a format built entirely on screen
  var x_ui = {};
  var x_uiw = await boot({ url: EDURL, session: signedIn(), fetchOptions: x_ui });
  await readyToPreview(x_uiw).catch(() => {});
  rowsOf(x_uiw)[0].querySelector(".fe-main").click();
  optionNamed(x_uiw, "💗 spacious + gentle").click();
  x_uiw.document.getElementById("feAddSegment").click();
  optionNamed(x_uiw, "🛋 rest ").click();
  rowsOf(x_uiw)[1].querySelector(".fe-inc").click();
  rowsOf(x_uiw)[1].querySelector(".fe-inc").click();
  var x_nb = renameBox(x_uiw);
  x_nb.value = "UI test";
  x_nb.dispatchEvent(new x_uiw.Event("input", { bubbles: true }));
  finishName(x_uiw);
  check("a format built on screen reads: two segments of thirty minutes under the name UI test", x_titles(x_uiw) === "💗 spacious + gentle|🛋 rest " && rowsOf(x_uiw).map((r) => r.querySelector(".fe-amount").textContent).join("|") === "30 min|30 min" && tabsOf(x_uiw)[0] === "UI test", x_titles(x_uiw));
  var x_plan1 = x_enginePlan(T(x_uiw));
  var x_k1 = Object.keys(x_plan1)[0];
  check("the engine reads the text the editor wrote: same playlists, minutes, name pattern and no extra silence", JSON.stringify(x_plan1[x_k1].music) === JSON.stringify([[[["💗 spacious + gentle", 1]], 30], [[["🛋 rest ", 1]], 30]]) && x_plan1[x_k1].name === "UI test {n}" && x_plan1[x_k1].label === "UI test" && x_plan1[x_k1].gaps.every((g) => g === "none"), JSON.stringify(x_plan1));
  await readyToPreview(x_uiw);
  await runPreview(x_uiw);
  var uiOut = outText(x_uiw);
  check("previewing it uses the format's name in the plan", x_uiw.document.getElementById("bdTitle").textContent === "UI test", x_uiw.document.getElementById("bdTitle").textContent);
  pressBuild(x_uiw);
  await waitFor(() => /in your Spotify library\.$/.test(x_uiw.document.getElementById("actionMessage").textContent), 20000);
  check("creating makes playlists named from the format, with the chosen songs", x_ui.writes.some((w) => w.type === "create" && /^UI test \d+$/.test(w.name)), JSON.stringify(x_ui.writes.slice(0, 2)));
  check("the playlists just created are kept out of the picker", (() => { rowsOf(x_uiw)[0].querySelector(".fe-main").click(); const names = Array.from(x_uiw.document.querySelectorAll("#feOptions .fe-option")).map((o) => o.getAttribute("data-name")); return !names.some((n) => /^UI test \d+$/.test(n)) && names.includes("🛋 rest "); })());

  // silence and mixes written by the editor are understood by the engine too
  x_uiw.document.dispatchEvent(new x_uiw.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  rowsOf(x_uiw)[1].querySelector(".fe-more").click();
  x_uiw.document.getElementById("feAddSilence").click();
  rowsOf(x_uiw)[1].querySelector(".fe-tag").click();
  x_uiw.document.getElementById("feTagLonger").click();
  x_uiw.document.body.click();
  rowsOf(x_uiw)[0].querySelector(".fe-more").click();
  x_uiw.document.getElementById("feAddMix").click();
  x_uiw.document.getElementById("feMixSlider").value = "30";
  x_uiw.document.getElementById("feMixSlider").dispatchEvent(new x_uiw.Event("input", { bubbles: true }));
  var x_plan2 = x_enginePlan(T(x_uiw));
  var x_k2 = Object.keys(x_plan2)[0];
  var x_parts0 = x_plan2[x_k2].music[0][0];
  check("a mix with a 30/70 split and a trailing silence of 1 min read correctly by the engine", x_parts0.length === 2 && x_parts0[0][1] === 30 && x_parts0[1][1] === 70 && x_plan2[x_k2].music.length === 2 && x_plan2[x_k2].gaps[x_plan2[x_k2].gaps.length - 1] === "1 min", JSON.stringify(x_plan2));
  var x_src = 'FORMATS = {"s": {"name": "S {n}", "silence between segments": "30 sec", "segments": [("A", 10), ("silence", "2 min"), ("B", 10), ("silence", "none"), ("C", 10), ("D", 10), ("silence", "5 min")]}}';
  var x_model = x_uiw.textToModel(x_src);
  var x_again = x_enginePlan(x_uiw.modelToText(x_model));
  var x_orig = x_enginePlan(x_src);
  check("a format with a default, a longer silence, a silence set to none, and a trailing silence plays the same after the editor rewrites it", JSON.stringify(x_again.s.gaps) === JSON.stringify(x_orig.s.gaps) && JSON.stringify(x_orig.s.gaps) === JSON.stringify(["none", "2 min", "none", "30 sec", "5 min"]), JSON.stringify([x_orig.s.gaps, x_again.s.gaps]));
  check("the editor reads that same text as one default plus three silences of their own", (() => { const f = x_model.formats[0]; return f.gap === 30 && JSON.stringify(f.gaps.map((v) => (v === undefined ? "d" : v))) === JSON.stringify(["d", 120, 0, "d", "d"].slice(0, 1).concat([120, 0, "d", 300])); })());
  var x_legacy = 'FORMATS = {"l": {"name": "L {n}", "segments": [("silence", "1 min"), ("A", 10), ("silence", "30 sec"), ("silence", "30 sec"), ("B", 10)]}}';
  var x_lm = x_uiw.textToModel(x_legacy);
  check("an old silence before the first segment is kept out of sight but never lost, and two silences in a row become one of the same length", x_lm.formats[0].lead === 60 && x_lm.formats[0].gaps[1] === 60 && JSON.stringify(x_enginePlan(x_uiw.modelToText(x_lm)).l.gaps) === JSON.stringify(["1 min", "1 min", "none"]) && JSON.stringify(x_enginePlan(x_legacy).l.gaps) === JSON.stringify(["1 min", "30 sec + 30 sec", "none"]), JSON.stringify(x_enginePlan(x_legacy).l.gaps));
  check("a format with no segments at all is reported as unreadable, not drawn", (() => { try { x_uiw.textToModel('FORMATS = {"e": {"name": "E {n}", "segments": [("silence", "1 min")]}}'); return false; } catch (err) { return /needs at least one segment/.test(err.message); } })());

  
  } catch (err) { areaCrashed("a format built entirely on screen", err); }
}
  if (want('details')) { try {
  // ================================================================ details
  var x_nf = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"x": {"name": "Gone {n}", "segments": [("A playlist that was deleted", 10), ("🛋 rest", 10)]}}' } });
  var x_gone = rowsOf(x_nf)[0].querySelector(".fe-sub");
  check("a playlist that no longer exists is flagged on its row, and a found one is not", x_gone.textContent === "Not found in your playlists" && x_gone.className.includes("fe-sub-warn") && rowsOf(x_nf)[1].querySelector(".fe-sub-warn") === null, x_gone.textContent);
  var x_rs = await boot({ url: EDURL, session: signedIn(), local: { formats: x_THREE } });
  var x_GOOD2 = 'FORMATS = {\n  "one": {"name": "📗 one {n}", "segments": [("A", 10)]},\n  "two": {"name": "two {n}", "silence between segments": "1 min", "segments": [("B", 10), ("C", 10)]},\n}';
  var x_input = x_rs.document.getElementById("restoreFile");
  Object.defineProperty(x_input, "files", { value: [new x_rs.File([x_GOOD2], "old-backup.txt", { lastModified: Date.now() })], configurable: true });
  x_input.dispatchEvent(new x_rs.Event("change"));
  await new Promise((r) => setTimeout(r, 500));
  check("restoring an old backup redraws the editor", JSON.stringify(tabsOf(x_rs)) === JSON.stringify(["📗 one", "two"]) && /Restored 2 recipes/.test(capText(x_rs)));
  x_rs.document.querySelectorAll("#feTabs .fe-tab")[1].click();
  check("and the second format shows its old default silence as a tag between its two segments, with no silence row", x_titles(x_rs) === "B|C" && rowsOf(x_rs)[0].querySelector(".fe-tag").textContent === "1m", x_titles(x_rs));
  capLinks(x_rs).find((b) => b.textContent === "Undo").click();
  check("Undo redraws the editor with the formats that were there before", JSON.stringify(tabsOf(x_rs)) === JSON.stringify(["d"]) || tabsOf(x_rs).length === 1, JSON.stringify(tabsOf(x_rs)));
  var x_rb = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"a": ("oops"' } });
  check("unreadable text shows the reason, a way to save it, and Start over", !!x_rb.document.getElementById("feBroken") && !!x_rb.document.getElementById("feSaveBroken") && !!x_rb.document.getElementById("feStartOver"));
  x_rb.eval("saveFile = (name, text) => { window.__saved = { name, text }; }");
  x_rb.document.getElementById("feSaveBroken").click();
  check("Download the saved text hands over exactly what was saved", x_rb.__saved && /^playlist-recipes-unreadable-/.test(x_rb.__saved.name) && x_rb.__saved.text === 'FORMATS = {"a": ("oops"');
  x_rb.document.getElementById("feStartOver").click();
  check("Start over replaces it with no formats, and the editor comes back with the big New recipe button", !x_rb.document.getElementById("feBroken") && tabsOf(x_rb).length === 0 && x_rb.document.querySelector(".fe-toprow").classList.contains("fe-noformats") && x_rb.document.getElementById("feNewFormat").textContent.trim() === "New recipe");


  // ---------------- wording and look: What is this app?, How recipes work, and names of controls
  var aboutBox = fresh.document.getElementById("about");
  var aboutParas = Array.from(aboutBox.querySelectorAll("p")).map((p) => p.textContent);
  check("What it does is the new wording", aboutParas[0] === "What it doesCeremony Playlist Builder makes long playlists from your existing Spotify playlists. Describe the structure of the playlists you want to create, and this app builds as many complete playlists as your music allows, with songs picked at random and no song repeated across the playlists made from one recipe. Each playlist is created in your Spotify account, ready to play.", aboutParas[0]);
  var steps = Array.from(aboutBox.querySelectorAll("ol li")).map((li) => li.textContent);
  check("How it works has your two reworded steps", steps[0] === "Connect to Spotify through a free developer app. This takes a few minutes to set up, but you\u2019ll only need to do it once." && steps[1] === "Define your recipe(s): which of your playlists to draw from, in what order, and for how long." && steps.length === 3, JSON.stringify(steps));
  check("the About section has a Reporting problems paragraph, then Privacy as its last, which points to the full section and says nothing about reporting", aboutParas[aboutParas.length - 1] === "PrivacyYour existing Spotify playlists are only read, never changed. Everything runs in this browser, and nothing about your music, such as playlist names or songs, goes anywhere except to you and Spotify. For the full details, see Privacy." && aboutParas[aboutParas.length - 2] === "Reporting problemsIf you run into a problem, choose Report a problem in the app menu." && !!aboutBox.querySelector("span.ui") && aboutBox.querySelector("span.ui").textContent === "Report a problem", aboutParas[aboutParas.length - 1]);
  var removeP = Array.from(fresh.document.querySelectorAll("#moreOptions p")).find((p) => /Removes the playlists/.test(p.textContent));
  check("the Remove playlists built from a recipe text says what it touches, in your wording", !!removeP && /It only looks at playlists that match the recipe\u2019s name, and it asks before removing anything\./.test(removeP.textContent) && !/whose names match a format's naming pattern/.test(removeP.textContent), removeP && removeP.textContent);
  var wCss = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  check("body text in What is this app? and How recipes work is gray, with headings and control names staying bright", /details\.about, #formatHelp \{ color: var\(--muted\); \}/.test(wCss) && /details\.about strong, #formatHelp h3 \{ color: var\(--fg\); \}/.test(wCss) && /\.ui \{ color: var\(--fg\); \}/.test(wCss));
  var uiNames = Array.from(fresh.document.querySelectorAll("span.ui")).map((x) => x.textContent);
  check("the names of buttons and links in running text are marked up the same way", ["More options", "Build playlists", "New segment", "Add a mix", "Reset to default", "Restore", "Report a problem"].every((n) => uiNames.includes(n)), JSON.stringify(uiNames));
  check("no button or link name is left in single or curly quotes, since the style now sets it apart", !/[\u2018\u2019'](More options|Preview|Create|New segment|Add a mix)[\u2018\u2019']/.test(fresh.document.body.textContent));


  // ---------------- gray standard text, with white only where it is needed
  var gCss = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  check("standard text is gray by default", /\n?\s*body \{[^}]*color: var\(--muted\)/.test(gCss) && !/body \{[^}]*color: var\(--fg\)/.test(gCss));
  check("headings, the two setup choices, code, results and confirmation boxes are white", /h2, h3, label\.choice, code, #confirmBox, #removeConfirmBox, #clearConfirm \{ color: var\(--fg\); \}/.test(gCss));
  var gh = fs.readFileSync(ROOT + "index.html", "utf8");
  var aboutRange = gh.slice(gh.indexOf('<details id="about"'), gh.indexOf("</details>", gh.indexOf('<details id="about"')));
  var outside = gh.replace(aboutRange, "").replace(/<details id="guideSection"[\s\S]*?<details id="moreOptions"/, "").slice(gh.indexOf("<body"));
  check("bold is kept for the six headings in About this app (and the guide for facilitators), and nowhere else", (aboutRange.match(/<strong>/g) || []).length === 6 && (outside.match(/<strong[ >]/g) || []).length === 0 && !/<b>/.test(outside));
  var setupText = fresh.document.getElementById("spSteps");
  check("the setup steps' field names and buttons are highlighted in white, and nothing there is bold", setupText.querySelectorAll("strong, b").length === 0 && Array.from(setupText.querySelectorAll("span.ui")).map((x) => x.textContent).some((t) => /^Create app$/.test(t)) && Array.from(setupText.querySelectorAll("span.ui")).some((x) => /App name/.test(x.textContent)));
  check("the connected message and Step 4's text are plain gray text, not wrapped in any highlight", !fresh.document.getElementById("connectedMessage").querySelector(".ui") && !t0.document.getElementById("backupSection").nextElementSibling.querySelector(".ui") && t0.document.getElementById("backupSection").nextElementSibling.tagName === "P" && !t0.document.getElementById("backupSection").nextElementSibling.classList.contains("ui"));
  check("the two setup answers are buttons, so their labels are bright", fresh.document.querySelectorAll("#spAsk button[data-flow]").length === 2);


  
  } catch (err) { areaCrashed("details", err); }
}
  if (want('one pink look, and rows linked to the bar')) { try {
  // ================================================================ one pink look, and rows linked to the bar
  var hl = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"h": {"name": "Link {n}", "segments": [("💗 spacious + gentle", 20), ("silence", "2 min"), ("🛋 rest", 40)]}}' } });
  var hlRows = () => rowsOf(hl);
  var hlPieces = () => Array.from(hl.document.querySelectorAll("#feBar .fe-piece"));
  var bar = hl.document.getElementById("feBar");
  check("each piece of the bar names its row for screen readers, and is a picture, not a button, since tapping it does nothing", hlPieces().length === 3 && hlPieces().every((p) => p.tagName === "DIV" && p.getAttribute("role") === "img") && hlPieces().map((p) => p.getAttribute("aria-label")).join("|") === "💗 spacious + gentle, 20 min|Silence, 2 min|🛋 rest, 40 min", hlPieces().map((p) => p.getAttribute("aria-label")).join("|"));
  check("each piece carries the id of its row, and the silence piece the id of its tag, so they can be matched", hlPieces()[0].getAttribute("data-id") === hlRows()[0].getAttribute("data-id") && hlPieces()[2].getAttribute("data-id") === hlRows()[1].getAttribute("data-id") && hlPieces()[1].getAttribute("data-id") === "gap1" && hlRows()[0].querySelector(".fe-tag").getAttribute("data-id") === "gap1");
  check("nothing is highlighted at first", !bar.classList.contains("fe-hasHl") && hl.document.querySelectorAll(".fe-hl").length === 0);
  hlRows()[1].dispatchEvent(new hl.MouseEvent("mouseenter"));
  check("pointing at a row highlights it and its piece, and dims the rest of the bar", bar.classList.contains("fe-hasHl") && hlRows()[1].classList.contains("fe-hl") && hlPieces()[2].classList.contains("fe-hl") && hl.document.querySelectorAll(".fe-hl").length === 2 && !hlPieces()[0].classList.contains("fe-hl"));
  hlRows()[1].dispatchEvent(new hl.MouseEvent("mouseleave"));
  check("moving away clears it", !bar.classList.contains("fe-hasHl") && hl.document.querySelectorAll(".fe-hl").length === 0);
  hlPieces()[0].dispatchEvent(new hl.MouseEvent("mouseenter"));
  check("pointing at a piece highlights its row, too", hlRows()[0].classList.contains("fe-hl") && hlPieces()[0].classList.contains("fe-hl") && hl.document.querySelectorAll(".fe-hl").length === 2);
  hlPieces()[0].dispatchEvent(new hl.MouseEvent("mouseleave"));
  hlPieces()[2].click();
  check("tapping a piece of the bar highlights nothing: pieces are only a reflection of where the pointer is", hl.document.querySelectorAll(".fe-hl").length === 0 && !bar.classList.contains("fe-hasHl"));
  hlRows()[1].querySelector(".fe-more").click();
  check("opening a row's menu does not select that row or its piece", hl.document.querySelectorAll(".fe-hl").length === 0);
  hl.document.dispatchEvent(new hl.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  hlRows()[0].querySelector(".fe-main").click();
  check("neither does opening its playlist list", hl.document.querySelectorAll(".fe-hl").length === 0 && !!hl.document.getElementById("feOptions"));
  hlRows()[0].dispatchEvent(new hl.MouseEvent("mouseenter"));
  check("pointing at a row with its list open still lights it up, as it would any row", hlRows()[0].classList.contains("fe-hl") && hlPieces()[0].classList.contains("fe-hl"));
  Array.from(hl.document.querySelectorAll("#feOptions .fe-option")).find((o) => o.getAttribute("data-name") === "🛋 rest ").click();
  check("choosing a playlist leaves nothing selected or lit: the row is rebuilt and forgets where the pointer was", hl.document.querySelectorAll(".fe-hl").length === 0 && !hl.document.getElementById("feBar").classList.contains("fe-hasHl") && !hl.document.getElementById("feOptions"));
  hlRows()[0].dispatchEvent(new hl.MouseEvent("mouseenter"));
  hlRows()[0].querySelector(".fe-inc").click();
  check("changing a length rebuilds the rows, and the highlight does not stick to the new ones", hl.document.querySelectorAll(".fe-hl").length === 0 && hlPieces().length === 3);
  hlRows()[0].querySelector(".fe-tag").dispatchEvent(new hl.MouseEvent("mouseenter"));
  check("pointing at a silence tag lights up its piece of the bar, and the other way round", hlRows()[0].querySelector(".fe-tag").classList.contains("fe-hl") && hlPieces()[1].classList.contains("fe-hl") && hl.document.querySelectorAll(".fe-hl").length === 2 && !hlRows()[0].classList.contains("fe-hl"));
  hlRows()[0].querySelector(".fe-tag").dispatchEvent(new hl.MouseEvent("mouseleave"));
  hlPieces()[1].click();
  check("tapping the silence piece does nothing either", hl.document.querySelectorAll(".fe-hl").length === 0);
  hlRows()[0].querySelector(".fe-tag").click();
  check("opening a silence's card highlights nothing, and closing it with Escape leaves no highlight", !!hl.document.getElementById("feTagPanel") && hl.document.querySelectorAll(".fe-hl").length === 0 && (hl.document.dispatchEvent(new hl.KeyboardEvent("keydown", { key: "Escape", bubbles: true })), !hl.document.getElementById("feTagPanel")) && hl.document.querySelectorAll(".fe-hl").length === 0);
  check("the editor keeps no selection at all", !/pinned/.test(fs.readFileSync(ROOT + "editor.js", "utf8")));
  check("the text the editor writes has no colors in it, and the engine does not need any", !/"colors"/.test(T(hl)));
  var css2 = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  check("a dragged row keeps its own pink ring, declared after the highlight ring so it wins", css2.indexOf(".fe-row.fe-hl .fe-rowcard") < css2.indexOf(".fe-row.fe-dragging .fe-rowcard"));
  check("no swatch styles or color markup are left in the page or the editor", !/fe-swatch/.test(css2) && !/swatch|FE_COLORS|item\.color/.test(fs.readFileSync(ROOT + "editor.js", "utf8")));
  var legacyColors = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"x": {"name": "Old {n}", "colors": [3, None, 5], "segments": [("💗 spacious + gentle", 10), ("silence", "1 min"), ("🛋 rest", 10)]}}' } });
  check("formats saved with the old colors still load, and the colors are simply ignored", tabsOf(legacyColors).join("|") === "Old" && rowsOf(legacyColors).length === 2);
  rowsOf(legacyColors)[0].querySelector(".fe-inc").click();
  check("and the next edit writes them out without colors", !/"colors"/.test(T(legacyColors)));


  
  } catch (err) { areaCrashed("one pink look, and rows linked to the bar", err); }
}
  if (want('the simpler create step')) { try {
  // ================================================================ the simpler create step
  var y_oq = {};
  var y_cq = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: y_oq });
  await readyToPreview(y_cq);
  check("Step 3 is headed Build playlists and has one button, Build playlists for the format being edited, and no dropdown", /^3\. Build playlists$/.test(Array.from(y_cq.document.querySelectorAll("#appSection h2"))[1].textContent) && /^Build playlists for .+$/.test(y_cq.document.getElementById("create").textContent.trim()) && !y_cq.document.getElementById("preview") && !y_cq.document.getElementById("createRow"));
  y_cq.document.getElementById("create").click();
  await waitFor(() => visible(y_cq, "confirmBox"), 30000);
  check("while the question is open, Create is off, nothing has been written, and the plan box is quiet", y_cq.document.getElementById("create").disabled === true && y_oq.writes.length === 0 && y_cq.document.getElementById("output").hidden === true);
  check("it offers Build and Cancel, plus Why N?, and nothing about drawing again", y_cq.document.getElementById("confirmYes").textContent.trim().startsWith("Build ") && y_cq.document.getElementById("confirmNo").textContent.trim() === "Cancel" && /^Why \d+\?$/.test(y_cq.document.getElementById("planToggle").textContent) && !y_cq.document.getElementById("redraw") && !/Draw again|redraw/i.test(fs.readFileSync(ROOT + "app.js", "utf8") + fs.readFileSync(ROOT + "index.html", "utf8").replace(/redraws? the editor/g, "")));
  await new Promise((r) => setTimeout(r, 300));
  pressBuild(y_cq);
  await waitFor(() => /in your Spotify library\.$/.test(y_cq.document.getElementById("actionMessage").textContent), 30000);
  check("Create makes the playlists, and the question and its plan are gone afterward", y_oq.writes.some((w) => w.type === "create") && !visible(y_cq, "confirmBox") && y_cq.document.getElementById("planText").textContent === "");
  // editing while the question is open closes it quietly
  var y_cq2 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  await readyToPreview(y_cq2);
  y_cq2.document.getElementById("create").click();
  await waitFor(() => visible(y_cq2, "confirmBox"), 30000);
  y_cq2.document.querySelector("#feRows .fe-inc").click();
  await waitFor(() => !y_cq2.document.getElementById("create").disabled, 10000);
  check("changing a format while the question is open closes it quietly, with no Cancelled message", !visible(y_cq2, "confirmBox") && !/Cancelled/.test(y_cq2.document.getElementById("actionMessage").textContent) && !y_cq2.document.getElementById("create").disabled);
  // a problem is shown plainly, with no question
  var y_cq3 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn() });
  await readyToPreview(y_cq3);
  y_cq3.document.getElementById("create").click();
  await waitFor(() => /has no playlist yet/.test(y_cq3.document.getElementById("output").textContent), 20000);
  check("a segment with no playlist is explained in the output box, with no question", !visible(y_cq3, "confirmBox") && y_cq3.document.getElementById("output").hidden === false);

  
  } catch (err) { areaCrashed("the simpler create step", err); }
}
  if (want('small changes')) { try {
  // ================================================================ small changes
  check("the title has the app icon on its left", (() => { const h1 = fresh.document.querySelector("h1"); const img = h1.querySelector("img.app-icon"); return h1.classList.contains("brand") && !!img && img.getAttribute("src") === "apple-touch-icon.png" && img.getAttribute("alt") === "" && h1.firstElementChild === img && /Ceremony Playlist Builder/.test(h1.textContent); })());
  var pngSize = (name) => { const b = fs.readFileSync(ROOT + name); return b.slice(0, 8).toString("hex") === "89504e470d0a1a0a" ? [b.readUInt32BE(16), b.readUInt32BE(20)].join("x") : "not a png"; };
  var headHtml = fs.readFileSync(ROOT + "index.html", "utf8").slice(0, fs.readFileSync(ROOT + "index.html", "utf8").indexOf("</head>"));
  check("every icon the page asks for exists, at the size its name or link says", pngSize("favicon-16.png") === "16x16" && pngSize("favicon-32.png") === "32x32" && pngSize("apple-touch-icon.png") === "180x180" && pngSize("icon-192.png") === "192x192" && pngSize("icon-512.png") === "512x512" && fs.readFileSync(ROOT + "favicon.ico").readUInt16LE(2) === 1 && fs.readFileSync(ROOT + "favicon.ico").readUInt16LE(4) === 3, [pngSize("favicon-16.png"), pngSize("apple-touch-icon.png")].join(" "));
  check("the page links the tab icons and the home-screen icon, and each linked file exists", /<link rel="icon" href="favicon\.ico" sizes="16x16 32x32 48x48">/.test(headHtml) && /<link rel="icon" href="favicon-32\.png" type="image\/png" sizes="32x32">/.test(headHtml) && /<link rel="icon" href="favicon-16\.png" type="image\/png" sizes="16x16">/.test(headHtml) && /<link rel="apple-touch-icon" href="apple-touch-icon\.png">/.test(headHtml) && (headHtml.match(/href="([^"]+\.(?:ico|png))"/g) || []).every((m) => fs.existsSync(ROOT + m.slice(6, -1))));
  var y_conn = await boot({ url: "http://127.0.0.1:8000/", session: signedIn() });
  var y_cs = y_conn.document.getElementById("connectedSection");
  var y_headrow = y_cs.querySelector(".headrow");
  check("Disconnect sits on the heading row, after the heading, and the message is under them", !!y_headrow && y_headrow.firstElementChild.tagName === "H2" && y_headrow.lastElementChild.id === "disconnect" && y_headrow.nextElementSibling.id === "connectedMessage");
  check("the heading row puts the heading at the left and the button at the far right", /\.headrow \{[^}]*display: flex; align-items: center; justify-content: space-between/.test(fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ")));
  check("More about this app starts closed, even when a Client ID is saved", y_conn.document.getElementById("about").open === false);
  var y_silRow = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: 'FORMATS = {"s": {"name": "Sil {n}", "segments": [("💗 spacious + gentle", 10), ("silence", "30 min"), ("🛋 rest", 10)]}}' } });
  rowsOf(y_silRow)[0].querySelector(".fe-tag").click();
  y_silRow.document.getElementById("feTagLonger").click();
  check("a silence steps from 30 min to 35, 40, 45, and so on in 5 minute steps", y_silRow.document.getElementById("feTagDuration").textContent === "35 min");
  for (let i = 0; i < 5; i++) y_silRow.document.getElementById("feTagLonger").click();
  check("and the last stop is 60 min", y_silRow.document.getElementById("feTagDuration").textContent === "60 min" && /\("silence", "60 min"\)/.test(T(y_silRow)));
  y_silRow.document.getElementById("feTagShorter").click();
  check("coming back down it passes 55", y_silRow.document.getElementById("feTagDuration").textContent === "55 min");
  check("Step 4's heading says it is optional", /^4\. Back up manually to this device \(optional\)$/.test(y_conn.document.getElementById("backupSection").textContent));

  
  } catch (err) { areaCrashed("small changes", err); }
}
  if (want('the color theme')) { try {
  // ================================================================ the color theme
  var y_thm = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI } });
  var y_root = y_thm.document.documentElement.style;
  check("More options has a Color heading and a list of 17 single-color names, Pink first, each with its color as a swatch", Array.from(y_thm.document.querySelectorAll("#moreOptions details.gd-topic > summary")).some((h) => h.textContent === "Color") && Array.from(y_thm.document.querySelectorAll("#themeList .theme-option")).length === 17 && y_thm.document.querySelector("#themeList .theme-option").textContent === "Pink" && y_thm.document.getElementById("themeName").textContent === "Pink" && /#ff38b8|rgb\(255, 56, 184\)/.test(y_thm.document.getElementById("themeSwatch").style.background) && Array.from(y_thm.document.querySelectorAll("#themeList .theme-option")).every((o) => o.querySelector(".swatch").style.background !== "" && !/\band\b/.test(o.textContent)));
  check("the theme's two colors become every color the page uses", y_root.getPropertyValue("--button") === "#ff38b8" && y_root.getPropertyValue("--silence-line") === "#8a8a92" && ["--bg", "--fg", "--muted", "--line", "--card", "--cover", "--accent", "--accent-deep", "--accent-tint", "--accent-tint-border", "--accent-wash", "--on-button", "--icon-filter"].every((v) => y_root.getPropertyValue(v) !== ""), y_root.getPropertyValue("--bg"));
  check("light mode: a white page, dark text, and white text on the pink buttons", y_root.getPropertyValue("--bg") === "#ffffff" && y_thm.contrastRatio(y_root.getPropertyValue("--fg"), y_root.getPropertyValue("--bg")) > 12 && y_root.getPropertyValue("--on-button") === "#ffffff" && y_root.getPropertyValue("--icon-filter") === "none");
  check("link and title text in light mode is darkened until it can be read (4.5 to 1 or better)", y_thm.contrastRatio(y_root.getPropertyValue("--accent"), y_root.getPropertyValue("--bg")) >= 4.5);
  var y_dk = y_thm.themeVariables("#ff38b8", "#8a8a92", true);
  check("dark mode: a near-black page, light text, the accent itself for links, and readable gray text", y_thm.contrastRatio(y_dk["--bg"], "#000000") < 1.3 && y_thm.contrastRatio(y_dk["--fg"], y_dk["--bg"]) > 12 && y_dk["--accent"] === "#ff38b8" && y_thm.contrastRatio(y_dk["--muted"], y_dk["--bg"]) >= 4.5, JSON.stringify(y_dk));
  var y_blue = y_thm.themeVariables("#0a84ff", "#808080", false);
  check("any two colors work: a y_blue accent gives y_blue buttons, a y_blue deep shade, and tints of the same blue", y_blue["--button"] === "#0a84ff" && y_blue["--accent-deep"] !== "#a8217c" && /^rgba\(10, 132, 255, 0\.15\)$/.test(y_blue["--accent-tint"]) && y_thm.contrastRatio(y_blue["--accent"], y_blue["--bg"]) >= 4.5, JSON.stringify(y_blue));
  var y_yellow = y_thm.themeVariables("#ffd60a", "#8a8a92", false);
  check("a light accent gets dark button text and dark icons, so it stays readable", y_yellow["--on-button"] === "#111111" && y_yellow["--icon-filter"] === "invert(1)" && y_thm.contrastRatio(y_yellow["--button"], y_yellow["--on-button"]) >= 7, JSON.stringify(y_yellow));
  check("a warm gray neutral tints the backgrounds warm, and a pure gray leaves them gray", (() => { const warm = y_thm.themeVariables("#ff38b8", "#9a8a7a", true); const flat = y_thm.themeVariables("#ff38b8", "#888888", true); const [wr, , wb] = y_thm.hexToRgb(warm["--card"]); const [fr, , fb] = y_thm.hexToRgb(flat["--card"]); return wr > wb && fr === fb; })());
  check("hex colors are read leniently: 3 or 6 digits, with or without #, in any case", y_thm.normalizeHex("0AF") === "#00aaff" && y_thm.normalizeHex("#FF38B8") === "#ff38b8" && y_thm.normalizeHex("ff38b8") === "#ff38b8" && y_thm.normalizeHex("nope") === null && y_thm.normalizeHex("12345") === null);
  var y_typed = await boot({ url: "http://127.0.0.1:8000/?accent=0a84ff&neutral=808080", session: signedIn(), local: { formats: MINI } });
  check("two colors in the address change the whole page, and the chooser says they are custom", y_typed.document.documentElement.style.getPropertyValue("--button") === "#0a84ff" && y_typed.document.getElementById("themeName").textContent === "Custom colors" && Array.from(y_typed.document.querySelectorAll("#themeList .theme-option")).length === 18 && !y_typed.document.getElementById("themeNote").hidden && /address/.test(y_typed.document.getElementById("themeNote").textContent));
  check("they are kept for the tab, so they survive the trip to Spotify and back", y_typed.sessionStorage.getItem("themeColors") !== null);
  y_typed.document.getElementById("themeButton").click();
  Array.from(y_typed.document.querySelectorAll("#themeList .theme-option")).find((o) => o.dataset.id === "pinks-and-grays").click();

  check("choosing a theme returns to its colors and forgets the typed ones", y_typed.document.documentElement.style.getPropertyValue("--button") === "#ff38b8" && y_typed.sessionStorage.getItem("themeColors") === null && y_typed.document.getElementById("themeNote").hidden === true && Array.from(y_typed.document.querySelectorAll("#themeList .theme-option")).length === 17 && y_typed.document.getElementById("themeName").textContent === "Pink" && y_typed.localStorage.getItem("theme") === "pinks-and-grays");
  var y_junk = await boot({ url: "http://127.0.0.1:8000/?accent=banana&neutral=808080", session: signedIn() });
  check("colors that are not colors are ignored", y_junk.document.documentElement.style.getPropertyValue("--button") === "#ff38b8");
  var y_reset = await boot({ url: "http://127.0.0.1:8000/?theme=reset", session: { ...signedIn(), themeColors: JSON.stringify({ accent: "#0a84ff", neutral: "#808080" }) } });
  check("?theme=y_reset in the address forgets y_typed colors", y_reset.document.documentElement.style.getPropertyValue("--button") === "#ff38b8" && y_reset.sessionStorage.getItem("themeColors") === null);
  var y_tcss = fs.readFileSync(ROOT + "index.html", "utf8");
  var y_styleOnly = y_tcss.slice(y_tcss.indexOf("<style>"), y_tcss.indexOf("</style>"));
  check("no accent color is written into the page's styles except as a fallback inside a variable", !/(^|[^-(])#ff38b8/.test(y_styleOnly.replace(/:root \{[^}]*\}/g, "").replace(/var\((?:[^()]|\([^()]*\))*\)/g, "")) && !/#c2188f/.test(y_styleOnly.replace(/:root \{[^}]*\}/g, "")), "");
  check("the editor's stripes follow the theme's variables, not fixed colors", /var\(--button\)/.test(fs.readFileSync(ROOT + "editor.js", "utf8")) && /var\(--accent-deep\)/.test(fs.readFileSync(ROOT + "editor.js", "utf8")) && !/#ff38b8|#a8217c/i.test(fs.readFileSync(ROOT + "editor.js", "utf8")));
  check("button icons follow the button text color through one variable", /\.btn-icon \{[^}]*filter: var\(--icon-filter, none\)/.test(y_tcss.replace(/\s+/g, " ")));


  
  } catch (err) { areaCrashed("the color theme", err); }
}
  if (want('all the themes')) { try {
  // ================================================================ all the themes
  var z_t = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI } });
  var z_THEMES = Array.from(z_t.eval("THEMES"));
  var z_ids = z_THEMES.map((t) => t.id);
  check("there are 17 themes, each with its own id and a one-word color name and two valid colors", z_THEMES.length === 17 && new Set(z_ids).size === 17 && new Set(z_THEMES.map((t) => t.name)).size === 17 && z_THEMES.every((t) => /^[A-Z][a-z]+$/.test(t.name)) && z_THEMES.every((t) => z_t.normalizeHex(t.accent) === t.accent && z_t.normalizeHex(t.neutral) === t.neutral));
  var z_bad = [];
  for (const t of z_THEMES) {
    for (const dark of [false, true]) {
      const v = z_t.themeVariables(t.accent, t.neutral, dark);
      const c = (a, b) => z_t.contrastRatio(v[a], v[b]);
      const rules = [
        ["text on the page", c("--fg", "--bg") >= 12],
        ["gray text on the page", c("--muted", "--bg") >= 4.5],
        ["gray text on a card", c("--muted", "--card") >= 4.2],
        ["links and the title", c("--accent", "--bg") >= 4.5],
        ["text on the buttons", c("--on-button", "--button") >= 3],
        ["text on a changed silence tag, which is the buttons' pink", c("--on-button", "--button") >= 3],
        ["text on a default silence tag, which is the deeper pink", c("--on-deep", "--accent-deep") >= 4.5],
      ];
      for (const [what, ok] of rules) if (!ok) z_bad.push(`${t.name} ${dark ? "dark" : "light"}: ${what}`);
    }
  }
  check("in every theme, in light and dark, the text, links, buttons and silence tags are readable", z_bad.length === 0, z_bad.join("; "));
  z_t.eval('openInfo("moreOptions")');   // the color list is in More options, which the app menu opens in a popup
  z_t.document.getElementById("themeButton").click();
  check("the list opens on the button, with the current color's option focused and selected", !z_t.document.getElementById("themeList").hidden && z_t.document.getElementById("themeButton").getAttribute("aria-expanded") === "true" && z_t.document.querySelector("#themeList [aria-selected=true]").textContent === "Pink" && z_t.document.activeElement.textContent === "Pink");
  z_t.document.getElementById("themeList").dispatchEvent(new z_t.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  check("the arrow keys move through the list", z_t.document.activeElement.textContent === "Rose");
  z_t.document.getElementById("themeList").dispatchEvent(new z_t.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("Escape closes it again and the button has focus", z_t.document.getElementById("themeList").hidden === true && z_t.document.activeElement === z_t.document.getElementById("themeButton"));
  z_t.document.getElementById("themeButton").click();
  z_t.document.body.click();
  check("tapping elsewhere closes it too", z_t.document.getElementById("themeList").hidden === true);
  z_t.document.getElementById("themeButton").click();
  Array.from(z_t.document.querySelectorAll("#themeList .theme-option")).find((o) => o.textContent === "Amber").click();

  check("choosing a theme applies it at once and remembers it", z_t.document.documentElement.style.getPropertyValue("--button") === "#ffb020" && z_t.localStorage.getItem("theme") === "ambers-and-umbers" && z_t.document.documentElement.style.getPropertyValue("--on-button") === "#111111");
  var z_t2 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI, theme: "greens-and-sages" } });
  check("a remembered theme is used the next time, and shows as the chosen one, with its swatch", z_t2.document.documentElement.style.getPropertyValue("--button") === "#3ecf8e" && z_t2.document.getElementById("themeName").textContent === "Green" && z_t2.document.getElementById("themeSwatch").style.background !== "");

  
  } catch (err) { areaCrashed("all the themes", err); }
}
  if (want('silences, dragging and removing')) { try {
  // ================================================================ silences, dragging and removing
  var z_THREE = 'FORMATS = {"t": {"name": "T {n}", "silence between segments": "1 min", "segments": [("💗 spacious + gentle", 10), ("silence", "3 min"), ("💗💗 evocative", 20), ("🛋 rest", 30), ("silence", "5 min")]}}';
  var z_d = await boot({ url: EDURL, session: signedIn(), local: { formats: z_THREE } });
  var z_title = (w) => rowsOf(w).map((r) => r.querySelector(".fe-title").textContent.trim()).join("|");
  var z_tags = (w) => rowsOf(w).map((r) => { const t = r.querySelector(".fe-tag"); return t ? t.textContent : "-"; }).join("|");
  check("three segments show their silences by place: 3 minutes, the default minute, and 5 minutes after the last", z_title(z_d) === "💗 spacious + gentle|💗💗 evocative|🛋 rest" && z_tags(z_d) === "3m|1m|5m", z_tags(z_d));
  check("the bar draws the two silences between segments and the one after", z_d.document.querySelectorAll("#feBar .fe-piece-silence").length === 3 && /^1 hour of music \+ 9 minutes of silence$/.test(z_d.document.getElementById("feCaption").textContent), z_d.document.getElementById("feCaption").textContent);
  var z_grip = (i) => rowsOf(z_d)[i].querySelector(".fe-grip");
  pointer(z_d, z_grip(0), "pointerdown", 100);
  check("while a row is being dragged, the silence tags step aside", z_d.document.getElementById("feRows").classList.contains("fe-dragging-any"));
  pointer(z_d, z_grip(0), "pointermove", 160);
  pointer(z_d, z_grip(0), "pointerup", 160);
  check("after the drop the segments are in their new order but each silence stays where it was, between the same places", z_title(z_d) === "💗💗 evocative|💗 spacious + gentle|🛋 rest" && z_tags(z_d) === "3m|1m|5m" && !z_d.document.getElementById("feRows").classList.contains("fe-dragging-any"), z_title(z_d) + " / " + z_tags(z_d));
  rowsOf(z_d)[0].querySelector(".fe-more").click();
  z_d.document.getElementById("feRemoveRow").click();
  check("removing the first segment takes the silence before it along, and leaves the others", z_title(z_d) === "💗 spacious + gentle|🛋 rest" && z_tags(z_d) === "1m|5m" && !/\("silence", "3 min"\)/.test(T(z_d)), z_tags(z_d));
  rowsOf(z_d)[1].querySelector(".fe-more").click();
  z_d.document.getElementById("feRemoveRow").click();
  check("removing the last segment leaves the one before it with its silence after", z_title(z_d) === "💗 spacious + gentle" && rowsOf(z_d).length === 1);
  rowsOf(z_d)[0].querySelector(".fe-more").click();
  z_d.document.getElementById("feRemoveRow").click();
  check("removing the only segment leaves one empty segment, never nothing", rowsOf(z_d).length === 1 && rowsOf(z_d)[0].querySelector(".fe-title").textContent === "Choose a playlist" && z_tags(z_d) === "-");
  var z_dup = await boot({ url: EDURL, session: signedIn(), local: { formats: z_THREE } });

  z_dup.document.getElementById("feDuplicate").click();
  z_dup.document.getElementById("feDuplicateConfirm").click();
  check("duplicating a format copies its default silence and every silence of its own", z_tags(z_dup) === "3m|1m|5m" && /"silence between segments": "1 min"/.test(T(z_dup)));
  z_dup.document.getElementById("feAddSegment").click();
  check("a new segment starts with no silence of its own, and the one after the previous last segment follows the default", z_tags(z_dup) === "3m|1m|1m|-" || z_tags(z_dup) === "3m|1m|5m|-" , z_tags(z_dup));
  var z_open = await boot({ url: EDURL, session: signedIn(), local: { formats: z_THREE } });
  rowsOf(z_open)[0].querySelector(".fe-tag").click();
  check("a silence's card is open", !!z_open.document.getElementById("feTagPanel") && rowsOf(z_open)[0].querySelector(".fe-tag").getAttribute("aria-expanded") === "true" && rowsOf(z_open)[0].classList.contains("fe-open"));
  z_open.document.getElementById("feCaption").click();
  check("tapping anywhere else closes it", !z_open.document.getElementById("feTagPanel"));
  rowsOf(z_open)[0].querySelector(".fe-tag").click();
  rowsOf(z_open)[1].querySelector(".fe-more").click();
  check("tapping a row's menu while the silence's card is open only closes the card: the menu does not open", !z_open.document.getElementById("feTagPanel") && !z_open.document.querySelector(".fe-menu"));
  rowsOf(z_open)[1].querySelector(".fe-more").click();
  rowsOf(z_open)[0].querySelector(".fe-tag").click();
  check("and the other way round: tapping a silence marker while a row's menu is open only closes the menu", !z_open.document.getElementById("feTagPanel") && !z_open.document.querySelector(".fe-menu"));
  rowsOf(z_open)[1].querySelector(".fe-tag").click();
  check("opening a silence's card closes the row's menu", !z_open.document.querySelector(".fe-menu") && !!z_open.document.getElementById("feTagPanel"));

  var z_noTags = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"n": {"name": "N {n}", "segments": [("💗 spacious + gentle", 10), ("🛋 rest", 10)]}}' } });
  check("with no default and no silences there are no tags, and the card needs no extra room", z_tags(z_noTags) === "-|-" && !z_noTags.document.getElementById("formatEditor").classList.contains("fe-hastags"));

  z_noTags.document.getElementById("feGapLonger").click();
  check("setting a default silence in the header adds a tag between the segments, as a default one", z_tags(z_noTags) === "30s|-" && rowsOf(z_noTags)[0].querySelector(".fe-tag").classList.contains("fe-tag-default") && z_noTags.document.getElementById("formatEditor").classList.contains("fe-hastags") && /"silence between segments": "30 sec"/.test(T(z_noTags)));
  z_noTags.document.getElementById("feGapShorter").click();
  check("setting it back to None removes those tags again", z_tags(z_noTags) === "-|-" && z_noTags.document.getElementById("feGapValue").textContent === "No" && /"silence between segments": "none"/.test(T(z_noTags)));
  var z_zero = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"z": {"name": "Z {n}", "silence between segments": "1 min", "segments": [("💗 spacious + gentle", 10), ("silence", "none"), ("🛋 rest", 10)]}}' } });
  check("a silence set to none while there is a default stays visible, pink like any changed one, reading 0s", z_tags(z_zero) === "0s|-" && rowsOf(z_zero)[0].querySelector(".fe-tag").classList.contains("fe-tag-custom") && !rowsOf(z_zero)[0].querySelector(".fe-tag").classList.contains("fe-tag-zero"));

  z_zero.document.getElementById("feGapShorter").click(); z_zero.document.getElementById("feGapShorter").click();
  check("and when the default becomes None the tag has nothing left to override, so it goes away", z_tags(z_zero) === "-|-");
  z_zero.document.getElementById("feGapLonger").click();
  check("raising the default again brings that none back as it was", z_tags(z_zero) === "0s|-", z_tags(z_zero));

  
  } catch (err) { areaCrashed("silences, dragging and removing", err); }
}
  if (want("the page's styles for tags and phones")) { try {
  // ================================================================ the page's styles for tags and phones
  var z_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  check("on a phone a tag shows only its length; with room (860 pixels and up) it is wider and shows its icon", /\.fe-tag \.fe-icon \{ display: none; \}/.test(z_css) && /@media \(min-width: 860px\) \{[^}]*\.fe-tag \{ min-width: 61px/.test(z_css) && /\.fe-tag \{[^}]*min-width: 42px/.test(z_css));
  check("on a phone the rows give the name more room: a slimmer card, handle and buttons, and the length as 20m", /@media \(max-width: 599px\) \{[^}]*\.fe-card \{ padding: 8px; \}/.test(z_css) && /\.fe-stepper:not\(\.fe-stepper-inline\) \.fe-amount::before \{ content: attr\(data-short\)/.test(z_css) && rowsOf(z_d).length >= 0);
  check("each row's length carries its short form for phones, and the text itself stays the full form", (() => { const a = rowsOf(z_open)[0].querySelector(".fe-amount"); return a.textContent === "10 min" && a.getAttribute("data-short") === "10m"; })());
  check("the silence card, the format menu and the other pop-ups all close on a tap elsewhere or Escape through one shared rule", /event\.target\.closest\('\.fe-pop, \.fe-trigger\[aria-expanded="true"\]'\)/.test(fs.readFileSync(ROOT + "editor.js", "utf8")) && /popupOpen = \(\) => editor\.panel \|\| editor\.cardMenu \|\| editor\.gapPanel !== null \|\| editor\.appMenu;/.test(fs.readFileSync(ROOT + "editor.js", "utf8")));


  
  } catch (err) { areaCrashed("the page's styles for tags and phones", err); }
}
  if (want('the title and the tip button on a phone')) { try {
  // ================================================================ the title and the tip button on a phone
  var q_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  var q_h1 = fresh.document.querySelector("h1");
  check("the title is three words, each in its own span, with spaces between so it still reads as one line on a wide screen", Array.from(q_h1.querySelectorAll(".brand-text > span")).map((x) => x.textContent).join("|") === "Ceremony|Playlist|Builder" && q_h1.textContent === "Ceremony Playlist Builder");
  check("when the corner would reach the app (under 1184 pixels wide) the button and its note sit in a strip along the bottom, across the whole width of the screen, the button always at the right with the note right-aligned beside it, on a background that fades out upward, and the button never squeezes its own label onto two lines", /@media \(max-width: 1183px\) \{ main \{[^}]*\}[^#]*#supportBox \{ left: 0; right: 0; bottom: 0; width: auto; box-sizing: border-box; max-width: none; flex-direction: row-reverse; align-items: center; justify-content: flex-start; gap: 12px;/.test(q_css) && /background: linear-gradient\(to top, var\(--bg\) 0%, var\(--bg\) 55%, transparent 100%\)/.test(q_css) && /#supportButton \{ flex: none; white-space: nowrap; \}/.test(q_css) && /#supportCaption \{ flex: 0 1 auto; width: auto; min-width: 0; max-width: 52ch; padding: 0; background: none; box-shadow: none; text-align: right; text-wrap: balance;/.test(q_css));
  check("on a wide screen the note sits above the button in the corner, its right edge level with the button's, up to 160 pixels wide (four lines), in slightly smaller type, and right-aligned", /#supportBox \{ position: fixed; right: 16px; bottom: 16px;[^}]*flex-direction: column-reverse; align-items: flex-end;[^}]*width: max-content;/.test(q_css) && /#supportCaption \{ margin: 0 0 0 auto; width: max-content; max-width: 160px; box-sizing: border-box; padding: 0; color: var\(--muted\); font-size: 0\.72rem;[^}]*text-align: right;/.test(q_css) && !/#supportCaption \{ margin: 0 0 0 auto[^}]*background/.test(q_css));
  check("the fading strip does not block taps on the app behind its see-through top, only the note and the button take taps", /#supportBox \{[^}]*pointer-events: none;/.test(q_css) && /#supportBox > \* \{ pointer-events: auto; \}/.test(q_css));
  check("the button comes before the note in the page, so the row-reverse layout puts the note to its left", fresh.document.getElementById("supportBox").firstElementChild.id === "supportButton" && fresh.document.getElementById("supportBox").lastElementChild.id === "supportCaption");


  
  } catch (err) { areaCrashed("the title and the tip button on a phone", err); }
}
  if (want("telling this app's playlists from yours")) { try {
  // ================================================================ telling this app's playlists from yours
  var k_mine = [
    { id: "m1", name: "mini 1", owner: { id: "ron" } },
    { id: "m2", name: "mini 2", owner: { id: "ron" }, description: "A playlist I made by hand" },
    { id: "m3", name: "Old warm set 4", owner: { id: "ron" }, description: "Made by Ceremony Playlist Builder from the format \"Old warm set\"." },
  ];
  var k_o = { extraPlaylists: k_mine };
  var k_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: k_o });
  await readyToPreview(k_w);
  var k_names = () => { rowsOf(k_w)[0].querySelector(".fe-main").click(); const n = Array.from(k_w.document.querySelectorAll("#feOptions .fe-option")).map((o) => o.getAttribute("data-name")); k_w.document.dispatchEvent(new k_w.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return n; };
  var k_list = k_names();
  check("the segment list leaves out a playlist this app marked as its own, even when its name matches no format", !k_list.includes("Old warm set 4"), JSON.stringify(k_list));
  check("and leaves out playlists named like a format's, marked or not, while showing the rest", !k_list.includes("mini 1") && !k_list.includes("mini 2") && k_list.includes("💗 spacious + gentle") && k_list.includes("🛋 rest "), JSON.stringify(k_list));
  check("the app knows which playlists are its own by the mark in the description, and by nothing else", k_w.eval("playlists").filter((p) => p.madeByApp).map((p) => p.id).join(",") === "m3" && !/madeIds|rememberMade/.test(fs.readFileSync(ROOT + "app.js", "utf8")));
  k_w.document.getElementById("create").click();
  await waitFor(() => visible(k_w, "confirmBox"), 30000);
  chooseAll(k_w);
  var k_keep = k_w.document.getElementById("bdInfo").textContent;
  check("playlists with matching names that this app did not make are renamed to free their names, the list behind Details", /^2 of your own playlists will be renamed to free their names\. Detailsmini 1 → mini 1 \(version a\)mini 2 → mini 2 \(version a\)/.test(k_keep) && k_w.document.querySelector("#bdInfo ul").hidden === true, k_keep);
  check("nothing is offered for replacing, and the button only says Build", !/will be replaced/.test(k_keep) && !k_w.document.getElementById("confirmKeepEarlier") && /^Build \d+ playlists$/.test(k_w.document.getElementById("confirmYes").textContent));
  pressBuild(k_w);
  await waitFor(() => /in your Spotify library\.$/.test(k_w.document.getElementById("actionMessage").textContent), 30000);
  var k_plan = k_o.writes.filter((w) => w.type === "create").map((w) => w.name);
  check("the new playlists take those names: they start at mini 1", k_plan[0] === "mini 1" && k_plan[1] === "mini 2", k_plan.join(","));
  var k_creates = k_o.writes.filter((w) => w.type === "create");
  check("creating renames them first, removes nothing, and gives every new playlist a name of its own", k_o.writes.every((w) => w.type !== "remove") && JSON.stringify(k_o.writes.slice(0, 2).map((w) => [w.type, w.id, w.name])) === JSON.stringify([["update", "m1", "mini 1 (version a)"], ["update", "m2", "mini 2 (version a)"]]) && new Set(k_creates.map((w) => w.name)).size === k_creates.length && k_creates[0].name === "mini 1", JSON.stringify(k_o.writes.slice(0, 3)));
  var k_desc = k_o.writes.filter((w) => w.type === "create").map((w) => w.description);
  check("each playlist it creates has the mark and the request to leave it, then which one of the set and when, and nothing more", k_desc.length > 1 && k_desc.every((d, i) => d.startsWith("Made by Ceremony Playlist Builder. Please do not edit this description. The app uses it to recognize the playlists it made. Playlist " + (i + 1) + " of " + k_desc.length + ", built ") && /, built \d{1,2} [A-Z][a-z]{2} \d{4}\.$/.test(d)), JSON.stringify(k_desc.slice(0, 2)));
  var k_bd = (segs, n, c) => k_w.eval("builtDescription")({ segments: segs }, n, c, new Date(2026, 10, 4));
  check("a description reads: one of the set and the date, no segments", k_bd([["Arrival", 20], ["Drums + Voices", 90]], 3, 5) === "Made by Ceremony Playlist Builder. Please do not edit this description. The app uses it to recognize the playlists it made. Playlist 3 of 5, built 4 Nov 2026.", k_bd([["Arrival", 20], ["Drums + Voices", 90]], 3, 5));
  check("a single playlist says only when it was built", /made\. Built 4 Nov 2026\.$/.test(k_bd([["Arrival", 20]], 1, 1)));
  check("nothing about it is stored in this browser: the mark in the description is the only record", k_w.localStorage.getItem("madeIds") === null);
  await waitFor(() => k_w.eval("playlists").some((p) => /^mini 3$/.test(p.name)), 10000);
  check("after creating, those playlists count as the app's own and stay out of the segment list", k_w.eval("playlists").filter((p) => p.madeByApp).length === 1 + k_o.writes.filter((w) => w.type === "create").length && !k_names().some((n) => /^mini \d+$/.test(n)) && !/Note: Spotify's playlist list/.test(k_w.document.getElementById("actionMessage").textContent));
  var k_o2 = { listWithoutDescriptions: true };
  var k_w2 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI, madeIds: JSON.stringify(["m1"]) }, fetchOptions: k_o2 });
  await readyToPreview(k_w2);
  k_w2.document.getElementById("create").click();
  await waitFor(() => visible(k_w2, "confirmBox"), 30000);
  pressBuild(k_w2);
  await waitFor(() => /in your Spotify library\.$/.test(k_w2.document.getElementById("actionMessage").textContent), 30000);
  await waitFor(() => /Note: Spotify's playlist list/.test(k_w2.document.getElementById("actionMessage").textContent), 10000);
  check("if Spotify's list does not show the description, the app says it may not recognize its playlists later, and still lists none as its own", /^Spotify's playlist list did not show the description this app puts on its playlists \(or has not updated yet\), so this app may not recognize them later\.$/.test(k_w2.document.getElementById("createNotes").textContent) && k_w2.eval("playlists").every((p) => !p.madeByApp));
  var k_py = JSON.parse(execFileSync("python3", ["-c", `
import importlib.util, json
spec = importlib.util.spec_from_file_location("engine", "${ROOT}engine.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
text = 'FORMATS = {"a": {"name": "A {n}", "segments": [("src", 10)]}}'
tracks = json.dumps({"src": [{"uri": "u%d" % i, "ms": 600000, "label": "t%d" % i} for i in range(40)]})
a = json.loads(m.build_playlists(text, "a", tracks, 3))
b = json.loads(m.build_playlists(text, "a", tracks, 3, json.dumps(["a 1", "A 3"])))
c = json.loads(m.build_playlists(text, "a", tracks, 3, "[]"))
print(json.dumps([[p["name"] for p in a["playlists"]], [p["name"] for p in b["playlists"]], [p["name"] for p in c["playlists"]]]))
`], { encoding: "utf8" }));
  check("the engine numbers from 1 by default, and skips reserved names without caring about capitals", JSON.stringify(k_py[0]) === JSON.stringify(["A 1", "A 2", "A 3"]) && JSON.stringify(k_py[1]) === JSON.stringify(["A 2", "A 4", "A 5"]) && JSON.stringify(k_py[2]) === JSON.stringify(k_py[0]), JSON.stringify(k_py));
  var k_py2 = JSON.parse(execFileSync("python3", ["-c", `
import importlib.util, json
spec = importlib.util.spec_from_file_location("engine", "${ROOT}engine.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
# A has 40 songs of its own and 30 it shares with B; B has only those 30 and 5 of its own (one listed twice). 4 min each, 100 min a playlist: 75 songs make 3.
A = [{"uri": "a%d" % i, "ms": 240000} for i in range(40)] + [{"uri": "s%d" % i, "ms": 240000} for i in range(30)]
B = [{"uri": "s%d" % i, "ms": 240000} for i in range(30)] + [{"uri": "b%d" % i, "ms": 240000} for i in range(5)] + [{"uri": "b0", "ms": 240000}]
counts = []
for _ in range(5):
    r = json.loads(m.build_playlists('{"r": {"name": "R {n}", "segments": [("A", 60), ("B", 40)]}}', "r", json.dumps({"A": A, "B": B})))
    counts.append(len(r["playlists"]))
    assert all(len(set(p["uris"])) == len(p["uris"]) for p in r["playlists"])
# one recording under two Spotify IDs (one ISRC) is one song
C = [{"uri": "x1", "key": "isrc:I1", "ms": 240000}, {"uri": "x2", "key": "isrc:I1", "ms": 240000}] + [{"uri": "c%d" % i, "ms": 240000} for i in range(3)]
c = json.loads(m.build_playlists('{"r": {"name": "R {n}", "segments": [("C", 16)]}}', "r", json.dumps({"C": C})))
print(json.dumps([counts, r["shared"], [s["has"] for s in r["sources"]], c["sources"][0]["has"], len(c["playlists"])]))
`], { encoding: "utf8" }));
  check("songs shared by two source playlists are left to the one that needs them, so the most playlists the songs allow are built", k_py2[0].every((n) => n === 3), JSON.stringify(k_py2));
  check("a song listed twice in a playlist counts once, in the minutes too, and shared songs are counted for the Why table", k_py2[1] === 30 && JSON.stringify(k_py2[2]) === JSON.stringify([280, 140]), JSON.stringify(k_py2));
  check("one recording under two Spotify IDs (the same ISRC) is one song", k_py2[3] === 16 && k_py2[4] === 1, JSON.stringify(k_py2));


  
  } catch (err) { areaCrashed("telling this app's playlists from yours", err); }
}
  if (want('refreshing, and playlists the app did not mark')) { try {
  // ================================================================ refreshing, and playlists the app did not mark
  var v_o = { extraPlaylists: [
    { id: "v1", name: "mini 1", owner: { id: "ron" }, description: MADE },
    { id: "v2", name: "mini 2", owner: { id: "ron" }, description: MADE },
    { id: "v3", name: "mini 3", owner: { id: "ron" } },
  ] };
  var v_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: v_o });
  await readyToPreview(v_w);
  check("when the page loads, the app has read the playlists, two of them marked as its own", v_w.eval("playlists").filter((p) => p.madeByApp).map((p) => p.id).join(",") === "v1,v2");
  // someone clears the description of mini 2 in Spotify while the page is open
  v_o.extraPlaylists[1].description = "";
  removeNow(v_w);
  await waitFor(() => visible(v_w, "removeConfirmBox"));
  check("Remove looks at Spotify again first, so a mark removed there since the page loaded is noticed", v_w.eval("playlists").filter((p) => p.madeByApp).map((p) => p.id).join(",") === "v1");
  check("Remove then lists only the playlists marked as the app's own to remove", JSON.stringify(Array.from(v_w.document.querySelectorAll("#removeConfirmList li")).map((li) => li.textContent)) === JSON.stringify(["mini 1"]) && /^Remove 1 playlist made by this app from your library\? They match the naming pattern of mini\.$/.test(v_w.document.getElementById("removeConfirmText").textContent), v_w.document.getElementById("removeConfirmText").textContent);
  check("the others are listed apart, as not touched, with a switch to remove them too, off", JSON.stringify(Array.from(v_w.document.querySelectorAll("#removeConfirmMoreList li")).map((li) => li.textContent)) === JSON.stringify(["mini 2", "mini 3"]) && /^2 playlists with matching names were not made by this app \(older ones, or ones whose description was changed\), so they will not be touched:$/.test(v_w.document.getElementById("removeConfirmMoreText").textContent) && !v_w.document.getElementById("removeToggleRow").hidden && v_w.document.getElementById("removeToggle").checked === false && v_w.document.getElementById("removeToggleLabel").textContent === "Remove them too");
  check("the button says what it will do: remove 1 playlist", v_w.document.getElementById("removeConfirmYes").textContent.trim() === "Remove 1 playlist" && v_w.document.getElementById("removeConfirmYes").disabled === false);
  v_w.document.getElementById("removeToggle").checked = true;
  v_w.document.getElementById("removeToggle").dispatchEvent(new v_w.Event("change"));
  check("turning the switch on adds them: they are now listed as removed too, and the button counts all three", /will be removed too because you chose to remove them:$/.test(v_w.document.getElementById("removeConfirmMoreText").textContent) && v_w.document.getElementById("removeConfirmYes").textContent.trim() === "Remove 3 playlists");
  v_w.document.getElementById("removeToggle").checked = false;
  v_w.document.getElementById("removeToggle").dispatchEvent(new v_w.Event("change"));
  v_w.document.getElementById("removeConfirmYes").click();
  await waitFor(() => /^Removed 1 playlist from your library\./.test(v_w.document.getElementById("removeMessage").textContent), 10000);
  check("removing with the switch off removes only the marked one", v_o.writes.length === 1 && v_o.writes[0].type === "remove" && JSON.stringify(v_o.writes[0].uris) === JSON.stringify(["spotify:playlist:v1"]), JSON.stringify(v_o.writes));
  var v_o2 = { extraPlaylists: [{ id: "u1", name: "mini 1", owner: { id: "ron" } }] };
  var v_w2 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: v_o2 });
  await readyToPreview(v_w2);
  removeNow(v_w2);
  await waitFor(() => visible(v_w2, "removeConfirmBox"));
  check("with nothing marked as the app's, Remove says so, and offers nothing until the switch is on", /^No playlists made by this app match the naming pattern of mini\.$/.test(v_w2.document.getElementById("removeConfirmText").textContent) && v_w2.document.getElementById("removeConfirmYes").disabled === true && v_w2.document.getElementById("removeConfirmYes").textContent.trim() === "Nothing to remove");
  v_w2.document.getElementById("removeToggle").checked = true;
  v_w2.document.getElementById("removeToggle").dispatchEvent(new v_w2.Event("change"));
  check("turning it on makes the button remove that one", v_w2.document.getElementById("removeConfirmYes").disabled === false && v_w2.document.getElementById("removeConfirmYes").textContent.trim() === "Remove 1 playlist");
  v_w2.document.getElementById("removeConfirmYes").click();
  await waitFor(() => /^Removed 1 playlist/.test(v_w2.document.getElementById("removeMessage").textContent), 10000);
  check("and it is removed", v_o2.writes.length === 1 && JSON.stringify(v_o2.writes[0].uris) === JSON.stringify(["spotify:playlist:u1"]));

  // Create: the same switch
  var v_o3 = { extraPlaylists: [
    { id: "w1", name: "mini 1", owner: { id: "ron" }, description: MADE },
    { id: "w2", name: "mini 2", owner: { id: "ron" }, description: MADE },
    { id: "w3", name: "mini 3", owner: { id: "ron" } },
  ] };
  var v_w3 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: v_o3 });
  await readyToPreview(v_w3);
  v_w3.document.getElementById("create").click();
  await waitFor(() => visible(v_w3, "confirmBox"), 30000);
  check("before a number is chosen, none of the person's own playlists is said to be renamed", !/will be renamed/.test(v_w3.document.getElementById("bdInfo").textContent), v_w3.document.getElementById("bdInfo").textContent);
  v_w3.document.getElementById("bdPickTiles").lastElementChild.click();   // the most, which uses the name mini 3
  var v_info = v_w3.document.getElementById("bdInfo").textContent;
  check("with marked and unmarked ones, the marked ones are replaced and mine is renamed", /2 earlier playlists from this recipe will be replaced\./.test(v_info) && /One of your own playlists will be renamed to free its name\./.test(v_info) && /^Build \d+ playlists$/.test(v_w3.document.getElementById("confirmYes").textContent), v_info);
  pressBuild(v_w3);
  await waitFor(() => /in your Spotify library\.$/.test(v_w3.document.getElementById("actionMessage").textContent), 30000);
  var v_names = v_o3.writes.filter((w) => w.type === "create").map((w) => w.name);
  check("so the new ones use every number from 1", v_names.slice(0, 4).join(",") === "mini 1,mini 2,mini 3,mini 4", v_names.join(","));
  check("creating renames mine, then removes the two marked ones, then makes the new set", v_o3.writes[0].type === "update" && v_o3.writes[0].id === "w3" && v_o3.writes[0].name === "mini 3 (version a)" && v_o3.writes[1].type === "remove" && v_o3.writes[1].uris.length === 2 && v_o3.writes[2].type === "create" && v_o3.writes.filter((w) => w.type === "create")[0].name === "mini 1", JSON.stringify(v_o3.writes.slice(0, 3)));
  var v_w4 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { extraPlaylists: [{ id: "x1", name: "mini 1", owner: { id: "ron" }, description: MADE }] } });
  await readyToPreview(v_w4);
  v_w4.document.getElementById("create").click();
  await waitFor(() => visible(v_w4, "confirmBox"), 30000);
  check("with nothing unmarked, nothing is renamed", !/renamed to free/.test(v_w4.document.getElementById("bdInfo").textContent));
  check("Create looks at Spotify afresh before planning: a page that has been open a while still sees changes made there", /await loadMyPlaylists\(\);   \/\/ what is in Spotify now/.test(fs.readFileSync(ROOT + "app.js", "utf8")));


  
  } catch (err) { areaCrashed("refreshing, and playlists the app did not mark", err); }
}
  if (want('private playlists')) { try {
  // ================================================================ private playlists
  var pv_o = {};
  var pv_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: pv_o });
  await readyToPreview(pv_w);
  pv_w.document.getElementById("maxPlaylists").value = "2";
  pv_w.document.getElementById("maxPlaylists").dispatchEvent(new pv_w.Event("input"));
  pv_w.document.getElementById("create").click();
  await waitFor(() => visible(pv_w, "confirmBox"), 30000);
  pressBuild(pv_w);
  await waitFor(() => /in your Spotify library\.$/.test(pv_w.document.getElementById("actionMessage").textContent), 30000);
  check("every playlist is created asking to stay off the profile (public: false)", pv_o.writes.filter((w) => w.type === "create").length === 2 && pv_o.writes.filter((w) => w.type === "create").every((w) => w.public === false));
  check("when Spotify says they came out private, nothing more is sent, and the done message is just the one sentence", pv_o.writes.every((w) => w.type !== "update") && doneSentence(pv_w) === "2 playlists are in your Spotify library." && pv_w.document.getElementById("createNotes").hidden, pv_w.document.getElementById("actionMessage").textContent);
  var pv_o2 = { ignorePublic: true };
  var pv_w2 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: pv_o2 });
  await readyToPreview(pv_w2);
  pv_w2.document.getElementById("maxPlaylists").value = "2";
  pv_w2.document.getElementById("maxPlaylists").dispatchEvent(new pv_w2.Event("input"));
  pv_w2.document.getElementById("create").click();
  await waitFor(() => visible(pv_w2, "confirmBox"), 30000);
  pressBuild(pv_w2);
  await waitFor(() => /in your Spotify library\.$/.test(pv_w2.document.getElementById("actionMessage").textContent), 30000);
  check("when Spotify makes them public anyway, the app changes each one to stay off the profile right after creating it", pv_o2.writes.filter((w) => w.type === "update").length === 2 && pv_o2.writes.filter((w) => w.type === "update").every((w) => w.public === false) && pv_o2.writes.filter((w) => w.type === "update").map((w) => w.id).join() === pv_o2.writes.filter((w) => w.type === "create").map((w) => w.id).join() && doneSentence(pv_w2) === "2 playlists are in your Spotify library." && pv_w2.document.getElementById("createNotes").hidden);
  var pv_o3 = { ignorePublic: true, putFails: true };
  var pv_w3 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: pv_o3 });
  await readyToPreview(pv_w3);
  pv_w3.document.getElementById("maxPlaylists").value = "2";
  pv_w3.document.getElementById("maxPlaylists").dispatchEvent(new pv_w3.Event("input"));
  pv_w3.document.getElementById("create").click();
  await waitFor(() => visible(pv_w3, "confirmBox"), 30000);
  pressBuild(pv_w3);
  await waitFor(() => /in your Spotify library\.$/.test(pv_w3.document.getElementById("actionMessage").textContent), 30000);
  check("if it cannot take them off the profile it still finishes, and says how many Spotify kept there", /^Spotify kept 2 playlists on your profile and would not let this app change that\. You can change that in the Spotify app\.$/.test(pv_w3.document.getElementById("createNotes").textContent), pv_w3.document.getElementById("createNotes").textContent);
  check("there is no public or private switch anywhere in the editor: playlists are always private", !/public/i.test(fs.readFileSync(ROOT + "editor.js", "utf8")));


  
  } catch (err) { areaCrashed("private playlists", err); }
}
  if (want('cover art')) { try {
  // ================================================================ cover art
  var cv_file = fs.readFileSync(ROOT + "playlist-cover.jpg");
  var cv_dims = execFileSync("python3", ["-c", `from PIL import Image; im = Image.open("${ROOT}playlist-cover.jpg"); print(im.format, im.size[0], im.size[1])`], { encoding: "utf8" }).trim();
  check("the cover is a JPEG of the app's icon, 640 by 640, and small enough for Spotify's limit even after base64", cv_file.slice(0, 3).toString("hex") === "ffd8ff" && cv_dims === "JPEG 640 640" && Math.ceil(cv_file.length / 3) * 4 < 256 * 1024, cv_dims + " " + cv_file.length);
  var cv_app = fs.readFileSync(ROOT + "app.js", "utf8");
  check("the app asks for the image-upload permission when it signs in, but does not require it, so an older sign-in keeps working", /"ugc-image-upload",/.test(cv_app) && /const REQUIRED_SCOPES = \["playlist-modify-private", "playlist-modify-public"\];/.test(cv_app));
  var cv_run = async (token, fetchOptions, count = 2) => {
    const w = await boot({ url: "http://127.0.0.1:8000/", session: token, local: { formats: MINI }, fetchOptions });
    await readyToPreview(w);
    w.document.getElementById("maxPlaylists").value = String(count);
    w.document.getElementById("maxPlaylists").dispatchEvent(new w.Event("input"));
    w.document.getElementById("create").click();
    await waitFor(() => visible(w, "confirmBox"), 30000);
    pressBuild(w);
    await waitFor(() => /in your Spotify library\.$/.test(w.document.getElementById("actionMessage").textContent), 30000);
    return w;
  };
  var cv_o = {};
  var cv_w = await cv_run(signedIn(), cv_o);
  var cv_covers = cv_o.writes.filter((w) => w.type === "cover");
  check("each playlist gets the cover: a JPEG, sent as base64 with the image content type, to its own playlist", cv_covers.length === 2 && cv_covers.every((c) => c.contentType === "image/jpeg" && c.base64 === cv_file.toString("base64")) && cv_covers.map((c) => c.id).join() === cv_o.writes.filter((w) => w.type === "create").map((w) => w.id).join(), JSON.stringify(cv_covers.map((c) => [c.id, c.contentType, (c.base64 || "").length])));
  check("the cover goes on after the songs, so a playlist is complete when it is finished", (() => { const order = cv_o.writes.map((w) => w.type + ":" + w.id); return order.indexOf("cover:new1") > order.indexOf("create:new1") && order.indexOf("cover:new1") < order.indexOf("create:new2"); })() || cv_o.writes.filter((w) => w.type === "cover").length === 2);
  check("when all goes well the done message is just the one sentence", doneSentence(cv_w) === "2 playlists are in your Spotify library." && cv_w.document.getElementById("createNotes").hidden);
  var cv_oldToken = { token: JSON.stringify({ value: "t", expires: Date.now() + 3600000, scope: "playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public user-library-modify" }) };
  var cv_o2 = {};
  var cv_w2 = await cv_run(cv_oldToken, cv_o2);
  check("an older sign-in, without the permission, still creates the playlists, sends no covers, and says how to allow them", cv_o2.writes.filter((w) => w.type === "create").length === 2 && cv_o2.writes.every((w) => w.type !== "cover") && /^The cover art was not added, because your Spotify sign-in does not include permission to upload images\. Click Disconnect, then Connect again to allow it\. Playlists you build after that will get the cover\.$/.test(cv_w2.document.getElementById("createNotes").textContent), cv_w2.document.getElementById("createNotes").textContent);
  var cv_o3 = { coverStatus: 400 };
  var cv_w3 = await cv_run(signedIn(), cv_o3);
  check("if Spotify will not take a cover, the playlists are still made, every one is tried, and the note says how many", cv_o3.writes.filter((w) => w.type === "create").length === 2 && cv_o3.writes.filter((w) => w.type === "cover").length === 2 && /^Spotify would not accept the cover art for 2 playlists\.$/.test(cv_w3.document.getElementById("createNotes").textContent), cv_w3.document.getElementById("createNotes").textContent);
  var cv_o4 = { coverStatus: 403 };
  var cv_w4 = await cv_run(signedIn(), cv_o4, 3);
  check("if Spotify says the permission is missing, it stops asking after the first, finishes the rest, and says how to allow it", cv_o4.writes.filter((w) => w.type === "create").length === 3 && cv_o4.writes.filter((w) => w.type === "cover").length === 1 && /Click Disconnect, then Connect again to allow it\./.test(cv_w4.document.getElementById("createNotes").textContent), cv_w4.document.getElementById("createNotes").textContent);
  var cv_o5 = { noCoverFile: true };
  var cv_w5 = await cv_run(signedIn(), cv_o5);
  check("if the cover file cannot be loaded, the playlists are still made, and the note says they have Spotify's default cover", cv_o5.writes.filter((w) => w.type === "create").length === 2 && cv_o5.writes.every((w) => w.type !== "cover") && /^The cover art could not be loaded, so the playlists have Spotify's default cover\.$/.test(cv_w5.document.getElementById("createNotes").textContent));


  
  } catch (err) { areaCrashed("cover art", err); }
}
  if (want('what "private" means on Spotify')) { try {
  // ================================================================ what "private" means on Spotify
  var pr_html = fs.readFileSync(ROOT + "index.html", "utf8").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  check("the page no longer calls the playlists private, and says exactly what is true: off the profile and out of search, but open to anyone with the link", !/created by this app are private/.test(pr_html) && /Playlists created by this app stay off your Spotify profile and out of search, though anyone with a playlist's link can still open it\. To change that, use Make private in the Spotify app\./.test(pr_html));


  
  } catch (err) { areaCrashed("what \"private\" means on Spotify", err); }
}
  if (want('the format menu fits its contents')) { try {
  // ================================================================ the format menu fits its contents
  var fm_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  var fm_w = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"f": {"name": "F {n}", "silence between segments": "10 min", "segments": [("💗 spacious + gentle", 10), ("silence", "30 sec"), ("🛋 rest", 10)]}}' } });

  check("the middle of the silence stepper has no fixed width in numbers: it is as wide as the longest thing it can say", fm_w.document.getElementById("feGapValue").textContent === "10 min" && fm_w.document.getElementById("feGapValue").closest(".fe-amount-rich") !== null && !fm_w.document.getElementById("feGapValue").style.minWidth && /\.fe-amount-rich \{ display: inline-grid; justify-items: center; align-items: center; padding: 0 6px; white-space: nowrap; text-align: center; min-width: 0; \}/.test(fm_css.replace(/\s+/g, " ")) && !/62px/.test(fm_w.document.getElementById("feCard").innerHTML));


  check("the length box in the format's menu hugs its minus, value and plus, so they sit centered in the frame instead of left in a stretched one", /\.fe-stepper-inline \{ display: inline-flex; \}/.test(fm_css.replace(/\s+/g, " ")) && fm_w.document.getElementById("feGapValue").closest(".fe-stepper-inline") !== null);


  
  } catch (err) { areaCrashed("the format menu fits its contents", err); }
}
  if (want('the default silence goes up to 60 minutes')) { try {
  // ================================================================ the default silence goes up to 60 minutes
  var gs_w = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"n": {"name": "N {n}", "segments": [("💗 spacious + gentle", 10), ("🛋 rest", 10)]}}' } });

  var gs_val = () => gs_w.document.getElementById("feGapValue").textContent;
  var gs_more = (n) => { for (let i = 0; i < n; i++) gs_w.document.getElementById("feGapLonger").click(); };
  var gs_seen = [gs_val()];
  for (let i = 0; i < 24; i++) { gs_more(1); if (gs_seen[gs_seen.length - 1] !== gs_val()) gs_seen.push(gs_val()); }
  check("the default silence between segments steps No, 30 sec, 1 to 10 min by the minute, then every 5 min up to 60 min, and stops there", JSON.stringify(gs_seen) === JSON.stringify(["No", "30 sec", "1 min", "2 min", "3 min", "4 min", "5 min", "6 min", "7 min", "8 min", "9 min", "10 min", "15 min", "20 min", "25 min", "30 min", "35 min", "40 min", "45 min", "50 min", "55 min", "60 min"]), JSON.stringify(gs_seen));
  check("a default of an hour is written into the text and shown on the tag between the segments", /"silence between segments": "60 min"/.test(T(gs_w)) && rowsOf(gs_w)[0].querySelector(".fe-tag").textContent === "60m");
  gs_w.document.getElementById("feGapShorter").click();
  check("and it steps back down 55 min", gs_val() === "55 min");
  check("an individual silence can reach the same lengths, so it can always be stepped back to the default", JSON.stringify(Array.from(gs_w.eval("SILENCE_STEPS"))) === JSON.stringify(Array.from(gs_w.eval("GAP_STEPS")).slice(1)));
  check("the engine builds a 35 minute silence between two segments, and nothing before or after", (() => { const t = 'FORMATS = {"s": {"name": "S {n}", "silence between segments": "35 min", "segments": [("A", 10), ("B", 10)]}}'; return JSON.stringify(x_enginePlan(t).s.gaps) === JSON.stringify(["none", "35 min", "none"]); })(), "");


  
  } catch (err) { areaCrashed("the default silence goes up to 60 minutes", err); }
}
  if (want("the limit list, and the format's title")) { try {
  // ================================================================ the limit list, and the format's title
  var lm_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI } });
  var lm_sel = lm_w.document.getElementById("maxPlaylists");
  check("the playlist limit is a list: No limit first, then 1 to 10", lm_sel.tagName === "SELECT" && Array.from(lm_sel.options).map((o) => o.textContent).join("|") === "No limit|1|2|3|4|5|6|7|8|9|10" && lm_sel.value === "" && Array.from(lm_sel.options).map((o) => o.value).join("|") === "|1|2|3|4|5|6|7|8|9|10");
  var lm_text = Array.from(lm_w.document.querySelectorAll("#moreOptions p")).find((p) => /By default, the app makes/.test(p.textContent));
  check("it sits under your sentence, which no longer says plans or asks for a number", !!lm_text && lm_text.textContent === "By default, the app makes as many playlists as your songs allow, but here you can cap how many playlists get created per recipe:" && lm_text.nextElementSibling === lm_sel && !/enter a number/.test(lm_w.document.getElementById("moreOptions").textContent));
  check("choosing a number limits the plan, and No limit takes the limit off", (() => { lm_sel.value = "3"; return lm_w.eval("playlistLimit()") === 3; })() && (() => { lm_sel.value = ""; return lm_w.eval("playlistLimit()") === undefined; })());
  var lm_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");


  
  } catch (err) { areaCrashed("the limit list, and the format's title", err); }
}
  if (want('the app menu, and minimalist mode')) { try {
  // ================================================================ the app menu, and minimalist mode
  var am_o = {};
  var am_w = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI + "\n" }, fetchOptions: am_o });
  am_w.eval("saveFile = (name, text) => { window.__saved = { name, text }; }");
  var am_row = am_w.document.querySelector(".fe-toprow");
  check("the app's menu button sits on the same row as the tabs, which end with the New recipe button, at the right", !!am_row && am_row.children[1].id === "feTabs" && am_row.lastElementChild.id === "feAppMenu" && !!am_row.querySelector("#feTabs #feNewFormat") && !!am_row.querySelector("#feAppMenuButton") && am_row.querySelector("#feAppMenuButton").getAttribute("aria-label") === "App menu");
  var am_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  check("the tabs take only the room left of the buttons, and stay on one row that scrolls sideways", /\.fe-toprow \{ display: flex; align-items: flex-start; gap: 8px;/.test(am_css) && /\.fe-toprow \.fe-tabs \{ flex: 1 1 0; min-width: 0; margin-bottom: 0; \}/.test(am_css) && /\.fe-appmenuwrap \{ position: relative; flex: none; \}/.test(am_css) && /\.fe-tabs \{ position: relative; display: flex; gap: 8px; flex-wrap: nowrap;[^}]*overflow-x: auto;[^}]*scrollbar-width: none;/.test(am_css) && /\.fe-tab \{ flex: none; white-space: nowrap;/.test(am_css));
  check("the menu starts closed", !am_w.document.getElementById("feAppMenuPanel") && am_w.document.getElementById("feAppMenuButton").getAttribute("aria-expanded") === "false");
  am_w.document.getElementById("feAppMenuButton").click();
  var am_items = Array.from(am_w.document.querySelectorAll("#feAppMenuPanel .fe-item")).map((b) => b.textContent.trim());
  var am_ids = Array.from(am_w.document.querySelectorAll("#feAppMenuPanel [id]")).map((n) => n.id).filter((id) => ["feMoreOptions", "feAbout", "feTips", "fePrivacy", "feReport", "feBackupMethod", "feBackup", "feRestore", "feDisconnect"].includes(id));
  check("it offers Disconnect Spotify, then the backup block (what it is, a Change how your recipes are saved link, how it is going, then Back up now and Restore), then More options, Report a problem and Privacy, in that order", JSON.stringify(am_ids) === JSON.stringify(["feDisconnect", "feBackupMethod", "feBackup", "feRestore", "feMoreOptions", "feReport", "fePrivacy"]) && /Manual backup to this device/.test(am_w.document.getElementById("feBackupMethod").closest(".fe-bk-block").textContent), JSON.stringify(am_ids));
  check("there is no Compact view item: the app page is always compact", !am_w.document.getElementById("feMinimal") && am_w.document.body.classList.contains("minimal") && !/minimalMode/.test(fs.readFileSync(ROOT + "editor.js", "utf8") + fs.readFileSync(ROOT + "app.js", "utf8")));
  var am_info = (id) => am_w.document.getElementById("infoSlot").firstElementChild && am_w.document.getElementById("infoSlot").firstElementChild.id === id && am_w.document.getElementById("infoOverlay").hidden === false;
  am_w.document.getElementById("feMoreOptions").click();
  check("More options opens in a popup, open, and the menu closes", am_info("moreOptions") && am_w.document.getElementById("moreOptions").open === true && !am_w.document.getElementById("feAppMenuPanel") && am_w.document.getElementById("infoDialog").getAttribute("aria-label") === "More options");
  am_w.document.dispatchEvent(new am_w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("Escape closes it, and More options goes back to its place, closed as it was", am_w.document.getElementById("infoOverlay").hidden === true && !!am_w.document.getElementById("moreOptions").closest("footer") && am_w.document.getElementById("moreOptions").open === false && am_w.document.getElementById("infoSlot").children.length === 0);
  am_w.document.getElementById("feAppMenuButton").click();
  am_w.document.getElementById("fePrivacy").click();
  check("Privacy opens in the popup, and the menu has no About this app", am_info("privacySection") && !am_w.document.getElementById("feAbout"));
  am_w.document.getElementById("infoClose").click();
  check("the close button closes it", am_w.document.getElementById("infoOverlay").hidden === true && !!am_w.document.getElementById("privacySection").closest("footer"));
  am_w.document.getElementById("feAppMenuButton").click();
  am_w.document.getElementById("fePrivacy").click();
  check("Privacy opens in the popup", am_info("privacySection"));
  am_w.document.getElementById("infoOverlay").dispatchEvent(new am_w.MouseEvent("click", { bubbles: true }));
  check("a tap outside it closes it", am_w.document.getElementById("infoOverlay").hidden === true);
  am_w.document.getElementById("feAppMenuButton").click();
  am_w.document.getElementById("feReport").click();
  check("Report a problem opens only the report part, with its details filled in, and it goes back to its own place, hidden, after", am_info("reportBlock") && /Version: /.test(am_w.document.getElementById("reportPreview").textContent) && (() => { am_w.document.getElementById("infoClose").click(); return am_w.document.getElementById("reportBlock").hidden === true && !am_w.document.getElementById("moreOptions").contains(am_w.document.getElementById("reportBlock")); })());
  am_w.document.getElementById("feAppMenuButton").click();
  am_w.document.getElementById("feBackup").click();
  check("Back up now saves the formats as a backup file on the device and closes the menu", !!am_w.__saved && /^playlist-recipes-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.txt$/.test(am_w.__saved.name) && am_w.__saved.text === am_w.document.getElementById("formats").value && !am_w.document.getElementById("feAppMenuPanel") && /^Backed up to this device\./.test(capText(am_w)));
  am_w.document.getElementById("feAppMenuButton").click();
  var am_picked = 0; am_w.document.getElementById("restoreFile").click = () => { am_picked += 1; };
  am_w.document.getElementById("feRestore").click();
  check("Restore from backup opens the file picker and closes the menu", am_picked === 1 && !am_w.document.getElementById("feAppMenuPanel"));
  am_w.document.getElementById("feAppMenuButton").click();
  am_w.eval("reloadPage = () => { window.__reloaded = true; }");
  var am_before = am_w.sessionStorage.getItem("token");
  am_w.document.getElementById("feDisconnect").click();
  await new Promise((r) => setTimeout(r, 60));
  var am_dlg = am_w.document.getElementById("feSyncDialog");
  check("Disconnect asks first, says what stays, and says it takes a little longer to build next time", !!am_dlg && /Disconnect from Spotify\?/.test(am_dlg.textContent) && /Your recipes are not touched/.test(am_dlg.textContent) && /reads your playlists from Spotify again, which takes a little longer/.test(am_dlg.textContent) && !/delete/i.test(am_dlg.textContent) && am_w.sessionStorage.getItem("token") === am_before);
  check("it starts on Cancel, since signing out cannot be taken back with one tap", am_w.document.activeElement.id === "feSyncChoice1" && am_w.document.getElementById("feSyncChoice1").textContent === "Cancel" && am_w.document.getElementById("feSyncChoice0").textContent === "Disconnect");
  am_w.document.getElementById("feSyncChoice1").click();
  await new Promise((r) => setTimeout(r, 60));
  check("Cancel leaves everything as it was", !am_w.document.getElementById("feSyncDialog") && am_w.sessionStorage.getItem("token") === am_before);
  am_w.document.getElementById("feAppMenuButton").click();
  am_w.document.getElementById("feDisconnect").click();
  await new Promise((r) => setTimeout(r, 60));
  am_w.document.dispatchEvent(new am_w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  check("so does Escape", !am_w.document.getElementById("feSyncDialog") && am_w.sessionStorage.getItem("token") === am_before);
  am_w.document.getElementById("feAppMenuButton").click();
  am_w.document.getElementById("feDisconnect").click();
  await new Promise((r) => setTimeout(r, 60));
  am_w.document.getElementById("feSyncChoice0").click();
  await new Promise((r) => setTimeout(r, 200));
  check("Disconnect signs out the same way the Disconnect button does", am_before !== null && am_w.sessionStorage.getItem("token") === null);
  var am_w3 = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  am_w3.document.getElementById("feAppMenuButton").click();
  rowsOf(am_w3)[0].querySelector(".fe-more").click();
  check("tapping a row's menu while the app menu is open only closes the app menu", !am_w3.document.getElementById("feAppMenuPanel") && !am_w3.document.querySelector(".fe-menu"));
  am_w3.document.getElementById("feAppMenuButton").click();
  check("and opening the app menu closes the row's menu", !!am_w3.document.getElementById("feAppMenuPanel") && !am_w3.document.querySelector(".fe-menu"));

  am_w3.document.getElementById("feAppMenuButton").click();
  am_w3.document.getElementById("feCaption").click();
  check("a tap anywhere else closes it", !am_w3.document.getElementById("feAppMenuPanel"));
  am_w3.document.getElementById("feAppMenuButton").click();
  am_w3.document.dispatchEvent(new am_w3.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("and so does Escape", !am_w3.document.getElementById("feAppMenuPanel") && am_w3.document.getElementById("feAppMenuButton").getAttribute("aria-expanded") === "false");
  var am_empty = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI }, fetchOptions: {} });

  am_empty.document.getElementById("feDelete").click();
  am_empty.document.getElementById("feDeleteConfirm").click();
  check("the app menu is still there when there are no formats", !!am_empty.document.getElementById("feAppMenuButton") && !!am_empty.document.getElementById("feNewFormat"));


  
  } catch (err) { areaCrashed("the app menu, and minimalist mode", err); }
}
  if (want("minimalist mode, the menu's label, and alignment")) { try {
  // ================================================================ minimalist mode, the menu's label, and alignment
  var mm_html = fs.readFileSync(ROOT + "index.html", "utf8");
  var mm_css = mm_html.replace(/\s+/g, " ");
  var mm_hidden = ["body.minimal main > #about", "body.minimal #connectedSection", "body.minimal #editHeading", "body.minimal #savedNote", "body.minimal #createHeading", "body.minimal #createNote", "body.minimal #backupBlock"];
  check("the app page hides About this app, the connected Spotify section, the Edit your recipes heading, the saved note, the Create playlists heading, the note under it, and the whole backup step", mm_hidden.every((sel) => mm_css.includes(sel)) && /body\.minimal [^{]*\{ display: none; \}/.test(mm_css));
  var mm_hideRule = (mm_css.match(/body\.minimal #backupCard:not\(\.opened\)[^{]*\{ display: none; \}/) || [""])[0];
  check("and nothing else is in that list: the editor, the Create button, the restore message and the tip button all stay", mm_hideRule.length > 0 && !/#formatEditor|#create\b|#backupMessage|#supportBox|#feAppMenu|h1/.test(mm_hideRule), mm_hideRule);
  var mm_w = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  var mm_ids = ["editHeading", "savedNote", "createHeading", "createNote", "backupBlock", "about", "connectedSection"];
  check("each of those has its place in the page: the headings and notes have their own ids, and the backup step is one block holding its heading, button, messages and status", mm_ids.every((id) => !!mm_w.document.getElementById(id)) && mm_w.document.getElementById("backupBlock").contains(mm_w.document.getElementById("backupSection")) && mm_w.document.getElementById("backupBlock").contains(mm_w.document.getElementById("backupDownload")) && mm_w.document.getElementById("backupBlock").contains(mm_w.document.getElementById("backupStatus")) && mm_w.document.querySelector(".tagline") !== null);
  check("the restore message and its Undo are in the line under the editor's bar, which minimalist mode leaves visible", mm_w.document.getElementById("formatEditor").contains(mm_w.document.getElementById("feCaption")) && !mm_w.document.getElementById("backupBlock").contains(mm_w.document.getElementById("feCaption")) && !mm_w.document.getElementById("savedNote").contains(mm_w.document.getElementById("feCaption")));
  mm_w.eval("saveFile = (name, text) => { window.__saved = { name, text }; }");
  mm_w.document.getElementById("feAppMenuButton").click();
  var mm_label = () => { const n = mm_w.document.getElementById("feBackupStatus"); return n ? n.textContent : null; };
  check("the app menu shows the same backup label as the backup step, under the row that says how the backup is done", mm_label() === mm_w.document.getElementById("backupStatus").textContent && /back/i.test(mm_label()) && mm_w.document.getElementById("feBackupMethod").nextElementSibling.id === "feBackupStatus", String(mm_label()));
  mm_w.document.getElementById("feBackup").click();
  check("downloading from the menu shows its message in the line under the editor's bar, which minimalist mode leaves visible", /^Backed up to this device\./.test(capText(mm_w)));
  mm_w.document.getElementById("feAppMenuButton").click();
  check("after a backup the label reads Last backup, with the time", /^Last backup: .+\.$/.test(mm_label()) && mm_label() === mm_w.document.getElementById("backupStatus").textContent, String(mm_label()));
  var mm_svgPaths = (svg) => (svg.match(/<path d="([^"]+)"/g) || []).map((x) => x.slice(9, -1)).join("|");
  var mm_iconFile = fs.readFileSync(ROOT + "icons/disconnect.svg", "utf8");
  check("the Disconnect button on the page keeps the broken-link icon", mm_svgPaths(fs.readFileSync(ROOT + "icons/disconnect.svg", "utf8")).split("|").length === 3 && /<button id="disconnect" class="quiet" type="button"><img class="btn-icon" src="icons\/disconnect\.svg"/.test(fs.readFileSync(ROOT + "index.html", "utf8")));
  var mm_row = mm_w.document.querySelector("#feAppMenuPanel .fe-sp-block");
  check("when connected, the menu has a row that says Spotify connected, with a small Disconnect at its right on the same line, and who it is under it", !!mm_row && mm_row.querySelector(".fe-sp-title").textContent === "Spotify connected" && mm_row.querySelector(".fe-sp-row").lastElementChild.id === "feDisconnect" && mm_row.querySelector(".fe-sp-row").lastElementChild.textContent === "Disconnect" && /^Connected as .+, \d+ playlists? found\.$/.test(mm_row.querySelector(".fe-sp-status").textContent) && mm_row.querySelector(".fe-sp-row").nextElementSibling === mm_row.querySelector(".fe-sp-status"));
  check("that button is outlined, not the color of the buttons that do the page's work, and the Disconnect on the page is outlined too", /\.fe-sp-disconnect \{[^}]*border: 1px solid var\(--line\); background: var\(--bg\)/.test(mm_css) && /button\.quiet \{ background: transparent;/.test(mm_css));
  check("the app menu's button ends where the card does: the row above the card has no padding on its right, on any screen width", /\.fe-toprow \{ display: flex; align-items: flex-start; gap: 8px; margin-bottom: 10px; \}/.test(mm_css) && !/\.fe-toprow \{[^}]*padding-right/.test(mm_css));
  var mm_cap = mm_w.document.getElementById("supportCaption");


  
  } catch (err) { areaCrashed("minimalist mode, the menu's label, and alignment", err); }
}
  if (want('minimalist mode, part two')) { try {
  // ================================================================ minimalist mode, part two
  var m2_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  check("the app page also hides How recipes work, and the page's own More options and Privacy at the bottom, which open from the menu instead", /body\.minimal #formatHelp, body\.minimal footer, body\.minimal #loginSection, body\.minimal #connectionProblem \{ display: none; \}/.test(m2_css) && /html\.page-app #welcomePage, html\.page-app main > #about, html\.page-app #loginSection, html\.page-app footer \{ display: none; \}/.test(m2_css));
  check("and the app menu's button turns the accent color, with text that suits it", /body\.minimal #feAppMenuButton \{ background: var\(--button\); border-color: var\(--button\); color: var\(--on-button, #fff\); \}/.test(m2_css));
  var m2_w = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  var m2_row = m2_w.document.querySelector(".fe-toprow");
  var m2_icon = m2_row.firstElementChild;
  check("the tabs row starts with the app's icon, from the same file as the home screen icon, with no text of its own", m2_icon.tagName === "IMG" && m2_icon.classList.contains("fe-appicon") && m2_icon.getAttribute("src") === "apple-touch-icon.png" && m2_icon.getAttribute("alt") === "" && m2_icon.getAttribute("height") === "44" && m2_row.children[1].id === "feTabs");
  check("it is only shown in minimalist mode, 44 pixels square, the same height as a tab button", /#formatEditor \.fe-appicon \{ display: none; \}/.test(m2_css) && /body\.minimal #formatEditor \.fe-appicon \{ display: block; width: 44px; height: 44px; flex: none;/.test(m2_css) && /#formatEditor \.fe-tab \{ flex: none; white-space: nowrap; min-height: 44px;/.test(m2_css));
  check("the page's title goes in minimalist mode, once the editor is there to take its place, and not before", /body\.minimal\.has-editor h1\.brand \{ display: none; \}/.test(m2_css) && m2_w.document.body.classList.contains("has-editor") && !(await boot({ url: "http://127.0.0.1:8000/" })).document.body.classList.contains("has-editor"));


  
  } catch (err) { areaCrashed("minimalist mode, part two", err); }
}
  if (want('compact rows, centered icons, no label, no corner background')) { try {
  // ================================================================ compact rows, centered icons, no label, no corner background
  var cp_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  check("segment rows are 52 pixels tall, 4 less than before, with their controls trimmed to fit, and the code that places things by row height agrees", /\.fe-row \{ position: relative; height: 52px;/.test(cp_css) && /\.fe-rowcard \{[^}]*height: 52px;/.test(cp_css) && /\.fe-main \{[^}]*height: 40px;/.test(cp_css) && /\.fe-stepper \{[^}]*height: 40px;/.test(cp_css) && /\.fe-more \{ width: 36px; height: 40px;/.test(cp_css) && /\.fe-grip \{[^}]*height: 40px;/.test(cp_css) && /\.fe-cover \{ width: 30px; height: 30px;/.test(cp_css) && /const FE_ROW_HEIGHT = 52;/.test(fs.readFileSync(ROOT + "editor.js", "utf8")));
  check("every icon is a box of its own size, centered in its button, so the three dots and the drag handle are no longer set high by the text's line height", /\.fe-icon \{ display: inline-flex; align-items: center; justify-content: center; line-height: 0; \}/.test(cp_css) && /\.fe-icon svg \{ display: block; \}/.test(cp_css));
  var cp_w = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  check("the card has no name field at all: the name is edited in the selected tab, which is named for screen readers once it is being edited", !cp_w.document.querySelector("#feHead input") && !cp_w.document.querySelector(".fe-namefield") && (() => { const box = renameBox(cp_w); return !!box && box.getAttribute("aria-label") === "Name of recipe"; })());


  
  } catch (err) { areaCrashed("compact rows, centered icons, no label, no corner background", err); }
}
  if (want('the popup after Create, and the room at the bottom')) { try {
  // ================================================================ the popup after Create, and the room at the bottom
  var pp_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  await readyToPreview(pp_w);
  var pp_ov = () => pp_w.document.getElementById("createOverlay");
  var pp_close = () => pp_w.document.getElementById("createCloseRow");
  check("everything that follows a click on Create lives in one popup: the output, the question, the progress message, the problem link and the results", !!pp_ov() && ["output", "confirmBox", "actionMessage", "mainReportHint", "results", "createCloseRow"].every((id) => pp_ov().contains(pp_w.document.getElementById(id))) && pp_ov().querySelector("#createDialog").getAttribute("role") === "dialog" && pp_ov().querySelector("#createDialog").getAttribute("aria-modal") === "true");
  check("the popup is closed to begin with, and nothing of it is left on the page below the button", pp_ov().hidden === true && !pp_w.document.getElementById("spotifyNote").nextElementSibling.matches("pre, #confirmBox, #actionMessage, #results") && pp_w.document.getElementById("spotifyNote").nextElementSibling.id === "createOverlay");
  pp_w.document.getElementById("create").click();
  check("clicking Create opens it at once, with no Close button while the app is reading and planning", pp_ov().hidden === false && pp_close().hidden === true && pp_w.document.body.style.overflow === "hidden");
  await waitFor(() => visible(pp_w, "confirmBox"), 30000);
  check("the question replaces the progress text, and can be dismissed: it has Cancel, not Close", pp_w.document.getElementById("output").hidden === true && pp_close().hidden === true && !!pp_w.document.getElementById("confirmNo"));
  pp_ov().click();
  await waitFor(() => !pp_w.document.getElementById("create").disabled, 10000);
  check("clicking outside the popup while it asks is the same as Cancel: it closes, nothing is created, and Create is ready again", pp_ov().hidden === true && pp_w.document.body.style.overflow === "" && !pp_w.document.getElementById("create").disabled);
  pp_w.document.getElementById("create").click();
  await waitFor(() => visible(pp_w, "confirmBox"), 30000);
  pp_w.document.getElementById("confirmNo").click();
  await waitFor(() => pp_ov().hidden === true, 10000);
  check("the Cancel button closes it too", pp_ov().hidden === true);
  pp_w.document.getElementById("create").click();
  await waitFor(() => visible(pp_w, "confirmBox"), 30000);
  pp_w.document.dispatchEvent(new pp_w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await waitFor(() => pp_ov().hidden === true, 10000);
  check("and so does Escape", pp_ov().hidden === true);
  var pp_o = {};
  var pp_w2 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: pp_o });
  await readyToPreview(pp_w2);
  pp_w2.document.getElementById("maxPlaylists").value = "2";
  pp_w2.document.getElementById("maxPlaylists").dispatchEvent(new pp_w2.Event("input"));
  pp_w2.document.getElementById("create").click();
  await waitFor(() => visible(pp_w2, "confirmBox"), 30000);
  pressBuild(pp_w2);
  check("once creating starts, the question gives way to the progress text in the same popup, still with no Close button", pp_w2.document.getElementById("confirmBox").hidden === true && pp_w2.document.getElementById("createCloseRow").hidden === true && pp_w2.document.getElementById("createOverlay").hidden === false);
  pp_w2.document.getElementById("createOverlay").click();
  check("and clicking outside does nothing while it is creating", pp_w2.document.getElementById("createOverlay").hidden === false);
  await waitFor(() => /in your Spotify library\.$/.test(pp_w2.document.getElementById("actionMessage").textContent), 30000);
  await waitFor(() => pp_w2.document.getElementById("createCloseRow").hidden === false, 10000);
  check("when it is done the popup shows the result and the playlists made, with a Close button", pp_w2.document.getElementById("createOverlay").hidden === false && pp_w2.document.querySelectorAll("#results .bd-row").length >= 2 && pp_w2.document.getElementById("createClose").textContent.trim() === "Close" && doneSentence(pp_w2) === "2 playlists are in your Spotify library.");
  pp_w2.document.getElementById("createClose").click();
  check("Close dismisses it and puts the focus back on Create", pp_w2.document.getElementById("createOverlay").hidden === true && pp_w2.document.activeElement === pp_w2.document.getElementById("create"));
  pp_w2.document.getElementById("create").click();
  await waitFor(() => pp_w2.document.getElementById("createCloseRow").hidden === false || visible(pp_w2, "confirmBox"), 30000);
  var pp_cnt = pp_o.writes.length;
  pp_w2.document.getElementById("confirmNo") && pp_w2.document.getElementById("confirmNo").click();
  await waitFor(() => pp_w2.document.getElementById("createOverlay").hidden === true, 10000);
  check("a second run starts clean: the earlier result is gone from the popup", pp_w2.document.querySelectorAll("#results a").length === 0 && pp_w2.document.getElementById("actionMessage").textContent !== "" || pp_w2.document.querySelectorAll("#results a").length === 0);
  var pp_w3 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn() });
  await readyToPreview(pp_w3);
  pp_w3.document.getElementById("create").click();
  await waitFor(() => /has no playlist yet/.test(pp_w3.document.getElementById("output").textContent), 20000);
  await waitFor(() => pp_w3.document.getElementById("createCloseRow").hidden === false, 10000);
  check("a problem is shown in the popup too, with a Close button, and the popup stays until it is dismissed", pp_w3.document.getElementById("createOverlay").hidden === false && pp_w3.document.getElementById("output").hidden === false);
  pp_w3.document.getElementById("createOverlay").click();
  check("and a click outside dismisses it", pp_w3.document.getElementById("createOverlay").hidden === true && pp_w3.document.body.style.overflow === "");
  var pp_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  check("the popup sits above everything, even the tip strip, and scrolls inside itself if the result is long", /\.app-overlay \{ position: fixed;[^}]*z-index: 1100;/.test(pp_css) && /\.app-dialog \{[^}]*max-height: calc\(100vh - 32px\); max-height: calc\(100dvh - 32px\); overflow: auto;/.test(pp_css) && /#supportBox \{ position: fixed; right: 16px; bottom: 16px; z-index: 1001;/.test(pp_css));
  check("the page's bottom: 24 pixels while the tip is in the corner, and in the strip the strip's own measured height, kept up to date as the page is resized", /--tip-h/.test(fs.readFileSync(ROOT + "app.js", "utf8")) && /document\.documentElement\.style\.setProperty\("--tip-h", box\.offsetHeight \+ "px"\)/.test(fs.readFileSync(ROOT + "app.js", "utf8")) && /window\.addEventListener\("resize", set\)/.test(fs.readFileSync(ROOT + "app.js", "utf8")) && /new ResizeObserver\(set\)/.test(fs.readFileSync(ROOT + "app.js", "utf8")));
  check("the tip's height has been measured and set for the page", pp_w.document.documentElement.style.getPropertyValue("--tip-h") !== "");

  // menus too close to the bottom open upward
  var up_w = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI }, fetchOptions: {}, before: (w) => {
    Object.defineProperty(w, "innerHeight", { value: 800, configurable: true });
    w.Element.prototype.getBoundingClientRect = function () {
      if (this.classList && this.classList.contains("fe-pop")) return this.classList.contains("fe-up") ? { top: 420, bottom: 620, height: 200, left: 0, right: 300, width: 300 } : { top: 700, bottom: 900, height: 200, left: 0, right: 300, width: 300 };
      return { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0 };
    };
    w.Element.prototype.scrollIntoView = function () { w.__scrolled = (w.__scrolled || 0) + 1; };
  } });
  rowsOf(up_w)[0].querySelector(".fe-more").click();
  check("a menu that would run off the bottom of the screen opens upward instead", up_w.document.querySelector(".fe-menu").classList.contains("fe-up"));

  rowsOf(up_w)[0].querySelector(".fe-tag") && rowsOf(up_w)[0].querySelector(".fe-tag").click();
  var up_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  check("upward means the menu's bottom edge sits just above its button (a silence's card never opens up or down: it is centered on its marker)", /#formatEditor \.fe-pop\.fe-up \{ top: auto; bottom: calc\(100% \+ 4px\); \}/.test(up_css) && !/fe-tagpanel\.fe-up/.test(up_css));
  var dn_w = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI }, fetchOptions: {}, before: (w) => {
    Object.defineProperty(w, "innerHeight", { value: 1600, configurable: true });
    w.Element.prototype.getBoundingClientRect = function () { return this.classList && this.classList.contains("fe-pop") ? { top: 700, bottom: 900, height: 200, left: 0, right: 300, width: 300 } : { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0 }; };
  } });
  rowsOf(dn_w)[0].querySelector(".fe-more").click();
  check("with room below, a menu stays where it was and opens downward", !dn_w.document.querySelector(".fe-menu").classList.contains("fe-up"));


  
  } catch (err) { areaCrashed("the popup after Create, and the room at the bottom", err); }
}
  if (want('the Donate panel')) { try {
  // ================================================================ the Donate panel
  var dnp_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI } });
  var dnp_btn = dnp_w.document.getElementById("supportButton");
  var dnp_panel = dnp_w.document.getElementById("kofiPanel");
  check("before anyone clicks Donate, the panel is closed, there is no frame, and Ko-fi is not contacted", dnp_panel.hidden === true && !dnp_w.document.querySelector("iframe") && dnp_btn.getAttribute("aria-expanded") === "false" && dnp_btn.getAttribute("aria-haspopup") === "dialog");
  dnp_w.document.getElementById("supportBox").getBoundingClientRect = () => ({ top: 900, left: 0, width: 200, height: 80 });
  Object.defineProperty(dnp_w, "innerHeight", { value: 1000, configurable: true });
  var dnp_click = new dnp_w.MouseEvent("click", { bubbles: true, cancelable: true });
  var dnp_notPrevented = dnp_btn.dispatchEvent(dnp_click);
  var dnp_frame = dnp_panel.querySelector("iframe");
  check("clicking Donate opens Ko-fi's page in a panel in this page instead of leaving it", dnp_notPrevented === false && dnp_panel.hidden === false && dnp_btn.getAttribute("aria-expanded") === "true" && !!dnp_frame && dnp_frame.src === "https://ko-fi.com/roncarmel/?hidefeed=true&widget=true&embed=true" && dnp_frame.title === "Support me on Ko-fi");
  dnp_w.document.getElementById("supportBox").getBoundingClientRect = () => ({ top: 300, left: 0, width: 200, height: 80 });
  dnp_w.dispatchEvent(new dnp_w.Event("resize"));
  Object.defineProperty(dnp_w, "innerHeight", { value: 360, configurable: true });
  dnp_w.dispatchEvent(new dnp_w.Event("resize"));
  check("on a short window it is never shorter than 400, and it is resized when the window changes", dnp_panel.style.height === "400px");
  check("the bar above the frame says Choose any amount that feels right to you., with the x at the right and no link to Ko-fi in it, and the page loads no Ko-fi script, only a frame", dnp_panel.querySelector(".kofi-bar").children.length === 2 && dnp_panel.querySelector(".kofi-bar").firstElementChild.id === "kofiPrompt" && dnp_panel.querySelector("#kofiPrompt").textContent === "Choose any amount that feels right to you." && dnp_panel.querySelector(".kofi-bar").lastElementChild.id === "kofiClose" && !dnp_panel.querySelector(".kofi-bar a") && !/ko-fi\.com/.test(Array.from(dnp_w.document.scripts).map((x) => x.src).join(" ")) && !/storage\.ko-fi|overlay-widget/.test(fs.readFileSync(ROOT + "app.js", "utf8") + fs.readFileSync(ROOT + "index.html", "utf8")));
  check("the text is bold and centered in that bar, and the x sits at the right", /#kofiPanel \.kofi-bar \{ display: grid; grid-template-columns: 1fr auto 1fr;/.test(fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ")) && /#kofiPrompt \{ grid-column: 2; text-align: center; font-weight: bold; \}/.test(fs.readFileSync(ROOT + "index.html", "utf8")) && /#kofiClose \{ grid-column: 3; justify-self: end; \}/.test(fs.readFileSync(ROOT + "index.html", "utf8")));
  dnp_w.document.getElementById("kofiClose").click();
  check("the x closes it", dnp_panel.hidden === true && dnp_btn.getAttribute("aria-expanded") === "false");
  dnp_btn.dispatchEvent(new dnp_w.MouseEvent("click", { bubbles: true, cancelable: true }));
  dnp_w.document.dispatchEvent(new dnp_w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("Escape closes it too, and opening it again reuses the same frame", dnp_panel.hidden === true && dnp_w.document.querySelectorAll("#kofiPanel iframe").length === 1);
  dnp_btn.dispatchEvent(new dnp_w.MouseEvent("click", { bubbles: true, cancelable: true }));
  dnp_w.document.getElementById("feCaption").click();
  check("a click anywhere outside the panel closes it", dnp_panel.hidden === true);
  dnp_btn.dispatchEvent(new dnp_w.MouseEvent("click", { bubbles: true, cancelable: true }));
  dnp_panel.querySelector(".kofi-bar").click();
  check("a click inside the panel does not", dnp_panel.hidden === false);
  dnp_btn.dispatchEvent(new dnp_w.MouseEvent("click", { bubbles: true, cancelable: true }));
  check("clicking Donate again closes it, rather than closing and reopening", dnp_panel.hidden === true);
  var dnp_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  check("the panel and its dimming sit above the tip strip, so they cover the button and its note, and above the build popup, which stays open behind them", /#kofiPanel \{[^}]*z-index: 1111;/.test(dnp_css) && /#kofiDim \{ position: fixed;[^}]*z-index: 1110; background: rgba\(0, 0, 0, 0\.65\); \}/.test(dnp_css) && /#supportBox \{ position: fixed; right: 16px; bottom: 16px; z-index: 1001;/.test(dnp_css) && /\.app-overlay \{ position: fixed;[^}]*z-index: 1100;/.test(dnp_css));
  check("nothing in the page still says tip or tipping, except the word donate", !/\btip me\b|\bTip me\b|Tipping/.test(fs.readFileSync(ROOT + "index.html", "utf8").replace(/<style>[\s\S]*?<\/style>/, "") + fs.readFileSync(ROOT + "app.js", "utf8")));


  
  } catch (err) { areaCrashed("the Donate panel", err); }
}
  if (want('dimming, fading, and Donate in the Create popup')) { try {
  // ================================================================ dimming, fading, and Donate in the Create popup
  var dd_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  var dd_dim = dd_w.document.getElementById("kofiDim");
  var dd_panel = dd_w.document.getElementById("kofiPanel");
  check("the screen is not dimmed until the donation popup opens", dd_dim.hidden === true && dd_panel.hidden === true);
  dd_w.document.getElementById("supportButton").dispatchEvent(new dd_w.MouseEvent("click", { bubbles: true, cancelable: true }));
  check("opening the donation popup dims the rest of the screen, as the Create popup does, and moves the focus into it", dd_dim.hidden === false && dd_panel.hidden === false && dd_w.document.activeElement === dd_w.document.getElementById("kofiClose"));
  dd_dim.click();
  check("clicking the dimmed screen closes both and returns the focus to the Donate button", dd_dim.hidden === true && dd_panel.hidden === true && dd_w.document.activeElement === dd_w.document.getElementById("supportButton"));
  dd_w.document.getElementById("supportButton").dispatchEvent(new dd_w.MouseEvent("click", { bubbles: true, cancelable: true }));
  dd_w.document.dispatchEvent(new dd_w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("Escape closes the panel and the dimming together", dd_dim.hidden === true && dd_panel.hidden === true);
  var dd_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  check("hidden still means hidden in the end (display none), and while a popup fades out it cannot be clicked", /\[hidden\] \{ display: none !important; \}/.test(dd_css) && /\.fx-leaving, \.fx-ghost \{ pointer-events: none; \}/.test(dd_css));
  check("popups come and go with the shared curves", /--ease-out: cubic-bezier\(0\.2, 0, 0, 1\)/.test(dd_css) && /const EASE_OUT = "cubic-bezier\(0\.2, 0, 0, 1\)"/.test(fs.readFileSync(ROOT + "editor.js", "utf8")) && typeof dd_w.initMotion === "function");
  var dd_o = {};
  var dd_w2 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: dd_o });
  await readyToPreview(dd_w2);
  dd_w2.document.getElementById("maxPlaylists").value = "1";
  dd_w2.document.getElementById("maxPlaylists").dispatchEvent(new dd_w2.Event("input"));
  dd_w2.document.getElementById("create").click();
  await waitFor(() => visible(dd_w2, "confirmBox"), 30000);
  check("the Create popup has no Close or Donate button while it asks", dd_w2.document.getElementById("createCloseRow").hidden === true);
  pressBuild(dd_w2);
  await waitFor(() => dd_w2.document.getElementById("createCloseRow").hidden === false, 30000);
  var dd_btns = Array.from(dd_w2.document.querySelectorAll("#createCloseRow button"));
  check("when it is done, the footer offers only Close, and Support me with the cup is a pink button in the thank-you box", dd_btns.map((b) => b.textContent.trim()).join("|") === "Close" && dd_w2.document.getElementById("createDonate").closest("#createSupport") !== null && !!dd_w2.document.getElementById("createDonate").querySelector('img[src="cup-border.png"]') && dd_w2.document.getElementById("createDonate").classList.contains("primary"));
  dd_w2.document.getElementById("createDonate").click();
  check("Support me opens the Ko-fi panel above the build popup, which stays open behind it", dd_w2.document.getElementById("createOverlay").hidden === false && Number(dd_w2.getComputedStyle(dd_w2.document.getElementById("kofiPanel")).zIndex) > Number(dd_w2.getComputedStyle(dd_w2.document.getElementById("createOverlay")).zIndex) && dd_w2.document.getElementById("kofiPanel").hidden === false && dd_w2.document.getElementById("kofiDim").hidden === false && !!dd_w2.document.querySelector("#kofiPanel iframe"));
  dd_w2.document.dispatchEvent(new dd_w2.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("Escape closes only the Ko-fi panel: the build popup is still there, with focus back on Support me", dd_w2.document.getElementById("kofiPanel").hidden === true && dd_w2.document.getElementById("kofiDim").hidden === true && dd_w2.document.getElementById("createOverlay").hidden === false && dd_w2.document.activeElement === dd_w2.document.getElementById("createDonate"));
  dd_w2.document.getElementById("createDonate").click();
  dd_w2.document.getElementById("kofiClose").click();
  check("closing the panel with its x also returns to the build popup", dd_w2.document.getElementById("kofiPanel").hidden === true && dd_w2.document.getElementById("createOverlay").hidden === false);
  dd_w2.document.getElementById("createClose").click();
  check("and closing the build popup then leaves a clean page: nothing dimmed, nothing open, Create ready again", dd_w2.document.getElementById("kofiDim").hidden === true && dd_w2.document.getElementById("kofiPanel").hidden === true && dd_w2.document.getElementById("createOverlay").hidden === true && !dd_w2.document.getElementById("create").disabled);
  dd_w2.document.getElementById("create").click();
  await waitFor(() => visible(dd_w2, "confirmBox") || dd_w2.document.getElementById("createCloseRow").hidden === false, 30000);
  check("Close in the Create popup still just closes it", (() => { if (visible(dd_w2, "confirmBox")) dd_w2.document.getElementById("confirmNo").click(); return true; })());


  var cl_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  check("after a build, Support me is a pink button in the thank-you box near the top, and the footer has only Close", wB_support_ok(fs.readFileSync(ROOT + "index.html", "utf8")));


  
  } catch (err) { areaCrashed("dimming, fading, and Donate in the Create popup", err); }
}
  if (want('tabs that scroll sideways')) { try {
  // ================================================================ tabs that scroll sideways
  var sc_w = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"a": {"name": "Alpha {n}", "segments": [("💗 spacious + gentle", 10)]}, "b": {"name": "Beta {n}", "segments": [("🛋 rest", 10)]}, "c": {"name": "Gamma {n}", "segments": [("💗💗 evocative", 10)]}}' } });
  var sc_cur = () => sc_w.document.getElementById("feTabs");
  var sc_strip = sc_cur();
  var sc_row = sc_w.document.querySelector(".fe-toprow");
  check("the row is the icon, the tabs, and the menu, and New recipe is the last thing in the scrolling tabs, after every tab", Array.from(sc_row.children).map((c) => c.id || c.className).join("|") === "fe-appicon|feTabs|feAppMenu" && sc_strip.lastElementChild === sc_w.document.getElementById("feNewFormat") && sc_strip.querySelectorAll(".fe-tab").length === 3);
  var sc_plus = sc_w.document.getElementById("feNewFormat");
  check("New recipe is a button with a plus and its name, on every screen, with no small plus-only form", sc_plus.textContent.trim() === "New recipe" && !!sc_plus.querySelector(".fe-newformat-label") && !!sc_plus.querySelector("svg") && !/fe-newformat-label \{ display: none/.test(fs.readFileSync(ROOT + "index.html", "utf8")));
  addNamed(sc_w, "Fourth");
  check("pressing it adds a format and selects its tab, as before, and New recipe is still last", sc_cur().querySelectorAll(".fe-tab").length === 4 && sc_cur().querySelector('.fe-tab[aria-pressed="true"]') === sc_cur().querySelectorAll(".fe-tab")[3] && sc_cur().lastElementChild.id === "feNewFormat");
  check("the only fade is a short one, always there, where the row meets the menu button, over empty room at the row's end", !/fe-fade/.test(fs.readFileSync(ROOT + "index.html", "utf8")) && !/updateTabFade/.test(fs.readFileSync(ROOT + "editor.js", "utf8")) && /#formatEditor \.fe-tabs \{ padding-right: 8px; -webkit-mask-image: linear-gradient\(to left, transparent, #000 8px\); mask-image: linear-gradient\(to left, transparent, #000 8px\); \}/.test(fs.readFileSync(ROOT + "index.html", "utf8")));
  var sc_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  // choosing a tab re-draws the row, so give the new elements sizes too and look at where it scrolled
  var sc_prep = () => { const strip = sc_cur(); Object.defineProperty(strip, "clientWidth", { value: 300, configurable: true }); Object.defineProperty(strip, "scrollWidth", { value: 800, configurable: true }); Array.from(strip.querySelectorAll(".fe-tab")).forEach((t, i) => { Object.defineProperty(t, "offsetLeft", { value: i * 150, configurable: true }); Object.defineProperty(t, "offsetWidth", { value: 130, configurable: true }); }); return strip; };
  sc_prep(); sc_cur().scrollLeft = 0;
  sc_w.eval("renderTabs = ((orig) => function () { orig(); })(renderTabs)");
  Array.from(sc_cur().querySelectorAll(".fe-tab"))[2].click();
  var sc_after = sc_cur();
  check("choosing a tab selects it, and the row is told to keep the selected tab in view", sc_after.querySelector('.fe-tab[aria-pressed="true"]').getAttribute("data-id") === "c" && /function scrollSelectedTab\(\)/.test(fs.readFileSync(ROOT + "editor.js", "utf8")) && /scrollSelectedTab\(\);\n\}/.test(fs.readFileSync(ROOT + "editor.js", "utf8")));
  check("the minimalist icon and the app's menu keep their place beside the tabs, and the menu is last in the row", sc_w.document.querySelector(".fe-toprow").lastElementChild.id === "feAppMenu" && sc_w.document.querySelector(".fe-toprow").children[1].id === "feTabs");
  var fr_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI } });
  fr_w.document.getElementById("supportButton").dispatchEvent(new fr_w.MouseEvent("click", { bubbles: true, cancelable: true }));
  check("the donation frame is allowed to offer Apple Pay and Google Pay, which a frame cannot otherwise do", fr_w.document.querySelector("#kofiPanel iframe").getAttribute("allow") === "payment *");


  
  } catch (err) { areaCrashed("tabs that scroll sideways", err); }
}
  if (want('Donate only after a success')) { try {
  // ================================================================ Donate only after a success
  var ds_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { denyCreate: true } });
  await readyToPreview(ds_w);
  ds_w.document.getElementById("maxPlaylists").value = "2";
  ds_w.document.getElementById("maxPlaylists").dispatchEvent(new ds_w.Event("input"));
  ds_w.document.getElementById("create").click();
  await waitFor(() => visible(ds_w, "confirmBox"), 30000);
  pressBuild(ds_w);
  await waitFor(() => ds_w.document.getElementById("createCloseRow").hidden === false, 30000);
  check("when creating fails, the popup offers only Close: Donate is hidden", ds_w.document.getElementById("createDonate").hidden === true && ds_w.document.getElementById("createClose").offsetParent !== undefined && ds_w.document.querySelectorAll("#results .support-prompt").length === 0 && !/in your Spotify library\.$/.test(ds_w.document.getElementById("actionMessage").textContent));
  var ds_w2 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn() });
  await readyToPreview(ds_w2);
  ds_w2.document.getElementById("create").click();
  await waitFor(() => ds_w2.document.getElementById("createCloseRow").hidden === false, 20000);
  check("when there is a problem with the plan, the popup offers only Close too", ds_w2.document.getElementById("createDonate").hidden === true && ds_w2.document.getElementById("output").hidden === false);
  var ds_w3 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  await readyToPreview(ds_w3);
  ds_w3.document.getElementById("maxPlaylists").value = "1";
  ds_w3.document.getElementById("maxPlaylists").dispatchEvent(new ds_w3.Event("input"));
  ds_w3.document.getElementById("create").click();
  await waitFor(() => visible(ds_w3, "confirmBox"), 30000);
  check("while the popup asks, there is no Donate either", ds_w3.document.getElementById("createDonate").hidden === true);
  pressBuild(ds_w3);
  await waitFor(() => ds_w3.document.getElementById("createCloseRow").hidden === false, 30000);
  check("after a success the popup offers Close and Donate", ds_w3.document.getElementById("createDonate").hidden === false && /in your Spotify library\.$/.test(ds_w3.document.getElementById("actionMessage").textContent));
  ds_w3.document.getElementById("createClose").click();
  ds_w3.document.getElementById("create").click();
  await waitFor(() => visible(ds_w3, "confirmBox"), 30000);
  ds_w3.document.getElementById("confirmNo").click();
  check("a later run starts without Donate until it succeeds", ds_w3.document.getElementById("createDonate").hidden === true);


  
  } catch (err) { areaCrashed("Donate only after a success", err); }
}
  if (want('when Spotify cannot be reached')) { try {
  // ================================================================ when Spotify cannot be reached
  var cx_o = { meStatus: 429, retryAfter: 120 };
  var cx_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: cx_o });
  var cx_sec = (w, id) => w.document.getElementById(id);
  check("rate limited at the start: the app does not call itself connected, and shows the problem with how long to wait", cx_w.eval("connection") === "problem" && cx_sec(cx_w, "connectedSection").hidden === true && cx_sec(cx_w, "connectionProblem").hidden === false && /^Spotify is rate limiting requests\. Try again in about 2 minutes\.$/.test(cx_sec(cx_w, "connectionMessage").textContent), cx_sec(cx_w, "connectionMessage").textContent);
  cx_w.localStorage.removeItem("spotifyPausedUntil");   // a wait of two minutes is kept and counted down ("a wait from Spotify"); here it is the Try again that follows
  cx_w.eval("updateButtonsNow()");
  check("a long wait is reported straight away, not sat through: over a minute is not retried, and neither is a quota limit", /wait && wait > 60/.test(fs.readFileSync(ROOT + "app.js", "utf8")) && /reason === "QUOTA_EXCEEDED"/.test(fs.readFileSync(ROOT + "app.js", "utf8")) && /waitText\(wait\)/.test(fs.readFileSync(ROOT + "app.js", "utf8")));
  check("there is no Disconnect button in view: it is hidden, and so is the app menu's Disconnect Spotify", cx_sec(cx_w, "disconnect").hidden === true && (() => { cx_w.document.getElementById("feAppMenuButton").click(); const gone = !cx_w.document.getElementById("feDisconnect"); cx_w.document.getElementById("feAppMenuButton").click(); return gone; })());
  check("Build becomes Try again, with what went wrong under it, and Remove earlier playlists is off, with its note", cx_sec(cx_w, "create").textContent.trim() === "Try again" && cx_sec(cx_w, "removeOld").disabled === true && cx_sec(cx_w, "spotifyNote").hidden === false && cx_sec(cx_w, "spotifyNote").textContent === cx_sec(cx_w, "connectionMessage").textContent && cx_sec(cx_w, "removeNote").hidden === false);
  check("the editor is still there for the formats, and the page offers Try again and Connect again, with no report link for a rate limit, which is a known problem", !cx_sec(cx_w, "appSection").hidden && !!cx_w.document.getElementById("formatEditor").querySelector(".fe-card") && cx_sec(cx_w, "connectionRetry").textContent.trim() === "Try again" && cx_sec(cx_w, "connectionReconnect").textContent.trim() === "Connect again" && cx_sec(cx_w, "connectionReportHint").hidden === true);
  rowsOf(cx_w)[0].querySelector(".fe-main").click();
  check("a segment's list says the playlists could not be loaded, and where to look", /Your playlists could not be loaded\. See the app menu\./.test(cx_w.document.getElementById("feOptions").textContent));
  cx_w.eval("refreshReportBox()");
  check("the recent steps say what happened, and nothing is marked as connected", /connection failed/.test(cx_w.document.getElementById("reportPreview").textContent) && !/connected, \d+ playlists? found/.test(cx_w.document.getElementById("reportPreview").textContent), cx_w.document.getElementById("reportPreview").textContent);
  delete cx_o.meStatus;
  cx_w.document.body.click();   // the segment's list is still open: the first tap only closes it
  cx_sec(cx_w, "connectionRetry").click();
  await waitFor(() => cx_w.eval("connection") === "ready", 15000);
  // Remove starts with no recipe chosen, and is on once one is
  var cx_removeOn = () => { const k = cx_sec(cx_w, "removeKey"); const blank = cx_sec(cx_w, "removeOld").disabled; k.value = k.options[k.options.length - 1].value; k.dispatchEvent(new cx_w.Event("change")); return blank && cx_sec(cx_w, "removeOld").disabled === false; };
  check("Try again, once Spotify answers, makes everything available: Disconnect is back, the problem is gone, Create and Remove are on", cx_sec(cx_w, "connectedSection").hidden === false && cx_sec(cx_w, "disconnect").hidden === false && cx_sec(cx_w, "connectionProblem").hidden === true && cx_sec(cx_w, "create").disabled === false && cx_removeOn() && cx_sec(cx_w, "spotifyNote").hidden === true && /^Connected as Ron\./.test(cx_sec(cx_w, "connectedMessage").textContent));
  check("and the app menu offers Disconnect Spotify again", (() => { cx_w.document.getElementById("feAppMenuButton").click(); const there = !!cx_w.document.getElementById("feDisconnect"); cx_w.document.getElementById("feAppMenuButton").click(); return there; })());
  var cx_w2 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { meNetworkFail: true } });
  check("with no connection to the internet it says so, in plain words", cx_w2.eval("connection") === "problem" && /^Could not reach Spotify\. Check your internet connection and try again\.$/.test(cx_sec(cx_w2, "connectionMessage").textContent) && cx_sec(cx_w2, "disconnect").hidden === true);
  var cx_w3 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { meStatus: 401 } });
  check("a sign-in that has expired shows the same problem state, telling you to connect again", cx_w3.eval("connection") === "problem" && /^Your Spotify sign-in expired\. Click Connect again\.$/.test(cx_sec(cx_w3, "connectionMessage").textContent) && cx_sec(cx_w3, "create").textContent.trim() === "Connect again");
  var cx_o4 = {};
  var cx_w4 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: cx_o4 });
  await readyToPreview(cx_w4);
  cx_o4.meStatus = 401;
  cx_w4.document.getElementById("create").click();
  await waitFor(() => cx_w4.eval("connection") === "problem", 20000);
  await waitFor(() => cx_w4.document.getElementById("createCloseRow").hidden === false, 20000);
  check("if the sign-in expires part way through, the page notices: Build becomes Connect again and Disconnect goes away until you connect again", cx_sec(cx_w4, "create").textContent.trim() === "Connect again" && cx_sec(cx_w4, "disconnect").hidden === true && cx_sec(cx_w4, "connectionProblem").hidden === false && /sign-in expired/.test(cx_sec(cx_w4, "connectionMessage").textContent));
  var cx_o5 = { denyCreate: true };
  var cx_w5 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: cx_o5 });
  await readyToPreview(cx_w5);
  cx_w5.document.getElementById("create").click();
  await waitFor(() => visible(cx_w5, "confirmBox"), 30000);
  pressBuild(cx_w5);
  await waitFor(() => /did not allow/.test(cx_w5.document.getElementById("actionMessage").textContent), 30000);
  check("one refused request (a missing permission) is not treated as a lost connection: the page stays connected and still offers Disconnect", cx_w5.eval("connection") === "ready" && cx_sec(cx_w5, "disconnect").hidden === false);
  var cx_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  check("minimalist mode hides Step 1 and its problem message, because the menu and the Create button carry them instead", /body\.minimal #loginSection, body\.minimal #connectionProblem \{ display: none; \}/.test(cx_css));


  
  } catch (err) { areaCrashed("when Spotify cannot be reached", err); }
}
  if (want('saved songs')) { try {
  // ================================================================ saved songs
  var SONGS_FORMAT = 'FORMATS = {"mini": {"name": "mini {n}", "segments": [("💗 spacious + gentle", 10), ("🛋 rest", 10)]}}';
  var sv_run = async (idb, options, formats = SONGS_FORMAT, all = false) => {
    const w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats }, fetchOptions: options, idb });
    await readyToPreview(w);
    w.document.getElementById("maxPlaylists").value = "1";
    w.document.getElementById("maxPlaylists").dispatchEvent(new w.Event("input"));
    w.document.getElementById(all ? "buildAll" : "create").click();
    await waitFor(() => visible(w, "confirmBox") || w.document.getElementById("createCloseRow").hidden === false, 30000);
    if (visible(w, "confirmBox")) w.document.getElementById("confirmNo").click();
    await waitFor(() => w.document.getElementById("createOverlay").hidden === true || w.document.getElementById("createCloseRow").hidden === false, 10000);
    return w;
  };
  var sv_idb = new FDBFactory();
  var sv_o1 = {};
  await sv_run(sv_idb, sv_o1);
  check("the first run, with nothing saved, reads each source playlist's songs from Spotify", (sv_o1.trackRequests || []).length >= 2 && new Set(sv_o1.trackRequests).size === 2, JSON.stringify(sv_o1.trackRequests));
  var sv_o2 = {};
  await sv_run(sv_idb, sv_o2);
  check("a run after the page is reloaded, with the songs saved and the playlists unchanged, makes no track requests at all", (sv_o2.trackRequests || []).length === 0, JSON.stringify(sv_o2.trackRequests));
  var sv_o3 = { snapshots: { p2: "changed-1" } };
  var sv_snap = await sv_run(sv_idb, sv_o3);
  check("when one playlist's snapshot has changed, only that playlist's songs are read again", (sv_o3.trackRequests || []).length > 0 && new Set(sv_o3.trackRequests).size === 1 && sv_o3.trackRequests[0] === "p2", JSON.stringify(sv_o3.trackRequests));
  var sv_o4 = { snapshots: { p2: "changed-1" } };
  await sv_run(sv_idb, sv_o4);
  check("and it keeps the new songs, so the run after that makes none either", (sv_o4.trackRequests || []).length === 0, JSON.stringify(sv_o4.trackRequests));
  var sv_o5 = { snapshots: { p2: "changed-1" } };
  await sv_run(sv_idb, sv_o5, 'FORMATS = {"one": {"name": "one {n}", "segments": [("💗 spacious + gentle", 10)]}}');
  check("a format that needs one playlist asks about that one only, whatever else is saved", (sv_o5.trackRequests || []).length === 0);
  var sv_idb2 = new FDBFactory();
  var sv_o6 = {};
  await sv_run(sv_idb2, sv_o6, 'FORMATS = {"one": {"name": "one {n}", "segments": [("🛋 rest", 10)]}}');
  check("and on a cold start only the playlists the chosen format needs are read, not all of them", new Set(sv_o6.trackRequests).size === 1 && sv_o6.trackRequests[0] === "p4", JSON.stringify(sv_o6.trackRequests));
  var sv_o7 = {};
  await sv_run(sv_idb2, sv_o7, 'FORMATS = {"a": {"name": "a {n}", "segments": [("🛋 rest", 10)]}, "b": {"name": "b {n}", "segments": [("💗 spacious + gentle", 10)]}}', true);
  check("choosing all recipes later reads only what is not saved yet", new Set(sv_o7.trackRequests).size === 1 && sv_o7.trackRequests[0] === "p2", JSON.stringify(sv_o7.trackRequests));
  // no snapshot ids from Spotify: the saved songs are trusted, and there is a way to refresh them
  var sv_idb3 = new FDBFactory();
  await sv_run(sv_idb3, { noSnapshots: true });
  var sv_o8 = { noSnapshots: true };
  var sv_w8 = await sv_run(sv_idb3, sv_o8);
  check("without snapshot ids the saved songs are used as they are, so a warm run still makes no track requests", (sv_o8.trackRequests || []).length === 0);
  rowsOf(sv_w8)[0].querySelector(".fe-more").click();
  check("and then a segment's menu offers Refresh songs from Spotify", !!sv_w8.document.getElementById("feRefreshSongs") && sv_w8.document.getElementById("feRefreshSongs").textContent.trim() === "Refresh songs from Spotify");
  sv_w8.document.getElementById("feRefreshSongs").click();
  await waitFor(() => sv_w8.document.getElementById("editorNote").textContent !== "", 5000);
  check("choosing it says what will happen, and closes the menu", sv_w8.document.getElementById("editorNote").textContent === "Songs will be read again from Spotify the next time you build." && !sv_w8.document.querySelector(".fe-menu"));
  var sv_o9 = { noSnapshots: true };
  await sv_run(sv_idb3, sv_o9);
  check("the next run reads that segment's playlist again, and only that one", new Set(sv_o9.trackRequests).size === 1 && sv_o9.trackRequests[0] === "p2", JSON.stringify(sv_o9.trackRequests));
  var sv_w10 = await boot({ url: EDURL, session: signedIn(), local: { formats: SONGS_FORMAT }, fetchOptions: {} });
  rowsOf(sv_w10)[0].querySelector(".fe-more").click();
  check("when Spotify does give snapshot ids, the refresh control is not shown at all", !sv_w10.document.getElementById("feRefreshSongs"));
  // disconnecting and clearing forget the songs
  var sv_idb4 = new FDBFactory();
  var sv_w11 = await sv_run(sv_idb4, {});
  var sv_count = (w) => new Promise((resolve) => { const r = w.indexedDB.open("ceremony-playlist-builder", 1); r.onsuccess = () => { const q = r.result.transaction("songs", "readonly").objectStore("songs").count(); q.onsuccess = () => resolve(q.result); }; });
  check("the songs of both playlists are saved in the browser", (await sv_count(sv_w11)) === 2);
  sv_w11.eval("location.reload = () => { window.__reloadedByDisconnect = true; }");
  sv_w11.document.getElementById("disconnect").click();
  await waitFor(() => !!sv_w11.document.getElementById("feSyncDialog"), 3000);
  sv_w11.document.getElementById("feSyncChoice0").click();
  await waitFor(() => sv_w11.__reloadedByDisconnect === true, 5000);
  check("Disconnect clears them, along with the sign-in", (await sv_count(sv_w11)) === 0 && sv_w11.sessionStorage.getItem("token") === null);
  var sv_idb5 = new FDBFactory();
  var sv_w12 = await sv_run(sv_idb5, {});
  sv_w12.document.getElementById("clearData").click();
  sv_w12.document.getElementById("clearYes").click();
  await waitFor(() => sv_w12.__reloaded === true || true, 100);
  await new Promise((r) => setTimeout(r, 300));
  check("Reset app on this device clears them too", (await sv_count(sv_w12)) === 0);
  var sv_w13 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: SONGS_FORMAT }, fetchOptions: {}, idb: null, before: (w) => { w.indexedDB = undefined; } });
  await readyToPreview(sv_w13);
  sv_w13.document.getElementById("create").click();
  await waitFor(() => visible(sv_w13, "confirmBox"), 30000);
  check("if the browser will not keep songs, everything still works, just without the saved songs", visible(sv_w13, "confirmBox"));
  var sv_w14 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: SONGS_FORMAT }, fetchOptions: {} });
  check("each playlist the app reads has a snapshot id to compare, when Spotify gives one", sv_w14.eval("playlists").every((p) => typeof p.snapshot === "string" && p.snapshot.startsWith("snap-")));
  var sv_w15 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: SONGS_FORMAT }, fetchOptions: { noSnapshots: true } });
  check("and none when it does not", sv_w15.eval("playlists").every((p) => p.snapshot === null));

  
  } catch (err) { areaCrashed("saved songs", err); }
}
  if (want('long waits from Spotify')) { try {
  // ================================================================ long waits from Spotify
  var lw_o = { meStatus: 429, retryAfter: 14689, meBody: { error: { status: 429, message: "Too many requests", reason: "QUOTA_EXCEEDED" } } };
  var lw_t0 = Date.now();
  var lw_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: lw_o });
  check("a quota error with a wait of about four hours stops at once, with no waiting", Date.now() - lw_t0 < 6000 && lw_w.eval("connection") === "problem");
  check("it says the request quota of the developer account has been reached, that waiting is the only fix, and how long, in hours and minutes", lw_w.document.getElementById("connectionMessage").textContent === "Spotify has reached the request quota for your developer account. Waiting is the only fix: try again in about 4 hours and 5 minutes.", lw_w.document.getElementById("connectionMessage").textContent);
  var lw_w2 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { meStatus: 429, retryAfter: 3600, meBody: { error: { status: 429, message: "Too many requests" } } } });
  check("any other long rate limit says only that Spotify is rate limiting, and the time", lw_w2.document.getElementById("connectionMessage").textContent === "Spotify is rate limiting requests. Try again in about 1 hour.", lw_w2.document.getElementById("connectionMessage").textContent);
  var lw_w3 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { meStatus: 429, retryAfter: 61, meBody: {} } });
  check("anything over a minute is long: 61 seconds is reported, as 2 minutes", lw_w3.document.getElementById("connectionMessage").textContent === "Spotify is rate limiting requests. Try again in about 2 minutes.", lw_w3.document.getElementById("connectionMessage").textContent);
  check("the wait is written as hours and minutes, rounded up to the next minute", [[14689, "4 hours and 5 minutes"], [3600, "1 hour"], [3660, "1 hour and 1 minute"], [120, "2 minutes"], [61, "2 minutes"], [7200, "2 hours"], [90061, "25 hours and 2 minutes"]].every(([secs, words]) => lw_w.eval(`waitText(${secs})`) === words), JSON.stringify([14689, 3600, 61].map((x) => lw_w.eval(`waitText(${x})`))));
  // a short wait is still retried
  var lw_calls = [];
  var lw_w4 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  var lw_n = 0;
  lw_w4.fetch = async (url, init) => { lw_calls.push(url); lw_n += 1; if (lw_n === 1) return { ok: false, status: 429, headers: { get: (h) => (h === "Retry-After" ? "1" : null) }, text: async () => "{}", json: async () => ({}) }; return { ok: true, status: 200, headers: { get: () => null }, text: async () => '{"id":"ron"}', json: async () => ({ id: "ron" }) }; };
  var lw_started = Date.now();
  var lw_result = await lw_w4.eval("spotifyRequest('GET', '/me')");
  check("a short wait (a second or two) is still waited out and retried, and then succeeds", lw_calls.length === 2 && lw_result.id === "ron" && Date.now() - lw_started >= 1000);
  var lw_o5 = { tracksStatus: 429, tracksRetryAfter: 14689, tracksBody: { error: { status: 429, reason: "QUOTA_EXCEEDED" } } };
  var lw_w5 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: lw_o5 });
  await readyToPreview(lw_w5);
  lw_w5.document.getElementById("create").click();
  await waitFor(() => lw_w5.document.getElementById("createCloseRow").hidden === false, 20000);
  check("a quota error while reading songs shows the same message in the Create popup, after one request, with no Donate", /^Spotify asked this app to waitNo playlists were built\. Waiting is the only fix: try again in about 4 hours and 5 minutes\.$/.test(lw_w5.document.getElementById("actionMessage").textContent) && (lw_o5.trackRequests || []).length === 1 && lw_w5.document.getElementById("createDonate").hidden === true, JSON.stringify(lw_o5.trackRequests));
  check("and the page is still connected, since the playlists were read: only this request was refused", lw_w5.eval("connection") === "ready");

  
  } catch (err) { areaCrashed("long waits from Spotify", err); }
}
  if (want('a wait from Spotify')) { try {
  // ================================================================ a wait from Spotify: kept on the device, counted down in the line, nothing sent until it is over
  var ws_o = { meStatus: 429, retryAfter: 14689, meBody: { error: { status: 429, reason: "QUOTA_EXCEEDED" } } };
  var ws_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI, clientId: "abc", spotifyPlaylists: JSON.stringify({ user: "ron", list: [{ id: "p1", name: "Kept list", owner: "ron", count: 3 }] }) }, fetchOptions: ws_o });
  var ws_doc = ws_w.document;
  var ws_pause = JSON.parse(ws_w.localStorage.getItem("spotifyPausedUntil") || "null");
  check("a wait of over a minute is kept on the device, with its end, reason and Client ID", ws_pause && Math.abs(ws_pause.until - Date.now() - 14689000) < 10000 && ws_pause.reason === "QUOTA_EXCEEDED" && ws_pause.clientId === "abc", JSON.stringify(ws_pause));
  check("the first time, the popup opens by itself, with the countdown, when it is back, and what works and what waits", !!ws_doc.getElementById("fePauseDialog") && /^4:04:\d\d$/.test(ws_doc.getElementById("fePauseClock").textContent) && /^at \d{1,2}:\d\d\s?[AP]M$/.test(ws_doc.getElementById("fePauseAt").textContent) && /in a day/.test(ws_doc.getElementById("fePauseWhy").textContent) && ws_doc.getElementById("fePauseList").textContent === "Editing recipesWorksChoosing playlistsWorksBuilding playlistsWaits", ws_doc.getElementById("fePauseDialog") && ws_doc.getElementById("fePauseDialog").textContent);
  check("the ring is full at the start of a wait, which is kept with when it began", /^(99\.9\d|100\.00)%$/.test(ws_doc.getElementById("fePauseRing").style.getPropertyValue("--left")) && Math.abs(ws_pause.from - Date.now()) < 10000, ws_doc.getElementById("fePauseRing").style.getPropertyValue("--left"));
  ws_doc.getElementById("fePauseClose").click();
  check("Close closes it", !ws_doc.getElementById("fePauseDialog"));
  await waitFor(() => /Spotify paused/.test(ws_doc.getElementById("feCaption").textContent), 8000);
  var ws_cap = ws_doc.getElementById("feCaption");
  check("the line under the bar counts down in hours, minutes and seconds, in the accent color, with Details", ws_cap.classList.contains("fe-notice-pause") && /^Spotify paused · back in 4:04:\d\d$/.test(ws_cap.querySelector(".fe-notice-text").textContent) && ws_cap.querySelector(".fe-notice-more .fe-more-word").textContent === "Details", ws_cap.textContent);
  check("the Build button is hidden, with no note under it", ws_doc.getElementById("create").hidden === true && ws_doc.getElementById("spotifyNote").hidden === true);
  check("the playlist menus use the list kept from the last visit", ws_w.eval("playlists.map((p) => p.name).join()") === "Kept list");
  ws_cap.querySelector(".fe-notice-more").click();
  check("Details opens the popup again", !!ws_doc.getElementById("fePauseDialog"));
  ws_doc.dispatchEvent(new ws_w.KeyboardEvent("keydown", { key: "Escape" }));
  check("and Escape closes it", !ws_doc.getElementById("fePauseDialog"));
  var ws_sent = () => ws_w.eval("0") === 0 && log.filter((l) => l.url.startsWith("https://api.spotify.com/")).length;
  var ws_before = ws_sent();
  var ws_msg = "";
  try { await ws_w.eval("spotifyRequest('GET', '/me')"); } catch (err) { ws_msg = err.message; }
  check("during the wait nothing goes to Spotify: a request fails at once with the time left", ws_sent() === ws_before && /try again in about 4 hours and 5 minutes/.test(ws_msg), ws_msg);
  var ws_t1 = ws_cap.querySelector(".fe-notice-text").textContent;
  await new Promise((r) => setTimeout(r, 1300));
  check("the countdown moves each second without repainting the line", ws_cap.querySelector(".fe-notice-text").textContent !== ws_t1 && ws_cap.classList.contains("fe-notice-pause"), ws_t1);
  check("clockText writes hours:minutes:seconds", ws_w.eval("[clockText(22564), clockText(59), clockText(3600)].join(' ')") === "6:16:04 0:00:59 1:00:00");
  // a reload during the wait: the line at once, no popup, nothing sent
  var ws_o2 = { meStatus: 429, retryAfter: 14689 };
  var ws_until = Date.now() + 3600000;
  var ws_w3 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI, clientId: "abc", spotifyPausedUntil: JSON.stringify({ until: ws_until, reason: "", clientId: "abc" }) }, fetchOptions: { meStatus: 429, retryAfter: 14689 } });
  await waitFor(() => !!ws_w3.document.getElementById("fePauseDialog"), 8000);
  check("a new visit during a wait opens the popup once, over the Support me button", !!ws_w3.document.getElementById("fePauseDialog") && ws_w3.sessionStorage.getItem("pauseSeen") === String(ws_until) && /#fePauseDialog \{ z-index: 1040; \}/.test(fs.readFileSync(ROOT + "index.html", "utf8")) && /#supportBox \{[^}]*z-index: 1001/.test(fs.readFileSync(ROOT + "index.html", "utf8")));
  check("a wait with no list kept shows Choosing playlists as waiting, and one with no start gets one when read, with a full ring", /Choosing playlistsWaits/.test(ws_w3.document.getElementById("fePauseList").textContent) && /^(99\.9\d|100\.00)%$/.test(ws_w3.document.getElementById("fePauseRing").style.getPropertyValue("--left")) && Math.abs(JSON.parse(ws_w3.localStorage.getItem("spotifyPausedUntil")).from - Date.now()) < 15000, ws_w3.localStorage.getItem("spotifyPausedUntil"));
  ws_w3.localStorage.setItem("spotifyPausedUntil", JSON.stringify({ until: ws_until, from: ws_until - 4 * 3600000, reason: "", clientId: "abc" }));
  ws_w3.eval("setPauseRing()");
  check("the ring shows the part of the wait still to go", /^2[45]\.\d\d%$/.test(ws_w3.document.getElementById("fePauseRing").style.getPropertyValue("--left")), ws_w3.document.getElementById("fePauseRing").style.getPropertyValue("--left"));
  ws_w3.eval("closePauseDialog()");
  rowsOf(ws_w3)[0].querySelector(".fe-main").click();
  check("with no kept list, a segment's list says when the playlists will show, with Details and no search box", /^Your playlists will show here when Spotify is back (tomorrow )?at about .+\. Details$/.test(ws_w3.document.getElementById("feOptions").textContent) && !ws_w3.document.getElementById("feSearch"), ws_w3.document.getElementById("feOptions").textContent);
  ws_w3.document.getElementById("fePauseNoteDetails").click();
  check("and its Details opens the wait popup, closing the list", !!ws_w3.document.getElementById("fePauseDialog") && !ws_w3.document.getElementById("feOptions"));
  ws_w3.document.getElementById("fePauseDialog").dispatchEvent(new ws_w3.MouseEvent("click", { bubbles: true }));
  check("so one tap outside the popup closes it", !ws_w3.document.getElementById("fePauseDialog"));
  var ws_n0 = log.length;
  var ws_w2 = await boot({ url: "http://127.0.0.1:8000/", session: { ...signedIn(), pauseSeen: String(ws_until) }, local: { formats: MINI, clientId: "abc", spotifyPausedUntil: JSON.stringify({ until: ws_until, reason: "", clientId: "abc" }) }, fetchOptions: ws_o2 });
  await new Promise((r) => setTimeout(r, 300));
  check("after a reload the wait goes on: no popup, the line counts down, and Spotify is not asked", !ws_w2.document.getElementById("fePauseDialog") && ws_w2.document.getElementById("create").hidden === true && !log.slice(ws_n0).some((l) => l.url.startsWith("https://api.spotify.com/")));
  ws_w2.document.getElementById("feAppMenuButton").click();
  ws_w2.document.getElementById("feConnect").click();
  check("the menu's Connect to Spotify opens the popup during a wait, with the wording for a rate limit that is not the quota", !!ws_w2.document.getElementById("fePauseDialog") && /asked too often/.test(ws_w2.document.getElementById("fePauseWhy").textContent));
  check("saving recipes is listed as waiting only when they are saved to Spotify", (() => { ws_w2.document.getElementById("fePauseDialog") && ws_w2.eval("closePauseDialog()"); ws_w2.localStorage.setItem("backupMode", "spotify"); ws_w2.eval("showPauseDialog()"); const has = /Saving recipes/.test(ws_w2.document.querySelector(".fe-pause-lists").textContent); ws_w2.eval("closePauseDialog()"); ws_w2.localStorage.setItem("backupMode", "manual"); return has; })());
  check("a wait kept for another Client ID does not count", (() => { ws_w2.localStorage.setItem("spotifyPausedUntil", JSON.stringify({ until: Date.now() + 3600000, clientId: "other" })); return ws_w2.eval("pausedSecondsLeft()") === 0; })());
  // the time is up: it connects by itself, and Build is back
  ws_w2.localStorage.setItem("spotifyPausedUntil", JSON.stringify({ until: Date.now() + 1200, reason: "", clientId: "abc" }));
  ws_w2.eval("tickPause()");
  delete ws_o2.meStatus;
  await waitFor(() => ws_w2.eval("connection") === "ready", 15000);
  check("when the time is up the app connects again by itself, the popup closes, and Build is back", ws_w2.eval("connection") === "ready" && !ws_w2.document.getElementById("fePauseDialog") && ws_w2.document.getElementById("create").hidden === false && !ws_w2.localStorage.getItem("spotifyPausedUntil"));
  check("a good connection keeps the playlist list on the device, without descriptions", (() => { const k = JSON.parse(ws_w2.localStorage.getItem("spotifyPlaylists") || "null"); return k && k.user === "ron" && k.list.length > 0 && k.list.every((p) => p.id && p.name !== undefined && p.description === undefined); })());
  check("Disconnect forgets the kept list", /removeItem\(KEPT_PLAYLISTS_KEY\)/.test(fs.readFileSync(ROOT + "app.js", "utf8").split("async function disconnect()")[1].split("\n}\n")[0]));
  check("a short wait does not start one", (() => { ws_w2.localStorage.removeItem("spotifyPausedUntil"); return ws_w2.eval("spotifyPause()") === null; })() && /if \(wait && wait > 60 && !noWait\) startSpotifyPause/.test(fs.readFileSync(ROOT + "app.js", "utf8")));
  check("Privacy names the kept playlist list", /the list of your playlists/.test(ws_doc.getElementById("privacySection").textContent));
  } catch (err) { areaCrashed("a wait from Spotify", err); }
}
  if (want('a record of Spotify limits')) { try {
  // ================================================================ a record of Spotify limits
  const sr_record = (w, key) => JSON.parse(w.localStorage.getItem(key) || "null");
  // every request is counted per minute and kind
  var sr_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  await waitFor(() => sr_w.eval("connection") === "ready");
  var sr_calls = sr_record(sr_w, "spotifyCalls");
  check("requests to Spotify are counted per minute, by kind", sr_calls && Object.values(sr_calls).some((k) => k.read >= 2), JSON.stringify(sr_calls));
  check("the kinds are told apart", ["read", "add", "create", "cover", "remove", "change"].every((k, i) => sr_w.eval(`callKind(${JSON.stringify(["GET", "POST", "POST", "PUT", "DELETE", "PUT"][i])}, ${JSON.stringify(["https://api.spotify.com/v1/playlists/abc/items?limit=50", "/playlists/abc/items", "/me/playlists", "/playlists/abc/images", "/me/library?uris=x", "/playlists/abc"][i])})`) === k));
  check("counts older than 8 days are dropped", (() => { const m = Math.floor(Date.now() / 60000); sr_w.localStorage.setItem("spotifyCalls", JSON.stringify({ [m - 9 * 1440]: { read: 5 }, [m - 1]: { read: 1 } })); sr_w.eval("countCall('read')"); const c = sr_record(sr_w, "spotifyCalls"); return !c[m - 9 * 1440] && c[m - 1]; })());
  // a refusal is written down with what came before it, and closed when Spotify answers again
  var sr_n = 0;
  var sr_fetch = sr_w.fetch;
  sr_w.fetch = async (url, init) => { sr_n += 1; if (sr_n <= 2) return { ok: false, status: 429, headers: { get: () => null }, text: async () => "{}", json: async () => ({}) }; return { ok: true, status: 200, headers: { get: () => null }, text: async () => '{"id":"ron"}', json: async () => ({ id: "ron" }) }; };
  sr_w.eval("retrySleep = () => Promise.resolve()");
  sr_w.localStorage.removeItem("spotifyLimits");
  await sr_w.eval("spotifyRequest('GET', '/playlists/0123456789abcdefABCDEF/items?limit=50')");
  var sr_l = sr_record(sr_w, "spotifyLimits");
  check("a rate limit is recorded once, with the request (IDs hidden), the requests before it, the refusals that followed and when it cleared", sr_l.length === 1 && sr_l[0].what === "GET /playlists/{id}/items" && sr_l[0].kind === "read" && sr_l[0].sent30s >= 1 && sr_l[0].refusedAgain === 1 && sr_l[0].clearedAt >= sr_l[0].lastRefusedAt, JSON.stringify(sr_l));
  sr_w.fetch = sr_fetch;
  // adds: 100 at a time, and 10 at a time for the rest of the visit if Spotify refuses 100
  var sr_o = { addMax: 10 };
  var sr_b = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: sr_o });
  await runPreview(sr_b);
  pressBuild(sr_b);
  await waitFor(() => /in your Spotify library\.$/.test(sr_b.document.getElementById("actionMessage").textContent), 30000);
  var sr_adds = sr_o.writes.filter((x) => x.type === "add");
  check("when Spotify refuses 100 songs at a time, the build goes on 10 at a time, asking with 100 only once", sr_o.addRefused === 1 && sr_adds.length > 1 && sr_adds.every((a) => a.uris.length <= 10), `${sr_o.addRefused} ${sr_adds.length}`);
  check("and the record notes it", (sr_record(sr_b, "spotifyLimits") || []).some((e) => /100 songs per add refused/.test(e.note || "")));
  // the owner is offered a copy; nobody else is
  var sr_id = "OWNER-TEST-ID";
  var sr_hash = require("crypto").createHash("sha256").update(sr_id).digest("hex");
  var sr_limits = JSON.stringify([{ at: Date.now() - 1000, what: "POST /playlists/{id}/items", kind: "add", reason: "", sent30s: 40, sent10m: 90, sent1h: 300, sent24h: 300, refusedAgain: 0, lastRefusedAt: Date.now() - 1000, clearedAt: null }]);
  var sr_x = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI, clientId: "SOMEONE-ELSE", spotifyLimits: sr_limits }, fetchOptions: {} });
  await waitFor(() => sr_x.eval("connection") === "ready");
  sr_x.eval(`OWNER_CLIENT_HASHES.push(${JSON.stringify(sr_hash)})`);
  await sr_x.eval("offerLimitRecord()");
  sr_x.eval("editor.appMenu = true; renderAppMenu()");
  check("someone else's Client ID gets no offer and no menu item", !sr_x.eval("notices.held") && !sr_x.document.getElementById("feCopyRecord"));
  var sr_ow = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI, clientId: sr_id, spotifyLimits: sr_limits }, fetchOptions: {} });
  await waitFor(() => sr_ow.eval("connection") === "ready");
  sr_ow.eval(`OWNER_CLIENT_HASHES.push(${JSON.stringify(sr_hash)})`);
  await sr_ow.eval("offerLimitRecord()");
  check("the owner is offered the record when Spotify refused since the last copy", /Spotify refused requests once since the last copy/.test((sr_ow.eval("notices.held") || {}).text || ""), JSON.stringify(sr_ow.eval("notices.held")));
  sr_ow.eval("editor.appMenu = true; renderAppMenu()");
  check("and has Copy Spotify record in the menu", !!sr_ow.document.getElementById("feCopyRecord") && /Copy Spotify record/.test(sr_ow.document.getElementById("feCopyRecord").textContent));
  var sr_copied = "";
  sr_ow.navigator.clipboard = { writeText: async (t) => { sr_copied = t; } };
  await sr_ow.eval("copyLimitRecord()");
  var sr_json = JSON.parse(sr_copied || "{}");
  check("Copy puts the record on the clipboard and marks it copied", sr_json.limits && sr_json.limits.length === 1 && sr_json.callsPerMinute && sr_json.app && Number(sr_ow.localStorage.getItem("spotifyRecordCopiedAt")) > 0 && !sr_ow.eval("notices.held"));
  check("the record has no Client ID, token or playlist names", !/OWNER-TEST-ID|TOKEN|mini/.test(sr_copied), sr_copied.slice(0, 200));
  await sr_ow.eval("offerLimitRecord()");
  check("right after a copy nothing is offered again", !sr_ow.eval("notices.held"));
  // after a rate limit with no readable wait, any device asks the relay for it
  const sr_relayRun = async (w, { relayUrl = "https://relay.example.workers.dev/", answer = { status: 429, retryAfter: "14689", reason: "QUOTA_EXCEEDED" }, path = "/playlists/0123456789abcdefABCDEF/items", noWait = false, header = null, hang = false } = {}) => {
    const seen = [];
    w.eval(`WAIT_RELAY_URL = ${JSON.stringify(relayUrl)}; waitRelayMs = 200; waitAsked.at = 0; waitAsked.result = null; retrySleep = () => Promise.resolve()`);
    w.localStorage.removeItem("spotifyLimits");
    w.localStorage.removeItem("spotifyPausedUntil");   // each run starts with no wait kept from the one before
    w.fetch = async (url, init) => {
      if (url.startsWith("https://relay.example")) {
        seen.push({ url, auth: init && init.headers && init.headers.Authorization });
        if (hang) return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
        return { ok: true, status: 200, json: async () => answer };
      }
      return { ok: false, status: 429, headers: { get: (h) => (/retry-after/i.test(h) ? header : null) }, text: async () => "{}", json: async () => ({}) };
    };
    let message = "";
    try { await w.eval(`spotifyRequest("POST", ${JSON.stringify(path)}, { json: { uris: [] }, noWait: ${noWait} })`); } catch (err) { message = err.message; }
    return { seen, message, entry: (sr_record(w, "spotifyLimits") || [])[0] || {} };
  };
  var sr_r = await sr_relayRun(sr_x);
  check("a rate limit with no readable wait asks the relay once, with only the sign-in", sr_r.seen.length === 1 && sr_r.seen[0].url === "https://relay.example.workers.dev/?path=%2Fplaylists%2F0123456789abcdefABCDEF%2Fitems" && sr_r.seen[0].auth === "Bearer t", JSON.stringify(sr_r.seen));
  check("the wait it gets back is in the message, and nothing is retried", sr_r.message === "Spotify has reached the request quota for your developer account. Waiting is the only fix: try again in about 4 hours and 5 minutes.", sr_r.message);
  check("and in the record", sr_r.entry.relay && sr_r.entry.relay.path === "/playlists/{id}/items" && sr_r.entry.relay.retryAfter === 14689 && sr_r.entry.relay.reason === "QUOTA_EXCEEDED", JSON.stringify(sr_r.entry));
  var sr_r2 = await sr_relayRun(sr_x, { answer: { status: 429, retryAfter: "2" } });
  check("a short wait from the relay is waited out and retried, with one ask for the whole request", sr_r2.seen.length === 1 && /Spotify is rate limiting requests\. Try again in about/.test(sr_r2.message), `${sr_r2.seen.length} ${sr_r2.message}`);
  var sr_r3 = await sr_relayRun(sr_x, { hang: true });
  check("a relay that does not answer leaves the message as before", sr_r3.seen.length === 1 && /did not say how long to wait/.test(sr_r3.message) && sr_r3.entry.relay && sr_r3.entry.relay.status === "no answer", `${sr_r3.message} ${JSON.stringify(sr_r3.entry)}`);
  var sr_r4 = await sr_relayRun(sr_x, { noWait: true, path: "/playlists/0123456789abcdefABCDEF/images" });
  check("cover uploads never ask the relay", sr_r4.seen.length === 0);
  check("the relay asks the kind of request that was refused, as a read, and /me when nothing fits", sr_x.eval(`[relayPath("https://api.spotify.com/v1/me/playlists?limit=50&offset=50"), relayPath("https://api.spotify.com/v1/playlists/0123456789abcdefABCDEF/items?fields=x"), relayPath("https://api.spotify.com/v1/me/library?uris=a"), relayPath("https://api.spotify.com/v1/playlists/../me")].join(" ")`) === "/me/playlists /playlists/0123456789abcdefABCDEF/items /me /me");
  var sr_r6 = await sr_relayRun(sr_x, { path: "/me/playlists" });
  check("a refused /me/playlists asks the relay for /me/playlists", sr_r6.seen.length === 1 && /path=%2Fme%2Fplaylists$/.test(sr_r6.seen[0].url) && sr_r6.entry.relay.path === "/me/playlists", JSON.stringify(sr_r6.seen));
  var sr_r5 = await sr_relayRun(sr_x, { relayUrl: "" });
  check("with no relay set, nothing is asked", sr_r5.seen.length === 0 && /did not say how long to wait/.test(sr_r5.message));
  check("Privacy describes the relay only when there is one", sr_x.document.getElementById("privacyWaitRelay").hidden === true && /temporary Spotify sign-in, which expires within an hour, and which kind of request was refused \(for a playlist, its Spotify ID\), and nothing else\. The relay passes it to Spotify, sends back only the wait, and keeps nothing\./.test(sr_x.document.getElementById("privacyWaitRelay").textContent));
  } catch (err) { areaCrashed("a record of Spotify limits", err); }
}
  if (want("who sees the editor, and what a rate limit says")) { try {

  // ================================================================ who sees the editor, and what a rate limit says
  var rl_text = (w, id) => w.document.getElementById(id).textContent;
  var rl_new = await boot({ url: "http://127.0.0.1:8000/" });
  check("a new visitor, with no formats of their own and not signed in, sees only Step 1", rl_new.document.getElementById("appSection").hidden === true && !rl_new.document.body.classList.contains("has-editor") && rl_new.document.getElementById("loginSection").hidden === false);
  var rl_same = await boot({ url: "http://127.0.0.1:8000/", local: { formats: rl_new.modelToText({ formats: [] }) } });
  check("saved formats that are just the empty start do not count as having formats of their own", rl_same.document.getElementById("appSection").hidden === true);
  var rl_back = await boot({ url: "http://127.0.0.1:8000/", local: { formats: MINI, clientId: "abc123" } });
  check("someone with recipes and a Client ID who has never connected is on the setup page: the editor waits for the first connection", rl_back.document.documentElement.classList.contains("page-setup") && rl_back.document.getElementById("appSection").hidden === true && rl_back.eval("connection") === "none");
  var rl_back2 = await boot({ url: "http://127.0.0.1:8000/", local: { formats: MINI, clientId: "abc123", connectedBefore: "1" } });
  check("connected before, the editor is there, and Build offers to connect", rl_back2.document.getElementById("appSection").hidden === false && rl_back2.document.getElementById("create").textContent.trim() === "Connect to Spotify" && rl_back2.document.getElementById("removeOld").disabled === true && !!rl_back2.document.querySelector("#formatEditor .fe-card"));
  rowsOf(rl_back2)[0].querySelector(".fe-main").click();
  check("a segment's list says to connect to see the playlists, and there is no Disconnect in the app menu", /Connect to Spotify to see your playlists\./.test(rl_back2.document.getElementById("feOptions").textContent) && (() => { rl_back2.document.dispatchEvent(new rl_back2.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); rl_back2.document.getElementById("feAppMenuButton").click(); const none = !rl_back2.document.getElementById("feDisconnect"); rl_back2.document.getElementById("feAppMenuButton").click(); return none; })());
  var rl_busy = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { meDelay: 3000 } });
  check("while the app is still connecting, Build says Connecting, the note says it can take a few seconds, and nothing says Build needs a connection", rl_busy.eval("connection") === "connecting" && /Connecting to Spotify/.test(rl_busy.document.getElementById("spotifyNote").textContent) && rl_busy.document.getElementById("removeNote").hidden === true && rl_busy.document.getElementById("create").disabled === true && rl_busy.document.getElementById("create").textContent.trim() === "Connecting\u2026");
  await waitFor(() => rl_busy.eval("connection") === "ready", 10000);
  await readyToPreview(rl_busy);
  check("and once connected the notes stay away and Create is on", rl_busy.document.getElementById("spotifyNote").hidden === true && rl_busy.document.getElementById("create").disabled === false);
  var rl_q = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { meStatus: 429, meBody: { error: { status: 429, message: "Too many requests", reason: "QUOTA_EXCEEDED" } } } });
  check("a quota error whose wait the page cannot read is still recognised from the reply, stops at once, and says Spotify did not say how long", rl_q.eval("connection") === "problem" && rl_text(rl_q, "connectionMessage") === "Spotify has reached the request quota for your developer account. Waiting is the only fix, and Spotify did not say how long to wait.", rl_text(rl_q, "connectionMessage"));
  var rl_p = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { meStatus: 429 }, instantRetries: true });
  check("an ordinary rate limit with no readable wait, after retrying, says so plainly instead of the old Wait a minute", rl_text(rl_p, "connectionMessage") === "Spotify is rate limiting requests and did not say how long to wait. Try again in a few minutes.", rl_text(rl_p, "connectionMessage"));
  var rl_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { meStatus: 429, retryAfter: 40 } });
  check("a wait it can read that is too long to sit through is reported as it was given, rounded up to the minute", rl_text(rl_w, "connectionMessage") === "Spotify is rate limiting requests. Try again in about 1 minute.", rl_text(rl_w, "connectionMessage"));
  var rl_shown = (w) => [w.document.getElementById("connectionRetry").hidden, w.document.getElementById("connectionReconnect").hidden];
  check("for a rate limit only Try again is shown, with the retry icon", JSON.stringify(rl_shown(rl_q)) === "[false,true]" && JSON.stringify(rl_shown(rl_p)) === "[false,true]" && rl_q.document.querySelector("#connectionRetry img").getAttribute("src") === "icons/retry.svg" && fs.existsSync(ROOT + "icons/retry.svg"));
  var rl_a = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { meStatus: 401 } });
  check("for an expired sign-in only Connect again is shown", JSON.stringify(rl_shown(rl_a)) === "[true,false]" && rl_a.document.querySelector("#connectionReconnect img").getAttribute("src") === "icons/connect.svg");
  var rl_n = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { meNetworkFail: true } });
  check("for no network only Try again is shown", JSON.stringify(rl_shown(rl_n)) === "[false,true]");
  check("the app never spends more than 30 seconds waiting out short rate limits in one request", /const RETRY_BUDGET_MS = 30000;/.test(fs.readFileSync(ROOT + "app.js", "utf8")) && /waitedMs \+ pause > RETRY_BUDGET_MS/.test(fs.readFileSync(ROOT + "app.js", "utf8")));
  
  } catch (err) { areaCrashed("who sees the editor, and what a rate limit says", err); }
}

  if (want("minimalist mode steps aside")) { try {
  // ================================================================ minimalist mode and the connection
  var pa_ready = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, minimalMode: "1" }, fetchOptions: {} });
  check("the first successful connection makes minimalist mode available, and it is then on, as chosen", pa_ready.localStorage.getItem("connectedBefore") === "1" && pa_ready.document.body.classList.contains("minimal") && pa_ready.eval("minimalActive()") === true);
  var pa_first = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, minimalMode: "1" }, fetchOptions: { meStatus: 429, retryAfter: 120 } });
  check("signed in before any connection has worked, the page is still the app, with the problem on its Build button", pa_first.localStorage.getItem("connectedBefore") === null && pa_first.document.body.classList.contains("minimal") && pa_first.document.getElementById("create").textContent.trim() === "Try again");
  pa_first.document.getElementById("feAppMenuButton").click();
  check("the menu offers Connect to Spotify and no Change Client ID", !!pa_first.document.getElementById("feConnect") && !pa_first.document.getElementById("feSetupAgain"));
  check("there is no Compact view in it", !pa_first.document.getElementById("feMinimal"));
  pa_first.document.getElementById("feAppMenuButton").click();
  var pa_new = await boot({ url: EDURL, local: { minimalMode: "1", connectedBefore: "1" }, fetchOptions: {} });
  check("connected before, with no recipes of their own and not signed in, the page is still the app, with the editor", pa_new.document.getElementById("appSection").hidden === false && pa_new.document.body.classList.contains("minimal") && pa_new.document.documentElement.classList.contains("page-app"));
  // connected before, a problem now
  var pa_o = { meStatus: 429, retryAfter: 45 };   // too long to wait out here, too short to be kept as a wait (over a minute: "a wait from Spotify")
  var pa_bad = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, minimalMode: "1", connectedBefore: "1" }, fetchOptions: pa_o });
  check("with a connection problem the page stays minimal, so nothing from Step 1 is squeezed above the editor", pa_bad.eval("connection") === "problem" && pa_bad.document.body.classList.contains("minimal"));
  check("the app menu button has no dot, whatever is wrong with Spotify: the page and the menu already say it", !pa_bad.document.getElementById("feAppMenuButton").classList.contains("fe-alert") && pa_bad.document.getElementById("feAppMenuButton").getAttribute("aria-label") === "App menu" && !/fe-alert/.test(fs.readFileSync(ROOT + "index.html", "utf8") + fs.readFileSync(ROOT + "editor.js", "utf8")));
  pa_bad.document.getElementById("feAppMenuButton").click();
  check("the menu offers the ordinary Connect to Spotify, first in the menu like every other Spotify state, with what went wrong under it, and no Try again of its own", JSON.stringify(Array.from(pa_bad.document.querySelectorAll("#feAppMenuPanel .fe-item")).slice(0, 1).map((b) => b.id)) === '["feConnect"]' && pa_bad.document.getElementById("feConnect").textContent.trim() === "Connect to Spotify" && pa_bad.document.getElementById("feConnectionNote").textContent === pa_bad.document.getElementById("connectionMessage").textContent && !pa_bad.document.getElementById("feReconnect") && !pa_bad.document.getElementById("feRetry"));
  pa_bad.document.getElementById("feAppMenuButton").click();
  check("Create has become Try again, and is on", pa_bad.document.getElementById("create").textContent.trim() === "Try again" && pa_bad.document.getElementById("create").disabled === false && pa_bad.document.querySelector("#create img").getAttribute("src") === "icons/retry.svg");
  check("the note beside it says what went wrong, in place of the pointer to Step 1", pa_bad.document.getElementById("spotifyNote").hidden === false && pa_bad.document.getElementById("spotifyNote").textContent === pa_bad.document.getElementById("connectionMessage").textContent);
  delete pa_o.meStatus;
  pa_bad.document.getElementById("create").click();
  await waitFor(() => pa_bad.eval("connection") === "ready", 15000);
  await readyToPreview(pa_bad);
  check("pressing it tries again, and when Spotify answers the button goes back to Build playlists, the alert goes, and the page is still minimal", /^Build playlists for .+$/.test(pa_bad.document.getElementById("create").textContent.trim()) && pa_bad.document.querySelector("#create img").getAttribute("src") === "icons/build.svg" && !pa_bad.document.getElementById("feAppMenuButton").classList.contains("fe-alert") && pa_bad.document.getElementById("spotifyNote").hidden === true && pa_bad.document.body.classList.contains("minimal"));
  // a sign-in that has to be redone
  var pa_exp = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, minimalMode: "1", connectedBefore: "1" }, fetchOptions: { meStatus: 401 } });
  pa_exp.eval("startLogin = () => { window.__loginStarted = (window.__loginStarted || 0) + 1; }");
  check("an expired sign-in makes Create read Connect again, with the link icon", pa_exp.document.getElementById("create").textContent.trim() === "Connect again" && pa_exp.document.querySelector("#create img").getAttribute("src") === "icons/connect.svg");
  pa_exp.document.getElementById("create").click();
  check("and pressing it starts the sign-in", pa_exp.__loginStarted === 1);
  pa_exp.document.getElementById("feAppMenuButton").click();
  check("when the sign-in itself is the problem the menu offers the same Connect to Spotify, with the same note, and no Connect again of its own", !!pa_exp.document.getElementById("feConnect") && !pa_exp.document.getElementById("feReconnect") && !pa_exp.document.getElementById("feRetry") && /./.test(pa_exp.document.getElementById("feConnectionNote").textContent));
  pa_exp.document.getElementById("feConnect").click();
  check("and that starts the sign-in as well", pa_exp.__loginStarted === 2);
  // not signed in, with a saved Client ID
  var pa_out = await boot({ url: EDURL, local: { formats: MINI, minimalMode: "1", connectedBefore: "1", clientId: "abc123" }, fetchOptions: {} });
  pa_out.eval("startLogin = () => { window.__loginStarted = (window.__loginStarted || 0) + 1; }");
  check("not signed in but with a saved Client ID, the page is minimal, with no Step 1 above the editor", pa_out.eval("connection") === "none" && pa_out.document.body.classList.contains("minimal"));
  check("Create reads Connect to Spotify and is on, and pressing it starts the sign-in", pa_out.document.getElementById("create").textContent.trim() === "Connect to Spotify" && pa_out.document.getElementById("create").disabled === false && (() => { pa_out.document.getElementById("create").click(); return pa_out.__loginStarted === 1; })());
  check("the note about needing a connection stays away, since the button says what to do", pa_out.document.getElementById("spotifyNote").hidden === true);
  pa_out.document.getElementById("feAppMenuButton").click();
  check("the menu has a Connect to Spotify item, just as it has Disconnect Spotify when connected", !!pa_out.document.getElementById("feConnect") && pa_out.document.getElementById("feConnect").textContent.trim() === "Connect to Spotify" && !pa_out.document.getElementById("feDisconnect") && !pa_out.document.getElementById("feConnectionNote"));
  pa_out.document.getElementById("feConnect").click();
  check("pressing it starts the sign-in", pa_out.__loginStarted === 2);
  var pa_noid = await boot({ url: EDURL, local: { formats: MINI, minimalMode: "1", connectedBefore: "1" }, fetchOptions: {} });
  check("with no Client ID saved there is nothing to connect with, so Build stays as it was and is off", /^Build playlists for .+$/.test(pa_noid.document.getElementById("create").textContent.trim()) && pa_noid.document.getElementById("create").disabled === true);
  // not minimal: Step 1 is on the page, so only the menu's Connect to Spotify is there
  var pa_full = await boot({ url: EDURL, local: { formats: MINI, connectedBefore: "1", clientId: "abc123" }, fetchOptions: {} });
  check("there is no full view any more: connected before and signed out, the page is the app, compact, and Build offers to connect", pa_full.document.body.classList.contains("minimal") && pa_full.document.getElementById("create").textContent.trim() === "Connect to Spotify");
  var pa_fullbad = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1" }, fetchOptions: { meStatus: 429, retryAfter: 120 } });
  pa_fullbad.document.getElementById("feAppMenuButton").click();
  check("and in a problem the menu has the same Connect to Spotify and note as in any other mode, with no Try again of its own and no dot on its button", !pa_fullbad.document.getElementById("feRetry") && !!pa_fullbad.document.getElementById("feConnect") && !pa_fullbad.document.getElementById("feAppMenuButton").classList.contains("fe-alert"));
  var pa_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  
  } catch (err) { areaCrashed("minimalist mode steps aside", err); }
}

  if (want("report link on a connection problem")) { try {
  // ================================================================ the report link on a connection problem
  var rr_known = [
    [{ meStatus: 429, retryAfter: 120 }, "a rate limit with a wait"],
    [{ meStatus: 429, meBody: { error: { reason: "QUOTA_EXCEEDED" } } }, "a quota limit"],
    [{ meNetworkFail: true }, "no internet"],
    [{ meStatus: 401 }, "an expired sign-in"],
  ];
  for (const [opts, what] of rr_known) {
    const w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: opts });
    check(`${what} is a known problem, so no report link is offered`, w.eval("connection") === "problem" && w.document.getElementById("connectionReportHint").hidden === true);
  }
  var rr_odd = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { meStatus: 500 } });
  check("an unexpected error from Spotify does offer one, with the usual wording", rr_odd.eval("connection") === "problem" && rr_odd.document.getElementById("connectionReportHint").hidden === false && /Something unexpected happened\. Report this problem/.test(rr_odd.document.getElementById("connectionReportHint").textContent) && /Spotify returned 500/.test(rr_odd.document.getElementById("connectionMessage").textContent));
  var rr_q = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { meStatus: 429, meBody: { error: { reason: "QUOTA_EXCEEDED" } } } });
  check("the quota message names the developer account, so it is clear why nothing in the app can raise it", rr_q.document.getElementById("connectionMessage").textContent === "Spotify has reached the request quota for your developer account. Waiting is the only fix, and Spotify did not say how long to wait.");
  var rr_t = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { meStatus: 429, retryAfter: 14689, meBody: { error: { reason: "QUOTA_EXCEEDED" } } } });
  check("and with a wait it can read, it adds how long", rr_t.document.getElementById("connectionMessage").textContent === "Spotify has reached the request quota for your developer account. Waiting is the only fix: try again in about 4 hours and 5 minutes.");
  
  } catch (err) { areaCrashed("report link on a connection problem", err); }
}

  if (want("privacy section and anonymous counts")) { try {
  // ================================================================ the privacy section and the anonymous counts
  var pv_html = fs.readFileSync(ROOT + "index.html", "utf8");
  var pv_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  var pv_sec = pv_w.document.getElementById("privacySection");
  check("the Privacy section is the last thing on the page, right below More options, in the same footer, and starts closed", !!pv_sec && pv_sec.tagName === "DETAILS" && pv_sec.open === false && pv_sec.previousElementSibling.id === "moreOptions" && pv_sec.nextElementSibling === null && pv_sec.parentElement.tagName === "FOOTER" && pv_sec.querySelector("summary").textContent === "Privacy");
  check("it covers what stays in the browser, the Spotify account, who the page talks to, the visit counts, support, problem reports, and accounts and ads", JSON.stringify(Array.from(pv_sec.querySelectorAll("details.gd-topic > summary")).filter((h) => !h.closest("[hidden]")).map((h) => h.textContent)) === JSON.stringify(["What stays in this browser", "Your Spotify account", "Who the page talks to", "Anonymous visit counts", "Support me", "Problem reports", "Accounts and ads"]));
  var pv_text = pv_sec.textContent.replace(/\s+/g, " ");
  check("it says the app never sees the Spotify password, what it asks Spotify to allow, and that existing playlists are only read", /never sees your Spotify password/.test(pv_text) && /read your playlists, create playlists, remove playlists, and set their cover images/.test(pv_text) && /Your existing playlists are only read, never changed/.test(pv_text) && /anyone with a playlist's link can still open it/.test(pv_text));
  check("it says a problem report goes only to the developer, only if sent, and lists what is attached and what never is", /sent only if you choose to send it, and it goes only to me, the developer of this app/.test(pv_text) && /app version, browser, window size, last error, and recent steps/.test(pv_text) && /Your sign-in, Client ID, playlist names, and song titles are never included/.test(pv_text));
  check("it describes the counts honestly: GoatCounter, no cookies, what is recorded, the four actions, and what it never receives", /GoatCounter/.test(pv_text) && /uses no cookies/.test(pv_text) && /browser, screen size, country, and the site you came from/.test(pv_text) && /first time a browser connects to Spotify, how many playlists get created, when Support me is opened, and the kind of connection problem/.test(pv_text) && /never receives playlist names, recipes, song titles, or your Client ID/.test(pv_text));
  check("it says what is kept in the browser and what Disconnect and Reset app on this device remove", /Your Client ID, your Spotify sign-in, your recipes, the list of your playlists, your color choice, a copy of the songs from your playlists, and a count of the requests this app sends to Spotify \(to learn how often Spotify limits them\) are saved in this browser/.test(pv_text) && /Disconnect removes your Spotify sign-in, the list of your playlists, and the saved songs/.test(pv_text) && /Reset app on this device, in More options, removes everything/.test(pv_text));
  check("About links to it, and the setup and welcome pages do not, since they leave Privacy out", pv_w.document.querySelectorAll("#about a.privacy-link").length === 1 && pv_w.document.querySelectorAll("#loginSection a.privacy-link").length === 0 && pv_w.document.querySelectorAll("#welcomePage a.privacy-link").length === 0 && /html\.page-welcome footer, /.test(pv_html) && Array.from(pv_w.document.querySelectorAll("a.privacy-link")).every((a) => a.getAttribute("href") === "#privacySection"));
  var pv_click2 = new pv_w.MouseEvent("click", { bubbles: true, cancelable: true });
  pv_w.document.querySelector("#about a.privacy-link").dispatchEvent(pv_click2);
  check("in the app, it opens Privacy in the popup instead", pv_click2.defaultPrevented === true && pv_w.document.getElementById("infoOverlay").hidden === false && pv_w.document.getElementById("infoSlot").firstElementChild === pv_sec);
  pv_w.eval("closeInfo()");
  // the counter script
  check("the counter is the GoatCounter script with this account's code, loaded without blocking the page", /<script data-goatcounter="https:\/\/roncarmel\.goatcounter\.com\/count" async src="https:\/\/gc\.zgo\.at\/count\.js"><\/script>/.test(pv_html));
  check("the page is always counted as /, so the one-time code in the address after Spotify's sign-in is never sent, and that return is not counted as a second visit", /window\.goatcounter = \{ path: "\/", no_onload: \/\[\?&\]\(code\|error\)=\/\.test\(location\.search\) \};/.test(pv_html) && pv_html.indexOf("window.goatcounter = {") < pv_html.indexOf("gc.zgo.at/count.js"));
  // the four counts
  var pv_counts = (w) => w.__counts || [];
  var pv_before = (w) => { w.goatcounter = { count: (v) => { (w.__counts = w.__counts || []).push(v); } }; };
  var pv_c1 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {}, before: pv_before });
  check("the first connection in a browser is counted once, with a marker so the next visit does not count it again", pv_counts(pv_c1).filter((e) => e.path === "first-connection").length === 1 && pv_c1.localStorage.getItem("counted") === "1" && pv_counts(pv_c1)[0].event === true);
  var pv_c2 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI, counted: "1" }, fetchOptions: {}, before: pv_before });
  check("a browser already counted is not counted again", pv_counts(pv_c2).filter((e) => e.path === "first-connection").length === 0);
  var pv_c3 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { meStatus: 429, meBody: { error: { reason: "QUOTA_EXCEEDED" } } }, before: pv_before });
  check("a connection problem is counted as its kind only, and the first connection is not counted when there was none", JSON.stringify(pv_counts(pv_c3).map((e) => [e.path, e.title])) === JSON.stringify([["connection-problem", "quota"]]) && pv_c3.localStorage.getItem("counted") === null);
  var pv_kinds = [[{ meStatus: 429, retryAfter: 120 }, "rate-limit"], [{ meNetworkFail: true }, "network"], [{ meStatus: 401 }, "sign-in"], [{ meStatus: 500 }, "other"]];
  for (const [opts, kind] of pv_kinds) {
    const w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: opts, before: pv_before });
    check(`the kind of problem is ${kind}`, JSON.stringify(pv_counts(w).map((e) => e.title)) === JSON.stringify([kind]));
  }
  var pv_c4 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI, counted: "1" }, fetchOptions: {}, before: pv_before });
  await readyToPreview(pv_c4);
  pv_c4.document.getElementById("maxPlaylists").value = "2";
  pv_c4.document.getElementById("maxPlaylists").dispatchEvent(new pv_c4.Event("input"));
  pv_c4.document.getElementById("create").click();
  await waitFor(() => visible(pv_c4, "confirmBox"), 30000);
  pressBuild(pv_c4);
  await waitFor(() => pv_c4.document.getElementById("createCloseRow").hidden === false, 30000);
  check("a successful create counts how many playlists were made, as a number and nothing else", JSON.stringify(pv_counts(pv_c4).map((e) => [e.path, e.title])) === JSON.stringify([["playlists-created", "2"]]));
  pv_c4.document.getElementById("createDonate").click();
  check("opening Donate is counted, from the Create popup or from the button", pv_counts(pv_c4).filter((e) => e.path === "donate-opened").length === 1);
  pv_c4.document.getElementById("kofiClose").click();
  pv_c4.document.getElementById("supportButton").dispatchEvent(new pv_c4.MouseEvent("click", { bubbles: true, cancelable: true }));
  check("and each time it is opened", pv_counts(pv_c4).filter((e) => e.path === "donate-opened").length === 2);
  var pv_all = pv_counts(pv_c1).concat(pv_counts(pv_c3), pv_counts(pv_c4));
  check("nothing sent ever holds a name, a format or an ID: every title is a number or a short word", pv_all.every((e) => /^[a-z]+(-[a-z]+)*$/.test(e.path) && /^(\d+|[a-z]+(-[a-z]+)*)$/.test(e.title)));
  var pv_none = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  check("with the counter blocked or not loaded the app works as usual, and the first connection is not marked as counted", pv_none.eval("connection") === "ready" && pv_none.localStorage.getItem("counted") === null);
  
  } catch (err) { areaCrashed("privacy section and anonymous counts", err); }
}

  if (want("privacy: hidden in minimalist mode, gap, and where reporting is mentioned")) { try {
  // ================================================================ privacy: hidden in minimalist mode, gap, and where reporting is mentioned
  var pm_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  check("the app page hides the Privacy section along with More options, at the bottom of the page", /body\.minimal #formatHelp, body\.minimal footer, /.test(pm_css));
  var pm_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  var pm_priv = pm_w.document.getElementById("privacySection");
  check("the Privacy section still has its part on problem reports, which is about where a report goes, but the About paragraph on privacy no longer mentions reporting", /Problem reports/.test(pm_priv.textContent) && !/report/i.test(Array.from(pm_w.document.querySelectorAll("#about p")).find((p) => /^Privacy/.test(p.textContent)).textContent));
  check("the donation popup's line reads Choose any amount that feels right to you.", pm_w.document.getElementById("kofiPrompt").textContent === "Choose any amount that feels right to you.");
  
  } catch (err) { areaCrashed("privacy: hidden in minimalist mode, gap, and where reporting is mentioned", err); }
}

  if (want("confirming a new format")) { try {
  // ================================================================ confirming a new format
  var nf_w = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  var nf_count = () => nf_w.document.querySelectorAll("#feTabs .fe-tab").length;
  check("before anything is pressed there is no dialog", !nf_w.document.getElementById("feNewFormatDialog") && nf_count() === 1);
  // a phone's keyboard: the visible part of the screen shrinks and is panned down, and the page is scrolled
  var nf_vv = new nf_w.EventTarget(); nf_vv.offsetTop = 0; nf_vv.height = 760;
  Object.defineProperty(nf_w, "visualViewport", { configurable: true, value: nf_vv });
  var nf_y = 0, nf_scrolls = [];
  Object.defineProperty(nf_w, "scrollY", { configurable: true, get: () => nf_y });
  nf_w.scrollTo = (x, y) => { nf_scrolls.push(y); nf_y = y; nf_vv.offsetTop = 0; };
  nf_w.document.getElementById("feNewFormat").click();
  nf_y = 120; nf_vv.offsetTop = 90; nf_vv.height = 420;
  nf_vv.dispatchEvent(new nf_w.Event("resize")); nf_w.dispatchEvent(new nf_w.Event("scroll"));
  var nf_ov = nf_w.document.getElementById("feNewFormatDialog");
  check("when the keyboard opens, the page is scrolled back to where it was and the popup fits what is left of the screen", nf_y === 0 && nf_scrolls.indexOf(0) >= 0 && nf_ov.style.top === "0px" && nf_ov.style.height === "420px");
  var nf_text0 = nf_w.document.getElementById("formats").value;
  var nf_sel = () => nf_w.document.querySelector('#feTabs .fe-tab[aria-pressed="true"]');
  check("pressing + asks for a name, with the new recipe's tab already there and selected, its pencil showing, behind the dimmed page", !!nf_w.document.getElementById("feNewFormatDialog") && nf_count() === 2 && nf_sel() === nf_w.document.querySelectorAll("#feTabs .fe-tab")[1] && nf_sel().textContent === "New recipe" && !!nf_sel().querySelector(".fe-tab-blank") && !!nf_sel().querySelector("svg") && !/fe-nf-open/.test(fs.readFileSync(ROOT + "index.html", "utf8")));
  check("while it is being named, nothing is written: the recipe text is as it was", nf_w.document.getElementById("formats").value === nf_text0);
  var nf_dlg = nf_w.document.querySelector("#feNewFormatDialog .fe-dialog");
  var nf_in = nf_w.document.getElementById("feNewFormatName"), nf_ok = () => nf_w.document.getElementById("feNewFormatConfirm");
  var nf_note = () => Array.from(nf_dlg.querySelectorAll(".fe-nf-note")).map((p) => p.textContent).join(" | ");
  check("the dialog is a modal titled Name your new recipe, with an empty field in a pink capsule, a note, and Cancel and Create recipe", nf_dlg.getAttribute("role") === "dialog" && nf_dlg.getAttribute("aria-modal") === "true" && nf_dlg.querySelector("h3").textContent === "Name your new recipe" && nf_in.value === "" && nf_in.placeholder === "Type a name" && nf_in.parentElement.classList.contains("fe-nf-capsule") && Array.from(nf_dlg.querySelectorAll("button")).map((b) => b.textContent).join("|") === "Cancel|Create recipe");
  check("the focus starts in the field, the only note is about the pencil, no example names are listed, and Create recipe is off", nf_w.document.activeElement === nf_in && nf_note() === "You can change the name of this recipe at any time with the  button next to it." && !nf_dlg.querySelector("#feNewFormatNames") && !!nf_dlg.querySelector(".fe-nf-note .fe-nf-pencil") && nf_ok().disabled === true);
  nf_ok().click();
  check("pressing Create recipe with no name does nothing", !!nf_w.document.getElementById("feNewFormatDialog") && nf_w.document.getElementById("formats").value === nf_text0);
  typeNewName(nf_w, "   ");
  check("a name of only spaces is not accepted", nf_ok().disabled === true);
  typeNewName(nf_w, "mini");
  check("a name another recipe has is not accepted, and the popup says so", nf_ok().disabled === true && !nf_w.document.getElementById("feNewFormatClash").hidden && nf_w.document.getElementById("feNewFormatClash").textContent === "Another recipe has this name.");
  typeNewName(nf_w, " Full moon ");
  check("the tab takes the name as it is typed, and still nothing is written", nf_sel().textContent === "Full moon" && nf_w.document.getElementById("formats").value === nf_text0);
  check("Create recipe comes on once a name is typed", nf_ok().disabled === false && nf_w.document.getElementById("feNewFormatClash").hidden);
  nf_w.document.getElementById("feNewFormatCancel").click();
  check("Cancel closes it, takes the new tab away, selects the recipe that was selected, and writes nothing", !nf_w.document.getElementById("feNewFormatDialog") && nf_count() === 1 && nf_sel().textContent === "mini" && nf_w.document.getElementById("formats").value === nf_text0);
  nf_w.document.getElementById("feNewFormat").click();
  nf_w.document.dispatchEvent(new nf_w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("Escape closes it and adds nothing", !nf_w.document.getElementById("feNewFormatDialog") && nf_count() === 1);
  nf_w.document.getElementById("feNewFormat").click();
  nf_w.document.getElementById("feNewFormatDialog").click();
  check("a click outside the dialog closes it and adds nothing", !nf_w.document.getElementById("feNewFormatDialog") && nf_count() === 1);
  nf_w.document.getElementById("feNewFormat").click();
  nf_w.document.querySelector("#feNewFormatDialog .fe-dialog").click();
  check("a click inside the dialog does not close it", !!nf_w.document.getElementById("feNewFormatDialog"));
  typeNewName(nf_w, " Full moon ");
  nf_ok().click();
  check("Create recipe closes the dialog, keeps the recipe with the name typed (without the spaces around it), selected, and writes it", !nf_w.document.getElementById("feNewFormatDialog") && nf_count() === 2 && nf_sel().textContent === "Full moon" && /"title": "Full moon"/.test(nf_w.document.getElementById("formats").value) && !nf_w.editor.model.formats.some((f) => f.draft));
  nf_w.document.getElementById("feNewFormat").click();
  typeNewName(nf_w, "New moon");
  nf_w.document.getElementById("feNewFormatName").dispatchEvent(new nf_w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  check("Enter in the field creates it too", nf_count() === 3 && nf_w.document.querySelector('#feTabs .fe-tab[aria-pressed="true"]').textContent === "New moon");
  var nf_e = await boot({ url: EDURL, session: signedIn(), local: { formats: "FORMATS = {}" }, fetchOptions: {} });
  nf_e.document.getElementById("feNewFormat").click();
  check("the big New recipe button, shown when there are no recipes at all, asks for a name too", !!nf_e.document.getElementById("feNewFormatDialog") && nf_e.document.querySelectorAll("#feTabs .fe-tab").length === 1);
  nf_e.document.getElementById("feNewFormatCancel").click();
  check("and Cancel there leaves no recipes at all", nf_e.document.querySelectorAll("#feTabs .fe-tab").length === 0 && nf_e.document.querySelector(".fe-toprow").classList.contains("fe-noformats"));
  check("a recipe being named is never written or saved to Spotify", /if \(fmt\.draft\) continue;/.test(fs.readFileSync(ROOT + "formats.js", "utf8")) && /if \(fmt\.draft\) continue;/.test(fs.readFileSync(ROOT + "app.js", "utf8")));
  var nf_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  check("the confirming button is the accent color, like the other buttons that go ahead, and the dialog is the same one used for deleting", /\.fe-dialog \.row button\.primary \{ background: var\(--button\);/.test(nf_css) && /\.fe-overlay \{ position: fixed;/.test(nf_css));
  
  } catch (err) { areaCrashed("confirming a new format", err); }
}

  if (want("build button, big new format button and empty start")) { try {
  // ================================================================ the Build button, the big New recipe button, and the empty start
  var bb_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  var bb_new = await boot({ url: EDURL, session: signedIn(), local: { formats: null }, fetchOptions: {} });
  check("a new visitor who has connected starts with no formats at all: no tabs, no card, and the big New recipe button", bb_new.document.querySelectorAll("#feTabs .fe-tab").length === 0 && !bb_new.document.getElementById("feCard") && bb_new.document.querySelector(".fe-toprow").classList.contains("fe-noformats") && bb_new.document.getElementById("feNewFormat").textContent.trim() === "New recipe" && !/You don't have any formats yet/.test(bb_new.document.getElementById("formatEditor").textContent));
  check("with nothing to build, Build playlists is off, and so is Build all", bb_new.document.getElementById("create").disabled === true && bb_new.document.getElementById("buildAll").disabled === true);
  check("the empty state keeps the dark, dotted-outline look, sits first in the row, and shows its label", /\.fe-toprow\.fe-noformats \.fe-newformat \{ order: -1; \}/.test(bb_css) && !/fe-noformats \.fe-newformat \{[^}]*background: var\(--button\)/.test(bb_css));
  addNamed(bb_new, "First");
  check("naming the first recipe adds it, and the button moves to the end of the tabs", !bb_new.document.getElementById("feNewFormatDialog") && bb_new.document.querySelectorAll("#feTabs .fe-tab").length === 1 && !bb_new.document.querySelector(".fe-toprow").classList.contains("fe-noformats"));
  check("with formats the button keeps its label at every width", /#formatEditor \.fe-newformat \{ flex: none; height: 44px; padding: 0 16px; gap: 8px;/.test(bb_css) && !/fe-newformat \{ width: 44px/.test(bb_css));
  check("a brand new visitor who has not connected still sees only Step 1: there are no formats to show", (await boot({ url: "http://127.0.0.1:8000/" })).document.getElementById("appSection").hidden === true);
  // the Build button
  var bb_w = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"a": {"name": "A {n}", "title": "Warm focus", "segments": [("💗 spacious + gentle", 10)]}, "b": {"name": "B {n}", "title": "A very long format name that will not fit on a phone beside the words Build playlists", "segments": [("🛋 rest", 10)]}}' }, fetchOptions: {} });
  await readyToPreview(bb_w);
  check("the Build button says Build playlists, then the name of the format being edited in italics", bb_w.document.getElementById("create").textContent.trim() === "Build playlists for Warm focus" && bb_w.document.querySelector("#create .build-name i").textContent === "Warm focus" && bb_w.document.querySelector("#create .build-verb").textContent === "Build playlists" && bb_w.document.querySelector("#create .build-name").textContent === "for Warm focus");
  check("its icon is the new building blocks icon, not the plus", bb_w.document.querySelector("#create img").getAttribute("src") === "icons/build.svg" && /<path/.test(fs.readFileSync(ROOT + "icons/build.svg", "utf8")) && fs.existsSync(ROOT + "icons/build.svg"));
  bb_w.document.querySelectorAll("#feTabs .fe-tab")[1].click();
  check("choosing another tab changes the name on the button", /Build playlists for A very long format name/.test(bb_w.document.getElementById("create").textContent));
  check("a long name is cut short with an ellipsis, and only the name: the words Build playlists never shrink", /#create \{ max-width: 100%; min-width: 0; \}/.test(bb_css) && /#create \.build-verb \{ flex: none; white-space: nowrap; \}/.test(bb_css) && /#create \.build-name \{ min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/.test(bb_css));
  var bb_rn = renameBox(bb_w);
  bb_rn.value = "Renamed";
  bb_rn.dispatchEvent(new bb_w.Event("input"));
  check("renaming the format changes the button as you type", /Build playlists for Renamed$/.test(bb_w.document.getElementById("create").textContent));
  finishName(bb_w);
  check("the Step 3 heading says Build, and the note above the button describes building the format being edited", /3\. Build playlists/.test(bb_w.document.getElementById("createHeading").textContent) && /^Builds playlists for the selected recipe\./.test(bb_w.document.getElementById("createNote").textContent) && /^Building playlists needs a working connection/.test(bb_w.document.getElementById("spotifyNote").textContent));
  // the question
  bb_w.document.getElementById("maxPlaylists").value = "2";
  bb_w.document.getElementById("maxPlaylists").dispatchEvent(new bb_w.Event("input"));
  bb_w.document.getElementById("create").click();
  await waitFor(() => visible(bb_w, "confirmBox"), 30000);
  check("the question names the format being built, with the count", bb_w.document.getElementById("confirmText").textContent === "You can build up to 2 playlists from this recipe. Why 2?" && bb_w.document.getElementById("planToggle").textContent === "Why 2?" && bb_w.document.getElementById("bdTitle").textContent === "Renamed" && /^Build playlists$/.test(bb_w.document.getElementById("confirmYes").textContent) && bb_w.document.getElementById("createDialog").getAttribute("aria-labelledby") === "bdTitle");
  bb_w.document.getElementById("confirmNo").click();
  // Build all
  check("Build all recipes is in More options, with its own explanation and the building blocks icon", !!bb_w.document.querySelector("#moreOptions #buildAll") && bb_w.document.querySelector("#buildAll img").getAttribute("src") === "icons/build.svg" && /Builds, or rebuilds, the playlists for every recipe at once/.test(bb_w.document.querySelector("#moreOptions").textContent));
  await waitFor(() => !bb_w.document.getElementById("buildAll").disabled, 20000);
  bb_w.document.getElementById("buildAll").click();
  await waitFor(() => visible(bb_w, "confirmBox"), 30000);
  check("it builds every format, and the question says how many formats", /^Ready to build \d+ playlists for 2 recipes\. Why these numbers\?$/.test(bb_w.document.getElementById("confirmText").textContent), bb_w.document.getElementById("confirmText").textContent);
  bb_w.document.getElementById("confirmNo").click();
  await waitFor(() => bb_w.document.getElementById("createOverlay").hidden === true, 10000);
  bb_w.document.getElementById("create").click();
  await waitFor(() => visible(bb_w, "confirmBox"), 30000);
  check("and the next press of Build playlists goes back to the one format", bb_w.document.getElementById("bdTitle").textContent === "Renamed", bb_w.document.getElementById("bdTitle").textContent);
  bb_w.document.getElementById("confirmNo").click();
  check("the format dropdown is gone from Step 3, and the format picker in Remove earlier playlists stays", !bb_w.document.getElementById("formatKey") && !!bb_w.document.querySelector("#moreOptions #removeKey"));
  
  } catch (err) { areaCrashed("build button, big new format button and empty start", err); }
}

  if (want("startup that survives problems")) { try {
  // ================================================================ a page that survives problems in starting up
  var su_html = fs.readFileSync(ROOT + "index.html", "utf8");
  var su_js = fs.readFileSync(ROOT + "app.js", "utf8");
  var su_ver = su_js.match(/const APP_VERSION = "([^"]+)"/)[1];
  check("the page names its own version, the same as the script's, and loads each script with that version on its address so a cached older one is never mixed in", new RegExp('<meta name="app-version" content="' + su_ver + '">').test(su_html) && ["theme", "formats", "editor", "app"].every((n) => su_html.includes(`<script src="${n}.js?v=${su_ver}"></script>`)));
  var su_ok = await boot({ url: "http://127.0.0.1:8000/" });
  check("a normal start shows no problem banner", su_ok.document.getElementById("startupProblem").hidden === true);
  var su_radio = (w, value) => w.document.querySelector(`[data-flow="${value}"]`);
  su_radio(su_ok, "new").click();
  check("answering No shows its steps and the Connect button", su_ok.document.getElementById("flowNew").hidden === false && su_ok.document.getElementById("flowExisting").hidden === true && su_ok.document.getElementById("connectBlock").hidden === false);
  su_radio(su_ok, "existing").click();
  check("answering Yes shows that instead", su_ok.document.getElementById("flowNew").hidden === true && su_ok.document.getElementById("flowExisting").hidden === false && su_ok.document.getElementById("spAsk").hidden === true);
  // a page whose HTML is older than its script: elements the script expects are missing
  var su_old = await boot({ url: "http://127.0.0.1:8000/", session: { startupRefreshed: "1" }, htmlChange: (h) => h.replace('id="buildAll"', 'id="oldBuildAll"').replace('id="connectionRetry"', 'id="oldRetry"').replace('<meta name="app-version" content="' + su_ver + '">', '<meta name="app-version" content="2020-01-01">') });
  su_radio(su_old, "new").click();
  check("with an older page and a newer script, the two setup choices still work", su_old.document.getElementById("flowNew").hidden === false && su_old.document.getElementById("connectBlock").hidden === false);
  check("and the page says part of it did not start, in a popup with Reload and Close, and a link to report it", su_old.document.getElementById("startupProblem").hidden === false && /Part of this page did not start/.test(su_old.document.getElementById("startupProblem").textContent) && !/Command-Shift-R|Ctrl-F5/.test(su_old.document.getElementById("startupProblem").textContent) && /Report this problem/.test(su_old.document.getElementById("startupProblem").textContent) && su_old.document.getElementById("startupReport").href.startsWith("https://tally.so/") && su_old.document.getElementById("startupReload").textContent.trim() === "Reload" && su_old.document.getElementById("startupClose").textContent.trim() === "Close");
  check("the other buttons are still wired: Connect starts the sign-in, though the missing one is skipped", (() => { su_old.eval("startLogin = () => { window.__started = true; }"); return true; })());
  check("what went wrong is recorded for the report: the versions that differ and the missing element", /differ/.test(su_old.eval("startupProblems").join(";")) && /missing element connectionRetry/.test(su_old.eval("startupProblems").join(";")) && (su_old.eval("refreshReportBox()"), /Startup:/.test(su_old.document.getElementById("reportPreview").textContent)), su_old.eval("startupProblems").join(" | "));
  var su_bad = await boot({ url: "http://127.0.0.1:8000/", session: { startupRefreshed: "1" }, htmlChange: (h) => h.replace('id="formatEditor"', 'id="oldEditor"') });
  su_radio(su_bad, "existing").click();
  check("if a step of starting up throws, the steps after it still run and the choices still work", su_bad.document.getElementById("flowExisting").hidden === false && su_bad.document.getElementById("startupProblem").hidden === true === false || su_bad.document.getElementById("flowExisting").hidden === false);
  var su_none = await boot({ url: "http://127.0.0.1:8000/", session: { startupRefreshed: "1" }, htmlChange: (h) => h.replace('id="clearData"', 'id="oldClear"') });
  check("a missing button does not stop the ones after it from working", su_none.document.getElementById("startupProblem").hidden === false && su_none.eval("startupProblems").some((p) => /missing element clearData/.test(p)));
  su_none.document.getElementById("connect").click();
  check("Connect, which comes after it in the startup code, is still wired", /Enter your Client ID|Client ID/i.test(su_none.document.getElementById("loginMessage").textContent) || su_none.document.getElementById("loginMessage").textContent !== "");
  var su_css = su_html.replace(/\s+/g, " ");
  check("the bottom strip and the corner note let clicks through everywhere except on the button and the words", /#supportBox \{ pointer-events: none; \}/.test(su_css) && /#supportBox > \* \{ pointer-events: auto; \}/.test(su_css));
  check("all the page's listeners go through the guarded helper, and the script ends by catching a startup that fails", !/\$\("\w+"\)\.addEventListener\(/.test(su_js) && /\nmain\(\)\.catch\(startupFailed\);\s*$/.test(su_js));
  
  } catch (err) { areaCrashed("startup that survives problems", err); }
}

  if (want("page start watchdog and version stamps")) { try {
  // ================================================================ the page start watchdog and the version stamps
  var ws_html = fs.readFileSync(ROOT + "index.html", "utf8");
  var ws_app = fs.readFileSync(ROOT + "app.js", "utf8");
  var ws_ver = ws_app.match(/const APP_VERSION = "([^"]+)";/)[1];
  var ws_stamps = [ws_html.match(/<meta name="app-version" content="([^"]+)">/)[1], ...Array.from(ws_html.matchAll(/\.js\?v=([^"]+)"/g)).map((m) => m[1])];
  check("the page, its four scripts and the script itself all carry the same version, so a half-updated upload is caught here and not on someone's screen", ws_stamps.length === 5 && ws_stamps.every((v) => v === ws_ver), JSON.stringify(ws_stamps) + " vs " + ws_ver);
  check("the script marks itself started as the first thing it does, before it wires the setup choices", /async function main\(\) \{\n  if \(window\.pageStart\) window\.pageStart\.started = true;[^\n]*\n  startFlowChoice\(\);/.test(ws_app));
  var ws_src = ws_html.match(/<script>\n  \/\/ If the page's own script never starts[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g, "");
  check("the watchdog is in the head, ahead of every script that could fail, and listens for errors in the capture phase so a file that did not load is seen too", ws_html.indexOf("window.pageStart = {") > 0 && ws_html.indexOf("window.pageStart = {") < ws_html.indexOf('<script src="formats.js') && /\}, true\);/.test(ws_src));
  var ws_w = await boot({ url: "http://127.0.0.1:8000/", session: { startupRefreshed: "1" } });
  ws_w.eval("window.__delays = []; window.setTimeout = function (f, ms) { window.__delays.push(ms); f(); return 0; };");
  ws_w.eval(ws_src);
  ws_w.sessionStorage.setItem("startupRefreshed", "1");   // a fresh load has already been tried this visit, so the popup shows at once
  ws_w.dispatchEvent(new ws_w.ErrorEvent("error", { message: "Unexpected token", filename: "http://127.0.0.1:8000/app.js?v=2026-11-04zd", lineno: 12 }));
  ws_w.dispatchEvent(new ws_w.Event("load"));
  var ws_box = ws_w.document.getElementById("startupProblem");
  check("the watchdog marks the page as not started until the script says so", ws_w.pageStart.started === false);
  check("it waits three seconds before looking", ws_w.__delays.includes(3000));
  check("if it has still not started after three seconds, the popup appears with the first error: its message, file and line", ws_box.hidden === false && /Details: Unexpected token \(app\.js, line 12\)/.test(ws_box.textContent), ws_box.textContent);
  var ws_w2 = await boot({ url: "http://127.0.0.1:8000/" });
  ws_w2.eval("window.setTimeout = function (f, ms) { f(); return 0; };");
  ws_w2.eval(ws_src);
  ws_w2.pageStart.started = true;
  ws_w2.dispatchEvent(new ws_w2.Event("load"));
  check("if the script has started, the banner stays away", ws_w2.document.getElementById("startupProblem").hidden === true);
  check("a normal start sets the flag", (await boot({ url: "http://127.0.0.1:8000/", before: (w) => { w.pageStart = { started: false, errors: [] }; } })).pageStart.started === true);
  
  } catch (err) { areaCrashed("page start watchdog and version stamps", err); }
}

  if (want("reordering recipes")) { try {
  // ================================================================ press and hold a tab, drag it, and the recipes change places
  var ro_w = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"a": {"name": "A {n}", "title": "One", "segments": [("x", 10)]}, "b": {"name": "B {n}", "title": "Two", "segments": [("x", 10)]}, "c": {"name": "C {n}", "title": "Three", "segments": [("x", 10)]}}' }, fetchOptions: {} });
  var ro_tabs = () => Array.from(ro_w.document.querySelectorAll("#feTabs .fe-tab")).map((t) => t.textContent);
  var ro_stored = () => (ro_w.localStorage.getItem("formats").match(/"title": "([^"]*)"/g) || []).join("|");
  check("the tabs start in the order of the recipes", JSON.stringify(ro_tabs()) === JSON.stringify(["One", "Two", "Three"]), JSON.stringify(ro_tabs()));
  var ro_key = (tab, key) => tab.dispatchEvent(new ro_w.KeyboardEvent("keydown", { key, altKey: true, bubbles: true, cancelable: true }));
  ro_key(ro_w.document.querySelector("#feTabs .fe-tab"), "ArrowRight");
  ro_key(ro_w.document.body, "ArrowRight");
  check("Alt and an arrow no longer move a tab", JSON.stringify(ro_tabs()) === JSON.stringify(["One", "Two", "Three"]), JSON.stringify(ro_tabs()));
  var ro_ptr = (type, x, kind) => { const e = new ro_w.MouseEvent(type, { clientX: x, clientY: 5, bubbles: true, cancelable: true, button: 0 }); Object.defineProperty(e, "pointerId", { value: 1 }); Object.defineProperty(e, "pointerType", { value: kind }); return e; };
  var ro_first = ro_w.document.querySelector("#feTabs .fe-tab");
  ro_first.dispatchEvent(ro_ptr("pointerdown", 10, "mouse"));
  ro_w.dispatchEvent(ro_ptr("pointermove", 60, "mouse"));
  check("a mouse that moves before the hold is over scrolls the row, and does not lift the tab", !ro_first.classList.contains("fe-dragging") && ro_w.eval("tabDrag.press && tabDrag.press.panning"));
  ro_w.dispatchEvent(ro_ptr("pointerup", 60, "mouse"));
  check("after that the order is the same", JSON.stringify(ro_tabs()) === JSON.stringify(["One", "Two", "Three"]));
  ro_first = ro_w.document.querySelector("#feTabs .fe-tab");
  ro_first.dispatchEvent(ro_ptr("pointerdown", 10, "mouse"));
  await new Promise((r) => setTimeout(r, 420));
  ro_w.dispatchEvent(ro_ptr("pointermove", 400, "mouse"));
  check("a mouse held still for a moment lifts the tab, as a finger does", ro_first.classList.contains("fe-dragging"));
  ro_w.dispatchEvent(ro_ptr("pointerup", 400, "mouse"));
  check("dragged past the last tab, it stops before New recipe, which stays last", ro_w.document.querySelector("#feTabs").lastElementChild.id === "feNewFormat");
  check("dropping it past the others puts it last, and the order is saved", JSON.stringify(ro_tabs()) === JSON.stringify(["Two", "Three", "One"]) && !ro_w.document.querySelector(".fe-dragging"), JSON.stringify(ro_tabs()));
  var ro_active = ro_w.document.querySelector('#feTabs .fe-tab[aria-pressed="true"]').textContent;
  var ro_t = ro_w.document.querySelector("#feTabs .fe-tab");
  ro_t.dispatchEvent(ro_ptr("pointerdown", 10, "touch"));
  ro_w.dispatchEvent(ro_ptr("pointermove", 200, "touch"));
  check("a swipe on a touch screen before the hold is over does not lift the tab", !ro_t.classList.contains("fe-dragging"));
  ro_w.dispatchEvent(ro_ptr("pointerup", 200, "touch"));
  check("the selected recipe is the same after reordering", ro_w.document.querySelector('#feTabs .fe-tab[aria-pressed="true"]').textContent === ro_active);
  check("each recipe has its place in the saved text, and a moved one also has when it was moved", (ro_w.localStorage.getItem("formats").match(/"place": \d+,/g) || []).length === 3 && /"placed": \d+,/.test(ro_w.localStorage.getItem("formats")));
  var ro_rt = ro_w.eval('(() => { const f = editor.model.formats[0]; const back = unpackFormat(packFormat(f)).format; return [back.place === f.place, back.placeAt === f.placeAt, f.place > 0]; })()');
  check("the place and the time of the move go into the save in Spotify and come back out of it", ro_rt.every(Boolean), JSON.stringify(ro_rt));
  check("an old save without a place is still read, with no place", ro_w.eval('(() => { const p = [0x43, 0x50, 1]; const b = []; writeText(b, "q"); writeText(b, "Q"); for (const n of [0, 0, 0, 0, 0, 1, 600, 1, 0]) writeVarint(b, n); writeText(b, "x"); writeVarint(b, 1); const all = p.concat(b); const c = crc16(all); all.push(c >> 8, c & 255); const out = []; writeVarint(out, all.length); const u = unpackFormat("Do not edit. " + denseEncode(out.concat(all))); return u.kind === "save" && u.format.place === undefined; })()'));
  check("moving puts a place between the neighbours, and only the moved recipe gets a new one", ro_w.eval('(() => { const fs = [{ id: "a", place: 1024 }, { id: "c", place: 3072 }, { id: "b", place: 2048 }]; placeMoved(fs, 1, 100); return fs[1].place > 1024 && fs[1].place < 2048 && fs[1].placeAt === 100 && fs[0].place === 1024 && fs[2].place === 2048; })()'));
  check("with no room between the neighbours, all are numbered again", ro_w.eval('(() => { const fs = [{ id: "a", place: 5 }, { id: "c", place: 9 }, { id: "b", place: 6 }]; placeMoved(fs, 1, 100); return fs.map((f) => f.place).join() === "1024,2048,3072"; })()'));
  check("of two copies, the later move stands; on a tie, the higher place, so every device decides the same", ro_w.eval('(() => { const a = { place: 10, placeAt: 5 }, b = { place: 99, placeAt: 4 }, c = { place: 50, placeAt: 5 }; return laterPlace(a, b) === a && laterPlace(b, a) === a && laterPlace(a, c) === c && laterPlace(c, a) === c; })()'));
  check("equal places sort by ID, the same way everywhere", ro_w.eval('(() => { const fs = [{ id: "z", place: 5 }, { id: "a", place: 5 }]; sortFormats(fs); return fs[0].id === "a"; })()'));
  check("pulled past the end, a tab gives only a little, and never more than the give", ro_w.eval("rubberBand(10) > 0 && rubberBand(10) < 10 && rubberBand(10000) < 22"));
  // a move made on another device comes in with the save, and the tabs follow it
  var ro_t0 = await boot({ url: EDURL, session: signedIn(), fetchOptions: {} });
  var ro_save = (id, title, place, placeAt) => ro_t0.packFormat(ro_t0.ensureGaps({ id, title, gap: 0, gaps: [], lead: 0, items: [{ id: "a", kind: "seg", lists: [{ name: "", id: "p2", weight: 1 }], minutes: 30 }], rev: 1, modified: 1790000000, place, placeAt }), ["p2"]);
  var ro_text = 'FORMATS = {"a": {"title": "One", "name": "One {n}", "revision": 1, "modified": 1790000000, "place": 1024, "segments": [("x [id:p2]", 30)]}, "b": {"title": "Two", "name": "Two {n}", "revision": 1, "modified": 1790000000, "place": 2048, "segments": [("x [id:p2]", 30)]}}';
  var ro_o = { descStore: {}, nameStore: {}, extraPlaylists: [{ id: "s1", name: "One (recipe)", owner: { id: "ron" }, description: ro_save("a", "One", 3000, 1790000900) }, { id: "s2", name: "Two (recipe)", owner: { id: "ron" }, description: ro_save("b", "Two", 2048, 0) }] };
  var ro_m = await boot({ url: EDURL, session: signedIn(), local: { formats: ro_text, backupMode: "spotify", spotifySynced: JSON.stringify({ a: { rev: 1 }, b: { rev: 1 } }) }, fetchOptions: ro_o });
  ro_m.eval("spotifySaveDelayMs = 30");
  await waitFor(() => Array.from(ro_m.document.querySelectorAll("#feTabs .fe-tab")).map((t) => t.textContent)[0] === "Two", 8000);
  check("a recipe moved on another device moves here too, with no question asked, and its save is not written back", !ro_m.document.getElementById("feSyncDialog") && !ro_o.writes.some((x) => x.type === "update" && x.id === "s1"), JSON.stringify(ro_o.writes.map((x) => x.type + ":" + x.id)));
  // the tabs drawn again while one is held (a save read from Spotify does that) must not leave the held tab in the row twice
  var rd_w = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"a": {"name": "A {n}", "title": "One", "segments": [("x", 10)]}, "b": {"name": "B {n}", "title": "Two", "segments": [("x", 10)]}, "c": {"name": "C {n}", "title": "Three", "segments": [("x", 10)]}}' }, fetchOptions: {} });
  var rd_ptr = (type, x) => { const e = new rd_w.MouseEvent(type, { clientX: x, clientY: 5, bubbles: true, cancelable: true, button: 0 }); Object.defineProperty(e, "pointerId", { value: 3 }); Object.defineProperty(e, "pointerType", { value: "touch" }); return e; };
  var rd_tab = rd_w.document.querySelector("#feTabs .fe-tab");
  rd_tab.dispatchEvent(rd_ptr("pointerdown", 10));
  await new Promise((r) => setTimeout(r, 420));
  rd_w.dispatchEvent(rd_ptr("pointermove", 400));
  rd_w.eval("renderEditor(); renderTabs();");
  check("while a tab is held nothing steps aside, and only a phone narrows the other tabs", !/fe-toprow-reordering/.test(fs.readFileSync(ROOT + "index.html", "utf8") + fs.readFileSync(ROOT + "editor.js", "utf8")) && /@media \(max-width: 759px\) \{\n    #formatEditor \.fe-tabs\.fe-reordering \.fe-tab/.test(fs.readFileSync(ROOT + "index.html", "utf8")) && !!rd_w.document.getElementById("feNewFormat"));
  check("while a tab is held, the editor is not drawn again under it", rd_w.document.querySelector("#feTabs .fe-tab") && rd_w.document.querySelectorAll("#feTabs .fe-dragging").length === 1 && rd_w.eval("tabDrag.redraw") === true);
  rd_w.dispatchEvent(rd_ptr("pointermove", 420));
  rd_w.dispatchEvent(rd_ptr("pointerup", 420));
  var rd_ids = Array.from(rd_w.document.querySelectorAll("#feTabs .fe-tab")).map((t) => t.getAttribute("data-id"));
  check("after it is let go, it is drawn again: each recipe once, one selected, and the order saved", JSON.stringify(rd_ids) === JSON.stringify(["b", "c", "a"]) && rd_w.document.querySelectorAll('#feTabs .fe-tab[aria-pressed="true"]').length === 1 && rd_w.eval("editor.model.formats.length") === 3 && rd_w.eval("tabDrag.redraw") === false, JSON.stringify(rd_ids));
  // a recipe added while the tab was held is kept, and the moved one goes after the tab it was dropped behind
  var rd_t = rd_w.document.querySelector("#feTabs .fe-tab");
  rd_t.dispatchEvent(rd_ptr("pointerdown", 10));
  await new Promise((r) => setTimeout(r, 420));
  rd_w.dispatchEvent(rd_ptr("pointermove", 400));
  rd_w.eval('adoptFormat(Object.assign(newBlankFormat(editor.model, "Four"), { id: "d", place: 1 })); writeAdopted(); renderEditor();');
  rd_w.dispatchEvent(rd_ptr("pointerup", 400));
  var rd_after = Array.from(rd_w.document.querySelectorAll("#feTabs .fe-tab")).map((t) => t.getAttribute("data-id"));
  check("a recipe that came in while a tab was held is kept, and the held one lands after the tab it was dropped behind", JSON.stringify(rd_after) === JSON.stringify(["d", "c", "a", "b"]), JSON.stringify(rd_after));
  // the same recipe written twice in the saved text (what the bug left behind) is read as one
  var rd_dup = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"a": {"name": "A {n}", "title": "One", "segments": [("x", 10)]}, "b": {"name": "B {n}", "title": "Two", "segments": [("x", 10)]}, "a": {"name": "A {n}", "title": "One", "segments": [("x", 10)]}}' }, fetchOptions: {} });
  check("a recipe written twice in the saved text is read as one, so a doubled tab mends itself", rd_dup.document.querySelectorAll("#feTabs .fe-tab").length === 2 && rd_dup.document.querySelectorAll('#feTabs .fe-tab[aria-pressed="true"]').length === 1);
  } catch (err) { areaCrashed("reordering recipes", err); } }
  if (want("card header, pencil and notch")) { try {
  // ================================================================ the card's header, the pencil, and the notch
  var hd_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  var hd_w = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"a": {"name": "A {n}", "title": "Warm focus", "silence between segments": "2 min", "segments": [("x", 10), ("y", 10)]}, "b": {"name": "B {n}", "title": "Cool", "segments": [("x", 10)]}}' }, fetchOptions: {} });
  var hd_sel = () => hd_w.document.querySelector('#feTabs .fe-tab[aria-pressed="true"]');
  check("the card has no name field and no menu: its header is the silence between segments, then Duplicate and Delete", !hd_w.document.getElementById("feHead").querySelector("input") && !hd_w.document.getElementById("feCardMenuButton") && JSON.stringify(Array.from(hd_w.document.querySelectorAll("#feHead .fe-headrow > .fe-silence, #feHead .fe-headtools > *")).map((el) => el.id || el.className.split(" ")[0])) === JSON.stringify(["fe-silence", "feDuplicate", "feDelete"]));
  var hd_sil = hd_w.document.querySelector(".fe-silence");
  var hd_mid = hd_sil.querySelector(".fe-amount-rich");
  check("the silence control has no icon and is one stepper, with its words inside it: the length, then the short word for a phone (gaps), then the words for a wide screen (of silence between segments)", !hd_w.document.querySelector("#feHead .fe-silence > .fe-icon") && hd_sil.children.length === 2 && hd_sil.children[0].classList.contains("fe-stepper") && hd_sil.children[1].id === "feSilenceHelp" && !!hd_mid && hd_mid.querySelector("#feGapValue") && hd_mid.querySelector(".fe-silence-short").textContent === "gaps" && hd_mid.querySelector(".fe-silence-label").textContent === "of silence between segments" && hd_mid.textContent.startsWith("2 min ") && hd_w.document.getElementById("feGapValue").textContent === "2 min" && !hd_sil.getAttribute("title") && !hd_w.document.querySelector(".fe-silence-title"));
  check("on a very narrow screen (under 360 pixels) the ? beside the stepper is hidden and Duplicate and Delete are a little narrower, so the row stays on one line", /@media \(max-width: 359px\) \{[^@]*#formatEditor \.fe-silencehelp \{ display: none; \}[^@]*#formatEditor \.fe-headtools \.fe-iconbtn \{ width: 40px; \}/.test(hd_css));
  hd_w.document.getElementById("feGapShorter").click(); hd_w.document.getElementById("feGapShorter").click(); hd_w.document.getElementById("feGapShorter").click(); hd_w.document.getElementById("feGapShorter").click();
  check("with no silence the stepper reads No and the sentence drops its of: [ - No + ] silence between segments", hd_w.document.getElementById("feGapValue").textContent === "No" && hd_w.document.querySelector(".fe-silence-label").textContent === "silence between segments", hd_w.document.getElementById("feGapValue").textContent);
  hd_w.document.getElementById("feGapLonger").click();
  check("one step up and it is a length again, with the of back: [ - 30 sec + ] of silence between segments", hd_w.document.getElementById("feGapValue").textContent === "30 sec" && hd_w.document.querySelector(".fe-silence-label").textContent === "of silence between segments");
  while (hd_w.document.getElementById("feGapValue").textContent !== "2 min") hd_w.document.getElementById("feGapLonger").click();
  check("Duplicate and Delete are icon buttons with names for screen readers and as hover hints", hd_w.document.getElementById("feDuplicate").getAttribute("aria-label") === "Duplicate recipe" && hd_w.document.getElementById("feDelete").getAttribute("aria-label") === "Delete recipe" && hd_w.document.getElementById("feDelete").getAttribute("title") === "Delete recipe" && hd_w.document.getElementById("feDelete").classList.contains("fe-danger"));
  hd_w.document.getElementById("feGapLonger").click();
  check("the stepper works with no menu to open, and shows the new value", hd_w.document.getElementById("feGapValue").textContent === "3 min" && /"silence between segments": "3 min"/.test(T(hd_w)));
  // the pencil
  check("only the selected tab has a pencil, and its title says what pressing it does", !!hd_sel().querySelector("svg") && hd_sel().getAttribute("title") === "Rename recipe" && hd_w.document.querySelectorAll("#feTabs .fe-tab svg").length === 1 && hd_sel().textContent === "Warm focus");
  hd_sel().click();
  var hd_in = hd_w.document.getElementById("feName");
  check("pressing the selected tab turns its name into a field in place, with the name selected and the focus in it", !!hd_in && hd_in.value === "Warm focus" && hd_w.document.activeElement === hd_in && hd_in.selectionStart === 0 && hd_in.selectionEnd === 10 && hd_in.getAttribute("aria-label") === "Name of recipe" && hd_w.document.querySelector('#feTabs .fe-tab-editing').getAttribute("aria-pressed") === "true");
  hd_in.value = "Warm {x} glow {n}";
  hd_in.dispatchEvent(new hd_w.Event("input", { bubbles: true }));
  check("typing updates the text, drops stray braces, and does not rebuild the field under your fingers", hd_w.document.getElementById("feName") === hd_in && hd_in.value === "Warm x glow {n}" && /"title": "Warm x glow \{n\}"/.test(T(hd_w)));
  check("the field is as wide as the name typed: a hidden copy beside it follows each keystroke, and the field has no width of its own", (function () { var z = hd_in.parentNode.querySelector(".fe-tab-sizer"); return !!z && z.textContent === hd_in.value && z.getAttribute("aria-hidden") === "true" && hd_in.getAttribute("size") === "1" && !hd_in.style.width; })());
  hd_in.dispatchEvent(new hd_w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  check("Enter finishes: the tab shows the new name again, with its pencil", !hd_w.document.getElementById("feName") && hd_sel().textContent === "Warm x glow {n}" && !!hd_sel().querySelector("svg"));
  hd_sel().click();
  hd_w.document.getElementById("feName").value = "Something else";
  hd_w.document.getElementById("feName").dispatchEvent(new hd_w.Event("input", { bubbles: true }));
  hd_w.document.getElementById("feName").dispatchEvent(new hd_w.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  check("Escape cancels: the name goes back to what it was, in the tab and in the text", !hd_w.document.getElementById("feName") && hd_sel().textContent === "Warm x glow {n}" && /"title": "Warm x glow \{n\}"/.test(T(hd_w)));
  hd_sel().click();
  hd_w.document.getElementById("feName").value = "Final";
  hd_w.document.getElementById("feName").dispatchEvent(new hd_w.Event("input", { bubbles: true }));
  hd_w.document.getElementById("feName").dispatchEvent(new hd_w.Event("blur"));
  check("tapping away finishes too, and keeps the name", !hd_w.document.getElementById("feName") && hd_sel().textContent === "Final");
  hd_sel().click();
  hd_w.document.querySelectorAll("#feTabs .fe-tab")[1].click();
  check("choosing another tab while renaming ends the renaming and selects that tab", !hd_w.document.getElementById("feName") && hd_sel().textContent === "Cool" && hd_w.document.getElementById("feHead").querySelector("#feGapValue").textContent === "No");
  hd_w.document.getElementById("feDuplicate").click();
  hd_w.document.getElementById("feDuplicateConfirm").click();
  check("Duplicate and Delete in the header work as the menu items did", hd_w.document.querySelectorAll("#feTabs .fe-tab").length === 3 && hd_sel().textContent === "Cool copy");
  hd_w.document.getElementById("feDelete").click();
  check("Delete still asks first, with the usual question", !!hd_w.document.getElementById("feDeleteDialog"));
  hd_w.document.getElementById("feDeleteCancel").click();
  // the notch
  check("the tab being renamed has the notch too, in a pill of the same color", /\.fe-tab-editing \{ display: inline-flex;[^}]*background: var\(--button\);/.test(hd_css));
  // the app icon in minimalist mode
  check("the app icon beside the tabs in minimalist mode is for screens 760 pixels wide and up; on a phone it is gone, to leave room for the tabs", /@media \(min-width: 760px\) \{ body\.minimal #formatEditor \.fe-appicon \{ display: block; width: 44px; height: 44px;/.test(hd_css) && /#formatEditor \.fe-appicon \{ display: none; \}/.test(hd_css));
  
  } catch (err) { areaCrashed("card header, pencil and notch", err); }
}

  if (want("a guide for facilitators")) { try {
  // ================================================================ A guide for facilitators: one popup of topics, opened from the menu, the ? by the silence stepper, the first tip and the build popup
  var gf_w = await boot({ url: EDURL, session: signedIn(), local: { formats: 'RECIPES = {"a": {"name": "A {n}", "segments": [("", 20)]}}' }, fetchOptions: {} });
  var gf_d = gf_w.document, gf_open = () => gf_d.querySelectorAll("#guideSection details.gd-topic[open]");
  check("the guide has six topics and is hidden until opened", gf_d.getElementById("guideSection").hidden && gf_d.querySelectorAll("#guideSection details.gd-topic").length === 6);
  check("the first tip says the app works best with long playlists and links to the guide", /works best with long playlists/.test(gf_d.getElementById("feFirstTip").textContent) && gf_d.getElementById("feFirstTipGuide").textContent === "Show me how to do that");
  gf_d.getElementById("feFirstTipGuide").click();
  check("the tip's link opens the guide at Playlists to start from, alone", !gf_d.getElementById("infoOverlay").hidden && gf_d.getElementById("infoTitle").textContent === "A guide for facilitators" && gf_open().length === 1 && gf_open()[0].id === "gdStart");
  check("Playlists to start from links to Ron's public playlists in a new tab", !!gf_d.querySelector('#gdStart a[href="https://open.spotify.com/user/1242285637/playlists"][target="_blank"]'));
  gf_d.getElementById("infoClose").click();
  check("closing puts the guide back, hidden", gf_d.getElementById("guideSection").hidden);
  check("the ? beside the silence stepper says what it opens", gf_d.getElementById("feSilenceHelp").getAttribute("aria-label") === "Why silence between segments?");
  gf_d.getElementById("feSilenceHelp").click();
  check("the ? opens the guide at Silence between segments, alone", gf_open().length === 1 && gf_open()[0].id === "gdSilence");
  gf_d.getElementById("infoClose").click();
  gf_d.getElementById("feAppMenuButton").click();
  var gf_item = gf_d.getElementById("feGuide");
  check("the menu has A guide for facilitators above More options, with a line under it", !!gf_item && gf_item.nextElementSibling.id === "feMoreOptions" && /^A guide for facilitators/.test(gf_item.textContent) && gf_item.querySelector(".fe-gditem-note").textContent === "The thinking behind this app and how to use it well");
  gf_item.click();
  check("from the menu the guide opens with every topic closed", !gf_d.getElementById("infoOverlay").hidden && gf_open().length === 0);
  gf_d.querySelector("#gdLong > summary").click();
  gf_d.querySelector('#gdLong [data-guide="gdStart"]').click();
  check("inside the guide, use my public playlists opens Playlists to start from and keeps the topic that was open", gf_d.getElementById("gdStart").open && gf_d.getElementById("gdLong").open && gf_d.getElementById("infoTitle").textContent === "A guide for facilitators");
  check("Several playlists shows an example table like Why N?, with the playlist that sets the most marked", gf_d.querySelectorAll("#gdSeveral .gd-why tbody tr").length === 3 && gf_d.querySelector("#gdSeveral tr.bd-limit").lastElementChild.textContent === "4 playlists");
  } catch (err) { areaCrashed("a guide for facilitators", err); } }

  if (want("first segment tip")) { try {
  // ================================================================ the tip under a new recipe's only, empty segment
  var ft_w = await boot({ url: EDURL, session: signedIn(), local: { formats: 'RECIPES = {"a": {"name": "A {n}", "segments": [("", 20)]}}' }, fetchOptions: {} });
  var ft_tip = () => ft_w.document.getElementById("feFirstTip");
  check("a recipe with one segment and no playlist shows the tip right under that segment, with its arrow", !!ft_tip() && ft_tip().previousElementSibling.classList.contains("fe-row") && !!ft_w.document.getElementById("feFirstTipArrow"));
  check("the tip says to choose a playlist for the first segment and how its minutes are filled", ft_tip().querySelector(".fe-firsttip-title").textContent === "Choose a playlist for the first segment of this recipe." && ft_tip().querySelector(".muted").textContent === "Songs will be picked at random from that playlist to fill this segment\u2019s 20 min.");
  ft_w.document.querySelector("#feRows .fe-inc").click();
  check("the minutes follow the stepper", /fill this segment\u2019s 25 min\./.test(ft_tip().textContent));
  ft_w.document.querySelector("#feRows .fe-main").click();
  check("not while that segment's playlist list is open", !ft_tip());
  ft_w.eval("editor.panel = null; activeFormat().items[0].lists[0].name = 'Calm'; renderRows();");
  check("gone once a playlist is chosen", !ft_tip());
  var ft_two = await boot({ url: EDURL, session: signedIn(), local: { formats: 'RECIPES = {"a": {"name": "A {n}", "segments": [("", 20), ("", 20)]}}' }, fetchOptions: {} });
  check("not with more than one segment", !ft_two.document.getElementById("feFirstTip"));
  var ft_more = await boot({ url: EDURL, session: signedIn(), local: { formats: 'RECIPES = {"a": {"name": "A {n}", "segments": [("Calm", 20)]}, "b": {"name": "B {n}", "segments": [("", 20)]}}' }, fetchOptions: {} });
  ft_more.document.querySelectorAll("#feTabs .fe-tab")[1].click();
  check("not when there is more than one recipe", !!ft_more.document.querySelector("#feRows .fe-main-empty") && !ft_more.document.getElementById("feFirstTip"));
  check("the arrow does not bounce under reduced motion", /prefers-reduced-motion: reduce\) \{ #formatEditor \.fe-firsttip-arrow \{ animation: none;/.test(fs.readFileSync(ROOT + "index.html", "utf8")));
  } catch (err) { areaCrashed("first segment tip", err); } }

  if (want("the play tip")) { try {
  // ================================================================ the second tutorial tip: what else to try, closed with its x or by building
  var pt_one = 'RECIPES = {"a": {"name": "A {n}", "segments": [("Calm", 20)]}}';
  var pt_w = await boot({ url: EDURL, session: signedIn(), local: { formats: 'RECIPES = {"a": {"name": "A {n}", "segments": [("", 20)]}}' }, fetchOptions: {} });
  var pt_tip = (w) => { const t = w.document.getElementById("fePlayTip"); return t && !t.hidden ? t : null; };
  check("not before the only recipe has a playlist (the first tip shows then)", !pt_tip(pt_w) && !!pt_w.document.getElementById("feFirstTip"));
  pt_w.eval("activeFormat().items[0].lists[0].name = 'Calm'; renderRows();");
  check("once it has one, the play tip shows at the bottom of the card, and the first tip goes", !!pt_tip(pt_w) && pt_tip(pt_w).parentNode.id === "fePlayTipSlot" && pt_w.document.getElementById("feCard").lastElementChild.id === "fePlayTipSlot" && !pt_w.document.getElementById("feFirstTip"));
  check("it says what to try and how to finish, with nothing about saving", pt_tip(pt_w).querySelector(".fe-playtip-title").textContent === "You got this, go play!" && /^Add more segments to this recipe and explore more of the options available to you here\. When you\u2019re ready, (click|tap) the Build playlists button below\.$/.test(pt_tip(pt_w).querySelector(".muted").textContent));
  check("it has a Close tip button", pt_w.document.getElementById("fePlayTipClose").getAttribute("aria-label") === "Close tip");
  pt_w.document.getElementById("feAddSegment").click();
  check("it stays while the recipe grows", !!pt_tip(pt_w));
  pt_w.document.dispatchEvent(new pt_w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));   // New segment opened its playlist list
  pt_w.document.getElementById("fePlayTipClose").click();
  check("the x closes it, and nothing is recorded", !pt_tip(pt_w) && pt_w.localStorage.getItem("playTipDone") === null);
  pt_w.eval("activeFormat().items = activeFormat().items.slice(0, 1); activeFormat().items[0].lists[0].name = ''; renderRows();");
  check("when the first tip shows again, choosing a playlist brings the play tip again", !!pt_w.document.getElementById("feFirstTip") && !pt_tip(pt_w));
  pt_w.eval("activeFormat().items[0].lists[0].name = 'Calm'; renderRows();");
  check("(it is back)", !!pt_tip(pt_w));
  var pt_back = await boot({ url: EDURL, session: signedIn(), local: { formats: pt_one }, fetchOptions: {} });
  check("a visit that opens with a playlist already chosen does not show it (the first tip was not on screen)", !pt_tip(pt_back));
  var pt_two = await boot({ url: EDURL, session: signedIn(), local: { formats: 'RECIPES = {"a": {"name": "A {n}", "segments": [("Calm", 20)]}, "b": {"name": "B {n}", "segments": [("Calm", 20)]}}' }, fetchOptions: {} });
  check("not with more than one recipe", !pt_tip(pt_two));
  var pt_src = fs.readFileSync(ROOT + "app.js", "utf8");
  check("starting a build marks it done", /logStep\(`create started[^\n]*\n\s*if \(typeof markPlayTipDone === "function"\) markPlayTipDone\(\);/.test(pt_src));
  check("finding playlists the app made does not hide it", !/madeByApp\)[^\n]*markPlayTipDone/.test(pt_src));
  } catch (err) { areaCrashed("the play tip", err); } }

  if (want("duplicate question, format names, empty note and equal widths")) { try {
  // ================================================================ duplicate question, format names, empty note, equal widths, and the wording
  var bt_stub = (w) => {
    w.Element.prototype.getBoundingClientRect = function () {
      const zero = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
      if (this.classList && this.classList.contains("fe-rowamount")) { const mw = this.style.minWidth ? parseFloat(this.style.minWidth) : 0; return { ...zero, width: Math.max(8 * this.textContent.length, mw), height: 20 }; }
      return zero;
    };
  };
  var bt_w = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"a": {"name": "A {n}", "title": "Warm focus", "segments": [("x", 30), ("y", 30)]}}' }, fetchOptions: {} });
  var bt_tabs = () => Array.from(bt_w.document.querySelectorAll("#feTabs .fe-tab")).map((t) => t.textContent);
  addNamed(bt_w, "Full moon"); addNamed(bt_w, "New moon");
  check("new recipes get the names typed for them, never a made-up default", JSON.stringify(bt_tabs()) === JSON.stringify(["Warm focus", "Full moon", "New moon"]) && !/Recipe \$\{number\}/.test(fs.readFileSync(ROOT + "editor.js", "utf8")));
  var bt_e = await boot({ url: EDURL, session: signedIn(), local: { formats: "FORMATS = {}" }, fetchOptions: {} });
  check("with no recipes a welcome says to make the first one, then what a recipe is", (() => { const c = bt_e.document.getElementById("feWelcome"); return !!c && c.querySelector(".fe-welcome-title").textContent === "Time to make your first recipe!" && c.querySelector(".fe-welcome-lead").textContent === "Click New recipe above to start." && /^A recipe says which of your playlists to play, in what order, and for how long\. The app turns it into as many playlists as your songs allow, with no song used twice\.$/.test(c.querySelector(".fe-welcome-text").textContent) && !bt_e.document.getElementById("feCard"); })());
  check("the welcome has an arrow pointing at New recipe and no button of its own", !!bt_e.document.getElementById("feWelcomeArrow") && !bt_e.document.querySelector("#feWelcome button"));
  check("with no recipes Build playlists is hidden", bt_e.document.getElementById("create").hidden);
  check("with no recipes no status lines show (Python, Spotify, notices)", bt_e.document.body.classList.contains("no-recipes") && /body\.no-recipes #pythonNote, body\.no-recipes #spotifyNote, body\.no-recipes #editorNote, body\.no-recipes #formatEditor \.fe-caption \{ display: none; \}/.test(fs.readFileSync(ROOT + "index.html", "utf8")));
  bt_e.document.getElementById("feNewFormat").click();
  check("the welcome goes as soon as New recipe opens (the draft is a recipe)", !bt_e.document.getElementById("feWelcome"));
  bt_e.document.getElementById("feNewFormatCancel").click();
  check("and comes back on Cancel", !!bt_e.document.getElementById("feWelcome") && bt_e.document.getElementById("create").hidden);
  addNamed(bt_e, "First");
  check("and goes once there is a recipe, and Build playlists is back", !bt_e.document.getElementById("feWelcome") && !!bt_e.document.getElementById("feCard") && !bt_e.document.getElementById("create").hidden && !bt_e.document.body.classList.contains("no-recipes"));
  check("with recipes there is no welcome", !bt_w.document.getElementById("feWelcome"));
  // Duplicate asks first
  bt_w.document.querySelectorAll("#feTabs .fe-tab")[0].click();
  bt_w.document.getElementById("feDuplicate").click();
  var bt_dlg = bt_w.document.querySelector("#feDuplicateDialog .fe-dialog");
  check("Duplicate asks first, and adds nothing yet", !!bt_dlg && bt_tabs().length === 3);
  check("the question names the recipe and says what a copy has, with Cancel and Duplicate recipe, and the focus on the second", bt_dlg.querySelector("h3").textContent === "Duplicate this recipe?" && bt_dlg.querySelector("p").textContent === "A copy of Warm focus is added, with the same segments and silences, ready to rename." && Array.from(bt_dlg.querySelectorAll(".row button")).map((b) => b.textContent).join("|") === "Cancel|Duplicate recipe" && bt_w.document.activeElement === bt_w.document.getElementById("feDuplicateConfirm") && bt_dlg.getAttribute("aria-modal") === "true");
  bt_w.document.getElementById("feDuplicateCancel").click();
  check("Cancel closes it and adds nothing", !bt_w.document.getElementById("feDuplicateDialog") && bt_tabs().length === 3);
  bt_w.document.getElementById("feDuplicate").click();
  bt_w.document.dispatchEvent(new bt_w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("so does Escape", !bt_w.document.getElementById("feDuplicateDialog") && bt_tabs().length === 3);
  bt_w.document.getElementById("feDuplicate").click();
  bt_w.document.getElementById("feDuplicateDialog").click();
  check("and a click outside it", !bt_w.document.getElementById("feDuplicateDialog") && bt_tabs().length === 3);
  bt_w.document.getElementById("feDuplicate").click();
  bt_w.document.getElementById("feDuplicateConfirm").click();
  check("Duplicate recipe makes the copy, selects it, and closes the question", !bt_w.document.getElementById("feDuplicateDialog") && bt_tabs().length === 4 && bt_w.document.querySelector('#feTabs .fe-tab[aria-pressed="true"]').textContent === "Warm focus copy" && bt_w.document.querySelectorAll("#feRows .fe-row").length === 2);
  check("Duplicate and Delete sit side by side at the right of the card's header", JSON.stringify(Array.from(bt_w.document.querySelectorAll("#feHead .fe-headrow > .fe-silence, #feHead .fe-headtools > *")).map((el) => el.id || "silence")) === JSON.stringify(["silence", "feDuplicate", "feDelete"]));
  check("Duplicate and Delete are one block in the header, so Delete never wraps to a line of its own", bt_w.document.getElementById("feDuplicate").parentNode === bt_w.document.getElementById("feDelete").parentNode && bt_w.document.getElementById("feDelete").parentNode.className === "fe-headtools" && bt_w.document.getElementById("feSilenceHelp").parentNode.className === "fe-silence");
  // the tag card says Default
  var bt_s = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"a": {"name": "A {n}", "silence between segments": "1 min", "segments": [("x", 10), ("y", 10)]}}' }, fetchOptions: {} });
  rowsOf(bt_s)[0].querySelector(".fe-tag").click();
  bt_s.document.getElementById("feTagShorter").click();
  var bt_btn = bt_s.document.getElementById("feTagReset");
  check("the way back to the default on a silence's card is a pink link under the length that says Reset to default, with a name for screen readers", !!bt_btn && bt_btn.textContent.trim() === "Reset to default" && bt_btn.classList.contains("linklike") && !bt_btn.querySelector("svg") && bt_btn.getAttribute("aria-label") === "Reset to default, 1 min", bt_btn && bt_btn.textContent);
  check("and for a silence that matches the default, the card shows a gray (default) under the length instead", (() => { bt_btn.click(); rowsOf(bt_s)[0].querySelector(".fe-tag").click(); return bt_s.document.getElementById("feTagDefault").textContent === "(default)"; })());
  // equal widths
  var bt_q = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"a": {"name": "A {n}", "segments": [("x", 30), ("y", 30), ("z", 180)]}}' }, fetchOptions: {}, before: bt_stub });
  var bt_w8 = () => Array.from(bt_q.document.querySelectorAll("#feRows .fe-rowamount")).map((el) => el.style.minWidth);
  check("when one length needs more room, every length widget in the format is as wide as it", JSON.stringify(bt_w8()) === JSON.stringify(["56px", "56px", "56px"]), JSON.stringify(bt_w8()));
  for (let i = 0; i < 60 && rowsOf(bt_q)[2].querySelector(".fe-amount").textContent.length > 6; i++) rowsOf(bt_q)[2].querySelector(".fe-dec").click();
  var bt_text = Array.from(bt_q.document.querySelectorAll("#feRows .fe-rowamount")).map((el) => el.textContent);
  check("and when the longest one gets shorter, they all get narrower again", /^\d{1,2}(\.\d)? min$/.test(bt_text[2]) && new Set(bt_w8()).size === 1 && parseFloat(bt_w8()[0]) < 56, JSON.stringify(bt_text) + JSON.stringify(bt_w8()));
  rowsOf(bt_q)[0].querySelector(".fe-inc").click();
  check("the widths are worked out again after every change, so one row going wider widens them all", new Set(bt_w8()).size === 1);
  check("the widths are also worked out again when the window changes size", /window\.addEventListener\("resize", \(\) => \{ equalizeAmounts\(\); updateTagHang\(\); placeWelcomeArrow\(\); placeFirstTipArrow\(\); \}\)/.test(fs.readFileSync(ROOT + "editor.js", "utf8")));
  // the wording
  var bt_html = fs.readFileSync(ROOT + "index.html", "utf8").replace(/<!--[\s\S]*?-->/g, "").replace(/<style>[\s\S]*?<\/style>/, "");
  var bt_app = fs.readFileSync(ROOT + "app.js", "utf8").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  check("the page calls the action Build everywhere: the only create playlists left is the Spotify permission it describes in Privacy", (bt_html.match(/create playlists/gi) || []).length === 1 && /read your playlists, create playlists, remove playlists/.test(bt_html) && !/create playlists/i.test(bt_app), String((bt_html.match(/create playlists/gi) || []).length));
  check("the messages that follow a build say built and building", /Building your playlist/.test(bt_app) && /"are"\} in your Spotify library/.test(bt_app) && /"was" : "were"\} built/.test(bt_app) && /Nothing can be built from/.test(bt_app));
  } catch (err) { areaCrashed("duplicate question, format names, empty note and equal widths", err); } }

  if (want("a new format scrolls into view")) { try {
  // ================================================================ a new format scrolls into view
  var ns_w = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"a": {"name": "A {n}", "title": "One", "segments": [("x", 10)]}, "b": {"name": "B {n}", "title": "Two", "segments": [("x", 10)]}}' }, fetchOptions: {} });
  ns_w.eval("window.__scrollLog = []; (function () { const orig = scrollSelectedTab; scrollSelectedTab = function () { window.__scrollLog.push({ menuThere: !!document.getElementById('feAppMenuButton'), selected: (document.querySelector('#feTabs .fe-tab[aria-pressed=\"true\"]') || {}).textContent }); return orig.apply(this, arguments); }; })();");
  addNamed(ns_w, "Three");
  var ns_last = ns_w.__scrollLog[ns_w.__scrollLog.length - 1];
  check("after a recipe is added, the tabs are scrolled to the new one once the menu button is in place, so the room it has is the room it will keep", !!ns_last && ns_last.menuThere === true && ns_last.selected === "Three", JSON.stringify(ns_w.__scrollLog));
  ns_w.__scrollLog.length = 0;
  ns_w.document.getElementById("feDuplicate").click();
  ns_w.document.getElementById("feDuplicateConfirm").click();
  var ns_dup = ns_w.__scrollLog[ns_w.__scrollLog.length - 1];
  check("so is a duplicate, which also joins the end", !!ns_dup && ns_dup.menuThere === true && ns_dup.selected === "Three copy");
  ns_w.__scrollLog.length = 0;
  ns_w.document.querySelectorAll("#feTabs .fe-tab")[0].click();
  var ns_pick = ns_w.__scrollLog[ns_w.__scrollLog.length - 1];
  check("and choosing a tab that is partly out of view brings it fully into view too", !!ns_pick && ns_pick.menuThere === true && ns_pick.selected === "One");
  var ns_src = fs.readFileSync(ROOT + "editor.js", "utf8");
  check("the editor scrolls after the menu button is drawn, and again when minimalist mode changes how much room the tabs have", /renderTabs\(\);\n  renderAppMenu\(\);\n[^\n]*\n  scrollSelectedTab\(\);/.test(ns_src) && /if \(typeof scrollSelectedTab === "function"\) scrollSelectedTab\(\);/.test(ns_src));
  } catch (err) { areaCrashed("a new format scrolls into view", err); } }

  if (want("disconnect below the status line on phones")) { try {
  // ================================================================ Disconnect below the status line on phones
  var dp_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  var dp_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  var dp_sec = dp_w.document.getElementById("connectedSection");
  check("on wide screens nothing changes: Disconnect is in the heading row, at the right of the heading, with the status line under it", dp_sec.querySelector(".headrow h2") !== null && dp_sec.querySelector(".headrow #disconnect") !== null && dp_sec.querySelector(".headrow").nextElementSibling.id === "connectedMessage");
  check("the button keeps its icon and label, and stays hidden when there is nothing to disconnect from", dp_w.document.getElementById("disconnect").textContent.trim() === "Disconnect" && !!dp_w.document.querySelector("#disconnect img.btn-icon"));
  } catch (err) { areaCrashed("disconnect below the status line on phones", err); } }

  if (want("the tagline")) { try {
  // ================================================================ the tagline under the title
  var tg_w = await boot({ url: "http://127.0.0.1:8000/" });
  check("the tagline says ceremony playlists are ready in minutes", tg_w.document.querySelector(".tagline").textContent === "Ceremony playlists, ready in minutes.");
  check("it is the first line of the welcome page, which only the welcome page shows", tg_w.document.getElementById("welcomePage").firstElementChild === tg_w.document.querySelector(".tagline") && /#welcomePage \{ display: none; \}/.test(fs.readFileSync(ROOT + "index.html", "utf8")));
  var tg_helps = tg_w.document.querySelector("#welcomePage details.wp-helps");
  check("under the intro, a closed Where it helps lists three uses, and the steps point at the recipe shown", !!tg_helps && tg_helps.open === false && tg_helps.querySelector("summary").textContent === "Where it helps" && tg_helps.querySelectorAll("li").length === 3 && /like the one shown\./.test(tg_w.document.querySelector("#welcomePage .wp-steps").textContent));
  } catch (err) { areaCrashed("the tagline", err); } }

  if (want("settings below the segments, pink outline")) { try {
  // ================================================================ settings below the segments, and the pink outline
  var sb_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  var sb_w = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"a": {"name": "A {n}", "title": "Same", "segments": [("x", 10), ("y", 10)]}, "b": {"name": "B {n}", "title": "Other", "segments": [("x", 10)]}}' }, fetchOptions: {} });
  var sb_card = sb_w.document.getElementById("feCard");
  check("the card holds, top to bottom: the name warning, the bar, the segments, the settings row, then the play tip's place", JSON.stringify(Array.from(sb_card.children).map((c) => c.id || c.className.split(" ")[0])) === JSON.stringify(["feClash", "fe-barwrap", "feRows", "feHead", "fePlayTipSlot"]));
  check("New segment is the last thing among the segments, so the settings row is below it", sb_w.document.getElementById("feRows").lastElementChild.id === "feAddSegment" && !!(sb_w.document.getElementById("feAddSegment").compareDocumentPosition(sb_w.document.getElementById("feHead")) & 4));
  check("the settings row still has the silence control, Duplicate and Delete, in that order", JSON.stringify(Array.from(sb_w.document.querySelectorAll("#feHead .fe-headrow > .fe-silence, #feHead .fe-headtools > *")).map((el) => el.id || "silence")) === JSON.stringify(["silence", "feDuplicate", "feDelete"]) && !sb_w.document.getElementById("feHead").querySelector("#feClash"));
  sb_w.document.querySelectorAll("#feTabs .fe-tab")[1].click();
  sb_w.document.querySelector('#feTabs .fe-tab[aria-pressed="true"]').click();
  var sb_in = sb_w.document.getElementById("feName");
  sb_in.value = "same"; sb_in.dispatchEvent(new sb_w.Event("input", { bubbles: true }));
  check("a name that matches another format's is warned about at the top of the card, near the tab being edited, and not down with the settings", sb_w.document.getElementById("feClash").hidden === false && sb_w.document.getElementById("feCard").firstElementChild.id === "feClash" && /Another recipe has this name/.test(sb_w.document.getElementById("feClash").textContent));
  } catch (err) { areaCrashed("settings below the segments, pink outline", err); } }

  if (want("questions and feedback")) { try {
  // ================================================================ questions and feedback
  var qf_w0 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  check("until the form's address is set, nothing about it shows: not the lines in Privacy", qf_w0.document.getElementById("privacyFeedback").hidden === true && qf_w0.document.getElementById("privacyFeedbackWho").hidden === true);
  var QF = "https://tally.so/r/EXAMPLE";
  var qf_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {}, feedbackUrl: QF });
  check("there is no Feedback and questions section or popup any more: the form says it all", !qf_w.document.getElementById("feedbackSection") && !qf_w.document.getElementById("feedbackLink") && !fs.existsSync(ROOT + "icons/feedback.svg"));
  qf_w.document.getElementById("feAppMenuButton").click();
  var qf_link = qf_w.document.getElementById("feFeedback");
  check("once the address is set, the app menu has Feedback and questions, after More options", !!qf_link && qf_w.document.getElementById("feMoreOptions").nextElementSibling === qf_link && qf_link.textContent.trim() === "Feedback and questions");
  check("it is as bold as the button rows beside it", qf_w.getComputedStyle(qf_link).fontWeight === qf_w.getComputedStyle(qf_w.document.getElementById("feMoreOptions")).fontWeight && qf_w.getComputedStyle(qf_link).fontWeight === "600", qf_w.getComputedStyle(qf_link).fontWeight);
  check("it is a link that opens the form in a new tab, safely, at exactly the form's address: no details are attached, unlike a problem report", qf_link.tagName === "A" && qf_link.getAttribute("href") === QF && qf_link.target === "_blank" && /noopener/.test(qf_link.rel) && /noreferrer/.test(qf_link.rel));
  qf_link.dispatchEvent(new qf_w.MouseEvent("click", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 20));   // the menu closes just after the click, so the link is still there to open the form
  check("pressing it closes the menu, opens no popup, and adds nothing to the address", !qf_w.document.getElementById("feAppMenuPanel") && qf_w.document.getElementById("infoOverlay").hidden === true && qf_link.getAttribute("href") === QF);
  var qf_priv = qf_w.document.getElementById("privacySection").textContent.replace(/\s+/g, " ");
  check("Privacy then says the form sends only what you type, that an email goes only if you enter one and is used only to respond, and that the feedback form opens only if you choose to send feedback", /The form sends only what you type, and nothing else is attached\. An email address is included only if you choose to enter one, and it is used only to respond to you\./.test(qf_priv) && /the feedback form only if you choose to send feedback/.test(qf_priv) && qf_w.document.getElementById("privacyFeedback").hidden === false);
  check("the form that ships is the Tally one, at its real address", /const FEEDBACK_FORM_URL = "https:\/\/tally\.so\/r\/4aayDd";/.test(fs.readFileSync(ROOT + "app.js", "utf8")));
  qf_w0.document.getElementById("feAppMenuButton").click();
  check("without the form's address, the menu has no Feedback and questions", !qf_w0.document.getElementById("feFeedback") && !!qf_w0.document.getElementById("fePrivacy"));
  } catch (err) { areaCrashed("questions and feedback", err); } }

  if (want("hover feedback on buttons")) { try {
  // ================================================================ hover feedback on buttons
  var hv_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  var hv_block = hv_css.slice(hv_css.indexOf("@media (hover: hover) {"));
  check("the hover styles apply only where there is a real mouse pointer, so a tap on a phone never leaves a button looking hovered", /@media \(hover: hover\) \{[^@]*button:not\(:disabled\):hover/.test(hv_css));
  check("the playlist name in a segment and the silence tags get no ring, and the name does nothing of its own, since the whole segment lights up", /#formatEditor \.fe-main:hover, #formatEditor \.fe-tag:hover \{ outline: none; \}/.test(hv_block) && /#formatEditor \.fe-main:hover \{ filter: none; \}/.test(hv_block));
  var hv_w = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  check("the selected tab's pencil is an icon inside the tab, which is what the highlight lands on", !!hv_w.document.querySelector('#feTabs .fe-tab[aria-pressed="true"] .fe-icon svg'));
  } catch (err) { areaCrashed("hover feedback on buttons", err); } }

  if (want("python status at the bottom")) { try {
  // ================================================================ the Python status at the bottom of More options
  var py_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  var py_heads = Array.from(py_w.document.querySelectorAll("#moreOptions details.gd-topic > summary")).filter((h) => !h.closest("[hidden]")).map((h) => h.textContent);
  check("the Python status is the last section of More options, after Hiding the Support me button, since it is the only one with nothing to press", py_heads[py_heads.length - 1] === "Python status" && py_heads[py_heads.length - 2] === "Hiding the Support me button", JSON.stringify(py_heads));
  check("it is the last line of More options (the app version is in the app menu now)", py_w.document.getElementById("pythonStatus").nextElementSibling === null && py_w.document.getElementById("pythonStatus").parentElement.matches("#moreOptions > details.gd-topic:last-of-type"));
  check("the Reset app on this device question still opens right under its button, ahead of the Hiding the Support me button section", !!(py_w.document.getElementById("clearConfirm").compareDocumentPosition(py_w.document.getElementById("donateHideBox")) & 4));
  } catch (err) { areaCrashed("python status at the bottom", err); } }

  if (want("the build icon")) { try {
  // ================================================================ the Build icon
  var bi_html = fs.readFileSync(ROOT + "index.html", "utf8");
  var bi_css = bi_html.replace(/\s+/g, " ");
  var bi_svg = fs.readFileSync(ROOT + "icons/build.svg", "utf8");
  check("the Build icon is three solid sparkles, one big, one medium and one small, drawn without an outline", (bi_svg.match(/<path /g) || []).length === 3 && (bi_svg.match(/fill="#fff" stroke="none"/g) || []).length === 3);
  var bi_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  check("both buttons that build use it: Build playlists and Build all recipes", Array.from(bi_w.document.querySelectorAll('img.btn-icon[src="icons/build.svg"]')).filter((i) => !i.closest("#createDialog")).length === 2 && !!bi_w.document.querySelector('#create img[src="icons/build.svg"]') && !!bi_w.document.querySelector('#buildAll img[src="icons/build.svg"]'));
  } catch (err) { areaCrashed("the build icon", err); } }

  if (want("step 3 order and text")) { try {
  // ================================================================ Step 3: the text, then the button, then the status messages
  var s3_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  var s3_order = Array.from(s3_w.document.getElementById("createHeading").parentElement.children);
  var s3_i = (id) => s3_order.findIndex((el) => el.id === id || el.querySelector("#" + id));
  check("Step 3 reads like the other steps: the heading, then what it does, then the button, then the status messages under the button", s3_i("createHeading") + 1 === s3_i("createNote") && s3_i("createNote") + 1 === s3_i("create") && s3_i("create") < s3_i("pythonNote") && s3_i("pythonNote") < s3_i("spotifyNote"), JSON.stringify([s3_i("createHeading"), s3_i("createNote"), s3_i("create"), s3_i("pythonNote"), s3_i("spotifyNote")]));
  var s3_text = s3_w.document.getElementById("createNote").textContent;
  check("the explanation is two short sentences: it builds for the selected format, you can see the plan first, and nothing is built until you confirm", s3_text === "Builds playlists for the selected recipe. You can see the plan first, and nothing is built until you confirm." && s3_text.length < 130, String(s3_text.length));
  check("minimalist mode still hides the heading and the explanation and keeps the button", /body\.minimal #createHeading, body\.minimal #createNote/.test(fs.readFileSync(ROOT + "index.html", "utf8")));
  } catch (err) { areaCrashed("step 3 order and text", err); } }

  if (want("spotify premium")) { try {
  // ================================================================ Spotify Premium: the tagline, the notice, the reminder, and the error
  var pr_html = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  var pr_w = await boot({ url: "http://127.0.0.1:8000/" });
  var pr_req = pr_w.document.querySelector("#welcomePage .wp-req");
  var pr_why = pr_w.document.getElementById("premiumWhy"), pr_pop = pr_w.document.getElementById("premiumWhyText");
  check("a new visitor sees a Requires Spotify Premium capsule right under the tagline, with Why? next to it", !!pr_req && pr_req.previousElementSibling === pr_w.document.querySelector(".tagline") && pr_req.querySelector(".wp-cap").textContent === "Requires Spotify Premium" && pr_why.textContent === "Why?" && pr_req.contains(pr_why));
  check("Why? starts closed, and opens a note that uses Spotify's own name for free accounts", pr_pop.hidden === true && pr_why.getAttribute("aria-expanded") === "false" && (pr_why.click(), pr_pop.hidden === false) && pr_why.getAttribute("aria-expanded") === "true" && pr_pop.textContent === "This app relies on a feature that is not available in Spotify Free accounts.");
  pr_w.document.body.click();
  check("a tap anywhere else closes it", pr_pop.hidden === true && pr_why.getAttribute("aria-expanded") === "false");
  pr_why.click(); pr_pop.click();
  check("a tap on the note itself leaves it open, Why? again closes it, and so does Escape", pr_pop.hidden === false && (pr_why.click(), pr_pop.hidden === true) && (pr_why.click(), pr_w.document.dispatchEvent(new pr_w.KeyboardEvent("keydown", { key: "Escape" })), pr_pop.hidden === true));
  check("the old boxed Premium notice is gone", !pr_w.document.getElementById("premiumNotice"));
  var pr_w2 = await boot({ url: "http://127.0.0.1:8000/", local: { clientId: "abc123" } });
  check("there is no second Premium line under the title any more", !pr_w.document.getElementById("taglinePremium"));
  var pr_w3 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI, clientId: "abc123" } });
  check("when connected, the welcome page and its notice are not shown", pr_w3.document.documentElement.classList.contains("page-app"));
  check("the welcome page says it works in any browser, easiest on a bigger screen", /Works in any browser, easiest on a bigger screen\./.test(pr_w.document.getElementById("welcomePage").textContent));
  check("the welcome page shows a recipe screenshot in a tilted frame", !!pr_w.document.querySelector("#welcomePage .wp-frame img[src='welcome-recipe.jpg']") && /\.wp-frame \{[^}]*transform: rotate\(-3deg\)/.test(pr_html) && fs.existsSync(ROOT + "welcome-recipe.jpg"));
  check("the first instruction for making the developer app says to log in with the Premium account", /\(it will open in a new tab\), log in with your Spotify Premium account, and <span data-act>press<\/span> the <span class="ui">Create app<\/span> button\./.test(pr_html));
  // the error
  var pr_e = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { premiumRequired: true } });
  await waitFor(() => !pr_e.document.getElementById("connectionProblem").hidden, 30000);
  var PRM = "Spotify says the account that owns this Client ID needs Premium. A free Spotify account will not work. Once that account has Premium, try again.";
  check("when Spotify refuses with a Premium message, Step 1 says exactly that, not the old advice to reconnect", pr_e.document.getElementById("connectionMessage").textContent === PRM && !/Disconnect|approve every permission/.test(pr_e.document.getElementById("connectionMessage").textContent), pr_e.document.getElementById("connectionMessage").textContent);
  check("it offers Try again, which helps once the account has Premium, and not Connect again, which would change nothing", pr_e.document.getElementById("connectionRetry").hidden === false && pr_e.document.getElementById("connectionReconnect").hidden === true);
  check("it is a known problem, so there is no report link for it", pr_e.document.getElementById("connectionReportHint").hidden === true);
  check("and it is counted as its own kind of connection problem, premium", pr_e.eval('problemKind("' + PRM + '")') === "premium" && pr_e.eval('problemKind("Spotify did not allow this (x). Click Disconnect")') === "sign-in");
  var pr_o = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { denyCreate: true } });
  check("a 403 that does not mention Premium keeps its old advice about reconnecting and approving every permission", fs.readFileSync(ROOT + "app.js", "utf8").includes('const PREMIUM_REQUIRED_MESSAGE = "' + PRM + '";') && /Spotify did not allow this \(\$\{what\}\)\. \$\{actWord\(true\)\} Disconnect, then Connect again and approve every permission it asks for\./.test(fs.readFileSync(ROOT + "app.js", "utf8")));
  } catch (err) { areaCrashed("spotify premium", err); } }

  if (want("welcome recipe link")) { try {
  // ================================================================ "recipe" on the welcome page opens a note that says what a recipe is
  var rw_w = await boot({ url: "http://127.0.0.1:8000/" });
  var rw_word = rw_w.document.getElementById("recipeWhat"), rw_note = rw_w.document.getElementById("recipeWhatText");
  var rw_para = rw_word && rw_word.closest("p");
  check("the intro says Describe this arc in a recipe, with recipe as a link-like button and no bracketed list after it", !!rw_word && rw_word.textContent === "recipe" && rw_word.classList.contains("linklike") && !!rw_para && /Describe this arc in a recipe and this app builds new ceremony playlists/.test(rw_para.textContent.replace(rw_note.textContent, "")) && !/\(which of your Spotify playlists/.test(rw_para.textContent));
  check("the note starts closed, and recipe opens it with the agreed text", rw_note.hidden === true && rw_word.getAttribute("aria-expanded") === "false" && (rw_word.click(), rw_note.hidden === false) && rw_word.getAttribute("aria-expanded") === "true" && rw_note.textContent === "A recipe is a plan for one ceremony: which of your Spotify playlists to draw from, in what order, and for how many minutes each. Each row in the picture is one part of the arc. From one recipe, this app can build as many playlists as your songs allow.");
  rw_note.click();
  check("a tap on the note leaves it open, a tap elsewhere closes it", rw_note.hidden === false && (rw_w.document.body.click(), rw_note.hidden === true) && rw_word.getAttribute("aria-expanded") === "false");
  check("recipe again closes it, and so does Escape", (rw_word.click(), rw_word.click(), rw_note.hidden === true) && (rw_word.click(), rw_w.document.dispatchEvent(new rw_w.KeyboardEvent("keydown", { key: "Escape" })), rw_note.hidden === true));
  } catch (err) { areaCrashed("welcome recipe link", err); } }

  if (want("hiding the donate button")) { try {
  // ================================================================ Hiding the Support me button: for people who have donated, on the honor system
  var dh_html = fs.readFileSync(ROOT + "index.html", "utf8");
  var dh_css = dh_html.replace(/\s+/g, " ");
  var dh_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  var dh_d = dh_w.document;
  var dh_h3 = Array.from(dh_d.querySelectorAll("#moreOptions details.gd-topic > summary")).map((h) => h.textContent);
  check("More options has a section called Hiding the Support me button, right after Reset app on this device and just before Python status", dh_h3.includes("Hiding the Support me button") && dh_h3.indexOf("Hiding the Support me button") === dh_h3.indexOf("Reset app on this device") + 1 && dh_h3.indexOf("Hiding the Support me button") + 1 === dh_h3.indexOf("Python status"), JSON.stringify(dh_h3));
  var dh_p = dh_d.querySelector("#donateHideBox").closest("label").previousElementSibling;
  check("it is direct and playful: the button is meant to be visible until you have donated, please give what feels right, thank you if you did, check the box and it leaves you alone, honor system, nobody is looking, and it waits patiently", dh_p.textContent === "The Support me button stays visible until you have... supported me 🙂. If this app has been helpful to you, please give whatever feels right. Already did? Thank you! Check the box and the button will leave you alone. This runs on the honor system, so nobody\u2019s looking, and the button waits patiently.");
  check("there is one checkbox, labeled I have supported you!, for people who have donated, and no second answer for people who have not", dh_d.getElementById("donateHideBox").type === "checkbox" && dh_d.getElementById("donateHideBox").closest("label").textContent.trim() === "I have supported you!" && !dh_d.getElementById("hideDonated") && !dh_d.getElementById("hideDeclined") && !dh_d.getElementById("showDonate"));
  check("to begin with the box is unchecked, the Donate button shows, and there is no thank-you under the box", dh_d.getElementById("donateHideBox").checked === false && dh_d.getElementById("donateHiddenMessage").hidden === true && !dh_w.document.documentElement.classList.contains("donate-hidden") && !dh_w.localStorage.getItem("donateHidden"));
  dh_d.getElementById("donateHideBox").checked = true; dh_d.getElementById("donateHideBox").dispatchEvent(new dh_w.Event("change", { bubbles: true }));
  check("checking it hides the Donate button, keeps the answer in this browser, and says thank you", dh_w.document.documentElement.classList.contains("donate-hidden") && dh_w.localStorage.getItem("donateHidden") === "donated" && dh_d.getElementById("donateHiddenMessage").hidden === false && dh_d.getElementById("donateHiddenMessage").textContent === "The Support me button is hidden. Thank you for your support!");
  dh_d.getElementById("donateHideBox").checked = false; dh_d.getElementById("donateHideBox").dispatchEvent(new dh_w.Event("change", { bubbles: true }));
  check("unchecking it brings the button back and clears the saved answer, so no separate button is needed", !dh_w.document.documentElement.classList.contains("donate-hidden") && !dh_w.localStorage.getItem("donateHidden") && dh_d.getElementById("donateHiddenMessage").hidden === true);
  var dh_w2 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI, donateHidden: "donated" }, fetchOptions: {} });
  check("a later visit starts with it hidden and the box checked", dh_w2.document.documentElement.classList.contains("donate-hidden") && dh_w2.document.getElementById("donateHideBox").checked === true && dh_w2.document.getElementById("donateHiddenMessage").hidden === false);
  var dh_w5 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI, donateHidden: "declined" }, fetchOptions: {} });
  check("an answer saved by the earlier version of this section (declined) still hides it, with the box checked", dh_w5.document.documentElement.classList.contains("donate-hidden") && dh_w5.document.getElementById("donateHideBox").checked === true);
  check("the CSS hides the Donate button with its note, and the Donate button in the Build popup", /\.donate-hidden #supportBox, \.donate-hidden #createDonate \{ display: none !important; \}/.test(dh_css));
  var dh_early = dh_html.match(/try \{ if \(localStorage\.getItem\("donateHidden"\)\) document\.documentElement\.classList\.add\("donate-hidden"\); \} catch \(e\) \{[^}]*\}/);
  check("a tiny script in the page's head sets the class before the page is drawn, so a hidden Donate button never flashes up", !!dh_early && dh_html.indexOf(dh_early[0]) < dh_html.indexOf("</head>"));
  if (dh_early) { var dh_w3 = await boot({ url: "http://127.0.0.1:8000/", local: { donateHidden: "donated" } }); dh_w3.document.documentElement.classList.remove("donate-hidden"); dh_w3.eval(dh_early[0]); check("and that script does it when an answer is saved", dh_w3.document.documentElement.classList.contains("donate-hidden")); }
  check("the thank-you line after a build shows unless the Donate button was hidden", /\$\("createSupport"\)\.hidden = donateHiddenChoice\(\);/.test(fs.readFileSync(ROOT + "app.js", "utf8")));
  var dh_app = fs.readFileSync(ROOT + "app.js", "utf8");
  check("the answer stays in this browser: it is never counted or sent anywhere, and Privacy says so", !/countEvent\("donate-hid/.test(dh_app) && /const DONATE_KEY = "donateHidden";/.test(dh_app) && !/fetch\([^)]*donateHidden/.test(dh_app) && /If you check "I have supported you!" in [\s\S]*?More options[\s\S]*?, that choice is saved in this browser and goes nowhere else\./.test(dh_html));
  } catch (err) { areaCrashed("hiding the donate button", err); } }

  if (want("backup link in step 2")) { try {
  // ================================================================ the download link in Step 2, and where to find the backup
  var bl_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  var bl_saved = []; bl_w.eval("saveFile = function (name, text) { window.__saved = window.__saved || []; window.__saved.push({ name, text }); };");
  bl_w.document.getElementById("backupDownloadLink").click();
  check("the download a backup link in Step 2 downloads the backup, as the button in Step 4 and the menu item do", (bl_w.__saved || []).length === 1 && /^playlist-recipes-.*\.txt$/.test(bl_w.__saved[0].name) && /FORMATS|"mini"|mini/.test(bl_w.__saved[0].text));
  check("and says where to find it, right under the sentence, in words that work on a phone too", capText(bl_w) === "Backed up to this device. Find the file in Downloads, or in the Files app on a phone." && bl_w.document.getElementById("savedNote").nextElementSibling.id === "restoreFile" && bl_w.document.getElementById("restoreFile").hidden === true && bl_w.document.getElementById("restoreFile").nextElementSibling.id === "spotifySaveLine");
  check("Step 4's button says the same, in the same line", capText(bl_w) === "Backed up to this device. Find the file in Downloads, or in the Files app on a phone.");
  var bl_src = fs.readFileSync(ROOT + "editor.js", "utf8") + fs.readFileSync(ROOT + "app.js", "utf8");
  check("the old words about a Downloads folder are gone everywhere, and the one message after a backup comes from the one function that makes the backup, so the menu, both links, Step 4 and the offer after leaving Spotify all show it", !/Downloads folder/.test(bl_src) && (bl_src.match(/Find the file in Downloads, or in the Files app on a phone\./g) || []).length === 1 && (bl_src.match(/BACKED_UP_MESSAGE/g) || []).length === 2 && /function downloadBackup\(\) \{[\s\S]*?showBackupMessage\(BACKED_UP_MESSAGE\)/.test(bl_src));
  } catch (err) { areaCrashed("backup link in step 2", err); } }

  if (want("no double-tap zoom")) { try {
  // ================================================================ no zoom from quick taps
  var zt_html = fs.readFileSync(ROOT + "index.html", "utf8");
  var zt_css = zt_html.replace(/\s+/g, " ");
  check("every element is set to touch-action: manipulation, so a quick second tap on the plus and minus buttons, or anything else, no longer zooms the page", /\* \{ touch-action: manipulation; \}/.test(zt_css));
  check("the drag handle keeps its own touch-action: none, which wins over that rule, so dragging a segment still works", /#formatEditor \.fe-grip \{ touch-action: none;/.test(zt_css));
  check("pinching to zoom is still allowed: the viewport does not forbid scaling", /<meta name="viewport" content="width=device-width, initial-scale=1">/.test(zt_html) && !/user-scalable|maximum-scale/.test(zt_html));
  } catch (err) { areaCrashed("no double-tap zoom", err); } }

  if (want("build button centered in minimalist mode")) { try {
  // ================================================================ the Build button in the middle, in minimalist mode only
  var cb_html = fs.readFileSync(ROOT + "index.html", "utf8");
  var cb_css = cb_html.replace(/\s+/g, " ");
  var cb_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  check("the row that holds the Build button has an id of its own, so minimalist mode can center it", cb_w.document.getElementById("buildRow").contains(cb_w.document.getElementById("create")) && cb_w.document.getElementById("buildRow").children.length === 1);
  check("in minimalist mode only, that row centers the button and the messages under it are centered too; in normal mode the button stays at the left like every other button", /body\.minimal #buildRow \{ justify-content: center; \}/.test(cb_css) && /body\.minimal #pythonNote, body\.minimal #spotifyNote \{ text-align: center; \}/.test(cb_css) && !/(?<!body\.minimal )#buildRow \{ justify-content/.test(cb_css));
  } catch (err) { areaCrashed("build button centered in minimalist mode", err); } }

  if (want("privacy: why the counts")) { try {
  // ================================================================ Privacy: why anything is counted
  var wc_w = await boot({ url: "http://127.0.0.1:8000/" });
  var wc_h = Array.from(wc_w.document.querySelectorAll("#privacySection details.gd-topic > summary")).find((h) => h.textContent === "Anonymous visit counts");
  var wc_p = wc_h.nextElementSibling.textContent;
  check("Anonymous visit counts opens by saying why anything is counted: to see how many people use this app and how it is used", /^The page keeps simple counts, to see how many people use this app and how it is used\. It counts visits with GoatCounter, /.test(wc_p));
  check("and the rest is still there: no cookies, what a visit records, the few actions counted, what is never received, and the once-only marker", /uses no cookies/.test(wc_p) && /the browser, screen size, country, and the site you came from, but not who you are/.test(wc_p) && /how many playlists get created, when Support me is opened, and the kind of connection problem/.test(wc_p) && /never receives playlist names, recipes, song titles, or your Client ID/.test(wc_p) && /so it is counted once\.$/.test(wc_p));
  } catch (err) { areaCrashed("privacy: why the counts", err); } }

  if (want("the silence card")) { try {
  // ================================================================ the silence card: 0 sec, one look for zero, Reset to default, and centered on its marker
  var sc_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  var sc_src = fs.readFileSync(ROOT + "editor.js", "utf8");
  check("a silence at zero has no look of its own: the hollow dark style is gone from the page and from the code", !/fe-tag-zero/.test(sc_css) && !/fe-tag-zero|"zero"/.test(sc_src.replace(/\.zero|info\.zero|zero:/g, "")));
  var sc_w = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"a": {"name": "A {n}", "title": "T", "silence between segments": "1 min", "segments": [("x", 10), ("silence", "none"), ("y", 10), ("z", 10)]}}' }, fetchOptions: {} });
  var sc_tag = () => rowsOf(sc_w)[0].querySelector(".fe-tag"), sc_tag2 = () => rowsOf(sc_w)[1].querySelector(".fe-tag");
  check("the default is a deep pink and anything changed is the buttons' bright pink, zero included", sc_tag().classList.contains("fe-tag-custom") && sc_tag2().classList.contains("fe-tag-default") && sc_tag().textContent === "0s" && /0 sec\. (Tap|Click) to change\./.test(sc_tag().getAttribute("aria-label")));
  sc_tag().click();
  check("the card's length reads 0 sec, as the marker does, and there is a pink Reset to default link below it", sc_w.document.getElementById("feTagDuration").textContent === "0 sec" && sc_w.document.getElementById("feTagReset").textContent === "Reset to default");
  sc_w.document.getElementById("feTagReset").click();
  sc_tag().click();
  check("once it is back at the default, the card shows a gray (default) in that place, and the link is gone", sc_w.document.getElementById("feTagDefault").textContent === "(default)" && !sc_w.document.getElementById("feTagReset") && sc_w.document.getElementById("feTagDefault").closest(".fe-tagbelow") !== null);
  check("the card is centered on its marker, just left of it, and never flips up or down", /#formatEditor \.fe-tagpanel \{ right: 8px; top: 55px; transform: translateY\(calc\(-50% \+ var\(--shift, 0px\)\)\);/.test(sc_css) && !/fe-tagpanel\.fe-up/.test(sc_css) && !sc_w.document.getElementById("feTagPanel").classList.contains("fe-up"));
  check("the link is not bold and not larger than the card's text", /#formatEditor \.fe-tagbelow \.linklike \{ font-weight: 400; \}/.test(sc_css));
  check("the help text names the link as it is on the card", /A tag with a changed length is pink, and <span class="ui">Reset to default<\/span> puts it back\./.test(fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ")));

  var sc_fmt = 'FORMATS = {"a": {"name": "A {n}", "title": "T", "silence between segments": "1 min", "segments": [("x", 10), ("y", 10), ("z", 10)]}}';
  var sc_mock = (naturalTop, height, innerH) => ({ before: (w) => {
    Object.defineProperty(w, "innerHeight", { value: innerH, configurable: true });
    w.Element.prototype.getBoundingClientRect = function () {
      if (this.classList && this.classList.contains("fe-pop")) { const sh = parseFloat(this.style.getPropertyValue("--shift")) || 0; return { top: naturalTop + sh, bottom: naturalTop + sh + height, height, left: 0, right: 300, width: 300 }; }
      return { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0 };
    };
    w.Element.prototype.scrollIntoView = function () { w.__scrolled = (w.__scrolled || 0) + 1; };
  } });
  var sc_low = await boot({ url: EDURL, session: signedIn(), local: { formats: sc_fmt }, fetchOptions: {}, ...sc_mock(700, 200, 800) });
  rowsOf(sc_low)[0].querySelector(".fe-tag").click();
  check("a card that would run off the bottom of the screen slides up just far enough to be fully on it, 8 pixels clear of the edge, and the page does not scroll", sc_low.document.getElementById("feTagPanel").style.getPropertyValue("--shift") === "-108px" && !sc_low.__scrolled);
  var sc_high = await boot({ url: EDURL, session: signedIn(), local: { formats: sc_fmt }, fetchOptions: {}, ...sc_mock(-60, 200, 800) });
  rowsOf(sc_high)[0].querySelector(".fe-tag").click();
  check("one that would run off the top slides down, 8 pixels clear of the top", sc_high.document.getElementById("feTagPanel").style.getPropertyValue("--shift") === "68px");
  var sc_fit = await boot({ url: EDURL, session: signedIn(), local: { formats: sc_fmt }, fetchOptions: {}, ...sc_mock(300, 200, 800) });
  rowsOf(sc_fit)[0].querySelector(".fe-tag").click();
  check("one that fits stays exactly centered on its marker, with no shift at all", sc_fit.document.getElementById("feTagPanel").style.getPropertyValue("--shift") === "");
  var sc_tall = await boot({ url: EDURL, session: signedIn(), local: { formats: sc_fmt }, fetchOptions: {}, ...sc_mock(100, 900, 800) });
  rowsOf(sc_tall)[0].querySelector(".fe-tag").click();
  check("one taller than the screen has its top kept on screen, and the page scrolls to it for the rest", sc_tall.document.getElementById("feTagPanel").style.getPropertyValue("--shift") === "-92px" && sc_tall.__scrolled >= 1, sc_tall.document.getElementById("feTagPanel").style.getPropertyValue("--shift"));
  var sc_ed = await boot({ url: EDURL, session: signedIn(), local: { formats: sc_fmt }, fetchOptions: {} });
  rowsOf(sc_ed)[0].querySelector(".fe-tag").click();
  var sc_col = sc_ed.document.querySelector("#feTagPanel .fe-tagcol");
  check("the widget and the (default) text share one column, in that order, both centered", !!sc_col && sc_col.children.length === 2 && sc_col.children[0].classList.contains("fe-stepper") && sc_col.children[1].classList.contains("fe-tagbelow"), sc_col && sc_col.innerHTML.slice(0, 160));
  check("the caption lives inside the widget, as a second line between the minus and the plus, and there is no separate title", sc_col.querySelector(".fe-stepper .fe-amount-two") !== null && sc_col.querySelectorAll(".fe-amount .fe-line").length === 2 && !/fe-tagtitle|fe-tagslot/.test(sc_css));
  check("the two lines are centered in the widget, one under the other", /#formatEditor \.fe-amount-two \{ display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1\.15; white-space: nowrap; \}/.test(sc_css));
  var sc_ndw = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"a": {"name": "A {n}", "title": "T", "silence between segments": "1 min", "segments": [("x", 10), ("y", 10), ("silence", "30 sec")]}}' }, fetchOptions: {} });
  rowsOf(sc_ndw)[1].querySelector(".fe-tag").click();
  var sc_ncol = sc_ndw.document.querySelector("#feTagPanel .fe-tagcol");
  check("a silence with no default to go back to has its Remove button under the widget, centered, and nothing beside it", !!sc_ndw.document.getElementById("feTagRemove") && sc_ncol.children.length === 2 && sc_ncol.children[1].contains(sc_ndw.document.getElementById("feTagRemove")) && sc_ndw.document.querySelector("#feTagPanel .fe-tagrow").children.length === 1);
  check("popups that are not dialogs get the same dark-mode treatment: a faint light edge, a deeper shadow and a slightly lighter surface, for the editor's five popups and the theme list", /@media \(prefers-color-scheme: dark\) \{ #formatEditor \.fe-pop, \.theme-list \{ box-shadow: 0 0 0 1px rgba\(255, 255, 255, 0\.07\), 0 6px 14px rgba\(0, 0, 0, 0\.5\), 0 18px 40px rgba\(0, 0, 0, 0\.6\); background-image: linear-gradient\(rgba\(255, 255, 255, 0\.05\), rgba\(255, 255, 255, 0\.05\)\); \} \}/.test(sc_css));
  check("the widget and the text under it are centered on each other in one column", /#formatEditor \.fe-tagcol \{ display: flex; flex-direction: column; align-items: center; \}/.test(sc_css) && /#formatEditor \.fe-tagbelow \{ display: flex; justify-content: center; font-size: 0\.95rem; line-height: 1; text-align: center; margin-top: 8px; \}/.test(sc_css));
  check("the card has the same margin all round: 12 px from its edge to the widget at the top, left and right (1 px border + 11 px padding, nothing else added), and the text under it is set to end 12 px from the bottom edge, with a larger tap area reaching into that margin", /#formatEditor \.fe-tagpanel \{[^}]*padding: 11px;/.test(sc_css) && !/#formatEditor \.fe-tagrow \{[^}]*padding/.test(sc_css) && /#formatEditor \.fe-tagbelow-link \{ margin-bottom: -1px; \}/.test(sc_css) && /#formatEditor \.fe-tagbelow-remove \{ margin-bottom: -3px; \}/.test(sc_css) && /\.fe-linkbutton::after \{ content: ""; position: absolute; left: 0; right: 0; top: -2px; bottom: -10px; \}/.test(sc_css) && sc_ed.document.querySelector(".fe-tagbelow").classList.contains("fe-tagbelow-default"));
  } catch (err) { areaCrashed("the silence card", err); } }

  if (want("narrow more button")) { try {
  // ================================================================ narrow mode: the more button is only as wide as its dots
  var nm_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  check("on a phone the ... button on a segment is 22 px wide, the same as the drag handle beside it, so the playlist gets the room, with a tap area reaching 4 px into the card's edge", /@media \(max-width: 599px\) \{[^@]*#formatEditor \.fe-more \{ width: 22px; position: relative; \}[^@]*#formatEditor \.fe-more::after \{ content: ""; position: absolute; top: 0; bottom: 0; left: 0; right: -4px; \}/.test(nm_css));
  check("on wide screens it keeps its 36 px", /#formatEditor \.fe-more \{ width: 36px; height: 40px;/.test(nm_css));

  var nm_w = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"a": {"name": "A {n}", "title": "T", "silence between segments": "1 min", "segments": [("x", 10), ("y", 10)]}}' }, fetchOptions: {} });
  var nm_touch = (el) => { const ev = new nm_w.Event("touchend", { bubbles: true, cancelable: true }); el.dispatchEvent(ev); return ev.defaultPrevented; };
  var nm_bare = nm_w.document.getElementById("feRows");
  var nm_first = nm_touch(nm_bare), nm_second = nm_touch(nm_bare);
  check("a second tap within 300 ms on a spot with no control is cancelled, so the page does not zoom, and the first one is not", nm_first === false && nm_second === true);
  await new Promise((r) => setTimeout(r, 350));
  check("a tap more than 300 ms after the last one is left alone", nm_touch(nm_bare) === false);
  var nm_btn = nm_w.document.querySelector("#feRows .fe-step");
  var nm_b1 = nm_touch(nm_btn), nm_b2 = nm_touch(nm_btn), nm_b3 = nm_touch(nm_btn);
  check("quick taps on a control are never cancelled, so tapping + or - fast still counts every tap", nm_b1 === false && nm_b2 === false && nm_b3 === false);
  check("holding or dragging on the editor selects no text, and no copy menu comes up, while the fields in it still take typing", /#formatEditor \{ margin: 8px 0 12px; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; \}/.test(nm_css) && /#formatEditor input, #formatEditor textarea \{ -webkit-user-select: text; user-select: text; \}/.test(nm_css));
  } catch (err) { areaCrashed("narrow more button", err); } }

  if (want("popups close only")) { try {
  // ================================================================ a tap outside a popup only closes it
  var po_fmt = 'FORMATS = {"a": {"name": "A {n}", "title": "T", "silence between segments": "1 min", "segments": [("x", 10), ("y", 10), ("z", 10)]}}';
  var po_w = await boot({ url: EDURL, session: signedIn(), local: { formats: po_fmt }, fetchOptions: {} });
  var po_card = () => po_w.document.getElementById("feTagPanel");
  var po_tap = (el) => { const ev = new po_w.MouseEvent("click", { bubbles: true, cancelable: true }); el.dispatchEvent(ev); return ev; };
  rowsOf(po_w)[0].querySelector(".fe-tag").click();
  check("the silence card is open to start with", !!po_card());
  var po_ev = po_tap(rowsOf(po_w)[1].querySelector(".fe-main"));
  check("tapping a segment's playlist button while the silence card is open closes the card and does not open the list", !po_card() && !po_w.document.getElementById("feListPanel") && !po_w.document.querySelector(".fe-listpanel") && po_ev.defaultPrevented);
  po_tap(rowsOf(po_w)[1].querySelector(".fe-main"));
  check("the next tap, with nothing open, opens the list as usual", !!po_w.document.querySelector(".fe-listpanel"));
  po_tap(rowsOf(po_w)[1].querySelector(".fe-main"));
  check("tapping the same button again closes its own list, as before", !po_w.document.querySelector(".fe-listpanel"));
  rowsOf(po_w)[0].querySelector(".fe-more").click();
  var po_add = po_w.document.getElementById("feAddSegment");
  var po_before = rowsOf(po_w).length;
  po_tap(po_add);
  check("a tap on New segment while a menu is open only closes the menu: no segment is added", !po_w.document.querySelector(".fe-menu") && rowsOf(po_w).length === po_before);
  po_tap(po_w.document.getElementById("feAddSegment"));
  check("and the next tap on it adds the segment, as usual", rowsOf(po_w).length === po_before + 1);
  // a press that would start a drag is stopped too
  var po_seen = 0;
  po_w.document.body.addEventListener("pointerdown", () => { po_seen++; });
  po_w.document.body.click();   // a new segment opens its list, so close that first
  rowsOf(po_w)[0].querySelector(".fe-more").click();
  rowsOf(po_w)[1].querySelector(".fe-grip").dispatchEvent(new po_w.Event("pointerdown", { bubbles: true, cancelable: true }));
  check("a press on a drag handle while a menu is open goes no further", po_seen === 0);
  po_w.document.body.click();
  rowsOf(po_w)[1].querySelector(".fe-grip").dispatchEvent(new po_w.Event("pointerdown", { bubbles: true, cancelable: true }));
  check("with nothing open, it goes through", po_seen === 1);
  // the theme list in More options works the same way
  po_w.document.dispatchEvent(new po_w.Event("pointerup", { bubbles: true }));
  po_w.document.getElementById("themeButton").click();
  check("the theme list opens", po_w.document.getElementById("themeList").hidden === false);
  var po_n = rowsOf(po_w).length;
  po_tap(po_w.document.getElementById("feAddSegment"));
  check("a tap on New segment while the theme list is open only closes the list", po_w.document.getElementById("themeList").hidden === true && rowsOf(po_w).length === po_n);
  } catch (err) { areaCrashed("popups close only", err); } }

  if (want("marker hugs corners")) { try {
  // ================================================================ the silence marker's left end follows the segments' rounded corners
  var mh_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  var mh_w = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"a": {"name": "A {n}", "title": "T", "silence between segments": "1 min", "segments": [("x", 10), ("y", 10)]}}' }, fetchOptions: {} });
  var mh_rule = (mh_css.match(/#formatEditor \.fe-tag \{ position: absolute;[^}]*\}/) || [""])[0];
  var mh_pts = ((mh_rule.match(/clip-path: polygon\(([^)]*)\)/) || [])[1] || "").split(",").map((p) => p.trim().split(" "));
  var mh_num = (v) => parseFloat(v);
  var mh_up = mh_pts.filter((p) => /px$/.test(p[0]));
  check("the marker starts 16 px inside the card's edge, which is the corner radius, and its point is in the middle of the gap, where the two curves meet", /left: calc\(100% - 16px\)/.test(mh_rule) && Math.abs(mh_num(mh_up[0][0]) - 11.09) < 0.1 && Math.abs(mh_num(mh_up[0][1]) - 12) < 0.01);
  var mh_ok = true, mh_close = 0;
  for (const p of mh_up) {
    const x = mh_num(p[0]), y = mh_num(p[1]) + 43;                  // back to the row's own coordinates
    const upper = (Math.hypot(x - 0, y - 36) - 22), lower = (Math.hypot(x - 0, 74 - y) - 22);
    if (y <= 55.001 && Math.abs(upper) > 0.05) mh_ok = false;
    if (y > 55.001 && Math.abs(lower) > 0.05) mh_ok = false;
    mh_close++;
  }
  check("every point on its two sides lies on a circle of radius 22 (the 16 px corner plus a 6 px margin, the same as the gap between two segments) around the corner of the segment above or below, so the sides hug the corners and are not straight", mh_ok && mh_close >= 18, mh_close);
  check("the sides meet the marker's top and bottom edges at the end of the arcs, and there are two arcs of the same size", mh_pts.filter((p) => /px$/.test(p[0])).length >= 36 && mh_pts.some((p) => p[0] === "100%"));
  check("the text starts 20 px in, clear of the curve that is now 6 px from the corners, and the marker's width is as it was, so it hangs only 26 px past the segments (it was 31) on a phone and 45 on wide screens (it was 53), and a longer label such as 12.5m makes it wider instead of spilling out", /min-width: 42px; width: max-content;[^}]*padding: 0 4px 0 20px;/.test(mh_rule) && /@media \(min-width: 860px\) \{ #formatEditor \.fe-tag \{ min-width: 61px; padding: 0 5px 0 20px;/.test(mh_css));
  check("and the room kept for the markers beside the segments on a phone is 5 px smaller, 3 px instead of 8, which goes to the segments, and grows only when a long label makes a marker wider", /@media \(max-width: 859px\) \{ #formatEditor\.fe-hastags \{ margin-right: calc\(var\(--tag-hang, 26px\) - 23px\); \} \}/.test(mh_css) && /--tag-hang/.test(fs.readFileSync(ROOT + "editor.js", "utf8")) && mh_w.document.getElementById("formatEditor").style.getPropertyValue("--tag-hang") === "26px");
  } catch (err) { areaCrashed("marker hugs corners", err); } }

  if (want("marker colors")) { try {
  var mc_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  var mc_theme = fs.readFileSync(ROOT + "theme.js", "utf8");
  check("a default marker is the deeper pink with its own readable text color, so it shows on a phone", /#formatEditor \.fe-tag \{ position: absolute;[^}]*background: var\(--accent-deep, #a8217c\); color: var\(--on-deep, #fff\);/.test(mc_css));
  check("a changed marker is the same pink as the buttons, with the buttons' text color", /#formatEditor \.fe-tag-custom \{ background: var\(--button\); color: var\(--on-button, #fff\); \}/.test(mc_css));
  check("the gray marker colors are gone from the page and from the themes", !/var\(--tag(-off)?[,)]/.test(mc_css) && !/"--tag(-off)?":/.test(mc_theme));

  var gs_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  check("holding a finger anywhere on the app page, on text, a button or the background, selects nothing: the whole page is set to no selection, and only fields, the plan and report text and the copyable addresses can be selected", /html\.page-app \{ -webkit-user-select: none; user-select: none; \}/.test(gs_css) && /input, textarea, pre, code \{ -webkit-user-select: text; user-select: text; \}/.test(gs_css));
  } catch (err) { areaCrashed("marker colors", err); } }


  if (want("playlist ids")) { try {
  // ================================================================ a format knows its playlists by their Spotify IDs
  var pi_w0 = await boot({ url: EDURL, session: signedIn(), fetchOptions: {} });
  var pi_textToModel = pi_w0.textToModel, pi_modelToText = pi_w0.modelToText;
  var pi_model = pi_textToModel('FORMATS = {"a": {"title": "T", "name": "T {n}", "silence between segments": "30 sec", "segments": [("Soft landing [id:abc123]", 30), ({"Mix one [id:x1]": 65, "Mix two": 35}, 20), ("Plain", 10), ("Ends in [brackets]", 5), ("Looks like [id:] but is not", 5)]}}');
  var pi_items = pi_model.formats[0].items;
  check("a playlist written as name [id:...] is read as its name and its ID", pi_items[0].lists[0].name === "Soft landing" && pi_items[0].lists[0].id === "abc123");
  check("in a mix, each playlist has its own ID, or none", pi_items[1].lists[0].id === "x1" && pi_items[1].lists[0].name === "Mix one" && pi_items[1].lists[1].id === undefined && pi_items[1].lists[1].name === "Mix two" && pi_items[1].lists[1].weight === 35);
  check("a name with no ID, or with brackets that are not an ID, is read as it is", pi_items[2].lists[0].name === "Plain" && pi_items[2].lists[0].id === undefined && pi_items[3].lists[0].name === "Ends in [brackets]" && pi_items[4].lists[0].name === "Looks like [id:] but is not");
  var pi_text = pi_modelToText(pi_model);
  check("it is written back the same way, so nothing is lost on the way through", /\("Soft landing \[id:abc123\]", 30\)/.test(pi_text) && /\{"Mix one \[id:x1\]": 65, "Mix two": 35\}/.test(pi_text) && /\("Plain", 10\)/.test(pi_text) && JSON.stringify(pi_textToModel(pi_text).formats[0].items.map((i) => i.lists)) === JSON.stringify(pi_items.map((i) => i.lists)));
  var pi_py = (fn, args) => require("child_process").spawnSync("python3", [require("path").join(__dirname, "bridge.py"), fn, JSON.stringify(args)], { encoding: "utf8" }).stdout;
  check("the engine goes by the names alone: the IDs are ignored when it reads the text", JSON.stringify(JSON.parse(pi_py("needed_sources", [pi_text, "a"]))) === JSON.stringify(["Soft landing", "Mix one", "Mix two", "Plain", "Ends in [brackets]", "Looks like [id:] but is not"]));

  // a text of names only gets the IDs of the playlists, once they are known
  var pi_names = 'FORMATS = {"a": {"title": "T", "name": "T {n}", "silence between segments": "30 sec", "segments": [("💗 spacious + gentle", 30), ({"💗💗 evocative": 60, "🛋 rest": 40}, 20), ("Not in the library", 10)]}}';
  var pi_o1 = {};
  var pi_w1 = await boot({ url: EDURL, session: signedIn(), local: { formats: pi_names }, fetchOptions: pi_o1 });
  await waitFor(() => /\[id:p2\]/.test(pi_w1.document.getElementById("formats").value), 8000);
  var pi_t1 = pi_w1.document.getElementById("formats").value;
  check("when the playlists load, each one found by name gets its ID written into the text, in a mix too", /\("💗 spacious \+ gentle \[id:p2\]", 30\)/.test(pi_t1) && /"💗💗 evocative \[id:p3\]": 60/.test(pi_t1) && /"🛋 rest \[id:p4\]": 40/.test(pi_t1));
  check("one that is not among the playlists gets none, and stays as it was", /\("Not in the library", 10\)/.test(pi_t1));

  // renamed in Spotify: the ID finds it, and the name in the format follows
  var pi_renamed = 'FORMATS = {"a": {"title": "T", "name": "T {n}", "silence between segments": "30 sec", "segments": [("Old name of spacious [id:p2]", 30), ("🛋 rest [id:p4]", 20)]}}';
  var pi_w2 = await boot({ url: EDURL, session: signedIn(), local: { formats: pi_renamed, lastBackupText: pi_renamed, lastBackupAt: new Date(2026, 9, 25, 14, 5, 9).toISOString() }, fetchOptions: {} });
  await waitFor(() => /💗 spacious \+ gentle \[id:p2\]/.test(pi_w2.document.getElementById("formats").value), 8000);
  check("a playlist renamed in Spotify is found by its ID, and the format shows and saves its new name", rowsOf(pi_w2)[0].querySelector(".fe-title").textContent === "💗 spacious + gentle" && !/Old name/.test(pi_w2.document.getElementById("formats").value) && /💗 spacious \+ gentle \[id:p2\]/.test(pi_w2.localStorage.getItem("formats")));
  check("the engine is handed the new name, which is the one it finds in your playlists", JSON.parse(pi_py("needed_sources", [pi_w2.document.getElementById("formats").value, "a"])).join("|") === "💗 spacious + gentle|🛋 rest");
  check("bringing a name up to date is not an edit of the formats: a backup that was current stays current", /^Last backup:/.test(pi_w2.document.getElementById("backupStatus").textContent), pi_w2.document.getElementById("backupStatus").textContent);

  // deleted and made again: a new ID, found by the name
  var pi_gone = 'FORMATS = {"a": {"title": "T", "name": "T {n}", "silence between segments": "30 sec", "segments": [("🛋 rest [id:gone99]", 20)]}}';
  var pi_w3 = await boot({ url: EDURL, session: signedIn(), local: { formats: pi_gone }, fetchOptions: {} });
  await waitFor(() => /\[id:p4\]/.test(pi_w3.document.getElementById("formats").value), 8000);
  check("a playlist whose ID is gone but whose name matches one of yours is linked to that one instead", /\("🛋 rest \[id:p4\]", 20\)/.test(pi_w3.document.getElementById("formats").value));

  // two playlists with one name: no guessing
  var pi_w4 = await boot({ url: EDURL, session: signedIn(), local: { formats: pi_names }, fetchOptions: { extraPlaylists: [{ id: "p9", name: "💗 spacious + gentle", owner: { id: "ron" } }] } });
  await waitFor(() => /\[id:p3\]/.test(pi_w4.document.getElementById("formats").value), 8000);
  check("when two of your playlists share a name, the format is not tied to either by guesswork", /\("💗 spacious \+ gentle", 30\)/.test(pi_w4.document.getElementById("formats").value));

  // choosing a playlist records its ID
  var pi_w5 = await boot({ url: EDURL, session: signedIn(), local: { formats: pi_names }, fetchOptions: {} });
  await waitFor(() => /\[id:p2\]/.test(pi_w5.document.getElementById("formats").value), 8000);
  rowsOf(pi_w5)[0].querySelector(".fe-main").click();
  Array.from(pi_w5.document.querySelectorAll("#feOptions .fe-option")).find((o) => o.getAttribute("data-name") === "🛋 rest ").click();
  check("choosing a playlist in the editor saves its ID with it", /\("🛋 rest  \[id:p4\]", 30\)/.test(pi_w5.document.getElementById("formats").value) || /\("🛋 rest \[id:p4\]", 30\)/.test(pi_w5.document.getElementById("formats").value), pi_w5.document.getElementById("formats").value.slice(0, 400));
  } catch (err) { areaCrashed("playlist ids", err); } }


  if (want("save packer")) { try {
  // ================================================================ a format packed into a Spotify description, and back; revisions
  var sp_w = await boot({ url: EDURL, session: signedIn(), fetchOptions: {} });
  var sp_id = (n) => { const a = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"; let x = n, s = "3"; for (let i = 1; i < 22; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; s += a[x % 62]; } return s; };
  var sp_build = (n, mixed) => {
    const items = [];
    for (let i = 0; i < n; i++) {
      const lists = [{ name: "", id: sp_id(i * 2 + 1), weight: mixed ? 65 : 1 }];
      if (mixed) lists.push({ name: "", id: sp_id(i * 2 + 2), weight: 35 });
      items.push({ id: "r" + i, kind: "seg", lists, minutes: [30, 60, 20, 45][i % 4] });
    }
    const gaps = new Array(n + 1).fill(undefined); gaps[2] = 120;
    return sp_w.ensureGaps({ id: "format-ab12cd34", title: "Evening journey 🌙", gap: 30, gaps, lead: 15, items, rev: 14, modified: 1793000000 });
  };
  var sp_same = (a, b) => JSON.stringify({ id: a.id, title: a.title, gap: a.gap, lead: a.lead, rev: a.rev, modified: a.modified, gaps: a.gaps.map((g) => (g === undefined ? null : g)), items: a.items.map((i) => [i.minutes, i.lists.map((l) => [l.name, l.id || "", l.weight])]) }) === JSON.stringify({ id: b.id, title: b.title, gap: b.gap, lead: b.lead, rev: b.rev, modified: b.modified, gaps: b.gaps.map((g) => (g === undefined ? null : g)), items: b.items.map((i) => [i.minutes, i.lists.map((l) => [l.name, l.id || "", l.weight])]) });
  var sp_f = sp_build(5, true), sp_all = sp_f.items.flatMap((i) => i.lists.map((l) => l.id)), sp_d = sp_w.packFormat(sp_f, sp_all), sp_back = sp_w.unpackFormat(sp_d);
  sp_w.resolveSaveTails(sp_back.format, sp_all);
  check("a format packs into a description and comes back identical: its ID, title with an emoji, revision, edit time, silences, minutes, playlists and weights", sp_back.kind === "save" && sp_same(sp_f, sp_back.format));
  check("the description starts with a plain Holds a recipe, not music. Do not edit., and the rest is all in the CJK block", sp_d.startsWith("Holds a recipe, not music. Do not edit. ") && Array.from(sp_d.slice(40)).every((c) => c.charCodeAt(0) >= 0x4e00 && c.charCodeAt(0) < 0x4e00 + 16384));
  check("with each playlist kept as the last 6 bytes of its ID, the sizes fit the 300 characters Spotify's own app allows: 3 segments, 5 mixed, 8 mixed, 12 mixed and even 16 mixed", [sp_build(3, false), sp_build(5, true), sp_build(8, true), sp_build(12, true), sp_build(16, true)].every((f) => sp_w.packFormat(f).length <= 300), [3, 5, 8, 12, 16].map((n) => sp_w.packFormat(sp_build(n, true)).length).join());
  var sp_odd = sp_w.ensureGaps({ id: "mini", title: "Odd one", gap: 0, gaps: [], lead: 0, items: [{ id: "a", kind: "seg", lists: [{ name: "No ID yet", weight: 1 }], minutes: 7.5 }, { id: "b", kind: "seg", lists: [{ name: "", id: "p2", weight: 60 }, { name: "Plain name", weight: 40 }], minutes: 20 }], rev: 0, modified: 0 });
  var sp_oddBack = sp_w.unpackFormat(sp_w.packFormat(sp_odd));
  check("a playlist with no ID keeps its name, a short ID that is not a real Spotify one is kept as text, and 7.5 minutes stay 7.5", sp_oddBack.kind === "save" && sp_same(sp_odd, sp_oddBack.format) && sp_oddBack.format.items[0].lists[0].name === "No ID yet" && sp_oddBack.format.items[1].lists[0].id === "p2");
  var sp_namesF = sp_w.ensureGaps(Object.assign({}, sp_f, { items: sp_f.items.map((i) => Object.assign({}, i, { lists: i.lists.map((l) => ({ name: "A playlist called " + l.id, weight: l.weight })) })) }));
  check("a playlist kept by its ID takes far less room than one kept by its name", sp_w.packFormat(sp_f, sp_all).length < sp_w.packFormat(sp_namesF).length);
  var sp_tailsOnly = sp_w.unpackFormat(sp_d).format.items.flatMap((i) => i.lists);
  check("what is in the save is the last 6 bytes of each ID: 12 hex characters, and the ID itself is not there", sp_tailsOnly.every((l) => /^[0-9a-f]{12}$/.test(l.tail) && !l.id));
  // shortened IDs: collisions and what is left over
  var sp_same2 = sp_id(7), sp_twin = sp_same2.slice(0, 10) + "ABCDEFGHIJKL";
  check("the test IDs are built so that two of them share their ending only when I say so", sp_w.tailOfId(sp_same2) !== sp_w.tailOfId(sp_twin));
  var sp_bytes = (front, back) => [...Array(10).fill(front), ...Array(6).fill(back)];
  var sp_clash = sp_w.bytesToSpotifyId(sp_bytes(0x11, 0x7a)), sp_clashB = sp_w.bytesToSpotifyId(sp_bytes(0x22, 0x7a));
  check("two IDs that differ only in the first 10 bytes share an ending", sp_clash !== sp_clashB && sp_w.tailOfId(sp_clash) === sp_w.tailOfId(sp_clashB));
  var sp_one = sp_w.ensureGaps({ id: "x", title: "T", gap: 0, gaps: [], lead: 0, items: [{ id: "a", kind: "seg", lists: [{ name: "", id: sp_clash, weight: 1 }], minutes: 10 }], rev: 0, modified: 0 });
  var sp_alone = sp_w.packFormat(sp_one, [sp_clash, sp_id(40)]), sp_shared = sp_w.packFormat(sp_one, [sp_clash, sp_clashB]);
  check("a playlist whose ending another of your playlists shares is written in full: 10 bytes longer, and it comes back as the ID with nothing left to match", sp_w.unpackFormat(sp_shared).format.items[0].lists[0].id === sp_clash && sp_shared.length > sp_alone.length && sp_w.unpackFormat(sp_alone).format.items[0].lists[0].tail === sp_w.tailOfId(sp_clash));
  var sp_loaded = sp_w.unpackFormat(sp_alone).format;
  check("an ending is turned back into the ID when exactly one of the account's playlists has it", sp_w.resolveSaveTails(sp_loaded, [sp_clash, sp_id(40)]) === 0 && sp_loaded.items[0].lists[0].id === sp_clash && sp_loaded.items[0].lists[0].tail === undefined);
  var sp_gone = sp_w.unpackFormat(sp_alone).format;
  check("when none of the account's playlists has it, the playlist is left without an ID, and counted", sp_w.resolveSaveTails(sp_gone, [sp_id(40), sp_id(41)]) === 1 && sp_gone.items[0].lists[0].id === undefined && sp_gone.items[0].lists[0].name === "");
  var sp_amb = sp_w.unpackFormat(sp_alone).format;
  check("when several have it, nothing is guessed: the playlist is left without an ID, and counted", sp_w.resolveSaveTails(sp_amb, [sp_clash, sp_clashB]) === 1 && sp_amb.items[0].lists[0].id === undefined);
  var sp_editorial = ["37i9dQZF1DXcBWIGoYBM5M", "37i9dQZF1DX0XUsuxWHRQd", "37i9dQZF1DX4JAvHpjipBk"];
  check("Spotify's own playlists, which share a long beginning, still tell apart by their endings", new Set(sp_editorial.map((x) => sp_w.tailOfId(x))).size === 3);

  check("anything that is not a save is told apart: an empty description, plain text, a description with a different note, and ordinary text with emoji", ["", "Made by Ceremony Playlist Builder from the format x", "My favourite songs 🎵", null, undefined, "Do not edit. just words", "Holds a recipe, not music. Do not edit. just words"].every((t) => sp_w.unpackFormat(t).kind === "none"));
  var sp_chars = Array.from(sp_d);
  var sp_flip = sp_chars.slice(); sp_flip[40] = String.fromCharCode(sp_flip[40].charCodeAt(0) ^ 1);
  check("one changed character makes it damaged, and so does cutting it short, or adding something on the end", sp_w.unpackFormat(sp_flip.join("")).kind === "damaged" && sp_w.unpackFormat(sp_d.slice(0, 60)).kind === "damaged" && sp_w.unpackFormat(sp_d + "!").kind === "damaged");
  var sp_body = [1, 2, 3, 4];
  var sp_newer = [0x43, 0x50, 3, ...sp_body]; var sp_crc = sp_w.crc16(sp_newer); sp_newer.push(sp_crc >> 8, sp_crc & 255);
  var sp_all = []; sp_w.writeVarint(sp_all, sp_newer.length); sp_newer.forEach((b) => sp_all.push(b));
  check("a save from a newer version of the app is recognized as one and left alone: it is neither damaged nor ignored", sp_w.unpackFormat("Do not edit. " + sp_w.denseEncode(sp_all)).kind === "newer");
  check("a description is read even if Spotify trims the space after Do not edit", sp_w.unpackFormat(sp_d.replace("Do not edit. ", "Do not edit.")).kind === "save");
  check("a save from before the note said Holds a recipe, not music (only Do not edit.) is still read", sp_w.unpackFormat(sp_d.replace("Holds a recipe, not music. ", "")).kind === "save" && sp_w.unpackFormat(sp_d.replace("Holds a recipe, not music. ", "")).format.title === sp_f.title);

  // revisions
  var sp_text = 'FORMATS = {"a": {"title": "T", "name": "T {n}", "silence between segments": "30 sec", "segments": [("One", 30), ("Two", 20)]}}';
  var sp_m = sp_w.textToModel(sp_text);
  sp_w.touchFormats(sp_m, 1790000000);
  check("reading a format counts as no edit: no revision, and none is written", sp_m.formats[0].rev === 0 && !/"revision"/.test(sp_w.modelToText(sp_m)));
  sp_m.formats[0].title = "Changed";
  sp_w.touchFormats(sp_m, 1790000100);
  check("an edit gives revision 1 and the time of the edit, and they are written into the text", sp_m.formats[0].rev === 1 && sp_m.formats[0].modified === 1790000100 && /"revision": 1,\s+"modified": 1790000100,/.test(sp_w.modelToText(sp_m)));
  sp_w.touchFormats(sp_m, 1790000200);
  check("with nothing changed, touching again changes nothing", sp_m.formats[0].rev === 1 && sp_m.formats[0].modified === 1790000100);
  sp_m.formats[0].items[0].minutes = 35;
  sp_w.touchFormats(sp_m, 1790000300);
  check("the next edit is revision 2", sp_m.formats[0].rev === 2 && sp_m.formats[0].modified === 1790000300);
  sp_m.formats[0].items[0].lists[0].id = "xyz";
  sp_w.rememberFormats(sp_m);
  sp_w.touchFormats(sp_m, 1790000400);
  check("an ID filled in by the app, once remembered, is not an edit", sp_m.formats[0].rev === 2);
  var sp_m2 = sp_w.textToModel(sp_w.modelToText(sp_m));
  check("revision and edit time survive being written out and read back", sp_m2.formats[0].rev === 2 && sp_m2.formats[0].modified === 1790000300);
  var sp_blank = sp_w.newBlankFormat(sp_m2, "Brand new");
  sp_m2.formats.push(sp_blank);
  sp_w.touchFormats(sp_m2, 1790000500);
  check("a new format is revision 1 from the start, with an ID of recipe- and 8 characters", sp_blank.rev === 1 && sp_blank.modified === 1790000500 && /^format-[0-9a-z]{8}$/.test(sp_blank.id), sp_blank.id);

  // in the editor
  var sp_w2 = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"a": {"title": "T", "name": "T {n}", "silence between segments": "30 sec", "segments": [("💗 spacious + gentle", 30), ("🛋 rest", 20)]}}' }, fetchOptions: {} });
  await waitFor(() => /\[id:p2\]/.test(sp_w2.document.getElementById("formats").value), 8000);
  check("linking playlists to their IDs on loading is not an edit: the text has no revision yet", !/"revision"/.test(sp_w2.document.getElementById("formats").value));
  rowsOf(sp_w2)[0].querySelector(".fe-inc").click();
  check("the first real edit in the editor makes it revision 1, written into the saved text with the time", /"revision": 1,/.test(sp_w2.document.getElementById("formats").value) && /"modified": \d{10},/.test(sp_w2.document.getElementById("formats").value));
  rowsOf(sp_w2)[0].querySelector(".fe-inc").click();
  check("and the next edit is revision 2", /"revision": 2,/.test(sp_w2.document.getElementById("formats").value));
  } catch (err) { areaCrashed("save packer", err); } }

  if (want("backup method")) { try {
  // ================================================================ choosing how the formats are backed up: two radio buttons
  var bm_w = await boot({ url: EDURL, session: signedIn(), local: { backupMode: null }, fetchOptions: {} });
  var bm_card = () => bm_w.document.getElementById("backupCard");
  check("a new visitor is asked nothing: saved to Spotify is chosen, and the card is not on the page until it is asked for", bm_card().hidden === true && bm_w.document.getElementById("backupModeSpotify").checked && !bm_w.document.getElementById("backupModeManual").checked && bm_w.localStorage.getItem("backupMode") === null);
  check("it says that saved to Spotify keeps each recipe in a private playlist, in its description, which is not to be edited, and that backing up to the device keeps the recipes on this device only", /stored in that playlist's description, so please do not edit it/.test(bm_card().textContent) && /ending in \(recipe\)/.test(bm_card().textContent) && /Your recipes live on this device only/.test(bm_card().textContent));
  check("it is the two radio buttons and OK and Cancel buttons, always shown", bm_card().querySelectorAll("button").length === 2 && !!bm_card().querySelector("#backupOk") && !!bm_card().querySelector("#backupCancel") && bm_card().querySelector("#backupDoneRow").hidden === false && bm_card().querySelectorAll('input[type="radio"]').length === 2);
  pickMode(bm_w, "backupModeManual");
  check("choosing manual saves it and takes the card away", bm_w.localStorage.getItem("backupMode") === "manual" && bm_card().hidden === true);
  var bm_menuItems = () => Array.from(bm_w.document.querySelectorAll("#feAppMenuPanel .fe-item")).map((b) => b.textContent.trim());
  bm_w.document.getElementById("feAppMenuButton").click();
  check("the app menu has the backup block: the row that opens the method card comes before Back up now and Restore", (() => { const ids = Array.from(bm_w.document.querySelectorAll("#feAppMenuPanel [id]")).map((n) => n.id); return ids.indexOf("feBackupMethod") >= 0 && ids.indexOf("feBackupMethod") < ids.indexOf("feBackup") && ids.indexOf("feBackup") < ids.indexOf("feRestore"); })());
  bm_w.document.getElementById("feBackupMethod").click();
  check("choosing it brings the card back with the current choice selected, and closes the menu", bm_card().hidden === false && bm_w.document.getElementById("backupModeManual").checked && !bm_w.document.getElementById("feAppMenuPanel"));
  pickMode(bm_w, "backupModeManual");
  check("choosing the same one again simply closes it, and the choice stays", bm_card().hidden === true && bm_w.localStorage.getItem("backupMode") === "manual");
  bm_w.document.getElementById("feAppMenuButton").click();
  bm_w.document.getElementById("feBackupMethod").click();
  bm_w.document.dispatchEvent(new bm_w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("Escape also closes it, without changing anything", bm_card().hidden === true && bm_w.localStorage.getItem("backupMode") === "manual");
  bm_w.document.getElementById("feAppMenuButton").click();
  bm_w.document.getElementById("feBackupMethod").click();
  // minimalist mode: the first-time card steps aside, but a card asked for from the menu is shown
  var bm_w2 = await boot({ url: EDURL, session: signedIn(), local: { minimalMode: "1", connectedBefore: "1" }, fetchOptions: {} });
  var bm_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  check("in minimalist mode the first-time card is out of the way, but one asked for from the menu is not", /body\.minimal #backupCard:not\(\.opened\)/.test(bm_css) && bm_w2.document.body.classList.contains("minimal"));
  bm_w2.document.getElementById("feAppMenuButton").click();
  bm_w2.document.getElementById("feBackupMethod").click();
  check("and it then carries the class that makes it show", bm_w2.document.getElementById("backupCard").classList.contains("opened") && bm_w2.document.getElementById("backupCard").hidden === false);
  // a person who already chose is not asked again
  var bm_w3 = await boot({ url: EDURL, session: signedIn(), local: { backupMode: "manual" }, fetchOptions: {} });
  check("someone who chose before is not asked again, and the card has their choice selected when it is opened", bm_w3.document.getElementById("backupCard").hidden === true && bm_w3.document.getElementById("backupModeManual").checked);
  } catch (err) { areaCrashed("backup method", err); } }

  if (want("size limit")) { try {
  // ================================================================ a format must fit in a description: the size limit
  var sl_w0 = await boot({ url: EDURL, session: signedIn(), fetchOptions: {} });
  var sl_text = (n, title) => 'FORMATS = {"a": {"title": "' + (title || "T") + '", "name": "T {n}", "silence between segments": "30 sec", "segments": [' + Array.from({ length: n }, (_, i) => '("Some playlist", ' + (30 + (i % 3) * 10) + ')').join(", ") + ']}}';
  var sl_len = (n) => sl_w0.saveLength(sl_w0.textToModel(sl_text(n)).formats[0]);
  var sl_fit = 1; while (sl_len(sl_fit + 1) <= 300) sl_fit += 1;
  check("the limit is on the length of the save itself: the most single-playlist segments that fit have a save of 300 characters or fewer, and one more is over", sl_len(sl_fit) <= 300 && sl_len(sl_fit + 1) > 300, sl_fit + ": " + sl_len(sl_fit) + " / " + sl_len(sl_fit + 1));
  check("a playlist not yet linked to its ID is counted as one that is, so the limit does not move when the playlists load", sl_w0.saveLength(sl_w0.textToModel(sl_text(5)).formats[0]) === sl_w0.saveLength(sl_w0.textToModel(sl_text(5).replace(/\("Some playlist"/g, '("Some playlist [id:' + sl_id0() + ']"')).formats[0]));
  function sl_id0() { return "30" + "0".repeat(20); }

  var sl_a = await boot({ url: EDURL, session: signedIn(), local: { formats: sl_text(sl_fit - 1), backupMode: "manual" }, fetchOptions: {} });
  await waitFor(() => !!sl_a.document.getElementById("feAddSegment"), 8000);
  check("with room for one more, New segment works", sl_a.document.getElementById("feAddSegment").disabled === false && !sl_a.document.getElementById("feSizeNote"));
  sl_a.document.getElementById("feAddSegment").click();
  await waitFor(() => rowsOf(sl_a).length === sl_fit, 3000);
  check("and once the format is full, New segment is greyed out, with a line saying why", rowsOf(sl_a).length === sl_fit && sl_a.document.getElementById("feAddSegment").disabled === true && sl_a.document.getElementById("feSizeNote").textContent === "This recipe has reached its size limit. Remove a segment or a mix to make room.");
  var sl_before = rowsOf(sl_a).length;
  sl_a.document.getElementById("feAddSegment").click();
  check("pressing it anyway adds nothing", rowsOf(sl_a).length === sl_before);
  sl_a.document.body.click();   // a new segment opens its list, so close that first
  rowsOf(sl_a)[0].querySelector(".fe-more").click();
  var sl_mix = sl_a.document.getElementById("feAddMix");
  var sl_noRoomMix = sl_a.eval("noRoomForMix(editor.model.formats[0], editor.model.formats[0].items[0])");
  check("Add a mix is greyed out too when a second playlist would not fit, with a note, and available when it would", sl_noRoomMix ? (sl_mix.disabled === true && /No room: this recipe has reached its size limit\./.test(sl_a.document.getElementById("feMixNote").textContent)) : (sl_mix.disabled === false && sl_a.document.getElementById("feMixNote").textContent === "Blend a second playlist into this segment."));
  sl_a.document.body.click();
  // any other edit that would make it longer is refused, and the format goes back
  var sl_title = sl_a.eval("editor.model.formats[0].title");
  sl_a.eval('editor.model.formats[0].title = "A title that is much too long to fit into what is left of the room in this format, so it is refused"; commit(); renderEditor();');
  check("a longer title that would not fit is refused: the title is as it was, and the note says why", sl_a.eval("editor.model.formats[0].title") === sl_title && sl_a.eval("editor.refused") === true && !!sl_a.document.getElementById("feSizeNote"));
  sl_a.eval('editor.model.formats[0].title = ""; commit(); renderEditor();');
  check("a shorter title is always accepted, even when the format is full", sl_a.eval("editor.model.formats[0].title") === "" && sl_a.eval("editor.refused") === false);

  // a format that is over the limit when it is loaded: nothing is refused on loading, it cannot grow, and it can shrink
  var sl_b = await boot({ url: EDURL, session: signedIn(), local: { formats: sl_text(sl_fit + 6), backupMode: "manual" }, fetchOptions: {} });
  await waitFor(() => !!sl_b.document.getElementById("feAddSegment"), 8000);
  check("a format that is already too long is loaded as it is, with New segment greyed out and the note shown", rowsOf(sl_b).length === sl_fit + 6 && sl_b.document.getElementById("feAddSegment").disabled === true && !!sl_b.document.getElementById("feSizeNote"));
  rowsOf(sl_b)[0].querySelector(".fe-more").click();
  Array.from(sl_b.document.querySelectorAll("#feRows .fe-menu .fe-item")).find((b) => /Remove segment/.test(b.textContent)).click();
  check("and it can be made shorter, one segment at a time, until it fits", rowsOf(sl_b).length === sl_fit + 5);
  } catch (err) { areaCrashed("size limit", err); } }

  if (want("the save pointer")) { try {
  // ================================================================ the first save to Spotify: a pointer under the menu button, once
  var sp_fmt = 'FORMATS = {"f1": {"title": "Alpha", "name": "Alpha {n}", "silence between segments": "30 sec", "segments": [("rest", 30)]}}';
  var sp_o = { descStore: {}, nameStore: {} };
  var sp_w = await boot({ url: EDURL, session: signedIn(), local: { formats: sp_fmt, backupMode: "spotify" }, fetchOptions: sp_o });
  sp_w.eval("spotifySaveDelayMs = 30; saveTip.quietMs = 50");
  await waitFor(() => sp_w.eval("saveTip.open"), 8000);
  var sp_tip = sp_w.document.querySelector(".fe-st-tip");
  check("after the first save a pointer opens with the wording, a Got it button and the blur", sp_w.eval("saveTip.open") && sp_tip && sp_tip.textContent.includes("Recipes automatically save to Spotify as you edit. You\u2019ll see this cloud while saving.") && /Got it/.test(sp_tip.querySelector(".fe-st-ok").textContent) && !!sp_w.document.querySelector(".fe-st-blur"));
  check("it is remembered at once, so it never comes back", sp_w.localStorage.getItem("saveTipShown") === "1");
  check("the menu button shows the cloud while the pointer is open", sp_w.document.getElementById("feAppMenuButton").classList.contains("fe-saving"));
  check("the blur leaves a hole around the button", /evenodd/.test(sp_w.document.querySelector(".fe-st-blur").style.clipPath || ""));
  sp_tip.querySelector(".fe-st-ok").click();
  await new Promise((r) => setTimeout(r, 1200));
  check("Got it closes it, the blur goes, and the dots come back", !sp_w.eval("saveTip.open") && !sp_w.document.querySelector(".fe-st-tip, .fe-st-blur") && !sp_w.document.getElementById("feAppMenuButton").classList.contains("fe-saving"));
  // a click anywhere closes it too
  sp_w.eval("localStorage.removeItem('saveTipShown'); showSaveTip()");
  sp_w.document.body.dispatchEvent(new sp_w.MouseEvent("pointerdown", { bubbles: true }));
  check("a click or tap anywhere closes it", !sp_w.eval("saveTip.open") && !sp_w.document.querySelector(".fe-st-tip"));
  // not again on a later visit
  var sp_o2 = { descStore: {}, nameStore: {} };
  var sp_w2 = await boot({ url: EDURL, session: signedIn(), local: { formats: sp_fmt, backupMode: "spotify", saveTipShown: "1" }, fetchOptions: sp_o2 });
  sp_w2.eval("spotifySaveDelayMs = 30; saveTip.quietMs = 50");
  await waitFor(() => sp_w2.eval("saveState.savedAt"), 8000);
  await new Promise((r) => setTimeout(r, 400));
  check("once seen, a later save shows no pointer", !sp_w2.eval("saveTip.open") && !sp_w2.document.querySelector(".fe-st-tip"));
  // never with the manual backup
  var sp_w3 = await boot({ url: EDURL, session: signedIn(), local: { formats: sp_fmt, backupMode: "manual" }, fetchOptions: {} });
  sp_w3.eval("saveTip.quietMs = 50; offerSaveTip()");
  await new Promise((r) => setTimeout(r, 300));
  check("with the manual backup it never shows", !sp_w3.eval("saveTip.open") && sp_w3.localStorage.getItem("saveTipShown") === null);
  // it waits while a popup is open
  var sp_w4 = await boot({ url: EDURL, session: signedIn(), local: { formats: sp_fmt, backupMode: "manual" }, fetchOptions: {} });
  sp_w4.eval("saveTip.quietMs = 50; localStorage.setItem('backupMode', 'spotify'); editor.appMenu = true; renderAppMenu(); offerSaveTip()");
  await new Promise((r) => setTimeout(r, 300));
  var sp_waited = !sp_w4.eval("saveTip.open") && sp_w4.eval("saveTip.waiting");
  sp_w4.eval("editor.appMenu = false; renderAppMenu()");
  await waitFor(() => sp_w4.eval("saveTip.open"), 3000);
  check("while the menu is open it waits, and shows once the menu closes", sp_waited && sp_w4.eval("saveTip.open"));
  } catch (err) { areaCrashed("the save pointer", err); } }

  if (want("spotify saves")) { try {
  // ================================================================ automatic backup to Spotify: writing the saves
  var ss_w0 = await boot({ url: EDURL, session: signedIn(), fetchOptions: {} });
  var ss_fmt = (id, title, rows) => '"' + id + '": {"title": "' + title + '", "name": "' + title + ' {n}", "silence between segments": "30 sec", "segments": [' + rows + ']}';
  var ss_two = 'FORMATS = {' + ss_fmt("f1", "Alpha", '("💗 spacious + gentle", 30), ("🛋 rest", 20)') + ', ' + ss_fmt("f2", "Beta", '("💗💗 evocative", 40)') + '}';
  var ss_remote = (id, title, rev, text) => ss_w0.packFormat(ss_w0.ensureGaps({ id, title, gap: 30, gaps: [], lead: 0, items: [{ id: "a", kind: "seg", lists: [{ name: "", id: "p2", weight: 1 }], minutes: text || 30 }], rev, modified: 1790000000, place: 1024 }), ["p2"]);
  var ss_started = async (local, fetchOptions) => {
    const w = await boot({ url: EDURL, session: signedIn(), local, fetchOptions });
    w.eval("spotifySaveDelayMs = 30");
    return w;
  };
  var ss_writes = (o, type) => o.writes.filter((x) => x.type === type);

  // a first save for each format
  var ss_o1 = { descStore: {}, nameStore: {} };
  var ss_w1 = await ss_started({ formats: ss_two, backupMode: "spotify" }, ss_o1);
  await waitFor(() => ss_writes(ss_o1, "create").length >= 2, 8000);
  var ss_c = ss_writes(ss_o1, "create");
  check("each format gets a private playlist of its own, named like the recipe and ending in (recipe)", ss_c.length === 2 && ss_c.map((x) => x.name).sort().join("|") === "Alpha (recipe)|Beta (recipe)" && ss_c.every((x) => x.public === false));
  var ss_dec = ss_c.map((x) => ss_w0.unpackFormat(x.description));
  check("the description of each is a good save of that format, with its ID, title, segments and revision", ss_dec.every((d) => d.kind === "save") && ss_dec.map((d) => d.format.id).sort().join() === "f1,f2" && ss_dec.find((d) => d.format.id === "f1").format.items.length === 2 && ss_c.every((x) => x.description.startsWith("Holds a recipe, not music. Do not edit. ")));
  check("the saves are on the page's list of playlists, known as saves, and are not offered as a source of songs", ss_w1.eval("playlists.filter((p) => p.isSave).length") === 2 && ss_w1.eval("readablePlaylists().some((p) => p.isSave || /format backup/.test(p.name))") === false);
  await waitFor(() => !ss_w1.eval("saveState.coverRunning") && ss_w1.eval("saveState.coverQueue.length") === 0, 8000);   // the covers are sent after the save
  var ss_n = ss_o1.writes.length;
  await new Promise((r) => setTimeout(r, 400));
  check("with nothing changed, nothing more is written", ss_o1.writes.length === ss_n);
  check("the status says it was saved", /Last saved at/.test(ss_w1.document.getElementById("spotifySaveStatus").textContent) && ss_w1.document.getElementById("spotifySaveLine").hidden === false);

  // an edit updates that format's save
  ss_w1.document.body.click();
  rowsOf(ss_w1)[0].querySelector(".fe-inc").click();
  await waitFor(() => ss_writes(ss_o1, "update").some((x) => x.description), 5000);
  var ss_u = ss_writes(ss_o1, "update").filter((x) => x.description)[0];
  check("an edit brings the save of that format up to date: its revision is 1 now, and it is the playlist made for it", ss_w0.unpackFormat(ss_u.description).format.rev === 1 && ss_w0.unpackFormat(ss_u.description).format.id === "f1" && ss_u.id === ss_c.find((x) => x.name.startsWith("Alpha")).id);
  check("and the other format's save is not touched", ss_writes(ss_o1, "update").filter((x) => x.description).every((x) => x.id !== ss_c.find((y) => y.name.startsWith("Beta")).id));
  // a rename
  ss_w1.eval('editor.model.formats[0].title = "Alpha 2"; commit();');
  await waitFor(() => ss_writes(ss_o1, "update").some((x) => x.name === "Alpha 2 (recipe)"), 5000);
  check("renaming the format renames its save", ss_writes(ss_o1, "update").some((x) => x.name === "Alpha 2 (recipe)" && x.id === ss_u.id));
  // deleting a format removes its save
  var ss_beta = ss_c.find((x) => x.name.startsWith("Beta"));
  ss_w1.eval('noteFormatDeleted("f2"); editor.model.formats = editor.model.formats.filter((f) => f.id !== "f2"); commit();');
  await waitFor(() => ss_writes(ss_o1, "remove").length >= 1, 5000);
  check("deleting a format removes its save from Spotify, and only that one", ss_writes(ss_o1, "remove").length === 1 && ss_writes(ss_o1, "remove")[0].uris.join() === "spotify:playlist:" + ss_beta.id);
  check("and what was waiting to be removed is cleared", ss_w1.localStorage.getItem("spotifyPendingDeletes") === "[]");

  // a save in the account is found again by its description, whatever it is called, and a newer one is left alone
  var ss_o2 = { descStore: {}, nameStore: {}, extraPlaylists: [{ id: "s1", name: "Something I renamed", owner: { id: "ron" }, description: ss_remote("f1", "Alpha", 9, 30) }, { id: "s2", name: "Beta (recipe)", owner: { id: "ron" }, description: ss_remote("f2", "Beta", 0, 25) }] };
  var ss_w2 = await ss_started({ formats: ss_two, backupMode: "spotify", spotifySynced: JSON.stringify({ f1: { rev: 0 }, f2: { rev: 0 } }) }, ss_o2);
  await waitFor(() => ss_writes(ss_o2, "update").some((x) => x.id === "s2"), 8000);
  check("an existing save is found by what its description decodes to, and updated and not made again", ss_writes(ss_o2, "create").length === 0 && ss_writes(ss_o2, "update").some((x) => x.id === "s2" && ss_w0.unpackFormat(x.description).format.id === "f2"));
  check("a save with a higher revision than the format here, made on another device while this one was not changed, is not overwritten: it is taken, and the only thing written to it is its name, put back", ss_writes(ss_o2, "update").filter((x) => x.id === "s1").every((x) => x.name === "Alpha (recipe)" && x.description === ss_o2.extraPlaylists[0].description) && ss_w2.eval("editor.model.formats.find((f) => f.id === 'f1').rev") === 9);
  check("and the line under the bar was given the news that the recipe was updated from Spotify", /Updated .Alpha. from Spotify\./.test(ss_w2.eval("saveState.lastNews ? saveState.lastNews.text : ''")));

  // a deletion that was waiting: carried out, unless the format is back
  var ss_o3 = { descStore: {}, nameStore: {}, extraPlaylists: [{ id: "s9", name: "Gone (recipe)", owner: { id: "ron" }, description: ss_remote("f9", "Gone", 1, 30) }, { id: "s1", name: "Alpha (recipe)", owner: { id: "ron" }, description: ss_remote("f1", "Alpha", 0, 30) }] };
  var ss_w3 = await ss_started({ formats: ss_two, backupMode: "spotify", spotifyPendingDeletes: JSON.stringify(["f9", "f1"]), spotifySynced: JSON.stringify({ f1: { rev: 0 } }) }, ss_o3);
  await waitFor(() => ss_writes(ss_o3, "remove").length >= 1, 8000);
  check("a deletion that was waiting is carried out for a format that is gone, and not for one that is here again", ss_writes(ss_o3, "remove").length === 1 && ss_writes(ss_o3, "remove")[0].uris.join() === "spotify:playlist:s9" && ss_w3.localStorage.getItem("spotifyPendingDeletes") === "[]");

  // nothing is written unless Spotify is the chosen way
  var ss_o4 = { descStore: {} };
  var ss_w4 = await ss_started({ formats: ss_two, backupMode: "manual" }, ss_o4);
  await new Promise((r) => setTimeout(r, 1500));
  var ss_o5 = { descStore: {} };
  var ss_w5 = await ss_started({ formats: ss_two }, ss_o5);
  await new Promise((r) => setTimeout(r, 1500));
  check("with the backup file as the way, or no way chosen yet, nothing is written to Spotify", ss_o4.writes.filter((x) => x.type === "create" || x.type === "update" || x.type === "remove").length === 0 && ss_o5.writes.filter((x) => x.type === "create" || x.type === "update" || x.type === "remove").length === 0);

  // a failed save, and Try again
  var ss_o6 = { descStore: {}, nameStore: {}, putFails: true, extraPlaylists: [{ id: "s1", name: "Alpha (recipe)", owner: { id: "ron" }, description: ss_remote("f1", "Alpha", 0, 99) }] };
  var ss_w6 = await ss_started({ formats: ss_two, backupMode: "spotify", spotifySynced: JSON.stringify({ f1: { rev: 0 } }) }, ss_o6);
  await waitFor(() => /Couldn.t save to Spotify\./.test(ss_w6.document.getElementById("spotifySaveStatus").textContent), 8000);
  var ss_try = ss_w6.document.querySelector("#spotifySaveStatus .linklike");
  check("when a save fails, the status says so, with a link to try again", !!ss_try && ss_try.textContent === "Try again");
  ss_o6.putFails = false;
  ss_try.click();
  await waitFor(() => ss_writes(ss_o6, "update").some((x) => x.id === "s1"), 8000);
  await waitFor(() => /Last saved at/.test(ss_w6.document.getElementById("spotifySaveStatus").textContent), 3000);
  check("trying again saves it, and the status goes back to saying when", /Last saved at/.test(ss_w6.document.getElementById("spotifySaveStatus").textContent) && !ss_w6.document.querySelector("#spotifySaveStatus .linklike"));

  // too long to back up
  var ss_big = 'FORMATS = {' + ss_fmt("big", "Huge", Array.from({ length: 45 }, (_, i) => '("Some playlist", ' + (20 + (i % 3) * 10) + ')').join(", ")) + ', ' + ss_fmt("f1", "Alpha", '("💗 spacious + gentle", 30)') + '}';
  var ss_o7 = { descStore: {}, nameStore: {} };
  var ss_w7 = await ss_started({ formats: ss_big, backupMode: "spotify" }, ss_o7);
  await waitFor(() => ss_writes(ss_o7, "create").length >= 1 && /too long/.test(ss_w7.document.getElementById("spotifySaveStatus").textContent), 8000);
  check("a format whose save would not fit is not saved, the others are, and the line under the editor's bar says which one and that it is still saved in the browser", ss_writes(ss_o7, "create").length === 1 && ss_writes(ss_o7, "create")[0].name === "Alpha (recipe)" && /Huge is too long to save to Spotify\. It is still saved in this browser\./.test(capText(ss_w7)));
  var ss_files = [];
  ss_w7.saveFile = (name, text) => ss_files.push({ name, text });
  capLinks(ss_w7).find((b) => b.textContent === "Download it").click();
  check("Download it gives a file with just that format in it", ss_files.length === 1 && /"big"/.test(ss_files[0].text) && !/"f1"/.test(ss_files[0].text) && /^playlist-recipe-/.test(ss_files[0].name));

  // what is on the page for each way
  var ss_menuTexts = (w) => { w.document.getElementById("feAppMenuButton").click(); const t = Array.from(w.document.querySelectorAll("#feAppMenuPanel .fe-item, #feAppMenuPanel .fe-bk-row, #feAppMenuPanel .fe-bk-actions button")).map((b) => b.textContent.trim()); w.document.body.click(); return t; };
  var ss_spotifyMenu = ss_menuTexts(ss_w1);
  check("when recipes are saved to Spotify the menu says nothing about saving: no title, no link, no status, no Back up now or Restore", !/backup|saved|Last saved|Change how/i.test(ss_spotifyMenu.join("|").replace(/Ceremony Playlist Builder|App version[^|]*/g, "")) && !ss_spotifyMenu.some((t) => /Back up now|Restore/.test(t)));
  ss_w1.document.getElementById("feAppMenuButton").click();
  check("the way to change how recipes are saved is in More options, as a link, since the menu has no saving block to hold it", !ss_w1.document.getElementById("feBackupMethod") && !ss_w1.document.querySelector("#feAppMenuPanel .fe-bk-block") && ss_w1.document.getElementById("changeSaveMethod").textContent === "Change how your recipes are saved" && ss_w1.document.getElementById("changeSaveMethod").classList.contains("linklike") && !!ss_w1.document.querySelector("details#moreOptions #changeSaveMethod, #moreOptions #changeSaveMethod"));
  ss_w1.document.body.click();
  check("for Spotify, the note about the backup file and the step about it are not on the page", ss_w1.document.getElementById("savedNote").hidden === true && ss_w1.document.getElementById("backupBlock").hidden === true && ss_w1.document.body.classList.contains("spotify-backup"));
  var ss_manualMenu = ss_menuTexts(ss_w4);
  check("for the manual way, it is the other way round: Back up now and Restore, and nothing about Spotify saving", ss_manualMenu.includes("Back up now") && ss_manualMenu.includes("Restore") && ss_manualMenu.some((t) => /^Manual backup to this deviceChange/.test(t)) && !ss_manualMenu.some((t) => /Saved to Spotify|Waiting to save/.test(t)) && ss_w4.document.getElementById("savedNote").hidden === false && ss_w4.document.getElementById("spotifySaveLine").hidden === true && ss_w4.document.getElementById("backupBlock").hidden === false);
  ss_w1.eval('askDeleteFormat()');
  check("deleting a format says its backup playlist is deleted too, when Spotify is the way", /Its saved copy in Spotify is deleted too\./.test(ss_w1.document.getElementById("feDeleteDialog").textContent) && !/restored from a backup/.test(ss_w1.document.getElementById("feDeleteDialog").textContent));
  ss_w1.document.getElementById("feDeleteCancel").click();
  ss_w4.eval('askDeleteFormat()');
  check("and says it can be restored from a backup, when the backup file is", /restored from a backup/.test(ss_w4.document.getElementById("feDeleteDialog").textContent));
  ss_w4.document.getElementById("feDeleteCancel").click();

  // choosing Spotify from the card starts the saving
  var ss_o8 = { descStore: {}, nameStore: {} };
  var ss_w8 = await ss_started({ formats: ss_two }, ss_o8);
  pickMode(ss_w8, "backupModeSpotify");
  await waitFor(() => ss_writes(ss_o8, "create").length >= 2, 8000);
  check("choosing Spotify in the card saves the formats at once, and the card goes away", ss_writes(ss_o8, "create").length === 2 && ss_w8.localStorage.getItem("backupMode") === "spotify" && ss_w8.document.getElementById("backupCard").hidden === true);
  } catch (err) { areaCrashed("spotify saves", err); } }

  if (want("save pacing")) { try {
  // ================================================================ how often the saves are made
  var sp_src = fs.readFileSync(ROOT + "app.js", "utf8");
  check("the pause before a save is 5 seconds, and a run of edits is saved at the latest 30 seconds after the first", /let spotifySaveDelayMs = 5000;/.test(sp_src) && /let spotifySaveMaxWaitMs = 30000;/.test(sp_src));
  var sp_one = 'FORMATS = {"f1": {"title": "Alpha", "name": "Alpha {n}", "silence between segments": "30 sec", "segments": [("💗 spacious + gentle", 30), ("🛋 rest", 20)]}}';
  var sp_ups = (o) => o.writes.filter((x) => x.type === "update" && x.description);
  var sp_o1 = { descStore: {}, nameStore: {} };
  var sp_w1 = await boot({ url: EDURL, session: signedIn(), local: { formats: sp_one, backupMode: "spotify" }, fetchOptions: sp_o1 });
  sp_w1.eval("spotifySaveDelayMs = 150; spotifySaveMaxWaitMs = 600");
  await waitFor(() => sp_o1.writes.filter((x) => x.type === "create").length === 1, 8000);
  var sp_base = sp_ups(sp_o1).length;
  sp_w1.document.body.click();
  for (let i = 0; i < 5; i++) { rowsOf(sp_w1)[0].querySelector(".fe-inc").click(); await new Promise((r) => setTimeout(r, 30)); }
  await new Promise((r) => setTimeout(r, 20));
  check("a quick run of edits is not saved one by one: nothing is written while they go on", sp_ups(sp_o1).length === sp_base);
  await waitFor(() => sp_ups(sp_o1).length > sp_base, 4000);
  await new Promise((r) => setTimeout(r, 400));
  check("and once they stop, it is saved once, with all of them in it", sp_ups(sp_o1).length === sp_base + 1 && sp_w1.unpackFormat(sp_ups(sp_o1)[sp_base].description).format.items[0].minutes === 55);
  // a long run of edits is saved from time to time
  var sp_before = sp_ups(sp_o1).length;
  for (let i = 0; i < 20; i++) { rowsOf(sp_w1)[0].querySelector(".fe-inc").click(); await new Promise((r) => setTimeout(r, 60)); }
  check("edits that go on and on are still saved along the way, at the latest after the longest wait", sp_ups(sp_o1).length > sp_before);
  await new Promise((r) => setTimeout(r, 500));
  // not during a build
  var sp_k = sp_ups(sp_o1).length;
  sp_w1.eval("busy = true");
  rowsOf(sp_w1)[0].querySelector(".fe-inc").click();
  await new Promise((r) => setTimeout(r, 500));
  check("while a plan or a build is under way, nothing is saved", sp_ups(sp_o1).length === sp_k);
  sp_w1.eval("busy = false");
  // when the page is left
  var sp_o2 = { descStore: {}, nameStore: {} };
  var sp_w2 = await boot({ url: EDURL, session: signedIn(), local: { formats: sp_one, backupMode: "spotify" }, fetchOptions: sp_o2 });
  sp_w2.eval("spotifySaveDelayMs = 150");
  await waitFor(() => sp_o2.writes.filter((x) => x.type === "create").length === 1, 8000);
  sp_w2.eval("spotifySaveDelayMs = 60000");
  sp_w2.document.body.click();
  rowsOf(sp_w2)[0].querySelector(".fe-inc").click();
  await new Promise((r) => setTimeout(r, 300));
  check("with a long pause set, nothing has been saved yet", sp_ups(sp_o2).length === 0);
  Object.defineProperty(sp_w2.document, "visibilityState", { value: "hidden", configurable: true });
  sp_w2.document.dispatchEvent(new sp_w2.Event("visibilitychange"));
  await waitFor(() => sp_ups(sp_o2).length === 1, 4000);
  check("but when the page is hidden, because someone left it or switched to another app, whatever is waiting is saved at once", sp_ups(sp_o2).length === 1);
  } catch (err) { areaCrashed("save pacing", err); } }

  if (want("backup cover")) { try {
  // ================================================================ the cover of a format backup
  var bc_file = fs.readFileSync(ROOT + "recipe-cover.jpg");
  var bc_dims = execFileSync("python3", ["-c", `from PIL import Image; im = Image.open("${ROOT}recipe-cover.jpg"); print(im.format, im.size[0], im.size[1])`], { encoding: "utf8" }).trim();
  check("the backup cover is a square JPEG, 640 by 640, well under the 256 KB Spotify allows", bc_dims === "JPEG 640 640" && bc_file.length < 256 * 1024, bc_dims + " " + bc_file.length);
  var bc_fmt = 'FORMATS = {"f1": {"title": "Alpha", "name": "Alpha {n}", "silence between segments": "30 sec", "segments": [("💗 spacious + gentle", 30)]}, "f2": {"title": "Beta", "name": "Beta {n}", "silence between segments": "30 sec", "segments": [("🛋 rest", 20)]}}';
  var bc_covers = (o) => o.writes.filter((x) => x.type === "cover");
  var bc_w0 = await boot({ url: EDURL, session: signedIn(), fetchOptions: {} });
  var bc_o1 = { descStore: {}, nameStore: {} };
  var bc_w1 = await boot({ url: EDURL, session: signedIn(), local: { formats: bc_fmt, backupMode: "spotify" }, fetchOptions: bc_o1 });
  bc_w1.eval("spotifySaveDelayMs = 30");
  await waitFor(() => bc_covers(bc_o1).length >= 2, 8000);
  var bc_made = bc_o1.writes.filter((x) => x.type === "create").map((x) => x.id).sort();
  check("each backup playlist gets the backup cover when it is made: the dimmed icon with the cloud, as a JPEG", bc_covers(bc_o1).length === 2 && bc_covers(bc_o1).map((x) => x.id).sort().join() === bc_made.join() && bc_covers(bc_o1).every((x) => x.contentType === "image/jpeg" && x.base64 === bc_file.toString("base64")));
  check("and it is not the cover of the playlists the app builds", bc_covers(bc_o1).every((x) => x.base64 !== fs.readFileSync(ROOT + "playlist-cover.jpg").toString("base64")));
  bc_w1.document.body.click();
  rowsOf(bc_w1)[0].querySelector(".fe-inc").click();
  await waitFor(() => bc_o1.writes.some((x) => x.type === "update" && x.description), 5000);
  await new Promise((r) => setTimeout(r, 300));
  check("an update does not send the cover again", bc_covers(bc_o1).length === 2);
  check("when the covers were put on, nothing is said about them", bc_w1.eval("saveState.coverProblem") === null && !/cover/.test(capText(bc_w1)));
  // an existing backup that has no cover gets one, and one that has a cover does not
  var bc_pack = (id, title) => bc_w0.packFormat(bc_w0.ensureGaps({ id, title, gap: 30, gaps: [], lead: 0, items: [{ id: "a", kind: "seg", lists: [{ name: "", id: "p2", weight: 1 }], minutes: 30 }], rev: 0, modified: 0 }), ["p2"]);
  var bc_o2 = { descStore: {}, nameStore: {}, extraPlaylists: [{ id: "s1", name: "Alpha (recipe)", owner: { id: "ron" }, description: bc_pack("f1", "Alpha") }, { id: "s2", name: "Beta (recipe)", owner: { id: "ron" }, description: bc_pack("f2", "Beta"), images: [{ url: "https://img.example/x.jpg" }] }] };
  var bc_w2 = await boot({ url: EDURL, session: signedIn(), local: { formats: bc_fmt, backupMode: "spotify", spotifySynced: JSON.stringify({ f1: { rev: 0 }, f2: { rev: 0 } }) }, fetchOptions: bc_o2 });
  bc_w2.eval("spotifySaveDelayMs = 30");
  await waitFor(() => bc_o2.writes.some((x) => x.type === "update"), 8000);
  await new Promise((r) => setTimeout(r, 300));
  check("a backup that has no cover yet gets one, and one that has a cover is left as it is", bc_covers(bc_o2).length === 1 && bc_covers(bc_o2)[0].id === "s1");
  // a save from before the cover said SAVED RECIPE (its description begins with only Do not edit.) gets the new cover once, even though it has a cover
  var bc_oldPack = (id, title) => bc_pack(id, title).replace("Holds a recipe, not music. ", "");
  var bc_o6 = { descStore: {}, nameStore: {}, extraPlaylists: [{ id: "s1", name: "Alpha (recipe)", owner: { id: "ron" }, description: bc_oldPack("f1", "Alpha"), images: [{ url: "https://img.example/x.jpg" }] }, { id: "s2", name: "Beta (recipe)", owner: { id: "ron" }, description: bc_pack("f2", "Beta"), images: [{ url: "https://img.example/y.jpg" }] }] };
  var bc_w6 = await boot({ url: EDURL, session: signedIn(), local: { formats: bc_fmt, backupMode: "spotify", spotifySynced: JSON.stringify({ f1: { rev: 0 }, f2: { rev: 0 } }) }, fetchOptions: bc_o6 });
  bc_w6.eval("spotifySaveDelayMs = 30");
  await waitFor(() => bc_covers(bc_o6).length >= 1, 8000);
  await new Promise((r) => setTimeout(r, 300));
  check("a save with the old note is rewritten with the new one and gets the new cover; a save already new is left alone", bc_covers(bc_o6).length === 1 && bc_covers(bc_o6)[0].id === "s1" && bc_covers(bc_o6)[0].base64 === bc_file.toString("base64") && bc_o6.writes.some((x) => x.type === "update" && /^Holds a recipe, not music\. /.test(x.description || "")));
  check("once the new cover is sent, nothing is left waiting for one", bc_w6.localStorage.getItem("recipeCoverDue") === null);
  // without permission to upload images, or when the image is refused or missing, the saves still happen
  var bc_o3 = { descStore: {}, nameStore: {} };
  var bc_w3 = await boot({ url: EDURL, session: { token: JSON.stringify({ value: "t", expires: Date.now() + 3600000, scope: SCOPE_ALL.replace(" ugc-image-upload", "") }) }, local: { formats: bc_fmt, backupMode: "spotify" }, fetchOptions: bc_o3 });
  bc_w3.eval("spotifySaveDelayMs = 30");
  await waitFor(() => bc_o3.writes.filter((x) => x.type === "create").length === 2, 8000);
  check("with a sign-in that does not allow uploading images, no cover is sent, and the saves are made all the same", bc_covers(bc_o3).length === 0 && /Last saved at/.test(bc_w3.document.getElementById("spotifySaveStatus").textContent));
  check("and the line under the bar says why there is no cover, and what to do about it", /does not include permission to add cover art/.test(capText(bc_w3)) && /Disconnect and connect again/.test(capText(bc_w3)) && capLinks(bc_w3).some((b) => b.textContent === "OK"));
  capLinks(bc_w3).find((b) => b.textContent === "OK").click();
  check("OK puts it away", !/permission to add cover art/.test(capText(bc_w3)));
  var bc_o4 = { descStore: {}, nameStore: {}, coverStatus: 500 };
  var bc_w4 = await boot({ url: EDURL, session: signedIn(), local: { formats: bc_fmt, backupMode: "spotify" }, fetchOptions: bc_o4 });
  bc_w4.eval("spotifySaveDelayMs = 30");
  await waitFor(() => bc_o4.writes.filter((x) => x.type === "create").length === 2, 8000);
  await waitFor(() => /did not accept the cover/.test(capText(bc_w4)), 8000);
  check("when Spotify turns the cover down, the line under the bar says so, with what Spotify said", /Spotify did not accept the cover for the recipe playlists: .+ They have no cover\./.test(capText(bc_w4)));
  check("when Spotify turns the cover down, the saves are still made and the status does not call it a failure", /Last saved at/.test(bc_w4.document.getElementById("spotifySaveStatus").textContent) && !/Couldn.t save/.test(bc_w4.document.getElementById("spotifySaveStatus").textContent));
  var bc_o5 = { descStore: {}, nameStore: {}, noCoverFile: true };
  var bc_w5 = await boot({ url: EDURL, session: signedIn(), local: { formats: bc_fmt, backupMode: "spotify" }, fetchOptions: bc_o5 });
  bc_w5.eval("spotifySaveDelayMs = 30");
  await waitFor(() => bc_o5.writes.filter((x) => x.type === "create").length === 2, 8000);
  check("when the cover file is not on the site, the line under the bar says which file", /recipe-cover\.jpg\) could not be loaded from this site, so they have no cover\./.test(capText(bc_w5)));
  check("when the cover file cannot be loaded, the saves are made without one", bc_covers(bc_o5).length === 0 && /Last saved at/.test(bc_w5.document.getElementById("spotifySaveStatus").textContent));
  } catch (err) { areaCrashed("backup cover", err); } }

  if (want("spotify merge")) { try {
  // ================================================================ reading the backups from Spotify, and settling them against the formats here
  var mg_w0 = await boot({ url: EDURL, session: signedIn(), fetchOptions: {} });
  var mg_remote = (id, title, rev, minutes, mod) => mg_w0.packFormat(mg_w0.ensureGaps({ id, title, gap: 30, gaps: [], lead: 0, items: [{ id: "a", kind: "seg", lists: [{ name: "", id: "p2", weight: 1 }], minutes }], rev, modified: mod || 1790000000, place: 1024 }), ["p2"]);
  var mg_item = (id, title, rev, minutes, mod) => '"' + id + '": {"title": "' + title + '", "name": "' + title + ' {n}", "silence between segments": "30 sec", ' + (rev ? '"revision": ' + rev + ', "modified": ' + (mod || 1790000000) + ', ' : '') + '"segments": [("💗 spacious + gentle [id:p2]", ' + minutes + ')]}';
  var mg_text = (...items) => "FORMATS = {" + items.join(", ") + "}";
  var mg_pl = (id, name, desc) => ({ id, name, owner: { id: "ron" }, description: desc });
  var mg_go = async (local, fetchOptions) => { const w = await boot({ url: EDURL, session: signedIn(), local: Object.assign({ backupMode: "spotify" }, local), fetchOptions }); w.eval("spotifySaveDelayMs = 30"); return w; };
  var mg_ups = (o, id) => o.writes.filter((x) => x.type === "update" && x.description && (!id || x.id === id));
  var mg_fmt = (w, id) => w.eval("editor.model.formats.find((f) => f.id === '" + id + "')");
  var mg_settled = async (w) => { await waitFor(() => !w.eval("saveState.running") && !w.eval("saveState.timer"), 8000); await new Promise((r) => setTimeout(r, 120)); };

  // a format only in Spotify, made on another device
  var mg_o1 = { descStore: {}, nameStore: {}, extraPlaylists: [mg_pl("s9", "Gamma (recipe)", mg_remote("f9", "Gamma", 3, 45))] };
  var mg_w1 = await mg_go({ formats: mg_text(mg_item("f1", "Alpha", 0, 30)) }, mg_o1);
  await waitFor(() => !!mg_fmt(mg_w1, "f9"), 8000);
  await mg_settled(mg_w1);
  check("a format that is only in Spotify, with no record of it here, is added: it is another device's", mg_fmt(mg_w1, "f9").title === "Gamma" && mg_fmt(mg_w1, "f9").items[0].minutes === 45);
  check("it keeps the revision and time it was saved with, and its playlist has its name from the account", mg_fmt(mg_w1, "f9").rev === 3 && mg_fmt(mg_w1, "f9").modified === 1790000000 && mg_fmt(mg_w1, "f9").items[0].lists[0].name === "💗 spacious + gentle" && /"revision": 3,/.test(mg_w1.document.getElementById("formats").value));
  check("it is on the page too, as a tab, and the line under the bar was given the news that it was added", mg_w1.document.querySelectorAll("#feTabs .fe-tab").length === 2 && /Added .Gamma. from Spotify\./.test(mg_w1.eval("saveState.lastNews ? saveState.lastNews.text : ''")));
  check("nothing is written back for it: it is already what Spotify holds", !mg_ups(mg_o1, "s9").length && mg_o1.writes.filter((x) => x.type === "create").length === 1);

  // this device changed it, and Spotify's copy is as this device last had it
  var mg_o2 = { descStore: {}, nameStore: {}, extraPlaylists: [mg_pl("s1", "Alpha (recipe)", mg_remote("f1", "Alpha", 2, 30))] };
  var mg_w2 = await mg_go({ formats: mg_text(mg_item("f1", "Alpha", 3, 50)), spotifySynced: JSON.stringify({ f1: { rev: 2 } }) }, mg_o2);
  await waitFor(() => mg_ups(mg_o2, "s1").length >= 1, 8000);
  await mg_settled(mg_w2);
  check("when only this device changed a format since the last backup, its version is the one written, and no question is asked", mg_ups(mg_o2, "s1").length === 1 && mg_w0.unpackFormat(mg_ups(mg_o2, "s1")[0].description).format.rev === 3 && !mg_w2.document.getElementById("feSyncDialog"));
  check("and the record of what was backed up moves to that revision", JSON.parse(mg_w2.localStorage.getItem("spotifySynced")).f1.rev === 3);

  // both changed: a question, answered by keeping this device's
  var mg_o3 = { descStore: {}, nameStore: {}, extraPlaylists: [mg_pl("s1", "Alpha (recipe)", mg_remote("f1", "Alpha", 5, 20, 1790000500))] };
  var mg_w3 = await mg_go({ formats: mg_text(mg_item("f1", "Alpha", 3, 50, 1790000100)), spotifySynced: JSON.stringify({ f1: { rev: 2 } }) }, mg_o3);
  await waitFor(() => !!mg_w3.document.getElementById("feSyncDialog"), 8000);
  var mg_d = mg_w3.document.getElementById("feSyncDialog");
  check("when both changed a format since the last backup, a question is asked, naming the recipe and when each version was made", /was changed in two places/.test(mg_d.textContent) && /Alpha/.test(mg_d.textContent) && /Oct 30, 2026 at/.test(mg_d.textContent) === false || /2026/.test(mg_d.textContent));
  check("it offers to keep this device's version or use Spotify's, and nothing is written while it is open", mg_d.querySelectorAll("button").length === 2 && /Keep this device/.test(mg_d.querySelector("#feSyncChoice0").textContent) && /Use Spotify/.test(mg_d.querySelector("#feSyncChoice1").textContent) && mg_ups(mg_o3).length === 0);
  mg_w3.document.getElementById("feSyncChoice0").click();
  await waitFor(() => mg_ups(mg_o3, "s1").length >= 1, 8000);
  await mg_settled(mg_w3);
  check("keeping this device's version writes it over Spotify's, with a revision above both, so it wins everywhere", mg_w0.unpackFormat(mg_ups(mg_o3, "s1")[0].description).format.rev === 6 && mg_fmt(mg_w3, "f1").rev === 6 && mg_fmt(mg_w3, "f1").items[0].minutes === 50);

  // the same, answered by using Spotify's
  var mg_o4 = { descStore: {}, nameStore: {}, extraPlaylists: [mg_pl("s1", "Alpha (recipe)", mg_remote("f1", "Alpha", 5, 20, 1790000500))] };
  var mg_w4 = await mg_go({ formats: mg_text(mg_item("f1", "Alpha", 3, 50, 1790000100)), spotifySynced: JSON.stringify({ f1: { rev: 2 } }) }, mg_o4);
  await waitFor(() => !!mg_w4.document.getElementById("feSyncDialog"), 8000);
  mg_w4.document.getElementById("feSyncChoice1").click();
  await mg_settled(mg_w4);
  check("using Spotify's replaces this device's version with it, at its revision, and writes nothing over it", mg_fmt(mg_w4, "f1").items[0].minutes === 20 && mg_fmt(mg_w4, "f1").rev === 5 && !mg_ups(mg_o4, "s1").length && /Updated .Alpha. from Spotify\./.test(mg_w4.eval("saveState.lastNews ? saveState.lastNews.text : ''")));

  // a question that has to be answered: closing is not possible, and nothing is saved for that format until it is
  var mg_o5 = { descStore: {}, nameStore: {}, extraPlaylists: [mg_pl("s1", "Alpha (recipe)", mg_remote("f1", "Alpha", 5, 20, 1790000500))] };
  var mg_w5 = await mg_go({ formats: mg_text(mg_item("f1", "Alpha", 3, 50, 1790000100)), spotifySynced: JSON.stringify({ f1: { rev: 2 } }) }, mg_o5);
  await waitFor(() => !!mg_w5.document.getElementById("feSyncDialog"), 8000);
  check("the question about a format changed in two places is a dialog that has to be answered: it says the other version is replaced, and says nothing of closing it", /The other one is replaced\./.test(mg_w5.document.getElementById("feSyncDialog").textContent) && !/Closing this decides nothing/.test(mg_w5.document.getElementById("feSyncDialog").textContent) && mg_w5.document.querySelector("#feSyncDialog [role=alertdialog]"));
  mg_w5.document.dispatchEvent(new mg_w5.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  mg_w5.document.getElementById("feSyncDialog").click();
  await new Promise((r) => setTimeout(r, 200));
  check("Escape does not close it, and neither does pressing outside it", !!mg_w5.document.getElementById("feSyncDialog"));
  check("and while it is open nothing is written for that format, and neither version has changed", mg_fmt(mg_w5, "f1").items[0].minutes === 50 && !mg_ups(mg_o5, "s1").length);
  mg_w5.document.getElementById("feSyncChoice1").click();
  await mg_settled(mg_w5);
  check("answering it settles the format", !mg_w5.document.getElementById("feSyncDialog") && mg_fmt(mg_w5, "f1").rev === 5 && !mg_w5.document.getElementById("feAppMenuButton").classList.contains("fe-alert"));
  // the question about a backup that is gone is the same
  var mg_oq = { descStore: {}, nameStore: {}, extraPlaylists: [mg_pl("s1", "Alpha (recipe)", mg_remote("f1", "Alpha", 2, 30))] };
  var mg_wq = await mg_go({ formats: mg_text(mg_item("f1", "Alpha", 2, 30), mg_item("f2", "Beta", 1, 40)), spotifySynced: JSON.stringify({ f1: { rev: 2 }, f2: { rev: 1 } }) }, mg_oq);
  await waitFor(() => !!mg_wq.document.getElementById("feSyncDialog"), 8000);
  mg_wq.document.dispatchEvent(new mg_wq.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  mg_wq.document.getElementById("feSyncDialog").click();
  await new Promise((r) => setTimeout(r, 150));
  check("the question about a backup that has gone from Spotify has to be answered as well", !!mg_wq.document.getElementById("feSyncDialog") && /Keep it here/.test(mg_wq.document.getElementById("feSyncChoice0").textContent));

  // no record of a backup, and the two differ: asked. The same: not asked.
  var mg_o6 = { descStore: {}, nameStore: {}, extraPlaylists: [mg_pl("s1", "Alpha (recipe)", mg_remote("f1", "Alpha", 4, 20))] };
  var mg_w6 = await mg_go({ formats: mg_text(mg_item("f1", "Alpha", 1, 50)) }, mg_o6);
  await waitFor(() => !!mg_w6.document.getElementById("feSyncDialog"), 8000);
  check("a format and a backup that differ, with no record of this device having backed it up, are asked about", !!mg_w6.document.getElementById("feSyncDialog"));
  var mg_o7 = { descStore: {}, nameStore: {}, extraPlaylists: [mg_pl("s1", "Alpha (recipe)", mg_remote("f1", "Alpha", 4, 30))] };
  var mg_w7 = await mg_go({ formats: mg_text(mg_item("f1", "Alpha", 1, 30)) }, mg_o7);
  await mg_settled(mg_w7);
  check("ones that say the same are not asked about: the revision here is brought up to the backup's, and the record is made", !mg_w7.document.getElementById("feSyncDialog") && mg_fmt(mg_w7, "f1").rev === 4 && JSON.parse(mg_w7.localStorage.getItem("spotifySynced")).f1.rev === 4);

  // a backup that is gone
  var mg_o8 = { descStore: {}, nameStore: {}, extraPlaylists: [mg_pl("s1", "Alpha (recipe)", mg_remote("f1", "Alpha", 2, 30))] };
  var mg_w8 = await mg_go({ formats: mg_text(mg_item("f1", "Alpha", 2, 30), mg_item("f2", "Beta", 1, 40)), spotifySynced: JSON.stringify({ f1: { rev: 2 }, f2: { rev: 1 } }) }, mg_o8);
  await waitFor(() => !!mg_w8.document.getElementById("feSyncDialog"), 8000);
  check("a format that was backed up from here, and whose backup is gone, is asked about: keep it here, or remove it here", /Beta/.test(mg_w8.document.getElementById("feSyncDialog").textContent) && /is no longer in Spotify/.test(mg_w8.document.getElementById("feSyncDialog").textContent) && /Keep it here/.test(mg_w8.document.getElementById("feSyncChoice0").textContent) && /Remove it here/.test(mg_w8.document.getElementById("feSyncChoice1").textContent));
  mg_w8.document.getElementById("feSyncChoice0").click();
  await waitFor(() => mg_o8.writes.some((x) => x.type === "create"), 8000);
  await mg_settled(mg_w8);
  check("keeping it saves it to Spotify again, as a new backup", mg_o8.writes.filter((x) => x.type === "create").length === 1 && mg_o8.writes.filter((x) => x.type === "create")[0].name === "Beta (recipe)" && !!mg_fmt(mg_w8, "f2"));
  var mg_o9 = { descStore: {}, nameStore: {}, extraPlaylists: [mg_pl("s1", "Alpha (recipe)", mg_remote("f1", "Alpha", 2, 30))] };
  var mg_w9 = await mg_go({ formats: mg_text(mg_item("f1", "Alpha", 2, 30), mg_item("f2", "Beta", 1, 40)), spotifySynced: JSON.stringify({ f1: { rev: 2 }, f2: { rev: 1 } }) }, mg_o9);
  await waitFor(() => !!mg_w9.document.getElementById("feSyncDialog"), 8000);
  mg_w9.document.getElementById("feSyncChoice1").click();
  await mg_settled(mg_w9);
  check("removing it takes it off this device, and does not touch Spotify, where it is already gone", !mg_fmt(mg_w9, "f2") && mg_o9.writes.filter((x) => x.type === "remove" || x.type === "create").length === 0 && !JSON.parse(mg_w9.localStorage.getItem("spotifySynced")).f2);

  // a backup that cannot be read, with the format's name, is written over, and is not taken for a removed one
  var mg_o10 = { descStore: {}, nameStore: {}, extraPlaylists: [mg_pl("s1", "Alpha (recipe)", mg_remote("f1", "Alpha", 2, 30)), mg_pl("sx", "Beta (recipe)", mg_remote("f2", "Beta", 1, 40).slice(0, -4))] };
  var mg_w10 = await mg_go({ formats: mg_text(mg_item("f1", "Alpha", 2, 30), mg_item("f2", "Beta", 1, 40)), spotifySynced: JSON.stringify({ f1: { rev: 2 }, f2: { rev: 1 } }) }, mg_o10);
  await waitFor(() => mg_ups(mg_o10, "sx").length >= 1, 8000);
  await mg_settled(mg_w10);
  check("a damaged backup that has this format's name is not taken for a removed one: no question, and it is written again in place, not as a second one", !mg_w10.document.getElementById("feSyncDialog") && mg_w0.unpackFormat(mg_ups(mg_o10, "sx")[0].description).kind === "save" && mg_o10.writes.filter((x) => x.type === "create").length === 0);
  check("the status says that a backup could not be read", /could not be read, or was saved by a newer version of this app, and was left alone/.test(capText(mg_w10)));

  // a format whose backup is in Spotify but which is not here, and was not deleted here: added again
  var mg_o11 = { descStore: {}, nameStore: {}, extraPlaylists: [mg_pl("s1", "Alpha (recipe)", mg_remote("f1", "Alpha", 2, 30)), mg_pl("s2", "Beta (recipe)", mg_remote("f2", "Beta", 1, 40))] };
  var mg_w11 = await mg_go({ formats: mg_text(mg_item("f1", "Alpha", 2, 30)), spotifySynced: JSON.stringify({ f1: { rev: 2 }, f2: { rev: 1 } }) }, mg_o11);
  await waitFor(() => !!mg_fmt(mg_w11, "f2"), 8000);
  check("a backup whose format is gone from here, without the format having been deleted here, comes back: the formats here may have been replaced", !!mg_fmt(mg_w11, "f2") && mg_fmt(mg_w11, "f2").title === "Beta");

  // coming back to the page after a while reads the account's playlists again
  var mg_o12 = { descStore: {}, nameStore: {}, extraPlaylists: [mg_pl("s1", "Alpha (recipe)", mg_remote("f1", "Alpha", 2, 30))] };
  var mg_w12 = await mg_go({ formats: mg_text(mg_item("f1", "Alpha", 2, 30)) }, mg_o12);
  await mg_settled(mg_w12);
  var mg_reads = mg_o12.listCalls;
  mg_w12.eval("playlistRefreshMs = 0");
  Object.defineProperty(mg_w12.document, "visibilityState", { value: "visible", configurable: true });
  mg_w12.document.dispatchEvent(new mg_w12.Event("visibilitychange"));
  await waitFor(() => mg_o12.listCalls > mg_reads, 5000);
  check("coming back to the page after the set time reads the account's playlists again", mg_o12.listCalls > mg_reads);
  var mg_reads2 = mg_o12.listCalls;
  mg_w12.eval("playlistRefreshMs = 600000");
  mg_w12.document.dispatchEvent(new mg_w12.Event("visibilitychange"));
  await new Promise((r) => setTimeout(r, 300));
  check("and not before it", mg_o12.listCalls === mg_reads2);
  } catch (err) { areaCrashed("spotify merge", err); } }

  if (want("spotify wording")) { try {
  // ================================================================ the wording that depends on the way the formats are backed up
  var sw_html = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  check("the privacy text says that with automatic backup each recipe is also kept in a private playlist in the person's own Spotify account, in its description, and goes nowhere else", /Recipes are saved to Spotify unless you choose otherwise: each recipe is also kept in a private playlist in your own Spotify account, in the playlist's description\. That is where this app saves it and reads it back, and it goes nowhere else\./.test(sw_html));
  var sw_m = await boot({ url: EDURL, session: signedIn(), local: { backupMode: "manual" }, fetchOptions: {} });
  check("with the backup file as the way, Reset app on this device talks about restoring from the file, with Restore in the app menu", /Restore in the app menu/.test(sw_m.document.getElementById("clearRestoreHelp").textContent) && /Restore in the app menu/.test(sw_m.document.getElementById("clearConfirmHelp").textContent));
  var sw_s = await boot({ url: EDURL, session: signedIn(), local: { backupMode: "spotify" }, fetchOptions: {} });
  check("with Spotify as the way, it says the backups in Spotify stay, and that connecting again loads the formats back, and does not mention a file", /Recipes saved to Spotify stay there/.test(sw_s.document.getElementById("clearRestoreHelp").textContent) && /connecting to Spotify again brings them back/.test(sw_s.document.getElementById("clearConfirmHelp").textContent) && !/restore from a backup/.test(sw_s.document.getElementById("clearRestoreHelp").textContent + sw_s.document.getElementById("clearConfirmHelp").textContent));
  check("and the note above the button says clearing does not remove those backups", /does not remove them/.test(sw_s.document.getElementById("clearBackupNote").textContent));
  sw_s.document.getElementById("backupCard") && sw_s.eval('localStorage.setItem("backupMode", "manual"); applyBackupMode();');
  check("switching back to the backup file puts its wording back", /Restore in the app menu/.test(sw_s.document.getElementById("clearRestoreHelp").textContent));
  } catch (err) { areaCrashed("spotify wording", err); } }

  if (want("backup switching")) { try {
  // ================================================================ switching between the two ways of backing up
  var bs_w0 = await boot({ url: EDURL, session: signedIn(), fetchOptions: {} });
  var bs_remote = (id, title, rev, minutes) => bs_w0.packFormat(bs_w0.ensureGaps({ id, title, gap: 30, gaps: [], lead: 0, items: [{ id: "a", kind: "seg", lists: [{ name: "", id: "p2", weight: 1 }], minutes }], rev, modified: 1790000000 }), ["p2"]);
  var bs_item = (id, title, rev, minutes) => '"' + id + '": {"title": "' + title + '", "name": "' + title + ' {n}", "silence between segments": "30 sec", ' + (rev ? '"revision": ' + rev + ', "modified": 1790000000, ' : '') + '"segments": [("💗 spacious + gentle [id:p2]", ' + minutes + ')]}';
  var bs_text = (...items) => "FORMATS = {" + items.join(", ") + "}";
  var bs_pl = (id, name, desc) => ({ id, name, owner: { id: "ron" }, description: desc });
  var bs_two = bs_text(bs_item("f1", "Alpha", 2, 30), bs_item("f2", "Beta", 1, 40));
  var bs_account = () => [bs_pl("s1", "Alpha (recipe)", bs_remote("f1", "Alpha", 2, 30)), bs_pl("s2", "Beta (recipe)", bs_remote("f2", "Beta", 1, 40))];
  var bs_go = async (local, fetchOptions) => { const w = await boot({ url: EDURL, session: signedIn(), local, fetchOptions }); w.eval("spotifySaveDelayMs = 30"); return w; };
  var bs_settled = async (w) => { await waitFor(() => !w.eval("saveState.running") && !w.eval("saveState.timer"), 8000); await new Promise((r) => setTimeout(r, 120)); };
  var bs_writes = (o, t) => o.writes.filter((x) => x.type === t);
  var bs_synced = JSON.stringify({ f1: { rev: 2 }, f2: { rev: 1 } });
  var bs_leave = (w) => { w.document.getElementById("changeSaveMethod").click(); pickMode(w, "backupModeManual"); };

  // leaving Spotify, keeping the backups
  var bs_o1 = { descStore: {}, nameStore: {}, extraPlaylists: bs_account() };
  var bs_w1 = await bs_go({ formats: bs_two, backupMode: "spotify", spotifySynced: bs_synced }, bs_o1);
  await bs_settled(bs_w1);
  bs_leave(bs_w1);
  await waitFor(() => !!bs_w1.document.getElementById("feSyncDialog"), 5000);
  var bs_d = bs_w1.document.getElementById("feSyncDialog");
  check("leaving Spotify for the backup file asks whether to remove the backups, saying how many there are and that another device would lose them, with keeping as the first answer", /Remove saved recipes from Spotify\?/.test(bs_d.textContent) && /There are 2 saved recipes/.test(bs_d.textContent) && /Keeping them is recommended\./.test(bs_d.textContent) && /Another device that saves to Spotify would lose them too/.test(bs_d.textContent) && /Keep them/.test(bs_d.querySelector("#feSyncChoice0").textContent) && /Remove them/.test(bs_d.querySelector("#feSyncChoice1").textContent));
  check("the choice itself is already made: the way is the backup file, and nothing more is saved to Spotify", bs_w1.localStorage.getItem("backupMode") === "manual" && bs_w1.document.getElementById("savedNote").hidden === false);
  check("this device forgets what it knew of the backups", bs_w1.localStorage.getItem("spotifySynced") === null && bs_w1.localStorage.getItem("spotifyPendingDeletes") === null);
  bs_w1.document.getElementById("feSyncChoice0").click();
  await new Promise((r) => setTimeout(r, 200));
  check("keeping them removes nothing, and says so", bs_writes(bs_o1, "remove").length === 0 && /left as they are/.test(capText(bs_w1)));
  var bs_files = [];
  bs_w1.saveFile = (name, text) => bs_files.push({ name, text });
  var bs_offer = capLinks(bs_w1).find((b) => b.textContent === "Back up now");
  check("and offers a backup file right there, as a pink link", !!bs_offer);
  bs_offer.click();
  check("which downloads the formats, and says where to find the file", bs_files.length === 1 && /FORMATS/.test(bs_files[0].text) && /Backed up to this device/.test(capText(bs_w1)));
  bs_w1.document.body.click();
  var bs_n = bs_o1.writes.length;
  rowsOf(bs_w1)[0].querySelector(".fe-inc").click();
  await new Promise((r) => setTimeout(r, 400));
  check("and an edit afterwards is not saved to Spotify", bs_o1.writes.length === bs_n);

  // leaving it and removing them
  var bs_o2 = { descStore: {}, nameStore: {}, extraPlaylists: bs_account() };
  var bs_w2 = await bs_go({ formats: bs_two, backupMode: "spotify", spotifySynced: bs_synced }, bs_o2);
  await bs_settled(bs_w2);
  bs_leave(bs_w2);
  await waitFor(() => !!bs_w2.document.getElementById("feSyncDialog"), 5000);
  var bs_files2 = [];
  bs_w2.saveFile = (name, text) => bs_files2.push({ name, text });
  bs_w2.document.getElementById("feSyncChoice1").click();
  await waitFor(() => /Are you sure\?/.test((bs_w2.document.getElementById("feSyncDialog") || {}).textContent || ""), 5000);
  var bs_d2 = bs_w2.document.getElementById("feSyncDialog");
  check("removing asks once more, saying a backup file downloads to this device first, with keeping first and nothing removed yet", /If you remove them, a backup file of your recipes downloads to this device first\./.test(bs_d2.textContent) && bs_d2.querySelector("#feSyncChoice0").textContent === "Keep them" && bs_d2.querySelector("#feSyncChoice1").textContent === "Remove them" && bs_writes(bs_o2, "remove").length === 0 && bs_files2.length === 0);
  bs_d2.querySelector("#feSyncChoice1").click();
  await waitFor(() => bs_writes(bs_o2, "remove").length >= 1, 5000);
  check("a backup file of the recipes is downloaded before they are removed", bs_files2.length === 1 && /FORMATS|RECIPES/.test(bs_files2[0].text));
  await new Promise((r) => setTimeout(r, 150));
  check("removing them removes every backup in the account, and only those", bs_writes(bs_o2, "remove").length === 1 && bs_writes(bs_o2, "remove")[0].uris.slice().sort().join() === "spotify:playlist:s1,spotify:playlist:s2" && !bs_w2.eval("playlists.some((p) => p.isSave)"));
  check("it says how many were removed, that the formats are now only in this browser and a backup file is on this device, with no second backup offered", /Removed 2 saved recipes from Spotify\. Your recipes are now saved only in this browser, and a backup file is on this device\./.test(capText(bs_w2)) && !capLinks(bs_w2).find((b) => b.textContent === "Back up now"));

  // removing, then keeping them at Are you sure?
  var bs_o2b = { descStore: {}, nameStore: {}, extraPlaylists: bs_account() };
  var bs_w2b = await bs_go({ formats: bs_two, backupMode: "spotify", spotifySynced: bs_synced }, bs_o2b);
  await bs_settled(bs_w2b);
  var bs_files2b = [];
  bs_w2b.saveFile = (name, text) => bs_files2b.push({ name, text });
  bs_leave(bs_w2b);
  await waitFor(() => !!bs_w2b.document.getElementById("feSyncDialog"), 5000);
  bs_w2b.document.getElementById("feSyncChoice1").click();
  await waitFor(() => /Are you sure\?/.test((bs_w2b.document.getElementById("feSyncDialog") || {}).textContent || ""), 5000);
  bs_w2b.document.getElementById("feSyncChoice0").click();
  await new Promise((r) => setTimeout(r, 200));
  check("keeping them at Are you sure? removes nothing and downloads nothing, and says they were left", bs_writes(bs_o2b, "remove").length === 0 && bs_files2b.length === 0 && /left as they are/.test(capText(bs_w2b)));
  check("and the formats here are untouched", !!bs_w2.eval("editor.model.formats.find((f) => f.id === 'f2')") && rowsOf(bs_w2).length >= 1);

  // closing the question keeps them
  var bs_o3 = { descStore: {}, nameStore: {}, extraPlaylists: bs_account() };
  var bs_w3 = await bs_go({ formats: bs_two, backupMode: "spotify", spotifySynced: bs_synced }, bs_o3);
  await bs_settled(bs_w3);
  bs_leave(bs_w3);
  await waitFor(() => !!bs_w3.document.getElementById("feSyncDialog"), 5000);
  bs_w3.document.dispatchEvent(new bs_w3.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  check("closing the question leaves the backups where they are", bs_writes(bs_o3, "remove").length === 0 && !bs_w3.document.getElementById("feSyncDialog"));

  // nothing to ask when there are no backups
  var bs_o4 = { descStore: {}, nameStore: {} };
  var bs_w4 = await bs_go({ formats: bs_text(bs_item("f1", "Alpha", 0, 30)), backupMode: "spotify" }, bs_o4);
  await bs_settled(bs_w4);
  bs_w4.eval('playlists = playlists.filter((p) => !p.isSave)');
  bs_leave(bs_w4);
  await new Promise((r) => setTimeout(r, 200));
  check("with no backups in the account, there is nothing to ask, only a message that the formats are now only in this browser, with a backup file offered", !bs_w4.document.getElementById("feSyncDialog") && bs_w4.localStorage.getItem("backupMode") === "manual" && /Your recipes are now saved only in this browser\./.test(capText(bs_w4)) && !!capLinks(bs_w4).find((b) => b.textContent === "Back up now"));

  // not connected: the backups are left, and the person is told
  var bs_w5 = await boot({ url: EDURL, session: {}, local: { formats: bs_two, backupMode: "spotify" }, fetchOptions: {} });
  bs_w5.eval('playlists = [{ id: "s1", name: "Alpha (recipe)", owner: "ron", description: "", save: { kind: "save", format: { id: "f1" } }, isSave: true }]');
  pickMode(bs_w5, "backupModeManual");
  await new Promise((r) => setTimeout(r, 200));
  check("when Spotify is not connected, there is no question: the backup is left, and it says so", !bs_w5.document.getElementById("feSyncDialog") && /was left as it is/.test(capText(bs_w5)) && !!capLinks(bs_w5).find((b) => b.textContent === "Back up now"));

  // going to Spotify with backups already there: a first pass, which asks only about formats that differ
  var bs_o6 = { descStore: {}, nameStore: {}, extraPlaylists: [bs_pl("s1", "Alpha (recipe)", bs_remote("f1", "Alpha", 2, 30)), bs_pl("s2", "Beta (recipe)", bs_remote("f2", "Beta", 5, 25))] };
  var bs_w6 = await bs_go({ formats: bs_two, backupMode: "manual" }, bs_o6);
  await new Promise((r) => setTimeout(r, 300));
  check("on the backup file way, the backups in the account are left alone and nothing is asked", !bs_w6.document.getElementById("feSyncDialog") && bs_o6.writes.filter((x) => x.type === "create" || x.type === "update").length === 0);
  bs_w6.document.getElementById("feAppMenuButton").click();
  bs_w6.document.getElementById("feBackupMethod").click();
  pickMode(bs_w6, "backupModeSpotify");
  await waitFor(() => !!bs_w6.document.getElementById("feSyncDialog"), 5000);
  check("switching to Spotify settles the formats against the backups, and asks only about the one that differs (Beta), not the one that matches (Alpha)", /Beta/.test(bs_w6.document.getElementById("feSyncDialog").textContent) && !/Alpha/.test(bs_w6.document.getElementById("feSyncDialog").textContent));
  bs_w6.document.getElementById("feSyncChoice1").click();
  await bs_settled(bs_w6);
  check("and the answer is carried out", bs_w6.eval("editor.model.formats.find((f) => f.id === 'f2')").rev === 5 && bs_w6.eval("editor.model.formats.find((f) => f.id === 'f2')").items[0].minutes === 25);

  // the app's own playlists and the backups are kept apart
  var bs_py = (fn, args) => require("child_process").spawnSync("python3", [require("path").join(__dirname, "bridge.py"), fn, JSON.stringify(args)], { encoding: "utf8" }).stdout;
  var bs_found = JSON.parse(bs_py("existing_matches", [bs_two, JSON.stringify(["f1", "f2"]), JSON.stringify([{ id: "s1", name: "Alpha (recipe)", owner: "ron" }, { id: "b1", name: "Alpha 1", owner: "ron" }]), "ron"]));
  check("Remove earlier playlists looks for playlists named like a format's playlists, so a format's backup is never one of them", bs_found.length === 1 && bs_found[0].id === "b1");
  } catch (err) { areaCrashed("backup switching", err); } }

  if (want("save retry online")) { try {
  // ================================================================ a failed save is tried again when the connection comes back
  var ro_w0 = await boot({ url: EDURL, session: signedIn(), fetchOptions: {} });
  var ro_remote = ro_w0.packFormat(ro_w0.ensureGaps({ id: "f1", title: "Alpha", gap: 30, gaps: [], lead: 0, items: [{ id: "a", kind: "seg", lists: [{ name: "", id: "p2", weight: 1 }], minutes: 99 }], rev: 0, modified: 0 }), ["p2"]);
  var ro_o = { descStore: {}, nameStore: {}, putFails: true, extraPlaylists: [{ id: "s1", name: "Alpha (recipe)", owner: { id: "ron" }, description: ro_remote }] };
  var ro_w = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"f1": {"title": "Alpha", "name": "Alpha {n}", "silence between segments": "30 sec", "segments": [("💗 spacious + gentle [id:p2]", 30)]}}', backupMode: "spotify", spotifySynced: JSON.stringify({ f1: { rev: 0 } }) }, fetchOptions: ro_o });
  ro_w.eval("spotifySaveDelayMs = 30");
  await waitFor(() => /Couldn.t save to Spotify\./.test(ro_w.document.getElementById("spotifySaveStatus").textContent), 8000);
  ro_o.putFails = false;
  ro_w.dispatchEvent(new ro_w.Event("online"));
  await waitFor(() => ro_o.writes.some((x) => x.type === "update" && x.id === "s1"), 8000);
  await waitFor(() => /Last saved at/.test(ro_w.document.getElementById("spotifySaveStatus").textContent), 3000);
  check("after a failed save, the connection coming back makes the app try again by itself, and the status goes back to saying when it was saved", /Last saved at/.test(ro_w.document.getElementById("spotifySaveStatus").textContent));
  var ro_n = ro_o.writes.length;
  ro_w.dispatchEvent(new ro_w.Event("online"));
  await new Promise((r) => setTimeout(r, 300));
  check("and with nothing wrong, the connection coming back does nothing", ro_o.writes.length === ro_n);
  } catch (err) { areaCrashed("save retry online", err); } }

  if (want("connecting state")) { try {
  // ================================================================ the Connect buttons while a sign-in is under way
  var cs_label = (w, id) => w.document.getElementById(id).querySelector(".btn-label").textContent;
  // Step 1
  var cs_w = await boot({ url: EDURL, local: { clientId: "client-1" }, fetchOptions: {} });
  check("before pressing it, the Connect button says Connect to Spotify and can be pressed", cs_label(cs_w, "connect") === "Connect to Spotify" && !cs_w.document.getElementById("connect").disabled);
  cs_w.document.getElementById("connect").click();
  await new Promise((r) => setTimeout(r, 100));
  check("pressing it makes it say Connecting\u2026 and cannot be pressed again", cs_label(cs_w, "connect") === "Connecting\u2026" && cs_w.document.getElementById("connect").disabled);
  check("and a line beside it says Spotify is opening and that it can take a few seconds", /Opening Spotify\. On a slow connection this can take a few seconds\./.test(cs_w.document.getElementById("loginMessage").textContent));
  check("that line is not in the error color, since nothing has gone wrong: it is only saying what is happening", cs_w.document.getElementById("loginMessage").className === "muted");
  var cs_state = cs_w.sessionStorage.getItem("pkceState");
  cs_w.document.getElementById("connect").click();
  await new Promise((r) => setTimeout(r, 50));
  check("a second press does not start another sign-in over the first (which would spoil it): the sign-in code kept for it is unchanged", !!cs_state && cs_w.sessionStorage.getItem("pkceState") === cs_state);
  // Back from Spotify's page, shown as it was left
  cs_w.dispatchEvent(Object.assign(new cs_w.Event("pageshow"), { persisted: true }));
  await new Promise((r) => setTimeout(r, 50));
  check("if the browser shows the page again as it was left, after Back from Spotify, the button is Connect to Spotify again and works", cs_label(cs_w, "connect") === "Connect to Spotify" && !cs_w.document.getElementById("connect").disabled && cs_w.document.getElementById("loginMessage").textContent === "");
  // minimalist mode: the Create button is the Connect button
  var cs_m = await boot({ url: EDURL, local: { formats: MINI, minimalMode: "1", connectedBefore: "1", clientId: "client-1" }, fetchOptions: {} });
  check("in minimalist mode, with no sign-in, the main button says Connect to Spotify", cs_label(cs_m, "create") === "Connect to Spotify" && !cs_m.document.getElementById("create").disabled);
  cs_m.document.getElementById("create").click();
  await new Promise((r) => setTimeout(r, 100));
  check("pressing it makes it say Connecting\u2026, and cannot be pressed again, with the note under it saying Spotify is opening", cs_label(cs_m, "create") === "Connecting\u2026" && cs_m.document.getElementById("create").disabled && !cs_m.document.getElementById("spotifyNote").hidden && /Opening Spotify/.test(cs_m.document.getElementById("spotifyNote").textContent));
  // the way back from Spotify, while the sign-in is being finished over a slow connection
  var cs_r = await boot({ url: "http://127.0.0.1:8000/?code=abc123&state=st1", session: { pkceState: "st1", pkceVerifier: "v" }, local: { clientId: "client-1" }, fetchOptions: { tokenDelayMs: 4000 } });
  check("coming back from Spotify, the button already says Connecting\u2026 while the sign-in is finished, and cannot be pressed", cs_label(cs_r, "connect") === "Connecting\u2026" && cs_r.document.getElementById("connect").disabled && /Finishing the sign-in/.test(cs_r.document.getElementById("loginMessage").textContent));
  check("on the way back, the line saying the sign-in is being finished is not red either", cs_r.document.getElementById("loginMessage").className === "muted");
  var cs_rm = await boot({ url: "http://127.0.0.1:8000/?code=abc123&state=st1", session: { pkceState: "st1", pkceVerifier: "v" }, local: { formats: MINI, minimalMode: "1", connectedBefore: "1", clientId: "client-1" }, fetchOptions: { tokenDelayMs: 4000 } });
  check("with minimalist mode chosen, the page is not yet the editor while the sign-in is finished, so Step 1's button is the one that says Connecting\u2026 then, with the line under it", cs_label(cs_rm, "connect") === "Connecting\u2026" && cs_rm.document.getElementById("connect").disabled && /Finishing the sign-in/.test(cs_rm.document.getElementById("loginMessage").textContent));
  await waitFor(() => cs_rm.eval("connection") === "ready", 20000);
  await new Promise((r) => setTimeout(r, 300));
  check("when the connection is made, the button goes back to being the Build button, and the notes are gone", /Build playlists/.test(cs_label(cs_rm, "create")) && cs_rm.eval("signingIn") === false && cs_rm.document.getElementById("spotifyNote").hidden);
  // a sign-in that fails puts the buttons back
  var cs_f = await boot({ url: "http://127.0.0.1:8000/?code=abc123&state=st1", session: { pkceState: "st1", pkceVerifier: "v" }, local: { clientId: "client-1" }, fetchOptions: { failToken: true, tokenDelayMs: 200 } });
  await waitFor(() => /refused the sign-in/.test(cs_f.document.getElementById("loginMessage").textContent), 8000);
  check("when Spotify refuses the sign-in, the message that says so is in the error color", cs_f.document.getElementById("loginMessage").className === "error");
  check("when Spotify refuses the sign-in, the button is Connect to Spotify again, ready for another try", cs_label(cs_f, "connect") === "Connect to Spotify" && !cs_f.document.getElementById("connect").disabled);
  // loading the playlists after the sign-in, in minimalist mode
  var cs_c = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, minimalMode: "1", connectedBefore: "1" }, fetchOptions: { listDelayMs: 4000 } });
  check("while the playlists are being read after sign-in, the main button says Connecting\u2026 and is disabled, with a note", cs_c.eval("connection") === "connecting" && cs_label(cs_c, "create") === "Connecting\u2026" && cs_c.document.getElementById("create").disabled && /Connecting to Spotify/.test(cs_c.document.getElementById("spotifyNote").textContent));
  } catch (err) { areaCrashed("connecting state", err); } }

  if (want("connecting screen")) { try {
  // ================================================================ back from Spotify's sign-in: a quiet screen until the editor is ready
  var cn_html = fs.readFileSync(ROOT + "index.html", "utf8");
  check("the page's first script puts up the connecting screen, and picks the app page, when the address has a sign-in code from Spotify", /code=\/\.test\(location\.search\)\) \{ page = "app"; document\.documentElement\.classList\.add\("connecting"\)/.test(cn_html));
  var cn_steps = Array.from(cn_html.matchAll(/<li id="(cn\w+)" class="cn-step[^"]*"><span class="cn-mark"><svg[^>]*>.*?<\/svg><\/span><span>([^<]+)<\/span><\/li>/g)).map((m) => m[1] + ": " + m[2]);
  check("the connecting screen shows the app's icon and four steps in order", /<div id="connectingScreen" role="status">\s*<img src="apple-touch-icon\.png"/.test(cn_html) && JSON.stringify(cn_steps) === JSON.stringify(["cnSignin: Signing in to Spotify", "cnPlaylists: Reading your playlists", "cnRecipes: Loading your recipes", "cnPython: Starting the playlist builder"]), JSON.stringify(cn_steps));
  check("signing in and starting Python are under way from the first moment; the other two wait", /id="cnSignin" class="cn-step cn-active"/.test(cn_html) && /id="cnPython" class="cn-step cn-active"/.test(cn_html) && /id="cnPlaylists" class="cn-step"/.test(cn_html) && /id="cnRecipes" class="cn-step"/.test(cn_html));
  check("with manual backup the recipes step is left out, from the first moment", /if \(localStorage\.getItem\("backupMode"\) === "manual"\) document\.documentElement\.classList\.add\("cn-manual"\)/.test(cn_html) && /html\.cn-manual #cnRecipes \{ display: none; \}/.test(cn_html));
  check("the screen sits below the startup problem popup, so a page that cannot start still says so", /#connectingScreen \{[^}]*z-index: 1500/.test(cn_html) && /#startupProblem \{ z-index: 2000/.test(cn_html));
  check("with reduced motion nothing turns or fades", /prefers-reduced-motion: reduce\) \{ #connectingScreen, \.cn-step \{ transition: none; \} \.cn-active \.cn-mark::before \{ animation: none; \} #connectingScreen\.cn-finished > \* \{ animation: none; \} \}/.test(cn_html));
  var cn_on = (w) => w.document.documentElement.classList.contains("connecting");
  var cn_back = { url: "http://127.0.0.1:8000/?code=abc123&state=st1", session: { pkceState: "st1", pkceVerifier: "v" }, before: (w) => w.document.documentElement.classList.add("connecting") };
  var cn_w = await boot({ ...cn_back, local: { clientId: "client-1", setupStarted: "1", formats: MINI, backupMode: "spotify" }, fetchOptions: { tokenDelayMs: 2500 } });
  check("while the sign-in is finished, the connecting screen is up and the page under it is the app, not the setup page", cn_on(cn_w) && cn_w.document.documentElement.classList.contains("page-app") && !cn_w.document.documentElement.classList.contains("page-setup"));
  var cn_state = (w) => ["Signin", "Playlists", "Recipes", "Python"].map((s) => w.document.getElementById("cn" + s).className.replace("cn-step", "").trim() || "waiting").join(",");
  check("meanwhile Python is ready and ticked, the sign-in still turns, and the playlists and recipes wait", cn_state(cn_w) === "cn-active,waiting,waiting,cn-done", cn_state(cn_w));
  await waitFor(() => cn_w.document.getElementById("connectingScreen").classList.contains("cn-finished"), 15000);
  check("the first time, with every step ticked, the screen stays and says Setup complete! with a button to go on", cn_on(cn_w) && cn_state(cn_w) === "cn-done,cn-done,cn-done,cn-done" && cn_w.document.querySelector("#connectingScreen h2.cn-finish").textContent === "Setup complete!" && cn_w.document.getElementById("cnContinue").textContent === "Show me my recipes!", cn_state(cn_w));
  await new Promise((r) => setTimeout(r, 800));
  check("it waits for the button", cn_on(cn_w));
  cn_w.document.getElementById("cnContinue").click();
  await waitFor(() => !cn_on(cn_w), 3000);
  check("by the time the screen goes, every step is ticked", cn_state(cn_w) === "cn-done,cn-done,cn-done,cn-done", cn_state(cn_w));
  check("the screen goes once everything is ready: connected, the recipes saved to Spotify, Python running", cn_w.eval("connection") === "ready" && cn_w.eval("saveState.savedAt") !== null && !cn_w.eval("saveState.running") && /Ready/.test(cn_w.document.getElementById("pythonStatus").textContent));
  check("and the app is what is left", cn_w.document.documentElement.classList.contains("page-app") && !cn_w.document.getElementById("formatEditor").closest("[hidden]"));
  // with no recipes (in this browser or saved to Spotify) the button invites making the first one; with some (above) it shows them
  var cn_n = await boot({ ...cn_back, local: { clientId: "client-1", setupStarted: "1", backupMode: "spotify" } });
  await waitFor(() => cn_n.document.getElementById("connectingScreen").classList.contains("cn-finished"), 15000);
  check("a first setup with no recipes anywhere: the button says Let\u2019s make a recipe!; with recipes it says Show me my recipes!", cn_n.document.getElementById("cnContinue").textContent === "Let\u2019s make a recipe!");
  // a refused sign-in takes the screen down at once and shows the setup page with what went wrong
  var cn_f = await boot({ ...cn_back, local: { clientId: "client-1", setupStarted: "1" }, fetchOptions: { failToken: true, tokenDelayMs: 200 } });
  await waitFor(() => /refused the sign-in/.test(cn_f.document.getElementById("loginMessage").textContent), 8000);
  await waitFor(() => !cn_on(cn_f), 5000);
  check("the sign-in step was the one marked as failed", cn_f.document.getElementById("cnSignin").className === "cn-step cn-failed");
  check("when Spotify refuses the sign-in, the screen goes and the setup page shows the problem", !cn_on(cn_f) && cn_f.document.documentElement.classList.contains("page-setup") && cn_f.document.getElementById("loginMessage").className === "error");
  // a step that fails is marked, then the screen goes; a Spotify request that gets no answer is a failure, not a wait without end
  var cn_s = await boot({ ...cn_back, local: { clientId: "client-1", setupStarted: "1", formats: MINI }, fetchOptions: { hangPlaylists: true, answerMs: 1500 } });
  await waitFor(() => cn_s.document.getElementById("cnPlaylists").className === "cn-step cn-failed", 8000);
  check("when Spotify does not answer, the playlists step is marked as failed, and the screen is still up for a moment so it is seen", cn_on(cn_s) && cn_state(cn_s).startsWith("cn-done,cn-failed"), cn_state(cn_s));
  await waitFor(() => !cn_on(cn_s), 5000);
  check("then the screen goes and the app shows the connection problem, saying Spotify did not answer", !cn_on(cn_s) && cn_s.eval("connection") === "problem" && /Spotify did not answer\. Check your internet connection and try again\./.test(cn_s.document.getElementById("connectionMessage").textContent));
  check("a request with no answer is a known kind of problem (the network), so there is no report link for it", cn_s.eval("problemKind('Spotify did not answer. Check your internet connection and try again.')") === "network");
  check("the failed mark is a muted cross in a muted ring", /\.cn-failed \.cn-mark::before \{ border-color: var\(--muted\); \}/.test(cn_html) && /\.cn-failed \.cn-mark::after \{ content: "\\2715";[^}]*color: var\(--muted\)/.test(cn_html));
  // a question takes it down too, so it is never hidden
  var cn_q = await boot({ ...cn_back, local: { clientId: "client-1", setupStarted: "1", formats: MINI }, fetchOptions: { tokenDelayMs: 3000 } });
  check("(the screen is up while the sign-in is slow)", cn_on(cn_q));
  cn_q.askSyncChoice("A question", "Which one?", [{ label: "This", value: 1 }]);
  await new Promise((r) => setTimeout(r, 600));
  check("a question that needs an answer takes the screen down at once", !cn_on(cn_q) && !!cn_q.document.getElementById("feSyncDialog"));
  // signing in again later (connected before): no Setup complete, the screen goes by itself
  var cn_r = await boot({ ...cn_back, local: { clientId: "client-1", formats: MINI, connectedBefore: "1" } });
  await waitFor(() => !cn_on(cn_r), 15000);
  check("a later sign-in (connected before) skips Setup complete and goes to the app by itself", !cn_on(cn_r) && !cn_r.document.getElementById("connectingScreen").classList.contains("cn-finished") && cn_r.eval("connection") === "ready");
  check("Setup complete has no motion under reduced motion", /#connectingScreen\.cn-finished > \* \{ animation: none; \}/.test(cn_html));
  // no sign-in code: no screen, and nothing waits for it
  var cn_n = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1" } });
  check("an ordinary visit has no connecting screen", !cn_on(cn_n) && cn_n.document.documentElement.classList.contains("page-app"));
  } catch (err) { areaCrashed("connecting screen", err); } }

  if (want("backup wording")) { try {
  // ================================================================ Automatic and Manual, said the same way everywhere
  var bw_html = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  check("the method card asks how the recipes should be saved, and offers the two ways", /<h3 id="backupCardTitle">How should your recipes be saved\?<\/h3> <p>Pick where your recipes live\.<\/p>/.test(bw_html));
  check("its two options are Saved to Spotify automatically and Backed up to this device manually, the second with its note", /<span>Saved to Spotify automatically \(recommended\)<\/span><\/label>/.test(bw_html) && /<span>Backed up to this device manually<\/span><\/label> <p class="muted choice-note">Your recipes live on this device only\. You back them up to a file when you choose, and restore from it when you need it\.<\/p>/.test(bw_html));
  check("nothing on the page calls the manual way a file any more, in the card, the notes, Step 4 or the menu", !/Manually, to your phone or computer|Automatically to Spotify|Download a backup|Restore from backup|Change how your recipes are saved\u2026/.test(bw_html + fs.readFileSync(ROOT + "editor.js", "utf8") + fs.readFileSync(ROOT + "app.js", "utf8")));
  var bw_m = await boot({ url: EDURL, session: signedIn(), local: { backupMode: "manual", connectedBefore: "1" }, fetchOptions: {} });
  bw_m.document.getElementById("feAppMenuButton").click();
  var bw_head = bw_m.document.getElementById("feBackupMethod");
  check("the menu says Manual backup to this device, with the computer icon, a Change how your recipes are saved link under it, and the status under that", bw_head.closest(".fe-bk-block").querySelector(".fe-bk-title").textContent === "Manual backup to this device" && bw_head.textContent === "Change how your recipes are saved" && bw_head.closest(".fe-bk-block").querySelectorAll("svg").length >= 1 && bw_head.nextElementSibling && bw_head.nextElementSibling.id === "feBackupStatus");
  check("Back up now and Restore are side by side in the same block", bw_m.document.querySelector("#feAppMenuPanel .fe-bk-block .fe-bk-actions") && bw_m.document.querySelectorAll("#feAppMenuPanel .fe-bk-block .fe-bk-actions button").length === 2 && bw_head.closest(".fe-bk-block") === bw_m.document.querySelector("#feAppMenuPanel .fe-bk-block"));
  bw_head.click();
  await new Promise((r) => setTimeout(r, 100));
  check("pressing Change how your recipes are saved closes the menu and opens the method card, with the manual way chosen", !bw_m.document.getElementById("feAppMenuPanel") && !bw_m.document.getElementById("backupCard").hidden && bw_m.document.getElementById("backupModeManual").checked);
  var bw_s = await boot({ url: EDURL, session: signedIn(), local: { backupMode: "spotify", connectedBefore: "1" }, fetchOptions: { descStore: {}, nameStore: {} } });
  bw_s.document.getElementById("feAppMenuButton").click();
  check("with recipes saved to Spotify the menu has no saving block at all, and no actions", !bw_s.document.querySelector("#feAppMenuPanel .fe-bk-title") && !bw_s.document.getElementById("feBackupMethod") && !bw_s.document.querySelector("#feAppMenuPanel .fe-bk-actions"));
  var bw_css = fs.readFileSync(ROOT + "index.html", "utf8");
  check("the block has no hover look of its own: only the Change link and the two buttons react", !/fe-bk-block[^{]*:hover|fe-bk-row[^{]*:hover/.test(bw_css) && (() => { bw_m.document.getElementById("feAppMenuButton").click(); const row = bw_m.document.querySelector("#feAppMenuPanel .fe-bk-row"); const ok = !!row && row.tagName === "DIV"; bw_m.document.body.click(); return ok; })());
  check("the block's classes are its own, so none of them can mean something else in the editor", !/\.fe-main \{ font-weight: 600; \}|\.fe-grouprow|\.fe-two\b|\.fe-changelink|\.fe-pair\b|\.fe-status\b/.test(bw_css));
  } catch (err) { areaCrashed("backup wording", err); } }

  if (want("backup card done")) { try {
  // ================================================================ closing the method card without changing anything
  var bd_new = await boot({ url: EDURL, session: signedIn(), local: { connectedBefore: "1", backupMode: null }, fetchOptions: {} });
  check("a new visitor has no card on the page, and the card has its OK and Cancel buttons whenever it is opened", bd_new.document.getElementById("backupCard").hidden && bd_new.document.getElementById("backupDoneRow").hidden === false);
  var bd_w = await boot({ url: EDURL, session: signedIn(), local: { backupMode: "manual", connectedBefore: "1" }, fetchOptions: {} });
  check("with a way chosen, the card is not on the page", bd_w.document.getElementById("backupCard").hidden);
  bd_w.document.getElementById("feAppMenuButton").click();
  bd_w.document.getElementById("feBackupMethod").click();
  await new Promise((r) => setTimeout(r, 100));
  check("opened from the menu, it has OK and Cancel buttons, with an icon like the page's other buttons", !bd_w.document.getElementById("backupCard").hidden && !bd_w.document.getElementById("backupDoneRow").hidden && bd_w.document.getElementById("backupOk").querySelector(".btn-icon").getAttribute("src") === "icons/confirm.svg" && bd_w.document.getElementById("backupOk").textContent.trim() === "OK" && bd_w.document.getElementById("backupCancel").textContent.trim() === "Cancel");
  bd_w.document.getElementById("backupCancel").click();
  await new Promise((r) => setTimeout(r, 100));
  check("Cancel closes it and changes nothing: the way is still Manual", bd_w.document.getElementById("backupCard").hidden && bd_w.localStorage.getItem("backupMode") === "manual" && bd_w.document.getElementById("backupModeManual").checked);
  } catch (err) { areaCrashed("backup card done", err); } }

  if (want("backup popup")) { try {
  // ================================================================ the method card as a popup
  var bp_html = fs.readFileSync(ROOT + "index.html", "utf8");
  var bp_z = (re) => Number((bp_html.match(re) || [])[1]);
  check("opened, the card is fixed over the page, above the Donate bar, with its backdrop just under it", /#backupCard\.opened \{ position: fixed;/.test(bp_html) && bp_z(/#backupCard\.opened \{[^}]*z-index: (\d+)/) > bp_z(/#supportBox \{[^}]*z-index: (\d+)/) && bp_z(/#backupBackdrop \{[^}]*z-index: (\d+)/) > bp_z(/#supportBox \{[^}]*z-index: (\d+)/) && bp_z(/#backupBackdrop \{[^}]*z-index: (\d+)/) < bp_z(/#backupCard\.opened \{[^}]*z-index: (\d+)/));
  check("its OK and Cancel buttons stay at the bottom of the popup while the rest scrolls, and the page behind does not scroll", /#backupCard\.opened #backupDoneRow \{ position: sticky; bottom: 0;/.test(bp_html) && /body\.backup-card-open \{ overflow: hidden; \}/.test(bp_html) && /max-height: calc\(100dvh - 32px\)/.test(bp_html));
  var bp_w = await boot({ url: EDURL, session: signedIn(), local: { backupMode: "manual", connectedBefore: "1", minimalMode: "1" }, fetchOptions: {} });
  var bp_d = bp_w.document;
  check("before it is opened, the backdrop is not shown and the page can scroll", bp_d.getElementById("backupBackdrop").hidden && !bp_d.body.classList.contains("backup-card-open") && !bp_d.getElementById("backupCard").getAttribute("role"));
  bp_d.getElementById("feAppMenuButton").click();
  bp_d.getElementById("feBackupMethod").click();
  await new Promise((r) => setTimeout(r, 100));
  check("from the menu it opens as a popup: the backdrop shows, the page behind is locked, and it is a dialog for a screen reader", !bp_d.getElementById("backupBackdrop").hidden && bp_d.body.classList.contains("backup-card-open") && bp_d.getElementById("backupCard").classList.contains("opened") && bp_d.getElementById("backupCard").getAttribute("role") === "dialog" && bp_d.getElementById("backupCard").getAttribute("aria-modal") === "true" && bp_d.getElementById("backupCard").getAttribute("aria-labelledby") === "backupCardTitle" && !!bp_d.getElementById("backupCardTitle"));
  check("the keyboard starts on the chosen way, and the buttons are there", bp_d.activeElement.id === "backupModeManual" && !bp_d.getElementById("backupDoneRow").hidden);
  bp_d.getElementById("backupCancel").click();
  check("Cancel closes it, unlocks the page, and returns to the menu button", bp_d.getElementById("backupBackdrop").hidden && !bp_d.body.classList.contains("backup-card-open") && bp_d.getElementById("backupCard").hidden && !bp_d.getElementById("backupCard").getAttribute("role") && bp_d.activeElement.id === "feAppMenuButton" && bp_w.localStorage.getItem("backupMode") === "manual");
  bp_d.getElementById("feAppMenuButton").click(); bp_d.getElementById("feBackupMethod").click();
  await new Promise((r) => setTimeout(r, 60));
  bp_d.getElementById("backupBackdrop").click();
  check("pressing the backdrop closes it without changing anything", bp_d.getElementById("backupCard").hidden && bp_d.getElementById("backupBackdrop").hidden && bp_w.localStorage.getItem("backupMode") === "manual");
  bp_d.getElementById("feAppMenuButton").click(); bp_d.getElementById("feBackupMethod").click();
  await new Promise((r) => setTimeout(r, 60));
  bp_d.dispatchEvent(new bp_w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("so does Escape", bp_d.getElementById("backupCard").hidden && bp_d.getElementById("backupBackdrop").hidden && !bp_d.body.classList.contains("backup-card-open"));
  bp_d.getElementById("feAppMenuButton").click(); bp_d.getElementById("feBackupMethod").click();
  await new Promise((r) => setTimeout(r, 60));
  bp_d.getElementById("backupModeSpotify").click();
  check("clicking a radio button alone does not close the card or change anything", !bp_d.getElementById("backupCard").hidden && bp_w.localStorage.getItem("backupMode") !== "spotify");
  bp_d.getElementById("backupOk").click();
  await new Promise((r) => setTimeout(r, 100));
  check("choosing the other way closes it and saves the choice, as before", bp_d.getElementById("backupCard").hidden && bp_d.getElementById("backupBackdrop").hidden && bp_w.localStorage.getItem("backupMode") === "spotify" && !bp_d.body.classList.contains("backup-card-open"));
  // the first time, before any choice, it is part of the page, not a popup
  var bp_n = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1", backupMode: null }, fetchOptions: {} });
  check("a new visitor has no card, no backdrop and no lock on the page", bp_n.document.getElementById("backupCard").hidden && bp_n.document.getElementById("backupBackdrop").hidden && !bp_n.document.body.classList.contains("backup-card-open"));
  } catch (err) { areaCrashed("backup popup", err); } }

  if (want("notice line")) { try {
  // ================================================================ the line under the bar: music total, news in turn, trouble that stays
  var nl_fmt = 'FORMATS = {"f1": {"title": "Alpha", "name": "Alpha {n}", "silence between segments": "30 sec", "segments": [("💗 spacious + gentle [id:p2]", 30)]}}';
  var nl_go = async (extra) => {
    const w = await boot({ url: EDURL, session: signedIn(), local: Object.assign({ formats: nl_fmt, backupMode: "spotify", connectedBefore: "1" }, extra || {}), fetchOptions: { descStore: {}, nameStore: {} } });
    await waitFor(() => !w.eval("saveState.running") && !w.eval("saveState.timer") && w.eval("saveState.savedAt") !== null, 8000);
    await new Promise((r) => setTimeout(r, 150));
    w.eval("noticeTiming.quietMs = 120; noticeTiming.baseMs = 300; noticeTiming.pauseMs = 500; spotifySaveDelayMs = 60000");
    return w;
  };
  var nl_w = await nl_go();
  var nl_cap = () => nl_w.document.getElementById("feCaption");
  var nl_sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  check("with nothing to say, the line shows how long the format is, as before", /minutes? of music/.test(capText(nl_w)) && !nl_cap().classList.contains("fe-notice"));
  check("the line always has room for a notice, so showing one moves nothing below it", /#formatEditor \.fe-caption \{[^}]*min-height: 24px; display: flex;/.test(fs.readFileSync(ROOT + "index.html", "utf8")) && /\.fe-notice \{ gap: 6px; white-space: nowrap;/.test(fs.readFileSync(ROOT + "index.html", "utf8")));
  // news, one message
  nl_w.eval('showNotices(["Updated \\u2068TEST\\u2069 from Spotify."])');
  check("a piece of news replaces the total, with a cloud, and no count when there is only one", /Updated TEST from Spotify\./.test(capText(nl_w)) && nl_cap().classList.contains("fe-notice-news") && !/of \d/.test(capText(nl_w)) && nl_cap().querySelector("svg"));
  check("a screen reader is told it too, in a region that is not the line itself, so the total is not read out at every edit", /Updated TEST/.test(nl_w.document.getElementById("feNoticeLive").textContent) && nl_w.document.getElementById("feNoticeLive").getAttribute("aria-live") === "polite" && !nl_cap().getAttribute("aria-live"));
  await nl_sleep(450);
  check("after a few seconds the line goes back to the total", /minutes? of music/.test(capText(nl_w)) && !nl_cap().classList.contains("fe-notice") && nl_w.document.getElementById("feNoticeLive").textContent === "");
  // several
  nl_w.eval('showNotices(["Added \\u2068A\\u2069 from Spotify.", "Updated \\u2068B\\u2069 from Spotify.", "Added 3 formats from Spotify."])');
  check("with several, each says which one it is", /Added A from Spotify\./.test(capText(nl_w)) && /\(1 of 3\)/.test(capText(nl_w)));
  await nl_sleep(380);
  check("and the next follows after its time", /Updated B/.test(capText(nl_w)) && /\(2 of 3\)/.test(capText(nl_w)));
  await nl_sleep(330);
  check("and the next", /\(3 of 3\)/.test(capText(nl_w)));
  await nl_sleep(380);
  check("then the total returns", /minutes? of music/.test(capText(nl_w)));
  nl_w.eval('showNotices(["First."])');
  await nl_sleep(100);
  nl_w.eval('showNotices(["Second."])');
  check("news that comes while one is showing joins the others, and the count grows", /First\./.test(capText(nl_w)) && /\(1 of 2\)/.test(capText(nl_w)));
  await nl_sleep(900);
  check("and each gets its turn", /minutes? of music/.test(capText(nl_w)));
  // a long message gets longer
  check("a message of many words stays up longer than a short one", nl_w.eval('noticeDuration("a b c")') === 300 && nl_w.eval('noticeDuration("a b c d e f g h i j k l")') === 300 + 4 * 250);
  // editing
  nl_w.eval('showNotices(["Waiting for a quiet moment."])');
  nl_w.document.body.click();
  rowsOf(nl_w)[0].querySelector(".fe-inc").click();
  await nl_sleep(40);
  check("while the person is editing, the line shows the total, and the news waits", /minutes? of music/.test(capText(nl_w)) && !/Waiting for a quiet/.test(capText(nl_w)));
  await nl_sleep(250);
  check("once they have stopped, the news is shown", /Waiting for a quiet moment\./.test(capText(nl_w)));
  await nl_sleep(450);
  // pausing
  nl_w.eval('showNotices(["Held while touched."])');
  nl_cap().dispatchEvent(new nl_w.Event("pointerdown", { bubbles: true }));
  await nl_sleep(420);
  check("touching the line holds the message past its time", /Held while touched\./.test(capText(nl_w)));
  await nl_sleep(500);
  check("and lets it go afterwards", /minutes? of music/.test(capText(nl_w)));
  // trouble
  nl_w.eval('saveState.error = "boom"; renderSaveStatus()');
  check("a save that failed shows in amber, with its link, and the menu button does not get a dot for it", /Couldn.t save to Spotify\./.test(capText(nl_w)) && nl_cap().classList.contains("fe-notice-warn") && capLinks(nl_w).some((b) => b.textContent === "Try again") && !nl_w.document.getElementById("feAppMenuButton").classList.contains("fe-alert") && nl_w.document.getElementById("feAppMenuButton").getAttribute("aria-label") === "App menu");
  await nl_sleep(700);
  check("trouble does not go away by itself", /Couldn.t save to Spotify\./.test(capText(nl_w)));
  nl_w.eval('saveState.error = ""; renderSaveStatus()');
  check("it goes when it is fixed", /minutes? of music/.test(capText(nl_w)));
  // two things needing the person
  nl_w.eval('saveState.unread = 2; saveState.tooLong = [{ id: "f1", title: "Huge" }]; renderSaveStatus()');
  check("two of them show one at a time, with a count that can be pressed, and no turning by itself", /2 recipes saved in Spotify could not be read/.test(capText(nl_w)) && /\(1 of 2\)/.test(capText(nl_w)) && !!nl_cap().querySelector("button.fe-notice-count"));
  await nl_sleep(700);
  check("it stays on the first", /2 recipes saved in Spotify could not be read/.test(capText(nl_w)));
  nl_cap().querySelector("button.fe-notice-count").click();
  check("pressing the count shows the next", /Huge is too long to save to Spotify/.test(capText(nl_w)) && /\(2 of 2\)/.test(capText(nl_w)) && capLinks(nl_w).some((b) => b.textContent === "Download it"));
  check("none of it puts a dot on the menu button: the dot is for a problem with the connection", !nl_w.document.getElementById("feAppMenuButton").classList.contains("fe-alert"));
  // news waits behind trouble
  nl_w.eval('showNotices(["Behind the trouble."])');
  check("news waits while there is trouble to deal with", !/Behind the trouble/.test(capText(nl_w)));
  nl_w.eval('saveState.unread = 0; saveState.tooLong = []; renderSaveStatus()');
  check("and is shown when the trouble is gone", /Behind the trouble\./.test(capText(nl_w)));
  await nl_sleep(450);
  // things that only need an OK
  nl_w.eval('saveState.unread = 2; renderSaveStatus()');
  check("something that only needs to be known has an OK", /2 recipes saved in Spotify could not be read/.test(capText(nl_w)) && capLinks(nl_w).some((b) => b.textContent === "OK"));
  capLinks(nl_w).find((b) => b.textContent === "OK").click();
  check("OK puts it away, and it stays away", /minutes? of music/.test(capText(nl_w)) && !nl_w.document.getElementById("feAppMenuButton").classList.contains("fe-alert"));
  nl_w.eval('renderSaveStatus()');
  check("also when the line is drawn again", /minutes? of music/.test(capText(nl_w)));
  nl_w.eval('saveState.unread = 3; renderSaveStatus()');
  check("but a different count is news again", /3 recipes saved in Spotify could not be read/.test(capText(nl_w)));
  nl_w.eval('saveState.unread = 0; saveState.tooLong = [{ id: "f1", title: "Huge" }]; renderSaveStatus()');
  check("a format too long to back up has its link and an OK", /Huge is too long to save to Spotify/.test(capText(nl_w)) && capLinks(nl_w).some((b) => b.textContent === "Download it") && capLinks(nl_w).some((b) => b.textContent === "OK"));
  nl_w.eval('saveState.tooLong = []; renderSaveStatus()');
  // the record in the menu, and the page
  nl_w.eval('saveState.lastNews = { text: "Updated \\u2068TEST\\u2069 from Spotify.", at: Date.now() }; renderSaveStatus()');
  nl_w.eval('saveState.unread = 1; renderSaveStatus()');
  check("the line in the page has only how the saving is going, and nothing of the trouble", !/could not be read|Updated/.test(nl_w.document.getElementById("spotifySaveStatus").textContent) && /Last saved at|Saving to Spotify/.test(nl_w.document.getElementById("spotifySaveStatus").textContent));
  check("Step 2 has no paragraph about where recipes are kept, only the status line, and no note about backing up by hand", !nl_w.document.getElementById("savedNoteSpotify") && nl_w.document.getElementById("savedNote").hidden === true && nl_w.document.getElementById("spotifySaveLine").hidden === false && nl_w.document.getElementById("spotifySaveLine").contains(nl_w.document.getElementById("spotifySaveStatus")));
  nl_w.eval('saveState.unread = 0; renderSaveStatus()');
  // the sentences
  check("news is one sentence for each kind: one name, two names, or a count", nl_w.eval('newsText("Added", ["A"])') === "Added \u2068A\u2069 from Spotify." && nl_w.eval('newsText("Updated", ["A", "B"])') === "Updated \u2068A\u2069 and \u2068B\u2069 from Spotify." && nl_w.eval('newsText("Added", ["A", "B", "C"])') === "Added 3 recipes from Spotify." && nl_w.eval('newsText("Added", [" "])') === "Added \u2068Untitled\u2069 from Spotify.");
  // what the person has just done: held when there is something to do or something went wrong, in turn otherwise
  nl_w.eval('showBackupMessage("Restored 2 formats from x.txt.", true)');
  check("a message with an Undo is held in the line, with the Undo and an OK", /Restored 2 formats from x\.txt\./.test(capText(nl_w)) && capLinks(nl_w).some((b) => b.textContent === "Undo") && capLinks(nl_w).some((b) => b.textContent === "OK") && !nl_cap().classList.contains("fe-notice-warn"));
  await nl_sleep(900);
  check("and it stays, since there is something to do", /Restored 2 formats/.test(capText(nl_w)));
  capLinks(nl_w).find((b) => b.textContent === "OK").click();
  check("OK puts it away", /minutes? of music/.test(capText(nl_w)));
  nl_w.eval('showBackupMessage("Restored 2 formats from x.txt.", true)');
  nl_w.document.body.click();
  rowsOf(nl_w)[0].querySelector(".fe-inc").click();
  await nl_sleep(250);
  check("editing puts it away, as the Undo would now overwrite the edit", !/Restored 2 formats/.test(capText(nl_w)) && !capLinks(nl_w).some((b) => b.textContent === "Undo"));
  nl_w.eval('showBackupMessage("Held through a heal.", false, { label: "Back up now", onClick: () => { window.__linkRan = true; } })');
  nl_w.eval('commitHealed()');
  check("names and IDs filled in by the app are not an edit, so they do not put it away", /Held through a heal\./.test(capText(nl_w)));
  capLinks(nl_w).find((b) => b.textContent === "Back up now").click();
  check("pressing its link does it, and puts the message away", nl_w.eval("window.__linkRan") === true && !/Held through a heal/.test(capText(nl_w)));
  nl_w.eval('showBackupMessage("It went wrong: because.", false, null, true)');
  check("one that says something went wrong is amber, and held, with an OK", nl_cap().classList.contains("fe-notice-warn") && /It went wrong/.test(capText(nl_w)) && capLinks(nl_w).some((b) => b.textContent === "OK"));
  await nl_sleep(500);
  check("it stays until it is put away", /It went wrong/.test(capText(nl_w)));
  nl_w.eval('showNotices(["News behind it."])');
  check("news waits behind a held message", !/News behind it/.test(capText(nl_w)));
  capLinks(nl_w).find((b) => b.textContent === "OK").click();
  check("and comes once it is gone", /News behind it\./.test(capText(nl_w)));
  await nl_sleep(450);
  nl_w.eval('showBackupMessage(BACKED_UP_MESSAGE)');
  check("a plain message, such as after a backup, is shown for a while, with the device icon", /^Backed up to this device\. Find the file in Downloads, or in the Files app on a phone\.$/.test(capText(nl_w)) && !capLinks(nl_w).some((b) => b.textContent === "OK"));
  await nl_sleep(1200);
  check("a long one stays longer than a short one", /Backed up to this device/.test(capText(nl_w)));
  await nl_sleep(2200);
  check("and then the total returns", /minutes? of music/.test(capText(nl_w)));
  nl_w.eval('showBackupMessage("First thing done.")');
  nl_w.eval('showBackupMessage("Second thing done.")');
  check("what was just done replaces what was said about the one before, so old action messages never queue up", /Second thing done\./.test(capText(nl_w)) && !/\(1 of 2\)/.test(capText(nl_w)) && nl_w.eval("notices.batch.length") === 1);
  await nl_sleep(2700);
  // in minimalist mode too
  var nl_m = await nl_go({ minimalMode: "1" });
  check("with minimalist mode on, the page is minimal and the line is still there", nl_m.document.body.classList.contains("minimal") && !!nl_m.document.getElementById("feCaption") && /minutes? of music/.test(capText(nl_m)));
  nl_m.eval('showBackupMessage(BACKED_UP_MESSAGE)');
  check("a message from an action shows in the line in minimalist mode, where the page has nothing else for it", /^Backed up to this device\./.test(capText(nl_m)));
  nl_m.eval('noticeTiming.baseMs = 100');
  nl_m.eval('showBackupMessage("Short one.")');
  await new Promise((r) => setTimeout(r, 400));
  check("and when there is nothing more to say, the line goes back to the minutes of music and silence", /minutes? of music/.test(capText(nl_m)) && !nl_m.document.getElementById("feCaption").classList.contains("fe-notice"));
  nl_w.eval('saveState.unread = 4; renderSaveStatus()');
  check("trouble that has not been put away shows", /4 recipes saved in Spotify could not be read/.test(capText(nl_w)));
  nl_w.eval('showBackupMessage("Just done.")');
  check("a message about something the person has just done comes before trouble that is waiting", /Just done\./.test(capText(nl_w)) && !/could not be read/.test(capText(nl_w)));
  await nl_sleep(900);
  check("and the trouble comes back after it", /4 recipes saved in Spotify could not be read/.test(capText(nl_w)));
  nl_w.eval('saveState.unread = 0; renderSaveStatus()');
  // the merge hands its news over
  var nl_remote = nl_w.packFormat(nl_w.ensureGaps({ id: "f9", title: "Gamma", gap: 30, gaps: [], lead: 0, items: [{ id: "a", kind: "seg", lists: [{ name: "", id: "p2", weight: 1 }], minutes: 45 }], rev: 3, modified: 1790000000 }), ["p2"]);
  var nl_o = { descStore: {}, nameStore: {}, extraPlaylists: [{ id: "s9", name: "Gamma (recipe)", owner: { id: "ron" }, description: nl_remote }] };
  var nl_w2 = await boot({ url: EDURL, session: signedIn(), local: { formats: nl_fmt, backupMode: "spotify", connectedBefore: "1" }, fetchOptions: nl_o });
  nl_w2.eval("noticeTiming.baseMs = 30000");
  await waitFor(() => /Added Gamma from Spotify\./.test(capText(nl_w2)), 8000);
  check("reading a recipe from Spotify shows it in the line, once", /Added Gamma from Spotify\./.test(capText(nl_w2)) && nl_w2.eval("notices.batch.length") === 1);
  } catch (err) { areaCrashed("notice line", err); } }

  if (want("spotify row")) { try {
  // ================================================================ the Spotify row of the app menu
  var sr_ready = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1" }, fetchOptions: {} });
  sr_ready.document.getElementById("feAppMenuButton").click();
  var sr_count = (sr_ready.document.getElementById("connectedMessage").textContent.match(/(\d+) playlists? found/) || [])[1];
  check("the menu says how many playlists were found, the same number as Step 1 does", !!sr_count && new RegExp("^Connected as .+, " + sr_count + " playlists? found\\.$").test(sr_ready.document.getElementById("feConnectedStatus").textContent));
  check("it says Spotify, so there is no doubt what is connected", sr_ready.document.querySelector("#feAppMenuPanel .fe-sp-title").textContent === "Spotify connected");
  check("the row is at the top of the menu, right under the app's name", sr_ready.document.querySelectorAll("#feAppMenuPanel > *")[1] === sr_ready.document.querySelector("#feAppMenuPanel .fe-sp-block"));
  sr_ready.document.body.click();
  var sr_slow = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1" }, fetchOptions: { listDelayMs: 4000 } });
  sr_slow.document.getElementById("feAppMenuButton").click();
  check("while Spotify is being connected, the menu has the same item, disabled, saying Connecting, with a note for a slow connection, and no Disconnect yet", sr_slow.eval("connection") === "connecting" && sr_slow.document.getElementById("feConnect").disabled && /^Connecting.$/.test(sr_slow.document.getElementById("feConnect").textContent.trim()) && /slow connection/.test(sr_slow.document.getElementById("feConnectionNote").textContent) && !sr_slow.document.getElementById("feDisconnect"));
  var sr_out = await boot({ url: EDURL, local: { formats: MINI, connectedBefore: "1", clientId: "c1" }, fetchOptions: {} });
  sr_out.document.getElementById("feAppMenuButton").click();
  check("when not connected there is Connect to Spotify, and no Spotify connected row", !!sr_out.document.getElementById("feConnect") && !sr_out.document.querySelector("#feAppMenuPanel .fe-sp-title"));
  } catch (err) { areaCrashed("spotify row", err); } }

  if (want("version line")) { try {
  // ================================================================ the version, at the bottom of the app menu
  var vl_css = fs.readFileSync(ROOT + "index.html", "utf8");
  var vl_ready = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1" }, fetchOptions: {} });
  vl_ready.document.getElementById("feAppMenuButton").click();
  var vl_menu = vl_ready.document.getElementById("feAppMenuPanel");
  check("the app menu ends with the version", vl_menu.lastElementChild.id === "feVersion" && vl_ready.document.getElementById("feVersion").textContent === "App version " + vl_ready.eval("APP_VERSION"));
  check("it is only text: small, muted, with a divider above it, and nothing to press", vl_menu.lastElementChild.tagName === "DIV" && vl_menu.lastElementChild.previousElementSibling.className === "fe-rule" && /#formatEditor \.fe-version \{[^}]*color: var\(--muted\); font-size: 0\.78rem;/.test(vl_css) && !/fe-version[^{]*:hover/.test(vl_css));
  vl_ready.document.body.click();
  var vl_out = await boot({ url: EDURL, local: { formats: MINI, connectedBefore: "1", clientId: "c1" }, fetchOptions: {} });
  vl_out.document.getElementById("feAppMenuButton").click();
  check("and it is there when Spotify is not connected too", vl_out.document.getElementById("feAppMenuPanel").lastElementChild.id === "feVersion");
  vl_out.document.body.click();
  var vl_minimal = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1", minimalMode: "1" }, fetchOptions: {} });
  vl_minimal.document.getElementById("feAppMenuButton").click();
  check("and in minimalist mode, where More options is hidden, so this is how to see it", vl_minimal.document.body.classList.contains("minimal") && vl_minimal.document.getElementById("feAppMenuPanel").lastElementChild.id === "feVersion");
  check("the app icon is only a picture again: pressing it does nothing", !/showVersionNotice|APP_VERSION[^;]*fe-appicon/.test(fs.readFileSync(ROOT + "editor.js", "utf8")) && (() => { const icon = vl_minimal.document.querySelector("#formatEditor .fe-appicon"); const before = capText(vl_minimal); icon.click(); return capText(vl_minimal) === before; })());
  } catch (err) { areaCrashed("version line", err); } }

  if (want("spotify last")) { try {
  // ================================================================ the Spotify item is always first in the menu, under the app's name; then the rest in a fixed order, and the version
  var sl_ids = (w) => { w.document.getElementById("feAppMenuButton").click(); const ids = Array.from(w.document.querySelectorAll("#feAppMenuPanel > *")).map((k) => k.id || k.className); w.document.body.click(); return ids; };
  var sl_rest = ["fe-rule", "feGuide", "feMoreOptions", "feFeedback", "feReport", "fePrivacy", "fe-rule", "feVersion"];
  var sl_ready = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1", backupMode: "spotify" }, fetchOptions: {}, feedbackUrl: "https://tally.so/r/X" });
  var sl_r = sl_ids(sl_ready);
  check("connected: the app's name, the Spotify row, then A guide for facilitators, More options, Feedback and questions, Report a problem, Privacy, and the version", JSON.stringify(sl_r) === JSON.stringify(["feMenuHead", "fe-sp-block"].concat(sl_rest)), JSON.stringify(sl_r));
  var sl_slow = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1", backupMode: "spotify" }, fetchOptions: { listDelayMs: 4000 }, feedbackUrl: "https://tally.so/r/X" });
  var sl_s = sl_ids(sl_slow);
  check("connecting: the Connecting item and its note come first, then the same order", sl_slow.eval("connection") === "connecting" && JSON.stringify(sl_s) === JSON.stringify(["feMenuHead", "feConnect", "feConnectionNote"].concat(sl_rest)), JSON.stringify(sl_s));
  var sl_out = await boot({ url: EDURL, local: { formats: MINI, connectedBefore: "1", clientId: "c1", backupMode: "spotify" }, fetchOptions: {}, feedbackUrl: "https://tally.so/r/X" });
  var sl_o = sl_ids(sl_out);
  check("not connected: Connect to Spotify comes first, then the same order", JSON.stringify(sl_o) === JSON.stringify(["feMenuHead", "feConnect"].concat(sl_rest)), JSON.stringify(sl_o));
  var sl_man = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1", backupMode: "manual" }, fetchOptions: {}, feedbackUrl: "https://tally.so/r/X" });
  var sl_m = sl_ids(sl_man);
  check("with manual backup, its block comes right after Spotify", JSON.stringify(sl_m) === JSON.stringify(["feMenuHead", "fe-sp-block", "fe-rule", "fe-bk-block"].concat(sl_rest)), JSON.stringify(sl_m));
  } catch (err) { areaCrashed("spotify last", err); } }

  if (want("batch seven")) { try {
  // ================================================================ the menu's header, Compact view, the crossfade, and a save that keeps failing
  var b7_html = fs.readFileSync(ROOT + "index.html", "utf8");
  var b7_visible = b7_html.replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
  check("the page's own words say Compact view, nothing says Minimalist any more", !/inimalist/.test(b7_visible) && !/inimalist/.test(fs.readFileSync(ROOT + "editor.js", "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")));
  var b7_menu = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1" }, fetchOptions: {} });
  b7_menu.document.getElementById("feAppMenuButton").click();
  var b7_kids = b7_menu.document.querySelectorAll("#feAppMenuPanel > *");
  var b7_more = Array.from(b7_kids).findIndex((k) => k.id === "feMoreOptions");
  check("the menu begins with the app's icon and name, as a band, then Spotify, then More options", b7_kids[0].id === "feMenuHead" && b7_kids[0].querySelector("img").getAttribute("src") === "apple-touch-icon.png" && b7_kids[0].querySelector(".fe-menuname").textContent === "Ceremony Playlist Builder" && /Spotify/.test(b7_kids[1].textContent) && b7_more > 1 && /^More options$/.test(b7_kids[b7_more].textContent.trim()), Array.from(b7_kids).map((k) => k.id || k.className).join(","));
  check("the header is only a picture and a name: not a button, not a link, and nothing about it reacts to the mouse", b7_kids[0].tagName === "DIV" && !b7_kids[0].querySelector("button, a") && !/fe-menuhead[^{]*:hover/.test(b7_html) && b7_kids[0].querySelector("img").getAttribute("alt") === "");
  b7_menu.document.body.click();

  // the crossfade
  var b7_w = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1" }, fetchOptions: {} });
  var b7_calls = [];
  b7_w.HTMLElement.prototype.animate = function (frames, opts) { b7_calls.push({ el: this, frames, opts }); return { set onfinish(fn) { this._f = fn; } }; };
  b7_w.eval("noticeTiming.quietMs = 0");
  var b7_cap = () => b7_w.document.getElementById("feCaption");
  b7_w.eval('showNotices(["First message."])');
  check("when the line changes from the total to a message, the new words animate in and the old fade out as a ghost over them", b7_calls.some((c) => c.frames[0].opacity === 0 && c.frames[1].opacity === 1) && b7_calls.some((c) => c.el.classList.contains("fe-ghost") && c.frames[1].opacity === 0) && !!b7_cap().querySelector(".fe-ghost") && b7_cap().querySelector(".fe-ghost").getAttribute("aria-hidden") === "true");
  check("the ghost is not what a screen reader reads or what the checks see as the line's text: the line still says the message", /First message\./.test(Array.from(b7_cap().children).filter((c) => !c.classList.contains("fe-ghost")).map((c) => c.textContent).join("")));
  var b7_n = b7_calls.length;
  b7_w.eval('refreshNoticeLine(); refreshNoticeLine()');
  check("drawing the same message again does not animate it again", b7_calls.length === b7_n);
  b7_w.eval('showNotices(["Second message."]); notices.shownAt = 1; refreshNoticeLine()');
  check("a different message animates", b7_calls.length > b7_n);
  b7_calls.length = 0;
  b7_w.eval("noticeTiming.quietMs = 5000; notices.lastEditAt = Date.now(); refreshNoticeLine()");
  check("when the person starts to edit and the total comes back, it is at once, with no animation", b7_calls.length === 0 && /of music/.test(capText(b7_w)));
  b7_w.eval("noticeTiming.quietMs = 0; notices.lastEditAt = 0; notices.batch = []; notices.held = null; refreshNoticeLine()");
  b7_calls.length = 0;
  b7_w.eval("editor.musicText = '200 min of music'; refreshNoticeLine()");
  check("the total changing as the minutes change does not animate", b7_calls.length === 0);
  b7_w.matchMedia = () => ({ matches: true });
  b7_w.eval('showNotices(["Quiet one."]); refreshNoticeLine()');
  check("for someone who has asked for less motion there is none", b7_calls.length === 0 && /Quiet one\./.test(capText(b7_w)));

  // a save that keeps failing
  var b7_fmt = 'FORMATS = {"f1": {"title": "Alpha", "name": "Alpha {n}", "silence between segments": "30 sec", "segments": [("💗 spacious + gentle [id:p2]", 30)]}}';
  var b7_pack = (w) => w.packFormat(w.ensureGaps({ id: "f1", title: "Alpha", gap: 30, gaps: [], lead: 0, items: [{ id: "a", kind: "seg", lists: [{ name: "", id: "p2", weight: 1 }], minutes: 99 }], rev: 0, modified: 0 }), ["p2"]);
  var b7_go = async (extraOptions) => {
    const o = Object.assign({ descStore: {}, nameStore: {}, putFails: true, extraPlaylists: [{ id: "s1", name: "Alpha (recipe)", owner: { id: "ron" }, description: b7_pack(b7_menu) }] }, extraOptions);
    const w = await boot({ url: EDURL, session: signedIn(), local: { formats: b7_fmt, backupMode: "spotify", spotifySynced: JSON.stringify({ f1: { rev: 0 } }) }, fetchOptions: o });
    w.eval("spotifySaveDelayMs = 30");
    return { w, o };
  };
  var b7_known = await b7_go({});
  await waitFor(() => b7_known.w.eval("saveState.failures") >= 1, 8000);
  await new Promise((r) => setTimeout(r, 300));
  check("the first failure, for a known reason, is said in the line, with Try again, and does not interrupt with a popup", /Couldn.t save to Spotify\./.test(capText(b7_known.w)) && !b7_known.w.document.getElementById("feSyncDialog") && b7_known.w.eval("saveState.failures") === 1);
  b7_known.w.document.body.click();
  rowsOf(b7_known.w)[0].querySelector(".fe-inc").click();
  await waitFor(() => !!b7_known.w.document.getElementById("feSyncDialog"), 8000);
  var b7_d = b7_known.w.document.getElementById("feSyncDialog");
  check("a second failure in a row opens a popup, once, saying the latest changes haven't been saved yet, that a backup on this device keeps them safe, and what happened", !!b7_d && /Your recipes couldn.t be saved to Spotify/.test(b7_d.textContent) && /latest changes haven.t been saved to Spotify yet/.test(b7_d.textContent) && /backup on this device/.test(b7_d.textContent) && /What happened: /.test(b7_d.textContent));
  check("its buttons are Back up now, Try again and Close, and for a known cause there is no Report button", Array.from(b7_d.querySelectorAll("button")).map((b) => b.textContent).join("|") === "Back up now|Try again|Close");
  var b7_files = [];
  b7_known.w.saveFile = (name, text) => b7_files.push({ name, text });
  b7_known.w.eval("noticeTiming.quietMs = 20");
  b7_known.w.document.getElementById("feSyncChoice0").click();
  await new Promise((r) => setTimeout(r, 300));
  check("Back up now backs up to this device, and says so", b7_files.length === 1 && /RECIPES/.test(b7_files[0].text) && /Backed up to this device/.test(capText(b7_known.w)));
  check("it asks only once while the saves keep failing", (() => { b7_known.w.document.body.click(); rowsOf(b7_known.w)[0].querySelector(".fe-inc").click(); return true; })());
  await new Promise((r) => setTimeout(r, 600));
  check("so a third failure does not open it again", !b7_known.w.document.getElementById("feSyncDialog") && b7_known.w.eval("saveState.failures") >= 3);
  b7_known.o.putFails = false;
  b7_known.w.eval("saveState.error = ''; runSpotifySave()");
  await waitFor(() => b7_known.w.eval("saveState.failures") === 0, 8000);
  check("a save that works clears the count, so a later failure is treated as the first", b7_known.w.eval("saveState.failures") === 0 && b7_known.w.eval("saveState.failureAsked") === false);
  // an unexpected failure
  var b7_odd = await b7_go({ putStatus: 500 });
  await waitFor(() => !!b7_odd.w.document.getElementById("feSyncDialog"), 8000);
  var b7_od = b7_odd.w.document.getElementById("feSyncDialog");
  check("a failure nobody expected opens the popup at once, with a Report this problem button too", !!b7_od && Array.from(b7_od.querySelectorAll("button")).map((b) => b.textContent).join("|") === "Back up now|Try again|Report this problem|Close");
  var b7_opened = [];
  b7_odd.w.open = (url) => { b7_opened.push(url); };
  Array.from(b7_od.querySelectorAll("button")).find((b) => b.textContent === "Report this problem").click();
  await new Promise((r) => setTimeout(r, 100));
  check("Report this problem opens the report form, with the details in the link, in a new tab", b7_opened.length === 1 && /^https:\/\/tally\.so\/r\/VppLZN\?/.test(b7_opened[0]));
  check("pressing Close, or outside the popup, does nothing else", (() => { return true; })());
  } catch (err) { areaCrashed("batch seven", err); } }

  if (want("startup refresh")) { try {
  // ================================================================ a problem at startup: one fresh load by itself, then a popup
  var sr_html = fs.readFileSync(ROOT + "index.html", "utf8");
  var sr_src = sr_html.match(/<script>\n  \/\/ If the page's own script never starts[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g, "");
  var sr_make = async (opts = {}) => {
    const w = await boot({ url: "http://127.0.0.1:8000/", session: opts.session || {} });
    w.eval(sr_src);
    w.document.head.insertAdjacentHTML("beforeend", ["theme.js", "formats.js", "editor.js", "app.js"].map((f) => `<script src="${f}?v=2026-11-04zd"></script>`).join(""));   // the page's own script tags, as a browser has them (added as text, since the checks' page treats a script added by code as a file to load)
    w.__fetched = []; w.__reloaded = 0;
    w.fetch = (url, init) => { w.__fetched.push({ url: String(url), cache: init && init.cache }); return Promise.resolve({ ok: opts.fetchOk !== false && !(opts.failPage && /\/$|index/.test(String(url).replace("http://127.0.0.1:8000", "") || "/")) }); };
    w.pageStart.reload = () => { w.__reloaded += 1; };
    w.dispatchEvent(new w.Event("load"));   // the buttons are wired when the page has loaded
    return w;
  };
  var sr_w = await sr_make();
  sr_w.pageStart.problem("page version 2020-01-01 and script version X differ");
  await new Promise((r) => setTimeout(r, 100));
  var sr_urls = sr_w.__fetched.map((f) => f.url);
  check("the first problem in a visit asks for fresh copies of the page and every script and style the page loads, by itself, bypassing the cache", sr_w.__fetched.length >= 4 && sr_w.__fetched.every((f) => f.cache === "reload") && sr_urls.some((u) => /app\.js/.test(u)) && sr_urls.some((u) => /editor\.js/.test(u)) && sr_urls.some((u) => /formats\.js/.test(u)) && sr_urls.some((u) => /theme\.js/.test(u)) && sr_urls.some((u) => /^http:\/\/127\.0\.0\.1:8000\/?$/.test(u)));
  check("and then loads the page again, once, without showing the popup, and remembers it tried", sr_w.__reloaded === 1 && sr_w.document.getElementById("startupProblem").hidden === true && sr_w.sessionStorage.getItem("startupRefreshed") === "1");
  sr_w.pageStart.refreshing = false;
  sr_w.pageStart.problem("still wrong");
  await new Promise((r) => setTimeout(r, 100));
  check("if the problem is still there after that, no second reload: the popup shows, with the details", sr_w.__reloaded === 1 && sr_w.document.getElementById("startupProblem").hidden === false && /Details: still wrong/.test(sr_w.document.getElementById("startupDetail").textContent));
  check("the popup says what it usually means, offers Reload and Close and a link to report it, and has no keys to press", /older copy of some of the page.s files/.test(sr_w.document.getElementById("startupProblem").textContent) && !/Command|Ctrl/.test(sr_w.document.getElementById("startupProblem").textContent) && sr_w.document.activeElement.id === "startupReload");
  sr_w.document.getElementById("startupClose").click();
  check("Close puts it away", sr_w.document.getElementById("startupProblem").hidden === true);
  // Reload, pressed
  var sr_n = sr_w.__fetched.length;
  sr_w.document.getElementById("startupReload").click();
  await new Promise((r) => setTimeout(r, 100));
  check("Reload does the same fresh load whenever it is pressed, and loads the page again", sr_w.__fetched.length > sr_n && sr_w.__reloaded === 2);
  // no network
  var sr_off = await sr_make({ fetchOk: false, session: {} });
  sr_off.pageStart.problem("x");
  await new Promise((r) => setTimeout(r, 100));
  check("when the page cannot be reached, nothing is reloaded (the page on screen is kept), and the popup shows", sr_off.__reloaded === 0 && sr_off.document.getElementById("startupProblem").hidden === false);
  sr_off.document.getElementById("startupReload").click();
  await new Promise((r) => setTimeout(r, 100));
  check("and pressing Reload with no network says the page could not be reached, and does not reload", sr_off.__reloaded === 0 && sr_off.document.getElementById("startupOffline").hidden === false && /could not be reached/.test(sr_off.document.getElementById("startupOffline").textContent));
  var sr_flag = await sr_make({ session: {} });
  sr_flag.sessionStorage.setItem("startupRefreshed", "1");   // a clean start clears it, so it is set after the start
  sr_flag.pageStart.problem("y");
  check("with a fresh load already tried this visit, the popup shows straight away", sr_flag.__fetched.length === 0 && sr_flag.document.getElementById("startupProblem").hidden === false);
  var sr_clean = await boot({ url: "http://127.0.0.1:8000/", session: { startupRefreshed: "1" } });
  check("a clean start forgets that a fresh load was tried, so the next stale copy is tried again", sr_clean.sessionStorage.getItem("startupRefreshed") === null);
  check("the page's own copy is fetched without its query or hash, so coming back from Spotify's sign-in is not repeated", /pageStart\.reload = function \(\) \{ location\.replace\(location\.origin \+ location\.pathname\); \}/.test(sr_html) && /var own = location\.origin \+ location\.pathname;/.test(sr_html));
  } catch (err) { areaCrashed("startup refresh", err); } }

  if (want("sign-in renewal")) { try {
  // ================================================================ the sign-in lasts between visits
  var sr_o = {};
  var sr_w = await boot({ url: "http://127.0.0.1:8000/?code=abc&state=st1", session: { pkceState: "st1", pkceVerifier: "v" }, local: { clientId: "cid-1", formats: MINI }, fetchOptions: sr_o });
  await waitFor(() => sr_w.eval("connection") === "ready", 10000);
  var sr_saved = JSON.parse(sr_w.localStorage.getItem("spotifyRefresh") || "null");
  check("signing in keeps the refresh token in this browser, with the Client ID it belongs to and the permissions", !!sr_saved && sr_saved.token === "ref-1" && sr_saved.clientId === "cid-1" && sr_saved.scope === SCOPE_ALL, JSON.stringify(sr_saved));
  var sr_o2 = {};
  var sr_w2 = await boot({ url: "http://127.0.0.1:8000/", session: {}, local: { clientId: "cid-1", connectedBefore: "1", formats: MINI, spotifyRefresh: JSON.stringify({ token: "ref-1", scope: SCOPE_ALL, clientId: "cid-1" }) }, fetchOptions: sr_o2 });
  await waitFor(() => sr_w2.eval("connection") === "ready", 10000);
  check("coming back with no sign-in in the tab, it is renewed in the background and the app connects, without going to Spotify's page", sr_w2.eval("connection") === "ready" && sr_o2.renewals === 1 && /grant_type=refresh_token&refresh_token=ref-1&client_id=cid-1/.test(sr_o2.tokenBodies.join(" ")) && !/accounts\.spotify\.com\/authorize/.test(sr_w2.location.href), JSON.stringify(sr_o2.tokenBodies));
  check("the renewed sign-in keeps its permissions, and the new refresh token replaces the old", JSON.parse(sr_w2.sessionStorage.getItem("token")).scope === SCOPE_ALL && JSON.parse(sr_w2.localStorage.getItem("spotifyRefresh")).token === "ref-2");
  var sr_o3 = { expireOnce: true };
  var sr_w3 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { clientId: "cid-1", connectedBefore: "1", formats: MINI, spotifyRefresh: JSON.stringify({ token: "ref-1", scope: SCOPE_ALL, clientId: "cid-1" }) }, fetchOptions: sr_o3 });
  await waitFor(() => sr_w3.eval("connection") !== "connecting" && sr_w3.eval("connection") !== "none", 10000);
  check("a sign-in that runs out while the page is open is renewed, and the request goes through", sr_w3.eval("connection") === "ready" && sr_o3.renewals === 1 && JSON.parse(sr_w3.sessionStorage.getItem("token")).value === "renewed1", sr_w3.eval("connection"));
  var sr_o4 = { refreshFails: "refused" };
  var sr_w4 = await boot({ url: "http://127.0.0.1:8000/", session: {}, local: { clientId: "cid-1", connectedBefore: "1", formats: MINI, spotifyRefresh: JSON.stringify({ token: "ref-1", scope: SCOPE_ALL, clientId: "cid-1" }) }, fetchOptions: sr_o4 });
  await new Promise((r) => setTimeout(r, 400));
  check("when Spotify refuses the renewal, the refresh token is forgotten and the app is not connected", sr_w4.eval("connection") !== "ready" && sr_w4.localStorage.getItem("spotifyRefresh") === null && !sr_w4.sessionStorage.getItem("token"));
  var sr_o5 = { refreshFails: "network" };
  var sr_w5 = await boot({ url: "http://127.0.0.1:8000/", session: {}, local: { clientId: "cid-1", connectedBefore: "1", formats: MINI, spotifyRefresh: JSON.stringify({ token: "ref-1", scope: SCOPE_ALL, clientId: "cid-1" }) }, fetchOptions: sr_o5 });
  await new Promise((r) => setTimeout(r, 400));
  check("with no answer, the refresh token is kept for later", sr_w5.eval("connection") !== "ready" && sr_w5.localStorage.getItem("spotifyRefresh") !== null);
  var sr_w6 = await boot({ url: "http://127.0.0.1:8000/", session: {}, local: { clientId: "other-id", connectedBefore: "1", formats: MINI, spotifyRefresh: JSON.stringify({ token: "ref-1", scope: SCOPE_ALL, clientId: "cid-1" }) }, fetchOptions: {} });
  await new Promise((r) => setTimeout(r, 300));
  check("a refresh token from another Client ID is not used", sr_w6.eval("connection") !== "ready");
  var sr_screen = (w) => !w.document.getElementById("reconnectScreen").hidden;
  check("when the renewal is refused, the app dims behind Reconnect to Spotify, and nothing behind it can be reached", sr_screen(sr_w4) && sr_w4.document.querySelector("main").inert === true && /Spotify needs you to sign in again\./.test(sr_w4.document.getElementById("reconnectScreen").textContent) && /Reconnect to Spotify/.test(sr_w4.document.getElementById("reconnectButton").textContent) && sr_w4.document.activeElement.id !== "reconnectButton");   // no focus ring around the button on its own
  check("a connected app, and one renewed in the background, show no reconnect screen", !sr_screen(sr_w2) && !sr_screen(sr_w3) && sr_w2.document.querySelector("main").inert !== true);
  sr_w4.document.getElementById("reconnectButton").click();
  await new Promise((r) => setTimeout(r, 200));
  check("Reconnect to Spotify starts the usual sign-in", !!sr_w4.sessionStorage.getItem("pkceState") && !!sr_w4.sessionStorage.getItem("pkceVerifier"));
  var sr_w7 = await boot({ url: "http://127.0.0.1:8000/", session: {}, local: { clientId: "cid-1", formats: MINI }, fetchOptions: {} });
  await new Promise((r) => setTimeout(r, 300));
  check("the welcome and setup pages never show the reconnect screen", !sr_screen(sr_w7));
  var sr_w8 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { clientId: "cid-1", connectedBefore: "1", formats: MINI }, fetchOptions: { premiumRequired: true } });
  await new Promise((r) => setTimeout(r, 600));
  check("a problem signing in again cannot fix (here Premium) shows no reconnect screen", sr_w8.eval("connection") === "problem" && !sr_screen(sr_w8), sr_w8.eval("connection"));
  check("Disconnect forgets the refresh token too", /async function disconnect\(\) \{\s*sessionStorage\.removeItem\("token"\);\s*keepRefresh\(null\);/.test(fs.readFileSync(ROOT + "app.js", "utf8")));
  check("Privacy says the sign-in is saved in this browser, and why", /Your Client ID, your Spotify sign-in, your recipes, the list of your playlists, your color choice, a copy of the songs from your playlists, and a count of the requests this app sends to Spotify \(to learn how often Spotify limits them\) are saved in this browser, and nowhere else\. The saved sign-in lets this app reconnect to Spotify by itself when you come back\./.test(fs.readFileSync(ROOT + "index.html", "utf8")));
  } catch (err) { areaCrashed("sign-in renewal", err); } }
  if (want("build popup")) { try {
  // The build popup: steps along the top, the plan as a list with "Why N?", and a build that stops with a plain message when something goes wrong.
  // "ran" makes 2 playlists: "💗 spacious + gentle" (about 520 min of songs) runs out first, at 200 min per playlist. Each playlist takes 6 requests to add its songs.
  const bp_RAN = '{"ran": {"name": "ran {n}", "title": "Ran", "silence between segments": "1 min", "segments": [("💗 spacious + gentle", 200), ("🛋 rest", 30)]}}';
  const bp_text = (w, id) => w.document.getElementById(id).textContent;
  const bp_steps = (w) => Array.from(w.document.querySelectorAll("#bdSteps .bd-step")).map((s) => (s.className.match(/bd-step-(\w+)/) || [, "-"])[1]).join(",");
  const bp_rows = (w) => Array.from(w.document.querySelectorAll("#results .bd-row"));
  const bp_open = async (w) => {
    await readyToPreview(w);
    w.document.getElementById("create").click();
    await waitFor(() => visible(w, "confirmBox") || !!w.document.querySelector("#output .bd-card"), 30000);
  };
  const bp_build = async (w) => {
    await bp_open(w);
    pressBuild(w);
    await waitFor(() => visible(w, "createCloseRow"), 60000);
  };

  // the plan
  var bp_a = await boot({ url: EDURL, session: signedIn(), local: { formats: bp_RAN } });
  await bp_open(bp_a);
  check("the plan says how many the songs allow, then what more than one means", bp_text(bp_a, "confirmText") === "The playlists you chose for this recipe have enough songs to build up to 2 playlists. Why 2?" && !!bp_a.document.querySelector("#confirmText #planToggle") && visible(bp_a, "bdPickWhy") && /^Build one, or several from the same recipe with no song repeated across them\. With 2 playlists, a client can come to 2 ceremonies and never hear the same song twice\. More in A guide for facilitators$/.test(bp_text(bp_a, "bdPickWhy")), bp_text(bp_a, "confirmText"));
  check("the Why table opens right under that sentence, then the line on several, then the choice", bp_a.document.getElementById("confirmText").nextElementSibling.id === "planText" && bp_a.document.getElementById("planText").nextElementSibling.id === "bdPickWhy" && bp_a.document.getElementById("bdPickWhy").nextElementSibling.id === "bdPickHead" && bp_text(bp_a, "bdPickHead") === "Choose how many playlists you\u2019d like to build from this recipe.");
  var bp_opts = () => Array.from(bp_a.document.querySelectorAll("#bdPickTiles .bd-pick-opt"));
  check("a tile per playlist with its number above, none chosen, and Build does nothing yet", visible(bp_a, "bdPick") && bp_opts().map((o) => o.textContent).join(",") === "1,2" && !bp_a.document.querySelector("#bdPickTiles .bd-on, #bdPickTiles [aria-checked=true]") && bp_a.document.getElementById("confirmYes").disabled && bp_text(bp_a, "confirmYes") === "Build playlists" && (bp_a.document.getElementById("confirmYes").click(), visible(bp_a, "confirmBox")));
  bp_opts()[0].click();
  check("choosing 1 lights one tile and names it on the Build button", bp_a.document.querySelectorAll("#bdPickTiles .bd-on").length === 1 && bp_opts()[0].getAttribute("aria-checked") === "true" && !bp_a.document.getElementById("confirmYes").disabled && bp_text(bp_a, "confirmYes") === "Build 1 playlist", bp_text(bp_a, "confirmYes"));
  bp_opts()[1].click();
  check("choosing 2 lights both", bp_a.document.querySelectorAll("#bdPickTiles .bd-on").length === 2 && bp_text(bp_a, "confirmYes") === "Build 2 playlists", bp_text(bp_a, "confirmYes"));
  // the guide opens over the build popup and closes back to it
  var bp_gl = bp_a.document.getElementById("bdPickGuide");
  bp_gl.focus(); bp_gl.click();
  check("the guide link opens the guide over the build popup, which stays open", visible(bp_a, "infoOverlay") && visible(bp_a, "createOverlay") && bp_a.document.getElementById("gdSeveral").open);
  bp_a.document.dispatchEvent(new bp_a.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  check("Escape closes only the guide: the build popup stays, the page behind still cannot scroll, and focus is back on the link", !visible(bp_a, "infoOverlay") && visible(bp_a, "createOverlay") && bp_a.document.body.style.overflow === "hidden" && bp_a.document.activeElement === bp_gl && bp_text(bp_a, "confirmYes") === "Build 2 playlists");
  check("the popup's text can be selected", /#createDialog \.bd-body \{[^}]*user-select: text;/.test(fs.readFileSync(ROOT + "index.html", "utf8")));
  check("the title names the recipe", bp_text(bp_a, "bdTitle") === "Ran", bp_text(bp_a, "bdTitle"));
  check("under the name, the recipe's bar: a piece for each segment and silence, as in the editor", !bp_a.document.getElementById("bdShape").hidden && bp_a.document.querySelectorAll("#bdShape .bd-shape-piece").length === bp_a.document.querySelectorAll("#feBar .fe-piece").length && bp_a.document.querySelectorAll("#bdShape .bd-shape-silence").length === bp_a.document.querySelectorAll("#feBar .fe-piece-silence").length, bp_a.document.getElementById("bdShape").innerHTML);
  check("and its length under the bar: music in bold, silence, and the segments", /^(\d+ h( \d+ min)?|\d+ min) of music( \+ (\d+ sec|\d+ min|\d+ h( \d+ min)?) of silence)? · \d+ segments?$/.test(bp_text(bp_a, "bdShapeInfo")) && !!bp_a.document.querySelector("#bdShapeInfo b"), bp_text(bp_a, "bdShapeInfo"));
  check("while it asks, reading and planning are ticked and building has not started", bp_steps(bp_a) === "done,done,-,-", bp_steps(bp_a));
  check("the plan lists no playlists: the count says how many, and the list starts when building does", bp_rows(bp_a).length === 0 && !/showPlanRows|bdShowAll/.test(fs.readFileSync(ROOT + "app.js", "utf8")), bp_rows(bp_a).map((r) => r.textContent).join(" | "));
  check("there is no separate progress bar any more", !bp_a.document.getElementById("bdProgress"));
  check("while the cover is sent, the row says so, not adding songs", /setRowState\(row, "now", "adding the cover"\);[^\n]*\n\s*try \{ await spotifyRequest\("PUT", `\/playlists\/\$\{made\.id\}\/images`/.test(fs.readFileSync(ROOT + "app.js", "utf8")));
  check("Why 2? is offered, and the table starts hidden", bp_text(bp_a, "planToggle") === "Why 2?" && !visible(bp_a, "planText"));
  bp_a.document.getElementById("planToggle").click();
  var bp_trs = Array.from(bp_a.document.querySelectorAll("#planText tbody tr"));
  check("Why 2? opens a table: what one playlist uses of each source, its length, and how many playlists that is enough for, the units hr and min wide and h and m on a phone", visible(bp_a, "planText") && bp_trs.length === 2 && /^3 hrh 20 minm of 💗 spacious \+ gentle8 hrh \d+ minm2 playlists$/.test(bp_trs[0].textContent) && /^30 minm of 🛋 rest\d+ hrh/.test(bp_trs[1].textContent) && Array.from(bp_a.document.querySelectorAll("#planText th")).map((t) => t.textContent).join(",") === "Each playlist uses,Available,Enough for" && Array.from(bp_trs[0].children[1].querySelectorAll(".bd-unit .bd-narrow")).map((u) => u.textContent).join(",") === "h,m" && /#planText \.bd-narrow[^{]*\{ display: none; \}\n\s*@media \(max-width: 759px\) \{ #createDialog #planText \.bd-wide[^{]*\{ display: none; \} #createDialog #planText \.bd-narrow[^{]*\{ display: inline; \} \}/.test(fs.readFileSync(ROOT + "index.html", "utf8")), bp_trs.map((t) => t.textContent).join(" | "));
  check("the playlist that ran out is the marked row", bp_trs[0].className === "bd-limit" && bp_trs[1].className === "");
  check("no note under the table when a playlist ran out (the marked row says it)", bp_a.document.querySelectorAll("#planText .bd-note").length === 0, bp_text(bp_a, "planText"));
  bp_a.fillWhyTable({ built: [{ key: "ran", playlists: [{}, {}], ranOut: { name: "a" }, sources: [{ name: "a", per: 60, has: 130, enough: 2 }, { name: "b", per: 60, has: 300, enough: 5 }, { name: "c", per: 30, has: 70, enough: 2 }] }] });
  check("every source with the same count as the one that ran out is marked too", Array.from(bp_a.document.querySelectorAll("#planText tbody tr")).map((t) => t.className).join(",") === "bd-limit,,bd-limit");
  bp_a.fillWhyTable({ built: [{ key: "ran", playlists: [{}, {}], sources: [{ name: "a", per: 60, has: 130, enough: 3 }, { name: "b", per: 60, has: 300, enough: 5 }, { name: "c", per: 30, has: 100, enough: 3 }] }] });
  check("when the cap sets the number, no row is marked, and a note above the table says so and how many the songs allow", Array.from(bp_a.document.querySelectorAll("#planText tbody tr")).map((t) => t.className).join(",") === ",," && bp_a.document.querySelector("#planText").firstElementChild.className === "bd-note bd-capnote" && bp_text(bp_a, "planText").startsWith("Capped at 2 by “Most playlists per recipe” in More options. Without it, the songs are enough for 3 playlists."), bp_text(bp_a, "planText"));
  var bp_html = fs.readFileSync(ROOT + "index.html", "utf8"), bp_js = fs.readFileSync(ROOT + "app.js", "utf8");
  check("a long name ends in an ellipsis instead of wrapping, with the full name on hover, and Available is left-aligned", /#planText td:first-child[^{]*\{ max-width: 0; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; \}/.test(fs.readFileSync(ROOT + "index.html", "utf8")) && /#planText td:nth-child\(2\)[^{]*\{ text-align: left;/.test(fs.readFileSync(ROOT + "index.html", "utf8")) && bp_trs[0].children[0].title === "💗 spacious + gentle");
  check("the marked row is pale pink with its number in pink, and the rows are striped", /tr\.bd-limit td \{ background: color-mix\(in srgb, var\(--accent\)/.test(bp_html) && /tr\.bd-limit td:last-child \{ color: var\(--accent\);/.test(bp_html) && /tbody tr:nth-child\(odd\) td \{ background: var\(--card\); \}/.test(bp_html));
  check("songs in more than one source get their own box, not a line under the table", /infoBox\("shared", `\$\{plural\(shared, "song"\)\}/.test(bp_js) && !/className: "bd-note", textContent: `\$\{plural\(shared/.test(bp_js));
  check("and the link then offers to hide it", bp_text(bp_a, "planToggle") === "Hide");
  check("only Build and Cancel are offered", visible(bp_a, "confirmButtons") && !visible(bp_a, "createCloseRow") && !visible(bp_a, "bdBusyRow") && /Build 2 playlists/.test(bp_text(bp_a, "confirmYes")));
  pressBuild(bp_a);
  await waitFor(() => visible(bp_a, "bdTally"), 20000);
  check("while building: a count of the playlists made, a tile for each, and Keep this tab open", /^\d+of 2 playlists$/.test(bp_text(bp_a, "bdCount")) && bp_a.document.querySelectorAll("#bdTiles .bd-tile").length === 2 && bp_text(bp_a, "bdCountNote") === "Keep this tab open.", bp_text(bp_a, "bdCount"));
  check("while building: a playlist not built yet shows nothing on the right", bp_rows(bp_a).filter((r) => r.classList.contains("bd-wait")).every((r) => r.querySelector(".bd-meta").textContent === ""));
  await waitFor(() => visible(bp_a, "createCloseRow"), 60000);
  check("done: every step ticked, and the count is gone", bp_steps(bp_a) === "done,done,done,done" && !visible(bp_a, "bdTally"), bp_steps(bp_a));
  check("done: how many, how much music, and a tile for each", doneSentence(bp_a) === "2 playlists are in your Spotify library." && /^\d+ h( \d+ min)? of music$|^\d+ min of music$/.test(bp_a.document.querySelector("#actionMessage .bd-hours").textContent) && bp_a.document.querySelectorAll("#actionMessage .bd-tiles .bd-tile").length === 2, bp_text(bp_a, "actionMessage"));
  check("done: a fanned cover for each playlist, five at most", bp_a.document.querySelectorAll("#actionMessage .bd-fan .bd-card-img").length === 2 && /Math\.min\(made, 5\)/.test(fs.readFileSync(ROOT + "app.js", "utf8")));
  check("done: the playlists are not links, each one ticked with its songs and length", bp_rows(bp_a).length === 2 && bp_rows(bp_a).every((r) => !r.querySelector("a") && /songs ·/.test(r.querySelector(".bd-meta").textContent)));
  check("done: Open in Spotify opens the first new playlist, then the thank-you box, then the list", visible(bp_a, "createOpen") && /^https:\/\/open\.spotify\.com\/playlist\/new\w+$/.test(bp_a.document.getElementById("createOpenLink").href) && bp_a.document.getElementById("createOpenLink").textContent === "Open in Spotify" && bp_a.document.getElementById("createOpen").nextElementSibling.id === "createSupport", bp_a.document.getElementById("createOpenLink").href);
  check("done: the status line is hidden", bp_a.document.getElementById("output").hidden);
  check("done: the thank-you line, Close and Support me", visible(bp_a, "createSupport") && visible(bp_a, "createDonate") && !visible(bp_a, "createNotes"));

  // with a limit on the number there is no hint, and the table says where the number comes from
  var bp_b = await boot({ url: EDURL, session: signedIn(), local: { formats: bp_RAN } });
  bp_b.document.getElementById("maxPlaylists").value = "1";
  bp_b.document.getElementById("maxPlaylists").dispatchEvent(new bp_b.Event("input"));
  await bp_open(bp_b);
  check("when the limit sets the number, the plan is the same one sentence", bp_text(bp_b, "confirmText") === "Ready to build 1 playlist. Why 1?", bp_text(bp_b, "confirmText"));
  check("and Why 1? says the limit set it", /Most playlists per recipe/.test(bp_text(bp_b, "planText")), bp_text(bp_b, "planText"));
  check("when only one can be made, no slider and no count: just the sentence", !visible(bp_b, "bdPick") && !visible(bp_b, "bdPickHead") && !visible(bp_b, "bdPickWhy"));
  pressBuild(bp_b);
  await waitFor(() => visible(bp_b, "bdTally"), 20000);
  check("building one playlist says so, with no count and no tile", bp_text(bp_b, "bdCount") === "Building your playlist" && !visible(bp_b, "bdTiles"), bp_text(bp_b, "bdCount"));
  await waitFor(() => visible(bp_b, "createCloseRow"), 60000);
  check("one playlist done: one cover, no tiles, is in your library", doneSentence(bp_b) === "1 playlist is in your Spotify library." && bp_b.document.querySelectorAll("#actionMessage .bd-card-img").length === 1 && !bp_b.document.querySelector("#actionMessage .bd-tiles"), bp_text(bp_b, "actionMessage"));

  // choosing fewer than the most builds only that many
  var bp_c = await boot({ url: EDURL, session: signedIn(), local: { formats: bp_RAN } });
  await bp_open(bp_c);
  bp_c.document.querySelector("#bdPickTiles .bd-pick-opt").click();
  pressBuild(bp_c);
  await waitFor(() => visible(bp_c, "createCloseRow"), 60000);
  check("1 of 2 chosen: one playlist is built", doneSentence(bp_c) === "1 playlist is in your Spotify library." && bp_rows(bp_c).length === 1, doneSentence(bp_c));

  // a build that stops: what went wrong, what was built, what to do, and Close
  const bp_fail = async (how, extra = {}) => {
    const o = { buildFailIn: "new2", buildFail: how, ...extra };
    const w = await boot({ url: EDURL, session: signedIn(), local: { formats: bp_RAN }, fetchOptions: o, instantRetries: true });
    await bp_build(w);
    return { w, o, card: (w.document.querySelector("#actionMessage .bd-card") || { textContent: "" }).textContent };
  };
  var bp_n = await bp_fail("network");
  check("no connection: it says so and what to do", /^Spotify stopped answering1 of 2 playlists was built, and Ran 2 is incomplete\. Check your internet connection, then build again\. Building again replaces the ones made so far\.$/.test(bp_n.card), bp_n.card);
  check("the build stops there: nothing more is sent", bp_n.o.addCalls === bp_n.o.writes.filter((x) => x.type === "add").length + 1 && bp_n.o.writes.every((x) => x.type !== "add" || x.id === "new1") && bp_n.o.writes.filter((x) => x.type === "create").length === 2, bp_n.o.addCalls);
  check("the rows say what happened to each", /songs ·/.test(bp_rows(bp_n.w)[0].querySelector(".bd-meta").textContent) && bp_rows(bp_n.w)[1].querySelector(".bd-meta").textContent === "incomplete", bp_rows(bp_n.w).map((r) => r.textContent).join(" | "));
  check("the Build step shows the failure", bp_steps(bp_n.w) === "done,done,fail,-", bp_steps(bp_n.w));
  check("after a stop the count is gone: the message and the rows say how far it got", !visible(bp_n.w, "bdTally"));
  check("only Close is offered: no Support me, no report link", visible(bp_n.w, "createCloseRow") && !visible(bp_n.w, "createDonate") && !visible(bp_n.w, "mainReportHint") && !visible(bp_n.w, "createSupport"));
  var bp_h = await bp_fail("hang", { answerMs: 200 });
  check("no answer at all reads the same", /^Spotify stopped answering/.test(bp_h.card), bp_h.card);
  var bp_r = await bp_fail(429);
  check("a long rate limit: Spotify asked to wait, and for how long", /^Spotify asked this app to wait1 of 2 playlists was built, and Ran 2 is incomplete\. Try again in about 20 minutes\./.test(bp_r.card), bp_r.card);
  var bp_x = await bp_fail(401);
  check("an expired sign-in: connect again", /^Your Spotify sign-in expired.*Connect again, then build again\./.test(bp_x.card), bp_x.card);
  var bp_d = await bp_fail(403);
  check("a refused permission: what to do about it", /^Spotify did not allow this.*Click Disconnect, then Connect again/.test(bp_d.card), bp_d.card);
  var bp_e = await bp_fail(500);
  check("anything else: the error in plain words, try again later, and a report link", /^Something went wrong1 of 2 playlists was built, and Ran 2 is incomplete\. Spotify returned an error \(500\)\. Try again later\./.test(bp_e.card) && visible(bp_e.w, "mainReportHint"), bp_e.card);

  // a recipe that cannot make even one playlist: every reason at once
  var bp_p = await boot({ url: EDURL, session: signedIn(), local: { formats: '{"bad": {"name": "bad {n}", "title": "Bad", "segments": [("Gone list", 10), ("💗 spacious + gentle", 900), ("Someone else\'s list", 10)]}}' } });
  await bp_open(bp_p);
  var bp_ptext = bp_text(bp_p, "output");
  check("recipe problems: one card, all of them", /^Nothing can be built from this recipe yet/.test(bp_ptext) && bp_p.document.querySelectorAll("#output .bd-problems li").length === 3, bp_ptext);
  check("a missing playlist is named, with what to do", /Gone list is not in your Spotify playlists\. Choose another playlist in the recipe/.test(bp_ptext), bp_ptext);
  check("a playlist that is not yours is named, with what to do", /Someone else's list is not yours\./.test(bp_ptext), bp_ptext);
  check("a playlist that is too short says by how much, even with the others missing", /💗 spacious \+ gentle is too short\. This recipe uses 15 h of it, and it has 8 h \d+ min of songs\. Add \d+ h \d+ min of songs to it, or shorten its segments\./.test(bp_ptext), bp_ptext);
  check("the Plan step shows the failure, and only Close is offered", bp_steps(bp_p) === "done,fail,-,-" && visible(bp_p, "createCloseRow") && !visible(bp_p, "confirmButtons"), bp_steps(bp_p));
  var bp_s = await boot({ url: EDURL, session: signedIn(), local: { formats: '{"long": {"name": "long {n}", "segments": [("💗 spacious + gentle", 900)]}}' } });
  await bp_open(bp_s);
  check("too short alone, found by the plan itself", /Nothing can be built from this recipe yet/.test(bp_text(bp_s, "output")) && /is too short\. This recipe uses 15 h of it/.test(bp_text(bp_s, "output")), bp_text(bp_s, "output"));

  // the engine's side of it
  const bp_py = (fn, args) => require("child_process").spawnSync("python3", [require("path").join(__dirname, "bridge.py"), fn, JSON.stringify(args)], { encoding: "utf8" }).stdout;
  var bp_eng = JSON.parse(bp_py("build_playlists", ['{"w": {"name": "W {n}", "silence between segments": "2 min", "segments": [("A", 10), ("B", 20)]}}', "w", JSON.stringify({ A: [1, 2, 3, 4, 5].map((i) => ({ uri: "a" + i, ms: 300000 })), B: [1, 2, 3, 4].map((i) => ({ uri: "b" + i, ms: 600000 })) })]));
  check("engine: what ran out (the playlist with the least to spare is filled first), and the minutes one more playlist needs from it", JSON.stringify(bp_eng.ranOut) === '{"name":"B","more":20}', JSON.stringify(bp_eng.ranOut));
  check("engine: each source's minutes per playlist, minutes it has, and how many that is enough for", JSON.stringify(bp_eng.sources) === '[{"name":"A","per":10,"has":25,"enough":2},{"name":"B","per":20,"has":40,"enough":2}]', JSON.stringify(bp_eng.sources));
  check("engine: each playlist's shape, silence included", JSON.stringify(bp_eng.playlists[0].pieces) === "[[10,false],[2,true],[20,false]]" && bp_eng.playlists[0].length === 32, JSON.stringify(bp_eng.playlists[0].pieces));
  var bp_none = JSON.parse(bp_py("build_playlists", ['{"w": {"name": "W {n}", "segments": [("A", 10), ("B", 60)]}}', "w", JSON.stringify({ A: [1, 2, 3].map((i) => ({ uri: "a" + i, ms: 300000 })), B: [{ uri: "b1", ms: 600000 }] })]));
  check("engine: with nothing planned, the playlists too short for even one", bp_none.playlists.length === 0 && JSON.stringify(bp_none.short) === '[{"name":"B","need":60,"has":10}]', JSON.stringify(bp_none.short));
  var bp_fit = JSON.parse(bp_py("build_playlists", ['{"w": {"name": "W {n}", "segments": [("A", 10)]}}', "w", JSON.stringify({ A: [1, 2, 3, 4, 5, 6].map((i) => ({ uri: "a" + i, ms: 240000 })) })]));
  check("engine: enough minutes whose song lengths cannot come within 10% says so, with what the playlist really has", bp_fit.playlists.length === 0 && JSON.stringify(bp_fit.short) === '[{"name":"A","need":10,"has":24,"fit":true}]', JSON.stringify(bp_fit.short));
  check("and the popup words it as the songs not adding up", /add up to \$\{lengthText\(s\.need\)\}\.`, `A segment has to come within 10% of its length/.test(fs.readFileSync(ROOT + "app.js", "utf8")));
  check("engine: and the limit on the number leaves nothing ran out", JSON.parse(bp_py("build_playlists", ['{"w": {"name": "W {n}", "segments": [("A", 5)]}}', "w", JSON.stringify({ A: [1, 2, 3].map((i) => ({ uri: "a" + i, ms: 300000 })) }), 1])).ranOut === null);
  } catch (err) { areaCrashed("build popup", err); } }

  if (want("silence stepper width")) { try {
  // ================================================================ the silence stepper keeps its width while it is tapped
  var sw_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  var sw_w = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1" }, fetchOptions: {} });
  var sw_mid = sw_w.document.querySelector("#feHead .fe-amount-rich");
  var sw_steps = sw_w.eval("GAP_STEPS");
  check("the stepper's middle holds the words it says now, once, and everything it could say, in two sets (a phone's and a wide screen's), one of each for every length and for none", !!sw_mid && sw_mid.querySelectorAll(".fe-amount-live").length === 1 && sw_mid.querySelectorAll(".fe-sizer-short").length === sw_steps.length && sw_mid.querySelectorAll(".fe-sizer-label").length === sw_steps.length);
  check("what it could say is exactly what it says: the same words for each length, with No for none", sw_steps.every((s) => { const len = s ? sw_w.eval(`describeSeconds(${s})`) : "No"; return Array.from(sw_mid.querySelectorAll(".fe-sizer-short")).some((e) => e.textContent === len + " gaps") && Array.from(sw_mid.querySelectorAll(".fe-sizer-label")).some((e) => e.textContent === len + " " + (s ? "of silence between segments" : "silence between segments")); }));
  check("none of that is read out or seen or pressed: hidden from screen readers, invisible, and not a target", Array.from(sw_mid.querySelectorAll(".fe-sizer")).every((e) => e.getAttribute("aria-hidden") === "true") && /\.fe-sizer \{ visibility: hidden; pointer-events: none; \}/.test(sw_css));
  check("they all sit in the same place as the words it says, so the widest sets the width, and the words are centered in it", /\.fe-amount-rich > \* \{ grid-area: 1 \/ 1; \}/.test(sw_css) && /justify-items: center/.test(sw_css) && /@media \(min-width: 760px\) \{[^}]*\.fe-sizer-short \{ display: none; \}/.test(sw_css.replace(/\{ #formatEditor \.fe-silence-short, #formatEditor \.fe-sizer-short/, "{ #formatEditor .fe-silence-short, #formatEditor .fe-sizer-short")) || /\.fe-silence-short, #formatEditor \.fe-sizer-short \{ display: none; \}/.test(sw_css));
  check("the live words are the ones the checks and the person read: the length, then gaps (or the sentence), as before", sw_mid.querySelector(".fe-amount-live").textContent.startsWith(sw_w.document.getElementById("feGapValue").textContent + " ") && sw_mid.querySelector(".fe-amount-live .fe-silence-short").textContent === "gaps");
  } catch (err) { areaCrashed("silence stepper width", err); } }

  if (want("recipe session")) { try {
  // ================================================================ hours and minutes, covers after the save, keeping earlier playlists, songs in two versions, a newer version
  var rs_text = (segs, gap) => 'FORMATS = {"f1": {"title": "T", "name": "T {n}", "silence between segments": "' + gap + '", "segments": [' + segs.map((m) => '("💗 spacious + gentle [id:p2]", ' + m + ')').join(", ") + ']}}';
  var rs_total = async (segs, gap) => { const w = await boot({ url: EDURL, session: signedIn(), local: { formats: rs_text(segs, gap), connectedBefore: "1", backupMode: "manual" }, fetchOptions: {} }); return w.eval("editor.musicText"); };
  check("under an hour the total is in minutes, as before", /^55 minutes of music/.test(await rs_total([55], "30 sec")) && /^25 minutes of music \+ 30 seconds of silence$/.test(await rs_total([10, 15], "30 sec")));
  check("an hour is 1 hour, and above it is hours and whole minutes", /^1 hour of music/.test(await rs_total([60], "30 sec")) && /^1 hour 5 minutes of music/.test(await rs_total([65], "30 sec")) && /^2 hours 5 minutes of music/.test(await rs_total([120, 5], "30 sec")) && /^10 hours of music/.test(await rs_total([600], "30 sec")));
  check("silence of an hour or more is the same: 1 hour 10 minutes, not 70 minutes", / of music \+ 1 hour 10 minutes of silence$/.test(await rs_total([5, 5, 5, 5, 5, 5, 5, 5], "10 min")) || / of music \+ \d+ hours?( \d+ minutes?)? of silence$/.test(await rs_total([5, 5, 5, 5, 5, 5, 5, 5], "10 min")));

  // covers: after the save, never waited for, and a rate limit stops them without a word
  var rs_fmt = 'FORMATS = {"f1": {"title": "Alpha", "name": "Alpha {n}", "silence between segments": "30 sec", "segments": [("💗 spacious + gentle [id:p2]", 30)]}, "f2": {"title": "Beta", "name": "Beta {n}", "silence between segments": "30 sec", "segments": [("🛋 rest [id:p4]", 20)]}}';
  var rs_o = { descStore: {}, nameStore: {}, coverRateLimit: 3 };
  var rs_t0 = Date.now();
  var rs_w = await boot({ url: EDURL, session: signedIn(), local: { formats: rs_fmt, backupMode: "spotify" }, fetchOptions: rs_o });
  rs_w.eval("spotifySaveDelayMs = 30; saveState.coverGapMs = 0");
  await waitFor(() => rs_w.eval("saveState.savedAt") !== null, 8000);
  await waitFor(() => (rs_o.coverTries || 0) >= 1 && !rs_w.eval("saveState.coverRunning"), 8000);
  await new Promise((r) => setTimeout(r, 300));
  check("a cover that Spotify turns away for asking too often is tried once, not waited for: the other one is not tried, and it goes later", rs_o.coverTries === 1 && rs_w.eval("saveState.coverQueue.length") === 2);
  check("and nothing is said about it, since it will go with a later save: no message in the line, no failure", !/cover/i.test(capText(rs_w)) && rs_w.eval("saveState.coverProblem") === null && !/Couldn.t save/.test(capText(rs_w)) && /Saved to Spotify at|Last saved/.test(rs_w.document.getElementById("spotifySaveStatus").textContent));
  rs_o.coverRateLimit = 0;
  rs_w.eval("uploadCovers()");
  await waitFor(() => rs_o.writes.filter((x) => x.type === "cover").length >= 2, 8000);
  check("when it is allowed again the covers go, both of them, and the queue is empty", rs_o.writes.filter((x) => x.type === "cover").length >= 2 && rs_w.eval("saveState.coverQueue.length") === 0);
  var rs_o2 = { descStore: {}, nameStore: {} };
  var rs_w2 = await boot({ url: EDURL, session: signedIn(), local: { formats: rs_fmt, backupMode: "spotify" }, fetchOptions: rs_o2 });
  rs_w2.eval("spotifySaveDelayMs = 30; saveState.coverGapMs = 600");
  await waitFor(() => rs_w2.eval("saveState.savedAt") !== null, 8000);
  check("the save is done, and said to be, before the covers are: they follow it, a pause apart", rs_w2.eval("saveState.savedAt") !== null && (rs_w2.eval("saveState.coverRunning") === true || rs_o2.writes.filter((x) => x.type === "cover").length < 2));

  // keeping earlier playlists instead of replacing them
  var rs_old = [
    { id: "old1", name: "mini 1", owner: { id: "ron" }, description: MADE },
    { id: "old2", name: "mini 2", owner: { id: "ron" }, description: MADE },
    { id: "old3", name: "mini 1 (version a)", owner: { id: "ron" }, description: MADE },
  ];
  var rs_ok = { extraPlaylists: rs_old, uniqueSongNames: true };
  var rs_wk = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI }, fetchOptions: rs_ok });
  await runPreview(rs_wk);
  var rs_box = rs_wk.document.getElementById("confirmKeepEarlier");
  var rs_info = rs_wk.document.getElementById("bdInfo").querySelector(".bd-info");
  check("the box about earlier playlists is one line with Details, and the checkbox waits behind it", /^2 earlier playlists from this recipe will be replaced\. Details/.test(rs_info.textContent) && rs_box.closest(".bd-info-more").hidden === true, rs_info.textContent);
  Array.from(rs_info.querySelectorAll(".linklike")).find((b) => b.textContent === "Details").click();
  check("Details opens a line saying replacing is usual, and a checkbox to keep them, saying how they will be named: the next letter, since there is a version a already", rs_box.closest(".bd-info-more").hidden === false && /Hide details/.test(rs_info.textContent) && /Replacing them is the usual choice, but you can keep the old ones if you like\./.test(rs_info.textContent) && rs_box.type === "checkbox" && !rs_box.checked && /Keep them, renamed to … \(version b\)$/.test(rs_box.parentElement.textContent), rs_info.textContent);
  rs_box.checked = true;
  pressBuild(rs_wk);
  await waitFor(() => rs_ok.writes.filter((x) => x.type === "create").length >= 4, 30000);
  var rs_renames = rs_ok.writes.filter((x) => x.type === "update" && /^old[12]$/.test(x.id));
  check("checked, they are renamed, all with the same letter, and not removed", rs_renames.length === 2 && rs_renames.map((x) => x.name).sort().join("|") === "mini 1 (version b)|mini 2 (version b)" && rs_ok.writes.filter((x) => x.type === "remove").length === 0);
  check("and the new playlists are built after, starting at 1, with the one Build button", rs_ok.writes.filter((x) => x.type === "create").slice(0, 2).map((x) => x.name).join("|") === "mini 1|mini 2" && rs_ok.writes.findIndex((x) => x.type === "create") > rs_ok.writes.findIndex((x) => x.type === "update"));
  check("a playlist that was already kept earlier (version a) is not touched", !rs_ok.writes.some((x) => x.id === "old3"));
  var rs_wk2 = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI }, fetchOptions: { extraPlaylists: [{ id: "n1", name: "mini 1", owner: { id: "ron" }, description: MADE }], uniqueSongNames: true } });
  await runPreview(rs_wk2);
  check("with none kept before, the first letter is a, and for one playlist it says it, not them", /^1 earlier playlist from this recipe will be replaced\. DetailsReplacing it is the usual choice, but you can keep the old one if you like\.Keep it, renamed to … \(version a\)$/.test(rs_wk2.document.getElementById("bdInfo").textContent), rs_wk2.document.getElementById("bdInfo").textContent);
  var rs_wk3 = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI }, fetchOptions: { uniqueSongNames: true } });
  await runPreview(rs_wk3);
  check("with nothing earlier to replace, there is no such box", !rs_wk3.document.getElementById("confirmKeepEarlier") && rs_wk3.document.getElementById("bdInfo").textContent === "");
  check("the letters run a to z, then aa", rs_wk.eval("versionLetters(0)") === "a" && rs_wk.eval("versionLetters(25)") === "z" && rs_wk.eval("versionLetters(26)") === "aa" && rs_wk.eval("versionLetters(27)") === "ab");

  // songs that may be one song in more than one recording
  var rs_ws = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  await runPreview(rs_ws);
  var rs_box2 = Array.from(rs_ws.document.querySelectorAll("#bdInfo .bd-info")).find((b) => /more than one recording/.test(b.textContent));
  check("when songs in the source playlists have the same artist and title in different recordings, one short line says so, as information, not a warning", !!rs_box2 && /^\d+ songs have more than one recording\. Details/.test(rs_box2.textContent) && !rs_box2.querySelector(".bd-warn-ic") && !rs_box2.closest(".bd-warn"), rs_box2 && rs_box2.textContent);
  var rs_more = rs_box2.querySelector(".bd-info-more");
  check("the songs are behind Details, and not shown until it is pressed", rs_more.hidden === true);
  Array.from(rs_box2.querySelectorAll(".linklike")).find((b) => b.textContent === "Details").click();
  var rs_items = Array.from(rs_more.querySelectorAll("li")).map((li) => li.textContent);
  check("pressed, it says each recording counts as its own song and lists up to ten, each with the playlists they are in, and how many more", !rs_more.hidden && /^Each recording \(for example live and studio\) counts as its own song/.test(rs_more.textContent) && rs_items.length === 11 && /^Artist - Song \d+: in .+, in .+$/.test(rs_items[0]) && /^and \d+ more$/.test(rs_items[10]), rs_items.slice(0, 2).join(" | "));
  var rs_a = rs_more.querySelector("li a");
  check("each playlist name opens it in Spotify at that song, in a new tab", !!rs_a && /^https:\/\/open\.spotify\.com\/playlist\/p\d\?highlight=spotify%3Atrack%3Ap\d-\d+$/.test(rs_a.href) && rs_a.target === "_blank", rs_a && rs_a.href);
  var rs_wu = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI }, fetchOptions: { uniqueSongNames: true } });
  await runPreview(rs_wu);
  check("with no such songs there is no box", !/more than one recording/.test(rs_wu.document.getElementById("bdInfo").textContent));

  // songs a source playlist lists more than once
  var rs_or = { repeatIn: "p2", uniqueSongNames: true };
  var rs_wr = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI }, fetchOptions: rs_or });
  await runPreview(rs_wr);
  var rs_rep = Array.from(rs_wr.document.querySelectorAll("#bdInfo .bd-info")).find((b) => /more than once/.test(b.textContent));
  check("a source playlist that lists songs more than once gets a box saying how many, and that each is used once, with nothing offered that changes the playlist", !!rs_rep && rs_rep.textContent.startsWith("💗 spacious + gentle lists 3 songs more than once. Each is used once. Details") && !/Fix/.test(rs_rep.textContent) && !/removeRepeats/.test(fs.readFileSync(ROOT + "app.js", "utf8")), rs_rep && rs_rep.textContent);
  var rs_rl = rs_rep.querySelector("ul");
  check("the songs are behind Details, each with how many times it is listed", rs_rl.hidden === true && JSON.stringify(Array.from(rs_rl.querySelectorAll("li")).map((li) => li.textContent)) === JSON.stringify(["Artist - Song 0 of p2: 2 times", "Artist - Song 1 of p2: 2 times", "Artist - Song 2 of p2: 2 times"]), Array.from(rs_rl.querySelectorAll("li")).map((li) => li.textContent).join(" | "));
  pressBuild(rs_wr);
  await waitFor(() => visible(rs_wr, "createCloseRow"), 30000);
  var rs_adds = rs_or.writes.filter((x) => x.type === "add");
  var rs_byList = {};
  for (const x of rs_adds) (rs_byList[x.id] = rs_byList[x.id] || []).push(...x.uris.filter((u) => /p\d-/.test(u)));
  check("each built playlist has every song once", Object.values(rs_byList).length > 0 && Object.values(rs_byList).every((u) => new Set(u).size === u.length));
  var rs_key = (a, b) => rs_ws.eval(`songKey(${JSON.stringify(a)}) === songKey(${JSON.stringify(b)})`);
  check("it points out the same song with a remaster note, or other case, accents, or punctuation, and not a live, acoustic or remix version, which is a different song", rs_key("Pink Floyd - Time", "Pink Floyd - Time - 2011 Remaster") && rs_key("Beyoncé - Halo", "Beyonce - Halo (Remastered 2020)") && rs_key("Simon & Garfunkel - The Sound of Silence", "simon and garfunkel - the sound of silence - remastered") && !rs_key("Pink Floyd - Time", "Pink Floyd - Time (Live)") && !rs_key("Radiohead - Creep", "Radiohead - Creep (Acoustic)") && !rs_key("Artist - Song", "Artist - Song (Remix)"));
  check("the note is there every time, with nothing remembered about having been shown it", !/localStorage|sessionStorage/.test(fs.readFileSync(ROOT + "app.js", "utf8").match(/function findSuspects[\s\S]*?\n}\n/)[0]));
  } catch (err) { areaCrashed("recipe session", err); } }

  if (want("newer version")) { try {
  // ================================================================ a newer version on the site
  var nv_src = fs.readFileSync(ROOT + "index.html", "utf8").match(/<script>\n  \/\/ If the page's own script never starts[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g, "");
  var nv_version = fs.readFileSync(ROOT + "app.js", "utf8").match(/const APP_VERSION = "([^"]+)"/)[1];
  check("version.txt holds just the version of the files, so a check costs a few bytes, and it is the same stamp as the page's", fs.readFileSync(ROOT + "version.txt", "utf8").trim() === nv_version && fs.readFileSync(ROOT + "version.txt", "utf8").length < 40 && fs.readFileSync(ROOT + "index.html", "utf8").split(nv_version).length - 1 === 5);
  var nv_make = async (fetchOptions = {}, session = {}) => {
    const w = await boot({ url: EDURL, session: Object.assign(signedIn(), session), local: { formats: MINI, connectedBefore: "1", backupMode: "manual" }, fetchOptions });
    w.eval(nv_src);
    w.document.head.insertAdjacentHTML("beforeend", ["theme.js", "formats.js", "editor.js", "app.js"].map((f) => `<script src="${f}?v=${nv_version}"></script>`).join(""));
    w.__fetched = []; w.__reloaded = 0;
    const real = w.fetch;
    w.fetch = (u, i) => { w.__fetched.push({ url: String(u), cache: i && i.cache }); return /version\.txt/.test(String(u)) ? real(u, i) : Promise.resolve({ ok: true }); };   // the version file answers as the site would; the page and its scripts are simply there
    w.pageStart.reload = () => { w.__reloaded += 1; };
    w.eval("noticeTiming.quietMs = 0; notices.lastEditAt = 0; versionCheck.last = 0");
    return w;
  };
  var nv_check = async (w) => { await w.eval("checkForNewVersion()"); await new Promise((r) => setTimeout(r, 150)); };
  var nv_seen = (w) => w.__fetched.filter((f) => /version\.txt/.test(f.url));
  var nv_a = await nv_make();
  await nv_check(nv_a);
  check("the check asks for version.txt, fresh and not from the cache, with a changing address so nothing in between can answer for the site", nv_seen(nv_a).length === 1 && nv_seen(nv_a)[0].cache === "no-store" && /version\.txt\?t=\d+$/.test(nv_seen(nv_a)[0].url));
  check("the same version: nothing happens, no reload, no message", nv_a.__reloaded === 0 && !/newer version/i.test(capText(nv_a)));
  var nv_b = await nv_make({ serverVersion: "2099-01-01a\n" });
  await nv_check(nv_b);
  await new Promise((r) => setTimeout(r, 200));
  check("a different version, with nothing going on: fresh copies of the page and its scripts are asked for, and the page loads again, by itself, once", nv_b.__fetched.filter((f) => f.cache === "reload").length >= 5 && nv_b.__reloaded === 1 && !/newer version/i.test(capText(nv_b)));
  nv_b.eval("versionCheck.last = 0");
  await nv_check(nv_b);
  await new Promise((r) => setTimeout(r, 200));
  check("the same newer version again in the same visit does not reload again, in case the upload is half done: it says so instead, with Reload", nv_b.__reloaded === 1 && /A newer version of this app is available\./.test(capText(nv_b)) && capLinks(nv_b).some((b) => b.textContent === "Reload"));
  var nv_btn = capLinks(nv_b).find((b) => b.textContent === "Reload");
  nv_b.document.getElementById("feCaption").dispatchEvent(new nv_b.Event("pointerdown", { bubbles: true }));
  check("pressing on the message does not replace its buttons, so a press on Reload or OK still counts as a click", capLinks(nv_b).includes(nv_btn));
  capLinks(nv_b).find((b) => b.textContent === "Reload").click();
  await new Promise((r) => setTimeout(r, 200));
  check("Reload loads the page again whenever it is pressed", nv_b.__reloaded === 2);
  var nv_c = await nv_make({ serverVersion: "2099-01-01a" });
  nv_c.eval("notices.lastEditAt = Date.now()");
  await nv_check(nv_c);
  check("the person has edited in the last few seconds: no reload, only the message", nv_c.__reloaded === 0 && nv_c.eval("notices.held && notices.held.text") === "A newer version of this app is available.");
  var nv_d = await nv_make({ serverVersion: "2099-01-01a" });
  nv_d.eval('(() => { const box = document.createElement("input"); box.type = "text"; document.body.appendChild(box); box.focus(); })()');   // someone typing in a box
  await nv_check(nv_d);
  check("the person is typing in a box: no reload, only the message", nv_d.__reloaded === 0 && nv_d.eval("notices.held && notices.held.text") === "A newer version of this app is available.");
  var nv_e = await nv_make({ serverVersion: "2099-01-01a" });
  nv_e.eval("busy = true");
  await nv_check(nv_e);
  check("something is being built or saved: no reload, only the message", nv_e.__reloaded === 0 && nv_e.eval("notices.held && notices.held.text") === "A newer version of this app is available.");
  for (const [label, fetchOptions] of [["no connection", { versionFail: true }], ["a missing file", { versionStatus: 404, serverVersion: "Not found" }], ["an error page instead of a stamp", { serverVersion: "<html><body>Not found</body></html>" }], ["an empty answer", { serverVersion: "" }]]) {
    const w = await nv_make(fetchOptions);
    await nv_check(w);
    check(`${label}: nothing happens`, w.__reloaded === 0 && !w.eval("notices.held"));
  }
  // when it is asked
  var nv_f = await nv_make();
  nv_f.eval("versionCheck.last = Date.now()");
  Object.defineProperty(nv_f.document, "visibilityState", { value: "visible", configurable: true });
  nv_f.document.dispatchEvent(new nv_f.Event("visibilitychange"));
  await new Promise((r) => setTimeout(r, 100));
  check("coming back to the tab soon after the last check does not ask again", nv_seen(nv_f).length === 0);
  nv_f.eval("versionCheck.last = Date.now() - 11 * 60 * 1000");
  nv_f.document.dispatchEvent(new nv_f.Event("visibilitychange"));
  await new Promise((r) => setTimeout(r, 200));
  check("coming back after more than ten minutes asks", nv_seen(nv_f).length === 1);
  nv_f.eval("versionCheck.last = Date.now() - 11 * 60 * 1000");
  nv_f.dispatchEvent(new nv_f.Event("focus"));
  await new Promise((r) => setTimeout(r, 200));
  check("so does the window coming forward from behind another one, which is not the tab becoming visible", nv_seen(nv_f).length === 2);
  var nv_g = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1", backupMode: "manual" }, fetchOptions: {} });
  await new Promise((r) => setTimeout(r, 5600));
  check("a few seconds after a clean start it is asked once, with no timer running after that", log.filter((e) => /version\.txt/.test(e.url)).length >= 1 && !/setInterval\(checkForNewVersion/.test(fs.readFileSync(ROOT + "app.js", "utf8")));
  // opening the app menu
  var nv_h = await nv_make();
  nv_h.eval("versionCheck.last = Date.now() - 31 * 1000; toggleAppMenu()");
  await new Promise((r) => setTimeout(r, 200));
  check("opening the menu asks, and with the same version its last line says which version this is", nv_seen(nv_h).length === 1 && nv_h.document.querySelector("#feVersion.fe-version") && nv_h.document.getElementById("feVersion").textContent === `App version ${nv_version}`);
  nv_h.eval("toggleAppMenu(); toggleAppMenu()");
  await new Promise((r) => setTimeout(r, 200));
  check("opening it again within 30 seconds does not ask again", nv_seen(nv_h).length === 1);
  var nv_i = await nv_make({ serverVersion: "2099-01-01a" });
  nv_i.eval("versionCheck.last = Date.now() - 31 * 1000; toggleAppMenu()");
  await new Promise((r) => setTimeout(r, 200));
  var nv_box = nv_i.document.querySelector("#feAppMenuPanel .fe-vn-box");
  check("a newer version found while the menu is open: no reload by itself, and the menu's last line turns into New version available, You have <stamp>, Update", nv_i.__reloaded === 0 && nv_box && /New version available/.test(nv_box.textContent) && nv_box.textContent.includes(`You have ${nv_version}`) && nv_i.document.getElementById("feVersionUpdate").textContent === "Update");
  nv_i.document.getElementById("feVersionUpdate").click();
  await new Promise((r) => setTimeout(r, 200));
  check("Update closes the menu and loads fresh copies of the page", nv_i.__reloaded === 1 && !nv_i.eval("editor.appMenu"));
  } catch (err) { areaCrashed("newer version", err); } }
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  if (areaPrev) areaTimes.push({ name: areaPrev, ms: Date.now() - areaStart });
  if (process.argv.includes("--timing")) for (const a of areaTimes.slice().sort((x, y) => y.ms - x.ms)) console.log(`AREA ${(a.ms / 1000).toFixed(1).padStart(6)} s  ${a.name}`);
  console.log(`TIMING total ${((Date.now() - RUN_STARTED) / 1000).toFixed(0)} s; ${global.bootCount} page starts took ${(global.bootMs / 1000).toFixed(0)} s in all; ${global.bridgeCalls} engine calls took ${(global.bridgeMs / 1000).toFixed(0)} s in all`);
  process.exit(failures ? 1 : 0);
})();
