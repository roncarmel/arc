// Arc's media: serves files from the R2 bucket arc-media, such as the tutorial video (tutorial.mp4), at arc-media.roncarmel.workers.dev/<name>.
// Answers the partial requests (Range) a video player makes, which Safari needs to play a video at all. Reads only; nothing is logged or kept.
// Deploy from this folder with: npx wrangler deploy. Replace a file with: npx wrangler r2 object put arc-media/<name> --file=<path> --content-type=<type> --remote

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    const key = decodeURIComponent(new URL(request.url).pathname.slice(1));
    if (!/^[A-Za-z0-9._-]+$/.test(key)) return new Response("Not found", { status: 404 });

    const object = request.method === "HEAD"
      ? await env.MEDIA.head(key)
      : await env.MEDIA.get(key, { range: request.headers, onlyIf: request.headers });
    if (!object) return new Response("Not found", { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("accept-ranges", "bytes");
    headers.set("cache-control", "public, max-age=3600");   // a replaced file shows within the hour

    if (request.method === "HEAD") {
      headers.set("content-length", String(object.size));
      return new Response(null, { status: 200, headers });
    }
    // a condition that failed (If-None-Match: the browser has it already; If-Match and the like: it changed)
    if (!("body" in object)) {
      return new Response(null, { status: request.headers.has("if-none-match") ? 304 : 412, headers });
    }
    const range = object.range;
    if (range && request.headers.has("range")) {
      const start = "suffix" in range && range.suffix !== undefined ? object.size - range.suffix : (range.offset || 0);
      const length = range.length !== undefined ? range.length : object.size - start;
      headers.set("content-range", `bytes ${start}-${start + length - 1}/${object.size}`);
      headers.set("content-length", String(length));
      return new Response(object.body, { status: 206, headers });
    }
    headers.set("content-length", String(object.size));
    return new Response(object.body, { status: 200, headers });
  },
};
