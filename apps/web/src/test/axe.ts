import axe from 'axe-core';
import { expect } from 'vitest';

/**
 * Runs axe-core on the rendered page (dialogs are portalled to <body>, so the
 * whole body by default). Colour contrast is left to the screenshot review:
 * jsdom has no layout or computed colours to measure.
 */
export async function expectNoAxeViolations(root: Element = document.body): Promise<void> {
  // The shell renders the portal nav twice (side rail, phone bottom bar) and CSS shows one
  // per breakpoint. jsdom applies no media queries, so leave the bottom bar out.
  const context = { include: [root], exclude: [['nav.fixed']] } as unknown as axe.ElementContext;
  const results = await axe.run(context, {
    rules: { 'color-contrast': { enabled: false } },
    resultTypes: ['violations'],
  });
  const violations = results.violations.map(
    (v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
  expect(violations).toEqual([]);
}
