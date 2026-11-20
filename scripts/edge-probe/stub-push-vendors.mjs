/**
 * Deterministic stand-in for the three network calls send-push makes:
 * APNs (iOS), FCM HTTP v1 (Android), and the Google OAuth token exchange FCM
 * needs first.
 *
 * WHY A STUB AND NOT THE REAL VENDORS. The defect class this probe exists for is
 * RECIPIENT SCOPING — whose phone a notification lands on. Reaching that line
 * needs a delivery endpoint that *answers*, not Apple's. A probe that needs a live
 * APNs key, a real Firebase project and outbound network is a probe that gets
 * skipped in CI and rots, and this repo has four logged instances of a gate that
 * could not catch its own bug. Delivery is the INPUT to the fan-out under test,
 * so it is exactly the right seam to pin.
 *
 * WHAT THE STUB IS FOR: it is the only place that can see WHICH device tokens a
 * single send-push call actually reached. The function's own response body reports
 * counts and REDACTED token prefixes (by design — full tokens never leave it), and
 * a count cannot tell "2 sent" from "2 sent to the wrong students". So the stub
 * records every (token, title) pair it is asked to deliver, and the probe asserts
 * SET EQUALITY against the recipient it asked for.
 *
 * Behaviour is carried by the token string, so each case picks its own vendor
 * outcome and nothing depends on a live service:
 *
 *   …-STALE  -> APNs 410 Unregistered / FCM 404 UNREGISTERED  (send-push must
 *               delete the row and keep fanning out to the rest)
 *   …-BOOM   -> 503 from both                                  (a transient
 *               failure: send-push must NOT delete the row)
 *   anything else -> 200
 *
 * Runs as a container on the Supabase docker network (see scripts/test-edge-push.sh):
 * the edge runtime reaches it by container name, the host reaches the published
 * port for /__hits. Deliberately NOT host.docker.internal — that resolves on
 * Docker Desktop but not on a stock Linux CI runner, and this gate has to mean the
 * same thing in both places.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.STUB_PORT ?? 8788);

/** Every delivery attempt, in order. The probe reads this and asserts set equality. */
const hits = {
  /** { token, title, body, bundleId, data } */
  apns: [],
  /** { token, title, body, projectId, data } */
  fcm: [],
  /** count of OAuth token exchanges — proves the FCM path was really exercised */
  oauth: 0,
  /** anything that did not match a known vendor route, so a silent 404 cannot hide */
  unmatched: [],
};

function outcomeFor(token) {
  if (token.includes("-STALE")) return "stale";
  if (token.includes("-BOOM")) return "transient";
  return "ok";
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

const server = createServer(async (req, res) => {
  const send = (status, body) => {
    const payload = JSON.stringify(body ?? {});
    res.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
    });
    res.end(payload);
  };

  const url = new URL(req.url, "http://stub");

  if (url.pathname === "/__health") return send(200, { ok: true });
  if (url.pathname === "/__hits") return send(200, hits);
  if (url.pathname === "/__reset") {
    hits.apns = [];
    hits.fcm = [];
    hits.oauth = 0;
    hits.unmatched = [];
    return send(200, { ok: true });
  }

  if (req.method !== "POST") return send(405, { error: "method" });

  const rawBody = await readBody(req);

  // ── Google OAuth: the service-account JWT exchange FCM needs ────────────────
  // Form-encoded, not JSON. The assertion is not checked: send-push signs it with
  // the throwaway RSA key the runner generated, and verifying it here would only
  // re-test `jose`.
  if (url.pathname === "/oauth2/token") {
    hits.oauth += 1;
    return send(200, {
      access_token: "dcpush-probe-access-token",
      token_type: "Bearer",
      expires_in: 3600,
    });
  }

  let body = null;
  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    /* reported through `unmatched` below if the route needed it */
  }

  // ── APNs: POST /3/device/<token> ───────────────────────────────────────────
  const apnsMatch = url.pathname.match(/^\/3\/device\/(.+)$/);
  if (apnsMatch) {
    const token = decodeURIComponent(apnsMatch[1]);
    const alert = body?.aps?.alert ?? {};
    hits.apns.push({
      token,
      title: alert.title ?? null,
      body: alert.body ?? null,
      bundleId: req.headers["apns-topic"] ?? null,
      data: Object.fromEntries(Object.entries(body ?? {}).filter(([k]) => k !== "aps")),
    });
    const outcome = outcomeFor(token);
    if (outcome === "stale") return send(410, { reason: "Unregistered" });
    if (outcome === "transient") return send(503, { reason: "ServiceUnavailable" });
    return send(200, {});
  }

  // ── FCM HTTP v1: POST /v1/projects/<project>/messages:send ─────────────────
  const fcmMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)\/messages:send$/);
  if (fcmMatch) {
    const token = body?.message?.token ?? "";
    hits.fcm.push({
      token,
      title: body?.message?.notification?.title ?? null,
      body: body?.message?.notification?.body ?? null,
      projectId: fcmMatch[1],
      data: body?.message?.data ?? {},
    });
    const outcome = outcomeFor(token);
    if (outcome === "stale") {
      return send(404, {
        error: {
          code: 404,
          status: "NOT_FOUND",
          message: "Requested entity was not found.",
          details: [
            {
              "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
              errorCode: "UNREGISTERED",
            },
          ],
        },
      });
    }
    if (outcome === "transient") {
      return send(503, {
        error: { code: 503, status: "UNAVAILABLE", message: "The service is unavailable." },
      });
    }
    return send(200, { name: `projects/${fcmMatch[1]}/messages/dcpush-probe` });
  }

  hits.unmatched.push({ method: req.method, path: url.pathname, body: rawBody.slice(0, 300) });
  return send(404, { error: `no stub route for ${url.pathname}` });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[stub-push-vendors] listening on 0.0.0.0:${PORT}`);
});
