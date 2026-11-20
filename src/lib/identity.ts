/**
 * Display identity shared by the sidebar user chip and the top-nav profile
 * menu, so both derive the same name/initials from the same sources.
 */
export function resolveDisplayName(profileName: string | undefined, email: string): string {
  return profileName && profileName !== 'Student'
    ? profileName
    : email.split('@')[0] || 'You';
}

export function getInitials(displayName: string): string {
  return (
    displayName
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'U'
  );
}
