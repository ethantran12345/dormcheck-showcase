type ConnectionHints = {
  saveData?: boolean;
  effectiveType?: string;
};

/** Avoid background downloads when the browser says bandwidth is constrained. */
export function shouldWarmLazyRoutes(connection?: ConnectionHints | null): boolean {
  if (!connection) return true;
  if (connection.saveData) return false;
  return connection.effectiveType !== 'slow-2g' && connection.effectiveType !== '2g';
}

export function browserConnectionHints(): ConnectionHints | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as Navigator & { connection?: ConnectionHints }).connection ?? null;
}
