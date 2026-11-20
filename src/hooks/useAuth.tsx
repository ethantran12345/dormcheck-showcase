import { createContext, useCallback, useContext, useEffect, useRef, useState, useMemo, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { registerPushNotifications, unregisterPushNotifications } from '@/lib/pushNotifications';

/**
 * Signup is NOT a client analytics event. It is derived from `profiles.created_at`.
 *
 * A `signup_complete` event used to be inserted from `ensureProfile()` below, gated
 * on the client being the writer that materialized the profile row. It could never
 * work: the `on_auth_user_created` trigger (`handle_new_user()`) inserts the profile
 * during the `auth.users` INSERT, so by the time `ensureProfile()` selects, the row
 * already exists and the gate is closed. Prod bore that out - 2 events against 77
 * profiles (the 2 are races the client happened to win).
 *
 * A DB fact cannot be lost to a client race, so the event was retired (2026-07-29)
 * rather than moved to another client hook. `admin-metrics` already derives
 * `funnel.signedUp` from `profiles.length`, so nothing downstream changed.
 */

export type AppRole = 'user' | 'university_admin' | 'superadmin';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
  /** Tiered role from profiles.role; 'user' until the profile fetch resolves */
  role: AppRole;
  /** profiles.university_id — scope for university_admin; null for user/superadmin today */
  universityId: string | null;
  isSuperAdmin: boolean;
  isUniversityAdmin: boolean;
  /** profiles.admin_scopes — capability scopes for university_admin delegation.
   *  null = all scopes (default). See src/lib/adminScopes.ts. */
  adminScopes: string[] | null;
  /** True for any admin tier (role !== 'user'). Kept for legacy call sites; DB keeps profiles.is_admin in sync */
  isAdmin: boolean;
  /**
   * False until the first `profiles.role` fetch for the current `user.id`
   * finishes (success or error). Reset when `user` logs out or `user.id` changes;
   * not reset on token refresh (same user id).
   */
  profileLoaded: boolean;
  /**
   * True when the profile read failed (offline, server error). Without it the
   * app carried on with universityId null, every tenant-scoped query stayed
   * disabled, and pages sat on skeletons forever. ProtectedRoute renders a
   * retryable error instead. Optional on the type only so hand-built test
   * contexts stay valid; the provider always supplies both.
   */
  profileError?: boolean;
  /** Re-run the profile read after a failure. */
  retryProfile?: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [profileRole, setProfileRole] = useState<AppRole>('user');
  const [universityId, setUniversityId] = useState<string | null>(null);
  const [adminScopes, setAdminScopes] = useState<string[] | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(true);
  const [profileError, setProfileError] = useState(false);
  const [profileAttempt, setProfileAttempt] = useState(0);
  const retryProfile = useCallback(() => setProfileAttempt((n) => n + 1), []);
  // Last user id whose profile fetch was kicked off. Lets the auth handlers
  // flip profileLoaded to false SYNCHRONOUSLY (same render batch as setUser)
  // when a new user lands - the [user?.id] effect below runs only after
  // render, so without this a gate can see user set + stale profileLoaded=true
  // + isAdmin=false and wrongly bounce an admin.
  const lastProfileUidRef = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    // Set up auth state listener - handles INITIAL_SESSION (first event) and all subsequent changes
    const ensureProfile = async (authUser: User) => {
      const uid = authUser.id;
      const { data: existing } = await supabase.from('profiles').select('id').eq('id', uid).maybeSingle();
      if (!existing) {
        await supabase.from('profiles').upsert(
          {
            id: uid,
            full_name: authUser.user_metadata?.full_name ?? authUser.email?.split('@')[0] ?? null,
            email: authUser.email ?? null,
          },
          { onConflict: 'id' }
        );
        // No analytics here - signup is derived from `profiles.created_at`. See the
        // note at the top of this file. This branch is only the client-side safety
        // net for a user whose `handle_new_user()` trigger row is missing.
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!isMounted) return;

        const authEvents = ['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'TOKEN_REFRESHED', 'USER_UPDATED'];
        if (authEvents.includes(event)) {
          setSession(session);
          setUser(session?.user ?? null);
          setIsLoading(false);
          if (!session?.user) {
            setProfileRole('user');
            setUniversityId(null);
            setProfileLoaded(true);
          } else if (session.user.id !== lastProfileUidRef.current) {
            setProfileLoaded(false);
          }
          lastProfileUidRef.current = session?.user?.id ?? null;
          if (session?.user?.id && ['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED'].includes(event)) {
            void ensureProfile(session.user);
          }
        }
      }
    );

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!isMounted) return;
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
      if (!session?.user) {
        setProfileRole('user');
        setUniversityId(null);
        setProfileLoaded(true);
      } else if (session.user.id !== lastProfileUidRef.current) {
        setProfileLoaded(false);
      }
      lastProfileUidRef.current = session?.user?.id ?? null;
      if (session?.user?.id) {
        void ensureProfile(session.user);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Fetch profile role + university scope when user is logged in
  useEffect(() => {
    if (!user?.id) {
      setProfileRole('user');
      setUniversityId(null);
      setAdminScopes(null);
      setProfileLoaded(true);
      return;
    }
    let isMounted = true;
    setProfileRole('user');
    setUniversityId(null);
    setAdminScopes(null);
    setProfileLoaded(false);
    // admin_scopes ships in migration 20260731020000; until it reaches every
    // environment the combined select would 42703 and wrongly demote admins,
    // so fall back to the pre-scope column list on error.
    const applyRow = (
      data: unknown,
    ) => {
      const row = data as {
        role?: AppRole;
        university_id?: string | null;
        admin_scopes?: string[] | null;
      } | null;
      setProfileRole(row?.role ?? 'user');
      setUniversityId(row?.university_id ?? null);
      setAdminScopes(row?.admin_scopes ?? null);
      setProfileError(false);
      setProfileLoaded(true);
    };
    supabase
      .from('profiles')
      .select('role, university_id, admin_scopes')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (!error) {
          applyRow(data);
          return;
        }
        // The fallback exists for one case: admin_scopes not yet migrated
        // (42703 undefined column). Any other failure (offline, 5xx) would just
        // fail again after the client's own retries, doubling the wait before
        // the student sees an error, so surface it now.
        if (error.code !== '42703') {
          console.error('[useAuth] profile fetch error:', error);
          setProfileRole('user');
          setUniversityId(null);
          setAdminScopes(null);
          setProfileError(true);
          setProfileLoaded(true);
          return;
        }
        supabase
          .from('profiles')
          .select('role, university_id')
          .eq('id', user.id)
          .maybeSingle()
          .then(({ data: fallbackData, error: fallbackError }) => {
            if (!isMounted) return;
            if (fallbackError) {
              console.error('[useAuth] profile fetch error:', fallbackError);
              setProfileRole('user');
              setUniversityId(null);
              setAdminScopes(null);
              setProfileError(true);
              setProfileLoaded(true);
              return;
            }
            applyRow(fallbackData);
          });
      });
    return () => { isMounted = false; };
  }, [user?.id, profileAttempt]);

  // Claim any pending admin invitations matching this user's email (invited
  // before they had an account). Fire once per logged-in user; on a claim,
  // re-read the profile so role/universityId update without a reload.
  const lastClaimUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    const uid = user?.id ?? null;
    if (!uid || uid === lastClaimUserIdRef.current) {
      if (!uid) lastClaimUserIdRef.current = null;
      return;
    }
    lastClaimUserIdRef.current = uid;
    let isMounted = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not yet in generated types (migration 20260721000000)
    (supabase as any)
      .rpc('claim_pending_admin_invites')
      .then(({ data, error }: { data: number | null; error: { message: string } | null }) => {
        if (error) {
          // Expected to fail silently until the migration ships everywhere.
          console.warn('[useAuth] claim_pending_admin_invites:', error.message);
          return;
        }
        if (!isMounted || !data || Number(data) < 1) return;
        supabase
          .from('profiles')
          .select('role, university_id')
          .eq('id', uid)
          .maybeSingle()
          .then(({ data: row }) => {
            if (!isMounted || !row) return;
            const p = row as { role?: AppRole; university_id?: string | null };
            setProfileRole(p.role ?? 'user');
            setUniversityId(p.university_id ?? null);
          });
      });
    return () => { isMounted = false; };
  }, [user?.id]);

  const isSuperAdmin = profileRole === 'superadmin';
  const isUniversityAdmin = profileRole === 'university_admin';
  const isAdmin = useMemo(() => profileRole !== 'user', [profileRole]);

  // Register push notifications on null -> user transition (login event), not on
  // every render or session refresh. iOS-native only; web is a no-op inside the
  // wrapper. Failures must not block app boot.
  const lastPushUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    const uid = user?.id ?? null;
    if (uid && uid !== lastPushUserIdRef.current) {
      lastPushUserIdRef.current = uid;
      void registerPushNotifications(uid);
    } else if (!uid) {
      lastPushUserIdRef.current = null;
    }
  }, [user?.id]);

  const signOut = async () => {
    const uid = user?.id;
    if (uid) {
      await unregisterPushNotifications(uid).catch((e) =>
        console.warn('[useAuth] unregisterPushNotifications failed:', e),
      );
    }
    await supabase.auth.signOut();
    if (typeof window !== 'undefined') {
      window.location.href = window.location.origin;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isLoading,
        signOut,
        role: profileRole,
        universityId,
        isSuperAdmin,
        isUniversityAdmin,
        adminScopes,
        isAdmin,
        profileLoaded,
        profileError,
        retryProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
