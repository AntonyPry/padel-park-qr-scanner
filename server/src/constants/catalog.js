const PNL_GROUPS = {
  REVENUE_POS: { type: 'income', label: 'Касса Эвотор' },
  REVENUE_EXT: { type: 'income', label: 'Выручка вне кассы' },
  COGS: { type: 'expense', label: 'Себестоимость' },
  FEES: { type: 'expense', label: 'Комиссии' },
  OPEX: { type: 'expense', label: 'Операционные расходы' },
};

const PNL_GROUP_VALUES = Object.keys(PNL_GROUPS);
const FINANCE_TYPES = ['income', 'expense'];

module.exports = {
  FINANCE_TYPES,
  PNL_GROUPS,
  PNL_GROUP_VALUES,
};
