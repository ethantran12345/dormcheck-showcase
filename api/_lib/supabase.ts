import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';

const url = process.env.SUPABASE_URL;
// Service role only. Falling back to the anon key would silently run these
// server-side handlers RLS-bound, which breaks notification lookups.
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabase = url && key
  ? createClient<Database>(url, key, { auth: { persistSession: false } })
  : null;
