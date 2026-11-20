/**
 * send-push, DRIVEN — fan a push out to a real user's real device_tokens rows
 * against a live local stack, and assert WHOSE PHONE IT REACHED.
 *
 * WHY THIS PROBE EXISTS
 * ---------------------
 * send-push is 529 lines that end in an unbounded loop over device tokens, and it
 * had zero automated coverage. Every push in the product converges here: the Vercel
 * /api senders and the private.dispatch_push() DB triggers all POST this one
 * function. A scoping defect — one dropped `.eq("user_id", …)`, one recipient list
 * built from the wrong id — delivers one student's notification to another
 * student's lock screen. That is unrecallable, it is live on iOS and Android
 * today, and there is no screen anywhere in the app where a human would notice it:
 * the function's own response reports COUNTS and redacted token prefixes, so "2
 * sent" and "2 sent to the wrong students" are the same success line.
 *
 * So the assertions here are about SCOPING, not delivery. Set equality on the
 * tokens the vendor stub was asked to deliver to, per call. A count is not enough.
 *
 * WHAT IS REAL HERE. The function runs in the real edge runtime, reached over HTTP
 * through Kong, authorised by the real SEND_PUSH_AUTH_TOKEN bearer check (which is
 * its ENTIRE gate — send-push is deployed verify_jwt:false, so the platform is not
 * checking anything for it). It reads the real device_tokens table through
 * PostgREST with the service role, signs real ES256/RS256 provider JWTs with jose,
 * and deletes real rows on a 410/UNREGISTERED. The last phase drives the whole
 * production path: a real profiles UPDATE fires the real trg_notify_building_new_resident
 * trigger, which calls the real private.dispatch_push(), which POSTs this function
 * over pg_net.
 *
 * The ONLY substitutions are APNs, FCM and Google's OAuth endpoint, pinned to
 * deterministic answers by scripts/edge-probe/stub-push-vendors.mjs — delivery is
 * the input to the fan-out under test, not the fan-out.
 *
 * VERDICT NAMESPACES, and why they are load-bearing:
 *   auth/…        the bearer gate. Must stay GREEN under the scoping mutation —
 *                 that is what proves a red run was caused by the mutation and not
 *                 by a broken stack posing as one.
 *   scope/…       whose tokens were reached. The mutation must turn these RED.
 *   resilience/…  one bad token must not break the fan-out for everyone else.
 *   suppress/…    quiet hours: the recipient is right, the moment is not.
 *
 * Conventions borrowed from scripts/test-db.sh and the moderate-listing probe on
 * purpose: print a PASS/FAIL token per assertion and let the runner assert a
 * MINIMUM verdict count. Silence is not success — a fixture that stops matching
 * must go red, not quiet.
 *
 * Run it through scripts/test-edge-push.sh; it needs env this script does not set.
 */

const API_URL = need("SUPABASE_API_URL");
const ANON_KEY = need("SUPABASE_ANON_KEY");
const SERVICE_KEY = need("SUPABASE_SERVICE_ROLE_KEY");
const STUB_HOST_URL = need("STUB_HOST_URL");
const PUSH_AUTH_TOKEN = need("SEND_PUSH_AUTH_TOKEN");
const DORM = need("PROBE_DORM");

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`FAIL: ${name} is not set — run this through scripts/test-edge-push.sh`);
    process.exit(2);
  }
  return v;
}

const FN_URL = `${API_URL}/functions/v1/send-push`;
const PASSWORD = "SendPushProbe!Passw0rd1";

/**
 * Four students. The point of the cast is that three of them must NEVER receive
 * anything addressed to the fourth:
 *   a        the recipient under test (two platforms, so the loop really forks)
 *   b        a different student at the SAME university, same dorm — the control
 *   blocked  same university, same dorm, but has blocked `a`
 *   cmu      a different TENANT entirely, in a dorm with the same name
 */
const USERS = {
  a: { email: "probe-push-a@pitt.edu", tenant: "pitt", name: "Probe A" },
  b: { email: "probe-push-b@pitt.edu", tenant: "pitt", name: "Probe B" },
  blocked: { email: "probe-push-blocked@pitt.edu", tenant: "pitt", name: "Probe Blocked" },
  cmu: { email: "probe-push-cmu@andrew.cmu.edu", tenant: "cmu", name: "Probe CMU" },
};

/** Token behaviour is carried by the string; see stub-push-vendors.mjs. */
const TOKENS = {
  a: [
    ["DCPUSH-A-IOS-1", "ios"],
    ["DCPUSH-A-AND-1", "android"],
  ],
  b: [["DCPUSH-B-IOS-1", "ios"]],
  blocked: [["DCPUSH-BLOCKED-IOS-1", "ios"]],
  cmu: [["DCPUSH-CMU-IOS-1", "ios"]],
};
const A_STALE = [
  ["DCPUSH-A-IOS-STALE", "ios"],
  ["DCPUSH-A-AND-STALE", "android"],
];
const A_TRANSIENT = [["DCPUSH-A-IOS-BOOM", "ios"]];

let passes = 0;
let failures = 0;
function assert(ok, label, detail = "") {
  if (ok) {
    passes += 1;
    console.log(`PASS ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const sortUnique = (xs) => [...new Set(xs)].sort();
const sameSet = (got, want) => JSON.stringify(sortUnique(got)) === JSON.stringify(sortUnique(want));

// ── thin REST helpers (no SDK: this script must run with zero node_modules, so a
// lane's symlinked deps can never change what it means) ──────────────────────
async function rest(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${API_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON bodies surface through `text` */
  }
  return { status: res.status, json, text };
}

async function admin(path, { method = "POST", body } = {}) {
  const res = await fetch(`${API_URL}/auth/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const stub = (path) => fetch(`${STUB_HOST_URL}${path}`).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A quiet-hours window (UTC) that contains this instant with an hour to spare. */
function windowAroundNow() {
  const now = new Date();
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const hhmm = (m) => {
    const x = ((m % 1440) + 1440) % 1440;
    return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
  };
  return {
    quiet_hours_start: hhmm(nowMin - 60),
    quiet_hours_end: hhmm(nowMin + 60),
    quiet_hours_timezone: "UTC",
  };
}

/** Every token the stub was asked to deliver to, for one notification title. */
function deliveredFor(hits, title) {
  return sortUnique(
    [...hits.apns, ...hits.fcm].filter((h) => h.title === title).map((h) => h.token),
  );
}

/** POST send-push the way dispatch_push does: bearer shared token, JSON body. */
async function callSendPush(body, { token = PUSH_AUTH_TOKEN, method = "POST" } = {}) {
  const headers = { "content-type": "application/json" };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(FN_URL, {
    method,
    headers,
    body: method === "POST" && body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* surfaced through text */
  }
  return { status: res.status, json, text };
}

// ── fixtures ────────────────────────────────────────────────────────────────
/** Returns { id, restore } — restore puts is_active back if we had to flip it. */
async function university(slug) {
  const { json } = await rest(`universities?slug=eq.${slug}&select=id,is_active&limit=1`);
  const row = json?.[0];
  if (!row?.id) throw new Error(`no '${slug}' university row — is this a reset stack?`);
  if (row.is_active === false) {
    // A local `db reset` leaves CMU inactive (prod was flipped by hand, never in a
    // migration), and validate_university_email() refuses a signup on an inactive
    // tenant. Flip it for the run and put it back — a cross-tenant probe whose
    // second tenant cannot exist proves nothing, and silently leaving the stack
    // changed would be a gift to the next agent.
    await rest(`universities?id=eq.${row.id}`, {
      method: "PATCH",
      body: { is_active: true },
      headers: { Prefer: "return=minimal" },
    });
    return { id: row.id, wasInactive: true };
  }
  return { id: row.id, wasInactive: false };
}

async function findUserByEmail(email) {
  const { json } = await admin(`admin/users?filter=${encodeURIComponent(email)}`, {
    method: "GET",
  });
  return (json?.users ?? []).find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function ensureUser(spec, universityId, { visible }) {
  let user = await findUserByEmail(spec.email);
  if (!user) {
    const created = await admin("admin/users", {
      body: { email: spec.email, password: PASSWORD, email_confirm: true },
    });
    user = created.json;
    if (!user?.id) {
      throw new Error(`could not create ${spec.email}: ${JSON.stringify(created.json)}`);
    }
  }
  // The auth.users trigger creates the profiles row first, so this is always an
  // update, never an insert.
  const { status, text } = await rest(`profiles?id=eq.${user.id}`, {
    method: "PATCH",
    body: {
      university_id: universityId,
      full_name: spec.name,
      current_dorm: DORM,
      housing_type: "on-campus",
      show_in_building: visible,
      quiet_hours_enabled: false,
    },
    headers: { Prefer: "return=minimal" },
  });
  if (status >= 300) throw new Error(`profile setup failed for ${spec.email}: ${status} ${text}`);
  return user.id;
}

async function insertTokens(userId, pairs) {
  const { status, text } = await rest("device_tokens", {
    method: "POST",
    body: pairs.map(([token, platform]) => ({ user_id: userId, token, platform })),
    headers: { Prefer: "return=minimal" },
  });
  if (status >= 300) throw new Error(`device_tokens insert failed: ${status} ${text}`);
}

async function tokensInDb() {
  const { json } = await rest("device_tokens?token=like.DCPUSH-*&select=token,user_id,platform");
  return sortUnique((json ?? []).map((r) => r.token));
}

async function clearFixtures(ids) {
  const inList = `(${ids.join(",")})`;
  await rest("device_tokens?token=like.DCPUSH-*", {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  await rest(`blocked_users?blocker_id=in.${inList}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  await rest(`blocked_users?blocked_id=in.${inList}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  // The building trigger EXCLUDES a recipient whose unread digest already counts
  // this joiner. Leftovers from a previous run would make the control resident
  // silently ineligible and the trigger phase would go red for the wrong reason.
  await rest(`notifications?recipient_id=in.${inList}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

/**
 * Wait for a push carrying `title` to reach the stub, then let the queue settle so
 * a LATE second delivery still lands inside the window we assert on. Without the
 * settle a leak that arrives 200ms after the control would read as "not delivered"
 * and the probe would be green for the worst possible reason.
 */
async function waitForPush(title, { timeoutMs = 45_000, settleMs = 4_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let hits = await stub("/__hits");
  while (Date.now() < deadline && deliveredFor(hits, title).length === 0) {
    await sleep(500);
    hits = await stub("/__hits");
  }
  await sleep(settleMs);
  return stub("/__hits");
}

// ── the drive ───────────────────────────────────────────────────────────────
async function run() {
  // Substitution must be PROVEN, not assumed. If the edge runtime cannot reach the
  // stub, every delivery attempt throws inside the fan-out loop and the probe would
  // go red blaming the function.
  const health = await stub("/__health");
  if (!health?.ok) throw new Error(`stub not reachable from the host at ${STUB_HOST_URL}`);

  const pitt = await university("pitt");
  const cmu = await university("cmu");
  if (cmu.wasInactive) console.log("· cmu.is_active was false on this stack; flipped for the run");

  const ids = {};
  for (const [key, spec] of Object.entries(USERS)) {
    // `a` starts HIDDEN so the building trigger's WHEN clause cannot fire for them
    // during setup; the trigger phase below flips exactly that bit, once, on
    // purpose, and it is the only profile write that happens while device tokens
    // exist.
    ids[key] = await ensureUser(
      spec,
      spec.tenant === "cmu" ? cmu.id : pitt.id,
      { visible: key !== "a" },
    );
  }
  const idList = Object.values(ids);
  await clearFixtures(idList);

  // Any dispatch the setup writes above may have queued is delivered by pg_net
  // asynchronously. Insert tokens only after that queue has had time to drain, so
  // a setup-era push cannot arrive later and get attributed to a case below.
  await sleep(4_000);

  for (const key of Object.keys(TOKENS)) await insertTokens(ids[key], TOKENS[key]);
  await rest("blocked_users", {
    method: "POST",
    body: [{ blocker_id: ids.blocked, blocked_id: ids.a }],
    headers: { Prefer: "return=minimal" },
  });

  const ALL_FOREIGN = [
    ...TOKENS.b.map(([t]) => t),
    ...TOKENS.blocked.map(([t]) => t),
    ...TOKENS.cmu.map(([t]) => t),
  ];

  // ── 1. the core scoping assertion ─────────────────────────────────────────
  {
    const title = "DCPUSH_M1_SELF";
    await stub("/__reset");
    const res = await callSendPush({ user_id: ids.a, title, body: "one student only" });
    const hits = await stub("/__hits");
    const got = deliveredFor(hits, title);

    assert(res.status === 200, "scope/self: function answered 200", `got ${res.status} ${res.text.slice(0, 200)}`);
    assert(
      sameSet(got, ["DCPUSH-A-IOS-1", "DCPUSH-A-AND-1"]),
      "scope/self: delivered set is exactly the addressed user's tokens",
      `got [${got.join(", ")}]`,
    );
    // Stated a second way and separately, because THIS is the sentence a scoping
    // bug makes false, and it should name itself in the failure output.
    const leaked = got.filter((t) => ALL_FOREIGN.includes(t));
    assert(
      leaked.length === 0,
      "scope/self: no other student's device token was reached",
      `leaked to [${leaked.join(", ")}]`,
    );
    assert(res.json?.sent === 2, "scope/self: reported sent is 2", `got ${JSON.stringify(res.json?.sent)}`);
    assert(
      hits.oauth >= 1,
      "scope/self: the android half really ran (OAuth exchange happened)",
      `oauth exchanges: ${hits.oauth}`,
    );
    assert(
      hits.fcm.every((h) => h.projectId === "dcpush-probe"),
      "scope/self: FCM was addressed to the configured project",
      `got ${JSON.stringify(hits.fcm.map((h) => h.projectId))}`,
    );
  }

  // ── 2. the same question from the other side ──────────────────────────────
  {
    const title = "DCPUSH_M2_OTHER";
    await stub("/__reset");
    const res = await callSendPush({ user_id: ids.b, title, body: "addressed to B" });
    const hits = await stub("/__hits");
    const got = deliveredFor(hits, title);

    assert(res.status === 200, "scope/isolation: function answered 200", `got ${res.status}`);
    assert(
      sameSet(got, ["DCPUSH-B-IOS-1"]),
      "scope/isolation: a push for B reached only B",
      `got [${got.join(", ")}]`,
    );
    assert(
      !got.some((t) => t.startsWith("DCPUSH-A-")),
      "scope/isolation: user A's devices were not reached by B's push",
      `got [${got.join(", ")}]`,
    );
  }

  // ── 3. cross-tenant ───────────────────────────────────────────────────────
  {
    const title = "DCPUSH_M3_TENANT";
    await stub("/__reset");
    const res = await callSendPush({ user_id: ids.cmu, title, body: "addressed to a CMU student" });
    const hits = await stub("/__hits");
    const got = deliveredFor(hits, title);

    assert(res.status === 200, "scope/tenant: function answered 200", `got ${res.status}`);
    assert(
      sameSet(got, ["DCPUSH-CMU-IOS-1"]),
      "scope/tenant: a CMU push reached only the CMU device",
      `got [${got.join(", ")}]`,
    );
    assert(
      !got.some((t) => t.startsWith("DCPUSH-A-") || t.startsWith("DCPUSH-B-")),
      "scope/tenant: no Pitt device was reached by a CMU push",
      `got [${got.join(", ")}]`,
    );
  }

  // ── 4. unknown recipient ──────────────────────────────────────────────────
  {
    await stub("/__reset");
    const res = await callSendPush({
      user_id: "00000000-0000-4000-8000-000000000000",
      title: "DCPUSH_M4_NOBODY",
      body: "nobody",
    });
    const hits = await stub("/__hits");
    assert(res.status === 200, "scope/nobody: unknown user is a 200, not an error", `got ${res.status}`);
    assert(res.json?.sent === 0, "scope/nobody: reported sent is 0", `got ${JSON.stringify(res.json?.sent)}`);
    assert(
      hits.apns.length === 0 && hits.fcm.length === 0,
      "scope/nobody: an unknown user reached no device at all",
      `apns ${hits.apns.length}, fcm ${hits.fcm.length}`,
    );
  }

  // ── 5. one bad token must not break the fan-out ───────────────────────────
  {
    await insertTokens(ids.a, [...A_STALE, ...A_TRANSIENT]);
    const title = "DCPUSH_M5_STALE";
    await stub("/__reset");
    const res = await callSendPush({ user_id: ids.a, title, body: "fan out past the dead ones" });
    const hits = await stub("/__hits");
    const got = deliveredFor(hits, title);

    assert(res.status === 200, "resilience/stale: function answered 200", `got ${res.status}`);
    assert(
      got.includes("DCPUSH-A-IOS-1") && got.includes("DCPUSH-A-AND-1"),
      "resilience/stale: the healthy tokens were still delivered",
      `got [${got.join(", ")}]`,
    );
    assert(
      sameSet(got, [
        "DCPUSH-A-IOS-1",
        "DCPUSH-A-AND-1",
        "DCPUSH-A-IOS-STALE",
        "DCPUSH-A-AND-STALE",
        "DCPUSH-A-IOS-BOOM",
      ]),
      "resilience/stale: every one of the user's tokens was attempted, and only theirs",
      `got [${got.join(", ")}]`,
    );
    assert(res.json?.sent === 2, "resilience/stale: 2 succeeded", `got ${JSON.stringify(res.json?.sent)}`);
    assert(res.json?.failed === 3, "resilience/stale: 3 failed", `got ${JSON.stringify(res.json?.failed)}`);

    const left = await tokensInDb();
    assert(
      !left.includes("DCPUSH-A-IOS-STALE") && !left.includes("DCPUSH-A-AND-STALE"),
      "resilience/stale: APNs 410 and FCM UNREGISTERED both evicted the row",
      `still present: [${left.join(", ")}]`,
    );
    assert(
      left.includes("DCPUSH-A-IOS-BOOM"),
      "resilience/stale: a transient 503 did NOT evict the row",
      `left: [${left.join(", ")}]`,
    );
    assert(
      left.includes("DCPUSH-A-IOS-1") && left.includes("DCPUSH-B-IOS-1"),
      "resilience/stale: eviction did not take healthy or foreign rows with it",
      `left: [${left.join(", ")}]`,
    );

    // Put A back to two healthy tokens for the trigger phase.
    await rest("device_tokens?token=eq.DCPUSH-A-IOS-BOOM", {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  }

  // ── 6. the bearer gate — send-push's ENTIRE gate (verify_jwt:false in prod) ─
  {
    await stub("/__reset");
    const noToken = await callSendPush({ user_id: ids.a, title: "DCPUSH_M6", body: "x" }, { token: null });
    assert(noToken.status === 401, "auth/anonymous: no bearer is 401", `got ${noToken.status}`);

    const wrongToken = await callSendPush(
      { user_id: ids.a, title: "DCPUSH_M6", body: "x" },
      { token: "not-the-shared-token" },
    );
    assert(wrongToken.status === 401, "auth/wrong-token: a wrong bearer is 401", `got ${wrongToken.status}`);

    const anonKeyAsToken = await callSendPush(
      { user_id: ids.a, title: "DCPUSH_M6", body: "x" },
      { token: ANON_KEY },
    );
    assert(
      anonKeyAsToken.status === 401,
      "auth/anon-key: the public anon key is not a send-push credential",
      `got ${anonKeyAsToken.status}`,
    );

    const wrongMethod = await callSendPush(undefined, { method: "GET" });
    assert(wrongMethod.status === 405, "auth/method: GET is 405", `got ${wrongMethod.status}`);

    const noRecipient = await callSendPush({ title: "DCPUSH_M6", body: "x" });
    assert(noRecipient.status === 400, "auth/no-recipient: a bodyless request is 400", `got ${noRecipient.status}`);

    const hits = await stub("/__hits");
    assert(
      hits.apns.length === 0 && hits.fcm.length === 0,
      "auth/refused: not one refused request reached a device",
      `apns ${hits.apns.length}, fcm ${hits.fcm.length}`,
    );
  }

  // ── 7. quiet hours ────────────────────────────────────────────────────────
  {
    // A two-hour window centred on now, in UTC. Written this way and not as a
    // constant "00:00"-"23:59" because the window is HALF-OPEN [start, end): a
    // fixed all-day window is not quiet for the one minute a day that equals its
    // end, which is a flake that would surface once and never reproduce.
    await rest(`profiles?id=eq.${ids.a}`, {
      method: "PATCH",
      body: {
        quiet_hours_enabled: true,
        ...windowAroundNow(),
      },
      headers: { Prefer: "return=minimal" },
    });
    const title = "DCPUSH_M7_QUIET";
    await stub("/__reset");
    const res = await callSendPush({ user_id: ids.a, title, body: "should be held" });
    const hits = await stub("/__hits");

    assert(res.status === 200, "suppress/quiet-hours: function answered 200", `got ${res.status}`);
    assert(
      res.json?.suppressed === "quiet_hours",
      "suppress/quiet-hours: the response says why",
      `got ${JSON.stringify(res.json)}`,
    );
    assert(
      hits.apns.length === 0 && hits.fcm.length === 0,
      "suppress/quiet-hours: no device was woken",
      `apns ${hits.apns.length}, fcm ${hits.fcm.length}`,
    );

    await rest(`profiles?id=eq.${ids.a}`, {
      method: "PATCH",
      body: { quiet_hours_enabled: false },
      headers: { Prefer: "return=minimal" },
    });
  }

  // ── 8. the production path, end to end ────────────────────────────────────
  // Not a hand-made POST: a real profiles UPDATE fires trg_notify_building_new_resident,
  // which builds the recipient list (same dorm, same tenant, not blocked, not the
  // joiner), calls private.dispatch_push() per recipient, and pg_net POSTs this
  // function. Everything the students would actually experience.
  {
    await stub("/__reset");
    await sleep(2_000);
    const quiet = await stub("/__hits");
    // A late setup-era dispatch arriving here would be attributed to the flip below
    // and could read as a cross-user leak. Name that possibility instead of letting
    // it masquerade as a scoping defect.
    assert(
      quiet.apns.length === 0 && quiet.fcm.length === 0,
      "scope/trigger: the stub was quiet before the flip",
      `stray deliveries in flight: ${JSON.stringify([...quiet.apns, ...quiet.fcm].map((h) => h.token))}`,
    );

    await rest(`profiles?id=eq.${ids.a}`, {
      method: "PATCH",
      body: { show_in_building: true },
      headers: { Prefer: "return=minimal" },
    });

    const hits = await waitForPush(DORM);
    const got = deliveredFor(hits, DORM);

    assert(
      got.includes("DCPUSH-B-IOS-1"),
      "scope/trigger: the eligible resident did get the digest push",
      `got [${got.join(", ")}] — if this is the only failure, the trigger -> pg_net -> send-push path never fired`,
    );
    assert(
      !got.includes("DCPUSH-BLOCKED-IOS-1"),
      "scope/trigger: the resident who blocked the joiner received nothing",
      `got [${got.join(", ")}]`,
    );
    assert(
      !got.includes("DCPUSH-CMU-IOS-1"),
      "scope/trigger: the other tenant's resident received nothing",
      `got [${got.join(", ")}]`,
    );
    assert(
      !got.some((t) => t.startsWith("DCPUSH-A-")),
      "scope/trigger: the joiner was not pushed their own arrival",
      `got [${got.join(", ")}]`,
    );
    assert(
      sameSet(got, ["DCPUSH-B-IOS-1"]),
      "scope/trigger: delivered set is exactly the one eligible resident",
      `got [${got.join(", ")}]`,
    );
  }

  // ── teardown ──────────────────────────────────────────────────────────────
  await clearFixtures(idList);
  await rest(`profiles?id=in.(${idList.join(",")})`, {
    method: "PATCH",
    body: { show_in_building: false, current_dorm: null },
    headers: { Prefer: "return=minimal" },
  });
  if (cmu.wasInactive) {
    await rest(`universities?id=eq.${cmu.id}`, {
      method: "PATCH",
      body: { is_active: false },
      headers: { Prefer: "return=minimal" },
    });
    console.log("· cmu.is_active restored to false");
  }
}

run()
  .then(() => {
    // Deliberately does NOT print the literal verdict tokens: test-edge-push.sh
    // counts them to assert "assertions actually ran", and a summary line carrying
    // one would inflate that count and hide a missing assertion.
    console.log(`\n${passes} verdict(s) recorded, ${failures} failure(s).`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error(`FAIL: probe threw before finishing — ${e?.stack ?? e}`);
    process.exit(2);
  });
