// Public front door for the Convex backend: api.tandem.siddharthbobba.com.
// Browsers speak HTTP/2 + WebSockets to Cloudflare; this Worker forwards to the
// backend's Tailscale Funnel URL (HTTP/1.1), which Funnel proxies correctly.
// The backend keeps no public port of its own beyond Funnel.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const target = new URL(url.pathname + url.search, env.BACKEND);
    const headers = new Headers(request.headers);
    headers.delete("host");
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      return fetch(target, { headers, method: "GET" });
    }
    return fetch(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
    });
  },
};
