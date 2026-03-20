import { useState, useCallback } from 'react';
import { toast } from 'react-toastify';

export type GeolocationDialogVariant = 'none' | 'consent' | 'blocked' | 'unsupported';

type Prelude = 'consent' | 'blocked' | 'unsupported' | 'immediate';

async function getGeolocationPrelude(): Promise<Prelude> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return 'unsupported';
  }
  try {
    const result = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    if (result.state === 'denied') return 'blocked';
    if (result.state === 'granted') return 'immediate';
  } catch {
    /* Permissions API unsupported or throws — fall through to consent */
  }
  return 'consent';
}

export function useGeolocationPicker(onSuccess: (lat: number, lng: number) => void) {
  const [locationLoading, setLocationLoading] = useState(false);
  const [geoVariant, setGeoVariant] = useState<GeolocationDialogVariant>('none');

  const runGeolocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoVariant('unsupported');
      return;
    }
    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onSuccess(pos.coords.latitude, pos.coords.longitude);
        setLocationLoading(false);
      },
      (err) => {
        setLocationLoading(false);
        if (err.code === 1) {
          setGeoVariant('blocked');
          return;
        }
        const messages: Record<number, string> = {
          2: 'Location unavailable. Enter coordinates manually.',
          3: 'Location request timed out. Try again or enter coordinates manually.',
        };
        toast.error(messages[err.code] ?? 'Could not get location. You can enter coordinates manually.');
      },
      { enableHighAccuracy: true },
    );
  }, [onSuccess]);

  const openPicker = useCallback(async () => {
    const prelude = await getGeolocationPrelude();
    if (prelude === 'unsupported') {
      setGeoVariant('unsupported');
      return;
    }
    if (prelude === 'blocked') {
      setGeoVariant('blocked');
      return;
    }
    if (prelude === 'immediate') {
      runGeolocation();
      return;
    }
    setGeoVariant('consent');
  }, [runGeolocation]);

  const confirmConsent = useCallback(() => {
    setGeoVariant('none');
    runGeolocation();
  }, [runGeolocation]);

  const closeDialog = useCallback(() => setGeoVariant('none'), []);

  return { locationLoading, geoVariant, openPicker, confirmConsent, closeDialog };
}
