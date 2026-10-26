// embeds.js: an optional layer that shows Ko-fi and Tally inside the page instead of in a new tab.
//
// It is OFF unless the page is opened with ?embeds=on (remembered for that browser tab; ?embeds=off turns it
// off again). While it is off, this file does nothing at all. To remove the feature completely, delete the
// <script src="embeds.js"> line in index.html.
//
// No code from Ko-fi or Tally is loaded into this page. Both are shown in frames, which the browser keeps
// separate from the page, and the frames are only created when someone opens them. The small behaviors that
// Ko-fi's and Tally's own scripts add around those frames (opening a panel, listening for "form submitted")
// are written here instead.
(function () {
  "use strict";

  // ---- the switch
  let on = false;
  try {
    const params = new URLSearchParams(location.search);
    if (params.get("embeds") === "on") sessionStorage.setItem("embeds", "on");
    if (params.get("embeds") === "off") sessionStorage.removeItem("embeds");
    on = sessionStorage.getItem("embeds") === "on";
  } catch (err) { on = false; }
  if (!on) return;

  const $ = (id) => document.getElementById(id);
  const REPORT_FRAME_HEIGHT = 640;       // how tall the report form frame is; the form scrolls inside if it needs more
  const KOFI_MAX_HEIGHT = 690;           // the same limits Ko-fi's own widget uses for its panel
  const KOFI_MIN_HEIGHT = 400;
  const TALLY_ORIGIN = "https://tally.so";

  const kofiPageUrl = $("supportButton").href;                          // e.g. https://ko-fi.com/roncarmel
  const kofiHandle = new URL(kofiPageUrl).pathname.replace(/^\//, "");
  const kofiFrameUrl = `https://ko-fi.com/${kofiHandle}/?hidefeed=true&widget=true&embed=true`;
  const tallyFormId = new URL($("reportLink").href).pathname.split("/").pop();
  const note = (text) => { try { logStep(text); } catch (err) { /* logging is optional */ } };

  const style = document.createElement("style");
  style.textContent = `
    #kofiPanel { position: fixed; right: 16px; width: 328px; max-width: calc(100vw - 32px); z-index: 1000; display: flex; flex-direction: column;
      background: #fff; color: #444; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 36px rgba(0, 0, 0, 0.3); }
    #kofiPanel .bar { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px 6px 14px; font-size: 0.85rem; }
    #kofiPanel .bar a { color: #444; }
    #kofiPanel iframe { flex: 1; width: 100%; border: none; background: #fff; }
    #kofiPanel button.close, #reportEmbed button.close { background: none; border: none; color: #444; font-size: 1.4rem; line-height: 1; padding: 0 6px; font-weight: normal; }
    #reportEmbed { margin: 12px 0; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: #fff; color: #444; }
    #reportEmbed .bar { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 6px 10px 6px 14px; font-size: 0.85rem; }
    #reportEmbed .bar a { color: #444; }
    #reportEmbed iframe { display: block; width: 100%; border: none; background: #fff; }
    #reportEmbedStatus { margin: 0; padding: 0 14px 8px; font-weight: 600; }
    @media (max-width: 520px) { #kofiPanel { right: 8px; max-width: calc(100vw - 16px); } }
  `;
  document.head.appendChild(style);

  const make = (tag, props = {}, children = []) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "text") el.textContent = v;
      else if (k === "hidden") el.hidden = v;
      else el.setAttribute(k, v);
    }
    for (const child of children) el.appendChild(child);
    return el;
  };

  // ---- a visible reminder, so it is clear this tab is in embeds mode, and how to leave it
  const reminder = make("p", { id: "embedsNote", class: "muted" }, [
    document.createTextNode("Integrated embeds are on for this tab (experimental). "),
    make("a", { href: "?embeds=off", text: "Turn off" }),
  ]);
  const moreSummary = document.querySelector("#moreOptions > summary");
  if (moreSummary) moreSummary.insertAdjacentElement("afterend", reminder);
  note("embeds on");

  // ---- Ko-fi: the Tip me button opens a panel in the page, with the same Ko-fi page the new tab would show
  const box = $("supportBox");
  const tipButton = $("supportButton");
  let kofiFrame = null;
  const kofiClose = make("button", { type: "button", class: "close", "aria-label": "Close", text: "\u00d7" });
  const kofiHolder = make("div", { style: "flex:1; display:flex; flex-direction:column; min-height:0;" });
  const kofiPanel = make("div", { id: "kofiPanel", role: "dialog", "aria-label": "Tip me on Ko-fi", hidden: true }, [
    make("div", { class: "bar" }, [make("a", { href: kofiPageUrl, target: "_blank", rel: "noopener noreferrer", text: `ko-fi.com/${kofiHandle}` }), kofiClose]),
    kofiHolder,
  ]);
  document.body.appendChild(kofiPanel);
  tipButton.setAttribute("aria-expanded", "false");

  function openKofi() {
    const top = box.getBoundingClientRect().top;
    const height = Math.max(KOFI_MIN_HEIGHT, Math.min(KOFI_MAX_HEIGHT, Math.round(top - 60)));   // same sizing rule as Ko-fi's widget
    kofiPanel.style.height = height + "px";
    kofiPanel.style.bottom = Math.max(8, window.innerHeight - top + 8) + "px";
    if (!kofiFrame) {
      kofiFrame = make("iframe", { src: kofiFrameUrl, title: "Tip me on Ko-fi" });
      kofiHolder.appendChild(kofiFrame);
    }
    kofiPanel.hidden = false;
    tipButton.setAttribute("aria-expanded", "true");
    note("tip panel opened");
  }
  function closeKofi() {
    kofiPanel.hidden = true;
    tipButton.setAttribute("aria-expanded", "false");
  }
  tipButton.addEventListener("click", (event) => {
    event.preventDefault();   // the link to Ko-fi in a new tab stays as the fallback if this file ever fails to load
    if (kofiPanel.hidden) openKofi(); else closeKofi();
  });
  kofiClose.addEventListener("click", closeKofi);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !kofiPanel.hidden) closeKofi(); });
  window.addEventListener("resize", () => { if (!kofiPanel.hidden) openKofi(); });

  // ---- Tally: the report form appears inline in the Report a problem section, with the details already filled in
  let reportFrame = null;
  let closeTimer = null;
  const reportStatus = make("p", { id: "reportEmbedStatus", "aria-live": "polite" });
  const reportClose = make("button", { type: "button", class: "close", "aria-label": "Close the report form", text: "\u00d7" });
  const reportNewTab = make("a", { href: $("reportLink").href, target: "_blank", rel: "noopener noreferrer", text: "Open the form in a new tab" });
  const reportFrameHolder = make("div");
  const reportEmbed = make("div", { id: "reportEmbed", hidden: true }, [
    make("div", { class: "bar" }, [reportNewTab, reportClose]),
    reportStatus,
    reportFrameHolder,
  ]);
  $("reportLink").insertAdjacentElement("afterend", reportEmbed);

  function tallyEmbedUrl() {
    // The same six details as the new-tab link, so one form serves both. The lengths are already kept safe by reportUrl().
    const search = new URL(reportUrl()).search;
    return `${TALLY_ORIGIN}/embed/${tallyFormId}${search}&alignLeft=1&hideTitle=1`;
  }
  function openReport() {
    clearTimeout(closeTimer);
    $("moreOptions").open = true;
    reportStatus.textContent = "";
    reportNewTab.href = reportUrl();
    if (reportFrame) reportFrame.remove();
    reportFrame = make("iframe", { src: tallyEmbedUrl(), title: "Report a problem", loading: "lazy", style: `height:${REPORT_FRAME_HEIGHT}px` });
    reportFrameHolder.appendChild(reportFrame);
    reportEmbed.hidden = false;
    if (reportEmbed.scrollIntoView) reportEmbed.scrollIntoView({ behavior: "smooth", block: "nearest" });
    note("report form opened");
  }
  function closeReport() {
    clearTimeout(closeTimer);
    reportEmbed.hidden = true;
    reportStatus.textContent = "";
    if (reportFrame) { reportFrame.remove(); reportFrame = null; }
  }
  const reportLinks = [$("reportLink"), ...["mainReportHint", "removeReportHint", "loginReportHint"].map((id) => $(id) && $(id).querySelector("a"))].filter(Boolean);
  for (const link of reportLinks) {
    link.addEventListener("click", (event) => { event.preventDefault(); openReport(); });
  }
  reportClose.addEventListener("click", closeReport);

  // Tally's frame announces events to the page that holds it. Only a message from that frame, from Tally, counts.
  window.addEventListener("message", (event) => {
    if (event.origin !== TALLY_ORIGIN || !reportFrame || event.source !== reportFrame.contentWindow) return;
    let data = event.data;
    if (typeof data === "string") { try { data = JSON.parse(data); } catch (err) { return; } }
    if (data && data.event === "Tally.FormSubmitted") {
      reportStatus.textContent = "Thanks. Your report was sent.";
      note("report sent");
      closeTimer = setTimeout(closeReport, 4000);
    }
  });
})();
