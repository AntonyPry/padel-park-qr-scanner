import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import RevenueLtvTab from './revenue-ltv-tab';

const getRevenueLtv = vi.hoisted(() => vi.fn());
vi.mock('@/api/visits-analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/visits-analytics')>();
  return { ...actual, getRevenueLtv };
});

afterEach(cleanup);

function response(attributedRevenue = 100) {
  const metric = { eligibleCount: 1, lowSample: true, revenue: attributedRevenue, value: attributedRevenue };
  return {
    from: '2026-01-01', to: '2026-01-31', asOf: '2026-01-31', timeZone: 'Europe/Moscow', appliedSourceKeys: [],
    availableSources: [
      { sourceId: 1, sourceKey: 'id:1', source: 'VK', clientCount: 1, actionableCount: 1 },
      { sourceId: 2, sourceKey: 'id:2', source: 'Радио', clientCount: 1, actionableCount: 1 },
    ],
    summary: {
      attributedRevenue, cohortAttributedRevenue: attributedRevenue, acquiredClients: 1,
      payingClients: 1, payerConversion: 100, averageRevenuePerAcquiredClient: attributedRevenue,
      averageRevenuePerPayingClient: attributedRevenue, ltv30: metric, ltv60: metric,
      ltv90: metric, lifetimeLtv: metric, coveragePercent: 100,
    },
    sources: [{
      sourceId: 1, sourceKey: 'id:1', source: 'VK', acquiredClients: 1,
      payingClients: 1, payerConversion: 100, attributedRevenue,
      averageRevenuePerAcquiredClient: attributedRevenue,
      averageRevenuePerPayingClient: attributedRevenue,
      ltv30: metric, ltv60: metric, ltv90: metric, lifetimeLtv: metric,
      matureSample: { days30: 1, days60: 1, days90: 1 },
      reliability: { key: 'low_sample', label: 'Мало данных' },
    }],
    cohorts: { months: [0], rows: [{ cohortMonth: '2026-01', cohortSize: 1, values: [{ monthIndex: 0, value: attributedRevenue, revenue: attributedRevenue, isMature: true, windowEnd: '2026-01-31' }] }] },
    coverage: {
      cashNetRevenue: attributedRevenue, cashMovementAmount: attributedRevenue,
      attributedCashRevenue: attributedRevenue, attributedCashMovementAmount: attributedRevenue,
      allAttributedCashRevenue: attributedRevenue, allAttributedCashMovementAmount: attributedRevenue,
      unlinkedCashRevenue: 0, unlinkedCashMovementAmount: 0,
      outsideSelectedSourcesCashRevenue: 0, coveragePercent: 100,
      selectedCashSharePercent: 100, paybackCount: 0,
      unlinkedPaybackCount: 0, unlinkedPaybackAmount: 0,
      unknownClientAmount: 0, ambiguousClientAmount: 0, duplicateRiskAmount: 0,
      receiptItemReconciliationDifference: 0, periodAttributedRevenue: attributedRevenue,
      legacySales: { amount: 0, count: 0 },
      bookingPaymentsReference: 0, manualFinanceWithoutClient: 0,
      corporateLedgerExcludedAmount: 0, sourceFilterScope: 'all_sources',
    },
  };
}

describe('RevenueLtvTab', () => {
  it('keeps successful data visible while a source-filter refetch is pending', async () => {
    let resolveFiltered: (value: ReturnType<typeof response>) => void = () => {};
    const filtered = new Promise<ReturnType<typeof response>>((resolve) => { resolveFiltered = resolve; });
    getRevenueLtv.mockReset();
    getRevenueLtv.mockResolvedValueOnce(response(100)).mockReturnValueOnce(filtered);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <RevenueLtvTab from="2026-01-01" to="2026-01-31" />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    await screen.findByText('Атрибутированная выручка');
    expect(document.body.textContent).toContain('100');
    await userEvent.click(screen.getByRole('button', { name: /Радио/ }));
    await waitFor(() => expect(getRevenueLtv).toHaveBeenLastCalledWith({
      from: '2026-01-01',
      sources: ['id:1'],
      to: '2026-01-31',
    }));
    expect(document.body.textContent).toContain('100');
    expect(screen.getByText('Обновляем данные')).toBeInTheDocument();
    resolveFiltered(response(70));
    expect(await screen.findAllByText(/70/)).not.toHaveLength(0);
  });

  it('keeps the last successful data visible when a background source-filter refetch fails', async () => {
    getRevenueLtv.mockReset();
    getRevenueLtv.mockResolvedValueOnce(response(100)).mockRejectedValueOnce(new Error('network unavailable'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <RevenueLtvTab from="2026-01-01" to="2026-01-31" />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    await screen.findByText('Атрибутированная выручка');
    await userEvent.click(screen.getByRole('button', { name: /Радио/ }));
    expect(await screen.findByText('Не удалось обновить данные. Показан последний успешный результат.')).toBeInTheDocument();
    expect(document.body.textContent).toContain('100');
    expect(screen.getByText('Основные показатели')).toBeInTheDocument();
  });

  it('shows the dedicated error state when the initial request fails', async () => {
    getRevenueLtv.mockReset();
    getRevenueLtv.mockRejectedValueOnce(new Error('network unavailable'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <RevenueLtvTab from="2026-01-01" to="2026-01-31" />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Выручка и LTV не загрузились')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });
});
