import {
  BellRing,
  Check,
  CheckCheck,
  Circle,
  CircleCheck,
  CircleDot,
  Clock,
  Flame,
  IndianRupee,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

/** Dining table states (wireframes §1). */
export type TableState = 'available' | 'occupied' | 'billing' | 'reserved' | 'cleaning';
/** KOT lifecycle (NEW → ACCEPTED → COOKING → READY → SERVED), plus the KDS delay flag. */
export type KotState = 'new' | 'accepted' | 'cooking' | 'ready' | 'served' | 'delayed';
export type ChipState = TableState | KotState;

/** The six colour tokens shared across portals. */
export type StateTone = 'available' | 'occupied' | 'billing' | 'reserved' | 'cleaning' | 'danger';

interface ChipLook {
  readonly tone: StateTone;
  readonly icon: LucideIcon;
  readonly iconClassName?: string;
}

/**
 * KOT states reuse the six table tones (so the palette stays small and
 * learnable) but each state has its own icon, so two chips that share a
 * colour are still told apart without relying on colour.
 */
export const CHIP_LOOKS: Readonly<Record<ChipState, ChipLook>> = {
  available: { tone: 'available', icon: Circle },
  occupied: { tone: 'occupied', icon: CircleDot },
  billing: { tone: 'billing', icon: IndianRupee },
  reserved: { tone: 'reserved', icon: Clock },
  cleaning: { tone: 'cleaning', icon: Sparkles },
  new: { tone: 'occupied', icon: BellRing },
  accepted: { tone: 'billing', icon: Check },
  cooking: { tone: 'reserved', icon: Flame },
  ready: { tone: 'available', icon: CircleCheck },
  served: { tone: 'cleaning', icon: CheckCheck },
  delayed: { tone: 'danger', icon: TriangleAlert, iconClassName: 'motion-safe:animate-pulse' },
};

const TONE_CLASSES: Record<StateTone, string> = {
  available: 'border-state-available bg-state-available-soft text-state-available-fg',
  occupied: 'border-state-occupied bg-state-occupied-soft text-state-occupied-fg',
  billing: 'border-state-billing bg-state-billing-soft text-state-billing-fg',
  reserved: 'border-state-reserved bg-state-reserved-soft text-state-reserved-fg',
  cleaning: 'border-state-cleaning bg-state-cleaning-soft text-state-cleaning-fg',
  danger: 'border-state-danger bg-state-danger-soft text-state-danger-fg',
};

export type StateChipProps = Omit<ComponentProps<'span'>, 'children'> & {
  state: ChipState;
  /** Translated state name, e.g. "Occupied". */
  label: ReactNode;
  /** Optional trailing detail such as elapsed time ("32 min"). */
  meta?: ReactNode;
  size?: 'sm' | 'md';
};

export function StateChip({
  state,
  label,
  meta,
  size = 'md',
  className,
  ...props
}: StateChipProps) {
  const look = CHIP_LOOKS[state];
  const Icon = look.icon;
  return (
    <span
      data-state={state}
      data-tone={look.tone}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-md border font-medium leading-tight',
        'transition-colors duration-200',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
        TONE_CLASSES[look.tone],
        className,
      )}
      {...props}
    >
      <Icon
        aria-hidden="true"
        data-icon={state}
        className={cn(size === 'sm' ? 'size-3.5' : 'size-4', 'shrink-0', look.iconClassName)}
      />
      <span>{label}</span>
      {meta !== undefined && <span className="font-normal tabular-nums opacity-90">{meta}</span>}
    </span>
  );
}
