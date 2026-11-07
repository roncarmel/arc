// Music sharing: a Cloudflare Worker with a D1 database (schema.sql), for Ceremony Playlist Builder.
// People share their own playlists (the phases they suit, tags, optional notes, the songs as Spotify IDs and ISRCs, a short summary) and copy each other's.
// Who someone is comes from Spotify: every write carries the person's Spotify sign-in, the worker asks Spotify's /me with it,
// and keeps only an HMAC of the user ID (SECRET), never the ID. There are no accounts or passwords here.
// Reports are emailed to the owner of the app through Resend; three reports from different people hide a playlist until he looks.
//
// Settings (wrangler.toml and secrets):
//   DB                 the D1 database
//   SECRET             secret: the key for the HMACs and the signed links in report emails
//   OWNER_SPOTIFY_IDS  secret: the app owner's Spotify user ID(s), comma separated (Developer options' tools)
//   RESEND_KEY         secret: Resend's API key
//   REPORT_TO          secret: where reports are emailed
//   ORIGINS            the pages allowed to call this worker, comma separated

const LIMITS = {
  nameChars: 200, shownChars: 40, notesMax: 400, tagsMin: 3, tagsMax: 10, tagChars: 30, phases: 5, minMs: 2 * 60 * 60 * 1000, maxSongs: 5000, artists: 5,
  sharesPerDay: 60, reportsPerDay: 30, noteChars: 500, copyShare: 0.9, hideAfterReports: 3,
};
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
        case "GET /mine": return answer(await mine(env, await who(request, env)), 200, cors);
        case "POST /share": return answer(await share(env, await who(request, env), await body(request)), 200, cors);
        case "DELETE /share/:id": return answer(await unshare(env, await who(request, env), id), 200, cors);
        case "POST /report": return answer(await report(env, await who(request, env), await body(request), url), 200, cors);
        case "GET /admin/reports": return answer(await adminReports(env, await owner(request, env)), 200, cors);
        case "POST /admin/share/:id": return answer(await adminHide(env, await owner(request, env), id, await body(request)), 200, cors);
        case "POST /admin/word": return answer(await adminWord(env, await owner(request, env), await body(request)), 200, cors);
        default: return answer({ error: "Not found" }, 404, cors);
      }
    } catch (err) {
      if (err instanceof Refusal) return answer({ error: err.message, code: err.code }, err.status, cors);
      return answer({ error: "Something went wrong here." }, 500, cors);
    }
  },
};

class Refusal extends Error {
  constructor(status, message, code = "") { super(message); this.status = status; this.code = code; }
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
function publicShare(r) {
  return {
    id: r.id, name: r.name, by: r.shown_as || null, phases: phaseList(r.phases), tags: JSON.parse(r.tags), notes: r.notes || "", cover: r.cover || null,
    songs: JSON.parse(r.songs), count: r.song_count, ms: r.total_ms, avgMs: r.avg_ms, artists: JSON.parse(r.artists),
    sharedAt: r.shared_at, updatedAt: r.updated_at,
  };
}
async function library(env) {
  const shares = await env.DB.prepare("SELECT * FROM shares WHERE hidden = 0 ORDER BY shared_at DESC").all();
  const words = await env.DB.prepare("SELECT word, hidden FROM words").all();
  return { shares: shares.results.map(publicShare), words: Object.fromEntries(words.results.map((w) => [w.word, w.hidden])), at: Date.now() };
}
async function mine(env, whoId) {
  const rows = await env.DB.prepare("SELECT id, playlist, snapshot, name, shown_as, phases, tags, notes, shared_at, updated_at, hidden FROM shares WHERE owner = ?").bind(whoId).all();
  return { shares: rows.results.map((r) => ({ id: r.id, playlist: r.playlist, snapshot: r.snapshot, name: r.name, by: r.shown_as || null, phases: phaseList(r.phases), tags: JSON.parse(r.tags), notes: r.notes || "", sharedAt: r.shared_at, updatedAt: r.updated_at, hidden: !!r.hidden })) };
}
// phases are kept as one number, a bit per phase (Preparing 1, Ascending 2, Plateau 4, Descending 8, Resting 16), and sent as a list of positions
const phaseList = (mask) => Array.from({ length: LIMITS.phases }, (_, i) => i).filter((i) => mask & (1 << i));
// a tag as the page makes it: lower case, single spaces, letters, numbers and a few marks
function cleanTag(t) {
  return typeof t === "string" ? t.toLowerCase().replace(/^#+/, "").replace(/[^\p{L}\p{N}' &-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, LIMITS.tagChars).trim() : "";
}

// ---------------------------------------------------------------- sharing
async function share(env, whoId, d) {
  const playlist = text(d.playlist, 40);
  if (!/^[A-Za-z0-9]{10,40}$/.test(playlist)) throw new Refusal(400, "That playlist could not be read.");
  const name = text(d.name, LIMITS.nameChars);
  const notes = text(d.notes, LIMITS.notesMax);
  const phases = (Array.isArray(d.phases) ? d.phases : []).reduce((m, i) => Number.isInteger(i) && i >= 0 && i < LIMITS.phases ? m | (1 << i) : m, 0);
  const tags = [...new Set((Array.isArray(d.tags) ? d.tags : []).map(cleanTag).filter((t) => t.length >= 2))].slice(0, LIMITS.tagsMax);
  if (!name) throw new Refusal(400, "The playlist needs a name.");
  if (!phases) throw new Refusal(400, "Choose at least one phase.", "phases");
  if (tags.length < LIMITS.tagsMin) throw new Refusal(400, `Add at least ${LIMITS.tagsMin} tags.`, "tags");
  const songs = Array.isArray(d.songs) ? d.songs.slice(0, LIMITS.maxSongs).filter((s) => Array.isArray(s) && /^[A-Za-z0-9]{10,40}$/.test(s[0])).map((s) => [s[0], /^[A-Z0-9]{12}$/.test(s[1] || "") ? s[1] : ""]) : [];
  const ms = Math.round(Number(d.ms) || 0);
  if (!songs.length) throw new Refusal(400, "That playlist has no songs.");
  if (ms < LIMITS.minMs) throw new Refusal(400, "Playlists need at least two hours of songs to be shared.", "length");
  const shown = d.by === null ? null : text(d.by, LIMITS.shownChars) || null;
  const cover = typeof d.cover === "string" && /^https:\/\/([a-z0-9-]+\.)*(scdn\.co|spotifycdn\.com)\/[\w/.-]+$/.test(d.cover) ? d.cover : null;
  const artists = Array.isArray(d.artists) ? d.artists.slice(0, LIMITS.artists).map((a) => text(a, 100)).filter(Boolean) : [];
  const avg = Math.round(ms / songs.length);
  await countToday(env, whoId, "share", LIMITS.sharesPerDay);
  // a copy of someone else's shared playlist cannot be shared again: most of its songs would be theirs
  const others = await env.DB.prepare("SELECT name, songs FROM shares WHERE owner != ?").bind(whoId).all();
  for (const o of others.results) {
    const theirs = JSON.parse(o.songs);
    const same = songs.filter(([id, isrc]) => theirs.some(([tid, tisrc]) => tid === id || (isrc && tisrc === isrc))).length;
    if (theirs.length && same / songs.length >= LIMITS.copyShare && same / theirs.length >= 0.5) throw new Refusal(409, `This looks like a copy of ${o.name}, which someone else shares.`, "copy");
  }
  const now = Date.now();
  const existing = await env.DB.prepare("SELECT id, hidden FROM shares WHERE owner = ? AND playlist = ?").bind(whoId, playlist).first();
  const id = existing ? existing.id : newId();
  await env.DB.prepare(`INSERT INTO shares (id, owner, playlist, snapshot, name, shown_as, phases, tags, notes, cover, songs, song_count, total_ms, avg_ms, artists, shared_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (owner, playlist) DO UPDATE SET snapshot = excluded.snapshot, name = excluded.name, shown_as = excluded.shown_as, phases = excluded.phases, tags = excluded.tags, notes = excluded.notes,
        cover = excluded.cover, songs = excluded.songs, song_count = excluded.song_count, total_ms = excluded.total_ms, avg_ms = excluded.avg_ms, artists = excluded.artists, updated_at = excluded.updated_at`)
    .bind(id, whoId, playlist, text(d.snapshot, 100) || null, name, shown, phases, JSON.stringify(tags), notes || null, cover, JSON.stringify(songs), songs.length, ms, avg, JSON.stringify(artists), now, now).run();
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
