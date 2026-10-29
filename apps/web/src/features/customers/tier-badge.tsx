import type { GuestTier } from '@restroos/contracts';
import { Badge, Crown } from '@restroos/ui';

/** The tier's name as a badge, for lists and the counter. */
export function TierBadge({ tier }: { tier: GuestTier | null }) {
  if (tier === null) return null;
  return (
    <Badge variant="info" className="whitespace-nowrap">
      <Crown aria-hidden="true" className="size-3" />
      {tier.name}
    </Badge>
  );
}
