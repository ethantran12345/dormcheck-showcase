import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Bell, MessageSquare } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDistanceToNow } from "date-fns";
import { useChat } from "@/contexts/ChatContext";
import { useNotifications } from "@/hooks/useNotifications";
import { cn } from "@/lib/utils";

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
}

/**
 * Top-nav notifications bell (desktop app shell, md+ only - see TopNav).
 * Real notifications come from the `notifications` table via useNotifications;
 * unread messages don't write notification rows, so that signal stays
 * synthesized from ChatContext as a single entry.
 */
export function NotificationsBell() {
  const { t } = useTranslation();
  const { hasUnreadMessages, unreadCount } = useChat();
  const { notifications, unreadNotificationCount, markAllRead } = useNotifications();

  const badgeCount = unreadCount + unreadNotificationCount;
  const badgeLabel = badgeCount > 9 ? "9+" : String(badgeCount);
  const hasAny = hasUnreadMessages || notifications.length > 0;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={
                badgeCount > 0
                  ? t("misc:notifications.withCount", { n: badgeCount })
                  : t("misc:notifications.title")
              }
              className={cn(
                "relative inline-flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1",
              )}
            >
              <Bell className="h-5 w-5" aria-hidden />
              {badgeCount > 0 && (
                <span
                  aria-hidden
                  // KEEP: the single unread-count indicator for the app shell
                  className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-malachite-800 px-1 text-[10px] font-extrabold leading-none text-white ring-2 ring-white"
                >
                  {badgeLabel}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {badgeCount > 0
            ? t("misc:notifications.tooltipWithCount", { n: badgeLabel })
            : t("misc:notifications.title")}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-sm font-extrabold text-foreground">{t("misc:notifications.title")}</span>
          <button
            type="button"
            onClick={() => markAllRead()}
            className="rounded text-xs font-bold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600" // KEEP: interaction-only focus ring
          >
            {t("misc:notifications.markAllRead")}
          </button>
        </div>
        <DropdownMenuSeparator className="my-0" />
        {hasAny ? (
          <div className="max-h-80 overflow-y-auto py-1">
            {hasUnreadMessages && (
              <DropdownMenuItem asChild>
                <Link to="/messages" className="flex cursor-pointer items-start gap-2.5 px-3 py-2.5">
                  <span className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-full bg-muted">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className="min-w-0 leading-snug">
                    <span className="block text-sm font-bold text-foreground">
                      {unreadCount > 0
                        ? t("misc:notifications.unreadMessages", { count: unreadCount })
                        : t("misc:notifications.unreadFallback")}
                    </span>
                    <span className="block text-xs font-semibold text-muted-foreground">
                      {t("misc:notifications.openToCatch")}
                    </span>
                  </span>
                </Link>
              </DropdownMenuItem>
            )}
            {notifications.map((n) => (
              <DropdownMenuItem key={n.id} asChild>
                <Link to={n.to} className="flex cursor-pointer items-start gap-2.5 px-3 py-2.5">
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1.5 h-2 w-2 flex-none rounded-full",
                      n.read ? "bg-transparent" : "bg-foreground",
                    )}
                  />
                  <span className="min-w-0 leading-snug">
                    <span
                      className={cn(
                        "block text-sm text-foreground",
                        n.read ? "font-semibold" : "font-bold",
                      )}
                    >
                      {n.title}
                    </span>
                    {n.body && (
                      <span className="block text-xs font-semibold text-muted-foreground">{n.body}</span>
                    )}
                    <span className="block text-xs font-medium text-muted-foreground">
                      {relativeTime(n.createdAt)}
                    </span>
                  </span>
                </Link>
              </DropdownMenuItem>
            ))}
          </div>
        ) : (
          <div className="px-3 py-6 text-center text-sm font-semibold text-muted-foreground">
            {t("misc:notifications.allCaughtUp")}
          </div>
        )}
        <DropdownMenuSeparator className="my-0" />
        <DropdownMenuItem asChild>
          <Link
            to="/messages"
            className="flex cursor-pointer justify-center px-3 py-2.5 text-sm font-bold text-foreground"
          >
            {t("misc:notifications.showAll")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
