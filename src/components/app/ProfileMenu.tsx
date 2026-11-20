import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useRef } from "react";
import { ChevronDown, Keyboard, LogOut, Search, Settings, Shield, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useGlobalSearch } from "@/contexts/GlobalSearchContext";
import { ShortcutKeys } from "@/components/shortcuts/ShortcutKeys";
import { useShowKeyboardHints } from "@/components/shortcuts/useShowKeyboardHints";
import { useAdminUniversitySilo } from "@/contexts/AdminUniversityContext";
import { useProfileIdentity } from "@/hooks/useProfileIdentity";
import { getInitials, resolveDisplayName } from "@/lib/identity";

/**
 * Desktop app-shell top-right account entry.
 *
 * - **lg+**: a quick-nav dropdown (My Profile / Settings / Admin (gated) /
 *   Sign out) so a desktop user jumps straight to a surface without a
 *   full-page hop. Deliberately has NO "Appearance" item - theme controls live
 *   inside Settings, not this menu.
 * - **below lg** (tablet / narrow desktop shell): a plain tap through to the
 *   full-page `/account` menu, matching the native top-bar avatar so the account
 *   experience stays one consistent route where the dropdown would be cramped.
 */
export function ProfileMenu() {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  // View-as: hide admin affordances while a superadmin previews as a student.
  const { effectiveIsAdmin: isAdmin } = useAdminUniversitySilo();
  const { fullName } = useProfileIdentity();
  const navigate = useNavigate();
  const { openSearch, openShortcuts } = useGlobalSearch();
  const showHints = useShowKeyboardHints();
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Radix hands focus back to this trigger as the menu closes; opening the dialog
  // a frame later keeps that hand-back from yanking focus out of the new dialog.
  const afterMenuCloses = (open: (o: { returnFocusTo: HTMLElement | null }) => void) =>
    requestAnimationFrame(() => open({ returnFocusTo: triggerRef.current }));

  const email = user?.email ?? "";
  const displayName = resolveDisplayName(fullName ?? undefined, email);
  const initials = getInitials(displayName);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const avatar = (
    <>
      <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-muted text-xs font-extrabold text-foreground">
        {initials}
      </span>
      <span className="hidden max-w-[10rem] truncate text-sm font-bold text-foreground lg:block">
        {displayName}
      </span>
    </>
  );

  return (
    <>
      {/* Below lg: plain tap through to the full /settings page. */}
      <Link
        to="/settings"
        aria-label={t("misc:topBar.accountMenuFor", { name: displayName })}
        className="flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1 lg:hidden"
      >
        {avatar}
      </Link>

      {/* lg+: quick-nav dropdown. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            aria-label={t("misc:topBar.accountMenuFor", { name: displayName })}
            className="hidden items-center gap-1.5 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1 lg:flex"
          >
            {avatar}
            <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <div className="px-2 py-1.5 leading-tight">
            <span className="block truncate text-sm font-extrabold text-foreground">{displayName}</span>
            <span className="block truncate text-xs font-semibold text-muted-foreground">{email}</span>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/profile" className="flex cursor-pointer items-center gap-2">
              <User className="h-4 w-4" aria-hidden />
              {t("common:labels.myProfile")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/settings" className="flex cursor-pointer items-center gap-2">
              <Settings className="h-4 w-4" aria-hidden />
              {t("common:labels.settings")}
            </Link>
          </DropdownMenuItem>
          {isAdmin && (
            <DropdownMenuItem asChild>
              <Link to="/admin" className="flex cursor-pointer items-center gap-2">
                <Shield className="h-4 w-4" aria-hidden />
                {t("common:labels.admin")}
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => afterMenuCloses(openSearch)}
            className="flex cursor-pointer items-center gap-2"
          >
            <Search className="h-4 w-4" aria-hidden />
            {t("misc:search.trigger")}
            {showHints && <ShortcutKeys id="openPalette" className="ml-auto" />}
          </DropdownMenuItem>
          {showHints && (
            <DropdownMenuItem
              onSelect={() => afterMenuCloses(openShortcuts)}
              className="flex cursor-pointer items-center gap-2"
            >
              <Keyboard className="h-4 w-4" aria-hidden />
              {t("misc:shortcuts.menuItem")}
              <ShortcutKeys id="showShortcuts" className="ml-auto" />
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              void handleSignOut();
            }}
            className="flex cursor-pointer items-center gap-2 text-red-600 focus:text-red-600"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            {t("common:actions.logOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
