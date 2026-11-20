import { useState } from 'react';
import { Navigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck,
  Building2,
  Clock,
  Loader2,
  LogOut,
  Megaphone,
  Plus,
  Users,
  XCircle,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { activeUniversities } from '@/config/universities';
import { cn } from '@/lib/utils';
import { PageContainer } from '@/components/ui/page-container';

/* eslint-disable @typescript-eslint/no-explicit-any -- advertiser tables/RPCs not yet in generated types (migration 20260713010000) */

type Advertiser = {
  id: string;
  business_name: string;
  website: string | null;
  category: string | null;
};

type Campaign = {
  id: string;
  name: string;
  university_id: string;
  status: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'ended';
  start_date: string | null;
  end_date: string | null;
  targeting: { class_years?: number[] } | null;
  review_note: string | null;
  creative?: Creative | null;
};

type Creative = {
  id?: string;
  campaign_id?: string;
  image_url: string | null;
  headline: string;
  body: string | null;
  cta_text: string;
  cta_url: string;
};

const CLASS_YEARS = [2026, 2027, 2028, 2029, 2030];

const STATUS_META: Record<Campaign['status'], { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-stone-100 text-stone-700' },
  pending_review: { label: 'In review', className: 'bg-amber-50 text-amber-800' },
  approved: { label: 'Approved', className: 'bg-malachite-50 text-malachite-800' },
  rejected: { label: 'Not approved', className: 'bg-red-50 text-red-700' },
  ended: { label: 'Ended', className: 'bg-stone-100 text-stone-500' },
};

/** The exact card students see in the Student Market feed, "Sponsored" pill included. */
function SponsoredPreview({ creative, businessName }: { creative: Creative; businessName: string }) {
  return (
    <Card className="w-64 rounded-xl border-stone-200 bg-white overflow-hidden">
      <div className="relative aspect-square bg-muted">
        {creative.image_url ? (
          // eslint-disable-next-line jsx-a11y/img-redundant-alt
          <img src={creative.image_url} alt="Ad creative image" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Image preview
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-stone-900/80 px-2 py-0.5 text-[10px] font-semibold text-white">
          Sponsored
        </span>
      </div>
      <div className="space-y-1 p-3">
        <p className="text-sm font-semibold leading-tight text-foreground line-clamp-2">
          {creative.headline || 'Your headline'}
        </p>
        {creative.body && <p className="text-xs text-muted-foreground line-clamp-2">{creative.body}</p>}
        <p className="text-[11px] text-muted-foreground">{businessName}</p>
        <span className="inline-flex items-center rounded-full bg-malachite-800 px-3 py-1 text-xs font-semibold text-white">
          {creative.cta_text || 'Learn more'}
        </span>
      </div>
    </Card>
  );
}

export default function AdvertiserPortalPage() {
  const { user, isLoading } = useAuth();
  const queryClient = useQueryClient();

  const advertiserQuery = useQuery({
    queryKey: ['advertiser', user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<{ advertiser: Advertiser | null; eligible: boolean }> => {
      const { data: row } = await (supabase as any)
        .from('advertisers')
        .select('id, business_name, website, category')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (row) return { advertiser: row as Advertiser, eligible: true };
      const { data: invited } = await (supabase as any).rpc('is_advertiser_account');
      return { advertiser: null, eligible: invited === true };
    },
  });

  const advertiser = advertiserQuery.data?.advertiser ?? null;

  const campaignsQuery = useQuery({
    queryKey: ['ad-campaigns', advertiser?.id],
    enabled: !!advertiser?.id,
    queryFn: async (): Promise<Campaign[]> => {
      const { data, error } = await (supabase as any)
        .from('ad_campaigns')
        .select(
          'id, name, university_id, status, start_date, end_date, targeting, review_note, creative:ad_creatives(id, image_url, headline, body, cta_text, cta_url)',
        )
        .eq('advertiser_id', advertiser!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((c: any) => ({ ...c, creative: c.creative ?? null })) as Campaign[];
    },
  });

  const [editing, setEditing] = useState<Campaign | 'new' | null>(null);

  if (isLoading || (user && advertiserQuery.isLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading" />
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;
  if (advertiserQuery.data && !advertiserQuery.data.eligible) return <Navigate to="/my-home" replace />;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <PageContainer width="prose" className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <Megaphone className="h-5 w-5 text-malachite-800" aria-hidden />
            <div>
              <p className="text-sm font-bold text-foreground">DormCheck for Business</p>
              <p className="text-xs text-muted-foreground">
                {advertiser?.business_name ?? 'Set up your advertiser profile'}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void supabase.auth.signOut()}>
            <LogOut className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Sign out
          </Button>
        </PageContainer>
      </header>

      <PageContainer as="main" width="prose" className="space-y-6 px-4 py-6 sm:px-6">
        {!advertiser ? (
          <OnboardingForm
            onDone={() => void queryClient.invalidateQueries({ queryKey: ['advertiser'] })}
          />
        ) : editing ? (
          <CampaignEditor
            advertiser={advertiser}
            campaign={editing === 'new' ? null : editing}
            onClose={() => {
              setEditing(null);
              void queryClient.invalidateQueries({ queryKey: ['ad-campaigns'] });
            }}
          />
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-bold text-foreground">Campaigns</h1>
              <Button
                onClick={() => setEditing('new')}
                className="bg-malachite-800 hover:bg-malachite-900"
              >
                <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                New campaign
              </Button>
            </div>
            {campaignsQuery.isLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-primary" aria-label="Loading campaigns" />
              </div>
            ) : (campaignsQuery.data?.length ?? 0) === 0 ? (
              <Card className="rounded-xl border-border p-8 text-center text-sm text-muted-foreground">
                No campaigns yet. A campaign is one sponsored placement in the Student Market feed,
                reviewed by the DormCheck team before it runs.
              </Card>
            ) : (
              <ul className="space-y-3">
                {campaignsQuery.data!.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setEditing(c)}
                      className="w-full rounded-xl border border-border bg-card p-4 text-left shadow-raised transition-colors hover:bg-secondary/40"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-foreground">{c.name}</p>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-xs font-medium',
                            STATUS_META[c.status].className,
                          )}
                        >
                          {STATUS_META[c.status].label}
                        </span>
                      </div>
                      {c.status === 'rejected' && c.review_note && (
                        <p className="mt-1 text-xs text-red-700">{c.review_note}</p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </PageContainer>
    </div>
  );
}

function OnboardingForm({ onDone }: { onDone: () => void }) {
  const { user } = useAuth();
  const [businessName, setBusinessName] = useState('');
  const [website, setWebsite] = useState('');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!user?.id || !businessName.trim()) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any).from('advertisers').insert({
        user_id: user.id,
        business_name: businessName.trim(),
        website: website.trim() || null,
        category: category.trim() || null,
        contact_email: (user.email ?? '').toLowerCase(),
      });
      if (error) throw error;
      onDone();
    } catch (err) {
      toast.error('Could not save', { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-4 rounded-xl border border-border bg-card p-6 shadow-raised">
      <div className="flex items-center gap-2.5">
        <Building2 className="h-5 w-5 text-malachite-800" aria-hidden />
        <h1 className="text-lg font-bold text-foreground">Tell us about your business</h1>
      </div>
      <div>
        <Label htmlFor="adv-name">Business name</Label>
        <Input id="adv-name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} maxLength={120} className="mt-1.5" />
      </div>
      <div>
        <Label htmlFor="adv-site">Website (https)</Label>
        <Input id="adv-site" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://example.com" className="mt-1.5" />
      </div>
      <div>
        <Label htmlFor="adv-cat">Category</Label>
        <Input id="adv-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Food & drink" maxLength={60} className="mt-1.5" />
      </div>
      <Button onClick={submit} disabled={busy || !businessName.trim()} className="w-full bg-malachite-800 hover:bg-malachite-900">
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Continue
      </Button>
    </div>
  );
}

function CampaignEditor({
  advertiser,
  campaign,
  onClose,
}: {
  advertiser: Advertiser;
  campaign: Campaign | null;
  onClose: () => void;
}) {
  const universities = activeUniversities();
  const readOnly = campaign != null && !['draft', 'rejected'].includes(campaign.status);

  const [name, setName] = useState(campaign?.name ?? '');
  const [universityId, setUniversityId] = useState(campaign?.university_id ?? universities[0]?.id ?? '');
  const [startDate, setStartDate] = useState(campaign?.start_date ?? '');
  const [endDate, setEndDate] = useState(campaign?.end_date ?? '');
  const [classYears, setClassYears] = useState<number[]>(campaign?.targeting?.class_years ?? []);
  const [creative, setCreative] = useState<Creative>(
    campaign?.creative ?? { image_url: null, headline: '', body: null, cta_text: 'Learn more', cta_url: '' },
  );
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null);

  // Estimated students reached, k-anonymity floored server-side (null = under
  // the floor -> the segment is not usable).
  const reachQuery = useQuery({
    queryKey: ['ad-reach', universityId, [...classYears].sort().join(',')],
    enabled: !!universityId,
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await (supabase as any).rpc('estimate_ad_reach', {
        p_university: universityId,
        p_class_years: classYears.length > 0 ? classYears : null,
      });
      if (error) throw error;
      return (data as number | null) ?? null;
    },
  });
  const reach = reachQuery.data;
  const underFloor = !reachQuery.isLoading && reach === null;

  const persist = async (submitForReview: boolean) => {
    if (!name.trim() || !universityId) {
      toast.error('Name and school are required');
      return;
    }
    if (submitForReview && (!creative.headline.trim() || !/^https:\/\//.test(creative.cta_url))) {
      toast.error('Finish the creative first', {
        description: 'A headline and an https link are required to submit for review.',
      });
      return;
    }
    if (submitForReview && underFloor) {
      toast.error('Audience is too narrow', {
        description: 'This segment is below the minimum size we allow for targeting. Broaden the class years.',
      });
      return;
    }
    setBusy(submitForReview ? 'submit' : 'save');
    try {
      const campaignRow = {
        advertiser_id: advertiser.id,
        university_id: universityId,
        name: name.trim(),
        status: submitForReview ? 'pending_review' : 'draft',
        start_date: startDate || null,
        end_date: endDate || null,
        targeting: { class_years: classYears },
        updated_at: new Date().toISOString(),
      };
      let campaignId = campaign?.id;
      if (campaignId) {
        const { error } = await (supabase as any).from('ad_campaigns').update(campaignRow).eq('id', campaignId);
        if (error) throw error;
      } else {
        const { data, error } = await (supabase as any)
          .from('ad_campaigns')
          .insert(campaignRow)
          .select('id')
          .single();
        if (error) throw error;
        campaignId = (data as { id: string }).id;
      }
      if (creative.headline.trim()) {
        const creativeRow = {
          campaign_id: campaignId,
          image_url: creative.image_url?.trim() || null,
          headline: creative.headline.trim(),
          body: creative.body?.trim() || null,
          cta_text: creative.cta_text.trim() || 'Learn more',
          cta_url: creative.cta_url.trim(),
          updated_at: new Date().toISOString(),
        };
        const { error } = await (supabase as any)
          .from('ad_creatives')
          .upsert(creativeRow, { onConflict: 'campaign_id' });
        if (error) throw error;
      }
      toast.success(submitForReview ? 'Submitted for review' : 'Saved', {
        description: submitForReview
          ? 'The DormCheck team reviews every ad against the content policy before it runs.'
          : undefined,
      });
      onClose();
    } catch (err) {
      toast.error('Could not save campaign', { description: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">
          {campaign ? campaign.name : 'New campaign'}
        </h1>
        <Button variant="outline" size="sm" onClick={onClose}>
          Back to campaigns
        </Button>
      </div>

      {campaign?.status === 'pending_review' && (
        <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <Clock className="h-4 w-4 shrink-0" aria-hidden /> In review - the DormCheck team checks every
          ad against the content policy. You can no longer edit it.
        </p>
      )}
      {campaign?.status === 'approved' && (
        <p className="flex items-center gap-2 rounded-xl border border-malachite-600/30 bg-malachite-50 p-3 text-sm text-foreground">
          <BadgeCheck className="h-4 w-4 shrink-0 text-malachite-800" aria-hidden /> Approved.
        </p>
      )}
      {campaign?.status === 'rejected' && campaign.review_note && (
        <p className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-foreground">
          <XCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden /> Not approved: {campaign.review_note}
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-[1fr,auto]">
        <div className="space-y-4">
          <div>
            <Label htmlFor="camp-name">Campaign name</Label>
            <Input id="camp-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} disabled={readOnly} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="camp-school">School</Label>
            <select
              id="camp-school"
              value={universityId}
              onChange={(e) => setUniversityId(e.target.value)}
              disabled={readOnly}
              className="mt-1.5 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600"
            >
              {universities.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="camp-start">Start date</Label>
              <Input id="camp-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={readOnly} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="camp-end">End date</Label>
              <Input id="camp-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={readOnly} className="mt-1.5" />
            </div>
          </div>

          <div>
            <Label>Class years (optional)</Label>
            <div className="mt-1.5 flex flex-wrap gap-2" role="group" aria-label="Target class years">
              {CLASS_YEARS.map((year) => {
                const active = classYears.includes(year);
                return (
                  <button
                    key={year}
                    type="button"
                    aria-pressed={active}
                    disabled={readOnly}
                    onClick={() =>
                      setClassYears((prev) =>
                        active ? prev.filter((y) => y !== year) : [...prev, year],
                      )
                    }
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600',
                      active
                        ? 'border-malachite-600 bg-malachite-50 text-malachite-800'
                        : 'border-border bg-card text-muted-foreground hover:bg-muted/50',
                    )}
                  >
                    {year}
                  </button>
                );
              })}
            </div>
            <p
              className={cn(
                'mt-2 inline-flex items-center gap-1.5 text-xs',
                underFloor ? 'text-red-700' : 'text-muted-foreground',
              )}
              role="status"
            >
              <Users className="h-3.5 w-3.5" aria-hidden />
              {reachQuery.isLoading
                ? 'Estimating reach...'
                : underFloor
                  ? 'This segment is below the minimum audience size we allow. Broaden it to continue.'
                  : `Estimated students reached: ${reach!.toLocaleString()}`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Targeting is aggregate-only. We never share who the students are, and segments below
              the minimum size can&apos;t be used.
            </p>
          </div>

          <div className="space-y-3 rounded-xl border border-border bg-card p-4">
            <p className="text-sm font-semibold text-foreground">Creative</p>
            <div>
              <Label htmlFor="cr-headline">Headline</Label>
              <Input id="cr-headline" value={creative.headline} onChange={(e) => setCreative({ ...creative, headline: e.target.value })} maxLength={80} disabled={readOnly} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="cr-body">Body (optional)</Label>
              <Textarea id="cr-body" value={creative.body ?? ''} onChange={(e) => setCreative({ ...creative, body: e.target.value || null })} maxLength={200} disabled={readOnly} className="mt-1.5 min-h-[60px]" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cr-cta">Button text</Label>
                <Input id="cr-cta" value={creative.cta_text} onChange={(e) => setCreative({ ...creative, cta_text: e.target.value })} maxLength={30} disabled={readOnly} className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="cr-url">Link (https)</Label>
                <Input id="cr-url" value={creative.cta_url} onChange={(e) => setCreative({ ...creative, cta_url: e.target.value })} placeholder="https://" disabled={readOnly} className="mt-1.5" />
              </div>
            </div>
            <div>
              <Label htmlFor="cr-img">Image URL (https, square works best)</Label>
              <Input id="cr-img" value={creative.image_url ?? ''} onChange={(e) => setCreative({ ...creative, image_url: e.target.value || null })} placeholder="https://" disabled={readOnly} className="mt-1.5" />
            </div>
          </div>

          {!readOnly && (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => void persist(false)} disabled={busy !== null}>
                {busy === 'save' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save draft
              </Button>
              <Button
                onClick={() => void persist(true)}
                disabled={busy !== null}
                className="bg-malachite-800 hover:bg-malachite-900"
              >
                {busy === 'submit' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Submit for review
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Live preview - what students see
          </p>
          <SponsoredPreview creative={creative} businessName={advertiser.business_name} />
        </div>
      </div>
    </div>
  );
}
