import { useSession } from '../features/auth/auth-store';
import { useDeviceStore } from '../stores/device-store';
import { homePath } from './portals';

export function useHomePath(): string {
  const session = useSession();
  const kind = useDeviceStore((s) => s.kind);
  return homePath(session, kind);
}
