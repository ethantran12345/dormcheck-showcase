#!/usr/bin/env bash
#
# finish-branch - clean up a short-lived task branch after it has landed on dev.
#
# Asserts the CURRENT branch is already merged into dev, then deletes it locally
# and on origin. Refuses to run on the permanent branches (dev, main) and refuses
# to delete a branch whose commits are not yet on dev.
#
#   npm run finish-branch
#
# See CLAUDE.md → "Branch lifecycle".
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="dev"
REMOTE="origin"

# Optional: finish a NAMED branch (npm run finish-branch <branch>); else the current one.
TARGET="${1:-}"
if [ -n "$TARGET" ]; then
  if ! git show-ref --verify --quiet "refs/heads/$TARGET"; then
    echo "✗ No local branch '$TARGET' to finish." >&2
    exit 1
  fi
  git checkout "$TARGET" >/dev/null 2>&1 || { echo "✗ Could not check out '$TARGET' (dirty tree?)." >&2; exit 1; }
fi

branch="$(git rev-parse --abbrev-ref HEAD)"

if [ "$branch" = "HEAD" ]; then
  echo "✗ Detached HEAD - check out the task branch you want to finish first." >&2
  exit 1
fi

# Never delete the permanent branches.
case "$branch" in
  dev|main)
    echo "✗ Refusing to run on '$branch'. finish-branch only deletes short-lived task branches." >&2
    echo "  Check out the task branch first (you are on a permanent branch)." >&2
    exit 1
    ;;
esac

# Make sure dev is current so the merged-in check is meaningful.
echo "→ Fetching $REMOTE/${BASE}…"
git fetch "$REMOTE" "$BASE" >/dev/null 2>&1 || true

# Resolve the freshest ref we have for the base branch.
if git show-ref --verify --quiet "refs/remotes/$REMOTE/$BASE"; then
  base_ref="$REMOTE/$BASE"
elif git show-ref --verify --quiet "refs/heads/$BASE"; then
  base_ref="$BASE"
else
  echo "✗ Cannot find '$BASE' (neither $REMOTE/$BASE nor local $BASE exists)." >&2
  exit 1
fi

# Assert the branch is fully merged into the base: no commits unique to it.
unmerged="$(git rev-list --count "$base_ref..$branch")"
if [ "$unmerged" != "0" ]; then
  echo "✗ '$branch' has $unmerged commit(s) not in $base_ref - not merged yet." >&2
  echo "  Merge it into $BASE and push before finishing the branch." >&2
  exit 1
fi

echo "✓ '$branch' is merged into $base_ref. Cleaning up…"

# Archive the branch tip as an immutable, PUSHED tag BEFORE any deletion, so the
# history is always recoverable. Never move or delete an existing archive/* tag.
archive_tag="archive/$branch"
if git rev-parse -q --verify "refs/tags/$archive_tag" >/dev/null; then
  existing="$(git rev-parse --short "$archive_tag")"
  echo "  archive tag '$archive_tag' already exists ($existing) - leaving it untouched (immutable)."
else
  tip="$(git rev-parse "$branch")"
  git tag "$archive_tag" "$tip"
  if git push "$REMOTE" "$archive_tag" >/dev/null 2>&1; then
    echo "  ✓ archived tip as tag '$archive_tag' -> ${tip:0:8} (pushed to $REMOTE)."
  else
    echo "✗ Could not push archive tag '$archive_tag' - refusing to delete an un-backed-up branch." >&2
    git tag -d "$archive_tag" >/dev/null 2>&1 || true
    exit 1
  fi
fi

# Move off the branch before deleting it.
git checkout "$BASE" >/dev/null 2>&1 || git checkout "$BASE"

# Local delete (-d refuses unmerged; we already checked, so this is belt-and-suspenders).
git branch -d "$branch"

# Remote delete (only if the branch exists on origin).
if git ls-remote --exit-code --heads "$REMOTE" "$branch" >/dev/null 2>&1; then
  git push "$REMOTE" --delete "$branch"
  where="locally and on $REMOTE"
else
  echo "  ($REMOTE has no '$branch' - nothing to delete remotely.)"
  where="locally"
fi

echo "✓ Done. Deleted '$branch' $where. Now on $BASE."
