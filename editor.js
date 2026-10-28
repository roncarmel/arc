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
  download: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>',
  restore: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V5M7 9l5-5 5 5M5 20h14"/></svg>',
  unplug: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/><path d="M4 4l16 16"/></svg>',
  check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  reset: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/></svg>',
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
  return playlists.filter((p) => (p.owner === (me && me.id) || p.collaborative) && !p.madeByApp && !patterns.some((re) => re.test(p.name)));
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
function commit() {
  const text = modelToText(editor.model);
  editor.internal = true;
  $("formats").value = text;
  $("formats").dispatchEvent(new Event("input", { bubbles: true }));
  editor.internal = false;
}

function syncEditorFromText() {
  try {
    editor.model = textToModel($("formats").value, true);
    editor.broken = "";
  } catch (err) {
    editor.model = null;
    editor.broken = String(err.message || err);
  }
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
  // tapping anywhere else, or pressing Escape, closes an open menu or list
  document.addEventListener("click", (event) => {
    if (!editor.panel && !editor.cardMenu && editor.gapPanel === null && !editor.appMenu) return;
    if (event.target.closest && event.target.closest(".fe-pop, .fe-trigger")) return;
    closePanels();
  }, true);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && (editor.panel || editor.cardMenu || editor.gapPanel !== null || editor.appMenu)) closePanels(); });
  window.addEventListener("resize", equalizeAmounts);   // the widget changes size when the page goes between phone and wide layouts
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
  if (editor.model) renderRows();
}

// ---------------------------------------------------------------- drawing
function renderEditor() {
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
    feEl("button", { type: "button", class: "fe-newformat", id: "feNewFormat", "aria-label": "New format", title: "New format", onClick: askNewFormat }, feIcon("plus"), feEl("span", { class: "fe-newformat-label", text: "New format" })),
    feEl("div", { class: "fe-appmenuwrap", id: "feAppMenu" })));
  $("feTabs").addEventListener("scroll", updateTabFade);
  renderTabs();
  renderAppMenu();
  // the menu button was not there yet when the tabs were drawn, so the tabs have less room than they were scrolled for
  scrollSelectedTab();
  updateTabFade();
  if (!format) {   // no formats: the New format button, and what to do with it
    root.appendChild(feEl("p", { class: "muted fe-emptynote", id: "feEmptyNote", text: "Tap New format to create your first format, then add as many segments to it as you like." }));
    if (typeof updateButtons === "function") updateButtons();
    return;
  }
  const card = feEl("div", { class: "fe-card", id: "feCard" },
    feEl("p", { class: "fe-warn", id: "feClash", hidden: true }),   // about the name, so it stays at the top, near the tab
    feEl("div", { class: "fe-barwrap" },
      feEl("div", { class: "fe-bar", id: "feBar", role: "img", "aria-label": "Shape of one playlist" }),
      feEl("div", { class: "fe-caption", id: "feCaption" })),
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
    feEl("p", { text: "Your saved formats could not be read, so they can't be shown." }),
    feEl("p", { class: "muted", text: editor.broken }),
    feEl("div", { class: "row" },
      feEl("button", { type: "button", id: "feSaveBroken", onClick: () => saveFile(`playlist-formats-unreadable-${fileStamp()}.txt`, $("formats").value) }, "Download the saved text"),
      feEl("button", { type: "button", class: "primary", id: "feStartOver", onClick: () => { setFormatsText(DEFAULT_FORMATS); } }, "Start over")));
}

// ---------------------------------------------------------------- the app-level menu
// Minimalist mode is a saved setting (more of the page will respond to it over time); for now it only records the choice and puts "minimal" on the page.
function minimalMode() {
  try { return localStorage.getItem("minimalMode") === "1"; } catch (err) { return false; }
}

// Minimalist mode becomes available once Spotify has connected for the first time, and it applies whenever the editor is on the page.
// Step 1 stays hidden then, whether or not Spotify is connected: connecting, trying again and connecting again are done from the
// app menu and the Create button instead.
function hasConnectedBefore() {
  try { return localStorage.getItem("connectedBefore") === "1"; } catch (err) { return false; }
}

function minimalActive() {
  return minimalMode() && hasConnectedBefore() && document.body.classList.contains("has-editor");
}

function applyMinimalMode() {
  document.body.classList.toggle("minimal", minimalActive());
  if (typeof scrollSelectedTab === "function") scrollSelectedTab();   // the icon changes how much room the tabs have, so keep the selected one in view
  if (typeof updateTabFade === "function") updateTabFade();
  if (typeof updateButtons === "function") updateButtons();   // Create turns into a connect button while minimal and not connected
}

function toggleMinimal() {
  if (!hasConnectedBefore()) return;
  try { localStorage.setItem("minimalMode", minimalMode() ? "0" : "1"); } catch (err) { /* the choice just does not last */ }
  applyMinimalMode();
  editor.appMenu = false;   // the menu closes; the checkbox shows the new state the next time it opens
  renderAppMenu();
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
    type: "button", class: "fe-iconbtn fe-trigger" + (connection === "problem" ? " fe-alert" : ""), id: "feAppMenuButton",
    "aria-label": connection === "problem" ? "App menu, there is a Spotify problem" : "App menu", "aria-haspopup": "menu", "aria-expanded": String(editor.appMenu),
    onClick: toggleAppMenu,
  }, feIcon("dots")));
  if (!editor.appMenu) return;
  const choose = (action) => () => { editor.appMenu = false; renderAppMenu(); action(); };
  const on = minimalMode();
  const backupLabel = ($("backupStatus") && $("backupStatus").textContent) || "";   // the same label as in the backup step, which minimalist mode hides
  const available = hasConnectedBefore();
  const box = feEl("span", { class: "fe-check" + (on ? " fe-check-on" : ""), "aria-hidden": "true" });
  if (on) box.appendChild(feIcon("check"));
  // Connecting from the menu: with a saved Client ID, Connect Spotify; and, in minimalist mode where Step 1 is hidden, the way out of a problem.
  const reconnect = connectionKind === "reconnect";
  const connectItems = [];
  if (connection === "none" && localStorage.getItem("clientId")) {
    connectItems.push(feEl("button", { type: "button", class: "fe-item", id: "feConnect", role: "menuitem", onClick: choose(() => startLogin()) }, feIcon("link"), "Connect Spotify"));
  } else if (connection === "problem" && minimalActive()) {
    connectItems.push(feEl("button", { type: "button", class: "fe-item", id: reconnect ? "feReconnect" : "feRetry", role: "menuitem", onClick: choose(() => (reconnect ? startLogin() : connectToSpotify())) }, feIcon(reconnect ? "link" : "retry"), reconnect ? "Connect again" : "Try again"));
    connectItems.push(feEl("div", { class: "fe-itemnote", id: "feConnectionNote", text: $("connectionMessage").textContent }));
  }
  const minimalButton = feEl("button", { type: "button", class: "fe-item", id: "feMinimal", role: "menuitemcheckbox", "aria-checked": String(on), onClick: toggleMinimal }, box, "Minimalist mode");
  if (!available) minimalButton.disabled = true;
  slot.appendChild(feEl("div", { class: "fe-pop fe-appmenu", id: "feAppMenuPanel", role: "menu" },
    ...connectItems,
    ...(connectItems.length ? [feEl("div", { class: "fe-rule" })] : []),
    minimalButton,
    ...(!available ? [feEl("div", { class: "fe-itemnote", id: "feMinimalNote", text: "Available after you first connect to Spotify." })] : []),
    feEl("div", { class: "fe-rule" }),
    feEl("button", { type: "button", class: "fe-item", id: "feBackup", role: "menuitem", onClick: choose(() => { downloadBackup(); showBackupMessage("Backup downloaded. Look for it in your Downloads folder."); }) }, feIcon("download"), "Download a backup"),
    ...(backupLabel ? [feEl("div", { class: "fe-itemnote", id: "feBackupStatus", text: backupLabel })] : []),
    feEl("button", { type: "button", class: "fe-item", id: "feRestore", role: "menuitem", onClick: choose(() => $("restoreFile").click()) }, feIcon("restore"), "Restore from backup"),
    ...(connection === "ready" ? [feEl("div", { class: "fe-rule" }), feEl("button", { type: "button", class: "fe-item", id: "feDisconnect", role: "menuitem", onClick: choose(() => disconnect()) }, feIcon("unplug"), "Disconnect Spotify")] : [])));
}

// A menu, list or card that would run off the bottom of the screen opens upward instead (or, if there is no more room above,
// stays below and is scrolled into view).
function fitPops() {
  const margin = 8;
  document.querySelectorAll("#formatEditor .fe-pop").forEach((pop) => {
    pop.classList.remove("fe-up");
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
        type: "button", class: "fe-tab", "aria-pressed": "true", "data-id": f.id, title: "Rename format", onClick: startRename,
      }, f.title.trim() || "Untitled", feIcon("pencil")));
    } else {
      tabs.appendChild(feEl("button", {
        type: "button", class: "fe-tab", "aria-pressed": "false", "data-id": f.id,
        onClick: () => { editor.activeId = f.id; editor.panel = null; editor.gapPanel = null; editor.cardMenu = false; editor.appMenu = false; renderEditor(); },
      }, f.title.trim() || "Untitled"));
    }
  }
  scrollSelectedTab();
  updateTabFade();
}

function renameTab(f) {
  const input = feEl("input", { type: "text", id: "feName", class: "fe-tab-input", value: f.title, autocomplete: "off", "aria-label": "Name of format", enterkeyhint: "done" });
  input.value = f.title;
  const fit = () => { input.style.width = Math.max(6, input.value.length + 1) + "ch"; };
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
  return feEl("div", { class: "fe-tab fe-tab-editing", "aria-pressed": "true", "data-id": f.id }, input);
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

// The tabs are one row that scrolls sideways. The selected one is kept in view, and a soft fade on an edge says there is more that way.
function scrollSelectedTab() {
  const strip = $("feTabs");
  const tab = strip && strip.querySelector('.fe-tab[aria-pressed="true"]');
  if (!tab) return;
  const room = 28;
  if (tab.offsetLeft - room < strip.scrollLeft) strip.scrollLeft = Math.max(0, tab.offsetLeft - room);
  else if (tab.offsetLeft + tab.offsetWidth + room > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = tab.offsetLeft + tab.offsetWidth + room - strip.clientWidth;
}

function updateTabFade() {
  const strip = $("feTabs");
  if (!strip) return;
  strip.classList.toggle("fe-fade-left", strip.scrollLeft > 2);
  strip.classList.toggle("fe-fade-right", strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2);
}

function renderHead(rebuild) {
  const head = $("feHead");
  const f = activeFormat();
  if (!head || !f) return;
  if (rebuild || !$("feGapValue")) {
    head.innerHTML = "";
    head.appendChild(feEl("div", { class: "fe-headrow" },
      feEl("div", { class: "fe-silence", title: "Silence between segments" },
        feIcon("mute"),
        feEl("span", { class: "fe-silence-label", text: "Silence between segments" }),
        stepperBox({
          shorterId: "feGapShorter", longerId: "feGapLonger", valueId: "feGapValue", inline: true, width: 46,
          text: f.gap ? describeSeconds(f.gap) : "None", shorterLabel: "Shorter silence between segments", longerLabel: "Longer silence between segments",
          onShorter: () => { const lower = GAP_STEPS.filter((s) => s < f.gap); f.gap = lower.length ? lower[lower.length - 1] : 0; afterGapChange(); },
          onLonger: () => { const higher = GAP_STEPS.filter((s) => s > f.gap); f.gap = higher.length ? higher[0] : GAP_STEPS[GAP_STEPS.length - 1]; afterGapChange(); },
        })),
      feEl("button", { type: "button", class: "fe-iconbtn", id: "feDuplicate", "aria-label": "Duplicate format", title: "Duplicate format", onClick: askDuplicateFormat }, feIcon("copy")),
      feEl("button", { type: "button", class: "fe-iconbtn fe-danger", id: "feDelete", "aria-label": "Delete format", title: "Delete format", onClick: askDeleteFormat }, feIcon("trash"))));
    renderClash();
  }
  $("feGapValue").textContent = f.gap ? describeSeconds(f.gap) : "None";
}

function renderClash() {
  const f = activeFormat();
  const note = $("feClash");
  if (!f || !note) return;
  const clash = editor.model.formats.some((x) => x.id !== f.id && normName(x.title) === normName(f.title));
  note.hidden = !clash;
  note.textContent = clash ? "Another format has this name. Playlists from both would be treated as one set when replacing." : "";
}

function renderTimeline() {
  const f = activeFormat();
  const bar = $("feBar");
  const caption = $("feCaption");
  if (!f || !bar) return;
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
  caption.textContent = `${Math.round(music * 10) / 10} min of music` + (quiet ? ` + ${describeSeconds(quiet)} of silence` : "");
  applyHighlight();
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

function renderRows(settle) {
  const f = activeFormat();
  const holder = $("feRows");
  if (!f || !holder) return;
  editor.hover = null;   // the old elements are gone, so whatever was under the pointer no longer is
  holder.innerHTML = "";
  f.items.forEach((item, index) => holder.appendChild(rowEl(f, item, index)));
  equalizeAmounts();
  holder.appendChild(feEl("button", { type: "button", class: "fe-add", id: "feAddSegment", onClick: addSegment }, feIcon("plus"), "New segment"));
  const rootEl = $("formatEditor");
  if (rootEl) rootEl.classList.toggle("fe-hastags", f.items.some((x, index) => gapInfo(f, index + 1).show));
  if (settle) applySettle(holder, settle);
  applyHighlight();
  fitPops();
}

function rowEl(f, item, index) {
  const mixed = item.lists.length > 1;
  const open = editor.panel && editor.panel.id === item.id ? editor.panel.mode : null;
  const g = index + 1;
  const tag = gapInfo(f, g);
  const wrap = feEl("div", { class: "fe-row" + (open || (tag.show && editor.gapPanel === g) ? " fe-open" : ""), "data-id": item.id, "data-index": String(index) });
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
  const key = `gap${g}`;
  const kind = info.zero ? "zero" : info.custom ? "custom" : "default";
  const where = info.interior ? "Silence between these segments" : "Silence after the last segment";
  const open = editor.gapPanel === g;
  const button = feEl("button", {
    type: "button", class: `fe-tag fe-trigger fe-tag-${kind}`, "data-id": key, "aria-expanded": String(open),
    "aria-label": `${where}: ${info.zero ? "none" : describeSeconds(info.sec)}. Tap to change.`,
    onClick: () => { editor.gapPanel = open ? null : g; editor.panel = null; editor.cardMenu = false; editor.appMenu = false; editor.search = ""; renderAppMenu(); renderHead(); renderRows(); },
  }, feIcon("mute"), feEl("span", { class: "fe-tag-text", text: shortSeconds(info.sec) }));
  button.addEventListener("mouseenter", () => { editor.hover = key; applyHighlight(); });
  button.addEventListener("mouseleave", () => { editor.hover = null; applyHighlight(); });
  return button;
}

function stepperBox({ text, onShorter, onLonger, shorterLabel, longerLabel, shorterId, longerId, valueId, inline, width }) {
  return feEl("div", { class: "fe-stepper" + (inline ? " fe-stepper-inline" : "") },
    feEl("button", { type: "button", class: "fe-step", id: shorterId, "aria-label": shorterLabel, onClick: onShorter }, feIcon("minus")),
    feEl("span", { class: "fe-amount", id: valueId, text, style: `min-width:${width}px` }),
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
  // beside the length: Default (back to the default) where there is one, Remove where there is not, and a quiet "(default)" while it matches
  const slot = feEl("div", { class: "fe-tagslot" + (info.hasDefault ? " fe-tagslot-default" : "") });
  if (info.hasDefault && info.custom) {
    slot.appendChild(feEl("button", { type: "button", class: "fe-linkbutton", id: "feTagReset", "aria-label": `Set to the default, ${describeSeconds(f.gap)}`, onClick: () => { editor.gapPanel = null; setGap(g, undefined); } }, feIcon("reset"), "Default"));
  } else if (info.hasDefault) {
    slot.appendChild(feEl("span", { class: "fe-tagdefault", id: "feTagDefault", text: "(default)" }));
  } else {
    slot.appendChild(feEl("button", { type: "button", class: "fe-linkbutton", id: "feTagRemove", "aria-label": "Remove this silence", onClick: () => { editor.gapPanel = null; setGap(g, undefined); } }, feIcon("trash"), "Remove"));
  }
  return feEl("div", { class: "fe-pop fe-tagpanel", id: "feTagPanel" },
    feEl("div", { class: "fe-tagtitle", text: "Silence for\u2026" }),
    feEl("div", { class: "fe-tagrow" },
      stepperBox({ shorterId: "feTagShorter", longerId: "feTagLonger", valueId: "feTagDuration", inline: true, width: 54,
        text: info.zero ? "None" : describeSeconds(info.sec), shorterLabel: "Shorter silence", longerLabel: "Longer silence", onShorter: shorter, onLonger: longer }),
      slot));
}

function setGap(g, value) {
  const f = activeFormat();
  if (!f) return;
  ensureGaps(f);
  f.gaps[g] = value;
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
    pop.appendChild(feEl("button", {
      type: "button", class: "fe-item", id: "feAddMix",
      onClick: () => {
        const used = item.lists[0].name;
        const other = readablePlaylists().find((p) => normName(p.name) !== normName(used));
        item.lists = [{ name: used, weight: 50 }, { name: other ? other.name : "", weight: 50 }];
        editor.panel = { id: item.id, mode: "mix" };
        commit(); renderRows(); renderTimeline();
      },
    }, feIcon("plus"), "Add a mix"));
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
  // a silence can be added after this segment wherever there is none yet
  if (!gapInfo(f, index + 1).show) {
    pop.appendChild(feEl("button", {
      type: "button", class: "fe-item", id: "feAddSilence",
      onClick: () => { ensureGaps(f); f.gaps[index + 1] = 30; editor.panel = null; afterGapChange(); },
    }, feIcon("mute"), "Add silence after"));
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
  item.lists = [{ name: item.lists[0].name, weight: 1 }];
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

  const choose = (name) => {
    item.lists[slot].name = name;
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
        disabled: taken ? true : undefined, onClick: () => choose(p.name),
      }, coverEl(p.name, 32),
      feEl("span", { class: "fe-text" }, feEl("span", { class: "fe-title", text: p.name }),
        feEl("span", { class: "fe-sub", text: taken ? "Already in this mix" : (typeof p.count === "number" ? `${p.count} songs` : "") }))));
    }
    if (!shown) list.appendChild(feEl("p", { class: "muted", style: "margin:8px", text: playlists.length ? "No playlists match." : (connection === "problem" ? "Your playlists could not be loaded. See Step 1." : connection === "none" ? "Connect to Spotify in Step 1 to see your playlists." : "Your playlists are still loading.") }));
  };
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
  if (!f) return;
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

// The + button asks first, since it sits close to the menu button and a stray tap would otherwise add a format.
function askNewFormat() {
  closePanels();
  if (!editor.model.formats.length) { addFormat(); return; }   // nothing to mistake it for when there are no formats
  const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (event) => { if (event.key === "Escape") close(); };
  const cancel = feEl("button", { type: "button", id: "feNewFormatCancel", onClick: close }, "Cancel");
  const confirm = feEl("button", { type: "button", class: "primary", id: "feNewFormatConfirm", onClick: () => { close(); addFormat(); } }, "Create format");
  const overlay = feEl("div", { class: "fe-overlay", id: "feNewFormatDialog", onClick: close },
    feEl("div", { class: "fe-dialog", role: "dialog", "aria-modal": "true", "aria-label": "New format", onClick: (e) => e.stopPropagation() },
      feEl("h3", { text: "Create a new format?" }),
      feEl("p", { text: "It starts with one empty segment, ready to rename and fill in." }),
      feEl("div", { class: "row" }, cancel, confirm)));
  document.body.appendChild(overlay);
  document.addEventListener("keydown", onKey);
  confirm.focus();
}

function addFormat() {
  const taken = new Set(editor.model.formats.map((f) => normName(f.title)));
  let number = 1;
  while (taken.has(normName(`Format ${number}`))) number += 1;
  const title = `Format ${number}`;
  const fresh = newBlankFormat(editor.model, title);
  editor.model.formats.push(fresh);
  editor.activeId = fresh.id;
  editor.panel = null;
  editor.gapPanel = null;
  editor.cardMenu = false;
  commit();
  renderEditor();
}

function askDuplicateFormat() {
  const f = activeFormat();
  if (!f) return;
  closePanels();
  const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (event) => { if (event.key === "Escape") close(); };
  const cancel = feEl("button", { type: "button", id: "feDuplicateCancel", onClick: close }, "Cancel");
  const confirm = feEl("button", { type: "button", class: "primary", id: "feDuplicateConfirm", onClick: () => { close(); duplicateFormat(); } }, "Duplicate format");
  const overlay = feEl("div", { class: "fe-overlay", id: "feDuplicateDialog", onClick: close },
    feEl("div", { class: "fe-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Duplicate format", onClick: (event) => event.stopPropagation() },
      feEl("h3", { text: "Duplicate this format?" }),
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
    commit();
    renderEditor();
  } }, "Delete format");
  const overlay = feEl("div", { class: "fe-overlay", id: "feDeleteDialog", onClick: close },
    feEl("div", { class: "fe-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Delete format", onClick: (e) => e.stopPropagation() },
      feEl("h3", { text: `Delete \u201c${f.title.trim() || "Untitled"}\u201d?` }),
      feEl("p", { text: `This removes the format and its ${rows === 1 ? "1 row" : rows + " rows"}. Playlists already in Spotify are not affected. Formats can be restored from a backup if you have one.` }),
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
  $("feRows").classList.add("fe-dragging-any");   // the silence tags step aside while a row is being moved
}

function moveDrag(event) {
  const d = editor.drag;
  if (!d) return;
  let dy = event.clientY - d.startY;
  dy = Math.max(-d.from * d.step, Math.min((d.count - 1 - d.from) * d.step, dy));
  const to = Math.max(0, Math.min(d.count - 1, Math.round(d.from + dy / d.step)));
  d.dy = dy;
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
