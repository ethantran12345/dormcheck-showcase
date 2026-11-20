import { useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router';
import { activeUniversities } from '@/config/universities';
import {
  persistSelectedUniversity,
  resolveSelectedUniversity,
} from '@/lib/selectedUniversity';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';

/**
 * Pre-auth school picker (fallback). The auth screen resolves the school from
 * the typed email (identifier-first); this page is only reached via its
 * "pick it from the list" link (?pick=1) or a direct/legacy URL. Auto-skips
 * (redirects straight to /auth) for an already-authenticated user or, unless
 * ?pick=1 forces the picker, when a selection already resolves.
 */
const SelectSchool = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isLoading } = useAuth();

  const schools = activeUniversities();
  const schoolParam = searchParams.get('school');
  const redirectParam = searchParams.get('redirect');
  // ?pick=1 (the auth page's "pick it from the list" fallback) forces the
  // picker even when a school is already persisted.
  const forcePick = searchParams.get('pick') === '1';

  const authTarget = useMemo(() => {
    const params = new URLSearchParams();
    if (redirectParam) params.set('redirect', redirectParam);
    const qs = params.toString();
    return `/auth${qs ? `?${qs}` : ''}`;
  }, [redirectParam]);

  // Resolve any existing selection (?school=, persisted choice, or sole active).
  const resolved = useMemo(
    () => resolveSelectedUniversity(schoolParam),
    [schoolParam],
  );

  useEffect(() => {
    if (isLoading) return;
    // Never force the picker on an authenticated session.
    if (user) {
      navigate('/', { replace: true });
      return;
    }
    // A selection already exists (or only one school is active): skip the picker.
    if (resolved && !forcePick) {
      navigate(authTarget, { replace: true });
    }
  }, [isLoading, user, resolved, forcePick, authTarget, navigate]);

  const choose = (slug: string) => {
    persistSelectedUniversity(slug);
    navigate(authTarget, { replace: true });
  };

  // Render nothing while redirecting to avoid a flash of the picker.
  if (isLoading || user || (resolved && !forcePick)) return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-raised sm:p-8">
        <div className="mb-6 flex justify-center">
          <img
            src="/dormcheck-logo-new.png"
            alt="DormCheck"
            className="h-14 w-auto object-contain"
            onError={(e) => { e.currentTarget.src = '/dormcheck-logo.png'; }}
          />
        </div>

        <h1 className="mb-1.5 text-center font-display text-2xl font-bold text-foreground">
          Choose your school
        </h1>
        <p className="mb-8 text-center text-sm text-muted-foreground">
          Pick your university to continue to sign in.
        </p>

        <ul className="space-y-3">
          {schools.map((school) => (
            <li key={school.slug}>
              <Button
                type="button"
                variant="outline"
                className="h-14 w-full justify-start gap-3 border-border bg-card px-4 text-left text-base font-medium text-foreground shadow-raised hover:bg-accent"
                onClick={() => choose(school.slug)}
              >
                {school.brand?.logoSrc ? (
                  <img
                    src={school.brand.logoSrc}
                    alt=""
                    className="h-8 w-8 shrink-0 object-contain"
                  />
                ) : (
                  /* The no-brand-color fallback is the `primary` token
                     (light: malachite-800), not a raw #03C03C literal — this
                     renders white text on it, and #03C03C fails AA under white.
                     A tenant's own primaryColor is config data and stays inline. */
                  <span
                    aria-hidden
                    className={
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white' +
                      (school.brand?.primaryColor ? '' : ' bg-primary')
                    }
                    style={
                      school.brand?.primaryColor
                        ? { backgroundColor: school.brand.primaryColor }
                        : undefined
                    }
                  >
                    {school.shortName.charAt(0)}
                  </span>
                )}
                <span className="flex flex-col">
                  <span className="leading-tight">{school.name}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {school.city}
                  </span>
                </span>
              </Button>
            </li>
          ))}
        </ul>

        <div className="mt-8 text-center text-sm text-muted-foreground">
          <Link
            to="/waitlist"
            className="text-primary underline underline-offset-2"
          >
            My school isn&apos;t listed
          </Link>
        </div>
      </div>
    </div>
  );
};

export default SelectSchool;
