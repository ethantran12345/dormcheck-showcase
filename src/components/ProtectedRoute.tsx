import { Navigate, useLocation } from 'react-router';
import { AppLoadFailed } from '@/components/AppLoadFailed';
import { useAuth } from '@/hooks/useAuth';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, isLoading, profileError, retryProfile } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    const redirect = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/auth?redirect=${redirect}`} replace />;
  }

  // The profile decides the tenant every page query is scoped to; without it
  // those queries never run. Say so, with a retry, rather than render children
  // that can only show skeletons.
  if (profileError && retryProfile) return <AppLoadFailed onRetry={retryProfile} />;

  return <>{children}</>;
}
