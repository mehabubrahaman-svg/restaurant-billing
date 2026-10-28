import { Bluetooth, Circle, RefreshCw, WifiOff, type LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

/** How this device currently reaches the Hub (wireframes §1, "Offline visible"). */
export type ConnectionStatus = 'live' | 'reconnecting' | 'bluetooth' | 'offline';

interface StatusLook {
  readonly icon: LucideIcon;
  readonly className: string;
  readonly iconClassName?: string;
}

// Colour is never the only signal: each status also has its own icon and the label text.
const LOOKS: Record<ConnectionStatus, StatusLook> = {
  live: {
    icon: Circle,
    className: 'border-state-available bg-state-available-soft text-state-available-fg',
    iconClassName: 'fill-current',
  },
  reconnecting: {
    icon: RefreshCw,
    className: 'border-state-reserved bg-state-reserved-soft text-state-reserved-fg',
    iconClassName: 'motion-safe:animate-spin [animation-duration:2s]',
  },
  bluetooth: {
    icon: Bluetooth,
    className: 'border-state-occupied bg-state-occupied-soft text-state-occupied-fg',
  },
  offline: {
    icon: WifiOff,
    className: 'border-state-danger bg-state-danger-soft text-state-danger-fg',
  },
};

export type StatusPillProps = Omit<ComponentProps<'div'>, 'children'> & {
  status: ConnectionStatus;
  /** Short, translated status text, e.g. "Live". */
  label: ReactNode;
  /** Optional second part, e.g. "3 actions queued". */
  detail?: ReactNode;
};

/**
 * Persistent connection indicator. It is a polite live region, so screen
 * readers announce changes without stealing focus.
 */
export function StatusPill({ status, label, detail, className, ...props }: StatusPillProps) {
  const look = LOOKS[status];
  const Icon = look.icon;
  return (
    <div
      role="status"
      aria-live="polite"
      data-status={status}
      className={cn(
        'inline-flex min-h-9 max-w-full items-center gap-2 rounded-full border px-3 py-1 text-sm leading-tight font-medium',
        'transition-colors duration-200',
        look.className,
        className,
      )}
      {...props}
    >
      <Icon
        aria-hidden="true"
        data-icon={status}
        className={cn('size-4 shrink-0', look.iconClassName)}
      />
      <span>{label}</span>
      {detail !== undefined && (
        <>
          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-current opacity-40" />
          <span className="font-normal">{detail}</span>
        </>
      )}
    </div>
  );
}
