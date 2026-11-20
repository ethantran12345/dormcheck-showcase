import { useCallback, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

export interface LiveCoords {
  lat: number;
  lng: number;
}

export type LiveLocationStatus =
  | 'idle'
  | 'locating'
  | 'granted'
  | 'denied'
  | 'unavailable';

/**
 * On-demand device GPS for the schedule navigator. We never request on mount -
 * a permission prompt on page load reads as hostile - so `request()` is wired
 * to an explicit "use my location" / "Directions" tap. Works on iOS, Android,
 * and web (browser geolocation). Fails soft: any error (permission denied, no
 * Info.plist usage string yet, timeout) resolves to `null` and the caller falls
 * back to the saved home location, so the feature degrades instead of breaking.
 */
export function useLiveLocation() {
  const [coords, setCoords] = useState<LiveCoords | null>(null);
  const [status, setStatus] = useState<LiveLocationStatus>('idle');

  const request = useCallback(async (): Promise<LiveCoords | null> => {
    setStatus('locating');
    try {
      if (Capacitor.isNativePlatform()) {
        let perm = await Geolocation.checkPermissions();
        if (perm.location !== 'granted') {
          perm = await Geolocation.requestPermissions();
        }
        if (perm.location !== 'granted') {
          setStatus('denied');
          return null;
        }
      }
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10_000,
      });
      const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setCoords(next);
      setStatus('granted');
      return next;
    } catch {
      // Native without the NSLocationWhenInUseUsageDescription key, a web user
      // who blocked the prompt, or a timeout all land here - stay usable.
      setStatus('unavailable');
      return null;
    }
  }, []);

  const clear = useCallback(() => {
    setCoords(null);
    setStatus('idle');
  }, []);

  return { coords, status, request, clear };
}
