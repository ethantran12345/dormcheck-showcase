import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Megaphone, Trash2, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { apiPost } from '@/lib/apiPost';
import { displayExactOrSuppressed } from '@/lib/smallCell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { PageContainer } from '@/components/ui/page-container';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Superadmin-only manual push broadcast (route-guarded by RequireSuperAdmin;
 * the real enforcement is the server-side role check in api/admin/broadcast.ts).
 * Flow: compose → Preview (recipient count) → Send now or Schedule. University
 * admins get only immediate send to their own school; templates, scheduling, and
 * history are operator-only.
 */

type AudienceKind = 'user' | 'building' | 'university' | 'everyone';

const EVERYONE_PHRASE = 'SEND TO EVERYONE';

type UniversityOption = { id: string; name: string };

type BroadcastTemplate = {
  id: string;
  name: string;
  title: string;
  body: string;
  category: string;
  default_audience_type: AudienceKind | null;
  default_audience_detail: Record<string, unknown> | null;
};

type BroadcastRow = {
  id: string;
  title: string;
  status: 'sent' | 'scheduled' | 'canceled';
  scheduled_for: string | null;
  sent_count: number;
  failed_count: number;
  audience_type: string;
  created_at: string;
};

export default function BroadcastPage() {
  // University admins are scoped to their own school (server-enforced); they
  // only ever send the 'university' audience. Superadmins get every audience.
  const { isSuperAdmin, universityId: myUniversityId } = useAuth();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [route, setRoute] = useState('');
  const [audienceKind, setAudienceKind] = useState<AudienceKind>(
    isSuperAdmin ? 'user' : 'university',
  );
  const [email, setEmail] = useState('');
  const [universityId, setUniversityId] = useState(isSuperAdmin ? '' : (myUniversityId ?? ''));
  const [building, setBuilding] = useState('');
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [busy, setBusy] = useState<'preview' | 'send' | null>(null);
  // Scheduling (superadmin-only). 'now' preserves the existing immediate send.
  const [sendMode, setSendMode] = useState<'now' | 'schedule'>('now');
  const [scheduledFor, setScheduledFor] = useState('');

  const { data: universities = [] } = useQuery({
    queryKey: ['admin-broadcast-universities'],
    queryFn: async (): Promise<UniversityOption[]> => {
      const { data, error } = await supabase
        .from('universities')
        .select('id, name')
        .order('name');
      if (error) throw error;
      return (data ?? []) as UniversityOption[];
    },
  });

  // Templates + history are operator-only surfaces.
  const { data: templates = [] } = useQuery({
    queryKey: ['admin-broadcast-templates'],
    enabled: isSuperAdmin,
    queryFn: async (): Promise<BroadcastTemplate[]> => {
      const res = await apiPost('/api/admin/broadcast-templates', { action: 'list' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Failed to load templates');
      return (json.templates ?? []) as BroadcastTemplate[];
    },
  });

  const { data: history = [] } = useQuery({
    queryKey: ['admin-broadcast-history'],
    enabled: isSuperAdmin,
    queryFn: async (): Promise<BroadcastRow[]> => {
      const { data, error } = await supabase
        .from('push_broadcasts')
        .select('id, title, status, scheduled_for, sent_count, failed_count, audience_type, created_at')
        .order('created_at', { ascending: false })
        .limit(25);
      if (error) throw error;
      return (data ?? []) as unknown as BroadcastRow[];
    },
  });

  const mySchoolName = universities.find((u) => u.id === universityId)?.name;

  const audiencePayload = () => {
    if (audienceKind === 'user') return { kind: 'user', email: email.trim() };
    if (audienceKind === 'building') {
      return { kind: 'building', universityId, building: building.trim() };
    }
    if (audienceKind === 'university') return { kind: 'university', universityId };
    return { kind: 'everyone' };
  };

  const audienceReady =
    audienceKind === 'everyone' ||
    (audienceKind === 'user' && !!email.trim()) ||
    (audienceKind === 'building' && !!universityId && !!building.trim()) ||
    (audienceKind === 'university' && !!universityId);

  const routeInvalid = !!route.trim() && (!route.trim().startsWith('/') || route.trim().startsWith('//'));

  const resetPreview = () => setPreviewCount(null);

  const applyTemplate = (templateId: string) => {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    setTitle(tpl.title);
    setBody(tpl.body);
    const at = tpl.default_audience_type;
    if (at) {
      setAudienceKind(at);
      const d = tpl.default_audience_detail ?? {};
      if (at === 'user' && typeof d.email === 'string') setEmail(d.email);
      if ((at === 'building' || at === 'university') && typeof d.university_id === 'string') {
        setUniversityId(d.university_id);
      }
      if (at === 'building' && typeof d.building === 'string') setBuilding(d.building);
    }
    resetPreview();
    toast.success(`Loaded template "${tpl.name}"`);
  };

  const saveAsTemplate = async () => {
    if (!title.trim() || !body.trim()) {
      toast.error('Add a title and message before saving a template');
      return;
    }
    const name = window.prompt('Template name?')?.trim();
    if (!name) return;
    const payload = audiencePayload() as { kind: AudienceKind } & Record<string, unknown>;
    const { kind, ...rest } = payload;
    const detail: Record<string, unknown> = {};
    if (typeof rest.email === 'string' && rest.email) detail.email = rest.email;
    if (typeof rest.universityId === 'string' && rest.universityId) detail.university_id = rest.universityId;
    if (typeof rest.building === 'string' && rest.building) detail.building = rest.building;
    try {
      const res = await apiPost('/api/admin/broadcast-templates', {
        action: 'create',
        template: {
          name,
          title: title.trim(),
          body: body.trim(),
          default_audience_type: kind,
          default_audience_detail: detail,
        },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Save failed');
      toast.success(`Saved template "${name}"`);
      queryClient.invalidateQueries({ queryKey: ['admin-broadcast-templates'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const deleteTemplate = async (id: string, name: string) => {
    if (!window.confirm(`Delete template "${name}"?`)) return;
    try {
      const res = await apiPost('/api/admin/broadcast-templates', { action: 'delete', id });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Delete failed');
      toast.success('Template deleted');
      queryClient.invalidateQueries({ queryKey: ['admin-broadcast-templates'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const cancelScheduled = async (id: string) => {
    if (!window.confirm('Cancel this scheduled broadcast?')) return;
    try {
      const res = await apiPost('/api/admin/broadcast', { action: 'cancel', broadcastId: id });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Cancel failed');
      toast.success('Scheduled broadcast canceled');
      queryClient.invalidateQueries({ queryKey: ['admin-broadcast-history'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Cancel failed');
    }
  };

  const handlePreview = async () => {
    setBusy('preview');
    try {
      const res = await apiPost('/api/admin/broadcast', {
        action: 'preview',
        audience: audiencePayload(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Preview failed');
      setPreviewCount(json.count as number);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setBusy(null);
    }
  };

  const scheduling = isSuperAdmin && sendMode === 'schedule';

  const handleSend = async () => {
    setBusy('send');
    try {
      const res = await apiPost('/api/admin/broadcast', {
        action: 'send',
        audience: audiencePayload(),
        title: title.trim(),
        body: body.trim(),
        ...(route.trim() ? { route: route.trim() } : {}),
        ...(scheduling ? { scheduledFor: new Date(scheduledFor).toISOString() } : {}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Send failed');
      if (json.scheduled) {
        toast.success(`Broadcast scheduled for ${new Date(json.scheduledFor).toLocaleString()}`);
        queryClient.invalidateQueries({ queryKey: ['admin-broadcast-history'] });
      } else {
        toast.success(
          `Broadcast sent to ${json.sent} device owner${json.sent === 1 ? '' : 's'}` +
            (json.resolved !== json.eligible
              ? ` (${json.resolved - json.eligible} opted out of announcements)`
              : ''),
        );
        queryClient.invalidateQueries({ queryKey: ['admin-broadcast-history'] });
      }
      setPreviewCount(null);
      setConfirmPhrase('');
      setScheduledFor('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setBusy(null);
    }
  };

  const scheduleValid = !scheduling || (!!scheduledFor && new Date(scheduledFor).getTime() > Date.now());

  const canSend =
    previewCount !== null &&
    previewCount > 0 &&
    !!title.trim() &&
    !!body.trim() &&
    !routeInvalid &&
    scheduleValid &&
    (audienceKind !== 'everyone' || confirmPhrase === EVERYONE_PHRASE) &&
    busy === null;

  return (
    <PageContainer width="content" className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Megaphone className="h-6 w-6 text-malachite-600" aria-hidden="true" />
        <div>
          <h1 className="text-xl font-bold text-stone-900">Push broadcast</h1>
          <p className="text-sm text-stone-500">
            Send a manual push notification. Recipients who turned off Announcements are skipped.
          </p>
        </div>
      </div>

      {isSuperAdmin && templates.length > 0 && (
        <Card className="space-y-2 rounded-xl border-stone-200 bg-white p-4">
          <Label htmlFor="template-picker">Start from a template</Label>
          <div className="flex items-center gap-2">
            <Select onValueChange={applyTemplate}>
              <SelectTrigger id="template-picker" className="flex-1">
                <SelectValue placeholder="Pick a saved template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((tpl) => (
                  <SelectItem key={tpl.id} value={tpl.id}>{tpl.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ul className="divide-y divide-stone-100">
            {templates.map((tpl) => (
              <li key={tpl.id} className="flex items-center justify-between py-1.5 text-sm">
                <span className="truncate text-stone-700">{tpl.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-stone-400 hover:text-red-600"
                  onClick={() => deleteTemplate(tpl.id, tpl.name)}
                  aria-label={`Delete template ${tpl.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="space-y-4 rounded-xl border-stone-200 bg-white p-6">
        <div className="space-y-2">
          <Label htmlFor="broadcast-title">Title</Label>
          <Input
            id="broadcast-title"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="A short headline"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="broadcast-body">Message</Label>
          <Textarea
            id="broadcast-body"
            value={body}
            maxLength={500}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What should the push say?"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="broadcast-route">Deep link (optional)</Label>
          <Input
            id="broadcast-route"
            value={route}
            onChange={(e) => setRoute(e.target.value)}
            placeholder="/my-home"
            aria-invalid={routeInvalid}
          />
          {routeInvalid && (
            <p className="text-sm text-red-600">Must be an in-app path starting with a single /</p>
          )}
        </div>
        {isSuperAdmin && (
          <Button type="button" variant="outline" size="sm" onClick={saveAsTemplate}>
            Save as template
          </Button>
        )}
      </Card>

      <Card className="space-y-4 rounded-xl border-stone-200 bg-white p-6">
        <Label>Audience</Label>
        {isSuperAdmin ? (
          <RadioGroup
            value={audienceKind}
            onValueChange={(v) => {
              setAudienceKind(v as AudienceKind);
              resetPreview();
              setConfirmPhrase('');
            }}
            className="space-y-2"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="user" id="audience-user" />
              <Label htmlFor="audience-user" className="font-normal">Single user (by email)</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="building" id="audience-building" />
              <Label htmlFor="audience-building" className="font-normal">A building</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="university" id="audience-university-all" />
              <Label htmlFor="audience-university-all" className="font-normal">All students at a university</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="everyone" id="audience-everyone" />
              <Label htmlFor="audience-everyone" className="font-normal">Everyone</Label>
            </div>
          </RadioGroup>
        ) : (
          <p className="text-sm text-stone-600">
            Sending to <span className="font-semibold">all students at {mySchoolName ?? 'your university'}</span>.
          </p>
        )}

        {audienceKind === 'user' && (
          <div className="space-y-2">
            <Label htmlFor="audience-email">User email</Label>
            <Input
              id="audience-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                resetPreview();
              }}
              placeholder="student@pitt.edu"
            />
          </div>
        )}

        {audienceKind === 'building' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="audience-university">University</Label>
              <Select
                value={universityId}
                onValueChange={(v) => {
                  setUniversityId(v);
                  resetPreview();
                }}
              >
                <SelectTrigger id="audience-university">
                  <SelectValue placeholder="Pick a school" />
                </SelectTrigger>
                <SelectContent>
                  {universities.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="audience-dorm">Building name</Label>
              <Input
                id="audience-dorm"
                value={building}
                onChange={(e) => {
                  setBuilding(e.target.value);
                  resetPreview();
                }}
                placeholder="Tower A"
              />
            </div>
          </div>
        )}

        {audienceKind === 'university' && isSuperAdmin && (
          <div className="space-y-2">
            <Label htmlFor="audience-university-select">University</Label>
            <Select
              value={universityId}
              onValueChange={(v) => {
                setUniversityId(v);
                resetPreview();
              }}
            >
              <SelectTrigger id="audience-university-select">
                <SelectValue placeholder="Pick a school" />
              </SelectTrigger>
              <SelectContent>
                {universities.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {audienceKind === 'everyone' && previewCount !== null && (
          <div className="space-y-2">
            <Label htmlFor="everyone-confirm">
              Type <span className="font-mono font-semibold">{EVERYONE_PHRASE}</span> to enable Send
            </Label>
            <Input
              id="everyone-confirm"
              value={confirmPhrase}
              onChange={(e) => setConfirmPhrase(e.target.value)}
              autoComplete="off"
            />
          </div>
        )}

        {isSuperAdmin && (
          <div className="space-y-2 border-t border-stone-100 pt-4">
            <Label>Delivery</Label>
            <RadioGroup
              value={sendMode}
              onValueChange={(v) => setSendMode(v as 'now' | 'schedule')}
              className="flex gap-6"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="now" id="send-now" />
                <Label htmlFor="send-now" className="font-normal">Send now</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="schedule" id="send-schedule" />
                <Label htmlFor="send-schedule" className="font-normal">Schedule</Label>
              </div>
            </RadioGroup>
            {scheduling && (
              <div className="space-y-1 pt-1">
                <Label htmlFor="schedule-at">Send at</Label>
                <Input
                  id="schedule-at"
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                />
                {!!scheduledFor && new Date(scheduledFor).getTime() <= Date.now() && (
                  <p className="text-sm text-red-600">Pick a time in the future.</p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={handlePreview}
            disabled={!audienceReady || busy !== null}
          >
            {busy === 'preview' && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Preview recipients
          </Button>
          {previewCount !== null && (
            <span className="text-sm text-stone-600" role="status">
              {/* FERPA small-cell suppression (P0.6): a university admin must
                  not see an exact 1-4 population count. Send still works. */}
              {displayExactOrSuppressed(previewCount, !isSuperAdmin)} recipient
              {isSuperAdmin && previewCount === 1 ? '' : 's'}
            </span>
          )}
          <Button
            type="button"
            className="ml-auto bg-malachite-800 hover:bg-malachite-900"
            onClick={handleSend}
            disabled={!canSend}
          >
            {busy === 'send' && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {scheduling ? 'Schedule broadcast' : 'Send broadcast'}
          </Button>
        </div>
      </Card>

      {isSuperAdmin && history.length > 0 && (
        <Card className="space-y-3 rounded-xl border-stone-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-stone-900">Recent broadcasts</h2>
          <ul className="divide-y divide-stone-100">
            {history.map((b) => {
              const overdue =
                b.status === 'scheduled' && !!b.scheduled_for && new Date(b.scheduled_for).getTime() < Date.now();
              return (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-stone-800">{b.title}</p>
                    <p className="text-xs text-stone-500">
                      <span className="capitalize">{b.audience_type}</span>
                      {b.status === 'scheduled' && b.scheduled_for
                        ? ` · scheduled ${new Date(b.scheduled_for).toLocaleString()}`
                        : b.status === 'sent'
                          ? ` · sent (${b.sent_count}✓${b.failed_count ? ` ${b.failed_count}✗` : ''})`
                          : ` · ${b.status}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {b.status === 'scheduled' && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                          overdue ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        {overdue ? 'Overdue' : 'Scheduled'}
                      </span>
                    )}
                    {b.status === 'scheduled' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-stone-500 hover:text-red-600"
                        onClick={() => cancelScheduled(b.id)}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </PageContainer>
  );
}
