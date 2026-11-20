import { useMemo } from 'react';
import { useTheme } from '@/contexts/ThemeContext';

export const MAPBOX_STYLE_LIGHT = 'mapbox://styles/mapbox/streets-v12';
export const MAPBOX_STYLE_DARK = 'mapbox://styles/mapbox/dark-v11';

/**
 * Theme-aware Mapbox style. Every map in the app derives its style URL from
 * here so light/dark swaps stay consistent (maps re-style via map.setStyle
 * when styleUrl changes).
 */
export function useMapboxTheme(): { styleUrl: string; isDark: boolean } {
  const { resolvedTheme } = useTheme();
  return useMemo(() => {
    const isDark = resolvedTheme === 'dark';
    return { styleUrl: isDark ? MAPBOX_STYLE_DARK : MAPBOX_STYLE_LIGHT, isDark };
  }, [resolvedTheme]);
}
