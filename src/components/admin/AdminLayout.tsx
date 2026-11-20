import { Link, Outlet, useLocation, useNavigate, Navigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, BarChart3, Building2, Eye, Flag, History, Megaphone, ShieldCheck, Users, ExternalLink, type LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminUniversitySilo } from "@/contexts/AdminUniversityContext";
import { useProfileIdentity } from "@/hooks/useProfileIdentity";
import { getInitials, resolveDisplayName } from "@/lib/identity";
import { getUniversityById } from "@/config/universities";
import { cn } from "@/lib/utils";

/**
 * Admin console shell: persistent left sidebar wrapping every /admin* route
 * (wired as a layout route in `AdminRoutes`). Web-only, desktop-shaped; below
 * `md` the nav renders as a horizontal strip so admin pages stay reachable on
 * a narrow window. Admin routes opt out of the student app chrome
 * (GlobalTopNav / AppSidebar / BottomNav) in `App.tsx`, so this component owns
 * the whole viewport.
 */

type AdminNavEntry = {
  label: string;
  to: string;
  icon: LucideIcon;
  match: (pathname: string) => boolean;
  /** Superadmin-only nav item (matches the RequireSuperAdmin route guard). */
  superAdminOnly?: boolean;
};

const NAV: AdminNavEntry[] = [
  {
    label: "Overview",
    to: "/admin/dashboard",
    icon: BarChart3,
    match: (p) => p === "/admin/dashboard",
  },
  {
    label: "Reports Queue",
    to: "/admin/reports",
    icon: Flag,
    match: (p) => p.startsWith("/admin/reports"),
    // Moderation is DormCheck's job, not a university_admin's: the automated
    // pipeline runs on the superadmin side, so the queue is superadmin-only.
    superAdminOnly: true,
  },
  {
    label: "Team",
    to: "/admin/team",
    icon: Users,
    match: (p) => p.startsWith("/admin/team"),
  },
  {
    label: "Activity",
    to: "/admin/activity",
    icon: History,
    match: (p) => p.startsWith("/admin/activity"),
  },
  {
    label: "Manage Dorms",
    to: "/admin/dorms",
    icon: Building2,
    match: (p) => p.startsWith("/admin/dorms"),
    // Any admin tier: a university_admin sees/edits only their own school's
    // dorms (master_housing RLS scopes to current_university_id()).
  },
  {
    label: "Ads",
    to: "/admin/ads",
    icon: Megaphone,
    match: (p) => p.startsWith("/admin/ads"),
    superAdminOnly: true,
  },
  {
    label: "Platform",
    to: "/admin/platform",
    icon: ShieldCheck,
    match: (p) => p.startsWith("/admin/platform"),
    superAdminOnly: true,
  },
  {
    label: "Broadcast",
    to: "/admin/broadcast",
    icon: Megaphone,
    match: (p) => p.startsWith("/admin/broadcast"),
    // Any admin tier: a university_admin broadcasts only to their own school
    // (server-enforced in api/admin/broadcast.ts); superadmins pick any audience.
  },
];

function usePendingReportsCount(enabled: boolean, isSuperAdmin: boolean, siloId: string | null) {
  const { data: count = 0 } = useQuery({
    queryKey: ["admin-pending-reports-count", siloId],
    queryFn: async (): Promise<number> => {
      // Chat-link reports resolve their school through the parent link; a
      // superadmin's silo filters explicitly, a university_admin is already
      // scoped by the parent's tenant RLS.
      const chatQuery =
        isSuperAdmin && siloId
          ? supabase
              .from("building_chat_link_reports")
              .select("id, building_chat_links!inner(university_id)", { count: "exact", head: true })
              .eq("building_chat_links.university_id", siloId)
          : supabase.from("building_chat_link_reports").select("*", { count: "exact", head: true });
      // content_reports has no university column; the RPC resolves each
      // report's school through its content and clamps non-superadmins
      // server-side, so its row count IS the silo count for both tiers.
      const [chatRes, contentRes] = await Promise.all([
        chatQuery,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC param not yet in generated types (migration 20260728000000)
        (supabase as any).rpc("get_content_reports", {
          content_type_filter: null,
          p_university_id: isSuperAdmin ? siloId : null,
        }),
      ]);
      if (chatRes.error) throw chatRes.error;
      if (contentRes.error) throw contentRes.error;
      return (chatRes.count ?? 0) + ((contentRes.data as unknown[] | null)?.length ?? 0);
    },
    enabled,
    staleTime: 30_000,
  });
  return count;
}

function NavItem({
  entry,
  active,
  badge,
}: {
  entry: AdminNavEntry;
  active: boolean;
  badge?: number;
}) {
  const Icon = entry.icon;
  return (
    <Link
      to={entry.to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1",
        active ? "bg-malachite-50 text-malachite-800" : "text-stone-600 hover:bg-stone-100",
      )}
    >
      <Icon className={cn("h-[18px] w-[18px]", active ? "text-malachite-600" : "text-stone-500")} aria-hidden />
      <span className="flex-1">{entry.label}</span>
      {typeof badge === "number" && badge > 0 && (
        <span
          className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700"
          aria-label={`${badge} pending`}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}

export default function AdminLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, isLoading, isAdmin, isSuperAdmin, profileLoaded } = useAuth();
  const { siloUniversityId, viewAs, setViewAs, effectiveIsSuperAdmin } = useAdminUniversitySilo();
  const { fullName } = useProfileIdentity();
  // Data (badge counts) stays on the REAL role; only the chrome below reads
  // the effective (view-as) flags.
  const pendingReports = usePendingReportsCount(!!isAdmin, isSuperAdmin, siloUniversityId);
  const nav = NAV.filter((entry) => effectiveIsSuperAdmin || !entry.superAdminOnly);
  // The console is one school at a time: a superadmin's picked silo, or a
  // university_admin's own school (same value - the context derives it).
  const scopeLabel = getUniversityById(siloUniversityId ?? "")?.name ?? "";

  // profileLoaded: isAdmin arrives after the session (own-row profiles fetch);
  // deciding before it lands would bounce real admins to "/".
  if (isLoading || !profileLoaded) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-muted-foreground">Loading…</div>
    );
  }
  if (!user || !isAdmin) {
    return <Navigate to="/" replace />;
  }

  const email = user.email ?? "";
  const displayName = resolveDisplayName(fullName ?? undefined, email);
  const initials = getInitials(displayName);

  return (
    <div className="flex min-h-screen w-full flex-col bg-stone-50 md:flex-row">
      <aside className="flex flex-col border-b border-stone-200 bg-white md:fixed md:inset-y-0 md:left-0 md:z-[900] md:w-[248px] md:border-b-0 md:border-r print:hidden">
        <div className="px-5 pb-2 pt-5">
          <Link
            to="/admin/dashboard"
            className="flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1"
          >
            <img src="/dormcheck-logo-new.png" alt="" className="h-7 w-7" aria-hidden />
            <span className="brand-wordmark text-lg">DormCheck</span>
          </Link>
          {scopeLabel && (
            <p className="mt-1 text-xs font-semibold text-stone-500">{scopeLabel}</p>
          )}
          {effectiveIsSuperAdmin && (
            <Link
              to="/admin/universities"
              className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-malachite-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
              Switch school
            </Link>
          )}
        </div>

        <nav aria-label="Admin" className="flex flex-row gap-0.5 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
          {nav.map((entry) => (
            <NavItem
              key={entry.to}
              entry={entry}
              active={entry.match(pathname)}
              badge={entry.to === "/admin/reports" ? pendingReports : undefined}
            />
          ))}
        </nav>

        <div className="hidden border-t border-stone-200 px-3 pb-4 pt-3 md:mt-auto md:block">
          {isSuperAdmin && (
            <fieldset className="mb-2 px-2.5">
              <legend className="flex items-center gap-1.5 pb-1 text-[11px] font-bold uppercase tracking-wide text-stone-400">
                <Eye className="h-3.5 w-3.5" aria-hidden />
                View as
              </legend>
              <div className="flex gap-1" role="radiogroup" aria-label="View the app as">
                {(
                  [
                    { value: "superadmin", label: "Superadmin" },
                    { value: "university_admin", label: "Univ. admin" },
                    { value: "user", label: "Student" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={viewAs === opt.value}
                    onClick={() => {
                      setViewAs(opt.value);
                      // The admin console isn't a student surface - previewing
                      // as a student starts where a student starts.
                      if (opt.value === "user") navigate("/my-home");
                    }}
                    className={cn(
                      "flex-1 rounded-lg border px-1.5 py-1 text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1",
                      viewAs === opt.value
                        ? "border-malachite-600 bg-malachite-50 text-malachite-800"
                        : "border-stone-200 bg-white text-stone-500 hover:bg-stone-100",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-gradient-to-br from-malachite-500 to-malachite-700 text-sm font-extrabold text-white">
              {initials}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-extrabold text-stone-900">{displayName}</span>
              <span className="block truncate text-xs font-semibold text-stone-500">{email}</span>
            </span>
            <span className="ml-auto inline-flex flex-none items-center rounded-full bg-malachite-50 px-2 py-0.5 text-[11px] font-bold text-malachite-800">
              Admin
            </span>
          </div>
          <Link
            to="/my-home"
            className="mt-1 flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-bold text-stone-600 transition-colors hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1"
          >
            <ExternalLink className="h-4 w-4 text-stone-500" aria-hidden />
            View student app
          </Link>
        </div>
      </aside>

      {/* LayoutWrapper already provides the page's <main id="main-content">; this is inner layout only. */}
      <div className="min-w-0 flex-1 md:pl-[248px] print:pl-0">
        <Outlet />
      </div>
    </div>
  );
}
