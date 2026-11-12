// Music sharing: a Cloudflare Worker with a D1 database (schema.sql), for Arc.
// People share their own playlists (a type: ceremony, phase, mood or other, with its books, phases, mood words or name, a description,
// the songs as Spotify IDs and ISRCs, a short summary) and copy each other's.
// Each song's title, artist and length are kept too, but sent only for one playlist at a time (GET /songs/:id, when its page opens), never with the library.
// Who someone is comes from Spotify: every write carries the person's Spotify sign-in, the worker asks Spotify's /me with it,
// and keeps only an HMAC of the user ID (SECRET), never the ID. There are no accounts or passwords here.
// Reports are emailed to the owner of the app through Resend; three reports from different people hide a playlist until he looks.
// Arc's Report a problem and Feedback forms (POST /message) are emailed the same way, with no sign-in; nothing of them is kept.
//
// Settings (wrangler.toml and secrets):
//   DB                 the D1 database
//   SECRET             secret: the key for the HMACs and the signed links in report emails
//   OWNER_SPOTIFY_IDS  secret: the app owner's Spotify user ID(s), comma separated (Developer options' tools)
//   RESEND_KEY         secret: Resend's API key
//   REPORT_TO          secret: where reports are emailed
//   ORIGINS            the pages allowed to call this worker, comma separated

import BLOCKED from "../../blocked-words/blocked-words.json";

const LIMITS = {
  nameChars: 200, shownChars: 40, descChars: 300, moodsMax: 8, moodChars: 30, otherChars: 24, phases: 5, books: 6, maxSongs: 5000, artists: 5, songChars: 100,
  sharesPerDay: 60, reportsPerDay: 30, noteChars: 500, copyShare: 0.9, hideAfterReports: 3,
  messagesPerDay: 10, messageChars: 3000, emailChars: 120, detailChars: 800,
};
const KINDS = ["ceremony", "phase", "mood", "other"];
const REASONS = ["offensive", "spam", "not theirs", "other"];

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = String(env.ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const cors = allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, DELETE", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "86400", "Vary": "Origin" } : {};
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: cors["Access-Control-Allow-Origin"] ? 204 : 403, headers: cors });
    try {
      if (url.pathname === "/link") return await signedLink(request, env, url);   // from a report email, not from the page
      if (!cors["Access-Control-Allow-Origin"]) return answer({ error: "Not allowed" }, 403);
      const route = `${request.method} ${url.pathname.replace(/\/[A-Za-z0-9_-]{10,40}$/, "/:id")}`;
      const id = url.pathname.split("/").pop();
      switch (route) {
        case "GET /library": return answer(await library(env), 200, cors);
        case "GET /songs/:id": return answer(await songNames(env, id), 200, cors);
        case "GET /mine": return answer(await mine(env, await who(request, env)), 200, cors);
        case "POST /share": return answer(await share(env, await who(request, env), await body(request)), 200, cors);
        case "DELETE /share/:id": return answer(await unshare(env, await who(request, env), id), 200, cors);
        case "POST /report": return answer(await report(env, await who(request, env), await body(request), url), 200, cors);
        case "POST /message": return answer(await message(env, request, await body(request)), 200, cors);
        case "GET /admin/reports": return answer(await adminReports(env, await owner(request, env)), 200, cors);
        case "POST /admin/share/:id": return answer(await adminHide(env, await owner(request, env), id, await body(request)), 200, cors);
        case "POST /admin/word": return answer(await adminWord(env, await owner(request, env), await body(request)), 200, cors);
        default: return answer({ error: "Not found" }, 404, cors);
      }
    } catch (err) {
      if (err instanceof Refusal) return answer({ error: err.message, code: err.code, ...err.extra }, err.status, cors);
      return answer({ error: "Something went wrong here." }, 500, cors);
    }
  },
};

class Refusal extends Error {
  constructor(status, message, code = "", extra = {}) { super(message); this.status = status; this.code = code; this.extra = extra; }
}
function answer(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { ...headers, "Cache-Control": "no-store" } });
}
async function body(request) {
  try { return await request.json(); } catch (err) { throw new Refusal(400, "That request could not be read."); }
}
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function hmac(env, value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

// The person, from their Spotify sign-in: Spotify says who it is, and only an HMAC of the ID is kept.
async function spotifyUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!/^Bearer [\w.-]{20,}$/.test(auth)) throw new Refusal(401, "Sign in to Spotify first.");
  if (env.TEST_USERS) {   // local testing only (.dev.vars, never deployed): pretend sign-ins, { token: user ID }
    const id = JSON.parse(env.TEST_USERS)[auth.slice(7)];
    if (!id) throw new Refusal(401, "Spotify did not accept the sign-in.", "signin");
    return id;
  }
  const reply = await fetch("https://api.spotify.com/v1/me", { headers: { Authorization: auth } });
  if (reply.status === 401) throw new Refusal(401, "Spotify did not accept the sign-in.", "signin");
  if (reply.status === 429) throw new Refusal(503, "Spotify is busy. Try again in a minute.", "busy");
  if (!reply.ok) throw new Refusal(502, "Spotify did not answer.", "spotify");
  const me = await reply.json();
  if (!me || !me.id) throw new Refusal(502, "Spotify did not answer.", "spotify");
  return me.id;
}
async function who(request, env) { return hmac(env, await spotifyUser(request, env)); }
async function owner(request, env) {
  const id = await spotifyUser(request, env);
  const owners = String(env.OWNER_SPOTIFY_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!owners.includes(id)) throw new Refusal(403, "Only the owner of the app can do that.");
  return hmac(env, id);
}

async function countToday(env, whoId, kind, limit) {
  const day = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare("INSERT INTO daily (who, day, kind, n) VALUES (?, ?, ?, 1) ON CONFLICT (who, day, kind) DO UPDATE SET n = n + 1 RETURNING n").bind(whoId, day, kind).first();
  if (row && row.n > limit) throw new Refusal(429, "That is a lot for one day. Try again tomorrow.", "daily");
  if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM daily WHERE day < ?").bind(day).run();   // old counts go now and then
}

// ---------------------------------------------------------------- reading
// what a share is, the same in the library and in /mine
function kindOf(r) {
  return { kind: r.kind, books: bitList(r.books, LIMITS.books), bookOther: r.book_other || "", phases: bitList(r.phases, LIMITS.phases), moods: r.moods ? JSON.parse(r.moods) : [], other: r.other || "", description: r.description || "" };
}
function publicShare(r) {
  return {
    id: r.id, name: r.name, by: r.shown_as || null, ...kindOf(r), cover: r.cover || null,
    songs: JSON.parse(r.songs), count: r.song_count, ms: r.total_ms, avgMs: r.avg_ms, artists: JSON.parse(r.artists),
    sharedAt: r.shared_at, updatedAt: r.updated_at,
  };
}
async function library(env) {
  // the song names stay out: they are read one playlist at a time (songNames)
  const shares = await env.DB.prepare("SELECT id, name, shown_as, kind, books, book_other, phases, moods, other, description, cover, songs, song_count, total_ms, avg_ms, artists, shared_at, updated_at FROM shares WHERE hidden = 0 ORDER BY shared_at DESC").all();
  const words = await env.DB.prepare("SELECT word, hidden FROM words").all();
  return { shares: shares.results.map(publicShare), words: Object.fromEntries(words.results.map((w) => [w.word, w.hidden])), at: Date.now() };
}
// One playlist's songs as [title, artist, length in ms], in the order of its songs in the library; null for a share made before names were kept.
async function songNames(env, id) {
  const r = await env.DB.prepare("SELECT names FROM shares WHERE id = ? AND hidden = 0").bind(id).first();
  if (!r) throw new Refusal(404, "That shared playlist is gone.");
  return { id, names: r.names ? JSON.parse(r.names) : null };
}
async function mine(env, whoId) {
  const rows = await env.DB.prepare("SELECT id, playlist, snapshot, name, shown_as, kind, books, book_other, phases, moods, other, description, desc_source, cover, song_count, total_ms, shared_at, updated_at, hidden FROM shares WHERE owner = ?").bind(whoId).all();
  return { shares: rows.results.map((r) => ({ id: r.id, playlist: r.playlist, snapshot: r.snapshot, name: r.name, by: r.shown_as || null, ...kindOf(r), descSource: r.desc_source || "mine",
    cover: r.cover || null, count: r.song_count, ms: r.total_ms, sharedAt: r.shared_at, updatedAt: r.updated_at, hidden: !!r.hidden })) };
}
// books and phases are kept as one number, a bit each (the first is 1, the second 2, then 4, 8, 16), and sent as a list of positions
const OTHER_BOOK = 5;   // the sixth book, Other: a bit like the others, its code in book_other
const bitList = (mask, n) => Array.from({ length: n }, (_, i) => i).filter((i) => mask & (1 << i));
const bitMask = (list, n) => (Array.isArray(list) ? list : []).reduce((m, i) => Number.isInteger(i) && i >= 0 && i < n ? m | (1 << i) : m, 0);
// a mood word or an Other name as the page makes it: lower case for moods, single spaces, letters, numbers and a few marks
function cleanWord(t, max) {
  return typeof t === "string" ? t.replace(/^#+/, "").replace(/[^\p{L}\p{N}' &-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, max).trim() : "";
}
// Whole words only, as in the page (sharing.js blockedWord): lower case, no accents, anything but letters and numbers a space.
const BLOCKED_SET = new Set(BLOCKED.words);
const BLOCKED_RE = BLOCKED.patterns.length ? new RegExp(`(^| )(${BLOCKED.patterns.join("|")})( |$)`) : null;
function blockedWord(t) {
  const n = String(t).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  if (!n) return false;
  const w = n.split(" ");
  for (let i = 0; i < w.length; i++) for (let j = i + 1; j <= Math.min(w.length, i + 4); j++) if (BLOCKED_SET.has(w.slice(i, j).join(" "))) return true;
  return !!(BLOCKED_RE && BLOCKED_RE.test(n));
}

// ---------------------------------------------------------------- sharing
async function share(env, whoId, d) {
  const playlist = text(d.playlist, 40);
  if (!/^[A-Za-z0-9]{10,40}$/.test(playlist)) throw new Refusal(400, "That playlist could not be read.");
  const name = text(d.name, LIMITS.nameChars);
  if (!name) throw new Refusal(400, "The playlist needs a name.");
  const kind = KINDS.includes(d.kind) ? d.kind : null;
  if (!kind) throw new Refusal(400, "Choose what type of playlist it is.", "kind");
  const description = text(d.description, LIMITS.descChars);
  const descSource = d.descSource === "spotify" ? "spotify" : "mine";
  let books = 0, bookOther = null, phases = 0, moods = null, other = null;
  if (kind === "ceremony") {
    books = bitMask(d.books, LIMITS.books);
    if (!books) throw new Refusal(400, "Choose at least one book.", "books");
    // the sixth, Other, is a book not among the five, named by up to 2 letters or numbers (the page's cleanBookCode)
    if (books & (1 << OTHER_BOOK)) {
      bookOther = String(d.bookOther || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 2);
      if (!bookOther) throw new Refusal(400, "Type the other book, up to 2 letters or numbers.", "books");
      if (blockedWord(bookOther)) throw new Refusal(400, "That other book cannot be used.", "books");
    }
  }
  if (kind === "phase") {
    phases = bitMask(d.phases, LIMITS.phases);
    if (!phases) throw new Refusal(400, "Choose at least one phase.", "phases");
  }
  if (kind === "mood") {
    moods = [...new Set((Array.isArray(d.moods) ? d.moods : []).map((m) => cleanWord(m, LIMITS.moodChars).toLowerCase()).filter((m) => m.length >= 2))].slice(0, LIMITS.moodsMax);
    if (!moods.length) throw new Refusal(400, "Add at least one mood.", "moods");
    if (moods.some(blockedWord)) throw new Refusal(400, "One of the moods is a word that cannot be used here.", "moods");
  }
  if (kind === "other") {
    other = cleanWord(d.other, LIMITS.otherChars);
    if (!other) throw new Refusal(400, "Say what it is.", "other");
    if (blockedWord(other)) throw new Refusal(400, "That has a word that cannot be used here.", "other");
  }
  if ((kind === "ceremony" || kind === "phase" || kind === "other") && !description) throw new Refusal(400, "Add a description.", "description");
  // each song's name goes with it, so a song left out takes its name along and the two lists stay in step
  const sent = Array.isArray(d.songs) ? d.songs.slice(0, LIMITS.maxSongs).map((s, i) => [s, Array.isArray(d.names) ? d.names[i] : null]).filter(([s]) => Array.isArray(s) && /^[A-Za-z0-9]{10,40}$/.test(s[0])) : [];
  const songs = sent.map(([s]) => [s[0], /^[A-Z0-9]{12}$/.test(s[1] || "") ? s[1] : ""]);
  const names = Array.isArray(d.names) ? sent.map(([, n]) => Array.isArray(n) ? [text(n[0], LIMITS.songChars), text(n[1], LIMITS.songChars), Math.max(0, Math.round(Number(n[2]) || 0))] : ["", "", 0]) : null;
  const ms = Math.round(Number(d.ms) || 0);
  if (!songs.length) throw new Refusal(400, "That playlist has no songs.", "empty");
  const shown = d.by === null ? null : text(d.by, LIMITS.shownChars) || null;
  const cover = typeof d.cover === "string" && /^https:\/\/([a-z0-9-]+\.)*(scdn\.co|spotifycdn\.com)\/[\w/.-]+$/.test(d.cover) ? d.cover : null;
  const artists = Array.isArray(d.artists) ? d.artists.slice(0, LIMITS.artists).map((a) => text(a, 100)).filter(Boolean) : [];
  const avg = Math.round(ms / songs.length);
  await countToday(env, whoId, "share", LIMITS.sharesPerDay);
  // a copy of someone else's shared playlist cannot be shared again: most of its songs would be theirs
  const others = await env.DB.prepare("SELECT name, songs FROM shares WHERE owner != ?").bind(whoId).all();
  for (const o of others.results) {
    const theirs = JSON.parse(o.songs);
    const ids = new Set(theirs.map((t) => t[0])), isrcs = new Set(theirs.map((t) => t[1]).filter(Boolean));
    const same = songs.filter(([id, isrc]) => ids.has(id) || (isrc && isrcs.has(isrc))).length;
    if (theirs.length && same / songs.length >= LIMITS.copyShare && same / theirs.length >= 0.5) {
      const percent = Math.floor((same / songs.length) * 100);
      throw new Refusal(409, `${percent}% of its songs are in ${o.name}, which someone else shares, so it can't be shared.`, "copy", { percent, of: o.name });
    }
  }
  const now = Date.now();
  const existing = await env.DB.prepare("SELECT id, hidden FROM shares WHERE owner = ? AND playlist = ?").bind(whoId, playlist).first();
  const id = existing ? existing.id : newId();
  await env.DB.prepare(`INSERT INTO shares (id, owner, playlist, snapshot, name, shown_as, kind, books, book_other, phases, moods, other, description, desc_source, cover, songs, song_count, total_ms, avg_ms, artists, names, shared_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (owner, playlist) DO UPDATE SET snapshot = excluded.snapshot, name = excluded.name, shown_as = excluded.shown_as, kind = excluded.kind, books = excluded.books, book_other = excluded.book_other, phases = excluded.phases,
        moods = excluded.moods, other = excluded.other, description = excluded.description, desc_source = excluded.desc_source,
        cover = excluded.cover, songs = excluded.songs, song_count = excluded.song_count, total_ms = excluded.total_ms, avg_ms = excluded.avg_ms, artists = excluded.artists, names = excluded.names, updated_at = excluded.updated_at`)
    .bind(id, whoId, playlist, text(d.snapshot, 100) || null, name, shown, kind, books, bookOther, phases, moods ? JSON.stringify(moods) : null, other, description || null, descSource,
      cover, JSON.stringify(songs), songs.length, ms, avg, JSON.stringify(artists), names ? JSON.stringify(names) : null, now, now).run();
  return { id, updated: !!existing, hidden: !!(existing && existing.hidden) };
}
function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}
async function unshare(env, whoId, id) {
  const done = await env.DB.prepare("DELETE FROM shares WHERE id = ? AND owner = ?").bind(id, whoId).run();
  if (!done.meta.changes) throw new Refusal(404, "That shared playlist is not yours, or is already gone.");
  await env.DB.prepare("DELETE FROM reports WHERE share = ?").bind(id).run();
  return { removed: id };
}

// ---------------------------------------------------------------- reports
async function report(env, whoId, d, url) {
  const id = text(d.share, 40);
  const reason = REASONS.includes(d.reason) ? d.reason : null;
  if (!reason) throw new Refusal(400, "Choose a reason.");
  const s = await env.DB.prepare("SELECT id, name, shown_as, hidden FROM shares WHERE id = ?").bind(id).first();
  if (!s) throw new Refusal(404, "That shared playlist is gone.");
  await countToday(env, whoId, "report", LIMITS.reportsPerDay);
  const note = text(d.note, LIMITS.noteChars) || null;
  await env.DB.prepare("INSERT INTO reports (share, reporter, reason, note, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (share, reporter) DO UPDATE SET reason = excluded.reason, note = excluded.note, at = excluded.at")
    .bind(id, whoId, reason, note, Date.now()).run();
  const count = (await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE share = ?").bind(id).first()).n;
  let hiddenNow = false;
  if (count >= LIMITS.hideAfterReports && s.hidden === 0) {
    await env.DB.prepare("UPDATE shares SET hidden = 1 WHERE id = ?").bind(id).run();
    hiddenNow = true;
  }
  await emailReport(env, url, s, { reason, note, count, hiddenNow });
  return { reported: id };
}
async function emailReport(env, url, s, r) {
  if (!env.RESEND_KEY || !env.REPORT_TO) return;
  const base = `${url.origin}/link?s=${encodeURIComponent(s.id)}`;
  const link = async (a) => `${base}&a=${a}&t=${await hmac(env, `${a}:${s.id}`)}`;
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const status = r.hiddenNow ? `It now has ${r.count} reports from different people, so it was hidden until you look.` : `Reports so far: ${r.count}.`;
  const html = `<p><b>${esc(s.name)}</b>${s.shown_as ? ` shared by ${esc(s.shown_as)}` : " (anonymous)"} was reported.</p>
    <p>Reason: ${esc(r.reason)}${r.note ? `<br>Note: ${esc(r.note)}` : ""}</p><p>${status}</p>
    <p><a href="${await link("hide")}">Hide it</a> &nbsp; <a href="${await link("show")}">Keep it shown</a></p>`;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "Music sharing <onboarding@resend.dev>", to: [env.REPORT_TO], subject: `Report: ${s.name}${r.hiddenNow ? " (hidden)" : ""}`, html }),
    });
  } catch (err) { /* the report is kept either way, and shows in Developer options */ }
}
// ---------------------------------------------------------------- Arc's Report a problem and Feedback
// What the person typed, an optional email for a reply, and for a problem the page's six details, emailed to the owner. Nothing is stored;
// only a count per day under an HMAC of the address it came from, so the form cannot be used to flood the inbox.
const DETAIL_NAMES = { appVersion: "Version", browser: "Browser", windowSize: "Window size", python: "Python", lastError: "Last error", recentSteps: "Recent steps" };
async function message(env, request, b) {
  const kind = b.kind === "problem" ? "problem" : b.kind === "feedback" ? "feedback" : "";
  if (!kind) throw new Refusal(400, "That request could not be read.");
  const msg = text(b.message, LIMITS.messageChars);
  if (!msg) throw new Refusal(400, "Write something first.");
  const email = text(b.email, LIMITS.emailChars);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Refusal(400, "That email address doesn\u2019t look right.");
  const details = [];
  if (kind === "problem" && b.details && typeof b.details === "object") {
    for (const [key, label] of Object.entries(DETAIL_NAMES)) { const v = text(b.details[key], LIMITS.detailChars); if (v) details.push([label, v]); }
  }
  if (!env.RESEND_KEY || !env.REPORT_TO) throw new Refusal(503, "Sending isn\u2019t set up yet.");
  await countToday(env, await hmac(env, "message:" + (request.headers.get("CF-Connecting-IP") || "unknown")), "message", LIMITS.messagesPerDay);
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const html = `<p style="white-space:pre-wrap">${esc(msg)}</p>` + (email ? `<p>From: ${esc(email)}</p>` : "<p>No email given.</p>") +
    (details.length ? `<p style="font-family:monospace;font-size:13px">${details.map(([k, v]) => `${esc(k)}: ${esc(v)}`).join("<br>")}</p>` : "");
  const first = msg.split("\n")[0].slice(0, 60);
  const mail = { from: "Arc <onboarding@resend.dev>", to: [env.REPORT_TO], subject: `Arc ${kind === "problem" ? "problem" : "feedback"}: ${first}`, html };
  if (email) mail.reply_to = email;
  let sent = false;
  try {
    const reply = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${env.RESEND_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(mail) });
    sent = reply.ok;
  } catch (err) { sent = false; }
  if (!sent) throw new Refusal(502, "It didn\u2019t go through. Try again in a moment.");
  return { sent: true };
}

// A link in a report email shows a page with one button, so a mail scanner opening the link changes nothing.
async function signedLink(request, env, url) {
  const id = url.searchParams.get("s") || "", a = url.searchParams.get("a") || "", t = url.searchParams.get("t") || "";
  const page = (msg, form = "") => new Response(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font:17px system-ui;max-width:420px;margin:40px auto;padding:0 16px"><p>${msg}</p>${form}</body>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  if (!["hide", "show"].includes(a) || t !== (await hmac(env, `${a}:${id}`))) return page("This link is not valid.");
  const s = await env.DB.prepare("SELECT name FROM shares WHERE id = ?").bind(id).first();
  if (!s) return page("That shared playlist is gone.");
  const name = String(s.name).replace(/[&<>"]/g, "");
  if (request.method !== "POST") return page(`${a === "hide" ? "Hide" : "Keep showing"} ${name}?`, `<form method="post"><button style="font:inherit;padding:10px 18px">${a === "hide" ? "Hide it" : "Keep it shown"}</button></form>`);
  await env.DB.prepare("UPDATE shares SET hidden = ? WHERE id = ?").bind(a === "hide" ? 2 : 0, id).run();
  if (a === "show") await env.DB.prepare("DELETE FROM reports WHERE share = ?").bind(id).run();
  return page(a === "hide" ? `${name} is hidden.` : `${name} is shown, and its reports are cleared.`);
}

// ---------------------------------------------------------------- the app owner's tools (Developer options)
async function adminReports(env) {
  const rows = await env.DB.prepare(`SELECT s.id, s.name, s.shown_as, s.hidden, r.reason, r.note, r.at FROM shares s JOIN reports r ON r.share = s.id
    UNION ALL SELECT id, name, shown_as, hidden, NULL, NULL, updated_at FROM shares WHERE hidden != 0 AND id NOT IN (SELECT share FROM reports) ORDER BY 7 DESC`).all();
  const byShare = new Map();
  for (const r of rows.results) {
    if (!byShare.has(r.id)) byShare.set(r.id, { id: r.id, name: r.name, by: r.shown_as || null, hidden: r.hidden, reports: [] });
    if (r.reason) byShare.get(r.id).reports.push({ reason: r.reason, note: r.note, at: r.at });
  }
  return { shares: [...byShare.values()] };
}
async function adminHide(env, _owner, id, d) {
  const hidden = d.hidden ? 2 : 0;
  const done = await env.DB.prepare("UPDATE shares SET hidden = ? WHERE id = ?").bind(hidden, id).run();
  if (!done.meta.changes) throw new Refusal(404, "That shared playlist is gone.");
  if (!hidden) await env.DB.prepare("DELETE FROM reports WHERE share = ?").bind(id).run();
  return { id, hidden };
}
async function adminWord(env, _owner, d) {
  const word = text(d.word, 60).toLowerCase();
  if (!word) throw new Refusal(400, "No word.");
  if (d.hidden === null) await env.DB.prepare("DELETE FROM words WHERE word = ?").bind(word).run();   // back to the app's own choice
  else await env.DB.prepare("INSERT INTO words (word, hidden) VALUES (?, ?) ON CONFLICT (word) DO UPDATE SET hidden = excluded.hidden").bind(word, d.hidden ? 1 : 0).run();
  return { word, hidden: d.hidden === null ? null : !!d.hidden };
}
