export function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, index)];
}

export function summarize(samples, startedAt, endedAt) {
  const latencies = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  const failed = samples.filter((sample) => !sample.ok).length;
  const durationMs = Math.max(1, endedAt - startedAt);
  const statusCounts = {};
  for (const sample of samples) {
    const key = sample.status ? String(sample.status) : sample.error || 'network_error';
    statusCounts[key] = (statusCounts[key] ?? 0) + 1;
  }

  return {
    requests: samples.length,
    failed,
    errorRate: samples.length === 0 ? 0 : failed / samples.length,
    requestsPerSecond: samples.length / (durationMs / 1_000),
    latencyMs: {
      min: latencies[0] ?? 0,
      median: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      max: latencies.at(-1) ?? 0,
    },
    statusCounts,
  };
}
