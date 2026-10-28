import { LoaderCircle } from 'lucide-react';
import { cn } from '../lib/cn';

/** Busy indicator. Pair it with visible or `label` text; the icon itself is hidden. */
export function Spinner({ label, className }: { label?: string; className?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2', className)}>
      <LoaderCircle aria-hidden="true" className="size-5 motion-safe:animate-spin" />
      {label !== undefined && <span>{label}</span>}
    </span>
  );
}
