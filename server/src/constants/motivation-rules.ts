type MotivationRuleUnit = 'currency' | 'hours';

interface DefaultMotivationRule {
  key: string;
  label: string;
  description: string;
  group: 'base';
  unit: MotivationRuleUnit;
  value: number;
  sortOrder: number;
}

const DEFAULT_MOTIVATION_RULES: DefaultMotivationRule[] = [
  {
    key: 'base_hour_rate',
    label: 'Первые часы',
    description: 'Ставка за час до порога переработки.',
    group: 'base',
    unit: 'currency',
    value: 250,
    sortOrder: 10,
  },
  {
    key: 'overtime_hour_rate',
    label: 'Переработка',
    description: 'Ставка за час после порога переработки.',
    group: 'base',
    unit: 'currency',
    value: 300,
    sortOrder: 20,
  },
  {
    key: 'overtime_after_hours',
    label: 'Порог переработки',
    description: 'После скольких часов включается повышенная ставка.',
    group: 'base',
    unit: 'hours',
    value: 12,
    sortOrder: 30,
  },
];

module.exports = {
  DEFAULT_MOTIVATION_RULES,
};
