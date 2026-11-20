# Storage buckets

Source of truth for DormCheck's Supabase Storage buckets. **Code is canonical:**
the bucket rows live in `supabase/migrations/20260820020000_storage_buckets_baseline.sql`
(+ `20260712220332_listing_verifications.sql` for `listing-verifications`). Their
RLS policies on `storage.objects` are in the migration baseline
`20260515044633_remote_schema.sql` and the security-pass migrations.

Doc-control: written 2026-07-20 from prod (project `abcdefghijklmnopqrst`) as ground
truth. If you change a bucket in the dashboard, mirror it into the migration + this
table, or a fresh stack drifts from prod.

## Why this exists

Every bucket was originally created by hand in the Supabase dashboard — **no migration
INSERTed the bucket rows** (migrations only ever defined the `storage.objects` RLS
policies). A migration-only stack (disaster recovery, staging, a second university
tenant) therefore came up with zero buckets and every upload died on "Bucket not found".
Found 2026-07-20 by the `audit:app` crawl on a clean local stack. The baseline migration
above closes the gap; buckets are now reproducible from git alone.

## Buckets (prod = ground truth, read 2026-07-20)

10 buckets. Settings mirror prod exactly — do not "correct" them here; fix in prod +
re-mirror if a value is wrong.

| Bucket | Public | Size limit | Allowed MIME types | Bucket row previously versioned? | Created by |
|---|---|---|---|---|---|
| `avatars` | ✅ true | 10 MB | 6 image types¹ | ❌ no (dashboard-only) | `20260820020000` |
| `business-banners` | ✅ true | 10 MB | 6 image types¹ | ❌ no (dashboard-only) | `20260820020000` |
| `business-logos` | ✅ true | 10 MB | 6 image types¹ | ❌ no (dashboard-only) | `20260820020000` |
| `dorm-photos` | ✅ true | 10 MB | 6 image types¹ | ❌ no (dashboard-only) | `20260820020000` |
| `marketplace-images` | ✅ true | 10 MB | 6 image types¹ | ❌ no (dashboard-only) | `20260820020000` |
| `roommate-post-photos` | ✅ true | 10 MB | 6 image types¹ | ❌ no (dashboard-only) | `20260820020000` |
| `setup-photos` | ✅ true | 10 MB | 6 image types¹ | ❌ no (dashboard-only) | `20260820020000` |
| `academic-planners` | 🔒 false | 15 MB | 6 image types¹ + `application/pdf` | ❌ no (dashboard-only) | `20260820020000` |
| `templates` | ✅ true | none | none (any type) | ❌ no (dashboard-only) | `20260820020000` |
| `listing-verifications` | 🔒 false | none | none (any type) | ✅ **yes** | `20260712220332` |

¹ `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/heic`, `image/heif`.
Byte sizes: 10 MB = `10485760`, 15 MB = `15728640`.

`academic-planners` was flipped public → private in `20260629045101` (security pass 4);
the baseline migration INSERTs it already-private to match prod.

## Policies — all previously versioned

Every `storage.objects` policy in prod was **already** in version control, so the
baseline migration adds **no** policies:

- Upload / delete / update / view policies for `avatars`, `business-banners`,
  `business-logos`, `dorm-photos`, `marketplace-images`, `roommate-post-photos`,
  `setup-photos`, `academic-planners` → `20260515044633_remote_schema.sql`
  (business update policies re-created in `20260624010000`).
- Broad "Public can view …" listing policies were **dropped** in `20260629045101`
  (public objects are served via `getPublicUrl`, which needs no SELECT policy).
- `lv_storage_insert_own` / `lv_storage_select_own_or_admin` (listing-verifications)
  → `20260712220332`.
- `templates` has **no** `storage.objects` policy in prod — it's service-role /
  dashboard managed (broadcast assets), public-read via `getPublicUrl`. Mirrored as-is.

## Drift corrected on 2026-07-20

The e2e seed's old `ensureBuckets()` helper (`scripts/e2e/seed-test-users.mjs`) listed
**11** buckets and was itself wrong:

- `dorm-setups` — **never existed** in prod (ghost).
- `dining-review-photos` — **torn down** in `20260613260000_teardown_dining_and_legacy_orphans.sql`.
- omitted `templates`, which **does** exist in prod.

Prod's real count is **10**. `ensureBuckets()` was removed once the migration covered
its job — a single source of truth for bucket definitions.
