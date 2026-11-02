// A Cloudflare Worker for Ceremony Playlist Builder.
// Spotify sends a Retry-After header with a rate limit, but does not let a web page read it. After a rate limit with no readable wait, the page asks this
// worker to send one GET /v1/me to Spotify with the person's sign-in, and the worker answers with only the status, Retry-After and the reason.
// Nothing is kept or logged here (leave Workers Logs off), and Spotify's answer itself is not passed on.
const ALLOWED_ORIGIN = "https://playlists.roncarmel.com";

export default {
  async fetch(request) {
    const cors = { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "Authorization", "Access-Control-Max-Age": "86400", "Vary": "Origin" };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "GET" || request.headers.get("Origin") !== ALLOWED_ORIGIN) return new Response("Not allowed", { status: 403 });
    const auth = request.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return new Response("Not allowed", { status: 403, headers: cors });
    const answer = await fetch("https://api.spotify.com/v1/me", { headers: { Authorization: auth } });
    let reason = "";
    if (answer.status === 429) { try { const data = await answer.json(); reason = (data && data.error && data.error.reason) || ""; } catch (err) { /* no body */ } }
    return Response.json({ status: answer.status, retryAfter: answer.headers.get("Retry-After"), reason }, { headers: { ...cors, "Cache-Control": "no-store" } });
  },
};
