---
description: Show where every scrap of work lives and which git state has no recovery path
---

Run `npm run state` and report the result to me.

It prints one screen: branch + cleanliness, dev/main vs origin, stray branches,
every stash (with per-file unlanded-line counts vs dev and a label/content
mismatch flag), untracked files older than 2h, dangling commits under 7 days,
extra worktrees, the current agent lock, and a verdict naming the top offender.

After running it:
- If the verdict is "Clean", say so in one line.
- Otherwise, summarize the top offenders in plain English and, for each, give the
  one concrete fix (e.g. `npm run finish-branch <b>`, commit the untracked file,
  `git restore --source=<ref>`, tag-then-drop a stash). Do NOT auto-fix anything
  destructive - surface it and let me decide.

Remember the standing rule: never reference a stash by index (indices renumber);
resolve to a SHA first, and park WIP as a pushed commit/tag, never a stash.
