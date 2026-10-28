import type { Portal } from '../../app/portals';
import { PortalPlaceholder } from '../portal-placeholder';
import { DisplayCheck } from './display-check';

export function PosPage({ portal }: { portal: Portal }) {
  return (
    <PortalPlaceholder portal={portal}>
      <DisplayCheck />
    </PortalPlaceholder>
  );
}
