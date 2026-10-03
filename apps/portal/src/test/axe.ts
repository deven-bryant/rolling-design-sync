import { axe } from 'jest-axe';
import { expect } from 'vitest';

/** Fails with a readable list when axe finds violations in `container`. */
export async function expectNoAxeViolations(container: Element): Promise<void> {
  const { violations } = await axe(container);
  expect(violations.map(v => `${v.id}: ${v.help} (${v.nodes.map(n => n.html).join(', ')})`)).toEqual([]);
}
