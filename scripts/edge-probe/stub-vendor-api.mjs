/**
 * Deterministic stand-in for the two paid vendors moderate-listing calls:
 * OpenAI omni-moderation (stage 1) and Anthropic messages (stage 3).
 *
 * WHY A STUB AND NOT THE REAL VENDORS. The defect this probe exists for
 * (74de73c8) lived AFTER the verdict — the function wrote status='available' on
 * every approval, which violates marketplace_listings_status_by_post_type_check
 * on a service post. Reaching that line only needs a *decision*, not a real
 * model, and a probe that needs a live OPENAI_API_KEY + network + a model whose
 * output can drift is a probe that will be skipped in CI and rot. The verdict is
 * the input to the code under test here, so it is exactly the right seam to pin.
 *
 * The decision is carried by a marker in the listing title (moderate-listing
 * sends title + category + description as the stage-1 text), so each case
 * chooses its own verdict and nothing depends on model behaviour:
 *
 *   DCPROBE_CLEAN     -> no categories flagged   -> stage 2 -> approve
 *   DCPROBE_SEVERE    -> violence/graphic        -> reject
 *   DCPROBE_MODERATE  -> harassment              -> hold
 *
 * An input carrying NO marker is a bug in the caller, not a "clean" listing, so
 * it 400s rather than defaulting to approve — a stub that silently approves
 * unknown input would turn a broken fixture into a green run.
 *
 * Runs as a container on the Supabase docker network (see scripts/test-edge.sh):
 * the edge runtime reaches it by container name, and the host reaches the
 * published port for /__hits. Deliberately NOT host.docker.internal — that
 * resolves on Docker Desktop but not on a stock Linux CI runner, and this gate
 * has to mean the same thing in both places.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.STUB_PORT ?? 8787);

/** Marker -> the categories block omni-moderation would return. */
const VERDICTS = {
  DCPROBE_CLEAN: {},
  DCPROBE_SEVERE: { "violence/graphic": true },
  DCPROBE_MODERATE: { harassment: true },
  // Part B: no real image is ever involved; the marker alone selects the category.
};

/** Every category omni-moderation can return, so the shape matches the real API. */
const ALL_CATEGORIES = [
  "harassment",
  "harassment/threatening",
  "hate",
  "hate/threatening",
  "illicit",
  "illicit/violent",
  "self-harm",
  "self-harm/instructions",
  "self-harm/intent",
  "sexual",
  "sexual/minors",
  "violence",
  "violence/graphic",
];

const hits = { moderations: 0, messages: 0, unmatched: [], emails: [] };

function categoriesFor(marker) {
  const on = VERDICTS[marker];
  return Object.fromEntries(ALL_CATEGORIES.map((c) => [c, on[c] === true]));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 2_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

/** Pull the marker out of whatever text the caller sent, in either vendor shape. */
function findMarker(haystack) {
  const found = Object.keys(VERDICTS).filter((m) => haystack.includes(m));
  // More than one marker means the fixture is ambiguous; refuse rather than pick.
  return found.length === 1 ? found[0] : null;
}

const server = createServer(async (req, res) => {
  const send = (status, body) => {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
    });
    res.end(payload);
  };

  const url = new URL(req.url, "http://stub");

  if (url.pathname === "/__hits") return send(200, hits);
  if (url.pathname === "/__reset") {
    hits.moderations = 0;
    hits.messages = 0;
    hits.unmatched = [];
    hits.emails = [];
    return send(200, { ok: true });
  }
  if (url.pathname === "/__health") return send(200, { ok: true });

  if (req.method !== "POST") return send(405, { error: "method" });

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return send(400, { error: "bad json" });
  }
  const raw = JSON.stringify(body);

  // ── Resend: POST /emails ──────────────────────────────────────────────────
  // Used by scripts/test-edge-functions.sh to drive send-auth-email's signed
  // webhook path end to end (RESEND_API_URL points here). Records the envelope
  // so the probe can assert WHO the email was addressed to; never a marker.
  if (url.pathname === "/emails") {
    hits.emails.push({
      to: body?.to ?? null,
      subject: body?.subject ?? null,
      from: body?.from ?? null,
      hasHtml: typeof body?.html === "string" && body.html.length > 0,
    });
    return send(200, { id: `email-dcprobe-${hits.emails.length}` });
  }

  const marker = findMarker(raw);

  // ── stage 1: OpenAI omni-moderation ───────────────────────────────────────
  if (url.pathname === "/v1/moderations") {
    hits.moderations += 1;
    if (!marker) {
      hits.unmatched.push(raw.slice(0, 300));
      return send(400, {
        error: {
          message:
            "stub-vendor-api: no DCPROBE_* marker in the moderation input. " +
            "Refusing to default to clean — see the header of this file.",
        },
      });
    }
    // One result per input item, which is what the real API returns and what
    // moderate-listing's stage-1 log counts to prove every photo was screened.
    const items = Array.isArray(body.input) ? body.input.length : 1;
    const categories = categoriesFor(marker);
    const flagged = Object.values(categories).some(Boolean);
    return send(200, {
      id: "modr-dcprobe",
      model: "omni-moderation-latest",
      results: Array.from({ length: items }, () => ({
        flagged,
        categories,
        category_scores: Object.fromEntries(
          ALL_CATEGORIES.map((c) => [c, categories[c] ? 0.99 : 0.001])
        ),
      })),
    });
  }

  // ── stage 3: Anthropic messages ───────────────────────────────────────────
  // Only reached when a listing trips a stage-2 scam pattern. The 8 lifecycle
  // cases deliberately do not, so this exists so a scam-flagged fixture gets a
  // deterministic answer instead of hanging on a 20s timeout into a real host.
  if (url.pathname === "/v1/messages") {
    hits.messages += 1;
    const decision = marker === "DCPROBE_CLEAN" ? "approve" : "hold";
    return send(200, {
      id: "msg-dcprobe",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5-20251001",
      content: [
        {
          type: "text",
          text: JSON.stringify({
            decision,
            categories: ["stub_verdict"],
            reason: "stub-vendor-api deterministic verdict",
          }),
        },
      ],
    });
  }

  return send(404, { error: `no stub route for ${url.pathname}` });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[stub-vendor-api] listening on 0.0.0.0:${PORT}`);
});
