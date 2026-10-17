/*
 * Local dev server.
 *
 * WHY THIS EXISTS
 * `wrangler pages dev` serves both the static assets and the Functions from one
 * node process. The service worker precached ~113 assets in a single tick, which
 * saturated that process; the page's own stylesheet and script requests queued
 * behind the precache and came back 502. The worker relayed those rather than
 * inventing them, so the symptom landed on the stylesheets while the cause sat
 * beside them.
 *
 * The concurrency cap in sw.js fixes the cause. This removes the possibility
 * entirely, and fixes the damage too:
 *
 *   1. Static files are served straight off disk. No bundler, no watcher, no
 *      queue. A request cannot be starved by another request.
 *   2. Every asset is sent with `Cache-Control: no-store`. A 502 that slips
 *      through can therefore never be stored by the browser and silently
 *      replayed on every later load - which is what left the site rendering as
 *      raw text with no CSS at all, and which deleting the service worker and
 *      clearing Cache Storage did nothing about.
 *   3. /api/* is proxied through to wrangler, so the Functions keep working.
 *
 * Usage:
 *   node scripts/dev-server.js                  # serves on :8787, proxies to :8789
 *   PORT=9000 WRANGLER_PORT=9001 node scripts/dev-server.js
 *
 * Run wrangler on the proxy port first:
 *   wrangler pages dev . --port 8789
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = parseInt(process.env.PORT || "8787", 10);
const WRANGLER_PORT = parseInt(process.env.WRANGLER_PORT || "8789", 10);
/* 0.0.0.0 by default rather than loopback, so the site is also reachable on the
   machine's LAN address. Loopback-only means any tooling outside this machine -
   a browser harness, a phone on the same wifi - cannot load the page at all,
   which is indistinguishable from the server being broken. */
const HOST = process.env.HOST || "0.0.0.0";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".webm": "video/webm",
  ".zip": "application/zip",
  ".sql": "text/plain; charset=utf-8",
};

function send(res, status, body, headers) {
  res.writeHead(status, {
    "Cache-Control": "no-store, must-revalidate",
    ...headers,
  });
  res.end(body);
}

/* Range support, so seeking in an audio file works locally. A 200 where the
   browser asked for bytes 100-200 makes the player treat the whole file as the
   requested slice and seek wrongly. */
function serveFile(req, res, file) {
  const ext = path.extname(file).toLowerCase();
  const type = TYPES[ext] || "application/octet-stream";
  const stat = fs.statSync(file);

  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      let start = m[1] === "" ? null : parseInt(m[1], 10);
      let end = m[2] === "" ? null : parseInt(m[2], 10);
      if (start === null) {
        // suffix range: last N bytes
        start = Math.max(0, stat.size - (end || 0));
        end = stat.size - 1;
      } else if (end === null || end >= stat.size) {
        end = stat.size - 1;
      }
      if (start <= end && start < stat.size) {
        res.writeHead(206, {
          "Content-Type": type,
          "Content-Range": "bytes " + start + "-" + end + "/" + stat.size,
          "Accept-Ranges": "bytes",
          "Content-Length": end - start + 1,
          "Cache-Control": "no-store, must-revalidate",
        });
        return fs.createReadStream(file, { start: start, end: end }).pipe(res);
      }
      return send(res, 416, null, { "Content-Range": "bytes */" + stat.size });
    }
  }

  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": stat.size,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store, must-revalidate",
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(req.url.split("?")[0]);
  } catch (_) {
    return send(res, 400, "bad request");
  }

  /* Functions live on the wrangler port. Everything else is a file on disk, so a
     slow or busy Functions runtime can never starve an asset. */
  if (pathname.startsWith("/api/")) {
    const proxy = http.request(
      {
        host: "127.0.0.1",
        port: WRANGLER_PORT,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: "127.0.0.1:" + WRANGLER_PORT },
      },
      (proxied) => {
        res.writeHead(proxied.statusCode, {
          ...proxied.headers,
          "Cache-Control": "no-store",
        });
        proxied.on("error", () => res.destroy());
        proxied.pipe(res);
      }
    );
    /* The backend can fail after the response has already started - mid-body,
       for instance. Sending a 502 at that point is a second writeHead, which
       throws ERR_HTTP_HEADERS_SENT. Uncaught, that kills the whole dev server,
       so the next request cannot even connect and the site looks broken rather
       than reporting an unreachable backend. This fired every time the Functions
       runtime was restarted, which is why the server kept dying mid-session. */
    proxy.on("error", () => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      send(res, 502, JSON.stringify({ ok: false, error: "functions_unavailable" }), {
        "Content-Type": "application/json; charset=utf-8",
      });
    });
    // A client that disconnects mid-request is routine, not a crash.
    res.on("error", () => {});
    req.on("error", () => {});
    req.pipe(proxy);
    return;
  }

  if (pathname === "/") pathname = "/index.html";

  const file = path.join(ROOT, pathname);
  if (!file.startsWith(ROOT)) return send(res, 403, "forbidden");

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      // Single-page app: unknown paths without a file extension are routes.
      if (!path.extname(pathname)) {
        return serveFile(req, res, path.join(ROOT, "index.html"));
      }
      return send(res, 404, "not found");
    }
    serveFile(req, res, file);
  });
});

server.listen(PORT, HOST, () => {
  console.log("dev server   http://127.0.0.1:" + PORT + "/  (also http://<lan-ip>:" + PORT + "/)");
  console.log("functions    proxied to http://127.0.0.1:" + WRANGLER_PORT);
  console.log("assets       served from disk, Cache-Control: no-store");
});