import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, ExternalLink, Loader2, Mail, Megaphone, XCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { logAdminAction } from '@/lib/adminAudit';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getUniversityById } from '@/config/universities';
import { PageContainer } from '@/components/ui/page-container';

/* eslint-disable @typescript-eslint/no-explicit-any -- advertiser tables not yet in generated types (migration 20260713010000) */

type PendingCampaign = {
  id: string;
  name: string;
  university_id: string;
  start_date: string | null;
  end_date: string | null;
  targeting: { class_years?: number[] } | null;
  created_at: string;
  advertiser: { business_name: string; website: string | null; contact_email: string } | null;
  creative: {
    image_url: string | null;
    headline: string;
    body: string | null;
    cta_text: string;
    cta_url: string;
  } | null;
};

/**
 * Ads review (P1.10, superadmin): manual human review of every campaign
 * against the content policy before it runs, plus advertiser invitations
 * (the only way a business email can register - see advertiser_invitations
 * and the signup-gate exception in migration 20260713010000).
 *
 * Content policy (v1, enforced by this review):
 *  - Housing ads must respect fair-housing rules; no discriminatory targeting
 *    or copy. DormCheck is an extension of campus systems, never positioned
 *    against them.
 *  - Nothing that charges students to use DormCheck itself; no alcohol,
 *    gambling, weapons, or adult content; no misleading claims.
 *  - Links must be https and land where the ad says they land.
 */
export default function AdsReviewPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [actingId, setActingId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteBusiness, setInviteBusiness] = useState('');
  const [inviting, setInviting] = useState(false);

  const query = useQuery({
    queryKey: ['admin-ads-review'],
    queryFn: async (): Promise<PendingCampaign[]> => {
      const { data, error } = await (supabase as any)
        .from('ad_campaigns')
        .select(
          'id, name, university_id, start_date, end_date, targeting, created_at, advertiser:advertisers(business_name, website, contact_email), creative:ad_creatives(image_url, headline, body, cta_text, cta_url)',
        )
        .eq('status', 'pending_review')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PendingCampaign[];
    },
    staleTime: 15_000,
  });

  const review = async (c: PendingCampaign, status: 'approved' | 'rejected') => {
    if (!user?.id || actingId) return;
    let note: string | null = null;
    if (status === 'rejected') {
      note = window.prompt('Reason shown to the advertiser:')?.trim() || null;
      if (!note) return;
    }
    setActingId(c.id);
    try {
      const { error } = await (supabase as any)
        .from('ad_campaigns')
        .update({
          status,
          review_note: note,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', c.id);
      if (error) throw error;
      await logAdminAction(`ad_campaign.${status === 'approved' ? 'approve' : 'reject'}`, 'ad_campaign', c.id, c.university_id);
      await queryClient.invalidateQueries({ queryKey: ['admin-ads-review'] });
      toast(status === 'approved' ? 'Campaign approved' : 'Campaign rejected');
    } catch (err) {
      toast.error('Could not save decision', { description: (err as Error).message });
    } finally {
      setActingId(null);
    }
  };

  const invite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || inviting) return;
    setInviting(true);
    try {
      const { error } = await (supabase as any).from('advertiser_invitations').insert({
        email,
        business_name: inviteBusiness.trim() || null,
        invited_by: user?.id ?? null,
      });
      if (error) throw error;
      await logAdminAction('advertiser.invite', 'advertiser_invitation', null, null);
      setInviteEmail('');
      setInviteBusiness('');
      toast.success('Advertiser invited', {
        description: `Send them dormcheck.com/auth to sign up with ${email}, then dormcheck.com/advertise.`,
      });
    } catch (err) {
      toast.error('Could not invite', { description: (err as Error).message });
    } finally {
      setInviting(false);
    }
  };

  const rows = query.data ?? [];

  return (
    <div className="min-h-screen bg-background">
      <PageContainer width="wide" className="px-4 sm:px-6 py-6 pb-16 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-malachite-600/15 flex items-center justify-center shrink-0">
            <Megaphone className="w-5 h-5 text-malachite-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Ads</h1>
            <p className="text-sm text-muted-foreground">
              Every campaign is human-reviewed against the content policy before it runs.
            </p>
          </div>
        </div>

        {/* Invite an advertiser */}
        <section className="rounded-xl border border-border bg-card p-4 shadow-raised space-y-3">
          <p className="text-sm font-semibold text-foreground">Invite an advertiser</p>
          <p className="text-xs text-muted-foreground">
            Invitations are the only way a business email can create an account. The .edu signup
            gate stays closed for everyone else.
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr,1fr,auto]">
            <div>
              <Label htmlFor="adv-inv-email" className="sr-only">Business email</Label>
              <Input
                id="adv-inv-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="owner@business.com"
              />
            </div>
            <div>
              <Label htmlFor="adv-inv-name" className="sr-only">Business name</Label>
              <Input
                id="adv-inv-name"
                value={inviteBusiness}
                onChange={(e) => setInviteBusiness(e.target.value)}
                placeholder="Business name (optional)"
                maxLength={120}
              />
            </div>
            <Button onClick={invite} disabled={inviting || !inviteEmail.trim()} className="bg-malachite-800 hover:bg-malachite-900">
              {inviting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Mail className="h-4 w-4 mr-1.5" />}
              Invite
            </Button>
          </div>
        </section>

        {/* Review queue */}
        <section className="rounded-xl border border-border bg-card shadow-raised overflow-hidden">
          {query.isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading campaigns" />
            </div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              No campaigns waiting for review.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((c) => (
                <li key={c.id} className="px-4 py-4 space-y-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">
                      {c.name}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {c.advertiser?.business_name} · {getUniversityById(c.university_id)?.shortName ?? 'Unknown school'}
                      </span>
                    </p>
                    <time className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                    </time>
                  </div>
                  {c.creative ? (
                    <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                      <p className="font-medium text-foreground">{c.creative.headline}</p>
                      {c.creative.body && <p className="text-muted-foreground">{c.creative.body}</p>}
                      <a
                        href={c.creative.cta_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-xs text-malachite-800 underline-offset-2 hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" aria-hidden />
                        {c.creative.cta_text} → {c.creative.cta_url}
                      </a>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No creative attached.</p>
                  )}
                  {(c.targeting?.class_years?.length ?? 0) > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Targets class years {c.targeting!.class_years!.join(', ')}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => void review(c, 'approved')}
                      disabled={actingId !== null}
                      className="bg-malachite-800 hover:bg-malachite-900"
                    >
                      {actingId === c.id ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                      ) : (
                        <BadgeCheck className="h-4 w-4 mr-1.5" />
                      )}
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void review(c, 'rejected')}
                      disabled={actingId !== null}
                      className="text-destructive border-destructive/40 hover:bg-destructive/5 hover:text-destructive"
                    >
                      <XCircle className="h-4 w-4 mr-1.5" />
                      Reject
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </PageContainer>
    </div>
  );
}
