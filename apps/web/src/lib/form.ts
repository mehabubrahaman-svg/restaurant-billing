/** Minimal shape of a zod safeParse result, so the app needs no direct zod import. */
export type ParseResult =
  | { success: true }
  | { success: false; error: { issues: readonly { path: readonly PropertyKey[] }[] } };

/**
 * Maps schema issues to one translated-message key per top-level field.
 * Server-side zod messages are English; users see our catalogue text instead.
 */
export function fieldErrors<F extends string, K extends string>(
  result: ParseResult,
  messages: Readonly<Record<F, K>>,
): Partial<Record<F, K>> {
  if (result.success) return {};
  const errors: Partial<Record<F, K>> = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? '') as F;
    if (field in messages && errors[field] === undefined) errors[field] = messages[field];
  }
  return errors;
}
