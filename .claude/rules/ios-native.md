---
description: iOS / Capacitor native layer — build, live-reload, Simulator interaction
paths:
  - "ios/**"
---

# iOS / native build

Most work targets desktop/mobile web; the iOS app is the same React bundle in a Capacitor shell (Xcode on macOS, SPM not CocoaPods). After a web change affecting native behavior, `npm run build:ios` (= `CAPACITOR=1 vite build` + `npx cap sync ios`) — not a bare `npm run build`. Native-layer changes (plugins, entitlements, `AppDelegate`) need a full rebuild. There's a codesign "detritus" gotcha on iCloud-synced checkouts — build to a DerivedData path outside the synced folder.

**Live reload — never commit the dev URL.** `npm run ios:live:local` injects `server: { url: "http://localhost:8080", cleartext: true }` into the tracked `ios/App/App/capacitor.config.json` so the sim loads from Vite; production config has **no** `server` block. Committing the dev URL makes a release/TestFlight build load `localhost:8080` and show a blank app. Before any commit/push, if `git status` shows `capacitor.config.json` modified, strip it with `npm run ios:reset`. The `check:ios-live-reload` guard (`.githooks/` pre-commit + pre-push) hard-blocks this; one-off bypass `SKIP_LIVE_RELOAD_CHECK=1`.

**Simulator interaction (agents):** drive it programmatically, never like a human with screenshots + taps + the on-screen keyboard, and **never type char-by-char** (fast synthetic typing misses keys and pops the iOS accent popup, corrupting the field). Apply this EVERY time, before the first keystroke, not after a failure. Best → good: deep-link to the screen under test (`xcrun simctl openurl`; a local/e2e build auto-logs-in the seeded user via `VITE_E2E_AUTOLOGIN`, so no credentials are typed) → tap the auth-provider button instead of typing credentials → `idb ui text` for HID text/taps → Maestro for repeatable flows → pbcopy+Paste (`xcrun simctl pbcopy booted`, then long-press → Paste / ⌘V) as last resort; if typing is truly unavoidable, Connect Hardware Keyboard first (⇧⌘K) so keystrokes skip the on-screen accent menu. Verification-critical controls carry stable `data-testid`s.

**iMessage extension (`MessagesExtension` target):** its `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` must always match the host `App` target (`tag-ios-release.sh` reads only host values); it ships embedded, so every host archive includes it. Detail: `docs/audits/capacitor-native.md` §9b.

**Canonical repo path: `the repo root` — the code repo MUST live outside `~/Documents` (iCloud)** (moved 2026-07-16 by fresh clone, not `mv`). iCloud sync spawns "conflicted copy" duplicates mid-build; Gradle rejects the spaces (`invalid file-based resource name`) and the same xattr behavior causes iOS codesign "detritus" failures. Gitignored config a fresh clone won't carry — keep these in sync on a new machine: `.env`/`.env.local`/`.env.e2e`, `android/key.properties`, `android/local.properties`, `supabase/config.toml`, `.vercel/`.

**Source of truth for the whole native layer** (camera, Info.plist keys, entitlements, APNs, submission blockers, live-reload, codesign, Simulator toolkit, autologin wiring): **`docs/audits/capacitor-native.md`**.
