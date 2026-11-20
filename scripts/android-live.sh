#!/usr/bin/env bash
#
# Live reload against an already-booted device/emulator (npm run android:live).
#
# Assumes a device is connected and the Vite dev server is already running; for
# the fully self-contained one-command flow use `npm run android:live:local`.
# Wraps `cap run android` with JDK auto-detection so the Gradle build finds a
# Java runtime even when JAVA_HOME is unset. See scripts/lib/ensure-java-home.sh.
#
set -euo pipefail

source "$(dirname "$0")/lib/ensure-java-home.sh" || exit 1

CAP_SERVER_URL="${CAP_SERVER_URL:-http://localhost:8080}" npx cap run android
