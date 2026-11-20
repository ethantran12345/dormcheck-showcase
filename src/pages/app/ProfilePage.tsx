import { Navigate, useSearchParams } from 'react-router';

/**
 * `/profile` now redirects into `Settings → Profile` (R9): the whole profile
 * editor lives in one place (`SettingsProfile` → shared `ProfileEditFields`),
 * and Settings' `max-w-3xl` shell gives it a proper desktop width instead of the
 * old full-bleed stretch. The `?openHousing=true` deep link is preserved.
 */
export default function ProfilePage() {
  const [searchParams] = useSearchParams();

  if (searchParams.get('openHousing') === 'true') {
    return <Navigate to="/my-home?openHousing=true" replace />;
  }

  return <Navigate to="/settings?section=profile" replace />;
}
