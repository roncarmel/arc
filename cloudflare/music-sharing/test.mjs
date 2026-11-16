// Music sharing's worker against a real SQLite in place of D1, with pretend sign-ins (TEST_USERS): node test.mjs (Node 22 or later)
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
const db = new DatabaseSync(":memory:");
db.exec(fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
// the worker as Node can load it: its blocked words left out (wrangler bundles the JSON)
const tmp = new URL("./.worker-test.mjs", import.meta.url);
fs.writeFileSync(tmp, fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8").replace(/^import BLOCKED from .*$/m, "const BLOCKED = { words: [], patterns: [] };"));
const worker = (await import(tmp.href)).default;
fs.unlinkSync(tmp);
const stmt = (sql) => { const st = { args: [], bind: (...a) => { st.args = a; return st; },
  first: async () => db.prepare(sql).get(...st.args) || null, all: async () => ({ results: db.prepare(sql).all(...st.args) }),
  run: async () => { const r = db.prepare(sql).run(...st.args); return { meta: { changes: r.changes } }; } }; return st; };
const env = { DB: { prepare: stmt, batch: async (list) => { for (const s of list) await s.run(); } }, SECRET: "x", ORIGINS: "http://a", TEST_USERS: JSON.stringify({ tokSpotifyAAAAAAAAAAAA: "sp1", tokTidalAAAAAAAAAAAAAAA: "td1", tokTidalBBBBBBBBBBBBBBB: "td2" }) };
const call = async (method, path, tok, svc, body) => { const h = { Origin: "http://a" }; if (tok) h.Authorization = "Bearer " + tok; if (svc) h["X-Arc-Service"] = svc; if (body) h["Content-Type"] = "application/json";
  const r = await worker.fetch(new Request("https://w" + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env); return [r.status, await r.json()]; };
let fails = 0; const check = (name, ok, extra) => { if (!ok) { fails++; console.log("FAIL", name, extra === undefined ? "" : JSON.stringify(extra)); } };
const sp = (n) => "a".repeat(21) + n, isrc = (n) => "TEST0000000" + n;
// a Spotify share (no header, as pages before TIDAL)
let [st, r] = await call("POST", "/share", "tokSpotifyAAAAAAAAAAAA", null, { playlist: "B".repeat(22), name: "Deep water", kind: "mood", moods: ["calm"], songs: [[sp(1), isrc(1)], [sp(2), isrc(2)], [sp(3), isrc(3)]], names: [["a","b",1],["c","d",2],["e","f",3]], ms: 6 });
check("a Spotify share is taken as before", st === 200 && r.id, r);
// a TIDAL share: UUID playlist, numeric IDs
[st, r] = await call("POST", "/share", "tokTidalAAAAAAAAAAAAAAA", "tidal", { playlist: "00000001-aaaa-4bbb-8ccc-000000000001", name: "Forest", kind: "mood", moods: ["warm"], songs: [["111", isrc(5)], ["222", isrc(6)]], ms: 4, cover: "https://resources.tidal.com/images/x/640x640.jpg" });
check("a TIDAL share is taken: its UUID, numeric song IDs and TIDAL cover", st === 200 && r.id, r);
let lib = (await call("GET", "/library"))[1];
const forest = lib.shares.find((s) => s.name === "Forest"), deep = lib.shares.find((s) => s.name === "Deep water");
check("the TIDAL share's songs are [\"\", ISRC, TIDAL ID] and its cover kept", JSON.stringify(forest.songs) === JSON.stringify([["", isrc(5), "111"], ["", isrc(6), "222"]]) && forest.cover.includes("tidal"), forest);
check("each share says the service it came from", forest.service === "tidal" && deep.service === "spotify", [forest.service, deep.service]);
check("the Spotify share's songs gain an empty TIDAL column", JSON.stringify(deep.songs[0]) === JSON.stringify([sp(1), isrc(1), ""]), deep.songs);
// a TIDAL user sends matches for the Spotify share
[st, r] = await call("POST", "/matches", "tokTidalBBBBBBBBBBBBBBB", "tidal", { found: { [isrc(1)]: "901", [isrc(2)]: "902" }, none: [isrc(3)] });
check("matches are taken", st === 200 && r.found === 2 && r.none === 1 && r.written === 3, r);
const songsOf = async (name, col) => (await call("GET", "/library"))[1].shares.find((s) => s.name === name).songs.map((t) => t[col]);
check("the library fills TIDAL IDs and marks the one not found", JSON.stringify(await songsOf("Deep water", 2)) === JSON.stringify(["901", "902", "!"]));
// another ID that played moves to the front; a fourth pushes out the last; the same again writes nothing
await call("POST", "/matches", "tokTidalAAAAAAAAAAAAAAA", "tidal", { found: { [isrc(1)]: "911" } });
await call("POST", "/matches", "tokTidalAAAAAAAAAAAAAAA", "tidal", { found: { [isrc(1)]: "912" } });
check("an ID that played goes first", (await songsOf("Deep water", 2))[0] === "912 911 901");
await call("POST", "/matches", "tokTidalAAAAAAAAAAAAAAA", "tidal", { found: { [isrc(1)]: "901" } });
check("one already there moves to the front", (await songsOf("Deep water", 2))[0] === "901 912 911");
await call("POST", "/matches", "tokTidalAAAAAAAAAAAAAAA", "tidal", { found: { [isrc(1)]: "913" } });
check("a fourth pushes out the last", (await songsOf("Deep water", 2))[0] === "913 901 912");
[st, r] = await call("POST", "/matches", "tokTidalAAAAAAAAAAAAAAA", "tidal", { found: { [isrc(1)]: "913" } });
check("nothing new is not written", r.written === 0, r);
// not found never hides IDs there are
await call("POST", "/matches", "tokTidalAAAAAAAAAAAAAAA", "tidal", { none: [isrc(1)] });
check("not found counts only with no ID", (await songsOf("Deep water", 2))[0] === "913 901 912");
// wrong drops that ID, never a sharer's own
await call("POST", "/matches", "tokTidalAAAAAAAAAAAAAAA", "tidal", { wrong: { [isrc(1)]: "901", [isrc(5)]: "111" } });
check("wrong drops that ID", (await songsOf("Deep water", 2))[0] === "913 912");
check("wrong never touches a sharer's own ID", (await songsOf("Forest", 2))[0] === "111");
// a Spotify user matches the TIDAL share
await call("POST", "/matches", "tokSpotifyAAAAAAAAAAAA", null, { found: { [isrc(5)]: sp(5) }, none: [isrc(6)] });
check("Spotify matches fill the TIDAL share's Spotify column", JSON.stringify(await songsOf("Forest", 0)) === JSON.stringify([sp(5), "!"]));
await call("POST", "/matches", "tokSpotifyAAAAAAAAAAAA", null, { found: { [isrc(6)]: sp(6) } });
check("a song found later replaces not found", (await songsOf("Forest", 0))[1] === sp(6));
// a not found older than 30 days is looked for again
db.prepare("UPDATE recordings SET tidal_none = ? WHERE isrc = ?").run(Date.now() - 31 * 86400000, isrc(3));
// a sharer's own ID comes first, matches after it (this write also clears the library the worker keeps a minute)
await call("POST", "/matches", "tokTidalAAAAAAAAAAAAAAA", "tidal", { found: { [isrc(5)]: "555" } });
check("not found expires after 30 days", (await songsOf("Deep water", 2))[2] === "");
check("the sharer's own ID first, then matches", (await songsOf("Forest", 2))[0] === "111 555");
// copies across services are refused
[st, r] = await call("POST", "/share", "tokTidalBBBBBBBBBBBBBBB", "tidal", { playlist: "00000002-aaaa-4bbb-8ccc-000000000002", name: "Copy", kind: "mood", moods: ["xy"], songs: [["901", isrc(1)], ["902", isrc(2)], ["903", isrc(3)]], ms: 3 });
check("a TIDAL copy of a Spotify share is refused by ISRC", st === 409, r);
// owners: the TIDAL sharer sees theirs in /mine, the Spotify sharer does not
const mineT = (await call("GET", "/mine", "tokTidalAAAAAAAAAAAAAAA", "tidal"))[1], mineS = (await call("GET", "/mine", "tokSpotifyAAAAAAAAAAAA"))[1];
check("each sharer's own shares by service", mineT.shares.map((s) => s.name).join() === "Forest" && mineS.shares.map((s) => s.name).join() === "Deep water", [mineT, mineS]);
// a bad ID for the service is dropped
[st, r] = await call("POST", "/matches", "tokTidalAAAAAAAAAAAAAAA", "tidal", { found: { [isrc(7)]: "not-a-number" } });
check("a TIDAL match that isn't a TIDAL ID is ignored", r.found === 0, r);
console.log(fails ? fails + " failed" : "all passed");
