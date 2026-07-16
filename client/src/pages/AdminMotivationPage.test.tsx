import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminMotivationPage, {
  AdminMotivationSettings,
} from '@/pages/AdminMotivationPage';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, apiFetch: mocks.apiFetch };
});

vi.mock('@/lib/realtime', () => ({
  useRealtimeRefresh: vi.fn(),
}));

vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({ account: { id: 1, role: 'owner' } }),
}));

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}

beforeEach(() => {
  mocks.apiFetch.mockReset().mockImplementation((input: string) => {
    if (input === '/api/motivation/rules') {
      return Promise.resolve(
        jsonResponse([
          {
            group: 'base',
            id: 1,
            isActive: true,
            key: 'base_hour_rate',
            label: 'Почасовая ставка',
            sortOrder: 10,
            unit: 'currency',
            value: 300,
          },
        ]),
      );
    }
    if (input === '/api/motivation/bonus-rules') {
      return Promise.resolve(
        jsonResponse([
          {
            bonusPercent: 5,
            categories: [{ group: 'sales', id: 4, name: 'Бар', type: 'income' }],
            categoryIds: [4],
            id: 2,
            isActive: true,
            name: 'Продажи бара',
            sortOrder: 10,
            thresholdType: 'none',
            thresholdValue: 0,
          },
        ]),
      );
    }
    if (input === '/api/motivation/categories') {
      return Promise.resolve(
        jsonResponse([{ group: 'sales', id: 4, name: 'Бар', type: 'income' }]),
      );
    }
    if (input === '/api/shifts/active') {
      return Promise.resolve(jsonResponse({ shift: null }));
    }
    if (input === '/api/motivation/current-sales?includePaymentSummary=true') {
      return Promise.resolve(
        jsonResponse({ paymentSummary: { cash: 0, cashless: 0, total: 0 }, records: [] }),
      );
    }
    throw new Error(`Unexpected API call: ${input}`);
  });
});

afterEach(() => cleanup());

describe('AdminMotivationPage views', () => {
  it('keeps only operational controls on the Shift workspace', async () => {
    render(<AdminMotivationPage />);

    expect(await screen.findByRole('button', { name: 'Начать смену' })).toBeInTheDocument();
    expect(screen.queryByText('Бонусные правила')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Создать' })).not.toBeInTheDocument();
    expect(
      mocks.apiFetch.mock.calls.some(([input]) => input === '/api/shifts/active'),
    ).toBe(true);
  });

  it('keeps rule forms in Shift settings without loading operational data', async () => {
    render(<AdminMotivationSettings />);

    expect(await screen.findByText('Бонусные правила')).toBeInTheDocument();
    expect(screen.getByText('Продажи бара')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Создать' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Начать смену' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(
        mocks.apiFetch.mock.calls.some(([input]) => input === '/api/shifts/active'),
      ).toBe(false);
      expect(
        mocks.apiFetch.mock.calls.some(
          ([input]) => input === '/api/motivation/current-sales?includePaymentSummary=true',
        ),
      ).toBe(false);
    });
  });
});
