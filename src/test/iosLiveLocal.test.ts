import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const script = readFileSync('scripts/ios-live-local.sh', 'utf8');

describe('ios:live:local native rebuild contract', () => {
  it('watches native sources even when the Vite server already exists', () => {
    expect(script).toContain('NATIVE_FINGERPRINT="$(native_fingerprint)"');
    expect(script).toContain('while sleep "${WATCH_INTERVAL}"');
    expect(script).toContain('Native iOS change detected');
    expect(script).not.toContain('leaving it up.');
  });

  it('reinstalls and cold-relaunches the app after a native build', () => {
    expect(script).toContain('build || return 1');
    expect(script).toContain('xcrun simctl install "${UDID}" "${APP_PATH}"');
    expect(script).toContain('xcrun simctl launch --terminate-running-process');
    expect(script).toContain('the watcher remains active');
  });

  it('tracks compiled native inputs but ignores copied web assets', () => {
    expect(script).toContain("-path 'ios/App/App/public'");
    expect(script).toContain("-name '*.swift'");
    expect(script).toContain("-name 'project.pbxproj'");
    expect(script).toContain("-name 'Package.swift'");
  });
});
