const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const PRODUCTION_HOSTS = new Set(['dormcheck.com', 'www.dormcheck.com', 'abcdefghijklmnopqrst.supabase.co']);

export const DEFAULT_LIMITS = Object.freeze({
  virtualUsers: 10,
  durationSeconds: 30,
  maxVirtualUsers: 100,
  maxDurationSeconds: 300,
  maxRequests: 50_000,
  requestTimeoutMs: 10_000,
  errorRateAbort: 0.05,
  p95AbortMs: 2_000,
});

function commaSet(value = '') {
  return new Set(value.split(',').map((part) => part.trim().toLowerCase()).filter(Boolean));
}

export function validateTarget(rawUrl, env = process.env) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid --base-url: ${rawUrl}`);
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Load targets must use http or https.');
  }

  const host = url.hostname.toLowerCase();
  if (PRODUCTION_HOSTS.has(host) || host.endsWith('.dormcheck.com')) {
    throw new Error(`Production load testing is forbidden by this harness: ${host}`);
  }

  if (LOOPBACK_HOSTS.has(host)) return url;

  if (env.LOAD_TEST_ACK !== 'staging') {
    throw new Error('Non-local targets require LOAD_TEST_ACK=staging.');
  }

  const allowedHosts = commaSet(env.LOAD_TEST_ALLOW_HOSTS);
  if (!allowedHosts.has(host)) {
    throw new Error(`Non-local host is not allowlisted in LOAD_TEST_ALLOW_HOSTS: ${host}`);
  }

  return url;
}

export function validateLimits(input, env = process.env) {
  const expanded = env.LOAD_TEST_ACK === 'staging' && env.LOAD_TEST_EXPANDED_LIMITS === '1';
  const maxVirtualUsers = expanded ? 500 : DEFAULT_LIMITS.maxVirtualUsers;
  const maxDurationSeconds = expanded ? 3_600 : DEFAULT_LIMITS.maxDurationSeconds;
  const maxRequests = expanded ? 500_000 : DEFAULT_LIMITS.maxRequests;

  const values = {
    virtualUsers: Number(input.virtualUsers ?? DEFAULT_LIMITS.virtualUsers),
    durationSeconds: Number(input.durationSeconds ?? DEFAULT_LIMITS.durationSeconds),
    maxRequests: Number(input.maxRequests ?? maxRequests),
    requestTimeoutMs: Number(input.requestTimeoutMs ?? DEFAULT_LIMITS.requestTimeoutMs),
    errorRateAbort: Number(input.errorRateAbort ?? DEFAULT_LIMITS.errorRateAbort),
    p95AbortMs: Number(input.p95AbortMs ?? DEFAULT_LIMITS.p95AbortMs),
  };

  for (const [name, value] of Object.entries(values)) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
  }
  if (!Number.isInteger(values.virtualUsers)) throw new Error('virtualUsers must be an integer.');
  if (!Number.isInteger(values.maxRequests)) throw new Error('maxRequests must be an integer.');
  if (values.virtualUsers > maxVirtualUsers) {
    throw new Error(`virtualUsers exceeds the safety ceiling (${maxVirtualUsers}).`);
  }
  if (values.durationSeconds > maxDurationSeconds) {
    throw new Error(`durationSeconds exceeds the safety ceiling (${maxDurationSeconds}s).`);
  }
  if (values.maxRequests > maxRequests) {
    throw new Error(`maxRequests exceeds the safety ceiling (${maxRequests}).`);
  }
  if (values.errorRateAbort > 1) throw new Error('errorRateAbort must be between 0 and 1.');

  return values;
}

export function isProductionHost(host) {
  const normalized = host.toLowerCase();
  return PRODUCTION_HOSTS.has(normalized) || normalized.endsWith('.dormcheck.com');
}
