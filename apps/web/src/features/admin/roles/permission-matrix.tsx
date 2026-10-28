import type { Permission } from '@restroos/contracts';
import { Checkbox } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { moduleLabel, permissionLabel } from './permission-labels';

/** Groups permissions by module, keeping the Hub's order within each. */
export function groupByModule(permissions: readonly Permission[]): [string, Permission[]][] {
  const groups = new Map<string, Permission[]>();
  for (const p of permissions) {
    const list = groups.get(p.module) ?? [];
    list.push(p);
    groups.set(p.module, list);
  }
  return [...groups];
}

/** Checkbox grid grouped by module, each with a module-level "select all". */
export function PermissionMatrix({
  permissions,
  selected,
  onChange,
  readOnly = false,
}: {
  permissions: readonly Permission[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();

  function setMany(codes: readonly string[], on: boolean) {
    const next = new Set(selected);
    for (const c of codes) {
      if (on) next.add(c);
      else next.delete(c);
    }
    onChange(next);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {groupByModule(permissions).map(([module, items]) => {
        const codes = items.map((p) => p.code);
        const count = codes.filter((c) => selected.has(c)).length;
        const name = moduleLabel(t, module);
        return (
          <fieldset key={module} className="rounded-xl border bg-surface p-4">
            <legend className="sr-only">{name}</legend>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-1">
              <Checkbox
                className="font-semibold"
                label={name}
                description={t('roles.selectedOf', { count, total: codes.length })}
                checked={count === codes.length}
                indeterminate={count > 0 && count < codes.length}
                disabled={readOnly}
                aria-label={t('roles.selectAll', { module: name })}
                onChange={(e) => setMany(codes, e.target.checked)}
              />
            </div>
            <div className="flex flex-col">
              {items.map((p) => (
                <Checkbox
                  key={p.code}
                  label={permissionLabel(t, p.code, p.description)}
                  description={<span className="font-mono text-xs">{p.code}</span>}
                  checked={selected.has(p.code)}
                  disabled={readOnly}
                  onChange={(e) => setMany([p.code], e.target.checked)}
                />
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
