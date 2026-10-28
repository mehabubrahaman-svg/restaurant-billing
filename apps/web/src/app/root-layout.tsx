import { useEffect } from 'react';
import { Outlet } from 'react-router';
import { useConnectionMonitor } from '../features/connection/use-connection-monitor';
import { applyTheme, effectiveTheme, useThemeStore } from '../features/theme/theme-store';
import { useDeviceStore } from '../stores/device-store';

/** Wraps every route, public ones included: connection polling and theme. */
export function RootLayout() {
  useConnectionMonitor();
  const preference = useThemeStore((s) => s.preference);
  const kind = useDeviceStore((s) => s.kind);

  useEffect(() => {
    applyTheme(effectiveTheme(preference, kind));
  }, [preference, kind]);

  return <Outlet />;
}
