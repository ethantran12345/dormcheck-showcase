#!/usr/bin/env bash
#
# tag-ios-release - tag the current commit as an iOS App Store/TestFlight release.
#
# Reads MARKETING_VERSION and CURRENT_PROJECT_VERSION straight out of
# ios/App/App.xcodeproj/project.pbxproj, builds the ios-v<version>-b<build> tag,
# and creates + pushes an annotated git tag on HEAD. Run this right after you
# Archive a build in Xcode, on the main commit you built from.
#
#   npm run tag:ios              # tag + push
#   npm run tag:ios -- --dry-run # show what would happen, don't tag or push
#   npm run tag:ios -- --no-push # tag locally only
#
# See CLAUDE.md → "Release tags".
set -euo pipefail
cd "$(dirname "$0")/.."

REMOTE="origin"
PBXPROJ="ios/App/App.xcodeproj/project.pbxproj"

dry_run=false
no_push=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    --no-push) no_push=true ;;
    *)
      echo "✗ Unknown argument: $arg (expected --dry-run and/or --no-push)" >&2
      exit 1
      ;;
  esac
done

if [ ! -f "$PBXPROJ" ]; then
  echo "✗ Can't find $PBXPROJ - is this the Dormcheck repo root?" >&2
  exit 1
fi

# Pull every MARKETING_VERSION / CURRENT_PROJECT_VERSION value (Debug + Release
# configs each declare one) and dedupe. Warn instead of guessing if they disagree.
marketing_versions="$(grep -oE 'MARKETING_VERSION = [^;]+;' "$PBXPROJ" | sed -E 's/MARKETING_VERSION = (.+);/\1/' | sort -u)"
build_versions="$(grep -oE 'CURRENT_PROJECT_VERSION = [^;]+;' "$PBXPROJ" | sed -E 's/CURRENT_PROJECT_VERSION = (.+);/\1/' | sort -u)"

if [ -z "$marketing_versions" ] || [ -z "$build_versions" ]; then
  echo "✗ Couldn't parse MARKETING_VERSION / CURRENT_PROJECT_VERSION out of $PBXPROJ." >&2
  exit 1
fi

# NB: BSD `wc -l` pads its output ("       1"), so the count MUST be stripped
# before comparing. Without the strip this test is true for every input and the
# script refuses to tag anything on macOS, reporting a "disagreement" while
# printing a single value - which is how ios-v1.0-b30 came to be tagged by hand.
count_lines() { printf '%s' "$1" | grep -c ''; }

if [ "$(count_lines "$marketing_versions")" != "1" ]; then
  echo "✗ Debug and Release configs disagree on MARKETING_VERSION:" >&2
  echo "$marketing_versions" | sed 's/^/  /' >&2
  echo "  Fix the mismatch in Xcode before tagging." >&2
  exit 1
fi

if [ "$(count_lines "$build_versions")" != "1" ]; then
  echo "✗ Debug and Release configs disagree on CURRENT_PROJECT_VERSION:" >&2
  echo "$build_versions" | sed 's/^/  /' >&2
  echo "  Fix the mismatch in Xcode before tagging." >&2
  exit 1
fi

marketing_version="$marketing_versions"
build_version="$build_versions"
tag="ios-v${marketing_version}-b${build_version}"

echo "→ Read version $marketing_version, build $build_version from $PBXPROJ"
echo "→ Tag: $tag"

# Refuse to reuse a tag - released ios-* tags are the permanent audit trail of
# what shipped to Apple and must never move.
if git show-ref --tags --verify --quiet "refs/tags/$tag"; then
  echo "✗ Tag '$tag' already exists locally." >&2
  echo "  Did you forget to bump CURRENT_PROJECT_VERSION in Xcode for this submission?" >&2
  exit 1
fi
if git ls-remote --exit-code --tags "$REMOTE" "refs/tags/$tag" >/dev/null 2>&1; then
  echo "✗ Tag '$tag' already exists on $REMOTE." >&2
  echo "  Did you forget to bump CURRENT_PROJECT_VERSION in Xcode for this submission?" >&2
  exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
commit="$(git rev-parse --short HEAD)"
if [ "$branch" != "main" ]; then
  echo "⚠ You're on '$branch', not 'main'. iOS tags are meant to pin a main commit." >&2
  echo "  Checkout main (or confirm this commit is already merged there) before tagging." >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "⚠ Working tree has uncommitted changes - tagging HEAD ($commit) anyway, but double-check that's the build you Archived." >&2
fi

message="iOS ${marketing_version} (${build_version}) → App Store review $(date +%Y-%m-%d)"

if [ "$dry_run" = true ]; then
  echo "→ Dry run - would create: git tag -a $tag -m \"$message\" (on $commit)"
  [ "$no_push" = true ] && echo "→ Dry run - --no-push set, would not push." || echo "→ Dry run - would push: git push $REMOTE $tag"
  exit 0
fi

git tag -a "$tag" -m "$message"
echo "✓ Created annotated tag '$tag' on $commit."

if [ "$no_push" = true ]; then
  echo "  --no-push set - tag stays local. Push later with: git push $REMOTE $tag"
else
  git push "$REMOTE" "$tag"
  echo "✓ Pushed '$tag' to $REMOTE."
fi

echo ""
echo "iOS tags so far:"
git tag -l 'ios-*' -n99
