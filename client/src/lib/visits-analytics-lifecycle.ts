import type { LifecycleStatus } from '@/api/visits-analytics';

const INVERSE_CHANGE_STATUSES = new Set<LifecycleStatus['key']>(['atRisk', 'sleeping', 'lost']);

export function getLifecycleChangeColorClass(
  statusKey: LifecycleStatus['key'],
  absoluteChange: number,
) {
  if (absoluteChange === 0) return 'text-muted-foreground';
  const isInverse = INVERSE_CHANGE_STATUSES.has(statusKey);
  const isPositiveOutcome = isInverse ? absoluteChange < 0 : absoluteChange > 0;
  return isPositiveOutcome
    ? 'text-emerald-700 dark:text-emerald-400'
    : 'text-red-700 dark:text-red-400';
}
