export type NumericFilterValue = number | string | null | undefined;

export interface ClientsListQueryFilters {
  includeMerged?: boolean;
  lastVisitDaysFrom?: NumericFilterValue;
  lastVisitDaysTo?: NumericFilterValue;
  page: number;
  pageSize?: number | string;
  q?: string;
  segment: string;
  sourceId?: string;
  status: string;
  trainingLevel?: string;
  visitCategoryId?: string;
  visitCountMax?: NumericFilterValue;
  visitCountMin?: NumericFilterValue;
}

export function parseNonNegativeNumericFilter(value: NumericFilterValue) {
  if (value === undefined || value === null) return null;

  const trimmedValue = String(value).trim();
  if (!trimmedValue) return null;

  const numberValue = Number(trimmedValue);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

export function normalizeNumericFilterInput(value: NumericFilterValue) {
  const numberValue = parseNonNegativeNumericFilter(value);
  return numberValue === null ? '' : String(numberValue);
}

export function appendNumericFilter(
  params: URLSearchParams,
  key: string,
  value: NumericFilterValue,
) {
  const numberValue = parseNonNegativeNumericFilter(value);
  if (numberValue !== null) {
    params.set(key, String(numberValue));
  }
}

export function buildClientsListQueryString(filters: ClientsListQueryFilters) {
  const params = new URLSearchParams({
    page: String(filters.page),
    pageSize: String(filters.pageSize || 10),
    segment: filters.segment,
    status: filters.status,
  });

  if (filters.q?.trim()) params.set('q', filters.q.trim());
  if (filters.sourceId && filters.sourceId !== 'all') {
    params.set('sourceId', filters.sourceId);
  }
  if (filters.visitCategoryId && filters.visitCategoryId !== 'all') {
    params.set('visitCategoryId', filters.visitCategoryId);
  }
  if (filters.trainingLevel && filters.trainingLevel !== 'all') {
    params.set('trainingLevel', filters.trainingLevel);
  }
  if (filters.includeMerged) params.set('includeMerged', 'true');

  appendNumericFilter(params, 'visitCountMin', filters.visitCountMin);
  appendNumericFilter(params, 'visitCountMax', filters.visitCountMax);
  appendNumericFilter(params, 'lastVisitDaysFrom', filters.lastVisitDaysFrom);
  appendNumericFilter(params, 'lastVisitDaysTo', filters.lastVisitDaysTo);

  return params.toString();
}
