// sharing.js: Music sharing. People share their own playlists (the phases of a session they suit, tags; its Spotify description goes along as notes) and copy each other's into
// their own Spotify. Opened from the app menu (opened to everyone by Ron, 2026-11-06).
// The library lives in a Cloudflare Worker with a D1 database (cloudflare/music-sharing). It keeps only what people write, the songs as Spotify IDs
// and ISRCs, and a short summary made on the sharer's device; who someone is comes from their Spotify sign-in, checked by the worker.
// The page does the rest itself: search, sorting, the phase filter, tags (the ones used on more than one shared playlist) and overlap with the person's recipes.
// Classic script, loaded after app.js; it uses app.js and editor.js names at run time.
(globalThis.scriptVersions = globalThis.scriptVersions || {})["sharing.js"] = "2026-11-07v";   // this file's version, checked against the app's at startup (checkScriptVersions in app.js)

const SHARING_URL = "https://music-sharing.roncarmel.workers.dev";
const SHARE_MIN_MS = 2 * 60 * 60 * 1000;
const SHARE_TAGS_MIN = 3, SHARE_TAGS_MAX = 10, SHARE_TAG_CHARS = 30, SHARE_NOTES_MAX = 400;   // the worker checks the same
// The phases of a session, drawn as one curve: low and flat, rising, high and flat, falling, low and flat (decided by Ron, 2026-11-06).
const PHASES = ["Beginning", "Ascent", "Plateau", "Descent", "Ending"];
const SHARING_COPIES_KEY = "sharingCopies";   // { shared playlist id: the person's copy's Spotify id }
const SHARING_SHOWN_KEY = "sharingShownAs";   // { mode: "spotify" | "custom" | "anon", name }
const SHARING_BLOCKED_KEY = "sharingBlocked";   // { playlist id: { snap, why: "short" | "copy", of } }: found under two hours, or refused as a copy of someone else's share; kept until the playlist changes in Spotify
const SHARING_MINE_KEY = "sharingMineIds";    // the ids of the person's own shares, so Find playlists says Shared by you at once (refreshed by loadMine)
const OVERLAP_MIN_SONGS = 100, OVERLAP_MIN_PLAYLISTS = 2, OVERLAP_MIN_SHARES = 3;   // when "already in your recipes" is worth showing
const OVERLAP_READ_GAP_MS = 2000;   // reading recipe playlists the browser does not have yet: one request every 2 seconds
const TAGS_STEP = 10;

// Tags this app's people would use everywhere start hidden (the owner can show one).
const TAG_COMMON = new Set("music musical playlist playlists session sessions ceremony ceremonies people person song songs track tracks time times like feel feels feeling something things thing way well good great part parts start end".split(" "));

const sharing = {
  tab: "find", detail: null, library: null, libraryAt: 0, loading: false, error: "",
  search: "", searchOpen: false, sort: "newest", hideAdded: true, tags: new Set(), tagsShown: TAGS_STEP, phases: new Set(),
  mine: null, mineError: "", picks: {}, shownAs: null, applying: false, adding: new Set(), addErrors: {},
  overlap: null, overlapShown: null, reading: false, readStop: false, showOverlapSongs: false,
  songNames: new Map(), player: null, previewNote: "",
};

// ---------------------------------------------------------------- talking to the worker
async function sharingFetch(method, path, json, retried = false) {
  const headers = {};
  if (json) headers["Content-Type"] = "application/json";
  if (token && path !== "/library" && !path.startsWith("/songs/")) headers.Authorization = "Bearer " + token;   // the library and a playlist's songs are public: reading them sends no sign-in
  let response;
  try {
    response = await fetchWithAnswerLimit(SHARING_URL + path, { method, headers, body: json ? JSON.stringify(json) : undefined });
  } catch (err) { throw new Error("Music sharing could not be reached. Check your connection and try again."); }
  let data = {};
  try { data = await response.json(); } catch (err) { /* no body */ }
  if (response.status === 401 && data.code === "signin" && !retried) {
    const renewed = await renewSignIn();   // the sign-in ran out (a tab open over an hour): renew it, then send this once more with the new one
    if (renewed) { token = renewed; return sharingFetch(method, path, json, true); }
  }
  if (!response.ok) { const e = new Error(data.error || `Music sharing answered ${response.status}.`); e.code = data.code || ""; e.status = response.status; throw e; }
  return data;
}

// One read at a time; a caller during a read waits for that one. Overlap (which may read Spotify) starts only while the popup is open,
// since the editor's Music sharing card also reads the library.
let libraryRead = null;
function loadLibrary(force = false) {
  if (libraryRead) return libraryRead.then(startOverlapIfOpen);
  if (!force && sharing.library && Date.now() - sharing.libraryAt < 60000) { startOverlapIfOpen(); return Promise.resolve(); }
  sharing.loading = true;
  sharing.error = "";
  renderSharing();
  libraryRead = (async () => {
    try {
      sharing.library = await sharingFetch("GET", "/library");
      sharing.libraryAt = Date.now();
      computeTagIndex();
    } catch (err) { sharing.error = err.message; }
    sharing.loading = false;
    libraryRead = null;
    renderSharing();
    renderSharingCard();
  })();
  return libraryRead.then(startOverlapIfOpen);
}
function startOverlapIfOpen() {
  if (sharing.library && $("msOverlay") && !$("msOverlay").hidden) startOverlap();
}

// ---------------------------------------------------------------- the card under Build in the editor (#msCard)
// Three covers fanned out and how many playlists others share; it opens Find playlists. Shown before the library arrives
// (and if it never does) with the menu's line and no covers.
function renderSharingCard() {
  const card = $("msCard");
  if (!card) return;
  const lib = sharing.library;
  const shares = lib ? lib.shares : [];
  const others = shares.filter((s) => !isMine(s));
  // covers: others' not gotten yet, then the person's own, then gotten ones (the library comes newest first)
  const order = [...others.filter((s) => !isAdded(s)), ...shares.filter(isMine), ...others.filter(isAdded)];
  const covers = order.filter((s) => s.cover).slice(0, 3);
  const fan = $("msCardFan");
  fan.textContent = "";
  fan.classList.toggle("ms-card-noart", !covers.length);
  if (covers.length) covers.forEach((s) => fan.appendChild(feEl("img", { src: s.cover, alt: "", loading: "lazy" })));
  else {   // no covers anywhere: the app icon in front of two pink cards
    fan.appendChild(feEl("span", { class: "ms-card-blank" }));
    fan.appendChild(feEl("span", { class: "ms-card-blank" }));
    fan.appendChild(feEl("img", { src: "apple-touch-icon.png", alt: "" }));
  }
  $("msCardText").textContent = others.length
    ? `${others.length} ${others.length === 1 ? "playlist" : "playlists"} shared by other facilitators. Find music for your recipes, or share your own.`
    : "Find playlists other facilitators share, and share your own.";
}
// Once connected on a device that has never read which shares are the person's own (a new browser, a Home Screen app added again), they are read once, so the
// card's count of playlists shared by other facilitators leaves them out. After that the list is refreshed whenever Music sharing opens (loadMine).
function sharingConnected() {
  let known = !!sharing.mine;
  try { known = known || localStorage.getItem(SHARING_MINE_KEY) !== null; } catch (err) { known = true; }   // no storage: it would be read on every visit
  if (!known) loadMine().then(renderSharingCard);
}
function startSharingCard() {
  const card = $("msCard");
  if (!card) return;
  card.addEventListener("click", () => openSharing("find"));
  renderSharingCard();
  if (pageName() === "app") loadLibrary();
}

async function loadMine() {
  if (!token || !me) return;
  sharing.mineError = "";
  try {
    sharing.mine = (await sharingFetch("GET", "/mine")).shares;
    if (!sharing.topIds) sharing.topIds = new Set(sharing.mine.map((s) => s.playlist));
    try { localStorage.setItem(SHARING_MINE_KEY, JSON.stringify(sharing.mine.map((s) => s.id))); } catch (err) { /* private browsing */ }
    for (const s of sharing.mine) {
      const pick = sharing.picks[s.playlist];
      if (!pick || !pick.touched) sharing.picks[s.playlist] = pickFromShare(s);
    }
  } catch (err) { sharing.mineError = err.message; }
  renderSharing();
}

// ---------------------------------------------------------------- what this device remembers
function sharingCopies() {
  try { return JSON.parse(localStorage.getItem(SHARING_COPIES_KEY) || "{}") || {}; } catch (err) { return {}; }
}
function rememberCopy(shareId, playlistId) {
  const all = sharingCopies();
  all[shareId] = playlistId;
  try { localStorage.setItem(SHARING_COPIES_KEY, JSON.stringify(all)); } catch (err) { /* private browsing: Added shows for this visit only */ }
}
function isAdded(share) {
  const copy = sharingCopies()[share.id];
  if (!copy) return false;
  return !playlists.length || playlists.some((p) => p.id === copy);   // a copy removed in Spotify can be added again
}
function shownAsSetting() {
  if (sharing.shownAs) return sharing.shownAs;
  try { sharing.shownAs = JSON.parse(localStorage.getItem(SHARING_SHOWN_KEY) || "null"); } catch (err) { sharing.shownAs = null; }
  if (!sharing.shownAs || !["spotify", "custom", "anon"].includes(sharing.shownAs.mode)) sharing.shownAs = { mode: "spotify", name: "" };
  return sharing.shownAs;
}
function shownAsName() {
  const s = shownAsSetting();
  if (s.mode === "anon") return null;
  if (s.mode === "custom") return (s.name || "").trim() || null;
  return (me && (me.display_name || me.id)) || null;
}

// ---------------------------------------------------------------- words and numbers
const songCountText = (n) => plural(n, "song");
function shareFacts(s) {
  let text = `${songCountText(s.count)}, ${lengthText(s.ms / 60000)}.`;
  if (s.artists && s.artists.length) text += ` ${includesText(s.artists)}`;
  return text;
}
// the artists with the most songs, as "Includes A, B, C, and more."
const includesText = (artists) => `Includes ${artists.slice(0, 3).join(", ")}, and more.`;
const phaseNames = (list) => list.map((i) => PHASES[i]).join(", ");
function cleanSpotifyDescription(text) {
  // Spotify gives descriptions with HTML entities and links; the app's own markers and recipe saves are not offered as text
  if (!text || text.startsWith(APP_MARKER)) return "";
  const box = document.createElement("textarea");
  box.innerHTML = String(text).replace(/<[^>]*>/g, "");
  return box.value.trim().slice(0, SHARE_NOTES_MAX);
}
// a tag as it is kept: lower case, single spaces, letters, numbers and a few marks (the worker does the same)
function cleanTag(t) {
  return String(t || "").toLowerCase().replace(/^#+/, "").replace(/[^\p{L}\p{N}' &-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, SHARE_TAG_CHARS).trim();
}

// ---------------------------------------------------------------- the curve of a session
// Five parts of one line, each 100 wide: Beginning low, Ascent rising, Plateau high, Descent falling, Ending low. Chosen parts are pink.
const CURVE_LOW = 82, CURVE_HIGH = 18;
const CURVE_PARTS = [`M0,${CURVE_LOW} L100,${CURVE_LOW}`, `M100,${CURVE_LOW} C150,${CURVE_LOW} 150,${CURVE_HIGH} 200,${CURVE_HIGH}`, `M200,${CURVE_HIGH} L300,${CURVE_HIGH}`,
  `M300,${CURVE_HIGH} C350,${CURVE_HIGH} 350,${CURVE_LOW} 400,${CURVE_LOW}`, `M400,${CURVE_LOW} L500,${CURVE_LOW}`];
function curveSvg(on, { area = true, dividers = false, cls = "ms-curve" } = {}) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  const add = (tag, attrs) => { const el = document.createElementNS(NS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); svg.appendChild(el); };
  svg.setAttribute("viewBox", "0 -6 500 112");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  if (dividers) for (const x of [100, 200, 300, 400]) add("line", { class: "ms-curve-div", x1: x, y1: -6, x2: x, y2: 106 });
  if (area) on.forEach((i) => add("path", { class: "ms-curve-area", d: `${CURVE_PARTS[i]} L${(i + 1) * 100},106 L${i * 100},106 Z` }));
  CURVE_PARTS.forEach((d, i) => { if (!on.includes(i)) add("path", { class: "ms-curve-base", d }); });
  on.forEach((i) => add("path", { class: "ms-curve-lit", d: CURVE_PARTS[i] }));
  return svg;
}
// the curve with the names under it; with choose, each part is a button that turns it on and off
function phaseCurve(on, choose = null, label = "Phases", single = false) {   // single: one part at a time (the filter); choosing it again clears it
  const box = feEl("div", { class: "ms-phases" + (choose ? " ms-phases-pick" : ""), role: choose ? "group" : null, "aria-label": choose ? label : null });
  const draw = () => {
    box.textContent = "";
    const list = [...on].sort();
    box.appendChild(curveSvg(list, { dividers: !!choose }));
    const names = feEl("div", { class: "ms-phase-names" });
    PHASES.forEach((name, i) => {
      const lit = list.includes(i);
      names.appendChild(choose
        ? feEl("button", { type: "button", class: lit ? "ms-on" : "", "aria-pressed": String(lit), onClick: () => { if (on.has(i)) on.delete(i); else { if (single) on.clear(); on.add(i); } draw(); box.querySelectorAll("button")[i].focus(); choose(); } }, name)
        : feEl("span", { class: lit ? "ms-on" : "" }, name));
    });
    box.appendChild(names);
  };
  draw();
  return box;
}
// the line over a share's curve: who plays it in which phases, one or two by name, more as a count
function phaseLine(s) {
  const list = (s.phases || []).slice().sort();
  const who = isMine(s) ? "You play it in " : s.by ? s.by + " plays it in " : "They play it in ";
  const names = list.length > 2 ? [feEl("b", {}, list.length + " phases")] : list.flatMap((i, n) => n ? [" and ", feEl("b", {}, PHASES[i])] : [feEl("b", {}, PHASES[i])]);
  return feEl("div", { class: "ms-phase-line" }, who, ...names);
}
function miniCurve(list) {
  const box = feEl("span", { class: "ms-mini-curve", role: "img", "aria-label": "Played in " + phaseNames(list) });
  box.appendChild(curveSvg(list, { area: false, cls: "ms-curve ms-curve-mini" }));
  return box;
}

// ---------------------------------------------------------------- tags: the ones used on more than one shared playlist
function computeTagIndex() {
  const lib = sharing.library;
  if (!lib) return;
  const counts = new Map();   // word: set of shared playlist ids
  const perShare = new Map();
  for (const s of lib.shares) {
    const words = new Set((s.tags || []).map(cleanTag).filter(Boolean));
    perShare.set(s.id, words);
    for (const w of words) { if (!counts.has(w)) counts.set(w, new Set()); counts.get(w).add(s.id); }
  }
  // one form per word: "drones" counts with "drone" when both are used
  for (const w of [...counts.keys()]) {
    if (w.includes(" ") || !/s$/.test(w) || /ss$/.test(w)) continue;
    const one = w.slice(0, -1);
    if (!counts.has(one)) continue;
    for (const id of counts.get(w)) { counts.get(one).add(id); perShare.get(id).add(one); }
    counts.delete(w);
  }
  const overrides = lib.words || {};
  sharing.tagIndex = [...counts.entries()].filter(([, ids]) => ids.size > 1)
    .map(([word, ids]) => ({ word, ids, count: ids.size, hidden: word in overrides ? overrides[word] === 1 : TAG_COMMON.has(word) }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}
// tags others use, most used first, for suggestions while typing (hidden ones are left out)
function knownTags() {
  const lib = sharing.library, counts = new Map();
  if (!lib) return [];
  const overrides = lib.words || {};
  for (const s of lib.shares) for (const t of new Set((s.tags || []).map(cleanTag))) if (t && overrides[t] !== 1) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}
function visibleTags() { return (sharing.tagIndex || []).filter((t) => !t.hidden); }

// ---------------------------------------------------------------- overlap with the person's recipes
function recipePlaylistIds() {
  const ids = new Set();
  if (typeof editor === "undefined" || !editor.model) return [];
  for (const f of editor.model.formats) {
    if (f.draft) continue;
    for (const item of f.items || []) for (const l of item.lists || []) if (l.id) ids.add(l.id);
  }
  return [...ids].filter((id) => !me || playlists.some((p) => p.id === id && p.owner === me.id));
}
async function keptSongsFor(id) {
  if (trackCache.has(id)) return trackCache.get(id);
  const saved = await savedSongs(id);
  return saved && saved.v === SONGS_VERSION && Array.isArray(saved.tracks) ? saved.tracks : null;
}
async function measureOverlap() {
  const ids = recipePlaylistIds();
  const keys = new Set(), uris = new Set(), labels = new Map();
  let kept = 0, songs = 0;
  const missing = [];
  for (const id of ids) {
    const tracks = await keptSongsFor(id);
    if (!tracks) { missing.push(id); continue; }
    kept++;
    for (const t of tracks) {
      if (t.key) { keys.add(t.key); labels.set(t.key, t.label); }
      uris.add(t.uri);
      labels.set(t.uri, t.label);
    }
  }
  songs = uris.size;
  const result = { per: {}, songs, playlists: kept, missing, labels, keys, uris };
  for (const s of (sharing.library ? sharing.library.shares : [])) {
    const same = s.songs.filter(([id, isrc]) => (isrc && keys.has("isrc:" + isrc)) || uris.has("spotify:track:" + id));
    result.per[s.id] = { same: same.length, pct: s.songs.length ? Math.round((same.length / s.songs.length) * 100) : 0, songs: same };
  }
  result.usable = songs >= OVERLAP_MIN_SONGS && kept >= OVERLAP_MIN_PLAYLISTS && Object.values(result.per).filter((p) => p.pct >= 1).length >= OVERLAP_MIN_SHARES;
  return result;
}
async function startOverlap() {
  sharing.overlap = await measureOverlap();
  if (!sharing.overlapShown) sharing.overlapShown = sharing.overlap;
  renderSharing();
  if (sharing.overlap.missing.length) readMissingSlowly(sharing.overlap.missing);
}
async function readMissingSlowly(ids) {
  // the recipe playlists this browser has not kept yet, read gently while Music sharing is open; nothing on screen moves until it is done
  if (sharing.reading) return;
  sharing.reading = true;
  sharing.readStop = false;
  try {
    for (const id of ids) {
      if (sharing.readStop || connection !== "ready" || spotifyPause() || busy) break;
      const info = playlists.find((p) => p.id === id);
      const entries = [];
      let path = `/playlists/${id}/items?limit=50`;
      while (path && !sharing.readStop) {
        await new Promise((r) => setTimeout(r, OVERLAP_READ_GAP_MS));
        const page = await spotifyRequest("GET", path, { noWait: true });
        entries.push(...(page.items || []));
        path = page.next || null;
      }
      if (sharing.readStop) break;
      const tracks = songsFromEntries(entries);
      trackCache.set(id, tracks);
      await saveSongs({ id, snapshot: info && info.snapshot ? info.snapshot : null, tracks, v: SONGS_VERSION, savedAt: Date.now() });
    }
  } catch (err) { logStep("music sharing: reading a recipe playlist stopped (" + (err && err.message) + ")"); }   // a refusal: tried again next time
  sharing.reading = false;
  if (!$("msOverlay") || $("msOverlay").hidden) return;
  sharing.overlap = await measureOverlap();   // the numbers change; the order follows the next time a sort is chosen
  renderSharing();
}

// ---------------------------------------------------------------- copying a shared playlist into the person's Spotify
async function addShared(s) {
  if (sharing.adding.has(s.id) || connection !== "ready") return;
  sharing.adding.add(s.id);
  delete sharing.addErrors[s.id];
  renderSharing();
  let made = null;
  try {
    made = await spotifyRequest("POST", "/me/playlists", { json: { name: s.name, public: false, description: copyDescription(s) } });
    if (made.public !== false) { try { await spotifyRequest("PUT", `/playlists/${made.id}`, { json: { public: false } }); } catch (err) { logStep("shared copy: could not make it private"); } }
    const uris = s.songs.map(([id]) => "spotify:track:" + id);
    for (let k = 0; k < uris.length;) {
      const n = addChunk;
      try { await spotifyRequest("POST", `/playlists/${made.id}/items`, { json: { uris: uris.slice(k, k + n) } }); }
      catch (err) {
        if (n > ADD_CHUNK_SMALL && /returned 400/.test(err.message)) { addChunk = ADD_CHUNK_SMALL; recordNote(`${n} songs per add refused (400)`); continue; }
        throw err;
      }
      k += n;
    }
    if (s.cover && hasScope("ugc-image-upload")) {   // a problem with the picture never undoes the playlist
      try {
        const bytes = new Uint8Array(await (await fetch(s.cover)).arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        await spotifyRequest("PUT", `/playlists/${made.id}/images`, { body: btoa(binary), contentType: "image/jpeg", noWait: true });
      } catch (err) { logStep("shared copy: cover not copied"); }
    }
  } catch (err) {
    if (made) { try { await removePlaylists([made.id]); } catch (e) { logStep("shared copy: half-made copy not removed"); } }   // all or nothing
    made = null;
    sharing.addErrors[s.id] = `Could not get it: ${String(err && err.message || err).replace(/\.$/, "")}. Try again.`;
  }
  sharing.adding.delete(s.id);
  if (made) {
    rememberCopy(s.id, made.id);
    try { await loadMyPlaylists(); }
    catch (err) { playlists.push({ id: made.id, name: s.name, owner: me.id, collaborative: false, image: null, cover: null, count: s.songs.length, description: copyDescription(s), snapshot: null, madeByApp: false, save: null, isSave: false }); keepPlaylists(); }
  }
  renderSharing();
}

// the copy's description in Spotify: the sharer's notes, else the tags
function copyDescription(s) { return (s.notes || (s.tags || []).join(", ")).slice(0, 300); }

// ---------------------------------------------------------------- the popup
function openSharing(tab = "find") {
  if (typeof closeInfo === "function") closeInfo(true);
  sharing.tab = tab;
  sharing.detail = null;
  sharing.overlapShown = sharing.overlap;
  sharing.sunk = new Set(Object.keys(blockRecord()));   // known on opening as not shareable: these go to the bottom; one found while open stays in its place until next time
  sharing.topIds = null;   // the shares as first read in this opening go to the top; one shared or stopped while open keeps its place until next time
  $("msOverlay").hidden = false;
  document.body.style.overflow = "hidden";
  renderSharing();
  $("msDialog").focus({ preventScroll: true });
  loadLibrary();
  loadMine();   // also on Find playlists, so the person's own shares say Shared by you
}
async function closeSharing() {
  if (!(await settlePending())) return;
  sharing.readStop = true;
  stopPreview();
  closeSortMenu();
  if ($("msSheet")) $("msSheet").remove();
  sharing.searchOpen = false;
  sharing.search = "";
  $("msOverlay").hidden = true;
  renderSharingCard();   // a Get or a share may change its count and covers
  if (!document.querySelector(".app-overlay:not([hidden])")) document.body.style.overflow = "";
  if ($("feAppMenuButton")) $("feAppMenuButton").focus();
}
async function switchTab(tab) {
  if (tab === sharing.tab && !sharing.detail) return;
  if (tab === sharing.tab) { closeDetail(); return; }   // the open tab, from a playlist's page: back to the list as All playlists does
  if (sharing.tab === "share" && !(await settlePending())) return;
  sharing.tab = tab;
  sharing.detail = null;
  if (tab === "find") sharing.overlapShown = sharing.overlap;
  renderSharing();
  $("msBody").scrollTop = 0;
  if (tab === "share") loadMine();
}
async function settlePending() {
  // leaving Share playlists with changes not yet applied asks first, so nothing is lost without a word
  if (sharing.tab !== "share" || !pendingChanges().total) return true;
  const answer = await askSyncChoice("Apply your changes?", "Some playlists are ticked or unticked but not shared or stopped yet.",
    [{ label: "Apply", value: "apply" }, { label: "Discard", value: "discard" }], { required: true });
  if (answer === "apply") await applyShares();
  else resetPicks();
  return true;
}

// ---------------------------------------------------------------- what each tab is
// A pink card at the top of each tab's list. Got it folds it away into the info button beside Close, which brings it back. Open or folded
// is kept per tab (sharingIntro in localStorage); nothing kept means open, so a first visit shows it.
function introText(tab) {
  return tab === "find"
    ? ["Playlists other facilitators share for their sessions. ", feEl("b", {}, "Get"), " puts your own private copy in your Spotify, ready to use in your recipes. The copy is yours to change, and it stays as it is if the sharer changes or removes theirs."]
    : [`Share your own playlists with other facilitators. Tick one, then choose when you play it and at least ${SHARE_TAGS_MIN} tags. It needs at least two hours of songs. Others get their own private copy, and yours stays as it is.`];
}
function introStates() { try { return JSON.parse(localStorage.getItem("sharingIntro")) || {}; } catch (e) { return {}; } }
function introOpen(tab) { return introStates()[tab] !== "closed"; }
function setIntroOpen(tab, open) {
  const all = introStates();
  all[tab] = open ? "open" : "closed";
  try { localStorage.setItem("sharingIntro", JSON.stringify(all)); } catch (e) {}
}
function introCard(tab) {
  return feEl("div", { id: "msIntroCard", class: "ms-introcard" },
    feEl("p", { id: "msIntro" }, ...introText(tab)),
    feEl("div", { class: "ms-introcard-row" }, feEl("button", { type: "button", id: "msGotIt", onClick: foldIntro }, "Got it")));
}
const sharingReducedMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// Got it: a copy of the card shrinks into the info button's place while the card's room closes, then the button pops in
function foldIntro() {
  const card = $("msIntroCard"), dialog = $("msDialog");
  setIntroOpen(sharing.tab, false);
  if (!card || sharingReducedMotion() || !card.animate) { renderSharing(); if (introButton(sharing.tab)) introButton(sharing.tab).focus(); return; }
  renderSharingTabs();   // only the tabs are drawn again (the card stays to fold away), so the open tab's ? is there to fly into
  const info = introButton(sharing.tab);
  info.style.visibility = "hidden";
  card.getAnimations().forEach((a) => a.finish()); // Got it while the card is still unfolding measures it at its full size
  card.style.transformOrigin = "";
  const d = dialog.getBoundingClientRect(), c = card.getBoundingClientRect(), t = info.getBoundingClientRect();
  const ghost = card.cloneNode(true);
  ghost.removeAttribute("id");
  ghost.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  ghost.classList.add("ms-introghost");
  ghost.setAttribute("aria-hidden", "true");
  // scaled about its own center (a card unfolded from the button carries that button's point as its origin, which sent this off screen)
  Object.assign(ghost.style, { transformOrigin: "50% 50%", left: c.left - d.left + "px", top: c.top - d.top + "px", width: c.width + "px", height: c.height + "px" });
  dialog.appendChild(ghost);
  const dx = t.left + t.width / 2 - (c.left + c.width / 2), dy = t.top + t.height / 2 - (c.top + c.height / 2);
  // it lands as the button's own circle (each axis scaled to the button, a 50% radius), still visible, and only fades as the button pops in
  const sx = Math.max(t.width / c.width, 0.02), sy = Math.max(t.height / c.height, 0.02);
  const FLY_MS = 520;
  Array.from(ghost.children).forEach((el) => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: EASE_IN, fill: "forwards" }));
  const fly = ghost.animate([
    { transform: "none", opacity: 1, borderRadius: "14px" },
    { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 1, borderRadius: "50%", offset: 0.85 },
    { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0, borderRadius: "50%" },
  ], { duration: FLY_MS, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" });
  const cs = getComputedStyle(card);
  card.style.overflow = "hidden";
  card.animate([
    { height: c.height + "px", marginBottom: cs.marginBottom, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, borderWidth: cs.borderTopWidth, opacity: 0 },
    { height: "0px", marginBottom: "0px", paddingTop: "0px", paddingBottom: "0px", borderWidth: "0px", opacity: 0 },
  ], { duration: 420, delay: 80, easing: EASE_OUT, fill: "forwards" });
  // the button pops in as the circle reaches it (about 55% of the way through the eased time), so one becomes the other
  setTimeout(() => {
    info.style.visibility = "";
    info.animate([{ transform: "scale(0.3)", opacity: 0 }, { transform: "scale(1.25)", opacity: 1, offset: 0.6 }, { transform: "scale(1)", opacity: 1 }],
      { duration: 380, easing: EASE_OUT });
    info.animate([{ boxShadow: "0 0 0 0 var(--accent-tint-border)" }, { boxShadow: "0 0 0 10px transparent" }], { duration: 700, delay: 200, easing: EASE_OUT });
    info.focus({ preventScroll: true });
  }, FLY_MS * 0.55);
  fly.finished.then(() => {
    ghost.remove();
    if (card.isConnected) card.remove();
  }).catch(() => {});
}
function introButton(tab) { return $(tab === "find" ? "msInfoFind" : "msInfoShare"); }
// a tab's ?: the card unfolds again at the top of that tab's list (switching to it first), growing out of the ?
async function unfoldIntro(tab) {
  tab = tab || sharing.tab;
  const t = introButton(tab).getBoundingClientRect();
  if (tab !== sharing.tab || sharing.detail) { await switchTab(tab); if (sharing.tab !== tab) return; }
  setIntroOpen(tab, true);
  $("msBody").scrollTop = 0;
  renderSharing();
  const card = $("msIntroCard");
  if (!card || sharingReducedMotion() || !card.animate) { if ($("msGotIt")) $("msGotIt").focus({ preventScroll: true }); return; }
  const c = card.getBoundingClientRect(), cs = getComputedStyle(card);
  card.style.transformOrigin = `${t.left + t.width / 2 - c.left}px ${t.top + t.height / 2 - c.top}px`;
  card.style.overflow = "hidden";   // while it grows (this hides its triangle until it has arrived)
  card.animate([
    { height: "0px", marginBottom: "0px", paddingTop: "0px", paddingBottom: "0px", opacity: 0, transform: "scale(0.15)" },
    { height: c.height + "px", marginBottom: cs.marginBottom, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, opacity: 1, transform: "none" },
  ], { duration: 420, easing: EASE_OUT }).finished.then(() => { card.style.transformOrigin = ""; card.style.overflow = ""; }).catch(() => {});
  if ($("msGotIt")) $("msGotIt").focus({ preventScroll: true });
}

function renderSharing() {
  const body = $("msBody");
  if (!body || $("msOverlay").hidden) return;
  if (sharing.player && sharing.player.share !== sharing.detail) stopPreview();   // a preview plays only on its playlist's page
  const keepScroll = body.scrollTop;
  body.textContent = "";
  $("msFoot").hidden = true;
  renderSharingTabs();
  if (sharing.detail) { renderDetail(body); body.scrollTop = keepScroll; return; }
  if (sharing.tab === "find") renderFind(body); else renderShareYours(body);
  body.scrollTop = keepScroll;
  aimIntro();
}
// the tabs stay above the scrolling part on every page, a playlist's page included, so the person always sees where they are
function renderSharingTabs() {
  const bar = $("msTabs");
  bar.textContent = "";
  // each tab has its own ? while its card is folded (pink on the open tab, white on the other); it brings that tab's card back
  const tabItem = (tab, name) => {
    const on = sharing.tab === tab;
    const item = feEl("div", { class: "ms-tab" + (on ? " ms-on" : "") },
      feEl("button", { type: "button", role: "tab", "aria-selected": String(on), class: "ms-tab-name", onClick: () => switchTab(tab) }, name));
    if (!sharing.detail && !introOpen(tab)) {
      const info = feEl("button", { type: "button", id: "msInfo" + (tab === "find" ? "Find" : "Share"), class: "ms-tab-info", "aria-label": "About " + name, onClick: () => unfoldIntro(tab) });
      info.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M9.4 9.3a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.4-2.6 4"/><path d="M12 17.4v.01"/></svg>';
      item.appendChild(info);
    }
    return item;
  };
  bar.append(tabItem("find", "Find playlists"), tabItem("share", "Share playlists"));
}
// the card's triangle points at the middle of its tab's name (measured unscaled, so a popup still growing in does not throw it off)
function aimIntro() {
  const card = $("msIntroCard"), name = document.querySelector("#msTabs .ms-on .ms-tab-name");
  if (!card || !name) return;
  const c = card.getBoundingClientRect(), t = name.getBoundingClientRect();
  if (!c.width) return;
  card.style.setProperty("--ms-aim", Math.round((t.left + t.width / 2 - c.left) * card.offsetWidth / c.width) + "px");
}

// ---------------------------------------------------------------- Find playlists
// The list with three buttons above it: Filters (a panel that slides up: phases, tags, Hide added), a search icon that turns the row into
// a search field, and Sort (a short menu). Chosen phases and tags show as chips under the buttons, each with an x.
const SORTS = [["newest", "Newest"], ["az", "A to Z"], ["longest", "Longest"], ["most", "Most overlap"], ["least", "Least overlap"]];
function sortChoices() {
  const usable = sharing.overlapShown && sharing.overlapShown.usable;
  return SORTS.filter(([v]) => usable || (v !== "most" && v !== "least"));
}
function filterCount() { return sharing.phases.size + sharing.tags.size; }
function renderFind(body) {
  if (!sortChoices().some(([v]) => v === sharing.sort)) sharing.sort = "newest";
  if (introOpen("find")) body.appendChild(introCard("find"));
  body.appendChild(feEl("div", { id: "msTools", class: "ms-tools" }));
  body.appendChild(feEl("div", { id: "msActive", class: "ms-active" }));
  const added = addedCount();
  if (added && !sharesAnything()) {   // a reminder to share back, never a condition: only after adding one, and gone once the person shares one
    body.appendChild(feEl("div", { id: "msShareNudge", class: "ms-nudge" },
      feEl("span", { class: "ms-nudge-text" }, "You have gotten ", feEl("b", {}, `${added} playlist${added === 1 ? "" : "s"}`), " from other facilitators."),
      feEl("button", { type: "button", class: "ms-nudge-go", onClick: () => switchTab("share") }, "Share one", feIcon("chevron"))));
  }
  body.appendChild(feEl("div", { id: "msResults" }));
  renderResults();
}
// copies this device made that are still in the person's Spotify
function addedCount() {
  const ids = Object.values(sharingCopies());
  return playlists.length ? ids.filter((id) => playlists.some((p) => p.id === id)).length : ids.length;
}
function sharesAnything() {
  if (sharing.mine) return sharing.mine.length > 0;
  try { return (JSON.parse(localStorage.getItem(SHARING_MINE_KEY)) || []).length > 0; } catch (err) { return false; }
}
function renderTools() {
  const box = $("msTools");
  if (!box) return;
  const has = sharing.library && sharing.library.shares.length;
  box.hidden = !has;   // nothing shared yet: nothing to filter
  if (sharing.searchOpen && box.querySelector("#msSearch")) return;   // typing: the field stays as it is
  box.textContent = "";
  if (sharing.searchOpen) {
    const search = feEl("input", { type: "search", class: "ms-search-input", id: "msSearch", placeholder: "Search", "aria-label": "Search names, sharers, tags, descriptions and artists", value: sharing.search });
    search.addEventListener("input", () => { sharing.search = search.value; renderResults(); });
    search.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeSearch(); } else if (e.key === "Enter") { e.preventDefault(); search.blur(); } });   // the list follows each letter; Enter (a phone's Search key) only puts the keyboard away
    box.appendChild(feEl("label", { class: "ms-search" }, feIcon("search"), search));
    box.appendChild(feEl("button", { type: "button", class: "linklike ms-cancel", onClick: closeSearch }, "Cancel"));
    box.appendChild(feEl("p", { class: "ms-search-hint" }, "Searches names, sharers, tags, descriptions and artists."));
    return;
  }
  const n = filterCount();
  box.appendChild(feEl("button", { type: "button", id: "msFilters", class: "ms-tbtn" + (n ? " ms-on" : ""), "aria-haspopup": "dialog", onClick: openFilters },
    feIcon("sliders"), "Filters", n ? feEl("span", { class: "ms-count" }, String(n)) : null));
  box.appendChild(feEl("button", { type: "button", id: "msSearchOpen", class: "ms-tbtn ms-icon", "aria-label": "Search", onClick: openSearch }, feIcon("search")));
  const label = (sortChoices().find(([v]) => v === sharing.sort) || SORTS[0])[1];
  box.appendChild(feEl("button", { type: "button", id: "msSortButton", class: "ms-tbtn ms-sortbtn", "aria-haspopup": "menu", "aria-expanded": "false", onClick: openSortMenu },
    feEl("span", { class: "ms-sortword" }, "Sort:"), feEl("b", {}, label), feIcon("chevron")));
}
function openSearch() {
  sharing.searchOpen = true;
  renderTools();
  const f = $("msSearch");
  if (f) f.focus();
}
function closeSearch() {
  sharing.searchOpen = false;
  sharing.search = "";
  renderTools();
  renderResults();
  if ($("msSearchOpen")) $("msSearchOpen").focus();
}
function renderActive() {
  const box = $("msActive");
  if (!box) return;
  box.textContent = "";
  const chip = (text, remove) => feEl("button", { type: "button", class: "ms-tag ms-on ms-chip", "aria-label": `Remove ${text}`, onClick: () => { remove(); renderResults(); } }, text, feIcon("close"));
  for (const i of [...sharing.phases].sort()) box.appendChild(chip(PHASES[i], () => sharing.phases.delete(i)));
  for (const t of sharing.tags) box.appendChild(chip(t, () => sharing.tags.delete(t)));
}

// the sort menu drops from its button; choosing closes it, and so does a click elsewhere or Escape
function openSortMenu() {
  const button = $("msSortButton");
  if (!button || $("msSortMenu")) return;
  const menu = feEl("div", { id: "msSortMenu", class: "ms-menu", role: "menu", "aria-label": "Sort" });
  const choices = sortChoices();
  for (const [value, label] of choices) {
    menu.appendChild(feEl("button", { type: "button", role: "menuitemradio", "aria-checked": String(value === sharing.sort), class: value === sharing.sort ? "ms-on" : "",
      onClick: () => { closeSortMenu(); setSort(value); } }, label, value === sharing.sort ? feIcon("check") : null));
  }
  if (choices.some(([v]) => v === "most")) menu.appendChild(feEl("p", { class: "ms-menu-note" }, "Overlap: songs already in your recipes"));
  $("msTools").appendChild(menu);
  button.setAttribute("aria-expanded", "true");
  const close = (e) => { if (e.type === "keydown" ? e.key === "Escape" : !menu.contains(e.target) && !button.contains(e.target)) { if (e.type === "keydown") { e.preventDefault(); e.stopPropagation(); } closeSortMenu(); } };
  sharing.sortClose = close;
  setTimeout(() => { document.addEventListener("pointerdown", close, true); document.addEventListener("keydown", close, true); });
  (menu.querySelector(".ms-on") || menu.querySelector("button")).focus();
}
function closeSortMenu() {
  const menu = $("msSortMenu");
  if (sharing.sortClose) { document.removeEventListener("pointerdown", sharing.sortClose, true); document.removeEventListener("keydown", sharing.sortClose, true); sharing.sortClose = null; }
  if (!menu) return;
  menu.remove();
  const b = $("msSortButton");
  if (b) { b.setAttribute("aria-expanded", "false"); b.focus(); }
}
function setSort(value) {
  sharing.sort = value;
  sharing.overlapShown = sharing.overlap;
  renderTools();
  renderResults();
  if ($("msSortButton")) $("msSortButton").focus();
}

// the filters panel slides up inside the popup; the list behind it follows each change, and its button says how many are left
function openFilters() {
  if ($("msSheet")) return;
  const sheet = feEl("div", { id: "msSheet", class: "ms-sheet-wrap" });
  const panel = feEl("div", { class: "ms-sheet", role: "dialog", "aria-modal": "true", "aria-label": "Filters", tabindex: "-1" },
    feEl("div", { class: "ms-sheet-head" },
      feEl("button", { type: "button", id: "msClearAll", class: "linklike", onClick: () => { clearFilters(); refreshFilters(); } }, "Clear all"),
      feEl("h3", {}, "Filters"),
      feEl("button", { type: "button", class: "ms-sheet-x", "aria-label": "Close", onClick: closeFilters }, feIcon("close"))),
    feEl("div", { class: "ms-sheet-body" },
      feEl("p", { class: "ms-ftitle" }, "Phase"),
      feEl("p", { class: "ms-fsub" }, "Choose one to see playlists that suit it."),
      feEl("div", { id: "msPhasePick" }),
      feEl("p", { class: "ms-ftitle" }, "Tags"),
      feEl("p", { class: "ms-fsub" }, "Words sharers chose for their music."),
      feEl("div", { id: "msTags", class: "ms-tags" }),
      feEl("label", { class: "ms-switchrow" },
        feEl("span", {}, "Hide playlists you have", feEl("small", {}, "Ones you got, and your own shares")),
        (() => { const hide = feEl("input", { type: "checkbox", id: "msHideAdded", class: "ms-switch", checked: sharing.hideAdded }); hide.addEventListener("change", () => { sharing.hideAdded = hide.checked; renderResults(); }); return hide; })())),
    feEl("div", { class: "ms-sheet-foot" }, feEl("button", { type: "button", id: "msShow", class: "ms-showbtn", onClick: closeFilters }, "")));
  sheet.appendChild(panel);
  sheet.addEventListener("click", (e) => { if (e.target === sheet) closeFilters(); });
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeFilters(); } });
  $("msDialog").appendChild(sheet);
  refreshFilters();
  if (typeof motionAllowed === "function" && motionAllowed(panel)) {
    sheet.animate([{ backgroundColor: "rgba(0,0,0,0)" }, { backgroundColor: "rgba(0,0,0,0.55)" }], { duration: 220, easing: EASE_OUT });
    panel.animate([{ transform: "translateY(100%)" }, { transform: "translateY(0)" }], { duration: 300, easing: EASE_OUT });
  }
  panel.focus({ preventScroll: true });
}
function refreshFilters() {
  const pick = $("msPhasePick");
  if (pick) { pick.textContent = ""; pick.appendChild(phaseCurve(sharing.phases, () => renderResults(), "Phase", true)); }
  if ($("msHideAdded")) $("msHideAdded").checked = sharing.hideAdded;
  renderResults();
}
function closeFilters() {
  const sheet = $("msSheet");
  if (!sheet) return;
  sheet.removeAttribute("id");
  for (const el of sheet.querySelectorAll("[id]")) el.removeAttribute("id");
  sheet.inert = true;
  const panel = sheet.querySelector(".ms-sheet");
  if (typeof motionAllowed === "function" && motionAllowed(panel)) {
    sheet.animate([{ backgroundColor: "rgba(0,0,0,0.55)" }, { backgroundColor: "rgba(0,0,0,0)" }], { duration: 180, easing: EASE_IN, fill: "forwards" });
    panel.animate([{ transform: "translateY(0)" }, { transform: "translateY(100%)" }], { duration: 200, easing: EASE_IN, fill: "forwards" }).onfinish = () => sheet.remove();
  } else sheet.remove();
  if ($("msFilters")) $("msFilters").focus();
}
function clearFilters() {
  sharing.phases.clear();
  sharing.tags.clear();
}

function matchesSearch(s, q) {
  if (!q) return true;
  const hay = `${s.name} ${s.by || ""} ${(s.tags || []).join(" ")} ${s.notes || ""} ${phaseNames(s.phases || [])} ${(s.artists || []).join(" ")}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}
function renderTags() {
  const box = $("msTags");
  if (!box) return;
  box.textContent = "";
  const tags = visibleTags();
  if (!tags.length) { box.appendChild(feEl("p", { class: "ms-fsub" }, "None yet.")); return; }
  // tags keep their places when chosen; a chosen one past the shown ones stays shown
  const shown = tags.filter((t, i) => i < sharing.tagsShown || sharing.tags.has(t.word));
  for (const t of shown) {
    box.appendChild(feEl("button", { type: "button", class: "ms-tag" + (sharing.tags.has(t.word) ? " ms-on" : ""), "aria-pressed": String(sharing.tags.has(t.word)),
      onClick: () => { if (sharing.tags.has(t.word)) sharing.tags.delete(t.word); else sharing.tags.add(t.word); renderResults(); } }, t.word));
  }
  if (shown.length < tags.length) box.appendChild(feEl("button", { type: "button", class: "ms-tag ms-more", onClick: () => { sharing.tagsShown += TAGS_STEP; renderTags(); } }, "More tags..."));
}
// the playlists the filters and search leave, before Hide added (so the empty list can say what hides them)
function filteredShares(hide = sharing.hideAdded) {
  const tagSets = (sharing.tagIndex || []).filter((t) => sharing.tags.has(t.word)).map((t) => t.ids);
  return sharing.library.shares.filter((s) => matchesSearch(s, sharing.search) && tagSets.every((ids) => ids.has(s.id)) && [...sharing.phases].every((i) => (s.phases || []).includes(i)) && !(hide && (isAdded(s) || isMine(s))));
}
function emptyState(icon, title, text, button) {
  return feEl("div", { class: "ms-empty" }, feEl("span", { class: "ms-empty-icon" }, feIcon(icon)), feEl("h3", {}, title), feEl("p", {}, text), button);
}
function renderResults() {
  renderTools();
  renderActive();
  renderTags();
  if ($("msPhasePick") && $("msPhasePick").firstChild) {
    // the curve in the panel follows chips removed under the buttons
    const lit = Array.from($("msPhasePick").querySelectorAll("button")).map((b) => b.classList.contains("ms-on"));
    if (lit.some((on, i) => on !== sharing.phases.has(i))) { $("msPhasePick").textContent = ""; $("msPhasePick").appendChild(phaseCurve(sharing.phases, () => renderResults(), "Phase", true)); }
  }
  const box = $("msResults");
  if (!box) return;
  box.textContent = "";
  if (sharing.loading && !sharing.library) { box.appendChild(feEl("p", { class: "ms-note" }, "Loading shared playlists...")); return; }
  if (sharing.error && !sharing.library) {
    box.appendChild(feEl("p", { class: "ms-note" }, sharing.error));
    box.appendChild(feEl("button", { type: "button", onClick: () => loadLibrary(true) }, "Try again"));
    return;
  }
  if (!sharing.library) return;
  const ov = sharing.overlapShown && sharing.overlapShown.usable && (sharing.sort === "most" || sharing.sort === "least") ? sharing.overlapShown : null;
  let list = filteredShares();
  if (sharing.sort === "longest") list = list.slice().sort((a, b) => b.ms - a.ms);
  else if (sharing.sort === "az") list = list.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  else if (ov) list = list.slice().sort((a, b) => ((ov.per[b.id] || {}).pct || 0) - ((ov.per[a.id] || {}).pct || 0)) ;
  if (ov && sharing.sort === "least") list.reverse();
  if ($("msShow")) $("msShow").textContent = list.length ? `Show ${list.length} playlist${list.length === 1 ? "" : "s"}` : "No playlists match";
  const total = sharing.library.shares.length;
  if (!total) {
    box.appendChild(emptyState("notes", "No playlists are shared yet", "Facilitators share playlists here for others to add to their own Spotify. Yours could be the first.",
      feEl("button", { type: "button", class: "ms-empty-main", onClick: () => switchTab("share") }, "Share playlists")));
    return;
  }
  if (!list.length) {
    const narrowed = filterCount() || sharing.search.trim();
    if (!narrowed || (sharing.hideAdded && filteredShares(false).length)) {
      // only Hide added is hiding them
      box.appendChild(emptyState("check", narrowed ? "You have all of these" : "You have them all", narrowed ? "Every playlist that matches is one you have or share." : "Every shared playlist is one you have or share.",
        feEl("button", { type: "button", class: "ms-empty-ghost", onClick: () => { sharing.hideAdded = false; if ($("msHideAdded")) $("msHideAdded").checked = false; renderResults(); } }, "Show them")));
      return;
    }
    const words = !!sharing.search.trim(), filters = filterCount() > 0;
    const tryText = words && filters ? "Try other words or fewer filters." : words ? "Try other words." : "Try fewer filters.";
    box.appendChild(emptyState(words && !filters ? "search" : "sliders", "No playlists match", `${total} playlist${total === 1 ? " is" : "s are"} shared. ${tryText}`,
      feEl("button", { type: "button", class: "ms-empty-ghost", onClick: () => { clearFilters(); if (sharing.searchOpen) closeSearch(); else renderResults(); refreshFilters(); } }, filters ? "Clear filters" : "Clear search")));
    return;
  }
  const shownOverlap = (sharing.sort === "most" || sharing.sort === "least") && sharing.overlap && sharing.overlap.usable ? sharing.overlap : null;
  for (const s of list) box.appendChild(shareRow(s, shownOverlap));
  fitCovers();
}
// Each row's cover is a square as tall as its text, so its top and bottom line up with the name and the tags. CSS cannot make a box
// square from a stretched height, so the text is measured, again whenever the list changes width.
let coverWatch = null;
function fitCovers() {
  const box = $("msResults") || document.querySelector("#msBody .ms-hero");   // the list, or a playlist's page (its cover lines up with the name and the lines under it)
  if (!box) return;
  for (const row of box.matches(".ms-hero") ? [box] : box.querySelectorAll(".ms-row")) {
    const cover = row.querySelector(".ms-cover"), text = row.querySelector(".ms-text, .ms-hero-text");
    const h = text && text.offsetHeight;
    if (cover && h) cover.style.width = cover.style.height = (row.matches(".ms-row") ? h : Math.max(48, h)) + "px";   // a row's cover is as tall as its name and who
    const tags = row.querySelector(".ms-rowtags");
    if (tags) fitRowTags(tags);
  }
  if (!coverWatch && window.ResizeObserver) {
    let width = 0;
    coverWatch = new ResizeObserver(() => { const b = $("msResults") || document.querySelector("#msBody .ms-hero"); if (b && b.offsetWidth !== width) { width = b.offsetWidth; fitCovers(); } });
  }
  if (coverWatch) { coverWatch.disconnect(); coverWatch.observe(box); }
}
// a row's tags on one line: as many as fit, then "+N more" for the rest (measured again when the width changes)
function fitRowTags(box) {
  const tags = Array.from(box.querySelectorAll(".ms-rowtag")), more = box.querySelector(".ms-rowtag-more");
  const fits = () => box.scrollWidth <= box.clientWidth;
  let shown = tags.length;
  const show = (n) => { tags.forEach((t, i) => { t.hidden = i >= n; }); more.hidden = n >= tags.length; more.textContent = `+${tags.length - n} more`; };
  show(shown);
  while (shown > 1 && !fits()) show(--shown);
}
function shareCoverEl(s, cls = "ms-cover") {
  return s.cover ? feEl("img", { class: cls, src: s.cover, alt: "", loading: "lazy" }) : feEl("span", { class: cls + " ms-nocover" }, feIcon("notes"));
}
function addButton(s, big = false) {
  // the person's own share: nothing to add (listed for now so they can see it as others do)
  if (isMine(s)) return feEl("span", { class: big ? "ms-addbig ms-yours" : "ms-add ms-yours" }, feIcon("user"), big ? "Shared by you" : "Yours");
  if (sharing.adding.has(s.id)) return feEl("button", { type: "button", class: big ? "ms-addbig ms-busy" : "ms-add ms-busy", disabled: true }, "Adding...");
  if (isAdded(s)) return feEl("button", { type: "button", class: big ? "ms-addbig ms-done" : "ms-add ms-done", disabled: true }, feIcon("check"), "Gotten");
  return feEl("button", { type: "button", class: big ? "ms-addbig" : "ms-add", disabled: connection !== "ready", onClick: (e) => { e.stopPropagation(); addShared(s); } }, big ? feIcon("plus") : null, big ? "Get this playlist" : "Get");
}
function shareRow(s, ov) {
  const per = ov && ov.per[s.id];
  const row = feEl("div", { class: "ms-row", role: "button", tabindex: "0", onClick: () => openDetail(s.id) },
    // a grid: the cover (two lines tall), the name (one line, cut with an ellipsis) and who, and Get at the top right;
    // under them the tags across the row with the phase curve in the bottom right corner, then the overlap and any error
    shareCoverEl(s),
    feEl("div", { class: "ms-text" },
      feEl("div", { class: "ms-name", text: s.name, title: s.name }),
      feEl("div", { class: "ms-sub" }, `${s.by || "Anonymous"} · ${lengthText(s.ms / 60000)}`)),
    feEl("div", { class: "ms-rowside" }, addButton(s)),
    (s.tags || []).length ? feEl("div", { class: "ms-rowtags" }, ...s.tags.map((t) => feEl("span", { class: "ms-rowtag" }, t)), feEl("span", { class: "ms-rowtag-more" })) : null,   // as many as fit on one line (fitRowTags)
    (s.phases || []).length ? feEl("div", { class: "ms-rowcurve" }, miniCurve(s.phases)) : null,
    per ? feEl("div", { class: "ms-ov" }, `${per.pct}% already in your recipes`) : null,
    sharing.addErrors[s.id] ? feEl("div", { class: "ms-error" }, sharing.addErrors[s.id]) : null);
  row.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === row) { e.preventDefault(); row.click(); } });
  return row;
}
// A playlist's page slides in from the right, pushing the list out to the left; Back reverses it. The list keeps where it was scrolled to.
function openDetail(id) {
  sharing.listScroll = $("msBody").scrollTop;
  slideBody(1, () => { sharing.detail = id; sharing.showOverlapSongs = false; renderSharing(); $("msBody").scrollTop = 0; });
}
function closeDetail() {
  slideBody(-1, () => { sharing.detail = null; renderSharing(); $("msBody").scrollTop = sharing.listScroll || 0; });
}
function slideBody(dir, change) {
  const body = $("msBody");
  if (typeof motionAllowed !== "function" || !motionAllowed(body)) { change(); return; }
  // the old page stays drawn as an untouchable copy while it leaves
  const ghost = body.cloneNode(true);
  ghost.removeAttribute("id");
  for (const el of ghost.querySelectorAll("[id]")) el.removeAttribute("id");
  ghost.classList.add("ms-slide-ghost");
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  Object.assign(ghost.style, { top: body.offsetTop + "px", left: body.offsetLeft + "px", width: body.offsetWidth + "px", height: body.offsetHeight + "px" });
  const top = body.scrollTop;
  body.after(ghost);
  ghost.scrollTop = top;
  change();
  const opts = { duration: 320, easing: EASE_OUT };
  ghost.animate([{ transform: "translateX(0)", opacity: 1 }, { transform: `translateX(${-dir * 40}%)`, opacity: 0 }], opts).onfinish = () => ghost.remove();
  body.animate([{ transform: `translateX(${dir * 100}%)` }, { transform: "translateX(0)" }], opts);
}
function isMine(s) {
  if (sharing.mine) return sharing.mine.some((m) => m.id === s.id);
  try { return (JSON.parse(localStorage.getItem(SHARING_MINE_KEY)) || []).includes(s.id); } catch (err) { return false; }
}
function renderDetail(body) {
  const s = sharing.library && sharing.library.shares.find((x) => x.id === sharing.detail);
  if (!s) { sharing.detail = null; renderSharing(); return; }
  body.appendChild(feEl("div", { class: "ms-back-bar" }, feEl("button", { type: "button", class: "ms-back", id: "msBack", onClick: () => closeDetail() }, feIcon("back"), "All playlists")));
  body.appendChild(feEl("div", { class: "ms-hero" }, shareCoverEl(s, "ms-cover ms-cover-big"),
    feEl("div", { class: "ms-hero-text" }, feEl("h3", { text: s.name }), feEl("div", { class: "ms-sub" }, isMine(s) ? "Shared by you" : s.by ? `Shared by ${s.by}` : "Shared anonymously"), feEl("div", { class: "ms-sub" }, `${songCountText(s.count)} · ${lengthText(s.ms / 60000)}`))));
  if (!isMine(s)) body.appendChild(feEl("div", { class: "ms-actions" }, addButton(s, true)));   // the person's own: the line under the name already says Shared by you
  if (sharing.addErrors[s.id]) body.appendChild(feEl("p", { class: "ms-error" }, sharing.addErrors[s.id]));
  // when the sharer plays it, as a sentence: "Maya plays it in Ascent and Plateau" (never "the": "in the Beginning" reads wrong)
  body.appendChild(phaseLine(s));
  body.appendChild(phaseCurve(new Set(s.phases || [])));
  body.appendChild(feEl("div", { class: "ms-sec" }, "Tags"));
  body.appendChild(feEl("div", { class: "ms-tags ms-tags-plain" }, ...(s.tags || []).map((t) => feEl("span", { class: "ms-tag" }, t))));
  if (s.notes) {
    body.appendChild(feEl("div", { class: "ms-sec" }, "Description"));
    body.appendChild(feEl("p", { class: "ms-long" }, s.notes));
  }
  // the songs, with a preview of each; a share made before song names were kept shows the artists with the most songs instead
  const names = songNamesFor(s);
  if (names.state === "none" && s.artists && s.artists.length) body.appendChild(feEl("div", { class: "ms-facts" }, includesText(s.artists)));
  const ov = sharing.overlap && sharing.overlap.playlists ? sharing.overlap.per[s.id] : null;
  if (ov && ov.same && names.state === "none") {   // no song list to mark: the box with Show them, as before song names were kept
    const box = feEl("div", { class: "ms-overlap" }, feIcon("overlap"), feEl("span", {}, `${ov.same === 1 ? "1 of these songs" : `${ov.same} of these songs`} (${ov.pct}%) ${ov.same === 1 ? "is" : "are"} already in your recipes. `,
      feEl("button", { type: "button", class: "linklike", onClick: () => { sharing.showOverlapSongs = !sharing.showOverlapSongs; renderSharing(); } }, sharing.showOverlapSongs ? "Hide them" : "Show them")));
    body.appendChild(box);
    if (sharing.showOverlapSongs) {
      const labels = sharing.overlap.labels;
      body.appendChild(feEl("ul", { class: "ms-songs" }, ...ov.songs.map(([id, isrc]) => feEl("li", {}, labels.get("isrc:" + isrc) || labels.get("spotify:track:" + id) || "A song"))));
    }
  }
  if (names.state !== "none") renderSongs(body, s, names, ov && ov.same ? ov : null);
  body.appendChild(feEl("div", { class: "ms-foot-links" }, feEl("button", { type: "button", class: "linklike ms-report", onClick: () => reportShare(s) }, feIcon("flag"), "Report")));
  fitCovers();
}

// ---------------------------------------------------------------- a playlist's songs and their previews
// The names come from the worker one playlist at a time, when its page opens (never with the library). A preview is looked up at Deezer
// by the song's ISRC only when its play button is pressed: one request, nothing before (decided by Ron, 2026-11-07).
const PREVIEW_KEEP_MS = 10 * 60 * 1000;   // Deezer's preview addresses expire; one looked up is reused for 10 minutes
const previewUrls = new Map();   // ISRC: { url (null: Deezer has no preview), at }
let previewAudio = null, deezerCalls = 0;

function songNamesFor(s) {
  let got = sharing.songNames.get(s.id);
  if (!got || got.at !== s.updatedAt || got.state === "retry") {
    got = { at: s.updatedAt, state: "loading" };
    sharing.songNames.set(s.id, got);
    sharingFetch("GET", "/songs/" + s.id).then((d) => {
      // the names follow the songs in the library one for one; anything else is a share made before names were kept
      const ok = d && Array.isArray(d.names) && d.names.length === s.songs.length;
      Object.assign(got, ok ? { state: "ok", list: d.names } : { state: "none" });
    }, (err) => Object.assign(got, { state: "error", error: err.message }))
      .then(() => { if (sharing.detail === s.id) renderSharing(); });
  }
  return got;
}
const songLength = (ms) => { const sec = Math.round((ms || 0) / 1000); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`; };

// The list's title says what the play buttons give (decided by Ron, 2026-11-07, so nobody expects whole songs); under it, a check marks
// the songs already in the person's recipes, explained once by the line above the list.
function renderSongs(body, s, names, ov) {
  body.appendChild(feEl("div", { class: "ms-sec" }, "30 second previews from Deezer"));
  if (names.state === "loading") { body.appendChild(feEl("p", { class: "ms-song-note" }, "Loading the songs...")); return; }
  if (names.state === "error") {
    body.appendChild(feEl("p", { class: "ms-song-note" }, `${names.error} `,
      feEl("button", { type: "button", class: "linklike", onClick: () => { names.state = "retry"; renderSharing(); } }, "Try again")));
    return;
  }
  const have = new Set(ov ? ov.songs.map(([id]) => id) : []);
  if (ov) body.appendChild(feEl("div", { class: "ms-have-key" }, feIcon("check"), ov.same === 1 ? "1 song already in your recipes" : `${ov.same} songs already in your recipes`));
  if (sharing.previewNote) body.appendChild(feEl("p", { class: "ms-song-note" }, sharing.previewNote));
  const list = feEl("div", { class: "ms-tracks" });
  names.list.forEach((n, i) => list.appendChild(songRow(s, i, n, have.has(s.songs[i] && s.songs[i][0]))));
  body.appendChild(list);
}
function songRow(s, i, [title, artist, ms], had) {
  const isrc = s.songs[i] && s.songs[i][1];
  const known = isrc && previewUrls.get(isrc);
  const none = !isrc || (known && known.url === null);   // no recording code, or Deezer has no preview of it
  const p = sharing.player, on = !!(p && p.share === s.id && p.index === i);
  const label = title || "A song";
  const btn = feEl("button", { type: "button", class: "ms-play" + (on ? " ms-play-on" : ""), disabled: none,
    "aria-label": none ? `No preview of ${label}` : on && p.state === "playing" ? `Pause ${label}` : `Play a preview of ${label}`,
    onClick: () => togglePreview(s, i) });
  if (on && p.state === "loading") btn.appendChild(feEl("span", { class: "ms-play-spin" }));
  else btn.appendChild(feIcon(on && p.state === "playing" ? "pause" : "play"));
  if (on && p.state !== "loading") btn.appendChild(previewRing());
  return feEl("div", { class: "ms-track" + (on ? " ms-track-on" : "") + (none ? " ms-track-none" : "") }, btn,
    feEl("div", { class: "ms-track-text" },
      feEl("div", { class: "ms-track-name" }, feEl("span", { class: "ms-track-title", text: label }), had ? feEl("span", { class: "ms-track-have", title: "Already in your recipes", "aria-label": "Already in your recipes" }, feIcon("check")) : null),
      artist ? feEl("div", { class: "ms-track-artist", text: artist }) : null),
    // while its preview is on, the length counts the preview down instead
    feEl("span", { class: "ms-track-len" + (on && p.state !== "loading" ? " ms-track-left" : "") }, on && p.state !== "loading" ? previewLeft() : songLength(ms)));
}
function previewLeft() {
  if (!previewAudio) return "0:30";
  const d = previewAudio.duration && isFinite(previewAudio.duration) ? previewAudio.duration : 30;
  return songLength(Math.max(0, d - previewAudio.currentTime) * 1000);
}
const PREVIEW_FADE_S = 2;   // the last two seconds fade out, so the end sounds meant
function previewTick() {
  setRing(document.querySelector("#msBody .ms-play-on .ms-ring"));
  const left = document.querySelector("#msBody .ms-track-left");
  if (left) left.textContent = previewLeft();
  const d = previewAudio.duration && isFinite(previewAudio.duration) ? previewAudio.duration : 30;
  try { previewAudio.volume = Math.max(0, Math.min(1, (d - previewAudio.currentTime) / PREVIEW_FADE_S)); } catch (err) { /* iPhones set the volume themselves */ }
}
// the ring around the playing song's button fills over the preview
function previewRing() {
  const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  ring.setAttribute("viewBox", "0 0 24 24");
  ring.setAttribute("class", "ms-ring");
  ring.setAttribute("aria-hidden", "true");
  ring.innerHTML = '<circle cx="12" cy="12" r="11" class="ms-ring-track"/><circle cx="12" cy="12" r="11" class="ms-ring-fill" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>';
  setRing(ring);
  return ring;
}
function setRing(ring) {
  const fill = ring && ring.querySelector(".ms-ring-fill");
  if (!fill || !previewAudio) return;
  const d = previewAudio.duration && isFinite(previewAudio.duration) ? previewAudio.duration : 30;
  fill.setAttribute("stroke-dashoffset", String(100 - Math.min(100, (previewAudio.currentTime / d) * 100)));
}

// a tiny silent sound, played on the tap itself: phones play sound only from a tap, and the lookup at Deezer comes after it
function silentSound() {
  const bytes = new Uint8Array(46), v = new DataView(bytes.buffer);
  "RIFF".split("").forEach((c, i) => (bytes[i] = c.charCodeAt(0)));
  v.setUint32(4, 38, true);
  "WAVEfmt ".split("").forEach((c, i) => (bytes[8 + i] = c.charCodeAt(0)));
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  "data".split("").forEach((c, i) => (bytes[36 + i] = c.charCodeAt(0)));
  v.setUint32(40, 2, true);
  return "data:audio/wav;base64," + btoa(String.fromCharCode(...bytes));
}
function audioPlayer() {
  if (previewAudio) return previewAudio;
  previewAudio = new Audio();
  previewAudio.preload = "none";
  previewAudio.addEventListener("timeupdate", previewTick);
  previewAudio.addEventListener("ended", () => { if (sharing.player && sharing.player.state === "playing") { sharing.player = null; renderSharing(); } });
  return previewAudio;
}
function stopPreview() {
  if (previewAudio) { previewAudio.pause(); previewAudio.removeAttribute("src"); try { previewAudio.load(); } catch (err) { /* nothing loaded */ } }
  if (!sharing.player) return;
  sharing.player = null;
  renderSharing();
}
async function togglePreview(s, i) {
  const audio = audioPlayer();
  const p = sharing.player;
  sharing.previewNote = "";
  if (p && p.share === s.id && p.index === i) {   // the same song: pause, or go on from where it was
    if (p.state === "playing") { audio.pause(); p.state = "paused"; }
    else if (p.state === "paused") { p.state = "playing"; audio.play().catch(() => {}); }
    renderSharing();
    return;
  }
  const isrc = s.songs[i] && s.songs[i][1];
  if (!isrc) return;
  const turn = sharing.player = { share: s.id, index: i, state: "loading" };
  audio.pause();
  const known = previewUrls.get(isrc);
  const fresh = known && Date.now() - known.at < PREVIEW_KEEP_MS;
  if (!fresh) { audio.src = silentSound(); audio.play().catch(() => {}); }   // still the tap: lets the preview start once it is found
  renderSharing();
  let url = fresh ? known.url : null;
  if (!fresh) {
    try { url = await deezerPreview(isrc); previewUrls.set(isrc, { url, at: Date.now() }); }
    catch (err) { if (sharing.player === turn) { sharing.player = null; sharing.previewNote = err.message; renderSharing(); } return; }
  }
  if (sharing.player !== turn) return;   // another song was pressed, or the page closed, while this one was looked up
  if (!url) { sharing.player = null; renderSharing(); return; }   // Deezer has no preview: the button fades
  turn.state = "playing";
  audio.src = url;
  try { audio.volume = 1; } catch (err) { /* set by the phone */ }
  audio.play().catch(() => { if (sharing.player === turn) { sharing.player = null; sharing.previewNote = "The preview could not play."; renderSharing(); } });
  renderSharing();
}
// Deezer's public API answers JSONP (it sends no CORS headers): a script tag that calls back with the track, or with an error when it has none.
// It is sent only the ISRC.
function deezerPreview(isrc) {
  return new Promise((resolve, reject) => {
    const name = "msDeezer" + ++deezerCalls;
    const script = document.createElement("script");
    const done = (url, err) => { clearTimeout(timer); delete window[name]; script.remove(); if (err) reject(err); else resolve(url); };
    const timer = setTimeout(() => done(null, new Error("Deezer did not answer. Try again in a moment.")), 10000);
    window[name] = (d) => done(d && !d.error && typeof d.preview === "string" && /^https:\/\//.test(d.preview) ? d.preview : null);
    script.onerror = () => done(null, new Error("Deezer could not be reached. Check your connection and try again."));
    script.src = `https://api.deezer.com/track/isrc:${encodeURIComponent(isrc)}?output=jsonp&callback=${name}`;
    document.head.appendChild(script);
  });
}

async function reportShare(s) {
  const reasons = [["offensive", "Offensive"], ["spam", "Spam or nonsense"], ["not theirs", "Copied from someone else"], ["other", "Something else"]];
  const result = await new Promise((resolve) => {
    let reason = null;
    const note = feEl("textarea", { class: "ms-ta", rows: "3", maxlength: "500", placeholder: "Anything else (optional)", "aria-label": "Note" });
    const send = feEl("button", { type: "button", class: "ms-addbig", disabled: true, onClick: () => done({ reason, note: note.value }) }, "Send report");
    const radios = reasons.map(([value, label]) => {
      const input = feEl("input", { type: "radio", name: "msReason", value });
      input.addEventListener("change", () => { reason = value; send.disabled = false; });
      return feEl("label", { class: "ms-radio" }, input, label);
    });
    const done = (v) => { overlay.remove(); document.removeEventListener("keydown", onKey); resolve(v); };
    const onKey = (e) => { if (e.key === "Escape") done(null); };
    const overlay = feEl("div", { class: "fe-overlay", id: "msReportDialog", onClick: () => done(null) },
      feEl("div", { class: "fe-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Report", onClick: (e) => e.stopPropagation() },
        feEl("h3", { text: `Report ${named(s.name)}` }),
        feEl("p", { class: "muted" }, "The developer of this app reads every report."),
        feEl("div", { class: "ms-radios" }, ...radios), note,
        feEl("div", { class: "row" }, send, feEl("button", { type: "button", onClick: () => done(null) }, "Cancel"))));
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey);
    radios[0].querySelector("input").focus();
  });
  if (!result) return;
  try {
    await sharingFetch("POST", "/report", { share: s.id, reason: result.reason, note: result.note });
    showNotices([{ text: `Thanks. ${named(s.name)} was reported.`, transient: true }]);
  } catch (err) { await askSyncChoice("Not reported", err.message, [{ label: "Close", value: null }]); }
}

// ---------------------------------------------------------------- Share playlists
function shareCandidates() {
  if (!me) return [];
  const copies = new Set(Object.values(sharingCopies()));
  return playlists.filter((p) => p.owner === me.id && !p.isSave && !p.madeByApp).map((p) => ({ p, copy: copies.has(p.id) }));
}
function emptyPick() { return { on: false, phases: new Set(), tags: [], notes: "", shared: null, touched: false, update: false }; }
function pickFromShare(s) { return { on: true, phases: new Set(s.phases || []), tags: (s.tags || []).slice(), notes: s.notes || "", shared: s, touched: false, update: false }; }
function pickFor(p) {
  if (!sharing.picks[p.id]) {
    sharing.picks[p.id] = emptyPick();
    const known = knownBlock(p);
    if (known && known.why === "short") sharing.picks[p.id].short = true;
    if (known && known.why === "copy") sharing.picks[p.id].copyOf = known.of || "";
  }
  return sharing.picks[p.id];
}
function blockRecord() {
  try { return JSON.parse(localStorage.getItem(SHARING_BLOCKED_KEY) || "{}") || {}; } catch (err) { return {}; }
}
// what was found before, if the playlist has not changed in Spotify since (a list kept from the last connection has no snapshot, so the record stands)
function knownBlock(p) {
  const b = blockRecord()[p.id];
  return b && (!p.snapshot || !b.snap || b.snap === p.snapshot) ? b : null;
}
function rememberBlock(p, why, of) {
  const all = blockRecord();
  if (why) all[p.id] = { snap: p.snapshot || null, why, of: of || "" }; else delete all[p.id];
  try { localStorage.setItem(SHARING_BLOCKED_KEY, JSON.stringify(all)); } catch (err) { /* private browsing: known for this visit only */ }
}
// whether what is ticked and typed differs from what is shared
function pickDiffers(pick, shared) {
  return [...pick.phases].sort().join() !== (shared.phases || []).slice().sort().join() || pick.tags.join("|") !== (shared.tags || []).join("|");
}
const pickComplete = (pick) => pick.phases.size > 0 && pick.tags.length >= SHARE_TAGS_MIN;
function sharedFor(p) { return sharing.mine ? sharing.mine.find((s) => s.playlist === p.id) || null : null; }
function pickState(p, pick) {
  // what a row says, and whether it is ready to share
  const shared = sharedFor(p);
  if (pick.checking) return { text: "Checking its length...", ready: false };
  if (pick.short) return { text: "Under two hours, so it cannot be shared.", ready: false, cls: "ms-dis" };
  if (pick.copyOf != null) return { text: "A copy of a playlist someone else shares, so it cannot be shared.", ready: false, cls: "ms-dis" };
  if (pick.error) return { text: pick.error, ready: false, cls: "ms-need" };
  // not complete: the counters beside the labels say what is missing in pink, so the row says nothing more
  if (pick.on && !pickComplete(pick)) return { text: "", ready: false };
  if (shared && !pick.on) return { text: "Will stop being shared", ready: true, cls: "ms-need" };
  if (shared && (pick.update || pickDiffers(pick, shared))) return { text: "", ready: true };   // the bottom button counts it
  if (shared && p.snapshot && shared.snapshot && p.snapshot !== shared.snapshot) return { text: "Changed in Spotify since it was shared.", ready: true, offerUpdate: true };
  if (shared) return { text: shared.hidden ? "Hidden after reports" : "", ready: true };
  return { text: "", ready: !!pick.on };   // ticked and filled in: nothing to say, the bottom button counts it
}
function shortDate(ms) { const d = new Date(ms); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; }
function pendingChanges() {
  const out = { share: [], update: [], stop: [], total: 0 };
  for (const { p, copy } of shareCandidates()) {
    if (copy) continue;
    const pick = sharing.picks[p.id];
    if (!pick) continue;
    const shared = sharedFor(p), state = pickState(p, pick);
    if (shared && !pick.on) out.stop.push(p);
    else if (!shared && pick.on && state.ready) out.share.push(p);
    else if (shared && pick.on && state.ready && (pick.update || pickDiffers(pick, shared) || (shared.by || null) !== shownAsName())) out.update.push(p);
  }
  out.total = out.share.length + out.update.length + out.stop.length;
  return out;
}
function resetPicks() {
  for (const id of Object.keys(sharing.picks)) {
    const shared = sharing.mine && sharing.mine.find((s) => s.playlist === id);
    sharing.picks[id] = shared ? pickFromShare(shared) : emptyPick();
  }
}
function renderShareYours(body) {
  if (introOpen("share")) body.appendChild(introCard("share"));
  if (connection !== "ready" || !me) { body.appendChild(feEl("p", { class: "ms-note" }, "Connect to Spotify to share your playlists.")); return; }
  if (sharing.mineError) body.appendChild(feEl("p", { class: "ms-error" }, sharing.mineError));
  if (!sharing.mine && !sharing.mineError) { body.appendChild(feEl("p", { class: "ms-note" }, "Loading...")); return; }
  const list = feEl("div", { class: "ms-share-list" });
  // shared (as of opening) first, then the rest; at the bottom the ones that can't be shared: known as such on opening, then copies
  const sunk = (p) => !!(sharing.sunk && sharing.sunk.has(p.id) && knownBlock(p));
  const rank = ({ p, copy }) => copy ? 2 : sunk(p) ? 1 : 0;
  const top = sharing.topIds || new Set(sharing.mine.map((s) => s.playlist));   // until this opening's read arrives, the shares kept from before
  const rows = shareCandidates().sort((a, b) => (rank(a) - rank(b)) || (top.has(b.p.id) - top.has(a.p.id)));
  for (const { p, copy } of rows) list.appendChild(shareYoursRow(p, copy));
  if (!rows.length) list.appendChild(feEl("p", { class: "ms-note" }, "No playlists of your own found."));
  body.appendChild(list);
  renderShareFoot();
}
function shareYoursRow(p, copy) {
  const pick = pickFor(p);
  const row = feEl("div", { class: "ms-srow", id: "msRow-" + p.id });
  // under two hours (known once its songs are read): no checkbox (its space kept, so the covers line up), a grey name, and one line saying so in place of the songs
  const short = !copy && (pick.short || pick.copyOf != null);   // either way the row looks the same, with its own line
  const why = pick.short ? "Under two hours, so it can't be shared."
    : pick.copyOf ? `A copy of ${named(pick.copyOf)}, which someone else shares, so it can't be shared.` : "A copy of a playlist someone else shares, so it can't be shared.";
  const box = feEl("input", { type: "checkbox", class: "ms-check" + (short ? " ms-nobox" : ""), checked: !copy && pick.on, disabled: copy || short, "aria-label": p.name, "aria-hidden": short ? "true" : null, tabindex: short ? "-1" : null });
  box.addEventListener("change", () => toggleShare(p, box.checked));
  const cover = p.image ? feEl("img", { class: "ms-cover", src: p.image, alt: "" }) : feEl("span", { class: "ms-cover ms-nocover" }, feIcon("notes"));
  const text = feEl("div", { class: "ms-text" }, feEl("div", { class: "ms-name" + (copy || short ? " ms-dim" : ""), text: p.name }),
    short ? feEl("div", { class: "ms-sub", text: why })
      : feEl("div", { class: "ms-sub ms-subrow" }, feEl("span", { class: "ms-subtext" }, !copy && pick.on && songsLine(p, pick, !fieldsShown(p, pick)) || (p.count != null ? songCountText(p.count) : "")),
        copy ? null : rowAction(p, pick)));
  if (copy) text.appendChild(feEl("div", { class: "ms-state ms-dis" }, "Gotten from Music sharing, so it cannot be shared again."));
  else if (!short) text.appendChild(stateLine(p, pick));
  row.append(box, cover, text);
  if (!copy && fieldsShown(p, pick)) row.appendChild(shareFields(p, pick));   // under the row, the full width
  return row;
}
// A shared playlist folds to its name and its songs, with Edit details at the right of the songs line; Edit details unfolds the same fields a new share has, and Done folds them again.
// It stays open while something it needs is missing. After a share goes through, the row folds (applyShares).
function fieldsShown(p, pick) {
  if (!pick.on || pick.short || pick.copyOf != null || pick.checking) return false;
  return !sharedFor(p) || pick.open || !pickState(p, pick).ready;
}
function stateLine(p, pick) {
  const state = pickState(p, pick), shared = sharedFor(p);
  const line = feEl("div", { class: "ms-state " + (state.cls || ""), id: "msState-" + p.id }, state.text);
  if (state.offerUpdate) line.appendChild(feEl("button", { type: "button", class: "linklike ms-inline", onClick: () => { pick.update = true; pick.touched = true; refreshRow(p); } }, "Update"));
  return line;
}
// Edit details (or Done while unfolded), at the right end of the songs line
function rowAction(p, pick) {
  const slot = feEl("span", { class: "ms-rowact", id: "msAct-" + p.id });
  if (sharedFor(p) && pick.on && pickState(p, pick).ready) {
    slot.appendChild(pick.open
      ? feEl("button", { type: "button", class: "linklike ms-inline", id: "msDone-" + p.id, onClick: () => foldRow(p, false) }, "Done")
      : feEl("button", { type: "button", class: "linklike ms-inline", id: "msEdit-" + p.id, onClick: () => foldRow(p, true) }, "Edit details"));
  }
  return slot;
}
async function foldRow(p, open) {
  const pick = pickFor(p);
  const fields = !open && $("msRow-" + p.id) && $("msRow-" + p.id).querySelector(".ms-fields");
  if (fields) { revealSmoothly(fields, false); if (fields._fxFold) await fields._fxFold.finished.catch(() => {}); }
  pick.open = open;
  refreshRow(p);
  const shown = open && $("msRow-" + p.id) && $("msRow-" + p.id).querySelector(".ms-fields");
  if (shown) { shown.hidden = true; revealSmoothly(shown, true); }
}
// the line the app adds about the songs (how many, how long, the artists heard most), from the songs read when ticked, or from the share itself
// folded (a shared row with Edit details), it is only the songs and length, to keep the row short
function songsLine(p, pick, folded = false) {
  const facts = (f) => folded ? shareFacts({ ...f, artists: [] }) : shareFacts(f);
  if (pick.songs) return facts(pick.songs);
  // the person's list of shares has no song facts; the library's copy of the same share does
  const shared = sharedFor(p), pub = shared && sharing.library && sharing.library.shares.find((x) => x.id === shared.id);
  return pub && pub.ms && pub.count ? facts(pub) : "";
}
function shareFields(p, pick) {
  const changed = () => { pick.touched = true; refreshState(p); };
  // phases: the curve, each part a button
  const phaseMeter = feEl("span", { class: "ms-meter" });
  // the chosen names, or how many once more than two would not fit on a phone's line
  const showPhases = () => { phaseMeter.textContent = !pick.phases.size ? "Choose all that apply" : pick.phases.size > 2 ? pick.phases.size + " phases" : phaseNames([...pick.phases].sort()); phaseMeter.classList.toggle("ms-short", !pick.phases.size); };
  showPhases();
  const phases = feEl("div", { class: "ms-field" }, feEl("div", { class: "ms-flabel" }, feEl("b", {}, "When do you play it?"), phaseMeter),
    phaseCurve(pick.phases, () => { showPhases(); changed(); }, "When do you play it?"));
  // no notes box: the playlist's Spotify description goes with the share as its notes (shown to people looking for playlists)
  return feEl("div", { class: "ms-fields" }, phases, tagField(p, pick, changed));
}
// Tags are typed as words with commas or spaces between them (one word each; a dash joins two, and a suggestion of two words stays whole); each becomes a chip with an x. Tags other people use are offered under the box.
function tagField(p, pick, changed) {
  const input = feEl("input", { type: "text", class: "ms-taginput", maxlength: String(SHARE_TAG_CHARS + 20), "aria-label": "Add a tag", enterkeyhint: "done", autocapitalize: "none", spellcheck: "false" });
  const box = feEl("div", { class: "ms-tagbox", onClick: (e) => { if (e.target === box) input.focus(); } });
  const meter = feEl("span", { class: "ms-meter" });
  const suggest = feEl("div", { class: "ms-suggest" });
  const hint = feEl("p", { class: "ms-taghint", hidden: true }, "For a tag of two words, join them with a dash: no-vocals.");   // only while typing in the box
  const addOne = (part) => {
    const t = cleanTag(String(part).replace(/-+/g, " "));   // a dash joins two words into one tag: no-vocals is "no vocals"
    if (t.length >= 2 && !pick.tags.includes(t) && pick.tags.length < SHARE_TAGS_MAX) pick.tags.push(t);
  };
  const add = (text) => { for (const part of String(text).split(/[,\s]+/)) addOne(part); };
  const showSuggestions = () => {
    suggest.textContent = "";
    if (pick.tags.length >= SHARE_TAGS_MAX) return;
    const q = cleanTag(input.value);
    const found = knownTags().filter((t) => !pick.tags.includes(t) && (!q || t.startsWith(q) || t.includes(" " + q))).slice(0, q ? 5 : 6);
    if (!found.length) return;
    suggest.appendChild(document.createTextNode(q ? "Tags others use: " : "Tags others use often: "));
    found.forEach((t, i) => {
      if (i) suggest.appendChild(document.createTextNode(", "));
      // mousedown keeps the focus in the box, so the half-typed word is not added on the way
      const b = feEl("button", { type: "button", class: "linklike ms-sugg", onClick: () => { addOne(t); input.value = ""; draw(); changed(); input.focus(); } }, t);
      b.addEventListener("mousedown", (e) => e.preventDefault());
      suggest.appendChild(b);
    });
  };
  const draw = () => {
    box.textContent = "";
    for (const t of pick.tags) {
      box.appendChild(feEl("span", { class: "ms-tag ms-on ms-tagchip" }, t,
        feEl("button", { type: "button", class: "ms-tagx", "aria-label": "Remove " + t, onClick: () => { pick.tags = pick.tags.filter((x) => x !== t); draw(); changed(); input.focus(); } }, "×")));
    }
    input.placeholder = pick.tags.length ? "" : "Describe the music, e.g. gentle, piano";
    input.hidden = pick.tags.length >= SHARE_TAGS_MAX;
    box.appendChild(input);
    const n = pick.tags.length;
    meter.textContent = n < SHARE_TAGS_MIN ? `${n}, at least ${SHARE_TAGS_MIN}` : `${n} of ${SHARE_TAGS_MAX}`;
    meter.classList.toggle("ms-short", n < SHARE_TAGS_MIN);
    showSuggestions();
  };
  input.addEventListener("input", () => {
    if (/[,\s]/.test(input.value)) { const parts = input.value.split(/[,\s]+/); const rest = parts.pop(); add(parts.join(" ")); input.value = rest; draw(); changed(); input.focus(); }
    else showSuggestions();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); if (input.value.trim()) { add(input.value); input.value = ""; draw(); changed(); input.focus(); } }
    else if (e.key === "Backspace" && !input.value && pick.tags.length) { pick.tags.pop(); draw(); changed(); input.focus(); }
  });
  input.addEventListener("focus", () => { hint.hidden = false; });
  input.addEventListener("blur", () => { hint.hidden = true; if (input.value.trim()) { add(input.value); input.value = ""; draw(); changed(); } });
  draw();
  return feEl("div", { class: "ms-field" }, feEl("div", { class: "ms-flabel" }, feEl("b", {}, "Tags"), meter), box,
    hint, suggest);
}
function refreshState(p) {
  const pick = pickFor(p), line = $("msState-" + p.id);
  if (line) line.replaceWith(stateLine(p, pick));
  const act = $("msAct-" + p.id);
  if (act) act.replaceWith(rowAction(p, pick));
  renderShareFoot();
}
function refreshRow(p) {
  const old = $("msRow-" + p.id);
  if (old) old.replaceWith(shareYoursRow(p, false));
  renderShareFoot();
}
async function toggleShare(p, on) {
  const pick = pickFor(p);
  const open = $("msRow-" + p.id) && $("msRow-" + p.id).querySelector(".ms-fields");
  if (!on && open && typeof revealSmoothly === "function") {
    // the fields fold away first; the row changes once they are gone
    revealSmoothly(open, false);
    if (open._fxFold) await open._fxFold.finished.catch(() => {});
  }
  pick.on = on;
  pick.touched = true;
  pick.error = "";
  if (on && !sharedFor(p)) {
    pick.checking = true;
    refreshRow(p);
    try {
      const tracks = await loadTracks(p.id);
      pick.ms = tracks.reduce((n, t) => n + (t.ms || 0), 0);
      pick.songs = { count: tracks.length, ms: pick.ms, avgMs: pick.ms / Math.max(1, tracks.length), artists: topArtists(tracks) };
      if (pick.ms < SHARE_MIN_MS) { pick.short = true; pick.on = false; }
      rememberBlock(p, pick.short ? "short" : null);
    } catch (err) { pick.error = `Its songs could not be read: ${String(err.message || err).replace(/\.$/, "")}.`; pick.on = false; }
    pick.checking = false;
  }
  refreshRow(p);
  const fields = on && $("msRow-" + p.id) && $("msRow-" + p.id).querySelector(".ms-fields");
  if (fields && typeof revealSmoothly === "function") { fields.hidden = true; revealSmoothly(fields, true); }
}
function renderShareFoot() {
  const foot = $("msFoot");
  if (sharing.tab !== "share" || sharing.detail || !me || !sharing.mine) { foot.hidden = true; return; }
  foot.hidden = false;
  foot.textContent = "";
  const set = shownAsSetting();
  const select = feEl("select", { class: "ms-shown-select", "aria-label": "Shown as" },
    feEl("option", { value: "spotify", selected: set.mode === "spotify" }, (me.display_name || me.id) + " (your Spotify name)"),
    feEl("option", { value: "custom", selected: set.mode === "custom" }, "A name you choose"),
    feEl("option", { value: "anon", selected: set.mode === "anon" }, "Anonymous"));
  const name = feEl("input", { type: "text", class: "ms-shown-name", maxlength: "40", placeholder: "Your name", value: set.name || "", "aria-label": "Name to show", hidden: set.mode !== "custom" });
  const keep = () => { try { localStorage.setItem(SHARING_SHOWN_KEY, JSON.stringify(sharing.shownAs)); } catch (err) { /* private browsing */ } };
  select.addEventListener("change", () => { sharing.shownAs = { mode: select.value, name: name.value }; keep(); name.hidden = select.value !== "custom"; if (!name.hidden) name.focus(); updateApplyButton(); });
  name.addEventListener("input", () => { sharing.shownAs = { mode: "custom", name: name.value }; keep(); updateApplyButton(); });
  foot.appendChild(feEl("div", { class: "ms-shown" }, feEl("span", {}, "Shown as"), select, name));
  foot.appendChild(feEl("button", { type: "button", id: "msApply", class: "ms-apply", onClick: () => applyShares() }));
  updateApplyButton();
}
function updateApplyButton() {
  const b = $("msApply");
  if (!b) return;
  const c = pendingChanges();
  const parts = [];
  if (c.share.length) parts.push(`Share ${c.share.length}`);
  if (c.update.length) parts.push(`update ${c.update.length}`);
  if (c.stop.length) parts.push(`stop sharing ${c.stop.length}`);
  let label = parts.join(", ");
  label = label ? label[0].toUpperCase() + label.slice(1) : "No changes";
  if (sharing.applying) label = "Saving...";
  const customEmpty = shownAsSetting().mode === "custom" && !(shownAsSetting().name || "").trim();
  b.textContent = "";
  if (c.total && !sharing.applying) b.appendChild(feIcon("upload"));
  b.appendChild(document.createTextNode(customEmpty && c.total ? "Type the name to show" : label));
  b.disabled = !c.total || sharing.applying || customEmpty;
  b.classList.toggle("ms-has", !!c.total);
}
// a kept song's [title, artist, length in ms]; its label is "artist - title" (songsFromEntries in app.js)
function songName(t) {
  const label = String(t.label || ""), cut = label.indexOf(" - ");
  return cut < 0 ? [label, "", t.ms || 0] : [label.slice(cut + 3), label.slice(0, cut), t.ms || 0];
}
function topArtists(tracks, n = 4) {
  const counts = new Map();
  for (const t of tracks) { const a = String(t.label || "").split(" - ")[0].trim(); if (a) counts.set(a, (counts.get(a) || 0) + 1); }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).filter(([, c]) => c > 1).map(([a]) => a);
}
async function applyShares() {
  const c = pendingChanges();
  if (!c.total || sharing.applying) return;
  sharing.applying = true;
  updateApplyButton();
  const by = shownAsName();
  for (const p of c.stop) {
    const pick = pickFor(p), shared = sharedFor(p);
    try { await sharingFetch("DELETE", "/share/" + shared.id); pick.touched = false; }
    catch (err) { pick.error = err.message; }
  }
  for (const p of [...c.share, ...c.update]) {
    const pick = pickFor(p);
    try {
      const tracks = await loadTracks(p.id);
      const ms = tracks.reduce((n, t) => n + (t.ms || 0), 0);
      const songs = tracks.map((t) => [String(t.uri).replace("spotify:track:", ""), t.key ? t.key.slice(5) : ""]);
      const names = tracks.map(songName);   // for the playlist's page in Find playlists; the worker sends them one playlist at a time
      const cover = p.cover || null;   // a custom cover or Spotify's square of four album covers
      await sharingFetch("POST", "/share", { playlist: p.id, snapshot: p.snapshot || null, name: p.name, by, phases: [...pick.phases].sort(), tags: pick.tags.slice(), notes: cleanSpotifyDescription(p.description), cover, songs, names, ms, artists: topArtists(tracks) });
      pick.touched = false;
      pick.update = false;
      pick.open = false;   // shared: the row folds
    } catch (err) {
      if (err.code === "copy" && c.share.includes(p)) {
        // refused as a copy: the row looks like a short one from now on, on later visits too, until the playlist changes
        const of = (/copy of (.+), which someone else shares/.exec(err.message) || [])[1] || "";
        pick.copyOf = of;
        pick.on = false;
        pick.touched = false;
        rememberBlock(p, "copy", of);
      } else pick.error = err.code === "copy" ? err.message + " Copies cannot be shared again." : err.message;
    }
  }
  sharing.applying = false;
  await loadMine();
  for (const p of [...c.share, ...c.update, ...c.stop]) { const pick = pickFor(p); if (pick.error) pick.on = !!sharedFor(p) || c.share.includes(p); }
  loadLibrary(true);
}

// ---------------------------------------------------------------- Developer options: tags and reports
function sharingDevOpened() {
  renderDevTags();
  loadLibrary(true).then(renderDevTags);
  loadDevReports();
}
let devTagFilter = "shown";
function renderDevTags() {
  const box = $("devTagWords");
  if (!box) return;
  box.textContent = "";
  const all = sharing.tagIndex || [];
  const counts = { shown: all.filter((t) => !t.hidden).length, hidden: all.filter((t) => t.hidden).length, all: all.length };
  const filters = feEl("div", { class: "ms-tags" }, ...[["shown", "Shown"], ["hidden", "Hidden"], ["all", "All"]].map(([k, label]) =>
    feEl("button", { type: "button", class: "ms-tag" + (devTagFilter === k ? " ms-on" : ""), onClick: () => { devTagFilter = k; renderDevTags(); } }, `${label} ${counts[k]}`)));
  box.appendChild(filters);
  if (!sharing.library) { box.appendChild(feEl("p", { class: "muted" }, sharing.error || "Loading...")); return; }
  const words = all.filter((t) => devTagFilter === "all" || (devTagFilter === "hidden") === t.hidden);
  if (!words.length) { box.appendChild(feEl("p", { class: "muted" }, all.length ? "None." : "No word is in more than one shared playlist yet.")); return; }
  const cloud = feEl("div", { class: "msd-cloud" });
  for (const t of words) {
    cloud.appendChild(feEl("button", { type: "button", class: "msd-word" + (t.hidden ? " msd-hidden" : ""), title: t.hidden ? "Show as a tag" : "Hide",
      onClick: () => toggleWord(t) }, t.word, feEl("span", { class: "msd-n" }, ` (${t.count})`)));
    cloud.appendChild(document.createTextNode(" "));
  }
  box.appendChild(cloud);
}
async function toggleWord(t) {
  const hide = !t.hidden;
  const common = TAG_COMMON.has(t.word) || t.word.split(" ").some((p) => TAG_COMMON.has(p));
  try {
    await sharingFetch("POST", "/admin/word", { word: t.word, hidden: hide === common ? null : hide });   // back to the app's own choice when it matches
    const words = sharing.library.words || (sharing.library.words = {});
    if (hide === common) delete words[t.word]; else words[t.word] = hide ? 1 : 0;
    computeTagIndex();
    renderDevTags();
  } catch (err) { showNotices([{ text: `Not changed: ${err.message}`, transient: true }]); }
}
async function loadDevReports() {
  const box = $("devReportList");
  if (!box) return;
  box.textContent = "Loading...";
  try {
    const data = await sharingFetch("GET", "/admin/reports");
    box.textContent = "";
    if (!data.shares.length) { box.appendChild(feEl("p", { class: "muted" }, "No reports.")); return; }
    for (const s of data.shares) {
      const state = s.hidden === 1 ? "Hidden after reports" : s.hidden === 2 ? "Hidden by you" : "Shown";
      box.appendChild(feEl("div", { class: "msd-report" },
        feEl("div", { class: "msd-rhead" }, feEl("b", { text: s.name }), feEl("span", { class: "muted" }, ` · ${s.by || "Anonymous"} · ${state}`)),
        ...s.reports.map((r) => feEl("div", { class: "muted" }, `${shortDate(r.at)}: ${r.reason}${r.note ? `. ${r.note}` : ""}`)),
        feEl("div", { class: "row" }, feEl("button", { type: "button", onClick: async () => {
          try { await sharingFetch("POST", "/admin/share/" + s.id, { hidden: !s.hidden }); loadDevReports(); loadLibrary(true); }
          catch (err) { showNotices([{ text: `Not changed: ${err.message}`, transient: true }]); }
        } }, s.hidden ? "Show again" : "Hide"))));
    }
  } catch (err) { box.textContent = err.status === 403 ? "Only the owner of the app can see reports." : err.message; }
}

// ---------------------------------------------------------------- wiring
(function wireSharing() {
  startSharingCard();
  if ($("msClose")) $("msClose").addEventListener("click", () => closeSharing());
  window.addEventListener("resize", aimIntro);
  if ($("msOverlay")) $("msOverlay").addEventListener("click", (e) => { if (e.target === $("msOverlay")) closeSharing(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !$("msOverlay") || $("msOverlay").hidden || document.querySelector(".fe-overlay")) return;
    if ($("msSheet")) closeFilters(); else if (sharing.detail) closeDetail(); else closeSharing();
  });
})();
