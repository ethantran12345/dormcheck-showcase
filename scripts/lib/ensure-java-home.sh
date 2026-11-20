# shellcheck shell=bash
#
# ensure-java-home.sh - source this (do not execute) before any Android Gradle
# build from the terminal (`cap run android`, `./gradlew …`).
#
# Why: Android Studio's Run button uses its bundled JetBrains Runtime internally
# but never exports it to your shell, so terminal Gradle builds fail with
# "Unable to locate a Java Runtime" when JAVA_HOME is unset and no `java` is on
# PATH. This detects a JDK and exports JAVA_HOME so the build just works.
#
# Contract:
#   - If JAVA_HOME is already set to a valid JDK -> respect it, do nothing.
#   - Else pick the first candidate that has bin/java (Android Studio JBR, then
#     macOS /usr/libexec/java_home) and export it.
#   - On failure, print an actionable error and `return 1` so the caller exits.
#
# Usage:
#   source "$(dirname "$0")/lib/ensure-java-home.sh" || exit 1

# Respect an already-valid JAVA_HOME (keeps CI / custom JDKs untouched).
if [ -n "${JAVA_HOME:-}" ] && [ -x "${JAVA_HOME}/bin/java" ]; then
  echo "→ Using JAVA_HOME=${JAVA_HOME} (already set)"
  return 0 2>/dev/null || exit 0
fi

# Candidate 1: Android Studio's bundled JetBrains Runtime (macOS default path).
_ejh_candidates=(
  "/Applications/Android Studio.app/Contents/jbr/Contents/Home"
)

# Candidate 2: macOS /usr/libexec/java_home (whatever JDK is registered).
if command -v /usr/libexec/java_home >/dev/null 2>&1; then
  _ejh_from_libexec="$(/usr/libexec/java_home 2>/dev/null || true)"
  [ -n "${_ejh_from_libexec}" ] && _ejh_candidates+=("${_ejh_from_libexec}")
fi

for _ejh_home in "${_ejh_candidates[@]}"; do
  if [ -x "${_ejh_home}/bin/java" ]; then
    export JAVA_HOME="${_ejh_home}"
    echo "→ Using JAVA_HOME=${JAVA_HOME}"
    unset _ejh_candidates _ejh_from_libexec _ejh_home
    return 0 2>/dev/null || exit 0
  fi
done

unset _ejh_candidates _ejh_from_libexec _ejh_home
echo "✗ No Java runtime found. Install a JDK or set JAVA_HOME." >&2
echo '  Quick fix: export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"' >&2
return 1 2>/dev/null || exit 1
