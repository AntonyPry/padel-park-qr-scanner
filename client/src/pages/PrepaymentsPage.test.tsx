import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PrepaymentsPage from '@/pages/PrepaymentsPage';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  realtimeRefresh: null as null | (() => void),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: mocks.apiFetch,
  getApiErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
  readApiError: async () => ({ message: 'Не удалось загрузить предоплаты' }),
}));

vi.mock('@/lib/realtime', () => ({
  useRealtimeRefresh: (_targets: string[], refresh: () => void) => {
    mocks.realtimeRefresh = refresh;
  },
}));

function makeDashboard({
  corporateBalance = 251400,
  pendingSales = 4,
}: {
  corporateBalance?: number;
  pendingSales?: number;
} = {}) {
  return {
    filters: {
      expiringDays: 14,
      expiry: 'all',
      limit: 12,
      lowBalanceThreshold: 1000,
      q: '',
      status: 'all',
      type: 'all',
    },
    generatedAt: '2026-07-14T12:00:00.000Z',
    permissions: {
      certificates: true,
      corporateBalances: true,
      pendingSales: true,
      subscriptions: true,
    },
    sections: {
      certificates: { available: true, items: [], total: 0 },
      corporateBalances: { available: true, items: [], total: 0 },
      pendingSales: { available: true, items: [], total: 0 },
      subscriptions: { available: true, items: [], total: 0 },
    },
    summary: {
      activeCertificates: {
        amountRemaining: 3000,
        count: 71,
        lowBalance: 0,
        serviceUnitsRemaining: 5,
      },
      activeSubscriptions: {
        count: 8,
        expiringSoon: 2,
        lowRemaining: 1,
        saleAmount: 50000,
      },
      corporateBalances: {
        count: 2,
        lowBalance: 0,
        totalBalance: corporateBalance,
      },
      expiringSoon: {
        certificates: 1,
        subscriptions: 2,
        total: 3,
      },
      pendingSales: {
        amount: 11600,
        count: pendingSales,
      },
    },
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/prepayments']}>
      <PrepaymentsPage />
    </MemoryRouter>,
  );
}

function metricCard(label: string) {
  return screen
    .getByText(label, { selector: '[data-slot="card-description"]' })
    .closest('[data-testid="prepayments-metric-card"]');
}

afterEach(() => {
  cleanup();
  mocks.apiFetch.mockReset();
  mocks.realtimeRefresh = null;
});

describe('PrepaymentsPage KPI stability', () => {
  it('renders a first-frame skeleton and keeps full labels in a two-column header', async () => {
    mocks.apiFetch.mockResolvedValueOnce(jsonResponse(makeDashboard()));

    renderPage();

    expect(screen.getByTestId('prepayments-metrics-skeleton')).toBeInTheDocument();

    const labels = [
      'Ожидают привязки',
      'Активные абонементы',
      'Скоро истекают',
      'Активные сертификаты',
      'Корпоративные балансы',
    ];

    for (const label of labels) {
      const description = await screen.findByText(label, {
        selector: '[data-slot="card-description"]',
      });
      expect(description.className).not.toContain('truncate');
      expect(description.closest('[data-slot="card-header"]')?.className).toContain(
        'grid-cols-[minmax(0,1fr)_auto]',
      );
      expect(
        description.closest('[data-slot="card"]')?.querySelector('[data-slot="card-action"]'),
      ).not.toBeNull();
    }

    const corporateCard = metricCard('Корпоративные балансы');
    expect(corporateCard?.textContent?.replace(/[\u00a0\u202f]/g, ' ')).toContain(
      '251 400 ₽',
    );
    expect(
      corporateCard?.querySelector('[data-slot="card-title"] span')?.className,
    ).toContain('whitespace-nowrap');
  });

  it('keeps the current dashboard visible during a realtime refresh', async () => {
    const refreshResponse = deferred<Response>();
    mocks.apiFetch
      .mockResolvedValueOnce(jsonResponse(makeDashboard({ corporateBalance: 251400 })))
      .mockImplementationOnce(() => refreshResponse.promise);

    renderPage();
    await waitFor(() =>
      expect(
        metricCard('Корпоративные балансы')?.textContent?.replace(
          /[\u00a0\u202f]/g,
          ' ',
        ),
      ).toContain('251 400 ₽'),
    );

    act(() => mocks.realtimeRefresh?.());

    expect(screen.queryByTestId('prepayments-metrics-skeleton')).not.toBeInTheDocument();
    expect(screen.getByTestId('prepayments-metrics-grid')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(metricCard('Корпоративные балансы')?.textContent).toContain('251');

    await act(async () => {
      refreshResponse.resolve(
        jsonResponse(makeDashboard({ corporateBalance: 999999 })),
      );
      await refreshResponse.promise;
    });

    await waitFor(() =>
      expect(
        metricCard('Корпоративные балансы')?.textContent?.replace(
          /[\u00a0\u202f]/g,
          ' ',
        ),
      ).toContain('999 999 ₽'),
    );
    expect(screen.getByTestId('prepayments-metrics-grid')).toHaveAttribute(
      'aria-busy',
      'false',
    );
  });

  it('keeps the dashboard visible and offers retry after a background refresh error', async () => {
    mocks.apiFetch
      .mockResolvedValueOnce(
        jsonResponse(makeDashboard({ corporateBalance: 251400 })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Недоступно' }), { status: 500 }),
      )
      .mockResolvedValueOnce(
        jsonResponse(makeDashboard({ corporateBalance: 999999 })),
      );

    renderPage();
    await waitFor(() =>
      expect(
        metricCard('Корпоративные балансы')?.textContent?.replace(
          /[\u00a0\u202f]/g,
          ' ',
        ),
      ).toContain('251 400 ₽'),
    );

    act(() => mocks.realtimeRefresh?.());

    const staleNotice = await screen.findByTestId('prepayments-stale-notice');
    expect(staleNotice).toHaveTextContent('Сводка не обновлена');
    expect(staleNotice).toHaveTextContent(
      'Показаны последние успешно загруженные данные',
    );
    expect(screen.queryByTestId('prepayments-metrics-skeleton')).not.toBeInTheDocument();
    expect(metricCard('Корпоративные балансы')?.textContent).toContain('251');
    expect(screen.getByTestId('prepayments-metrics-grid')).toHaveAttribute(
      'aria-busy',
      'false',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));

    await waitFor(() =>
      expect(
        metricCard('Корпоративные балансы')?.textContent?.replace(
          /[\u00a0\u202f]/g,
          ' ',
        ),
      ).toContain('999 999 ₽'),
    );
    expect(screen.queryByTestId('prepayments-stale-notice')).not.toBeInTheDocument();
    expect(screen.getByTestId('prepayments-metrics-grid')).toHaveAttribute(
      'aria-busy',
      'false',
    );
  });

  it('marks stale data when a search request fails', async () => {
    mocks.apiFetch
      .mockResolvedValueOnce(jsonResponse(makeDashboard({ pendingSales: 4 })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Недоступно' }), { status: 500 }),
      );

    renderPage();
    await screen.findByText('4', { selector: '[data-slot="card-title"] span' });

    fireEvent.change(screen.getByPlaceholderText('Клиент, сертификат или компания'), {
      target: { value: 'неуспешный поиск' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));

    const staleNotice = await screen.findByTestId('prepayments-stale-notice');
    expect(staleNotice).toHaveTextContent('Поиск и фильтры не применены');
    expect(staleNotice).toHaveTextContent(
      'Показана последняя успешно загруженная сводка',
    );
    expect(mocks.apiFetch).toHaveBeenLastCalledWith(
      '/api/prepayments/dashboard?limit=12&q=%D0%BD%D0%B5%D1%83%D1%81%D0%BF%D0%B5%D1%88%D0%BD%D1%8B%D0%B9+%D0%BF%D0%BE%D0%B8%D1%81%D0%BA',
    );
    expect(
      metricCard('Ожидают привязки')?.querySelector('[data-slot="card-title"]')
        ?.textContent,
    ).toBe('4');
    expect(screen.queryByTestId('prepayments-metrics-skeleton')).not.toBeInTheDocument();
    expect(screen.getByTestId('prepayments-metrics-grid')).toHaveAttribute(
      'aria-busy',
      'false',
    );
  });

  it('replaces the first-frame skeleton with a distinct initial error state', async () => {
    mocks.apiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Недоступно' }), { status: 500 }),
    );

    renderPage();
    expect(screen.getByTestId('prepayments-metrics-skeleton')).toBeInTheDocument();

    await screen.findByText('Не удалось загрузить сводку');
    expect(screen.queryByTestId('prepayments-metrics-skeleton')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('prepayments-metric-card')).toHaveLength(0);
  });

  it('does not let an older request overwrite a newer filter result', async () => {
    const firstResponse = deferred<Response>();
    const secondResponse = deferred<Response>();
    mocks.apiFetch
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => secondResponse.promise);

    renderPage();
    fireEvent.change(screen.getByPlaceholderText('Клиент, сертификат или компания'), {
      target: { value: 'новый фильтр' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(2));

    await act(async () => {
      secondResponse.resolve(jsonResponse(makeDashboard({ pendingSales: 9 })));
      await secondResponse.promise;
    });
    await screen.findByText('9', { selector: '[data-slot="card-title"] span' });

    await act(async () => {
      firstResponse.resolve(jsonResponse(makeDashboard({ pendingSales: 1 })));
      await firstResponse.promise;
    });

    expect(
      metricCard('Ожидают привязки')?.querySelector('[data-slot="card-title"]')
        ?.textContent,
    ).toBe('9');
  });
});
