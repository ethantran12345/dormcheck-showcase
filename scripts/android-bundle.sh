#!/usr/bin/env bash
#
# Build the signed release AAB (npm run bundle:android).
#
# Wraps `CAPACITOR=1 vite build && cap sync android && ./gradlew bundleRelease`
# with JDK auto-detection so the Gradle bundle step finds a Java runtime even
# when JAVA_HOME is unset (Android Studio's Run button never exports its JBR to
# the shell). See scripts/lib/ensure-java-home.sh and docs/android-release-signing.md.
#
set -euo pipefail

source "$(dirname "$0")/lib/ensure-java-home.sh" || exit 1

npm run build:android
cd android && ./gradlew bundleRelease
