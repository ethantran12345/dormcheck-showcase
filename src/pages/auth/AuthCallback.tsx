import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';
import { getPostLoginRedirect, parseSafeRedirectParam } from '@/lib/authRedirects';
import { gateUniversityEmail } from '@/lib/universityAuth';
import { resolveUniversityByEmail } from '@/config/universities';

const AuthCallback = () => {
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;

    const redirect = async () => {
      let targetRoute = '/';

      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (session?.user?.id) {
          // No picked-school context on this route (OAuth/magic-link
          // callback), so resolve by the session email against every active
          // university, not just the default.
          const authedUniversity = resolveUniversityByEmail(session.user.email);
          const gate = await gateUniversityEmail(session.user.email, authedUniversity);
          if (gate === 'advertiser') {
            // Invite-gated business account (P1.10): web-only advertiser zone.
            targetRoute = '/advertise';
          } else if (gate === 'rejected') {
            targetRoute = '/auth';
          } else {
            try {
              // Read the destination from the URL query param FIRST — it is the
              // only carrier that survives the email-confirmation round-trip
              // (a fresh browser context has no sessionStorage). Fall back to
              // the same-session sessionStorage stash for OAuth/magic-link.
              const fromQuery = parseSafeRedirectParam(
                new URLSearchParams(window.location.search).get('redirect'),
              );
              const stored = fromQuery ?? parseSafeRedirectParam(sessionStorage.getItem('auth_redirect'));
              if (stored) {
                sessionStorage.removeItem('auth_redirect');
                targetRoute = stored;
              } else if (Capacitor.isNativePlatform()) {
                targetRoute = '/my-home';
              } else {
                targetRoute = await getPostLoginRedirect(session.user.id);
              }
            } catch {
              targetRoute = Capacitor.isNativePlatform()
                ? '/my-home'
                : await getPostLoginRedirect(session.user.id);
            }
          }
        }
      } catch (error) {
        console.error('Auth callback getSession error', error);
      }

      if (isMounted) {
        navigate(targetRoute, { replace: true });
      }
    };

    void redirect();

    return () => {
      isMounted = false;
    };
  }, [navigate]);

  return null;
};

export default AuthCallback;
