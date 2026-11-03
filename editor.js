// editor.js: the visual editor for formats.
//
// People edit a list of formats on screen. Every change is written back into the hidden formats text
// ($("formats")) in the form the engine reads, and the page is told with an ordinary "input" event, so
// everything else (previews, backups, saving) works on that text exactly as before.
// formats.js does the reading and writing of that text. This file draws and handles the screen.

// The editor has one color, the theme's accent (--button), and a deeper shade of it (--accent-deep) for the second stripe of a mix.
const FE_ROW_HEIGHT = 52;
const FE_ROW_GAP = 6;

const editor = {
  model: null,        // { formats: [...] }, or null when the saved text could not be read
  broken: "",         // why it could not be read
  activeId: null,
  panel: null,        // { id, mode } mode: "menu" | "mix" | "list-a" | "list-b"
  cardMenu: false,
  renaming: null,     // the format whose name is being edited in its tab
  internal: false,    // true while the editor itself is writing the text
  drag: null,
  search: "",
  gapPanel: null,     // the silence (by its place, 1 to the number of segments) whose card is open
  appMenu: false,     // the app-level menu beside the format tabs
  hover: null,        // the row, silence or bar piece under the pointer
};

// ---------------------------------------------------------------- small helpers
const FE_ICONS = {
  tour: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M10 8.5l5 3.5-5 3.5z"/></svg>',
  grip: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="5" cy="3" r="1.5" fill="currentColor"/><circle cx="11" cy="3" r="1.5" fill="currentColor"/><circle cx="5" cy="8" r="1.5" fill="currentColor"/><circle cx="11" cy="8" r="1.5" fill="currentColor"/><circle cx="5" cy="13" r="1.5" fill="currentColor"/><circle cx="11" cy="13" r="1.5" fill="currentColor"/></svg>',
  dots: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
  chevron: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  note: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>',
  mute: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l4 6M21 9l-4 6"/></svg>',
  copy: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a1 1 0 0 1 1-1h9"/></svg>',
  trash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12"/></svg>',
  sliders: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 8h10M18 8h2M4 16h2M10 16h10"/><circle cx="16" cy="8" r="2"/><circle cx="8" cy="16" r="2"/></svg>',
  pencil: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>',
  link: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  retry: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/></svg>',
  cloud: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 19h9a4.2 4.2 0 0 0 .5-8.37A5.6 5.6 0 0 0 6.3 11.7 3.7 3.7 0 0 0 7.5 19z"/><path d="M12 16.5v-5M9.7 13.7 12 11.4l2.3 2.3"/></svg>',
  device: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  download: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>',
  restore: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V5M7 9l5-5 5 5M5 20h14"/></svg>',
  unplug: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/><path d="M4 4l16 16"/></svg>',
  lock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  flag: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  chat: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/></svg>',
  info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  key: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/></svg>',
  check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  reset: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/></svg>',
  clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  warn: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.1"/></svg>',
};

function feEl(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "style") node.setAttribute("style", value);
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function feIcon(name) {
  const holder = document.createElement("span");
  holder.className = "fe-icon";
  holder.innerHTML = FE_ICONS[name];
  return holder;
}

// diagonal stripes running from lower left to upper right; each stripe is as thick as its share of the mix
function feStripes(shareA, period) {
  const a = Math.max(1.5, Math.round(period * shareA * 10) / 10);
  return `repeating-linear-gradient(135deg, var(--button) 0, var(--button) ${a}px, var(--accent-deep) ${a}px, var(--accent-deep) ${period}px)`;
}

// Point at (or tap) a row or a piece of the bar, and the other one lights up.
function applyHighlight() {
  const id = editor.hover;   // only while the pointer is over a row, a silence or a piece of the bar; nothing stays selected
  const bar = $("feBar");
  if (bar) bar.classList.toggle("fe-hasHl", !!id);
  document.querySelectorAll("#feBar .fe-piece, #feRows .fe-row, #feRows .fe-tag").forEach((el) => {
    el.classList.toggle("fe-hl", !!id && el.getAttribute("data-id") === id);
  });
}

function activeFormat() {
  return editor.model ? editor.model.formats.find((f) => f.id === editor.activeId) || null : null;
}

// ---------------------------------------------------------------- the playlists people can choose from
function readablePlaylists() {
  // playlists the app is allowed to read, leaving out the ones this app made (marked when created, or named like a format's playlists), since those may be removed later
  const titles = editor.model ? editor.model.formats.map((f) => nameFromTitle(f.title)) : [];
  const patterns = titles.map((name) => {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{n\\\}/g, "\\d+").replace(/\\\{letter\\\}/g, "[a-z]+");
    return new RegExp("^" + esc + "$", "i");
  });
  return playlists.filter((p) => (p.owner === (me && me.id) || p.collaborative) && !p.madeByApp && !p.isSave && !patterns.some((re) => re.test(p.name)));
}

function playlistInfo(name) {
  if (!name) return null;
  const key = normName(name);
  return playlists.find((p) => normName(p.name) === key) || null;
}

function playlistSub(name) {
  if (!name) return "";
  const info = playlistInfo(name);
  if (!info) return playlists.length ? "Not found in your playlists" : "";
  return typeof info.count === "number" ? `${info.count} song${info.count === 1 ? "" : "s"}` : "";
}

function coverEl(name, size, extraClass) {
  const info = playlistInfo(name);
  const box = feEl("span", { class: "fe-cover " + (extraClass || ""), style: `width:${size}px;height:${size}px` });
  if (info && info.image) box.appendChild(feEl("img", { src: info.image, alt: "", width: size, height: size, loading: "lazy" }));
  else box.appendChild(feIcon("note"));
  return box;
}

// ---------------------------------------------------------------- writing changes back
// ---------------------------------------------------------------- the size limit
// A format has to fit in the description of a Spotify playlist (SAVE_LIMIT characters), in both backup modes, so that a format that works in one works in the other.
// Whatever is done to a format that would make its save longer than that is not done: the format goes back to how it was, and a note says why. Making a format
// shorter is always allowed, which is how one that is already too long gets back under the limit.
const SIZE_MESSAGE = "This recipe has reached its size limit. Remove a segment or a mix to make room.";
const formatSnapshots = new Map();   // a format's id -> the format as last accepted, and the length of its save

function copyItems(items) {
  return items.map((it) => ({ id: it.id, kind: it.kind, minutes: it.minutes, lists: it.lists.map((l) => ({ ...l })) }));
}

function snapshotFormats(model) {
  formatSnapshots.clear();
  for (const f of model.formats) formatSnapshots.set(f.id, { title: f.title, gap: f.gap, gaps: (f.gaps || []).slice(), lead: f.lead, rev: f.rev, modified: f.modified, items: copyItems(f.items), length: saveLength(f) });
}

function restoreFormat(f, s) {
  f.title = s.title; f.gap = s.gap; f.gaps = s.gaps.slice(); f.lead = s.lead; f.rev = s.rev; f.modified = s.modified; f.items = copyItems(s.items);
  ensureGaps(f);
}

// Would one more segment, or one more playlist in a segment's mix, push the format past the limit?
function noRoomForSegment(f) {
  const trial = { ...f, gaps: f.gaps.slice(), items: copyItems(f.items).concat([{ id: "trial", kind: "seg", minutes: 20, lists: [{ name: "", weight: 1 }] }]) };
  trial.gaps.push(undefined);
  return saveLength(trial) > SAVE_LIMIT;
}

function noRoomForMix(f, item) {
  const trial = { ...f, items: copyItems(f.items).map((it) => (it.id === item.id ? { ...it, lists: it.lists.concat([{ name: "", weight: 50 }]) } : it)) };
  return saveLength(trial) > SAVE_LIMIT;
}

function commit() {
  editor.refused = false;
  if (!editor.healing) { notices.lastEditAt = Date.now(); notices.held = null; }   // notices wait while the person is editing, and what was offered after an earlier action goes
  for (const f of editor.model.formats) {
    const before = formatSnapshots.get(f.id);
    if (!before || FORMAT_SIGNATURES.get(f) === formatSignature(f)) continue;   // new, or not changed by this edit
    const length = saveLength(f);
    if (length > SAVE_LIMIT && length > before.length) { restoreFormat(f, before); editor.refused = true; }
  }
  placeFormats(editor.model.formats);   // a new format goes last
  touchFormats(editor.model);   // a format whose content changed gets its next revision number and its edit time
  const text = modelToText(editor.model);
  editor.internal = true;
  $("formats").value = text;
  $("formats").dispatchEvent(new Event("input", { bubbles: true }));
  editor.internal = false;
  snapshotFormats(editor.model);
  if (typeof scheduleSpotifySave === "function") scheduleSpotifySave();
}

// A playlist in a format is known by its Spotify ID, and its name is kept up to date from it, so renaming a playlist in Spotify does not break the format.
// A playlist without an ID yet (a format written by hand, or from before IDs) is given one when exactly one playlist of yours has that name;
// one whose ID is no longer among your playlists (deleted and made again) is found again by its name. Returns whether anything changed.
function syncPlaylistRefs() {
  if (!editor.model || !playlists.length) return false;
  const byId = new Map(playlists.map((p) => [p.id, p]));
  const readable = readablePlaylists();
  let changed = false;
  for (const f of editor.model.formats) {
    for (const item of f.items) {
      for (const l of item.lists) {
        const known = l.id && byId.get(l.id);
        if (known) {
          if (normName(known.name) !== normName(l.name)) { l.name = known.name; changed = true; }   // a real rename, not a difference in capitals or spacing
          continue;
        }
        if (!l.name) continue;
        const same = readable.filter((p) => normName(p.name) === normName(l.name));
        if (same.length === 1 && l.id !== same[0].id) { l.id = same[0].id; changed = true; }
      }
    }
  }
  return changed;
}

// Saves the text after playlist IDs were added or a renamed playlist's name was brought up to date. That is not an edit of the formats, so a backup that was
// current stays current.
function commitHealed() {
  const wasCurrent = typeof backupState === "function" && backupState().kind === "current";
  rememberFormats(editor.model);   // IDs and renamed names filled in by the app are not an edit, so they do not count as a new revision
  editor.healing = true;
  try { commit(); } finally { editor.healing = false; }
  if (wasCurrent) localStorage.setItem("lastBackupText", $("formats").value);
  if (typeof refreshBackupStatus === "function") refreshBackupStatus();
}

// ---------------------------------------------------------------- formats coming from Spotify, and questions about them
// A format read from its backup in Spotify replaces the one here with that ID, or is added. That is not an edit made here, so it keeps the revision and the time it
// was saved with, and nothing is saved back.
function writeAdopted() {
  placeFormats(editor.model.formats);   // in the order the places say, whatever device moved them
  rememberFormats(editor.model);
  const text = modelToText(editor.model);
  editor.internal = true;
  $("formats").value = text;
  $("formats").dispatchEvent(new Event("input", { bubbles: true }));
  editor.internal = false;
  if (!editor.model.formats.some((f) => f.id === editor.activeId)) editor.activeId = editor.model.formats.length ? editor.model.formats[0].id : null;
  snapshotFormats(editor.model);
}

function adoptFormat(fmt) {
  if (!editor.model) return;
  const i = editor.model.formats.findIndex((f) => f.id === fmt.id);
  if (i >= 0) editor.model.formats[i] = fmt; else editor.model.formats.push(fmt);
  syncPlaylistRefs();   // the names of its playlists, from the account's playlists
}

function removeLocalFormat(id) {
  if (editor.model) editor.model.formats = editor.model.formats.filter((f) => f.id !== id);
}

// A question with a few answers, in a dialog. Resolves with the answer's value. One that is required has to be answered: Escape and the backdrop do nothing. Otherwise
// closing it resolves with null, to decide later.
function askSyncChoice(title, text, choices, options = {}) {
  if (typeof endConnectingScreen === "function") endConnectingScreen();   // a question needs the page in view
  return new Promise((resolve) => {
    const required = !!options.required;
    const done = (value) => { overlay.remove(); document.removeEventListener("keydown", onKey); resolve(value); };
    const onKey = (event) => { if (event.key === "Escape" && !required) done(null); };
    const buttons = choices.map((c, i) => feEl("button", { type: "button", id: "feSyncChoice" + i, class: c.danger ? "fe-danger-button" : undefined, onClick: () => done(c.value) }, c.label));
    const overlay = feEl("div", { class: "fe-overlay", id: "feSyncDialog", onClick: () => { if (!required) done(null); } },
      feEl("div", { class: "fe-dialog", role: required ? "alertdialog" : "dialog", "aria-modal": "true", "aria-label": title, onClick: (e) => e.stopPropagation() },
        feEl("h3", { text: title }),
        feEl("p", { text }),
        options.detail ? feEl("p", { class: "muted", id: "feSyncDetail", text: options.detail }) : null,
        feEl("div", { class: "row" }, ...buttons)));
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey);
    (options.focusLast ? buttons[buttons.length - 1] : buttons[0]).focus();   // a question about something that cannot be taken back starts on the safe answer
  });
}

function syncEditorFromText() {
  try {
    editor.model = textToModel($("formats").value, true);
    editor.broken = "";
  } catch (err) {
    editor.model = null;
    editor.broken = String(err.message || err);
  }
  if (editor.model) snapshotFormats(editor.model);
  if (editor.model && syncPlaylistRefs()) commitHealed();
  if (editor.model && !editor.model.formats.some((f) => f.id === editor.activeId)) {
    editor.activeId = editor.model.formats.length ? editor.model.formats[0].id : null;
  }
  editor.panel = null;
  editor.gapPanel = null;
  editor.cardMenu = false;
  renderEditor();
}

function initEditor() {
  $("formats").addEventListener("input", () => { if (!editor.internal) syncEditorFromText(); });
  // Tapping anywhere else, or pressing Escape, closes an open menu or list, and does nothing else: the press and the tap that follows are both stopped
  // before they reach what was tapped. The only things let through are the popup itself and the control that opened it, which closes it as usual.
  const popupOpen = () => editor.panel || editor.cardMenu || editor.gapPanel !== null || editor.appMenu;
  const outsidePopup = (event) => !(event.target.closest && event.target.closest('.fe-pop, .fe-trigger[aria-expanded="true"]'));
  document.addEventListener("pointerdown", (event) => { if (popupOpen() && outsidePopup(event)) event.stopPropagation(); }, true);   // so a handle does not start a drag
  document.addEventListener("click", (event) => {
    if (!popupOpen() || !outsidePopup(event)) return;
    event.stopPropagation();
    event.preventDefault();
    closePanels();
  }, true);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && (editor.panel || editor.cardMenu || editor.gapPanel !== null || editor.appMenu)) closePanels(); });
  window.addEventListener("resize", () => { equalizeAmounts(); updateTagHang(); });   // the widget changes size when the page goes between phone and wide layouts
  applyMinimalMode();
  syncEditorFromText();
}

function closePanels() {
  editor.panel = null;
  editor.gapPanel = null;
  editor.cardMenu = false;
  editor.appMenu = false;
  renderAppMenu();
  renderHead();
  renderRows();
}

function focusSearchBox() {
  // On a phone, focusing the box would open the keyboard over the list, so only do it with a mouse.
  const fine = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
  const box = document.querySelector("#feRows .fe-search");
  if (fine && box && box.focus) { try { box.focus({ preventScroll: true }); } catch (err) { box.focus(); } }
}

function editorThemeChanged() { /* every color in the editor is a CSS variable, so there is nothing to redraw */ }

function editorPlaylistsChanged() {
  if (!editor.model) return;
  if (typeof scheduleSpotifySave === "function") scheduleSpotifySave(800);
  if (syncPlaylistRefs()) { commitHealed(); renderEditor(); return; }
  renderRows();
}

// ---------------------------------------------------------------- drawing
function renderEditor() {
  if (tabHeld()) { tabDrag.redraw = true; return; }   // not under a held tab: it is drawn again when the tab is let go
  const root = $("formatEditor");
  if (!root) return;
  root.innerHTML = "";
  editor.hover = null;
  editor.gapPanel = null;
  editor.renaming = null;
  if (editor.broken) { root.appendChild(brokenView()); return; }
  // In minimalist mode the page's title goes and the app's icon takes the first place in this row, as tall as the tabs.
  const format = activeFormat();
  root.appendChild(feEl("div", { class: "fe-toprow" + (format ? "" : " fe-noformats") },
    feEl("img", { class: "fe-appicon", src: "apple-touch-icon.png", alt: "", width: "44", height: "44" }),
    feEl("div", { class: "fe-tabs", id: "feTabs" }),
    feEl("div", { class: "fe-appmenuwrap", id: "feAppMenu" })));
  const strip = $("feTabs");
  strip.addEventListener("pointerdown", startTabPress);
  strip.addEventListener("touchmove", (event) => { if (tabDrag.press && tabDrag.press.dragging) event.preventDefault(); }, { passive: false });   // a held tab moves, the row does not scroll under it
  strip.addEventListener("contextmenu", (event) => { if (tabDrag.press) event.preventDefault(); });   // the long press is not a request for a menu
  renderTabs();
  renderAppMenu();
  // the menu button was not there yet when the tabs were drawn, so the tabs have less room than they were scrolled for
  scrollSelectedTab();
  if (!format) {   // no formats: the New format button, and what to do with it
    root.appendChild(feEl("p", { class: "muted fe-emptynote", id: "feEmptyNote", text: "Tap New recipe to create your first recipe, then add as many segments to it as you like." }));
    // the line for notices is here too, so a message about what was just done is never left without a place to show
    root.appendChild(feEl("div", { class: "fe-caption", id: "feCaption", onPointerDown: pauseNotices, onMouseEnter: pauseNotices }));
    root.appendChild(feEl("span", { class: "fe-sr", id: "feNoticeLive", "aria-live": "polite" }));
    editor.musicText = "";
    refreshNoticeLine();
    if (typeof updateButtons === "function") updateButtons();
    return;
  }
  const card = feEl("div", { class: "fe-card", id: "feCard" },
    feEl("p", { class: "fe-warn", id: "feClash", hidden: true }),   // about the name, so it stays at the top, near the tab
    feEl("div", { class: "fe-barwrap" },
      feEl("div", { class: "fe-bar", id: "feBar", role: "img", "aria-label": "Shape of one playlist" }),
      feEl("div", { class: "fe-caption", id: "feCaption", onPointerDown: pauseNotices, onMouseEnter: pauseNotices }),
      feEl("span", { class: "fe-sr", id: "feNoticeLive", "aria-live": "polite" })),
    feEl("div", { class: "fe-rows", id: "feRows" }),
    feEl("div", { id: "feHead" }));   // the silence between segments, Duplicate and Delete: settings for the whole format, below the segments
  root.appendChild(card);
  renderHead(true);
  renderTimeline();
  renderRows();
  if (typeof updateButtons === "function") updateButtons();   // the Build button names the format being edited
}

function brokenView() {
  return feEl("div", { class: "fe-empty", id: "feBroken" },
    feEl("p", { text: "Your saved recipes could not be read, so they can't be shown." }),
    feEl("p", { class: "muted", text: editor.broken }),
    feEl("div", { class: "row" },
      feEl("button", { type: "button", id: "feSaveBroken", onClick: () => saveFile(`playlist-recipes-unreadable-${fileStamp()}.txt`, $("formats").value) }, "Download the saved text"),
      feEl("button", { type: "button", class: "primary", id: "feStartOver", onClick: () => { setFormatsText(DEFAULT_FORMATS); } }, "Start over")));
}

// ---------------------------------------------------------------- the app-level menu
// The app page is the compact one ("minimal" on the body): only the editor and the Build button. Connecting, trying again and connecting
// again are done from the app menu and the Build button.
function minimalActive() {
  return document.documentElement.classList.contains("page-app") && document.body.classList.contains("has-editor");
}

function applyMinimalMode() {
  document.body.classList.toggle("minimal", minimalActive());
  if (typeof scrollSelectedTab === "function") scrollSelectedTab();   // the icon changes how much room the tabs have, so keep the selected one in view
  if (typeof updateButtons === "function") updateButtons();   // Create turns into a connect button while minimal and not connected
}

function toggleAppMenu() {
  editor.appMenu = !editor.appMenu;
  editor.panel = null;
  editor.gapPanel = null;
  editor.cardMenu = false;
  renderAppMenu();
  renderHead();
  renderRows();
}

function renderAppMenu() {
  const slot = $("feAppMenu");
  if (!slot) return;
  slot.innerHTML = "";
  slot.appendChild(feEl("button", {
    type: "button", class: "fe-iconbtn fe-trigger", id: "feAppMenuButton",
    "aria-label": "App menu", "aria-haspopup": "menu", "aria-expanded": String(editor.appMenu),
    onClick: toggleAppMenu,
  }, feIcon("dots"), feEl("img", { class: "fe-saveicon", src: "backup-cover.jpg", alt: "", "aria-hidden": "true", width: "44", height: "44" })));
  applySavingIcon();
  if (!editor.appMenu) return;
  const choose = (action) => () => { editor.appMenu = false; renderAppMenu(); action(); };
  const backupLabel = ($("backupStatus") && $("backupStatus").textContent) || "";   // the same label as in the backup step, which the app page hides
  // Connecting from the menu: with a saved Client ID, Connect to Spotify, which is also the way out of a problem.
  // Not connected is one thing in the menu, whatever the reason: Connect to Spotify, with what is wrong (or that it is under way) in a line under it. The page has its own
  // Try again and Connect again, with the same words, so the menu does not need its own.
  const connectItems = [];
  const hasClientId = !!localStorage.getItem("clientId");
  if ((connection === "none" && hasClientId) || ((connection === "problem" || connection === "connecting") && (hasClientId || token))) {
    const connecting = connection === "connecting";
    // a problem that waiting can mend (the network, a rate limit) is tried again where it stopped; one in the sign-in itself, or no sign-in, starts a new sign-in
    const press = () => (typeof spotifyPause === "function" && spotifyPause() ? showPauseDialog() : connection === "problem" && connectionKind === "retry" && token ? connectToSpotify() : startLogin());
    connectItems.push(feEl("button", { type: "button", class: "fe-item", id: "feConnect", role: "menuitem", disabled: connecting, onClick: choose(press) }, feIcon("link"), connecting ? "Connecting\u2026" : "Connect to Spotify"));
    const why = connecting ? "On a slow connection this can take a few seconds." : connection === "problem" ? $("connectionMessage").textContent : "";
    if (why) connectItems.push(feEl("div", { class: "fe-itemnote", id: "feConnectionNote", text: why }));
  }
  // When recipes are saved to Spotify there is nothing about saving in this menu: it happens by itself, and the icon on the menu button shows it while it does. For a person
  // who backs up by hand there is one block: what it is, a link to change it, when the last backup was, and the two actions.
  const auto = typeof backupMode === "function" && backupMode() === "spotify";
  let backupBlock = null;
  if (!auto) {
    const status = backupLabel ? feEl("span", { class: "fe-bk-status", id: "feBackupStatus", text: backupLabel }) : null;
    backupBlock = feEl("div", { class: "fe-bk-block" },
      feEl("div", { class: "fe-bk-row" }, feIcon("device"),
        feEl("div", { class: "fe-bk-text" },
          feEl("span", { class: "fe-bk-title", text: "Manual backup to this device" }),
          feEl("button", { type: "button", class: "linklike fe-bk-change", id: "feBackupMethod", role: "menuitem", onClick: choose(() => openBackupCard()), text: "Change how your recipes are saved" }),
          status)),
      feEl("div", { class: "fe-bk-actions" },
        feEl("button", { type: "button", id: "feBackup", role: "menuitem", onClick: choose(() => downloadBackup()) }, feIcon("download"), "Back up now"),
        feEl("button", { type: "button", id: "feRestore", role: "menuitem", onClick: choose(() => $("restoreFile").click()) }, feIcon("restore"), "Restore")));
  }
  // Spotify, when it is connected: what is connected and who to, and the way out, small and to the side, since it is hardly ever wanted
  const who = typeof me !== "undefined" && me ? (me.display_name || me.id) : "";
  const spotifyRow = feEl("div", { class: "fe-sp-block" },
    feEl("div", { class: "fe-sp-row" }, feIcon("link"), feEl("span", { class: "fe-sp-title", text: "Spotify connected" }),
      feEl("button", { type: "button", class: "fe-sp-disconnect", id: "feDisconnect", role: "menuitem", onClick: choose(() => confirmDisconnect()), text: "Disconnect" })),
    who ? feEl("div", { class: "fe-sp-status", id: "feConnectedStatus", text: `Connected as ${who}, ${plural(playlists.length, "playlist")} found.` }) : null);
  // what the welcome and setup pages have at the bottom, each in a popup
  const infoItem = (id, target, icon, label) => feEl("button", { type: "button", class: "fe-item", id, role: "menuitem", onClick: choose(() => openInfo(target)) }, feIcon(icon), label);
  // Spotify is the first thing in the menu under its name, in whatever state it is in (connected, connecting, not connected, a problem), so it is always found in the same place.
  const spotifyItems = connection === "ready" ? [spotifyRow] : connectItems;
  slot.appendChild(feEl("div", { class: "fe-pop fe-appmenu", id: "feAppMenuPanel", role: "menu" },
    feEl("div", { class: "fe-menuhead", id: "feMenuHead" }, feEl("img", { class: "fe-menuicon", src: "apple-touch-icon.png", alt: "", width: "40", height: "40" }), feEl("span", { class: "fe-menuname", text: "Ceremony Playlist Builder" })),
    ...spotifyItems,
    ...(backupBlock ? [feEl("div", { class: "fe-rule" }), backupBlock] : []),
    ...(spotifyItems.length || backupBlock ? [feEl("div", { class: "fe-rule" })] : []),
    infoItem("feMoreOptions", "moreOptions", "sliders", "More options"),
    // the form says all there is to say about itself, so the item opens it straight away, in a new tab, with nothing attached
    typeof FEEDBACK_FORM_URL !== "undefined" && FEEDBACK_FORM_URL ? feEl("a", { class: "fe-item", id: "feFeedback", role: "menuitem", href: FEEDBACK_FORM_URL, target: "_blank", rel: "noopener noreferrer", onClick: () => setTimeout(() => { editor.appMenu = false; renderAppMenu(); }, 0) }, feIcon("chat"), "Feedback and questions") : null,
    infoItem("feReport", "reportBlock", "flag", "Report a problem"),
    feEl("button", { type: "button", class: "fe-item", id: "feTour", role: "menuitem", onClick: choose(() => takeTour()) }, feIcon("tour"), "Guided tour"),
    infoItem("fePrivacy", "privacySection", "lock", "Privacy"),
    // only on the owner's device: the app's own record of Spotify's limits, for the chat where it is studied
    typeof isOwnerHere !== "undefined" && isOwnerHere ? feEl("button", { type: "button", class: "fe-item", id: "feCopyRecord", role: "menuitem", onClick: choose(() => copyLimitRecord()) }, feIcon("copy"), "Copy Spotify record") : null,
    feEl("div", { class: "fe-rule" }),
    feEl("div", { class: "fe-version", id: "feVersion", text: `App version ${typeof APP_VERSION === "undefined" ? "" : APP_VERSION}` })));
}

// While recipes are being saved to Spotify the menu button shows the cloud-save picture in place of its dots, with a short cross-fade, and keeps it for at least a second so a
// quick save can still be seen. It stays up for as long as saves follow each other.
const savingIcon = { on: false, since: 0, timer: null };
function applySavingIcon() {
  const button = $("feAppMenuButton");
  if (button) button.classList.toggle("fe-saving", savingIcon.on);
}
function setSavingIcon(flag) {
  if (flag) {
    clearTimeout(savingIcon.timer);
    savingIcon.timer = null;
    if (!savingIcon.on) { savingIcon.on = true; savingIcon.since = Date.now(); }
  } else if (savingIcon.on && !savingIcon.timer) {
    const left = 1000 - (Date.now() - savingIcon.since);
    const off = () => { savingIcon.on = false; savingIcon.timer = null; applySavingIcon(); };
    if (left > 0) savingIcon.timer = setTimeout(off, left); else off();
  }
  applySavingIcon();
}

// A menu, list or card that would run off the bottom of the screen opens upward instead (or, if there is no more room above,
// stays below and is scrolled into view).
function fitPops() {
  const margin = 8;
  document.querySelectorAll("#formatEditor .fe-pop").forEach((pop) => {
    pop.classList.remove("fe-up");
    if (pop.classList.contains("fe-tagpanel")) {
      // a silence's card is centered on its marker, so it has no up or down: if that would put part of it off the screen, it slides up or down
      // just far enough to be fully on screen (and clear of the tip strip along the bottom, when there is one)
      pop.style.removeProperty("--shift");
      const r = pop.getBoundingClientRect();
      if (!r.height) return;
      const vv = window.visualViewport;
      const topEdge = (vv ? vv.offsetTop : 0) + margin;
      let bottomEdge = (vv ? vv.offsetTop + vv.height : window.innerHeight) - margin;
      const tip = document.getElementById("supportBox");
      if (tip && getComputedStyle(tip).display !== "none") {   // (a fixed box has no offsetParent, so it is not used here)
        const t = tip.getBoundingClientRect();
        if (t.width > window.innerWidth * 0.6 && t.top > 0 && t.top < bottomEdge + margin) bottomEdge = t.top - margin;   // a strip across the whole bottom of the screen
      }
      let shift = 0;
      if (r.bottom > bottomEdge) shift = bottomEdge - r.bottom;
      if (r.top + shift < topEdge) shift = topEdge - r.top;   // too tall for the screen: its top wins
      if (shift) pop.style.setProperty("--shift", Math.round(shift) + "px");
      if (r.height > bottomEdge - topEdge && pop.scrollIntoView) pop.scrollIntoView({ block: "nearest" });
      return;
    }
    const down = pop.getBoundingClientRect();
    if (!down.height || down.bottom <= window.innerHeight - margin) return;   // not laid out, or it fits
    pop.classList.add("fe-up");
    const up = pop.getBoundingClientRect();
    const overflowDown = down.bottom - (window.innerHeight - margin);
    const overflowUp = margin - up.top;
    if (overflowUp > 0 && overflowUp >= overflowDown) pop.classList.remove("fe-up");   // no better above
    if (pop.scrollIntoView && (overflowUp > 0 || overflowDown > 0) && Math.min(overflowUp, overflowDown) > 0) pop.scrollIntoView({ block: "nearest" });
  });
}

function renderTabs() {
  if (tabHeld()) return;   // the tabs are drawn again when the held one is let go
  const tabs = $("feTabs");
  if (!tabs) return;
  tabs.innerHTML = "";
  for (const f of editor.model.formats) {
    const selected = f.id === editor.activeId;
    if (selected && editor.renaming === f.id) {
      tabs.appendChild(renameTab(f));
    } else if (selected) {
      // the selected tab carries a pencil, and pressing it renames the format where it is
      tabs.appendChild(feEl("button", {
        type: "button", class: "fe-tab", "aria-pressed": "true", "data-id": f.id, title: "Rename recipe", onClick: startRename,
      }, f.title.trim() || (f.draft ? feEl("span", { class: "fe-tab-blank", text: "New recipe" }) : "Untitled"), feIcon("pencil")));
    } else {
      tabs.appendChild(feEl("button", {
        type: "button", class: "fe-tab", "aria-pressed": "false", "data-id": f.id,
        onClick: () => { editor.activeId = f.id; editor.panel = null; editor.gapPanel = null; editor.cardMenu = false; editor.appMenu = false; renderEditor(); },
      }, f.title.trim() || "Untitled"));
    }
  }
  // New recipe is the last thing in the row, after every tab, and scrolls with them; no tab can be dragged past it
  tabs.appendChild(feEl("button", { type: "button", class: "fe-newformat", id: "feNewFormat", onClick: askNewFormat }, feIcon("plus"), feEl("span", { class: "fe-newformat-label", text: "New recipe" })));
  scrollSelectedTab();
}

// ---------------------------------------------------------------- reordering the tabs
// Press and hold a tab for about a third of a second, then drag it sideways; the others make way. Moving before the hold is over scrolls the row instead: a finger
// scrolls it as usual, and a mouse drags it along. The held tab grows a little past its lifted size and settles back, and on a phone each step gives a tick. Near either end of the row it scrolls by itself, but never past the last tab. The tab stays inside the row: pulled past an end it gives a little,
// harder the further it goes, like a list on a phone pulled past its end; it never goes past New recipe at the end of the row. On a phone the other tabs get
// narrower while a tab is held, so more of the row can be seen. Alt + the left or right arrow moves the focused tab, or else the selected one, one place.
const tabDrag = { holdMs: 350, slop: 8, edge: 44, speed: 10, give: 22, press: null, frame: 0, redraw: false };

function startTabPress(event) {
  if (tabDrag.press || !editor.model) return;
  const mouse = event.pointerType === "mouse";
  if (mouse && event.button !== 0) return;
  const found = event.target.closest && event.target.closest(".fe-tab");
  const tab = found && !found.classList.contains("fe-tab-editing") && editor.model.formats.length > 1 ? found : null;
  if (!tab && !mouse) return;   // a finger scrolls the row by itself; a mouse is helped to, from anywhere in it
  if (found && found.classList.contains("fe-tab-editing")) return;   // the name being typed: the mouse selects text there
  const press = { tab, pointerId: event.pointerId, x0: event.clientX, x: event.clientX, touch: !mouse, dragging: false, panning: false, scroll0: $("feTabs").scrollLeft, grab: 0, timer: 0 };
  tabDrag.press = press;
  if (tab) press.timer = setTimeout(() => beginTabDrag(press), tabDrag.holdMs);
  window.addEventListener("pointermove", moveTabPress);
  window.addEventListener("pointerup", endTabPress);
  window.addEventListener("pointercancel", endTabPress);
}

function moveTabPress(event) {
  const press = tabDrag.press;
  if (!press || event.pointerId !== press.pointerId) return;
  press.x = event.clientX;
  if (press.dragging) { placeDraggedTab(); return; }
  if (press.panning) { $("feTabs").scrollLeft = press.scroll0 - (press.x - press.x0); return; }
  if (Math.abs(press.x - press.x0) <= tabDrag.slop) return;
  if (press.touch) { endTabPress(); return; }   // a swipe before the hold is over: the row scrolls
  clearTimeout(press.timer);   // the mouse moved before the hold was over: it scrolls the row
  press.panning = true;
  press.scroll0 += press.x - press.x0;   // no jump: it scrolls from here on
}

function beginTabDrag(press) {
  if (tabDrag.press !== press || press.tab.parentNode !== $("feTabs")) return;   // the tabs were drawn again while it was held: this one is gone
  press.dragging = true;
  press.grab = press.x0 - press.tab.getBoundingClientRect().left;   // where the tab was taken hold of, not where the finger is by now
  press.tab.classList.add("fe-dragging");
  liftTab(press.tab, true);
  haptic();
  $("feTabs").classList.add("fe-reordering");
  placeDraggedTab();
  const tick = () => {
    if (tabDrag.press !== press) return;
    const strip = $("feTabs");
    const box = strip.getBoundingClientRect();
    // the further into the edge, the faster; and only as far as the tabs go (the lifted tab's own offset would otherwise let the row scroll on into nothing)
    const into = press.x < box.left + tabDrag.edge ? -(box.left + tabDrag.edge - press.x) : press.x > box.right - tabDrag.edge ? press.x - (box.right - tabDrag.edge) : 0;
    if (into) {
      const end = strip.lastElementChild ? strip.lastElementChild.offsetLeft + strip.lastElementChild.offsetWidth : 0;   // New recipe comes into view, but no tab goes past it
      const most = Math.max(0, end + (parseFloat(getComputedStyle(strip).paddingRight) || 0) - strip.clientWidth);
      strip.scrollLeft = Math.max(0, Math.min(most, strip.scrollLeft + Math.sign(into) * tabDrag.speed * Math.min(1, Math.abs(into) / tabDrag.edge)));
    }
    placeDraggedTab();
    tabDrag.frame = requestAnimationFrame(tick);
  };
  tabDrag.frame = requestAnimationFrame(tick);
}

// The lifted tab follows the finger; when its middle passes the middle of a neighbour, the two swap places in the row and the neighbour slides over.
function placeDraggedTab() {
  const press = tabDrag.press;
  const strip = $("feTabs");
  if (!press || !press.dragging || !strip) return;
  const tab = press.tab;
  const origin = strip.getBoundingClientRect().left - strip.scrollLeft;   // layout positions (offsetLeft) never include the transforms of tabs in motion
  const others = [...strip.querySelectorAll(".fe-tab")].filter((t) => t !== tab);
  const middle = press.x - press.grab + tab.offsetWidth / 2;
  const index = others.filter((t) => origin + t.offsetLeft + t.offsetWidth / 2 < middle).length;
  const target = others[index] || strip.querySelector(".fe-newformat");   // never past New recipe
  if (tab.nextElementSibling !== target) {
    const before = new Map(others.map((t) => [t, t.offsetLeft]));
    strip.insertBefore(tab, target);
    haptic();
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) {
      for (const t of others) {
        const moved = before.get(t) - t.offsetLeft;
        if (moved && typeof t.animate === "function") t.animate([{ transform: `translateX(${moved}px)` }, { transform: "translateX(0)" }], { duration: 160, easing: "ease-out" });
      }
    }
  }
  // inside the row and inside the tabs, with a little give past either end; the give, and the lifted tab's extra size, stay inside the row, which cuts off anything past it
  const box = strip.getBoundingClientRect();
  const first = strip.querySelector(".fe-tab");
  const inset = tabDrag.give + tab.offsetWidth * 0.03;
  const lowest = Math.max(box.left + inset, origin + first.offsetLeft);
  const highest = Math.min(box.right - inset, origin + tabsEnd(strip)) - tab.offsetWidth;
  let left = press.x - press.grab;
  if (left < lowest) left = lowest - rubberBand(lowest - left);
  else if (left > highest) left = Math.max(lowest, highest) + rubberBand(left - Math.max(lowest, highest));
  tab.style.transform = `translateX(${left - (origin + tab.offsetLeft)}px)`;
}

// The held tab's size is its own animation, apart from the sideways move: on lifting it grows a little past its lifted size and settles back to it.
const TAB_LIFT = 1.06;
function liftTab(tab, up) {
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || typeof tab.animate !== "function") { tab.style.scale = up ? String(TAB_LIFT) : ""; return; }
  tab.animate(up ? [{ scale: 1 }, { scale: 1.12, offset: 0.55 }, { scale: TAB_LIFT }] : [{ scale: TAB_LIFT }, { scale: 1 }],
    { duration: up ? 260 : 180, easing: "ease-out", fill: up ? "forwards" : "none" });
}

// A short tick on a phone. Android browsers have vibrate. Safari on an iPhone has no vibrate, but since iOS 18 switching a switch gives a light tick, so a hidden one
// is switched; elsewhere it does nothing.
let hapticSwitch = null;
function haptic() {
  try {
    if (typeof navigator.vibrate === "function") { navigator.vibrate(8); return; }
    if (!/iPhone|iPad|iPod/.test(navigator.userAgent) && !(navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform))) return;
    if (!hapticSwitch) {
      const input = feEl("input", { type: "checkbox", switch: true, tabindex: "-1" });
      hapticSwitch = feEl("label", { class: "fe-haptic", "aria-hidden": "true" }, input);
      document.body.appendChild(hapticSwitch);
    }
    hapticSwitch.click();
  } catch (err) { /* no tick: nothing else depends on it */ }
}

// where the last tab ends, by layout (a moving tab's offset does not count)
function tabsEnd(strip) {
  const tabs = strip.querySelectorAll(".fe-tab");
  const last = tabs[tabs.length - 1];
  return last ? last.offsetLeft + last.offsetWidth : 0;
}

// how far something pulled past its end goes: about half at first, then less and less, never more than the give
function rubberBand(distance) {
  return (1 - 1 / (distance * 0.55 / tabDrag.give + 1)) * tabDrag.give;
}

function endTabPress() {
  const press = tabDrag.press;
  if (!press) return;
  tabDrag.press = null;
  clearTimeout(press.timer);
  cancelAnimationFrame(tabDrag.frame);
  window.removeEventListener("pointermove", moveTabPress);
  window.removeEventListener("pointerup", endTabPress);
  window.removeEventListener("pointercancel", endTabPress);
  if (!press.dragging && !press.panning) return;
  // letting go is not a tap on the tab
  const swallow = (event) => { event.stopPropagation(); event.preventDefault(); };
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
  if (!press.dragging) return;
  const strip = $("feTabs");
  const id = press.tab.getAttribute("data-id");
  const from = press.tab.getBoundingClientRect().left;
  // The recipes may have changed while the tab was held (a save read from Spotify can add one), so the tabs on screen are not taken as the new list: the moved
  // recipe is put after the one it was dropped behind, in the list as it is now.
  const shown = [...strip.querySelectorAll(".fe-tab")].map((t) => t.getAttribute("data-id"));
  const behind = shown[shown.indexOf(id) - 1];
  const formats = editor.model.formats;
  const moving = formats.find((f) => f.id === id);
  if (moving) {
    const rest = formats.filter((f) => f !== moving);
    const at = behind === undefined ? 0 : rest.findIndex((f) => f.id === behind) + 1;
    rest.splice(at, 0, moving);
    if (rest.some((f, i) => f !== formats[i])) {
      editor.model.formats = rest;
      placeMoved(rest, at);
      commit();
    }
  }
  if (tabDrag.redraw) { tabDrag.redraw = false; renderEditor(); } else renderTabs();
  // the tab settles into its place from where it was let go
  const dropped = [...$("feTabs").querySelectorAll(".fe-tab")].find((t) => t.getAttribute("data-id") === id);
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (dropped && !reduce && typeof dropped.animate === "function") {
    const moved = from - dropped.getBoundingClientRect().left;
    dropped.animate([{ transform: `translateX(${moved}px)`, scale: TAB_LIFT }, { transform: "none", scale: 1 }], { duration: 200, easing: "ease-out" });
  }
}

// a tab is lifted and moving: drawing the tabs again now would take it out from under the finger
function tabHeld() {
  return !!(tabDrag.press && tabDrag.press.dragging);
}

function renameTab(f) {
  const input = feEl("input", { type: "text", id: "feName", class: "fe-tab-input", value: f.title, size: 1, autocomplete: "off", "aria-label": "Name of recipe", enterkeyhint: "done" });
  input.value = f.title;
  // the field is as wide as the name in it, growing and shrinking as it is typed: a hidden copy of the name beside it sets the width
  const sizer = feEl("span", { class: "fe-tab-sizer", "aria-hidden": "true" });
  const fit = () => { sizer.textContent = input.value; };
  fit();
  input.addEventListener("input", () => {
    const cleaned = cleanTitle(input.value);
    if (cleaned !== input.value) input.value = cleaned;
    f.title = cleaned;
    commit();
    renderClash();
    fit();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); finishRename(false); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finishRename(true); }
  });
  input.addEventListener("blur", () => { if (editor.renaming === f.id) finishRename(false); });
  return feEl("div", { class: "fe-tab fe-tab-editing", "aria-pressed": "true", "data-id": f.id }, feEl("span", { class: "fe-tab-fit" }, sizer, input));
}

function startRename() {
  const f = activeFormat();
  if (!f) return;
  editor.renaming = f.id;
  editor.renameFrom = f.title;
  renderTabs();
  const input = $("feName");
  if (input) { input.focus(); input.select(); }
}

function finishRename(cancel) {
  const f = activeFormat();
  if (f && cancel && editor.renameFrom !== undefined) { f.title = editor.renameFrom; commit(); renderClash(); }
  editor.renaming = null;
  editor.renameFrom = undefined;
  renderTabs();
}

// The tabs are one row that scrolls sideways, with New recipe at its end. The selected one is kept in view.
function scrollSelectedTab() {
  const strip = $("feTabs");
  const tab = strip && strip.querySelector('.fe-tab[aria-pressed="true"]');
  if (!tab) return;
  const room = 28;
  if (tab.offsetLeft - room < strip.scrollLeft) strip.scrollLeft = Math.max(0, tab.offsetLeft - room);
  else if (tab.offsetLeft + tab.offsetWidth + room > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = tab.offsetLeft + tab.offsetWidth + room - strip.clientWidth;
}


function renderHead(rebuild) {
  const head = $("feHead");
  const f = activeFormat();
  if (!head || !f) return;
  if (rebuild || !$("feGapValue")) {
    head.innerHTML = "";
    head.appendChild(feEl("div", { class: "fe-headrow" },
      feEl("div", { class: "fe-silence" },
        stepperBox({
          shorterId: "feGapShorter", longerId: "feGapLonger", valueId: "feGapValue", inline: true, width: 46,
          // "[ - 30 sec gaps + ]", "[ - No gaps + ]" on a phone, and a whole sentence on a wide screen: "[ - 30 sec of silence between segments + ]"
          // The stepper is as wide as the longest thing it can say, whatever it says now, so the + and − stay where they are while someone taps. Every thing it can say is
          // in it, invisibly, in the same place, so the width follows the fonts and not a guess.
          children: [
            feEl("span", { class: "fe-amount-live" }, feEl("span", { id: "feGapValue", text: f.gap ? describeSeconds(f.gap) : "No" }), " ", feEl("span", { class: "fe-silence-short", text: "gaps" }), feEl("span", { class: "fe-silence-label", id: "feSilenceLabel", text: silenceLabel(f.gap) })),
            ...GAP_STEPS.flatMap((s) => [
              feEl("span", { class: "fe-sizer fe-sizer-short", "aria-hidden": "true", text: `${s ? describeSeconds(s) : "No"} gaps` }),
              feEl("span", { class: "fe-sizer fe-sizer-label", "aria-hidden": "true", text: `${s ? describeSeconds(s) : "No"} ${silenceLabel(s)}` }),
            ]),
          ],
          shorterLabel: "Shorter silence between segments", longerLabel: "Longer silence between segments",
          onShorter: () => { const lower = GAP_STEPS.filter((s) => s < f.gap); f.gap = lower.length ? lower[lower.length - 1] : 0; afterGapChange(); },
          onLonger: () => { const higher = GAP_STEPS.filter((s) => s > f.gap); f.gap = higher.length ? higher[0] : GAP_STEPS[GAP_STEPS.length - 1]; afterGapChange(); },
        })),
      feEl("button", { type: "button", class: "fe-iconbtn", id: "feDuplicate", "aria-label": "Duplicate recipe", title: "Duplicate recipe", onClick: askDuplicateFormat }, feIcon("copy")),
      feEl("button", { type: "button", class: "fe-iconbtn fe-danger", id: "feDelete", "aria-label": "Delete recipe", title: "Delete recipe", onClick: askDeleteFormat }, feIcon("trash"))));
    renderClash();
  }
  $("feGapValue").textContent = f.gap ? describeSeconds(f.gap) : "No";
  $("feSilenceLabel").textContent = silenceLabel(f.gap);
}

// On a wide screen the stepper reads as a sentence: "[ - 30 sec of silence between segments + ]", and with none: "[ - No silence between segments + ]".
// On a phone it is shorter: "[ - 30 sec gaps + ]", and with none "[ - No gaps + ]".
function silenceLabel(gap) {
  return gap ? "of silence between segments" : "silence between segments";
}

function renderClash() {
  const f = activeFormat();
  const note = $("feClash");
  if (!f || !note) return;
  const clash = editor.model.formats.some((x) => x.id !== f.id && normName(x.title) === normName(f.title));
  note.hidden = !clash;
  note.textContent = clash ? "Another recipe has this name. Playlists from both would be treated as one set when replacing." : "";
}

// ---------------------------------------------------------------- the line under the bar: the music total, or a notice
// The line says how long the format is. It also carries the app's notices: news (formats added or updated from Spotify), each shown for a few seconds in turn, and
// trouble that needs the person, which stays until it is fixed or dismissed. While the person is editing the total is what they want, so notices wait.
const noticeTiming = { quietMs: 2000, baseMs: 3000, perWordMs: 250, pauseMs: 4000 };
const notices = { batch: [], held: null, pos: 0, shownAt: 0, pausedUntil: 0, lastEditAt: 0, attn: 0, timer: null, spoken: "" };

function attentionNow() { return typeof attentionItems === "function" ? attentionItems() : []; }

function noticeDuration(item) { return noticeTiming.baseMs + Math.max(0, String(item.text || item).split(/\s+/).length - 8) * noticeTiming.perWordMs; }

// A message is a sentence, or { text, icon, warn, hold, actions: [{ label, run }] }. Sentences, and messages with nothing to do, come in turn for a few seconds each. A message
// with something to do (Undo, Back up now), or one that says something went wrong, is held: it stays until the person uses it, presses OK, or edits.
function showNotices(messages) {
  if (!messages || !messages.length) return;
  for (const m of messages) {
    const item = typeof m === "string" ? { text: m } : m;
    if (item.transient) { notices.batch = notices.batch.filter((b) => !b.transient); notices.pos = 0; notices.shownAt = 0; }   // what was just done replaces what was said about the one before, which is no longer news
    if (item.hold) notices.held = item; else notices.batch.push(item);   // a held one replaces the one before it; the rest join whatever is waiting or showing
  }
  refreshNoticeLine();
}

function clearHeldNotice() {
  if (!notices.held) return;
  notices.held = null;
  refreshNoticeLine();
}

function pauseNotices() {
  notices.pausedUntil = Date.now() + noticeTiming.pauseMs;
  refreshNoticeLine();
}

// What the line says changes with a short crossfade: the old words fade up and out as the new ones rise in. Not when the person is editing (the total is feedback for their
// taps, so it comes back at once), not for the total as it changes minute by minute, and not for someone who has asked for less motion.
function paintNotice(caption, view, options = {}) {
  const key = view ? (view.key || `${view.text}|${view.count || ""}`) : "total";   // a countdown keeps its key, so it is not faded every second
  if (view && notices.paintedKey === key && caption.classList.contains("fe-notice") && caption.querySelector("button")) return;   // the same message is already there: repainting on a press would replace the button under the finger before the click lands
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fade = !options.instant && !reduce && typeof caption.animate === "function" && notices.paintedKey !== undefined && notices.paintedKey !== key;
  let ghost = null;
  if (fade) {
    ghost = document.createElement("div");
    ghost.className = caption.className + " fe-ghost";
    ghost.setAttribute("aria-hidden", "true");
    ghost.innerHTML = caption.innerHTML;
  }
  notices.paintedKey = key;
  paintNoticeNow(caption, view);
  if (!fade) return;
  for (const child of Array.from(caption.children)) child.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: "ease-out" });
  caption.appendChild(ghost);
  const out = ghost.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-4px)" }], { duration: 160, easing: "ease-in", fill: "forwards" });
  out.onfinish = () => ghost.remove();
}

function paintNoticeNow(caption, view) {
  caption.className = "fe-caption";
  caption.textContent = "";
  const live = $("feNoticeLive");
  if (!view) {
    caption.appendChild(feEl("span", { class: "fe-total", text: editor.musicText || "" }));
    notices.spoken = "";
    if (live) live.textContent = "";
    return;
  }
  caption.classList.add("fe-notice", view.pause ? "fe-notice-pause" : view.warn ? "fe-notice-warn" : "fe-notice-news");
  caption.appendChild(feIcon(view.icon || (view.warn ? "warn" : "cloud")));
  caption.appendChild(feEl("span", { class: "fe-notice-text", text: view.text }));
  for (const a of view.actions || []) caption.appendChild(a.more
    ? feEl("button", { type: "button", class: "fe-notice-link fe-notice-more", onClick: a.run }, feEl("span", { class: "fe-more-word", text: a.label }), feEl("span", { class: "fe-more-arrow", "aria-hidden": "true", text: "\u203A" }))   // the word alone is underlined on hover
    : feEl("button", { type: "button", class: a.ok ? "fe-notice-ok" : "fe-notice-link", onClick: a.run, text: a.label }));
  if (view.count) caption.appendChild(view.cycle
    ? feEl("button", { type: "button", class: "fe-notice-count", "aria-label": "Next message", onClick: view.cycle, text: `(${view.count})` })
    : feEl("span", { class: "fe-notice-count", text: `(${view.count})` }));
  if (live && notices.spoken !== view.text) { notices.spoken = view.text; live.textContent = view.text; }
}

function refreshNoticeLine() {
  clearTimeout(notices.timer);
  notices.timer = null;
  const caption = $("feCaption");
  if (!caption) return;
  const now = Date.now();
  const attention = attentionNow();
  const settleIn = notices.lastEditAt + noticeTiming.quietMs - now;
  if (settleIn > 0) {   // still being edited
    notices.shownAt = 0;
    paintNotice(caption, null, { instant: true });
    notices.timer = setTimeout(refreshNoticeLine, settleIn + 20);
    return;
  }
  if (notices.held) {   // what the person has just done has something to say, and something to offer
    const held = notices.held;
    const actions = (held.actions || []).map((a) => ({ label: a.label, run: () => { notices.held = null; a.run(); refreshNoticeLine(); } }));
    actions.push({ label: "OK", ok: true, run: () => clearHeldNotice() });
    paintNotice(caption, { warn: !!held.warn, icon: held.icon, text: held.text, actions });
    return;
  }
  const pauseLeft = typeof pausedSecondsLeft === "function" ? pausedSecondsLeft() : 0;
  if (pauseLeft && !notices.batch.length) {   // a wait from Spotify: it stays, counting down, after any message that is showing
    paintNotice(caption, { key: "pause", pause: true, icon: "clock", text: pauseLineText(pauseLeft), actions: [{ label: "Details", more: true, run: () => showPauseDialog() }] });
    return;
  }
  if (attention.length && !notices.batch.some((b) => b.transient)) {   // what was said about something the person has just done comes before trouble that is waiting
    notices.attn = Math.min(notices.attn, attention.length - 1);
    const item = attention[notices.attn];
    const actions = (item.actions || []).map((a) => ({ label: a.label, run: a.run }));
    if (item.ok) actions.push({ label: "OK", ok: true, run: () => dismissAttention(item.key) });
    paintNotice(caption, { warn: true, text: item.text, actions, count: attention.length > 1 ? `${notices.attn + 1} of ${attention.length}` : "",
      cycle: attention.length > 1 ? () => { notices.attn = (notices.attn + 1) % attention.length; refreshNoticeLine(); } : null });
    return;
  }
  if (notices.batch.length) {
    if (notices.pos >= notices.batch.length) notices.pos = 0;
    if (!notices.shownAt) notices.shownAt = now;
    let due = notices.shownAt + noticeDuration(notices.batch[notices.pos]);
    if (now < notices.pausedUntil) due = Math.max(due, notices.pausedUntil);
    if (now >= due) {
      notices.pos += 1;
      notices.shownAt = now;
      if (notices.pos >= notices.batch.length) { notices.batch = []; notices.pos = 0; notices.shownAt = 0; refreshNoticeLine(); return; }   // done: whatever is waiting comes next, or the total
      due = now + noticeDuration(notices.batch[notices.pos]);
    }
    paintNotice(caption, { text: notices.batch[notices.pos].text, icon: notices.batch[notices.pos].icon, count: notices.batch.length > 1 ? `${notices.pos + 1} of ${notices.batch.length}` : "" });
    notices.timer = setTimeout(refreshNoticeLine, Math.max(due - Date.now(), 0) + 20);
    return;
  }
  paintNotice(caption, null);
}

// ---------------------------------------------------------------- a wait from Spotify (see spotifyPause in app.js)
function pauseLineText(left) {
  return `Spotify paused \u00b7 back in ${clockText(left)}`;
}

// Each second while Spotify is paused: the countdown in the line and in the popup. The line is repainted only when it changes over (from the total, or at the end).
function refreshPauseViews(left) {
  const caption = $("feCaption");
  if (caption && left && notices.paintedKey === "pause") {
    const text = caption.querySelector(".fe-notice-text");
    if (text) text.textContent = pauseLineText(left);
  } else if (caption && (left ? notices.paintedKey === "total" : notices.paintedKey === "pause")) refreshNoticeLine();
  const clock = $("fePauseClock");
  if (clock && left) { clock.textContent = clockText(left); setPauseRing(); }
  if (!left && $("fePauseDialog")) closePauseDialog();
}

// The ring in the popup shows the part of the wait still to go. A wait kept with no start gets one the first time it is read (spotifyPause), so its ring empties from then.
function setPauseRing() {
  const ring = $("fePauseRing");
  const pause = typeof spotifyPause === "function" ? spotifyPause() : null;
  if (!ring || !pause) return;
  const share = pause.from && pause.until > pause.from ? Math.min(1, Math.max(0, (pause.until - Date.now()) / (pause.until - pause.from))) : 1;
  ring.style.setProperty("--left", (share * 100).toFixed(2) + "%");
}

function pauseBackAtText(until) {
  // "Back at about 9:48 PM", or "Back tomorrow at about 9:48 AM", or the day's name further on
  const at = new Date(until);
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return `Back at about ${time}`;
  if (days === 1) return `Back tomorrow at about ${time}`;
  return `Back ${at.toLocaleDateString([], { weekday: "long" })} at about ${time}`;
}

function closePauseDialog() {
  const overlay = $("fePauseDialog");
  if (!overlay) return;
  overlay.remove();
  document.removeEventListener("keydown", pauseDialogKey);
}
function pauseDialogKey(event) { if (event.key === "Escape") closePauseDialog(); }

function showPauseDialog() {
  const pause = typeof spotifyPause === "function" ? spotifyPause() : null;
  if (!pause || $("fePauseDialog")) return;
  if (typeof endConnectingScreen === "function") endConnectingScreen();   // the popup needs the page in view
  if (editor.panel || editor.cardMenu || editor.gapPanel !== null || editor.appMenu) closePanels();   // an open list would take the first tap outside the popup
  const quota = pause.reason === "QUOTA_EXCEEDED";
  const kept = playlists.length || (typeof KEPT_PLAYLISTS_KEY === "string" && localStorage.getItem(KEPT_PLAYLISTS_KEY));   // the kept list may be put in just after this opens
  const rows = [["Editing recipes", true], ["Choosing playlists", !!kept], ["Building playlists", false]];
  if (typeof backupMode === "function" && backupMode() === "spotify") rows.push(["Saving recipes", false]);
  rows.sort((a, b) => b[1] - a[1]);   // what works first
  const row = ([label, works]) => feEl("div", { class: "fe-pause-row" }, feEl("span", { text: label }),
    feEl("span", { class: "fe-pause-chip " + (works ? "fe-pause-works" : "fe-pause-waits") }, feIcon(works ? "check" : "clock"), works ? "Works" : "Waits"));
  const close = feEl("button", { type: "button", id: "fePauseClose", onClick: () => closePauseDialog() }, "Close");
  const overlay = feEl("div", { class: "fe-overlay", id: "fePauseDialog", onClick: () => closePauseDialog() },
    feEl("div", { class: "fe-dialog fe-pause-dialog", id: "fePauseBox", tabindex: "-1", role: "dialog", "aria-modal": "true", "aria-labelledby": "fePauseTitle", onClick: (e) => e.stopPropagation() },
      feEl("h3", { id: "fePauseTitle", text: "Spotify paused this app" }),
      feEl("div", { class: "fe-pause-ring", id: "fePauseRing" },
        feEl("div", { class: "fe-pause-label", text: "Back in" }),
        feEl("div", { class: "fe-pause-clock", id: "fePauseClock", text: clockText(pausedSecondsLeft()) }),
        feEl("div", { class: "fe-pause-at", id: "fePauseAt", text: "at " + new Date(pause.until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) })),
      feEl("p", { id: "fePauseWhy", text: (quota
        ? "Spotify limits how much each app may ask of it in a day. This app reached that limit, so Spotify stopped answering it for a while."
        : "Spotify limits how often each app may ask it for things. This app asked too often, so Spotify stopped answering it for a while.")
        + " Asking sooner does not help, so the app waits, and connects again by itself when the time is up." }),
      feEl("div", { class: "fe-pause-lists", id: "fePauseList" }, ...rows.map(row)),
      feEl("div", { class: "row" }, close)));
  document.body.appendChild(overlay);
  setPauseRing();
  document.addEventListener("keydown", pauseDialogKey);
  try { sessionStorage.setItem("pauseSeen", String(pause.until)); } catch (err) { /* private browsing */ }
  $("fePauseBox").focus();   // the popup itself, not Close: a ring on a button in a popup that opened by itself looked like a mistake
}

function renderTimeline() {
  const f = activeFormat();
  const bar = $("feBar");
  const caption = $("feCaption");
  if (!f || !bar) { editor.musicText = ""; refreshNoticeLine(); return; }
  editor.hover = null;
  bar.innerHTML = "";
  const addPiece = (key, label, style, silence) => {
    const piece = feEl("div", { role: "img", class: "fe-piece" + (silence ? " fe-piece-silence" : ""), "data-id": key, "aria-label": label, style });
    piece.addEventListener("mouseenter", () => { editor.hover = key; applyHighlight(); });
    piece.addEventListener("mouseleave", () => { editor.hover = null; applyHighlight(); });
    bar.appendChild(piece);
  };
  let quiet = 0;
  if (f.lead > 0) { addPiece("lead", `Silence before the first segment, ${describeSeconds(f.lead)}`, `flex:${Math.max(f.lead / 60, 0.7)} 1 0`, true); quiet += f.lead; }
  f.items.forEach((item, index) => {
    const mixed = item.lists.length > 1;
    addPiece(item.id, `${item.lists.map((l) => l.name || "No playlist yet").join(" + ")}, ${Math.round(item.minutes * 10) / 10} min`,
      `flex:${item.minutes} 1 0;` + (mixed ? `background-image:${feStripes(mixPercentA(item) / 100, 16)}` : ""), false);
    const info = gapInfo(f, index + 1);
    if (info.show && !info.zero) {
      addPiece(`gap${index + 1}`, `Silence, ${describeSeconds(info.sec)}`, `flex:${Math.max(info.sec / 60, 0.5)} 1 0`, true);
      quiet += info.sec;
    }
  });
  const music = f.items.reduce((n, i) => n + i.minutes, 0);
  // Under an hour it is in minutes, with a decimal where there is one ("12.5 min"); from an hour up it is hours and whole minutes ("2 hr 40 min").
  const shownMusic = Math.round(music * 10) / 10;
  const musicWords = shownMusic >= 60 ? clockWords(shownMusic) : minuteWords(shownMusic);
  const quietWords = quiet >= 3600 ? clockWords(quiet / 60) : quiet < 60 ? `${quiet} ${quiet === 1 ? "second" : "seconds"}` : minuteWords(Math.round(quiet / 6) / 10);
  editor.musicText = `${musicWords} of music` + (quiet ? ` + ${quietWords} of silence` : "");
  refreshNoticeLine();   // the line shows the total, unless there is a notice to show
  applyHighlight();
}

// The line under the bar has room, so it uses whole words.
function minuteWords(n) { return `${n} ${n === 1 ? "minute" : "minutes"}`; }
function clockWords(minutes) {
  const m = Math.round(minutes), h = Math.floor(m / 60);
  return `${h} ${h === 1 ? "hour" : "hours"}` + (m % 60 ? " " + minuteWords(m % 60) : "");
}

// Every length widget in a format is as wide as the widest one: they all grow when one needs more room, and shrink again when it does not.
function equalizeAmounts() {
  const spans = Array.from(document.querySelectorAll("#feRows .fe-rowamount"));
  if (!spans.length) return;
  for (const el of spans) el.style.minWidth = "";
  let widest = 0;
  for (const el of spans) widest = Math.max(widest, el.getBoundingClientRect().width);
  if (widest > 0) for (const el of spans) el.style.minWidth = Math.ceil(widest) + "px";
}

// The room kept beside the segments for the silence markers follows the widest marker: they hang 26 px past the segments with the usual labels, more with a long one such as 12.5m.
function updateTagHang() {
  const rootEl = $("formatEditor"), holder = $("feRows");
  if (!rootEl || !holder) return;
  const hang = Math.max(26, ...Array.from(holder.querySelectorAll(".fe-tag")).map((t) => Math.ceil(t.getBoundingClientRect().width) - 16));
  if (rootEl.style.getPropertyValue("--tag-hang") !== hang + "px") rootEl.style.setProperty("--tag-hang", hang + "px");
}

function renderRows(settle) {
  const f = activeFormat();
  const holder = $("feRows");
  if (!f || !holder) return;
  editor.hover = null;   // the old elements are gone, so whatever was under the pointer no longer is
  holder.innerHTML = "";
  f.items.forEach((item, index) => holder.appendChild(rowEl(f, item, index)));
  equalizeAmounts();
  const full = noRoomForSegment(f);
  holder.appendChild(feEl("button", { type: "button", class: "fe-add", id: "feAddSegment", disabled: full ? true : undefined, onClick: addSegment }, feIcon("plus"), "New segment"));
  if (full || editor.refused) holder.appendChild(feEl("p", { class: "muted", id: "feSizeNote", role: "status", text: SIZE_MESSAGE }));
  const rootEl = $("formatEditor");
  if (rootEl) rootEl.classList.toggle("fe-hastags", gapInfo(f, 0).show || f.items.some((x, index) => gapInfo(f, index + 1).show));
  updateTagHang();
  // the markers only have a size once the editor is on screen, so measure again whenever the rows change size
  if (window.ResizeObserver) { if (!editor.tagObserver) editor.tagObserver = new ResizeObserver(() => updateTagHang()); editor.tagObserver.disconnect(); editor.tagObserver.observe(holder); }
  if (settle) applySettle(holder, settle);
  applyHighlight();
  fitPops();
}

function rowEl(f, item, index) {
  const mixed = item.lists.length > 1;
  const open = editor.panel && editor.panel.id === item.id ? editor.panel.mode : null;
  const g = index + 1;
  const tag = gapInfo(f, g);
  const leadTag = index === 0 ? gapInfo(f, 0) : null;
  const wrap = feEl("div", { class: "fe-row" + (open || (tag.show && editor.gapPanel === g) || (leadTag && leadTag.show && editor.gapPanel === 0) ? " fe-open" : ""), "data-id": item.id, "data-index": String(index) });
  wrap.addEventListener("mouseenter", () => { editor.hover = item.id; applyHighlight(); });
  wrap.addEventListener("mouseleave", () => { editor.hover = null; applyHighlight(); });
  const card = feEl("div", { class: "fe-rowcard" });

  const grip = feEl("button", { type: "button", class: "fe-grip", "aria-label": "Drag to reorder" }, feIcon("grip"));
  grip.addEventListener("pointerdown", (event) => startDrag(event, grip, item.id, index));
  grip.addEventListener("pointermove", moveDrag);
  grip.addEventListener("pointerup", endDrag);
  grip.addEventListener("pointercancel", endDrag);
  card.appendChild(grip);

  // the playlist button
  let cover;
  let title;
  let sub;
  let warn = false;
  if (mixed) {
    cover = feEl("span", { class: "fe-cover", style: `background-image:${feStripes(mixPercentA(item) / 100, 12)}` });
    title = item.lists.map((l) => l.name || "\u2026").join(" + ");
    sub = item.lists.length === 2 ? `${mixPercentA(item)}% / ${100 - mixPercentA(item)}% mix` : `${item.lists.length}-playlist mix`;
  } else {
    const name = item.lists[0].name;
    cover = coverEl(name, 30);
    title = name || "Choose a playlist";
    sub = playlistSub(name);
    warn = !!name && !playlistInfo(name) && playlists.length > 0;
  }
  const main = feEl("button", {
    type: "button", class: "fe-main fe-trigger" + (!item.lists[0].name && !mixed ? " fe-main-empty" : ""),
    "aria-expanded": String(open === "list-a" || open === "mix"), "aria-label": `Playlist: ${title}`,
    onClick: () => setPanel(item.id, open ? null : (mixed ? "mix" : "list-a")),
  }, cover,
  feEl("span", { class: "fe-text" }, feEl("span", { class: "fe-title", text: title }), feEl("span", { class: "fe-sub" + (warn ? " fe-sub-warn" : ""), text: sub })),
  feIcon("chevron"));
  card.appendChild(main);

  // the length
  const minutes = Math.round(item.minutes * 10) / 10;
  card.appendChild(feEl("div", { class: "fe-stepper" },
    feEl("button", { type: "button", class: "fe-step fe-dec", "aria-label": "Shorter", onClick: () => stepItem(item, -1) }, feIcon("minus")),
    feEl("span", { class: "fe-amount fe-rowamount", text: `${minutes} min`, "data-short": `${minutes}m` }),
    feEl("button", { type: "button", class: "fe-step fe-inc", "aria-label": "Longer", onClick: () => stepItem(item, 1) }, feIcon("plus"))));

  card.appendChild(feEl("button", {
    type: "button", class: "fe-more fe-trigger", "aria-label": "More options", "aria-expanded": String(open === "menu"),
    onClick: () => setPanel(item.id, open === "menu" ? null : "menu"),
  }, feIcon("dots")));
  wrap.appendChild(card);

  if (leadTag && leadTag.show) {
    wrap.appendChild(tagEl(f, 0));
    if (editor.gapPanel === 0) wrap.appendChild(tagPanel(f, 0));
  }
  if (tag.show) {
    wrap.appendChild(tagEl(f, g));
    if (editor.gapPanel === g) wrap.appendChild(tagPanel(f, g));
  }
  if (open === "menu") wrap.appendChild(menuPanel(f, item, index));
  if (open === "mix") wrap.appendChild(mixPanel(item, cover));
  if (open === "list-a" || open === "list-b") wrap.appendChild(listPanel(item, open === "list-b" ? 1 : 0));
  return wrap;
}

// ---------------------------------------------------------------- silences
// A silence is a small bookmark-shaped tag hanging off the right side of the rows, its point aimed at the gap it belongs to.
function tagEl(f, g) {
  const info = gapInfo(f, g);
  const key = g === 0 ? "lead" : `gap${g}`;
  const kind = info.custom ? "custom" : "default";   // a silence set to 0 is a changed one, like any other: pink
  const where = g === 0 ? "Silence before the first segment" : info.interior ? "Silence between these segments" : "Silence after the last segment";
  const open = editor.gapPanel === g;
  const button = feEl("button", {
    type: "button", class: `fe-tag fe-trigger fe-tag-${kind}` + (g === 0 ? " fe-tag-lead" : ""), "data-id": key, "aria-expanded": String(open),
    "aria-label": `${where}: ${info.zero ? "0 sec" : describeSeconds(info.sec)}. Tap to change.`,
    onClick: () => { editor.gapPanel = open ? null : g; editor.panel = null; editor.cardMenu = false; editor.appMenu = false; editor.search = ""; renderAppMenu(); renderHead(); renderRows(); },
  }, feIcon("mute"), feEl("span", { class: "fe-tag-text", text: shortSeconds(info.sec) }));
  button.addEventListener("mouseenter", () => { editor.hover = key; applyHighlight(); });
  button.addEventListener("mouseleave", () => { editor.hover = null; applyHighlight(); });
  return button;
}

function stepperBox({ text, children, onShorter, onLonger, shorterLabel, longerLabel, shorterId, longerId, valueId, inline, width }) {
  return feEl("div", { class: "fe-stepper" + (inline ? " fe-stepper-inline" : "") },
    feEl("button", { type: "button", class: "fe-step", id: shorterId, "aria-label": shorterLabel, onClick: onShorter }, feIcon("minus")),
    children
      ? feEl("span", { class: "fe-amount fe-amount-rich" }, ...children)   // the words are inside the stepper, with the length
      : feEl("span", { class: "fe-amount", id: valueId, text, style: `min-width:${width}px` }),
    feEl("button", { type: "button", class: "fe-step", id: longerId, "aria-label": longerLabel, onClick: onLonger }, feIcon("plus")));
}

function tagPanel(f, g) {
  const info = gapInfo(f, g);
  // landing back on the default length means following the default again
  const keep = (sec) => setGap(g, info.hasDefault && sec === f.gap ? undefined : sec);
  const lower = SILENCE_STEPS.filter((s) => s < info.sec);
  const higher = SILENCE_STEPS.filter((s) => s > info.sec);
  const shorter = () => {
    if (info.zero) return;
    if (lower.length) keep(lower[lower.length - 1]);
    else if (info.hasDefault) setGap(g, 0);   // below the shortest length is none
  };
  const longer = () => (info.zero ? keep(SILENCE_STEPS[0]) : keep(higher.length ? higher[0] : SILENCE_STEPS[SILENCE_STEPS.length - 1]));
  // under the length: a pink link, Reset to default, once it has been changed, and a quiet gray (default) while it matches; with no default to go back to,
  // a Remove button beside the length instead
  const below = feEl("div", { class: "fe-tagbelow" });
  if (info.hasDefault && info.custom) {
    below.classList.add("fe-tagbelow-link");
    below.appendChild(feEl("button", { type: "button", class: "linklike", id: "feTagReset", "aria-label": `Reset to default, ${describeSeconds(f.gap)}`, onClick: () => { editor.gapPanel = null; setGap(g, undefined); } }, "Reset to default"));
  } else if (info.hasDefault) {
    below.classList.add("fe-tagbelow-default");
    below.appendChild(feEl("span", { class: "fe-tagdefault", id: "feTagDefault", text: "(default)" }));
  } else {
    below.classList.add("fe-tagbelow-remove");
    below.appendChild(feEl("button", { type: "button", class: "fe-linkbutton", id: "feTagRemove", "aria-label": "Remove this silence", onClick: () => { editor.gapPanel = null; setGap(g, undefined); } }, feIcon("trash"), "Remove"));
  }
  // one widget: the length and its caption on two lines, between the minus and the plus ("30 sec of" over "silence")
  const stepper = stepperBox({ shorterId: "feTagShorter", longerId: "feTagLonger", valueId: "feTagAmount", inline: true, width: 66,
    text: "", shorterLabel: "Shorter silence", longerLabel: "Longer silence", onShorter: shorter, onLonger: longer });
  const amount = stepper.querySelector(".fe-amount");
  amount.classList.add("fe-amount-two");
  amount.appendChild(feEl("span", { class: "fe-line" }, feEl("span", { id: "feTagDuration", text: info.zero ? "0 sec" : describeSeconds(info.sec) }), " of"));
  amount.appendChild(feEl("span", { class: "fe-line", text: "silence" }));
  // the link, the gray (default) or the Remove button sits right under the widget, centered on it
  const column = feEl("div", { class: "fe-tagcol" }, stepper, ...(below.childNodes.length ? [below] : []));
  return feEl("div", { class: "fe-pop fe-tagpanel" + (g === 0 ? " fe-tagpanel-lead" : ""), id: "feTagPanel" }, feEl("div", { class: "fe-tagrow" }, column));
}

function setGap(g, value) {
  const f = activeFormat();
  if (!f) return;
  ensureGaps(f);
  if (g === 0) f.lead = value === undefined ? 0 : value;   // the silence before the first segment is kept apart from the others
  else f.gaps[g] = value;
  afterGapChange();
}

function afterGapChange() {
  commit();
  renderHead();
  renderRows();
  renderTimeline();
}


// ---------------------------------------------------------------- panels
function setPanel(id, mode) {
  editor.panel = mode ? { id, mode } : null;
  editor.gapPanel = null;
  editor.cardMenu = false;
  editor.appMenu = false;
  renderAppMenu();
  editor.search = "";
  renderHead();
  renderRows();
  if (mode === "list-a" || mode === "list-b") focusSearchBox();
}

function menuPanel(f, item, index) {
  const mixed = item.lists.length > 1;
  const pop = feEl("div", { class: "fe-pop fe-menu" });
  if (!mixed) {
    const noRoom = noRoomForMix(f, item);
    pop.appendChild(feEl("button", {
      type: "button", class: "fe-item", id: "feAddMix", disabled: noRoom ? true : undefined,
      onClick: () => {
        const used = item.lists[0].name;
        const other = readablePlaylists().find((p) => normName(p.name) !== normName(used));
        item.lists = [{ name: used, id: item.lists[0].id, weight: 50 }, { name: other ? other.name : "", id: other ? other.id : undefined, weight: 50 }];
        editor.panel = { id: item.id, mode: "mix" };
        commit(); renderRows(); renderTimeline();
      },
    }, feIcon("plus"), "Add a mix"));
    if (noRoom) pop.appendChild(feEl("div", { class: "fe-itemnote", id: "feMixNote", text: "No room: this recipe has reached its size limit." }));
  } else {
    pop.appendChild(feEl("button", { type: "button", class: "fe-item", id: "feEditMix", onClick: () => setPanel(item.id, "mix") }, feIcon("sliders"), "Edit mix"));
    pop.appendChild(feEl("button", { type: "button", class: "fe-item", id: "feRemoveMix", onClick: () => removeMix(item) }, feIcon("minus"), "Remove mix"));
  }
  // When Spotify gives no snapshot for a playlist, the app cannot tell that its songs changed, so the saved songs can be refreshed by hand.
  const unwatched = item.lists.filter((l) => { const p = l.name && playlistInfo(l.name); return p && !p.snapshot; });
  if (unwatched.length) {
    pop.appendChild(feEl("button", {
      type: "button", class: "fe-item", id: "feRefreshSongs",
      onClick: () => { editor.panel = null; renderRows(); refreshSongsFor(unwatched.map((l) => l.name)); },
    }, feIcon("reset"), "Refresh songs from Spotify"));
  }
  // a silence can be added before or after this segment; the choice is dimmed where there is one already
  for (const [id, g, label] of [["feAddSilenceBefore", index, "Add silence before"], ["feAddSilence", index + 1, "Add silence after"]]) {
    pop.appendChild(feEl("button", {
      type: "button", class: "fe-item", id, disabled: gapInfo(f, g).show ? true : undefined,
      onClick: () => { editor.panel = null; setGap(g, 30); },
    }, feIcon("mute"), label));
  }
  pop.appendChild(feEl("div", { class: "fe-rule" }));
  pop.appendChild(feEl("button", {
    type: "button", class: "fe-item fe-danger", id: "feRemoveRow",
    onClick: () => { removeSegment(f, index); },
  }, feIcon("trash"), "Remove segment"));
  return pop;
}

function removeSegment(f, index) {
  ensureGaps(f);
  const last = f.items.length === 1;
  f.items.splice(index, 1);
  f.gaps.splice(index, 1);   // the silence before the removed segment goes with it
  if (last) { f.items.push({ id: `r${++ROW_SEQ}`, kind: "seg", lists: [{ name: "", weight: 1 }], minutes: 30 }); }
  ensureGaps(f);
  editor.panel = null;
  editor.gapPanel = null;
  commit(); renderRows(); renderTimeline();
}

function removeMix(item) {
  item.lists = [{ name: item.lists[0].name, id: item.lists[0].id, weight: 1 }];
  editor.panel = null;
  commit(); renderRows(); renderTimeline();
}

function mixPanel(item, rowCover) {
  const two = item.lists.length === 2;
  const pctA = feEl("span", { class: "fe-pct", id: "fePctA", text: `${mixPercentA(item)}%` });
  const pctB = feEl("span", { class: "fe-pct", id: "fePctB", text: `${100 - mixPercentA(item)}%` });
  const picker = (index) => feEl("button", {
    type: "button", class: "fe-minipick", id: index === 0 ? "feMixA" : "feMixB",
    onClick: () => setPanel(item.id, index === 0 ? "list-a" : "list-b"),
  }, coverEl(item.lists[index].name, 28), feEl("span", { class: "fe-minipick-name", text: item.lists[index].name || "Choose a playlist" }), feIcon("chevron"));
  const pop = feEl("div", { class: "fe-pop fe-mixpanel" }, feEl("div", { class: "fe-poplabel", text: two ? "Mix two playlists" : `Mix of ${item.lists.length} playlists` }));
  if (!two) {
    pop.appendChild(feEl("p", { class: "muted", style: "margin:4px 8px", text: "This mix has more than two playlists. You can remove the mix to use just the first one." }));
  } else {
    const slider = feEl("input", { type: "range", id: "feMixSlider", min: "10", max: "90", step: "5", "aria-label": "How much of each playlist" });
    slider.value = String(mixPercentA(item));
    slider.addEventListener("input", () => {
      const a = parseInt(slider.value, 10);
      item.lists[0].weight = a;
      item.lists[1].weight = 100 - a;
      pctA.textContent = `${a}%`;
      pctB.textContent = `${100 - a}%`;
      if (rowCover) rowCover.style.backgroundImage = feStripes(a / 100, 12);
      const subline = document.querySelector(`#feRows .fe-row[data-id="${item.id}"] .fe-sub`);
      if (subline) subline.textContent = `${a}% / ${100 - a}% mix`;
      commit();
      renderTimeline();
    });
    pop.appendChild(feEl("div", { class: "fe-mixline" }, picker(0), pctA));
    pop.appendChild(feEl("div", { class: "fe-sliderline" }, slider));
    pop.appendChild(feEl("div", { class: "fe-mixline" }, picker(1), pctB));
  }
  pop.appendChild(feEl("div", { class: "fe-popbuttons" },
    feEl("button", { type: "button", id: "feMixRemove", onClick: () => removeMix(item) }, "Remove mix"),
    feEl("button", { type: "button", class: "primary", id: "feMixDone", onClick: () => setPanel(item.id, null) }, "Done")));
  return pop;
}

function listPanel(item, slot) {
  const mixed = item.lists.length > 1;
  const current = normName(item.lists[slot] ? item.lists[slot].name : "");
  const other = mixed ? normName(item.lists[slot === 0 ? 1 : 0].name) : "";
  const list = feEl("div", { class: "fe-options", id: "feOptions" });
  const search = feEl("input", { type: "search", class: "fe-search", id: "feSearch", placeholder: "Search your playlists", "aria-label": "Search your playlists", autocomplete: "off" });
  search.value = editor.search;

  const choose = (p) => {
    item.lists[slot].name = p.name;
    item.lists[slot].id = p.id;
    editor.panel = mixed ? { id: item.id, mode: "mix" } : null;
    editor.search = "";
    commit(); renderRows(); renderTimeline();
  };

  const draw = () => {
    list.innerHTML = "";
    const query = normName(search.value);
    let shown = 0;
    for (const p of readablePlaylists()) {
      if (query && !normName(p.name).includes(query)) continue;
      shown += 1;
      const taken = mixed && normName(p.name) === other;
      list.appendChild(feEl("button", {
        type: "button", class: "fe-option" + (normName(p.name) === current ? " fe-option-on" : ""), "data-name": p.name,
        disabled: taken ? true : undefined, onClick: () => choose(p),
      }, coverEl(p.name, 32),
      feEl("span", { class: "fe-text" }, feEl("span", { class: "fe-title", text: p.name }),
        feEl("span", { class: "fe-sub", text: taken ? "Already in this mix" : (typeof p.count === "number" ? `${p.count} songs` : "") }))));
    }
    if (!shown) list.appendChild(feEl("p", { class: "muted", style: "margin:8px", text: playlists.length ? "No playlists match." : (connection === "problem" ? "Your playlists could not be loaded. See the app menu." : connection === "none" ? "Connect to Spotify to see your playlists." : "Your playlists are still loading.") }));
  };
  // During a wait with no list kept from an earlier visit there is nothing to search: say when the playlists come
  const pause = typeof spotifyPause === "function" ? spotifyPause() : null;
  if (pause && !playlists.length) {
    const back = pauseBackAtText(pause.until).replace(/^Back/, "back");
    list.appendChild(feEl("p", { class: "muted fe-pausenote", id: "fePauseNote" }, `Your playlists will show here when Spotify is ${back}. `,
      feEl("button", { type: "button", class: "linklike", id: "fePauseNoteDetails", onClick: () => showPauseDialog() }, "Details")));
    return feEl("div", { class: "fe-pop fe-listpanel" }, list);
  }
  search.addEventListener("input", () => { editor.search = search.value; draw(); });
  draw();
  return feEl("div", { class: "fe-pop fe-listpanel" }, search, list);
}

// ---------------------------------------------------------------- changing things
function stepItem(item, direction) {
  item.minutes = direction < 0 ? Math.max(1, item.minutes - 5) : Math.min(600, item.minutes + 5);
  commit();
  renderRows();
  renderTimeline();
}

function addSegment() {
  const f = activeFormat();
  if (!f || noRoomForSegment(f)) return;
  ensureGaps(f);
  const item = { id: `r${++ROW_SEQ}`, kind: "seg", lists: [{ name: "", weight: 1 }], minutes: 20 };
  f.items.push(item);
  f.gaps.push(undefined);
  editor.panel = { id: item.id, mode: "list-a" };
  editor.gapPanel = null;
  editor.search = "";
  commit();
  renderRows();
  renderTimeline();
  focusSearchBox();
}

// A new recipe is named first: playlists are named after it, and a default like "Recipe 1" would make "Recipe 1 1". The recipe is there at once, selected, as a
// draft: its tab, with its pencil, takes the name as it is typed behind the dimmed page. A draft is not written or saved (modelToText and the save skip it);
// Create makes it a recipe, and Cancel takes it away. The field is a pink capsule like the tab, and Create waits for a name that is not blank and not another recipe's.
function askNewFormat() {
  closePanels();
  const before = editor.activeId;
  const draft = newBlankFormat(editor.model, "");
  draft.draft = true;
  editor.model.formats.push(draft);
  editor.activeId = draft.id;
  editor.renaming = null;
  renderEditor();
  let done = false;
  const close = (keep) => {
    if (done) return;
    done = true;
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("scroll", holdStill);
    if (vv) { vv.removeEventListener("resize", holdStill); vv.removeEventListener("scroll", holdStill); }
    if (keep) { delete draft.draft; commit(); }
    else {
      editor.model.formats = editor.model.formats.filter((x) => x !== draft);
      editor.activeId = editor.model.formats.some((x) => x.id === before) ? before : (editor.model.formats.length ? editor.model.formats[0].id : null);
    }
    renderEditor();
  };
  const onKey = (event) => { if (event.key === "Escape") close(false); };
  const input = feEl("input", { type: "text", id: "feNewFormatName", class: "fe-nf-input", placeholder: "Type a name", autocomplete: "off", "aria-label": "Name of the new recipe", enterkeyhint: "done" });
  const clash = feEl("p", { class: "fe-nf-clash", id: "feNewFormatClash", text: "Another recipe has this name.", hidden: true });
  const cancel = feEl("button", { type: "button", id: "feNewFormatCancel", onClick: () => close(false) }, "Cancel");
  const confirm = feEl("button", { type: "button", class: "primary", id: "feNewFormatConfirm", disabled: true, onClick: () => { if (confirm.disabled) return; draft.title = input.value.trim(); close(true); } }, "Create recipe");
  const update = () => {
    const cleaned = cleanTitle(input.value);
    if (cleaned !== input.value) input.value = cleaned;
    const name = cleaned.trim();
    const taken = !!name && editor.model.formats.some((x) => x !== draft && normName(x.title) === normName(name));
    draft.title = name;
    renderTabs();
    clash.hidden = !taken;
    confirm.disabled = typing || !name || taken;
  };
  let typing = false;
  input.addEventListener("input", update);
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); confirm.click(); } });
  update();
  const typed = feEl("span", { class: "fe-nf-typed", "aria-hidden": "true" });
  const pencil = feIcon("pencil");
  pencil.classList.add("fe-nf-pencil");
  const overlay = feEl("div", { class: "fe-overlay", id: "feNewFormatDialog", onClick: () => close(false) },
    feEl("div", { class: "fe-dialog fe-nf-dialog", role: "dialog", "aria-modal": "true", "aria-label": "New recipe", onClick: (e) => e.stopPropagation() },
      feEl("h3", { text: "Name your new recipe" }),
      feEl("div", { class: "fe-nf-capsule" }, input, typed),
      clash,
      feEl("p", { class: "fe-nf-note" }, "You can change the name of this recipe at any time with the ", pencil, " button next to it."),
      feEl("div", { class: "row" }, cancel, confirm)));
  document.body.appendChild(overlay);
  document.addEventListener("keydown", onKey);
  // A phone's keyboard would scroll the page to bring the field into view, taking the new tab off the top of the screen. So the page is held where
  // it was, and the popup is centered in what the keyboard leaves visible, which puts it below the tabs.
  const vv = window.visualViewport, scrollY = window.scrollY;
  const holdStill = () => {
    if (window.scrollY !== scrollY || (vv && vv.offsetTop > 0)) window.scrollTo(0, scrollY);   // (a short page is panned instead of scrolled, and this undoes that too)
    if (vv) { overlay.style.top = Math.round(vv.offsetTop) + "px"; overlay.style.height = Math.round(vv.height) + "px"; overlay.style.bottom = "auto"; }
  };
  window.addEventListener("scroll", holdStill);
  if (vv) { vv.addEventListener("resize", holdStill); vv.addEventListener("scroll", holdStill); }
  if (tour.on) typeTourName(overlay.querySelector(".fe-nf-dialog"));
  else { try { input.focus({ preventScroll: true }); } catch (err) { input.focus(); } }
  holdStill();

  // In the tour the name is typed for the person, so no keyboard comes up to take half the screen. The box can't be edited, and the tour's
  // panel (and Create recipe) waits until the typing is done.
  function typeTourName(dialog) {
    input.readOnly = true;
    input.tabIndex = -1;
    let name = "Sample recipe";
    for (let n = 2; editor.model.formats.some((x) => x !== draft && normName(x.title) === normName(name)); n++) name = `Sample recipe ${n}`;
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const show = (i) => { input.value = name.slice(0, i); update(); typed.textContent = input.value; typed.appendChild(feEl("span", { class: "fe-nf-caret" })); };
    const finish = () => { typing = false; input.value = name; update(); dialog.classList.remove("fe-nf-typing"); };
    if (reduce) { finish(); return; }
    typing = true;
    dialog.classList.add("fe-nf-typing");
    show(0);
    let i = 0;
    const next = () => {
      if (done) return;
      if (i >= name.length) { finish(); return; }
      show(++i);
      setTimeout(next, i === name.length ? 350 : 70);
    };
    setTimeout(next, 450);
  }
}

function askDuplicateFormat() {
  const f = activeFormat();
  if (!f) return;
  closePanels();
  const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (event) => { if (event.key === "Escape") close(); };
  const cancel = feEl("button", { type: "button", id: "feDuplicateCancel", onClick: close }, "Cancel");
  const confirm = feEl("button", { type: "button", class: "primary", id: "feDuplicateConfirm", onClick: () => { close(); duplicateFormat(); } }, "Duplicate recipe");
  const overlay = feEl("div", { class: "fe-overlay", id: "feDuplicateDialog", onClick: close },
    feEl("div", { class: "fe-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Duplicate recipe", onClick: (event) => event.stopPropagation() },
      feEl("h3", { text: "Duplicate this recipe?" }),
      feEl("p", { text: `A copy of \u201c${f.title.trim() || "Untitled"}\u201d is added, with the same segments and silences, ready to rename.` }),
      feEl("div", { class: "row" }, cancel, confirm)));
  document.body.appendChild(overlay);
  document.addEventListener("keydown", onKey);
  confirm.focus();
}

function duplicateFormat() {
  const f = activeFormat();
  if (!f) return;
  const copy = ensureGaps({ id: newFormatId(editor.model), title: f.title + " copy", gap: f.gap, gaps: f.gaps.slice(), lead: f.lead, items: f.items.map((i) => ({ ...JSON.parse(JSON.stringify(i)), id: `r${++ROW_SEQ}` })) });
  editor.model.formats.push(copy);
  editor.activeId = copy.id;
  editor.cardMenu = false;
  commit();
  renderEditor();
}


function askDeleteFormat() {
  const f = activeFormat();
  if (!f) return;
  editor.cardMenu = false;
  renderHead();
  const rows = f.items.length;
  const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (event) => { if (event.key === "Escape") close(); };
  const cancel = feEl("button", { type: "button", id: "feDeleteCancel", onClick: close }, "Cancel");
  const confirm = feEl("button", { type: "button", class: "fe-danger-button", id: "feDeleteConfirm", onClick: () => {
    editor.model.formats = editor.model.formats.filter((x) => x.id !== f.id);
    editor.activeId = editor.model.formats.length ? editor.model.formats[0].id : null;
    close();
    if (typeof noteFormatDeleted === "function") noteFormatDeleted(f.id);
    commit();
    renderEditor();
  } }, "Delete recipe");
  const overlay = feEl("div", { class: "fe-overlay", id: "feDeleteDialog", onClick: close },
    feEl("div", { class: "fe-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Delete recipe", onClick: (e) => e.stopPropagation() },
      feEl("h3", { text: `Delete \u201c${f.title.trim() || "Untitled"}\u201d?` }),
      feEl("p", { text: `This removes the recipe and its ${rows === 1 ? "1 row" : rows + " rows"}. Playlists already in Spotify are not affected.${typeof backupMode === "function" && backupMode() === "spotify" ? " Its backup playlist in Spotify is deleted too." : " Formats can be restored from a backup if you have one."}` }),
      feEl("div", { class: "row" }, cancel, confirm)));
  document.body.appendChild(overlay);
  document.addEventListener("keydown", onKey);
  cancel.focus();
}

// ---------------------------------------------------------------- dragging rows
function startDrag(event, grip, id, index) {
  if (event.button !== undefined && event.button > 0) return;
  if (editor.panel || editor.cardMenu || editor.gapPanel !== null) {
    editor.panel = null;
    editor.gapPanel = null;
    editor.cardMenu = false;
    renderHead();
    renderRows();
    grip = document.querySelector(`#feRows .fe-row[data-id="${id}"] .fe-grip`) || grip;
  }
  const rows = Array.from(document.querySelectorAll("#feRows .fe-row"));
  const step = rows.length > 1 && rows[1].offsetTop !== rows[0].offsetTop ? rows[1].offsetTop - rows[0].offsetTop : FE_ROW_HEIGHT + FE_ROW_GAP;
  event.preventDefault();
  if (grip.setPointerCapture) { try { grip.setPointerCapture(event.pointerId); } catch (err) { /* not every browser needs it */ } }
  editor.drag = { id, from: index, to: index, startY: event.clientY, dy: 0, step, rows, count: rows.length };
  rows[index].classList.add("fe-dragging");
  $("feRows").classList.add("fe-dragging-any");
  haptic();   // the silence tags step aside while a row is being moved
}

function moveDrag(event) {
  const d = editor.drag;
  if (!d) return;
  let dy = event.clientY - d.startY;
  dy = Math.max(-d.from * d.step, Math.min((d.count - 1 - d.from) * d.step, dy));
  const to = Math.max(0, Math.min(d.count - 1, Math.round(d.from + dy / d.step)));
  d.dy = dy;
  if (to !== d.to) haptic();   // a tick each time the row takes a new place
  d.to = to;
  d.rows.forEach((row, i) => {
    if (i === d.from) { row.style.transform = `translateY(${dy}px)`; return; }
    let shift = 0;
    if (d.from < to && i > d.from && i <= to) shift = -d.step;
    if (d.from > to && i >= to && i < d.from) shift = d.step;
    row.style.transform = shift ? `translateY(${shift}px)` : "";
  });
}

function endDrag() {
  const d = editor.drag;
  if (!d) return;
  editor.drag = null;
  const f = activeFormat();
  const holder = $("feRows");
  if (holder) holder.classList.remove("fe-dragging-any");
  if (d.to === d.from || !f) {
    d.rows.forEach((row) => { row.style.transform = ""; row.classList.remove("fe-dragging"); });
    return;
  }
  // Where the dragged row is on screen right now, relative to the slot it is about to take. The other rows
  // are already sitting in their new slots, so only the dragged row should move on release.
  const offset = (d.from - d.to) * d.step + d.dy;
  const moved = f.items.splice(d.from, 1)[0];
  f.items.splice(d.to, 0, moved);
  commit();
  renderRows({ id: d.id, offset });
  renderTimeline();
}

function applySettle(holder, settle) {
  const rows = Array.from(holder.querySelectorAll(".fe-row"));
  rows.forEach((row) => row.classList.add("fe-still"));
  const dropped = rows.find((row) => row.getAttribute("data-id") === settle.id);
  if (dropped) { dropped.style.transform = `translateY(${settle.offset}px)`; dropped.classList.add("fe-dragging"); }
  const release = () => {
    rows.forEach((row) => row.classList.remove("fe-still"));
    if (dropped) { dropped.style.transform = ""; dropped.classList.remove("fe-dragging"); }
  };
  if (window.requestAnimationFrame) window.requestAnimationFrame(() => window.requestAnimationFrame(release));
  else setTimeout(release, 30);
}

// ---------------------------------------------------------------- the tour
// A walk through making one recipe, on rails: the page is dimmed and softly blurred except the one thing to tap, and only that thing works. Driver.js (vendor/, MIT)
// draws the dim and the panel; it is loaded the first time the tour starts. The step shown is worked out from the recipe itself after every change on the page,
// so a step undone (the name popup cancelled, say) goes back by itself. The two steppers have a Next button, since any number of taps is right there.
// Offered once, to someone with no recipes yet, when the app is ready; the ⋯ menu has Guided tour.
const tour = { on: false, recipeId: null, lengthDone: false, driver: null, shown: null, el: null, observer: null, frame: 0 };
const TOUR_TOTAL = 7;

function tourRecipe() {
  if (!editor.model) return null;
  const known = editor.model.formats.find((f) => f.id === tour.recipeId);
  if (known) return known;
  // not started yet, or the name popup was cancelled (its draft is gone): the recipe is whichever draft the name popup opens next
  const draft = editor.model.formats.find((f) => f.draft);
  tour.recipeId = draft ? draft.id : null;
  return draft || null;
}

function tourSegment(n) {
  const f = tourRecipe();
  return f ? f.items.filter((x) => x.kind === "seg")[n] || null : null;
}

// the playlist step of segment n: its list when open, else its playlist button
function tourPlaylistView(n, step, first) {
  const item = tourSegment(n);
  if (!item) return null;
  const row = document.querySelector(`#feRows .fe-row[data-id="${item.id}"]`);
  const list = row && row.querySelector(".fe-listpanel");
  if (list) return { el: list, side: "top", title: first ? "Pick one" : "Pick its playlist", text: first ? "Songs for this segment are selected at random from the playlist you choose." : "The new segment plays after the first one. Its length can stay as it is." };
  return { el: row && row.querySelector(".fe-main"), side: "bottom", title: first ? "Choose a playlist" : "Pick its playlist", text: first ? "This is the first segment of the recipe. Choose which of your playlists it plays." : "Tap to choose which of your playlists the new segment plays." };
}

const TOUR_STEPS = [
  { done: () => !!tourRecipe(), view: () => ({ el: $("feNewFormat"), side: "bottom", title: "Create a recipe", text: "A recipe says which of your playlists to play, in what order, and for how long. Press New recipe." }) },
  { done: () => { const f = tourRecipe(); return !!f && !f.draft; }, view: () => { const d = document.querySelector("#feNewFormatDialog .fe-nf-dialog"), f = tourRecipe(); return { el: d, arrowAt: d && d.querySelector("#feNewFormatConfirm"), side: "bottom", wait: !!d && d.classList.contains("fe-nf-typing"), title: "Name the recipe", text: `Every recipe needs a name. This one’s called ${f ? f.title : "Sample recipe"} for now. Tap Create recipe.` }; } },
  { done: () => { const s = tourSegment(0); return !!s && !!s.lists[0].name; }, view: () => tourPlaylistView(0, 3, true) },
  { done: () => tour.lengthDone, view: () => { const s = tourSegment(0); const row = s && document.querySelector(`#feRows .fe-row[data-id="${s.id}"]`); return { el: row && row.querySelector(".fe-stepper"), side: "bottom", title: "Set the segment’s length", text: "Tap + or − to choose how many minutes of music this segment plays. Tap Next when you're ready.", next: () => { tour.lengthDone = true; tourSync(); } }; } },
  { done: () => !!tourSegment(1), view: () => ({ el: $("feAddSegment"), side: "bottom", title: "Add a second segment", text: "A session can have many segments. Tap New segment." }) },
  { done: () => { const s = tourSegment(1); return !!s && !!s.lists[0].name; }, view: () => tourPlaylistView(1, 6, false) },
  { done: () => false, view: () => ({ el: $("create"), side: "bottom", title: "Build playlists from this recipe", text: "Tap Build playlists. You see the plan first, and nothing is made in Spotify until you confirm. This concludes your guided tour!" }) },
];

// The tour needs the person's playlists, so it waits for a working connection; during a wait from Spotify it says when.
function tourBlocked() {
  const pause = typeof spotifyPause === "function" ? spotifyPause() : null;
  if (pause) return "The tour can start when Spotify is back.";
  if (typeof connection === "undefined" || connection !== "ready" || !playlists.length) return "The tour can start once Spotify is connected.";
  return "";
}

// something else that needs the person took over the screen
function tourInterrupted() {
  const shown = (id) => { const el = $(id); return !!el && !el.hidden && getComputedStyle(el).display !== "none"; };
  return !!$("feSyncDialog") || !!$("fePauseDialog") || shown("createOverlay") || shown("infoOverlay") || shown("startupProblem") || shown("reconnectScreen") || document.documentElement.classList.contains("connecting");
}

function loadDriver() {
  if (window.driver && window.driver.js) return Promise.resolve(true);
  const stamp = typeof APP_VERSION === "undefined" ? "" : APP_VERSION;
  if (!document.getElementById("driverStyles")) document.head.appendChild(feEl("link", { rel: "stylesheet", id: "driverStyles", href: `vendor/driver.css?v=${stamp}` }));
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = `vendor/driver.js?v=${stamp}`;
    script.onload = () => resolve(!!(window.driver && window.driver.js));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

function tourDriver() {
  if (tour.driver) return tour.driver;
  const dark = !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  // a dark wash disappears on a dark page, so there it is a light one
  tour.driver = window.driver.js.driver({ popoverClass: "fe-tour", overlayColor: dark ? "#fff" : "#000", overlayOpacity: dark ? 0.22 : 0.55, stagePadding: 6, stageRadius: 14,
    allowClose: false, allowKeyboardControl: false, animate: false, smoothScroll: false, showButtons: [] });
  return tour.driver;
}

// one panel: a title, a few words, then the step count, Skip tour and (where the step has one) a button
function tourPanel(view, step, buttons) {
  if (view.wait) { tourDriver().highlight({ element: view.el }); tour.el = view.el; tourGeometry(); return; }   // the element alone, its panel comes later
  tourDriver().highlight({ element: view.el || undefined, popover: { title: view.title, description: view.text, side: view.side, align: "center",
    onPopoverRender: (pop) => {
      pop.footer.style.display = "flex";
      pop.footer.innerHTML = "";
      pop.footer.appendChild(feEl("span", { class: "fe-tour-count", text: step ? `${step} of ${TOUR_TOTAL}` : "" }));
      pop.footer.appendChild(feEl("span", { class: "fe-tour-btns" }, ...buttons));
    } } });
  tour.el = view.el;
  tour.arrowAt = view.arrowAt || null;
  // Driver.js focuses the panel's first button, which drew a focus ring on a button nobody had pressed: the panel itself takes the focus
  const pop = document.querySelector(".driver-popover.fe-tour");
  if (pop) { pop.setAttribute("tabindex", "-1"); pop.focus({ preventScroll: true }); }
  tourGeometry();
}

function tourSkipLink() {
  return feEl("button", { type: "button", class: "fe-tour-skip", id: "feTourSkip", onClick: () => endTour() }, "Skip tour");
}

// After any change on the page: the first step not yet done, on whatever element now stands for it (the editor redraws its rows often).
function tourSync() {
  if (!tour.on) return;
  if (tourInterrupted()) { endTour(); return; }
  const index = TOUR_STEPS.findIndex((s) => !s.done());
  const view = TOUR_STEPS[index].view();
  if (!view || !view.el) return;   // the page is between two drawings; the next change brings it back
  const key = `${index}:${view.title}:${view.wait ? "wait" : ""}`;
  if (tour.shown === key && tour.el === view.el && view.el.isConnected) return;
  tour.shown = key;
  const buttons = [tourSkipLink()];
  if (view.next) buttons.push(feEl("button", { type: "button", class: "fe-tour-next", id: "feTourNext", onClick: view.next }, "Next"));
  tourPanel(view, index + 1, buttons);
}

// Every frame while the tour is on: the blur keeps its hole over the highlighted element, and the panel's arrow points at the element's middle
// (or at the one button in it to tap), wherever the panel had to sit to fit on the screen.
function tourGeometry() {
  const blur = $("feTourBlur");
  const el = tour.el && tour.el.isConnected ? tour.el : null;
  if (blur) {
    const W = window.innerWidth, H = window.innerHeight;
    let hole = "";
    if (el) {
      const r = el.getBoundingClientRect(), pad = 6, rad = 14;
      const x = r.left - pad, y = r.top - pad, w = r.width + pad * 2, h = r.height + pad * 2, k = Math.min(rad, w / 2, h / 2);
      hole = ` M${x + k} ${y} H${x + w - k} A${k} ${k} 0 0 1 ${x + w} ${y + k} V${y + h - k} A${k} ${k} 0 0 1 ${x + w - k} ${y + h} H${x + k} A${k} ${k} 0 0 1 ${x} ${y + h - k} V${y + k} A${k} ${k} 0 0 1 ${x + k} ${y} Z`;
    }
    const clip = `path(evenodd, "M0 0 H${W} V${H} H0 Z${hole}")`;
    if (blur.style.clipPath !== clip) blur.style.clipPath = clip;
  }
  const pop = document.querySelector(".driver-popover.fe-tour");
  const arrow = pop && pop.querySelector(".driver-popover-arrow");
  if (el && arrow) {
    const t = (tour.arrowAt && tour.arrowAt.isConnected ? tour.arrowAt : el).getBoundingClientRect(), w = pop.getBoundingClientRect();
    if (/side-(left|right)/.test(arrow.className)) { arrow.style.bottom = "auto"; arrow.style.top = Math.max(16, Math.min(w.height - 16, t.top + t.height / 2 - w.top)) - 8 + "px"; }
    else { arrow.style.right = "auto"; arrow.style.left = Math.max(16, Math.min(w.width - 16, t.left + t.width / 2 - w.left)) - 8 + "px"; }
    arrow.style.margin = "0";
  }
}

function tourFrame() {
  if (!tour.on) return;
  tourGeometry();
  tour.frame = requestAnimationFrame(tourFrame);
}

async function startTour() {
  if (tour.on || tourBlocked()) return;
  if (!(await loadDriver())) return;
  closePanels();
  Object.assign(tour, { on: true, recipeId: null, lengthDone: false, shown: null, el: null });
  document.documentElement.classList.add("fe-touring");
  document.body.appendChild(feEl("div", { id: "feTourBlur", "aria-hidden": "true" }));
  tour.observer = new MutationObserver(() => requestAnimationFrame(tourSync));
  tour.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class"] });
  document.addEventListener("click", tourBuildClick, true);
  tourSync();
  tour.frame = requestAnimationFrame(tourFrame);
}

// Build is the last step: the tour ends there, and the build popup takes over
function tourBuildClick(event) {
  if (tour.on && event.target.closest && event.target.closest("#create")) setTimeout(endTour, 0);
}

function endTour() {
  if (tour.observer) tour.observer.disconnect();
  tour.observer = null;
  cancelAnimationFrame(tour.frame);
  document.removeEventListener("click", tourBuildClick, true);
  const wasOn = tour.on;
  tour.on = false;
  tour.el = null;
  tour.shown = null;
  if (tour.driver) tour.driver.destroy();
  tour.driver = null;
  const blur = $("feTourBlur");
  if (blur) blur.remove();
  document.documentElement.classList.remove("fe-touring");
  if (wasOn && editor.model) renderEditor();
}

// The offer, once on this device, to someone who has no recipes yet, when the app is ready and nothing else is on screen.
async function maybeOfferTour() {
  try { if (localStorage.getItem("tourOffered")) return; } catch (err) { return; }
  if (tour.on || tourBlocked() || tourInterrupted() || !editor.model || editor.model.formats.some((f) => !f.draft)) return;
  if (!(await loadDriver()) || tourInterrupted()) return;
  try { localStorage.setItem("tourOffered", "1"); } catch (err) { /* offered again next time */ }
  document.documentElement.classList.add("fe-touring");
  document.body.appendChild(feEl("div", { id: "feTourBlur", "aria-hidden": "true" }));
  const close = () => { tourDriver().destroy(); tour.driver = null; const blur = $("feTourBlur"); if (blur) blur.remove(); document.documentElement.classList.remove("fe-touring"); };
  tourPanel({ title: "Would you like a guided tour?", text: "This walks you through creating a new recipe and building your first set of playlists from it, start to finish, in about a minute. You can take the tour any time from the ⋯ menu." }, 0, [
    feEl("button", { type: "button", class: "fe-tour-later", id: "feTourLater", onClick: close }, "Nah, I’ll figure it out"),
    feEl("button", { type: "button", class: "fe-tour-next", id: "feTourStart", onClick: () => { close(); startTour(); } }, "Yes, hold my hand!"),
  ]);
  const pop = document.querySelector(".driver-popover.fe-tour");
  if (pop) pop.classList.add("fe-tour-offer");   // its two answers are long, so they are stacked, the yes on top
}

// from the menu: the tour, or why it cannot start yet
function takeTour() {
  const why = tourBlocked();
  if (why) { showNotices([{ text: why, transient: true }]); return; }
  startTour();
}

// ---------------------------------------------------------------- what the rest of the page asks
function blankSegmentReport(keys) {
  // formats that still have a segment with no playlist chosen
  const report = [];
  const model = textToModel($("formats").value, true);
  for (const f of model.formats) {
    if (keys && !keys.includes(f.id)) continue;
    const blanks = f.items.filter((i) => i.lists.some((l) => !l.name.trim())).length;
    if (blanks) report.push({ title: f.title.trim() || "Untitled", count: blanks });
  }
  return report;
}
