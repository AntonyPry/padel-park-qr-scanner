import type { ShiftReport } from '@/api/shift-reports';

const ACTIONABLE_STATUSES = new Set(['pending', 'draft', 'overdue']);

export interface ShiftReportsAttention {
  ariaLabel: string;
  count: number;
  hasOverdue: boolean;
  label: string;
}

export function formatShiftReportsAttentionLabel(
  count: number,
  hasOverdue: boolean,
) {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;
  let message: string;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    message = `${count} отчетов требуют внимания`;
  } else if (lastDigit === 1) {
    message = `${count} отчет требует внимания`;
  } else if (lastDigit >= 2 && lastDigit <= 4) {
    message = `${count} отчета требуют внимания`;
  } else {
    message = `${count} отчетов требуют внимания`;
  }

  return hasOverdue ? `${message}, есть просроченные` : message;
}

export function getShiftReportsAttention(
  reports: Array<Pick<ShiftReport, 'computedStatus'>>,
): ShiftReportsAttention | null {
  const actionable = reports.filter((report) =>
    ACTIONABLE_STATUSES.has(report.computedStatus),
  );
  if (actionable.length === 0) return null;

  const hasOverdue = actionable.some(
    (report) => report.computedStatus === 'overdue',
  );

  return {
    ariaLabel: formatShiftReportsAttentionLabel(actionable.length, hasOverdue),
    count: actionable.length,
    hasOverdue,
    label: actionable.length > 99 ? '99+' : String(actionable.length),
  };
}
