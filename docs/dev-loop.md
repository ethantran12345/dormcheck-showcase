# How to touch the app: the dev-loop ladder

**Goal:** iterate on DormCheck as fast and reliably as possible, by matching the tool to the layer you're changing. DormCheck is a web app in a native wrapper (Capacitor), so most UI work belongs in the browser, and the Simulator is for the native-only things the browser can't show. Never drive the Simulator like a human (screenshots + taps + on-screen keyboard) - that's the slow, unreliable path this doc exists to prevent.

**The one rule:** climb down this ladder only as far as the change forces you to. Start at the top.

---

## Running a second agent (a new Herd tab)

**Read this before you open a second tab.** Every tab you start in `the repo root` is looking at the *same folder*. Two agents editing one folder overwrite each other's half-finished work, and the auto-save hook commits the mixture under a message nobody wrote. That is what happened on 2026-08-05: four tabs, two commits nobody authored, a day to unpick.

**Tab 1 — nothing changes.** Stay in `the repo root`, work as usual, commit on `dev`.

**Tab 2 (and 3, and 4) — three steps, in this order:**

```bash
cd the repo root
npm run agent:new -- <name> --owns "<the paths this agent will edit>"
#   e.g. npm run agent:new -- marketplace-filters --owns "src/components/marketplace/**"
```

It prints a `cd …` line in a box. **Paste that `cd`, then start Claude** — in that order. That agent now has its own private copy of the repo, so it physically cannot touch tab 1's files.

Lane creation does **not** require the shared checkout to be synchronized first. If local `dev` is ahead, the lane preserves that local context; if it is behind, the lane starts from current `origin/dev`; if the histories diverged, the lane starts from `origin/dev` and reports that local-only commits were excluded. In every case, `lane:start` leaves main's branch, commits, index, and unrelated dirty files untouched. Reconciliation belongs to `lane:ship`, after the agent is already isolated.

`--owns` is required and is never guessed. List the folders that agent will edit; if two agents ask for overlapping paths, the second one is refused before it starts.

**When that agent is done,** in its own tab:

```bash
npm run lane:ship     # runs the checks, merges its work into dev, closes the worktree
```

**One tab owns the database at a time.** There is only one local Supabase stack on the machine, so `npm run lane:bootstrap` and `npm run lane:verify` claim it. If another tab already has it, you get a refusal naming which one. Wait for it, or once you're sure that tab is finished:

```bash
npm run agent:db:release
```

**If you forget and start a second Claude in `the repo root` anyway:** the session banner says so at startup, and auto-save switches itself off in that folder until you're alone again (your edits stay in the tree — `npm run wip` saves them whenever you want). Nothing is blocked; you can still finish what you're doing. `npm run agent:sessions` lists who is live.

**Was that warning right?** Every time the banner fires — and every time auto-save skips, and every time it decides you're alone — the decision is appended to a log with the `ps` evidence behind it. Read it back:

```bash
npm run agent:detections
```

The line that matters is **SUSPECT**: a session the guard called a live peer whose pid was not actually an agent process. That is a false positive with proof attached, and it is the number the two remaining upgrades are waiting on — turning the banner into a real commit-time block, and counting Codex (or any other agent CLI) as a peer instead of as nobody. Both were previously blocked on a rate nothing was measuring. The log also shows **unclean exits**: a session that died without deregistering, which is the case that strands a stale row. Nothing here blocks anything; disable it with `DC_DETECTION_LOG=0` if you ever need to.

---

## Tier 1 - Browser at localhost (default, ~90% of UI work)

**Use for:** any screen, component, layout, styling, state, routing, or copy change. Anything that isn't native-shell behavior.

**Why it's the fastest loop:** the app is a web view, so at localhost you have the real DOM. Instant hot reload, click-by-selector, console, network panel, no black box. This is the seamless edit-and-see loop.

```bash
npm run dev          # localhost:8080
```

Check responsive/native branches without a device: `useIsMobile()` (768px) drives web layout; `Capacitor.isNativePlatform()` gates native-only behavior. Unprefixed Tailwind is the mobile/iOS baseline; desktop overrides use `md:`/`lg:` only.

---

## Parking a lane (release ownership without shipping)

**Use for:** a lane that's blocked on external work (awaiting review, a live verification, a decision) but is holding `--owns` globs that another commit needs. Before `lane:park` existed there was no way to release ownership short of `lane:ship`/`lane:abandon`, which caused a hard deadlock on 2026-07-22: a lane owned `docs/**`, the main worktree had one uncommitted `docs/` file, `lane:ship` refused (main dirty) while the pre-commit guard refused the commit (owned by that lane) — circular, escapable only with a forbidden `git commit --no-verify`.

```bash
npm run lane:park [name]     # release this lane's ownership; keep branch + worktree + all commits
# … other sessions can now commit the previously-owned paths …
npm run lane:resume [name]   # re-claim the SAME ownership (refuses only if another live lane took overlapping paths meanwhile)
```

- **Park is not abandon.** Nothing is shipped, nothing is deleted, no work is lost — the only change is the lock is dropped (`status: parked` in the registry). Fully reversible.
- **Resolving the deadlock:** if the pre-commit guard blocks a file in the main worktree because your own lane owns it, run `npm run lane:park <owner>`, commit, then `npm run lane:resume <owner>`. The guard's own error message now tells you this. **Never `--no-verify` past the ownership guard.**
- **Inactive lanes self-park.** A lane's registered pid anchors to the terminal *shell*, which outlives the agent session — so a lane whose agent exited would otherwise read as live forever and block every sibling commit. Liveness is now by *activity*: no lane-command activity for ~90 min (`DC_LANE_INACTIVE_MIN` overrides), or a dead pid, marks the lane INACTIVE — its ownership stops being enforced and the next lane command auto-parks it (salvaging any uncommitted work to a pushed `salvage/lane-<name>` tag, **keeping** branch + worktree). `lane:status` shows live / inactive / parked distinctly. Resume, or just run a lane command from the worktree, to re-claim.

---

## Verifiable authed stack from a lane

**Use for:** verifying anything behind `@pitt.edu` auth (checklist, admin, marketplace, roommates) from a **lane worktree** - which has no running backend of its own. Ethan's `:8080` runs against **prod** and is off-limits; this gives you a throwaway **local** stack with real content on a dedicated port.

**One-time per lane:**

```bash
npm run lane:bootstrap   # carries supabase/config.toml, brings the local stack up,
                         # db reset (all migrations + storage buckets), seeds users + content
npm run lane:verify      # browsable Vite dev server on :8123 (NOT :8080)
```

**Browser: agents attach over CDP to a dedicated Chrome profile — never to Ethan's own window.** Playwright MCP runs with `--cdp-endpoint http://127.0.0.1:9222` (in `.codex/config.toml` and the Claude Code user config) instead of `--browser chrome`, so it never launches a browser of its own — and fails at startup with a handshake error whenever nothing is listening on 9222. **The flag is `--cdp-endpoint`, NOT `--connect-over-cdp`** — the latter is the Playwright *library* API name (`browserType.connectOverCDP`); the MCP CLI rejects it as an unknown option and exits during startup, which surfaces as "handshaking with MCP server failed: connection closed" even when 9222 is perfectly healthy. Verify the SERVER, not just the port: `printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}\n' | npx @playwright/mcp@latest --cdp-endpoint http://127.0.0.1:9222` must return an `initialize` result.

**Start agents with `ccd` / `cxd`, not `claude` / `codex`:**

```bash
ccd    # ensure CDP :9222 is live, wait for it, then exec claude
cxd    # same, then codex
```

Those wrappers (`~/.zshrc`) are the reliable path because they guarantee **ordering**: MCP servers initialize alongside `SessionStart`, so a browser launched by the hook may not be listening in time for *that* session. `npm run session:begin` calls `scripts/chrome-cdp.mjs` as a third step anyway (after orient + lane-warn), but it only launches-or-warns — it never blocks and never affects session start.

**Why a separate profile:** since **Chrome 136, `--remote-debugging-port` is silently ignored on the default user-data-dir** (a security change — verified on Chrome 150: default profile + flag = nothing listening; a non-default `--user-data-dir` = port live in ~2s). The port is also **launch-only** and can't be added to a running Chrome. So agents drive a persistent dedicated profile at **`~/.chrome-cdp`**, started as a *second* instance with `open -na`. **Nothing here ever quits or restarts Ethan's Chrome.** Sign in to that profile once and it persists across sessions.

`npm run chrome:cdp` is the same check standalone: silent if the port answers, launches the agent profile if it isn't running, and if the agent profile is up *without* the port (rare — crashed or relaunched flagless) it **only warns**; close that window (it holds no tabs of yours) and re-run. `chromedbg` is kept as a manual alias for exactly this, and is **no longer destructive** — the old quit-and-reopen version could never have worked on a current Chrome. Confirm any time with `curl -s http://127.0.0.1:9222/json/version` (JSON with `webSocketDebuggerUrl` = good). The playwright allowlist in `.claude/settings.json` stays **read-only** (navigate/snapshot/screenshot/console/network) — do not widen it.

Then open `http://localhost:8123` and sign in - **Turnstile is disabled** on this server (the app's keyless-dev bypass), so there's nothing to solve:

| persona | email | password |
|---------|-------|----------|
| student | `e2e+user@pitt.edu`  | `E2eUser!Passw0rd`  |
| admin   | `e2e+admin@pitt.edu` | `E2eAdmin!Passw0rd` |

The seed (`scripts/e2e/seed-content.mjs`) creates 3 dorms, 6 checklist items, a marketplace listing, and a roommate post so authed screens render populated - an empty seed can't tell a broken screen from a legitimately empty one.

**Traps, pre-solved (don't rediscover):**
- **A real (prod) `VITE_TURNSTILE_SITE_KEY` leaves the sign-in submit permanently disabled** in headless/localhost Chromium and looks exactly like a P0 auth bug. `serve-verify.mjs` forces it empty - same override `playwright.config.ts` uses. If you `npm run dev` instead (prod env), that's the bug you'll hit.
- **`supabase start -x studio` does NOT serve edge functions** - the admin dashboard's `admin-metrics` call 503s. Not a bug; run `supabase functions serve` if you need them.
- **Switching persona:** the browser persists the Supabase session, so auto-login won't re-pick. Clear `localStorage` (or relaunch `lane:verify` with `VITE_E2E_EMAIL`/`VITE_E2E_PASSWORD` overridden) to switch.
- **After `npm install` in a running lane:** restart `lane:verify` (`rm -rf node_modules/.vite`) - Vite re-optimizing deps mid-session can briefly load two React copies ("Invalid hook call").

Same seeded stack feeds `npm run audit:app` (the Playwright bug-audit crawl), so a hand check and the automated crawl exercise identical config.

---

## Tier 2 - Simulator with live reload (native shell, still editing web)

**Use for:** you need the real iOS shell (safe-area insets, `NativeTopBar` + `BottomNav`, native scroll/keyboard feel) but you're still iterating on `src/` web code.

**Why:** edit any `src/` file and it hot-reloads live in the Simulator - no rebuild. Same edit-and-see loop as Tier 1, inside the native frame.

```bash
npm run ios:live:local   # auto-starts Vite, boots Simulator, builds to /tmp DerivedData, installs, launches. Ctrl+C stops.
```

**Guard:** a live session writes a dev `server.url` into `ios/App/App/capacitor.config.json`. That must never reach dev/main (a release build would try to load localhost). Strip it before committing:

```bash
npm run ios:reset        # or: git checkout ios/App/App/capacitor.config.json
```

Pre-commit + pre-push hooks block any commit carrying the dev URL (one-off bypass `SKIP_LIVE_RELOAD_CHECK=1`). Use `ios:live:local`, not bare `ios:live` - the latter puts DerivedData inside the iCloud-synced repo and trips a codesign "detritus" failure.

**Dev server binds loopback only (`VITE_LAN=1` to opt in).** `vite.config.ts` binds `localhost`, so `:8080` is not reachable from the café/campus network the Mac happens to be on. Everything above still works: the iOS Simulator shares the Mac's loopback, the Android emulator reaches it via `adb reverse` (what `android:live:local` does for `localhost`) or the `10.0.2.2` alias, and the browser is local. Only a **physical device** over Wi-Fi needs the server on all interfaces:

```bash
VITE_LAN=1 CAP_SERVER_URL=http://<lan-ip>:8080 npm run ios:live:local       # or android:live:local
VITE_LAN=1 npm run dev                                                        # standalone server for a device
```

`VITE_LAN=1` only matters to the process that starts Vite: if a server is already running on `:8080` the live scripts reuse it as-is, so restart it with the flag first. Turn it off when done; `lsof -iTCP:8080 -sTCP:LISTEN` should show only `localhost`/`127.0.0.1`.

Keep `ios:live:local` running while developing. Web changes update through Vite HMR; changes to Swift, plists, entitlements, storyboards, asset catalogs, Swift packages, or the Xcode project automatically trigger a native rebuild, Simulator reinstall, and cold relaunch. This prevents an old installed native shell from masking newly merged native UI while the React screen appears current.

**Generated vs. tracked under `ios/App/App/`:** `cap sync` (run by `build:ios`/`ios`/`ios:reset`) regenerates `capacitor.config.json` and copies `dist/` into `public/` on every build - so before committing, know which of those are meant to drift:
- **Gitignored (never commit):** `public/assets/` (hashed JS/CSS bundle) and `public/index.html` (references those hashes, so it changes on every build - this was tracked-and-regenerated churn until 2026-07-22, when it was untracked and gitignored to match `assets/`).
- **Tracked, but should stay clean on a normal build:** `capacitor.config.json` (only changes for a genuine config/plugin change, or the dev live-reload leak the guard above catches) and the static `public/` assets (icons, fonts, `cordova.js`) - these only diff when a source asset actually changes.
- **Tracked and meant to change:** `project.pbxproj`'s `CURRENT_PROJECT_VERSION` bump on every TestFlight/App Store archive - that's real, committed history (see `npm run tag:ios`), never untrack it.

If `git status` shows dirt under `ios/App/App/` after a build that isn't one of the above, that's new drift worth investigating, not "ambient churn" to routinely commit.

---

## Tier 3 - Simulator, driven programmatically (native-only verification)

**Use for:** the genuinely native things you can't test in the browser - push notifications (APNs), deep links, camera, native keyboard behavior, cold-boot auth, App Store build parity.

**Rule: drive it with commands, never with the on-screen keyboard.** Claude Code has a real shell - use it. Char-by-char typing on the iOS keyboard triggers the accent popup (á â …) and corrupts fields. A Capacitor web view is also opaque to `idb ui describe-all`, so target elements via Maestro (WebView-aware) or DOM checks, not accessibility scraping.

Best to good:

1. **Skip the UI. Deep-link straight to the screen under test:**
   ```bash
   xcrun simctl openurl booted "<app-url>"   # e.g. /roommates/invite/CODE
   ```
2. **Boot already signed in:** dev-only auto-login gated to the local/e2e build (no email ever typed). *[Pending merge - see below.]*
3. **Inject text via `idb`, not the keyboard:** `brew install idb-companion` + `pip install fb-idb`, then `idb ui text "..."` into the focused field.
4. **Maestro** for repeatable verification flows (`launchApp` w/ deep link, `tapOn`, `inputText`).
5. **Last resort:** `xcrun simctl pbcopy booted` then long-press → Paste; or Connect Hardware Keyboard (⇧⌘K). For a local login where auto-login isn't wired, paste a seeded `@pitt.edu` email/password user - never Google (not on the local stack).

---

## Which agent runs this

Simulator work needs a real shell - that's **Claude Code**, not Cowork. Cowork's browser and computer-use tools can't drive a Capacitor Simulator well (the web view is a black box to them). Brainstorm and plan in Cowork; execute Tier 2/3 in Claude Code.

## Pending (as of 2026-07-08)

The affordances that make Tier 3 seamless - dev auto-login + verification `data-testid`s - are built and committed on branch `chore/simulator-tooling` (commit `87a9435`) but **not merged**. They're blocked on two local checks: (a) the e2e build actually boots signed in, and (b) live `xcrun simctl openurl` + `idb ui text` work against a running Simulator. Until merged, Tier 3 step 2 is manual.

## Sources

Toolkit + auto-login standard: memory `dormcheck-ios-simulator-text-entry`. Live reload + config guard: memory `dormcheck-ios-live-reload`, `docs/audits/capacitor-native.md`. Codesign gotcha: `ios-build-codesign-gotcha`. Agent split: `tool-division-of-labor`.
