import { supabase } from '../_lib/supabase.js';
import { getAuthedUser } from '../_lib/auth.js';
import { applyCors } from '../_lib/cors.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Superadmin-only CRUD for reusable broadcast templates (scheduled/templated
// broadcasts, 2026-07-14). The table is RLS default-deny (service-role only), so
// this endpoint is the sole access path and enforces superadmin server-side.
// Actions: list | create | update | delete.

const AUDIENCE_TYPES = ['user', 'building', 'university', 'everyone'];

async function requireSuperadmin(req: VercelRequest, res: VercelResponse): Promise<{ id: string } | null> {
  const user = await getAuthedUser(req, { requireAal2: true });
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  const { data } = await supabase!
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if ((data as { role?: string } | null)?.role !== 'superadmin') {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return { id: user.id };
}

type TemplateInput = {
  name?: string;
  title?: string;
  body?: string;
  category?: string;
  default_audience_type?: string | null;
  default_audience_detail?: Record<string, unknown> | null;
};

function validated(template: TemplateInput | undefined): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const name = template?.name?.trim();
  const title = template?.title?.trim();
  const body = template?.body?.trim();
  if (!name || !title || !body) return { ok: false, error: 'name, title, and body are required' };
  if (title.length > 120 || body.length > 500) return { ok: false, error: 'title or body too long' };
  const at = template?.default_audience_type ?? null;
  if (at !== null && !AUDIENCE_TYPES.includes(at)) return { ok: false, error: 'invalid default_audience_type' };
  return {
    ok: true,
    value: {
      name,
      title,
      body,
      category: template?.category?.trim() || 'announcements',
      default_audience_type: at,
      default_audience_detail: template?.default_audience_detail ?? {},
    },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (!supabase) {
    console.error('[broadcast-templates] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    return res.status(503).json({ error: 'Service unavailable' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const me = await requireSuperadmin(req, res);
  if (!me) return;

  // Generous for a human admin; a stop on a scripted runaway or stolen session.
  if (!(await enforceRateLimit({ res, action: 'broadcast-templates', userId: me.id, max: 60, windowSeconds: 3600 }))) {
    return;
  }

  const { action, template, id } = req.body as {
    action?: string;
    template?: TemplateInput;
    id?: string;
  };

  try {
    if (action === 'list') {
      const { data, error } = await supabase
        .from('broadcast_templates')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json({ ok: true, templates: data ?? [] });
    }

    if (action === 'create') {
      const v = validated(template);
      if (!v.ok) return res.status(400).json({ error: v.error });
      const { data, error } = await supabase
        .from('broadcast_templates')
        .insert({ ...v.value, created_by: me.id })
        .select('*')
        .single();
      if (error) throw error;
      return res.status(200).json({ ok: true, template: data });
    }

    if (action === 'update') {
      if (!id) return res.status(400).json({ error: 'id required' });
      const v = validated(template);
      if (!v.ok) return res.status(400).json({ error: v.error });
      const { data, error } = await supabase
        .from('broadcast_templates')
        .update({ ...v.value, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return res.status(200).json({ ok: true, template: data });
    }

    if (action === 'delete') {
      if (!id) return res.status(400).json({ error: 'id required' });
      const { error } = await supabase.from('broadcast_templates').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true, deleted: true });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (err) {
    console.error('[broadcast-templates]', err);
    return res.status(500).json({ error: 'Template operation failed' });
  }
}
