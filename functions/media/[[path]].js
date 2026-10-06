/*
  Audio delivery with working Range support — Cloudflare Pages Function.

  Why this exists: Pages serves static assets without honouring Range requests.
  Verified seven different Range forms (bounded, open-ended, suffix, multi, with
  cache-busting and Accept-Encoding: identity) and all came back HTTP 200 with
  the whole file and no Content-Range, while the same client got a correct 206
  from another host. A browser treats a resource that cannot serve partial
  content as non-seekable: setting currentTime is silently ignored and playback
  snaps back to the start. So the WRLD Player's scrub bar was dead on every
  track it streams - the 55 tracks over the player's own 12 MiB blob ceiling,
  which are the long sessions people scrub most. The other 227 blob-cache into
  memory and seek fine, which is why this only showed up on the big ones.

  Files are read from the same static assets that are already deployed at
  /Audio/, via the ASSETS binding. Nothing is stored twice and no upload is
  needed.

  Full requests are passed through as a stream rather than buffered, so ordinary
  playback costs no memory here. Only a Range request reads the body in order to
  slice it.
*/

const AUDIO_ROOT = "/Audio/";

/* Only ever hand back real audio. Pages answers an unknown path with 200 and the
   SPA HTML, so a missing file must be turned into a real 404 here or it would
   surface as a player that silently never plays - the failure this replaced. */
const AUDIO_TYPES = /^(audio\/|video\/mp4$)/i;

const CACHE = "public, max-age=604800, stale-while-revalidate=86400";

function notFound() {
  return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
}

function badRequest(msg) {
  return new Response(msg, { status: 400, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
}

/* Resolve the request to exactly one file inside Audio/. Rejects anything that
   could climb out of the folder or name something other than a track. */
function trackName(pathname) {
  const raw = pathname.replace(/^\/media\/?/, "");
  if (!raw) return null;
  let name;
  try {
    name = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return null;
  if (name === "." || name === ".." || name.startsWith("..")) return null;
  if (!/\.(mp3|m4a|aac|wav)$/i.test(name)) return null;
  return name;
}

async function fetchAsset(context, name) {
  const origin = new URL(context.request.url).origin;
  const target = new URL(AUDIO_ROOT + encodeURIComponent(name), origin);
  const res = await context.env.ASSETS.fetch(new Request(target.toString(), { method: "GET" }));
  const type = res.headers.get("Content-Type") || "";
  // The ASSETS binding also falls back to index.html for unknown paths.
  if (!res.ok || !AUDIO_TYPES.test(type)) return null;
  return res;
}

/* Parse a single byte range. Returns null when absent or unparseable, and
   "unsatisfiable" with the size when the range cannot be served. */
function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return "ignore"; // multi-range or malformed: answering 200 is legal
  const [, rawStart, rawEnd] = m;
  if (rawStart === "" && rawEnd === "") return "ignore";

  let start, end;
  if (rawStart === "") {
    // suffix form: last N bytes
    const n = Number(rawEnd);
    if (!Number.isFinite(n) || n <= 0) return "unsatisfiable";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return "ignore";
    if (end >= size) end = size - 1;
    if (start > end || start >= size) return "unsatisfiable";
  }
  return { start, end };
}

async function handle(context) {
  const isHead = context.request.method === "HEAD";
  const name = trackName(new URL(context.request.url).pathname);
  if (!name) return badRequest("Bad audio path");

  const asset = await fetchAsset(context, name);
  if (!asset) return notFound();

  const type = asset.headers.get("Content-Type");
  const rangeHeader = context.request.headers.get("Range");
  const declared = Number(asset.headers.get("Content-Length"));
  const knownSize = Number.isFinite(declared) && declared > 0 ? declared : 0;

  // Ordinary playback: stream the file straight through. The ASSETS binding does
  // not reliably send Content-Length, so nothing here may depend on it.
  if (!rangeHeader) {
    const headers = new Headers({
      "Content-Type": type,
      "Accept-Ranges": "bytes",
      "Cache-Control": CACHE,
      "Access-Control-Allow-Origin": "*",
    });
    if (knownSize) headers.set("Content-Length", String(knownSize));
    return new Response(isHead ? null : asset.body, { status: 200, headers });
  }

  // A Range request has to buffer, because slicing needs the real size. Take it
  // from the bytes themselves rather than trusting a header that may be absent -
  // depending on Content-Length here is what made the first deployed version
  // answer 200 to every Range request.
  const body = await asset.arrayBuffer();
  const size = knownSize || body.byteLength;
  const range = parseRange(rangeHeader, size);

  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes", "Cache-Control": "no-store" },
    });
  }

  // Multi-range or malformed: answering the whole file is legal.
  if (!range || range === "ignore") {
    const headers = new Headers({
      "Content-Type": type,
      "Accept-Ranges": "bytes",
      "Cache-Control": CACHE,
      "Access-Control-Allow-Origin": "*",
    });
    headers.set("Content-Length", String(body.byteLength));
    return new Response(isHead ? null : body, { status: 200, headers });
  }

  const { start, end } = range;
  const slice = body.slice(start, end + 1);

  return new Response(isHead ? null : slice, {
    status: 206,
    headers: {
      "Content-Type": type,
      "Content-Length": String(slice.byteLength),
      "Content-Range": `bytes ${start}-${end}/${body.byteLength}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": CACHE,
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function onRequestGet(context) {
  try {
    return await handle(context);
  } catch (err) {
    // Never take audio down entirely because one request misbehaved.
    console.error("media function error", err && err.message);
    return new Response("Audio unavailable", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function onRequestHead(context) {
  return onRequestGet(context);
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS", "Cache-Control": "no-store" },
  });
}