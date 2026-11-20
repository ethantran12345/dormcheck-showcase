// Fetches OpenGraph metadata for a user-supplied URL.
//
// Security: internet-facing fetch of attacker-controlled URLs. Guards:
// - http/https only, default ports only
// - DNS resolution checked against private/link-local/metadata ranges
// - redirects followed manually, each hop re-validated (max 3)
// - response capped at 1 MB and 8s
// JWT is enforced by the Supabase gateway (verify_jwt default).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.43/deno-dom-wasm.ts";

const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast / reserved
  );
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fe80:") || // link-local
    lower.startsWith("fc") || // unique local fc00::/7
    lower.startsWith("fd") ||
    lower.startsWith("::ffff:") // v4-mapped; v4 check happens via resolved A records
  );
}

// A validated target: the parsed URL plus the specific IP we will connect to.
// Connecting to this exact IP (instead of letting fetch re-resolve the
// hostname) is what closes the DNS-rebinding (TOCTOU) SSRF hole.
interface SafeTarget {
  url: URL;
  connectIp: string;
}

async function assertSafeUrl(rawUrl: string): Promise<SafeTarget> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed");
  }
  if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
    throw new Error("Non-standard ports are not allowed");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Credentials in URL are not allowed");
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  // Literal IP hosts: validate, then connect to that exact literal.
  if (/^\d+(\.\d+){3}$/.test(hostname)) {
    if (isPrivateIpv4(hostname)) throw new Error("Blocked address");
    return { url: parsed, connectIp: hostname };
  }
  if (hostname.includes(":")) {
    if (isPrivateIpv6(hostname)) throw new Error("Blocked address");
    return { url: parsed, connectIp: hostname };
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".internal")) {
    throw new Error("Blocked address");
  }

  // Resolve and verify EVERY returned address, then pin to the first valid one.
  // We connect to this IP directly so there is no second, unchecked resolution.
  let pinnedIp: string | null = null;
  for (const recordType of ["A", "AAAA"] as const) {
    let ips: string[];
    try {
      ips = await Deno.resolveDns(hostname, recordType);
    } catch {
      continue; // NXDOMAIN for one record type is fine
    }
    for (const ip of ips) {
      if (recordType === "A" ? isPrivateIpv4(ip) : isPrivateIpv6(ip)) {
        throw new Error("Blocked address");
      }
      if (!pinnedIp) pinnedIp = ip;
    }
  }
  if (!pinnedIp) {
    throw new Error("Could not resolve host");
  }
  return { url: parsed, connectIp: pinnedIp };
}

async function writeAll(conn: Deno.Writer, data: Uint8Array): Promise<void> {
  let written = 0;
  while (written < data.length) {
    written += await conn.write(data.subarray(written));
  }
}

async function readAllCapped(conn: Deno.Reader, cap: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const buf = new Uint8Array(16 * 1024);
  while (total < cap) {
    let n: number | null;
    try {
      n = await conn.read(buf);
    } catch {
      break; // connection closed (timeout) or read error
    }
    if (n === null) break;
    chunks.push(buf.slice(0, n));
    total += n;
  }
  const merged = new Uint8Array(Math.min(total, cap));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.length, merged.length - offset);
    merged.set(chunk.subarray(0, take), offset);
    offset += take;
    if (offset >= merged.length) break;
  }
  return merged;
}

interface PinnedResponse {
  status: number;
  headers: Map<string, string>;
  body: string;
}

// Performs one HTTP request over a connection PINNED to the validated IP.
// TLS still uses the real hostname for SNI + certificate verification, so an
// attacker cannot rebind the hostname to an internal IP between validation and
// connection. HTTP/1.0 + Accept-Encoding: identity avoids chunked/gzip framing
// so the body can be read straight off the socket.
async function pinnedRequest(target: SafeTarget): Promise<PinnedResponse> {
  const { url, connectIp } = target;
  const isTls = url.protocol === "https:";
  const port = url.port ? Number(url.port) : isTls ? 443 : 80;

  const tcp = await Deno.connect({ hostname: connectIp, port });
  let conn: Deno.Conn;
  try {
    conn = isTls ? await Deno.startTls(tcp, { hostname: url.hostname }) : tcp;
  } catch (e) {
    try { tcp.close(); } catch { /* ignore */ }
    throw e;
  }

  const timer = setTimeout(() => {
    try { conn.close(); } catch { /* ignore */ }
  }, FETCH_TIMEOUT_MS);

  try {
    const path = (url.pathname || "/") + (url.search || "");
    const request =
      `GET ${path} HTTP/1.0\r\n` +
      `Host: ${url.host}\r\n` +
      `User-Agent: Mozilla/5.0 (compatible; DormCheckbot/1.0; +https://dormcheck.app)\r\n` +
      `Accept: text/html,application/xhtml+xml\r\n` +
      `Accept-Encoding: identity\r\n` +
      `Connection: close\r\n\r\n`;
    await writeAll(conn, new TextEncoder().encode(request));

    const raw = await readAllCapped(conn, MAX_BODY_BYTES + 64 * 1024);

    // Split headers from body on the first CRLFCRLF.
    let sep = -1;
    for (let i = 0; i + 3 < raw.length; i++) {
      if (raw[i] === 13 && raw[i + 1] === 10 && raw[i + 2] === 13 && raw[i + 3] === 10) {
        sep = i;
        break;
      }
    }
    const headText = new TextDecoder().decode(sep >= 0 ? raw.subarray(0, sep) : raw);
    const bodyBytes = sep >= 0
      ? raw.subarray(sep + 4, Math.min(raw.length, sep + 4 + MAX_BODY_BYTES))
      : new Uint8Array(0);

    const lines = headText.split("\r\n");
    const statusMatch = /^HTTP\/\d\.\d\s+(\d{3})/.exec(lines[0] ?? "");
    const status = statusMatch ? Number(statusMatch[1]) : 0;
    const headers = new Map<string, string>();
    for (let i = 1; i < lines.length; i++) {
      const idx = lines[i].indexOf(":");
      if (idx > 0) {
        headers.set(lines[i].slice(0, idx).trim().toLowerCase(), lines[i].slice(idx + 1).trim());
      }
    }

    return { status, headers, body: new TextDecoder("utf-8", { fatal: false }).decode(bodyBytes) };
  } finally {
    clearTimeout(timer);
    try { conn.close(); } catch { /* ignore */ }
  }
}

async function safeFetch(rawUrl: string): Promise<{ html: string; finalUrl: string }> {
  let current = rawUrl;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const target = await assertSafeUrl(current); // re-validates + re-pins each hop
    const { status, headers, body } = await pinnedRequest(target);
    if (status >= 300 && status < 400) {
      const location = headers.get("location");
      if (!location) throw new Error("Redirect without location");
      current = new URL(location, target.url).toString();
      continue;
    }
    return { html: body, finalUrl: target.url.toString() };
  }
  throw new Error("Too many redirects");
}

serve(async (req) => {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== "string") {
      return new Response(JSON.stringify({ error: "URL is required" }), {
        status: 400,
      });
    }

    let html: string;
    let finalUrl: string;
    try {
      ({ html, finalUrl } = await safeFetch(url));
    } catch (e) {
      return new Response(
        JSON.stringify({ error: (e as Error).message || "Fetch blocked" }),
        { status: 400 },
      );
    }

    const doc = new DOMParser().parseFromString(html, "text/html");

    if (!doc) {
      return new Response(JSON.stringify({ error: "Failed to parse HTML" }), {
        status: 500,
      });
    }

    const getMetaContent = (name: string) => {
      const element =
        doc.querySelector(`meta[property='${name}']`) ||
        doc.querySelector(`meta[name='${name}']`);
      return element ? element.getAttribute("content") : null;
    };

    const title =
      getMetaContent("og:title") || doc.querySelector("title")?.textContent || "";
    const image = getMetaContent("og:image") || "";

    let validImage = image;
    if (image && !image.startsWith("http")) {
      try {
        validImage = new URL(image, finalUrl).toString();
      } catch {
        validImage = "";
      }
    }

    return new Response(
      JSON.stringify({ title, image: validImage, url }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500 },
    );
  }
});
