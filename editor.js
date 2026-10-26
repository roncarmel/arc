// editor.js: the visual editor for formats.
//
// People edit a list of formats on screen. Every change is written back into the hidden formats text
// ($("formats")) in the form the engine reads, and the page is told with an ordinary "input" event, so
// everything else (previews, backups, saving) works on that text exactly as before.
// formats.js does the reading and writing of that text. This file draws and handles the screen.

const FE_COLORS = ["#f2b45a", "#6f93e8", "#b78be0", "#ee7e87", "#7fc4b0", "#a3acbb"];
const FE_ROW_HEIGHT = 56;
const FE_ROW_GAP = 6;

const editor = {
  model: null,        // { formats: [...] }, or null when the saved text could not be read
  broken: "",         // why it could not be read
  activeId: null,
  panel: null,        // { id, mode } mode: "menu" | "mix" | "list-a" | "list-b"
  cardMenu: false,
  internal: false,    // true while the editor itself is writing the text
  drag: null,
  search: "",
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

function feRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// the same hue, a little darker
function feDarken(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * 0.72));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// diagonal stripes running from lower left to upper right; each stripe is as thick as its share of the mix
function feStripes(hex, shareA, period) {
  const a = Math.max(1.5, Math.round(period * shareA * 10) / 10);
  const dark = feDarken(hex);
  return `repeating-linear-gradient(135deg, ${hex} 0, ${hex} ${a}px, ${dark} ${a}px, ${dark} ${period}px)`;
}

function activeFormat() {
  return editor.model ? editor.model.formats.find((f) => f.id === editor.activeId) || null : null;
}

// ---------------------------------------------------------------- the playlists people can choose from
function readablePlaylists() {
  // playlists the app is allowed to read, leaving out the ones this app made from the formats
  const titles = editor.model ? editor.model.formats.map((f) => nameFromTitle(f.title)) : [];
  const patterns = titles.map((name) => {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{n\\\}/g, "\\d+").replace(/\\\{letter\\\}/g, "[a-z]+");
    return new RegExp("^" + esc + "$", "i");
  });
  return playlists.filter((p) => (p.owner === (me && me.id) || p.collaborative) && !patterns.some((re) => re.test(p.name)));
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
  editor.cardMenu = false;
  renderEditor();
}

function initEditor() {
  $("formats").addEventListener("input", () => { if (!editor.internal) syncEditorFromText(); });
  // tapping anywhere else, or pressing Escape, closes an open menu or list
  document.addEventListener("click", (event) => {
    if (!editor.panel && !editor.cardMenu) return;
    if (event.target.closest && event.target.closest(".fe-pop, .fe-trigger")) return;
    closePanels();
  }, true);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && (editor.panel || editor.cardMenu)) closePanels(); });
  syncEditorFromText();
}

function closePanels() {
  editor.panel = null;
  editor.cardMenu = false;
  renderHead();
  renderRows();
}

function focusSearchBox() {
  // On a phone, focusing the box would open the keyboard over the list, so only do it with a mouse.
  const fine = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
  const box = document.querySelector("#feRows .fe-search");
  if (fine && box && box.focus) { try { box.focus({ preventScroll: true }); } catch (err) { box.focus(); } }
}

function editorPlaylistsChanged() {
  if (editor.model) renderRows();
}

// ---------------------------------------------------------------- drawing
function renderEditor() {
  const root = $("formatEditor");
  if (!root) return;
  root.innerHTML = "";
  if (editor.broken) { root.appendChild(brokenView()); return; }
  root.appendChild(feEl("div", { class: "fe-tabs", id: "feTabs" }));
  renderTabs();
  const format = activeFormat();
  if (!format) {
    root.appendChild(feEl("div", { class: "fe-empty" },
      feEl("p", { text: "You don't have any formats yet." }),
      feEl("button", { type: "button", class: "primary", id: "feCreateFirst", onClick: addFormat }, "Create a format")));
    return;
  }
  const card = feEl("div", { class: "fe-card", id: "feCard" },
    feEl("div", { id: "feHead" }),
    feEl("div", { class: "fe-barwrap" },
      feEl("div", { class: "fe-bar", id: "feBar", role: "img", "aria-label": "Shape of one playlist" }),
      feEl("div", { class: "fe-caption", id: "feCaption" })),
    feEl("div", { class: "fe-rows", id: "feRows" }));
  root.appendChild(card);
  renderHead(true);
  renderTimeline();
  renderRows();
}

function brokenView() {
  return feEl("div", { class: "fe-empty", id: "feBroken" },
    feEl("p", { text: "Your saved formats could not be read, so they can't be shown." }),
    feEl("p", { class: "muted", text: editor.broken }),
    feEl("div", { class: "row" },
      feEl("button", { type: "button", id: "feSaveBroken", onClick: () => saveFile(`playlist-formats-unreadable-${fileStamp()}.txt`, $("formats").value) }, "Download the saved text"),
      feEl("button", { type: "button", class: "primary", id: "feStartOver", onClick: () => { setFormatsText(DEFAULT_FORMATS); } }, "Start over")));
}

function renderTabs() {
  const tabs = $("feTabs");
  if (!tabs) return;
  tabs.innerHTML = "";
  for (const f of editor.model.formats) {
    tabs.appendChild(feEl("button", {
      type: "button", class: "fe-tab", "aria-pressed": String(f.id === editor.activeId), "data-id": f.id,
      onClick: () => { editor.activeId = f.id; editor.panel = null; editor.cardMenu = false; renderEditor(); },
    }, f.title.trim() || "Untitled"));
  }
  tabs.appendChild(feEl("button", { type: "button", class: "fe-newformat", id: "feNewFormat", onClick: addFormat }, feIcon("plus"), "New format"));
}

function renderHead(rebuildInput) {
  const head = $("feHead");
  const f = activeFormat();
  if (!head || !f) return;
  let input = $("feName");
  if (rebuildInput || !input) {
    head.innerHTML = "";
    input = feEl("input", { type: "text", id: "feName", value: f.title, autocomplete: "off" });
    input.value = f.title;
    input.addEventListener("input", () => {
      const cleaned = cleanTitle(input.value);
      if (cleaned !== input.value) input.value = cleaned;
      f.title = cleaned;
      commit();
      renderTabs();
      renderClash();
    });
    head.appendChild(feEl("div", { class: "fe-headrow" },
      feEl("label", { class: "fe-namefield" }, feEl("span", { text: "Name of format" }), input),
      feEl("div", { class: "fe-menuwrap" },
        feEl("button", { type: "button", class: "fe-iconbtn fe-trigger", id: "feCardMenuButton", "aria-label": "Format options", "aria-expanded": String(editor.cardMenu), onClick: toggleCardMenu }, feIcon("dots")),
        feEl("div", { id: "feCardMenuSlot" }))));
    head.appendChild(feEl("p", { class: "fe-warn", id: "feClash", hidden: true }));
    renderClash();
  }
  const button = $("feCardMenuButton");
  if (button) button.setAttribute("aria-expanded", String(editor.cardMenu));
  const slot = $("feCardMenuSlot");
  if (slot) {
    slot.innerHTML = "";
    if (editor.cardMenu) {
      slot.appendChild(feEl("div", { class: "fe-pop fe-cardmenu", id: "feCardMenu" },
        feEl("button", { type: "button", class: "fe-item", id: "feDuplicate", onClick: duplicateFormat }, feIcon("copy"), "Duplicate format"),
        feEl("button", { type: "button", class: "fe-item fe-danger", id: "feDelete", onClick: askDeleteFormat }, feIcon("trash"), "Delete format")));
    }
  }
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
  bar.innerHTML = "";
  for (const item of f.items) {
    if (item.kind === "silence") {
      bar.appendChild(feEl("div", { class: "fe-piece fe-piece-silence", style: `flex:${Math.max(item.seconds / 60, 0.7)} 1 0` }));
    } else {
      const hex = FE_COLORS[item.color % FE_COLORS.length];
      const mixed = item.lists.length > 1;
      bar.appendChild(feEl("div", { class: "fe-piece", style: `flex:${item.minutes} 1 0;` + (mixed ? `background-image:${feStripes(hex, mixPercentA(item) / 100, 16)}` : `background:${hex}`) }));
    }
  }
  const music = f.items.filter((i) => i.kind === "seg").reduce((n, i) => n + i.minutes, 0);
  const quiet = f.items.filter((i) => i.kind === "silence").reduce((n, i) => n + i.seconds, 0);
  caption.textContent = `${Math.round(music * 10) / 10} min of music` + (quiet ? ` + ${describeSeconds(quiet)} of silence` : "");
}

function renderRows(settle) {
  const f = activeFormat();
  const holder = $("feRows");
  if (!f || !holder) return;
  holder.innerHTML = "";
  let clock = 0;
  f.items.forEach((item, index) => {
    holder.appendChild(rowEl(f, item, index, clock));
    clock += item.kind === "seg" ? item.minutes : item.seconds / 60;
  });
  holder.appendChild(feEl("button", { type: "button", class: "fe-add", id: "feAddSegment", onClick: addSegment }, feIcon("plus"), "New segment"));
  if (settle) applySettle(holder, settle);
}

function rowEl(f, item, index, startsAt) {
  const seg = item.kind === "seg";
  const mixed = seg && item.lists.length > 1;
  const hex = seg ? FE_COLORS[item.color % FE_COLORS.length] : "#8a8a92";
  const open = editor.panel && editor.panel.id === item.id ? editor.panel.mode : null;
  const wrap = feEl("div", { class: "fe-row" + (open ? " fe-open" : ""), "data-id": item.id, "data-index": String(index) });
  const card = feEl("div", { class: "fe-rowcard" + (seg ? "" : " fe-rowcard-silence"), style: seg ? `background:${feRgba(hex, 0.17)};border-color:${feRgba(hex, 0.55)}` : "" });

  const grip = feEl("button", { type: "button", class: "fe-grip", "aria-label": "Drag to reorder" }, feIcon("grip"));
  grip.addEventListener("pointerdown", (event) => startDrag(event, grip, item.id, index));
  grip.addEventListener("pointermove", moveDrag);
  grip.addEventListener("pointerup", endDrag);
  grip.addEventListener("pointercancel", endDrag);
  card.appendChild(grip);

  // the playlist (or silence) button
  let cover;
  let title;
  let sub;
  let warn = false;
  if (!seg) {
    cover = feEl("span", { class: "fe-cover fe-cover-silence" }, feIcon("mute"));
    title = "Silence";
    sub = `starts at ${describeClock(startsAt)}`;
  } else if (mixed) {
    cover = feEl("span", { class: "fe-cover", style: `background-image:${feStripes(hex, mixPercentA(item) / 100, 12)}` });
    title = item.lists.map((l) => l.name || "…").join(" + ");
    sub = item.lists.length === 2 ? `${mixPercentA(item)}% / ${100 - mixPercentA(item)}% mix` : `${item.lists.length}-playlist mix`;
  } else {
    const name = item.lists[0].name;
    cover = coverEl(name, 34);
    title = name || "Choose a playlist";
    sub = playlistSub(name);
    warn = !!name && !playlistInfo(name) && playlists.length > 0;
  }
  const main = feEl("button", {
    type: "button", class: "fe-main fe-trigger" + (seg && !item.lists[0].name && !mixed ? " fe-main-empty" : ""),
    "aria-expanded": String(open === "list-a" || open === "mix"), "aria-label": `Playlist: ${title}`,
    onClick: () => setPanel(item.id, open ? null : (mixed ? "mix" : "list-a")),
  }, cover,
  feEl("span", { class: "fe-text" }, feEl("span", { class: "fe-title", text: title }), feEl("span", { class: "fe-sub" + (warn ? " fe-sub-warn" : ""), text: sub })),
  feIcon("chevron"));
  card.appendChild(main);

  // the length
  const unit = seg ? "min" : "";
  const amount = seg ? `${Math.round(item.minutes * 10) / 10} min` : describeSeconds(item.seconds);
  card.appendChild(feEl("div", { class: "fe-stepper" },
    feEl("button", { type: "button", class: "fe-step fe-dec", "aria-label": "Shorter", onClick: () => stepItem(item, -1) }, feIcon("minus")),
    feEl("span", { class: "fe-amount", text: amount, "data-unit": unit }),
    feEl("button", { type: "button", class: "fe-step fe-inc", "aria-label": "Longer", onClick: () => stepItem(item, 1) }, feIcon("plus"))));

  card.appendChild(feEl("button", {
    type: "button", class: "fe-more fe-trigger", "aria-label": "More options", "aria-expanded": String(open === "menu"),
    onClick: () => setPanel(item.id, open === "menu" ? null : "menu"),
  }, feIcon("dots")));
  wrap.appendChild(card);

  if (open === "menu") wrap.appendChild(menuPanel(f, item));
  if (open === "mix") wrap.appendChild(mixPanel(item, cover));
  if (open === "list-a" || open === "list-b") wrap.appendChild(listPanel(item, open === "list-b" ? 1 : 0));
  return wrap;
}

// ---------------------------------------------------------------- panels
function setPanel(id, mode) {
  editor.panel = mode ? { id, mode } : null;
  editor.cardMenu = false;
  editor.search = "";
  renderHead();
  renderRows();
  if (mode === "list-a" || mode === "list-b") focusSearchBox();
}

function menuPanel(f, item) {
  const seg = item.kind === "seg";
  const mixed = seg && item.lists.length > 1;
  const pop = feEl("div", { class: "fe-pop fe-menu" });
  if (seg) {
    pop.appendChild(feEl("div", { class: "fe-poplabel", text: "Color" }));
    const swatches = feEl("div", { class: "fe-swatches" });
    FE_COLORS.forEach((hex, k) => {
      swatches.appendChild(feEl("button", {
        type: "button", class: "fe-swatchbtn", "aria-label": `Color ${k + 1}`, "aria-pressed": String(item.color === k),
        onClick: () => { item.color = k; editor.panel = null; commit(); renderRows(); renderTimeline(); },
      }, feEl("span", { class: "fe-swatch" + (item.color === k ? " fe-swatch-on" : ""), style: `background:${hex}` })));
    });
    pop.appendChild(swatches);
    pop.appendChild(feEl("div", { class: "fe-rule" }));
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
    pop.appendChild(feEl("div", { class: "fe-rule" }));
  }
  pop.appendChild(feEl("button", {
    type: "button", class: "fe-item fe-danger", id: "feRemoveRow",
    onClick: () => { f.items = f.items.filter((x) => x.id !== item.id); editor.panel = null; commit(); renderRows(); renderTimeline(); },
  }, feIcon("trash"), seg ? "Remove segment" : "Remove silence"));
  return pop;
}

function removeMix(item) {
  item.lists = [{ name: item.lists[0].name, weight: 1 }];
  editor.panel = null;
  commit(); renderRows(); renderTimeline();
}

function mixPanel(item, rowCover) {
  const hex = FE_COLORS[item.color % FE_COLORS.length];
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
      if (rowCover) rowCover.style.backgroundImage = feStripes(hex, a / 100, 12);
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
  const seg = item.kind === "seg";
  const mixed = seg && item.lists.length > 1;
  const current = seg ? normName(item.lists[slot] ? item.lists[slot].name : "") : "";
  const other = mixed ? normName(item.lists[slot === 0 ? 1 : 0].name) : "";
  const list = feEl("div", { class: "fe-options", id: "feOptions" });
  const search = feEl("input", { type: "search", class: "fe-search", id: "feSearch", placeholder: "Search your playlists", "aria-label": "Search your playlists", autocomplete: "off" });
  search.value = editor.search;

  const choose = (name) => {
    if (name === null) {                                   // silence
      replaceRow(item, { id: item.id, kind: "silence", seconds: 120 });
      editor.panel = null;
    } else if (!seg) {                                     // a silence row becomes a playlist
      replaceRow(item, { id: item.id, kind: "seg", lists: [{ name, weight: 1 }], minutes: 20, color: nextColor(activeFormat()) });
      editor.panel = null;
    } else {
      item.lists[slot].name = name;
      editor.panel = mixed ? { id: item.id, mode: "mix" } : null;
    }
    editor.search = "";
    commit(); renderRows(); renderTimeline();
  };

  const draw = () => {
    list.innerHTML = "";
    const query = normName(search.value);
    if (!mixed && (!query || "silence".includes(query))) {
      list.appendChild(feEl("button", { type: "button", class: "fe-option" + (!seg ? " fe-option-on" : ""), id: "feOptionSilence", onClick: () => choose(null) },
        feEl("span", { class: "fe-cover fe-cover-silence", style: "width:32px;height:32px" }, feIcon("mute")),
        feEl("span", { class: "fe-text" }, feEl("span", { class: "fe-title", text: "Silence" }), feEl("span", { class: "fe-sub", text: "No music" }))));
    }
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
    if (!shown) list.appendChild(feEl("p", { class: "muted", style: "margin:8px", text: playlists.length ? "No playlists match." : "Your playlists are still loading." }));
  };
  search.addEventListener("input", () => { editor.search = search.value; draw(); });
  draw();
  return feEl("div", { class: "fe-pop fe-listpanel" }, search, list);
}

function replaceRow(item, replacement) {
  const f = activeFormat();
  f.items = f.items.map((x) => (x.id === item.id ? replacement : x));
}

function nextColor(f) {
  const used = f.items.filter((i) => i.kind === "seg").length;
  return used % FE_COLORS.length;
}

// ---------------------------------------------------------------- changing things
function stepItem(item, direction) {
  if (item.kind === "seg") {
    item.minutes = direction < 0 ? Math.max(1, item.minutes - 5) : Math.min(600, item.minutes + 5);
  } else {
    const steps = SILENCE_STEPS;
    if (direction < 0) { const lower = steps.filter((s) => s < item.seconds); item.seconds = lower.length ? lower[lower.length - 1] : steps[0]; }
    else { const higher = steps.filter((s) => s > item.seconds); item.seconds = higher.length ? higher[0] : steps[steps.length - 1]; }
  }
  commit();
  renderRows();
  renderTimeline();
}

function addSegment() {
  const f = activeFormat();
  if (!f) return;
  const item = { id: `r${++ROW_SEQ}`, kind: "seg", lists: [{ name: "", weight: 1 }], minutes: 20, color: nextColor(f) };
  f.items.push(item);
  editor.panel = { id: item.id, mode: "list-a" };
  editor.search = "";
  commit();
  renderRows();
  renderTimeline();
  focusSearchBox();
}

function addFormat() {
  let title = "New format";
  const taken = new Set(editor.model.formats.map((f) => normName(f.title)));
  for (let n = 2; taken.has(normName(title)); n += 1) title = `New format ${n}`;
  const fresh = newBlankFormat(editor.model, title);
  editor.model.formats.push(fresh);
  editor.activeId = fresh.id;
  editor.panel = null;
  editor.cardMenu = false;
  commit();
  renderEditor();
}

function duplicateFormat() {
  const f = activeFormat();
  if (!f) return;
  const copy = { id: newFormatId(editor.model), title: f.title + " copy", items: f.items.map((i) => ({ ...JSON.parse(JSON.stringify(i)), id: `r${++ROW_SEQ}` })) };
  editor.model.formats.push(copy);
  editor.activeId = copy.id;
  editor.cardMenu = false;
  commit();
  renderEditor();
}

function toggleCardMenu() {
  editor.cardMenu = !editor.cardMenu;
  editor.panel = null;
  renderHead();
  renderRows();
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
  if (editor.panel || editor.cardMenu) {
    editor.panel = null;
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
    const blanks = f.items.filter((i) => i.kind === "seg" && i.lists.some((l) => !l.name.trim())).length;
    if (blanks) report.push({ title: f.title.trim() || "Untitled", count: blanks });
  }
  return report;
}
