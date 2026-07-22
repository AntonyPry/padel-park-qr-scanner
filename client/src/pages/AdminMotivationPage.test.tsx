import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminMotivationPage, {
  AdminMotivationSettings,
} from '@/pages/AdminMotivationPage';

const mocks = vi.hoisted(() => ({
  activeShift: null as null | {
    adminName: string;
    date: string;
    id: number;
    startedAt: string;
    status: 'active';
  },
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
  useAuthorizationRole: () => 'owner',
}));

vi.mock('@/components/shift-workspace-state', () => ({
  useShiftWorkspaceOptional: () => ({
    activeShift: mocks.activeShift,
    loaded: true,
    setActiveShift: vi.fn(),
  }),
}));

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}

beforeEach(() => {
  mocks.activeShift = null;
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
    render(
      <MemoryRouter>
        <AdminMotivationPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Смена не начата')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Начать смену' })).not.toBeInTheDocument();
    expect(screen.queryByText('Бонусные правила')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Создать' })).not.toBeInTheDocument();
    expect(
      mocks.apiFetch.mock.calls.some(([input]) => input === '/api/shifts/active'),
    ).toBe(false);
  });

  it('keeps rule forms in Shift settings without loading operational data', async () => {
    render(
      <MemoryRouter>
        <AdminMotivationSettings />
      </MemoryRouter>,
    );

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

  it('keeps the motivation progress header concise during an active shift', async () => {
    mocks.activeShift = {
      adminName: 'Администратор',
      date: '2026-07-16',
      id: 12,
      startedAt: '2026-07-16T09:00:00.000Z',
      status: 'active',
    };

    render(
      <MemoryRouter>
        <AdminMotivationPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Прогресс мотиваций')).toBeInTheDocument();
    expect(
      screen.queryByText(/Что уже продано, какой бонус начислится/),
    ).not.toBeInTheDocument();
  });
});
