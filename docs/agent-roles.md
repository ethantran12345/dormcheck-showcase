# Agent roles — three agents share this repo, all commit to `dev`

Pointer from `CLAUDE.md` → "Agent roles". Lane mechanics (worktrees, path ownership, ship):
`/lane` / `.claude/commands/lane.md`.

DormCheck is a Capacitor app: the "iOS app" is ~95% the React/TS bundle in a WKWebView, very
little Swift. **So the split is native/Swift/Xcode-project vs `src/`, NOT iOS vs web.**

- **Claude in Xcode** — native `ios/` only: Swift, Xcode project/targets/schemes/build
  settings, signing & provisioning, Info.plist/entitlements/capabilities (APNs, App Links,
  iMessage extension), native Capacitor plugins, archive → TestFlight/App Store.
- **Claude Code (terminal)** — everything in `src/` (React/TS), Supabase, Vercel `/api`,
  git/PRs, npm scripts, tests, `npm run build:ios`, `audit:app`. Includes UI that renders on
  iOS (nav, glass, components) — it's React, not Swift.
- **Cowork** — strategy, vault, decisions, specs/handoffs. Never builds app UI.

**Rule:** "iOS work" does NOT default to Xcode. Route to Xcode only for true-native tasks
(build/sign/ship, plist/entitlements, plugins, Swift). Keep lanes hard — Xcode agent in
`ios/` native files, Claude Code in `src/`, never two agents in the same area at once.

**Shared rules bind all three:** `npm run build:ios` (not bare `build`), no whole-file reads
of the giant files, journal every change to `docs/CHANGELOG.md`, target `dev`.
