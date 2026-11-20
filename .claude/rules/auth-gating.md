---
description: "University-email auth gating — form + runtime + DB-trigger + API enforcement"
paths:
  - "src/**/Auth*.tsx"
  - "supabase/**"
---

# Auth gating (university email)

DormCheck is **multi-tenant, not Pitt-only**. The allowed domains come from the tenant
registry — `src/config/universities.ts` on the client (`PITT`, `CMU`; both `isActive`) and
`public.universities.email_domains` for `is_active` rows in the DB. Never hard-code
`pitt.edu`, and never fall back to a default university: a silent Pitt default is what broke
CMU sign-in on 2026-07-10, which is why `enforceUniversityEmailOrSignOut(email, university)`
takes the school as a **required** argument.

Enforced in four places — keep all four in sync:
- Auth-page **form validation** on the sign-in/sign-up forms (`src/pages/auth/Auth.tsx`).
- **Runtime** `enforceUniversityEmailOrSignOut()` / `gateUniversityEmail()` from
  `src/lib/universityAuth.ts`, called from `src/pages/auth/Auth.tsx` and `src/App.tsx`.
  `gateUniversityEmail` returns `allowed` | `advertiser` | `rejected` — invite-gated
  advertiser accounts pass the domain gate but must be routed to `/advertise`, never the
  student app.
- The **`validate_university_email()` DB trigger** — trigger `check_university_email_on_signup`,
  `BEFORE INSERT ON auth.users`. It replaced `validate_pitt_email()` /
  `check_pitt_email_on_signup` in `supabase/migrations/20260710055958_generalize_email_gate.sql`;
  the old names no longer exist.
  <!-- docs-drift-ignore: validate_pitt_email, check_pitt_email_on_signup -->
- **Server-side** `isAllowedEmailDomain()` in `api/_lib/auth.ts` (checks the
  `ALLOWED_EMAIL_DOMAINS` array). The API bundle builds separately from `src/` and cannot
  import the registry, so this list is a hand-synced mirror.

Supabase email confirmation is required. OAuth and magic links use `VITE_SITE_URL` as
`redirectTo`, never a hardcoded domain. `AuthProvider` (`src/hooks/useAuth.tsx`) wraps
`onAuthStateChange`, bootstraps `profiles`, and exposes `role` plus `isAdmin` /
`isUniversityAdmin` / `isSuperAdmin` derived from **`profiles.role`** (the `app_role` enum:
`user` | `university_admin` | `superadmin`). `isAdmin` is `role !== 'user'`;
`profiles.is_admin` is a derived column the `sync_is_admin_from_role` trigger keeps in sync —
never write it directly. Full detail: `docs/audits/auth-and-access.md`,
`docs/multi-university.md`.
