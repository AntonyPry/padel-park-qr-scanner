export interface MotivationRule {
  id: number;
  key: string;
  label: string;
  description?: string | null;
  group: string;
  unit: 'currency' | 'percent' | 'quantity' | 'hours';
  value: number;
  sortOrder: number;
  isActive: boolean;
}

export type MotivationThresholdType = 'none' | 'revenue' | 'quantity';

export interface MotivationCategory {
  id: number;
  name: string;
  type: 'income' | 'expense' | string;
  group: string;
  parentId?: number | null;
}

export interface MotivationBonusRule {
  id: number;
  name: string;
  description?: string | null;
  bonusPercent: number;
  thresholdType: MotivationThresholdType;
  thresholdValue: number;
  sortOrder: number;
  isActive: boolean;
  categories: MotivationCategory[];
  categoryIds: number[];
}

export type MotivationRulesMap = Record<string, number>;

export function rulesToMap(rules: MotivationRule[]): MotivationRulesMap {
  return rules.reduce<MotivationRulesMap>((acc, rule) => {
    if (rule.isActive) acc[rule.key] = Number(rule.value);
    return acc;
  }, {});
}

export function formatRuleValue(rule: MotivationRule) {
  const value = Number(rule.value).toLocaleString('ru-RU');

  if (rule.unit === 'currency') return `${value} ₽`;
  if (rule.unit === 'percent') return `${value}%`;
  if (rule.unit === 'hours') return `${value} ч`;
  return value;
}

export function calculateBasePay(hours: number, rules: MotivationRulesMap) {
  const overtimeAfter = Number(rules.overtime_after_hours) || 12;
  const baseRate = Number(rules.base_hour_rate) || 0;
  const overtimeRate = Number(rules.overtime_hour_rate) || baseRate;

  return (
    Math.min(hours, overtimeAfter) * baseRate +
    Math.max(0, hours - overtimeAfter) * overtimeRate
  );
}

export function formatThreshold(rule: MotivationBonusRule) {
  if (rule.thresholdType === 'none') return 'Без порога';

  const value = Number(rule.thresholdValue).toLocaleString('ru-RU');
  if (rule.thresholdType === 'quantity') return `от ${value} шт`;

  return `от ${value} ₽`;
}

export function getThresholdLabel(type: MotivationThresholdType) {
  if (type === 'revenue') return 'Порог по сумме';
  if (type === 'quantity') return 'Порог по количеству';

  return 'Без порога';
}
