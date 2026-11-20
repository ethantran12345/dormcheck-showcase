# DormCheck i18n — Full Chinese (zh-CN) translation program

Reference doc for the multi-phase translation of the whole app into Chinese (Simplified), done right (native-reviewed). Every phase session reads this. Decision (Ethan, 2026-07-13): full site + emails, zh-CN first, native review before the picker goes live. This reverses the earlier "keep hidden" call — deliberately.

## Reality / scale
- Locale files today hold ONLY the settings-language keys (~9 lines). Effectively nothing is translated.
- ~323 tsx files, 1,000+ user-facing strings (buttons, placeholders, toasts, aria-labels, emails).
- This is a weeks-long retrofit, not a flag flip. Run it as ordered phases; keep the picker gated until the enable-criteria below are met.

## Conventions (do NOT deviate per phase)
1. **Namespaced locale files.** Replace the single `translation` namespace with per-feature namespaces so files stay small and phases don't collide: `common`, `auth`, `onboarding`, `settings`, `marketplace`, `roommates`, `housing`, `messaging`, `checklist`, `resources`, `misc`. Files: `src/i18n/locales/<lang>/<namespace>.json`. Update `src/i18n/index.ts` to load them.
2. **Keys** are semantic + nested: `settings.notifications.quietHours.title`, not English text as the key. lowerCamel leaf names.
3. **Interpolation** for anything with a name/count/date: `t('welcome', { name })` → `"Welcome, {{name}}"`. Never concatenate translated fragments.
4. **Plurals** via i18next suffixes on the EN side (`_one` / `_other`). zh-CN has a single form — one value is fine.
5. **aria-labels, placeholders, title attrs, toast/error strings, email copy** all get translated — not just visible JSX text.
6. **Extraction tooling:** add `i18next-parser` (dev dep) with a config that scans `src/**` and writes missing keys, so no string is silently missed. Manual wiring still required, but parser catches stragglers each phase.

## NEVER translate (leave as-is)
- Brand: "DormCheck", the wordmark.
- **User-generated content** — listing titles/descriptions, chat messages, bios, roommate posts, dorm reviews, names. UGC always renders in whatever language the user wrote it.
- Proper nouns: university/dorm names, Pitt systems (Panther Central, StarRez, RoomSync), payment apps (Venmo, Zelle).
- Hex/tokens/#03C03C/code.
- **Legal text (Terms, Privacy Policy)** — do NOT machine-translate. Flag for professional/legal translation on its own track; keep English until then. A wrong legal translation is a liability.

## Quality bar
- Draft translations may be AI-generated, but each namespace's zh-CN file gets a **native Chinese speaker review** before it counts as done. (Pitt has a large Chinese-speaking student community — good reviewer pool.) AI-only is NOT "correctly translated."
- After wiring a screen, render it in zh-CN and check for layout breakage (Chinese strings are often shorter but some UI still shifts) and missing-key warnings in the console.

## Phase order (by visibility; one namespace per phase unless small)
- **Phase 1 — Foundation + `common` + `settings`** (proof of the whole pipeline; settings is self-contained and freshly built). Picker stays gated.
- **Phase 2 — `auth` + `onboarding`** (first impression).
- **Phase 3 — app shell / nav / `misc` chrome.**
- **Phase 4 — `marketplace`.**
- **Phase 5 — `roommates`.**
- **Phase 6 — `housing` / explore.**
- **Phase 7 — `messaging`.**
- **Phase 8 — `checklist` / move-in / schedule / `resources`.**
- **Phase E — Emails** (server-side `api/` + Resend templates) — separate, server-side.
- **Legal track** — professional translation of Terms/Privacy (not Claude Code).
- **Phase F — Native review sign-off + enable.** Only when all above are done + reviewed.

## Parallelization (optional, after Phase 1 lands)
Because each feature owns its own namespace file, Phases 4–8 CAN run as separate parallel Claude Code sessions without colliding — each edits its own `marketplace.json` / `roommates.json` etc. The ONLY shared surfaces are `common`, `src/i18n/index.ts`, and shared components — those must be settled in Phase 1/3 first. Do NOT parallelize anything that edits `common` or the i18n config.

## Enable-criteria (when the picker goes live)
Flip `I18N_LANGUAGE_PICKER = true` and `zh.enabled = true` in `languages.ts` ONLY when: all feature namespaces + emails translated AND native-reviewed, legal track resolved (translated or explicitly English-for-now), and a full click-through of the app in zh-CN shows no missing-key fallbacks on core flows. Until then the picker stays gated (no half-Chinese UI shipped to students).

## Per-phase done-criteria
- Namespace's EN keys complete (parser shows no un-extracted literals in that area) + zh-CN drafted + flagged for native review.
- Screen renders in zh-CN with no console missing-key warnings, no layout break, light + dark.
- No UGC, brand, or legal text translated.
- tsc/eslint/tests/build green; commit on dev, no branch, no PR; CHANGELOG line.

## zh-CN native-review tracker (files drafted, awaiting sign-off)
Draft translations are AI-generated and NOT done until a native Chinese speaker reviews them.
Mark a file `[reviewed <name/date>]` once signed off.

- [ ] `src/i18n/locales/zh/common.json` (Phase 1, +2 keys Phase 2, +10 keys Phase 3: `actions.signIn/logOut/tryAgain` + `labels.*`) - PENDING NATIVE REVIEW
- [ ] `src/i18n/locales/zh/settings.json` (Phase 1) - PENDING NATIVE REVIEW
- [ ] `src/i18n/locales/zh/auth.json` (Phase 2) - PENDING NATIVE REVIEW
- [ ] `src/i18n/locales/zh/onboarding.json` (Phase 2) - PENDING NATIVE REVIEW
  - Reviewer note: some strings use half-width punctuation (`,` `;` `?` `(可选)`) where native zh-CN prefers full-width (`，；？（可选）`); normalize on review.
- [ ] `src/i18n/locales/zh/misc.json` (Phase 3, 85 keys: app shell / nav / topbar / notifications / error / 404 / safety dialog) - PENDING NATIVE REVIEW
  - Reviewer note: full-width punctuation used per the note above. Sanity-check nav term choices: Housing=住宿 vs Dorms=宿舍, Schedule=课程表 (class schedule, not 日程), Student Setups=学生布置, Logistics=物流.
- [ ] `src/i18n/locales/zh/messaging.json` (Phase 7, 107 keys: DM/group chat chrome, composer, request flow, delete/decline/retract dialogs, group create/search, DM user-search, payment-safety + contact-share warnings, preview fallbacks) - PENDING NATIVE REVIEW
  - Reviewer note: full-width punctuation used. Sanity-check term choices: 会话=conversation/thread, 群聊=group chat, 消息请求=message request, 撤回=retract, 举报=report, 成色=condition (marketplace item). Message bodies + user names are UGC and intentionally left untranslated. In-sentence feature-tab references drafted as 市场=Marketplace, 室友=Roommates, 我的主页=My Home, 你的宿舍=Your Dorm - align with the misc/nav canonical choices on review.
- [ ] `src/i18n/locales/zh/housing.json` (Phase 6, 392 keys: explore filters/map legend/transit/compare-tray, dorm search, dorm card + detail, dorm rankings + collaboration toasts, dorm-portal overview/apply/chats/floor-plan/move-in/report/setup-tag/submit-link, in-portal marketplace chrome, student-setups chrome) - PENDING NATIVE REVIEW
  - Reviewer note: full-width punctuation used. Term choices: 宿舍=dorm/hall, 楼=building, 楼层=floor, 大一新生=first-year, 高年级=upperclass, 入住=move-in, 布置=setup, 商品=marketplace item, 卖家=seller, 排名=rankings, 设施=amenities, 收藏=save/bookmark, 点赞=like. Dorm/university names, seeded dorm data (descriptions, amenity free-text, DRS institutional address/phone/email), listing + setup UGC, and data-sourced enums (`MARKETPLACE_CONDITIONS`/`MARKETPLACE_CATEGORIES`) are intentionally untranslated. Align 宿舍 (Dorms) vs 住宿 (Housing) with the misc/nav canonical choice on review.
- [ ] `src/i18n/locales/zh/checklist.json` (Phase 8, 586 keys: checklist page/topbar/landing/summary/item/dnd/assignee/group/skip, Shop-Essentials explore + filters, Import-from-Notes, split-cost/payment/record-payment/room-photo popovers, move-in journey + arrival, move-out flow + logistics/Ship2Pitt/Store@Pitt, and `schedule.*` = class schedule/weekly grid/add-class/add-room/set-home) - PENDING NATIVE REVIEW
  - Reviewer note: full-width punctuation used. Term choices: 清单=checklist, 分区=section, 物品=item, 已打包=packed, 待购买=to pack/need to buy, 入住=move-in, 搬离=move-out, 分摊费用=split cost, 课程表=schedule, 楼栋=building, 教室=room, 住处=home, 步行路线=walking route, 出发时间=leave by, 宿舍楼=residence hall, 选购必需品=Shop Essentials, 我的选品=My Picks. Weekday labels under `schedule.days.*`; `schedule.daysHeading`="Days" (renamed from `days` to avoid a string/object key collision). Generic verbs consumed from `common:actions.*`; five namespace-local verbs live in `checklist:actions.{couldNotSave,create,invite,undo,view}` (kept out of `common` for parallel-phase safety).
- [~] ~~`src/i18n/locales/zh/resources.json`~~ **(namespace removed — the Pitt Resources hub and its `resources` namespace no longer exist in `src/i18n/locales/`)** (Phase 8, ~16 keys: Pitt Resources hub chrome - page intro, search box, guide read-time badge, quick-answer, official-forms/link chrome, coming-soon state, and YourHallSection row labels) - PENDING NATIVE REVIEW
  - Reviewer note: full-width punctuation used. Guide/link TITLES + SUMMARIES + BODIES come from `src/data/pittGuides.ts` and `src/data/pittResources.ts` and are intentionally LEFT ENGLISH (see the resource-content track note below); only page-hardcoded chrome around the tiles is translated. `{{school}}` = university short name (proper noun). Hub heading reuses `misc:nav.resourcesHub`/`misc:nav.pittResources`.
- [ ] `src/i18n/locales/zh/roommates.json` (Phase 5, 351 keys: browse/match/detail/invite/liked/saved chrome, the compatibility profile form + boundaries, the post composer + post cards + finding tab, and the `options.*` compatibility-enum + boundary display labels) - PENDING NATIVE REVIEW
  - Reviewer note: full-width punctuation used. The `options.*` labels are DISPLAY-ONLY for persisted English DB values (via `roommateOptionLabel`) - do not touch the English enum values in `lib/roommateOptions.ts`. Sanity-check people-matching term choices: compatibility=契合度, boundaries=界限, roommate=室友; the dynamically-generated match reason/conflict sentences from `lib/roommateMatch.ts` are still English (deferred). Custom user-typed boundary chips + all post free-text stay untranslated (UGC).
- [ ] `src/i18n/locales/zh/marketplace.json` (Phase 4, 234 keys: buy/sell listing edit + my-items management, seller ratings/reviews, listing verification dialog, photo-gallery + item-tagger fields, and the full student-businesses browse/list/detail/form/admin-moderation surface) - PENDING NATIVE REVIEW
  - Reviewer note: full-width punctuation used. Term choices: 商品=marketplace item/listing, 卖家=seller, 成色=condition, 见面地点=meetup location, 待定=pending, 已售=sold, 认证=verify/verified, 商家=(student) business, 套餐=package, 收藏=save/bookmark, 私信=DM/message. Data-sourced enums (`MARKETPLACE_CATEGORIES`/`CONDITIONS`/`PAYMENT_METHOD_LABELS`, business category names, the `'All'`/`'Create your own...'` filter sentinels) are persisted DB / logic values shown verbatim - intentionally untranslated; the `buildBusinessDmCard` context card is a persisted DM body (messaging/UGC) - untranslated. Brand/proper nouns (DormCheck, Instagram, Snapchat, Pitt, Venmo/Zelle) + format placeholders (@handles, sample phone/address/price) kept literal.

### Phase 4 status (done 2026-07-13)
`marketplace` surface wired to `t('marketplace:*')` + drafted zh-CN (dev commit `6090d56`,
UNPUSHED). 16 components (`src/components/marketplace/*`) + `pages/app/{MarketplaceEdit,
MarketplaceMyItems}.tsx`: buy/sell listing edit + my-items management, seller ratings/reviews,
listing verification dialog, photo-gallery + item-tagger fields, and the full student-businesses
browse/list/detail/form/admin-moderation surface. `Marketplace.tsx` has no strings (renders
`MarketplaceTab` in `dorm-portal/` = Phase 6 scope). **UGC/DATA boundary held**: listing/business/
seller free-text, prices, photos, names; `MARKETPLACE_CATEGORIES`/`CONDITIONS`/`PAYMENT_METHOD_LABELS`
+ business category enums + the `'All'`/`'Create your own...'` filter sentinels (persisted DB /
logic values, shown verbatim); and `buildBusinessDmCard` (persisted DM body) left untranslated.
234 keys, en↔zh parity 234/234 (0 blanks, placeholder + `<b>` tag parity, 231 distinct used keys
all resolve). Real plurals `_one/_other` (`rating.ariaWithCount`/`starsCount`, `seller.ratingsChipAria`);
plain counters use `{{n}}`/`{{max}}`/`{{sold}}`/`{{total}}`; `<Trans>` for the inline-bold
under-review line. Verified per the concurrent-tree playbook ([[i18n-parallel-phases-shared-tree]]):
deterministic parity/usage audit (NOT global `i18n:extract`), tsc clean in scope, eslint 0 errors
(2 pre-existing warnings), 472 tests. Picker gated. Follow-up: native zh review of `marketplace.json`;
isolated-worktree `vite build` + live zh browser pass.

### Phase 8 status (done 2026-07-13)
`checklist` + `resources` (checklist page, Shop Essentials, move-in/move-out/logistics, class
`schedule`, and the Pitt Resources hub chrome) wired to `t()` and drafted zh-CN. This was the
LAST feature phase. 586 checklist keys + ~16 resources keys, EN↔ZH parity exact (586/586,
16/16), and every one of the 582 `t()` key references in the wired code resolves (authoritative
code-ref cross-check; 0 missing). Wired across `src/components/{checklist,schedule,resources}/*`
+ `ChecklistPage.tsx` (Read-guard temporarily lifted, restored) + `SchedulePage.tsx` +
`ResourcesPage.tsx`. `schedule.*` lives under the `checklist` namespace (this phase owns two
namespaces; schedule is not a third). Executed as a parallel fan-out (7 cluster wiring subagents
against a shared glossary; the coordinator authored `resources` + owned all JSON assembly +
fixed subagent artifacts: invalid inline-Handlebars plurals -> `_one/_other`, `&amp;` escapes,
zh straight-quote -> full-width, smart-quote code delimiters, and the `days` key collision).

Deliberately NOT translated (flagged for follow-up decisions):
- **Resource-content track:** `src/data/pittGuides.ts` (native guide title/summary/body) and
  `src/data/pittResources.ts` (official link-out title/description) + `PITT_RESOURCE_CATEGORIES`
  labels stay ENGLISH. They are app-curated CONTENT (like the legal track), not UI chrome, and
  live in data files outside the component scope; both have tests asserting English copy.
  Needs a separate content-translation decision before enable.
- **Checklist `STANDARD_CATEGORIES`** (13 default section labels in `checklistTypes.ts`) stay
  ENGLISH: they are stored per-item in the `checklist_items` DB rows, are user-renameable, and
  are used as grouping identifiers, so translating them risks breaking category-match logic.
  Needs a label-map helper (translate app-defaults, passthrough custom) if wanted later.
- **`countdownLabel()`** (`@/lib/dateUtils`, shared util, out of scope) still returns English
  move-in/out countdown text; only the in-component chrome around it was wired.
- Default checklist ITEMS are DB-seeded (not code) = UGC, correctly untranslated.

Verified: tsc clean; eslint 0 errors on all 34 changed files (jsx-a11y gate passes); full suite
472/472; prod build green (3500 modules); a throwaway vitest probe confirmed checklist +
resources render in zh through the real pipeline with every interpolation var matching (no
leftover `{{...}}`), plurals using the single zh form, and the repointed `checklist:actions.*`
resolving. Picker stays gated. Ran in a shared working tree alongside live Phase 5/7 sessions;
staged ONLY Phase 8 files (never messaging/roommate/settings/iOS).

### Phase 6 status (done 2026-07-13)
`housing` / explore / dorm-portal app-defined UI wired to `t('housing:*')` and drafted zh-CN
(392 keys, EN↔ZH parity 392/392, 0 placeholder mismatches). Wired across `src/components/{explore,
housing,dorm-portal}/*`, `DormCard/DormDetail/DormMiniMap/DormSearch/ExploreHousingFilterBar/
ExploreHousingRankingsOverlay`, `HousingRankingsContent`, `pages/app/HousingDetailPage`. Generic
actions reuse `common:*`. **UGC/DATA boundary held**: dorm/university names + seeded dorm data
(descriptions, amenity free-text, DRS address/phone/email) + listing/setup UGC + data-sourced
condition/category enum arrays left as source data; only fixed hard-coded app-UI literals translated.
Three plain-number interpolations moved off reserved `{{count}}` to `{{n}}`
(`explore.compareTray.dialogDescription`, `portal.marketplace.filters.filtersWithCount`,
`portal.setups.upload.photoValidationErrorMultiple`) to avoid i18next pluralization coupling; the
one genuine plural (`marketplace.listing.itemsCount`) keeps `_one`/`_other`. Verified per the
concurrent-tree playbook ([[i18n-parallel-phases-shared-tree]]): deterministic en↔zh parity +
no-blank/no-straggler scan, tsc clean (whole graph), eslint no new errors on scope, 472 tests; a
green `vite build` was obtained in an **isolated worktree at HEAD** (the main tree's build was red
only on a sibling Phase-5 `RoommatePage.tsx` smart-quote edit, not in this commit). Picker stays
gated. Follow-up: native zh-CN review of `housing.json`; a logged-in live zh browser pass of
explore/list/map/detail.

### Phase 3 status (done 2026-07-13)
App shell + `misc` chrome wired to `t()` and drafted zh-CN; `common` finalized for the feature
phases. **This is the LAST shared/sequential phase - Phases 4-8 can now run in parallel**, each
owning its own namespace and consuming (never editing) `common`/`misc`/the shell/`i18n/index.ts`.

Migrated: `AppSidebar`, `navSections` (the sub-tab hub - `label`/`title` fields renamed to
`labelKey`/`titleKey` holding `misc:nav.*` keys, resolved via `t()` in all 4 consumers),
`NavActionMenu`, `SidebarRail`, `SidebarSubTabs`, `BottomNav` (kept English `label` as the stable
`data-tour-id` identifier, added `labelKey`/`tabLabelKey`), `TopNav`, `NativeTopBar`,
`AppShellTopRight`, `NotificationsBell`, `BookmarkToggle`, `ProfileMenu`, `LegalBackBar`,
`ErrorBoundary` (class component - uses the `i18n.t` singleton), `NotFound`, `SafetyTipsDialog`.
Keys: misc 85, common +10 (`actions.signIn/logOut/tryAgain`, `labels.{home,settings,messages,
notifications,profile,myProfile,admin}`); EN↔ZH shape-matched exactly (parity-checked). School
name interpolated via `misc:nav.resourcesHub` (`{{school}}`); notification unread count is a real
i18next plural (`unreadMessages_one/_other`, `{{count}}`), other counts use `{{n}}` to avoid the
reserved-`count` pluralization coupling; no Handlebars conditionals.

Test infra: `src/test/setup.ts` now initializes the shared i18n instance (deferred `await import`
so it runs after the localStorage polyfill - the language detector binds to localStorage at init)
so tests that render migrated components see real English copy, not raw keys.

Not migrated here (deliberately): `ChatPanel` empty state belongs to Phase 7 (messaging);
`NativeTopBar`'s `'Student'` display-name fallback is profile-identity logic, not shell chrome.
Verified: tsc/eslint(0 err)/472 tests/build all green; `i18n:extract` surfaced no stragglers in
the shell; en↔zh parity 85/85 misc + 39/39 common; a throwaway vitest probe confirmed zh renders
through the real pipeline (namespace load, `{{school/label/name/n}}` interpolation, plurals,
fallback) - a logged-in live zh browser pass of the shell is a good follow-up. Picker stays gated.

### Phase 2 status (done 2026-07-13)
`auth` + `onboarding` wired to `t()` and drafted zh-CN. Full auth surface (`Auth.tsx`,
`PasswordInput`, `PasswordRequirements`, `MfaChallengeGate`, plus the `universityOnlyMessage`
gating string via the `i18n.t` singleton) + full onboarding surface (`OnboardingIntro`,
`WaitlistCard`, `WaitlistPage`). Keys: auth 93, onboarding 165 (`intro.*` + `waitlist.*`),
common +2 (`backToSignIn`, `joinWaitlist`); EN↔ZH shape-matched exactly. `<Trans>` used for
embedded markup/links (legal, code-sent-to, hero, oauth-only, waitlist optional/rank);
plurals via `_one`/`_other` (`signedUpLine`); optional-name headings via `title`/`titleWithName`
chosen in code (NOT `{{#if}}` - i18next has no handlebars conditionals). Picker stays gated.
Browser-verified `/waitlist` (public) end-to-end in zh-CN (no stray English, no missing-key
warnings, no layout break); `/auth` + `OnboardingIntro` are session-gated (dev autologin
redirects `/auth`) so they were verified statically (exact EN↔ZH parity + full code-ref audit +
no un-wired literals) rather than visually - a logged-out visual pass is a good follow-up.

### Phase 1 status (done 2026-07-13)
Foundation + `common` + `settings` wired and drafted. Namespaced structure + `i18next-parser`
(`npm run i18n:extract`) in place. Picker stays gated (`I18N_LANGUAGE_PICKER = false`,
`zh.enabled = false`). Deferred within settings: the shared `ProfileEditFields` form (Profile
section body) stays English - it is shared with the roommates surface, so it belongs to that
phase; the Settings > Profile search rows still show localized labels but anchor-highlight
degrades to a section jump in zh until ProfileEditFields is migrated.

<!-- docs-drift-ignore: src/i18n/locales/zh/resources.json, src/data/pittGuides.ts, src/data/pittResources.ts -->
<!-- The Pitt Resources hub was removed; these three are named only in entries
     recording what was never translated and no longer exists. -->
