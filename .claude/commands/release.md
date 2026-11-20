---
description: Ship dev → main the safe way (dry-run first; web deploys from main via Vercel)
---

Ship the current `dev` to `main`.

1. Run `npm run state` first and show me the verdict. If anything is at-risk
   (uncommitted work, a stash, an unpushed dev), STOP and surface it - do not
   release over unparked work.
2. Run `npm run release` (dry-run). It refuses a dirty tree, verifies
   `dev == origin/dev` and that `main` fast-forwards from `dev`, and prints how
   many commits would ship. It always ends on `dev`.
3. Show me the dry-run plan and WAIT for my explicit OK.
4. Only after I confirm, run `npm run release -- --yes` to fast-forward `main`
   and push. Report the new `origin/main` SHA. Vercel deploys automatically.
5. Journal the release in `docs/CHANGELOG.md`.

Never leave my checkout on `main`; the release script returns to `dev`, but
confirm it did.
