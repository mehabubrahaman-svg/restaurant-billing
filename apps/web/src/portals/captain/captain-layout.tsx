import { Outlet } from 'react-router';
import { useReadyAlerts } from '../../features/orders/use-ready-alerts';

/** Wraps the captain's floor and order pad: ready alerts follow the captain on both. */
export function CaptainLayout() {
  useReadyAlerts();
  return <Outlet />;
}
