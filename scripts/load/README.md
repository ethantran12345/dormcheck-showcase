# Dormcheck bounded load harness

This harness measures HTTP capacity against the disposable local stack or an explicitly
allowlisted staging host. It deliberately refuses `dormcheck.com`, every Dormcheck subdomain,
and the production Supabase project.

Start with the existing seeded stack on `:8123` after confirming no other session owns the shared
local Supabase resource. Do not start, stop, or point this at Ethan's `:8080` preview.

```sh
node scripts/load/run.mjs \
  --base-url http://127.0.0.1:8123 \
  --workload scripts/load/workloads/public-smoke.json \
  --vus 10 --duration 30
```

For a staging host, both controls are mandatory:

```sh
LOAD_TEST_ACK=staging \
LOAD_TEST_ALLOW_HOSTS=staging.example.test \
node scripts/load/run.mjs --base-url https://staging.example.test \
  --workload scripts/load/workloads/public-smoke.json
```

Authenticated Supabase reads use `supabase-read.example.json` and disposable test-user tokens.
Never commit keys or tokens. Write workloads additionally require `LOAD_TEST_ALLOW_WRITES=1`,
tagged disposable data, notifications disabled, and a teardown/read-back plan.

Default ceilings are 100 workers, five minutes, and 50,000 requests. Expanded staging ceilings
require both `LOAD_TEST_ACK=staging` and `LOAD_TEST_EXPANDED_LIMITS=1`. Production remains refused.

The command exits non-zero when the error-rate or p95 budget fails. Collect database CPU,
connections, I/O, PostgREST latency, Realtime delivery lag, Storage failures/orphans, and
serverless duration alongside the client result; HTTP latency alone cannot locate saturation.

## Two-client Realtime, Auth, and Storage resilience

Run only against the disposable seeded local stack or an explicitly allowlisted staging project.
The runner creates one tagged DM conversation, proves delivery to two authenticated clients,
disconnect recovery, reconnect delivery, duplicate absence, invalid-session rejection, Storage
ownership, and owner cleanup, then deletes its tagged rows and object.

```sh
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
E2E_USER_PASSWORD=... E2E_PEER_PASSWORD=... \
REALTIME_MESSAGE_COUNT=25 \
node scripts/load/supabase-resilience.mjs
```

The service key is test setup/teardown authority only and must never be bundled into the app or
committed. Non-local targets remain subject to the same staging acknowledgement and exact-host
allowlist enforced by `policy.mjs`; production is always refused.
