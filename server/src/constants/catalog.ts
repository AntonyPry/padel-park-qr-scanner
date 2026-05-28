const PNL_GROUPS = {
  REVENUE_POS: { type: 'income', label: 'Касса Эвотор' },
  REVENUE_EXT: { type: 'income', label: 'Выручка вне кассы' },
  COGS: { type: 'expense', label: 'Себестоимость' },
  FEES: { type: 'expense', label: 'Комиссии' },
  OPEX: { type: 'expense', label: 'Операционные расходы' },
} as const;

type FinanceType = 'income' | 'expense';
type PnlGroup = keyof typeof PNL_GROUPS;

const PNL_GROUP_VALUES = Object.keys(PNL_GROUPS) as PnlGroup[];
const FINANCE_TYPES: FinanceType[] = ['income', 'expense'];

module.exports = {
  FINANCE_TYPES,
  PNL_GROUPS,
  PNL_GROUP_VALUES,
};

export type { FinanceType, PnlGroup };
