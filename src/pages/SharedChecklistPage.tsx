import { useMemo } from "react";
import { useParams } from "react-router";
import { Loader2, ExternalLink, LinkIcon, Hand, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  useSharedChecklist,
  useSetSharedItemStatus,
  type SharedChecklistItem,
} from "@/hooks/useChecklistShareLink";
import { isSafeHttpUrl } from "@/lib/amazonAffiliateUrl";
import { buildAffiliateUrl } from "@/lib/products/provider";
import { PageContainer } from "@/components/ui/page-container";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Public guest view of one group's move-in checklist, reached via a family
 * share link (/checklist/shared/:token). No account, no login wall: the token
 * (an unguessable uuid) scopes an anon SECURITY DEFINER RPC to this one
 * checklist, read + check-off only. Rendered outside AppLayout with no app
 * chrome; a parent lands here from a text message, sees the list, and marks
 * what they bought. The student's app updates live via existing realtime.
 */
export default function SharedChecklistPage() {
  const { token } = useParams<{ token: string }>();
  const validToken = !!token && UUID_REGEX.test(token.trim());
  const { data, isLoading, isError, refetch } = useSharedChecklist(validToken ? token : undefined);
  const setStatus = useSetSharedItemStatus(token);

  const sections = useMemo(() => {
    const byCategory = new Map<string, SharedChecklistItem[]>();
    for (const item of data?.items ?? []) {
      const key = item.category?.trim() || "Other";
      const list = byCategory.get(key) ?? [];
      list.push(item);
      byCategory.set(key, list);
    }
    return [...byCategory.entries()];
  }, [data?.items]);

  const boughtCount = (data?.items ?? []).filter((i) => i.status !== "need").length;
  const totalCount = data?.items.length ?? 0;

  const header = (
    <header className="bg-malachite-800 px-4 pb-6 pt-[max(1.5rem,env(safe-area-inset-top))] text-white">
      <PageContainer width="narrow">
        <p className="brand-wordmark text-sm text-white">DormCheck</p>
        {data ? (
          <>
            <h1 className="mt-1 text-xl font-bold">
              {data.owner_first_name
                ? `${data.owner_first_name}'s move-in list`
                : data.group_name || "Move-in list"}
            </h1>
            <p className="mt-1 text-sm text-malachite-100">
              Shared with you. {data.can_check ? "Tap what you've got covered." : "View only."}
            </p>
          </>
        ) : (
          <h1 className="mt-1 text-xl font-bold">Move-in list</h1>
        )}
      </PageContainer>
    </header>
  );

  // Only a definitive null result means the link is dead; a failed fetch gets
  // a retry so a flaky connection never reads as "revoked" to a parent.
  if (!validToken || (!isLoading && !isError && !data)) {
    return (
      <div className="min-h-screen bg-background">
        {header}
        <PageContainer as="main" width="narrow" className="px-4 py-10">
          <Card className="rounded-xl border-border p-6 text-center">
            <p className="text-base font-semibold text-foreground">This link is no longer active</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Ask the person who sent it for a new link.
            </p>
          </Card>
        </PageContainer>
      </div>
    );
  }

  if (isError && !data) {
    return (
      <div className="min-h-screen bg-background">
        {header}
        <PageContainer as="main" width="narrow" className="px-4 py-10">
          <Card className="rounded-xl border-border p-6 text-center">
            <p className="text-base font-semibold text-foreground">Could not load the checklist</p>
            <p className="mt-2 text-sm text-muted-foreground">Check your connection and try again.</p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-4 rounded-xl bg-malachite-800 px-4 py-2 text-sm font-medium text-white hover:bg-malachite-900"
            >
              Try again
            </button>
          </Card>
        </PageContainer>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        {header}
        <main className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label="Loading checklist" />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-[max(2rem,env(safe-area-inset-bottom))]">
      {header}
      <PageContainer as="main" width="narrow" className="px-4 py-5">
        {totalCount > 0 && (
          <p className="mb-4 text-sm text-muted-foreground">
            {boughtCount} of {totalCount} items handled
          </p>
        )}
        {totalCount === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/50 p-6 text-center">
            <p className="text-sm text-muted-foreground">Nothing on this list yet.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {sections.map(([category, items]) => (
              <section key={category}>
                <h2 className="mb-2 text-sm font-semibold text-foreground">{category}</h2>
                <ul className="space-y-2">
                  {items.map((item) => {
                    const bought = item.status !== "need";
                    const canClaim = !!data!.can_check;
                    return (
                      <li
                        key={item.id}
                        className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 shadow-raised"
                      >
                        <div className="min-w-0 flex-1">
                          <p
                            className={
                              bought
                                ? "text-sm font-medium text-muted-foreground line-through"
                                : "text-sm font-medium text-foreground"
                            }
                          >
                            {item.item}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            {item.status === "packed" && (
                              <Badge variant="secondary" className="text-xs">Packed</Badge>
                            )}
                            {/* Read-only viewers (no claim button) still see a Bought badge. */}
                            {!canClaim && item.status === "bought" && (
                              <Badge className="bg-malachite-800 text-xs text-white hover:bg-malachite-800">
                                Bought
                              </Badge>
                            )}
                            {typeof item.estimated_price === "number" && item.estimated_price > 0 && (
                              <span className="text-xs text-muted-foreground">
                                About ${item.estimated_price.toFixed(2)}
                              </span>
                            )}
                            {item.assignee_name && (
                              <span className="text-xs text-muted-foreground">
                                For {item.assignee_name}
                              </span>
                            )}
                          </div>
                          {isSafeHttpUrl(item.link) && (
                            <a
                              href={buildAffiliateUrl(item.link)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1.5 inline-flex items-center gap-1 text-sm font-medium text-malachite-800 underline-offset-2 hover:underline"
                            >
                              <LinkIcon className="h-3.5 w-3.5" aria-hidden />
                              <span className="truncate">{item.link_title || "View product"}</span>
                              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                            </a>
                          )}
                        </div>
                        {canClaim && (
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            {bought ? (
                              <>
                                <span className="inline-flex items-center gap-1 rounded-full bg-malachite-800 px-2.5 py-1 text-xs font-semibold text-white">
                                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                                  You've got this
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setStatus.mutate({ itemId: item.id, status: "need" })
                                  }
                                  disabled={setStatus.isPending}
                                  className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-60"
                                >
                                  Undo
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  setStatus.mutate({ itemId: item.id, status: "bought" })
                                }
                                disabled={setStatus.isPending}
                                className="inline-flex items-center gap-1.5 rounded-full bg-malachite-800 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-malachite-900 disabled:opacity-60"
                                aria-label={`I've got ${item.item}`}
                              >
                                <Hand className="h-4 w-4" strokeWidth={2} aria-hidden />
                                I've got this
                              </button>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
        <p className="mt-8 text-center text-xs text-muted-foreground">
          Shared from DormCheck, the move-in checklist for college students.
        </p>
      </PageContainer>
    </div>
  );
}
