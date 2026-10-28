export interface DiffRow {
  readonly path: string;
  readonly before: string | undefined;
  readonly after: string | undefined;
  readonly kind: 'added' | 'removed' | 'changed';
}

function flatten(value: unknown, prefix: string, out: Map<string, string>): Map<string, string> {
  if (value !== null && typeof value === 'object') {
    const entries = Array.isArray(value)
      ? value.map((v, i) => [String(i), v] as const)
      : Object.entries(value as Record<string, unknown>);
    if (entries.length === 0 && prefix !== '') out.set(prefix, Array.isArray(value) ? '[]' : '{}');
    for (const [k, v] of entries) flatten(v, prefix === '' ? k : `${prefix}.${k}`, out);
  } else if (value !== undefined) {
    out.set(prefix, JSON.stringify(value));
  }
  return out;
}

/** Field-by-field difference of two JSON snapshots, sorted by path. */
export function jsonDiff(before: unknown, after: unknown): DiffRow[] {
  const a = flatten(before ?? {}, '', new Map());
  const b = flatten(after ?? {}, '', new Map());
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  const rows: DiffRow[] = [];
  for (const path of paths) {
    const x = a.get(path);
    const y = b.get(path);
    if (x === y) continue;
    rows.push({
      path: path === '' ? '(value)' : path,
      before: x,
      after: y,
      kind: x === undefined ? 'added' : y === undefined ? 'removed' : 'changed',
    });
  }
  return rows;
}
