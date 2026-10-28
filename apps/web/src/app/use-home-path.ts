import { useDeviceStore } from '../stores/device-store';
import { useSessionStore } from '../stores/session-store';
import { homePath } from './portals';

export function useHomePath(): string {
  const user = useSessionStore((s) => s.user);
  const kind = useDeviceStore((s) => s.kind);
  return homePath(user, kind);
}
