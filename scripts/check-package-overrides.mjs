#!/usr/bin/env node
// Keeps npm overrides deterministic. `npm ci` verifies that the committed lock can
// be installed; this complementary check rejects open-ended override ranges that
// can make a previously-valid lock fail later without a source change.
import { readFileSync } from "node:fs";

const manifestPath = process.argv[2] || new URL("../package.json", import.meta.url);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const errors = [];

function checkOverride(value, path) {
  if (typeof value === "string") {
    // Exact, caret, and tilde versions are reproducible with a committed lock.
    // Floors (`>=`), wildcards, unions, and comparator ranges are not: npm may
    // re-resolve them later and invalidate `npm ci` without a repository change.
    if (!/^(?:[~^]?v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/.test(value)) {
      errors.push(`${path}: ${JSON.stringify(value)} is not an exact, ^, or ~ semver version`);
    }
    return;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path}: override must be a version string or nested override object`);
    return;
  }

  for (const [name, nested] of Object.entries(value)) checkOverride(nested, `${path}.${name}`);
}

for (const [name, value] of Object.entries(manifest.overrides || {})) {
  checkOverride(value, `overrides.${name}`);
}

if (errors.length) {
  console.error("Package override policy failed:");
  for (const error of errors) console.error(`- ${error}`);
  console.error("Use an exact, caret, or tilde version and regenerate package-lock.json.");
  process.exit(1);
}

console.log("Package override policy: deterministic.");
