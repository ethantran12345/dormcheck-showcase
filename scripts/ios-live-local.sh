#!/usr/bin/env bash
#
# One-command iOS live reload for this iCloud-synced checkout.
#
# Why this exists: `npm run ios:live` (`cap run ios`) puts DerivedData *inside*
# the repo (`ios/DerivedData/`). When the checkout lives under iCloud-synced
# `~/Documents`, the file provider stamps xattrs onto the build products and
# codesign rejects them ("resource fork, Finder information, or similar detritus
# not allowed"). This script instead syncs the dev-server URL into the native
# config and builds to DerivedData *outside* the synced folder, then installs and
# launches on the booted Simulator. See docs/audits/capacitor-native.md.
#
# Self-contained: if the Vite dev server isn't already running, this starts it in
# the background. The command stays open either way and watches the native shell;
# Swift/Xcode changes automatically rebuild, reinstall, and relaunch while web
# changes continue through Vite HMR. Ctrl+C stops the watcher and any Vite server
# this command started.
#
# Usage:   npm run ios:live:local
#          VITE_LAN=1 CAP_SERVER_URL=http://<lan-ip>:8080 npm run ios:live:local   # physical device LAN
#          (Vite binds loopback only unless VITE_LAN=1; a reused server must have been started with it)
#
set -euo pipefail

CAP_SERVER_URL="${CAP_SERVER_URL:-http://localhost:8080}"
DERIVED_DATA="${DERIVED_DATA:-/tmp/dormcheck-ios-dd}"
VITE_LOG="${VITE_LOG:-/tmp/dormcheck-vite.log}"
APP_ID="com.dormcheck.ios"
SCHEME="App"
PROJECT="ios/App/App.xcodeproj"

STARTED_VITE=0
VITE_PID=""
WATCH_INTERVAL="${IOS_NATIVE_WATCH_INTERVAL:-1}"
cleanup() {
  if [ "${STARTED_VITE}" = "1" ] && [ -n "${VITE_PID}" ]; then
    echo ""
    echo "→ Stopping dev server (pid ${VITE_PID})…"
    kill "${VITE_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

native_fingerprint() {
  {
    find ios/App/App \
      \( -path 'ios/App/App/public' -o -path 'ios/App/App/public/*' \) -prune -o \
      -type f \( \
        -name '*.swift' -o \
        -name '*.plist' -o \
        -name '*.entitlements' -o \
        -name '*.storyboard' -o \
        -name '*.xcassets' -o \
        -path '*/Assets.xcassets/*' \
      \) -exec shasum {} +
    find ios/App/App.xcodeproj ios/App/CapApp-SPM \
      -type f \( -name 'project.pbxproj' -o -name 'Package.swift' -o -name 'Package.resolved' \) \
      -exec shasum {} +
  } | LC_ALL=C sort | shasum | awk '{print $1}'
}

build_install_launch() {
  echo "→ Building to ${DERIVED_DATA} …"
  xcodebuild -scheme "${SCHEME}" -project "${PROJECT}" -configuration Debug \
    -destination "id=${UDID}" -derivedDataPath "${DERIVED_DATA}" build || return 1

  xcrun simctl bootstatus "${UDID}" -b || return 1

  APP_PATH="${DERIVED_DATA}/Build/Products/Debug-iphonesimulator/App.app"
  echo "→ Installing ${APP_PATH}"
  xcrun simctl install "${UDID}" "${APP_PATH}" || return 1
  for attempt in 1 2 3; do
    xcrun simctl launch --terminate-running-process "${UDID}" "${APP_ID}" && return 0
    echo "  launch attempt ${attempt} failed; sim warming up, retrying in 3s…"
    sleep 3
  done
  return 1
}

# 1) Ensure the Vite dev server is running (start it if not).
if curl -sf -o /dev/null "${CAP_SERVER_URL}/"; then
  echo "→ Reusing dev server already running at ${CAP_SERVER_URL}"
else
  echo "→ Starting Vite dev server (logs: ${VITE_LOG})…"
  npm run dev > "${VITE_LOG}" 2>&1 &
  VITE_PID=$!
  STARTED_VITE=1
  for _ in $(seq 1 60); do
    curl -sf -o /dev/null "${CAP_SERVER_URL}/" && break
    sleep 1
  done
  if ! curl -sf -o /dev/null "${CAP_SERVER_URL}/"; then
    echo "✗ Dev server failed to start within 60s; see ${VITE_LOG}"
    exit 1
  fi
  echo "  dev server up (pid ${VITE_PID})"
fi

# 2) Use the booted Simulator, or boot the first available iPhone.
UDID="$(xcrun simctl list devices booted | grep -Eo '[0-9A-Fa-f-]{36}' | head -1 || true)"
if [ -z "${UDID}" ]; then
  echo "ℹ No booted simulator - booting an iPhone…"
  UDID="$(xcrun simctl list devices available | grep -E 'iPhone' | grep -Eo '[0-9A-Fa-f-]{36}' | head -1 || true)"
  [ -n "${UDID}" ] || { echo "✗ No available iPhone simulator found."; exit 1; }
  xcrun simctl boot "${UDID}"
fi
# -g keeps the Simulator in the background: it must be running for simctl, but
# raising it here steals focus for the whole xcodebuild below. Set IOS_FOCUS=1
# to bring it forward at the end instead.
open -g -a Simulator
echo "→ Simulator: ${UDID}"

# 3) Sync the env-gated server block into the generated native config.
echo "→ Syncing native config (CAP_SERVER_URL=${CAP_SERVER_URL})"
CAP_SERVER_URL="${CAP_SERVER_URL}" npx cap sync ios

# 4) Build to DerivedData OUTSIDE the repo, then install and launch.
build_install_launch

# 5.5) Opt-in: raise the Simulator now that the slow work is done.
if [ "${IOS_FOCUS:-0}" = "1" ]; then open -a Simulator; fi

echo ""
echo "✅ Live reload active - web edits use HMR; native edits rebuild automatically."
echo "⚠  Before any commit or release build, run:  npm run ios:reset"

# 6) Stay alive even when Vite was started elsewhere. This is what closes the
# native/HMR gap: an already-running live session notices a later Swift merge.
NATIVE_FINGERPRINT="$(native_fingerprint)"
echo "→ Watching native iOS sources. Press Ctrl+C to stop."
while sleep "${WATCH_INTERVAL}"; do
  NEXT_FINGERPRINT="$(native_fingerprint)"
  [ "${NEXT_FINGERPRINT}" = "${NATIVE_FINGERPRINT}" ] && continue

  NATIVE_FINGERPRINT="${NEXT_FINGERPRINT}"
  echo ""
  echo "↻ Native iOS change detected - rebuilding and reinstalling…"
  if build_install_launch; then
    echo "✅ Native shell updated; live reload remains active."
  else
    echo "✗ Native rebuild failed. Fix the error; the watcher remains active." >&2
  fi
done
