import type { FloorArea } from '@restroos/contracts';
import { cn } from '@restroos/ui';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';

/**
 * Floor area tabs (Ground, Rooftop, AC Hall…). They wrap rather than scroll,
 * so every area stays one tap away; arrow keys move between them.
 */
export function AreaTabs({
  label,
  areas,
  value,
  onChange,
  panelId,
  after,
  describe,
}: {
  label: string;
  areas: readonly FloorArea[];
  value: string | null;
  onChange: (id: string) => void;
  /** id of the element the tabs control. */
  panelId: string;
  /** Extra controls after the tabs (e.g. "Add area"). */
  after?: ReactNode;
  /** Optional suffix per tab, e.g. a "retired" note. */
  describe?: (area: FloorArea) => string | null;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    areas.findIndex((a) => a.id === value),
  );

  function onKeyDown(event: KeyboardEvent) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0 || areas.length === 0) return;
    event.preventDefault();
    const next = (index + step + areas.length) % areas.length;
    onChange(areas[next]!.id);
    refs.current[next]?.focus();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-2" onKeyDown={onKeyDown}>
        {areas.map((area, i) => {
          const selected = i === index;
          const note = describe?.(area) ?? null;
          return (
            <button
              key={area.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(area.id)}
              className={cn(
                'min-h-touch rounded-lg border px-4 text-base font-medium',
                selected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-surface hover:bg-muted',
                !area.isActive && 'border-dashed',
              )}
            >
              {area.name}
              {note !== null && (
                <span className="ms-1 text-sm font-normal opacity-80">({note})</span>
              )}
            </button>
          );
        })}
      </div>
      {after}
    </div>
  );
}
