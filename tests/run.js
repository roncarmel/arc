const { JSDOM } = require("jsdom");
const { execFileSync } = require("child_process");
// Run only some areas: node run.js --only=privacy|tabs   (matches part of an area's name; --list shows the names)
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7).toLowerCase().split("|").filter(Boolean);
const SECTION_NAMES = ["builder landing and participants", "launch screen", "sharing card in the editor", "music sharing", "tidal", "device checks", "sharing what arc built", "music sharing songs", "developer options", "menu popups and the silence help", "first segment tip", "the play tip", "a wait from Spotify", "sign-in renewal", "newer version", "recipe session", "silence stepper width", "startup refresh", "batch seven", "spotify last", "version line", "welcome recipe link", "spotify row", "notice line", "connecting state", "connecting screen", "save retry online", "spotify wording", "spotify merge", "backup cover", "save pacing", "spotify saves", "size limit", "save packer", "playlist ids", "popups close only", "narrow more button", "the silence card", "spotify premium", "python status at the bottom", "questions and feedback", "settings below the segments, pink outline", "the tagline", "duplicate question, format names, empty note and equal widths", "reordering recipes", "card header, pencil and notch", "page start watchdog and version stamps", "startup that survives problems", "build button, big new format button and empty start", "confirming a new format", "scrolling home with the keyboard watch", "privacy section and anonymous counts", "report link on a connection problem", "who sees the editor, and what a rate limit says", 'core', 'the visual format editor', 'dragging rows', 'a format built entirely on screen', 'details', 'one pink look, and rows linked to the bar', 'small changes', 'the color theme', 'all the themes', 'silences, dragging and removing', "the page's styles for tags and phones", 'the title and the tip button on a phone', 'private playlists', 'cover art', 'the format menu fits its contents', 'the default silence goes up to 60 minutes', 'the app menu, and minimalist mode', 'minimalist mode, part two', 'when Spotify cannot be reached', 'saved songs', 'long waits from Spotify', 'a record of Spotify limits'];
// areas that need another area's setup to have run first
const NEEDS = {
  "the page's styles for tags and phones": ["silences, dragging and removing"],
};
const wantRaw = (name) => {
  if (!ONLY.length) return true;
  const hit = (x) => ONLY.some((o) => (process.env.EXACT_AREA ? x.toLowerCase() === o : x.toLowerCase().includes(o)));   // EXACT_AREA=1: whole names only
  return hit(name) || Object.entries(NEEDS).some(([user, deps]) => hit(user) && deps.some((d) => d.toLowerCase() === name.toLowerCase()));
};
// Every page a test opens stays in memory with its timers running until it is closed: when an area starts, the pages from two areas back are closed
// (the area just before may still be read by this one, as NEEDS allows). Pages opened before the first area are shared by all of them and stay.
const openPages = []; let areaSerial = 0;
function closeOldPages() {
  areaSerial += 1;
  for (let i = openPages.length - 1; i >= 0; i--) if (openPages[i].area > 0 && openPages[i].area < areaSerial - 1) { try { openPages[i].w.close(); } catch (err) { /* already gone */ } openPages.splice(i, 1); }
}
// how long each area takes: the time from one area starting to the next (shown with --timing)
const areaTimes = []; let areaPrev = null, areaStart = Date.now();
const want = (name) => { const hit = wantRaw(name); if (hit && areaPrev !== name && !areaTimes.some((a) => a.name === name)) { if (areaPrev) areaTimes.push({ name: areaPrev, ms: Date.now() - areaStart }); areaPrev = name; areaStart = Date.now(); closeOldPages(); } return hit; };
if (process.argv.includes("--list")) { console.log(SECTION_NAMES.join("\n")); process.exit(0); }
const FDBFactory = (require("fake-indexeddb/lib/FDBFactory").default || require("fake-indexeddb/lib/FDBFactory"));
const { spawnSync } = require("child_process");
const fs = require("fs");

// where the app is: the folder above this one, or APP_DIR
const ROOT = (process.env.APP_DIR || require("path").join(__dirname, "..")).replace(/\/?$/, "/");
const html = fs.readFileSync(ROOT + "index.html", "utf8").replace(/<script src="(theme|formats|editor|shared-service|service-spotify|service-tidal|app|sharing)\.js(\?v=[^"]*)?"><\/script>/g, "");
// the three scripts share one scope in a browser, so they are run together here
const appJs = fs.readFileSync(ROOT + "theme.js", "utf8") + "\n" + fs.readFileSync(ROOT + "formats.js", "utf8") + "\n" + fs.readFileSync(ROOT + "editor.js", "utf8") + "\n" + fs.readFileSync(ROOT + "shared-service.js", "utf8") + "\n" + fs.readFileSync(ROOT + "service-spotify.js", "utf8") + "\n" + fs.readFileSync(ROOT + "service-tidal.js", "utf8") + "\n" + fs.readFileSync(ROOT + "app.js", "utf8") + "\n" + fs.readFileSync(ROOT + "sharing.js", "utf8");

// app.js and the Spotify code it uses from service-spotify.js, for the checks that read the code itself
const appSource = () => fs.readFileSync(ROOT + "service-spotify.js", "utf8") + "\n" + fs.readFileSync(ROOT + "app.js", "utf8");

const MADE = 'Made by Arc. Do not edit this description. Built 1 Nov 2026.';
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
// A participant playlist's packed data (app.js packData), for fixtures: packedFor("f1", [ids])
const packedFor = (() => {
  const vm = require("vm");
  const ctx = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(ROOT + "formats.js", "utf8").replace(/\bconst /g, "var ").replace(/\blet /g, "var "), ctx);
  const app = fs.readFileSync(ROOT + "app.js", "utf8");
  vm.runInContext(app.slice(app.indexOf("const HEARD_MAX"), app.indexOf("// The packed data of a description")).replace(/\bconst /g, "var "), ctx);
  return (recipe, heard = []) => ctx.packData({ recipe, heard });
})();
const log = [];
const RUN_STARTED = Date.now();
global.bridgeCalls = 0; global.bridgeMs = 0; global.bootCount = 0; global.bootMs = 0;
const SCOPE_ALL = "playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public user-library-modify ugc-image-upload";
global.planTextArgCounts = [];
// A pretend TIDAL (openapi.tidal.com/v2, JSON:API), for the areas that run Arc under TIDAL (work/tidal-plan.md, stage 4): the same playlists as
// MY_PLAYLISTS that are the person's own, under UUIDs, with numeric song IDs, ISRCs and lengths as "PT2M31S"; pages of 20, as TIDAL sends them.
// options.tidal holds what was written: {created: [{id, name, description, accessType}], adds: [{id, ids}], patches: [{id, attributes}], deletes: [id], descs: {id: text}}
const TIDAL_SILENCE = { "83423070": 30, "83423071": 60, "83423073": 180, "83423075": 300, "83423080": 600 };
const tidalUuid = (n) => `${String(n).padStart(8, "0")}-aaaa-4bbb-8ccc-${String(n).padStart(12, "0")}`;
const TIDAL_PLAYLISTS = MY_PLAYLISTS.filter((p) => p.owner.id === "ron").map((p, i) => ({ id: tidalUuid(i + 1), from: p.id, name: p.name }));
function tidalTrack(id) {
  const silence = TIDAL_SILENCE[id];
  if (silence) return { id, type: "tracks", attributes: { title: "Silence", isrc: "DEAR4" + id.slice(-7), duration: `PT${Math.floor(silence / 60)}M${silence % 60}S` }, relationships: { artists: { data: [{ type: "artists", id: "a0" }] } } };
  const pl = String(Number(id.slice(0, -4))), n = String(Number(id.slice(-4)));   // "10042": playlist 1's song 42
  const ms = 150000 + ((Number(pl) * 7919 + Number(n) * 104729) % 180000);
  return { id, type: "tracks", attributes: { title: `Song ${n}`, isrc: `TEST${pl.padStart(3, "0")}${n.padStart(5, "0")}`, duration: `PT${Math.floor(ms / 60000)}M${(ms % 60000) / 1000}S` }, relationships: { artists: { data: [{ type: "artists", id: "a1" }] } } };
}
const tidalSongIds = (i) => Array.from({ length: 130 }, (_, n) => `${i + 1}${String(n).padStart(4, "0")}`);
function tidalAnswer(options, url, method, init, json) {
  const st = options.tidal = options.tidal || { created: [], adds: [], patches: [], deletes: [], descs: {}, requests: [] };
  const u = new URL(url), path = u.pathname.replace(/^\/v2/, ""), body = init.body ? JSON.parse(init.body) : null;
  st.requests.push(`${method} ${path}`);
  if (!/^Bearer \S/.test((init.headers || {}).Authorization || "")) return json({ errors: [{ status: "401" }] }, 401);
  const all = () => TIDAL_PLAYLISTS.map((p) => ({ id: p.id, name: p.name })).concat(st.created).filter((p) => !st.deletes.includes(p.id));
  const songsOf = (id) => { const p = TIDAL_PLAYLISTS.find((x) => x.id === id); if (p) return tidalSongIds(TIDAL_PLAYLISTS.indexOf(p)); return st.adds.filter((a) => a.id === id).flatMap((a) => a.ids); };
  const asPlaylist = (p) => ({ id: p.id, type: "playlists", attributes: { name: p.name, description: st.descs[p.id] !== undefined ? st.descs[p.id] : (p.description || ""), numberOfItems: songsOf(p.id).length, lastModifiedAt: "2026-11-16T10:00:00Z", accessType: p.accessType || "PUBLIC" }, relationships: { owners: { data: [{ type: "users", id: "777" }] } } });
  const page = (items, mapped) => { const at = Number(u.searchParams.get("page[cursor]") || 0); const next = at + 20 < items.length ? (u.searchParams.set("page[cursor]", String(at + 20)), u.pathname.replace(/^\/v2/, "") + "?" + u.searchParams.toString()) : null; return { data: items.slice(at, at + 20).map(mapped), links: next ? { next } : {} }; };
  if (method === "GET" && path === "/users/me") return json({ data: { id: "777", type: "users", attributes: { username: "ron", country: "US" } } });
  if (method === "GET" && path === "/playlists") {
    // with include=coverArt,suggestedCoverArts: the first playlist has its own cover, the second only suggested ones, the rest none
    const p = page(all(), asPlaylist), want = (u.searchParams.get("include") || "").split(",");
    const art = (id, sizes) => ({ id, type: "artworks", attributes: { mediaType: "IMAGE", files: sizes.map((n) => ({ href: `https://resources.tidal.com/images/${id}/${n}x${n}.jpg`, meta: { width: n, height: n } })) } });
    const included = [];
    for (const d of p.data) {
      if (d.id === TIDAL_PLAYLISTS[0].id && want.includes("coverArt")) { d.relationships = { coverArt: { data: [{ id: "own1", type: "artworks" }] } }; included.push(art("own1", [1080, 640, 320, 160, 80])); }
      if (d.id === TIDAL_PLAYLISTS[1].id && want.includes("suggestedCoverArts")) { d.relationships = { coverArt: { data: [] }, suggestedCoverArts: { data: [{ id: "sug1", type: "artworks" }, { id: "sug2", type: "artworks" }] } }; included.push(art("sug1", [750, 480, 320]), art("sug2", [640])); }
    }
    return json(included.length ? { ...p, included } : p);
  }
  if (method === "POST" && path === "/playlists") { const a = body.data.attributes; const made = { id: tidalUuid(900 + st.created.length), name: a.name, description: a.description, accessType: a.accessType }; st.created.push(made); st.descs[made.id] = a.description; return json({ data: asPlaylist(made) }, 201); }
  let m = path.match(/^\/playlists\/([0-9a-f-]+)\/relationships\/items$/);
  if (m && method === "POST") { if (body.data.length > 50) return json({ errors: [{ status: "400" }] }, 400); st.adds.push({ id: m[1], ids: body.data.map((r) => r.id) }); return json({}, 201); }
  if (m && method === "GET") { const refs = songsOf(m[1]).map((id) => ({ id, type: "tracks" })); const p = page(refs, (r) => r); return json({ ...p, included: p.data.map((r) => tidalTrack(r.id)).map((t) => options.tidalUnplayable ? { ...t, attributes: { ...t.attributes, availability: options.tidalUnplayable.includes(t.id) ? ["DJ"] : ["STREAM"] } } : t).concat([{ id: "a1", type: "artists", attributes: { name: "Artist" } }, { id: "a0", type: "artists", attributes: { name: "silence moments" } }]) }); }
  m = path.match(/^\/playlists\/([0-9a-f-]+)$/);
  if (m) {
    const p = all().find((x) => x.id === m[1]);
    if (!p) return json({ errors: [{ status: "404" }] }, 404);
    if (method === "PATCH") { const a = body.data.attributes; st.patches.push({ id: m[1], attributes: a }); if (a.description !== undefined) st.descs[m[1]] = a.description; if (a.name !== undefined) p.name = a.name; return json({}, 204); }
    if (method === "DELETE") { st.deletes.push(m[1]); return json({}, 204); }
    return json({ data: asPlaylist(p) });
  }
  if (method === "GET" && path === "/tracks") { const want = (u.searchParams.get("filter[isrc]") || "").split(","); st.lookups = (st.lookups || 0) + 1; const songs = want.map((x) => /^TEST(\d{3})(\d{5})$/.exec(x)).filter((m) => m && Number(m[1]) >= 1 && Number(m[1]) <= TIDAL_PLAYLISTS.length && Number(m[2]) < 130).map((m) => tidalTrack(String(Number(m[1])) + m[2].slice(1)));
    return json({ data: Object.keys(TIDAL_SILENCE).map(tidalTrack).filter((t) => want.includes(t.attributes.isrc)).concat(songs) }); }
  m = path.match(/^\/tracks\/(\d+)$/);
  if (m) return json({ data: tidalTrack(m[1]) });
  return json({ errors: [{ status: "404" }] }, 404);
}

function makeFetch(options = {}) {
  return async (url, init = {}) => {
    url = String(url);
    log.push({ url, init });
    const method = (init.method || "GET").toUpperCase();
    const writes = options.writes;
    const json = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
    if (url.startsWith("https://openapi.tidal.com/")) return tidalAnswer(options, url, method, init, json);
    if (options.premiumRequired && url.startsWith("https://api.spotify.com/")) return json({ error: { status: 403, message: "Active premium subscription required for the owner of the app" } }, 403);
    if (url.startsWith("https://music-sharing.roncarmel.workers.dev/")) {   // a pretend Music sharing worker: options.sharing holds its shares
      const sh = options.sharing = options.sharing || { shares: [], words: {}, posts: [], deletes: [], reports: [] };
      if (sh.down) throw new TypeError("Failed to fetch");
      // staleToken: the worker turns down any sign-in but a renewed one, as Spotify does once an hour has passed
      if (sh.staleToken && !String(url).endsWith("/library") && !/^Bearer renewed/.test((init.headers || {}).Authorization || "")) return json({ error: "Spotify did not accept the sign-in.", code: "signin" }, 401);
      const path = new URL(url).pathname, body = init.body ? JSON.parse(init.body) : null;
      const kindOf = (s) => ({ kind: s.kind || "phase", books: s.books || [], bookOther: s.bookOther || "", phases: s.phases || [], moods: s.moods || [], other: s.other || "", description: s.description || "" });
      const out = (s) => ({ id: s.id, name: s.name, by: s.by || null, ...kindOf(s), cover: s.cover || null, service: s.service || "spotify", songs: s.songs, count: s.songs.length, ms: s.ms, avgMs: s.ms / Math.max(1, s.songs.length), artists: s.artists || [], sharedAt: s.sharedAt, updatedAt: s.sharedAt });
      if (method === "GET" && path === "/counts") { sh.countReads = (sh.countReads || 0) + 1; return json({ ids: sh.shares.filter((s) => !s.hidden).sort((a, b) => b.sharedAt - a.sharedAt).map((s) => s.id) }); }
      if (method === "GET" && path === "/library") { sh.libraryReads = (sh.libraryReads || 0) + 1; } if (method === "GET" && path === "/library") return json({ shares: sh.shares.filter((s) => !s.hidden).sort((a, b) => b.sharedAt - a.sharedAt).map(out), words: sh.words, at: Date.now() });
      if (method === "GET" && path.startsWith("/songs/")) { const s = sh.shares.find((x) => x.id === path.slice(7) && !x.hidden); sh.songReads = (sh.songReads || []).concat([{ id: path.slice(7), auth: (init.headers || {}).Authorization || null }]); return s ? json({ id: s.id, names: s.names || null }) : json({ error: "That shared playlist is gone." }, 404); }
      if (method === "GET" && path === "/admin/reports") { sh.ownerAsks = (sh.ownerAsks || 0) + 1; return sh.owner ? json({ shares: sh.adminReports || [] }) : json({ error: "Only the owner of the app can do that." }, 403); }
      if (method === "GET" && path === "/mine") return json({ shares: sh.shares.filter((s) => s.owner === "ron").map((s) => ({ id: s.id, playlist: s.playlist, snapshot: s.snapshot || null, name: s.name, by: s.by || null, ...kindOf(s), descSource: s.descSource || "mine", cover: s.cover || null, count: s.songs.length, ms: s.ms, sharedAt: s.sharedAt, updatedAt: s.sharedAt, hidden: !!s.hidden })) });
      if (method === "POST" && path === "/share") {
        sh.posts.push(body);
        if (sh.refuse) return json(typeof sh.refuse === "string" ? { error: sh.refuse, code: "copy" } : sh.refuse, sh.refuse.status || 409);
        let s = sh.shares.find((x) => x.owner === "ron" && x.playlist === body.playlist);
        if (!s) { s = { id: "s" + (sh.shares.length + 1), owner: "ron", sharedAt: Date.now() }; sh.shares.push(s); }
        Object.assign(s, body);
        return json({ id: s.id });
      }
      if (method === "DELETE" && path.startsWith("/share/")) { sh.deletes.push(path.slice(7)); sh.shares = sh.shares.filter((s) => s.id !== path.slice(7)); return json({ ok: true }); }
      if (method === "POST" && path === "/report") { sh.reports.push(body); return json({ ok: true }); }
      if (method === "POST" && path === "/matches") { sh.matches = (sh.matches || []).concat([{ body, service: (init.headers || {})["X-Arc-Service"] || null }]); return json({ ok: true }); }
      if (method === "POST" && path === "/message") { sh.messages = (sh.messages || []).concat([body]); if (sh.messageFail) return json({ error: sh.messageFail }, 429); return json({ sent: true }); }
      return json({ error: "Not found" }, 404);
    }
    if (url.includes("blocked-words/blocked-words.json")) return json(JSON.parse(fs.readFileSync(ROOT + "blocked-words/blocked-words.json", "utf8")));
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
    if (method === "PUT" && url.includes("/v1/me/library")) {   // saving a song to Liked Songs (a song's menu in Music sharing)
      if (options.failLike) return json({}, 500);
      writes.push({ type: "like", uris: new URL(url).searchParams.get("uris").split(",") });
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => "", json: async () => { throw new Error("no body"); } };
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
      const all = MY_PLAYLISTS.concat(options.extraPlaylists || [], options.createdPlaylists || []).filter((p) => !p || !(options.removedIds && options.removedIds.has(p.id)));   // null: a playlist Spotify will not show the app
      const out = typeof options.leaveOut === "function" ? options.leaveOut(offset) : options.leaveOut;   // playlists Spotify leaves out of this read
      const limit = Math.min(2, Number(u.searchParams.get("limit") || 2));   // pages of at most 2, fewer when asked (Arc reads an empty page in pieces)
      const page = all.slice(offset, offset + limit).filter((p) => !(p && out && out.includes(p.id))).map((p) => { if (!p) return null; const q = options.listWithoutDescriptions ? { ...p, description: undefined } : { ...p, description: (options.descStore && options.descStore[p.id] !== undefined) ? options.descStore[p.id] : p.description, name: (options.nameStore && options.nameStore[p.id] !== undefined) ? options.nameStore[p.id] : p.name }; if (!options.noSnapshots) q.snapshot_id = (options.snapshots && options.snapshots[p.id]) || "snap-" + p.id; return q; });   // tiny pages, to exercise paging
      const next = offset + limit < all.length ? `https://api.spotify.com/v1/me/playlists?limit=2&offset=${offset + limit}` : null;
      if (options.zeroList) return json({ items: [], next: null, total: 0, offset, limit });   // the whole list as 0 of 0 (2026-11-16)
      if (options.emptyFirstPages !== undefined) {   // Spotify's total on every page, and the first page sent empty this many times (as on 2026-11-13)
        const empty = offset < 2 && options.emptyFirstPages > 0;   // any request inside the first page, whatever its size
        if (empty) options.emptyFirstPages -= 1;
        // slots Spotify cannot send for a while: any page holding one comes empty, at any size (2026-11-16)
        const bad = (options.unreadableIds || []).some((id) => page.some((p) => p && p.id === id));
        return json({ items: empty || bad || options.allEmpty ? [] : page, next, total: all.length, offset, limit });
      }
      return json({ items: page, next });
    }
    if (method === "GET" && /\/v1\/playlists\/\w+\?fields=id,name,owner/.test(url) && url.includes("snapshot_id")) {   // one playlist in the list's shape (readListEntry)
      (options.entryReads = options.entryReads || []).push(url.match(/playlists\/(\w+)/)[1]);
      const p = MY_PLAYLISTS.concat(options.extraPlaylists || [], options.createdPlaylists || []).find((x) => x && x.id === url.match(/playlists\/(\w+)/)[1]);
      return p ? json({ ...p, snapshot_id: "snap-" + p.id }) : json({ error: { status: 404 } }, 404);
    }
    if (method === "GET" && /\/v1\/playlists\/\w+(\?|$)/.test(url) && options.descStore) {
      const stored = options.descStore[url.match(/playlists\/(\w+)/)[1]] || "";
      const kept = Array.from(stored).slice(0, options.descLimit || 300).join("");
      return json({ description: kept.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;") });
    }
    const song = method === "GET" && url.match(/\/v1\/tracks\/(\w+)$/);
    if (song) {   // one song: Arc's silences carry the ISRCs of the same album on TIDAL
      const silences = { "5kiJ9x6eX37H5J9lyyXkua": [30, "DEAR41889211"], "4iOpD4OvwCi6ndxpNYk4HG": [60, "DEAR41877634"], "5yM42dAylwB17DomSHGcXM": [180, "DEAR41854451"], "7depNAqAh1r9unkIRzibID": [300, "DEAR41825110"], "3mkOlbSv5RYadx0JsjTrKq": [600, "DEAR41862465"] };
      const [secs, isrc] = silences[song[1]] || [60, "XX0000000000"];
      return json({ uri: "spotify:track:" + song[1], type: "track", duration_ms: secs * 1000, name: "Silence", artists: [{ name: "silence moments" }], external_ids: { isrc: (options.silenceIsrc && options.silenceIsrc[song[1]]) || isrc } });
    }
    if (url.startsWith("https://api.spotify.com/v1/search")) {   // as Spotify answers apps like Arc's: the isrc: filter refused, a search by words allowed (Device checks, 2026-11-16)
      const q = new URL(url).searchParams.get("q") || "";
      (options.searches = options.searches || []).push(q);
      (options.searchForms = options.searchForms || []).push(url.replace(/&q=.*$/, "").replace(/^.*\?type=track&/, ""));
      if (/^isrc:/.test(q)) return { ok: false, status: 403, headers: { get: () => null }, text: async () => "Forbidden", json: async () => ({}) };
      const items = (options.searchable || []).filter((t) => q.toLowerCase().includes(t.name.toLowerCase())).map((t) => ({ id: t.id, name: t.name, type: "track", uri: "spotify:track:" + t.id, external_ids: { isrc: t.isrc }, artists: [{ name: t.artist }], duration_ms: 200000 }));
      return json({ tracks: { items } });
    }
    const m = url.match(/\/playlists\/(\w+)\/items/);
    if (m) {
      (options.trackRequests = options.trackRequests || []).push(m[1]);
      if (options.tracksStatus) return { ok: false, status: options.tracksStatus, headers: { get: (h) => (h === "Retry-After" && options.tracksRetryAfter ? String(options.tracksRetryAfter) : null) }, json: async () => ({}), text: async () => JSON.stringify(options.tracksBody || {}) };
      const u = new URL(url); const offset = Number(u.searchParams.get("offset") || 0);
      // a playlist made during the test holds the songs added to it, as in Spotify
      const added = () => (writes || []).filter((w) => w.type === "add" && w.id === m[1]).flatMap((w) => w.uris).map((uri) => { for (const list of Object.values(TRACKS)) { const it = list.find((x) => x.track && x.track.uri === uri); if (it) return it; } return { track: { uri, type: "track", duration_ms: 60000, name: "Silence", artists: [{ name: "Arc" }] } }; });
      const all = (options.repeatIn === m[1] ? repeatList() : TRACKS[m[1]] || added()) || [];
      const page = all.slice(offset, offset + 50).map((it) => (options.uniqueSongNames && it.track && it.track.name ? { track: { ...it.track, name: `${it.track.name} of ${m[1]}` } } : it));
      const next = offset + 50 < all.length ? `https://api.spotify.com/v1/playlists/${m[1]}/items?limit=50&offset=${offset + 50}` : null;
      return json({ items: page, next });
    }
    return json({}, 404);
  };
}

function fakePyodideFactory() {
  return {
    runPythonAsync: async (code) => { const m = /^set_silence\((.*)\)$/.exec(String(code)); if (m) global.arcSilence = JSON.parse(m[1]); },   // the page hands engine.py the service's silent tracks
    globals: {
      get: (name) => (...args) => {
        if (name === "build_playlists") global.planTextArgCounts.push(args.length);
        const t0b = Date.now();
        const r = spawnSync("python3", [require("path").join(__dirname, "bridge.py"), name, JSON.stringify(args)], { encoding: "utf8", env: { ...process.env, ARC_SILENCE: global.arcSilence || "" } });
        global.bridgeCalls += 1; global.bridgeMs += Date.now() - t0b;
        if (r.status !== 0) throw new Error(r.stderr);
        return r.stdout;
      },
    },
  };
}

// view: which of Arc's views the app page starts in. Most checks were written before Arc's home, for the builder; pass view: "home" for the page as it opens.
async function boot({ url, session = {}, local = {}, fetchOptions = {}, before = null, idb = null, instantRetries = false, htmlChange = null, feedbackUrl = "", view = "builder", panel = true }) {
  const bootStarted = Date.now();
  const dom = new JSDOM(htmlChange ? htmlChange(html) : html, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  openPages.push({ w, area: areaSerial });
  fetchOptions.writes = fetchOptions.writes || [];
  for (const [k, v] of Object.entries(session)) w.sessionStorage.setItem(k, v);
  // Most tests were written when everyone started with one format; a signed-in test with no saved formats gets that starter.
  // Pass formats: null to start with nothing saved at all, as a new visitor does.
  const savedLocal = { ...local };
  if (savedLocal.formats === undefined && session && session.token) savedLocal.formats = OLD_STARTER;
  if (savedLocal.formats === null) delete savedLocal.formats;
  // Recipes always save to Spotify, which would put saves into every signed-in test, so the tests that are not about saving turn it off (savingToSpotify in app.js).
  // Pass backupMode: "spotify" or null to save, as a real visitor does (the old name for the choice, kept so the checks read as before).
  const noSaves = savedLocal.backupMode === undefined || savedLocal.backupMode === "manual";
  delete savedLocal.backupMode;
  for (const [k, v] of Object.entries(savedLocal)) w.localStorage.setItem(k, v);
  Object.defineProperty(w, "crypto", { value: require("crypto").webcrypto });
  w.TextEncoder = TextEncoder;
  if (noSaves) w.arcTestNoSaves = true;
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
  w.document.documentElement.classList.add("view-" + view);   // as the <head> script would (it does not run here)
  if (savedLocal.devMode === "1") w.document.documentElement.classList.add("dev-mode");   // developer mode, as the <head> script would
  w.__scriptsRequested = [];
  w.eval(appJs.replace("const sharing = {", "var sharing = {").replace("const service = (() => {", "var service = (() => {").replace("const previewUrls =", "var previewUrls =").replace("let answerLimitMs = 30000;", "var answerLimitMs = " + (fetchOptions.answerMs || 30000) + ";").replace("let reloadPage =", "var reloadPage =").replace("const THEMES =", "var THEMES =").replace("const editor = {", "var editor = {").replace("const tabDrag =", "var tabDrag =").replace("const recipeEdit =", "var recipeEdit =").replace("const builderHome =", "var builderHome =").replace("const saveState =", "var saveState =").replace("let spotifySaveDelayMs =", "var spotifySaveDelayMs =").replace("let spotifySaveMaxWaitMs =", "var spotifySaveMaxWaitMs =").replace("let playlistsLoadedAt =", "var playlistsLoadedAt =").replace("let signingIn =", "var signingIn =").replace("const APP_VERSION =", "var APP_VERSION =").replace("const versionCheck =", "var versionCheck =").replace("const noticeTiming =", "var noticeTiming =").replace("const notices =", "var notices =").replace("let signInNote =", "var signInNote =").replace("let playlistRefreshMs =", "var playlistRefreshMs =").replace("let SHORT_LIST_RETRY_MS =", "var SHORT_LIST_RETRY_MS =").replace("let playlistPages =", "var playlistPages =").replace("let busy =", "var busy =").replace("let token = null;", "var token = null;").replace("let py = null;", "var py = null;").replace("let formatsValid =", "var formatsValid =").replace("const startupProblems =", "var startupProblems =").replace("let playlists =", "var playlists =").replace("let currentFormats =", "var currentFormats =").replace(/const FEEDBACK_FORM_URL = "[^"]*";/, "const FEEDBACK_FORM_URL = " + JSON.stringify(feedbackUrl) + ";").replace(/\nmain\(\)\.catch\(startupFailed\);\s*$/, "\nwindow.__main = main().catch(startupFailed);\n").replace("let connection =", "var connection =").replace("let appView =", "var appView =").replace(/const WAIT_RELAY_URL = "[^"]*";/, "var WAIT_RELAY_URL = \"\";").replace("let waitRelayMs =", "var waitRelayMs =").replace("const waitAsked =", "var waitAsked =").replace("let retrySleep = (ms) => new Promise((r) => setTimeout(r, ms));", instantRetries ? "var retrySleep = () => Promise.resolve();" : "var retrySleep = (ms) => new Promise((r) => setTimeout(r, ms));").replace("const SILENCE_STEPS =", "var SILENCE_STEPS =").replace("let launchScreen =", "var launchScreen =").replace("const GAP_STEPS =", "var GAP_STEPS =").replace("let startupDone =", "var startupDone =").replace("const limitWait =", "var limitWait =").replace("const personBuild =", "var personBuild =").replace("let slowReadingMs = 10000;", "var slowReadingMs = " + (fetchOptions.slowReadingMs || 10000) + ";").replace("const SPLIT_STALL_MS = 15000;", "const SPLIT_STALL_MS = " + (fetchOptions.stallMs || 15000) + ";"));  // test harness only: lets a test replace the reload
  await Promise.race([w.__main, new Promise((r) => setTimeout(r, 1500))]);   // ready as soon as the page has finished starting up
  await new Promise((r) => setTimeout(r, 30));
  // Most tests were written when the editor was always on the page: the recipe being edited opens in its panel, as a tap on it would (panel: false leaves the landing)
  if (panel && view === "builder" && w.editor && w.editor.activeId && w.openRecipePanel) { await w.openRecipePanel(w.editor.activeId); await new Promise((r) => setTimeout(r, 10)); }
  global.bootCount += 1; global.bootMs += Date.now() - bootStarted;
  return w;
}

// the record in the app menu, and the line under the editor's bar
function menuStatus(w) { w.document.getElementById("feAppMenuButton").click(); const n = w.document.getElementById("feSaveStatus"); const t = n ? n.textContent : ""; w.document.body.click(); return t; }
// Save changes in the recipe panel, then open the same recipe again so a test can go on editing it (saving is explicit since 2026-11-12)
async function saveRecipe(w) { const id = w.editor.activeId; w.document.getElementById("rpSave").click(); await w.openRecipePanel(id); }
function capText(w) { const n = w.document.getElementById(w.eval("recipeEdit.open") ? "feCaption" : "bhCaption"); return n ? n.textContent : ""; }
function capLinks(w) { const c = w.eval("recipeEdit.open") ? "#feCaption" : "#bhCaption"; return Array.from(w.document.querySelectorAll(`${c} .fe-notice-link, ${c} .fe-notice-ok, ${c} .fe-notice-count`)); }
// One playlist for a participant, as Build on a recipe does after Who is it for? Waits until Arc is ready, runs the build and returns where it ended (personBuild).
async function buildFor(w, id, code = "T", repeat = null) {
  await waitFor(() => w.eval("!!token && connection === 'ready' && !!py && formatsValid && !busy"), 20000);
  await w.eval(`buildForParticipant(${JSON.stringify(id)}, ${JSON.stringify(code)}, ${JSON.stringify(repeat)})`);
  return JSON.parse(w.eval("JSON.stringify(personBuild)"));
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

  // 2. songs from playlists longer than one page are all read
  var w1_songs = await w1.eval("loadMyPlaylists().then(() => loadTracks(playlists.find((p) => p.name === '💗 spacious + gentle').id)).then((t) => t.length)");
  check("songs from paged playlist items were all read (130 minus skipped)", w1_songs > 100 && w1_songs <= 130, String(w1_songs));

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
  var w5_b = await buildFor(w5, "x");
  check("not-owned playlist explained, and nothing is made", w5_b.state === "blocked" && w5_b.problems.some((p) => /is not yours/.test(p[0])), JSON.stringify(w5_b.problems));

  // 6b. first runtime versions unavailable: falls back to a later one
  var w6 = await boot({ url: "http://127.0.0.1:8000/", session: { token: JSON.stringify({ value: "t", expires: Date.now() + 3600000, scope: SCOPE_ALL }) }, fetchOptions: { brokenVersions: ["v0.29.3", "v0.29.2"] } });
  await waitFor(() => /ready$|Could not load/.test(w6.document.getElementById("pythonStatus").textContent), 15000);
  check("falls back to a later runtime version", /Pyodide 0\.29\.1 ready$/.test(w6.document.getElementById("pythonStatus").textContent) && w6.eval("currentFormats[0].id") === "format-1", w6.document.getElementById("pythonStatus").textContent);

  // 6c. every version unavailable: clear message, dropdown says so
  var w7 = await boot({ url: "http://127.0.0.1:8000/", session: { token: JSON.stringify({ value: "t", expires: Date.now() + 3600000, scope: SCOPE_ALL }) }, fetchOptions: { brokenVersions: ["v0.29.3", "v0.29.2", "v0.29.1", "v0.29.0", "v0.28.3", "v0.27.7"] } });
  await waitFor(() => /Could not load Python/.test(w7.document.getElementById("pythonStatus").textContent), 15000);
  check("clear message when Python cannot load", /Could not load Python/.test(w7.document.getElementById("pythonStatus").textContent) && /Python could not start/.test(w7.document.getElementById("pythonNote").textContent) && !/More options/.test(w7.document.getElementById("pythonNote").textContent), w7.document.getElementById("pythonStatus").textContent);

  // 6d. bad formats text: dropdown explains instead of staying blank
  check("a bad formats box is explained where the formats are, and Build is off", /could not be read/.test(w4.document.getElementById("formatEditor").textContent) && w4.document.getElementById("create").disabled === true, w4.document.getElementById("formatEditor").textContent);

  // 6g. "All recipes" previews every format once, with one closing line
  var two = 'FORMATS = {"b1-evocative": {"name": "evo {n}", "segments": [("💗 spacious + gentle", 30), ("🛋 rest", 30)]}, "second": {"name": "second {n}", "silence between segments": "1 min", "segments": [("💗💗 evocative", 20), ("🛋 rest", 20)]}}';
  var w8 = await boot({ url: "http://127.0.0.1:8000/", session: { token: JSON.stringify({ value: "t", expires: Date.now() + 3600000, scope: SCOPE_ALL }) }, local: { formats: two } });
  check("page sends at most 7 arguments to build_playlists (the last are what they heard and the repeats)", global.planTextArgCounts.length === 0 || Math.max(...global.planTextArgCounts) <= 7, String(global.planTextArgCounts));
  // two setup flows: nothing chosen at first, existing when a Client ID is already saved
  var hid = (w, id) => w.document.getElementById(id).hidden;
  check("new visitors see neither flow, and nothing below the choices", hid(fresh, "flowNew") && hid(fresh, "flowExisting") && hid(fresh, "connectBlock") && hid(fresh, "spSteps") && !hid(fresh, "spAsk"));
  var returning = await boot({ url: "http://127.0.0.1:8000/", local: { clientId: "abc" } });
  check("the existing-app steps show a close-up of the app on Spotify's dashboard, ringed, and the old screenshots are gone", returning.document.querySelector('#flowExisting img[src="setup-spotify/open-app.png"]') && returning.document.querySelector("#flowExisting .tx-ring") && !fs.existsSync(ROOT + "step-open-app-phone.jpg") && !fs.existsSync(ROOT + "step-create-app.jpg"));
  check("a saved Client ID opens the existing-app flow", !hid(returning, "flowExisting") && hid(returning, "flowNew") && !hid(returning, "connectBlock"));
  var sp_d = fresh.document;
  check("the answers are radio buttons with none chosen, Next beside Back waits for a choice (Ron, 2026-11-16, mockups/setup-radio V)", sp_d.querySelector("#spAsk .sp-choices").getAttribute("role") === "radiogroup" && [...sp_d.querySelectorAll("[data-flow]")].every((b) => b.getAttribute("role") === "radio" && b.getAttribute("aria-checked") === "false") && sp_d.getElementById("spNext").disabled && !sp_d.getElementById("spNext").hidden && sp_d.getElementById("spNext").parentElement === sp_d.getElementById("setupBack").parentElement && !sp_d.querySelector(".sp-choice-go"));
  sp_d.querySelector('[data-flow="new"]').click();
  check("a tap chooses without going on, and Next is ready", sp_d.querySelector('[data-flow="new"]').getAttribute("aria-checked") === "true" && !hid(fresh, "spAsk") && hid(fresh, "spSteps") && !sp_d.getElementById("spNext").disabled);
  sp_d.querySelector('[data-flow="new"]').dispatchEvent(new fresh.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  check("an arrow key moves the choice", sp_d.querySelector('[data-flow="existing"]').getAttribute("aria-checked") === "true" && sp_d.querySelector('[data-flow="new"]').getAttribute("aria-checked") === "false" && sp_d.querySelector('[data-flow="existing"]').tabIndex === 0);
  sp_d.querySelector('[data-flow="new"]').click();
  sp_d.getElementById("spNext").click();
  check("Next shows the steps, with Back alone under them", !hid(fresh, "spSteps") && sp_d.getElementById("spNext").hidden);
  check("choosing create shows the create flow and the connect block", !hid(fresh, "flowNew") && hid(fresh, "flowExisting") && !hid(fresh, "connectBlock"));
  var createText = fresh.document.getElementById("flowNew").textContent;
  check("create flow gives exact form instructions", /App name and App description, and leave Website blank:\s*ArcCopy/.test(createText) && /Redirect URIs, then (press|click|tap) Add:\s*http:\/\/127\.0\.0\.1:8000\/Copy/i.test(createText) && /check Web API only/.test(createText), createText);
  fresh.document.getElementById("setupBack").click();
  check("Back from the steps returns to the question with the answer still chosen and Next ready", !hid(fresh, "spAsk") && sp_d.querySelector('[data-flow="new"]').getAttribute("aria-checked") === "true" && !sp_d.getElementById("spNext").disabled && !sp_d.getElementById("spNext").hidden);
  fresh.document.querySelector('[data-flow="existing"]').click(); fresh.document.getElementById("spNext").click();
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
  check("in a browser the setup text still says tab", /it will open in a new tab\)/.test(w1.document.getElementById("flowNew").textContent) && /Switch back to this tab/.test(w1.document.getElementById("flowExisting").textContent));
  var hs = await boot({ url: "http://127.0.0.1:8000/", before: (w) => { Object.defineProperty(w.navigator, "standalone", { value: true, configurable: true }); } });
  var hsLinks = [...hs.document.querySelectorAll('a[href*="developer.spotify.com"]')];
  check("opened from an iPhone's Home Screen, both dashboard links open in Safari, not a panel", hsLinks.length === 2 && hsLinks.every((a) => a.getAttribute("href") === "x-safari-https://developer.spotify.com/dashboard" && !a.hasAttribute("target")), hsLinks.map((a) => a.outerHTML).join(" "));
  check("and the setup text says Safari and this app", /it will open in Safari\), log in with your Spotify Premium account/.test(hs.document.getElementById("flowNew").textContent) && /Switch back to this app any time/.test(hs.document.getElementById("flowExisting").textContent));
  check("other links are left alone there (TIDAL's two dashboard links open in Safari too)", [...hs.document.querySelectorAll("a[href]")].filter((a) => /^x-safari/.test(a.getAttribute("href"))).length === 4 && [...hs.document.querySelectorAll('a[href*="developer.tidal.com"]')].every((a) => a.getAttribute("href") === "x-safari-https://developer.tidal.com/dashboard"));

  // 6f. copy button gives feedback
  w1.document.getElementById("copyRedirect").click();
  await new Promise((r) => setTimeout(r, 100));
  check("copy button says Copied", w1.document.getElementById("copyRedirect").textContent === "Copied", w1.document.getElementById("copyRedirect").textContent);
  var cfCopied = [];
  w1.navigator.clipboard = { writeText: async (t) => { cfCopied.push(t); } };
  var cfButtons = w1.document.querySelectorAll("#flowNew .tx-copy .copy-field");
  for (const b of cfButtons) b.click();
  await new Promise((r) => setTimeout(r, 100));
  check("Arc (for App name and App description) and the Redirect URI each have a Copy button that copies the text in its box", cfButtons.length === 2 && cfCopied.join("|") === "Arc|http://127.0.0.1:8000/", cfCopied.join("|"));

  // 6h. clearing saved data forgets the Client ID, formats and sign-in, after asking
  var wClear = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { clientId: "keep-me", formats: MINI } });
  wClear.eval("reloadPage = () => { window.__reloaded = true; }");
  wClear.eval("showView('home', false)");
  wClear.document.getElementById("feAppMenuButton").click();
  wClear.document.getElementById("feClear").click();
  check("Sign out and clear data in home's menu asks first in a popup, and clears nothing yet", wClear.document.getElementById("infoOverlay").hidden === false && wClear.document.getElementById("infoTitle").textContent === "Sign out and clear data" && !!wClear.document.querySelector("#infoSlot #eeClear #clearYes") && wClear.localStorage.getItem("clientId") === "keep-me" && !!wClear.sessionStorage.getItem("token"));
  wClear.document.querySelector("#eeClear .dlg-cancel").click();
  check("Cancel closes it and leaves everything saved", wClear.document.getElementById("infoOverlay").hidden === true && wClear.document.getElementById("eeClear").hidden === true && wClear.localStorage.getItem("clientId") === "keep-me" && !wClear.__reloaded);
  wClear.eval("openInfo('eeClear')");
  wClear.document.getElementById("clearYes").click();
  await waitFor(() => wClear.__reloaded === true, 5000);
  check("confirming forgets the Client ID, formats and sign-in, then reloads", wClear.localStorage.length === 0 && wClear.sessionStorage.length === 0 && wClear.__reloaded === true, `${wClear.localStorage.length} local, ${wClear.sessionStorage.length} session`);
  check("troubleshooting is available before connecting too", !!fresh.document.getElementById("clearYes") && fresh.document.getElementById("appSection").hidden === true);

  check("no Support me: no Ko-fi link, caption or cup on the page", !fresh.document.getElementById("supportButton") && !fresh.document.getElementById("supportCaption") && !fresh.document.querySelector('a[href*="ko-fi"], img[src="cup-border.png"]'));

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
  var css0 = fs.readFileSync(ROOT + "index.html", "utf8");
  check("hidden always means hidden, even for elements the page styles with display (like the flex rows)", /\[hidden\] \{ display: none !important; \}/.test(css0) && /\.row \{[^}]*display: flex/.test(css0));
  var bB = await buildFor(wB, "mini");
  var creates = writesOf(oB, "create");
  check("a participant's build makes one playlist, private, named with their code and the recipe", bB.state === "done" && creates.length === 1 && creates[0].public === false && /^T · mini · \d+ \w+$/.test(creates[0].name), JSON.stringify(creates) + JSON.stringify(bB));
  check("its description says it is Arc's and whom it is for", /^Made by Arc\. Do not edit this description\. For participant T\. Built /.test(creates[0].description), creates[0].description);
  var addsFor = (o, id) => writesOf(o, "add").filter((w) => w.id === id);
  var firstUris = addsFor(oB, creates[0].id).flatMap((a) => a.uris);
  check("songs were added up to 100 at a time", addsFor(oB, creates[0].id).length === Math.ceil(firstUris.length / 100) && firstUris.length > 0, String(firstUris.length));
  var silenceAt = firstUris.reduce((acc, u, i) => (u === SILENCE_30 ? acc.concat(i) : acc), []);
  check("one silence track sits between the two segments", silenceAt.length === 1 && silenceAt[0] > 0 && silenceAt[0] < firstUris.length - 1, JSON.stringify(silenceAt));
  var musicUris = firstUris.filter((u) => u !== SILENCE_30);
  check("no song repeats within the playlist", new Set(musicUris).size === musicUris.length);
  var bB2 = await buildFor(wB, "mini");
  var second = writesOf(oB, "create")[1];
  var secondUris = second ? addsFor(oB, second.id).flatMap((a) => a.uris).filter((u) => u !== SILENCE_30) : [];
  check("their next playlist has none of the songs they heard in the first", bB2.state === "done" && secondUris.length > 0 && secondUris.every((u) => !musicUris.includes(u)), JSON.stringify(bB2));


  // F. a permissions failure is explained
  var oE = { denyCreate: true };
  var wE = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: oE });
  var bE = await buildFor(wE, "mini");
  check("a refused permission stops the build and says so in the participant's row, and nothing is made", bE.state === "fail" && /Spotify/.test(bE.error) && writesOf(oE, "create").length === 0, JSON.stringify(bE));

  // G. when nothing can be made there is no Create and nothing is touched
  var oF = { extraPlaylists: [{ id: "old1", name: "huge 1", owner: { id: "ron" }, description: MADE }] };
  var wF = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: '{"huge": {"name": "huge {n}", "segments": [("💗 spacious + gentle", 99999)]}}' }, fetchOptions: oF });
  var bF = await buildFor(wF, "huge");
  check("an impossible recipe makes nothing, and says why", bF.state === "blocked" && bF.problems.length > 0 && oF.writes.length === 0, JSON.stringify(bF.problems));

  // H. Delete recipe leaves the playlists built from it: they are participants'
  var TWO = '{"a": {"name": "alpha {n}", "segments": [("💗 spacious + gentle", 10)]}, "b": {"name": "beta {n}", "segments": [("🛋 rest", 10)]}}';
  var oG2 = {};
  var wG2 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: TWO }, fetchOptions: oG2 });
  await waitFor(() => wG2.eval("connection") === "ready", 15000);
  wG2.eval('showView("builder")');
  wG2.eval("editor.activeId = 'b'; renderEditor(); askDeleteFormat()");
  var del2 = wG2.document.getElementById("feDeleteDialog");
  check("Delete recipe offers no box, and says participants' playlists stay", !wG2.document.getElementById("feDeleteBuilt") && /Playlists built from this recipe for participants stay\./.test(del2.textContent));

  // I. many playlists to remove are sent in batches of 40
  var many = Array.from({ length: 95 }, (_, i) => ({ id: "m" + i, name: "mini " + (i + 1), owner: { id: "ron" }, description: MADE }));
  var oH = { extraPlaylists: many };
  var wH = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: oH });
  await waitFor(() => wH.eval("connection") === "ready", 15000);
  await wH.eval("service.deletePlaylists(" + JSON.stringify(many.map((p) => p.id)) + ")");
  check("removals are batched at 40", JSON.stringify(oH.writes.map((w) => w.uris.length)) === "[40,40,15]", JSON.stringify(oH.writes.map((w) => w.uris && w.uris.length)));

  // I2. how-to help for formats, under the editor
  var fh = wB.document.getElementById("formatHelp");
  var editorBox = wB.document.getElementById("formatEditor");
  var rpWrap = wB.document.getElementById("recipePanelWrap");
  check("the editor is the last thing in the recipe panel (no buttons under it), and the help under the panel and its note, ahead of Step 3", editorBox.nextElementSibling === null && rpWrap.nextElementSibling.id === "editorNote" && rpWrap.nextElementSibling.nextElementSibling.id === "formats" && rpWrap.nextElementSibling.nextElementSibling.nextElementSibling === fh && fh.nextElementSibling.tagName === "H2" && fh.open === false && /How recipes work/.test(fh.querySelector("summary").textContent));
  var helpText = fh.textContent;
  check("the help explains segments, silence, mixes and names, and has no troubleshooting section", ["Segments", "Silence", "Mixes", "Names"].every((t) => Array.from(fh.querySelectorAll("h3")).some((h) => h.textContent === t)) && !/If something goes wrong/.test(fh.textContent) && fh.querySelectorAll("ul").length === 0);
  check("the hidden text is not in the way: it is hidden from sight and from assistive tools", wB.document.getElementById("formats").hidden === true && wB.document.getElementById("formats").getAttribute("aria-hidden") === "true");

  // I3. the Python status moved out of the way
  check("the Python status is the DEV menu's foot, short: the versions and ready", !!wB.document.querySelector("#devMenu #pythonStatus.dm-foot") && /^(Python [\d.]+ · )?Pyodide [\d.]+ ready$/.test(wB.document.getElementById("pythonStatus").textContent) && !wB.document.querySelector("#appSection #pythonStatus"), wB.document.getElementById("pythonStatus").textContent);


  // ---------------- the top of the page, the starting template, and the wording
  var pageHtml = fs.readFileSync(ROOT + "index.html", "utf8");
  check("the page is titled Arc, in pink", /<title>Arc<\/title>/.test(pageHtml) && t0.document.querySelector("h1").textContent === "Arc" && /\n  h1 \{[^}]*color: var\(--accent\)/.test(pageHtml), t0.document.querySelector("h1").textContent);
  check("a one-line tagline opens the welcome page", /^Ceremony playlist tools for your music library$/.test(t0.document.querySelector(".tagline").textContent) && t0.document.getElementById("welcomePage").contains(t0.document.querySelector(".tagline")));
  var aboutFresh = fresh.document.getElementById("about");
  var aboutText = aboutFresh.textContent;
  check("it starts closed once a Client ID is saved, and once connected", returning.document.getElementById("about").open === false && t0.document.getElementById("about").open === false);
  var staticText = pageHtml.replace("Yes, I have", "").replace("I have done this before", "").replace("No, this is my first time", "").replace("I (Ron) read every report and respond when I can.", "").replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<details id="guideSection"[\s\S]*?<details id="moreOptions"/, "").replace(/<[^>]+>/g, " ");
  var firstPerson = staticText.match(/\b(my|mine|myself|I|I'm|I've|I'll)\b/gi) || [];
  check("no first-person wording anywhere in the page text, apart from the setup choice you worded yourself, Ron's line in Report a problem, and the guide for facilitators, which is in Ron's", firstPerson.length === 0, JSON.stringify(firstPerson));
  check("the two setup answers are plain labels", /Yes, I have/.test(fresh.document.getElementById("loginSection").textContent) && /No, this is my first time/.test(fresh.document.getElementById("loginSection").textContent));
  var tpl = t0.document.getElementById("formats").value;
  check("the editor starts with one format called Generated playlist, with one segment waiting for a playlist", t0.document.querySelectorAll("#feTabs .fe-tab").length === 1 && t0.document.querySelector("#feTabs .fe-tab").textContent === "Generated playlist" && t0.document.querySelectorAll("#feRows .fe-row").length === 1 && t0.document.querySelector("#feRows .fe-row .fe-title").textContent === "Choose a playlist", t0.document.getElementById("formatEditor").textContent);
  check("the recipe it starts with is format-1", t0.eval("currentFormats[0].id") === "format-1");
  var t0b_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn() });
  var t0b = await buildFor(t0b_w, "format-1");
  check("building before choosing a playlist says so, and creates nothing", t0b.state === "blocked" && t0b.problems.some((p) => /^A segment in Generated playlist has no playlist yet\.$/.test(p[0].replace(/[\u2066-\u2069]/g, "")) && p[1] === "Choose one in the recipe."), JSON.stringify(t0b.problems));


  // ---------------- returning visitors: a friendly welcome with one button, setup steps tucked away
  // ---------------- the three pages: welcome, the one-time setup, and the app
  var pg = (w) => ["welcome", "setup", "app"].filter((p) => w.document.documentElement.classList.contains("page-" + p)).join();
  check("a new visitor sees the welcome page, with Start setup", pg(fresh) === "welcome" && !!fresh.document.getElementById("startSetup") && fresh.document.getElementById("welcomePage").contains(fresh.document.getElementById("startSetup")));
  check("the setup page asks Have you set up Arc before?, under the band and the line to Spotify with its link, with the Back button under the steps, not above", fresh.document.querySelector("#spAsk h2").textContent === "Have you set up Arc before?" && !!fresh.document.querySelector("#loginSection > .wp-band") && !!fresh.document.querySelector("#spJoint .wp-ok svg") && !fresh.document.querySelector("#spJoint .sp-num") && !!fresh.document.getElementById("setupBack") && !fresh.document.getElementById("setupBack").closest(".card"));
  check("each answer says how long it takes, and nothing mentions tabs, the Spotify app or the Client ID", [...fresh.document.querySelectorAll("#spAsk .sp-choice-time")].map((x) => x.textContent).join("|") === "Takes a couple of minutes.|Takes about a minute." && !/tab|Client ID|app\b/i.test(fresh.document.getElementById("spAsk").textContent));
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
  pgc.document.getElementById("feAppMenuButton").click();
  var pgHead = fs.readFileSync(ROOT + "index.html", "utf8");


  // ---------------- the playlist count in Step 1 follows creates and removals
  var oCount = {};
  var wCount = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: oCount });
  var countText = () => wCount.document.getElementById("connectedMessage").textContent;
  await buildFor(wCount, "mini");
  await waitFor(() => /6 playlists found/.test(countText()), 5000);
  check("after building a playlist the count goes from 5 to 6", countText() === "Connected as Ron. 6 playlists found.", countText());
  var tcss = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");


  // ---------------- problem reports
  var REPORT_KEYS = ["appVersion", "browser", "windowSize", "python", "lastError", "earlierErrors", "recentSteps"];
  var reportParams = (w) => JSON.parse(w.eval("JSON.stringify(reportDetails())"));
  var params = (href) => new URL(href).searchParams;

  var rp = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI, clientId: "SECRET-CLIENT-ID-9" } });
  await readyToPreview(rp);
  check("Report a problem has its own block, opened from the app menu, that explains what happens", !!rp.document.getElementById("reportBlock").closest("footer") && rp.document.getElementById("reportBlock").hidden === true && /Say what happened\. I \(Ron\) read every report and respond when I can\./.test(rp.document.getElementById("reportBlock").textContent));
  var rf = rp.document.getElementById("reportForm"), rq = reportParams(rp);
  check("the report is written in the page: a box for what happened, an optional email, and Send report, pale until something is typed", !!rf && rf.querySelector("#reportText") && rf.querySelector("#reportEmail").type === "email" && rf.querySelector(".mf-send").disabled === true && /Send report/.test(rf.querySelector(".mf-send").textContent) && !rp.document.getElementById("reportLink"));
  check("the details sent are exactly these seven, and nothing else", JSON.stringify(Object.keys(rq).sort()) === JSON.stringify([...REPORT_KEYS].sort()), JSON.stringify(Object.keys(rq)));
  check("the details are real: version, browser, window size, python, last error, steps", rq.appVersion === "2026-11-16zr" && / on /.test(rq.browser) && /^\d+x\d+$/.test(rq.windowSize) && /^ready \(Python v[\d.]+\)$/.test(rq.python) && rq.lastError === "none" && rq.earlierErrors === "none" && /^page opened \(0:\d\d\) > connected, 5 playlists found \(0:\d\d\) > python ready \(0:\d\d\)$/.test(rq.recentSteps), JSON.stringify(rq));
  rp.document.getElementById("reportSentToggle").click();
  var shown = rp.document.getElementById("reportPreview").textContent;
  check("Sent with your message opens to show people exactly what goes with it", rp.document.getElementById("reportSent").hidden === false && /Version: 2026-11-16zr/.test(shown) && /Browser: .* on /.test(shown) && /Window size: \d+x\d+/.test(shown) && /Python: ready \(v/.test(shown) && /Last error: none/.test(shown) && /Recent steps: page opened \(0:\d\d\) > connected/.test(shown), shown);
  check("every Report this problem link opens the page's report form, not another site", ["mainReportHint", "loginReportHint", "connectionReportHint"].every((id) => { const a = rp.document.getElementById(id).querySelector("a"); return a.classList.contains("report-open") && a.getAttribute("href") === "#"; }));

  // scrubbing: anything in quotation marks is a name that could be private
  check("scrubbing hides quoted names but keeps normal apostrophes", rp.scrubError("Could not find a playlist named 'My Secret List'. It couldn't be read.") === "Could not find a playlist named .... It couldn't be read." && rp.scrubError('Got: ("Private Name", 20)') === "Got: (..., 20)" && rp.scrubError("'Lone Name' is not yours.") === "... is not yours." && rp.scrubError("x".repeat(500)).length === 400, rp.scrubError("Could not find a playlist named 'My Secret List'. It couldn't be read."));

  // an unexpected failure offers a report with that failure filled in, and never leaks private data
  var oRp = { buildFailIn: "new1", buildFail: 500 };
  var rp2 = await boot({ url: "http://127.0.0.1:8000/", session: { token: JSON.stringify({ value: "TOKEN-VALUE-XYZ", expires: Date.now() + 3600000, scope: SCOPE_ALL }) }, local: { formats: MINI, clientId: "SECRET-CLIENT-ID-9" }, fetchOptions: oRp });
  check("no report link is offered when nothing has gone wrong", !visible(rp2, "mainReportHint") && !visible(rp2, "loginReportHint"));
  var rp2_b = await buildFor(rp2, "mini");
  check("an unexpected failure stops the build and says so in the participant's row", rp2_b.state === "fail" && /Spotify returned 500/.test(rp2_b.error), JSON.stringify(rp2_b));
  var q2 = reportParams(rp2);
  check("a report carries the failure, without any quoted text", /Spotify returned 500/.test(q2.lastError) && !/['"]/.test(q2.lastError), q2.lastError);
  check("and the steps that led to it", /participant build started \(0:\d\d\) > .*participant build failed \(0:\d\d\)/.test(q2.recentSteps), q2.recentSteps);
  await waitFor(() => (oRp.sharing && oRp.sharing.messages || []).length === 1, 4000);
  var auto2 = oRp.sharing.messages[0];
  check("an unexpected failure is reported by Arc itself: the message says so, with the details and the request log", auto2.kind === "problem" && auto2.auto === true && /^Sent by Arc when this happened: .*Spotify returned 500/.test(auto2.message) && /Spotify returned 500/.test(auto2.details.lastError) && /"listReads"/.test(auto2.log) && !auto2.email, JSON.stringify(auto2).slice(0, 300));
  await new Promise((r) => setTimeout(r, 50));
  var rp2_row = rp2.document.querySelector('#bhPeople [data-code="T"] .er-box');
  check("the participant's row says Arc sent the details, in place of Report this problem", /Arc sent the details to its developer\./.test(rp2_row.textContent) && !/Report this problem/.test(rp2_row.textContent), rp2_row.textContent);
  check("it is marked as sent for this version, by its kind", JSON.parse(rp2.localStorage.getItem("autoReported")).v === rp2.eval("APP_VERSION") && JSON.parse(rp2.localStorage.getItem("autoReported")).kinds.length === 1);
  await rp2.eval("autoReport('Spotify returned 500 for 7 songs')"); await rp2.eval("autoReport('Spotify returned 500 for 9 songs')");
  check("the same kind of problem is sent once per version, whatever its numbers; an expected one never", oRp.sharing.messages.length === 2 && (await rp2.eval("autoReport('Could not reach Spotify')")) === false && oRp.sharing.messages.length === 2);
  check("Python's script not arriving from the CDN is a network problem, never sent", (await rp2.eval("autoReport('Could not load Python from the internet. Check your connection, then reload. Details are in the browser console. (Could not load the Python runtime from https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js)')")) === false && oRp.sharing.messages.length === 2);
  rp2.localStorage.setItem("autoReported", JSON.stringify({ v: "2000-01-01a", kinds: JSON.parse(rp2.localStorage.getItem("autoReported")).kinds }));
  check("a new version reports it again", (await rp2.eval("autoReports.clear(); autoReport('Spotify returned 500 for 7 songs')")) === true && oRp.sharing.messages.length === 3);
  oRp.sharing.messages = [];
  rp2.eval("openReport()");
  check("Report this problem opens the report form in a popup, its box ready for typing", rp2.document.getElementById("infoOverlay").hidden === false && rp2.document.getElementById("infoSlot").contains(rp2.document.getElementById("reportForm")) && rp2.document.activeElement === rp2.document.getElementById("reportText"));
  var rp2_text = rp2.document.getElementById("reportText"), rp2_send = rp2.document.querySelector("#reportForm .mf-send");
  rp2_text.value = "It stopped."; rp2_text.dispatchEvent(new rp2.Event("input"));
  check("typing something lights Send report", rp2_send.disabled === false);
  rp2.document.getElementById("reportEmail").value = "not an address";
  rp2_send.click();
  await new Promise((r) => setTimeout(r, 30));
  check("an email that is not one is said under the form, and nothing is sent", /doesn\u2019t look right/.test(rp2.document.querySelector("#reportForm .mf-error").textContent) && oRp.sharing.messages.length === 0);
  rp2.document.getElementById("reportEmail").value = "maya@example.com";
  rp2_send.click();
  await waitFor(() => !rp2.document.querySelector("#reportBlock .mf-done").hidden, 4000);
  var sent2 = oRp.sharing.messages[0];
  check("Send report sends what was typed, the email and the six details to the worker, then says Report sent", oRp.sharing.messages.length === 1 && sent2.kind === "problem" && sent2.message === "It stopped." && sent2.email === "maya@example.com" && /Spotify returned 500/.test(sent2.details.lastError) && rp2.document.getElementById("reportForm").hidden && /Report sent/.test(rp2.document.querySelector("#reportBlock .mf-done").textContent), JSON.stringify(sent2));
  var sent2log = JSON.parse(sent2.log || "{}");
  check("a report also sends the Spotify request log, with the report's details, its steps and errors, and the list reads", sent2log.report && /Spotify returned 500/.test(sent2log.report.lastError) && Array.isArray(sent2log.steps) && sent2log.steps.length >= 3 && Array.isArray(sent2log.errors) && Array.isArray(sent2log.listReads) && sent2log.listReads.length >= 1 && /Spotify request log: about \d+ KB, attached/.test(rp2.document.getElementById("reportPreview").textContent), Object.keys(sent2log).join());
  rp2.eval("recordError('first'); recordError('second')");
  check("earlier errors are kept beside the last one, each with its time", /^second/.test(reportParams(rp2).lastError) && /Spotify returned 500 .*\| first \(\d+:\d\d\)$/.test(reportParams(rp2).earlierErrors), reportParams(rp2).earlierErrors);
  var everything = JSON.stringify(sent2) + rp2.document.getElementById("reportPreview").textContent;
  check("the report never contains the sign-in, the Client ID, playlist names, or song titles", !/TOKEN-VALUE-XYZ|SECRET-CLIENT-ID-9|spacious|gentle|rest|mini \d|Song \d|Artist/.test(everything.replace(/Recent steps|restore|ready|recentSteps/g, "")), everything.slice(0, 200));
  rp2.document.querySelector("#reportBlock .mf-again").click();
  check("Send another brings back an empty form", !rp2.document.getElementById("reportForm").hidden && rp2_text.value === "" && rp2_send.disabled === true);
  rp2.closeInfo(true);

  // problems the person can fix themselves are recorded, but do not offer a report
  var rp3 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: 'FORMATS = {"a": ' } });
  await new Promise((r) => setTimeout(r, 500));
  rp3.eval("refreshReportBox()");
  check("a formats typo is recorded as the last error, with no report link offered", /^Last error: Could not read the formats/m.test(rp3.document.getElementById("reportPreview").textContent) && !visible(rp3, "mainReportHint"), rp3.document.getElementById("reportPreview").textContent);
  var rp4 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn() });
  await buildFor(rp4, "format-1");
  rp4.eval("refreshReportBox()");
  check("a segment with no playlist chosen is recorded as the last error, without any names", /Last error: Build blocked: 1 problem in the recipe/.test(rp4.document.getElementById("reportPreview").textContent) && !visible(rp4, "mainReportHint"), rp4.document.getElementById("reportPreview").textContent);

  // other places a failure can happen
  var rp6 = await boot({ url: "http://127.0.0.1:8000/?code=abc&state=st1", session: { pkceState: "st1", pkceVerifier: "v" }, local: { clientId: "SECRET-CLIENT-ID-9" }, fetchOptions: { failToken: true } });
  check("a refused sign-in offers a report link in Step 1", visible(rp6, "loginReportHint") && /Spotify refused the sign-in/.test(rp6.document.getElementById("loginMessage").textContent) && !/SECRET-CLIENT-ID-9/.test(JSON.stringify(reportParams(rp6))));
  check("Python that cannot load offers a report link", visible(w7, "mainReportHint") && /Could not load Python/.test(reportParams(w7).lastError) && /not loaded/.test(reportParams(w7).python));
  var rp7 = await boot({ url: "http://127.0.0.1:8000/?error=access_denied&state=st1" });
  check("cancelling on Spotify's page is not treated as a problem to report", !visible(rp7, "loginReportHint"));

  // privacy wording
  check("the setup page says the Client ID stays in the browser and goes only to Spotify; the About section points to Report a problem in the app menu", /Your Client ID is not a secret\. It stays in this browser and goes only to Spotify\./.test(fresh.document.getElementById("loginSection").textContent) && /If you run into a problem, choose Report a problem in the app menu\./.test(fresh.document.getElementById("about").textContent));



  check("what goes with a report sits behind Sent with your message, closed at first", rp.document.getElementById("reportSentToggle").textContent.trim() === "Sent with your message" && rp.document.getElementById("reportSent").contains(rp.document.getElementById("reportPreview")));


  // ---------------- Sign out and clear data says the recipes stay in Spotify
  var cb = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: null } });
  var clearSection = [...cb.document.querySelectorAll("#eeClear p")].map((p) => p.textContent).join(" ").replace(/\s+/g, " ");
  check("the Sign out and clear data popup says what it does and that the recipes stay in Spotify", /^Signs you out of Spotify and erases what Arc keeps in this browser\./.test(clearSection) && /Your recipes stay in Spotify and come back when you connect again\./.test(clearSection) && !/If something looks stuck/.test(clearSection));
  check("its buttons are Cancel and a red Sign out and clear", JSON.stringify([...cb.document.querySelectorAll("#eeClear .dlg-foot button")].map((b) => b.textContent.trim())) === JSON.stringify(["Cancel", "Sign out and clear"]) && cb.document.getElementById("clearYes").classList.contains("dlg-danger"));


  // ---------------- the old numbered steps
  var st = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI } });
  var $s = (id) => st.document.getElementById(id);
  var h2s = Array.from(st.document.querySelectorAll("#appSection h2")).filter((h) => !h.closest("#builderHome, #recipePanelWrap")).map((h) => h.textContent);

  // ---------------- headings: the page title outranks the step headings, which are easy to spot
  var hcss = fs.readFileSync(ROOT + "index.html", "utf8");
  var sizeOf = (sel) => { const m = hcss.match(new RegExp("\\n  " + sel + " \\{ font-size: clamp\\(([\\d.]+)rem, ([\\d.]+)vw, ([\\d.]+)rem\\)")); return m ? { min: Number(m[1]), max: Number(m[3]) } : null; };
  var h1s = sizeOf("h1"), h2s2 = sizeOf("h2");
  check("the page title is larger than the step headings, at every window size", !!h1s && !!h2s2 && h1s.max > h2s2.max && h1s.min > h2s2.min, JSON.stringify([h1s, h2s2]));
  check("step headings are large (at least 1.35rem, up to 1.7rem), and the title larger still", h2s2.min >= 1.35 && h2s2.max >= 1.7 && h1s.max >= 2.5);


  // ---------------- every numbered section title says what the person will do
  var verbs = ["Find", "Connect", "Edit", "Build", "Back up"];
  var allH2 = Array.from(t0.document.querySelectorAll("h2")).filter((h) => !h.closest("#msOverlay, #builderHome, #recipePanelWrap")).map((h) => h.textContent);
  check("the welcome and setup pages have their own headings, and every numbered section title left is an action", JSON.stringify(allH2) === JSON.stringify(["Connecting to Spotify", "Setup complete!", "Unwrapping the update", "Tools", "Which music service do you use?", "Connect your Spotify account", "Have you set up Arc before?", "Find your Client ID", "1. Connect to Spotify", "1. Connect to Spotify", "2. Edit your recipes", "3. Build playlists"]) && allH2.slice(7).every((t) => verbs.some((v) => t.replace(/^\d\.\s/, "").startsWith(v))), JSON.stringify(allH2));


  // ---------------- What is this app? headings, and placeholder icons on the buttons
  var ab = t0.document.getElementById("about");
  var leads = Array.from(ab.querySelectorAll("strong")).map((x) => x.textContent);
  check("the headings in What is this app? stand on their own line, without trailing periods", JSON.stringify(leads) === JSON.stringify(["What it does", "What it's good for", "How it works", "What you need", "Reporting problems", "Privacy"]) && Array.from(ab.querySelectorAll("p")).filter((p) => p.querySelector("strong + br")).length === 5, JSON.stringify(leads));
  var pill = Array.from(t0.document.querySelectorAll("button:not(.linklike):not(.theme-swatch):not(.mf-sent-toggle):not(#cnContinue):not(#usOk), a.button-link")).filter((b) => !b.closest("#formatEditor") && !b.closest("#startupProblem") && !b.closest("#createDialog") && !b.closest(".dlg-foot") && !b.closest("#devMenu") && b.id !== "infoClose" && b.id !== "msClose" && b.id !== "msCard" && b.id !== "homeBuilder" && !b.classList.contains("wp-tool-head") && !b.closest("#homeMore .hp-ee-bar") && !b.classList.contains("sp-choice") && b.id !== "waitStrip" && !b.closest("#appBar") && b.id !== "updateGet" && !b.classList.contains("tv-row") && !b.closest("#builderHome") && !b.closest("#recipePanelWrap"));   // the builder's landing and panel draw their icons inline; the tutorial rows have a frame   // the Music sharing card (covers, not an icon) and the update card's Get it (its gift is on the card)   // the Setup complete button has words only; the startup popup and the info popup's close draw their icons inline
  pill = pill.filter((b) => !b.classList.contains("wp-svc"));   // the service tiles are cards, not pink buttons
  var pillsIn = pill.filter((b) => b.querySelector("img.btn-icon"));
  check("every pink button has an icon in front of its label", pill.length >= 15 && pillsIn.length === pill.length, `${pillsIn.length} of ${pill.length} ` + pill.filter((b) => !b.querySelector("img.btn-icon")).map((b) => b.id || b.outerHTML.slice(0, 60)).join(","));
  check("each icon is a small file, 20 by 20 (the Build sparkles 24 by 24), decorative, and the file exists", pill.every((b) => { const i = b.querySelector("img.btn-icon"); const size = i.getAttribute("src") === "icons/build.svg" ? "24" : "20"; return i.getAttribute("width") === size && i.getAttribute("height") === size && i.getAttribute("alt") === "" && /^icons\/[a-z]+\.svg$/.test(i.getAttribute("src")) && fs.existsSync(ROOT + i.getAttribute("src")); }));
  check("text-style links (Restore, Reset, Undo) have no icons", Array.from(t0.document.querySelectorAll("button.linklike")).every((b) => !b.querySelector("img")));
  check("each icon sits left of a label (a forward button such as Get started, right of it), and the label is its own element", pill.every((b) => { const i = b.querySelector("img.btn-icon, img"); return i === (["getStarted", "startSetup", "wpWhichNext", "spNext"].includes(b.id) ? b.lastElementChild : b.firstElementChild) && !!b.querySelector(".btn-label, span"); }));
  var icss = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  // changing a label must not remove the icon
  var ic = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  await waitFor(() => ic.eval("connection") === "ready", 15000);
  var cp = ic.document.getElementById("copyRedirect");
  cp.dispatchEvent(new ic.Event("click"));
  await new Promise((r) => setTimeout(r, 200));
  check("the Copy button says Copied and shows a check as its icon", /^Copied$/.test(cp.textContent) && cp.querySelector("img.btn-icon").getAttribute("src") === "icons/confirm.svg", cp.textContent + " " + cp.querySelector("img.btn-icon").getAttribute("src"));
  await new Promise((r) => setTimeout(r, 2300));
  check("after two seconds the Copy button goes back to its copy icon and label", cp.textContent === "Copy" && cp.querySelector("img.btn-icon").getAttribute("src") === "icons/copy.svg");
  check("the Build button keeps its icon", ic.document.getElementById("create").querySelector("img").getAttribute("src") === "icons/build.svg");
  var rs = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI + "\n# x" } });
  rs.eval("saveFile = () => {}");







  // ---------------- the Sign out and clear data question
  var cq = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI } });
  cq.eval("reloadPage = () => { window.__reloadedByClear = true; }");
  cq.eval("openInfo('eeClear')");
  var cqCopied = []; cq.navigator.clipboard = { writeText: async (t) => { cqCopied.push(t); } };
  cq.localStorage.setItem("clientId", "cq-id");
  cq.document.getElementById("clearYes").click();
  await waitFor(() => cq.__reloadedByClear === true, 5000);
  check("Sign out and clear clears everything and reloads", cq.localStorage.length === 0 && cq.__reloadedByClear === true);
  check("and it copies nothing to the clipboard, and says nothing about it: it is for leaving a computer that is not yours", cqCopied.length === 0 && !/clipboard/i.test(cq.document.getElementById("eeClear").textContent));
  var so = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { clientId: "so-id", formats: MINI } });
  so.eval("reloadPage = () => { window.__reloadedByStartOver = true; }");
  var soCopied = []; so.navigator.clipboard = { writeText: async (t) => { soCopied.push(t); } };
  so.eval("startOver()");
  await waitFor(() => so.__reloadedByStartOver === true, 5000);
  check("Start over (developer options) clears the same way, but copies the Client ID first", so.localStorage.length === 0 && soCopied.join("|") === "so-id");


  // ---------------- times read with the day and the time of day (the merge's questions use them)
  var tb = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI } });
  var afternoon = tb.eval("formatBackupTime(" + JSON.stringify(new Date(2026, 9, 25, 14, 5, 9).toISOString()) + ")");
  check("a time shows the day and the time of day", /^Oct 25, 2026 at 2:05\s?PM$/.test(afternoon.replace(/\u202f/g, " ")), JSON.stringify(afternoon));
  var morning = tb.eval("formatBackupTime(" + JSON.stringify(new Date(2026, 9, 5, 9, 7, 0).toISOString()) + ")");
  check("a morning time reads naturally, with no leading zero on the day or hour", /^Oct 5, 2026 at 9:07\s?AM$/.test(morning.replace(/\u202f/g, " ")), morning);


  // ---------------- What it's good for: the closing sentence
  var goodFor = Array.from(t0.document.getElementById("about").querySelectorAll("p")).find((p) => /^What it's good for/.test(p.textContent));


  // ---------------- the Client ID steps: no Settings page is involved
  var ciNew = fresh.document.getElementById("flowNew");
  var ciOld = fresh.document.getElementById("flowExisting");
  var lastNew = Array.from(ciNew.querySelectorAll(":scope > li")).pop().textContent.trim();
  var lastOld = Array.from(ciOld.querySelectorAll(":scope > li")).pop().textContent.trim();
  check("creating an app ends with copying the Client ID shown on the new app's page, no Settings", lastNew === "Copy the Client ID shown on your new app's page." && !/Settings/.test(lastNew), lastNew);
  check("using an existing app ends with copying the Client ID shown on its page, no Settings", lastOld === "Copy the Client ID shown on its page." && !/Settings/.test(lastOld), lastOld);



  // ---------------- the menu's popups (the tutorial, Silence between segments): gray body text, with headings, buttons, links and widgets standing out
  var moCss = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  check("the menu's popups are gray by default", /\.menu-popup(, [#\w-]+)* \{ color: var\(--muted\); \}/.test(moCss) && ["tutorialSection", "silenceHelp"].every((id) => fresh.document.getElementById(id).classList.contains("menu-popup")));
  check("their headings stay in the normal text color", /footer\.debug h3 \{[^}]*color: var\(--fg\)/.test(moCss));
  var moreBoxes = Array.from(fresh.document.querySelectorAll(".menu-popup"));
  var loud = moreBoxes.flatMap((b) => Array.from(b.querySelectorAll("p, label, span"))).filter((el) => el.closest(".btn-label") === null && el.hasAttribute("style") && /color\s*:/.test(el.getAttribute("style")));
  check("no paragraph in the menu's popups sets its own text color, so the gray applies everywhere", loud.length === 0, loud.map((e) => e.id || e.textContent.slice(0, 30)).join(","));


  // ---------------- a build and the playlist list (2026-11-15: a build sat a minute on Reading your playlists, then failed on a short re-read)
  var bl_o = { emptyFirstPages: 0 };
  var bl = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: bl_o });
  await waitFor(() => bl.eval("connection === 'ready' && !!py"), 20000);
  var bl_pages = bl_o.listCalls;
  var bl_b1 = await buildFor(bl, "mini", "T");
  check("a build right after connecting uses the list it read then: the only read is the one after the playlist is made", bl_b1.state === "done" && bl_o.listCalls - bl_pages === bl_pages, `${bl_pages} then ${bl_o.listCalls}`);
  bl.eval("BUILD_LIST_FRESH_MS = 0");
  bl_o.emptyFirstPages = 99;
  var bl_b2 = await buildFor(bl, "mini", "U");
  check("a list read again for a build that comes short leaves the build on the list already held: it is made, Arc stays connected, no wait", bl_b2.state === "done" && bl.eval("connection") === "ready" && !bl.eval("limitWait.active") && /playlist list short, the one read earlier kept/.test(reportParams(bl).recentSteps), JSON.stringify(bl_b2) + " " + reportParams(bl).recentSteps);
  check("the short list was still recorded and reported", /^Spotify listed /.test(reportParams(bl).lastError) || /Spotify listed /.test(reportParams(bl).earlierErrors), reportParams(bl).lastError);

  // ---------------- the report's details name python
  var pyKeys = Object.keys(reportParams(rp));
  check("the report fills a field named python, and no field named planner", JSON.stringify(pyKeys.sort()) === JSON.stringify(["appVersion", "browser", "earlierErrors", "lastError", "python", "recentSteps", "windowSize"]) && !pyKeys.includes("planner"), JSON.stringify(pyKeys));

  // ---------------- gray rounded boxes for the three collapsible sections
  var cardCss = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  var sect = (w, id) => w.document.getElementById(id);
  check("What is this app? and How to edit formats are gray rounded boxes", ["about", "formatHelp"].every((id) => sect(fresh, id).classList.contains("card")) && /\.card \{[^}]*border-radius: 10px/.test(cardCss) && /\.card \{[^}]*background: var\(--card\)/.test(cardCss));
  check("their titles share one look: bold pink, clickable", /details\.card > summary \{ cursor: pointer; font-weight: 600; color: var\(--accent\); \}/.test(cardCss) && ["about", "formatHelp"].every((id) => !!sect(fresh, id).querySelector(":scope > summary")));
  check("things inside the boxes (samples, code, confirmations) stand out from the gray", /details\.card \.card, details\.card pre, details\.card figure\.sample \{ background: var\(--bg\); \}/.test(cardCss));


  // ---------------- after the embeds experiment was reverted
  var finalHtml = fs.readFileSync(ROOT + "index.html", "utf8");
  // page text names the service (service.name, <span data-service>), not Spotify; the strings left are Spotify's own setup, Device checks and developer notes
  var sv_left = [];
  for (const f of ["app.js", "editor.js", "sharing.js", "formats.js", "theme.js"]) {
    fs.readFileSync(ROOT + f, "utf8").split("\n").forEach((line, i) => {
      const code = line.replace(/(^|\s)\/\/.*$/, "");
      for (const m of code.matchAll(/(["'`])((?:\\.|(?!\1).)*?)\1/g)) if (/(^|[^A-Za-z])Spotify(?![A-Za-z])/.test(m[2])) sv_left.push(m[2]);
    });
  }
  var sv_allowed = ["Create an app inside your Spotify account", "save: covers wait, Spotify is limiting uploads", "Spotify refused the renewal, or did not answer.", "Spotify sent back ${got.length} characters, differing from character ${at + 1} on.", "Opens Spotify at the song", "Spotify should open the playlist with that song picked out.", "Spotify sent a short list. Read again, all there."];
  check("page text in the scripts names the service, not Spotify (Spotify's setup, Device checks and developer notes aside)", sv_left.every((t) => sv_allowed.includes(t) || /Spotify's own cover/.test(t)), JSON.stringify(sv_left.filter((t) => !sv_allowed.includes(t))));
  var sv_html = fs.readFileSync(ROOT + "index.html", "utf8");
  check("the markup marks the service's name for filling in, and the requirement (Spotify Premium) where it is said (the setup step; the welcome page's tiles name each)", (sv_html.match(/<span data-service>Spotify<\/span>/g) || []).length >= 25 && (sv_html.match(/data-requirement-name>Spotify Premium</g) || []).length === 1 && (sv_html.match(/ data-requirement>/g) || []).length === 1);
  check("only TIDAL's file names TIDAL's addresses", ["app.js", "editor.js", "sharing.js", "formats.js", "shared-service.js", "service-spotify.js"].every((f) => !/tidal\.com/.test(fs.readFileSync(ROOT + f, "utf8").replace(/https:\/\/developer\.tidal\.com"\]/, ""))) && /openapi\.tidal\.com/.test(fs.readFileSync(ROOT + "service-tidal.js", "utf8")));
  check("only the service file talks to Spotify: no Spotify address, URI, request, sign-in token, wait, permission or ID packing elsewhere, and songs carry the service's id, not a URI", ["app.js", "editor.js", "sharing.js", "formats.js", "engine.py"].every((f) => !/api\.spotify\.com|spotify:(track|playlist):|spotifyRequest|\bspotify\(|spotifyPause\(|pausedSecondsLeft|spotifyIdToBytes|bytesToSpotifyId|\bSCOPES\b/.test(fs.readFileSync(ROOT + f, "utf8").replace(/(^|\s)\/\/.*$/gm, ""))) && ["app.js", "editor.js", "sharing.js"].every((f) => !/(^|[^\w.])token\b(?!\s*[:"])/.test(fs.readFileSync(ROOT + f, "utf8").replace(/(^|\s)\/\/.*$/gm, "").replace(/(["'`])(?:\\.|(?!\1).)*?\1/g, ""))) && /const spotifyService = \{/.test(fs.readFileSync(ROOT + "service-spotify.js", "utf8")) && !/\["uri"\]/.test(fs.readFileSync(ROOT + "engine.py", "utf8")));
  check("the page has eight scripts of its own, with the theme first, and nothing about embeds", finalHtml.match(/<script src="[^"]+"><\/script>/g).join("").replace(/\?v=[^"]+/g, "") === '<script src="theme.js"></script><script src="formats.js"></script><script src="editor.js"></script><script src="shared-service.js"></script><script src="service-spotify.js"></script><script src="service-tidal.js"></script><script src="app.js"></script><script src="sharing.js"></script>' && finalHtml.indexOf('<script src="theme.js">') < finalHtml.indexOf("</head>") && !/embeds/i.test(finalHtml) && !/embeds/i.test(appSource()) && !fs.existsSync(ROOT + "embeds.js"));
  check("the app never names an outside script, so no Ko-fi or Tally code can run in the page", !/tally\.so\/widgets|overlay-widget|storage\.ko-fi\.com\/cdn\/scripts/.test(appSource() + finalHtml));
  check("Tally is left only in the startup problem popup, whose report link must work when the scripts did not start", (finalHtml.match(/tally\.so/g) || []).length === 1 && /id="startupReport"[^>]*href="https:\/\/tally\.so\/r\/VppLZN"/.test(finalHtml) && !/FEEDBACK_FORM_URL/.test(appSource()));
  var stale = await boot({ url: "http://127.0.0.1:8000/?embeds=on", session: { ...signedIn(), embeds: "on" }, local: { formats: MINI } });


  
  } catch (err) { areaCrashed("core", err); }
}
  if (want('the visual format editor')) { try {
  // ================================================================ the visual format editor
  var TWO_F = 'FORMATS = {"warm": {"name": "Warm focus {n}", "silence between segments": "1 min", "segments": [("💗 spacious + gentle", 20), ("🛋 rest", 40)]}, "ed_cool": {"name": "Cool {n}", "segments": [({"💗 spacious + gentle": 60, "🛋 rest": 40}, 30)]}}';
  var ed1 = await boot({ url: EDURL, session: signedIn(), local: { formats: TWO_F }, fetchOptions: { extraPlaylists: [{ id: "g1", name: "Warm focus 3", owner: { id: "ron" } }] } });

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
  ed1.document.dispatchEvent(new ed1.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("Escape closes the list", !ed1.document.getElementById("feOptions"));
  rowsOf(ed1)[2].querySelector(".fe-more").click();
  check("a menu is open", !!ed1.document.querySelector(".fe-menu"));
  ed1.document.getElementById("feCaption").click();
  check("clicking anywhere else closes it", !ed1.document.querySelector(".fe-menu"));
  check("a segment with no playlist is marked, and Preview refuses it", true);

  // ---- the card's own menu, and deleting
  check("Duplicate is greyed while the recipe has changes not saved", ed1.document.getElementById("feDuplicate").disabled);
  await saveRecipe(ed1);
  ed1.document.getElementById("feDuplicate").click();
  ed1.document.getElementById("feDuplicateConfirm").click();
  check("Duplicate adds a copy, named so, selected, with its own rows", JSON.stringify(tabsOf(ed1)) === JSON.stringify(["Warm focus", "Cool", "Warm focus copy"]) && ed1.document.querySelector('#feTabs .fe-tab[aria-pressed="true"]').textContent === "Warm focus copy" && rowsOf(ed1).length === 3);

  ed1.eval("askDeleteFormat()");
  var ed_dlg = ed1.document.getElementById("feDeleteDialog");
  check("Delete asks first, naming the recipe, and says it goes from Spotify too while participants' playlists stay", !!ed_dlg && /Delete Warm focus copy\?/.test(ed_dlg.textContent) && ed_dlg.querySelector("h3 i").textContent === "Warm focus copy" && /This permanently removes the recipe from this list and from Spotify\. Playlists built from this recipe for participants stay\./.test(ed_dlg.textContent) && tabsOf(ed1).length === 3, ed_dlg && ed_dlg.textContent);
  ed1.document.getElementById("feDeleteCancel").click();
  check("Cancel keeps the format", !ed1.document.getElementById("feDeleteDialog") && tabsOf(ed1).length === 3);

  ed1.eval("askDeleteFormat()");
  ed1.document.getElementById("feDeleteConfirm").click();
  check("Delete recipe removes it and selects another", JSON.stringify(tabsOf(ed1)) === JSON.stringify(["Warm focus", "Cool"]) && !ed1.document.getElementById("feDeleteDialog") && ed1.document.querySelector('#feTabs .fe-tab[aria-pressed="true"]').textContent === "Warm focus");
  for (let i = 0; i < 2; i++) { ed1.eval("askDeleteFormat()"); ed1.document.getElementById("feDeleteConfirm").click(); }
  check("every format can be deleted, leaving only the big New recipe button, and nothing to build", tabsOf(ed1).length === 0 && !ed1.document.getElementById("feCreateFirst") && !/You don't have any formats yet/.test(ed1.document.getElementById("formatEditor").textContent) && ed1.document.querySelector(".fe-toprow").classList.contains("fe-noformats") && ed1.document.getElementById("feNewFormat").textContent.trim() === "New recipe" && !ed1.document.getElementById("feCard") && ed1.document.getElementById("create").disabled === true, ed1.document.getElementById("formatEditor").textContent);
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
  var x_uib = await buildFor(x_uiw, x_uiw.eval("editor.activeId"));
  check("building makes a playlist named from the recipe", x_uib.state === "done" && x_ui.writes.some((w) => w.type === "create" && /^T · UI test · \d+ \w+$/.test(w.name)), JSON.stringify(x_ui.writes.filter((w) => w.type === "create")));
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
  var steps = Array.from(aboutBox.querySelectorAll("ol li")).map((li) => li.textContent);
  var wCss = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  var uiNames = Array.from(fresh.document.querySelectorAll("span.ui")).map((x) => x.textContent);
  check("the names of buttons and links in running text are marked up the same way", ["New segment", "Add a mix", "Reset to default", "Report a problem"].every((n) => uiNames.includes(n)), JSON.stringify(uiNames));
  check("no button or link name is left in single or curly quotes, since the style now sets it apart", !/[\u2018\u2019'](More options|Preview|Create|New segment|Add a mix)[\u2018\u2019']/.test(fresh.document.body.textContent));


  // ---------------- gray standard text, with white only where it is needed
  var gCss = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  var gh = fs.readFileSync(ROOT + "index.html", "utf8");
  var aboutRange = gh.slice(gh.indexOf('<details id="about"'), gh.indexOf("</details>", gh.indexOf('<details id="about"')));
  var outside = gh.replace(aboutRange, "").replace(/<section id="silenceHelp"[\s\S]*?<\/section>/, "").slice(gh.indexOf("<body")).replace(/<span class="(?:hp|wp-tool)-text">(?:<span class="hp-soon">[^<]*<\/span>)?<b>[^<]*<\/b>/g, "").replace('<span class="hp-more-text"><b>Everything else</b>', "").replace("<b>Bold</b> is shown", "");   // the tools' titles on home and the welcome page, Everything else's title, and Developer options showing what bold means there
  var setupText = fresh.document.getElementById("spSteps");
  check("the connected message is plain gray text, not wrapped in any highlight", !fresh.document.getElementById("connectedMessage").querySelector(".ui"));
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
  check("the text the editor writes has no colors in it, and the engine does not need any", !/"colors"/.test(T(hl)));
  var css2 = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  var legacyColors = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"x": {"name": "Old {n}", "colors": [3, None, 5], "segments": [("💗 spacious + gentle", 10), ("silence", "1 min"), ("🛋 rest", 10)]}}' } });
  check("formats saved with the old colors still load, and the colors are simply ignored", tabsOf(legacyColors).join("|") === "Old" && rowsOf(legacyColors).length === 2);
  rowsOf(legacyColors)[0].querySelector(".fe-inc").click();
  check("and the next edit writes them out without colors", !/"colors"/.test(T(legacyColors)));


  
  } catch (err) { areaCrashed("one pink look, and rows linked to the bar", err); }
}
  if (want('small changes')) { try {
  // ================================================================ small changes
  check("Everything else on home and each topic in it scroll into view once opened (bottom in view, never past the top; with or without motion)", /function bringOpenedIntoView\(details\) \{\n  if \(!details\.closest \|\| !details\.closest\("#homeMore"\)/.test(appJs) && /const by = Math\.min\(below, top - gap\);/.test(appJs) && /foldMotion\(details, frames\(full\), true, \(finished\) => \{ if \(finished\) bringOpenedIntoView\(details\); \}\)/.test(appJs) && /details\.open && !motionAllowed\(details\)\) bringOpenedIntoView\(details\)/.test(appJs));
  check("the title has the app icon on its left", (() => { const h1 = fresh.document.querySelector("h1"); const img = h1.querySelector("img.app-icon"); return h1.classList.contains("brand") && !!img && img.getAttribute("src") === "arc-mark.png" && img.getAttribute("alt") === "" && h1.firstElementChild === img && h1.textContent === "Arc"; })());
  var pngSize = (name) => { const b = fs.readFileSync(ROOT + name); return b.slice(0, 8).toString("hex") === "89504e470d0a1a0a" ? [b.readUInt32BE(16), b.readUInt32BE(20)].join("x") : "not a png"; };
  var headHtml = fs.readFileSync(ROOT + "index.html", "utf8").slice(0, fs.readFileSync(ROOT + "index.html", "utf8").indexOf("\n</head>"));   // the real end of the head: the Phone width script holds one as text
  check("every icon the page asks for exists, at the size its name or link says", pngSize("favicon-16.png") === "16x16" && pngSize("favicon-32.png") === "32x32" && pngSize("apple-touch-icon.png") === "180x180" && fs.readFileSync(ROOT + "favicon.ico").readUInt16LE(2) === 1 && fs.readFileSync(ROOT + "favicon.ico").readUInt16LE(4) === 3, [pngSize("favicon-16.png"), pngSize("apple-touch-icon.png")].join(" "));
  check("the page links the tab icons and the home-screen icon, and each linked file exists", /<link rel="icon" href="favicon\.ico" sizes="16x16 32x32 48x48">/.test(headHtml) && /<link rel="icon" href="favicon-32\.png" type="image\/png" sizes="32x32">/.test(headHtml) && /<link rel="icon" href="favicon-16\.png" type="image\/png" sizes="16x16">/.test(headHtml) && /<link rel="apple-touch-icon" href="apple-touch-icon\.png">/.test(headHtml) && (headHtml.match(/href="([^"]+\.(?:ico|png))"/g) || []).every((m) => fs.existsSync(ROOT + m.slice(6, -1))));
  var y_conn = await boot({ url: "http://127.0.0.1:8000/", session: signedIn() });
  var y_cs = y_conn.document.getElementById("connectedSection");
  var y_headrow = y_cs.querySelector(".headrow");
  check("the heading row holds the heading, and the message is under it", !!y_headrow && y_headrow.firstElementChild.tagName === "H2" && y_headrow.nextElementSibling.id === "connectedMessage");
  var y_silRow = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: 'FORMATS = {"s": {"name": "Sil {n}", "segments": [("💗 spacious + gentle", 10), ("silence", "30 min"), ("🛋 rest", 10)]}}' } });
  rowsOf(y_silRow)[0].querySelector(".fe-tag").click();
  y_silRow.document.getElementById("feTagLonger").click();
  check("a silence steps from 30 min to 35, 40, 45, and so on in 5 minute steps", y_silRow.document.getElementById("feTagDuration").textContent === "35 min");
  for (let i = 0; i < 5; i++) y_silRow.document.getElementById("feTagLonger").click();
  check("and the last stop is 60 min", y_silRow.document.getElementById("feTagDuration").textContent === "60 min" && /\("silence", "60 min"\)/.test(T(y_silRow)));
  y_silRow.document.getElementById("feTagShorter").click();
  check("coming back down it passes 55", y_silRow.document.getElementById("feTagDuration").textContent === "55 min");

  
  } catch (err) { areaCrashed("small changes", err); }
}
  if (want('the color theme')) { try {
  // ================================================================ the color theme
  var y_thm = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI } });
  var y_root = y_thm.document.documentElement.style;
  check("Color is a popup of its own (from the ⋯ menus) with 17 swatches, single-color names, Pink first and chosen, no name shown", y_thm.document.querySelector("#colorBlock.menu-popup > h3").textContent === "Color" && Array.from(y_thm.document.querySelectorAll("#themeSwatches .theme-swatch")).length === 17 && y_thm.document.querySelector("#themeSwatches .theme-swatch").getAttribute("aria-label") === "Pink" && y_thm.document.querySelector("#themeSwatches [aria-checked=true]").getAttribute("aria-label") === "Pink" && /#ff38b8|rgb\(255, 56, 184\)/.test(y_thm.document.querySelector("#themeSwatches [aria-checked=true]").style.background) && Array.from(y_thm.document.querySelectorAll("#themeSwatches .theme-swatch")).every((o) => o.style.background !== "" && o.getAttribute("role") === "radio" && !/\band\b/.test(o.getAttribute("aria-label"))));
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
  check("two colors in the address change the whole page, and the chooser says they are custom", y_typed.document.documentElement.style.getPropertyValue("--button") === "#0a84ff" && y_typed.document.querySelector("#themeSwatches [aria-checked=true]").getAttribute("aria-label") === "Custom colors" && Array.from(y_typed.document.querySelectorAll("#themeSwatches .theme-swatch")).length === 18 && !y_typed.document.getElementById("themeNote").hidden && /address/.test(y_typed.document.getElementById("themeNote").textContent));
  check("they are kept for the tab, so they survive the trip to Spotify and back", y_typed.sessionStorage.getItem("themeColors") !== null);
  Array.from(y_typed.document.querySelectorAll("#themeSwatches .theme-swatch")).find((o) => o.dataset.id === "pinks-and-grays").click();

  check("choosing a theme returns to its colors and forgets the typed ones", y_typed.document.documentElement.style.getPropertyValue("--button") === "#ff38b8" && y_typed.sessionStorage.getItem("themeColors") === null && y_typed.document.getElementById("themeNote").hidden === true && Array.from(y_typed.document.querySelectorAll("#themeSwatches .theme-swatch")).length === 17 && y_typed.document.querySelector("#themeSwatches [aria-checked=true]").getAttribute("aria-label") === "Pink" && y_typed.localStorage.getItem("theme") === "pinks-and-grays");
  var y_junk = await boot({ url: "http://127.0.0.1:8000/?accent=banana&neutral=808080", session: signedIn() });
  check("colors that are not colors are ignored", y_junk.document.documentElement.style.getPropertyValue("--button") === "#ff38b8");
  var y_reset = await boot({ url: "http://127.0.0.1:8000/?theme=reset", session: { ...signedIn(), themeColors: JSON.stringify({ accent: "#0a84ff", neutral: "#808080" }) } });
  check("?theme=y_reset in the address forgets y_typed colors", y_reset.document.documentElement.style.getPropertyValue("--button") === "#ff38b8" && y_reset.sessionStorage.getItem("themeColors") === null);
  var y_tcss = fs.readFileSync(ROOT + "index.html", "utf8");
  var y_styleOnly = y_tcss.slice(y_tcss.indexOf("<style>"), y_tcss.indexOf("</style>"));
  check("no accent color is written into the page's styles except as a fallback inside a variable", !/(^|[^-(])#ff38b8/.test(y_styleOnly.replace(/:root \{[^}]*\}/g, "").replace(/var\((?:[^()]|\([^()]*\))*\)/g, "")) && !/#c2188f/.test(y_styleOnly.replace(/:root \{[^}]*\}/g, "")), "");


  
  } catch (err) { areaCrashed("the color theme", err); }
}
  if (want('all the themes')) { try {
  // ================================================================ all the themes
  var z_t = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI } });
  var z_THEMES = Array.from(z_t.eval("THEMES"));
  var z_ids = z_THEMES.map((t) => t.id);
  check("there are 17 themes, each with its own id and a one-word color name and two valid colors", z_THEMES.length === 17 && new Set(z_ids).size === 17 && new Set(z_THEMES.map((t) => t.name)).size === 17 && z_THEMES.every((t) => /^[A-Z][a-z]+$/.test(t.name)) && z_THEMES.every((t) => z_t.normalizeHex(t.accent) === t.accent && z_t.normalizeHex(t.neutral) === t.neutral));
  var z_html = fs.readFileSync(ROOT + "index.html", "utf8");
  check("Arc's icon in the page takes the theme's color: the white arc over --icon-bg (band, tool cards, every icon picture); the Home Screen icon stays the pink file", /\.wp-band-icon \{ position: relative;[^}]*background: url\(arc-mark\.png\) center \/ cover, var\(--icon-bg/.test(z_html) && /\.tool-icon \{[^}]*background: radial-gradient\([^}]*var\(--icon-bg/.test(z_html) && /img\[src="arc-mark\.png"\] \{ background-color: var\(--icon-bg/.test(z_html) && !/<img[^>]+src="apple-touch-icon\.png"/.test(z_html) && /<link rel="apple-touch-icon" href="apple-touch-icon\.png">/.test(z_html) && fs.existsSync(ROOT + "arc-mark.png"));
  var z_bad = [];
  for (const t of z_THEMES) {
    for (const dark of [false, true]) {
      const v = z_t.themeVariables(t.accent, t.neutral, dark);
      const c = (a, b) => z_t.contrastRatio(v[a], v[b]);
      const rules = [
        ["the badge drawing on Arc's icon in the page, on its white circle", z_t.contrastRatio(v["--icon-ink"], "#ffffff") >= 3 && /^#[0-9a-f]{6}$/.test(v["--icon-bg"])],
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
  z_t.eval('showView("home", false)');
  z_t.eval('openInfo("colorBlock")');   // the color list is a popup from the ⋯ menus
  var z_sw = (name) => Array.from(z_t.document.querySelectorAll("#themeSwatches .theme-swatch")).find((o) => o.getAttribute("aria-label") === name);
  check("only the chosen swatch can be tabbed to", z_sw("Pink").tabIndex === 0 && Array.from(z_t.document.querySelectorAll("#themeSwatches .theme-swatch")).filter((o) => o.tabIndex === 0).length === 1);
  z_sw("Pink").focus();
  z_t.document.getElementById("themeSwatches").dispatchEvent(new z_t.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  check("the arrow keys move to the next color and choose it, as radio buttons do", z_t.document.activeElement === z_sw("Rose") && z_sw("Rose").getAttribute("aria-checked") === "true" && z_t.localStorage.getItem("theme") === "roses-and-mauves");
  z_sw("Amber").click();
  check("choosing a theme applies it at once and remembers it", z_t.document.documentElement.style.getPropertyValue("--button") === "#ffb020" && z_t.localStorage.getItem("theme") === "ambers-and-umbers" && z_t.document.documentElement.style.getPropertyValue("--on-button") === "#111111");
  var z_t2 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI, theme: "greens-and-sages" } });
  check("a remembered theme is used the next time, and shows as the chosen one, with its swatch", z_t2.document.documentElement.style.getPropertyValue("--button") === "#3ecf8e" && z_t2.document.querySelector("#themeSwatches [aria-checked=true]").getAttribute("aria-label") === "Green");

  
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
  check("each row's length carries its short form for phones, and the text itself stays the full form", (() => { const a = rowsOf(z_open)[0].querySelector(".fe-amount"); return a.textContent === "10 min" && a.getAttribute("data-short") === "10m"; })());


  
  } catch (err) { areaCrashed("the page's styles for tags and phones", err); }
}
  if (want('the title and the tip button on a phone')) { try {
  // ================================================================ the title and the tip button on a phone
  var q_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  var q_h1 = fresh.document.querySelector("h1");
  check("the title is the one word Arc", Array.from(q_h1.querySelectorAll(".brand-text > span")).map((x) => x.textContent).join("|") === "Arc" && q_h1.textContent === "Arc");


  
  } catch (err) { areaCrashed("the title and the tip button on a phone", err); }
}
  if (want('private playlists')) { try {
  // ================================================================ private playlists
  var pv_o = {};
  var pv_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: pv_o });
  var pv_b = await buildFor(pv_w, "mini");
  check("a participant's playlist is created asking to stay off the profile (public: false)", pv_b.state === "done" && pv_o.writes.filter((w) => w.type === "create").length === 1 && pv_o.writes.filter((w) => w.type === "create").every((w) => w.public === false));
  check("when Spotify says it came out private, nothing more is sent", pv_o.writes.every((w) => w.type !== "update"));
  var pv_o2 = { ignorePublic: true };
  var pv_w2 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: pv_o2 });
  await buildFor(pv_w2, "mini");
  check("when Spotify makes it public anyway, Arc changes it to stay off the profile right after creating it", pv_o2.writes.filter((w) => w.type === "update").length === 1 && pv_o2.writes.filter((w) => w.type === "update").every((w) => w.public === false) && pv_o2.writes.find((w) => w.type === "update").id === pv_o2.writes.find((w) => w.type === "create").id);
  var pv_o3 = { ignorePublic: true, putFails: true };
  var pv_w3 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: pv_o3 });
  var pv_b3 = await buildFor(pv_w3, "mini");
  check("if it cannot take it off the profile, the build still finishes", pv_b3.state === "done", JSON.stringify(pv_b3));
  } catch (err) { areaCrashed("private playlists", err); }
}
  if (want('cover art')) { try {
  // ================================================================ cover art
  var cv_file = fs.readFileSync(ROOT + "playlist-cover.jpg");
  var cv_dims = execFileSync("python3", ["-c", `from PIL import Image; im = Image.open("${ROOT}playlist-cover.jpg"); print(im.format, im.size[0], im.size[1])`], { encoding: "utf8" }).trim();
  check("the cover is a JPEG of the app's icon, 640 by 640, and small enough for Spotify's limit even after base64", cv_file.slice(0, 3).toString("hex") === "ffd8ff" && cv_dims === "JPEG 640 640" && Math.ceil(cv_file.length / 3) * 4 < 256 * 1024, cv_dims + " " + cv_file.length);
  var cv_app = appSource();
  check("the app asks for the image-upload permission when it signs in, but does not require it, so an older sign-in keeps working", /"ugc-image-upload",/.test(fs.readFileSync(ROOT + "service-spotify.js", "utf8")) && /const REQUIRED_SCOPES = \["playlist-modify-private", "playlist-modify-public"\];/.test(fs.readFileSync(ROOT + "service-spotify.js", "utf8")));
  var cv_run = async (token, fetchOptions) => {
    const w = await boot({ url: "http://127.0.0.1:8000/", session: token, local: { formats: MINI }, fetchOptions });
    w.cvBuild = await buildFor(w, "mini");
    return w;
  };
  var cv_o = {};
  var cv_w = await cv_run(signedIn(), cv_o);
  var cv_covers = cv_o.writes.filter((w) => w.type === "cover");
  check("the playlist gets the cover: a JPEG, sent as base64 with the image content type, to its own playlist", cv_covers.length === 1 && cv_covers.every((c) => c.contentType === "image/jpeg" && c.base64 === cv_file.toString("base64")) && cv_covers[0].id === cv_o.writes.find((w) => w.type === "create").id, JSON.stringify(cv_covers.map((c) => c.id)));
  check("the cover goes on after the songs, so the playlist is complete when it is finished", (() => { const order = cv_o.writes.map((w) => w.type); return order.lastIndexOf("add") < order.indexOf("cover"); })());
  var cv_oldToken = { token: JSON.stringify({ value: "t", expires: Date.now() + 3600000, scope: "playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public user-library-modify" }) };
  var cv_o2 = {};
  var cv_w2 = await cv_run(cv_oldToken, cv_o2);
  check("an older sign-in, without the permission, still builds the playlist and sends no cover", cv_w2.cvBuild.state === "done" && cv_o2.writes.filter((w) => w.type === "create").length === 1 && cv_o2.writes.every((w) => w.type !== "cover"));
  var cv_o3 = { coverStatus: 400 };
  var cv_w3 = await cv_run(signedIn(), cv_o3);
  check("if Spotify will not take the cover, the playlist is still made", cv_w3.cvBuild.state === "done" && cv_o3.writes.filter((w) => w.type === "cover").length === 1, JSON.stringify(cv_w3.cvBuild));
  var cv_o5 = { noCoverFile: true };
  var cv_w5 = await cv_run(signedIn(), cv_o5);
  check("if the cover file cannot be loaded, the playlist is still made, with no cover sent", cv_w5.cvBuild.state === "done" && cv_o5.writes.every((w) => w.type !== "cover"));


  
  } catch (err) { areaCrashed("cover art", err); }
}
  if (want('the format menu fits its contents')) { try {
  // ================================================================ the format menu fits its contents
  var fm_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  var fm_w = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"f": {"name": "F {n}", "silence between segments": "10 min", "segments": [("💗 spacious + gentle", 10), ("silence", "30 sec"), ("🛋 rest", 10)]}}' } });



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
  if (want('the app menu, and minimalist mode')) { try {
  // ================================================================ the app menu, and minimalist mode
  var am_o = {};
  var am_w = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI + "\n" }, fetchOptions: am_o });
  am_w.eval("saveFile = (name, text) => { window.__saved = { name, text }; }");
  var am_row = am_w.document.querySelector(".fe-toprow");
  var am_bar = am_w.document.getElementById("appBar");
  check("the app's menu button is at the right of Arc's bar, over the tabs, which end with the New recipe button", !!am_row && am_row.children[0].id === "feTabs" && am_bar.lastElementChild.id === "feAppMenu" && !!am_row.querySelector("#feTabs #feNewFormat") && !!am_bar.querySelector("#feAppMenuButton") && am_bar.querySelector("#feAppMenuButton").getAttribute("aria-label") === "App menu");
  var am_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  check("the menu starts closed", !am_w.document.getElementById("feAppMenuPanel") && am_w.document.getElementById("feAppMenuButton").getAttribute("aria-expanded") === "false");
  am_w.document.getElementById("feAppMenuButton").click();
  var am_items = Array.from(am_w.document.querySelectorAll("#feAppMenuPanel .fe-item")).map((b) => b.textContent.trim());
  var am_ids = Array.from(am_w.document.querySelectorAll("#feAppMenuPanel [id]")).map((n) => n.id).filter((id) => ["feTutorial", "feColor", "feFeedback", "feBuildAll", "feRemoveBuilt", "feSaveMethod", "feMoreOptions", "feGuide", "feAbout", "feTips", "fePrivacy", "feReport", "feBackupMethod", "feBackup", "feRestore", "feDisconnect", "feMenuVersion"].includes(id));
  check("it has no Disconnect and no title row; Watch the tutorial, Color, Feedback, Report a problem, Privacy and the version, in that order, with no backup block", JSON.stringify(am_ids) === JSON.stringify(["feTutorial", "feColor", "feFeedback", "feReport", "fePrivacy", "feMenuVersion"]) && !am_w.document.querySelector("#feAppMenuPanel .fe-menuhead") && !am_w.document.querySelector("#feAppMenuPanel .fe-bk-block"), JSON.stringify(am_ids));
  var am_info = (id) => am_w.document.getElementById("infoSlot").firstElementChild && am_w.document.getElementById("infoSlot").firstElementChild.id === id && am_w.document.getElementById("infoOverlay").hidden === false;
  check("the menu has no About this app", !am_w.document.getElementById("homePrivacy") && !am_w.document.getElementById("feAbout"));
  am_w.document.getElementById("infoOverlay").dispatchEvent(new am_w.MouseEvent("click", { bubbles: true }));
  check("a tap outside it closes it", am_w.document.getElementById("infoOverlay").hidden === true);
  am_w.document.getElementById("feAppMenuButton").click();
  am_w.document.getElementById("feReport").click();
  check("Report a problem opens only the report part, with its details filled in, and it goes back to its own place, hidden, after", am_info("reportBlock") && /Version: /.test(am_w.document.getElementById("reportPreview").textContent) && (() => { am_w.document.getElementById("infoClose").click(); return !!am_w.document.getElementById("reportBlock").closest("footer") && am_w.document.getElementById("reportBlock").hidden; })());
  am_w.document.getElementById("feAppMenuButton").click();
  am_w.document.getElementById("feFeedback").click();
  check("Feedback opens only the feedback form in the popup, and it goes back to its place, hidden, after", am_info("feedbackBlock") && am_w.document.getElementById("infoTitle").textContent === "Feedback" && !!am_w.document.querySelector("#infoSlot #feedbackForm") && (() => { am_w.document.getElementById("infoClose").click(); return !!am_w.document.getElementById("feedbackBlock").closest("footer") && am_w.document.getElementById("feedbackBlock").hidden; })());
  am_w.document.getElementById("feAppMenuButton").click();
  check("the version is a grey line at the menu's foot, with Check for update at its right", am_w.document.querySelector("#feMenuVersion .fe-menuver-text").textContent === "Arc " + am_w.eval("APP_VERSION") && am_w.document.getElementById("feCheckUpdate").textContent === "Check for update" && am_w.document.getElementById("feCheckUpdate").parentElement.id === "feMenuVersion" && am_w.document.querySelector("#feAppMenuPanel").lastElementChild.id === "feMenuVersion");
  am_w.document.body.click();   // the menu closes
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

  am_empty.eval("askDeleteFormat()");
  am_empty.document.getElementById("feDeleteConfirm").click();
  check("the app menu is still there when there are no formats", !!am_empty.document.getElementById("feAppMenuButton") && !!am_empty.document.getElementById("feNewFormat"));


  
  check("a tap on a pink band's icon shows the version at the band's top right (for a second, then faded)", (() => { var bd = am_w.document.querySelector(".wp-band"); bd.querySelector(".wp-band-icon").dispatchEvent(new am_w.MouseEvent("click", { bubbles: true })); var v = bd.querySelector(".wp-band-ver"); return !!v && v.textContent === am_w.APP_VERSION; })());
  } catch (err) { areaCrashed("the app menu, and minimalist mode", err); }
}
  if (want('minimalist mode, part two')) { try {
  // ================================================================ minimalist mode, part two
  var m2_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  var m2_w = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  var m2_row = m2_w.document.querySelector(".fe-toprow");
  m2_w.eval("showView('builder', false); nameToolInBar()");
  var m2_tool = m2_w.document.getElementById("appTool");
  check("the tabs row is only the tabs; Arc's bar above has the tool's own icon inside its name's button, the one its row in the list shows, and no separate home icon", m2_row.children.length === 1 && m2_row.children[0].id === "feTabs" && !m2_w.document.getElementById("appHome") && m2_tool.firstElementChild.id === "appToolIcon" && m2_tool.firstElementChild.getAttribute("aria-hidden") === "true" && !!m2_tool.querySelector("#appToolIcon > .tool-icon > .tool-glyph") && m2_tool.querySelector("#appToolIcon .tool-glyph").innerHTML === m2_w.document.querySelector('#appToolMenu [data-view="' + m2_w.eval("appView") + '"] .tool-glyph').innerHTML);


  
  } catch (err) { areaCrashed("minimalist mode, part two", err); }
}
  if (want('when Spotify cannot be reached')) { try {
  // ================================================================ when Spotify cannot be reached
  var cx_o = { meStatus: 429, retryAfter: 120 };
  var cx_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: cx_o });
  var cx_sec = (w, id) => w.document.getElementById(id);
  check("rate limited at the start: the app does not call itself connected, and shows the problem with how long to wait", cx_w.eval("connection") === "problem" && cx_sec(cx_w, "connectedSection").hidden === true && cx_sec(cx_w, "connectionProblem").hidden === false && /^Spotify is rate limiting requests\. Try again in about 2 minutes\.$/.test(cx_sec(cx_w, "connectionMessage").textContent), cx_sec(cx_w, "connectionMessage").textContent);
  cx_w.localStorage.removeItem("spotifyPausedUntil");   // a wait of two minutes is kept and counted down ("a wait from Spotify"); here it is the Try again that follows
  cx_w.eval("updateButtonsNow()");
  check("Build becomes Try again, with what went wrong under it", cx_sec(cx_w, "create").textContent.trim() === "Try again" && cx_sec(cx_w, "spotifyNote").hidden === false && cx_sec(cx_w, "spotifyNote").textContent === cx_sec(cx_w, "connectionMessage").textContent);
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
  var cx_w2 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { meNetworkFail: true } });
  check("with no connection to the internet it says so, in plain words", cx_w2.eval("connection") === "problem" && /^Could not reach Spotify\. Check your internet connection and try again\.$/.test(cx_sec(cx_w2, "connectionMessage").textContent));
  var cx_w3 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { meStatus: 401 } });
  check("a sign-in that has expired shows the same problem state, telling you to connect again", cx_w3.eval("connection") === "problem" && /^Your Spotify sign-in expired\. Click Connect again\.$/.test(cx_sec(cx_w3, "connectionMessage").textContent) && cx_sec(cx_w3, "create").textContent.trim() === "Connect again");
  var cx_o4 = {};
  var cx_w4 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: cx_o4 });
  await waitFor(() => cx_w4.eval("connection") === "ready", 15000);
  cx_o4.meStatus = 401;
  cx_w4.eval("buildForParticipant('mini', 'T')");
  await waitFor(() => cx_w4.eval("connection") === "problem", 20000);
  await waitFor(() => cx_w4.eval("personBuild.state") !== "now", 20000);
  check("if the sign-in expires part way through, the page notices: Build becomes Connect again until you connect again", cx_sec(cx_w4, "create").textContent.trim() === "Connect again" && cx_sec(cx_w4, "connectionProblem").hidden === false && /sign-in expired/.test(cx_sec(cx_w4, "connectionMessage").textContent));
  var cx_o5 = { denyCreate: true };
  var cx_w5 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: cx_o5 });
  await buildFor(cx_w5, "mini");
  check("one refused request (a missing permission) is not treated as a lost connection: the page stays connected", cx_w5.eval("connection") === "ready");
  var cx_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");


  
  } catch (err) { areaCrashed("when Spotify cannot be reached", err); }
}
  if (want('saved songs')) { try {
  // ================================================================ saved songs
  var SONGS_FORMAT = 'FORMATS = {"mini": {"name": "mini {n}", "segments": [("💗 spacious + gentle", 10), ("🛋 rest", 10)]}}';
  // reads the songs a build would read (gatherInputs, as a participant's build does first), without building
  var sv_run = async (idb, options, formats = SONGS_FORMAT, all = false) => {
    const w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats }, fetchOptions: options, idb });
    await waitFor(() => w.eval("!!token && connection === 'ready' && !!py && formatsValid && !busy"), 20000);
    w.svInputs = await w.eval(all ? "gatherInputs(currentFormats.map((f) => f.id))" : "gatherInputs([currentFormats[0].id])");
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
  // clearing forgets the songs
  var sv_idb4 = new FDBFactory();
  var sv_w11 = await sv_run(sv_idb4, {});
  var sv_count = (w) => new Promise((resolve) => { const r = w.indexedDB.open("ceremony-playlist-builder", 1); r.onsuccess = () => { const q = r.result.transaction("songs", "readonly").objectStore("songs").count(); q.onsuccess = () => resolve(q.result); }; });
  check("the songs of both playlists are saved in the browser", (await sv_count(sv_w11)) === 2);
  var sv_idb5 = new FDBFactory();
  var sv_w12 = await sv_run(sv_idb5, {});
  sv_w12.document.getElementById("clearYes").click();
  await waitFor(() => sv_w12.__reloaded === true || true, 100);
  await new Promise((r) => setTimeout(r, 300));
  check("Sign out and clear data clears them too", (await sv_count(sv_w12)) === 0);
  var sv_w13 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: SONGS_FORMAT }, fetchOptions: {}, idb: null, before: (w) => { w.indexedDB = undefined; } });
  await waitFor(() => sv_w13.eval("!!token && connection === 'ready' && !!py && formatsValid && !busy"), 20000);
  var sv_b13 = await buildFor(sv_w13, "mini");
  check("if the browser will not keep songs, everything still works, just without the saved songs", sv_b13.state === "done", JSON.stringify(sv_b13));
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
  var lw_b5 = await buildFor(lw_w5, "mini");
  check("a quota error while reading songs stops the build after one request and says to wait", lw_b5.state === "fail" && /wait/i.test(lw_b5.error || "") && (lw_o5.trackRequests || []).length === 1, JSON.stringify(lw_b5) + JSON.stringify(lw_o5.trackRequests));
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
  check("the first time, the popup opens by itself, with the countdown, when it is back, and what works and what waits", !!ws_doc.getElementById("fePauseDialog") && /^4:04:\d\d$/.test(ws_doc.getElementById("fePauseClock").textContent) && /^at \d{1,2}:\d\d\s?[AP]M$/.test(ws_doc.getElementById("fePauseAt").textContent) && /in a day/.test(ws_doc.getElementById("fePauseWhy").textContent) && ws_doc.getElementById("fePauseList").textContent === "Editing recipesWorksChoosing playlistsWorksBuilding playlistsWaitsSaving recipesWaits", ws_doc.getElementById("fePauseDialog") && ws_doc.getElementById("fePauseDialog").textContent);
  check("the ring is full at the start of a wait, which is kept with when it began", /^(99\.9\d|100\.00)%$/.test(ws_doc.getElementById("fePauseRing").style.getPropertyValue("--left")) && Math.abs(ws_pause.from - Date.now()) < 10000, ws_doc.getElementById("fePauseRing").style.getPropertyValue("--left"));
  ws_doc.getElementById("fePauseClose").click();
  check("Close closes it", !ws_doc.getElementById("fePauseDialog"));
  var ws_cap = ws_doc.getElementById("waitStrip");
  check("the strip under Arc's bar counts down in hours, minutes and seconds, with Details, and the line under the editor's bar says nothing of it", !ws_cap.hidden && /^Spotify asked Arc to wait · 4:04:\d\d$/.test(ws_doc.getElementById("waitStripText").textContent) && /Details/.test(ws_cap.textContent) && !/Spotify paused/.test(ws_doc.getElementById("feCaption").textContent), ws_cap.textContent);
  check("the Build button is hidden, with no note under it", ws_doc.getElementById("create").hidden === true && ws_doc.getElementById("spotifyNote").hidden === true);
  check("the playlist menus use the list kept from the last visit", ws_w.eval("playlists.map((p) => p.name).join()") === "Kept list");
  ws_cap.click();
  check("the strip opens the popup again", !!ws_doc.getElementById("fePauseDialog"));
  ws_doc.dispatchEvent(new ws_w.KeyboardEvent("keydown", { key: "Escape" }));
  check("and Escape closes it", !ws_doc.getElementById("fePauseDialog"));
  var ws_sent = () => ws_w.eval("0") === 0 && log.filter((l) => l.url.startsWith("https://api.spotify.com/")).length;
  var ws_before = ws_sent();
  var ws_msg = "";
  try { await ws_w.eval("spotifyRequest('GET', '/me')"); } catch (err) { ws_msg = err.message; }
  check("during the wait nothing goes to Spotify: a request fails at once with the time left", ws_sent() === ws_before && /try again in about 4 hours and 5 minutes/.test(ws_msg), ws_msg);
  var ws_t1 = ws_doc.getElementById("waitStripText").textContent;
  await new Promise((r) => setTimeout(r, 1300));
  check("the countdown moves each second", ws_doc.getElementById("waitStripText").textContent !== ws_t1, ws_t1);
  check("clockText writes hours:minutes:seconds", ws_w.eval("[clockText(22564), clockText(59), clockText(3600)].join(' ')") === "6:16:04 0:00:59 1:00:00");
  // a reload during the wait: the line at once, no popup, nothing sent
  var ws_o2 = { meStatus: 429, retryAfter: 14689 };
  var ws_until = Date.now() + 3600000;
  var ws_w3 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI, clientId: "abc", spotifyPausedUntil: JSON.stringify({ until: ws_until, reason: "", clientId: "abc" }) }, fetchOptions: { meStatus: 429, retryAfter: 14689 } });
  await waitFor(() => !!ws_w3.document.getElementById("fePauseDialog"), 8000);
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
  check("saving recipes is always listed as waiting, since recipes are always saved to Spotify", (() => { ws_w2.document.getElementById("fePauseDialog") && ws_w2.eval("closePauseDialog()"); ws_w2.eval("showPauseDialog()"); const has = /Saving recipes/.test(ws_w2.document.querySelector(".fe-pause-lists").textContent); ws_w2.eval("closePauseDialog()"); return has; })());
  check("a wait kept for another Client ID does not count", (() => { ws_w2.localStorage.setItem("spotifyPausedUntil", JSON.stringify({ until: Date.now() + 3600000, clientId: "other" })); return ws_w2.eval("pausedSecondsLeft()") === 0; })());
  // the time is up: it connects by itself, and Build is back
  ws_w2.localStorage.setItem("spotifyPausedUntil", JSON.stringify({ until: Date.now() + 1200, reason: "", clientId: "abc" }));
  ws_w2.eval("tickPause()");
  delete ws_o2.meStatus;
  await waitFor(() => ws_w2.eval("connection") === "ready", 15000);
  check("when the time is up the app connects again by itself, the popup closes, and Build is back", ws_w2.eval("connection") === "ready" && !ws_w2.document.getElementById("fePauseDialog") && ws_w2.document.getElementById("create").hidden === false && !ws_w2.localStorage.getItem("spotifyPausedUntil"));
  check("a good connection keeps the playlist list on the device, without descriptions", (() => { const k = JSON.parse(ws_w2.localStorage.getItem("spotifyPlaylists") || "null"); return k && k.user === "ron" && k.list.length > 0 && k.list.every((p) => p.id && p.name !== undefined && p.description === undefined); })());
  check("Privacy names what this browser keeps", /your recipes, settings and sign-in/.test(ws_doc.getElementById("privacySection").textContent));
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
  await buildFor(sr_b, "mini");
  var sr_adds = sr_o.writes.filter((x) => x.type === "add");
  check("when Spotify refuses 100 songs at a time, the build goes on 10 at a time, asking with 100 only once", sr_o.addRefused === 1 && sr_adds.length > 1 && sr_adds.every((a) => a.uris.length <= 10), `${sr_o.addRefused} ${sr_adds.length}`);
  check("and the record notes it", (sr_record(sr_b, "spotifyLimits") || []).some((e) => /100 songs per add refused/.test(e.note || "")));
  // the request log: copied from the DEV menu, never offered
  var sr_limits = JSON.stringify([{ at: Date.now() - 1000, what: "POST /playlists/{id}/items", kind: "add", reason: "", sent30s: 40, sent10m: 90, sent1h: 300, sent24h: 300, refusedAgain: 0, lastRefusedAt: Date.now() - 1000, clearedAt: null }]);
  var sr_id = "OWNER-TEST-ID";
  var sr_x = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI, clientId: "SOMEONE-ELSE", spotifyLimits: sr_limits }, fetchOptions: {} });
  await waitFor(() => sr_x.eval("connection") === "ready");
  var sr_ow = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI, clientId: sr_id, spotifyLimits: sr_limits }, fetchOptions: {} });
  await waitFor(() => sr_ow.eval("connection") === "ready");
  sr_ow.localStorage.setItem("sharingOwner", JSON.stringify({ account: sr_ow.localStorage.getItem("spotifyAccount"), owner: true }));   // the worker said yes
  check("the owner is not offered the request log after a refusal", !sr_ow.eval("notices.held") && sr_ow.eval("typeof offerLimitRecord") === "undefined");
  sr_ow.eval("editor.appMenu = true; renderAppMenu()");
  check("Copy Spotify request log is not in the builder menu, even for the owner: it is in the DEV menu", !sr_ow.document.getElementById("feCopyRecord") && !!sr_ow.document.querySelector("#devMenu #devCopyRecord") && /Copy Spotify request log/.test(sr_ow.document.getElementById("devCopyRecord").textContent));
  var sr_copied = "";
  sr_ow.navigator.clipboard = { writeText: async (t) => { sr_copied = t; } };
  await sr_ow.eval("copyLimitRecord()");
  var sr_json = JSON.parse(sr_copied || "{}");
  check("Copy puts the record on the clipboard and marks it copied", sr_json.limits && sr_json.limits.length === 1 && sr_json.callsPerMinute && sr_json.app && Number(sr_ow.localStorage.getItem("spotifyRecordCopiedAt")) > 0);
  check("the record has no Client ID, token or playlist names", !/OWNER-TEST-ID|TOKEN|mini/.test(sr_copied), sr_copied.slice(0, 200));
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
  check("Privacy no longer mentions the wait relay (Ron, 2026-11-16)", !sr_x.document.getElementById("privacyWaitRelay"));
  } catch (err) { areaCrashed("a record of Spotify limits", err); }
}
  if (want("who sees the editor, and what a rate limit says")) { try {

  // ================================================================ who sees the editor, and what a rate limit says
  var rl_text = (w, id) => w.document.getElementById(id).textContent;
  var rl_new = await boot({ url: "http://127.0.0.1:8000/" });
  var rl_same = await boot({ url: "http://127.0.0.1:8000/", local: { formats: rl_new.modelToText({ formats: [] }) } });
  check("saved formats that are just the empty start do not count as having formats of their own", rl_same.document.getElementById("appSection").hidden === true);
  var rl_back = await boot({ url: "http://127.0.0.1:8000/", local: { formats: MINI, clientId: "abc123" } });
  check("someone with recipes and a Client ID who has never connected is on the setup page: the editor waits for the first connection", rl_back.document.documentElement.classList.contains("page-setup") && rl_back.document.getElementById("appSection").hidden === true && rl_back.eval("connection") === "none");
  var rl_back2 = await boot({ url: "http://127.0.0.1:8000/", local: { formats: MINI, clientId: "abc123", connectedBefore: "1" } });
  check("connected before, the editor is there, and Build offers to connect", rl_back2.document.getElementById("appSection").hidden === false && rl_back2.document.getElementById("create").textContent.trim() === "Connect to Spotify" && !!rl_back2.document.querySelector("#formatEditor .fe-card"));
  rowsOf(rl_back2)[0].querySelector(".fe-main").click();
  check("a segment's list says to connect to see the playlists, and there is no Disconnect in the app menu", /Connect to Spotify to see your playlists\./.test(rl_back2.document.getElementById("feOptions").textContent) && (() => { rl_back2.document.dispatchEvent(new rl_back2.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); rl_back2.document.getElementById("feAppMenuButton").click(); const none = !rl_back2.document.getElementById("feDisconnect"); rl_back2.document.getElementById("feAppMenuButton").click(); return none; })());
  var rl_busy = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { meDelay: 3000 } });
  check("while the app is still connecting, Build says Connecting, the note says it can take a few seconds, and nothing says Build needs a connection", rl_busy.eval("connection") === "connecting" && /Connecting to Spotify/.test(rl_busy.document.getElementById("spotifyNote").textContent) && rl_busy.document.getElementById("create").disabled === true && rl_busy.document.getElementById("create").textContent.trim() === "Connecting\u2026");
  await waitFor(() => rl_busy.eval("connection") === "ready", 10000);
  await readyToPreview(rl_busy);
  var rl_q = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { meStatus: 429, meBody: { error: { status: 429, message: "Too many requests", reason: "QUOTA_EXCEEDED" } } } });
  check("a quota error whose wait the page cannot read is still recognised from the reply, stops at once, and says Spotify did not say how long", rl_q.eval("connection") === "problem" && rl_text(rl_q, "connectionMessage") === "Spotify has reached the request quota for your developer account. Waiting is the only fix, and Spotify did not say how long to wait.", rl_text(rl_q, "connectionMessage"));
  var rl_p = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { meStatus: 429 }, instantRetries: true });
  check("an ordinary rate limit with no readable wait, after retrying, says so plainly instead of the old Wait a minute", rl_text(rl_p, "connectionMessage") === "Spotify is rate limiting requests and did not say how long to wait. Try again in a few minutes.", rl_text(rl_p, "connectionMessage"));
  // no readable wait: a popup once, the strip under Arc's bar counting down to the next try, every 5 minutes, and Try again now (Ron, 2026-11-12)
  var rl_pd = rl_p.document;
  check("connecting refused with no readable wait opens the popup, with Close and Try again now", !!rl_pd.getElementById("feLimitDialog") && rl_pd.getElementById("feLimitTitle").textContent === "Spotify asked Arc to wait" && /every 5 minutes/.test(rl_pd.getElementById("feLimitDialog").textContent) && rl_pd.getElementById("feLimitClose").textContent === "Close" && rl_pd.getElementById("feLimitRetry").textContent === "Try again now");
  rl_pd.getElementById("feLimitClose").click();
  check("Close closes it, and the strip stays, counting down to the next try, and hides the grey note under the recipes", !rl_pd.getElementById("feLimitDialog") && !rl_pd.getElementById("waitStrip").hidden && /^Spotify asked Arc to wait · [45]:\d\d$/.test(rl_pd.getElementById("waitStripText").textContent) && rl_pd.documentElement.classList.contains("spotify-waiting"), rl_pd.getElementById("waitStripText").textContent);
  rl_pd.getElementById("waitStrip").click();
  check("the strip opens the popup again", !!rl_pd.getElementById("feLimitDialog"));
  rl_p.eval("limitWait.retryAt = Date.now() - 1; tickLimitWait()");
  await waitFor(() => rl_p.eval("connection") === "problem" && rl_p.eval("limitWait.retryAt") > Date.now() + 60000, 8000);
  check("when the 5 minutes are up Arc tries again by itself, and a second refusal says nothing more, leaving the popup as it was", rl_p.eval("limitWait.active") && rl_pd.querySelectorAll("#feLimitDialog").length === 1);
  rl_p.eval("limitWait.retryAt = 0; tickLimitWait()");
  var rl_ok = { meStatus: 429 };
  var rl_g = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: rl_ok, instantRetries: true });
  delete rl_ok.meStatus;
  rl_g.document.getElementById("feLimitRetry").click();
  await waitFor(() => rl_g.eval("connection") === "ready", 15000);
  check("once Spotify answers, the popup and the strip go", !rl_g.document.getElementById("feLimitDialog") && rl_g.document.getElementById("waitStrip").hidden && !rl_g.document.documentElement.classList.contains("spotify-waiting") && !rl_g.eval("limitWait.active"));
  var rl_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { meStatus: 429, retryAfter: 40 } });
  check("a wait it can read that is too long to sit through is reported as it was given, rounded up to the minute", rl_text(rl_w, "connectionMessage") === "Spotify is rate limiting requests. Try again in about 1 minute.", rl_text(rl_w, "connectionMessage"));
  var rl_shown = (w) => [w.document.getElementById("connectionRetry").hidden, w.document.getElementById("connectionReconnect").hidden];
  check("for a rate limit only Try again is shown, with the retry icon", JSON.stringify(rl_shown(rl_q)) === "[false,true]" && JSON.stringify(rl_shown(rl_p)) === "[false,true]" && rl_q.document.querySelector("#connectionRetry img").getAttribute("src") === "icons/retry.svg" && fs.existsSync(ROOT + "icons/retry.svg"));
  var rl_a = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { meStatus: 401 } });
  check("for an expired sign-in only Connect again is shown", JSON.stringify(rl_shown(rl_a)) === "[true,false]" && rl_a.document.querySelector("#connectionReconnect img").getAttribute("src") === "icons/connect.svg");
  var rl_n = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { meNetworkFail: true } });
  check("for no network only Try again is shown", JSON.stringify(rl_shown(rl_n)) === "[false,true]");
  
  } catch (err) { areaCrashed("who sees the editor, and what a rate limit says", err); }
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
  await waitFor(() => /sent the details/.test(rr_odd.document.getElementById("connectionReportHint").textContent), 4000);
  check("an unexpected error from Spotify is reported by Arc itself, and the line says so", rr_odd.eval("connection") === "problem" && rr_odd.document.getElementById("connectionReportHint").hidden === false && rr_odd.document.getElementById("connectionReportHint").textContent === "Something unexpected happened. Arc sent the details to its developer." && /Spotify returned 500/.test(rr_odd.document.getElementById("connectionMessage").textContent));
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
  check("Privacy is a popup from the ⋯ menu, hidden on the page, its title Privacy", !!pv_sec && pv_sec.hidden === true && pv_sec.classList.contains("menu-popup") && pv_sec.querySelector("h3").textContent === "Privacy" && !pv_w.document.getElementById("homeMore"));
  var pv_text = pv_sec.textContent.replace(/\s+/g, " ");
  check("it opens with what Arc stands for, then one short line per topic", /^Arc runs in your browser\. No accounts, no ads\. Your music stays between this browser and your own Spotify, unless you share it\.$/.test(pv_sec.querySelector(".pv-lead").textContent) && JSON.stringify(Array.from(pv_sec.querySelectorAll("li > b")).map((b) => b.textContent)) === JSON.stringify(["In this browser:", "In your Spotify:", "Participants:", "Shared playlist library:", "Anonymous counts:", "Error reports:", "Feedback:"]));
  check("it says that Sign out and clear data erases what is kept, and what reports never hold", /Sign out and clear data erases them/.test(pv_text) && /Never your sign-in, playlist names or songs/.test(pv_text) && /visits and a few actions are counted, without cookies/.test(pv_text));
  for (const view of ["home", "builder", "sharing"]) {
    pv_w.eval(`showView("${view}", false); editor.appMenu = false; renderAppMenu()`);
    pv_w.document.getElementById("feAppMenuButton").click();
    const ids = [...pv_w.document.querySelectorAll("#feAppMenuPanel .fe-item, #feMenuVersion")].map((n) => n.id);
    check(`the ${view} menu has Privacy last, right before the version`, ids.slice(-2).join("|") === "fePrivacy|feMenuVersion", JSON.stringify(ids));
  }
  pv_w.document.getElementById("fePrivacy").click();
  check("Privacy in the menu opens its popup", pv_w.document.getElementById("infoSlot").firstElementChild.id === "privacySection" && pv_w.document.getElementById("infoTitle").textContent === "Privacy" && pv_w.document.getElementById("infoOverlay").hidden === false);
  pv_w.eval("closeInfo(true)");
  var pv_click2 = new pv_w.MouseEvent("click", { bubbles: true, cancelable: true });
  pv_w.document.querySelector("#about a.privacy-link").dispatchEvent(pv_click2);
  check("a Privacy link elsewhere opens the same popup", pv_w.document.getElementById("infoSlot").firstElementChild.id === "privacySection");
  pv_w.eval("closeInfo(true)");
  // the counter script
  check("the counter is the GoatCounter script with this account's code, loaded without blocking the page", /<script data-goatcounter="https:\/\/roncarmel\.goatcounter\.com\/count" async src="https:\/\/gc\.zgo\.at\/count\.js"><\/script>/.test(pv_html));
  check("the page is always counted as /, so the one-time code in the address after Spotify's sign-in is never sent, and that return is not counted as a second visit", /window\.goatcounter = \{ path: "\/", no_onload: \/\[\?&\]\(code\|error\)=\/\.test\(location\.search\) \};/.test(pv_html) && pv_html.indexOf("window.goatcounter = {") < pv_html.indexOf("gc.zgo.at/count.js"));
  // the four counts
  var pv_counts = (w) => w.__counts || [];
  var pv_before = (w) => { w.goatcounter = { count: (v) => { (w.__counts = w.__counts || []).push(v); } }; };
  var pv_c1 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {}, before: pv_before });
  check("the first connection in a browser is counted once, with a marker so the next visit does not count it again", pv_counts(pv_c1).filter((e) => e.path === "first-connection-spotify").length === 1 && pv_c1.localStorage.getItem("counted") === "1" && pv_counts(pv_c1)[0].event === true);
  var pv_c2 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI, counted: "1" }, fetchOptions: {}, before: pv_before });
  check("a browser already counted is not counted again", pv_counts(pv_c2).filter((e) => e.path === "first-connection-spotify").length === 0);
  var pv_c3 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { meStatus: 429, meBody: { error: { reason: "QUOTA_EXCEEDED" } } }, before: pv_before });
  check("a connection problem is counted as its kind only, and the first connection is not counted when there was none", JSON.stringify(pv_counts(pv_c3).map((e) => [e.path, e.title])) === JSON.stringify([["connection-problem", "quota"]]) && pv_c3.localStorage.getItem("counted") === null);
  var pv_kinds = [[{ meStatus: 429, retryAfter: 120 }, "rate-limit"], [{ meNetworkFail: true }, "network"], [{ meStatus: 401 }, "sign-in"], [{ meStatus: 500 }, "other"]];
  for (const [opts, kind] of pv_kinds) {
    const w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: opts, before: pv_before });
    check(`the kind of problem is ${kind}`, JSON.stringify(pv_counts(w).map((e) => e.title)) === JSON.stringify([kind]));
  }
  var pv_c4 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI, counted: "1" }, fetchOptions: {}, before: pv_before });
  await buildFor(pv_c4, "mini");
  check("a successful build counts the playlist made, as a number and nothing else", JSON.stringify(pv_counts(pv_c4).filter((e) => !/^active-/.test(e.path)).map((e) => [e.path, e.title])) === JSON.stringify([["playlists-created", "1"]]), JSON.stringify(pv_counts(pv_c4)));
  var pv_all = pv_counts(pv_c1).concat(pv_counts(pv_c3), pv_counts(pv_c4));
  // a day of use, by how long since this browser first connected
  check("connecting counts the day once, as the browser's first week, and keeps the dates only here", JSON.stringify(pv_counts(pv_c1).filter((e) => /^active-/.test(e.path)).map((e) => e.path)) === JSON.stringify(["active-first-week-spotify"]) && pv_c1.localStorage.getItem("countedDay") === new Date().toDateString() && Number(pv_c1.localStorage.getItem("countedSince")) > 0);
  var pv_d1 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI, counted: "1", countedSince: String(Date.now() - 40 * 86400000), countedDay: new Date().toDateString() }, fetchOptions: {}, before: pv_before });
  check("the same day is not counted twice", pv_counts(pv_d1).filter((e) => /^active-/.test(e.path)).length === 0);
  var pv_d2 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI, counted: "1", countedSince: String(Date.now() - 40 * 86400000), countedDay: "Mon Jan 01 2024" }, fetchOptions: {}, before: pv_before });
  check("a later day says how long since the first connection, here months 2 to 3", JSON.stringify(pv_counts(pv_d2).filter((e) => /^active-/.test(e.path)).map((e) => e.path)) === JSON.stringify(["active-months-2-3-spotify"]));
  // the tutorial
  pv_c2.__counts = [];
  pv_c2.eval("watchTutorial()");
  var pv_vid = pv_c2.document.querySelector("#tutorialPlayer video");
  pv_vid.dispatchEvent(new pv_c2.Event("ended")); pv_vid.dispatchEvent(new pv_c2.Event("ended"));
  check("opening the tutorial counts a start and where, and its end is counted once even when watched again", JSON.stringify(pv_counts(pv_c2).map((e) => [e.path, e.title])) === JSON.stringify([["tutorial-started", "computer"], ["tutorial-finished", "tutorial-finished"]]));
  pv_all = pv_all.concat(pv_counts(pv_d2), pv_counts(pv_c2));
  check("nothing sent ever holds a name, a format or an ID: every title is a number or a short word", pv_all.every((e) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.path) && /^(\d+|[a-z]+(-[a-z0-9]+)*)$/.test(e.title)));
  var pv_none = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  check("with the counter blocked or not loaded the app works as usual, and the first connection is not marked as counted", pv_none.eval("connection") === "ready" && pv_none.localStorage.getItem("counted") === null);
  
  } catch (err) { areaCrashed("privacy section and anonymous counts", err); }
}


  if (want("scrolling home with the keyboard watch")) { try {
  // ================================================================ scrolling home with the keyboard watch
  // Music sharing's keyboard watch runs on every scroll of the visible area, on every view; on Home it once scrolled the page back to its top (Ron, 2026-11-15)
  var hk_w = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  var hk_vv = new hk_w.EventTarget(); hk_vv.offsetTop = 0; hk_vv.height = 760;
  Object.defineProperty(hk_w, "visualViewport", { configurable: true, value: hk_vv });
  var hk_y = 0, hk_scrolls = [];
  Object.defineProperty(hk_w, "scrollY", { configurable: true, get: () => hk_y });
  hk_w.scrollTo = (x, y) => { hk_scrolls.push(typeof x === "object" ? x.top : y); hk_y = typeof x === "object" ? x.top : y; };
  hk_w.eval("watchKeyboard()");
  hk_w.eval("showView('home')"); hk_scrolls.length = 0;
  hk_y = 400; hk_vv.offsetTop = 0; hk_vv.height = 700;
  hk_vv.dispatchEvent(new hk_w.Event("scroll")); hk_vv.dispatchEvent(new hk_w.Event("resize"));
  check("scrolling Home leaves it where it was: the keyboard watch does not scroll it back to the top", hk_scrolls.length === 0 && hk_y === 400, JSON.stringify(hk_scrolls));
  hk_w.eval("showView('sharing')"); hk_scrolls.length = 0;
  var hk_ov = hk_w.document.getElementById("msOverlay");
  hk_ov.classList.add("ms-typing-page"); hk_ov.style.top = "0px";
  hk_y = 0; hk_vv.offsetTop = 120; hk_vv.dispatchEvent(new hk_w.Event("resize"));
  check("typing ending in Music sharing places the page under the bar again and logs a page left panned, without scrolling it", !hk_ov.classList.contains("ms-typing-page") && hk_scrolls.length === 0 && /panned after the keyboard/.test(hk_w.localStorage.getItem("layoutLog") || ""), JSON.stringify(hk_scrolls));
  check("nothing in Music sharing scrolls the window back after the keyboard", !/unpanSharingPage/.test(fs.readFileSync(ROOT + "sharing.js", "utf8")));
  } catch (err) { areaCrashed("scrolling home with the keyboard watch", err); }
}


  if (want("confirming a new format")) { try {
  // ================================================================ confirming a new format
  var nf_w = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  var nf_count = () => nf_w.document.querySelectorAll("#feTabs .fe-tab").length;
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
  var nf_text0 = nf_w.document.getElementById("formats").value;
  var nf_sel = () => nf_w.document.querySelector('#feTabs .fe-tab[aria-pressed="true"]');
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
  nf_w.__counts = []; nf_w.goatcounter = { count: (v) => nf_w.__counts.push(v) };
  nf_ok().click();
  check("a new recipe is counted, with nothing about it", JSON.stringify(nf_w.__counts.map((e) => [e.path, e.title])) === JSON.stringify([["recipe-created", "recipe-created"]]));
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
  var nf_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  
  } catch (err) { areaCrashed("confirming a new format", err); }
}

  if (want("build button, big new format button and empty start")) { try {
  // ================================================================ the Build button, the big New recipe button, and the empty start
  var bb_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  var bb_new = await boot({ url: EDURL, session: signedIn(), local: { formats: null }, fetchOptions: {} });
  addNamed(bb_new, "First");
  check("naming the first recipe adds it, and the button moves to the end of the tabs", !bb_new.document.getElementById("feNewFormatDialog") && bb_new.document.querySelectorAll("#feTabs .fe-tab").length === 1 && !bb_new.document.querySelector(".fe-toprow").classList.contains("fe-noformats"));
  // the Build button
  var bb_w = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"a": {"name": "A {n}", "title": "Warm focus", "segments": [("💗 spacious + gentle", 10)]}, "b": {"name": "B {n}", "title": "A very long format name that will not fit on a phone beside the words Build playlists", "segments": [("🛋 rest", 10)]}}' }, fetchOptions: {} });
  await readyToPreview(bb_w);
  bb_w.document.querySelectorAll("#feTabs .fe-tab")[1].click();
  var bb_rn = renameBox(bb_w);
  bb_rn.value = "Renamed";
  bb_rn.dispatchEvent(new bb_w.Event("input"));
  finishName(bb_w);
  
  } catch (err) { areaCrashed("build button, big new format button and empty start", err); }
}

  if (want("startup that survives problems")) { try {
  // ================================================================ a page that survives problems in starting up
  var su_html = fs.readFileSync(ROOT + "index.html", "utf8");
  var su_js = appSource();
  var su_ver = su_js.match(/const APP_VERSION = "([^"]+)"/)[1];
  check("the page names its own version, the same as the script's, and loads each script with that version on its address so a cached older one is never mixed in", new RegExp('<meta name="app-version" content="' + su_ver + '">').test(su_html) && ["theme", "formats", "editor", "service-spotify", "app", "sharing"].every((n) => su_html.includes(`<script src="${n}.js?v=${su_ver}"></script>`)));
  var su_ok = await boot({ url: "http://127.0.0.1:8000/" });
  check("a normal start shows no problem banner", su_ok.document.getElementById("startupProblem").hidden === true);
  var su_radio = (w, value) => ({ click() { w.document.querySelector(`[data-flow="${value}"]`).click(); w.document.getElementById("spNext").click(); } });   // choose, then Next
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
  var su_none = await boot({ url: "http://127.0.0.1:8000/", session: { startupRefreshed: "1" }, htmlChange: (h) => h.replace('id="clearYes"', 'id="oldClear"') });
  check("a missing button does not stop the ones after it from working", su_none.document.getElementById("startupProblem").hidden === false && su_none.eval("startupProblems").some((p) => /missing element clearYes/.test(p)));
  su_none.document.getElementById("connect").click();
  check("Connect, which comes after it in the startup code, is still wired", /Enter your Client ID|Client ID/i.test(su_none.document.getElementById("loginMessage").textContent) || su_none.document.getElementById("loginMessage").textContent !== "");
  var su_css = su_html.replace(/\s+/g, " ");
  check("all the page's listeners go through the guarded helper (but Setup complete's Continue, which only lets the startup go on), and the script ends by catching a startup that fails", !/\$\("\w+"\)\.addEventListener\(/.test(su_js.replace('$("cnContinue").addEventListener("click", () => resolve(true), { once: true })', "")) && /\nmain\(\)\.catch\(startupFailed\);\s*$/.test(su_js));
  
  } catch (err) { areaCrashed("startup that survives problems", err); }
}

  if (want("page start watchdog and version stamps")) { try {
  // ================================================================ the page start watchdog and the version stamps
  var ws_html = fs.readFileSync(ROOT + "index.html", "utf8");
  var ws_app = appSource();
  var ws_ver = ws_app.match(/const APP_VERSION = "([^"]+)";/)[1];
  var ws_stamps = [ws_html.match(/<meta name="app-version" content="([^"]+)">/)[1], ...Array.from(ws_html.matchAll(/\.js\?v=([^"]+)"/g)).map((m) => m[1])];
  check("the page, its eight scripts and the script itself all carry the same version, so a half-updated upload is caught here and not on someone's screen", ws_stamps.length === 9 && ws_stamps.every((v) => v === ws_ver), JSON.stringify(ws_stamps) + " vs " + ws_ver);
  var ws_own = ["theme.js", "formats.js", "editor.js", "shared-service.js", "service-spotify.js", "service-tidal.js", "sharing.js"].map((f) => (fs.readFileSync(ROOT + f, "utf8").match(/\(globalThis\.scriptVersions = globalThis\.scriptVersions \|\| \{\}\)\["([a-z-]+\.js)"\] = "([^"]+)";/) || []).slice(1).join("="));
  check("every other script names its own version, the same as the app's", ws_own.join() === ["theme.js", "formats.js", "editor.js", "shared-service.js", "service-spotify.js", "service-tidal.js", "sharing.js"].map((f) => f + "=" + ws_ver).join(), ws_own.join());
  var ws_sv = await boot({ url: "http://127.0.0.1:8000/", session: { startupRefreshed: "1" } });
  await ws_sv.__main;
  check("a normal start finds every script's version in agreement", ws_sv.document.getElementById("startupProblem").hidden === true && !ws_sv.eval("startupProblems").some((p) => /is version/.test(p)));
  ws_sv.eval('window.scriptVersions["sharing.js"] = "2020-01-01a"; delete window.scriptVersions["editor.js"]; checkScriptVersions();');
  check("an old copy of one script (or one that names no version) is a startup problem: it is recorded and the popup shows", ws_sv.eval("startupProblems").some((p) => p === "editor.js is version unknown, the app " + ws_ver + "; sharing.js is version 2020-01-01a, the app " + ws_ver) && ws_sv.document.getElementById("startupProblem").hidden === false, JSON.stringify(ws_sv.eval("startupProblems")));
  check("the script marks itself started as the first thing it does, before it wires the setup choices", /async function main\(\) \{\n  if \(window\.pageStart\) window\.pageStart\.started = true;[^\n]*\n  startFlowChoice\(\);/.test(ws_app));
  var ws_src = ws_html.match(/<script>\n  \/\/ If the page's own script never starts[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g, "");
  check("the watchdog is in the head, ahead of every script that could fail, and listens for errors in the capture phase so a file that did not load is seen too", ws_html.indexOf("window.pageStart = {") > 0 && ws_html.indexOf("window.pageStart = {") < ws_html.indexOf('<script src="formats.js') && /\}, true\);/.test(ws_src));
  var ws_w = await boot({ url: "http://127.0.0.1:8000/", session: { startupRefreshed: "1" } });
  ws_w.eval("window.__delays = []; window.setTimeout = function (f, ms) { window.__delays.push(ms); f(); return 0; };");
  ws_w.eval(ws_src);
  ws_w.sessionStorage.setItem("startupRefreshed", "1");   // a fresh load has already been tried this visit, so the popup shows at once
  ws_w.dispatchEvent(new ws_w.ErrorEvent("error", { message: "Unexpected token", filename: "http://127.0.0.1:8000/app.js?v=2026-11-16zr", lineno: 12 }));
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
  var ro_key = (tab, key) => tab.dispatchEvent(new ro_w.KeyboardEvent("keydown", { key, altKey: true, bubbles: true, cancelable: true }));
  ro_key(ro_w.document.querySelector("#feTabs .fe-tab"), "ArrowRight");
  ro_key(ro_w.document.body, "ArrowRight");
  var ro_ptr = (type, x, kind) => { const e = new ro_w.MouseEvent(type, { clientX: x, clientY: 5, bubbles: true, cancelable: true, button: 0 }); Object.defineProperty(e, "pointerId", { value: 1 }); Object.defineProperty(e, "pointerType", { value: kind }); return e; };
  var ro_first = ro_w.document.querySelector("#feTabs .fe-tab");
  ro_first.dispatchEvent(ro_ptr("pointerdown", 10, "mouse"));
  ro_w.dispatchEvent(ro_ptr("pointermove", 60, "mouse"));
  ro_w.dispatchEvent(ro_ptr("pointerup", 60, "mouse"));
  ro_first = ro_w.document.querySelector("#feTabs .fe-tab");
  ro_first.dispatchEvent(ro_ptr("pointerdown", 10, "mouse"));
  await new Promise((r) => setTimeout(r, 420));
  ro_w.dispatchEvent(ro_ptr("pointermove", 400, "mouse"));
  ro_w.dispatchEvent(ro_ptr("pointerup", 400, "mouse"));
  check("dropping it past the others puts it last, and the order is saved", JSON.stringify(ro_tabs()) === JSON.stringify(["Two", "Three", "One"]) && !ro_w.document.querySelector(".fe-dragging"), JSON.stringify(ro_tabs()));
  var ro_active = ro_w.document.querySelector('#feTabs .fe-tab[aria-pressed="true"]').textContent;
  var ro_t = ro_w.document.querySelector("#feTabs .fe-tab");
  ro_t.dispatchEvent(ro_ptr("pointerdown", 10, "touch"));
  ro_w.dispatchEvent(ro_ptr("pointermove", 200, "touch"));
  ro_w.dispatchEvent(ro_ptr("pointerup", 200, "touch"));
  check("each recipe has its place in the saved text, and a moved one also has when it was moved", (ro_w.localStorage.getItem("formats").match(/"place": \d+,/g) || []).length === 3 && /"placed": \d+,/.test(ro_w.localStorage.getItem("formats")));
  var ro_rt = ro_w.eval('(() => { const f = editor.model.formats[0]; const back = unpackFormat(packFormat(f)).format; return [back.place === f.place, back.placeAt === f.placeAt, f.place > 0]; })()');
  check("the place and the time of the move go into the save in Spotify and come back out of it", ro_rt.every(Boolean), JSON.stringify(ro_rt));
  check("an old save without a place is still read, with no place", ro_w.eval('(() => { const p = [0x43, 0x50, 1]; const b = []; writeText(b, "q"); writeText(b, "Q"); for (const n of [0, 0, 0, 0, 0, 1, 600, 1, 0]) writeVarint(b, n); writeText(b, "x"); writeVarint(b, 1); const all = p.concat(b); const c = crc16(all); all.push(c >> 8, c & 255); const out = []; writeVarint(out, all.length); const u = unpackFormat("Do not edit. " + denseEncode(out.concat(all))); return u.kind === "save" && u.format.place === undefined; })()'));
  check("moving puts a place between the neighbours, and only the moved recipe gets a new one", ro_w.eval('(() => { const fs = [{ id: "a", place: 1024 }, { id: "c", place: 3072 }, { id: "b", place: 2048 }]; placeMoved(fs, 1, 100); return fs[1].place > 1024 && fs[1].place < 2048 && fs[1].placeAt === 100 && fs[0].place === 1024 && fs[2].place === 2048; })()'));
  check("with no room between the neighbours, all are numbered again", ro_w.eval('(() => { const fs = [{ id: "a", place: 5 }, { id: "c", place: 9 }, { id: "b", place: 6 }]; placeMoved(fs, 1, 100); return fs.map((f) => f.place).join() === "1024,2048,3072"; })()'));
  check("of two copies, the later move stands; on a tie, the higher place, so every device decides the same", ro_w.eval('(() => { const a = { place: 10, placeAt: 5 }, b = { place: 99, placeAt: 4 }, c = { place: 50, placeAt: 5 }; return laterPlace(a, b) === a && laterPlace(b, a) === a && laterPlace(a, c) === c && laterPlace(c, a) === c; })()'));
  check("equal places sort by ID, the same way everywhere", ro_w.eval('(() => { const fs = [{ id: "z", place: 5 }, { id: "a", place: 5 }]; sortFormats(fs); return fs[0].id === "a"; })()'));
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
  var hd_sil = hd_w.document.querySelector(".fe-silence");
  var hd_mid = hd_sil.querySelector(".fe-amount-rich");
  hd_w.document.getElementById("feGapShorter").click(); hd_w.document.getElementById("feGapShorter").click(); hd_w.document.getElementById("feGapShorter").click(); hd_w.document.getElementById("feGapShorter").click();
  check("with no silence the stepper reads No and the sentence drops its of: [ - No + ] silence between segments", hd_w.document.getElementById("feGapValue").textContent === "No" && hd_w.document.querySelector(".fe-silence-label").textContent === "silence between segments", hd_w.document.getElementById("feGapValue").textContent);
  hd_w.document.getElementById("feGapLonger").click();
  check("one step up and it is a length again, with the of back: [ - 30 sec + ] of silence between segments", hd_w.document.getElementById("feGapValue").textContent === "30 sec" && hd_w.document.querySelector(".fe-silence-label").textContent === "of silence between segments");
  while (hd_w.document.getElementById("feGapValue").textContent !== "2 min") hd_w.document.getElementById("feGapLonger").click();
  check("Duplicate is an icon button with a name for screen readers and as a hover hint, and Delete is not in the editor (it is on the recipe's open row)", hd_w.document.getElementById("feDuplicate").getAttribute("aria-label") === "Duplicate recipe" && !hd_w.document.getElementById("feDelete"));
  hd_w.document.getElementById("feGapLonger").click();
  check("the stepper works with no menu to open, and shows the new value", hd_w.document.getElementById("feGapValue").textContent === "3 min" && /"silence between segments": "3 min"/.test(T(hd_w)));
  // the pencil
  hd_sel().click();
  var hd_in = hd_w.document.getElementById("feName");
  hd_in.value = "Warm {x} glow {n}";
  hd_in.dispatchEvent(new hd_w.Event("input", { bubbles: true }));
  hd_in.dispatchEvent(new hd_w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  hd_sel().click();
  hd_w.document.getElementById("feName").value = "Something else";
  hd_w.document.getElementById("feName").dispatchEvent(new hd_w.Event("input", { bubbles: true }));
  hd_w.document.getElementById("feName").dispatchEvent(new hd_w.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  hd_sel().click();
  hd_w.document.getElementById("feName").value = "Final";
  hd_w.document.getElementById("feName").dispatchEvent(new hd_w.Event("input", { bubbles: true }));
  hd_w.document.getElementById("feName").dispatchEvent(new hd_w.Event("blur"));
  hd_sel().click();
  hd_w.document.querySelectorAll("#feTabs .fe-tab")[1].click();
  hd_w.document.getElementById("feDuplicate").click();
  hd_w.document.getElementById("feDuplicateConfirm").click();
  check("Duplicate in the header works as the menu item did", hd_w.document.querySelectorAll("#feTabs .fe-tab").length === 3 && hd_sel().textContent === "Cool copy");
  hd_w.eval("askDeleteFormat()");
  check("Delete still asks first, with the usual question", !!hd_w.document.getElementById("feDeleteDialog"));
  hd_w.document.getElementById("feDeleteCancel").click();
  // the notch
  // the app icon is in Arc's bar now, not beside the tabs
  
  } catch (err) { areaCrashed("card header, pencil and notch", err); }
}

  if (want("menu popups and the silence help")) { try {
  // ================================================================ the builder menu's popups and the ? by the silence stepper (A guide for facilitators was removed by Ron, 2026-11-10)
  var gf_w = await boot({ url: EDURL, session: signedIn(), local: { formats: 'RECIPES = {"a": {"name": "A {n}", "segments": [("", 20)]}}' }, fetchOptions: {} });
  var gf_d = gf_w.document;
  check("the ? beside the silence stepper says what it opens", gf_d.getElementById("feSilenceHelp").getAttribute("aria-label") === "Why silence between segments?");
  gf_d.getElementById("feSilenceHelp").click();
  check("the ? opens Silence between segments in a popup of its own", gf_d.getElementById("infoOverlay").hidden === false && gf_d.getElementById("infoSlot").firstElementChild.id === "silenceHelp" && gf_d.getElementById("infoTitle").textContent === "Silence between segments" && /Give space\./.test(gf_d.getElementById("silenceHelp").textContent));
  gf_d.getElementById("infoClose").click();
  check("closing puts it back, hidden", gf_d.getElementById("silenceHelp").hidden && !!gf_d.getElementById("silenceHelp").closest("footer"));
  gf_d.getElementById("feAppMenuButton").click();
  var gf_item = gf_d.getElementById("feTutorial");
  check("the menu begins with Watch the tutorial, with a line under it, then Color, a line, Feedback and Report a problem", !!gf_item && gf_item.nextElementSibling.classList.contains("fe-rule") && gf_item.nextElementSibling.nextElementSibling.id === "feColor" && gf_item.nextElementSibling.nextElementSibling.nextElementSibling.classList.contains("fe-rule") && gf_item.nextElementSibling.nextElementSibling.nextElementSibling.nextElementSibling.id === "feFeedback" && /^Watch the tutorial/.test(gf_item.textContent) && gf_item.querySelector(".fe-gditem-note").textContent === "2 minute walkthrough");
  gf_item.click();
  check("the tutorial popup has the browser's own player (controls, plays inline, the frame as its poster), a line under it, and Done", gf_d.getElementById("infoSlot").firstElementChild.id === "tutorialSection" && (() => { const v = gf_d.querySelector("#tutorialPlayer video"); return !!v && v.controls && v.hasAttribute("playsinline") && v.getAttribute("poster") === "tutorial-poster.jpg" && v.getAttribute("src") === "https://arc-media.roncarmel.workers.dev/tutorial.mp4"; })() && gf_d.getElementById("tutorialNote").textContent === "A 2 minute walkthrough." && gf_d.querySelector("#tutorialSection .dlg-foot .dlg-cancel").textContent === "Done");
  check("the menu's item shows a small frame from the video in place of an icon", !!gf_item.querySelector(".tv-frame img[src='tutorial-poster.jpg']") && !gf_item.querySelector(".fe-icon"));
  gf_d.getElementById("infoClose").click();
  var gf_html = fs.readFileSync(ROOT + "index.html", "utf8");
  check("every topic heading in Privacy has an icon, ahead of its text", [...gf_d.querySelectorAll("#privacySection details.gd-topic > summary")].every(s => s.querySelector(".gd-thead > .gd-ticon svg") && s.querySelector(".gd-thead > .gd-ttext").textContent.trim() && !s.querySelector(".gd-ticon").textContent));
  check("a heading's icon is grey, and pink while its topic is open", /details\.gd-topic > summary \.gd-ticon \{[^}]*color: var\(--muted\)/.test(gf_html) && /details\.gd-topic\[open\] > summary \.gd-ticon \{ color: var\(--accent\)/.test(gf_html));
  gf_w.eval("closeInfo(true); showView(\"home\", false)");
  check("home's ⋯ sits in its band, in the top right corner, as far in as Arc's icon", gf_d.getElementById("feAppMenu").parentElement.id === "hpMenuSlot" && gf_d.getElementById("hpMenuSlot").parentElement.classList.contains("hp-band") && /#homePage #hpMenuSlot \{ position: absolute; top: 16px; right: 16px;/.test(gf_html));
  gf_d.getElementById("feAppMenuButton").click();
  var gf_home = Array.from(gf_d.querySelectorAll("#feAppMenuPanel > *")).map((k) => k.id || k.className);
  check("home's ⋯ menu: Color, a line, Feedback, Report a problem, a line, Change Spotify login, Sign out and clear data, a line, Privacy, a line, the version", JSON.stringify(gf_home) === JSON.stringify(["feColor", "fe-rule", "feFeedback", "feReport", "fe-rule", "feLogin", "feClear", "fe-rule", "fePrivacy", "fe-rule", "feMenuVersion"]) && gf_d.getElementById("feLogin").textContent.trim() === "Change Spotify login" && gf_d.getElementById("feClear").textContent.trim() === "Sign out and clear data" && gf_d.querySelector("#feClear .fe-icon").outerHTML === gf_w.eval("feIcon(\"logout\").outerHTML"), JSON.stringify(gf_home));
  check("Color shows the chosen color as a dot at its right", !!gf_d.querySelector("#feColor .fe-colordot") && gf_d.querySelector("#feColor").lastElementChild.classList.contains("fe-colordot") && gf_d.querySelector("#feColor .fe-colordot").style.background !== "");
  gf_d.getElementById("feColor").click();
  check("and opens the swatches in the menu's popup, titled Color, with only its X to close it (no Done)", gf_d.getElementById("infoOverlay").hidden === false && gf_d.getElementById("infoTitle").textContent === "Color" && !!gf_d.querySelector("#infoSlot #colorBlock #themeSwatches .theme-swatch") && !gf_d.querySelector("#infoSlot #colorBlock .dlg-foot"));
  check("the page behind Color is not dimmed, so the color shows as it is", /#infoOverlay:has\(#colorBlock\) \{ background: transparent; \}/.test(gf_html));
  gf_d.getElementById("infoClose").click();
  check("the X closes it and Color goes back, hidden", gf_d.getElementById("infoOverlay").hidden === true && gf_d.getElementById("colorBlock").hidden === true && !!gf_d.getElementById("colorBlock").closest("footer"));
  gf_w.eval("showView(\"builder\", false)");
  check("in a tool the ⋯ is back in Arc's bar", gf_d.getElementById("feAppMenu").parentElement.id === "appBar" && !gf_d.getElementById("hpMenuSlot").firstElementChild);
  var gf_titles = {};
  for (const id of ["feedbackBlock", "reportBlock"]) { gf_w.eval(`openInfo("${id}")`); const t = gf_d.getElementById("infoTitle"); gf_titles[id] = [t.textContent, t.querySelector(".info-ticon") && t.querySelector(".info-ticon").innerHTML]; gf_d.getElementById("infoClose").click(); }
  check("each popup has its name as its title, with no icon, as in the build popup", JSON.stringify(Object.keys(gf_titles).map(k => gf_titles[k][0])) === JSON.stringify(["Feedback", "Report a problem"]) && Object.keys(gf_titles).every(k => !gf_titles[k][1]), JSON.stringify(gf_titles));
  gf_w.eval('openInfo("feedbackBlock")');
  check("Feedback's foot is Cancel then Send, and Cancel closes the popup", JSON.stringify(Array.from(gf_d.querySelectorAll("#infoSlot #feedbackForm .dlg-foot button")).map((b) => b.textContent.trim())) === JSON.stringify(["Cancel", "Send"]) && (gf_d.querySelector("#infoSlot #feedbackForm .dlg-cancel").click(), gf_d.getElementById("infoOverlay").hidden === true && !!gf_d.getElementById("feedbackBlock").closest("footer")));
  check("the forms always show Cancel and Done: they open only in the popup", !/#homeMore \.dlg-cancel/.test(gf_html));
  check("the popup's title has a round grey X and a line under it, like the build popup", /#infoHeader \{[^}]*border-bottom: 1px solid var\(--line\)/.test(gf_html) && /#infoDialog #infoClose \{[^}]*width: 32px; height: 32px;[^}]*border-radius: 50%/.test(gf_html));
  check("the popup title shrinks only on narrow screens, so a long title fits on one line at 320 px", /#infoTitle \{[^}]*font-size: min\(1\.15rem, calc\(\(100vw - 140px\) \/ 11\)\)/.test(gf_html));
  } catch (err) { areaCrashed("menu popups and the silence help", err); } }

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
  } catch (err) { areaCrashed("first segment tip", err); } }

  if (want("the play tip")) { try {
  // ================================================================ the second tutorial tip: what else to try, closed with its x or by building
  var pt_one = 'RECIPES = {"a": {"name": "A {n}", "segments": [("Calm", 20)]}}';
  var pt_w = await boot({ url: EDURL, session: signedIn(), local: { formats: 'RECIPES = {"a": {"name": "A {n}", "segments": [("", 20)]}}' }, fetchOptions: {} });
  var pt_tip = (w) => { const t = w.document.getElementById("fePlayTip"); return t && !t.hidden ? t : null; };
  check("not before the only recipe has a playlist (the first tip shows then)", !pt_tip(pt_w) && !!pt_w.document.getElementById("feFirstTip"));
  pt_w.eval("activeFormat().items[0].lists[0].name = 'Calm'; renderRows();");
  check("once it has one, the play tip shows at the bottom of the card, and the first tip goes", !!pt_tip(pt_w) && pt_tip(pt_w).parentNode.id === "fePlayTipSlot" && pt_w.document.getElementById("feCard").lastElementChild.id === "fePlayTipSlot" && !pt_w.document.getElementById("feFirstTip"));
  check("it says what to try and how to finish, with nothing about saving", pt_tip(pt_w).querySelector(".fe-playtip-title").textContent === "You got this, go play!" && /^Add more segments to this recipe and explore more of the options available to you here\. When you\u2019re ready, (click|tap) Done, then the  button on its row\.$/.test(pt_tip(pt_w).querySelector(".muted").textContent) && !!pt_tip(pt_w).querySelector(".muted .bh-mini svg"));
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
  var pt_src = appSource();
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
  var bt_e = await boot({ url: EDURL, session: signedIn(), local: { formats: "FORMATS = {}" }, fetchOptions: {} });
  check("with no recipes the landing has a welcome card: make the first one, what a recipe is, and the tutorial's row, then New recipe", (() => { const c = bt_e.document.getElementById("feWelcome"); return !!c && c.closest("#bhRecipes") && c.querySelector(".fe-welcome-title").textContent === "Time to make your first recipe!" && /^A recipe says which of your playlists to play, in what order, and for how long\./.test(c.querySelector(".fe-welcome-text").textContent) && JSON.stringify([...c.querySelectorAll("button")].map((b) => b.id)) === '["feWatch"]' && c.nextElementSibling.id === "bhNewRecipe"; })());
  check("with no recipes no status lines show (Python, Spotify, notices)", bt_e.document.body.classList.contains("no-recipes"));
  bt_e.document.getElementById("bhNewRecipe").click();
  bt_e.document.getElementById("feNewFormatCancel").click();
  check("New recipe and Cancel leave the welcome as it was", !!bt_e.document.getElementById("feWelcome") && bt_e.document.getElementById("recipePanelWrap").hidden);
  addNamed(bt_e, "First");
  check("a new recipe opens in the panel as new (Done in place of the X), and the landing lists it with no welcome", !bt_e.document.getElementById("feWelcome") && !!bt_e.document.getElementById("feCard") && !bt_e.document.getElementById("recipePanelWrap").hidden && !bt_e.document.getElementById("recipePanel").classList.contains("rp-clean") && bt_e.document.querySelector("#bhRecipes .bh-recipe .bh-name").textContent === "First" && !bt_e.document.body.classList.contains("no-recipes"));
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
  check("Duplicate sits at the right of the card's header, with no Delete beside it", JSON.stringify(Array.from(bt_w.document.querySelectorAll("#feHead .fe-headrow > .fe-silence, #feHead .fe-headtools > *")).map((el) => el.id || "silence")) === JSON.stringify(["silence", "feDuplicate"]));
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
  // the wording
  var bt_html = fs.readFileSync(ROOT + "index.html", "utf8").replace(/<!--[\s\S]*?-->/g, "").replace(/<style>[\s\S]*?<\/style>/g, "");
  var bt_app = appSource().split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  check("the page calls the action Build everywhere, never create playlists", !/create playlists/i.test(bt_html) && !/create playlists/i.test(bt_app), String((bt_html.match(/create playlists/gi) || []).length));
  } catch (err) { areaCrashed("duplicate question, format names, empty note and equal widths", err); } }


  if (want("tutorial video")) { try {
  // ================================================================ the tutorial video (Ron, 2026-11-11): the menu's frame, the first-recipe card's row, the welcome page's rows
  var tv_w = await boot({ url: "http://127.0.0.1:8000/" }), tv_d = tv_w.document;
  var tv_out = tv_d.getElementById("wpWatch"), tv_in = tv_d.getElementById("wpWatchIn");
  check("the welcome page has Watch how it works under the builder's card, with a triangle pointing up, and a frame from the video", !!tv_out && tv_out.previousElementSibling.querySelector("#wpBuilderHead") !== null && !!tv_out.querySelector(".tv-tip") && !!tv_out.querySelector(".tv-frame img[src='tutorial-poster.jpg']") && tv_out.querySelector(".tv-row-text b").textContent === "Watch how it works" && tv_out.querySelector(".tv-row-text span").textContent === "2 minute walkthrough" && !tv_out.hidden);
  check("both welcome rows open the tutorial the same way as the menu (watchTutorial)", "tutorial" in tv_out.dataset && "tutorial" in tv_in.dataset);
  tv_d.getElementById("wpBuilderHead").click();
  check("opening the builder's card folds the row away; the card has its own under its title", tv_out.hidden && !tv_d.getElementById("wpBuilderMore").hidden && tv_d.getElementById("wpBuilderMore").firstElementChild === tv_in);
  tv_d.getElementById("wpBuilderHead").click();
  check("closing the card brings the row back", !tv_out.hidden);
  tv_out.click();
  check("on a computer a welcome row opens the popup (no hidden fullscreen video is made)", !tv_d.getElementById("tutorialFull") && tv_d.getElementById("infoOverlay").hidden === false && tv_d.getElementById("infoSlot").firstElementChild.id === "tutorialSection");
  tv_d.getElementById("infoClose").click();
  var tv_b = await boot({ url: EDURL, session: signedIn(), local: { formats: "FORMATS = {}" }, fetchOptions: {} }), tv_bd = tv_b.document;
  var tv_watch = tv_bd.getElementById("feWatch");
  check("the first-recipe card has Watch how it works with a frame, under what a recipe is", !!tv_watch && tv_watch.previousElementSibling.classList.contains("fe-welcome-text") && !!tv_watch.querySelector(".tv-frame") && tv_watch.querySelector("b").textContent === "Watch how it works");
  tv_watch.click();
  check("it opens the tutorial popup", tv_bd.getElementById("infoOverlay").hidden === false && tv_bd.getElementById("infoSlot").firstElementChild.id === "tutorialSection");
  var tv_v = tv_bd.querySelector("#tutorialPlayer video");
  check("the popup's player has Watch again and Done over it, hidden until the end", !!tv_bd.querySelector("#tutorialPlayer .tv-end .tv-again") && !!tv_bd.querySelector("#tutorialPlayer .tv-end .tv-done") && !tv_bd.getElementById("tutorialPlayer").classList.contains("tv-ended"));
  tv_v.dispatchEvent(new tv_b.Event("ended"));
  check("at the end, Watch again and Done show and the player's controls go", tv_bd.getElementById("tutorialPlayer").classList.contains("tv-ended") && !tv_v.controls);
  tv_bd.querySelector("#tutorialPlayer .tv-again").click();
  check("Watch again starts over with the controls back", !tv_bd.getElementById("tutorialPlayer").classList.contains("tv-ended") && tv_v.controls);
  tv_v.dispatchEvent(new tv_b.Event("ended"));
  tv_bd.querySelector("#tutorialPlayer .tv-done").click();
  check("Done over the video closes the popup", tv_bd.getElementById("infoOverlay").hidden === true);
  tv_watch.click();
  tv_bd.getElementById("infoClose").click();
  check("closing the popup empties its player, so nothing plays on", tv_bd.getElementById("tutorialPlayer").childElementCount === 0);
  var tv_src = fs.readFileSync(ROOT + "editor.js", "utf8") + appSource();
  check("the video comes from Arc's media worker, no YouTube or Vimeo, and Privacy says so", !/youtube|vimeo/i.test(tv_src + fs.readFileSync(ROOT + "index.html", "utf8")) && /const TUTORIAL_VIDEO = "https:\/\/arc-media\.roncarmel\.workers\.dev\/tutorial\.mp4"/.test(tv_src) && fs.existsSync(ROOT + "tutorial-poster.jpg") && fs.existsSync(ROOT + "cloudflare/media/worker.js"));
  } catch (err) { areaCrashed("tutorial video", err); } }

  if (want("the tagline")) { try {
  // ================================================================ the tagline under the title
  var tg_w = await boot({ url: "http://127.0.0.1:8000/", local: { devMode: "1" } });   // developer mode: Music sharing opens
  check("the tagline says Arc is ceremony playlist tools for a Spotify library", tg_w.document.querySelector(".tagline").textContent === "Ceremony playlist tools for your music library");
  var tg_d = tg_w.document, tg_heads = Array.from(tg_d.querySelectorAll("#welcomePage .wp-tool-head"));
  check("under Tools, a card per tool: name, tagline, and the tool's own icon", tg_d.querySelector("#welcomePage .wp-sec").textContent === "Tools" && JSON.stringify(tg_heads.map((h) => [h.querySelector("b").textContent, h.querySelector(".wp-tool-tag").textContent])) === JSON.stringify([["Playlist builder", "Ceremony playlists, ready in seconds"], ["Shared playlist library", "Bring some, get some!"]]) && tg_heads.every((h) => !!h.querySelector(".tool-icon > svg.tool-glyph")));
  check("both cards start closed", tg_heads.every((h) => h.getAttribute("aria-expanded") === "false" && tg_d.getElementById(h.getAttribute("aria-controls")).hidden));
  tg_heads[0].click();
  var tg_more0 = tg_d.getElementById("wpBuilderMore"), tg_more1 = tg_d.getElementById("wpSharingMore");
  tg_heads[1].click();
  check("opening Music sharing closes the builder: one card open at a time", tg_more0.hidden && tg_heads[0].getAttribute("aria-expanded") === "false" && !tg_more1.hidden && !!tg_more1.querySelector("img[src='welcome-sharing-light.jpg']") && tg_more1.querySelector("source").getAttribute("srcset") === "welcome-sharing.jpg" && fs.existsSync(ROOT + "welcome-sharing.jpg") && fs.existsSync(ROOT + "welcome-sharing-light.jpg"));
  tg_heads[1].click();
  check("and a card closes again on its own head", tg_more1.hidden && tg_heads[1].getAttribute("aria-expanded") === "false");
  check("Get started is the first step's only button below the cards, and the setup step starts hidden", tg_d.getElementById("getStarted").textContent === "Get started" && tg_d.getElementById("wpSetup").hidden && !tg_d.getElementById("wpFirst").hidden && tg_d.getElementById("wpSetup").contains(tg_d.getElementById("startSetup")));
  tg_d.getElementById("getStarted").click();
  tg_d.querySelector('#wpWhich [data-pick-service="spotify"]').click(); tg_d.getElementById("wpWhichNext").click();   // the service choice comes first (its own checks are in the spotify premium area)
  check("Get started shows the band joined to Spotify's mark, Connect your Spotify account, the Premium note, Back and Start setup", !tg_d.getElementById("wpSetup").hidden && tg_d.getElementById("wpFirst").hidden && !!tg_d.querySelector("#welcomePage > .wp-band") && !!tg_d.querySelector("#wpJoint .wp-spotify") && tg_d.getElementById("wpSpotifyName").textContent === "Your Spotify" && /^M[\d.]+ /.test(tg_d.getElementById("wpWire").getAttribute("d") || "") && tg_d.querySelector("#wpSetup h2").textContent === "Connect your Spotify account" && !tg_d.querySelector("#wpSetup .wp-steps") && /^Spotify Premium is needed for the connection\.$/.test(tg_d.querySelector("#wpSetup .wp-note").textContent) && tg_d.getElementById("wpSetupBack").textContent === "Back" && tg_d.documentElement.classList.contains("page-welcome"));
  tg_w.eval("showWelcomeStep(1, false)");
  check("Back returns to the tools", tg_d.getElementById("wpSetup").hidden && !tg_d.getElementById("wpFirst").hidden);
  } catch (err) { areaCrashed("the tagline", err); } }

  if (want("settings below the segments, pink outline")) { try {
  // ================================================================ settings below the segments, and the pink outline
  var sb_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  var sb_w = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"a": {"name": "A {n}", "title": "Same", "segments": [("x", 10), ("y", 10)]}, "b": {"name": "B {n}", "title": "Other", "segments": [("x", 10)]}}' }, fetchOptions: {} });
  var sb_card = sb_w.document.getElementById("feCard");
  check("the card holds, top to bottom: the name warning, the bar, the segments, the settings row, then the play tip's place", JSON.stringify(Array.from(sb_card.children).map((c) => c.id || c.className.split(" ")[0])) === JSON.stringify(["feClash", "fe-barwrap", "feRows", "feHead", "fePlayTipSlot"]));
  check("New segment is the last thing among the segments, so the settings row is below it", sb_w.document.getElementById("feRows").lastElementChild.id === "feAddSegment" && !!(sb_w.document.getElementById("feAddSegment").compareDocumentPosition(sb_w.document.getElementById("feHead")) & 4));
  check("the settings row still has the silence control, then Duplicate", JSON.stringify(Array.from(sb_w.document.querySelectorAll("#feHead .fe-headrow > .fe-silence, #feHead .fe-headtools > *")).map((el) => el.id || "silence")) === JSON.stringify(["silence", "feDuplicate"]) && !sb_w.document.getElementById("feHead").querySelector("#feClash"));
  sb_w.document.querySelectorAll("#feTabs .fe-tab")[1].click();
  sb_w.document.querySelector('#feTabs .fe-tab[aria-pressed="true"]').click();
  var sb_in = sb_w.document.getElementById("feName");
  sb_in.value = "same"; sb_in.dispatchEvent(new sb_w.Event("input", { bubbles: true }));
  check("a name that matches another format's is warned about at the top of the card, near the tab being edited, and not down with the settings", sb_w.document.getElementById("feClash").hidden === false && sb_w.document.getElementById("feCard").firstElementChild.id === "feClash" && /Another recipe has this name/.test(sb_w.document.getElementById("feClash").textContent));
  } catch (err) { areaCrashed("settings below the segments, pink outline", err); } }

  if (want("questions and feedback")) { try {
  // ================================================================ questions and feedback
  var qf_o = {};
  var qf_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: qf_o, view: "home" });
  qf_w.document.getElementById("feAppMenuButton").click();
  check("home's ⋯ menu always has Feedback, before Report a problem", !!qf_w.document.getElementById("feFeedback") && qf_w.document.getElementById("feFeedback").nextElementSibling === qf_w.document.getElementById("feReport") && qf_w.document.getElementById("feFeedback").textContent.trim() === "Feedback");
  qf_w.document.getElementById("feFeedback").click();
  var qf_f = qf_w.document.getElementById("feedbackForm"), qf_t = qf_w.document.getElementById("feedbackText"), qf_s = qf_f.querySelector(".mf-send");
  check("its panel is a form: Your message, an optional email, and Send, pale until something is typed, with nothing attached", qf_f.dataset.kind === "feedback" && /Your message/.test(qf_f.textContent) && qf_w.document.getElementById("feedbackEmail").type === "email" && qf_s.disabled && qf_s.textContent.trim() === "Send" && !qf_f.querySelector("pre"));
  qf_t.value = "   "; qf_t.dispatchEvent(new qf_w.Event("input"));
  check("spaces alone do not light Send", qf_s.disabled === true);
  qf_t.value = "More colors please"; qf_t.dispatchEvent(new qf_w.Event("input"));
  qf_o.sharing = { shares: [], words: {}, posts: [], deletes: [], reports: [], messageFail: "Too many messages today. Try again tomorrow." };
  qf_s.click();
  await waitFor(() => !!qf_f.querySelector(".mf-error .er-box"), 4000);
  check("a refusal is said in the form's small error box, in the worker's words, and Send can be pressed again", /Too many messages today/.test(qf_f.querySelector(".mf-error").textContent) && !qf_f.hidden && qf_s.disabled === false);
  qf_o.sharing.messageFail = "";
  qf_s.click();
  await waitFor(() => !qf_w.document.querySelector("#feedbackBlock .mf-done").hidden, 4000);
  var qf_m = qf_o.sharing.messages[qf_o.sharing.messages.length - 1];
  check("then it sends only the message and an empty email, no details, and says Sent", qf_m.kind === "feedback" && qf_m.message === "More colors please" && qf_m.email === "" && !("details" in qf_m) && qf_f.hidden && /Sent/.test(qf_w.document.querySelector("#feedbackBlock .mf-done").textContent) && !qf_f.querySelector(".mf-error .er-box"));
  qf_o.sharing.down = true;
  qf_w.document.querySelector("#feedbackBlock .mf-again").click();
  qf_t.value = "Hello"; qf_t.dispatchEvent(new qf_w.Event("input"));
  qf_s.click();
  await waitFor(() => !!qf_f.querySelector(".mf-error .er-box"), 4000);
  check("with no connection it says so", /Check the connection/.test(qf_f.querySelector(".mf-error").textContent));
  var qf_priv = qf_w.document.getElementById("privacySection").textContent.replace(/\s+/g, " ");
  check("Privacy always names reports and feedback: sent only when the person sends them", /Error reports: when something unexpected goes wrong, Arc sends its developer the technical details\. Never your sign-in, playlist names or songs\. Feedback: sent only when you (tap|click) Send\./.test(qf_priv) && !qf_w.document.getElementById("privacyFeedback"), qf_priv);
  } catch (err) { areaCrashed("questions and feedback", err); } }

  if (want("python status at the bottom")) { try {
  // ================================================================ the Python status at the bottom of More options
  var py_w = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: {} });
  py_w.document.getElementById("feAppMenuButton").click();
  py_w.document.body.click();
  check("home has no Everything else; Python status is in the DEV menu", !py_w.document.getElementById("homeMore") && !!py_w.document.querySelector("#devMenu #pythonStatus"));
  } catch (err) { areaCrashed("python status at the bottom", err); } }

  if (want("spotify premium")) { try {
  // ================================================================ Spotify Premium: the tagline, the notice, the reminder, and the error
  var pr_html = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  var pr_w = await boot({ url: "http://127.0.0.1:8000/" });
  // the welcome page names no service until one is chosen; what each needs is on its tile (stage 5 of work/tidal-plan.md, 2026-11-16)
  var pr_d = pr_w.document;
  check("before a service is chosen, the welcome page names both and asks for nothing: no Premium capsule, the band says your music library", !pr_d.querySelector("#welcomePage .wp-req") && !pr_d.getElementById("premiumWhy") && /your own Spotify or TIDAL playlists/.test(pr_d.querySelector(".wp-lead").textContent) && pr_d.querySelector("#welcomePage .wp-band-tag").textContent.includes("for your music library"), pr_d.querySelector(".wp-lead").textContent);
  pr_d.getElementById("getStarted").click();
  await new Promise((r) => setTimeout(r, 50));
  var pr_tiles = [...pr_d.querySelectorAll("#wpWhich .wp-svc")];
  check("Get started asks Which music service do you use?, Spotify and TIDAL side by side, each saying what it needs", !pr_d.getElementById("wpWhich").hidden && pr_d.getElementById("wpFirst").hidden && pr_d.getElementById("wpSetup").hidden && pr_tiles.map((t) => t.dataset.pickService + ":" + t.querySelector(".wp-svc-name").textContent + ":" + t.querySelector(".wp-svc-req").textContent).join("|") === "spotify:Spotify:Spotify Premium is needed|tidal:TIDAL:Any TIDAL plan", pr_tiles.map((t) => t.textContent).join("|"));
  check("each tile's mark is plain, one color in the text's color, with no circle of another color", pr_tiles.every((t) => !t.querySelector("circle") && t.querySelector("svg path").getAttribute("fill") === "currentColor"));
  check("the tiles are radio buttons with none chosen, and Next waits for a choice (Ron, 2026-11-16)", pr_d.querySelector("#wpWhich .wp-svcs").getAttribute("role") === "radiogroup" && pr_tiles.every((t) => t.getAttribute("role") === "radio" && t.getAttribute("aria-checked") === "false") && pr_d.getElementById("wpWhichNext").disabled && pr_tiles[0].tabIndex === 0 && pr_tiles[1].tabIndex === -1);
  pr_tiles[0].click();
  check("a tap chooses Spotify without going on, and Next is ready", pr_tiles[0].getAttribute("aria-checked") === "true" && !pr_d.getElementById("wpWhichNext").disabled && !pr_d.getElementById("wpWhich").hidden);
  pr_tiles[0].dispatchEvent(new pr_w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  check("arrow keys skip TIDAL while it is Coming soon", pr_tiles[0].getAttribute("aria-checked") === "true" && pr_tiles[1].getAttribute("aria-checked") === "false");
  pr_d.getElementById("wpWhichNext").click();
  await new Promise((r) => setTimeout(r, 50));
  check("Spotify, the service in use, goes straight on to Connect your Spotify account, with its Premium note and its own mark on the line", !pr_d.getElementById("wpSetup").hidden && pr_d.getElementById("wpWhich").hidden && !pr_d.querySelector("#wpSetup .wp-note").hidden && pr_d.querySelector("#wpSetup .wp-setup-title").textContent === "Connect your Spotify account" && pr_d.querySelector("#wpSetup .wp-spotify-name").textContent === "Your Spotify" && !!pr_d.querySelector("#wpSetup .wp-spotify path[fill-rule='evenodd']"));
  pr_d.getElementById("wpSetupBack").click();
  await new Promise((r) => setTimeout(r, 50));
  check("Back from there returns to the choice", !pr_d.getElementById("wpWhich").hidden && pr_d.getElementById("wpSetup").hidden);
  pr_w.eval('localStorage.setItem("clientId", "spotify-id"); localStorage.setItem("clientId-tidal", "tidal-id"); localStorage.setItem("spotifySynced", "{}"); localStorage.setItem("spotifyAccount", "me"); pageWindow = () => ({ location: { reload() { window.prReloaded = true; } } })');
  pr_tiles[1].click();
  check("outside developer mode TIDAL says Coming soon, greyed, and choosing it does nothing (Ron, 2026-11-16)", pr_tiles[1].getAttribute("aria-disabled") === "true" && pr_w.getComputedStyle(pr_tiles[1].querySelector(".wp-svc-soon")).display === "block" && pr_w.getComputedStyle(pr_tiles[1].querySelector(".wp-svc-req")).display === "none" && !pr_tiles[0].hasAttribute("aria-disabled") && !pr_w.prReloaded && pr_w.localStorage.getItem("arcService") === null && !pr_d.getElementById("wpWhich").hidden);
  pr_w.eval("setDevMode(true)");
  check("in developer mode TIDAL can be chosen: no Coming soon", !pr_tiles[1].hasAttribute("aria-disabled") && pr_w.getComputedStyle(pr_tiles[1].querySelector(".wp-svc-soon")).display === "none");
  pr_tiles[0].dispatchEvent(new pr_w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  check("in developer mode an arrow key moves the choice to TIDAL, and the tap's choice stays until Next", pr_tiles[1].getAttribute("aria-checked") === "true" && pr_tiles[0].getAttribute("aria-checked") === "false" && pr_tiles[1].tabIndex === 0 && !pr_w.prReloaded);
  pr_w.eval("setDevMode(false)");
  check("developer mode off again: TIDAL loses the choice and Next waits", pr_tiles[1].getAttribute("aria-checked") === "false" && pr_d.getElementById("wpWhichNext").disabled);
  pr_w.eval("setDevMode(true)");
  pr_tiles[1].click();
  pr_d.getElementById("wpWhichNext").click();
  check("TIDAL, another service, swaps in its Client ID, forgets the old service's save records, and loads the page again on the next step", pr_w.prReloaded === true && pr_w.localStorage.getItem("arcService") === "tidal" && pr_w.localStorage.getItem("clientId") === "tidal-id" && pr_w.localStorage.getItem("clientId-spotify") === "spotify-id" && pr_w.localStorage.getItem("spotifySynced") === null && pr_w.localStorage.getItem("spotifyAccount") === null && pr_w.sessionStorage.getItem("welcomeAt") === "3");
  var pr_t = await boot({ url: "http://127.0.0.1:8000/", local: { arcService: "tidal" }, session: { welcomeAt: "3" } });
  var pr_td = pr_t.document;
  check("loaded again under TIDAL, it opens on Connect your TIDAL account, with no Premium note, TIDAL's mark and Your TIDAL on the line, and back goes to the choice", !pr_td.getElementById("wpSetup").hidden && pr_td.getElementById("wpFirst").hidden && pr_td.getElementById("wpWhich").hidden && pr_td.querySelector("#wpSetup .wp-note").hidden && pr_td.querySelector("#wpSetup .wp-setup-title").textContent === "Connect your TIDAL account" && pr_td.querySelector("#wpSetup .wp-spotify-name").textContent === "Your TIDAL" && !pr_td.querySelector("#wpSetup .wp-spotify path[fill-rule='evenodd']") && pr_t.history.state && pr_t.history.state.step === 3 && pr_t.sessionStorage.getItem("welcomeAt") === null);
  pr_td.getElementById("startSetup").click();
  await new Promise((r) => setTimeout(r, 50));
  pr_td.querySelector('[data-flow="new"]').click(); pr_td.getElementById("spNext").click();
  await new Promise((r) => setTimeout(r, 50));
  check("TIDAL's setup shows its own steps (its dashboard, the redirect address, the five scopes) and its own note, not Spotify's; the last step names Connect to TIDAL, which sits beside Back at the foot", !pr_td.getElementById("flowNewTidal").hidden && pr_td.getElementById("flowNew").hidden && pr_td.getElementById("spStepsTitle").textContent === "Create an app inside your TIDAL account" && pr_td.querySelector('#flowNewTidal a[href="https://developer.tidal.com/dashboard"]') && pr_td.querySelector("#flowNewTidal .redirect-address").textContent === "http://127.0.0.1:8000/" && pr_td.querySelectorAll("#flowNewTidal li code").length >= 6 && !pr_td.getElementById("spWhatTidal").hidden && pr_td.getElementById("spWhat").hidden && pr_td.querySelector('#connectStep [data-only="spotify"]').hidden && /^Press Connect to TIDAL below\. TIDAL will ask you to log in and to allow Arc access\.$/.test(pr_td.querySelector('#connectStep [data-only="tidal"]').textContent.replace(/Click|Tap/, "Press")) && !pr_td.getElementById("connect").hidden && pr_td.getElementById("connect").closest(".wp-pair").contains(pr_td.getElementById("setupBack")) && pr_td.getElementById("connect").textContent.includes("Connect to TIDAL") && pr_td.querySelector("#flowNewTidal .tx-nw").textContent === "Redirect URI 1");
  var pr_shots = [...pr_td.querySelectorAll("#flowNewTidal .tx-shot img")];
  check("TIDAL's steps show close-ups of its dashboard that exist, each with a pink ring on what to press (the typed name has nothing to press); each value to copy sits on one line with an icon-only Copy; the five scopes are a list", pr_shots.length === 10 && pr_shots.every((i) => fs.existsSync(ROOT + i.getAttribute("src")) && i.getAttribute("alt")) && [...pr_td.querySelectorAll("#flowNewTidal .tx-shot")].filter((s) => !s.querySelector(".tx-ring")).map((s) => s.querySelector("img").getAttribute("src")).join() === "setup-tidal/name.png" && [...pr_td.querySelectorAll("#flowNewTidal .tx-copy")].map((c) => c.querySelector("code").textContent + ":" + c.querySelector(".copy-field").getAttribute("aria-label")).join("|") === "Arc:Copy|http://127.0.0.1:8000/:Copy" && [...pr_td.querySelectorAll("#flowNewTidal .tx-scopes li")].map((l) => l.textContent).join(",") === "collection.read,playlists.read,playlists.write,search.read,user.read");
  pr_t.close();
  var pr_w2 = await boot({ url: "http://127.0.0.1:8000/", local: { clientId: "abc123" } });
  var pr_w3 = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI, clientId: "abc123" } });
  check("when connected, the welcome page and its notice are not shown", pr_w3.document.documentElement.classList.contains("page-app"));
  check("the first instruction for making the developer app says to log in with the Premium account", /\(it will open in <span data-home="Safari">a new tab<\/span>\), log in with your Spotify Premium account, and <span data-act>press<\/span> the <span class="ui">Create app<\/span> button\./.test(pr_html));
  // the error
  var pr_e = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { premiumRequired: true } });
  await waitFor(() => !pr_e.document.getElementById("connectionProblem").hidden, 30000);
  var PRM = "Spotify says the account that owns this Client ID needs Premium. A free Spotify account will not work. Once that account has Premium, try again.";
  check("when Spotify refuses with a Premium message, Step 1 says exactly that, not the old advice to reconnect", pr_e.document.getElementById("connectionMessage").textContent === PRM && !/Disconnect|approve every permission/.test(pr_e.document.getElementById("connectionMessage").textContent), pr_e.document.getElementById("connectionMessage").textContent);
  check("it offers Try again, which helps once the account has Premium, and not Connect again, which would change nothing", pr_e.document.getElementById("connectionRetry").hidden === false && pr_e.document.getElementById("connectionReconnect").hidden === true);
  check("it is a known problem, so there is no report link for it", pr_e.document.getElementById("connectionReportHint").hidden === true);
  check("and it is counted as its own kind of connection problem, premium", pr_e.eval('problemKind("' + PRM + '")') === "premium" && pr_e.eval('problemKind("Spotify did not allow this (x). Click Disconnect")') === "sign-in");
  var pr_o = await boot({ url: "http://127.0.0.1:8000/", session: signedIn(), local: { formats: MINI }, fetchOptions: { denyCreate: true } });
  } catch (err) { areaCrashed("spotify premium", err); } }

  if (want("welcome recipe link")) { try {
  // ================================================================ "recipe" on the welcome page opens a note that says what a recipe is
  var rw_w = await boot({ url: "http://127.0.0.1:8000/" });
  var rw_word = rw_w.document.getElementById("recipeWhat"), rw_note = rw_w.document.getElementById("recipeWhatText");
  var rw_para = rw_word && rw_word.closest("p");
  check("the intro says Describe this arc in a recipe, with recipe as a link-like button and no bracketed list after it", !!rw_word && rw_word.textContent === "recipe" && rw_word.classList.contains("linklike") && !!rw_para && /Describe this arc in a recipe and the builder follows it to make new ceremony playlists/.test(rw_para.textContent.replace(rw_note.textContent, "")) && !/\(which of your Spotify playlists/.test(rw_para.textContent));
  check("the note starts closed, and recipe opens it with the agreed text", rw_note.hidden === true && rw_word.getAttribute("aria-expanded") === "false" && (rw_word.click(), rw_note.hidden === false) && rw_word.getAttribute("aria-expanded") === "true" && rw_note.textContent === "A recipe is a plan for one ceremony: which of your playlists to draw from, in what order, and for how many minutes each.");
  rw_note.click();
  check("a tap on the note leaves it open, a tap elsewhere closes it", rw_note.hidden === false && (rw_w.document.body.click(), rw_note.hidden === true) && rw_word.getAttribute("aria-expanded") === "false");
  check("recipe again closes it, and so does Escape", (rw_word.click(), rw_word.click(), rw_note.hidden === true) && (rw_word.click(), rw_w.document.dispatchEvent(new rw_w.KeyboardEvent("keydown", { key: "Escape" })), rw_note.hidden === true));
  } catch (err) { areaCrashed("welcome recipe link", err); } }



  if (want("the silence card")) { try {
  // ================================================================ the silence card: 0 sec, one look for zero, Reset to default, and centered on its marker
  var sc_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  var sc_src = fs.readFileSync(ROOT + "editor.js", "utf8");
  var sc_w = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"a": {"name": "A {n}", "title": "T", "silence between segments": "1 min", "segments": [("x", 10), ("silence", "none"), ("y", 10), ("z", 10)]}}' }, fetchOptions: {} });
  var sc_tag = () => rowsOf(sc_w)[0].querySelector(".fe-tag"), sc_tag2 = () => rowsOf(sc_w)[1].querySelector(".fe-tag");
  check("the default is a deep pink and anything changed is the buttons' bright pink, zero included", sc_tag().classList.contains("fe-tag-custom") && sc_tag2().classList.contains("fe-tag-default") && sc_tag().textContent === "0s" && /0 sec\. (Tap|Click) to change\./.test(sc_tag().getAttribute("aria-label")));
  sc_tag().click();
  check("the card's length reads 0 sec, as the marker does, and there is a pink Reset to default link below it", sc_w.document.getElementById("feTagDuration").textContent === "0 sec" && sc_w.document.getElementById("feTagReset").textContent === "Reset to default");
  sc_w.document.getElementById("feTagReset").click();
  sc_tag().click();
  check("once it is back at the default, the card shows a gray (default) in that place, and the link is gone", sc_w.document.getElementById("feTagDefault").textContent === "(default)" && !sc_w.document.getElementById("feTagReset") && sc_w.document.getElementById("feTagDefault").closest(".fe-tagbelow") !== null);
  check("the card is centered on its marker, just left of it, and never flips up or down", /#formatEditor \.fe-tagpanel \{ right: 8px; top: 55px; transform: translateY\(calc\(-50% \+ var\(--shift, 0px\)\)\);/.test(sc_css) && !/fe-tagpanel\.fe-up/.test(sc_css) && !sc_w.document.getElementById("feTagPanel").classList.contains("fe-up"));

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
  var sc_ndw = await boot({ url: EDURL, session: signedIn(), local: { formats: 'FORMATS = {"a": {"name": "A {n}", "title": "T", "silence between segments": "1 min", "segments": [("x", 10), ("y", 10), ("silence", "30 sec")]}}' }, fetchOptions: {} });
  rowsOf(sc_ndw)[1].querySelector(".fe-tag").click();
  var sc_ncol = sc_ndw.document.querySelector("#feTagPanel .fe-tagcol");
  check("a silence with no default to go back to has its Remove button under the widget, centered, and nothing beside it", !!sc_ndw.document.getElementById("feTagRemove") && sc_ncol.children.length === 2 && sc_ncol.children[1].contains(sc_ndw.document.getElementById("feTagRemove")) && sc_ndw.document.querySelector("#feTagPanel .fe-tagrow").children.length === 1);
  } catch (err) { areaCrashed("the silence card", err); } }

  if (want("narrow more button")) { try {
  // ================================================================ narrow mode: the more button is only as wide as its dots
  var nm_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");

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
  } catch (err) { areaCrashed("popups close only", err); } }


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
  var pi_w2 = await boot({ url: EDURL, session: signedIn(), local: { formats: pi_renamed }, fetchOptions: {} });
  await waitFor(() => /💗 spacious \+ gentle \[id:p2\]/.test(pi_w2.document.getElementById("formats").value), 8000);
  check("a playlist renamed in Spotify is found by its ID, and the format shows and saves its new name", rowsOf(pi_w2)[0].querySelector(".fe-title").textContent === "💗 spacious + gentle" && !/Old name/.test(pi_w2.document.getElementById("formats").value) && /💗 spacious \+ gentle \[id:p2\]/.test(pi_w2.localStorage.getItem("formats")));
  check("the engine is handed the new name, which is the one it finds in your playlists", JSON.parse(pi_py("needed_sources", [pi_w2.document.getElementById("formats").value, "a"])).join("|") === "💗 spacious + gentle|🛋 rest");

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
  var sp_clash = sp_w.service.idFromBytes(sp_bytes(0x11, 0x7a)), sp_clashB = sp_w.service.idFromBytes(sp_bytes(0x22, 0x7a));
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
  await saveRecipe(ss_w1);
  await waitFor(() => ss_writes(ss_o1, "update").some((x) => x.description), 5000);
  var ss_u = ss_writes(ss_o1, "update").filter((x) => x.description)[0];
  check("an edit brings the save of that format up to date: its revision is 1 now, and it is the playlist made for it", ss_w0.unpackFormat(ss_u.description).format.rev === 1 && ss_w0.unpackFormat(ss_u.description).format.id === "f1" && ss_u.id === ss_c.find((x) => x.name.startsWith("Alpha")).id);
  check("and the other format's save is not touched", ss_writes(ss_o1, "update").filter((x) => x.description).every((x) => x.id !== ss_c.find((y) => y.name.startsWith("Beta")).id));
  // a rename
  ss_w1.eval('editor.model.formats[0].title = "Alpha 2"; commit();');
  await saveRecipe(ss_w1);
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

  // nothing is written while the tests turn saving off
  var ss_o4 = { descStore: {} };
  var ss_w4 = await ss_started({ formats: ss_two, backupMode: "manual" }, ss_o4);
  await new Promise((r) => setTimeout(r, 1500));
  var ss_o5 = { descStore: {} };
  var ss_w5 = await ss_started({ formats: ss_two }, ss_o5);
  await new Promise((r) => setTimeout(r, 1500));
  check("with saving turned off by the tests, nothing is written to Spotify", ss_o4.writes.filter((x) => x.type === "create" || x.type === "update" || x.type === "remove").length === 0 && ss_o5.writes.filter((x) => x.type === "create" || x.type === "update" || x.type === "remove").length === 0);

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
  ss_w1.eval('askDeleteFormat()');
  check("deleting a recipe says it is removed from Spotify too", /removes the recipe from this list and from Spotify\./.test(ss_w1.document.getElementById("feDeleteDialog").textContent) && !/restored from a backup/.test(ss_w1.document.getElementById("feDeleteDialog").textContent));
  ss_w1.document.getElementById("feDeleteCancel").click();
  } catch (err) { areaCrashed("spotify saves", err); } }

  if (want("save pacing")) { try {
  // ================================================================ how often the saves are made
  var sp_src = appSource();
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
  await new Promise((r) => setTimeout(r, 900));
  check("edits are not saved to Spotify until Save changes, however long they wait", sp_ups(sp_o1).length === sp_base && /"dirty":true/.test(sp_w1.localStorage.getItem("recipeEditing") || ""));
  await saveRecipe(sp_w1);
  await waitFor(() => sp_ups(sp_o1).length > sp_base, 4000);
  await new Promise((r) => setTimeout(r, 400));
  check("and once saved, it is saved once, with all of them in it", sp_ups(sp_o1).length === sp_base + 1 && sp_w1.unpackFormat(sp_ups(sp_o1)[sp_base].description).format.items[0].minutes === 55 && !sp_w1.localStorage.getItem("recipeEditing"));
  // not during a build
  var sp_k = sp_ups(sp_o1).length;
  sp_w1.eval("busy = true");
  rowsOf(sp_w1)[0].querySelector(".fe-inc").click();
  await saveRecipe(sp_w1);
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
  check("an edit not saved yet sends nothing", sp_ups(sp_o2).length === 0);
  Object.defineProperty(sp_w2.document, "visibilityState", { value: "hidden", configurable: true });
  sp_w2.document.dispatchEvent(new sp_w2.Event("visibilitychange"));
  await new Promise((r) => setTimeout(r, 300));
  check("nor does hiding the page: changes not saved stay in this browser as Unsaved changes", sp_ups(sp_o2).length === 0 && /"dirty":true/.test(sp_w2.localStorage.getItem("recipeEditing") || ""));
  Object.defineProperty(sp_w2.document, "visibilityState", { value: "visible", configurable: true });
  sp_w2.eval("spotifySaveDelayMs = 60000");
  sp_w2.document.getElementById("rpSave").click();
  await waitFor(() => sp_ups(sp_o2).length === 1, 4000);
  check("Save changes sends them at once, whatever the usual pause", sp_ups(sp_o2).length === 1);
  var sp_sub = () => { const r = sp_w2.document.querySelector("#builderHome .bh-recipe .bh-sub"); return r ? r.className + "|" + r.textContent : ""; };
  await waitFor(() => /bh-saved\|.*Saved/.test(sp_sub()), 4000);
  check("and the recipe's row says Saved (with a check) once it is in Spotify", /bh-saved\|\u2713Saved/.test(sp_sub()), sp_sub());
  await waitFor(() => !/bh-sav/.test(sp_sub()), 4000);
  check("then goes back to its length", !/bh-sav/.test(sp_sub()) && /min|hr/.test(sp_sub()), sp_sub());
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
  bc_w1.document.body.click();
  rowsOf(bc_w1)[0].querySelector(".fe-inc").click();
  await saveRecipe(bc_w1);
  await waitFor(() => bc_o1.writes.some((x) => x.type === "update" && x.description), 5000);
  await new Promise((r) => setTimeout(r, 300));
  check("an update does not send the cover again", bc_covers(bc_o1).length === 2);
  check("when the covers were put on, nothing is said about them", bc_w1.eval("saveState.coverProblem") === null && !/cover/.test(capText(bc_w1)));
  // an existing backup that has no cover gets one, and one that has a cover does not
  var bc_pack = (id, title) => bc_w0.packFormat(bc_w0.ensureGaps({ id, title, gap: 30, gaps: [], lead: 0, items: [{ id: "a", kind: "seg", lists: [{ name: "", id: "p2", weight: 1 }], minutes: 30 }], rev: 0, modified: 0 }), ["p2"]);
  var bc_o2 = { descStore: {}, nameStore: {}, extraPlaylists: [{ id: "s1", name: "Alpha (recipe)", owner: { id: "ron" }, description: bc_pack("f1", "Alpha") }, { id: "s2", name: "Beta (recipe)", owner: { id: "ron" }, description: bc_pack("f2", "Beta"), images: [{ url: "https://img.example/x.jpg" }] }] };
  var bc_w2 = await boot({ url: EDURL, session: signedIn(), local: { formats: bc_fmt, backupMode: "spotify", recipeCoverLook: "sliders", spotifySynced: JSON.stringify({ f1: { rev: 0 }, f2: { rev: 0 } }) }, fetchOptions: bc_o2 });
  bc_w2.eval("spotifySaveDelayMs = 30");
  await waitFor(() => bc_o2.writes.some((x) => x.type === "update"), 8000);
  await new Promise((r) => setTimeout(r, 300));
  check("a backup that has no cover yet gets one, and one that has a cover is left as it is", bc_covers(bc_o2).length === 1 && bc_covers(bc_o2)[0].id === "s1");
  // a save from before the cover said SAVED RECIPE (its description begins with only Do not edit.) gets the new cover once, even though it has a cover
  var bc_oldPack = (id, title) => bc_pack(id, title).replace("Holds a recipe, not music. ", "");
  var bc_o6 = { descStore: {}, nameStore: {}, extraPlaylists: [{ id: "s1", name: "Alpha (recipe)", owner: { id: "ron" }, description: bc_oldPack("f1", "Alpha"), images: [{ url: "https://img.example/x.jpg" }] }, { id: "s2", name: "Beta (recipe)", owner: { id: "ron" }, description: bc_pack("f2", "Beta"), images: [{ url: "https://img.example/y.jpg" }] }] };
  var bc_w6 = await boot({ url: EDURL, session: signedIn(), local: { formats: bc_fmt, backupMode: "spotify", recipeCoverLook: "sliders", spotifySynced: JSON.stringify({ f1: { rev: 0 }, f2: { rev: 0 } }) }, fetchOptions: bc_o6 });
  bc_w6.eval("spotifySaveDelayMs = 30");
  await waitFor(() => bc_covers(bc_o6).length >= 1, 8000);
  await new Promise((r) => setTimeout(r, 300));
  check("a save with the old note is rewritten with the new one and gets the new cover; a save already new is left alone", bc_covers(bc_o6).length === 1 && bc_covers(bc_o6)[0].id === "s1" && bc_covers(bc_o6)[0].base64 === bc_file.toString("base64") && bc_o6.writes.some((x) => x.type === "update" && /^Holds a recipe, not music\. /.test(x.description || "")));
  check("once the new cover is sent, nothing is left waiting for one", bc_w6.localStorage.getItem("recipeCoverDue") === null);
  // when the cover changes (a browser that has not sent this look yet), every save that has a cover gets the new one once
  var bc_o7 = { descStore: {}, nameStore: {}, extraPlaylists: [{ id: "s1", name: "Alpha (recipe)", owner: { id: "ron" }, description: bc_pack("f1", "Alpha"), images: [{ url: "https://img.example/x.jpg" }] }, { id: "s2", name: "Beta (recipe)", owner: { id: "ron" }, description: bc_pack("f2", "Beta"), images: [{ url: "https://img.example/y.jpg" }] }] };
  var bc_w7 = await boot({ url: EDURL, session: signedIn(), local: { formats: bc_fmt, backupMode: "spotify", recipeCoverLook: "cloud", spotifySynced: JSON.stringify({ f1: { rev: 0 }, f2: { rev: 0 } }) }, fetchOptions: bc_o7 });
  bc_w7.eval("spotifySaveDelayMs = 30");
  await waitFor(() => bc_covers(bc_o7).length >= 2, 8000);
  check("a new cover look is sent once to every save that has a cover", bc_covers(bc_o7).map((c) => c.id).sort().join() === "s1,s2" && bc_w7.localStorage.getItem("recipeCoverLook") === "sliders" && bc_w7.localStorage.getItem("recipeCoverDue") === null);
  // without permission to upload images, or when the image is refused or missing, the saves still happen
  var bc_o3 = { descStore: {}, nameStore: {} };
  var bc_w3 = await boot({ url: EDURL, session: { token: JSON.stringify({ value: "t", expires: Date.now() + 3600000, scope: SCOPE_ALL.replace(" ugc-image-upload", "") }) }, local: { formats: bc_fmt, backupMode: "spotify" }, fetchOptions: bc_o3 });
  bc_w3.eval("spotifySaveDelayMs = 30");
  await waitFor(() => bc_o3.writes.filter((x) => x.type === "create").length === 2, 8000);
  check("with a sign-in that does not allow uploading images, no cover is sent, and the saves are made all the same", bc_covers(bc_o3).length === 0 && /Last saved at/.test(bc_w3.document.getElementById("spotifySaveStatus").textContent));
  check("and the line under the bar says why there is no cover, and what to do about it", /does not include permission to add cover art/.test(capText(bc_w3)) && /Sign in again with Change Spotify login, in the ⋯ menu on Arc.s home, to allow it/.test(capText(bc_w3)) && capLinks(bc_w3).some((b) => b.textContent === "OK"));
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

  // Arc open on two devices: the other one saved after this page read the list, then this one changes the recipe too. The save reads the list again first, so it asks
  var mg_o2b = { descStore: {}, nameStore: {}, extraPlaylists: [mg_pl("s1", "Alpha (recipe)", mg_remote("f1", "Alpha", 2, 30))] };
  var mg_w2b = await mg_go({ formats: mg_text(mg_item("f1", "Alpha", 2, 30)), spotifySynced: JSON.stringify({ f1: { rev: 2 } }) }, mg_o2b);
  await mg_settled(mg_w2b);
  mg_w2b.eval("SAVE_FRESH_MS = 0");
  mg_o2b.descStore.s1 = mg_remote("f1", "Alpha", 3, 20, 1790000500);
  var mg_lists2b = mg_o2b.listCalls;
  mg_w2b.eval("(() => { const f = editor.model.formats.find((x) => x.id === 'f1'); f.items[0].minutes = 50; f.rev = 3; f.modified = 1790000600; runSpotifySave(); })()");
  await waitFor(() => !!mg_w2b.document.getElementById("feSyncDialog"), 8000);
  check("a save reads the account's playlists again first, so a recipe another device saved since is asked about instead of written over", mg_o2b.listCalls > mg_lists2b && /was changed in two places/.test(mg_w2b.document.getElementById("feSyncDialog").textContent) && !mg_ups(mg_o2b, "s1").length);

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

  // two saves of one recipe in the list are recorded for the request log, once, with where each sits
  var mg_od = { descStore: {}, nameStore: {}, extraPlaylists: [mg_pl("s1", "Alpha (recipe)", mg_remote("f1", "Alpha", 2, 30)), mg_pl("s1b", "Alpha (recipe)", mg_remote("f1", "Alpha", 1, 30))] };
  var mg_wd = await mg_go({ formats: mg_text(mg_item("f1", "Alpha", 2, 30)), spotifySynced: JSON.stringify({ f1: { rev: 2, playlistId: "s1" } }) }, mg_od);
  await mg_settled(mg_wd);
  await mg_wd.loadMyPlaylists();
  var mg_dup = JSON.parse(mg_wd.localStorage.getItem("saveDuplicates") || "[]");
  var mg_lr = JSON.parse(mg_wd.localStorage.getItem("listReads") || "[]");
  check("every read of the playlist list is recorded with its tab, its count against Spotify's total and the saves it showed", mg_lr.length >= 2 && mg_lr.every((e) => e.tab && typeof e.count === "number" && "total" in e) && mg_lr[mg_lr.length - 1].saves.filter((x) => x[0] === "f1").length === 2 && JSON.parse(mg_wd.limitRecordText()).listReads.length === mg_lr.length, JSON.stringify(mg_lr[mg_lr.length - 1]));
  check("two saves of one recipe are recorded once for the request log, with their places in the list and the list's pages, and nothing is removed", mg_dup.length === 1 && mg_dup[0].recipeId === "f1" && mg_dup[0].saves.length === 2 && mg_dup[0].saves.every((x) => typeof x.at === "number") && mg_dup[0].pages.length >= 1 && !mg_od.writes.some((x) => x.type === "remove") && JSON.parse(mg_wd.limitRecordText()).saveDuplicates.length === 1, JSON.stringify(mg_dup));

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
  var mg_sc = JSON.parse(mg_w8.localStorage.getItem("saveCreates") || "[]");
  check("a new save is recorded for the request log with what the save saw: the recipe, its record, the list's count and Spotify's total", mg_sc.length === 1 && mg_sc[0].recipe.id === "f2" && mg_sc[0].sameName.length === 0 && typeof mg_sc[0].playlistCount === "number" && "listTotal" in mg_sc[0] && "listReadAgainDuringSave" in mg_sc[0] && JSON.parse(mg_w8.limitRecordText()).saveCreates.length === 1, JSON.stringify(mg_sc[0]));
  check("keeping it saves it to Spotify again, as a new backup", mg_o8.writes.filter((x) => x.type === "create").length === 1 && mg_o8.writes.filter((x) => x.type === "create")[0].name === "Beta (recipe)" && !!mg_fmt(mg_w8, "f2"));
  var mg_o9 = { descStore: {}, nameStore: {}, extraPlaylists: [mg_pl("s1", "Alpha (recipe)", mg_remote("f1", "Alpha", 2, 30))] };
  var mg_w9 = await mg_go({ formats: mg_text(mg_item("f1", "Alpha", 2, 30), mg_item("f2", "Beta", 1, 40)), spotifySynced: JSON.stringify({ f1: { rev: 2 }, f2: { rev: 1 } }), devMode: "1" }, mg_o9);
  await waitFor(() => !!mg_w9.document.getElementById("feSyncDialog"), 8000);
  var mg_rec = JSON.parse(mg_w9.localStorage.getItem("syncAsks") || "[]");
  check("what the app saw when it asked is kept for the request log: the recipe asked about, its record, the saves in the list and who read the list", mg_rec.length === 1 && mg_rec[0].asks[0].id === "f2" && mg_rec[0].asks[0].kind === "removed" && mg_rec[0].asks[0].synced.rev === 1 && mg_rec[0].saves.length === 1 && mg_rec[0].saves[0][2] === "f1" && /loadMyPlaylists|connect|load/i.test(mg_rec[0].listReadBy) && JSON.parse(mg_w9.limitRecordText()).syncAsks.length === 1, JSON.stringify(mg_rec[0] && { by: mg_rec[0].listReadBy, saves: mg_rec[0].saves }));
  check("in developer mode the question has Copy details, and it is not one of the answers", /Copy details/.test((mg_w9.document.getElementById("feSyncDebug") || {}).textContent || "") && !mg_w8.document.getElementById("feSyncDebug"));
  mg_w9.document.getElementById("feSyncChoice1").click();
  await mg_settled(mg_w9);
  check("removing it takes it off this device, and does not touch Spotify, where it is already gone", !mg_fmt(mg_w9, "f2") && mg_o9.writes.filter((x) => x.type === "remove" || x.type === "create").length === 0 && !JSON.parse(mg_w9.localStorage.getItem("spotifySynced")).f2);

  // Spotify sends the first page of the list empty: read again, and nothing is asked
  var mg_o13 = { descStore: {}, nameStore: {}, emptyFirstPages: 1, extraPlaylists: [] };
  var mg_o13Saves = [mg_pl("s1", "Alpha (recipe)", mg_remote("f1", "Alpha", 2, 30)), mg_pl("s2", "Beta (recipe)", mg_remote("f2", "Beta", 1, 40))];
  mg_o13.extraPlaylists = mg_o13Saves;
  var mg_w13 = await mg_go({ formats: mg_text(mg_item("f1", "Alpha", 2, 30), mg_item("f2", "Beta", 1, 40)), spotifySynced: JSON.stringify({ f1: { rev: 2, playlistId: "s1" }, f2: { rev: 1, playlistId: "s2" } }) }, mg_o13);
  await mg_settled(mg_w13);
  check("a page Spotify sends short is read again, and the saves on it are found: no question, no new save, no wait", !mg_w13.document.getElementById("feSyncDialog") && mg_o13.writes.filter((x) => x.type === "create").length === 0 && mg_w13.eval("connection") === "ready" && !mg_w13.eval("limitWait.active"), JSON.stringify(mg_w13.eval("playlistPages")));
  var mg_o14 = { descStore: {}, nameStore: {}, emptyFirstPages: 99, extraPlaylists: mg_o13Saves };
  var mg_w14 = await mg_go({ formats: mg_text(mg_item("f1", "Alpha", 2, 30), mg_item("f2", "Beta", 1, 40)), spotifySynced: JSON.stringify({ f1: { rev: 2, playlistId: "s1" }, f2: { rev: 1, playlistId: "s2" } }), spotifyPendingDeletes: JSON.stringify(["f3"]) }, mg_o14);
  await waitFor(() => !!mg_w14.document.getElementById("feSyncDialog"), 12000);
  var mg_d14 = mg_w14.document.getElementById("feSyncDialog");
  check("a list still short after reading again is not used: Arc is not connected, waits for all of it, and says so in a plain popup with OK alone, Arc reporting it by itself", /Spotify didn’t send all your playlists/.test(mg_d14.textContent) && /Arc will keep trying/.test(mg_d14.textContent) && mg_w14.document.getElementById("feSyncChoice0").textContent.trim() === "OK" && !mg_w14.document.getElementById("feSyncChoice1") && !!mg_d14.querySelector(".pb-sent") && mg_w14.eval("connection") === "problem" && mg_w14.eval("limitWait.active && limitWait.reason") === "short" && !/no longer in Spotify/.test(mg_d14.textContent));
  check("the strip says Arc is waiting for all the playlists, with the time to the next try", !mg_w14.document.getElementById("waitStrip").hidden && /^Waiting for all your playlists · 0:(2\d|30)$/.test(mg_w14.document.getElementById("waitStripText").textContent), mg_w14.document.getElementById("waitStripText").textContent);
  check("the first tries come after 30 s, 2 min and 10 min, then every 10 min", mg_w14.eval("SHORT_LIST_RETRY_MS").join() === "30000,120000,600000" && Math.abs(mg_w14.eval("limitWait.retryAt") - Date.now() - 30000) < 3000);
  mg_w14.document.getElementById("feSyncChoice0").click();
  await new Promise((r) => setTimeout(r, 300));
  check("while waiting nothing is written to Spotify: no save, no new save, no removal", mg_o14.writes.length === 0, JSON.stringify(mg_o14.writes));
  mg_w14.eval("retryAfterLimit()");
  await new Promise((r) => setTimeout(r, 300));
  await waitFor(() => mg_w14.eval("connection") === "problem", 12000);
  check("a try that comes short again waits longer, and the popup is not shown again", Math.abs(mg_w14.eval("limitWait.retryAt") - Date.now() - 120000) < 8000 && !mg_w14.document.getElementById("feSyncDialog"));
  mg_o14.emptyFirstPages = 0;
  mg_w14.eval("retryAfterLimit()");
  await waitFor(() => mg_w14.eval("connection") === "ready", 12000);
  await mg_settled(mg_w14);
  check("when all of it arrives the wait ends, the strip goes, it says so, and saving goes on with no question and no new save", !mg_w14.eval("limitWait.active") && mg_w14.document.getElementById("waitStrip").hidden && !mg_w14.document.getElementById("feSyncDialog") && mg_o14.writes.filter((x) => x.type === "create").length === 0 && /All your playlists arrived/.test(capText(mg_w14)), capText(mg_w14));
  var mg_m14 = (mg_o14.sharing && mg_o14.sharing.messages) || [];
  check("Arc reports by itself that the whole list arrived, how long after and after how many short reads, and forgets the mark", mg_m14.length === 2 && /^Sent by Arc after a short playlist list: the whole playlist list arrived \(\d+ of \d+\), 0 min after it first came short, with 2 short reads before; the same visit$/.test(mg_m14[1].message) && mg_m14[1].auto === true && !mg_w14.localStorage.getItem("shortListSince"), JSON.stringify(mg_m14.map((m) => m.message)));

  // Spotify sends null for playlists it will not show the app (its own), and its total counts them: the list is whole, Arc connects (937 of 941, 2026-11-15)
  var mg_o15 = { descStore: {}, nameStore: {}, emptyFirstPages: 0, extraPlaylists: [null, ...mg_o13Saves, null] };
  var mg_w15 = await mg_go({ formats: mg_text(mg_item("f1", "Alpha", 2, 30), mg_item("f2", "Beta", 1, 40)), spotifySynced: JSON.stringify({ f1: { rev: 2, playlistId: "s1" }, f2: { rev: 1, playlistId: "s2" } }) }, mg_o15);
  await mg_settled(mg_w15);
  var mg_lr15 = JSON.parse(mg_w15.localStorage.getItem("listReads") || "[]").pop() || {};
  check("playlists Spotify sends as null count as arrived: Arc connects with no wait or question, leaves them out of the list, and records how many and where", mg_w15.eval("connection") === "ready" && !mg_w15.eval("limitWait.active") && !mg_w15.document.getElementById("feSyncDialog") && mg_lr15.hidden === 2 && mg_lr15.count === mg_lr15.total - 2 && /2 hidden by Spotify/.test(mg_w15.limitRecordText()), JSON.stringify({ c: mg_w15.eval("connection"), lr: mg_lr15 }));

  // Spotify leaves playlists out of its pages (the ones it will not show the app) though its total counts them: the same page twice is taken, Arc connects (939 of 943, 2026-11-15)
  var mg_o16 = { descStore: {}, nameStore: {}, emptyFirstPages: 0, leaveOut: ["hid1", "hid2"], extraPlaylists: [mg_pl("hid1", "Discover Weekly", ""), mg_o13Saves[0], mg_pl("hid2", "Daily Mix 1", ""), mg_o13Saves[1]] };
  var mg_w16 = await mg_go({ formats: mg_text(mg_item("f1", "Alpha", 2, 30), mg_item("f2", "Beta", 1, 40)), spotifySynced: JSON.stringify({ f1: { rev: 2, playlistId: "s1" }, f2: { rev: 1, playlistId: "s2" } }) }, mg_o16);
  await waitFor(() => mg_w16.eval("connection") !== "connecting", 12000);
  await mg_settled(mg_w16);
  var mg_lr16 = JSON.parse(mg_w16.localStorage.getItem("listReads") || "[]").pop() || {};
  check("pages Spotify sends short the same way twice are taken as its answer: Arc connects with no wait or question, and records how many were left out", mg_w16.eval("connection") === "ready" && !mg_w16.eval("limitWait.active") && !mg_w16.document.getElementById("feSyncDialog") && mg_lr16.leftOut === 2 && mg_lr16.count === mg_lr16.total - 2 && /2 left out by Spotify/.test(mg_w16.limitRecordText()), JSON.stringify({ c: mg_w16.eval("connection"), lr: mg_lr16 }));

  // each read of a page misses a different playlist (a slip, not Spotify's answer): the reads are joined, and the page is whole
  var mg_n17 = 0;
  var mg_o17 = { descStore: {}, nameStore: {}, emptyFirstPages: 0, leaveOut: (offset) => (offset === 4 ? [(mg_n17++ % 2) ? "s1" : "p5"] : []), extraPlaylists: [mg_o13Saves[0], mg_o13Saves[1]] };
  var mg_w17 = await mg_go({ formats: mg_text(mg_item("f1", "Alpha", 2, 30), mg_item("f2", "Beta", 1, 40)), spotifySynced: JSON.stringify({ f1: { rev: 2, playlistId: "s1" }, f2: { rev: 1, playlistId: "s2" } }) }, mg_o17);
  await waitFor(() => mg_w17.eval("connection") !== "connecting", 12000);
  await mg_settled(mg_w17);
  var mg_lr17 = JSON.parse(mg_w17.localStorage.getItem("listReads") || "[]").pop() || {};
  check("a page whose reads each miss a different playlist is joined from them: Arc connects with every playlist, none taken as left out", mg_w17.eval("connection") === "ready" && mg_lr17.count === mg_lr17.total && mg_lr17.leftOut === 0 && /joined from reads/.test(JSON.stringify(mg_lr17.pages)) && mg_o17.writes.filter((x) => x.type === "create").length === 0, JSON.stringify({ c: mg_w17.eval("connection"), lr: mg_lr17 }));
  // Spotify cannot send certain slots for a while and empties every page holding one (2026-11-16): an empty page is read in pieces, a slot still empty
  // alone is left out, the save and the recipe playlist the list lacks are read by ID and put back, and Arc reports it once
  var mg_o18 = { descStore: {}, nameStore: {}, emptyFirstPages: 0, unreadableIds: ["p2", "s1"], extraPlaylists: [mg_o13Saves[0], mg_o13Saves[1]] };
  var mg_w18 = await mg_go({ formats: mg_text(mg_item("f1", "Alpha", 2, 30), mg_item("f2", "Beta", 1, 40)), spotifySynced: JSON.stringify({ f1: { rev: 2, playlistId: "s1" }, f2: { rev: 1, playlistId: "s2" } }) }, mg_o18);
  await waitFor(() => mg_w18.eval("connection") !== "connecting", 12000);
  await mg_settled(mg_w18);
  var mg_lr18 = JSON.parse(mg_w18.localStorage.getItem("listReads") || "[]").pop() || {};
  var mg_m18 = ((mg_o18.sharing && mg_o18.sharing.messages) || []).map((m) => m.message);
  check("an empty page is read in pieces: Arc connects with no wait or question, the unreadable slots recorded", mg_w18.eval("connection") === "ready" && !mg_w18.eval("limitWait.active") && !mg_w18.document.getElementById("feSyncDialog") && mg_lr18.unreadable === 2 && /empty, split/.test(JSON.stringify(mg_lr18.pages)), JSON.stringify({ c: mg_w18.eval("connection"), lr: mg_lr18 }));
  check("the records name the playlists on either side of each unreadable slot, by ID", JSON.stringify(mg_lr18.unreadableAround) === JSON.stringify([[1, 1, "p1", "p3"], [5, 5, "p5", "s2"]]), JSON.stringify(mg_lr18.unreadableAround));
  check("the save and the recipe playlist the list lacks are read by ID and put back: no new save, both in the playlists", mg_o18.writes.filter((x) => x.type === "create").length === 0 && mg_w18.eval("playlists.some((p) => p.id === 's1' && p.isSave) && playlists.some((p) => p.id === 'p2')") && (mg_o18.entryReads || []).sort().join() === "p2,s1", JSON.stringify(mg_o18.entryReads));
  check("Arc reports it once, when all of it is done, with the slots, the requests and what was read back", mg_m18.length === 1 && /^Sent by Arc: Spotify sent empty pages of the playlist list, and Arc read them again in smaller pieces: 2 slots of 7 unreadable \(at \[1,5\]\), 2 empty pages read in \d+ requests in pieces in [\d.]+ s \(slowest request [\d.]+ s\), the whole list in [\d.]+ s; read back by ID: 2 of 2 \(1 saves, 1 recipe playlists, 0 not found, 0 failed\)$/.test(mg_m18[0]), JSON.stringify(mg_m18));

  // every page empty is everything failing, not a few slots: the list stays short, Arc waits as before, and the report says the pieces were tried
  var mg_o19 = { descStore: {}, nameStore: {}, emptyFirstPages: 0, allEmpty: true, extraPlaylists: [mg_o13Saves[0], mg_o13Saves[1]] };
  var mg_w19 = await mg_go({ formats: mg_text(mg_item("f1", "Alpha", 2, 30), mg_item("f2", "Beta", 1, 40)), spotifySynced: JSON.stringify({ f1: { rev: 2, playlistId: "s1" }, f2: { rev: 1, playlistId: "s2" } }) }, mg_o19);
  await waitFor(() => !!mg_w19.document.getElementById("feSyncDialog"), 12000);
  var mg_m19 = ((mg_o19.sharing && mg_o19.sharing.messages) || []).map((m) => m.message);
  check("every page empty leaves the list short: Arc waits for all of it, and the report shows the pieces were tried", mg_w19.eval("connection") === "problem" && mg_w19.eval("limitWait.active && limitWait.reason") === "short" && mg_o19.writes.length === 0 && mg_m19.length === 1 && /empty pages read in pieces/.test(mg_m19[0]), JSON.stringify(mg_m19));

  // Spotify sends the whole list as 0 of 0 (2026-11-16): with saves known here it counts as short, never as every save gone; with nothing known it is a new account
  var mg_o20 = { descStore: {}, nameStore: {}, zeroList: true, extraPlaylists: [mg_o13Saves[0], mg_o13Saves[1]] };
  var mg_w20 = await mg_go({ formats: mg_text(mg_item("f1", "Alpha", 2, 30), mg_item("f2", "Beta", 1, 40)), spotifySynced: JSON.stringify({ f1: { rev: 2, playlistId: "s1" }, f2: { rev: 1, playlistId: "s2" } }) }, mg_o20);
  await waitFor(() => mg_w20.eval("limitWait.active"), 12000);
  var mg_m20 = ((mg_o20.sharing && mg_o20.sharing.messages) || []).map((m) => m.message);
  check("a list of 0 of 0 while saves are known here counts as short: Arc waits, asks nothing about the saves, writes nothing, and reports it", mg_w20.eval("connection") === "problem" && mg_w20.eval("limitWait.reason") === "short" && mg_o20.writes.length === 0 && JSON.parse(mg_w20.localStorage.getItem("syncAsks") || "[]").length === 0 && mg_m20.length === 1 && /listed 0 of 0 playlists, while this device knows 2 saves/.test(mg_m20[0]), JSON.stringify({ m: mg_m20, w: mg_o20.writes.length }));
  var mg_o21 = { descStore: {}, nameStore: {}, zeroList: true, extraPlaylists: [] };
  var mg_w21 = await mg_go({}, mg_o21);
  await waitFor(() => mg_w21.eval("connection") !== "connecting", 12000);
  check("a list of 0 of 0 with nothing known here is a new account's: Arc connects", mg_w21.eval("connection") === "ready" && !mg_w21.eval("limitWait.active"), mg_w21.eval("connection"));

  // a request of the reading in pieces that stalls ends it: the rest is left unread, so the list is short and Arc waits as usual
  var mg_o22 = { descStore: {}, nameStore: {}, emptyFirstPages: 0, unreadableIds: ["p2"], listDelayMs: 250, stallMs: 150, extraPlaylists: [mg_o13Saves[0], mg_o13Saves[1]] };
  var mg_w22 = await mg_go({ formats: mg_text(mg_item("f1", "Alpha", 2, 30), mg_item("f2", "Beta", 1, 40)), spotifySynced: JSON.stringify({ f1: { rev: 2, playlistId: "s1" }, f2: { rev: 1, playlistId: "s2" } }) }, mg_o22);
  await waitFor(() => mg_w22.eval("limitWait.active"), 15000);
  var mg_m22 = ((mg_o22.sharing && mg_o22.sharing.messages) || []).map((m) => m.message);
  check("a stalled request in the pieces leaves the list short: Arc waits, writes nothing, and the report says it stalled", mg_w22.eval("limitWait.reason") === "short" && mg_o22.writes.length === 0 && mg_m22.length === 1 && /:true/.test(mg_m22[0]), JSON.stringify(mg_m22));
  // a list still short keeps its counts and short reads as the error a report carries, though the message is caught further up
  mg_w14.eval("recordError('Spotify listed 5 of 9 playlists, after reading again; short reads [offset, items] [[0,0]]')");
  mg_w14.eval("recordError(\"Spotify didn\u2019t send all your playlists.\")");
  check("the bare short-list message does not replace the counted one in a report", /^Spotify listed 5 of 9/.test(mg_w14.eval("reportDetails().lastError")), mg_w14.eval("reportDetails().lastError"));

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
  check("the privacy text says that each recipe is kept in a private playlist's description in the person's own Spotify", /<b>In your <span data-service>Spotify<\/span>:<\/b> your recipes, in <span data-only="spotify">private<\/span><span data-only="tidal" hidden>unlisted<\/span> playlists\./.test(sw_html) && !/back up by hand/.test(sw_html));
  var sw_s = await boot({ url: EDURL, session: signedIn(), local: { backupMode: "spotify" }, fetchOptions: {} });
  check("Sign out and clear data says the recipes stay in Spotify and come back when connecting again, and does not mention a file", /Your recipes stay in Spotify/.test(sw_s.document.getElementById("clearRestoreHelp").textContent) && /come back when you connect again/.test(sw_s.document.getElementById("clearRestoreHelp").textContent) && !/restore from a backup|Restore in/.test(sw_s.document.getElementById("clearRestoreHelp").textContent));
  } catch (err) { areaCrashed("spotify wording", err); } }


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
  // the app page: a recipe's Build button is the Connect button
  var cs_m = await boot({ url: EDURL, local: { formats: MINI, connectedBefore: "1", clientId: "client-1" }, fetchOptions: {} });
  var cs_b = () => cs_m.document.querySelector("#bhRecipes .bh-build");
  check("on the app page, with no sign-in, a recipe's Build button says Connect to Spotify", !!cs_b() && cs_b().getAttribute("aria-label") === "Connect to Spotify" && !cs_b().disabled);
  cs_b().click();
  await new Promise((r) => setTimeout(r, 100));
  var cs_ms = cs_m.sessionStorage.getItem("pkceState");
  cs_b().click();
  await new Promise((r) => setTimeout(r, 50));
  check("pressing it starts the sign-in, and a second press does not start another over it", !!cs_ms && cs_m.sessionStorage.getItem("pkceState") === cs_ms, JSON.stringify([cs_ms, cs_m.sessionStorage.getItem("pkceState")]));
  // the way back from Spotify, while the sign-in is being finished over a slow connection
  var cs_r = await boot({ url: "http://127.0.0.1:8000/?code=abc123&state=st1", session: { pkceState: "st1", pkceVerifier: "v" }, local: { clientId: "client-1" }, fetchOptions: { tokenDelayMs: 4000 } });
  check("coming back from Spotify, the button already says Connecting\u2026 while the sign-in is finished, and cannot be pressed", cs_label(cs_r, "connect") === "Connecting\u2026" && cs_r.document.getElementById("connect").disabled && /Finishing the sign-in/.test(cs_r.document.getElementById("loginMessage").textContent));
  check("on the way back, the line saying the sign-in is being finished is not red either", cs_r.document.getElementById("loginMessage").className === "muted");
  var cs_rm = await boot({ url: "http://127.0.0.1:8000/?code=abc123&state=st1", session: { pkceState: "st1", pkceVerifier: "v" }, local: { formats: MINI, minimalMode: "1", connectedBefore: "1", clientId: "client-1" }, fetchOptions: { tokenDelayMs: 4000 } });
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

  if (want("launch screen")) { try {
  // ================================================================ the launch screen (an iPhone's Home Screen app)
  var ls_html = fs.readFileSync(ROOT + "index.html", "utf8");
  check("the <head> script puts the launch screen up from the first paint, only on the app page of a Home Screen app (or after the DEV menu's Launch screen) and not over the connecting screen or the update card", /if \(page === "app" && \(navigator\.standalone === true \|\| \(window\.matchMedia && matchMedia\("\(display-mode: standalone\)"\)\.matches\) \|\| sessionStorage\.getItem\("launchTest"\)\) && !cls\.contains\("connecting"\) && !cls\.contains\("updating"\)\) cls\.add\("launching"\);/.test(ls_html));
  var ls_links = Array.from(ls_html.matchAll(/<link rel="apple-touch-startup-image" media="\(device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d)\) and \(orientation: portrait\) and \(prefers-color-scheme: (dark|light)\)" href="(splash\/[^"]+)">/g));
  var ls_sizes = JSON.parse(fs.readFileSync(ROOT + "splash/sizes.json", "utf8"));
  check("the page's plain background comes first in <head>, before any script, so dark mode does not flash white", /^<!doctype html>\n<html lang="en">\n<head>\n<meta name="color-scheme" content="light dark">\n<style>html \{ background: #ffffff; \} @media \(prefers-color-scheme: dark\) \{ html \{ background: #151517; \} \}<\/style>/.test(ls_html));
  check("a page that did not start is never hidden behind it", /pageStart\.show = function \(detail\) \{\n    document\.documentElement\.classList\.remove\("launching"\);/.test(ls_html));
  var ls_w = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1", backupMode: "manual" }, before: (w) => w.document.documentElement.classList.add("launching") });
  var ls_d = ls_w.document;
  check("it shows home's band (icon, name, tagline) and the step under way, home's own band hidden behind it", ls_d.documentElement.classList.contains("launching") && ls_d.querySelector("#launchScreen .ls-band.wp-band .wp-band-icon") && ls_d.querySelector("#launchScreen .wp-band-name").textContent === "Arc" && ls_d.querySelector("#launchScreen .wp-band-tag").textContent === ls_d.querySelector("#homePage .hp-band .wp-band-tag").textContent && /html\.launching #homePage \.hp-band \{ visibility: hidden; \}/.test(ls_html) && /Spotify|playlists|playlist builder/.test(ls_d.getElementById("lsStep").textContent), ls_d.getElementById("lsStep").textContent);
  await waitFor(() => ls_d.getElementById("launchScreen").classList.contains("ls-ready"), 20000);
  check("once signed in, the playlists read and Python started, the spinner gives way to a check and Ready, still on the launch screen", ls_w.eval("connection") === "ready" && ls_d.getElementById("lsStep").textContent === "Ready" && ls_d.documentElement.classList.contains("launching") && ls_w.getComputedStyle(ls_d.querySelector("#launchScreen .ls-spin")).display === "none");
  await waitFor(() => !ls_d.documentElement.classList.contains("launching"), 5000);
  check("then the band glides up to home's band and home's parts rise in turn", ls_d.getElementById("launchScreen").classList.contains("ls-glide") || ls_d.documentElement.classList.contains("ls-arrive") || !ls_d.documentElement.classList.contains("launching"));
  check("then it gives way to the app", !ls_d.documentElement.classList.contains("launching") && ls_w.eval("connection") === "ready" && ls_w.eval("launchScreen") === false && ls_d.documentElement.classList.contains("page-app"));
  var ls_n = await boot({ url: EDURL, session: {}, local: { formats: MINI, connectedBefore: "1", backupMode: "manual" }, before: (w) => w.document.documentElement.classList.add("launching") });
  await new Promise((r) => setTimeout(r, 900));
  check("with no sign-in it goes as soon as that is known, without Ready, so the app can say what to do", ls_n.eval("launchScreen") === false && !ls_n.document.documentElement.classList.contains("launching") && ls_n.document.getElementById("lsStep").textContent !== "Ready");
  var ls_q = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1", backupMode: "manual" }, before: (w) => w.document.documentElement.classList.add("launching") });
  ls_q.eval('askSyncChoice("A question", "Text", [{ label: "OK", value: "ok" }])');
  check("a question takes it down at once", ls_q.eval("launchScreen") === false);
  var ls_b = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1", backupMode: "manual" } });
  check("in a browser tab there is no launch screen", ls_b.eval("launchScreen") === false && !ls_b.document.documentElement.classList.contains("launching"));
  var ls_t = ls_w.document.querySelectorAll("#devMenu [data-launch]");
  check("the DEV menu's Launch screen plays it in any tab (Play, or Slow at a third of the speed), its mark used once", ls_t.length === 2 && ls_t[0].dataset.launch === "1" && ls_t[1].dataset.launch === "slow" && /sessionStorage\.setItem\("launchTest", button\.dataset\.launch\)/.test(appJs) && /sessionStorage\.getItem\("launchTest"\) === "slow" \? 3 : 1; sessionStorage\.removeItem\("launchTest"\)/.test(appJs));
  } catch (err) { areaCrashed("launch screen", err); }
}

  if (want("connecting screen")) { try {
  // ================================================================ back from Spotify's sign-in: a quiet screen until the editor is ready
  var cn_html = fs.readFileSync(ROOT + "index.html", "utf8");
  check("the page's first script puts up the connecting screen, and picks the app page, when the address has a sign-in code from Spotify", /code=\/\.test\(location\.search\)\) \{ page = "app"; document\.documentElement\.classList\.add\("connecting"\)/.test(cn_html));
  var cn_steps = Array.from(cn_html.matchAll(/<li id="(cn\w+)" class="cn-step[^"]*"><span class="cn-mark"><svg[^>]*>.*?<\/svg><\/span><span>(.+?)<\/span><\/li>/g)).map((m) => m[1] + ": " + m[2].replace(/<span id="cnSlow" class="cn-slow"><\/span>/, "").replace(/<span data-service>(\w+)<\/span>/g, "$1"));
  check("the connecting screen has the setup page's band, the line to Spotify with a spinner in its middle, Connecting to Spotify, and four steps in order", /<div id="connectingScreen" role="status">\s*<div class="cn-page">\s*<div class="wp-band">/.test(cn_html) && /<div class="wp-joint cn-joint" aria-hidden="true">[\s\S]{0,400}<span class="wp-ok cn-mid">/.test(cn_html) && /<h2 class="cn-title cn-working">Connecting to <span data-service>Spotify<\/span><\/h2>/.test(cn_html) && JSON.stringify(cn_steps) === JSON.stringify(["cnSignin: Signing in to Spotify", "cnPlaylists: Reading your playlists", "cnRecipes: Loading your recipes", "cnPython: Starting the playlist builder"]), JSON.stringify(cn_steps));
  check("signing in and starting Python are under way from the first moment; the other two wait", /id="cnSignin" class="cn-step cn-active"/.test(cn_html) && /id="cnPython" class="cn-step cn-active"/.test(cn_html) && /id="cnPlaylists" class="cn-step"/.test(cn_html) && /id="cnRecipes" class="cn-step"/.test(cn_html));
  check("the screen sits below the startup problem popup, so a page that cannot start still says so", /#connectingScreen \{[^}]*z-index: 1500/.test(cn_html) && /#startupProblem \{ z-index: 2000/.test(cn_html));
  check("with reduced motion nothing turns or fades", /prefers-reduced-motion: reduce\) \{ #connectingScreen, \.cn-step \{ transition: none; \} \.cn-active \.cn-mark::before, \.cn-mid::before \{ animation: none; \} #connectingScreen\.cn-finished \.cn-finish, #connectingScreen\.cn-finished \.cn-go \{ animation: none; \} \}/.test(cn_html));
  var cn_on = (w) => w.document.documentElement.classList.contains("connecting");
  var cn_back = { url: "http://127.0.0.1:8000/?code=abc123&state=st1", session: { pkceState: "st1", pkceVerifier: "v" }, before: (w) => w.document.documentElement.classList.add("connecting") };
  var cn_w = await boot({ ...cn_back, local: { clientId: "client-1", setupStarted: "1", formats: MINI, backupMode: "spotify" }, fetchOptions: { tokenDelayMs: 2500 }, view: "home" });
  check("while the sign-in is finished, the connecting screen is up and the page under it is the app, not the setup page", cn_on(cn_w) && cn_w.document.documentElement.classList.contains("page-app") && !cn_w.document.documentElement.classList.contains("page-setup"));
  var cn_state = (w) => ["Signin", "Playlists", "Recipes", "Python"].map((s) => w.document.getElementById("cn" + s).className.replace("cn-step", "").trim() || "waiting").join(",");
  check("meanwhile Python is ready and ticked, the sign-in still turns, and the playlists and recipes wait", cn_state(cn_w) === "cn-active,waiting,waiting,cn-done", cn_state(cn_w));
  await waitFor(() => cn_w.document.getElementById("connectingScreen").classList.contains("cn-finished"), 15000);
  check("the first time, with every step ticked, the screen stays and says Setup complete! with Continue", cn_on(cn_w) && cn_state(cn_w) === "cn-done,cn-done,cn-done,cn-done" && cn_w.document.querySelector("#connectingScreen h2.cn-finish").textContent === "Setup complete!" && cn_w.document.getElementById("cnContinue").textContent.trim() === "Continue", cn_state(cn_w));
  check("when setup is complete the line goes solid and a pink check joins Arc and Spotify; Continue sits on the right like Next", /#connectingScreen\.cn-finished \.wp-wire path \{ stroke-dasharray: none; animation: none; \}/.test(cn_html) && /#connectingScreen\.cn-finished \.cn-mid svg \{ display: block; \}/.test(cn_html) && /#cnContinue \{ grid-column: 2;/.test(cn_html));
  await new Promise((r) => setTimeout(r, 800));
  check("it waits for the button", cn_on(cn_w));
  cn_w.document.getElementById("cnContinue").click();
  await waitFor(() => !cn_on(cn_w), 3000);
  check("by the time the screen goes, every step is ticked", cn_state(cn_w) === "cn-done,cn-done,cn-done,cn-done", cn_state(cn_w));
  check("the screen goes once everything is ready: connected, the recipes saved to Spotify, Python running", cn_w.eval("connection") === "ready" && cn_w.eval("saveState.savedAt") !== null && !cn_w.eval("saveState.running") && /ready$/.test(cn_w.document.getElementById("pythonStatus").textContent));
  check("and Arc's home is what is left, where the person picks a tool", cn_w.document.documentElement.classList.contains("page-app") && cn_w.document.documentElement.classList.contains("view-home") && !cn_w.document.documentElement.classList.contains("view-builder"));
  // reading the playlists taking longer than usual says so under its step, and the line goes when it is done
  var cn_sl = await boot({ ...cn_back, local: { clientId: "client-1", setupStarted: "1", formats: MINI }, fetchOptions: { listDelayMs: 400, slowReadingMs: 150 } });
  await waitFor(() => !!cn_sl.document.getElementById("cnSlow").textContent, 8000);
  check("a slow reading of the playlists says so under its step while it goes on", cn_sl.document.getElementById("cnSlow").textContent === "Spotify is slow to answer. Still working." && cn_sl.document.getElementById("cnPlaylists").className === "cn-step cn-active" && cn_sl.getComputedStyle(cn_sl.document.getElementById("cnSlow")).display === "block", cn_sl.document.getElementById("cnSlow").textContent);
  await waitFor(() => cn_sl.document.getElementById("cnPlaylists").className === "cn-step cn-done", 12000);
  check("once the playlists are read the slow line goes", cn_sl.document.getElementById("cnSlow").textContent === "", cn_sl.document.getElementById("cnSlow").textContent);
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
  check("the failed mark is the usual error mark, a white ! in a pink circle", /\.cn-failed \.cn-mark::before \{ border: none; background: var\(--accent\); \}/.test(cn_html) && /\.cn-failed \.cn-mark::after \{ content: "!";[^}]*color: #fff/.test(cn_html));
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
  check("Setup complete has no motion under reduced motion", /#connectingScreen\.cn-finished \.cn-finish, #connectingScreen\.cn-finished \.cn-go \{ animation: none; \}/.test(cn_html));
  // no sign-in code: no screen, and nothing waits for it
  var cn_n = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1" } });
  check("an ordinary visit has no connecting screen", !cn_on(cn_n) && cn_n.document.documentElement.classList.contains("page-app"));
  } catch (err) { areaCrashed("connecting screen", err); } }




  if (want("notice line")) { try {
  // ================================================================ the line under the bar: music total, news in turn, trouble that stays
  var nl_fmt = 'FORMATS = {"f1": {"title": "Alpha", "name": "Alpha {n}", "silence between segments": "30 sec", "segments": [("💗 spacious + gentle [id:p2]", 30)]}}';
  var nl_go = async (extra) => {
    const w = await boot({ url: EDURL, session: signedIn(), local: Object.assign({ formats: nl_fmt, backupMode: "spotify", connectedBefore: "1" }, extra || {}), fetchOptions: { descStore: {}, nameStore: {} } });
    await waitFor(() => !w.eval("saveState.running") && !w.eval("saveState.timer") && w.eval("saveState.savedAt") !== null, 8000);
    await new Promise((r) => setTimeout(r, 150));
    w.eval("noticeTiming.quietMs = 120; noticeTiming.baseMs = 300; noticeTiming.pauseMs = 500; spotifySaveDelayMs = 60000");
    // a message about something just done, as the page's actions send it (held when it has something to do or says something went wrong)
    w.eval('window.testSay = function (text, undo = false, link = null, warn = false) { const actions = []; if (link) actions.push({ label: link.label, run: link.onClick }); if (undo) actions.push({ label: "Undo", run: () => {} }); showNotices([{ text, icon: warn ? "alert" : "device", warn, hold: warn || actions.length > 0, actions, transient: true }]); }');
    return w;
  };
  var nl_w = await nl_go();
  var nl_cap = () => nl_w.document.getElementById("feCaption");
  var nl_sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  check("with nothing to say, the line shows how long the format is, as before", /minutes? of music/.test(capText(nl_w)) && !nl_cap().classList.contains("fe-notice"));
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
  check("a save that failed shows as an error (pink, with the !), with its link, and the menu button does not get a dot for it", /Couldn.t save to Spotify\./.test(capText(nl_w)) && nl_cap().classList.contains("fe-notice-warn") && capLinks(nl_w).some((b) => b.textContent === "Try again") && !nl_w.document.getElementById("feAppMenuButton").classList.contains("fe-alert") && nl_w.document.getElementById("feAppMenuButton").getAttribute("aria-label") === "App menu");
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
  check("pressing the count shows the next", /Huge is too long to save to Spotify/.test(capText(nl_w)) && /\(2 of 2\)/.test(capText(nl_w)));
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
  check("a format too long to save says so, with an OK and no download", /Huge is too long to save to Spotify/.test(capText(nl_w)) && !capLinks(nl_w).some((b) => b.textContent === "Download it") && capLinks(nl_w).some((b) => b.textContent === "OK"));
  nl_w.eval('saveState.tooLong = []; renderSaveStatus()');
  // the record in the menu, and the page
  nl_w.eval('saveState.lastNews = { text: "Updated \\u2068TEST\\u2069 from Spotify.", at: Date.now() }; renderSaveStatus()');
  nl_w.eval('saveState.unread = 1; renderSaveStatus()');
  check("the line in the page has only how the saving is going, and nothing of the trouble", !/could not be read|Updated/.test(nl_w.document.getElementById("spotifySaveStatus").textContent) && /Last saved at|Saving to Spotify/.test(nl_w.document.getElementById("spotifySaveStatus").textContent));
  nl_w.eval('saveState.unread = 0; renderSaveStatus()');
  // the sentences
  check("news is one sentence for each kind: one name, two names, or a count", nl_w.eval('newsText("Added", ["A"])') === "Added \u2068A\u2069 from Spotify." && nl_w.eval('newsText("Updated", ["A", "B"])') === "Updated \u2068A\u2069 and \u2068B\u2069 from Spotify." && nl_w.eval('newsText("Added", ["A", "B", "C"])') === "Added 3 recipes from Spotify." && nl_w.eval('newsText("Added", [" "])') === "Added \u2068Untitled\u2069 from Spotify.");
  // what the person has just done: held when there is something to do or something went wrong, in turn otherwise
  nl_w.eval('testSay("Restored 2 formats from x.txt.", true)');
  check("a message with an Undo is held in the line, with the Undo and an OK", /Restored 2 formats from x\.txt\./.test(capText(nl_w)) && capLinks(nl_w).some((b) => b.textContent === "Undo") && capLinks(nl_w).some((b) => b.textContent === "OK") && !nl_cap().classList.contains("fe-notice-warn"));
  await nl_sleep(900);
  check("and it stays, since there is something to do", /Restored 2 formats/.test(capText(nl_w)));
  capLinks(nl_w).find((b) => b.textContent === "OK").click();
  check("OK puts it away", /minutes? of music/.test(capText(nl_w)));
  nl_w.eval('testSay("Restored 2 formats from x.txt.", true)');
  nl_w.document.body.click();
  rowsOf(nl_w)[0].querySelector(".fe-inc").click();
  await nl_sleep(250);
  check("editing puts it away, as the Undo would now overwrite the edit", !/Restored 2 formats/.test(capText(nl_w)) && !capLinks(nl_w).some((b) => b.textContent === "Undo"));
  nl_w.eval('testSay("Held through a heal.", false, { label: "Do it", onClick: () => { window.__linkRan = true; } })');
  nl_w.eval('commitHealed()');
  check("names and IDs filled in by the app are not an edit, so they do not put it away", /Held through a heal\./.test(capText(nl_w)));
  capLinks(nl_w).find((b) => b.textContent === "Do it").click();
  check("pressing its link does it, and puts the message away", nl_w.eval("window.__linkRan") === true && !/Held through a heal/.test(capText(nl_w)));
  nl_w.eval('testSay("It went wrong: because.", false, null, true)');
  check("one that says something went wrong is an error, and held, with an OK", nl_cap().classList.contains("fe-notice-warn") && /It went wrong/.test(capText(nl_w)) && capLinks(nl_w).some((b) => b.textContent === "OK"));
  await nl_sleep(500);
  check("it stays until it is put away", /It went wrong/.test(capText(nl_w)));
  nl_w.eval('showNotices(["News behind it."])');
  check("news waits behind a held message", !/News behind it/.test(capText(nl_w)));
  capLinks(nl_w).find((b) => b.textContent === "OK").click();
  check("and comes once it is gone", /News behind it\./.test(capText(nl_w)));
  await nl_sleep(450);
  nl_w.eval('testSay("Copied to this device. Find the file in Downloads, or in the Files app on a phone.")');
  check("a plain message is shown for a while, with the device icon", /^Copied to this device\. Find the file in Downloads, or in the Files app on a phone\.$/.test(capText(nl_w)) && !capLinks(nl_w).some((b) => b.textContent === "OK"));
  await nl_sleep(1200);
  check("a long one stays longer than a short one", /Copied to this device/.test(capText(nl_w)));
  await nl_sleep(2200);
  check("and then the total returns", /minutes? of music/.test(capText(nl_w)));
  nl_w.eval('testSay("First thing done.")');
  nl_w.eval('testSay("Second thing done.")');
  check("what was just done replaces what was said about the one before, so old action messages never queue up", /Second thing done\./.test(capText(nl_w)) && !/\(1 of 2\)/.test(capText(nl_w)) && nl_w.eval("notices.batch.length") === 1);
  await nl_sleep(2700);
  // in minimalist mode too
  var nl_m = await nl_go({ minimalMode: "1" });
  nl_m.eval('testSay("Copied to this device. Find the file in Downloads, or in the Files app on a phone.")');
  nl_m.eval('noticeTiming.baseMs = 100');
  nl_m.eval('testSay("Short one.")');
  await new Promise((r) => setTimeout(r, 400));
  check("and when there is nothing more to say, the line goes back to the minutes of music and silence", /minutes? of music/.test(capText(nl_m)) && !nl_m.document.getElementById("feCaption").classList.contains("fe-notice"));
  nl_w.eval('saveState.unread = 4; renderSaveStatus()');
  check("trouble that has not been put away shows", /4 recipes saved in Spotify could not be read/.test(capText(nl_w)));
  nl_w.eval('testSay("Just done.")');
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
  await waitFor(() => sr_ready.eval("connection") === "ready", 15000);
  sr_ready.document.getElementById("feAppMenuButton").click();
  sr_ready.document.body.click();
  sr_ready.eval("window.__go = []"); sr_ready.eval("startLogin = (o) => { window.__go.push(o); }");
  sr_ready.document.getElementById("changeSpotifyLogin").click();
  check("Change Spotify login in More options starts a sign-in that lets another account be chosen", sr_ready.eval("window.__go.length") === 1 && sr_ready.eval("window.__go[0].switchAccount") === true);
  var sr_sw = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1", spotifyAccount: "someone-else", spotifySynced: '{"x":{"rev":1,"playlistId":"p"}}', spotifyPendingDeletes: '["q"]' }, fetchOptions: {} });
  await waitFor(() => sr_sw.eval("connection") === "ready", 15000);
  check("signed in to a different account, this device forgets what it knew of the old account's saves", sr_sw.localStorage.getItem("spotifyAccount") === "ron" && sr_sw.localStorage.getItem("spotifyAccount") !== "someone-else" && !/"x"/.test(sr_sw.localStorage.getItem("spotifySynced") || "") && !sr_sw.localStorage.getItem("spotifyPendingDeletes"));
  var sr_same = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1" }, fetchOptions: {} });
  await waitFor(() => sr_same.eval("connection") === "ready", 15000);
  check("a device with no record just starts one", sr_same.localStorage.getItem("spotifyAccount") === "ron");
  sr_ready.document.body.click();
  var sr_slow = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1" }, fetchOptions: { listDelayMs: 4000 } });
  sr_slow.document.getElementById("feAppMenuButton").click();
  check("while Spotify is being connected, the menu has the same item, disabled, saying Connecting, with a note for a slow connection, and no Disconnect yet", sr_slow.eval("connection") === "connecting" && sr_slow.document.getElementById("feConnect").disabled && /^Connecting.$/.test(sr_slow.document.getElementById("feConnect").textContent.trim()) && /slow connection/.test(sr_slow.document.getElementById("feConnectionNote").textContent) && !sr_slow.document.getElementById("feDisconnect"));
  var sr_out = await boot({ url: EDURL, local: { formats: MINI, connectedBefore: "1", clientId: "c1" }, fetchOptions: {} });
  sr_out.document.getElementById("feAppMenuButton").click();
  } catch (err) { areaCrashed("spotify row", err); } }

  if (want("version line")) { try {
  // ================================================================ the version, at the bottom of the app menu
  var vl_css = fs.readFileSync(ROOT + "index.html", "utf8");
  var vl_ready = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1" }, fetchOptions: {} });
  vl_ready.document.getElementById("feAppMenuButton").click();
  var vl_menu = vl_ready.document.getElementById("feAppMenuPanel");
  check("the builder's menu ends with the version as a grey line", vl_menu.lastElementChild.id === "feMenuVersion" && vl_menu.lastElementChild.textContent.includes(vl_ready.eval("APP_VERSION")), vl_menu.lastElementChild.id);
  vl_ready.document.body.click();
  var vl_out = await boot({ url: EDURL, local: { formats: MINI, connectedBefore: "1", clientId: "c1" }, fetchOptions: {} });
  vl_out.document.getElementById("feAppMenuButton").click();
  check("and when Spotify is not connected too", vl_out.document.getElementById("feAppMenuPanel").lastElementChild.id === "feMenuVersion");
  vl_out.document.body.click();
  var vl_minimal = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1", minimalMode: "1" }, fetchOptions: {} });
  check("Arc home in the tool's list goes home from Arc's bar", (() => { vl_minimal.document.body.click(); const before = capText(vl_minimal); vl_minimal.document.getElementById("appTool").click(); vl_minimal.document.querySelector('#appToolMenu [data-view="home"]').click(); return vl_minimal.document.documentElement.classList.contains("view-home") && capText(vl_minimal) === before; })());
  } catch (err) { areaCrashed("version line", err); } }

  if (want("sharing card in the editor")) { try {
  // ================================================================ Music sharing shown in the editor: a card under Build, and the playlist picker's last line
  var sc_sh = { words: {}, posts: [], deletes: [], reports: [], shares: ["a", "b", "c", "d"].map((id, i) => ({ id, owner: "other-" + id, name: "Share " + id, by: "Tom", phases: [i], tags: ["piano", "slow", "ambient"], notes: "", songs: [["x" + id, ""]], ms: 3 * 3600000, artists: [], sharedAt: 4000 - i, cover: i < 2 ? "https://i.scdn.co/image/" + id : null })) };
  var sc_w = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1", devMode: "1" }, fetchOptions: { sharing: sc_sh } });
  var sc_d = sc_w.document;
  await waitFor(() => /4 by others/.test(sc_d.getElementById("msCardText").textContent), 8000);
  check("the shared playlist library's card on Arc's home has three lines: its name, Bring some, get some!, and how many playlists others share, the number set apart", sc_d.querySelector("#msCard .hp-text > b").textContent === "Shared playlist library" && sc_d.querySelector("#msCard .hp-tag").textContent === "Bring some, get some!" && sc_d.getElementById("msCardText").textContent === "0 shares by you, 4 by others" && sc_d.querySelectorAll("#msCardText .hp-num")[1].textContent === "4" && !sc_d.querySelector("#msCard img") && !!sc_d.getElementById("msCard").closest("#homePage"));
  check("reading the library for the card starts no overlap reading while the popup is closed", sc_w.eval("sharing.overlap === null && !sharing.reading"));
  check("home's card reads only which shares there are (/counts), not the library itself", sc_sh.countReads >= 1 && !sc_sh.libraryReads && !sc_w.eval("sharing.library"), JSON.stringify([sc_sh.countReads, sc_sh.libraryReads]));
  check("Arc's home, with the card, shows only on the app page's home view, and the builder's parts only in the builder", /html\.page-app\.view-home #homePage \{ display: block; \}/.test(Array.from(sc_d.querySelectorAll("style")).map((x) => x.textContent).join("")) && /html\.page-app:not\(\.view-builder\) #appSection > :is\(#builderHome, #recipePanelWrap, #editorNote, #buildRow/.test(Array.from(sc_d.querySelectorAll("style")).map((x) => x.textContent).join("")));
  check("on connecting, the person's shares are read and kept (none here)", sc_w.localStorage.getItem("sharingMineIds") === "[]");
  var sc_own = { words: {}, posts: [], deletes: [], reports: [], shares: sc_sh.shares.map((x, i) => Object.assign({}, x, i < 2 ? { owner: "ron", playlist: "p" + i } : {})) };
  var sc_o = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1", devMode: "1" }, fetchOptions: { sharing: sc_own } });
  await waitFor(() => /^2 shares by you, 2/.test(sc_o.document.getElementById("msCardText").textContent), 8000);
  check("on a device that has never opened Music sharing, the person's own shares are read once on connecting and counted apart: Y shares by you, Z by others", sc_o.document.getElementById("msCardText").textContent === "2 shares by you, 2 by others" && sc_o.document.querySelectorAll("#msCardText .hp-num").length === 2 && JSON.parse(sc_o.localStorage.getItem("sharingMineIds")).sort().join() === "a,b", sc_o.document.getElementById("msCardText").textContent);
  sc_w.eval("sharing.counts.ids = sharing.counts.ids.slice(0, 2); sharing.mine = [{ id: 'a' }, { id: 'b' }]; renderSharingCard()");
  check("only the person's own: the others' count is still there, at 0", sc_d.getElementById("msCardText").textContent === "2 shares by you, 0 by others");
  sc_w.eval("sharing.counts.ids = []; renderSharingCard()");
  check("none at all: both counts, at 0", sc_d.getElementById("msCardText").textContent === "0 shares by you, 0 by others");
  sc_w.eval("sharing.mine = null; sharing.library = null; sharing.counts = null; renderSharingCard()");
  check("home is layout C: the welcome page's band, Your tools, and the builder's card of three lines, the last saying how many recipes are ready", !!sc_d.querySelector("#homePage > .wp-band .wp-band-icon") && sc_d.querySelector("#homePage .hp-sec").textContent === "Your tools" && sc_d.getElementById("homeRecipes").textContent === "1 recipe ready to build" && sc_d.querySelector("#homeRecipes .hp-num").textContent === "1" && sc_d.querySelector("#homeBuilder .hp-tag").textContent === "Ceremony playlists, ready in seconds" && sc_d.querySelectorAll("#homePage .hp-tool .hp-line").length === 6, sc_d.getElementById("homeRecipes").textContent);
  sc_d.getElementById("formats").value = "RECIPES = {}"; sc_w.eval("syncEditorFromText()");
  sc_d.getElementById("formats").value = MINI; sc_w.eval("syncEditorFromText()");   // the recipe back for the checks that follow
  sc_w.eval("sharing.libraryAt = 0"); await sc_w.eval("loadLibrary()");
  sc_d.getElementById("msCard").click();
  check("the card opens Music sharing as a page of its own on Shared by others, Arc's bar naming it", sc_d.getElementById("msOverlay").hidden === false && sc_w.eval("sharing.tab") === "find" && sc_d.documentElement.classList.contains("view-sharing") && sc_d.getElementById("appTool").textContent === "Shared playlist library");
  check("the bar's icon is now the library's own", !!sc_d.querySelector("#appToolIcon .tool-glyph") && sc_d.querySelector("#appToolIcon .tool-glyph").innerHTML === sc_d.querySelector('#appToolMenu [data-view="sharing"] .tool-glyph').innerHTML);
  sc_d.getElementById("appTool").click();
  sc_d.getElementById("appDevRow").click();
  check("Developer \u203a turns the list into the DEV menu, a row back to the list at its top, staying in Music sharing", sc_d.getElementById("appToolMenu").hidden === true && sc_d.getElementById("devMenu").hidden === false && sc_d.getElementById("devMenuBack").hidden === false && sc_d.documentElement.classList.contains("view-sharing"));
  sc_d.getElementById("devMenuBack").click();
  check("its back row brings the list back", sc_d.getElementById("devMenu").hidden === true && sc_d.getElementById("appToolMenu").hidden === false);
  sc_d.getElementById("appToolMenu").querySelector('[data-view="home"]').click();
  await new Promise((r) => setTimeout(r, 50));
  check("only Made by Arc marks the app's own playlists; the old Made by Ceremony Playlist Builder is no longer read", sc_w.eval("!madeByAppText('Made by Ceremony Playlist Builder. Please do not edit') && madeByAppText('Made by Arc. Do not edit') && !madeByAppText('Made by me') && !madeByAppText(null)"));
  check("Arc home goes home, and Music sharing closes", sc_d.documentElement.classList.contains("view-home") && sc_d.getElementById("msOverlay").hidden === true);
  sc_d.getElementById("homeBuilder").click();
  check("Playlist builder opens the builder, Arc's bar naming it", sc_d.documentElement.classList.contains("view-builder") && sc_d.getElementById("appTool").textContent === "Playlist builder");
  sc_d.getElementById("appTool").click();
  var sc_tm = sc_d.getElementById("appToolMenu");
  check("the tool's name in Arc's bar opens a list of the tools and Arc home, the one shown ticked", sc_tm.hidden === false && sc_d.getElementById("appTool").getAttribute("aria-expanded") === "true" && Array.from(sc_tm.querySelectorAll(".ab-mi[data-view]")).map((b) => b.dataset.view).join() === "builder,sharing,home" && sc_tm.querySelector('[data-view="builder"]').getAttribute("aria-checked") === "true" && sc_tm.querySelector('[data-view="sharing"]').getAttribute("aria-checked") === "false");
  sc_tm.querySelector('[data-view="sharing"]').click();
  check("below 360 px Arc's bar calls it Shared playlists, the full name not fitting", sc_w.eval("toolName('sharing', true)") === "Shared playlists" && sc_w.eval("toolName('sharing', false)") === "Shared playlist library" && sc_w.eval("toolName('builder', true)") === "Playlist builder");
  check("choosing Music sharing there opens it and closes the list", sc_d.documentElement.classList.contains("view-sharing") && sc_tm.hidden === true && sc_d.getElementById("appTool").textContent === "Shared playlist library");
  sc_d.getElementById("appTool").click();
  sc_d.body.click();
  check("a tap elsewhere closes the list", sc_tm.hidden === true && sc_d.documentElement.classList.contains("view-sharing"));
  sc_d.getElementById("appTool").click();
  sc_d.dispatchEvent(new sc_w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("Escape closes it too", sc_tm.hidden === true);
  sc_d.getElementById("appTool").click();
  sc_tm.querySelector('[data-view="home"]').click();
  await new Promise((r) => setTimeout(r, 50));
  check("Arc home in the list goes home", sc_d.documentElement.classList.contains("view-home"), sc_d.documentElement.className + " " + sc_w.eval("appView") + " tm:" + sc_tm.hidden);
  sc_d.getElementById("homeBuilder").click();
  sc_d.documentElement.classList.remove("dev-mode");
  sc_d.getElementById("appTool").click();
  check("outside developer mode Music sharing can be chosen in the list too", sc_tm.querySelector('[data-view="sharing"]').disabled === false && sc_tm.querySelector('[data-view="builder"]').disabled === false && !/Coming soon/.test(sc_tm.textContent));
  sc_d.body.click();
  sc_d.documentElement.classList.add("dev-mode");
  sc_d.querySelector("#feRows .fe-row .fe-main").click();
  var sc_find = sc_d.getElementById("feMsFind");
  check("the playlist picker has no way into Music sharing: the tools meet at Arc's home", !sc_find && !/Music sharing/.test(sc_d.querySelector("#formatEditor").textContent));
  sc_w.close();
  } catch (err) { areaCrashed("sharing card in the editor", err); }
  }

  if (want("music sharing")) { try {
  // ================================================================ Music sharing: Shared by others (by type, a playlist's page, Get) and Shared by you (the wizard, edit, update, stop)
  var ms_share = (id, name, by, kind, extra, songs, hours, t) => Object.assign({ id, owner: "other-" + id, name, by, kind, songs, ms: hours * 3600000, artists: ["Brian Eno", "Hammock"], sharedAt: t }, extra);
  var ms_mine = (pre, from, n) => Array.from({ length: n }, (_, i) => [pre + "-" + (from + i), ""]);
  var ms_other = (pre, n) => Array.from({ length: n }, (_, i) => [pre + "x" + i, "USX" + pre.toUpperCase() + i]);
  var ms_sh = { words: {}, posts: [], deletes: [], reports: [], shares: [
    ms_share("a", "Deep water", "Maya", "ceremony", { books: [1], description: "Slow and spacious, almost no vocals." }, ms_mine("p2", 0, 20).concat(ms_other("a", 80)), 6, 5000),
    ms_share("b", "Forest floor", null, "phase", { phases: [0, 4] }, ms_mine("p4", 0, 5).concat(ms_other("b", 60)), 1.5, 4000),
    ms_share("c", "Night sky", "Ann", "mood", { moods: ["grief", "tender"], description: "Mostly cello and voice." }, ms_mine("p2", 50, 2).concat(ms_other("c", 40)), 0.8, 3000),
    ms_share("d", "Bowls and gongs", "Tom", "other", { other: "Sound bath", description: "Crystal bowls." }, ms_other("d", 50), 1.1, 2000),
    ms_share("e", "Soft rain", "Kai", "mood", { moods: ["tender", "awe"] }, ms_other("e", 30), 1, 1000),
  ] };
  var ms_opts = { sharing: ms_sh };
  var ms_w = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1", devMode: "1" }, fetchOptions: ms_opts });
  await waitFor(() => ms_w.eval("connection") === "ready", 15000);
  var ms_d = ms_w.document;
  await ms_w.eval("Promise.all([loadTracks('p2'), loadTracks('p4')])");   // the recipe's playlists are kept in the browser, so overlap can be measured
  check("the DEV menu does not open Music sharing, Arc's home does, and Privacy has its topic, which names what a share keeps", !ms_d.getElementById("devOpenSharing") && /what you share is public in Arc, under your Spotify name unless anonymous/.test(ms_d.getElementById("privacyMusicSharing").textContent) && (ms_w.eval("closeInfo(true)"), !!ms_d.getElementById("msCard")));
  ms_d.getElementById("msCard").click();
  var ms_names = () => Array.from(ms_d.querySelectorAll("#msResults .ms-row .ms-name")).map((e) => e.textContent);
  var ms_labels = () => Array.from(ms_d.querySelectorAll("#msResults .ms-row .ms-klabel")).map((e) => e.textContent);
  var ms_tile = (k) => ms_d.querySelector(`#msBody .ms-ktile[data-kind="${k}"]`);
  await waitFor(() => ms_names().length === 5 && ms_w.eval("sortChoices().length") === 5, 5000);
  check("the tabs are By others and By you, each with its icon, a capsule behind the chosen one, with no ? and no pink card", Array.from(ms_d.querySelectorAll("#msTabs .ms-tab-name")).map((b) => b.textContent + (b.querySelector("svg") ? "+icon" : "")).join("|") === "By others+icon|By you+icon" && !!ms_d.querySelector("#msTabs .ms-tabpill") && !ms_d.getElementById("msTabs").classList.contains("ms-tabs-right") && !ms_d.querySelector(".ms-tab-info") && !ms_d.getElementById("msIntroCard"));
  check("Shared by others starts with tiles for the four types, none lit, and no line about Get", Array.from(ms_d.querySelectorAll("#msBody .ms-ktile")).map((b) => b.textContent).join("|") === "Ceremonies|Phases|Moods|Others" && !ms_d.querySelector("#msBody .ms-ktile.ms-on") && !/Get puts/.test(ms_d.getElementById("msBody").textContent));
  check("All lists every share, newest first, each with its type's line above its name", JSON.stringify(ms_names()) === JSON.stringify(["Deep water", "Forest floor", "Night sky", "Bowls and gongs", "Soft rain"]) && ms_labels().join("|") === "Ceremony · Book 2|Phase · Beginning, Ending|Mood · grief, tender|Sound bath|Mood · tender, awe", ms_labels().join("|"));
  check("an anonymous share says Anonymous, and each row has Get", /^Anonymous · 1 h 30 min$/.test(ms_d.querySelectorAll("#msResults .ms-row .ms-sub")[1].textContent) && ms_d.querySelectorAll("#msResults .ms-add").length === 5);
  ms_d.getElementById("msSortButton").click();
  check("All has one row of Search and Sort, no Hide playlists you have, and Sort's menu has Newest, A to Z, Longest, Most in your recipes and Least in your recipes", ms_d.querySelector("#msFindHead .ms-searchrow #msSearch") && ms_d.querySelector("#msFindHead .ms-searchrow #msSortButton") && !ms_d.getElementById("msHideAdded") && !/Hide playlists you have/.test(ms_d.getElementById("msBody").textContent) && ms_d.getElementById("msSearch").placeholder === "Search playlists" && Array.from(ms_d.querySelectorAll("#msSortMenu button")).map((b) => b.textContent).join("|") === "Newest|A to Z|Longest|Most in your recipes|Least in your recipes");
  check("Sort's menu opens under its button, in Search's row", ms_d.getElementById("msSortMenu").parentElement === ms_d.getElementById("msSortButton").parentElement);
  ms_d.getElementById("msSortButton").click();
  check("and the button closes it again", !ms_d.getElementById("msSortMenu") && ms_d.getElementById("msSortButton").getAttribute("aria-expanded") === "false");
  ms_d.getElementById("msSortButton").click();
  Array.from(ms_d.querySelectorAll("#msSortMenu button")).find((b) => b.textContent === "Most in your recipes").click();
  check("Most in your recipes sorts by the songs already in the recipes, and each row says it", ms_names()[0] === "Deep water" && ms_d.querySelector("#msResults .ms-ov").textContent === "20% already in your recipes");
  ms_w.eval("setSort('newest')");
  var ms_search = (q) => { const s = ms_d.getElementById("msSearch"); s.value = q; s.dispatchEvent(new ms_w.Event("input")); };
  ms_search("cello");
  check("search finds descriptions, with no count above the list", JSON.stringify(ms_names()) === '["Night sky"]' && !ms_d.getElementById("msCount"));
  ms_d.getElementById("msSearch").focus();
  ms_d.querySelector("#msResults .ms-row .ms-name").dispatchEvent(new ms_w.PointerEvent("pointerdown", { bubbles: true }));
  var ms_kept = ms_d.activeElement === ms_d.getElementById("msSearch");
  ms_d.querySelector("#msResults .ms-row .ms-name").click();
  check("while searching, a tap on a playlist keeps the search until it opens the playlist's page", ms_kept && ms_w.eval("sharing.detail") && /Night sky/.test(ms_d.getElementById("msFlow").textContent));
  ms_w.eval("closeDetail()");
  ms_search("zzzz");
  check("a search that finds nothing says Nothing matches, with Clear search and filters", /Nothing matches/.test(ms_d.getElementById("msResults").textContent) && ms_d.querySelector("#msResults .ms-empty-ghost").textContent === "Clear search and filters");
  ms_d.querySelector("#msResults .ms-empty-ghost").click();
  check("which clears it, showing the whole list", ms_names().length === 5 && ms_d.getElementById("msSearch").value === "");
  ms_tile("ceremony").click();
  check("Ceremony shows only ceremonies, keeping the row of Search playlists and Sort, with the five books and Other under Which book", JSON.stringify(ms_names()) === '["Deep water"]' && ms_d.querySelectorAll("#msTools .ms-btile").length === 6 && /\?/.test(ms_d.querySelectorAll("#msTools .ms-btile")[5].textContent) && ms_d.getElementById("msSearch").placeholder === "Search playlists" && !!ms_d.querySelector("#msFindHead .ms-searchrow #msSortButton") && ms_d.querySelector("#msTools .ms-flabel2").textContent === "Which book");
  check("the type tiles and Search's row (one head) scroll with the list like the type's filter, nothing sticky", !!ms_d.querySelector("#msFindHead > .ms-ktiles") && !!ms_d.querySelector("#msFindHead > .ms-searchrow") && !ms_d.querySelector("#msFindHead .ms-btile") && !/\.ms-findhead \{[^}]*position: sticky/.test(ms_d.documentElement.outerHTML));
  ms_d.querySelectorAll("#msTools .ms-btile")[0].click();
  check("a book shows the ceremonies for it", ms_names().length === 0 && /Nothing matches/.test(ms_d.getElementById("msResults").textContent));
  ms_d.querySelectorAll("#msTools .ms-btile")[1].click();
  check("one book at a time: choosing another takes its place", ms_d.querySelectorAll("#msTools .ms-btile.ms-on").length === 1 && JSON.stringify(ms_names()) === '["Deep water"]');
  ms_d.querySelectorAll("#msTools .ms-btile")[5].click();
  check("Other in the filter shows ceremonies for another book, whatever book, with no field to type one", ms_names().length === 0 && !ms_d.getElementById("msBookCode") && /\?/.test(ms_d.querySelectorAll("#msTools .ms-btile")[5].textContent));
  check("choosing a type shows what it is under the tiles, the share form's line", ms_d.querySelector("#msFindHead > .ms-ktiles + #msTypeHint").textContent === "The whole arc of a ceremony, from start to finish." && !ms_d.getElementById("msTypeHint").hidden);
  ms_tile("phase").click();
  check("another type within 3 s keeps the line up with its own words", ms_d.getElementById("msTypeHint").textContent === "Made for part of a ceremony, like the ascent or the ending." && !ms_d.getElementById("msTypeHint").hidden);
  ms_w.eval("sharing.typeHint = null; renderSharing();");
  check("once its time is up the line is gone", ms_d.getElementById("msTypeHint").hidden);
  ms_tile("ceremony").click(); ms_tile("ceremony").click();
  check("clearing the type takes the line away at once", !ms_w.eval("sharing.typeHint") && ms_w.eval("sharing.type") === "all");
  ms_tile("phase").click();
  check("Phase shows the curve to choose phases, and changing type clears the book", JSON.stringify(ms_names()) === '["Forest floor"]' && !!ms_d.querySelector("#msTools .ms-phases-pick") && ms_w.eval("sharing.book") === null);
  ms_d.querySelectorAll("#msTools .ms-phase-names button")[2].click();
  check("a phase no share has leaves nothing", ms_names().length === 0);
  ms_d.querySelectorAll("#msTools .ms-phase-names button")[4].click();
  check("one phase at a time, under Which phase: choosing another takes its place", JSON.stringify(ms_names()) === '["Forest floor"]' && ms_d.querySelectorAll("#msTools .ms-phase-names button.ms-on").length === 1 && ms_d.querySelector("#msTools .ms-flabel2").textContent === "Which phase");
  ms_d.querySelectorAll("#msTools .ms-phase-names button")[4].click();
  check("a tap on the lit phase clears it", !ms_d.querySelector("#msTools .ms-phase-names button.ms-on") && JSON.stringify(ms_names()) === '["Forest floor"]');
  ms_tile("mood").click();
  var ms_chipWords = () => Array.from(ms_d.querySelectorAll("#msMoods .ms-chip")).map((c) => c.textContent);
  check("Mood shows the mood words two or more shares use", JSON.stringify(ms_names()) === '["Night sky","Soft rain"]' && ms_chipWords().join() === "tender", ms_chipWords().join());
  ms_tile("other").click();
  check("Other shows the rest, with a search", JSON.stringify(ms_names()) === '["Bowls and gongs"]' && !!ms_d.getElementById("msSearch"));
  ms_w.eval("sharing.library.shares = sharing.library.shares.filter((s) => s.kind !== 'other'); renderSharing();");
  check("a type no one has shared yet says so, with Share one of yours", /No one has shared one of these yet/.test(ms_d.getElementById("msResults").textContent) && ms_d.querySelector("#msResults .ms-empty-ghost").textContent === "Share one of yours");
  ms_w.eval("sharing.libraryAt = 0"); await ms_w.eval("loadLibrary(true)");
  ms_d.querySelector("#msBody .ms-ktile.ms-on").click();
  ms_d.querySelector("#msResults .ms-row").click();
  await waitFor(() => !!ms_d.querySelector("#msFlowBody .ms-hero"), 5000);
  check("a playlist's page: its type, name, who on one line and the songs and length on the next", ms_d.querySelector("#msFlowBody .ms-hero .ms-klabel").textContent === "Ceremony" && ms_d.querySelector("#msFlowBody h3").textContent === "Deep water" && Array.from(ms_d.querySelectorAll("#msFlowBody .ms-hero .ms-sub")).map((e) => e.textContent).join("|") === "Shared by Maya|100 songs · 6 h");
  check("a ceremony's page shows its book lit under For use with, then the description with Report under it", /For use with/.test(ms_d.querySelector("#msFlowBody .ms-facts").textContent) && ms_d.querySelector("#msFlowBody .ms-btile.ms-on").textContent === "Book2" && ms_d.querySelector("#msFlowBody .ms-long").textContent === "Slow and spacious, almost no vocals." && ms_d.querySelector("#msFlowBody .ms-long").nextElementSibling.classList.contains("ms-reportrow"));
  check("the page is a popup over the list, with no title band, a round X at its top right and no Back, Get this playlist wide under the header, and no bottom row", !ms_d.getElementById("msFlowWrap").hidden && ms_d.getElementById("msFlow").classList.contains("ms-pop-detail") && ms_d.getElementById("msFlow").getAttribute("aria-labelledby") === "msDetailTitle" && !!ms_d.querySelector("#msFlow > #msPopClose") && !ms_d.getElementById("msBack") && ms_d.querySelector("#msFlowBody .ms-hero + #msMain.ms-getwide").textContent === "Get this playlist" && ms_d.getElementById("msFlowFoot").hidden && ms_d.getElementById("msBody").inert && ms_d.querySelectorAll("#msResults .ms-row").length > 0);
  ms_d.getElementById("msPopClose").click();
  check("its X closes it, back to the list", ms_w.eval("sharing.detail") === null && ms_d.getElementById("msFlowWrap").hidden && !ms_d.getElementById("msPopClose") && !ms_d.getElementById("msBody").inert);
  ms_d.querySelector("#msResults .ms-row").click();
  ms_d.dispatchEvent(new ms_w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("Escape closes it", ms_w.eval("sharing.detail") === null && ms_d.getElementById("msFlowWrap").hidden);
  ms_d.querySelector("#msResults .ms-row").click();
  ms_d.getElementById("msFlowWrap").dispatchEvent(new ms_w.MouseEvent("click", { bubbles: true }));
  check("a tap outside it closes it", ms_w.eval("sharing.detail") === null && ms_d.getElementById("msFlowWrap").hidden);
  ms_d.querySelector("#msResults .ms-row").click();
  await waitFor(() => !!ms_d.querySelector("#msFlowBody .ms-hero"), 5000);
  ms_w.eval("sharing.detail = 'b'; renderSharing();");
  check("a phase share says when its sharer plays it over the curve, and with nothing typed there is no Report", ms_d.querySelector("#msFlowBody .ms-phase-line").textContent === "They play it in Beginning and Ending" && !ms_d.querySelector("#msFlowBody .ms-report"));
  check("more than two phases is a count, and the person's own share says You", ms_w.eval(`phaseLine({ by: "Kai", phases: [0, 1, 4] }).textContent`) === "Kai plays it in 3 phases");
  ms_w.eval("sharing.detail = 'e'; renderSharing();");
  check("a mood share shows its words, and Report covers them even with no description", Array.from(ms_d.querySelectorAll("#msFlowBody .ms-chip")).map((c) => c.textContent).join() === "tender,awe" && !!ms_d.querySelector("#msFlowBody .ms-report"));
  ms_w.eval("sharing.detail = 'a'; renderSharing();");
  ms_d.querySelector("#msFlowBody .ms-report").click();
  check("Report asks for a reason, with a note that is optional", ms_d.querySelectorAll(".fe-dialog input[type=radio]").length === 4 && !!ms_d.querySelector(".fe-dialog textarea"));
  ms_d.dispatchEvent(new ms_w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  ms_w.__counts = []; ms_w.goatcounter = { count: (v) => ms_w.__counts.push(v) };
  ms_d.getElementById("msMain").click();
  await waitFor(() => !!ms_d.getElementById("msSheet"), 5000);
  check("a Get is counted with the share's type only", JSON.stringify(ms_w.__counts.map((e) => [e.path, e.title])) === JSON.stringify([["playlist-gotten", "ceremony"]]));
  var ms_made = log.filter((e) => e.url.endsWith("/v1/me/playlists") && (e.init.method || "") === "POST").map((e) => JSON.parse(e.init.body)).pop();
  check("Get this playlist makes a private copy with its name and description, and the device remembers it as a copy", ms_made && ms_made.name === "Deep water" && ms_made.public === false && ms_made.description === "Slow and spacious, almost no vocals. [origin: a]" && "a" in ms_w.eval("sharingCopies()"));
  check("after a Get, with nothing shared, a sheet says it is in Spotify, what a private copy is, and invites a share", /Deep water is in your Spotify/.test(ms_d.getElementById("msSheet").textContent) && /It stays as it is if Maya changes theirs\./.test(ms_d.getElementById("msSheet").textContent) && /Maya shared this\. Share one of yours\?/.test(ms_d.getElementById("msSheet").textContent) && !!ms_d.getElementById("msNotNow"));
  check("and the button says Gotten, grey", /Gotten/.test(ms_d.getElementById("msMain").textContent) && ms_d.getElementById("msMain").disabled);
  ms_d.getElementById("msNotNow").click();
  check("Not now closes it", !ms_d.getElementById("msSheet"));
  check("once the person shares 1 for every 4 they get, the sheet has no invitation, only OK", ms_w.eval("sharing.mine = [{ id: 'zz', playlist: 'x' }]; offerToShare(sharing.library.shares[0]); const ok = !!document.getElementById('msGotOk') && !document.getElementById('msNotNow') && !/Share one of yours/.test(document.getElementById('msSheet').textContent); closeSheet(true); sharing.mine = []; ok") === true);
  ms_w.eval("closeDetail()");
  await waitFor(() => ms_w.eval("sharing.detail") === null, 3000);
  ms_tile("ceremony").click();
  check("playlists the person has stay in the list, Gotten", ms_names().join() === "Deep water" && /Gotten/.test(ms_d.querySelector("#msResults .ms-add").textContent));
  ms_d.querySelector("#msBody .ms-ktile.ms-on").click();
  check("another device knows a copy by the [origin: ID] at the end of its description, with no record of its own, and a copy deleted in Spotify can be gotten again", ms_w.eval(`(() => {
    const keep = localStorage.getItem("sharingCopies"); localStorage.removeItem("sharingCopies");
    const s = sharing.library.shares[0], p = playlists.find((x) => x.name === "Deep water");
    const marked = isAdded(s) && copyShareId(p) === "a" && addedCount() === 1 && !shareCandidates().includes(p);
    const at = playlists.indexOf(p); playlists.splice(at, 1);
    const gone = !isAdded(s) && addedCount() === 0;
    playlists.splice(at, 0, p); localStorage.setItem("sharingCopies", keep);
    return marked && gone;
  })()`) === true);
  check("the origin is not offered as part of the playlist's own description, an ordinary last word is not taken for one, and a long description loses its end at a space to make room", ms_w.eval(`cleanSpotifyDescription("Slow. [origin: a]") === "Slow." && cleanSpotifyDescription("Slow and gentle") === "Slow and gentle" && !copyShareId({ description: "Slow and gentle" }) && (() => { const d = copyDescription({ id: "abc", description: "word ".repeat(70) }); return d.length <= 300 && d.endsWith("word [origin: abc]"); })()`) === true);
  var ms_before = log.length;
  await ms_w.eval(`(async () => {
    const p = playlists.find((x) => x.name === "Deep water"); p.description = "Slow and spacious.";
    await markOldCopies();
  })()`);
  var ms_put = log.slice(ms_before).filter((e) => /\/v1\/playlists\/[^/]+$/.test(e.url) && e.init.method === "PUT").map((e) => JSON.parse(e.init.body));
  check("a copy made before the origin was added gets it once from this device's record", ms_put.length === 1 && ms_put[0].description === "Slow and spacious. [origin: a]" && ms_w.eval(`copyShareId(playlists.find((x) => x.name === "Deep water"))`) === "a", JSON.stringify(ms_put));

  // ---------------- Shared by you
  ms_d.querySelectorAll(".ms-tab-name")[1].click();
  await waitFor(() => ms_d.querySelectorAll("#msBody .ms-yours-list > *").length === 1, 5000);
  check("choosing By you slides the capsule to it and keeps the same switch (so it can slide)", ms_d.getElementById("msTabs").classList.contains("ms-tabs-right") && ms_d.querySelectorAll("#msTabs .ms-tabpill").length === 1 && ms_d.querySelectorAll("#msTabs .ms-tab")[1].classList.contains("ms-on") && ms_d.querySelectorAll("#msTabs .ms-tab-name")[1].getAttribute("aria-selected") === "true");
  check("with nothing shared, Shared by you is only Share your first playlist, where Share another playlist will be, and no bottom row", ms_d.getElementById("msBody").children.length === 1 && ms_d.querySelector("#msBody .ms-yours-list > #msShareRow:only-child").textContent === "Share your first playlist" && ms_d.getElementById("msFoot").hidden);
  ms_d.getElementById("msShareRow").click();
  var ms_pick = () => Array.from(ms_d.querySelectorAll("#msFlowBody .ms-pickrow:not(.ms-pickrow-off)")).map((r) => r.id.slice(7));
  var ms_ftile = (k) => ms_d.querySelector(`#msFlowBody .ms-ktile[data-kind="${k}"]`);
  var ms_main = () => ms_d.getElementById("msFlowMain");
  check("Share a playlist: one popup over the tabs, its title, no steps, only the empty playlist card, and Share grey, with nothing under it", ms_d.querySelector(".ms-flowtitle").textContent === "Share a playlist" && !ms_d.querySelector(".ms-steps") && ms_d.getElementById("msPickCard").classList.contains("ms-pcard-empty") && /Choose a playlist/.test(ms_d.getElementById("msPickCard").textContent) && !ms_d.querySelector('#msFlowBody [data-field="kind"]') && ms_main().disabled && ms_main().textContent === "Share" && !!ms_main().querySelector("svg") && !ms_d.getElementById("msFlowBack") && !ms_d.getElementById("msNeed"));
  check("the form is a popup over the page: the tabs stay under it, Shared by you chosen, and the page is inert meanwhile", !ms_d.getElementById("msFlowWrap").hidden && ms_d.getElementById("msFlowWrap").parentElement === ms_d.getElementById("msDialog") && ms_d.querySelector("#msTabs .ms-tab.ms-on").textContent === "By you" && ms_d.getElementById("msBody").inert && ms_d.getElementById("msTabsBar").inert);
  check("its Close ends it, and Share a playlist opens it again", (ms_d.getElementById("msFlowClose").click(), ms_d.getElementById("msFlowWrap").hidden && !ms_w.eval("sharing.flow") && !ms_d.getElementById("msBody").inert) && (ms_d.getElementById("msShareRow").click(), !ms_d.getElementById("msFlowWrap").hidden));
  ms_d.getElementById("msPickCard").click();
  check("a tap on the card opens the list under it: the person's own playlists, not others', the copy just gotten greyed with why, with a search", ms_pick().join() === "p1,p2,p3,p4" && /A copy from Music sharing/.test(ms_d.getElementById("msPickOff-new1").textContent) && !!ms_d.getElementById("msPickSearch") && ms_d.getElementById("msPickCard").getAttribute("aria-expanded") === "true", ms_pick().join());
  { const q = ms_d.getElementById("msPickSearch"); q.value = "evoc"; q.dispatchEvent(new ms_w.Event("input")); }
  check("the search narrows the list", ms_pick().join() === "p3", ms_pick().join());
  ms_d.getElementById("msPick-p3").click();
  await waitFor(() => !!ms_w.eval("sharing.flow.draft"), 5000);
  var ms_card = () => ms_d.getElementById("msCardPreview");
  check("choosing one reads its songs, closes the list, and the card shows it as others will see it (no type line yet)", !ms_d.getElementById("msPickList") && ms_card().querySelector(".ms-name").textContent === "💗💗 evocative" && !ms_card().querySelector(".ms-klabel") && /^Ron · /.test(ms_card().querySelector(".ms-sub").textContent));
  check("then the type question appears, the four types as tiles with no line under them yet, and Share still grey", ms_d.querySelector('#msFlowBody [data-field="kind"] .ms-flabel b').textContent === "What type of playlist is this?" && ms_d.querySelectorAll("#msFlowBody .ms-ktile").length === 4 && !ms_d.getElementById("msKindLine") && ms_main().disabled);
  ms_d.getElementById("msAnon").click();
  check("Share anonymously is a switch in the card, and the card follows it", ms_d.getElementById("msAnon").getAttribute("role") === "switch" && /^Anonymous · /.test(ms_card().querySelector(".ms-sub").textContent));
  ms_ftile("ceremony").click();
  check("choosing a type says what it is under the tiles, changes the card, and asks its question with a placeholder of its own", ms_d.getElementById("msKindLine").textContent === "The whole arc of a ceremony, from start to finish." && ms_card().querySelector(".ms-klabel").textContent === "Ceremony" && ms_d.querySelector('#msFlowBody [data-field="books"] .ms-flabel b').textContent === "Which books is it for?" && ms_d.querySelector('#msFlowBody [data-field="description"] .ms-flabel b').textContent === "How would you describe it?" && /^Describe the music and when you/.test(ms_d.getElementById("msDesc").placeholder));
  check("a playlist with no Spotify description has no Mine | Spotify's switch", !ms_d.getElementById("msDescSpotify"));
  ms_d.querySelectorAll('#msFlowBody [data-field="books"] .ms-btile')[2].click();
  check("each answer shows in the card, and Share stays grey until all are there", ms_card().querySelector(".ms-klabel").textContent === "Ceremony · Book 3" && ms_main().disabled);
  ms_d.querySelectorAll('#msFlowBody [data-field="books"] .ms-btile')[0].click();
  check("ceremonies take more than one book", ms_card().querySelector(".ms-klabel").textContent === "Ceremony · Books 1, 3");
  check("no field for the other book until Other is chosen", !ms_d.getElementById("msBookCode"));
  ms_d.querySelectorAll('#msFlowBody [data-field="books"] .ms-btile')[5].click();
  check("Other opens a field for its code under the books, focused", !!ms_d.getElementById("msBookCode") && ms_d.activeElement === ms_d.getElementById("msBookCode") && /Up to 2 letters or numbers/.test(ms_d.querySelector(".ms-bcode-row").textContent));
  { const t = ms_d.getElementById("msDesc"); t.value = "Long and quiet."; t.dispatchEvent(new ms_w.Event("input")); }
  check("Other with no code keeps Share grey", ms_main().disabled && ms_sh.posts.length === 0);
  { const t = ms_d.getElementById("msBookCode"); t.value = "b-w7"; t.dispatchEvent(new ms_w.Event("input")); }
  check("the code keeps 2 letters or numbers in capitals, shows in its book and in the card, and Share turns pink", ms_d.getElementById("msBookCode").value === "BW" && ms_d.querySelectorAll('#msFlowBody [data-field="books"] .ms-btile')[5].textContent.includes("BW") && ms_card().querySelector(".ms-klabel").textContent === "Ceremony · Books 1, 3, BW" && !ms_main().disabled);
  ms_d.getElementById("msPickCard").click();
  check("the card opens the list again to choose another, the chosen one ticked, and what was filled in stays", ms_d.getElementById("msPick-p3").classList.contains("ms-on") && ms_w.eval("sharing.flow.draft.kind") === "ceremony");
  ms_d.getElementById("msPick-p3").click();
  check("tapping the chosen one closes the list", !ms_d.getElementById("msPickList"));
  { const t = ms_d.getElementById("msDesc"); t.value = "Long and quiet."; t.dispatchEvent(new ms_w.Event("input")); }
  ms_w.__counts = []; ms_w.goatcounter = { count: (v) => ms_w.__counts.push(v) };
  ms_d.getElementById("msFlowMain").click();
  await waitFor(() => !!ms_d.querySelector("#msFlowBody .ms-shared"), 5000);
  check("a share is counted with its type only", JSON.stringify(ms_w.__counts.map((e) => [e.path, e.title])) === JSON.stringify([["playlist-shared", "ceremony"]]));
  var ms_post = ms_sh.posts[ms_sh.posts.length - 1];
  check("the new share is in the library at once, as the worker will have it, without reading the library again", ms_w.eval("(() => { const s = sharing.library.shares[0]; return s.name === '💗💗 evocative' && s.kind === 'ceremony' && s.count === 130 && s.by === null && s.description === 'Long and quiet.'; })()"), ms_w.eval("JSON.stringify(sharing.library.shares[0]).slice(0, 200)"));
  check("Share sends the type, its books, the description, anonymous, and the songs with their names", ms_post.playlist === "p3" && ms_post.kind === "ceremony" && JSON.stringify(ms_post.books) === "[0,2,5]" && ms_post.bookOther === "BW" && ms_post.description === "Long and quiet." && ms_post.descSource === "mine" && ms_post.by === null && ms_post.songs.length === 130 && ms_post.names.length === 130 && !("tags" in ms_post));
  check("then a page says it is shared, with Share another playlist and Done", /💗💗 evocative is shared/.test(ms_d.getElementById("msFlowBody").textContent) && /Other facilitators can find it in Shared by others now\./.test(ms_d.getElementById("msFlowBody").textContent) && ms_d.getElementById("msFlowMain").textContent === "Share another playlist" && !!ms_d.getElementById("msDone"));
  ms_d.getElementById("msDone").click();
  await waitFor(() => !!ms_d.querySelector("#msBody .ms-yrow"), 5000);
  var ms_yrow = () => ms_d.querySelector("#msBody .ms-yrow");
  check("Done shows the list of shares: its type, name, Anonymous, and Share another playlist under them, in New recipe's look, with no bottom row", ms_yrow().querySelector(".ms-klabel").textContent === "Ceremony · Books 1, 3, BW" && /^Anonymous/.test(ms_yrow().querySelector(".ms-sub").textContent) && ms_d.querySelector(".ms-yours-list > #msShareRow:last-child.bh-add").textContent === "Share another playlist" && ms_d.getElementById("msFoot").hidden);
  check("a playlist already shared is greyed in the list, saying so", (ms_d.getElementById("msShareRow").click(), ms_d.getElementById("msPickCard").click(), !ms_pick().includes("p3") && /Already shared/.test(ms_d.getElementById("msPickOff-p3").textContent)) && (ms_d.getElementById("msFlowClose").click(), true));
  var ms_openEdit = async () => {
    ms_yrow().click();
    await waitFor(() => ms_w.eval("!!sharing.detail"), 3000);
    const ok = ms_w.eval("!!sharing.detail && !sharing.flow") && ms_d.querySelector("#msFlowBody .ms-dcard #msEdit").textContent === "Edit details" && !ms_d.getElementById("msMain") && ms_d.getElementById("msFoot").hidden;
    ms_d.getElementById("msEdit").click();
    return ok;
  };
  check("a share in Shared by you opens its playlist's page, its details in a card with Edit details, and no bottom row", await ms_openEdit());
  check("Edit details is the same form: the card with no way to change the playlist, its fields filled in, Share anonymously on, Stop sharing, and Update grey until something changes", ms_d.querySelector(".ms-flowtitle").textContent === "Edit details" && !ms_d.getElementById("msPickCard") && ms_main().disabled && ms_d.querySelector('#msFlowBody .ms-ktile.ms-on').dataset.kind === "ceremony" && ms_d.getElementById("msDesc").value === "Long and quiet." && ms_d.getElementById("msAnon").checked && !!ms_d.getElementById("msStop") && ms_d.getElementById("msFlowMain").textContent === "Update");
  ms_ftile("mood").click();
  var ms_moodType = (text) => { const i = ms_d.getElementById("msMoodInput"); i.value = text; i.dispatchEvent(new ms_w.Event("input")); };
  var ms_moodAdd = (text) => { ms_moodType(text); ms_d.getElementById("msMoodAdd").click(); };
  check("moods have a text box with Add beside it, pale until something is typed", !!ms_d.getElementById("msMoodInput") && ms_d.getElementById("msMoodAdd").textContent === "Add" && ms_d.getElementById("msMoodAdd").disabled);
  ms_moodAdd("shit");
  check("a mood word on the blocked list is not taken, and says so", ms_w.eval("sharing.flow.draft.moods.length") === 0 && !ms_d.querySelector("#msFlowBody .ms-moodrow + .ms-ferr").hidden && /can't be used/.test(ms_d.querySelector("#msFlowBody .ms-moodrow + .ms-ferr").textContent));
  ms_moodAdd("Deep calm");
  check("Add makes what is typed one mood, spaces and all, lower case, as a chip above the box, and moods others use are offered", ms_w.eval("sharing.flow.draft.moods.join()") === "deep calm" && ms_d.getElementById("msMoodInput").value === "" && ms_d.querySelector("#msFlowBody .ms-moodchips + .ms-moodrow .ms-moodinput") && ms_d.querySelector("#msFlowBody .ms-moodchips .ms-moodchip").firstChild.textContent === "deep calm" && Array.from(ms_d.querySelectorAll("#msFlowBody .ms-suggest .ms-chip")).map((c) => c.textContent).includes("tender"));
  ms_moodType("calm, open");
  ms_d.getElementById("msMoodInput").dispatchEvent(new ms_w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  check("Return adds too, and a comma is not a split", ms_w.eval("sharing.flow.draft.moods.join('|')") === "deep calm|calm open");
  ms_d.querySelectorAll("#msFlowBody .ms-moodchip .ms-chipx")[1].click();
  check("a chip's x removes it", ms_w.eval("sharing.flow.draft.moods.join('|')") === "deep calm");
  check("damn, hell and crap are allowed", ["damn", "hell", "crap", "grief"].every((w) => !ms_w.eval(`blockedWord(${JSON.stringify(w)})`)) && ms_w.eval("blockedWord('bugger off')"));
  ms_d.getElementById("msFlowMain").click();
  await waitFor(() => !ms_w.eval("sharing.flow"), 5000);
  ms_post = ms_sh.posts[ms_sh.posts.length - 1];
  check("Update sends the new type and its words, and goes back to the playlist's page", ms_post.kind === "mood" && JSON.stringify(ms_post.moods) === '["deep calm"]' && JSON.stringify(ms_post.books) === "[]" && ms_w.eval("!!sharing.detail && sharing.tab === 'share'"));
  ms_d.getElementById("msPopClose").click();
  await waitFor(() => !!ms_yrow(), 3000);
  // a new snapshot with the same songs (a new name or description) is not a change; new songs are (Ron, 2026-11-14)
  await ms_w.eval("loadTracks('p3').then((t) => { const s = sharing.library.shares.find((x) => x.id === sharing.mine[0].id); if (s) s.songs = t.map((x) => [String(x.id), '']).filter(([id]) => /^[A-Za-z0-9]{10,40}$/.test(id)); })");
  ms_w.eval("playlists.find((p) => p.id === 'p3').snapshot = 'renamed'; sharing.mine[0].snapshot = 'before'; renderSharing();");
  await waitFor(() => ms_w.eval("!!(sharing.changeChecks && sharing.changeChecks[sharing.mine[0].id] && 'changed' in sharing.changeChecks[sharing.mine[0].id])"), 3000);
  await new Promise((r) => setTimeout(r, 200));
  check("a share whose playlist has a new snapshot but the same songs (a new name or description) gets no strip", ms_w.eval("!!sharing.library.shares.find((x) => x.id === sharing.mine[0].id)") && !ms_d.querySelector("#msBody .ms-strip"));
  ms_w.eval("playlists.find((p) => p.id === 'p3').snapshot = 'changed'; sharing.library.shares.find((x) => x.id === sharing.mine[0].id).songs = [['zzzzzzzzzzzzzzzzzzzzzz', '']]; renderSharing();");
  await waitFor(() => !!ms_d.querySelector("#msBody .ms-strip"), 3000);
  check("a share whose songs changed in Spotify since it was shared gets a strip with Update", /Changed in Spotify since you shared it/.test(ms_d.querySelector("#msBody .ms-strip").textContent));
  ms_d.querySelector("#msBody .ms-stripbtn").click();
  await waitFor(() => ms_sh.posts.length === 3, 5000);
  check("Update there shares it again with the same details", ms_sh.posts[2].kind === "mood" && JSON.stringify(ms_sh.posts[2].moods) === '["deep calm"]' && ms_sh.posts[2].snapshot === "changed");
  ms_sh.staleToken = true;
  ms_w.eval('keepRefresh("ref-old", "' + SCOPE_ALL + '")');
  ms_w.eval("sharing.mine = null; loadMine()");
  await waitFor(() => ms_w.eval("!!sharing.mine || !!sharing.mineError"), 4000);
  check("when the sign-in has run out, Music sharing renews it and sends again with the new one", ms_w.eval("!!sharing.mine && !sharing.mineError") && ms_opts.renewals >= 1, ms_w.eval("sharing.mineError"));
  ms_sh.staleToken = false;
  await ms_openEdit();
  var ms_gone = ms_sh.shares.find((s) => s.playlist === "p3"), ms_reads = ms_sh.libraryReads;
  ms_d.getElementById("msStop").click();
  await waitFor(() => !!ms_d.getElementById("feSyncChoice1"), 3000);
  check("Stop sharing asks first, saying copies others got stay theirs", /Copies others already got stay theirs\./.test(ms_d.getElementById("feSyncChoice1").closest(".fe-dialog").textContent) && ms_d.getElementById("feSyncChoice1").textContent === "Stop sharing" && ms_d.getElementById("feSyncChoice1").classList.contains("fe-danger-button"));
  ms_d.getElementById("feSyncChoice1").click();
  await waitFor(() => ms_sh.deletes.length === 1 && ms_d.querySelectorAll("#msBody .ms-yours-list > *").length === 1, 5000);
  check("and stops sharing it", ms_sh.shares.every((s) => s.playlist !== "p3"));
  check("the library drops it at once, without reading the library again", ms_sh.libraryReads === ms_reads && !ms_w.eval("sharing.library.shares.some((s) => s.id === " + JSON.stringify(ms_gone.id) + ")"));
  ms_sh.shares.push(ms_gone);   // a copy of the worker that still keeps the library from before
  await ms_w.eval("loadLibrary(true)");
  check("a library read within the next minute that still has it does not bring it back", !ms_w.eval("sharing.library.shares.some((s) => s.id === " + JSON.stringify(ms_gone.id) + ")"));
  ms_sh.shares.splice(ms_sh.shares.indexOf(ms_gone), 1);
  ms_sh.refuse = { error: "x", code: "copy", percent: 93, of: "Forest floor" };
  ms_d.getElementById("msShareRow").click();
  ms_d.getElementById("msPickCard").click();
  ms_d.getElementById("msPick-p1").click();
  await waitFor(() => !!ms_w.eval("sharing.flow.draft"), 5000);
  ms_ftile("phase").click();
  ms_d.querySelectorAll("#msFlowBody .ms-phase-names button")[1].click();
  check("a phase share needs a description too, with a placeholder of its own", ms_main().disabled && /^What is the music like, and what does it leave out\?/.test(ms_d.getElementById("msDesc").placeholder) && !ms_d.querySelector('[data-field="description"] .ms-fnote'));
  ms_ftile("mood").click();
  check("a mood's description is optional, and Share stays grey until a mood is added as a chip", ms_d.querySelector('[data-field="description"] .ms-fnote').textContent === "Optional" && ms_d.getElementById("msDesc").placeholder === "Anything to add beyond the moods above?" && ms_main().disabled && (ms_moodType("tender"), ms_main().disabled) && (ms_d.getElementById("msMoodInput").dispatchEvent(new ms_w.KeyboardEvent("keydown", { key: "Enter", bubbles: true })), !ms_main().disabled));
  { const x = ms_d.querySelector("#msFlowBody .ms-moodchip .ms-chipx"); if (x) x.click(); }
  ms_ftile("other").click();
  check("Other asks what to call it, keeps Share grey until named, and has its own placeholder", ms_d.querySelector('[data-field="other"] .ms-flabel b').textContent === "What would you call it?" && ms_main().disabled && /sound bath, integration circles/.test(ms_d.getElementById("msDesc").placeholder));
  ms_ftile("phase").click();
  { const t = ms_d.getElementById("msDesc"); t.value = "For the climb."; t.dispatchEvent(new ms_w.Event("input")); }
  ms_d.getElementById("msFlowMain").click();
  await waitFor(() => !!ms_d.getElementById("msRefused"), 5000);
  check("a share the worker finds to be a copy says so at the top with the exact share, and Share turns grey", ms_d.getElementById("msRefused").textContent === "93% of its songs are in Forest floor, which someone else shares, so it can't be shared." && ms_d.getElementById("msFlowMain").disabled);
  check("the refusal is remembered, so it is not offered again until it changes in Spotify", JSON.parse(ms_w.localStorage.getItem("sharingBlocked")).p1.why === "copy" && (ms_w.eval("startShare()"), ms_d.getElementById("msPickCard").click(), !ms_pick().includes("p1") && /Mostly songs another facilitator shares/.test(ms_d.getElementById("msPickOff-p1").textContent)));
  ms_sh.refuse = null;
  ms_w.close();
  } catch (err) { areaCrashed("music sharing", err); }
  }

  if (want("tidal")) { try {
  // ================================================================ TIDAL (work/tidal-plan.md, stage 4): the same page under arcService "tidal", against a pretend TIDAL
  // (tidalAnswer): it connects, names TIDAL, sends nothing to Spotify, saves recipes and builds a participant's playlist the way TIDAL takes them
  var td_opts = {}, td_from = log.length;
  var td_scope = "playlists.read playlists.write collection.read user.read search.read";
  var td = await boot({ url: EDURL, session: { tidalToken: JSON.stringify({ value: "tt", expires: Date.now() + 3600000, scope: td_scope }) }, local: { formats: MINI, connectedBefore: "1", arcService: "tidal", clientId: "tidal-client", backupMode: "spotify" }, fetchOptions: td_opts, before: (w) => { w.goatcounter = { count: (v) => { (w.__counts = w.__counts || []).push(v.path); } }; } });
  await waitFor(() => td.eval("connection") === "ready", 15000);
  var td_d = td.document;
  check("under arcService tidal the page uses TIDAL and connects to it", td.eval("service.key") === "tidal" && td.eval("connection") === "ready" && td.eval("playlists.length") === 4, td.eval("connection") + " " + td.eval("JSON.stringify((playlists || []).map((p) => p.name))"));
  check("the page names TIDAL, and with no requirement the Spotify Premium lines are hidden", td_d.querySelector(".hp-band .wp-band-tag").textContent.includes("for your TIDAL library") && Array.from(td_d.querySelectorAll("[data-requirement]")).every((el) => el.hidden));
  check("the anonymous counts name TIDAL: its first connection and active day end in -tidal, as Spotify's end in -spotify", JSON.stringify((td.__counts || []).filter((p) => /^(first-connection|active-)/.test(p))) === JSON.stringify(["first-connection-tidal", "active-first-week-tidal"]), JSON.stringify(td.__counts));
  var td_pl = (i) => td.eval(`JSON.stringify(playlists.find((p) => p.id === "${TIDAL_PLAYLISTS[i].id}"))`);
  check("TIDAL's covers are read with the list: a playlist's own, else the first TIDAL suggests; the smallest of 160 px or more for lists and the largest up to 640 for Music sharing; none stays none", JSON.parse(td_pl(0)).image === "https://resources.tidal.com/images/own1/160x160.jpg" && JSON.parse(td_pl(0)).cover === "https://resources.tidal.com/images/own1/640x640.jpg" && JSON.parse(td_pl(1)).image === "https://resources.tidal.com/images/sug1/320x320.jpg" && JSON.parse(td_pl(1)).cover === "https://resources.tidal.com/images/sug1/480x480.jpg" && JSON.parse(td_pl(2)).image === null, td_pl(0) + " " + td_pl(1));
  check("nothing goes to Spotify while TIDAL is the service", !log.slice(td_from).some((e) => /spotify\.com/.test(e.url)), JSON.stringify(log.slice(td_from).filter((e) => /spotify\.com/.test(e.url)).map((e) => e.url).slice(0, 3)));
  check("a TIDAL playlist ID (a UUID) packs into 16 bytes and back unchanged", td.eval(`service.idToBytes("${TIDAL_PLAYLISTS[0].id}").length`) === 16 && td.eval(`service.idFromBytes(service.idToBytes("${TIDAL_PLAYLISTS[0].id}"))`) === TIDAL_PLAYLISTS[0].id && td.eval("service.idToBytes('5kiJ9x6eX37H5J9lyyXkua')") === null);
  td.eval("spotifySaveDelayMs = 50; spotifySaveMaxWaitMs = 200");
  await waitFor(() => (td_opts.tidal.created || []).some((c) => /^Holds a recipe/.test(c.description || "")), 15000);
  var td_save = (td_opts.tidal.created || []).find((c) => /^Holds a recipe/.test(c.description || ""));
  check("the recipe is saved to TIDAL as an Unlisted playlist named <title> (recipe), with no cover sent", !!td_save && /\(recipe\)$/.test(td_save.name) && td_save.accessType === "UNLISTED" && !log.slice(td_from).some((e) => /images|artworks/.test(e.url)), JSON.stringify(td_opts.tidal.created));
  await waitFor(() => td.eval("service.signedIn() && connection === 'ready' && !!py && formatsValid && !busy && !saveState.running"), 20000);
  check("no cover notice under TIDAL, which has no covers: nothing queued, no problem, nothing on the line under the bar", td.eval("saveState.coverQueue.length") === 0 && !td.eval("saveState.coverProblem") && !/cover/i.test(capText(td)), capText(td));
  await td.eval("buildForParticipant('mini', 'T', null)");
  var td_built = (td_opts.tidal.created || []).find((c) => /For participant T\./.test(c.description || ""));
  var td_adds = td_built ? td_opts.tidal.adds.filter((a) => a.id === td_built.id) : [];
  var td_ids = td_adds.flatMap((a) => a.ids);
  check("a participant's playlist is built on TIDAL: Unlisted, named with the code, songs added at most 50 at a time", td.eval("personBuild.state") === "done" && !!td_built && /^T · /.test(td_built.name) && td_built.accessType === "UNLISTED" && td_adds.length >= 1 && td_adds.every((a) => a.ids.length <= 50), JSON.stringify({ state: td.eval("personBuild.state"), error: td.eval("personBuild.error || ''"), built: td_built, adds: td_adds.map((a) => a.ids.length) }));
  check("its songs are TIDAL's own IDs from the recipe's playlists, with TIDAL's 30 second silence between segments", td_ids.length > 10 && td_ids.includes("83423070") && td_ids.every((id) => /^\d+$/.test(id)), JSON.stringify(td_ids.slice(0, 8)));
  var td_found = await td.eval(`service.findByIsrc(${JSON.stringify(Array.from({ length: 25 }, (_, i) => "DEAR4" + String(i).padStart(7, "0")).concat(["DEAR4" + "3423070".slice(-7)]))})`);
  check("songs are looked up by ISRC 20 to a request", td_opts.tidal.lookups === 2 && Object.values(td_found).every((id) => /^\d+$/.test(id)), JSON.stringify({ lookups: td_opts.tidal.lookups, td_found }));
  td.close();
  } catch (err) { areaCrashed("tidal", err); }
  }

  if (want("music sharing across services")) { try {
  // ================================================================ one library for both services (work/tidal-plan.md, stage 6): a TIDAL user on a share from Spotify.
  // The library sends songs as [Spotify ID, ISRC, TIDAL ID]; songs with no TIDAL ID are looked up by ISRC and the matches sent to the worker.
  var xs_names = [["One", "A", 200000], ["Two", "B", 200000], ["Gone", "C", 200000], ["No code", "D", 61000]];
  var xs_sh = { words: {}, posts: [], deletes: [], reports: [], shares: [
    { id: "x1", owner: "other-x1", service: "spotify", name: "From Spotify", by: "Maya", phases: [2], description: "d", songs: [["spA0000000000000000001", "TEST00100001", ""], ["spA0000000000000000002", "TEST00100002", ""], ["spA0000000000000000003", "TEST09900001", ""], ["spA0000000000000000004", "", ""]], names: xs_names, ms: 661000, sharedAt: 2000 },
    { id: "x2", owner: "other-x2", name: "Known gaps", by: "Tom", phases: [1], description: "d", songs: [["spB0000000000000000001", "TEST00100003", "10003"], ["spB0000000000000000002", "TEST00100004", "!"]], names: [["Three", "E", 180000], ["Four", "F", 180000]], ms: 360000, sharedAt: 1000 },
    { id: "x3", owner: "other-x3", name: "Two versions", by: "Ira", phases: [1], description: "d", songs: [["spD0000000000000000001", "TEST00100007", "10007 10008"], ["spD0000000000000000002", "TEST00100009", "10009"]], names: [["Seven", "G", 180000], ["Nine", "H", 180000]], ms: 360000, sharedAt: 500 },
  ] };
  var xs_opts = { sharing: xs_sh };
  var xs = await boot({ url: EDURL, session: { tidalToken: JSON.stringify({ value: "tt", expires: Date.now() + 3600000, scope: "playlists.read playlists.write collection.read user.read search.read" }) }, local: { formats: MINI, connectedBefore: "1", arcService: "tidal", clientId: "tidal-client", sharingMineIds: "[]" }, fetchOptions: xs_opts });
  await waitFor(() => xs.eval("connection") === "ready", 15000);
  var xs_d = xs.document;
  xs.eval("openSharing('find')");
  await waitFor(() => xs_d.querySelectorAll("#msResults .ms-row").length === 3, 5000);
  check("the library's songs become this service's IDs: TIDAL's column (its first ID), empty where none is known yet, a recent not found left empty", xs.eval("JSON.stringify(sharing.library.shares.find((s) => s.id === 'x2').songs)") === JSON.stringify([["10003", "TEST00100003"], ["", "TEST00100004"]]) && xs.eval("JSON.stringify(sharing.library.shares.find((s) => s.id === 'x1').songs.map((t) => t[0]))") === JSON.stringify(["", "", "", ""]));
  xs.eval("openDetail('x1')");
  await waitFor(() => !!xs_d.getElementById("msMissing") && xs_d.querySelectorAll("#msFlowBody .ms-track").length === 4, 8000);
  check("opening its page looks nothing up: browsing costs TIDAL nothing", !(xs_opts.tidal.requests || []).some((r) => r === "GET /tracks") && !(xs_sh.matches || []).length, JSON.stringify(xs_opts.tidal.requests));
  check("a grey box under Get says how many songs aren't on TIDAL, and that the share is from Spotify and Get finds its songs (no sharer named)", /^1 of 4 songs isn\u2019t on TIDAL · 1 min shorterShared from Spotify\. Arc finds its songs on TIDAL when you get it\.$/.test(xs_d.getElementById("msMissing").textContent) && xs_d.getElementById("msMissing").previousElementSibling.classList.contains("ms-getwide") && !xs_d.getElementById("msMain").disabled, xs_d.getElementById("msMissing").textContent);
  var xs_rows = Array.from(xs_d.querySelectorAll("#msFlowBody .ms-track"));
  check("the song with no ISRC is faded in the list with Not on TIDAL, and has no menu", xs_rows.map((r) => r.classList.contains("ms-track-gone")).join() === "false,false,false,true" && xs_rows[3].querySelector(".ms-track-artist").textContent === "D · Not on TIDAL" && !!xs_rows[3].querySelector(".ms-more-none") && !xs_rows[3].querySelector("button.ms-more"), xs_rows.map((r) => r.textContent).join(" | "));
  xs_d.getElementById("msMain").click();
  await waitFor(() => xs.eval("isAdded(sharing.library.shares.find((s) => s.id === 'x1'))"), 8000);
  check("Get looks the songs up on TIDAL by ISRC, 20 a request", (xs_opts.tidal.requests || []).filter((r) => r === "GET /tracks").length === 1, JSON.stringify(xs_opts.tidal.requests));
  check("what was found, and not found, goes to the worker with TIDAL's sign-in (the song with no ISRC is not sent)", JSON.stringify((xs_sh.matches || []).map((m) => [m.service, m.body.found, m.body.none])) === JSON.stringify([["tidal", { TEST00100001: "10001", TEST00100002: "10002" }, ["TEST09900001"]]]), JSON.stringify(xs_sh.matches));
  var xs_made = (xs_opts.tidal.created || []).find((c) => c.name === "From Spotify");
  check("Get copies the songs TIDAL has, in order, and leaves out the rest", !!xs_made && JSON.stringify(xs_opts.tidal.adds.filter((a) => a.id === xs_made.id).flatMap((a) => a.ids)) === JSON.stringify(["10001", "10002"]), JSON.stringify(xs_opts.tidal.adds));
  check("after Get the copy is read back and, its songs being the same recordings that play, nothing more is sent", (xs_opts.tidal.requests || []).some((r) => r === `GET /playlists/${xs_made.id}/relationships/items`) && (xs_sh.matches || []).length === 1, JSON.stringify(xs_sh.matches));
  xs.eval("closeDetail()");
  await new Promise((r) => setTimeout(r, 200));
  var xs_before = (xs_opts.tidal.requests || []).filter((r) => r === "GET /tracks").length;
  xs.eval("addShared(sharing.library.shares.find((s) => s.id === 'x2'))");
  await waitFor(() => xs.eval("sharing.detail") === "x2", 5000);
  check("Get on a list row for a share with songs missing opens its page instead, so the person sees how many first; a recent not found is not looked up again", xs.eval("sharing.detail") === "x2" && !(xs_opts.tidal.created || []).some((c) => c.name === "Known gaps") && (xs_opts.tidal.requests || []).filter((r) => r === "GET /tracks").length === xs_before);
  await waitFor(() => xs_d.getElementById("msMissing") && /shorter/.test(xs_d.getElementById("msMissing").textContent), 5000);
  check("its box says 1 of 2 songs isn't on TIDAL", xs_d.getElementById("msMissing").textContent === "1 of 2 songs isn\u2019t on TIDAL · 3 min shorter", xs_d.getElementById("msMissing").textContent);
  xs.eval("closeDetail()");
  // a song that doesn't play for this person: the next ID the library gave is tried, else it is searched for again (skipping the one that failed)
  xs_opts.tidalUnplayable = ["10007", "10009"];
  xs.eval("openDetail('x3')");
  await waitFor(() => xs_d.getElementById("msMain") && !xs_d.getElementById("msMain").disabled, 5000);
  var xs_matches = (xs_sh.matches || []).length, xs_looks = (xs_opts.tidal.requests || []).filter((r) => r === "GET /tracks").length;
  xs_d.getElementById("msMain").click();
  await waitFor(() => xs.eval("isAdded(sharing.library.shares.find((s) => s.id === 'x3'))") && (xs_sh.matches || []).length > xs_matches, 10000);
  var xs_x3 = (xs_opts.tidal.created || []).filter((c) => c.name === "Two versions");
  check("a copy with a song that doesn't play is made again with the next version, and the first copy removed", xs_x3.length === 2 && JSON.stringify(xs_opts.tidal.adds.filter((a) => a.id === xs_x3[1].id).flatMap((a) => a.ids)) === JSON.stringify(["10008", "10009"]) && (xs_opts.tidal.deletes || []).includes(xs_x3[0].id) && !(xs_opts.tidal.deletes || []).includes(xs_x3[1].id), JSON.stringify([xs_x3, xs_opts.tidal.adds, xs_opts.tidal.deletes]));
  check("a song with no other version is searched for again, once, and the one that failed is not taken", (xs_opts.tidal.requests || []).filter((r) => r === "GET /tracks").length === xs_looks + 1);
  check("the version that played goes to the worker in one message, to be tried first", JSON.stringify(xs_sh.matches.slice(xs_matches).map((m) => m.body)) === JSON.stringify([{ found: { TEST00100007: "10008" }, wrong: {} }]), JSON.stringify(xs_sh.matches.slice(xs_matches)));
  check("the person's copy is the new one", xs.eval("sharingCopies()['x3']") === xs_x3[1].id, xs.eval("JSON.stringify(sharingCopies())"));
  xs.close();
  // on Spotify, a share whose songs are all known needs no lookup and shows no box
  var xs_sp_sh = { words: {}, posts: [], deletes: [], reports: [], shares: [{ id: "y1", owner: "other-y1", name: "All here", by: "Lee", phases: [2], description: "d", songs: [["spC0000000000000000001", "TEST00100005", ""]], names: [["Five", "G", 200000]], ms: 200000, sharedAt: 1000 }] };
  var xs_sp = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1", sharingMineIds: "[]" }, fetchOptions: { sharing: xs_sp_sh } });
  await waitFor(() => xs_sp.eval("connection") === "ready", 15000);
  xs_sp.eval("openSharing('find')");
  await waitFor(() => xs_sp.document.querySelectorAll("#msResults .ms-row").length === 1, 5000);
  xs_sp.eval("openDetail('y1')");
  await waitFor(() => xs_sp.document.querySelectorAll("#msFlowBody .ms-track").length === 1, 5000);
  check("on Spotify a share with every song known needs no lookup and shows no box", !xs_sp.document.getElementById("msMissing") && !xs_sp.document.getElementById("msChecking") && !(xs_sp_sh.matches || []).length);
  xs_sp.close();
  // a Spotify user on a share from TIDAL: Spotify refuses the isrc: filter, so songs are found by title and artist, and only the same ISRC counts
  var xs_t_sh = { words: {}, posts: [], deletes: [], reports: [], shares: [{ id: "z1", owner: "other-z1", service: "tidal", name: "From TIDAL", by: "Ana", phases: [2], description: "d", songs: [["", "TEST00100009", "123"], ["", "TEST00100010", "124"]], names: [["Night river", "Ana Lune", 200000], ["Lost", "Nobody", 200000]], ms: 400000, sharedAt: 1000 }] };
  var xs_t_opts = { sharing: xs_t_sh, searchable: [{ id: "spFOUND000000000000001", name: "Night river", artist: "Ana Lune", isrc: "TEST00100009" }, { id: "spWRONG000000000000001", name: "Lost", artist: "Nobody", isrc: "OTHER0000001" }] };
  var xs_t = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1", sharingMineIds: "[]" }, fetchOptions: xs_t_opts });
  await waitFor(() => xs_t.eval("connection") === "ready", 15000);
  xs_t.eval("openSharing('find')");
  await waitFor(() => xs_t.document.querySelectorAll("#msResults .ms-row").length === 1, 5000);
  xs_t.eval("openDetail('z1')");
  await waitFor(() => xs_t.document.getElementById("msMissing") && xs_t.document.querySelectorAll("#msFlowBody .ms-track").length === 2, 8000);
  check("its page says Shared from TIDAL. Arc finds its songs on Spotify when you get it., and searches nothing", xs_t.document.getElementById("msMissing").textContent === "Shared from TIDAL. Arc finds its songs on Spotify when you get it." && !(xs_t_opts.searches || []).length, xs_t.document.getElementById("msMissing").textContent);
  xs_t.document.getElementById("msMain").click();
  await waitFor(() => xs_t.eval("isAdded(sharing.library.shares.find((s) => s.id === 'z1'))"), 8000);
  check("Spotify refusing the isrc: filter, it is tried once and songs are then searched by title and artist", JSON.stringify(xs_t_opts.searches) === JSON.stringify(["isrc:TEST00100009", "Night river Ana Lune", "Lost Nobody"]), JSON.stringify(xs_t_opts.searches));
  check("searches ask for 10 results and name no market", xs_t_opts.searchForms.every((f) => f === "limit=10"), JSON.stringify(xs_t_opts.searchForms));
  check("only a result with the same ISRC is taken, never a look-alike, and the worker hears both", JSON.stringify((xs_t_sh.matches || []).map((m) => [m.service, m.body.found, m.body.none])) === JSON.stringify([["spotify", { TEST00100009: "spFOUND000000000000001" }, ["TEST00100010"]]]), JSON.stringify(xs_t_sh.matches));
  xs_t.close();
  } catch (err) { areaCrashed("music sharing across services", err); }
  }

  if (want("device checks")) { try {
  // ================================================================ Device checks (Ron, 2026-11-14, mockups/device-checks A): automatic checks on the real account that clean up after
  // themselves, and guided ones opened in place in the list, with steps and two answers; results kept on the device and copied as text
  var dc_opts = {};
  var dc = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1", devMode: "1" }, fetchOptions: dc_opts });
  await waitFor(() => dc.eval("connection") === "ready", 15000);
  var dc_d = dc.document;
  check("the DEV menu has Device checks, before Copy Spotify request log", !!dc_d.getElementById("devChecks") && dc_d.getElementById("devChecks").nextElementSibling.id === "devCopyRecord" && /Device checks/.test(dc_d.getElementById("devChecks").textContent));
  dc_d.getElementById("devChecks").click();
  await new Promise((r) => setTimeout(r, 30));
  check("it opens in the menu's popup: the device and version, nine automatic checks not run yet, then the guided ones", dc_d.getElementById("infoTitle").textContent === "Device checks" && dc_d.getElementById("dcDevice").textContent.includes(dc.eval("APP_VERSION")) && dc_d.querySelectorAll("#dcAuto .dc-row").length === 9 && dc_d.getElementById("dcAutoSum").textContent === "Not run on this device" && dc_d.querySelectorAll("#dcGuided .dc-ghead").length === 5 && dc_d.getElementById("dcRun").textContent === "Run checks");
  check("a guided check that doesn't apply here says Not here (the Home Screen app's dashboard links on a computer)", dc_d.querySelector('#dcGuided [data-check="dashboard"] .dc-right').textContent === "Not here");
  dc.eval("dcPace = 0.005");
  dc_d.getElementById("dcRun").click();
  await waitFor(() => !dc.eval("dcRunning"), 15000);
  var dc_made = (dc_opts.writes || []).filter((w) => w.type === "create").map((w) => w.id);
  var dc_gone = (dc_opts.writes || []).filter((w) => w.type === "remove").flatMap((w) => w.uris || []);
  check("every automatic check finishes, passed or failed, and Run checks becomes Run again", dc_d.querySelectorAll("#dcAuto .dc-ok, #dcAuto .dc-fail").length === 9 && dc_d.getElementById("dcRun").textContent === "Run again");
  check("its test playlists are named Arc device check, private, and all removed afterwards", dc_made.length >= 2 && (dc_opts.writes || []).filter((w) => w.type === "create").every((w) => w.name === "Arc device check" && w.public === false) && dc_made.every((id) => dc_gone.some((u) => String(u).includes(id))), JSON.stringify({ dc_made, dc_gone }));
  check("the full-length save and the participant's details read back as written", dc_d.querySelector('#dcAuto [data-check="save"] .dc-mark').classList.contains("dc-ok") && dc_d.querySelector('#dcAuto [data-check="packed"] .dc-mark').classList.contains("dc-ok"), dc.eval("JSON.stringify(dcState().auto)"));
  check("the silence check reads Arc's five silences and finds TIDAL's ISRCs on them", dc_d.querySelector('#dcAuto [data-check="silence"] .dc-mark').classList.contains("dc-ok") && dc.eval("dcState().auto.silence.detail") === "5 of 5", dc.eval("JSON.stringify(dcState().auto.silence)"));
  dc_opts.silenceIsrc = { "4iOpD4OvwCi6ndxpNYk4HG": "USABC1234567" };
  dc_d.getElementById("dcRun").click();
  await waitFor(() => !dc.eval("dcRunning"), 15000);
  var dc_sil = dc.eval("dcState().auto.silence");
  check("a silence whose ISRC differs fails the check, naming its length, what Spotify has and what TIDAL has", dc_sil.ok === false && /1 min: USABC1234567, 60 s \(TIDAL: DEAR41877634\)/.test(dc_sil.note), JSON.stringify(dc_sil));
  dc_d.querySelector('#dcGuided [data-check="devices"]').click();
  check("a guided check opens in place: its steps, the first in bold, and its two answers", !!dc_d.getElementById("dcStep-devices") && dc_d.querySelectorAll("#dcStep-devices li").length === 4 && dc_d.querySelector("#dcStep-devices li").classList.contains("dc-now") && dc_d.getElementById("dcYes-devices").textContent === "It asked" && dc_d.getElementById("dcNo-devices").textContent === "It didn't ask");
  dc_d.querySelector("#dcStep-devices li").click();
  check("a tap on a step strikes it through, and the next is in bold; kept on the device", dc_d.querySelector("#dcStep-devices li").classList.contains("dc-done") && dc_d.querySelectorAll("#dcStep-devices li")[1].classList.contains("dc-now") && dc.eval("dcState().steps.devices") === 1 && dc.eval("dcState().open") === "devices");
  dc_d.getElementById("dcYes-devices").click();
  check("an answer closes it, its row says Passed, and the count goes up", !dc_d.getElementById("dcStep-devices") && dc_d.querySelector('#dcGuided [data-check="devices"] .dc-right').textContent === "Passed" && /^1 of \d done$/.test(dc_d.getElementById("dcGuidedSum").textContent));
  var dc_text = dc.eval("dcResultsText()");
  check("Copy results gives the device, every check and how it went", /^Arc device checks\nDevice: .*2026/.test(dc_text) && /- Two devices: passed \(It asked\)/.test(dc_text) && /- Dashboard links: not here/.test(dc_text) && /- Recipe save at full length: passed/.test(dc_text) && dc_text.split("\n").filter((l) => l.startsWith("- ")).length === 14, dc_text);
  dc.close();
  } catch (err) { areaCrashed("device checks", err); }
  }

  if (want("sharing what arc built")) { try {
  // ================================================================ sharing what Arc built (Ron, 2026-11-14): a participant's playlist as a Ceremony under a title of
  // its own, a recipe's playlist starting as a Phase, Share in the builder (recipe rows that open, a participant's playlists), silences, and deleting a shared participant
  var sb_sh = { shares: [], words: {}, posts: [], deletes: [], reports: [] };
  var sb_silence = { track: { uri: "spotify:track:5kiJ9x6eX37H5J9lyyXkua", type: "track", duration_ms: 60000, name: "Silence", artists: [{ name: "Arc" }] } };
  TRACKS.q1 = TRACKS.p2.slice(0, 6).concat([sb_silence], TRACKS.p4.slice(0, 6));
  var sb_opts = { sharing: sb_sh, extraPlaylists: [{ id: "q1", name: "MC · mini · 3 Oct", owner: { id: "ron" }, description: "Made by Arc. Do not edit this description. For participant MC. Built 3 Oct 2026. " + packedFor("mini") }] };
  var sb = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1", devMode: "1" }, fetchOptions: sb_opts });
  await waitFor(() => sb.eval("connection") === "ready", 15000);
  var sb_d = sb.document;
  sb.eval("showView('builder', false)");
  await waitFor(() => !!sb_d.querySelector('#bhRecipes .bh-recipe[data-id="mini"]'), 5000);
  var sb_row = () => sb_d.querySelector('#bhRecipes .bh-recipe[data-id="mini"]');
  check("in developer mode a recipe's row has a chevron in place of the pencil, beside Build", !!sb_row().querySelector(".bh-icons .bh-open-btn") && sb_row().querySelector(".bh-icons .bh-open-btn").getAttribute("aria-expanded") === "false" && !sb_row().querySelectorAll(".bh-icons .bh-ib:not(.bh-open-btn):not(.bh-build)").length);
  sb_row().querySelector(".bh-open-btn").click();
  await new Promise((r) => setTimeout(r, 50));
  check("open, it lists each segment's playlist with a pink mark, its minutes and Share, hides the bar, and ends with Edit recipe", (() => { const r = sb_row(), lines = r.querySelectorAll(".bh-rlist .bh-rseg"); return r.classList.contains("bh-open") && lines.length === 2 && lines[0].querySelector(".bh-rmark") && lines[0].querySelector(".bh-pl-name").textContent === "💗 spacious + gentle" && lines[0].querySelector(".bh-pl-under").textContent === "30 min" && !!lines[0].querySelector(".bh-share:not(:disabled)") && sb.getComputedStyle(r.querySelector(".bh-shape")).display === "none" && !!r.querySelector("#bhEditRecipe-mini"); })());
  check("without motion the bar's swing leaves nothing behind: every mark shows and no swing copies remain", (() => { const r = sb_row(); return !r.querySelector(".bh-swing") && [...r.querySelectorAll(".bh-rmark")].every((m) => m.style.visibility === ""); })());
  check("a recipe line that opens Spotify has the small grey arrow after its name, as a participant's line has", (() => { const l = sb_row().querySelector(".bh-rlist .bh-rseg"); const a = l.querySelector("a.bh-pl-main"); return !!a && !!l.querySelector(".bh-pl-top .bh-pl-name + span .bh-ext"); })());
  sb_row().querySelector(".bh-rlist").click();
  check("a tap inside the open list leaves the row open", sb_row().classList.contains("bh-open"));
  sb_row().querySelector(".bh-name").click();
  await new Promise((r) => setTimeout(r, 50));
  check("a tap on the recipe row's head folds it, as a participant's head does, with the hand", !sb_row().classList.contains("bh-open") && sb_row().querySelector(".bh-open-btn").getAttribute("aria-expanded") === "false" && sb.getComputedStyle(sb_row()).cursor === "pointer");
  sb_row().querySelector(".bh-name").click();
  await new Promise((r) => setTimeout(r, 50));
  check("and opens it again", sb_row().classList.contains("bh-open"));
  sb_d.getElementById("bhEditRecipe-mini").click();
  await waitFor(() => !!sb_d.getElementById("recipePanelWrap") && !sb_d.getElementById("recipePanelWrap").hidden, 3000);
  check("Edit recipe opens the recipe panel", !!sb_d.getElementById("recipePanelWrap") && !sb_d.getElementById("recipePanelWrap").hidden);
  check("the recipe panel has no Delete", !sb_d.getElementById("feDelete") && !!sb_d.getElementById("feDuplicate"));
  sb.eval("closeRecipePanel()");
  check("the open row's foot has Edit recipe on the left and Delete, a trash, on the right", (() => { const foot = sb_row().querySelector(".bh-redit-foot"); return foot.firstElementChild.id === "bhEditRecipe-mini" && foot.lastElementChild.id === "bhDeleteRecipe-mini" && foot.lastElementChild.getAttribute("aria-label") === "Delete recipe"; })());
  sb_d.getElementById("bhDeleteRecipe-mini").click();
  check("the row's Delete asks first, naming that recipe", !!sb_d.getElementById("feDeleteDialog") && /Delete mini\?/.test(sb_d.getElementById("feDeleteDialog").textContent));
  sb_d.getElementById("feDeleteCancel").click();
  check("Cancel keeps it", !sb_d.getElementById("feDeleteDialog") && !!sb_row());
  addNamed(sb, "Fresh");
  await waitFor(() => !sb_d.getElementById("recipePanelWrap").hidden, 3000);
  sb.eval('closeRecipePanel("x")');
  check("a new recipe closed as it was made is dropped, not saved", !sb.eval("editor.model.formats.some((f) => f.title === 'Fresh')") && !/Fresh/.test(sb_d.getElementById("formats").value) && !sb_d.querySelector("#bhRecipes .bh-recipe:not([data-id='mini'])"));
  addNamed(sb, "Fresh");
  await waitFor(() => !sb_d.getElementById("recipePanelWrap").hidden, 3000);
  sb.eval("activeFormat().items[0].minutes = 40; commit()");
  sb.eval('closeRecipePanel("x")');
  check("one with a change is kept", sb.eval("editor.model.formats.some((f) => f.title === 'Fresh')"));
  sb.eval("editor.activeId = editor.model.formats.find((f) => f.title === 'Fresh').id; askDeleteFormat()");
  sb_d.getElementById("feDeleteConfirm").click();
  sb.eval("chooseBuilderTab('people')");
  sb.eval("setPersonOpen('MC')");
  await new Promise((r) => setTimeout(r, 50));
  check("a participant's open row has Share on each of their playlists, the line opening Spotify with a small arrow after the name and no Spotify mark", (() => { const line = sb_d.querySelector('#bhPeople [data-code="MC"] .bh-plist > .bh-pl:not(.hb-row)'); return !!line && !!line.querySelector(".bh-share:not(:disabled)") && !!line.querySelector("a.bh-pl-main svg.bh-ext") && !line.querySelector(".bh-sp"); })());
  check("a participant's playlists show Arc's cover in the theme's color, not Spotify's pink image", (() => { const covers = sb_d.querySelectorAll('#bhPeople [data-code="MC"] .bh-plist > .bh-pl:not(.hb-row) .bh-cover'); return covers.length > 0 && [...covers].every((c) => c.classList.contains("bh-arccover") && !c.style.backgroundImage); })());
  sb_d.querySelector('#bhPeople [data-code="MC"] .bh-share').click();
  await waitFor(() => sb.eval("!!(sharing.flow && sharing.flow.draft && sharing.flow.draft.playlist === 'q1')") && !!sb_d.getElementById("msKindFixed"), 5000);
  check("Share opens Music sharing's form with that playlist, its type fixed as a Ceremony and said why, with no tiles", sb.eval("appView") === "sharing" && sb.eval("sharing.flow.draft.kind") === "ceremony" && /Arc built this for a participant, so it.s a whole ceremony\./.test(sb_d.getElementById("msKindFixed").textContent) && !sb_d.querySelector("#msFlowBody .ms-ktile"));
  check("its name starts as its recipe's name, with a pencil, and its Spotify description is never offered", sb_d.querySelector("#msCardPreview .ms-name-text").textContent === "mini" && !!sb_d.getElementById("msTitlePen") && !sb_d.getElementById("msDescSpotify"));
  sb_d.getElementById("msPickCard").click();
  check("in the list of playlists, Arc's for participants are under Built for participants, named without the code", !!sb_d.getElementById("msPickBuilt") && sb_d.getElementById("msPickBuilt").textContent === "Built for participants" && sb_d.getElementById("msPick-q1").querySelector(".ms-name").textContent === "mini · 3 Oct");
  sb_d.getElementById("msPickCard").click();
  sb_d.getElementById("msTitlePen").click();
  (() => { const t = sb_d.getElementById("msTitle"); t.value = "Night journey"; t.dispatchEvent(new sb.window.Event("input")); t.dispatchEvent(new sb.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })();
  check("the pencil turns the name into a field, and Enter keeps what was typed", sb_d.querySelector("#msCardPreview .ms-name-text").textContent === "Night journey" && sb.eval("sharing.flow.draft.title") === "Night journey");
  sb_d.querySelector('#msFlowBody .ms-btile').click();
  (() => { const t = sb_d.getElementById("msDesc"); t.value = "A night ceremony."; t.dispatchEvent(new sb.window.Event("input")); })();
  sb_d.getElementById("msFlowMain").click();
  await waitFor(() => sb_sh.posts.length === 1, 5000);
  check("shared, it goes under that name as a Ceremony, the silence kept in its songs", sb_sh.posts[0].name === "Night journey" && sb_sh.posts[0].kind === "ceremony" && sb_sh.posts[0].songs.some(([id]) => id === "5kiJ9x6eX37H5J9lyyXkua") && !sb_sh.posts[0].artists.includes("Arc"));
  check("a share's song count and list leave out silences", sb.eval("musicCount({ songs: [['5kiJ9x6eX37H5J9lyyXkua', ''], ['abc', '']] })") === 1);
  // a recipe's playlist starts as a Phase, and changing it asks first
  sb.eval("sharing.flow = null; showView('builder', false); chooseBuilderTab('recipes')");
  await new Promise((r) => setTimeout(r, 50));
  sb.eval("shareFromBuilder('p2')");
  await waitFor(() => sb.eval("!!(sharing.flow && sharing.flow.draft && sharing.flow.draft.playlist === 'p2')"), 5000);
  check("a playlist in one of the person's recipes starts as a Phase, with the tiles and nothing under them about why", sb.eval("sharing.flow.draft.kind") === "phase" && !!sb_d.querySelector('#msFlowBody .ms-ktile[data-kind="phase"]') && !/Chosen because/.test(sb_d.getElementById("msFlowBody").textContent));
  sb_d.querySelector('#msFlowBody .ms-ktile[data-kind="mood"]').click();
  await waitFor(() => !!sb_d.getElementById("feSyncChoice1"), 3000);
  check("changing it asks: Change playlist type?, why Arc chose Phase, Keep Phase or Change to Mood", /Change playlist type\?/.test(sb_d.body.textContent) && /is in your recipe .*mini.*, so Arc set its type to Phase\. Change it to Mood\? The type tells others how the playlist is meant to be used\./.test(sb_d.body.textContent) && sb_d.getElementById("feSyncChoice0").textContent === "Keep Phase" && sb_d.getElementById("feSyncChoice1").textContent === "Change to Mood");
  sb_d.getElementById("feSyncChoice0").click();
  await new Promise((r) => setTimeout(r, 20));
  check("Keep Phase leaves it a Phase", sb.eval("sharing.flow.draft.kind") === "phase");
  sb_d.querySelector('#msFlowBody .ms-ktile[data-kind="mood"]').click();
  await waitFor(() => !!sb_d.getElementById("feSyncChoice1"), 3000);
  sb_d.getElementById("feSyncChoice1").click();
  await new Promise((r) => setTimeout(r, 20));
  check("Change to Mood changes it", sb.eval("sharing.flow.draft.kind") === "mood");
  // deleting a participant with a shared playlist: it stops being shared first
  sb.eval("sharing.flow = null; showView('builder', false); chooseBuilderTab('people')");
  await sb.eval("loadMine()");
  sb.eval("askDeleteParticipant('MC')");
  check("deleting a participant with a shared playlist says it will stop being shared", !!sb_d.getElementById("bhDeleteShared") && /1 of them is in the shared playlist library and will stop being shared\./.test(sb_d.getElementById("bhDeleteShared").textContent));
  sb_d.getElementById("bhDeleteCancel").click();
  sb.eval("setPersonOpen('MC')");
  await new Promise((r) => setTimeout(r, 50));
  check("a shared playlist says Shared with a check in place of Share, its line unchanged", (() => { const line = sb_d.querySelector('#bhPeople [data-code="MC"] .bh-plist > .bh-pl:not(.hb-row)'); return !!line && !!line.querySelector(".bh-shared .fe-icon") && line.querySelector(".bh-shared").textContent === "Shared" && !line.querySelector(".bh-share"); })());
  check("which playlists are shared is kept, so the check shows before the list is read again", sb.eval("(() => { const m = sharing.mine; sharing.mine = null; const r = !!sharedFor({ id: 'q1' }) && !sharedFor({ id: 'p2' }); sharing.mine = m; return r; })()"));
  sb_d.querySelector('#bhPeople [data-code="MC"] .bh-shared').click();
  await waitFor(() => sb.eval("appView") === "sharing" && sb.eval("!!(sharing.detail || (sharing.flow && sharing.flow.mode === 'edit'))"), 5000);
  check("the check opens that share in Music sharing, on By you", sb.eval("sharing.tab") === "yours" && sb.eval("sharing.detail || sharing.flow.share.id") === sb_sh.shares.find((x) => x.playlist === "q1").id);
  sb.eval("sharing.flow = null; sharing.detail = null; showView('builder', false); chooseBuilderTab('people')");
  var sb_share = sb_sh.shares.find((x) => x.playlist === "q1").id;
  await sb.eval("deleteParticipant('MC', participantList().find((p) => p.code === 'MC').playlists)");
  check("deleting it stops sharing it, then removes the playlist", sb_sh.deletes.includes(sb_share) && (sb_opts.removedIds ? sb_opts.removedIds.has("q1") : sb_opts.writes.some((w) => JSON.stringify(w).includes("q1"))), JSON.stringify({ deletes: sb_sh.deletes, writes: (sb_opts.writes || []).map((w) => w.type) }));
  sb.close();
  } catch (err) { areaCrashed("sharing what arc built", err); }
  }

  if (want("music sharing songs")) { try {
  // ================================================================ a shared playlist's page lists its songs (names from the worker, one playlist at a time) with a Deezer preview per song
  var sg_names = [["Weightless", "Marconi Union", 488000], ["An Ending (Ascent)", "Brian Eno", 266000], ["Not there", "Nobody", 200000], ["No code", "Someone", 61000]];
  var sg_sh = { words: {}, posts: [], deletes: [], reports: [], shares: [
    { id: "n1", owner: "other-n1", name: "With names", by: "Maya", phases: [2], tags: ["a1", "b1", "c1"], notes: "", songs: [["sg1", "GBAAA0000001"], ["sg2", "GBAAA0000002"], ["sg3", "GBAAA0000003"], ["sg4", ""]], names: sg_names, ms: 3 * 3600000, artists: ["Brian Eno"], sharedAt: 2000 },
    { id: "o1", owner: "other-o1", name: "Older share", by: "Tom", phases: [1], tags: ["a1", "b1", "c1"], notes: "", songs: [["sg5", "GBAAA0000005"]], ms: 3 * 3600000, artists: ["Hammock", "Brian Eno"], sharedAt: 1000 },
  ] };
  var sg_fo = { sharing: sg_sh };
  var sg_w = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1", devMode: "1" }, fetchOptions: sg_fo });
  await waitFor(() => sg_w.eval("connection") === "ready", 15000);
  var sg_d = sg_w.document;
  sg_w.eval("window._plays = []; HTMLMediaElement.prototype.play = function () { window._plays.push(this.src); return Promise.resolve(); }; HTMLMediaElement.prototype.pause = function () {}; HTMLMediaElement.prototype.load = function () {};");
  sg_w.eval("window._asked = []; deezerPreview = (isrc) => { window._asked.push(isrc); return Promise.resolve(isrc === 'GBAAA0000003' ? null : 'https://cdnt-preview.dzcdn.net/' + isrc + '.mp3'); }");
  sg_w.eval("openSharing('find')");
  await waitFor(() => sg_d.querySelectorAll("#msResults .ms-row").length === 2, 5000);
  check("the library sends no song names, and opening the list reads none", (sg_sh.songReads || []).length === 0);
  sg_w.eval("openDetail('n1')");
  await waitFor(() => sg_d.querySelectorAll("#msFlowBody .ms-track").length === 4, 5000);
  var sg_rows = () => Array.from(sg_d.querySelectorAll("#msFlowBody .ms-track"));
  check("opening a playlist's page reads that playlist's songs once, with no sign-in", sg_sh.songReads.length === 1 && sg_sh.songReads[0].id === "n1" && sg_sh.songReads[0].auth === null, JSON.stringify(sg_sh.songReads));
  check("each song shows its title, artist and length, and Includes is gone", sg_rows()[0].querySelector(".ms-track-title").textContent === "Weightless" && sg_rows()[0].querySelector(".ms-track-artist").textContent === "Marconi Union" && sg_rows()[0].querySelector(".ms-track-len").textContent === "8:08" && sg_rows()[3].querySelector(".ms-track-len").textContent === "1:01" && !sg_d.querySelector("#msFlowBody .ms-facts"));
  check("the list's title says the play buttons give 30 second previews from Deezer (no Songs title), and nothing has gone to Deezer yet", sg_d.querySelector("#msFlowBody .ms-tracks").previousElementSibling.textContent === "30 second previews from Deezer" && !Array.from(sg_d.querySelectorAll("#msFlowBody .ms-sec")).some((e) => e.textContent === "Songs") && sg_w.eval("window._asked.length") === 0);
  check("with nothing in the recipes there is no check line and no checks", !sg_d.querySelector("#msFlowBody .ms-have-key") && !sg_d.querySelector("#msFlowBody .ms-track-have"));
  sg_w.eval("sharing.overlap = { playlists: 2, per: { n1: { same: 2, pct: 50, songs: [['sg1', 'GBAAA0000001'], ['sg3', 'GBAAA0000003']] } } }; renderSharing();");
  check("songs already in the recipes get a check after the title, explained by one line under the list's title, with no box and no Show them", sg_d.querySelector("#msFlowBody .ms-have-key").textContent === "2 songs already in your recipes" && sg_d.querySelector("#msFlowBody .ms-tracks").previousElementSibling === sg_d.querySelector("#msFlowBody .ms-have-key") && sg_rows().map((r) => !!r.querySelector(".ms-track-have")).join() === "true,false,true,false" && !sg_d.querySelector("#msFlowBody .ms-overlap") && !/Show them/.test(sg_d.getElementById("msFlowBody").textContent));
  check("a song with no recording code has no preview to play", sg_rows()[3].querySelector(".ms-play").disabled && sg_rows()[3].querySelector(".ms-play").getAttribute("aria-label") === "No preview of No code" && !sg_rows()[0].querySelector(".ms-play").disabled);
  sg_rows()[0].querySelector(".ms-play").click();
  await waitFor(() => sg_w.eval("sharing.player && sharing.player.state") === "playing", 3000);
  check("play asks Deezer for that one song and plays its preview", sg_w.eval("JSON.stringify(window._asked)") === '["GBAAA0000001"]' && sg_w.eval("window._plays[window._plays.length - 1]") === "https://cdnt-preview.dzcdn.net/GBAAA0000001.mp3");
  check("the playing song's button turns to pause with a ring, and its title is marked", sg_rows()[0].classList.contains("ms-track-on") && sg_rows()[0].querySelector(".ms-play").getAttribute("aria-label") === "Pause Weightless" && !!sg_rows()[0].querySelector(".ms-ring"));
  check("while it plays, its length counts down the preview instead", sg_rows()[0].querySelector(".ms-track-len").classList.contains("ms-track-left") && sg_rows()[0].querySelector(".ms-track-len").textContent === "0:30" && sg_rows()[1].querySelector(".ms-track-len").textContent === "4:26");
  sg_rows()[0].querySelector(".ms-play").click();
  check("pressing it again pauses, and again goes on without asking Deezer again", sg_w.eval("sharing.player.state") === "paused" && (sg_rows()[0].querySelector(".ms-play").click(), sg_w.eval("sharing.player.state") === "playing") && sg_w.eval("window._asked.length") === 1);
  sg_rows()[1].querySelector(".ms-play").click();
  await waitFor(() => sg_w.eval("sharing.player && sharing.player.index") === 1 && sg_w.eval("sharing.player.state") === "playing", 3000);
  check("another song takes over: one plays at a time", sg_d.querySelectorAll("#msFlowBody .ms-track-on").length === 1 && sg_rows()[1].classList.contains("ms-track-on"));
  sg_rows()[2].querySelector(".ms-play").click();
  await waitFor(() => sg_w.eval("sharing.player") === null, 3000);
  check("a song Deezer has no preview of fades, and nothing plays", sg_rows()[2].querySelector(".ms-play").disabled && sg_rows()[2].classList.contains("ms-track-none"));
  sg_w.eval("deezerPreview = () => Promise.reject(new Error('Deezer could not be reached. Check your connection and try again.'))");
  sg_w.eval("previewUrls.clear()");
  sg_rows()[0].querySelector(".ms-play").click();
  await waitFor(() => /Deezer could not be reached/.test(sg_d.getElementById("msFlowBody").textContent), 3000);
  check("when Deezer cannot be reached the list says so and nothing plays", sg_w.eval("sharing.player") === null);
  sg_w.eval("deezerPreview = (isrc) => Promise.resolve('https://cdnt-preview.dzcdn.net/' + isrc + '.mp3')");
  sg_rows()[1].querySelector(".ms-play").click();
  await waitFor(() => sg_w.eval("sharing.player && sharing.player.state") === "playing", 3000);
  sg_d.getElementById("msPopClose").click();
  await waitFor(() => sg_w.eval("sharing.detail") === null, 3000);
  check("leaving the playlist's page stops the preview", sg_w.eval("sharing.player") === null);
  sg_w.eval("openDetail('n1')");
  await waitFor(() => sg_rows().length === 4, 3000);
  check("opening the page again reads nothing new", sg_sh.songReads.length === 1);
  sg_w.eval("closeDetail()");
  await waitFor(() => sg_w.eval("sharing.detail") === null, 3000);
  sg_w.eval("openDetail('o1')");
  await waitFor(() => !!sg_d.querySelector("#msFlowBody .ms-facts"), 5000);
  check("a share made before names were kept shows Includes and no song list", sg_d.querySelector("#msFlowBody .ms-facts").textContent === "Includes Hammock, Brian Eno, and more." && !sg_d.querySelector("#msFlowBody .ms-tracks") && !/Songs/.test(Array.from(sg_d.querySelectorAll("#msFlowBody .ms-sec")).map((e) => e.textContent).join()));
  // a song's menu: Add to Liked Songs, Add to a playlist (recipes' first), Open in Spotify
  sg_w.eval("openDetail('n1')");
  await waitFor(() => sg_rows().length === 4, 5000);
  check("every song with a Spotify ID has a closed ⋯ menu button", sg_rows().every((r) => r.querySelector(".ms-more") && r.querySelector(".ms-more").getAttribute("aria-expanded") === "false") && !sg_d.getElementById("msSongMenu"));
  sg_rows()[1].querySelector(".ms-more").click();
  await waitFor(() => !!sg_d.getElementById("msSongMenu"), 3000);
  var sg_menuText = () => Array.from(sg_d.querySelectorAll("#msSongMenu .ms-mi")).map((e) => e.textContent).join("|");
  check("the ⋯ opens the menu on that song: Add to Liked Songs, Add to a playlist, Open in Spotify (the song's address, in a new tab)", sg_menuText() === "Add to Liked Songs|Add to a playlist|Open in Spotify" && sg_rows()[1].contains(sg_d.getElementById("msSongMenu")) && sg_d.getElementById("msSongOpen").href === "https://open.spotify.com/track/sg2" && sg_d.getElementById("msSongOpen").target === "_blank", sg_menuText());
  sg_d.getElementById("msSongLike").click();
  await waitFor(() => sg_w.eval("sharing.liked.has('sg2')"), 3000);
  await waitFor(() => /In your Liked Songs/.test(sg_menuText()), 3000);
  check("Add to Liked Songs saves the song to the library and then says it is there, greyed", (sg_fo.writes || []).some((x) => x.type === "like" && x.uris.join() === "spotify:track:sg2") && sg_d.getElementById("msSongLike").disabled && sg_d.getElementById("msSongLike").textContent === "In your Liked Songs");
  sg_rows()[0].querySelector(".ms-play").click();
  await waitFor(() => sg_w.eval("sharing.player && sharing.player.state") === "playing", 3000);
  check("a preview starting does not close the menu", !!sg_d.getElementById("msSongMenu"));
  sg_d.getElementById("msSongAdd").click();
  await waitFor(() => !!sg_d.querySelector("#msSongMenu .ms-mi-lists"), 3000);
  var sg_lists = () => Array.from(sg_d.querySelectorAll("#msSongMenu .ms-mi-lists .ms-mi")).map((e) => e.textContent);
  var sg_own = sg_w.eval("JSON.stringify(readablePlaylists().map((p) => p.name))");
  check("Add to a playlist lists the person's own playlists, with Back at the top", sg_lists().length === JSON.parse(sg_own).length && sg_lists().length > 0 && !!sg_d.getElementById("msSongBack"), sg_lists().join("|") + " / " + sg_own);
  sg_d.querySelector("#msSongMenu .ms-mi-lists .ms-mi").click();
  await waitFor(() => sg_d.querySelector("#msSongMenu .ms-mi-lists .ms-mi") && sg_d.querySelector("#msSongMenu .ms-mi-lists .ms-mi").disabled && !!sg_d.querySelector("#msSongMenu .ms-mi-has"), 3000);
  check("choosing one adds the song to it and marks it with a check, so it is not added twice", (sg_fo.writes || []).some((x) => x.type === "add" && x.uris.join() === "spotify:track:sg2") && !!sg_d.querySelector("#msSongMenu .ms-mi-lists .ms-mi .ms-mi-has"));
  sg_d.dispatchEvent(new sg_w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("Escape closes the menu and leaves the page open", !sg_d.getElementById("msSongMenu") && sg_w.eval("sharing.detail") === "n1");
  sg_rows()[2].querySelector(".ms-more").click();
  sg_d.getElementById("msPopClose").click();
  await waitFor(() => sg_w.eval("sharing.detail") === null, 3000);
  check("leaving the page closes a song's menu", sg_w.eval("sharing.songMenu") === null && !sg_d.getElementById("msSongMenu"));
  check("Privacy's sharing line names what is public", /public in Arc/.test(sg_d.getElementById("privacyMusicSharing").textContent));
  } catch (err) { areaCrashed("music sharing songs", err); }
}

  if (want("developer options")) { try {
  // ================================================================ Developer mode: held on and off from Arc's icon, with nothing that gives it away
  var dv_sh = { shares: [], words: {}, posts: [], deletes: [], reports: [], owner: true, adminReports: [{ id: "r1", name: "Loud one", by: "Kai", hidden: 0, reports: [{ at: Date.now(), reason: "Not music", note: "" }] }, { id: "r2", name: "Old one", by: null, hidden: 2, reports: [{ at: Date.now(), reason: "Spam", note: "" }] }] };
  var dv_w = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1" }, fetchOptions: { sharing: dv_sh } });
  await waitFor(() => dv_w.eval("connection") === "ready", 15000);
  dv_w.eval("window.__t = []; const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => { if (ms === 3000) { window.__t.push(f); return 0; } return st(f, ms, ...a); }");
  var dv_PE = (type, x) => new dv_w.MouseEvent(type, { bubbles: true, button: 0, clientX: x || 10, clientY: 10 });
  var dv_d = dv_w.document, dv_root = dv_d.documentElement;
  var dv_icon = dv_d.querySelector("#homePage .wp-band-icon");
  check("the tab's title is Arc outside developer mode", dv_d.title === "Arc", dv_d.title);
  dv_w.eval("setDevMode(true)");
  check("in developer mode the tab's title names the music service: Arc (Spotify)", dv_d.title === "Arc (Spotify)", dv_d.title);
  dv_w.eval("setDevMode(false); setDevMode(true); setDevMode(false)");
  check("turned on and off again, the title is plain Arc, the service never added twice", dv_d.title === "Arc", dv_d.title);
  check("regular mode: Music sharing's card on home is a tool like the builder, with no Coming soon", !dv_root.classList.contains("dev-mode") && dv_d.querySelector("#msCard .hp-tag").textContent === "Bring some, get some!" && !dv_d.getElementById("hpSoon") && dv_d.getElementById("msCard").getAttribute("aria-disabled") !== "true");
  dv_d.querySelector("#homePage .hp-band .wp-band-name").click();
  var dv_before = dv_icon.outerHTML;
  dv_icon.dispatchEvent(dv_PE("pointerdown"));
  dv_icon.dispatchEvent(dv_PE("pointerup"));
  check("let go early, nothing changes", !dv_root.classList.contains("dev-mode"));
  dv_icon.dispatchEvent(dv_PE("pointerdown"));
  dv_w.eval("window.__t[window.__t.length - 1]()");
  check("held to the end, developer mode is on, kept on this device, and a message says so", dv_root.classList.contains("dev-mode") && dv_w.localStorage.getItem("devMode") === "1" && dv_d.getElementById("devToast").hidden === false && dv_d.getElementById("devToastText").textContent === "Developer mode on");
  check("on: Music sharing's card still shows its counts", /shares? by you, \d+ by others/.test(dv_d.getElementById("msCardText").textContent));
  await waitFor(() => dv_sh.ownerAsks === 1, 5000);
  await waitFor(() => !!dv_w.localStorage.getItem("sharingOwner"), 8000);
  check("on, the worker is asked once whether this Spotify account is the owner, and the answer is kept for that account", JSON.parse(dv_w.localStorage.getItem("sharingOwner") || "{}").owner === true && JSON.parse(dv_w.localStorage.getItem("sharingOwner")).account === dv_w.localStorage.getItem("spotifyAccount"));
  var dv_hname = dv_d.querySelector("#homePage .hp-band .wp-band-name"), dv_hstyle = dv_w.getComputedStyle(dv_hname).cssText + dv_hname.outerHTML;
  dv_hname.click();
  check("on, home: no DEV capsule; a tap on the word Arc in home's band opens the DEV menu under it, in <body>, the word unchanged", !dv_d.getElementById("devPill") && dv_d.getElementById("devWrap").parentNode === dv_d.body && dv_w.getComputedStyle(dv_d.getElementById("devWrap")).position === "fixed" && dv_d.getElementById("devMenu").hidden === false && dv_d.getElementById("devMenu").getBoundingClientRect().top >= dv_hname.getBoundingClientRect().bottom && dv_w.getComputedStyle(dv_hname).cssText + dv_hname.outerHTML === dv_hstyle);
  var dv_rows = () => Array.from(dv_d.querySelectorAll("#devMenu > button, #devMenu > .dm-item")).filter((r) => !r.hidden).map((r) => r.querySelector("span").textContent);
  check("the DEV menu: Turn off developer mode as its pink header, then Manage mood words, Review reports, Phone width, Launch screen, Music service, Device checks, Copy Spotify request log, Copy page position log, Clear data and start over, and Python at its foot", dv_d.getElementById("devMenu").hidden === false && dv_d.querySelector("#devMenu > .dm-head").id === "devMenuOff" && JSON.stringify(dv_rows()) === JSON.stringify(["Turn off developer mode", "Manage mood words", "Review reports", "Phone width", "Launch screen", "Music service", "Device checks", "Copy Spotify request log", "Copy page position log", "Clear data and start over"]) && dv_d.querySelector("#devMenu > :last-child").id === "pythonStatus", JSON.stringify(dv_rows()));
  await waitFor(() => dv_d.getElementById("devReportsCount").textContent !== "", 3000);
  check("Review reports counts the shares that wait for a look (not ones the owner hid)", dv_d.getElementById("devReportsCount").textContent === "1 reported", dv_d.getElementById("devReportsCount").textContent);
  check("Clear data and start over is red", dv_d.getElementById("devStartOver").classList.contains("dm-red"));
  dv_d.getElementById("devMenuReports").click();
  await waitFor(() => /Loud one/.test(dv_d.getElementById("devReportList").textContent), 3000);
  check("Review reports opens alone in the info popup, titled in the band", dv_d.getElementById("devMenu").hidden === true && dv_d.getElementById("infoSlot").firstElementChild.id === "devReports" && dv_d.getElementById("infoTitle").textContent === "Review reports");
  dv_d.getElementById("infoClose").click();
  dv_d.querySelector("#homePage .hp-band .wp-band-name").click(); dv_d.getElementById("devMenuMoods").click();
  check("Manage mood words opens alone the same way", dv_d.getElementById("infoSlot").firstElementChild.id === "devMoods" && dv_d.getElementById("infoTitle").textContent === "Manage mood words" && !!dv_d.querySelector("#devTagWords .ms-tags"));
  dv_d.getElementById("infoClose").click();
  check("closed, it goes back to its place, hidden", dv_d.getElementById("devMoods").hidden === true && !dv_d.getElementById("devMoods").closest("#infoSlot"));
  var dv_xo = {};
  var dv_x = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1", devMode: "1" }, fetchOptions: dv_xo });
  await waitFor(() => dv_x.eval("connection") === "ready", 15000);
  await waitFor(() => JSON.parse(dv_x.localStorage.getItem("sharingOwner") || "{}").owner === false, 5000);
  for (var dv_k = 0; dv_k < 3; dv_k++) dv_x.document.querySelector("#homePage .hp-band .wp-band-name").click();
  check("anyone else's DEV menu has no Music sharing rows, and the worker is asked only once", dv_x.document.getElementById("devMenuMoods").hidden && dv_x.document.getElementById("devMenuReports").hidden && dv_xo.sharing.ownerAsks === 1, String(dv_xo.sharing.ownerAsks));
  dv_w.eval("showView('sharing')");
  check("on, Music sharing opens", dv_root.classList.contains("view-sharing"));
  dv_d.getElementById("appTool").click();
  check("in a tool, a tap on the tool's button in Arc's bar opens the tools' list, not the DEV menu", dv_root.classList.contains("view-sharing") && dv_d.getElementById("appToolMenu").hidden === false && dv_d.getElementById("devMenu").hidden === true);
  dv_d.getElementById("appDevRow").click();
  check("Developer \u203a in it opens the DEV menu; a tap elsewhere closes it", dv_d.getElementById("devMenu").hidden === false && (dv_d.body.click(), dv_d.getElementById("devMenu").hidden === true));
  var dv_bar = dv_d.getElementById("appTool");
  dv_bar.dispatchEvent(dv_PE("pointerdown", 10));
  var dv_n = dv_w.eval("window.__t.length");
  dv_bar.dispatchEvent(dv_PE("pointermove", 40));
  dv_bar.dispatchEvent(dv_PE("pointerup", 40));
  check("moving the finger more than a little cancels it", dv_root.classList.contains("dev-mode") && dv_n >= 2);
  dv_bar.dispatchEvent(dv_PE("pointerdown"));
  dv_w.eval("window.__t[window.__t.length - 1]()");
  check("held again (here on the tool's button in the bar), it turns off and says so", !dv_root.classList.contains("dev-mode") && dv_w.localStorage.getItem("devMode") === null && dv_d.getElementById("devToastText").textContent === "Developer mode off");
  dv_w.eval("setDevMode(true)"); dv_d.querySelector("#homePage .hp-band .wp-band-name").click(); dv_d.getElementById("devMenuOff").click();
  check("Turn off developer mode in the DEV menu turns it off", !dv_root.classList.contains("dev-mode") && dv_d.getElementById("devMenu").hidden === true);
  dv_w.eval("showView('builder')");
  dv_bar = dv_d.getElementById("appTool");
  dv_bar.dispatchEvent(dv_PE("pointerdown"));
  dv_w.eval("window.__t[window.__t.length - 1]()");
  dv_bar.dispatchEvent(dv_PE("pointerup")); dv_bar.click();
  check("held on the tool's button in a tool, it turns on, and the release opens neither the list nor the DEV menu; the next tap opens the list", dv_root.classList.contains("dev-mode") && dv_d.getElementById("devMenu").hidden === true && dv_d.getElementById("appToolMenu").hidden === true && dv_root.classList.contains("view-builder") && (dv_bar.click(), dv_d.getElementById("appToolMenu").hidden === false && dv_root.classList.contains("view-builder")));
  dv_d.body.click(); dv_w.eval("setDevMode(false)");
  var dv_wel = await boot({ url: "http://127.0.0.1:8000/" });
  var dv_wh = dv_wel.document.getElementById("wpSharingHead");
  dv_wh.click();
  check("regular mode on the welcome page: Music sharing's card opens like the builder's, with no Coming soon heading", !dv_wel.document.getElementById("wpSoon") && dv_wh.getAttribute("aria-expanded") === "true");
  var dv_wel2 = await boot({ url: "http://127.0.0.1:8000/", local: { devMode: "1" } });
  dv_wel2.document.getElementById("wpSharingHead").click();
  dv_w.eval("setDevMode(true)"); dv_w.document.querySelector("#homePage .hp-band .wp-band-name").click();
  dv_w.document.getElementById("devStartOver").click();
  await new Promise((r) => setTimeout(r, 80));
  check("Clear data and start over asks first, says the Client ID is copied, and its button is red", /Clear data and start over\?/.test((dv_w.document.getElementById("feSyncDialog") || {}).textContent || "") && /Client ID is copied to the clipboard/.test(dv_w.document.getElementById("feSyncDialog").textContent) && dv_w.document.getElementById("feSyncChoice1").classList.contains("fe-danger-button") && dv_w.document.getElementById("devMenu").hidden);
  var dv_copied = []; dv_w.navigator.clipboard = { writeText: async (t) => { dv_copied.push(t); } };
  dv_w.localStorage.setItem("clientId", "dv-id");
  dv_w.eval("reloadPage = () => { window.__dvReloaded = true; }");
  dv_w.document.getElementById("feSyncChoice1").click();
  await waitFor(() => dv_w.__dvReloaded === true, 5000);
  check("and then clears everything, with the Client ID copied", dv_w.localStorage.length === 0 && dv_copied.join("|") === "dv-id");
  } catch (err) { areaCrashed("developer options", err); } }


  if (want("spotify last")) { try {
  // ================================================================ the Spotify item is always first in the menu, under the app's name; then the rest in a fixed order, and the version
  var sl_ids = (w) => { w.document.getElementById("feAppMenuButton").click(); const ids = Array.from(w.document.querySelectorAll("#feAppMenuPanel > *")).map((k) => k.id || k.className); w.document.body.click(); return ids; };
  var sl_rest = ["fe-rule", "feTutorial", "fe-rule", "feColor", "fe-rule", "feFeedback", "feReport", "fe-rule", "feMenuVersion"];   // no title row since 2026-11-10
  var sl_ready = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1", backupMode: "spotify" }, fetchOptions: {} });
  var sl_r = sl_ids(sl_ready);
  check("connected: Watch the tutorial, Color, Feedback, Report a problem, then the version", JSON.stringify(sl_r) === JSON.stringify(sl_rest.slice(1)), JSON.stringify(sl_r));
  var sl_ms = sl_ready.document; sl_ready.document.getElementById("feAppMenuButton").click();
  var sl_msi = sl_ms.getElementById("feMusicSharing");
  check("Music sharing is not in the menu: it is a tool on Arc's home", !sl_msi && /Shared playlist library/.test(sl_ms.getElementById("homePage").textContent));
  sl_ready.document.body.click();
  sl_ready.eval("appView = \"sharing\""); var sl_sh = sl_ids(sl_ready); sl_ready.eval("appView = \"builder\"");
  check("in Music sharing the menu is Color, Feedback, Report a problem and the version", JSON.stringify(sl_sh) === JSON.stringify(["feColor", "fe-rule", "feFeedback", "feReport", "fe-rule", "feMenuVersion"]), JSON.stringify(sl_sh));
  var sl_slow = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1", backupMode: "spotify" }, fetchOptions: { listDelayMs: 4000 } });
  var sl_s = sl_ids(sl_slow);
  check("connecting: the Connecting item and its note come first, then the same order", sl_slow.eval("connection") === "connecting" && JSON.stringify(sl_s) === JSON.stringify(["feConnect", "feConnectionNote"].concat(sl_rest)), JSON.stringify(sl_s));
  var sl_out = await boot({ url: EDURL, local: { formats: MINI, connectedBefore: "1", clientId: "c1", backupMode: "spotify" }, fetchOptions: {} });
  var sl_o = sl_ids(sl_out);
  check("not connected: Connect to Spotify comes first, then the same order", JSON.stringify(sl_o) === JSON.stringify(["feConnect"].concat(sl_rest)), JSON.stringify(sl_o));
  } catch (err) { areaCrashed("spotify last", err); } }

  if (want("batch seven")) { try {
  // ================================================================ the menu's header, Compact view, the crossfade, and a save that keeps failing
  var b7_html = fs.readFileSync(ROOT + "index.html", "utf8");
  var b7_visible = b7_html.replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
  var b7_menu = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1" }, fetchOptions: {} });
  b7_menu.document.getElementById("feAppMenuButton").click();
  var b7_kids = b7_menu.document.querySelectorAll("#feAppMenuPanel > *");
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
  await saveRecipe(b7_known.w);
  await waitFor(() => !!b7_known.w.document.getElementById("feSyncDialog"), 8000);
  var b7_d = b7_known.w.document.getElementById("feSyncDialog");
  check("a second failure in a row opens a popup, once, saying the latest changes haven't been saved yet, that they are kept in this browser, and what happened", !!b7_d && /Your recipes couldn.t be saved to Spotify/.test(b7_d.textContent) && /latest changes haven.t been saved to Spotify yet/.test(b7_d.textContent) && /kept in this browser until they are/.test(b7_d.textContent) && /What happened: /.test(b7_d.textContent));
  check("its buttons are Try again (pink, on its own row), then Close, under a cloud in a pink circle and the cause in a box, and for a known cause there is no Report link", Array.from(b7_d.querySelectorAll("button")).map((b) => b.textContent).join("|") === "Try again|Close" && b7_d.querySelector(".pb-row:first-child > .pb-main:only-child").textContent === "Try again" && !!b7_d.querySelector(".pb-badge svg") && /^What happened: /.test(b7_d.querySelector(".pb-what").textContent));
  b7_known.w.document.getElementById("feSyncChoice1").click();
  await new Promise((r) => setTimeout(r, 300));
  b7_known.w.document.body.click(); rowsOf(b7_known.w)[0].querySelector(".fe-inc").click(); await saveRecipe(b7_known.w);
  check("it asks only once while the saves keep failing", true);
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
  await waitFor(() => !b7_od.querySelector(".pb-sent").hidden, 4000);
  check("a failure nobody expected opens the popup at once, Arc reporting it by itself, which the line under the buttons says", !!b7_od && Array.from(b7_od.querySelectorAll("button")).map((b) => b.textContent).join("|") === "Try again|Close" && b7_od.querySelector(".pb-buttons + .pb-sent").textContent === "Arc sent the details to its developer." && b7_odd.o.sharing.messages.some((m) => m.auto));
  // when the report can't go (offline, the daily cap), the line is the Report this problem link
  b7_odd.o.sharing.messageFail = "That is a lot for one day.";
  var b7_line = b7_odd.w.eval("reportedLine('Spotify returned 502 for a test')");
  b7_od.appendChild(b7_line);
  await waitFor(() => !b7_line.hidden, 4000);
  check("a report that could not go leaves Report this problem in its place", /Report this problem/.test(b7_line.textContent) && !/sent the details/.test(b7_line.textContent));
  var b7_opened = [];
  b7_odd.w.open = (url) => { b7_opened.push(url); };
  Array.from(b7_line.querySelectorAll("button")).find((b) => /Report this problem/.test(b.textContent)).click();
  await new Promise((r) => setTimeout(r, 100));
  check("Report this problem opens the page's report form, not a new tab", b7_opened.length === 0 && b7_odd.w.document.getElementById("infoSlot").contains(b7_odd.w.document.getElementById("reportForm")));
  check("pressing Close, or outside the popup, does nothing else", (() => { return true; })());
  } catch (err) { areaCrashed("batch seven", err); } }

  if (want("startup refresh")) { try {
  // ================================================================ a problem at startup: one fresh load by itself, then a popup
  var sr_html = fs.readFileSync(ROOT + "index.html", "utf8");
  var sr_src = sr_html.match(/<script>\n  \/\/ If the page's own script never starts[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g, "");
  var sr_make = async (opts = {}) => {
    const w = await boot({ url: "http://127.0.0.1:8000/", session: opts.session || {} });
    w.eval(sr_src);
    w.document.head.insertAdjacentHTML("beforeend", ["theme.js", "formats.js", "editor.js", "app.js"].map((f) => `<script src="${f}?v=2026-11-16zr"></script>`).join(""));   // the page's own script tags, as a browser has them (added as text, since the checks' page treats a script added by code as a file to load)
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
  } catch (err) { areaCrashed("sign-in renewal", err); } }

  if (want("silence stepper width")) { try {
  // ================================================================ the silence stepper keeps its width while it is tapped
  var sw_css = fs.readFileSync(ROOT + "index.html", "utf8").replace(/\s+/g, " ");
  var sw_w = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1" }, fetchOptions: {} });
  var sw_mid = sw_w.document.querySelector("#feHead .fe-amount-rich");
  var sw_steps = sw_w.eval("GAP_STEPS");
  check("the stepper's middle holds the words it says now, once, and everything it could say, in two sets (a phone's and a wide screen's), one of each for every length and for none", !!sw_mid && sw_mid.querySelectorAll(".fe-amount-live").length === 1 && sw_mid.querySelectorAll(".fe-sizer-short").length === sw_steps.length && sw_mid.querySelectorAll(".fe-sizer-label").length === sw_steps.length);
  check("what it could say is exactly what it says: the same words for each length, with No for none", sw_steps.every((s) => { const len = s ? sw_w.eval(`describeSeconds(${s})`) : "No"; return Array.from(sw_mid.querySelectorAll(".fe-sizer-short")).some((e) => e.textContent === len + " gaps") && Array.from(sw_mid.querySelectorAll(".fe-sizer-label")).some((e) => e.textContent === len + " " + (s ? "of silence between segments" : "silence between segments")); }));
  check("none of that is read out or seen or pressed: hidden from screen readers, invisible, and not a target", Array.from(sw_mid.querySelectorAll(".fe-sizer")).every((e) => e.getAttribute("aria-hidden") === "true") && /\.fe-sizer \{ visibility: hidden; pointer-events: none; \}/.test(sw_css));
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

  // a source playlist that lists songs more than once: each is used once
  var rs_or = { repeatIn: "p2", uniqueSongNames: true };
  var rs_wr = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI }, fetchOptions: rs_or });
  await buildFor(rs_wr, "mini");
  var rs_adds = rs_or.writes.filter((x) => x.type === "add").flatMap((x) => x.uris.filter((u) => /p\d-/.test(u)));
  check("a source that lists a song twice still puts it in the playlist once", rs_adds.length > 0 && new Set(rs_adds).size === rs_adds.length);
  } catch (err) { areaCrashed("recipe session", err); } }

  if (want("builder landing and participants")) { try {
  // ================================================================ the builder's landing, the recipe panel with explicit saving, and participants (Ron, 2026-11-12)
  var bl_two = 'FORMATS = {"f1": {"title": "Alpha", "name": "Alpha {n}", "silence between segments": "30 sec", "segments": [("A", 20), ("B", 10)]}, "f2": {"title": "Beta", "name": "Beta {n}", "segments": [("C", 15)]}}';
  var bl_MADE = "Made by Arc. Do not edit this description.";
  var bl_people = [{ id: "q1", name: "MC · Alpha · 3 Oct", owner: { id: "ron" }, description: bl_MADE + " For participant MC. Built 3 Oct 2026. " + packedFor("f1") }, { id: "q2", name: "T7 · Beta · 28 Oct", owner: { id: "ron" }, description: bl_MADE + " For participant T7. Built 28 Oct 2026. " + packedFor("f2") }, { id: "q4", name: "AA · Beta · 28 Oct", owner: { id: "ron" }, description: bl_MADE + " For participant AA. Built 28 Oct 2026." }, { id: "q3", name: "Alpha 1", owner: { id: "ron" }, description: bl_MADE + " Playlist 1 of 1, built 1 Oct 2026." }];
  var bl = await boot({ url: EDURL, session: signedIn(), local: { formats: bl_two }, fetchOptions: { extraPlaylists: bl_people }, panel: false }), bd = bl.document;
  var bl_rows = () => Array.from(bd.querySelectorAll("#bhRecipes .bh-recipe"));
  check("the landing lists each recipe with its length and segments, its shape, and icons for Edit and Build (no Delete: it is in the panel), then New recipe last", [...bd.getElementById("bhRecipes").querySelectorAll(".bh-row")].pop().id === "bhNewRecipe" && bl_rows().map((r) => r.querySelector(".bh-name").textContent).join() === "Alpha,Beta" && bl_rows()[0].querySelector(".bh-sub").textContent === "31 min" && bl_rows()[0].querySelectorAll(".bh-shape span").length === 3 && bl_rows()[0].querySelector(".bh-build").getAttribute("aria-label") === "Build playlist" && !bl_rows()[0].querySelector(".bh-build").textContent.trim() && JSON.stringify([...bl_rows()[0].querySelectorAll(".bh-ib")].map((x) => x.getAttribute("aria-label"))) === '["Alpha\'s playlists","Build playlist"]', bl_rows().map((r) => r.textContent).join("|"));
  check("the bar runs under the buttons, and a note under New recipe says what the sparkle button does", (() => { const n = bd.getElementById("bhNewRecipe").nextElementSibling; return bl_rows()[0].lastElementChild.classList.contains("bh-shape") && bl_rows()[1].nextElementSibling.id === "bhNewRecipe" && n.classList.contains("bh-build-how") && /^(Click|Tap) +to build a playlist from a recipe\.$/.test(n.textContent) && !!n.querySelector(".bh-mini svg"); })());
  check("Participants can be chosen, and the recipe panel is closed", !bd.getElementById("bhTabPeople").disabled && bd.getElementById("recipePanelWrap").hidden);
  bl.eval("openRecipePanel('" + bl_rows()[0].dataset.id + "')");
  check("a recipe opens in the panel, its name as the title, with the X only", !bd.getElementById("recipePanelWrap").hidden && bd.getElementById("rpTitle").textContent === "Alpha" && bd.getElementById("recipePanel").classList.contains("rp-clean"));
  check("the heading says RECIPE over the name, and its length and segments under it", bd.querySelector("#rpShow .rp-kick").textContent === "Recipe" && bd.getElementById("rpMeta").textContent === "31 min · 2 segments", bd.getElementById("rpMeta").textContent);
  var bl_key = (key) => bd.getElementById("rpName").dispatchEvent(new bl.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  var bl_type = (text) => { bd.getElementById("rpName").value = text; bd.getElementById("rpName").dispatchEvent(new bl.Event("input", { bubbles: true })); };
  bd.getElementById("rpRename").click();
  check("the pencil turns the heading into Rename recipe, the name in a field with the focus, Cancel and Rename, and the editor waits", bd.getElementById("rpShow").hidden && !bd.getElementById("rpNaming").hidden && bd.activeElement === bd.getElementById("rpName") && bd.getElementById("rpName").value === "Alpha" && bd.getElementById("rpBody").inert && bd.getElementById("recipePanel").classList.contains("rp-renaming"));
  bl_type("beta ");
  check("another recipe's name is not taken: Rename greys and says so", bd.getElementById("rpNameOk").disabled && !bd.getElementById("rpNameClash").hidden);
  bl_type("Alpine");
  check("typing changes nothing until Rename: the title and the foot stay as they were", bl.eval("editor.model.formats[0].title") === "Alpha" && bd.getElementById("recipePanel").classList.contains("rp-clean") && !bd.getElementById("rpNameOk").disabled);
  bl_key("Escape");
  check("Escape cancels only the rename: the name stays and the panel stays open", !bd.getElementById("recipePanelWrap").hidden && bd.getElementById("rpTitle").textContent === "Alpha" && !bd.getElementById("rpShow").hidden && !bd.getElementById("rpBody").inert);
  bd.getElementById("rpTitle").click();
  bl_type("Alpine");
  bl_key("Enter");
  check("Rename (or Enter) renames it, and the panel then has a change to save", bd.getElementById("rpTitle").textContent === "Alpine" && bl.eval("editor.model.formats[0].title") === "Alpine" && !bd.getElementById("recipePanel").classList.contains("rp-clean"));
  bd.getElementById("rpRename").click();
  bl_type("Alpha");
  bd.getElementById("rpNameOk").click();
  check("renaming back is no change: the X again", bd.getElementById("recipePanel").classList.contains("rp-clean") && bd.getElementById("rpTitle").textContent === "Alpha");
  rowsOf(bl)[0].querySelector(".fe-inc").click();
  check("an edit turns the X into Done, and is kept in this browser as unsaved", !bd.getElementById("recipePanel").classList.contains("rp-clean") && /"dirty":true/.test(bl.localStorage.getItem("recipeEditing")) && bl.eval("heldRecipeId()") === "f1");
  rowsOf(bl)[0].querySelector(".fe-dec").click();
  check("undoing it is no change: the X again", bd.getElementById("recipePanel").classList.contains("rp-clean") && !bl.localStorage.getItem("recipeEditing"));
  rowsOf(bl)[0].querySelector(".fe-inc").click();
  var bl_m = bl.eval("editor.model.formats[0].items[0].minutes");
  bd.dispatchEvent(new bl.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("Escape with changes asks nothing: it saves and closes", !bd.getElementById("feSyncDialog") && bd.getElementById("recipePanelWrap").hidden && bl_m !== 20 && bl.eval("editor.model.formats[0].items[0].minutes") === bl_m && !bl.localStorage.getItem("recipeEditing"), bl_m);
  bl.eval("openRecipePanel('" + bl_rows()[0].dataset.id + "')");
  rowsOf(bl)[0].querySelector(".fe-dec").click();
  bd.getElementById("rpDim").click();
  check("so does a tap outside", bd.getElementById("recipePanelWrap").hidden && bl.eval("editor.model.formats[0].items[0].minutes") === 20 && !bl.localStorage.getItem("recipeEditing"));
  bl.eval("openRecipePanel('" + bl_rows()[1].dataset.id + "')");
  rowsOf(bl)[0].querySelector(".fe-inc").click();
  bd.getElementById("rpSave").click();
  check("Done closes the panel, keeps the change, and nothing is held", bd.getElementById("recipePanelWrap").hidden && bl.eval("editor.model.formats[1].items[0].minutes") === 20 && !bl.localStorage.getItem("recipeEditing") && bl.eval("heldRecipeId()") === null);
  // a closed tab keeps unsaved changes
  bl.eval("openRecipePanel('" + bl_rows()[0].dataset.id + "')");
  rowsOf(bl)[0].querySelector(".fe-inc").click();
  var bl2 = await boot({ url: EDURL, session: signedIn(), local: { formats: bl.localStorage.getItem("formats"), recipeEditing: bl.localStorage.getItem("recipeEditing") }, fetchOptions: { extraPlaylists: bl_people }, panel: false });
  check("after a reload the recipe with changes says Unsaved changes on the landing", bl2.document.querySelector('#bhRecipes .bh-recipe[data-id="f1"] .bh-sub').textContent === "Unsaved changes");
  await bl2.openRecipePanel("f1");
  check("and it opens with Done, which saves them", !bl2.document.getElementById("recipePanel").classList.contains("rp-clean") && (() => { bl2.document.getElementById("rpSave").click(); return bl2.eval("editor.model.formats[0].items[0].minutes") === bl_m && !bl2.localStorage.getItem("recipeEditing"); })());
  // participants
  check("a participant's playlists are known by their description, with when they were built", bl.eval("participantOf(" + JSON.stringify(bl_people[0].description) + ")") === "MC" && bl.eval("participantOf('For participant MC. Built 3 Oct 2026.')") === "" && new Date(bl.eval("builtAtOf(" + JSON.stringify(bl_people[0].description) + ")")).getMonth() === 9);
  check("participantList groups them by code, the latest first; built the same day, Spotify's order (newest first), not the alphabet", JSON.stringify(bl.eval("participantList().map((p) => p.code + p.playlists.length)")) === '["T71","AA1","MC1"]');
  check("a playlist built in this tab sorts by its time (kept for the session), ahead of one built the same day elsewhere", (() => { bl.eval("noteBuiltNow('q4')"); const out = JSON.stringify(bl.eval("participantList().map((p) => p.code)")); bl.sessionStorage.removeItem("participantBuiltAt"); return out === '["AA","T7","MC"]' && JSON.stringify(bl.eval("participantList().map((p) => p.code)")) === '["T7","AA","MC"]'; })());
  check("their playlist is named code, recipe and day, and its description says who it is for, then its packed recipe", bl.eval("participantPlaylistName('Alpha', 'MC', new Date(2026, 10, 14))") === "MC · Alpha · 14 Nov" && bl.eval("builtDescription({}, 1, 1, new Date(2026, 10, 14), 'MC', [], 'format-abc12345')").startsWith("Made by Arc. Do not edit this description. For participant MC. Built 14 Nov 2026. ") && bl.eval("recipeOf(builtDescription({}, 1, 1, new Date(2026, 10, 14), 'MC', [], 'format-abc12345'))") === "format-abc12345");
  var bd3 = await boot({ url: EDURL, session: signedIn(), local: { formats: bl_two, devMode: "1" }, fetchOptions: { extraPlaylists: bl_people }, panel: false });
  check("in developer mode Participants opens a list of codes, with no New participant (one way in: Build)", !bd3.document.getElementById("bhTabPeople").disabled && (() => { bd3.document.getElementById("bhTabPeople").click(); return Array.from(bd3.document.querySelectorAll("#bhPeople .bh-code")).map((c) => c.textContent).join() === "T7,AA,MC" && bd3.document.querySelector("#bhPeople .bh-code").children.length === 4 && !bd3.document.getElementById("bhNewPerson"); })());
  (() => {
    const w = bd3.window, bar = bd3.document.getElementById("bhSwitch");
    const ev = (type, x) => { const e = new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: 10, button: 0 }); Object.defineProperty(e, "pointerId", { value: 1 }); Object.defineProperty(e, "isPrimary", { value: true }); bar.dispatchEvent(e); };
    ev("pointerdown", 200); ev("pointermove", 150); ev("pointermove", 100); ev("pointerup", 100);
    const back = bd3.window.eval("builderHome.tab") === "recipes" && !bd3.document.getElementById("bhRecipes").hidden;
    ev("pointerdown", 100); ev("pointermove", 160); ev("pointermove", 220); ev("pointerup", 220);
    check("the Recipes | Participants switch drags like Music sharing's tabs: left to Recipes, right to Participants", back && bd3.window.eval("builderHome.tab") === "people" && !bd3.document.getElementById("bhPeople").hidden);
  })();
  check("a participant's row has the code as its title, how many playlists (no day), and the chevron and Build playlist at its end (Delete is in the open row)", (() => { const r = bd3.document.querySelector('#bhPeople [data-code="T7"]'); return r.querySelector(".bh-name").textContent === "T7" && r.querySelector(".bh-sub").textContent === "1 playlist" && !r.querySelector(".bh-info") && r.querySelector(".bh-build").getAttribute("aria-label") === "Build playlist" && JSON.stringify([...r.querySelectorAll(".bh-ib")].map((x) => x.getAttribute("aria-label"))) === '["T7\'s playlists","Build playlist"]'; })());
  check("a participant last built in an earlier year shows only the year", bd3.eval("builtWhen(new Date(2024, 4, 3).getTime())") === "2024" && bd3.eval("builtWhen(Date.now())") === bd3.eval("shortDate(Date.now())"));
  check("with participants, a note says how to build their next playlist", /a participant\u2019s +button to build their next playlist/.test(bd3.document.querySelector("#bhPeople .bh-note").textContent) && !bd3.document.querySelector(".bh-people-empty"));
  check("with none, the list says No participants yet and that they show up from the Recipes tab", /^No participants yetParticipants show up here when you build a playlist for one on the Recipes tab\.$/.test(bd3.eval("(() => { const keep = playlists; playlists = []; renderParticipantList(); const t = document.getElementById('bhPeople').textContent; playlists = keep; renderParticipantList(); return t; })()")));
  check("with none, Recipes in that line is a link that switches to the Recipes tab", bd3.eval("(() => { const keep = playlists, tab = builderHome.tab; playlists = []; builderHome.tab = 'people'; renderBuilderHome(); document.querySelector('#bhPeople .bh-tablink').click(); const went = builderHome.tab === 'recipes'; playlists = keep; builderHome.tab = tab; renderBuilderHome(); return went; })()"));
  check("a tap on a recipe's row does nothing: only its buttons act (Ron, 2026-11-12)", (bd3.document.querySelector('#bhRecipes .bh-recipe').click(), bd3.document.getElementById("recipePanelWrap").hidden && !bd3.document.querySelector(".bh-recipe[role], .bh-phead[role]")));
  check("a tap on a participant's row head opens it and a second closes it (Ron, 2026-11-13)", (() => { const h = () => bd3.document.querySelector('#bhPeople [data-code="MC"] .bh-phead'); h().click(); const opened = !!bd3.document.querySelector('#bhPeople .bh-person.bh-open[data-code="MC"]'); h().click(); return opened && !bd3.document.querySelector('#bhPeople .bh-person.bh-open'); })());
  bd3.document.querySelector('#bhPeople [data-code="MC"] .bh-open-btn').click();
  check("the chevron on a participant's row opens it in place to their playlists, one line each without their code; no popup", (() => { const c = bd3.document.querySelector('#bhPeople .bh-person[data-code="MC"]'); const pl = c.querySelectorAll(".bh-plist > .bh-pl:not(.hb-row)"); return c.classList.contains("bh-open") && c.querySelector(".bh-open-btn").getAttribute("aria-expanded") === "true" && pl.length === 1 && !/ MC /.test(pl[0].querySelector(".bh-pl-name").textContent) && !bd3.document.getElementById("personPanelWrap") && !bd3.document.querySelector('#bhPeople .bh-person[data-code="T7"]').classList.contains("bh-open"); })());
  bd3.document.querySelector('#bhPeople [data-code="T7"] .bh-open-btn').click();
  check("opening another participant folds the first: one open at a time", bd3.document.querySelector('#bhPeople .bh-person[data-code="T7"]').classList.contains("bh-open") && !bd3.document.querySelector('#bhPeople .bh-person[data-code="MC"]').classList.contains("bh-open"));
  bd3.document.querySelector('#bhPeople [data-code="T7"] .bh-open-btn').click();
  check("a second tap on the chevron folds it", !bd3.document.querySelector('#bhPeople .bh-person.bh-open') && bd3.eval("builderHome.person") === null);
  // Delete asks twice: the list and Delete MC and 1 playlist, then Are you sure? starting on Cancel (Ron, 2026-11-12)
  bd3.eval("window.blDeleted = []; window.blKeepDelete = deleteParticipant; deleteParticipant = (code) => { blDeleted.push(code); }");
  check("a participant's row has the chevron and Build; Delete is a red trash at the foot of the open row (Ron, 2026-11-12, mockups/participant-delete B)", (() => { const c = () => bd3.document.querySelector('#bhPeople .bh-person[data-code="MC"]'); const icons = [...c().querySelectorAll(".bh-phead .bh-ib")].map((b) => b.getAttribute("aria-label")); if (!c().classList.contains("bh-open")) c().querySelector(".bh-open-btn").click(); const del = c().querySelector(".bh-plist .bh-pdel-foot .bh-pdel"); return icons.length === 2 && icons[0] === "MC's playlists" && !c().querySelector(".bh-phead .bh-del") && !!del && !del.textContent.trim() && del.getAttribute("aria-label") === "Delete MC" && !!del.querySelector("svg") && del.parentElement === c().querySelector(".bh-plist").lastElementChild; })());
  var bl_askDel = async () => { const mc = bd3.document.querySelector('#bhPeople .bh-person[data-code="MC"]'); if (!mc.classList.contains("bh-open")) mc.querySelector(".bh-open-btn").click(); bd3.document.querySelector('#bhPeople [data-code="MC"] .bh-del').click(); bd3.document.getElementById("bhDeleteConfirm").click(); await new Promise((r) => setTimeout(r, 0)); return bd3.document.getElementById("feSyncDialog"); };
  var bl_sure = await bl_askDel();
  check("Delete MC and 1 playlist asks Are you sure? next, starting on Cancel, and Cancel deletes nothing", !!bl_sure && /Are you sure\?/.test(bl_sure.textContent) && /1 playlist will be deleted from your Spotify/.test(bl_sure.textContent) && bd3.document.activeElement.textContent === "Cancel" && !bd3.document.getElementById("bhDeleteDialog") && (bd3.document.activeElement.click(), true) && await new Promise((r) => setTimeout(r, 0)).then(() => bd3.eval("blDeleted.length") === 0));
  bl_sure = await bl_askDel();
  bl_sure.querySelector(".fe-danger-button").click();
  await new Promise((r) => setTimeout(r, 0));
  check("Delete in Are you sure? deletes the participant", bd3.eval("blDeleted.join()") === "MC");
  bd3.eval("deleteParticipant = blKeepDelete");
  bd3.eval("editor.activeId = 'f1'; askDeleteFormat()");
  var bl_delR = bd3.document.getElementById("feDeleteDialog");
  check("in developer mode Delete recipe has no box to remove playlists, and says in grey that participants' playlists stay", !!bl_delR && !bd3.document.getElementById("feDeleteBuilt") && bl_delR.querySelector("p.muted") && /permanently removes the recipe from this list.*Playlists built from this recipe for participants stay\. Are you sure you want to delete it\?/.test(bl_delR.textContent));
  bd3.document.getElementById("feDeleteCancel").click();
  // Which recipe? (Ron, 2026-11-12, mockups/recipe-pick C): Who is it for? turned around
  bd3.document.querySelector('#bhPeople [data-code="MC"] .bh-build').click();
  var bl_pick = bd3.document.getElementById("pickRecipeWrap");
  check("Build playlist on MC's row opens a sheet: Build a playlist, FOR over MC's card, WHICH RECIPE? over Choose a recipe, no radio buttons", !!bl_pick && bd3.document.getElementById("prTitle").textContent === "Build a playlist" && Array.from(bl_pick.querySelectorAll(".wf-label")).map((l) => l.textContent).join() === "For,Which recipe?,Repeat songs" && bl_pick.querySelector(".wf-person .bh-name").textContent === "MC" && /Choose a recipe/.test(bd3.document.getElementById("bhRecipe").textContent) && !bl_pick.querySelector(".bh-radio,[role=radio]") && bd3.document.getElementById("bhDialogNext").disabled && bd3.document.getElementById("bhDialogNext").textContent.trim() === "Build playlist");
  bd3.document.getElementById("bhRecipe").click();
  check("the drop-down lists the recipes as the landing shows them, the one MC's latest playlist came from first as Last time, and no search with few recipes", Array.from(bd3.document.querySelectorAll("#bhRecipePanel .wf-opt")).map((o) => o.dataset.id).join() === "f1,f2" && /Last time/.test(bd3.document.querySelector("#bhRecipePanel .wf-opt").textContent) && !!bd3.document.querySelector("#bhRecipePanel .wf-opt .bh-shape") && !bd3.document.getElementById("bhRecipeFind"));
  bd3.document.dispatchEvent(new bd3.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("Escape closes the drop-down first, the sheet stays", bd3.document.getElementById("bhRecipePanel").hidden && !!bd3.document.getElementById("pickRecipeWrap"));
  bd3.document.getElementById("bhRecipe").click();
  bd3.document.querySelector('#bhRecipePanel .wf-opt[data-id="f2"]').click();
  check("choosing a recipe closes the drop-down to it, and Build playlist is ready", bd3.document.getElementById("bhRecipePanel").hidden && /Beta/.test(bd3.document.getElementById("bhRecipe").textContent) && !bd3.document.getElementById("bhDialogNext").disabled);
  bd3.document.dispatchEvent(new bd3.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  check("then Escape closes the sheet", !bd3.document.getElementById("pickRecipeWrap"));
  bd3.eval("pickRecipeFor('T7')");
  bd3.document.getElementById("bhRecipe").click();
  check("for T7, whose latest playlist is from Beta, Beta comes first", Array.from(bd3.document.querySelectorAll("#bhRecipePanel .wf-opt")).map((o) => o.dataset.id).join() === "f2,f1");
  bd3.document.getElementById("bhDialogCancel").click();
  await new Promise((r) => setTimeout(r, 300));
  bd3.document.getElementById("bhTabRecipes").click();
  await waitFor(() => !bd3.document.querySelector('#bhRecipes .bh-recipe[data-id="f1"] .bh-build').disabled, 15000);
  bd3.document.querySelector('#bhRecipes .bh-recipe[data-id="f1"] .bh-build').click();
  var bl_who = bd3.document.getElementById("whoForWrap");
  check("in developer mode Build is always for a participant: a sheet, Build a playlist (no For one participant), the recipe's card, Who is it for? and a drop-down", !!bl_who && bd3.document.getElementById("wfTitle").textContent === "Build a playlist" && !/For one participant/.test(bl_who.textContent) && !!bl_who.querySelector(".wf-build svg") && !!bl_who.querySelector(".wf-cancel svg") && !!bl_who.querySelector(".wf-recipe") && bl_who.querySelector(".wf-label").textContent === "Recipe" && /Who is it for\?/.test(bl_who.textContent) && !/A set of playlists/.test(bl_who.textContent) && !!bd3.document.getElementById("bhWho") && bd3.document.getElementById("bhDialogNext").disabled && bd3.document.getElementById("bhDialogNext").textContent.trim() === "Build playlist");
  check("the sheet's recipe card is its name and length on one line, with no segment count", !!bl_who.querySelector(".wf-recipe .wf-rtop .bh-name") && !/segment/.test(bl_who.querySelector(".wf-recipe").textContent), bl_who.querySelector(".wf-recipe").textContent);
  bd3.document.getElementById("bhWho").click();
  check("the drop-down opens to + New, then a square per participant, the most recently built first", !bd3.document.getElementById("bhWhoPanel").hidden && Array.from(bd3.document.querySelectorAll("#bhWhoPanel .bh-tile")).map((t) => t.dataset.code || "+").join() === "+,T7,AA,MC");
  (() => { const f = bd3.document.getElementById("bhWhoFind"); f.value = "m"; f.dispatchEvent(new bd3.window.Event("input")); })();
  check("Find a code is only a search: matching squares, + New still first, no new code offered", Array.from(bd3.document.querySelectorAll("#bhWhoPanel .bh-tile")).map((t) => t.dataset.code || "+").join() === "+,MC");
  bd3.document.dispatchEvent(new bd3.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("Escape closes the drop-down, not the popup", bd3.document.getElementById("bhWhoPanel").hidden && !!bd3.document.getElementById("whoForWrap"));
  bd3.document.getElementById("bhWho").click();
  bd3.document.getElementById("bhWhoAdd").click();
  (() => { const f = bd3.document.getElementById("bhWhoNew"); f.value = "zq9"; f.dispatchEvent(new bd3.window.Event("input")); })();
  check("+ New turns the drop-down into a code entry, its square filled a place per character, and Build playlist is ready", bd3.document.querySelector(".bh-dd").hidden && Array.from(bd3.document.querySelectorAll(".bh-dd-newline .bh-code i")).map((i) => i.textContent).join("|") === "Z|Q|9|" && !bd3.document.getElementById("bhDialogNext").disabled);
  bd3.document.getElementById("bhWhoNewCancel").click();
  bd3.document.getElementById("bhWho").click();
  bd3.document.querySelector('#bhWhoPanel .bh-tile[data-code="MC"]').click();
  check("choosing a square closes it to that participant, and Build playlist is ready (no line on how much is new to them)", !/New to /.test(bd3.document.getElementById("whoForWrap").textContent) && bd3.document.getElementById("bhWhoPanel").hidden && /MC/.test(bd3.document.getElementById("bhWho").textContent) && !bd3.document.getElementById("bhDialogNext").disabled);
  // Repeat songs (Ron, 2026-11-13, mockups/repeat-songs F)
  var rs_el = (id) => bd3.document.getElementById(id);
  bd3.window.HTMLElement.prototype.scrollIntoView = bd3.window.HTMLElement.prototype.scrollIntoView || function () {};   // jsdom has none (the drop-down opens again with a square chosen)
  var rs_set = (v, release) => { const s = rs_el("rsShare"); s.value = String(v); s.dispatchEvent(new bd3.window.Event("input", { bubbles: true })); if (release) s.dispatchEvent(new bd3.window.Event("change", { bubbles: true })); };
  check("with a participant chosen, REPEAT SONGS shows at 0%: No repeats. New music comes first., a slider from 0 to 100 in steps of 10, and no cards", !rs_el("rsSection").hidden && rs_el("rsLine").textContent === "No repeats. New music comes first." && rs_el("rsShare").min === "0" && rs_el("rsShare").max === "100" && rs_el("rsShare").step === "10" && rs_el("rsFrom").hidden && Array.from(bd3.document.querySelectorAll("#whoFor .wf-label")).map((l) => l.textContent).join() === "Recipe,Who is it for?,Heard before · optional,Repeat songs" && bd3.document.querySelector("#whoFor .bh-dd-add").hidden);
  rs_set(30, false);
  check("while dragging the line follows (About 30% from the most recent playlist) and the cards wait", rs_el("rsLine").textContent === "About 30% from the most recent playlist" && rs_el("rsLine").querySelector(".rs-num").textContent === "30%" && rs_el("rsFrom").hidden);
  rs_set(30, true);
  check("let go above 0%, the cards show: Most recent (chosen, with their latest playlist and its day) and All previous (their playlists counted)", !rs_el("rsFrom").hidden && (() => { const [a, b] = bd3.document.querySelectorAll("#rsFrom .rs-card"); return a.classList.contains("rs-on") && /^Most recent/.test(a.textContent) && / · /.test(a.querySelector("small").textContent) && !b.classList.contains("rs-on") && /^All previous\d+ playlists?$/.test(b.textContent); })());
  bd3.document.querySelector('#rsFrom .rs-card[data-from="all"]').click();
  check("All previous chosen: About 30% from all previous playlists", rs_el("rsLine").textContent === "About 30% from all previous playlists" && bd3.document.querySelector('#rsFrom .rs-card[data-from="all"]').getAttribute("aria-pressed") === "true");
  rs_el("rsShare").dispatchEvent(new bd3.window.Event("pointerdown", { bubbles: true })); rs_set(0); rs_set(60);
  check("dragging from 30% (through 0%) leaves the cards as they were until let go", !rs_el("rsFrom").hidden);
  rs_set(0, true);
  check("back at 0% the cards go and the line says no repeats", rs_el("rsFrom").hidden && /^No repeats/.test(rs_el("rsLine").textContent));
  rs_set(40, true);
  bd3.document.getElementById("bhWho").click();
  bd3.document.querySelector('#bhWhoPanel .bh-tile[data-code="T7"]').click();
  check("choosing another participant starts again at 0% and Most recent", rs_el("rsShare").value === "0" && rs_el("rsFrom").hidden && /^No repeats/.test(rs_el("rsLine").textContent));
  bd3.document.getElementById("bhWho").click();
  bd3.document.getElementById("bhWhoAdd").click();
  check("a new code has nothing to repeat: no Repeat songs", rs_el("rsSection").hidden);
  bd3.document.getElementById("bhWhoNewCancel").click();
  bd3.document.getElementById("bhDialogCancel").click();
  // building for a participant happens in their popup, not the build popup (Ron, 2026-11-12, mockups/build-one C)
  var bl_fo = { extraPlaylists: bl_people };
  var bl_g = 'FORMATS = {"g1": {"title": "Gamma", "name": "Gamma {n}", "segments": [("\u2618\ufe0f intro / outro (soothing, familiar)", 10)]}, "g2": {"title": "Delta", "name": "Delta {n}", "segments": [("Nowhere", 10)]}}';
  var bd4 = await boot({ url: EDURL, session: signedIn(), local: { formats: bl_g, devMode: "1" }, fetchOptions: bl_fo, panel: false });
  await waitFor(() => / ready$/.test(bd4.document.getElementById("pythonStatus").textContent), 15000);   // Python can still be loading here on a slower disk
  await bd4.eval("buildForParticipant('g2', 'MC')");
  check("a recipe that can't be built for a participant says why in their open row, and nothing is made", !!bd4.document.querySelector('#bhPeople .bh-person.bh-open[data-code="MC"]') && /This playlist can't be built/.test(bd4.document.querySelector('#bhPeople [data-code="MC"]').textContent) && /Nowhere/.test(bd4.document.querySelector('#bhPeople [data-code="MC"] .er-box').textContent) && !bl_fo.writes.some((w) => w.type === "create"));
  bd4.eval("setPersonOpen(null)");
  var bl_steps = [];
  var bl_bar = [];
  var bl_guard = [];
  bd4.window.paintPersonBuild = ((paint) => (force) => { const r = bd4.document.getElementById("ppBuild"); if (r) bl_steps.push(r.textContent); if (r && bd4.eval("buildWriting()")) { const ev = new bd4.window.Event("beforeunload", { cancelable: true }); bd4.window.dispatchEvent(ev); bl_guard.push(ev.defaultPrevented && bd4.document.getElementById("changeSpotifyLogin").disabled && bd4.document.getElementById("updateGet").disabled); } paint(force); const r2 = bd4.document.getElementById("ppBuild"); if (r2) bl_bar.push({ el: r2.querySelector(".pp-bar i"), w: parseFloat(r2.querySelector(".pp-bar i").style.width) }); })(bd4.window.paintPersonBuild);
  await bd4.eval("buildForParticipant('g1', 'ZQ9')");
  var bl_made = bl_fo.writes.find((w) => w.type === "create");
  check("the bar moves forward with every phase (reading, making, songs, cover), on the same bar so it eases", new Set(bl_bar.map((x) => x.w)).size >= 5 && bl_bar.every((x, i) => !i || x.w >= bl_bar[i - 1].w) && bl_bar.slice(0, -1).every((x) => x.el === bl_bar[0].el), JSON.stringify(bl_bar.map((x) => x.w)));
  check("Build for a participant opens their row on Participants, where the playlist fills in at the top of their playlists, with no Keep this tab open", bl_steps.some((t) => /Gamma · .*Adding songs · \d+ of \d+$/.test(t)) && !bl_steps.some((t) => /Keep this tab/.test(t)) && !!bd4.document.querySelector('#bhPeople .bh-person.bh-open[data-code="ZQ9"]'), JSON.stringify(bl_steps));
  check("while it builds, leaving the page asks first, and Get it and Change Spotify login are greyed; after, they work again", bl_guard.length > 0 && bl_guard.every(Boolean) && (() => { const ev = new bd4.window.Event("beforeunload", { cancelable: true }); bd4.window.dispatchEvent(ev); return !ev.defaultPrevented && !bd4.document.getElementById("changeSpotifyLogin").disabled; })(), JSON.stringify(bl_guard));
  check("it is made private, for that participant, with its songs and the cover", !!bl_made && bl_made.public === false && /For participant ZQ9\./.test(bl_made.description) && bl_fo.writes.some((w) => w.type === "add" && w.id === bl_made.id) && bl_fo.writes.some((w) => w.type === "cover" && w.id === bl_made.id));
  check("the sweep is one band, never a repeated copy showing as the loop ends, and a redrawn build row carries on its sweep and pulse where the page's clock is, not from the start", (() => { const t = bd4.eval("performance.now()"); const r = bd4.eval("personBuildRow({ name: 'MC · x · 1 Jan', code: 'MC', step: 's', progress: 0.5 })"); const at = (v) => -parseFloat(r.style.getPropertyValue(v)); const css = fs.readFileSync(ROOT + "index.html", "utf8"); return /background-size: 250% 100%; background-repeat: no-repeat; animation: pp-sweep/.test(css) && Math.abs(at("--pp-sweep-at") - t % 1800) < 50 && Math.abs(at("--pp-head-at") - t % 1000) < 50 && /animation: pp-sweep 1\.8s linear var\(--pp-sweep-at, 0s\) infinite/.test(css) && /animation: pp-head 1s ease-in-out var\(--pp-head-at, 0s\) infinite/.test(css); })());
  check("done, the new playlist is marked with Open, no song count, and no message pops up", (() => { const r = bd4.document.querySelector("#bhPeople .bh-pl.pp-new"); return !!r && /Open/.test(r.textContent) && !/\d+ songs/.test(r.textContent) && !/new to/.test(r.textContent) && !bd4.document.getElementById("ppBuild") && !bd4.document.getElementById("builtToast"); })());
  bd4.eval("setPersonOpen(null)");
  bd4.eval("openPersonPanel('ZQ9')");
  check("folded and opened again, the mark is gone", !bd4.document.querySelector("#bhPeople .pp-new") && bd4.document.querySelectorAll('#bhPeople [data-code="ZQ9"] .bh-plist > .bh-pl:not(.hb-row)').length === 1);
  // Repeat songs: 100% from the most recent playlist builds one of only its songs, each still from the segment's playlist
  var rs_before = bl_fo.writes.filter((w) => w.type === "add" && w.id === bl_made.id).flatMap((w) => w.uris);
  var rd_from = bl_steps.length, rd_bar = bl_bar.length;
  await bd4.eval("buildForParticipant('g1', 'ZQ9', { share: 100, from: 'recent' })");
  var rd_steps = bl_steps.slice(rd_from).map((t) => (t.match(/Reading the songs.*$/) || [""])[0]).filter(Boolean);
  check("reading the songs counts the playlists it reads (the recipe's and the participant's), and the bar never goes back (Ron, 2026-11-16)", rd_steps.some((t) => /^Reading the songs · 1 of 2$/.test(t)) && rd_steps.some((t) => /^Reading the songs · 2 of 2$/.test(t)) && bl_bar.slice(rd_bar).every((x, i, a) => !i || x.w >= a[i - 1].w) && bd4.eval("readingShare() === null"), JSON.stringify(rd_steps));
  var rs_made = bl_fo.writes.filter((w) => w.type === "create").pop();
  var rs_uris = bl_fo.writes.filter((w) => w.type === "add" && w.id === rs_made.id).flatMap((w) => w.uris);   // one segment: no silence
  check("Repeat songs at 100% from the most recent playlist: every song in the new one was in it", rs_made !== bl_made && rs_uris.length > 0 && rs_uris.every((u) => rs_before.includes(u)), JSON.stringify({ same: rs_made === bl_made, row: bd4.document.querySelector('#bhPeople [data-code="ZQ9"]').textContent, people: bd4.eval("participantList().map((p) => p.code + p.playlists.length)") }));
  // too few of their songs in this recipe's playlists: nothing is made, and the row says how much can repeat
  var rs_n = bl_fo.writes.filter((w) => w.type === "create").length;
  bd4.eval("setPersonOpen(null)");
  await bd4.eval("buildForParticipant('g1', 'MC', { share: 50, from: 'recent' })");
  check("50% when few of their songs are in the recipe's playlists: nothing is made, and their row says Only about N% can repeat with this recipe", bl_fo.writes.filter((w) => w.type === "create").length === rs_n && /Only about \d+% can repeat with this recipe\./.test(bd4.document.querySelector('#bhPeople [data-code="MC"] .er-box').textContent), bd4.document.querySelector('#bhPeople [data-code="MC"]').textContent);
  var rs_src = fs.readFileSync(ROOT + "engine.py", "utf8");
  // Heard before (Ron, 2026-11-13): playlists a participant heard before Arc, carried in their playlists' descriptions, no playlist of its own
  var hb_id = "4" + "a".repeat(21), hb_ids15 = Array.from({ length: 16 }, (_, i) => "4" + String(i).padStart(2, "0") + "b".repeat(19));
  check("the Heard before list packs into a description and reads back; 15 fit in the 300 characters Spotify shows, with a 4-letter code", (() => {
    const d = bd4.eval(`builtDescription({}, 1, 1, new Date(2026, 10, 14), 'ABCD', ${JSON.stringify(hb_ids15)})`);
    const back = bd4.eval(`heardOf(${JSON.stringify(d)})`);
    return d.length <= 300 && back.length === 15 && back.every((x, i) => x === hb_ids15[i]) && bd4.eval(`participantOf(${JSON.stringify(d)})`) === "ABCD" && builtOk(d);
    function builtOk(t) { return new Date(bd4.eval(`builtAtOf(${JSON.stringify(t)})`)).getDate() === 14; }
  })());
  check("replacing the list keeps the rest of the description, and an edited list reads as none", (() => {
    const d = bd4.eval(`withHeard(builtDescription({}, 1, 1, new Date(2026, 10, 14), 'MC', ['${hb_id}']), [])`);
    const two = bd4.eval(`withHeard(builtDescription({}, 1, 1, new Date(2026, 10, 14), 'MC', ['${hb_id}']), ['${hb_id}', '${hb_ids15[0]}'])`);
    return d.includes("For participant MC. Built 14 Nov 2026. ") && bd4.eval(`heardOf(${JSON.stringify(d)}).length`) === 0 && bd4.eval(`recipeOf(withHeard(builtDescription({}, 1, 1, new Date(2026, 10, 14), "MC", ["${hb_id}"], "format-keep1234"), []))`) === "format-keep1234" && bd4.eval(`heardOf(${JSON.stringify(two)}).length`) === 2 && bd4.eval(`heardOf(${JSON.stringify(two.slice(0, -3) + "\u4e00\u4e00\u4e00")}).length`) === 0;
  })());
  TRACKS[hb_id] = TRACKS.p4.map((it) => (it && it.track && it.track.uri ? { track: { ...it.track, uri: it.track.uri.replace("p4", "hb") } } : it));
  var hb_fo = { extraPlaylists: bl_people.concat([{ id: hb_id, name: "Old circle", owner: { id: "ron" }, description: "" }]) };
  var hb = await boot({ url: EDURL, session: signedIn(), local: { formats: bl_g, devMode: "1" }, fetchOptions: hb_fo, panel: false });
  await waitFor(() => / ready$/.test(hb.document.getElementById("pythonStatus").textContent), 15000);
  hb.eval("builderHome.tab = 'recipes'; renderBuilderHome()");
  await waitFor(() => !hb.document.querySelector('#bhRecipes .bh-recipe[data-id="g1"] .bh-build').disabled, 15000);
  hb.document.querySelector('#bhRecipes .bh-recipe[data-id="g1"] .bh-build').click();
  if (!hb.document.getElementById("bhWhoNew") || hb.document.querySelector(".bh-dd-add").hidden) { hb.document.getElementById("bhWho").click(); hb.document.getElementById("bhWhoAdd").click(); }
  (() => { const f = hb.document.getElementById("bhWhoNew"); f.value = "hb"; f.dispatchEvent(new hb.window.Event("input")); })();
  check("a new participant's code is followed by Heard before · optional, Add previously heard playlists and what it does", (() => { const sec = hb.document.querySelector(".hb-section"); return !!sec && /^Heard before · optional$/.test(sec.querySelector(".wf-label").textContent) && hb.document.getElementById("hbNewAdd").textContent.trim() === "Add previously heard playlists" && sec.querySelector(".hb-hint").textContent === "Arc treats every song in them as heard and prioritizes new music."; })());
  hb.document.getElementById("hbNewAdd").click();
  var hb_items = () => Array.from(hb.document.querySelectorAll(".hb-panel .hb-item"));
  check("it opens a list of the person's own playlists (not Arc's), ticked by a tap, and Add N", hb_items().some((b) => /Old circle/.test(b.textContent)) && !hb_items().some((b) => /·/.test(b.querySelector(".bh-pl-name").textContent)) && hb.document.getElementById("hbNewAddN").disabled && (() => { hb_items().find((b) => /Old circle/.test(b.textContent)).click(); return hb.document.getElementById("hbNewAddN").textContent === "Add 1" && !hb.document.getElementById("hbNewAddN").disabled; })());
  hb.document.getElementById("hbNewAddN").click();
  check("added, it is a line with an X, and the button says Add more", hb.document.querySelectorAll(".hb-lines .hb-line").length === 1 && /Old circle/.test(hb.document.querySelector(".hb-lines").textContent) && hb.document.getElementById("hbNewAdd").textContent.trim() === "Add more");
  hb.document.getElementById("hbNewAdd").click();
  check("opened again, the ones already in are ticked like the rest, fixed, with Already in where the songs go", (() => { const b = hb_items().find((x) => /Old circle/.test(x.textContent)); return b.classList.contains("hb-on") && b.disabled && b.querySelector(".bh-pl-sub").textContent === "Already in"; })());
  hb.document.dispatchEvent(new hb.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("Escape closes the list first", hb.document.querySelector(".hb-panel").hidden && !!hb.document.getElementById("whoForWrap"));
  hb.document.getElementById("bhDialogNext").click();
  await waitFor(() => hb_fo.writes && hb_fo.writes.some((w) => w.type === "create") && !!hb.document.querySelector("#bhPeople .pp-new"), 15000);
  var hb_made = hb_fo.writes.find((w) => w.type === "create");
  check("the first playlist carries the list in its description, and nothing waits in the tab any more", !!hb_made && JSON.stringify(hb.eval(`heardOf(${JSON.stringify(hb_made.description)})`)) === JSON.stringify([hb_id]) && /For participant HB\./.test(hb_made.description) && !hb.sessionStorage.getItem("pendingHeard").includes("HB"), hb_made && hb_made.description);
  check("no extra playlist is made for it", hb_fo.writes.filter((w) => w.type === "create").length === 1);
  check("the participant's line says 1 playlist + 1 heard, and their open row lists it under Heard before, with Add previously heard playlists by the trash", (() => {
    const card = hb.document.querySelector('#bhPeople .bh-person[data-code="HB"]');
    return !!card && card.querySelector(".bh-phead .bh-sub").textContent === "1 playlist + 1 heard" && card.querySelector(".hb-subhead").textContent === "Heard before" && /Old circle/.test(card.querySelector(".hb-row").textContent) && card.querySelector(".hb-foot").firstElementChild.id === "hbAdd" && hb.document.getElementById("hbAdd").textContent.trim() === "Edit heard playlists" && !!card.querySelector(".hb-foot .bh-pdel");
  })(), hb.document.getElementById("bhPeople").textContent);
  check("its songs count as heard, longest ago of all", await hb.eval(`Promise.all([heardBy('HB'), loadTracks('${hb_id}')]).then(([r, t]) => t.length > 0 && t.every((x) => (x.key || x.id) in r.songs))`) && await hb.eval(`(setPendingHeard('NEW', ['${hb_id}']), Promise.all([heardBy('NEW'), loadTracks('${hb_id}')])).then(([r, t]) => (setPendingHeard('NEW', null), t.every((x) => r.songs[x.key || x.id] === 0)))`));
  hb.document.getElementById("hbAdd").click();
  var hb_sheet = () => hb.document.getElementById("heardBefore");
  var hb_row = (name) => Array.from(hb.document.querySelectorAll("#heardBefore .hb-item")).find((x) => x.textContent.includes(name));
  check("Edit heard playlists opens Heard before · HB with no buttons at its foot, the X at the top, and the one in ticked with Already in, untickable", hb.document.getElementById("hbTitle").textContent === "Heard before · HB" && !hb_sheet().querySelector(".wf-foot") && hb_sheet().classList.contains("rp-clean") && hb_row("Old circle").classList.contains("hb-on") && !hb_row("Old circle").disabled && /Already in/.test(hb_row("Old circle").textContent));
  hb_row("Old circle").click();
  check("a change turns the X into Done", !hb_sheet().classList.contains("rp-clean"));
  hb_row("Old circle").click();
  check("changing it back is no change: the X again", hb_sheet().classList.contains("rp-clean"));
  hb_row("Old circle").click();
  var hb_w0 = hb_fo.writes.length;
  hb.document.querySelector("#heardBeforeWrap .rp-dim").click();
  await waitFor(() => !hb.document.getElementById("heardBefore"), 5000);
  check("with a change, a tap outside saves (as Done does): every playlist carrying it is rewritten without it, nothing else is made", hb_fo.writes.slice(hb_w0).filter((w) => w.type === "update").length === 1 && hb_fo.writes.slice(hb_w0).every((w) => w.type === "update" && /For participant HB\. Built /.test(w.description) && !/Heard before/.test(w.description)), JSON.stringify(hb_fo.writes.slice(hb_w0)));
  check("their line and the link are back to none", hb.document.querySelector('#bhPeople .bh-person[data-code="HB"] .bh-phead .bh-sub').textContent === "1 playlist" && hb.document.getElementById("hbAdd").textContent.trim() === "Add previously heard playlists" && !hb.document.querySelector('#bhPeople [data-code="HB"] .hb-subhead'));
  hb.document.getElementById("hbAdd").click();
  hb_row("Old circle").click();
  hb.document.getElementById("hbDone").click();
  await waitFor(() => !hb.document.getElementById("heardBefore"), 5000);
  check("Done adds it back into their newest playlist", JSON.stringify(hb.eval("participantList().find((p) => p.code === 'HB').heard")) === JSON.stringify([hb_id]));
  hb.document.getElementById("hbAdd").click();
  hb.document.dispatchEvent(new hb.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("with nothing changed, Escape just closes", !hb.document.getElementById("heardBefore"));
  var bl_src = fs.readFileSync(ROOT + "engine.py", "utf8");
  } catch (err) { areaCrashed("builder landing and participants", err); } }

  if (want("newer version")) { try {
  // ================================================================ a newer version on the site
  var nv_src = fs.readFileSync(ROOT + "index.html", "utf8").match(/<script>\n  \/\/ If the page's own script never starts[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g, "");
  var nv_version = appSource().match(/const APP_VERSION = "([^"]+)"/)[1];
  check("version.txt holds just the version of the files, so a check costs a few bytes, and it is the same stamp as the page's", fs.readFileSync(ROOT + "version.txt", "utf8").trim() === nv_version && fs.readFileSync(ROOT + "version.txt", "utf8").length < 40 && fs.readFileSync(ROOT + "index.html", "utf8").split(nv_version).length - 1 === 9);
  var nv_make = async (fetchOptions = {}, session = {}, local = {}) => {
    const w = await boot({ url: EDURL, session: Object.assign(signedIn(), session), local: Object.assign({ formats: MINI, connectedBefore: "1", backupMode: "manual" }, local), fetchOptions });
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
  check("the same version: no update card", nv_a.document.getElementById("updateCard").hidden && !nv_a.document.documentElement.classList.contains("update-ready"));
  var nv_b = await nv_make({ serverVersion: "2099-01-01a\n" });
  await nv_check(nv_b);
  await new Promise((r) => setTimeout(r, 200));
  var nv_card = nv_b.document.getElementById("updateCard");
  check("a different version, with nothing going on: the page does not load again by itself, and asks for no fresh copies", nv_b.__reloaded === 0 && nv_b.__fetched.filter((f) => f.cache === "reload").length === 0);
  check("a card says Update available, the version running and the new one, and Get it", !nv_card.hidden && /Update available/.test(nv_card.textContent) && nv_b.document.getElementById("updateFrom").textContent === nv_version && nv_b.document.getElementById("updateTo").textContent === "2099-01-01a" && nv_b.document.getElementById("updateGet").textContent === "Get it");
  check("the card sits in the bottom corner, which shows only while it does", nv_card.parentElement.id === "supportBox" && nv_b.document.documentElement.classList.contains("update-ready"));
  check("no message under the bar about it", !/newer version|update available/i.test(capText(nv_b)));
  nv_b.document.getElementById("updateGet").click();
  await new Promise((r) => setTimeout(r, 200));
  check("Get it loads fresh copies of the page and its scripts, then the page again", nv_b.__fetched.filter((f) => f.cache === "reload").length >= 5 && nv_b.__reloaded === 1);
  nv_b.document.getElementById("updateGet").click();
  await new Promise((r) => setTimeout(r, 200));
  check("and again whenever it is pressed", nv_b.__reloaded === 2);
  // the update card (mockup B): up at once on Get it, back after the reload until the app is ready, then All set! with OK
  var nv_us = nv_b.document.getElementById("updateScreen");
  check("Get it puts the update card over the app at once, with a spinner and the step under way (no progress bar), and marks the reload", nv_b.document.documentElement.classList.contains("updating") && nv_b.document.getElementById("usTitle").textContent === "Unwrapping the update" && nv_b.document.getElementById("usStep").textContent === "Getting the new version" && !!nv_us.querySelector(".us-spin") && !nv_us.querySelector("progress, [role=progressbar]") && nv_b.sessionStorage.getItem("updating") === "1");
  var nv_x = await nv_make({ serverVersion: "2099-01-01a" });
  nv_x.fetch = () => Promise.reject(new Error("offline"));
  nv_x.eval("getUpdate()");
  await new Promise((r) => setTimeout(r, 200));
  check("when the new version cannot be fetched, the card says so with OK, and the mark is gone", nv_x.__reloaded === 0 && nv_x.document.getElementById("usTitle").textContent === "The update did not arrive" && nv_x.document.getElementById("updateScreen").classList.contains("us-done") && nv_x.sessionStorage.getItem("updating") === null);
  nv_x.document.getElementById("usOk").click();
  await new Promise((r) => setTimeout(r, 600));
  check("OK takes the card down", !nv_x.document.documentElement.classList.contains("updating"));
  var nv_u = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1", backupMode: "manual" }, fetchOptions: {}, before: (w) => w.document.documentElement.classList.add("updating") });
  await waitFor(() => nv_u.document.getElementById("updateScreen").classList.contains("us-done"), 20000);
  check("once signed in, the playlists read and Python started, it says All set! with the version and OK", nv_u.eval("connection") === "ready" && nv_u.document.getElementById("usTitle").textContent === "All set!" && nv_u.document.getElementById("usText").textContent === `You have the newest version of the app, ${nv_version}.` && nv_u.document.documentElement.classList.contains("updating"));
  nv_u.document.dispatchEvent(new nv_u.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await new Promise((r) => setTimeout(r, 600));
  check("Escape (or OK) takes it down", !nv_u.document.documentElement.classList.contains("updating"));
  // Get it keeps the place: the tool and its tab come back after the reload (Ron, 2026-11-13)
  check("Get it notes the tool and tab that are open", (() => { const kept = JSON.parse(nv_b.sessionStorage.getItem("updateView") || "{}"); return kept.view === "builder" && kept.builder === "recipes" && kept.sharing === "find"; })(), nv_b.sessionStorage.getItem("updateView"));
  var nv_p = await boot({ url: EDURL, session: { ...signedIn(), updateView: JSON.stringify({ view: "builder", builder: "people", sharing: "find" }) }, local: { formats: MINI, connectedBefore: "1", backupMode: "manual", devMode: "1" }, fetchOptions: {}, view: "home", before: (w) => w.document.documentElement.classList.add("updating", "dev-mode") });
  await new Promise((r) => setTimeout(r, 300));
  check("after an update the builder comes back on Participants, and the mark is used up", nv_p.eval("appView") === "builder" && nv_p.eval("builderHome.tab") === "people" && nv_p.sessionStorage.getItem("updateView") === null, nv_p.eval("appView") + " " + nv_p.eval("builderHome.tab"));
  var nv_s = await boot({ url: EDURL, session: { ...signedIn(), updateView: JSON.stringify({ view: "sharing", builder: "recipes", sharing: "share" }) }, local: { formats: MINI, connectedBefore: "1", backupMode: "manual", devMode: "1" }, fetchOptions: {}, view: "home", before: (w) => w.document.documentElement.classList.add("updating", "dev-mode") });
  await new Promise((r) => setTimeout(r, 300));
  check("and Music sharing on By you", nv_s.eval("appView") === "sharing" && nv_s.eval("sharing.tab") === "share", nv_s.eval("appView") + " " + nv_s.eval("sharing.tab"));
  var nv_n = await boot({ url: EDURL, session: { ...signedIn(), updateView: JSON.stringify({ view: "builder", builder: "recipes" }) }, local: { formats: MINI, connectedBefore: "1", backupMode: "manual" }, fetchOptions: {}, view: "home" });
  await new Promise((r) => setTimeout(r, 300));
  check("a start that is not after an update still opens on home", nv_n.eval("appView") === "home");
  // the version at the menu's foot checks for an update when tapped
  var nv_m = await nv_make({ serverVersion: "2099-01-01a" });
  nv_m.eval("showView('builder')");
  nv_m.document.getElementById("feAppMenuButton").click();
  nv_m.document.getElementById("feCheckUpdate").click();
  check("Check for update in the menu says it is checking, with a spinner", nv_m.document.getElementById("feCheckUpdate").textContent === "Checking…" && !!nv_m.document.querySelector("#feCheckUpdate .fe-menuver-spin"));
  await new Promise((r) => setTimeout(r, 300));
  check("a newer one: the menu closes and the update card shows", !nv_m.document.getElementById("feAppMenuPanel") && !nv_m.document.getElementById("updateCard").hidden);
  var nv_m2 = await nv_make();
  nv_m2.eval("showView('builder')");
  nv_m2.document.getElementById("feAppMenuButton").click();
  nv_m2.document.getElementById("feCheckUpdate").click();
  await new Promise((r) => setTimeout(r, 300));
  check("the same one: the button says Up to date, and the menu stays", nv_m2.document.getElementById("feCheckUpdate").textContent === "Up to date" && nv_m2.document.getElementById("updateCard").hidden, nv_m2.document.getElementById("feCheckUpdate").textContent);
  var nv_v = await boot({ url: EDURL, session: {}, local: { formats: MINI, connectedBefore: "1", backupMode: "manual" }, fetchOptions: {}, before: (w) => w.document.documentElement.classList.add("updating") });
  await new Promise((r) => setTimeout(r, 3000));
  check("a start that does not end ready (no sign-in) takes the card down quietly, so the problem shows as usual", !nv_v.document.documentElement.classList.contains("updating") || nv_v.document.getElementById("updateScreen").classList.contains("us-out"));
  for (const [label, fetchOptions] of [["no connection", { versionFail: true }], ["a missing file", { versionStatus: 404, serverVersion: "Not found" }], ["an error page instead of a stamp", { serverVersion: "<html><body>Not found</body></html>" }], ["an empty answer", { serverVersion: "" }]]) {
    const w = await nv_make(fetchOptions);
    await nv_check(w);
    check(`${label}: nothing happens`, w.__reloaded === 0 && !w.eval("notices.held") && w.document.getElementById("updateCard").hidden);
  }
  // when it is asked
  var nv_f = await nv_make();
  nv_f.eval("versionCheck.last = Date.now()");
  Object.defineProperty(nv_f.document, "visibilityState", { value: "visible", configurable: true });
  nv_f.document.dispatchEvent(new nv_f.Event("visibilitychange"));
  await new Promise((r) => setTimeout(r, 100));
  check("coming back to the tab within 30 seconds of the last check does not ask again", nv_seen(nv_f).length === 0);
  nv_f.eval("versionCheck.last = Date.now() - 31 * 1000");
  nv_f.document.dispatchEvent(new nv_f.Event("visibilitychange"));
  await new Promise((r) => setTimeout(r, 200));
  check("coming back after more than 30 seconds asks", nv_seen(nv_f).length === 1);
  nv_f.eval("versionCheck.last = Date.now() - 31 * 1000");
  nv_f.dispatchEvent(new nv_f.Event("focus"));
  await new Promise((r) => setTimeout(r, 200));
  check("so does the window coming forward from behind another one, which is not the tab becoming visible", nv_seen(nv_f).length === 2);
  var nv_g = await boot({ url: EDURL, session: signedIn(), local: { formats: MINI, connectedBefore: "1", backupMode: "manual" }, fetchOptions: {} });
  await new Promise((r) => setTimeout(r, 5600));
  // opening the app menu does not ask (the card arrived behind the menu)
  var nv_h = await nv_make({ serverVersion: "2099-01-01a" });
  nv_h.eval("versionCheck.last = Date.now() - 31 * 1000; toggleAppMenu()");
  await new Promise((r) => setTimeout(r, 200));
  check("opening the menu does not ask", nv_seen(nv_h).length === 0 && nv_h.document.getElementById("updateCard").hidden);
  // a tap on Arc's icon in a pink band asks at once, even within 30 seconds of the last check
  var nv_t = await nv_make({ serverVersion: "2099-01-01a" });
  await waitFor(() => nv_t.eval("startupDone"), 20000);
  nv_t.eval("versionCheck.last = Date.now()");
  nv_t.document.querySelector("#homePage .wp-band-icon").click();
  await new Promise((r) => setTimeout(r, 300));
  check("a tap on Arc's icon in a band shows the version and asks for a newer one at once, and the card shows", nv_seen(nv_t).length === 1 && !nv_t.document.getElementById("updateCard").hidden && nv_t.document.querySelector("#homePage .wp-band-ver").textContent === nv_version);
  } catch (err) { areaCrashed("newer version", err); } }
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  if (areaPrev) areaTimes.push({ name: areaPrev, ms: Date.now() - areaStart });
  if (process.argv.includes("--timing")) for (const a of areaTimes.slice().sort((x, y) => y.ms - x.ms)) console.log(`AREA ${(a.ms / 1000).toFixed(1).padStart(6)} s  ${a.name}`);
  console.log(`TIMING total ${((Date.now() - RUN_STARTED) / 1000).toFixed(0)} s; ${global.bootCount} page starts took ${(global.bootMs / 1000).toFixed(0)} s in all; ${global.bridgeCalls} engine calls took ${(global.bridgeMs / 1000).toFixed(0)} s in all`);
  process.exit(failures ? 1 : 0);
})();
