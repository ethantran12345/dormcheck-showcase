#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { DEFAULT_LIMITS, validateLimits, validateTarget } from './policy.mjs';
import { summarize } from './stats.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    if (name === 'help') return { help: true };
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`);
    result[name] = value;
    index += 1;
  }
  return result;
}

function usage() {
  return `Dormcheck bounded load harness

Usage:
  node scripts/load/run.mjs --base-url http://127.0.0.1:8123 \\
    --workload scripts/load/workloads/public-smoke.json [options]

Options:
  --vus N                 concurrent workers (default ${DEFAULT_LIMITS.virtualUsers}, max 100)
  --duration N            seconds (default ${DEFAULT_LIMITS.durationSeconds}, max 300)
  --max-requests N        hard request cap (default ${DEFAULT_LIMITS.maxRequests})
  --timeout-ms N          per-request timeout (default ${DEFAULT_LIMITS.requestTimeoutMs})
  --error-rate-abort N    abort threshold from 0-1 (default ${DEFAULT_LIMITS.errorRateAbort})
  --p95-abort-ms N        final p95 budget (default ${DEFAULT_LIMITS.p95AbortMs})

Non-local targets require LOAD_TEST_ACK=staging and an exact hostname in
LOAD_TEST_ALLOW_HOSTS. Production Dormcheck and production Supabase are always refused.`;
}

function expandEnv(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => process.env[name] ?? '');
}

async function loadWorkload(path) {
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(parsed.requests) || parsed.requests.length === 0) {
    throw new Error('Workload must contain a non-empty requests array.');
  }
  return parsed.requests.map((request, index) => {
    if (!request.path?.startsWith('/')) throw new Error(`requests[${index}].path must start with /.`);
    const method = String(request.method ?? 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && process.env.LOAD_TEST_ALLOW_WRITES !== '1') {
      throw new Error(`${method} requires LOAD_TEST_ALLOW_WRITES=1.`);
    }
    return {
      name: request.name ?? `${method} ${request.path}`,
      method,
      path: request.path,
      headers: Object.fromEntries(
        Object.entries(request.headers ?? {}).map(([key, value]) => [key, expandEnv(value)]),
      ),
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      thinkMs: Number(request.thinkMs ?? parsed.thinkMs ?? 0),
    };
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args['base-url'] || !args.workload) throw new Error(`--base-url and --workload are required.\n\n${usage()}`);

  const baseUrl = validateTarget(args['base-url']);
  const limits = validateLimits({
    virtualUsers: args.vus,
    durationSeconds: args.duration,
    maxRequests: args['max-requests'],
    requestTimeoutMs: args['timeout-ms'],
    errorRateAbort: args['error-rate-abort'],
    p95AbortMs: args['p95-abort-ms'],
  });
  const requests = await loadWorkload(args.workload);
  const startedAt = Date.now();
  const deadline = startedAt + limits.durationSeconds * 1_000;
  const samples = [];
  let issued = 0;
  let aborted = false;
  let abortReason = '';

  process.stdout.write(`target=${baseUrl.origin} vus=${limits.virtualUsers} duration=${limits.durationSeconds}s\n`);

  async function worker(workerId) {
    let cursor = workerId % requests.length;
    while (!aborted && Date.now() < deadline && issued < limits.maxRequests) {
      const request = requests[cursor % requests.length];
      cursor += 1;
      issued += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), limits.requestTimeoutMs);
      const requestStarted = performance.now();
      try {
        const response = await fetch(new URL(request.path, baseUrl), {
          method: request.method,
          headers: request.headers,
          body: request.body,
          signal: controller.signal,
          redirect: 'manual',
        });
        samples.push({ name: request.name, ok: response.ok || response.status === 304, status: response.status, ms: performance.now() - requestStarted });
        await response.body?.cancel();
      } catch (error) {
        samples.push({ name: request.name, ok: false, error: error?.name ?? 'request_error', ms: performance.now() - requestStarted });
      } finally {
        clearTimeout(timeout);
      }

      if (samples.length >= Math.max(20, limits.virtualUsers * 2)) {
        const failures = samples.filter((sample) => !sample.ok).length;
        if (failures / samples.length > limits.errorRateAbort) {
          aborted = true;
          abortReason = `error rate exceeded ${limits.errorRateAbort}`;
        }
      }
      if (request.thinkMs > 0) await sleep(request.thinkMs);
    }
  }

  await Promise.all(Array.from({ length: limits.virtualUsers }, (_, index) => worker(index)));
  const endedAt = Date.now();
  const result = summarize(samples, startedAt, endedAt);
  const budgetFailures = [];
  if (result.errorRate > limits.errorRateAbort) budgetFailures.push(`errorRate ${result.errorRate.toFixed(4)} > ${limits.errorRateAbort}`);
  if (result.latencyMs.p95 > limits.p95AbortMs) budgetFailures.push(`p95 ${result.latencyMs.p95.toFixed(1)}ms > ${limits.p95AbortMs}ms`);
  if (aborted) budgetFailures.push(`aborted: ${abortReason}`);

  process.stdout.write(`${JSON.stringify({ target: baseUrl.origin, limits, result, budgetFailures }, null, 2)}\n`);
  if (budgetFailures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
});
