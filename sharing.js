// sharing.js: Music sharing. People share their own playlists and copy each other's into their own Spotify. Opened from the app menu and the card under Build.
// Two tabs (redesigned by Ron, 2026-11-08, after user testing): Shared by others (a list by type, each playlist's page, Get) and Shared by you
// (the person's shares, and Share a playlist: a wizard of three steps, Playlist, Type, Details). Each share has a type: Ceremony (with the books
// it is for), Phase (the phases of a session), Mood (words), or Other (a name), and a description.
// The library lives in a Cloudflare Worker with a D1 database (cloudflare/music-sharing). It keeps only what people write, the songs as Spotify IDs
// and ISRCs, and a short summary made on the sharer's device; who someone is comes from their Spotify sign-in, checked by the worker.
// The page does the rest itself: search, sorting, filters, mood words (the ones used on more than one shared playlist) and overlap with the person's recipes.
// Classic script, loaded after app.js; it uses app.js and editor.js names at run time.
(globalThis.scriptVersions = globalThis.scriptVersions || {})["sharing.js"] = "2026-11-08zza";   // this file's version, checked against the app's at startup (checkScriptVersions in app.js)

const SHARING_URL = "https://music-sharing.roncarmel.workers.dev";
const SHARE_DESC_MAX = 300, SHARE_OTHER_MAX = 24, SHARE_MOOD_CHARS = 30, SHARE_MOODS_MAX = 8;   // the worker checks the same
// The phases of a session, drawn as one curve: low and flat, rising, high and flat, falling, low and flat (decided by Ron, 2026-11-06).
const PHASES = ["Beginning", "Ascent", "Plateau", "Descent", "Ending"];
const BOOKS = 5;   // the facilitators' books, Book 1 to Book 5 (they know what they are)
// a sixth tile, Other, for a book that is not one of the five: a ? in the book until its code is typed, up to 2 letters or numbers
// (decided by Ron, 2026-11-08, mockups/book-other.html B). It is position 5 in a share's books, and the code is its bookOther.
const OTHER_BOOK = BOOKS, BOOK_CODE_MAX = 2;
const cleanBookCode = (t) => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, BOOK_CODE_MAX);
// a book as it is named: its number, or the other book's code
const bookName = (i, code) => (i === OTHER_BOOK ? cleanBookCode(code) || "?" : String(i + 1));
// The types of a share, in this order everywhere, each with its icon (kindIcon) and a line for the big tiles
const KINDS = [
  ["ceremony", "Ceremony", "A whole session, start to finish.", "Ceremonies"],
  ["phase", "Phase", "One or more phases of a session.", "Phases"],
  ["mood", "Mood", "A feeling that could fit anywhere.", "Moods"],
  ["other", "Other", "Anything else. You name it.", "Others"],
];
const SHARING_COPIES_KEY = "sharingCopies";   // { shared playlist id: the person's copy's Spotify id }
const SHARING_BLOCKED_KEY = "sharingBlocked";   // { playlist id: { snap, why: "copy", of } }: refused as a copy of someone else's share; kept until the playlist changes in Spotify
const SHARING_MINE_KEY = "sharingMineIds";    // the ids of the person's own shares, so others' list knows them at once (refreshed by loadMine)
const OVERLAP_MIN_SONGS = 100, OVERLAP_MIN_PLAYLISTS = 2, OVERLAP_MIN_SHARES = 3;   // when "already in your recipes" is worth showing
const OVERLAP_READ_GAP_MS = 2000;   // reading recipe playlists the browser does not have yet: one request every 2 seconds
const SHARE_GET_RATIO = 4;   // after a Get, the invitation to share shows while the person shares fewer than 1 playlist for every 4 they get

// Mood words this app's people would use everywhere start hidden in the filter (the owner can show one).
const TAG_COMMON = new Set("music musical playlist playlists session sessions ceremony ceremonies people person song songs track tracks time times like feel feels feeling something things thing way well good great part parts start end mood moods".split(" "));

const sharing = {
  tab: "find", detail: null, flow: null, library: null, libraryAt: 0, loading: false, error: "",
  type: "all", search: "", sort: "newest", hideAdded: true, book: null, phases: new Set(), moods: new Set(),
  mine: null, mineError: "", adding: new Set(), addErrors: {},
  overlap: null, overlapShown: null, reading: false, readStop: false, showOverlapSongs: false,
  songNames: new Map(), player: null, previewNote: "",
  songMenu: null, songMenuClose: null, liked: new Set(), addedTo: new Map(),   // a song's menu, and what it did this visit
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
  if (!response.ok) { const e = new Error(data.error || `Music sharing answered ${response.status}.`); e.code = data.code || ""; e.status = response.status; e.percent = data.percent; e.of = data.of; throw e; }
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
      computeMoodIndex();
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

// ---------------------------------------------------------------- Music sharing's card on Arc's home (#msCard)
// Under its name, a strip of what is waiting: the newest covers (up to four, overlapping) and how many playlists others share. It opens Shared by others.
// Before the library arrives (and if it never does) the strip is empty and hidden.
function renderSharingCard() {
  const card = $("msCard");
  if (!card) return;
  const lib = sharing.library;
  const shares = lib ? lib.shares : [];
  const others = shares.filter((s) => !isMine(s));
  // covers: others' not gotten yet, then the person's own, then gotten ones (the library comes newest first)
  const order = [...others.filter((s) => !isAdded(s)), ...shares.filter(isMine), ...others.filter(isAdded)];
  const covers = order.filter((s) => s.cover).slice(0, 4);
  const fan = $("msCardFan");
  fan.textContent = "";
  covers.forEach((s) => fan.appendChild(feEl("img", { src: s.cover, alt: "", loading: "lazy" })));
  card.setAttribute("aria-disabled", String(!devMode()));
  if (!lib) { $("msCardText").textContent = ""; return; }
  $("msCardText").textContent = others.length
    ? `${others.length} ${others.length === 1 ? "playlist" : "playlists"} shared by others`
    : "Nothing shared by others yet. Share the first one.";
}
// Once connected on a device that has never read which shares are the person's own (a new browser, a Home Screen app added again), they are read once, so the
// card's count of playlists shared by other facilitators leaves them out. After that the list is refreshed whenever Music sharing opens (loadMine).
function sharingConnected() {
  if (devMode() && !ownerKnown()) askOwner();   // the owner's tools in the DEV menu, and the request log offered (offerLimitRecord in app.js)
  let known = !!sharing.mine;
  try { known = known || localStorage.getItem(SHARING_MINE_KEY) !== null; } catch (err) { known = true; }   // no storage: it would be read on every visit
  if (!known) loadMine().then(renderSharingCard);
  markOldCopies();
}
function startSharingCard() {
  const card = $("msCard");
  if (!card) return;
  card.addEventListener("click", () => showView("sharing"));
  renderSharingCard();
  if (pageName() === "app" && devMode()) loadLibrary();
}

async function loadMine() {
  if (!token || !me) return;
  sharing.mineError = "";
  try {
    sharing.mine = (await sharingFetch("GET", "/mine")).shares;
    try { localStorage.setItem(SHARING_MINE_KEY, JSON.stringify(sharing.mine.map((s) => s.id))); } catch (err) { /* private browsing */ }
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
// A copy's Spotify description is the share's, ending in [origin: <share ID>] (the text cut short to make room), so every device knows it is
// gotten from the playlist list it reads anyway, and a copy deleted in Spotify can be gotten again.
// sharingCopies is this device's own record, kept for copies whose origin was edited away.
const ORIGIN_RE = /\s*\[origin:\s*([a-z0-9]{1,40})\]\s*$/;
function originShareId(text) {
  const m = typeof text === "string" && text.match(ORIGIN_RE);
  return m ? m[1] : null;
}
function copyShareId(p) { return p ? originShareId(p.description) : null; }
function withShareId(text, id) {
  const origin = `[origin: ${id}]`;
  const room = 300 - origin.length - 1;
  let t = String(text || "").trim();
  if (t.length > room) { t = t.slice(0, room); t = t.slice(0, Math.max(t.lastIndexOf(" "), 0)) || t; }   // the end goes, cut at a space
  t = t.trim();
  return t ? `${t} ${origin}` : origin;
}
// share id -> the person's copy still in their Spotify, from the marks and this device's record
function copiesInSpotify() {
  const found = new Map();
  if (!me) return found;
  for (const p of playlists) { const id = p.owner === me.id && copyShareId(p); if (id && !found.has(id)) found.set(id, p.id); }
  for (const [shareId, copy] of Object.entries(sharingCopies())) if (!found.has(shareId) && playlists.some((p) => p.id === copy)) found.set(shareId, copy);
  return found;
}
function isAdded(share) {
  if (!playlists.length) return share.id in sharingCopies();   // no list yet: this device's record
  return copiesInSpotify().has(share.id);   // a copy removed in Spotify can be gotten again
}
// ---------------------------------------------------------------- words and numbers
const songCountText = (n) => plural(n, "song");
// the artists with the most songs, as "Includes A, B, C, and more."
const includesText = (artists) => `Includes ${artists.slice(0, 3).join(", ")}, and more.`;
const phaseNames = (list) => list.map((i) => PHASES[i]).join(", ");
function cleanSpotifyDescription(text) {
  // Spotify gives descriptions with HTML entities and links; the app's own markers and recipe saves are not offered as text
  if (!text || madeByAppText(text)) return "";
  const box = document.createElement("textarea");
  box.innerHTML = String(text).replace(/<[^>]*>/g, "");
  return box.value.replace(ORIGIN_RE, "").trim().slice(0, SHARE_DESC_MAX);   // a copy's [origin: ...] is not part of its description
}
// a mood word or an Other name as it is kept: single spaces, letters, numbers and a few marks (the worker does the same); moods are lower case
function cleanWord(t, max) {
  return String(t || "").replace(/^#+/, "").replace(/[^\p{L}\p{N}' &-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
}
const cleanMood = (t) => cleanWord(t, SHARE_MOOD_CHARS).toLowerCase();

// ---------------------------------------------------------------- words that cannot be used (blocked-words/, decided by Ron, 2026-11-08)
// Whole words only, in mood words and Other names; the worker checks the same list. Descriptions are left to Report.
let blockedList = null;
function loadBlockedWords() {
  if (blockedList) return blockedList;
  const v = (globalThis.scriptVersions || {})["sharing.js"] || "";
  blockedList = fetch("blocked-words/blocked-words.json?v=" + encodeURIComponent(v)).then((r) => r.json()).then((d) => ({
    words: new Set(d.words || []),
    re: d.patterns && d.patterns.length ? new RegExp(`(^| )(${d.patterns.join("|")})( |$)`) : null,
  })).catch(() => { blockedList = null; return null; });   // not reached: the worker still checks
  return blockedList;
}
let blockedNow = null;   // the list once loaded, for checks while typing
function blockedWord(text) {
  if (!blockedNow) return false;
  const n = String(text).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  if (!n) return false;
  const w = n.split(" ");
  for (let i = 0; i < w.length; i++) for (let j = i + 1; j <= Math.min(w.length, i + 4); j++) if (blockedNow.words.has(w.slice(i, j).join(" "))) return true;
  return !!(blockedNow.re && blockedNow.re.test(n));
}

// ---------------------------------------------------------------- types
const kindName = (kind) => (KINDS.find((k) => k[0] === kind) || [])[1] || "";
// each type's icon, drawn in the current color: Ceremony the whole curve, Phase the curve with only Ascent lit, Mood a wave, Other three dots
function kindIcon(kind) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 58 30");
  svg.setAttribute("class", "ms-kicon");
  svg.setAttribute("aria-hidden", "true");
  const path = (d, cls) => { const p = document.createElementNS(NS, "path"); p.setAttribute("d", d); if (cls) p.setAttribute("class", cls); svg.appendChild(p); };
  const curve = ["M4 23 H15", "M15 23 C20 23 20 7 25 7", "M25 7 H33", "M33 7 C38 7 38 23 43 23", "M43 23 H54"];
  if (kind === "ceremony") curve.forEach((d) => path(d));
  else if (kind === "phase") curve.forEach((d, i) => path(d, i === 1 ? "" : "ms-kicon-dim"));
  else if (kind === "mood") path("M4 18 C14 6, 22 26, 30 15 S 46 8, 54 14");
  else for (const x of [17, 29, 41]) { const c = document.createElementNS(NS, "circle"); c.setAttribute("cx", x); c.setAttribute("cy", 15); c.setAttribute("r", 3); c.setAttribute("class", "ms-kicon-dot"); svg.appendChild(c); }
  return svg;
}
// the pink line above a share's name: CEREMONY · BOOK 2, PHASE · ASCENT, PLATEAU, MOOD · GRIEF, TENDER, or an Other share's own name
// (written in ordinary case; CSS makes it small capitals). Parts not chosen yet are left out, and nothing chosen is blank.
function kindLabel(s) {
  if (!s || !s.kind) return "";
  if (s.kind === "other") return s.other || "";
  const list = s.kind === "ceremony" ? (s.books || []).slice().sort((a, b) => a - b).map((i) => bookName(i, s.bookOther))
    : s.kind === "phase" ? (s.phases || []).slice().sort().map((i) => PHASES[i]) : (s.moods || []).slice();
  let part = "";
  if (s.kind === "ceremony" && list.length) part = (list.length === 1 ? "Book " : "Books ") + list.join(", ");
  else if (s.kind === "phase" && list.length) part = list.length > 2 ? list.length + " phases" : list.join(", ");
  else if (s.kind === "mood" && list.length) part = list.slice(0, 3).join(", ") + (list.length > 3 ? ", ..." : "");
  return kindName(s.kind) + (part ? " · " + part : "");
}
// type tiles: the four types in a row, each name under its tile (the edit page), the same as a filter (Shared by others: none lit shows every type, a tap lights one, a tap on the lit one shows every type again), or the four as big tiles with a line each (the wizard)
function kindTiles(on, choose, { filter = false, big = false } = {}) {
  const box = feEl("div", { class: "ms-ktiles" + (big ? " ms-ktiles-big" : ""), role: filter ? "group" : "radiogroup", "aria-label": filter ? "Type" : "What type of playlist is this?" });
  const tile = (value, name, line, icon) => feEl("button", { type: "button", role: filter ? null : "radio", class: "ms-ktile" + (on === value ? " ms-on" : ""),
    [filter ? "aria-pressed" : "aria-checked"]: String(on === value),
    "data-kind": value, onClick: () => choose(filter && on === value ? "all" : value) },
    big ? icon : feEl("span", { class: "ms-ktile-box" }, icon), feEl("span", { class: "ms-ktile-name" }, name), big ? feEl("span", { class: "ms-ktile-line" }, line) : null);
  for (const [value, name, line, plural] of KINDS) box.appendChild(tile(value, filter ? plural : name, line, kindIcon(value)));
  return box;
}
// a closed book with its number on it, under the word Book (A2, decided by Ron, 2026-11-08); the other book's two letters are smaller
function bookIcon(n) {
  const holder = feEl("span", { class: "ms-bookicon", "aria-hidden": "true" });
  const t = String(n);
  holder.innerHTML = `<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M10 5h20a2 2 0 0 1 2 2v26a2 2 0 0 1-2 2H10z"/><path d="M10 5a3 3 0 0 0-3 3v24a3 3 0 0 0 3 3"/><text x="21" y="${t.length > 1 ? 24.5 : 25}" text-anchor="middle" font-size="${t.length > 1 ? 12 : 15}" font-weight="800" fill="currentColor" stroke="none"></text></svg>`;
  holder.querySelector("text").textContent = t;
  return holder;
}
// the five books and Other as tiles: single (the filter) chooses one at a time, choosing it again clears it; without choose they only show which are lit.
// code is the other book's code, shown in its book (a ? until there is one)
function bookTiles(on, choose = null, single = false, code = "") {
  const box = feEl("div", { class: "ms-btiles" + (choose ? "" : " ms-btiles-ro"), role: choose ? "group" : null, "aria-label": choose ? "Books" : null });
  for (let i = 0; i <= OTHER_BOOK; i++) {
    const lit = on.has(i), other = i === OTHER_BOOK;
    const inner = [feEl("span", { class: "ms-btile-word" }, other ? "Other" : "Book"), bookIcon(bookName(i, code))];
    const label = other ? "Other book" + (cleanBookCode(code) ? " " + cleanBookCode(code) : "") : "Book " + (i + 1);
    box.appendChild(choose
      ? feEl("button", { type: "button", class: "ms-btile" + (lit ? " ms-on" : "") + (other ? " ms-btile-other" : ""), "aria-pressed": String(lit), "aria-label": label,
        onClick: () => { if (on.has(i)) on.delete(i); else { if (single) on.clear(); on.add(i); } choose(i); } }, ...inner)
      : feEl("span", { class: "ms-btile" + (lit ? " ms-on" : "") + (other ? " ms-btile-other" : ""), "aria-label": `${label}${lit ? "" : ", not this one"}` }, ...inner));
  }
  return box;
}

// ---------------------------------------------------------------- mood words: the ones used on more than one shared playlist
function computeMoodIndex() {
  const lib = sharing.library;
  if (!lib) return;
  const counts = new Map();   // word: set of shared playlist ids
  for (const s of lib.shares) for (const w of new Set((s.moods || []).map(cleanMood).filter(Boolean))) { if (!counts.has(w)) counts.set(w, new Set()); counts.get(w).add(s.id); }
  const overrides = lib.words || {};
  sharing.moodIndex = [...counts.entries()].filter(([, ids]) => ids.size > 1)
    .map(([word, ids]) => ({ word, ids, count: ids.size, hidden: word in overrides ? overrides[word] === 1 : TAG_COMMON.has(word) }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}
// moods others use, most used first, for suggestions while typing (hidden ones are left out)
function knownMoods() {
  const lib = sharing.library, counts = new Map();
  if (!lib) return [];
  const overrides = lib.words || {};
  for (const s of lib.shares) if (!isMine(s)) for (const t of new Set((s.moods || []).map(cleanMood))) if (t && overrides[t] !== 1) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}
function visibleMoods() { return (sharing.moodIndex || []).filter((t) => !t.hidden); }

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
    sharing.addErrors[s.id] = String(err && err.message || err).replace(/\.?$/, ".");   // what went wrong, shown in the usual error box (getError)
  }
  sharing.adding.delete(s.id);
  if (made) {
    rememberCopy(s.id, made.id);
    try { await loadMyPlaylists(); }
    catch (err) { playlists.push({ id: made.id, name: s.name, owner: me.id, collaborative: false, image: null, cover: null, count: s.songs.length, description: copyDescription(s), snapshot: null, madeByApp: false, save: null, isSave: false }); keepPlaylists(); }
  }
  renderSharing();
  if (made) offerToShare(s);
}

// the copy's description in Spotify: the sharer's description, else what it is, ending in [origin: <share ID>]
function copyDescription(s) { return withShareId(s.description || kindLabel(s), s.id); }
// copies made before the origin was added: this device's record says which share each is, so their descriptions get it once, one at a time
async function markOldCopies() {
  if (sharing.marking || !me) return;
  sharing.marking = true;
  try {
    for (const [shareId, copy] of Object.entries(sharingCopies())) {
      if (connection !== "ready" || spotifyPause() || busy) break;
      const p = playlists.find((x) => x.id === copy && x.owner === me.id);
      if (!p || typeof p.description !== "string" || copyShareId(p) === shareId) continue;   // gone, not read with its description, or has it already
      const description = withShareId(cleanSpotifyDescription(p.description), shareId);
      await spotifyRequest("PUT", `/playlists/${p.id}`, { json: { description }, noWait: true });
      p.description = description;
    }
  } catch (err) { logStep("music sharing: marking an older copy stopped (" + (err && err.message) + ")"); }   // tried again next time
  sharing.marking = false;
}

// ---------------------------------------------------------------- the popup
// tab "find" is Shared by others, "share" Shared by you. sharing.detail is a playlist's page; sharing.flow is Share a playlist (the wizard),
// the edit page of one of the person's shares, or the page that says a share went through.
function openSharing(tab = "find") {
  if (typeof closeInfo === "function") closeInfo(true);
  sharing.tab = tab;
  sharing.detail = null;
  sharing.flow = null;
  sharing.overlapShown = sharing.overlap;
  $("msOverlay").hidden = false;
  document.body.style.overflow = "hidden";
  renderSharing();
  $("msDialog").focus({ preventScroll: true });
  loadLibrary();
  loadMine();   // also for Shared by others, so the person's own shares are known
  loadBlockedWords().then((l) => { blockedNow = l; });
}
function closeSharing() {
  sharing.readStop = true;
  stopPreview();
  closeSortMenu();
  closeSheet(true);
  sharing.search = "";
  sharing.flow = null;
  sharing.detail = null;
  endTyping();
  $("msOverlay").hidden = true;
  renderSharingCard();   // a Get or a share may change its count and covers
  if (!document.querySelector(".app-overlay:not([hidden])")) document.body.style.overflow = "";
}
function switchTab(tab) {
  if (tab === sharing.tab && !sharing.detail && !sharing.flow) return;
  sharing.tab = tab;
  sharing.detail = null;
  sharing.flow = null;
  if (tab === "find") sharing.overlapShown = sharing.overlap;
  renderSharing();
  $("msBody").scrollTop = 0;
  if (tab === "share") loadMine();
}

function renderSharing() {
  const body = $("msBody");
  if (!body || $("msOverlay").hidden) return;
  if (sharing.player && sharing.player.share !== sharing.detail) stopPreview();   // a preview plays only on its playlist's page
  if (sharing.songMenu && (sharing.songMenu.share !== sharing.detail || sharing.flow)) dropSongMenu();   // and a song's menu only stays on it
  const keepScroll = body.scrollTop;
  body.textContent = "";
  const foot = $("msFoot");
  foot.textContent = "";
  foot.hidden = true;
  renderSharingTabs();
  if (sharing.flow) renderFlow(body, foot);
  else if (sharing.detail) renderDetail(body, foot);
  else if (sharing.tab === "find") renderFind(body);
  else renderShareYours(body, foot);
  body.scrollTop = keepScroll;
}
// the top row: the two tabs as words with a pink line under the chosen one, and Close. In Share a playlist and the edit page,
// a title in their place, and for the wizard its three steps under it.
function renderSharingTabs() {
  const bar = $("msTabs");
  bar.textContent = "";
  const flow = sharing.flow;
  $("msTabsBar").classList.toggle("ms-flowbar", !!flow);
  if (flow) {
    bar.removeAttribute("role");
    bar.appendChild(feEl("div", { class: "ms-flowtitle" }, flow.mode === "edit" ? "Edit details" : "Share a playlist"));
    if (flow.mode === "new") {
      bar.appendChild(feEl("ol", { class: "ms-steps", "aria-label": "Steps" }, ...["Playlist", "Type", "Details"].map((name, i) =>
        feEl("li", { class: i < flow.step ? "ms-done" : i === flow.step ? "ms-now" : "", "aria-current": i === flow.step ? "step" : null }, name))));
    }
    return;
  }
  bar.setAttribute("role", "tablist");
  const tab = (value, name) => feEl("div", { class: "ms-tab" + (sharing.tab === value ? " ms-on" : "") },
    feEl("button", { type: "button", role: "tab", "aria-selected": String(sharing.tab === value), class: "ms-tab-name", onClick: () => switchTab(value) }, name));
  bar.append(tab("find", "Shared by others"), tab("share", "Shared by you"));
}
// the bottom row: Back (grey) and the main button; Back alone fills the row. In the wizard and the edit page (wizard: true) Back is pink
// and as wide as the main button, with a gap between, and alone it keeps that size and place.
function footButtons(foot, back, main) {
  foot.hidden = false;
  const row = feEl("div", { class: "ms-footrow" + (back && back.wizard ? " ms-wizrow" : "") });
  if (back) row.appendChild(feEl("button", { type: "button", class: "ms-backbtn", id: "msBack", onClick: back.onClick }, feIcon("back"), back.label || "Back"));
  if (main) row.appendChild(main);
  foot.appendChild(row);
}
const mainButton = (label, onClick, { id = "msMain", grey = false, icon = null, iconAfter = null, disabled = false } = {}) =>
  feEl("button", { type: "button", id, class: "ms-mainbtn" + (grey ? " ms-grey" : ""), disabled, onClick }, icon ? feIcon(icon) : null, label, iconAfter ? feIcon(iconAfter) : null);

// ---------------------------------------------------------------- Shared by others
// Type tiles (the four types; none lit means all), then what each type is found by: none lit, a search, Hide playlists you have and Sort;
// Ceremony the books (one at a time) and a search of descriptions; Phase the curve (any of the chosen phases); Mood its words; Other a search.
const SORTS = [["newest", "Newest"], ["az", "A to Z"], ["longest", "Longest"], ["most", "Most in your recipes"], ["least", "Least in your recipes"]];
function sortChoices() {
  const usable = sharing.overlapShown && sharing.overlapShown.usable;
  return SORTS.filter(([v]) => usable || (v !== "most" && v !== "least"));
}
function setType(type) {
  if (type === sharing.type) return;
  sharing.type = type;
  sharing.book = null;
  sharing.phases.clear();
  sharing.moods.clear();
  renderSharing();
}
function renderFind(body) {
  if (!sortChoices().some(([v]) => v === sharing.sort)) sharing.sort = "newest";
  const has = sharing.library && sharing.library.shares.length;
  body.appendChild(kindTiles(sharing.type, setType, { filter: true }));
  const tools = feEl("div", { id: "msTools", class: "ms-tools" });
  if (has) {
    const t = sharing.type;
    if (t === "ceremony") {
      tools.appendChild(feEl("p", { class: "ms-flabel2" }, "For use with (one at a time)"));
      const on = new Set(sharing.book == null ? [] : [sharing.book]);
      // Other shows every ceremony for another book, whatever its code (Ron, 2026-11-08)
      tools.appendChild(bookTiles(on, () => { sharing.book = on.size ? [...on][0] : null; renderSharing(); }, true));
    } else if (t === "phase") {
      tools.appendChild(feEl("p", { class: "ms-flabel2" }, "Which phases"));
      tools.appendChild(phaseCurve(sharing.phases, () => renderResults(), "Which phases"));
    } else if (t === "mood") {
      tools.appendChild(feEl("p", { class: "ms-flabel2" }, "Which moods"));
      tools.appendChild(feEl("div", { id: "msMoods", class: "ms-chips" }));
    }
    tools.appendChild(searchField(t === "ceremony" ? "Search descriptions" : "Search"));
    if (t === "all") {
      const hide = feEl("input", { type: "checkbox", id: "msHideAdded", class: "ms-cb", checked: sharing.hideAdded });
      hide.addEventListener("change", () => { sharing.hideAdded = hide.checked; renderResults(); });
      const label = (sortChoices().find(([v]) => v === sharing.sort) || SORTS[0])[1];
      tools.appendChild(feEl("div", { class: "ms-toolrow" },
        feEl("label", { class: "ms-cbrow" }, hide, feEl("span", {}, "Hide playlists you have")),
        feEl("button", { type: "button", id: "msSortButton", class: "ms-tbtn ms-sortbtn", "aria-haspopup": "menu", "aria-expanded": "false", onClick: openSortMenu }, feEl("b", {}, label), feIcon("chevron"))));
    }
  }
  body.appendChild(tools);
  body.appendChild(feEl("div", { id: "msResults" }));
  renderResults();
}
function searchField(placeholder) {
  const input = feEl("input", { type: "search", class: "ms-search-input", id: "msSearch", placeholder, "aria-label": placeholder, value: sharing.search, enterkeyhint: "search" });
  input.addEventListener("input", () => { sharing.search = input.value; renderResults(); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });   // the list follows each letter; Enter only puts the keyboard away
  return feEl("label", { class: "ms-search" }, feIcon("search"), input);
}
// copies this device made that are still in the person's Spotify
function addedCount() {
  return playlists.length ? copiesInSpotify().size : Object.keys(sharingCopies()).length;
}
function mineCount() {
  if (sharing.mine) return sharing.mine.length;
  try { return (JSON.parse(localStorage.getItem(SHARING_MINE_KEY)) || []).length; } catch (err) { return 0; }
}
function renderMoodChips() {
  const box = $("msMoods");
  if (!box) return;
  box.textContent = "";
  const words = visibleMoods().filter((t) => t.ids.size && [...t.ids].some((id) => { const s = sharing.library.shares.find((x) => x.id === id); return s && s.kind === "mood"; }));
  if (!words.length) { box.appendChild(feEl("p", { class: "ms-fsub" }, "Moods show here once two playlists share one.")); return; }
  for (const t of words) {
    const on = sharing.moods.has(t.word);
    box.appendChild(feEl("button", { type: "button", class: "ms-chip" + (on ? " ms-on" : ""), "aria-pressed": String(on),
      onClick: () => { if (on) sharing.moods.delete(t.word); else sharing.moods.add(t.word); renderMoodChips(); renderResults(); } }, t.word));
  }
}

// the sort menu drops from its button; choosing closes it, and so does a click elsewhere or Escape
function openSortMenu() {
  const button = $("msSortButton");
  if (!button || $("msSortMenu")) return;
  const menu = feEl("div", { id: "msSortMenu", class: "ms-menu", role: "menu", "aria-label": "Sort" });
  for (const [value, label] of sortChoices()) {
    menu.appendChild(feEl("button", { type: "button", role: "menuitemradio", "aria-checked": String(value === sharing.sort), class: value === sharing.sort ? "ms-on" : "",
      onClick: () => { closeSortMenu(); setSort(value); } }, label, value === sharing.sort ? feIcon("check") : null));
  }
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
  renderSharing();
  if ($("msSortButton")) $("msSortButton").focus();
}

function matchesSearch(s, q) {
  if (!q) return true;
  const hay = (sharing.type === "ceremony" ? `${s.description || ""}` : `${s.name} ${s.by || ""} ${kindLabel(s)} ${(s.moods || []).join(" ")} ${s.description || ""} ${(s.artists || []).join(" ")}`).toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}
function narrowed() { return sharing.book != null || sharing.phases.size > 0 || sharing.moods.size > 0 || !!sharing.search.trim(); }
function clearNarrowing() { sharing.book = null; sharing.phases.clear(); sharing.moods.clear(); sharing.search = ""; }
// the playlists of the chosen type that the filters and search leave, before Hide playlists you have (so the empty list can say what hides them)
function filteredShares(hide = sharing.hideAdded) {
  return ofType().filter((s) => matchesSearch(s, sharing.search)
    && (sharing.book == null || (s.books || []).includes(sharing.book))
    && (!sharing.phases.size || (s.phases || []).some((i) => sharing.phases.has(i)))
    && (!sharing.moods.size || (s.moods || []).some((m) => sharing.moods.has(cleanMood(m))))
    && !(hide && (isAdded(s) || isMine(s))));
}
function ofType() { return sharing.library.shares.filter((s) => sharing.type === "all" || s.kind === sharing.type); }
function emptyState(icon, title, text, button) {
  return feEl("div", { class: "ms-empty" }, feEl("span", { class: "ms-empty-icon" }, typeof icon === "string" ? feIcon(icon) : icon), feEl("h3", {}, title), feEl("p", {}, text), button);
}
const EMPTY_TYPE = {
  all: ["No one has shared a playlist yet", "Playlists other facilitators share will show here."],
  ceremony: ["No one has shared one of these yet", "Playlists for a whole session will show here."],
  phase: ["No one has shared one of these yet", "Playlists for one or more phases of a session will show here."],
  mood: ["No one has shared one of these yet", "Playlists made for a feeling will show here."],
  other: ["No one has shared one of these yet", "Playlists that are not a ceremony, a phase or a mood will show here."],
};
function renderResults() {
  renderMoodChips();
  const box = $("msResults");
  if (!box) return;
  box.textContent = "";
  if (sharing.loading && !sharing.library) { box.appendChild(feEl("p", { class: "ms-note" }, "Loading shared playlists...")); return; }
  if (sharing.error && !sharing.library) {
    box.appendChild(problemBox("Shared playlists didn\u2019t load", sharing.error, [{ label: "Try again", run: () => loadLibrary(true) }]));
    return;
  }
  if (!sharing.library) return;
  const ov = sharing.overlapShown && sharing.overlapShown.usable && (sharing.sort === "most" || sharing.sort === "least") && sharing.type === "all" ? sharing.overlapShown : null;
  let list = filteredShares();
  if (sharing.type === "all" && sharing.sort === "longest") list = list.slice().sort((a, b) => b.ms - a.ms);
  else if (sharing.type === "all" && sharing.sort === "az") list = list.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  else if (ov) list = list.slice().sort((a, b) => ((ov.per[b.id] || {}).pct || 0) - ((ov.per[a.id] || {}).pct || 0));
  if (ov && sharing.sort === "least") list.reverse();
  if (!ofType().length) {
    const [title, text] = EMPTY_TYPE[sharing.type];
    box.appendChild(emptyState(sharing.type === "all" ? feIcon("notes") : kindIcon(sharing.type), title, text,
      feEl("button", { type: "button", class: "ms-empty-ghost", onClick: () => { switchTab("share"); startShare(); } }, "Share one of yours")));
    return;
  }
  if (!list.length) {
    if (sharing.hideAdded && filteredShares(false).length) {
      // only Hide playlists you have is hiding them
      const n = filteredShares(false).length;
      box.appendChild(emptyState("check", n === 1 ? "You have it already" : `You have all ${n} already`, "Playlists you got or shared are hidden.",
        feEl("button", { type: "button", class: "ms-empty-ghost", onClick: () => { sharing.hideAdded = false; if ($("msHideAdded")) $("msHideAdded").checked = false; renderResults(); } }, "Show them")));
      return;
    }
    box.appendChild(emptyState("search", "Nothing matches", "Try other words or fewer choices.",
      feEl("button", { type: "button", class: "ms-empty-ghost", onClick: () => { clearNarrowing(); renderSharing(); } }, "Clear search and filters")));
    return;
  }
  for (const s of list) box.appendChild(shareRow(s, ov));
}
function shareCoverEl(s, cls = "ms-cover") {
  return s.cover ? feEl("img", { class: cls, src: s.cover, alt: "", loading: "lazy" }) : feEl("span", { class: cls + " ms-nocover" }, feIcon("notes"));
}
function addButton(s, big = false) {
  if (isMine(s)) return big ? null : feEl("span", { class: "ms-add ms-yours" }, "Yours");
  if (sharing.adding.has(s.id)) return feEl("button", { type: "button", id: big ? "msMain" : null, class: big ? "ms-mainbtn ms-grey" : "ms-add ms-busy", disabled: true }, "Getting...");
  if (isAdded(s)) return feEl("button", { type: "button", id: big ? "msMain" : null, class: big ? "ms-mainbtn ms-grey" : "ms-add ms-done", disabled: true }, feIcon("check"), "Gotten");
  return feEl("button", { type: "button", id: big ? "msMain" : null, class: big ? "ms-mainbtn" : "ms-add", disabled: connection !== "ready", onClick: (e) => { e.stopPropagation(); addShared(s); } }, big ? feIcon("plus") : null, big ? "Get this playlist" : "Get");
}
// a row: the cover, the type's line in pink small capitals, the name, who and how long, and Get
function shareRow(s, ov) {
  const per = ov && ov.per[s.id];
  const row = feEl("div", { class: "ms-row", role: "button", tabindex: "0", onClick: () => openDetail(s.id) },
    shareCoverEl(s),
    feEl("div", { class: "ms-text" },
      feEl("div", { class: "ms-klabel" }, kindLabel(s)),
      feEl("div", { class: "ms-name", text: s.name, title: s.name }),
      feEl("div", { class: "ms-sub" }, `${isMine(s) ? "You" : s.by || "Anonymous"} · ${lengthText(s.ms / 60000)}`),
      per ? feEl("div", { class: "ms-ov" }, `${per.pct}% already in your recipes`) : null,
      null),
    addButton(s));
  row.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === row) { e.preventDefault(); row.click(); } });
  return sharing.addErrors[s.id] ? feEl("div", { class: "ms-roww" }, row, getError(s)) : row;
}
// a Get that failed: the usual error box, with Try again
function getError(s) {
  return problemBox("Couldn\u2019t get it", sharing.addErrors[s.id], [{ label: "Try again", run: (e) => { e.stopPropagation(); addShared(s); } }]);
}
// A page slides in from the right, pushing the one before out to the left; going back reverses it. The list keeps where it was scrolled to.
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
// the line over a share's curve: who plays it in which phases, one or two by name, more as a count (never "the": "in the Beginning" reads wrong)
function phaseLine(s) {
  const list = (s.phases || []).slice().sort();
  const who = isMine(s) ? "You play it in " : s.by ? s.by + " plays it in " : "They play it in ";
  const names = list.length > 2 ? [feEl("b", {}, list.length + " phases")] : list.flatMap((i, n) => n ? [" and ", feEl("b", {}, PHASES[i])] : [feEl("b", {}, PHASES[i])]);
  return feEl("div", { class: "ms-phase-line" }, who, ...names);
}
// A playlist's page: its cover, type, name, who and how long; what its type says; the description, with Report right under what the sharer typed
// (none when nothing was typed); the songs with previews. Back at the top; Get this playlist wide under the header (B), or on the person's own,
// a Details card with Edit details (A). No bottom row, so it does not look like a step of the wizard (decided by Ron, 2026-11-08).
function renderDetail(body, foot) {
  const s = sharing.library && sharing.library.shares.find((x) => x.id === sharing.detail);
  if (!s) { sharing.detail = null; renderSharing(); return; }
  const mine = isMine(s) && sharing.mine && sharing.mine.find((m) => m.id === s.id);
  body.appendChild(feEl("button", { type: "button", class: "ms-backlink", id: "msBack", onClick: () => closeDetail() }, feIcon("back"), "Back"));
  body.appendChild(feEl("div", { class: "ms-hero" }, shareCoverEl(s, "ms-cover ms-cover-big"),
    feEl("div", { class: "ms-hero-text" },
      feEl("div", { class: "ms-klabel" }, kindName(s.kind) === "Other" ? s.other : kindName(s.kind)),
      feEl("h3", { text: s.name }),
      feEl("div", { class: "ms-sub" }, isMine(s) ? "Shared by you" : s.by ? `Shared by ${s.by}` : "Shared anonymously"),
      feEl("div", { class: "ms-sub" }, `${songCountText(s.count)} · ${lengthText(s.ms / 60000)}`))));
  if (!isMine(s)) { const get = addButton(s, true); get.classList.add("ms-getwide"); body.appendChild(get); }
  if (sharing.addErrors[s.id]) body.appendChild(getError(s));
  // on the person's own share, what Edit details changes sits in one card with Edit details at its top right
  const into = mine ? feEl("div", { class: "ms-dcard" }, feEl("div", { class: "ms-dhead" }, feEl("b", {}, "Details"),
    feEl("button", { type: "button", class: "ms-editlink", id: "msEdit", onClick: () => { const tab = sharing.tab; editShare(mine); sharing.backTo = { id: s.id, tab }; } }, feIcon("pencil"), "Edit details"))) : body;
  const report = () => feEl("div", { class: "ms-reportrow" }, feEl("button", { type: "button", class: "linklike ms-report", onClick: () => reportShare(s) }, feIcon("flag"), "Report"));
  if (s.kind === "ceremony") into.appendChild(feEl("div", { class: "ms-facts" }, feEl("div", { class: "ms-sec" }, "For use with"), bookTiles(new Set(s.books || []), null, false, s.bookOther)));
  if (s.kind === "phase") { into.appendChild(phaseLine(s)); into.appendChild(phaseCurve(new Set(s.phases || []))); }
  if (s.kind === "mood") into.appendChild(feEl("div", { class: "ms-facts" }, feEl("div", { class: "ms-sec" }, "Moods"), feEl("div", { class: "ms-chips" }, ...(s.moods || []).map((m) => feEl("span", { class: "ms-chip ms-chip-ro" }, m)))));
  if (s.description) into.appendChild(feEl("p", { class: "ms-long" }, s.description));
  if (into !== body) body.appendChild(into);
  if (!isMine(s) && (s.description || s.kind === "mood" || s.kind === "other")) body.appendChild(report());
  // the songs, with a preview of each; a share whose song names are not there shows the artists with the most songs instead
  const names = songNamesFor(s);
  if (names.state === "none" && s.artists && s.artists.length) body.appendChild(feEl("div", { class: "ms-facts ms-facts-box" }, includesText(s.artists)));
  const ov = sharing.overlap && sharing.overlap.playlists ? sharing.overlap.per[s.id] : null;
  if (ov && ov.same && names.state === "none") {   // no song list to mark: a box with Show them
    body.appendChild(feEl("div", { class: "ms-overlap" }, feIcon("overlap"), feEl("span", {}, `${ov.same === 1 ? "1 of these songs" : `${ov.same} of these songs`} (${ov.pct}%) ${ov.same === 1 ? "is" : "are"} already in your recipes. `,
      feEl("button", { type: "button", class: "linklike", onClick: () => { sharing.showOverlapSongs = !sharing.showOverlapSongs; renderSharing(); } }, sharing.showOverlapSongs ? "Hide them" : "Show them"))));
    if (sharing.showOverlapSongs) {
      const labels = sharing.overlap.labels;
      body.appendChild(feEl("ul", { class: "ms-songs" }, ...ov.songs.map(([id, isrc]) => feEl("li", {}, labels.get("isrc:" + isrc) || labels.get("spotify:track:" + id) || "A song"))));
    }
  }
  if (names.state !== "none") renderSongs(body, s, names, ov && ov.same ? ov : null);
}

// ---------------------------------------------------------------- after every Get: a sheet says what the copy is (D1); while the person shares
// fewer than 1 playlist for every 4 they get, it also invites a share (D2). Decided by Ron, 2026-11-08.
function offerToShare(s) {
  if ($("msSheet")) return;
  const invite = mineCount() * SHARE_GET_RATIO < addedCount();
  const sheet = feEl("div", { id: "msSheet", class: "ms-sheet-wrap" });
  const who = s.by || "the sharer";
  const panel = feEl("div", { class: "ms-sheet", role: "dialog", "aria-modal": "true", "aria-label": `${s.name} is in your Spotify`, tabindex: "-1" },
    feEl("div", { class: "ms-grab" }),
    feEl("div", { class: "ms-gothead" }, shareCoverEl(s, "ms-cover"),
      feEl("div", {}, feEl("div", { class: "ms-gottitle", text: `${named(s.name)} is in your Spotify` }), feEl("div", { class: "ms-sub" }, "Your own private copy"))),
    feEl("ul", { class: "ms-gotwhy" },
      feEl("li", {}, feEl("b", {}, "Yours to change."), " Add, remove or reorder songs."),
      feEl("li", {}, feEl("b", {}, "It stays as it is"), ` if ${who} changes theirs.`)),
    invite ? feEl("div", { class: "ms-invitebox" },
      feEl("p", { class: "ms-invite" }, s.by ? `${s.by} shared this. Share one of yours?` : "Someone shared this. Share one of yours?"),
      feEl("p", { class: "ms-sub" }, "It takes about a minute.")) : null,
    feEl("div", { class: "ms-footrow" + (invite ? " ms-wizrow" : "") },
      invite ? feEl("button", { type: "button", class: "ms-backbtn ms-greybtn", id: "msNotNow", onClick: () => closeSheet() }, "Not now") : null,
      invite ? mainButton("Share a playlist", () => { closeSheet(true); switchTab("share"); startShare(); }, { id: "msShareOne" })
        : mainButton("OK", () => closeSheet(), { id: "msGotOk" })));
  sheet.appendChild(panel);
  sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(); });
  $("msDialog").appendChild(sheet);
  if (typeof motionAllowed === "function" && motionAllowed(panel)) {
    sheet.animate([{ backgroundColor: "rgba(0,0,0,0)" }, { backgroundColor: "rgba(0,0,0,0.55)" }], { duration: 220, easing: EASE_OUT });
    panel.animate([{ transform: "translateY(100%)" }, { transform: "translateY(0)" }], { duration: 300, easing: EASE_OUT });
  }
  panel.focus({ preventScroll: true });
}
function closeSheet(now = false) {
  const sheet = $("msSheet");
  if (!sheet) return;
  sheet.removeAttribute("id");
  for (const el of sheet.querySelectorAll("[id]")) el.removeAttribute("id");
  sheet.inert = true;
  const panel = sheet.querySelector(".ms-sheet");
  if (!now && typeof motionAllowed === "function" && motionAllowed(panel)) {
    sheet.animate([{ backgroundColor: "rgba(0,0,0,0.55)" }, { backgroundColor: "rgba(0,0,0,0)" }], { duration: 180, easing: EASE_IN, fill: "forwards" });
    panel.animate([{ transform: "translateY(0)" }, { transform: "translateY(100%)" }], { duration: 200, easing: EASE_IN, fill: "forwards" }).onfinish = () => sheet.remove();
  } else sheet.remove();
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
    body.appendChild(problemBox("The songs didn\u2019t load", names.error, [{ label: "Try again", run: () => { names.state = "retry"; renderSharing(); } }]));
    return;
  }
  const have = new Set(ov ? ov.songs.map(([id]) => id) : []);
  if (ov) body.appendChild(feEl("div", { class: "ms-have-key" }, feIcon("check"), ov.same === 1 ? "1 song already in your recipes" : `${ov.same} songs already in your recipes`));
  if (sharing.previewNote) body.appendChild(problemBox(sharing.previewNote, "", [], true));
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
    feEl("span", { class: "ms-track-len" + (on && p.state !== "loading" ? " ms-track-left" : "") }, on && p.state !== "loading" ? previewLeft() : songLength(ms)),
    songMoreButton(s, i, [title, artist, ms], label));
}

// ---------------------------------------------------------------- a song's menu
// A ⋯ on every song opens Add to Liked Songs, Add to a playlist (the person's own, the recipes' first) and Open in Spotify, so a song
// heard in a preview can be kept (decided by Ron, 2026-11-08, mockups/song-open.html C). Kept in sharing.songMenu so a new drawing of
// the page (a preview starting or ending) keeps it open.
function songMoreButton(s, i, names, label) {
  const m = sharing.songMenu, open = !!(m && m.share === s.id && m.index === i);
  if (!s.songs[i] || !s.songs[i][0]) return null;
  const btn = feEl("button", { type: "button", class: "ms-more" + (open ? " ms-on" : ""), id: open ? "msSongMore" : null, "aria-label": `More for ${label}`,
    "aria-haspopup": "menu", "aria-expanded": String(open), onClick: () => (open ? closeSongMenu() : openSongMenu(s, i, names)) }, feIcon("dots"));
  return open ? feEl("div", { class: "ms-more-wrap" }, btn, songMenu(s, i, label)) : btn;
}
function openSongMenu(s, i, names) {
  dropSongMenu();
  sharing.songMenu = { share: s.id, index: i, names, view: "main", busy: null, note: "" };
  const close = (e) => {
    if (e.type === "keydown") { if (e.key !== "Escape") return; e.preventDefault(); e.stopPropagation(); closeSongMenu(); return; }
    const menu = $("msSongMenu"), button = $("msSongMore");
    if ((menu && menu.contains(e.target)) || (button && button.contains(e.target))) return;
    closeSongMenu(false);
  };
  sharing.songMenuClose = close;
  setTimeout(() => { document.addEventListener("pointerdown", close, true); document.addEventListener("keydown", close, true); });
  renderSharing();
  focusSongMenu();
}
// The menu opens down from its ⋯, or up when the list cannot scroll far enough to show it whole
function placeSongMenu() {
  const menu = $("msSongMenu"), body = $("msBody"), m = sharing.songMenu;
  if (!menu || !body || !m || !menu.getBoundingClientRect) return;
  menu.classList.remove("ms-up");
  const box = body.getBoundingClientRect(), r = menu.getBoundingClientRect();
  const below = r.bottom - (box.bottom - SONG_MENU_FOOT), canScroll = body.scrollHeight - body.clientHeight - body.scrollTop;
  m.up = below > canScroll && r.height > 0;
  menu.classList.toggle("ms-up", m.up);
}
const SONG_MENU_FOOT = 12;   // the room kept below it, at the bottom of the screen
function focusSongMenu() {
  const menu = $("msSongMenu");
  if (!menu) return;
  placeSongMenu();
  if (menu.scrollIntoView) menu.scrollIntoView({ block: "nearest" });
  const first = menu.querySelector("button:not(:disabled), a");
  if (first) first.focus();
}
function dropSongMenu() {
  if (sharing.songMenuClose) { document.removeEventListener("pointerdown", sharing.songMenuClose, true); document.removeEventListener("keydown", sharing.songMenuClose, true); sharing.songMenuClose = null; }
  sharing.songMenu = null;
}
function closeSongMenu(focusButton = true) {
  if (!sharing.songMenu) return;
  dropSongMenu();
  const b = $("msSongMore");
  renderSharing();
  if (focusButton && b) { const again = document.querySelector(`#msBody .ms-more[aria-label="${CSS.escape(b.getAttribute("aria-label"))}"]`); if (again) again.focus(); }
}
function songMenuItem(icon, text, { onClick, disabled, end, id } = {}) {
  return feEl("button", { type: "button", role: "menuitem", class: "ms-mi", id, disabled: disabled ? true : undefined, onClick },
    icon, feEl("span", { class: "ms-mi-text", text }), end || null);
}
function songMenu(s, i, label) {
  const m = sharing.songMenu, id = s.songs[i][0];
  const ready = typeof connection !== "undefined" && connection === "ready";
  const menu = feEl("div", { id: "msSongMenu", class: "ms-menu ms-songmenu" + (m.up ? " ms-up" : ""), role: "menu", "aria-label": label });
  if (m.view === "lists") {
    menu.appendChild(songMenuItem(feIcon("back"), "Add to a playlist", { id: "msSongBack", onClick: () => { m.view = "main"; m.note = ""; renderSharing(); focusSongMenu(); } }));
    menu.appendChild(feEl("div", { class: "ms-mi-rule" }));
    const own = typeof readablePlaylists === "function" ? readablePlaylists() : [];
    const inRecipes = new Set(recipePlaylistIds());
    const first = own.filter((p) => inRecipes.has(p.id)), rest = own.filter((p) => !inRecipes.has(p.id));
    const scroller = feEl("div", { class: "ms-mi-lists" });
    const group = (title, list) => {
      if (!list.length) return;
      if (first.length && rest.length) scroller.appendChild(feEl("div", { class: "ms-mi-head", text: title }));
      for (const p of list) {
        const has = songIsIn(s, i, p.id), busy = m.busy === p.id;
        scroller.appendChild(songMenuItem(null, p.name, {
          disabled: has || !!m.busy, onClick: () => addSongTo(s, i, p),
          end: busy ? feEl("span", { class: "ms-play-spin ms-mi-end" }) : has ? feEl("span", { class: "ms-mi-end ms-mi-has", title: "Already in it" }, feIcon("check")) : null,
        }));
      }
    };
    group("In your recipes", first);
    group("Other playlists", rest);
    if (!own.length) scroller.appendChild(feEl("div", { class: "ms-mi-empty", text: "No playlists of yours to add it to." }));
    menu.appendChild(scroller);
  } else {
    const liked = sharing.liked.has(id);
    menu.appendChild(songMenuItem(feIcon(liked ? "check" : "heart"), liked ? "In your Liked Songs" : m.busy === "like" ? "Adding to Liked Songs..." : "Add to Liked Songs",
      { id: "msSongLike", disabled: !ready || liked || !!m.busy, onClick: () => likeSong(s, i) }));
    menu.appendChild(songMenuItem(feIcon("musicplus"), "Add to a playlist", { id: "msSongAdd", disabled: !ready,
      end: feEl("span", { class: "ms-mi-end ms-mi-chev" }, feIcon("chevron")),
      onClick: () => { m.view = "lists"; m.note = ""; renderSharing(); focusSongMenu(); } }));
    menu.appendChild(feEl("div", { class: "ms-mi-rule" }));
    menu.appendChild(feEl("a", { role: "menuitem", class: "ms-mi", id: "msSongOpen", href: `https://open.spotify.com/track/${encodeURIComponent(id)}`, target: "_blank", rel: "noopener noreferrer",
      onClick: () => setTimeout(() => closeSongMenu(false)) }, feIcon("spotify"), feEl("span", { class: "ms-mi-text", text: "Open in Spotify" })));
  }
  if (m.note) menu.appendChild(problemBox(m.note, "", [], true));
  return menu;
}
// whether a playlist already has the song, by what this browser keeps of it or what was added this visit
function songIsIn(s, i, playlistId) {
  const [id, isrc] = s.songs[i];
  if ((sharing.addedTo.get(playlistId) || new Set()).has(id)) return true;
  const tracks = trackCache.get(playlistId);
  return !!tracks && tracks.some((t) => t.uri === "spotify:track:" + id || (isrc && t.key === "isrc:" + String(isrc).toUpperCase()));
}
async function likeSong(s, i) {
  const m = sharing.songMenu, id = s.songs[i][0];
  m.busy = "like"; m.note = "";
  renderSharing();
  try {
    await spotifyRequest("PUT", "/me/library", { params: { uris: "spotify:track:" + id } });
    sharing.liked.add(id);
  } catch (err) { m.note = "It wasn\u2019t added. " + (err && err.message ? err.message : ""); }
  m.busy = null;
  if (sharing.songMenu === m) { renderSharing(); if ($("msSongLike")) $("msSongLike").focus(); }
}
async function addSongTo(s, i, p) {
  const m = sharing.songMenu, [id, isrc] = s.songs[i], uri = "spotify:track:" + id;
  m.busy = p.id; m.note = "";
  renderSharing();
  try {
    const res = await spotifyRequest("POST", `/playlists/${p.id}/items`, { json: { uris: [uri] } });
    if (!sharing.addedTo.has(p.id)) sharing.addedTo.set(p.id, new Set());
    sharing.addedTo.get(p.id).add(id);
    // what this browser keeps of the playlist gets the song too, so the checks and the overlap follow at once
    const info = playlists.find((x) => x.id === p.id);
    if (info && res && res.snapshot_id) info.snapshot = res.snapshot_id;
    if (info && typeof info.count === "number") info.count++;
    const kept = await keptSongsFor(p.id);
    if (kept) {
      const [title, artist, ms] = m.names || [];
      const song = { uri, ms: ms || 0, label: `${artist || ""} - ${title || ""}` };
      if (isrc) song.key = "isrc:" + String(isrc).toUpperCase();
      const tracks = [...kept, song];
      trackCache.set(p.id, tracks);
      await saveSongs({ id: p.id, snapshot: info && info.snapshot ? info.snapshot : null, tracks, v: SONGS_VERSION, savedAt: Date.now() });
    }
    if (recipePlaylistIds().includes(p.id)) sharing.overlap = await measureOverlap();
  } catch (err) { m.note = "It wasn\u2019t added. " + (err && err.message ? err.message : ""); }
  m.busy = null;
  if (sharing.songMenu === m) renderSharing();
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
  for (;;) {   // a report that did not go through is sent again as it was, on Try again
    try {
      await sharingFetch("POST", "/report", { share: s.id, reason: result.reason, note: result.note });
      showNotices([{ text: `Thanks. ${named(s.name)} was reported.`, transient: true }]);
      return;
    } catch (err) {
      const again = await askSyncChoice("Your report didn\u2019t go through", "Nothing was sent. Try again in a moment.",
        [{ label: "Try again", value: "again", main: true, icon: "retry" }, { label: "Close", value: null }], { problem: "flag", what: err.message });
      if (!again) return;
    }
  }
}

// ---------------------------------------------------------------- Shared by you
// The person's shares, each opening its edit page; one changed in Spotify since it was shared gets a strip joined under it with Update.
// With none yet, a short welcome with three steps. At the bottom, Share a playlist (or Share another playlist).
function sharedFor(p) { return sharing.mine ? sharing.mine.find((s) => s.playlist === p.id) || null : null; }
const playlistFor = (m) => playlists.find((p) => p.id === m.playlist) || null;
const changedInSpotify = (m, p) => !!(p && p.snapshot && m.snapshot && p.snapshot !== m.snapshot);
function renderShareYours(body, foot) {
  if (connection !== "ready" || !me) { body.appendChild(feEl("p", { class: "ms-note" }, "Connect to Spotify to share your playlists.")); return; }
  if (sharing.mineError) body.appendChild(problemBox("Your shares didn\u2019t load", sharing.mineError, [{ label: "Try again", run: () => loadMine() }]));
  if (!sharing.mine && !sharing.mineError) { body.appendChild(feEl("p", { class: "ms-note" }, "Loading...")); return; }
  const mine = sharing.mine || [];
  if (!mine.length) {
    const covers = playlists.filter((p) => p.owner === me.id && !p.isSave && !p.madeByApp && p.image).slice(0, 3);
    const fan = feEl("div", { class: "ms-fan" + (covers.length ? "" : " ms-fan-blank"), "aria-hidden": "true" });
    if (covers.length) covers.forEach((p) => fan.appendChild(feEl("img", { src: p.image, alt: "" })));
    else for (let i = 0; i < 3; i++) fan.appendChild(feEl("span", {}));
    body.appendChild(feEl("div", { class: "ms-welcome" }, fan,
      feEl("h3", {}, "You haven't shared any playlists yet"),
      feEl("ol", { class: "ms-how" },
        feEl("li", {}, feEl("b", {}, "1"), feEl("span", {}, "Choose one of your playlists.")),
        feEl("li", {}, feEl("b", {}, "2"), feEl("span", {}, "Say what type it is: a ceremony, a phase, a mood, or something else.")),
        feEl("li", {}, feEl("b", {}, "3"), feEl("span", {}, "Add a few details, and share it."))),
      feEl("p", { class: "ms-sub" }, "Others get their own private copy. Yours stays as it is, and you can stop sharing it any time.")));
    footButtons(foot, null, mainButton("Share a playlist", startShare, { icon: "plus" }));
    return;
  }
  const list = feEl("div", { class: "ms-yours-list" });
  for (const m of mine) list.appendChild(yourRow(m));
  body.appendChild(list);
  footButtons(foot, null, mainButton("Share another playlist", startShare, { icon: "plus" }));
}
function yourRow(m) {
  const p = playlistFor(m), pub = sharing.library && sharing.library.shares.find((x) => x.id === m.id);
  const cover = (pub && pub.cover) || m.cover || (p && p.image);
  const changed = changedInSpotify(m, p);
  const row = feEl("div", { class: "ms-row ms-yrow", role: "button", tabindex: "0", id: "msYours-" + m.id, onClick: () => (pub ? openDetail(m.id) : editShare(m)) },
    cover ? feEl("img", { class: "ms-cover", src: cover, alt: "" }) : feEl("span", { class: "ms-cover ms-nocover" }, feIcon("notes")),
    feEl("div", { class: "ms-text" },
      feEl("div", { class: "ms-klabel" }, kindLabel(m)),
      feEl("div", { class: "ms-name", text: m.name }),
      feEl("div", { class: "ms-sub" }, [m.by || "Anonymous", m.ms ? lengthText(m.ms / 60000) : ""].filter(Boolean).join(" · ")),
      m.hidden ? feEl("div", {}, feEl("span", { class: "ms-hiddentag" }, feIcon("eyeoff"), "Hidden after reports")) : null),
    feEl("span", { class: "ms-chev" }, feIcon("chevron")));
  row.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === row) { e.preventDefault(); row.click(); } });
  if (!changed) return row;
  const busy = sharing.updating === m.id;
  const failed = sharing.updateErrors && sharing.updateErrors[m.id];
  return feEl("div", { class: "ms-joined" }, row,
    feEl("div", { class: "ms-strip", id: "msStrip-" + m.id }, feEl("span", {}, "Changed in Spotify since you shared it"),
      feEl("button", { type: "button", class: "ms-stripbtn", disabled: busy || !!sharing.updating, onClick: () => updateShare(m) }, busy ? "Updating..." : "Update")),
    failed ? problemBox("Not updated", failed, [{ label: "Try again", run: () => updateShare(m) }]) : null);
}
// Update from the strip: the share again with the same details and the playlist's songs (and its Spotify description, when the share uses it) as they are now
async function updateShare(m) {
  const p = playlistFor(m);
  if (!p || sharing.updating) return;
  sharing.updating = m.id;
  sharing.updateErrors = sharing.updateErrors || {};
  delete sharing.updateErrors[m.id];
  renderSharing();
  try {
    trackCache.delete(p.id);   // the songs changed
    await sendShare(p, draftFromShare(m, p));
    await loadMine();
    loadLibrary(true);
  } catch (err) { sharing.updateErrors[m.id] = err.message; }
  sharing.updating = null;
  renderSharing();
}

// ---------------------------------------------------------------- Share a playlist: Playlist, Type, Details
// A draft: the playlist, its type, what the type asks for, the description (the person's own, or the playlist's Spotify description, kept in step
// when the share is updated), and whether it is shared anonymously.
function newDraft(p) {
  return { playlist: p.id, shareId: null, kind: null, books: new Set(), bookOther: "", phases: new Set(), moods: [], other: "", desc: "", descSource: "mine", anon: false, errors: null, refused: "", problem: "", sending: false };
}
function draftFromShare(m, p) {
  return { playlist: m.playlist, shareId: m.id, kind: m.kind, books: new Set(m.books || []), bookOther: m.bookOther || "", phases: new Set(m.phases || []), moods: (m.moods || []).slice(), other: m.other || "",
    desc: m.descSource === "spotify" ? "" : m.description || "", descSource: m.descSource === "spotify" && spotifyDescription(p) ? "spotify" : "mine", anon: !m.by,
    errors: null, refused: "", problem: "", sending: false };
}
const spotifyDescription = (p) => (p ? cleanSpotifyDescription(p.description) : "");
const draftDescription = (d, p) => (d.descSource === "spotify" ? spotifyDescription(p) : d.desc.trim());
// the person's own playlists that can be shared: not a copy from Music sharing, not shared already, not made by this app, not a recipe save,
// and not one refused before as a copy of someone else's share (until it changes in Spotify)
function shareCandidates() {
  if (!me) return [];
  const copies = new Set(Object.values(sharingCopies()));
  return playlists.filter((p) => p.owner === me.id && !p.isSave && !p.madeByApp && !copies.has(p.id) && !copyShareId(p) && !sharedFor(p) && !knownBlock(p));
}
function startShare() {
  sharing.tab = "share";
  sharing.detail = null;
  sharing.flow = { mode: "new", step: 0, draft: null, reading: null };
  renderSharing();
  $("msBody").scrollTop = 0;
}
function editShare(m) {
  const p = playlistFor(m);
  sharing.tab = "share";
  sharing.detail = null;
  sharing.flow = { mode: "edit", share: m, draft: draftFromShare(m, p) };
  loadBlockedWords().then((l) => { blockedNow = l; });
  renderSharing();
  $("msBody").scrollTop = 0;
}
function flowBack() {
  const f = sharing.flow;
  if (!f) return;
  endTyping();
  if (f.mode === "new" && f.step > 0 && f.step < 3) { f.step--; f.draft.errors = null; renderSharing(); $("msBody").scrollTop = 0; return; }
  if (f.mode === "edit" && backToDetail()) return;
  sharing.flow = null;
  renderSharing();
  $("msBody").scrollTop = 0;
}
// from the edit page back to the playlist's page it was opened from (and its tab), when there is one
function backToDetail() {
  const back = sharing.backTo;
  sharing.backTo = null;
  if (!back || !sharing.library || !sharing.library.shares.some((x) => x.id === back.id)) return false;
  sharing.flow = null;
  sharing.tab = back.tab;
  sharing.detail = back.id;
  renderSharing();
  $("msBody").scrollTop = 0;
  return true;
}
function renderFlow(body, foot) {
  const f = sharing.flow;
  if (f.mode === "done") return renderShared(body, foot);
  if (f.mode === "new" && f.step === 0) return renderPickPlaylist(body, foot);
  const p = playlists.find((x) => x.id === f.draft.playlist);
  if (!p) { sharing.flow = null; renderSharing(); return; }
  body.appendChild(othersWillSee(p, f.draft));
  if (f.draft.refused) body.appendChild(flowProblem(f.draft.refused, "msRefused"));
  else if (f.draft.problem) body.appendChild(flowProblem(f.draft.problem, "msProblem"));
  if (f.mode === "new" && f.step === 1) {
    body.appendChild(feEl("h3", { class: "ms-q" }, "What type of playlist is this?"));
    body.appendChild(field("kind", null, kindTiles(f.draft.kind, (k) => { f.draft.kind = k; draftChanged(); renderSharing(); }, { big: true })));
    body.appendChild(anonBox(f.draft));
    footButtons(foot, { onClick: flowBack, wizard: true }, mainButton("Next", () => {
      if (!f.draft.kind) { f.draft.errors = { kind: "Choose a type." }; renderSharing(); return; }
      f.draft.errors = null;
      f.step = 2;
      renderSharing();
      $("msBody").scrollTop = 0;
    }, { iconAfter: "next" }));
    return;
  }
  if (f.mode === "edit") {
    body.appendChild(field("kind", "What type of playlist is this?", kindTiles(f.draft.kind, (k) => { f.draft.kind = k; draftChanged(); renderSharing(); })));
  }
  for (const part of detailFields(p, f.draft)) body.appendChild(part);
  if (f.mode === "edit") {
    body.appendChild(anonBox(f.draft));
    body.appendChild(feEl("button", { type: "button", class: "ms-stopbtn", id: "msStop", onClick: () => stopSharing(f.share) }, feIcon("ban"), "Stop sharing"));
  }
  const label = f.draft.sending ? (f.mode === "edit" ? "Updating..." : "Sharing...") : f.mode === "edit" ? "Update" : "Share now";
  footButtons(foot, { onClick: flowBack, wizard: true }, mainButton(label, () => submitDraft(p), { grey: !!f.draft.refused, disabled: !!f.draft.refused || f.draft.sending, icon: f.mode === "edit" ? "check" : "upload" }));
}
// Step 1: tapping a playlist reads its songs, then goes on to Type
function renderPickPlaylist(body, foot) {
  const f = sharing.flow;
  footButtons(foot, { onClick: flowBack, wizard: true });
  const list = shareCandidates();
  if (!list.length) {
    body.appendChild(emptyState("notes", "No playlists of your own to share", "Make a playlist in Spotify, then come back. Playlists you got from Music sharing and ones this app built can't be shared."));
    return;
  }
  body.appendChild(feEl("h3", { class: "ms-q" }, "Which playlist would you like to share?"));
  if (f.readError) body.appendChild(problemBox(f.readError.title, f.readError.text, [{ label: "Try again", run: () => pickPlaylist(f.readError.p) }]));
  const box = feEl("div", { class: "ms-pick-list" });
  for (const p of list) {
    const reading = f.reading === p.id;
    const row = feEl("button", { type: "button", class: "ms-row ms-pickrow", id: "msPick-" + p.id, disabled: !!f.reading, onClick: () => pickPlaylist(p) },
      p.image ? feEl("img", { class: "ms-cover", src: p.image, alt: "" }) : feEl("span", { class: "ms-cover ms-nocover" }, feIcon("notes")),
      feEl("span", { class: "ms-text" }, feEl("span", { class: "ms-name", text: p.name }), feEl("span", { class: "ms-sub" }, reading ? "Reading its songs..." : p.count != null ? songCountText(p.count) : "")),
      reading ? feEl("span", { class: "ms-play-spin" }) : feEl("span", { class: "ms-chev" }, feIcon("chevron")));
    box.appendChild(row);
  }
  body.appendChild(box);
}
async function pickPlaylist(p) {
  const f = sharing.flow;
  f.reading = p.id;
  f.readError = "";
  renderSharing();
  try {
    const tracks = await loadTracks(p.id);
    if (sharing.flow !== f) return;
    if (!tracks.length) throw new Error("It has no songs");
    f.draft = newDraft(p);
    f.step = 1;
  } catch (err) { f.readError = { p, title: `The songs of ${named(p.name)} couldn\u2019t be read`, text: String(err.message || err).replace(/\.?$/, ".") }; }
  f.reading = null;
  renderSharing();
  $("msBody").scrollTop = 0;
}
// "Others will see": the row as it will be in Shared by others, following each choice; parts not chosen yet are blank.
// While typing on a phone it shrinks to one line (CSS, .ms-typing).
function othersWillSee(p, d) {
  const tracks = trackCache.get(p.id);
  const ms = tracks ? tracks.reduce((n, t) => n + (t.ms || 0), 0) : (sharing.flow.share && sharing.flow.share.ms) || 0;
  const look = { kind: d.kind, books: [...d.books], bookOther: d.bookOther, phases: [...d.phases], moods: d.moods, other: cleanWord(d.other, SHARE_OTHER_MAX) };
  const by = d.anon ? "Anonymous" : (me && (me.display_name || me.id)) || "";
  return feEl("div", { class: "ms-pcard", id: "msCardPreview" },
    feEl("div", { class: "ms-pcard-cap" }, "Others will see"),
    feEl("div", { class: "ms-pcard-line" }, "Others will see: ", feEl("b", { text: p.name })),
    feEl("div", { class: "ms-row ms-prow" },
      p.image ? feEl("img", { class: "ms-cover", src: p.image, alt: "" }) : feEl("span", { class: "ms-cover ms-nocover" }, feIcon("notes")),
      feEl("div", { class: "ms-text" },
        feEl("div", { class: "ms-klabel" + (kindLabel(look) ? "" : " ms-blank") }, kindLabel(look) || " "),
        feEl("div", { class: "ms-name", text: p.name }),
        feEl("div", { class: "ms-sub" }, [by, ms ? lengthText(ms / 60000) : ""].filter(Boolean).join(" · ")))));
}
function refreshCard() {
  const f = sharing.flow, old = $("msCardPreview");
  if (!f || !old || !f.draft) return;
  old.replaceWith(othersWillSee(playlists.find((x) => x.id === f.draft.playlist), f.draft));
}
// after any change: the card follows, and errors already shown are worked out again (a fixed field loses its red)
function draftChanged() {
  const d = sharing.flow && sharing.flow.draft;
  if (!d) return;
  d.problem = "";
  if (d.errors) {
    const before = d.errors;
    d.errors = draftErrors(d, playlists.find((x) => x.id === d.playlist));
    for (const k of Object.keys(before)) if (!d.errors[k]) clearFieldError(k);
  }
  refreshCard();
}
function clearFieldError(key) {
  const box = document.querySelector(`#msBody [data-field="${key}"]`);
  if (!box) return;
  box.classList.remove("ms-bad");
  const err = box.querySelector(".ms-ferr");
  if (err) err.remove();
}
// a field: its label (with a note at the right), what it holds, and an error under it once Share now found it missing
function field(key, label, content, note = null) {
  const d = sharing.flow && sharing.flow.draft, err = d && d.errors && d.errors[key];
  return feEl("div", { class: "ms-field" + (err ? " ms-bad" : ""), "data-field": key },
    label ? feEl("div", { class: "ms-flabel" }, feEl("b", {}, label), note) : null,
    content,
    err ? fieldError(err) : null);
}
// what is missing or wrong in a field: one sentence in the usual small error box (Pink C: the field itself keeps its border, since pink outlines mean chosen or focused)
function fieldError(text) {
  const box = problemBox(text, "", [], true);
  box.classList.add("ms-ferr");
  return box;
}
// at the top of a share's details, why it can't be shared
function flowProblem(text, id) {
  const box = problemBox(text, "", [], true);
  box.classList.add("ms-errbox");
  box.id = id;
  return box;
}
const fieldNote = (text) => feEl("span", { class: "ms-fnote" }, text);
function anonBox(d) {
  const box = feEl("input", { type: "checkbox", class: "ms-cb", id: "msAnon", checked: d.anon });
  const name = (me && (me.display_name || me.id)) || "";
  const say = () => (d.anon ? "Others see Anonymous instead of your Spotify name." : name ? `Others see your Spotify name, ${name}.` : "Others see your Spotify name.");
  const sub = feEl("span", { class: "ms-sub", id: "msAnonSay" }, say());
  box.addEventListener("change", () => { d.anon = box.checked; sub.textContent = say(); draftChanged(); });
  return feEl("label", { class: "ms-cbrow ms-anon" }, box, feEl("span", {}, feEl("b", {}, "Share anonymously"), sub));
}
function detailFields(p, d) {
  const out = [];
  if (d.kind === "ceremony") out.push(field("books", "For use with which books?", booksContent(d), fieldNote("all that apply")));
  if (d.kind === "phase") out.push(field("phases", "Which phases?", phaseCurve(d.phases, draftChanged, "Which phases?"), fieldNote("all that apply")));
  if (d.kind === "mood") out.push(field("moods", "Which moods?", moodField(d), fieldNote("at least 1")));
  if (d.kind === "other") out.push(field("other", "What kind of playlist is this?", otherField(d), fieldNote("a word or two")));
  if (d.kind) out.push(descriptionField(p, d));
  return out;
}
// the books, and with Other lit a small field for its code under them (the tile shows the code as it is typed)
function booksContent(d) {
  const box = feEl("div", { id: "msBooks" }, bookTiles(d.books, (i) => { draftChanged(); refreshBooks(d, i === OTHER_BOOK && d.books.has(OTHER_BOOK)); }, false, d.bookOther));
  if (d.books.has(OTHER_BOOK)) box.appendChild(bookCodeRow(d.bookOther, box, (code) => { d.bookOther = code; draftChanged(); }, () => $("msDesc")));
  return box;
}
// the Other book field: up to 2 letters or numbers, kept in capitals, shown in the Other tile (inside tiles) as it is typed
function bookCodeRow(value, tiles, changed, next = null) {
  const input = feEl("input", { type: "text", class: "ms-input ms-bcode", id: "msBookCode", maxlength: String(BOOK_CODE_MAX), value, autocapitalize: "characters",
    autocomplete: "off", spellcheck: "false", enterkeyhint: next ? "next" : "done", "aria-label": "Other book, up to 2 letters or numbers" });
  input.addEventListener("input", () => {
    const code = cleanBookCode(input.value);
    if (input.value !== code) input.value = code;
    const tile = tiles.querySelector(".ms-btile-other");
    if (tile) { tile.querySelector(".ms-bookicon").replaceWith(bookIcon(bookName(OTHER_BOOK, code))); tile.setAttribute("aria-label", "Other book" + (code ? " " + code : "")); }
    changed(code);
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const to = next && next(); if (to && !to.readOnly) to.focus(); else input.blur(); } });
  return feEl("label", { class: "ms-bcode-row" }, feEl("b", {}, "Other book"), input, feEl("span", { class: "ms-fnote" }, "Up to 2 letters or numbers"));
}
function refreshBooks(d, focusCode = false) {
  const old = $("msBooks");
  if (old) old.replaceWith(booksContent(d));
  if (focusCode && $("msBookCode")) $("msBookCode").focus();
}
function otherField(d) {
  const input = feEl("input", { type: "text", class: "ms-input", id: "msOther", maxlength: String(SHARE_OTHER_MAX), value: d.other, placeholder: "e.g. Sound bath", enterkeyhint: "next", "aria-label": "What kind of playlist is this?" });
  input.addEventListener("input", () => { d.other = input.value; draftChanged(); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const next = $("msDesc"); if (next && !next.readOnly) next.focus(); else input.blur(); } });
  return input;
}
// Moods are typed as words (a comma or Return ends one; a word may be two, like "deep calm"); each becomes a chip with an x.
// Moods others use are offered under the box. A word on the blocked list stays in the box with the small error box under it.
function moodField(d) {
  const input = feEl("input", { type: "text", class: "ms-moodinput", id: "msMoodInput", maxlength: String(SHARE_MOOD_CHARS + 10), "aria-label": "Add a mood", enterkeyhint: "done", autocapitalize: "none", spellcheck: "false" });
  const box = feEl("div", { class: "ms-moodbox", onClick: (e) => { if (e.target === box) input.focus(); } });
  const suggest = feEl("div", { class: "ms-chips ms-suggest" });
  const blockedMsg = Object.assign(fieldError("That word can't be used."), { hidden: true });
  const add = (text) => {
    const w = cleanMood(text);
    if (w.length < 2 || d.moods.includes(w) || d.moods.length >= SHARE_MOODS_MAX) return true;
    if (blockedWord(w)) { blockedMsg.hidden = false; box.classList.add("ms-bad-box"); return false; }
    d.moods.push(w);
    return true;
  };
  const showSuggestions = () => {
    suggest.textContent = "";
    if (d.moods.length >= SHARE_MOODS_MAX) return;
    const q = cleanMood(input.value);
    knownMoods().filter((t) => !d.moods.includes(t) && (!q || t.startsWith(q) || t.includes(" " + q))).slice(0, 8).forEach((t) => {
      const b = feEl("button", { type: "button", class: "ms-chip ms-chip-add", onClick: () => { add(t); input.value = ""; draw(); draftChanged(); input.focus(); } }, t);
      b.addEventListener("mousedown", (e) => e.preventDefault());   // keeps the focus in the box, so the half-typed word is not added on the way
      suggest.appendChild(b);
    });
  };
  const draw = () => {
    box.textContent = "";
    for (const t of d.moods) {
      box.appendChild(feEl("span", { class: "ms-chip ms-on ms-moodchip" }, t,
        feEl("button", { type: "button", class: "ms-chipx", "aria-label": "Remove " + t, onClick: () => { d.moods = d.moods.filter((x) => x !== t); draw(); draftChanged(); input.focus(); } }, "×")));
    }
    input.placeholder = d.moods.length ? "" : "e.g. tender, grief";
    input.hidden = d.moods.length >= SHARE_MOODS_MAX;
    box.appendChild(input);
    showSuggestions();
  };
  const take = () => {
    const parts = input.value.split(",");
    const rest = parts.pop();
    let ok = true;
    for (const part of parts) ok = add(part) && ok;
    input.value = ok ? rest : parts.join(",") + (rest ? "," + rest : "");
    return ok;
  };
  input.addEventListener("input", () => {
    blockedMsg.hidden = true;
    box.classList.remove("ms-bad-box");
    if (input.value.includes(",")) { take(); draw(); draftChanged(); input.focus(); }
    else showSuggestions();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); if (input.value.trim()) { if (add(input.value)) input.value = ""; draw(); draftChanged(); input.focus(); } else input.blur(); }
    else if (e.key === "Backspace" && !input.value && d.moods.length) { d.moods.pop(); draw(); draftChanged(); input.focus(); }
  });
  input.addEventListener("blur", () => { if (input.value.trim() && add(input.value)) { input.value = ""; draw(); draftChanged(); } });
  draw();
  return feEl("div", {}, box, blockedMsg, suggest);
}
// The description: the person's own (the default), or with the small switch at the right of its label, the playlist's Spotify description,
// shown locked and kept in step with Spotify when the share is updated (C2, decided by Ron, 2026-11-08). No switch when Spotify has none.
function descriptionField(p, d) {
  const theirs = spotifyDescription(p);
  if (!theirs && d.descSource === "spotify") d.descSource = "mine";
  const required = d.kind === "ceremony" || d.kind === "phase" || d.kind === "other";
  const spotify = d.descSource === "spotify";
  const area = feEl("textarea", { class: "ms-ta" + (spotify ? " ms-locked" : ""), id: "msDesc", rows: "3", maxlength: String(SHARE_DESC_MAX), placeholder: "A sentence or two",
    "aria-label": "Description", readonly: spotify || null }, spotify ? theirs : d.desc);
  area.addEventListener("input", () => { if (!spotify) { d.desc = area.value; draftChanged(); } });
  const sw = theirs ? feEl("span", { class: "ms-mseg", role: "radiogroup", "aria-label": "Whose description" },
    ...[["mine", "Mine"], ["spotify", "Spotify's"]].map(([v, label]) => feEl("button", { type: "button", role: "radio", "aria-checked": String(d.descSource === v), class: d.descSource === v ? "ms-on" : "",
      id: v === "mine" ? "msDescMine" : "msDescSpotify", onClick: () => { if (d.descSource !== v) { d.descSource = v; draftChanged(); const old = document.querySelector('#msBody [data-field="description"]'); if (old) old.replaceWith(descriptionField(p, d)); } } }, label))) : null;
  return field("description", "Description", feEl("div", {}, area, spotify ? feEl("p", { class: "ms-fsub ms-keptnote" }, "Kept in step with Spotify when you Update.") : null),
    sw || fieldNote(required ? "a sentence or two" : "optional"));
}
// what is missing, by field (Share now marks these red with a message under each)
function draftErrors(d, p) {
  const e = {};
  if (!d.kind) e.kind = "Choose a type.";
  if (d.kind === "ceremony" && !d.books.size) e.books = "Choose at least one book.";
  else if (d.kind === "ceremony" && d.books.has(OTHER_BOOK)) {
    const code = cleanBookCode(d.bookOther);
    if (!code) e.books = "Type the other book, up to 2 letters or numbers.";
    else if (blockedWord(code)) e.books = "That other book can't be used.";
  }
  if (d.kind === "phase" && !d.phases.size) e.phases = "Choose at least one phase.";
  if (d.kind === "mood" && !d.moods.length) e.moods = "Add at least one mood.";
  if (d.kind === "other") {
    const o = cleanWord(d.other, SHARE_OTHER_MAX);
    if (!o) e.other = "Say what it is in a word or two.";
    else if (blockedWord(o)) e.other = "That has a word that can't be used.";
  }
  if ((d.kind === "ceremony" || d.kind === "phase" || d.kind === "other") && !draftDescription(d, p)) e.description = "Add a sentence or two.";
  return e;
}
async function submitDraft(p) {
  const f = sharing.flow, d = f.draft;
  if (d.sending || d.refused) return;
  endTyping();
  // a mood still in the box counts, as if Return had been pressed
  const moodInput = $("msMoodInput");
  if (moodInput && moodInput.value.trim()) { const w = cleanMood(moodInput.value); if (w.length >= 2 && !blockedWord(w) && !d.moods.includes(w)) d.moods.push(w); }
  if (!blockedNow) blockedNow = await loadBlockedWords();
  d.errors = draftErrors(d, p);
  if (Object.keys(d.errors).length) {
    renderSharing();
    const first = document.querySelector("#msBody .ms-bad");
    if (first && first.scrollIntoView) first.scrollIntoView({ block: "center", behavior: typeof motionAllowed === "function" && motionAllowed(first) ? "smooth" : "auto" });
    return;
  }
  d.errors = null;
  d.sending = true;
  d.problem = "";
  renderSharing();
  try {
    await sendShare(p, d);
    d.sending = false;
    rememberBlock(p, null);
    await loadMine();
    loadLibrary(true);
    if (f.mode === "edit") { if (backToDetail()) return; sharing.flow = null; renderSharing(); $("msBody").scrollTop = 0; return; }
    sharing.flow = { mode: "done", name: p.name };
    renderSharing();
    $("msBody").scrollTop = 0;
  } catch (err) {
    d.sending = false;
    if (err.code === "copy") {
      // refused as a copy: said at the top with the exact share, Share now grey; remembered until the playlist changes in Spotify
      d.refused = err.percent != null && err.of ? `${err.percent}% of its songs are in ${named(err.of)}, which someone else shares, so it can't be shared.` : err.message;
      rememberBlock(p, "copy", err.of || "");
    } else if (["books", "phases", "moods", "other", "description", "kind"].includes(err.code)) {
      d.errors = { [err.code]: err.message.replace("cannot", "can't") };
    } else d.problem = err.message;
    renderSharing();
    $("msBody").scrollTop = 0;
  }
}
// sends a share (new, edited or updated): what the draft says, and the playlist's songs as they are now
async function sendShare(p, d) {
  const tracks = await loadTracks(p.id);
  const ms = tracks.reduce((n, t) => n + (t.ms || 0), 0);
  const songs = tracks.map((t) => [String(t.uri).replace("spotify:track:", ""), t.key ? t.key.slice(5) : ""]);
  const names = tracks.map(songName);   // for the playlist's page; the worker sends them one playlist at a time
  const kind = d.kind;
  await sharingFetch("POST", "/share", {
    playlist: p.id, snapshot: p.snapshot || null, name: p.name, by: d.anon ? null : (me && (me.display_name || me.id)) || null,
    kind, books: kind === "ceremony" ? [...d.books].sort((a, b) => a - b) : [], bookOther: kind === "ceremony" && d.books.has(OTHER_BOOK) ? cleanBookCode(d.bookOther) : "", phases: kind === "phase" ? [...d.phases].sort() : [], moods: kind === "mood" ? d.moods.slice() : [],
    other: kind === "other" ? cleanWord(d.other, SHARE_OTHER_MAX) : "", description: draftDescription(d, p), descSource: d.descSource,
    cover: p.cover || null, songs, names, ms, artists: topArtists(tracks),
  });
}
// the page after Share now: a big check, what happened, and Share another playlist or Done
function renderShared(body, foot) {
  const f = sharing.flow;
  body.appendChild(feEl("div", { class: "ms-shared" },
    feEl("span", { class: "ms-bigcheck" }, feIcon("check")),
    feEl("h3", { text: `${named(f.name)} is shared` }),
    feEl("p", { class: "ms-sub" }, "Other facilitators can find it in Shared by others now.")));
  foot.hidden = false;
  foot.appendChild(feEl("div", { class: "ms-footcol" },
    mainButton("Share another playlist", startShare, { icon: "plus" }),
    feEl("button", { type: "button", class: "ms-backbtn ms-wide", id: "msDone", onClick: () => { sharing.flow = null; renderSharing(); } }, "Done")));
}
async function stopSharing(m) {
  const answer = await askSyncChoice(`Stop sharing ${named(m.name)}?`, "Copies others already got stay theirs.",
    [{ label: "Cancel", value: null }, { label: "Stop sharing", value: "stop", danger: true }]);
  if (answer !== "stop") return;
  const d = sharing.flow && sharing.flow.draft;
  try {
    await sharingFetch("DELETE", "/share/" + m.id);
    sharing.flow = null;
    sharing.backTo = null;
    await loadMine();
    loadLibrary(true);
  } catch (err) { if (d) { d.problem = err.message; renderSharing(); } }
}

// ---------------------------------------------------------------- typing on a phone
// While a field has the focus and the keyboard is up, the popup fits above it (visualViewport), the card shrinks to one line and the
// bottom row hides; a tap outside a field puts the keyboard away (as does the phone's own Done).
function watchKeyboard() {
  const vv = window.visualViewport;
  const dialog = $("msDialog");
  if (!vv || !dialog) return;
  const fit = () => {
    const field = document.activeElement;
    const typing = !$("msOverlay").hidden && field && dialog.contains(field) && field.matches("input[type=text], input[type=search], textarea") && window.innerHeight - vv.height > 120;
    dialog.classList.toggle("ms-typing", !!typing);
    dialog.style.height = typing ? vv.height + "px" : "";
    dialog.style.transform = typing && vv.offsetTop ? `translateY(${vv.offsetTop}px)` : "";
  };
  vv.addEventListener("resize", fit);
  vv.addEventListener("scroll", fit);
  dialog.addEventListener("focusin", () => setTimeout(fit, 50));
  dialog.addEventListener("focusout", () => setTimeout(fit, 50));
  $("msBody").addEventListener("pointerdown", (e) => {
    const a = document.activeElement;
    if (a && a.matches("input, textarea") && !e.target.closest("input, textarea, button, label, .ms-moodbox")) a.blur();
  });
}
function endTyping() {
  const a = document.activeElement;
  if (a && $("msDialog") && $("msDialog").contains(a) && a.matches("input, textarea")) a.blur();
  if ($("msDialog")) { $("msDialog").classList.remove("ms-typing"); $("msDialog").style.height = ""; $("msDialog").style.transform = ""; }
}

// ---------------------------------------------------------------- what this device remembers about refusals
function blockRecord() {
  try { return JSON.parse(localStorage.getItem(SHARING_BLOCKED_KEY) || "{}") || {}; } catch (err) { return {}; }
}
// what was found before, if the playlist has not changed in Spotify since (a list kept from the last connection has no snapshot, so the record stands);
// only copies count now (there is no minimum length any more)
function knownBlock(p) {
  const b = blockRecord()[p.id];
  return b && b.why === "copy" && (!p.snapshot || !b.snap || b.snap === p.snapshot) ? b : null;
}
function rememberBlock(p, why, of) {
  const all = blockRecord();
  if (why) all[p.id] = { snap: p.snapshot || null, why, of: of || "" }; else delete all[p.id];
  try { localStorage.setItem(SHARING_BLOCKED_KEY, JSON.stringify(all)); } catch (err) { /* private browsing: known for this visit only */ }
}
function shortDate(ms) { const d = new Date(ms); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; }
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

// ---------------------------------------------------------------- the DEV menu's owner tools: mood words and reports
// Whether this Spotify account is the owner is the worker's answer to GET /admin/reports (403 for anyone else), asked in developer mode only, once per account,
// and kept (OWNER_KEY in app.js): someone who finds developer mode never sees tools that would only refuse them. The worker checks every change anyway.
const ownerTools = { asking: null, reports: null };
function askOwner() {
  if (ownerTools.asking) return ownerTools.asking;
  if (!devMode() || !token || !me) return Promise.resolve(false);
  ownerTools.asking = (async () => {
    try {
      const data = await sharingFetch("GET", "/admin/reports");
      ownerTools.reports = data.shares || [];
      try { localStorage.setItem(OWNER_KEY, JSON.stringify({ account: me.id, owner: true })); } catch (err) { /* private browsing */ }
    } catch (err) {
      if (err.status === 403) try { localStorage.setItem(OWNER_KEY, JSON.stringify({ account: me.id, owner: false })); } catch (e) { /* private browsing */ }
    } finally { ownerTools.asking = null; }
    renderDevMenuRows();
    return checkOwner();
  })();
  return ownerTools.asking;
}
function ownerKnown() {
  try { const kept = JSON.parse(localStorage.getItem(OWNER_KEY) || "null"); return !!kept && kept.account === localStorage.getItem("spotifyAccount"); } catch (err) { return true; }
}
// the menu just opened: the owner's rows with fresh counts; anyone else's menu is asked about once
function sharingDevMenu() {
  renderDevMenuRows();
  if (checkOwner()) { if (!sharing.library) loadLibrary().then(renderDevMenuRows); askOwner(); }
  else if (!ownerKnown()) askOwner();
}
function renderDevMenuRows() {
  const moods = $("devMenuMoods"), reports = $("devMenuReports");
  if (!moods || !reports) return;
  const mine = checkOwner();
  moods.hidden = reports.hidden = !mine;
  if (!mine) return;
  const hidden = (sharing.moodIndex || []).filter((t) => t.hidden).length;
  $("devMoodsCount").textContent = sharing.library && hidden ? `${hidden} hidden` : "";
  const open = ownerTools.reports && ownerTools.reports.filter((r) => r.hidden !== 2).length;   // hidden by the owner is settled; the rest wait for a look
  $("devReportsCount").textContent = ownerTools.reports ? (open ? `${open} reported` : "None") : "";
}
function sharingDevOpened(id) {
  if (id === "devMoods") { renderDevTags(); loadLibrary(true).then(renderDevTags); }
  else loadDevReports();
}
let devTagFilter = "shown";
function renderDevTags() {
  const box = $("devTagWords");
  if (!box) return;
  box.textContent = "";
  const all = sharing.moodIndex || [];
  const counts = { shown: all.filter((t) => !t.hidden).length, hidden: all.filter((t) => t.hidden).length, all: all.length };
  const filters = feEl("div", { class: "ms-tags" }, ...[["shown", "Shown"], ["hidden", "Hidden"], ["all", "All"]].map(([k, label]) =>
    feEl("button", { type: "button", class: "ms-tag" + (devTagFilter === k ? " ms-on" : ""), onClick: () => { devTagFilter = k; renderDevTags(); } }, `${label} ${counts[k]}`)));
  box.appendChild(filters);
  if (!sharing.library) { box.appendChild(sharing.error ? problemBox(sharing.error, "", [], true) : feEl("p", { class: "muted" }, "Loading...")); return; }
  const words = all.filter((t) => devTagFilter === "all" || (devTagFilter === "hidden") === t.hidden);
  if (!words.length) { box.appendChild(feEl("p", { class: "muted" }, all.length ? "None." : "No mood is in more than one shared playlist yet.")); return; }
  const cloud = feEl("div", { class: "msd-cloud" });
  for (const t of words) {
    cloud.appendChild(feEl("button", { type: "button", class: "msd-word" + (t.hidden ? " msd-hidden" : ""), title: t.hidden ? "Show as a mood" : "Hide",
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
    computeMoodIndex();
    renderDevTags();
  } catch (err) { showNotices([{ text: `Not changed: ${err.message}`, icon: "alert", warn: true, hold: true, transient: true }]); }
}
async function loadDevReports() {
  const box = $("devReportList");
  if (!box) return;
  box.textContent = "Loading...";
  try {
    const data = await sharingFetch("GET", "/admin/reports");
    ownerTools.reports = data.shares;
    renderDevMenuRows();
    box.textContent = "";
    if (!data.shares.length) { box.appendChild(feEl("p", { class: "muted" }, "No reports.")); return; }
    for (const s of data.shares) {
      const state = s.hidden === 1 ? "Hidden after reports" : s.hidden === 2 ? "Hidden by you" : "Shown";
      box.appendChild(feEl("div", { class: "msd-report" },
        feEl("div", { class: "msd-rhead" }, feEl("b", { text: s.name }), feEl("span", { class: "muted" }, ` · ${s.by || "Anonymous"} · ${state}`)),
        ...s.reports.map((r) => feEl("div", { class: "muted" }, `${shortDate(r.at)}: ${r.reason}${r.note ? `. ${r.note}` : ""}`)),
        feEl("div", { class: "row" }, feEl("button", { type: "button", onClick: async () => {
          try { await sharingFetch("POST", "/admin/share/" + s.id, { hidden: !s.hidden }); loadDevReports(); loadLibrary(true); }
          catch (err) { showNotices([{ text: `Not changed: ${err.message}`, icon: "alert", warn: true, hold: true, transient: true }]); }
        } }, s.hidden ? "Show again" : "Hide"))));
    }
  } catch (err) { box.textContent = err.status === 403 ? "Only the owner of the app can see reports." : err.message; }
}

// ---------------------------------------------------------------- wiring
(function wireSharing() {
  startSharingCard();
  if ($("msClose")) $("msClose").addEventListener("click", () => closeSharing());
  watchKeyboard();
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !$("msOverlay") || $("msOverlay").hidden || document.querySelector(".fe-overlay")) return;
    if ($("msSheet")) closeSheet(); else if (sharing.flow) flowBack(); else if (sharing.detail) closeDetail();   // a page of its own now (Arc's home): Escape does not leave it
  });
})();
