import { CircleCheck, Info, TriangleAlert, OctagonAlert, type LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const LOOKS: Record<AlertTone, { icon: LucideIcon; className: string }> = {
  info: { icon: Info, className: 'border-state-occupied bg-state-occupied-soft' },
  success: { icon: CircleCheck, className: 'border-state-available bg-state-available-soft' },
  warning: { icon: TriangleAlert, className: 'border-state-reserved bg-state-reserved-soft' },
  danger: { icon: OctagonAlert, className: 'border-state-danger bg-state-danger-soft' },
};

const ICON_COLOUR: Record<AlertTone, string> = {
  info: 'text-state-occupied-fg',
  success: 'text-state-available-fg',
  warning: 'text-state-reserved-fg',
  danger: 'text-state-danger-fg',
};

export type AlertProps = Omit<ComponentProps<'div'>, 'title'> & {
  readonly tone?: AlertTone;
  readonly title?: ReactNode;
};

/**
 * A callout. Pass `role="alert"` when it appears in response to an action
 * (e.g. a failed save) so screen readers announce it.
 */
export function Alert({ tone = 'info', title, children, className, ...props }: AlertProps) {
  const look = LOOKS[tone];
  const Icon = look.icon;
  return (
    <div
      data-tone={tone}
      className={cn('flex gap-3 rounded-lg border p-3 text-sm', look.className, className)}
      {...props}
    >
      <Icon aria-hidden="true" className={cn('mt-0.5 size-5 shrink-0', ICON_COLOUR[tone])} />
      <div className="flex min-w-0 flex-col gap-1">
        {title !== undefined && <p className="font-semibold">{title}</p>}
        {children !== undefined && <div className="text-foreground">{children}</div>}
      </div>
    </div>
  );
}
