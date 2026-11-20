import { supabase } from '@/integrations/supabase/client';

/** Row shape of public.academic_terms (20260731010000). */
export type AcademicTerm = {
  id: string;
  university_id: string;
  name: string;
  code: string;
  starts_at: string;
  ends_at: string;
};

/**
 * Terms for a university, soonest first. Groundwork for term-scoped features
 * (move-in cohorts, term-tagged groups); nothing consumes this yet.
 */
export async function fetchAcademicTerms(universityId: string): Promise<AcademicTerm[]> {
  const { data, error } = await supabase
    .from('academic_terms' as never)
    .select('id, university_id, name, code, starts_at, ends_at')
    .eq('university_id', universityId)
    .order('starts_at', { ascending: true });
  if (error) throw error;
  // Cast: types.ts intentionally lags the academic_terms migration.
  return (data ?? []) as unknown as AcademicTerm[];
}

/** The term containing `date` (defaults to today), or undefined. */
export function termForDate(terms: AcademicTerm[], date = new Date()): AcademicTerm | undefined {
  const iso = date.toISOString().slice(0, 10);
  return terms.find((t) => t.starts_at <= iso && iso <= t.ends_at);
}

/** The next term starting after `date` (defaults to today), or undefined. */
export function nextTermAfter(terms: AcademicTerm[], date = new Date()): AcademicTerm | undefined {
  const iso = date.toISOString().slice(0, 10);
  return terms.filter((t) => t.starts_at > iso).sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1))[0];
}
