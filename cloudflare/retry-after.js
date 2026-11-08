// A Cloudflare Worker for Ceremony Playlist Builder.
// Spotify sends a Retry-After header with a rate limit, but does not let a web page read it. After a rate limit with no readable wait, the page asks this
// worker to send one GET to Spotify with the person's sign-in, and the worker answers with only the status, Retry-After and the reason.
// Spotify limits each kind of request on its own (/me can answer while /me/playlists is refused), so the page says which kind, as ?path=, and
// the worker reads that kind, one item at most. Only the paths below are allowed; anything else, or none (older pages), asks /me.
// Nothing is kept or logged here (leave Workers Logs off), and Spotify's answer itself is not passed on.
const ALLOWED_ORIGINS = ["https://arc.roncarmel.com", "https://playlists.roncarmel.com"];
const ALLOWED_PATH = /^\/(me|me\/playlists|playlists\/[A-Za-z0-9]{22}(\/items|\/images)?)$/;

function spotifyAddress(path) {
  if (!ALLOWED_PATH.test(path || "")) return "https://api.spotify.com/v1/me";
  const light = /^\/playlists\/[A-Za-z0-9]{22}$/.test(path) ? "?fields=id" : (/(playlists|items)$/.test(path) ? "?limit=1" : "");
  return "https://api.spotify.com/v1" + path + light;
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const cors = { "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0], "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "Authorization", "Access-Control-Max-Age": "86400", "Vary": "Origin" };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "GET" || !ALLOWED_ORIGINS.includes(origin)) return new Response("Not allowed", { status: 403 });
    const auth = request.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return new Response("Not allowed", { status: 403, headers: cors });
    const answer = await fetch(spotifyAddress(new URL(request.url).searchParams.get("path")), { headers: { Authorization: auth } });
    let reason = "";
    if (answer.status === 429) { try { const data = await answer.json(); reason = (data && data.error && data.error.reason) || ""; } catch (err) { /* no body */ } }
    return Response.json({ status: answer.status, retryAfter: answer.headers.get("Retry-After"), reason }, { headers: { ...cors, "Cache-Control": "no-store" } });
  },
};
