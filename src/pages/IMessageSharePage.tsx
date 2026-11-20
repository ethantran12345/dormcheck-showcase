import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Send, Users, Home } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { dormSlugFromName } from "@/lib/dormSlug";
import { PageContainer } from "@/components/ui/page-container";

/**
 * Share UI for the native iMessage app extension.
 *
 * Loaded by MessagesViewController (ios/App/MessagesExtension) inside a
 * WKWebView at /imessage?imessage=1. It hands a dormcheck.com URL to the native
 * side via window.webkit.messageHandlers.dormcheck.postMessage, which composes
 * the MSMessage bubble (MSMessageTemplateLayout) and inserts it into the
 * conversation. The native side only accepts https dormcheck.com URLs.
 *
 * Two layers:
 *   1. Authenticated pick-lists. The extension reads the host app's Supabase
 *      session from the shared Keychain group and calls window.__dcSetSession
 *      (see MessagesViewController.injectSharedSessionIfAvailable). We restore
 *      the session and let the user tap one of their OWN roommate-group invites
 *      or saved dorms - no copy/paste. Only entities with a canonical URL are
 *      offered (roommate invites -> /roommates/invite/<code>, saved dorms ->
 *      /campus/<slug>). Marketplace listings have no public detail route yet, so
 *      they are intentionally not a pick-list (paste still works for any link).
 *   2. Paste fallback. Signed out (or nothing to pick), the user pastes an
 *      invite link/code or a dormcheck.com URL they already hold.
 *
 * Outside the extension (plain web visit) the bridge is absent and the page
 * renders a short explainer instead.
 */

declare global {
  interface Window {
    /** Native -> web session handoff (see MessagesViewController). */
    __dcSetSession?: (accessToken: string, refreshToken: string) => void;
    /** Session injected before the page mounted; drained on mount. */
    __dcPendingSession?: { access: string; refresh: string };
  }
}

// Same static brand image index.html uses for og:image; a dedicated share
// card can replace it when the link-previews (OG) work ships.
const SHARE_CARD_IMAGE = "https://dormcheck.com/dormcheck-logo-new.png";

type SharePick = { id: string; label: string; sublabel?: string; url: string };

/** Accepts a full invite URL or a bare code; returns the canonical invite URL, or null. */
export function normalizeInviteInput(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const urlMatch = value.match(
    /^https:\/\/(?:www\.)?dormcheck\.com\/roommates\/invite\/([A-Za-z0-9-]+)$/,
  );
  if (urlMatch) return `https://dormcheck.com/roommates/invite/${urlMatch[1]}`;
  if (/^[A-Za-z0-9-]{4,64}$/.test(value)) {
    return `https://dormcheck.com/roommates/invite/${value}`;
  }
  return null;
}

/** Accepts a full dormcheck.com URL (e.g. a marketplace listing) and returns it, or null. */
export function normalizeListingInput(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (host !== "dormcheck.com" && host !== "www.dormcheck.com") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export default function IMessageSharePage() {
  const bridge = useMemo(() => window.webkit?.messageHandlers?.dormcheck, []);
  const [mode, setMode] = useState<"invite" | "listing">("invite");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [authed, setAuthed] = useState(false);
  const [groups, setGroups] = useState<SharePick[]>([]);
  const [dorms, setDorms] = useState<SharePick[]>([]);

  const share = useCallback(
    (url: string, title: string) => {
      if (!bridge) return;
      bridge.postMessage({ action: "sendMessage", url, title, imageURL: SHARE_CARD_IMAGE });
    },
    [bridge],
  );

  // Load the signed-in user's own shareable entities (RLS scopes to them).
  const loadUserData = useCallback(async (userId: string) => {
    try {
      const { data: memberships } = await supabase
        .from("ranking_group_members")
        .select("group_id")
        .eq("user_id", userId)
        .eq("status", "accepted");
      const groupIds = [...new Set((memberships ?? []).map((m) => String(m.group_id)))];
      let groupPicks: SharePick[] = [];
      if (groupIds.length) {
        const { data: gs } = await supabase
          .from("ranking_collaborations")
          .select("id, group_name, dorm_name, invite_code")
          .in("id", groupIds)
          .eq("group_type", "roommate")
          .order("created_at", { ascending: false });
        groupPicks = (gs ?? [])
          .filter((g) => g.invite_code)
          .map((g) => ({
            id: String(g.id),
            label: (g.group_name as string | null) || (g.dorm_name as string | null) || "Roommate group",
            sublabel: g.group_name && g.dorm_name ? (g.dorm_name as string) : undefined,
            url: `https://dormcheck.com/roommates/invite/${g.invite_code}`,
          }));
      }
      setGroups(groupPicks);
    } catch {
      setGroups([]);
    }

    try {
      const { data: saved } = await supabase
        .from("saved_dorms")
        .select("dorm_id")
        .eq("user_id", userId);
      const dormIds = [...new Set((saved ?? []).map((s) => s.dorm_id))];
      let dormPicks: SharePick[] = [];
      if (dormIds.length) {
        const { data: mh } = await supabase
          .from("master_housing")
          .select("id, residence_hall")
          .in("id", dormIds);
        dormPicks = (mh ?? [])
          .filter((d) => d.residence_hall)
          .map((d) => ({
            id: String(d.id),
            label: d.residence_hall as string,
            url: `https://dormcheck.com/campus/${dormSlugFromName(d.residence_hall as string)}`,
          }));
      }
      setDorms(dormPicks);
    } catch {
      setDorms([]);
    }
  }, []);

  // Native -> web session handoff, plus a re-open path (session already persisted).
  useEffect(() => {
    let cancelled = false;
    const apply = async (accessToken: string, refreshToken: string) => {
      try {
        const { data, error: setErr } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (cancelled || setErr || !data.session) return;
        setAuthed(true);
        await loadUserData(data.session.user.id);
      } catch {
        /* stay on paste fallback */
      }
    };

    window.__dcSetSession = (a, r) => {
      void apply(a, r);
    };

    const pending = window.__dcPendingSession;
    if (pending?.access && pending?.refresh) {
      window.__dcPendingSession = undefined;
      void apply(pending.access, pending.refresh);
    } else {
      // Re-open: the extension WebView may still hold a persisted session.
      void supabase.auth.getSession().then(({ data }) => {
        if (!cancelled && data.session) {
          setAuthed(true);
          void loadUserData(data.session.user.id);
        }
      });
    }

    return () => {
      cancelled = true;
      delete window.__dcSetSession;
    };
  }, [loadUserData]);

  const handleSend = () => {
    setError("");
    if (!bridge) return;
    if (mode === "invite") {
      const url = normalizeInviteInput(input);
      if (!url) {
        setError("That does not look like a DormCheck invite link or code.");
        return;
      }
      share(url, "Join my roommate group on DormCheck");
    } else {
      const url = normalizeListingInput(input);
      if (!url) {
        setError("Paste a full dormcheck.com link, like a marketplace listing.");
        return;
      }
      share(url, "Check this out on DormCheck");
    }
    setInput("");
  };

  if (!bridge) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-background p-6">
        <div className="max-w-md space-y-2 text-center">
          <h1 className="text-xl font-bold text-foreground">Share on iMessage</h1>
          <p className="text-sm text-muted-foreground">
            This page powers the DormCheck iMessage app. Open Messages on your
            iPhone, tap the DormCheck icon in the app drawer, and share an invite
            or listing from there.
          </p>
        </div>
      </div>
    );
  }

  const hasPicks = authed && (groups.length > 0 || dorms.length > 0);

  return (
    <div className="min-h-full bg-background p-4">
      <PageContainer width="narrow" className="space-y-4">
        {hasPicks && (
          <>
            {groups.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Users className="h-4 w-4 text-malachite-600" aria-hidden="true" />
                    Your roommate groups
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {groups.map((g) => (
                    <Button
                      key={g.id}
                      variant="outline"
                      className="h-auto w-full justify-start whitespace-normal py-2 text-left"
                      data-testid={`imessage-pick-group-${g.id}`}
                      onClick={() => share(g.url, `Join my roommate group on DormCheck`)}
                    >
                      <Send className="mr-2 h-4 w-4 shrink-0 text-malachite-600" aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{g.label}</span>
                        {g.sublabel && (
                          <span className="block truncate text-xs text-muted-foreground">{g.sublabel}</span>
                        )}
                      </span>
                    </Button>
                  ))}
                </CardContent>
              </Card>
            )}

            {dorms.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Home className="h-4 w-4 text-malachite-600" aria-hidden="true" />
                    Your saved dorms
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {dorms.map((d) => (
                    <Button
                      key={d.id}
                      variant="outline"
                      className="h-auto w-full justify-start whitespace-normal py-2 text-left"
                      data-testid={`imessage-pick-dorm-${d.id}`}
                      onClick={() => share(d.url, `Check out ${d.label} on DormCheck`)}
                    >
                      <Send className="mr-2 h-4 w-4 shrink-0 text-malachite-600" aria-hidden="true" />
                      <span className="block min-w-0 truncate font-medium">{d.label}</span>
                    </Button>
                  ))}
                </CardContent>
              </Card>
            )}

            <p className="px-1 text-center text-xs text-muted-foreground">Or paste a link</p>
          </>
        )}

        <div className="flex gap-2" role="tablist" aria-label="What to share">
          <Button
            role="tab"
            aria-selected={mode === "invite"}
            variant={mode === "invite" ? "default" : "outline"}
            className={mode === "invite" ? "flex-1 bg-malachite-800 hover:bg-malachite-900" : "flex-1"}
            onClick={() => {
              setMode("invite");
              setError("");
            }}
          >
            Roommate invite
          </Button>
          <Button
            role="tab"
            aria-selected={mode === "listing"}
            variant={mode === "listing" ? "default" : "outline"}
            className={mode === "listing" ? "flex-1 bg-malachite-800 hover:bg-malachite-900" : "flex-1"}
            onClick={() => {
              setMode("listing");
              setError("");
            }}
          >
            Listing link
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {mode === "invite" ? "Share a roommate invite" : "Share a DormCheck link"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {mode === "invite"
                ? "Paste your group's invite link or code from the DormCheck app."
                : "Paste a dormcheck.com link, like a marketplace listing."}
            </p>
            <label htmlFor="imessage-share-input" className="sr-only">
              {mode === "invite" ? "Invite link or code" : "DormCheck link"}
            </label>
            <Input
              id="imessage-share-input"
              data-testid="imessage-share-input"
              placeholder={
                mode === "invite"
                  ? "Invite link or code"
                  : "https://dormcheck.com/..."
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
            />
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button
              className="w-full bg-malachite-800 hover:bg-malachite-900"
              onClick={handleSend}
              data-testid="imessage-share-send"
            >
              <Send className="mr-2 h-4 w-4" />
              Add to message
            </Button>
          </CardContent>
        </Card>
      </PageContainer>
    </div>
  );
}
