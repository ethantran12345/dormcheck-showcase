---
description: Make a scoped, journaled feature change to DormCheck the cheap, correct way
argument-hint: <what to change> e.g. "fix marketplace card spacing on mobile"
---

Change requested: $ARGUMENTS

Do this in order. The goal is a minimal, correct diff with the least
exploration - name files, read one audit, don't grep the whole tree.

1. SCOPE CHEAPLY. Map the change to the smallest set of files. Open
   docs/audits/_manifest.json, find the audit that covers this area, and read
   ONLY that audit (per CLAUDE.md, read the relevant audit before changing a
   feature). Identify the exact target files from it. Do NOT read unrelated
   files or scan the repo. If you must search, spawn a subagent so exploration
   stays out of this context. If scope is still unclear after the audit, ask me
   one question - don't explore blindly.

2. PLAN (only if non-trivial). List the files you'll touch and the change in
   ≤5 lines, and wait for my OK. For a one-file tweak, skip this and just do it.

3. BRANCH off dev: git checkout -b <type>/<slug> dev. Never work on main.
   Trivial doc/tooling tweaks may stay on dev.

4. MAKE THE CHANGE - minimal diff, follow repo conventions:
   - Imports use the @/ alias; Supabase only from @/integrations/supabase/client;
     UI primitives from @/components/ui first; reuse an existing component before
     building a new one.
   - Mobile-first: unprefixed Tailwind is the mobile/iOS baseline; add md:/lg:
     for desktop only - never rewrite unprefixed classes to serve desktop.
     Branch native behavior on Capacitor.isNativePlatform(), responsive web on
     useIsMobile() (768px).

5. HARD RULES (bind in code AND copy):
   - Brand color is #03C03C - never "teal", never another green.
   - Never charge the student; money flows through universities/brands/businesses.
   - DormCheck is an extension of Pitt systems, not a replacement.
   - No dollar amounts in stakeholder-facing copy.
   - Amazon links carry tag=dormcheck-20.

6. JOURNAL (CLAUDE.md change-journaling):
   - Append one line to docs/CHANGELOG.md: "YYYY-MM-DD: what changed + why, plus
     follow-ups (migrations, retired objects, risks)".
   - If this reflects an architectural/product decision, also one line to
     docs/DECISIONS.md.
   - If you changed how a feature works, refresh its docs/audits/*.md and bump
     its doc-control note, then run npm run audit:check.

7. VERIFY: npm run lint, npm run test, npm run build. If the change affects
   native, also npm run build && npx cap sync ios. For release-bound changes,
   note that npm run audit:app should be run before shipping.

8. STOP before commit/merge. Leave the branch for me to review. Report: files
   changed, a short diff summary, verification results, and the exact merge
   command - git checkout dev && git merge <branch> && git push origin dev, then
   npm run finish-branch.
