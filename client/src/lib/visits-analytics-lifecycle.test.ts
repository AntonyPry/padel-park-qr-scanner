import { describe, expect, it } from 'vitest';
import { getLifecycleChangeColorClass } from './visits-analytics-lifecycle';

describe('lifecycle change colors', () => {
  it('uses direct semantics for healthy statuses', () => {
    expect(getLifecycleChangeColorClass('regular', 2)).toContain('text-emerald');
    expect(getLifecycleChangeColorClass('regular', -2)).toContain('text-red');
  });

  it.each(['atRisk', 'sleeping', 'lost'] as const)('inverts growth semantics for %s', (status) => {
    expect(getLifecycleChangeColorClass(status, 2)).toContain('text-red');
    expect(getLifecycleChangeColorClass(status, -2)).toContain('text-emerald');
    expect(getLifecycleChangeColorClass(status, 0)).toBe('text-muted-foreground');
  });
});
