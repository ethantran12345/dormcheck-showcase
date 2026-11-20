# The 50 orphaned locale keys — decision list

> **RESOLVED 2026-08-17. Ethan approved all 35 deletions; they are executed.** Each key was
> re-verified as still unreferenced at `36e276fc` immediately before removal — a
> token-boundary scan over 799 files under `src/` (locale JSON excluded), plus the dynamic
> `` t(`ns:prefix.${x}`) `` residue rule — and all 35 were still clean. Each was then removed
> from **both** `src/i18n/locales/en/` and `zh/`, its baseline entry dropped, and every
> parent object left empty pruned. `scripts/i18n-orphan-baseline.json` now holds the **15
> KEEP entries and nothing else.**
>
> **The commit is the archive.** This copy exists nowhere else now, and the commit body
> lists every deleted key with its English and Chinese strings, so `git log -S '<key>'`
> recovers it.
>
> Group **D6** was approved with the rest: Ethan confirmed the "My lists" card counts are
> not planned. Note what that group actually cost — `itemsCount` and `memberCount` are
> **i18next plural keys**, stored as `itemsCount_one` / `itemsCount_other`, so the base form
> the baseline names appears nowhere in the JSON. Deleting the two keys removed eight
> entries, four per locale. A deletion pass that matched the literal key name would have
> silently left all eight behind and reported success.
>
> **The 15 KEEP entries below stand unchanged**, with one addendum under K3.

**Why this is not a sweep.** Subleases were removed on 2026-07-21 and restored on
2026-08-05. A key whose feature is *paused* costs a line of JSON; a key deleted from a
feature that comes back costs a re-translation and, until someone notices, a raw key in
the UI — which is exactly the bug `2483f248` had to fix in the settings search index. So
each group below is judged on **what still exists behind the copy**, not on whether a
component was deleted.

Source: `scripts/i18n-orphan-baseline.json` (50 keys, en + zh). Evidence re-checked
2026-08-17 against `git log -S`, the migration history, and live `src/` imports.

---

## Summary

| Verdict | Groups | Keys | State |
|---|---|---|---|
| **DELETE** — the thing behind the copy is gone or superseded by something live | 12 | **35** | **executed 2026-08-17** |
| **KEEP** — the feature is paused with its data layer and wiring intact, or the copy is not retired at all | 3 | **15** | untouched; K3 re-opened |

Three groups carry a **↩ might-return** flag; two of them are the KEEP groups.

---

## KEEP

### K1 · Checklist balances / record payment — 8 keys ↩ **highest return risk in the list**

```
checklist:recordPayment.amount        checklist:recordPayment.methodOther
checklist:recordPayment.method        checklist:recordPayment.methodVenmo
checklist:recordPayment.methodCash    checklist:recordPayment.methodZelle
checklist:recordPayment.record        checklist:recordPayment.title
```

Retired by: `RecordBalancePaymentPopover.tsx` deleted in `c7494eef` (dead-code sweep,
2026-08-01); `ChecklistBalancesSection` went in `fcc4244d`.

**Status: PAUSED — only the popover died. Everything under it is still live.**

- `public.payment_history` still exists (`20260101000000_baseline.sql`), commented
  *"Checklist group payments; confirmed rows reduce displayed balance vs split obligations."*
- `get_group_checklist_settlement_context` RPC still exists
  (`20260606120000_…`), and `useChecklistSettlementContext` is **still called in
  production code** — `src/hooks/useGroupSurface.ts:139`, not just tests.
- `ChecklistSummaryZone.tsx:24` still declares a `balancesSection?: ReactNode` slot. The
  hole the section used to fill was left in place.
- `profiles.venmo_username` is live, and Settings ships a live **Payments** row whose own
  search keywords are `venmo, zelle, split, checklist, balances`
  (`settingsSearchIndex.ts:53`).

**Recommendation: KEEP all 8.** A UI was swept off a feature that was otherwise left
running end to end. These eight strings are the cheapest part of turning it back on.

### K2 · Roommates "Find Roommates" tab — 6 keys ↩ **the subleases-shaped one**

```
roommates:finding.title      roommates:finding.searchPlaceholder
roommates:finding.subtitle   roommates:finding.interestCreated
roommates:finding.tabLabel   roommates:finding.couldNotUpdateInterest
```

Retired by: `b52a1462` removed the `?tab=finding` tab; `RoommatePage` is Browse-only.

**Status: PAUSED, and the removing commit said so in its own message** —
*"FindingRoommates infra + `roommates:finding.*` keys retained (used elsewhere)."*

- `src/components/roommates/FindingRoommates.tsx` still exists and is still imported by
  `src/components/chat/MessagePreviewCard.tsx` and
  `src/pages/app/RoommatesSavedPostsPage.tsx`.
- Sibling keys in the same namespace are rendered today: `finding.expressInterest`,
  `finding.reportPost`, `finding.viewPostDetails` (`RoommatePostDetail.tsx`,
  `RoommatePostCard.tsx`), `finding.couldNotStartConversation` (`useStartDm.ts`).
- Roommates is an **off-by-default surface**, not a deleted one — `LIMITED_SURFACES` in
  `src/lib/featureFlags.ts`, overridable per tenant.

This is the closest structural match to subleases: a tab hidden while its infrastructure
and its feature flag both stay. Note also that `interestCreated` and
`couldNotUpdateInterest` are **half of a toast pair** whose other half
(`couldNotStartConversation`) is live — deleting one side of a pair is how a raw key
appears months later.

**Recommendation: KEEP all 6.**

### K3 · `marketplace:service.notesLabel` — 1 key

Baseline reason: *"No removal commit found by `git log -S`, so the provenance is NOT
traced."*

**Status: it was never retired copy.** The traced answer is that this key does not belong
in an orphan list at all — services is a live, actively-developed feature:

- `marketplace_listings.service_notes` exists with a length constraint
  (`20260910000000_marketplace_service_posts.sql`), and the column is guarded by the
  service edit rate limit (`20260924000000_…`, `trg_service_edit_rate_limit` live in prod).
- `ServiceFields.tsx:66` reads `form.service_notes` today.
- The sibling `marketplace:service.notes` ("Anything else worth knowing") is the live
  string on that same field.

So `notesLabel` ("Notes") is an **unused label variant beside a live input**, not copy that
outlived its component.

**Recommendation: KEEP, and consider wiring it** as the field's `<Label>` rather than
deleting it. Either way it should move out of the orphan baseline's "retired copy" framing
with a corrected reason, because the current reason ("provenance not traced") invites the
next reader to delete it as unexplained.

#### Addendum, 2026-08-17 — re-traced, and the recommendation above is wrong

The KEEP above answered "was it retired?" That is not the question that decides whether copy
should exist. **"Currently unreferenced" is**, and the trace now runs end to end.

**It is not a rename, in either direction.** `service.notes` did not supersede `notesLabel`
and `notesLabel` did not supersede `service.notes`. Both arrived in the **same commit** —
`fa824b20` (2026-08-05, the sublease restore) added the whole `service.*` block:
`notes`, `notesPlaceholder`, `notesHint`, `notesLabel`. Three minutes later — `fa824b20` at
23:53:15, `ec16fc14` at 23:56:17 — `ec16fc14` added `ServiceFields.tsx`, which called
`service.notes`, `notesPlaceholder` and `notesHint` and left `notesLabel` alone. So
`notesLabel` was **born unreferenced beside three siblings the component did wire up**, and
has never rendered once in the twelve days since: `git log -S"notesLabel" --all` returns
`fa824b20`, the two commits that merely *name* the key in the baseline and this document,
and two autosnaps whose only `src/` file is `settingsSearchIndex.ts`. No component, page or
hook has ever contained it, in any commit.

**The field it would label already has a rendered label.** `ServiceFields.tsx:210` puts
`service.notes` in the `<Label>`; `notesPlaceholder` is the placeholder and `notesHint` the
character counter. So keeping `notesLabel` means **two labels for one input on a live,
actively-developed feature** — which is exactly the en/zh drift vector: an edit or a
translation pass touches one and not the other, and whichever gets wired later ships the
stale half. This is the same shape as the bug `2483f248` fixed, only pointed the other way.

**The one argument for wiring it instead is refuted by the copy around it.** "Notes" is the
tidier label, so the tempting read is that the component picked the wrong key. But every
sibling label in this composer is conversational, not a terse noun — `category` = "What kind
of help?", `date` = "When", `duration` = "About how long", `location` = "Where". "Anything
else worth knowing" belongs to that set. "Notes" does not. The component is using the right
key for the voice this surface speaks in.

**Revised recommendation: DELETE `marketplace:service.notesLabel`** (en + zh, plus its
baseline entry). It is neither retired copy nor a rename residue; it is an unwired duplicate
label, and the live feature underneath it is the reason to remove it rather than the reason
to keep it. **Not executed — this key was in the KEEP set and is out of scope for the
2026-08-17 pass. Ethan decides.**

---

## DELETE

### D1 · Verifications — 5 keys

```
marketplace:myItems.verification.verified   marketplace:myItems.actions.verify
marketplace:myItems.verification.pending    marketplace:myItems.thisListingFallback
marketplace:myItems.verification.declined
```

Retired by: `e80b03f4` — *"Verifications removed entirely"*: nav entry,
`/admin/verifications`, `ListingVerificationsPage.tsx`, the student-side
`VerifyListingDialog` render + status pill + Verify button, and the `listing_verifications`
query in `MarketplaceMyItems.tsx`. `VerifyListingDialog.tsx` deleted.

**Status: gone as a product surface.** The schema was deliberately left intact
("reversible without a migration"), and `20260926000000_listing_verifications_superadmin_only.sql`
later scoped its admin policies on the explicit finding that *"the database has been
granting read+approve on lease documents for a product surface that does not exist."*

**Recommendation: DELETE all 5.** The reversibility that was preserved is the *database's*,
and the stated product direction is that moderation lives on the superadmin side. Even on a
return, these are **student-side My Items** strings for a dialog that no longer exists as a
file; an admin-side moderation tool would not reuse them. `VerifiedListingBadge` and its own
copy stay live and are untouched by this.

### D2 · Move-in "night one" add flow — 4 keys

```
checklist:moveIn.nightOneAdd     checklist:moveIn.nightOneAdding
checklist:moveIn.nightOneAddError  checklist:moveIn.nightOneExists
```

Retired by: the dorm-aware packing list's add flow (`6a441a79`) stopped rendering when the
move-in journey was repaged in `f2fb55cc`.

**Status: the move-in journey is live; this specific interaction was replaced.**

**Recommendation: DELETE.** Low risk — a repagination, not a retirement, and copy for the
new paging would be authored to the new page's structure rather than reusing four strings
built around a popover that no longer exists.

### D3 · Move-out tier rail — 1 key

`checklist:moveOut.tierRailAriaLabel` — the rail was replaced by the chooser-filtered
ladder in `f2fb55cc`.

**Recommendation: DELETE.** It is an `aria-label` for a control that does not exist. An
aria-label cannot outlive its control usefully.

### D4 · Checklist estimated total — 3 keys

```
checklist:summary.estTotal   checklist:summary.estTotalHelp   checklist:summary.estTotalTooltip
```

Dropped in the checklist v2 restructure (`dc8e2d86`).

**Status: superseded by something live** — `ChecklistReadinessSummary.tsx` renders
`summary.budgetLabel`, `summary.spendingBudgetAria` and `summary.setBudget` today. The
estimated-total idea shipped as a budget.

**Recommendation: DELETE.**

### D5 · `checklist:summary.toPack` — 1 key

Superseded by `checklist:summary.toPackCount`, which is live at
`ChecklistSummaryZone.tsx:84`.

**Recommendation: DELETE — zero risk.** The replacement renders today; this key only ever
looked referenced because `toPack` is a prefix of `toPackCount` under the old
substring-based scan.

### D6 · Checklist v2 hub counts — 3 keys ↩ **might-return, but as intent, not as a revert**

```
checklist:v2.hub.personalDefault   checklist:v2.hub.itemsCount   checklist:v2.hub.memberCount
```

Added in `f0d8f7bc` and **never rendered by `ChecklistListsHub.tsx`**; the siblings
(`v2.hub.title`, `.subtitle`, `.personalBadge`) are live.

**Status: born orphaned.** No user has ever seen these, and no translator has ever seen them
in situ.

**Recommendation: DELETE — unless the hub is still meant to show item and member counts.**
This is the one group where the risk is not "the feature comes back" but "the feature was
never finished." Worth one sentence from Ethan: if per-list item/member counts are still
planned for the lists hub, keep the three keys as the spec; if not, they are the safest
deletions on this page.

### D7 · Schedule / class calendar — 3 keys

```
housing:emptyStates.calendarNoClassesTitle   housing:emptyStates.calendarAddClasses
housing:emptyStates.calendarNoClassesBody
```

Retired by: `74898fc8` ("retire schedule and expand feature launcher").

**Status (2026-08-17): gone, with a tombstone.** `/schedule` was converted into a permanent
`Navigate to="/housing"` redirect, pinned by a test and recorded in `docs/ARCHITECTURE.md`
(`2f999c27`). The three keys were deleted on that reading.

**REVERSED 2026-08-26.** Schedule was restored from history: `/schedule` renders
`SchedulePage` again, `SHOW_SCHEDULE` is `true`, the redirect route and its test are gone,
and all three keys are back in `en`/`zh` `housing.json`. Kept here as the record of a
DELETE that had to be undone — a surface with a live route, a live table, and retained
user rows is a weaker "gone" signal than a redirect plus a test suggests.

### D8 · Building chat join prompt — 6 keys ↩ **medium return risk**

```
messaging:buildingJoin.title  messaging:buildingJoin.cta     messaging:buildingJoin.dismiss
messaging:buildingJoin.body   messaging:buildingJoin.notNow  messaging:buildingJoin.error
```

Retired by: `a9beba34` — Community Space Phase 1 deleted `BuildingChatJoinPrompt.tsx` and
replaced the opt-in join prompt with **auto-join at the housing-confirm paths**.

**Status: architecturally inverted, not paused.**

**Recommendation: DELETE, with the risk stated.** Auto-joining a student into a building
chat is the kind of thing that can be pushed back to an explicit opt-in later, on consent
or App Store grounds. If that happens the prompt returns — but as a consent flow with
consent copy, not as these six strings. Overrule this one if a consent review is already
on the calendar.

### D9 · Messages preview widget — 3 keys

```
messaging:previewWidget.emptyTitle   messaging:previewWidget.emptyBody
messaging:previewWidget.findRoommates
```

`MessagesPreviewWidget.tsx` deleted in `c7494eef` (dead-code sweep, 2026-08-01).

**Status: gone, and its host page has since been rebuilt** — My Home was re-focused in
`51bd749b` with its own widget set.

**Recommendation: DELETE.** Note `previewWidget.findRoommates` pointed at the same tab as
group K2; the K2 keys are being kept, so nothing about roommates is lost by dropping this
widget's own copy.

### D10 · Nav action menu — 2 keys

`misc:actionMenu.homeOptions`, `misc:actionMenu.groupSections` — nav chrome from
`0dad31e7`, superseded by the navSections launcher.

**Status: superseded by a live, actively-maintained replacement** (the launcher is what
`2483f248` was fixing three commits ago). The baseline already records that `968e8043` did
not orphan these — it only touched `actionMenu.goTo`, which is live.

**Recommendation: DELETE.**

### D11 · Labels a primitive now supplies — 2 keys

- `auth:mfa.dialogLabel` — the MFA gate was recomposed onto `ui/` primitives in `57dc94a4`;
  the primitive supplies its own dialog label.
- `marketplace:business.detail.closeBackdropAria` — `BusinessDetailModal` moved from a raw
  overlay to `Dialog` in `6fd8ca66`; Dialog supplies its own close affordance and label.

**Recommendation: DELETE — zero risk, and keeping them is mildly harmful.** A leftover
dialog label sitting next to a Radix-supplied one is an invitation to re-add it and ship a
double-labelled dialog, which is an accessibility regression on a blocking gate
(`jsx-a11y` + axe).

### D12 · Swept settings rows — 2 keys

`settings:appearance.hint`, `settings:support.about.title` — removed with the rows deleted
in `c7494eef`.

**Status: gone, and the settings model already agrees.** Neither row appears in
`settingsSearchIndex.ts`, which is the hand-authored inventory of every row a user can
actually see.

**Recommendation: DELETE.** Mild note: an **About** row (version/build) is a common App
Store expectation and could plausibly return to Support & Legal. If it does it is one
string, and it would come back through the search index as a new entry.

---

## How to act on this

Deleting a group means, per key: remove it from `src/i18n/locales/en/<ns>.json`, remove the
mirror from `src/i18n/locales/zh/<ns>.json`, and drop its line from
`scripts/i18n-orphan-baseline.json`. The baseline may only shrink, and an entry that stops
being an orphan also fails the gate, so `npm run i18n:verify` will catch a half-done pass in
either direction.

Do not deep-re-sort the locale JSON while editing it — it is not fully sorted, and a
re-sort turns a two-line change into an unreviewable diff.
