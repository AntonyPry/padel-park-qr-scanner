import { describe, expect, it } from 'vitest';
import {
  formatShiftReportsAttentionLabel,
  getShiftReportsAttention,
} from '@/components/shift-reports-attention';

describe('shift reports attention labels', () => {
  it.each<[number, string]>([
    [1, '1 отчет требует внимания'],
    [2, '2 отчета требуют внимания'],
    [4, '4 отчета требуют внимания'],
    [5, '5 отчетов требуют внимания'],
    [11, '11 отчетов требуют внимания'],
    [12, '12 отчетов требуют внимания'],
    [14, '14 отчетов требуют внимания'],
    [21, '21 отчет требует внимания'],
    [22, '22 отчета требуют внимания'],
    [24, '24 отчета требуют внимания'],
    [25, '25 отчетов требуют внимания'],
    [111, '111 отчетов требуют внимания'],
  ])('formats %i actionable reports', (count, expected) => {
    expect(formatShiftReportsAttentionLabel(count, false)).toBe(expected);
  });

  it('preserves the overdue suffix after the declined count', () => {
    expect(formatShiftReportsAttentionLabel(2, true)).toBe(
      '2 отчета требуют внимания, есть просроченные',
    );
  });

  it('counts only actionable reports and marks overdue attention', () => {
    expect(
      getShiftReportsAttention([
        { computedStatus: 'draft' },
        { computedStatus: 'overdue' },
        { computedStatus: 'submitted' },
      ]),
    ).toEqual({
      ariaLabel: '2 отчета требуют внимания, есть просроченные',
      count: 2,
      hasOverdue: true,
      label: '2',
    });
  });
});
