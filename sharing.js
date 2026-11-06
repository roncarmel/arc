// sharing.js: Music sharing. People share their own playlists (with a few words on the music and how they use it) and copy each other's into
// their own Spotify. Opened from Developer options until it is ready for the app menu (decided by Ron, 2026-11-06).
// The library lives in a Cloudflare Worker with a D1 database (cloudflare/music-sharing). It keeps only what people write, the songs as Spotify IDs
// and ISRCs, and a short summary made on the sharer's device; who someone is comes from their Spotify sign-in, checked by the worker.
// The page does the rest itself: search, sorting, tags (words that turn up in more than one description) and overlap with the person's recipes.
// Classic script, loaded after app.js; it uses app.js and editor.js names at run time.

const SHARING_URL = "https://music-sharing.roncarmel.workers.dev";
const SHARE_TEXT_MIN = 40, SHARE_TEXT_MAX = 400, SHARE_MIN_MS = 60 * 60 * 1000;
const SHARING_COPIES_KEY = "sharingCopies";   // { shared playlist id: the person's copy's Spotify id }
const SHARING_SHOWN_KEY = "sharingShownAs";   // { mode: "spotify" | "custom" | "anon", name }
const OVERLAP_MIN_SONGS = 100, OVERLAP_MIN_PLAYLISTS = 2, OVERLAP_MIN_SHARES = 3;   // when "already in your recipes" is worth showing
const OVERLAP_READ_GAP_MS = 2000;   // reading recipe playlists the browser does not have yet: one request every 2 seconds
const TAGS_STEP = 10;

// Words that are never tags (ordinary English), and words this app's people use everywhere, which start hidden (the owner can show one).
const TAG_STOP = new Set(("a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each even ever every few for from "
  + "further get gets got had has have having he her here hers him his how i if in into is it its itself just less lot lots me more most much my myself no nor not now of off often on once one only or other our ours "
  + "out over own quite rather really same she should so some such than that the their theirs them then there these they this those through to too under until up us use used uses using very was we were what when "
  + "where which while who whom why will with without would you your yours yourself into onto upon via etc i'm it's don't doesn't isn't can't i've i'll").split(" "));
const TAG_COMMON = new Set("music musical playlist playlists session sessions ceremony ceremonies people person song songs track tracks time times like feel feels feeling something things thing way well good great part parts start end".split(" "));
const TAG_NEGATION = new Set(["no", "not", "without", "never", "nothing", "none"]);

const sharing = {
  tab: "find", detail: null, library: null, libraryAt: 0, loading: false, error: "",
  search: "", sort: "newest", hideAdded: true, tags: new Set(), tagsShown: TAGS_STEP,
  mine: null, mineError: "", picks: {}, shownAs: null, applying: false, adding: new Set(), addErrors: {},
  overlap: null, overlapShown: null, reading: false, readStop: false, showOverlapSongs: false,
};

// ---------------------------------------------------------------- talking to the worker
async function sharingFetch(method, path, json, retried = false) {
  const headers = {};
  if (json) headers["Content-Type"] = "application/json";
  if (token && path !== "/library") headers.Authorization = "Bearer " + token;   // the library is public: reading it sends no sign-in
  let response;
  try {
    response = await fetchWithAnswerLimit(SHARING_URL + path, { method, headers, body: json ? JSON.stringify(json) : undefined });
  } catch (err) { throw new Error("Music sharing could not be reached. Check your connection and try again."); }
  let data = {};
  try { data = await response.json(); } catch (err) { /* no body */ }
  if (response.status === 401 && data.code === "signin" && !retried && await renewSignIn()) return sharingFetch(method, path, json, true);
  if (!response.ok) { const e = new Error(data.error || `Music sharing answered ${response.status}.`); e.code = data.code || ""; e.status = response.status; throw e; }
  return data;
}

async function loadLibrary(force = false) {
  if (sharing.loading || (!force && sharing.library && Date.now() - sharing.libraryAt < 60000)) return;
  sharing.loading = true;
  sharing.error = "";
  renderSharing();
  try {
    sharing.library = await sharingFetch("GET", "/library");
    sharing.libraryAt = Date.now();
    computeTagIndex();
  } catch (err) { sharing.error = err.message; }
  sharing.loading = false;
  renderSharing();
  if (sharing.library) startOverlap();
}

async function loadMine() {
  if (!token || !me) return;
  sharing.mineError = "";
  try {
    sharing.mine = (await sharingFetch("GET", "/mine")).shares;
    for (const s of sharing.mine) {
      const pick = sharing.picks[s.playlist];
      if (!pick || !pick.touched) sharing.picks[s.playlist] = { on: true, music: s.music, use: s.use, shared: s, touched: false, update: false };
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
  const avg = Math.max(1, Math.round(s.avgMs / 60000));
  let text = `${songCountText(s.count)}, ${lengthText(s.ms / 60000)}. Songs are ${avg} min on average.`;
  if (s.artists && s.artists.length) text += ` Artists heard most: ${s.artists.join(", ")}.`;
  return text;
}
function cleanSpotifyDescription(text) {
  // Spotify gives descriptions with HTML entities and links; the app's own markers and recipe saves are not offered as text
  if (!text || text.startsWith(APP_MARKER)) return "";
  const box = document.createElement("textarea");
  box.innerHTML = String(text).replace(/<[^>]*>/g, "");
  return box.value.trim().slice(0, SHARE_TEXT_MAX);
}

// ---------------------------------------------------------------- tags: words that turn up in more than one shared playlist
function tagWords(text) {
  // the words and two-word phrases of one description, without ordinary words or words right after no, not or without
  const words = String(text || "").toLowerCase().replace(/[’']/g, "'").split(/[^\p{L}\p{N}'-]+/u).map((w) => w.replace(/^['-]+|['-]+$/g, "")).filter(Boolean);
  const found = new Set();
  let prev = null;   // the previous word that counts, for phrases
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const negated = i > 0 && TAG_NEGATION.has(words[i - 1]);
    if (TAG_STOP.has(w) || TAG_NEGATION.has(w) || /^\d+$/.test(w) || w.length < 3) { prev = null; continue; }
    if (negated) { prev = null; continue; }
    found.add(w);
    if (prev) found.add(prev + " " + w);
    prev = w;
  }
  return found;
}
function computeTagIndex() {
  const lib = sharing.library;
  if (!lib) return;
  const counts = new Map();   // word: set of shared playlist ids
  const perShare = new Map();
  for (const s of lib.shares) {
    const words = tagWords(`${s.music} ${s.use}`);
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
    .map(([word, ids]) => ({ word, ids, count: ids.size, hidden: word in overrides ? overrides[word] === 1 : TAG_COMMON.has(word) || word.split(" ").some((p) => TAG_COMMON.has(p)) }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
  // a phrase that always comes with the same playlists as its words adds nothing; keep it only when it is the more telling one
  sharing.tagIndex = sharing.tagIndex.filter((t) => !t.word.includes(" ") || t.count >= 2);
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
    made = await spotifyRequest("POST", "/me/playlists", { json: { name: s.name, public: false, description: s.music } });
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
    sharing.addErrors[s.id] = `Not added: ${String(err && err.message || err).replace(/\.$/, "")}. Try again.`;
  }
  sharing.adding.delete(s.id);
  if (made) {
    rememberCopy(s.id, made.id);
    try { await loadMyPlaylists(); }
    catch (err) { playlists.push({ id: made.id, name: s.name, owner: me.id, collaborative: false, image: null, cover: null, count: s.songs.length, description: s.music, snapshot: null, madeByApp: false, save: null, isSave: false }); keepPlaylists(); }
  }
  renderSharing();
}

// ---------------------------------------------------------------- the popup
function openSharing(tab = "find") {
  if (typeof closeInfo === "function") closeInfo(true);
  sharing.tab = tab;
  sharing.detail = null;
  sharing.overlapShown = sharing.overlap;
  $("msOverlay").hidden = false;
  document.body.style.overflow = "hidden";
  renderSharing();
  $("msDialog").focus({ preventScroll: true });
  loadLibrary();
  if (tab === "share") loadMine();
}
async function closeSharing() {
  if (!(await settlePending())) return;
  sharing.readStop = true;
  $("msOverlay").hidden = true;
  if (!document.querySelector(".app-overlay:not([hidden])")) document.body.style.overflow = "";
  if ($("feAppMenuButton")) $("feAppMenuButton").focus();
}
async function switchTab(tab) {
  if (tab === sharing.tab && !sharing.detail) return;
  if (sharing.tab === "share" && !(await settlePending())) return;
  sharing.tab = tab;
  sharing.detail = null;
  if (tab === "find") sharing.overlapShown = sharing.overlap;
  renderSharing();
  $("msBody").scrollTop = 0;
  if (tab === "share") loadMine();
}
async function settlePending() {
  // leaving Share yours with changes not yet applied asks first, so nothing is lost without a word
  if (sharing.tab !== "share" || !pendingChanges().total) return true;
  const answer = await askSyncChoice("Apply your changes?", "Some playlists are ticked or unticked but not shared or stopped yet.",
    [{ label: "Apply", value: "apply" }, { label: "Discard", value: "discard" }], { required: true });
  if (answer === "apply") await applyShares();
  else resetPicks();
  return true;
}

function renderSharing() {
  const body = $("msBody");
  if (!body || $("msOverlay").hidden) return;
  const head = $("msHead");
  head.textContent = "";
  if (sharing.detail) head.appendChild(feEl("button", { type: "button", class: "ms-back", "aria-label": "Back", onClick: () => { sharing.detail = null; renderSharing(); } }, feIcon("back")));
  else head.appendChild(feIcon("swap"));
  head.appendChild(feEl("span", { text: "Music sharing" }));
  const keepScroll = body.scrollTop;
  body.textContent = "";
  $("msFoot").hidden = true;
  if (sharing.detail) { renderDetail(body); return; }
  body.appendChild(feEl("div", { class: "ms-tabs", role: "tablist" },
    feEl("button", { type: "button", role: "tab", "aria-selected": String(sharing.tab === "find"), class: sharing.tab === "find" ? "ms-on" : "", onClick: () => switchTab("find") }, "Find playlists"),
    feEl("button", { type: "button", role: "tab", "aria-selected": String(sharing.tab === "share"), class: sharing.tab === "share" ? "ms-on" : "", onClick: () => switchTab("share") }, "Share yours")));
  if (sharing.tab === "find") renderFind(body); else renderShareYours(body);
  body.scrollTop = keepScroll;
}

// ---------------------------------------------------------------- Find playlists
function renderFind(body) {
  const search = feEl("input", { type: "search", class: "ms-search-input", id: "msSearch", placeholder: "Keyword search", "aria-label": "Keyword search", value: sharing.search });
  search.addEventListener("input", () => { sharing.search = search.value; renderResults(); });
  body.appendChild(feEl("label", { class: "ms-search" }, feIcon("search"), search));
  body.appendChild(feEl("div", { id: "msTags", class: "ms-tags" }));
  const sort = feEl("select", { id: "msSort", class: "ms-sort", "aria-label": "Sort" });
  const usable = sharing.overlapShown && sharing.overlapShown.usable;
  const choices = [["newest", "Newest"], ...(usable ? [["most", "Most overlap"], ["least", "Least overlap"]] : []), ["longest", "Longest"]];
  if (!choices.some(([v]) => v === sharing.sort)) sharing.sort = "newest";
  for (const [value, label] of choices) sort.appendChild(feEl("option", { value, selected: value === sharing.sort }, label));
  sort.addEventListener("change", () => { sharing.sort = sort.value; sharing.overlapShown = sharing.overlap; renderResults(); });
  const hide = feEl("input", { type: "checkbox", class: "ms-switch", checked: sharing.hideAdded, "aria-label": "Hide added" });
  hide.addEventListener("change", () => { sharing.hideAdded = hide.checked; renderResults(); });
  body.appendChild(feEl("div", { class: "ms-bar" }, feEl("label", { class: "ms-sortwrap" }, sort), feEl("label", { class: "ms-toggle" }, "Hide added", hide)));
  body.appendChild(feEl("div", { id: "msResults" }));
  renderResults();
}
function matchesSearch(s, q) {
  if (!q) return true;
  const hay = `${s.name} ${s.by || ""} ${s.music} ${s.use} ${(s.artists || []).join(" ")}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}
function renderTags() {
  const box = $("msTags");
  if (!box) return;
  box.textContent = "";
  const tags = visibleTags();
  if (!tags.length) return;
  const chosen = tags.filter((t) => sharing.tags.has(t.word));
  const rest = tags.filter((t) => !sharing.tags.has(t.word)).slice(0, Math.max(0, sharing.tagsShown - chosen.length));
  for (const t of [...chosen, ...rest]) {
    box.appendChild(feEl("button", { type: "button", class: "ms-tag" + (sharing.tags.has(t.word) ? " ms-on" : ""), "aria-pressed": String(sharing.tags.has(t.word)),
      onClick: () => { if (sharing.tags.has(t.word)) sharing.tags.delete(t.word); else sharing.tags.add(t.word); renderResults(); } }, t.word));
  }
  if (chosen.length + rest.length < tags.length) box.appendChild(feEl("button", { type: "button", class: "ms-tag ms-more", onClick: () => { sharing.tagsShown += TAGS_STEP; renderTags(); } }, "More tags..."));
}
function renderResults() {
  renderTags();
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
  const tagSets = (sharing.tagIndex || []).filter((t) => sharing.tags.has(t.word)).map((t) => t.ids);
  const ov = sharing.overlapShown && sharing.overlapShown.usable && (sharing.sort === "most" || sharing.sort === "least") ? sharing.overlapShown : null;
  let list = sharing.library.shares.filter((s) => matchesSearch(s, sharing.search) && tagSets.every((ids) => ids.has(s.id)) && !(sharing.hideAdded && isAdded(s)));
  if (sharing.sort === "longest") list = list.slice().sort((a, b) => b.ms - a.ms);
  else if (ov) list = list.slice().sort((a, b) => ((ov.per[b.id] || {}).pct || 0) - ((ov.per[a.id] || {}).pct || 0)) ;
  if (ov && sharing.sort === "least") list.reverse();
  if (!sharing.library.shares.length) { box.appendChild(feEl("p", { class: "ms-note" }, "Nothing is shared yet. Be the first: share yours.")); return; }
  if (!list.length) { box.appendChild(feEl("p", { class: "ms-note" }, "No playlists match.")); return; }
  const shownOverlap = (sharing.sort === "most" || sharing.sort === "least") && sharing.overlap && sharing.overlap.usable ? sharing.overlap : null;
  for (const s of list) box.appendChild(shareRow(s, shownOverlap));
}
function shareCoverEl(s, cls = "ms-cover") {
  return s.cover ? feEl("img", { class: cls, src: s.cover, alt: "", loading: "lazy" }) : feEl("span", { class: cls + " ms-nocover" }, feIcon("notes"));
}
function addButton(s, big = false) {
  if (sharing.adding.has(s.id)) return feEl("button", { type: "button", class: big ? "ms-addbig ms-busy" : "ms-add ms-busy", disabled: true }, "Adding...");
  if (isAdded(s)) return feEl("button", { type: "button", class: big ? "ms-addbig ms-done" : "ms-add ms-done", disabled: true }, feIcon("check"), "Added");
  return feEl("button", { type: "button", class: big ? "ms-addbig" : "ms-add", disabled: connection !== "ready", onClick: (e) => { e.stopPropagation(); addShared(s); } }, big ? feIcon("plus") : null, big ? "Add to my Spotify" : "Add");
}
function shareRow(s, ov) {
  const per = ov && ov.per[s.id];
  const row = feEl("div", { class: "ms-row", role: "button", tabindex: "0", onClick: () => { sharing.detail = s.id; sharing.showOverlapSongs = false; renderSharing(); $("msBody").scrollTop = 0; } },
    shareCoverEl(s),
    feEl("div", { class: "ms-text" },
      feEl("div", { class: "ms-name", text: s.name }),
      feEl("div", { class: "ms-sub" }, `${s.by || "Anonymous"} · ${lengthText(s.ms / 60000)}`),
      feEl("div", { class: "ms-desc" }, s.music),
      per ? feEl("div", { class: "ms-ov" }, `${per.pct}% already in your recipes`) : null,
      sharing.addErrors[s.id] ? feEl("div", { class: "ms-error" }, sharing.addErrors[s.id]) : null),
    addButton(s));
  row.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === row) { e.preventDefault(); row.click(); } });
  return row;
}
function renderDetail(body) {
  const s = sharing.library && sharing.library.shares.find((x) => x.id === sharing.detail);
  if (!s) { sharing.detail = null; renderSharing(); return; }
  body.appendChild(feEl("div", { class: "ms-hero" }, shareCoverEl(s, "ms-cover ms-cover-big"),
    feEl("div", {}, feEl("h3", { text: s.name }), feEl("div", { class: "ms-sub" }, s.by ? `Shared by ${s.by}` : "Shared anonymously"), feEl("div", { class: "ms-sub" }, `${songCountText(s.count)} · ${lengthText(s.ms / 60000)}`))));
  body.appendChild(feEl("div", { class: "ms-actions" }, addButton(s, true)));
  if (sharing.addErrors[s.id]) body.appendChild(feEl("p", { class: "ms-error" }, sharing.addErrors[s.id]));
  body.appendChild(feEl("div", { class: "ms-sec" }, "The music"));
  body.appendChild(feEl("p", { class: "ms-long" }, s.music));
  body.appendChild(feEl("div", { class: "ms-sec" }, "How I use it"));
  body.appendChild(feEl("p", { class: "ms-long" }, s.use));
  body.appendChild(feEl("div", { class: "ms-facts" }, feEl("div", { class: "ms-facts-h" }, feIcon("notes"), "The songs"), shareFacts(s)));
  const ov = sharing.overlap && sharing.overlap.playlists ? sharing.overlap.per[s.id] : null;
  if (ov && ov.same) {
    const box = feEl("div", { class: "ms-overlap" }, feIcon("overlap"), feEl("span", {}, `${ov.same === 1 ? "1 of these songs" : `${ov.same} of these songs`} (${ov.pct}%) ${ov.same === 1 ? "is" : "are"} already in your recipes. `,
      feEl("button", { type: "button", class: "linklike", onClick: () => { sharing.showOverlapSongs = !sharing.showOverlapSongs; renderSharing(); } }, sharing.showOverlapSongs ? "Hide them" : "Show them")));
    body.appendChild(box);
    if (sharing.showOverlapSongs) {
      const labels = sharing.overlap.labels;
      body.appendChild(feEl("ul", { class: "ms-songs" }, ...ov.songs.map(([id, isrc]) => feEl("li", {}, labels.get("isrc:" + isrc) || labels.get("spotify:track:" + id) || "A song"))));
    }
  }
  body.appendChild(feEl("div", { class: "ms-foot-links" }, feEl("button", { type: "button", class: "linklike ms-report", onClick: () => reportShare(s) }, feIcon("flag"), "Report")));
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

// ---------------------------------------------------------------- Share yours
function shareCandidates() {
  if (!me) return [];
  const copies = new Set(Object.values(sharingCopies()));
  return playlists.filter((p) => p.owner === me.id && !p.isSave && !p.madeByApp).map((p) => ({ p, copy: copies.has(p.id) }));
}
function pickFor(p) {
  if (!sharing.picks[p.id]) sharing.picks[p.id] = { on: false, music: "", use: "", shared: null, touched: false, update: false };
  return sharing.picks[p.id];
}
function sharedFor(p) { return sharing.mine ? sharing.mine.find((s) => s.playlist === p.id) || null : null; }
function pickState(p, pick) {
  // what a row says, and whether it is ready to share
  const shared = sharedFor(p);
  if (pick.checking) return { text: "Checking its length...", ready: false };
  if (pick.short) return { text: "Under an hour, so it cannot be shared.", ready: false, cls: "ms-dis" };
  if (pick.error) return { text: pick.error, ready: false, cls: "ms-need" };
  const m = pick.music.trim().length, u = pick.use.trim().length;
  if (pick.on) {
    if (m < SHARE_TEXT_MIN && u < SHARE_TEXT_MIN) return { text: "Needs a few words on the music and how you use it", ready: false, cls: "ms-need" };
    if (m < SHARE_TEXT_MIN) return { text: "Needs more on the music", ready: false, cls: "ms-need" };
    if (u < SHARE_TEXT_MIN) return { text: "Needs more on how you use it", ready: false, cls: "ms-need" };
  }
  if (shared && !pick.on) return { text: "Will stop being shared", ready: true, cls: "ms-need" };
  if (shared && (pick.update || pick.music.trim() !== shared.music || pick.use.trim() !== shared.use)) return { text: "Changes ready", ready: true, cls: "ms-ok" };
  if (shared && p.snapshot && shared.snapshot && p.snapshot !== shared.snapshot) return { text: `Shared ${shortDate(shared.sharedAt)}. Changed in Spotify since then.`, ready: true, offerUpdate: true };
  if (shared) return { text: `Shared ${shortDate(shared.sharedAt)}${shared.hidden ? ", hidden after reports" : ""}`, ready: true };
  if (pick.on) return { text: "Ready", ready: true, cls: "ms-ok" };
  return { text: "", ready: false };
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
    else if (shared && pick.on && state.ready && (pick.update || pick.music.trim() !== shared.music || pick.use.trim() !== shared.use || sharing.shownChanged)) out.update.push(p);
  }
  out.total = out.share.length + out.update.length + out.stop.length;
  return out;
}
function resetPicks() {
  for (const id of Object.keys(sharing.picks)) {
    const shared = sharing.mine && sharing.mine.find((s) => s.playlist === id);
    sharing.picks[id] = shared ? { on: true, music: shared.music, use: shared.use, shared, touched: false, update: false } : { on: false, music: "", use: "", shared: null, touched: false, update: false };
  }
  sharing.shownChanged = false;
}
function renderShareYours(body) {
  if (connection !== "ready" || !me) { body.appendChild(feEl("p", { class: "ms-note" }, "Connect to Spotify to share your playlists.")); return; }
  body.appendChild(feEl("p", { class: "ms-intro" }, `Tick the playlists you'd like to share. Each needs a few words on the music and how you use it, and at least an hour of songs.`));
  if (sharing.mineError) body.appendChild(feEl("p", { class: "ms-error" }, sharing.mineError));
  if (!sharing.mine && !sharing.mineError) { body.appendChild(feEl("p", { class: "ms-note" }, "Loading...")); return; }
  const list = feEl("div", { class: "ms-share-list" });
  const rows = shareCandidates().sort((a, b) => (a.copy - b.copy) || (!!sharedFor(b.p) - !!sharedFor(a.p)));
  for (const { p, copy } of rows) list.appendChild(shareYoursRow(p, copy));
  if (!rows.length) list.appendChild(feEl("p", { class: "ms-note" }, "No playlists of your own found."));
  body.appendChild(list);
  renderShareFoot();
}
function shareYoursRow(p, copy) {
  const pick = pickFor(p);
  const row = feEl("div", { class: "ms-srow", id: "msRow-" + p.id });
  const box = feEl("input", { type: "checkbox", class: "ms-check", checked: !copy && pick.on, disabled: copy || pick.short, "aria-label": p.name });
  box.addEventListener("change", () => toggleShare(p, box.checked));
  const cover = p.image ? feEl("img", { class: "ms-cover", src: p.image, alt: "" }) : feEl("span", { class: "ms-cover ms-nocover" }, feIcon("notes"));
  const text = feEl("div", { class: "ms-text" }, feEl("div", { class: "ms-name" + (copy ? " ms-dim" : ""), text: p.name }),
    feEl("div", { class: "ms-sub" }, p.count != null ? songCountText(p.count) : ""));
  if (copy) text.appendChild(feEl("div", { class: "ms-state ms-dis" }, "Added from Music sharing, so it cannot be shared again."));
  else {
    const state = pickState(p, pick);
    const line = feEl("div", { class: "ms-state " + (state.cls || ""), id: "msState-" + p.id }, state.text);
    if (state.offerUpdate) line.appendChild(feEl("button", { type: "button", class: "linklike ms-inline", onClick: () => { pick.update = true; pick.touched = true; refreshRow(p); } }, "Update"));
    text.appendChild(line);
    if (pick.on && !pick.short && !pick.checking) text.appendChild(shareFields(p, pick));
  }
  row.append(box, cover, text);
  return row;
}
function shareFields(p, pick) {
  const field = (key, label, hint) => {
    const ta = feEl("textarea", { class: "ms-ta", rows: "3", maxlength: String(SHARE_TEXT_MAX), "aria-label": label });
    ta.value = pick[key];
    const meter = feEl("div", { class: "ms-meter" });
    const show = () => { const n = ta.value.trim().length; meter.textContent = n < SHARE_TEXT_MIN ? `${n}, at least ${SHARE_TEXT_MIN}` : `${n} of ${SHARE_TEXT_MAX}`; meter.classList.toggle("ms-short", n < SHARE_TEXT_MIN); };
    ta.addEventListener("input", () => { pick[key] = ta.value; pick.touched = true; show(); refreshState(p); });
    show();
    return feEl("div", { class: "ms-field" }, feEl("label", {}, feEl("b", {}, label), hint ? feEl("span", { class: "ms-hint" }, " · " + hint) : null), ta, meter);
  };
  return feEl("div", { class: "ms-fields" },
    field("music", "The music", pick.fromSpotify ? "from its Spotify description" : "What kind of music is it?"),
    field("use", "How I use it", "How and where do you use it in a ceremony?"),
    feEl("div", { class: "ms-mini" }, feIcon("notes"), "The app adds a line about the songs: how many, how long, and the artists heard most."));
}
function refreshState(p) {
  const pick = pickFor(p), state = pickState(p, pick), line = $("msState-" + p.id);
  if (line) { line.className = "ms-state " + (state.cls || ""); line.textContent = state.text; }
  renderShareFoot();
}
function refreshRow(p) {
  const old = $("msRow-" + p.id);
  if (old) old.replaceWith(shareYoursRow(p, false));
  renderShareFoot();
}
async function toggleShare(p, on) {
  const pick = pickFor(p);
  pick.on = on;
  pick.touched = true;
  pick.error = "";
  if (on && !sharedFor(p)) {
    if (!pick.music) { const d = cleanSpotifyDescription(p.description); if (d) { pick.music = d; pick.fromSpotify = true; } }
    pick.checking = true;
    refreshRow(p);
    try {
      const tracks = await loadTracks(p.id);
      pick.ms = tracks.reduce((n, t) => n + (t.ms || 0), 0);
      if (pick.ms < SHARE_MIN_MS) { pick.short = true; pick.on = false; }
    } catch (err) { pick.error = `Its songs could not be read: ${String(err.message || err).replace(/\.$/, "")}.`; pick.on = false; }
    pick.checking = false;
  }
  refreshRow(p);
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
  const keep = () => { try { localStorage.setItem(SHARING_SHOWN_KEY, JSON.stringify(sharing.shownAs)); } catch (err) { /* private browsing */ } sharing.shownChanged = !!(sharing.mine && sharing.mine.length); };
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
      const cover = p.cover && !/mosaic\.scdn\.co/.test(p.cover) ? p.cover : null;
      await sharingFetch("POST", "/share", { playlist: p.id, snapshot: p.snapshot || null, name: p.name, by, music: pick.music.trim(), use: pick.use.trim(), cover, songs, ms, artists: topArtists(tracks) });
      pick.touched = false;
      pick.update = false;
    } catch (err) {
      pick.error = err.code === "copy" ? err.message + " Copies cannot be shared again." : err.message;
    }
  }
  sharing.applying = false;
  sharing.shownChanged = false;
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
  const open = $("devOpenSharing");
  if (open) open.addEventListener("click", () => openSharing("find"));
  if ($("msClose")) $("msClose").addEventListener("click", () => closeSharing());
  if ($("msOverlay")) $("msOverlay").addEventListener("click", (e) => { if (e.target === $("msOverlay")) closeSharing(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !$("msOverlay") || $("msOverlay").hidden || document.querySelector(".fe-overlay")) return;
    if (sharing.detail) { sharing.detail = null; renderSharing(); } else closeSharing();
  });
})();
