import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSidebar } from '@/components/app-sidebar';
import ShiftWorkspaceLayout from '@/components/shift-workspace-layout';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AuthContext } from '@/lib/auth-context';
import {
  getRealtimeQueryKeys,
  type CrmChangedEvent,
} from '@/lib/realtime-invalidation';
import type { AccountRole } from '@/lib/roles';

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}));

vi.mock('@/components/theme-toggle', () => ({
  ThemeToggle: () => null,
}));

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  listActiveShiftReports: vi.fn(),
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, apiFetch: mocks.apiFetch };
});

vi.mock('@/api/shift-reports', () => ({
  listActiveShiftReports: mocks.listActiveShiftReports,
}));

class ResizeObserverMock {
  disconnect() {}
  observe() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverMock);

afterEach(() => cleanup());
beforeEach(() => {
  mocks.apiFetch.mockReset().mockResolvedValue(
    new Response(
      JSON.stringify({
        shift: {
          adminName: 'Администратор',
          date: '2026-07-16',
          id: 12,
          startedAt: '2026-07-16T09:00:00.000Z',
          status: 'active',
        },
      }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 },
    ),
  );
  mocks.listActiveShiftReports.mockReset();
  mocks.listActiveShiftReports.mockResolvedValue({ reports: [], shift: null });
});

function renderSidebar(role: AccountRole, path = '/admin/catalog') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AuthContext.Provider
          value={{
            account: {
              id: 1,
              email: `${role}@padelpark.demo`,
              role,
              status: 'active',
            },
            bootstrap: vi.fn(),
            loading: false,
            login: vi.fn(),
            logout: vi.fn(),
            setupRequired: false,
          }}
        >
          <SidebarProvider>
            <AppSidebar />
          </SidebarProvider>
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

function renderSidebarAndWorkspace(path = '/admin/shift/motivation') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AuthContext.Provider
          value={{
            account: {
              id: 1,
              email: 'owner@padelpark.demo',
              role: 'owner',
              status: 'active',
            },
            bootstrap: vi.fn(),
            loading: false,
            login: vi.fn(),
            logout: vi.fn(),
            setupRequired: false,
          }}
        >
          <SidebarProvider>
            <AppSidebar />
            <Routes>
              <Route path="/admin/shift" element={<ShiftWorkspaceLayout />}>
                <Route path="motivation" element={<div>motivation content</div>} />
                <Route path="reports" element={<div>reports content</div>} />
                <Route path="cash" element={<div>cash content</div>} />
              </Route>
            </Routes>
          </SidebarProvider>
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

describe('AppSidebar inventory placeholder', () => {
  it('renders the current Setly brand mark', () => {
    const { container } = renderSidebar('owner');

    expect(screen.getByText('Setly')).toBeInTheDocument();
    expect(
      container.querySelector('img[src="/setly-mark.png?v=20260714"]'),
    ).toBeInTheDocument();
  });

  it.each<AccountRole>(['owner', 'manager', 'accountant'])(
    'shows a disabled coming-soon item for %s',
    (role) => {
      renderSidebar(role);

      const label = screen.getByText('Инвентаризация');
      const button = label.closest('button');

      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAttribute('tabindex', '-1');
      expect(button).not.toHaveAttribute('data-active');
      expect(label.closest('a')).toBeNull();
      expect(label.closest('li')).toHaveAttribute(
        'title',
        'Раздел в разработке',
      );
      expect(screen.getByText('Скоро')).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Справочник товаров' }),
      ).toHaveAttribute('href', '/admin/catalog');
    },
  );

  it.each<AccountRole>(['admin', 'trainer', 'viewer'])(
    'hides the inventory item from %s',
    (role) => {
      renderSidebar(role);

      expect(screen.queryByText('Инвентаризация')).not.toBeInTheDocument();
    },
  );
});

describe('AppSidebar shift navigation', () => {
  it.each<AccountRole>(['owner', 'manager', 'admin'])(
    'shows one Shift item in the workday section for %s',
    (role) => {
      renderSidebar(role);

      const shift = screen.getByRole('link', { name: 'Смена' });
      const workdayLabel = screen.getByText('Рабочий день');
      const workdayGroup = workdayLabel.parentElement;

      expect(shift).toHaveAttribute('href', '/admin/shift/motivation');
      expect(workdayGroup).toContainElement(shift);
      expect(screen.queryByRole('link', { name: 'Мотивация' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Отчеты' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Касса' })).not.toBeInTheDocument();
    },
  );

  it.each<AccountRole>(['accountant', 'viewer', 'trainer'])(
    'hides the Shift section from %s',
    (role) => {
      renderSidebar(role);
      expect(screen.queryByRole('link', { name: 'Смена' })).not.toBeInTheDocument();
      expect(mocks.listActiveShiftReports).not.toHaveBeenCalled();
    },
  );

  it.each([
    '/admin/shift/motivation',
    '/admin/shift/reports',
    '/admin/shift/cash',
  ])('keeps the Shift item active on %s', (path) => {
    renderSidebar('owner', path);
    expect(screen.getByRole('link', { name: 'Смена' })).toHaveAttribute(
      'data-active',
      'true',
    );
  });

  it.each<AccountRole>(['owner', 'manager'])(
    'shows Shift settings for %s',
    (role) => {
      renderSidebar(role);
      expect(screen.getByRole('link', { name: 'Настройки смены' })).toHaveAttribute(
        'href',
        '/admin/shift-settings',
      );
    },
  );

  it.each<AccountRole>(['admin', 'accountant', 'viewer', 'trainer'])(
    'hides Shift settings from %s',
    (role) => {
      renderSidebar(role);
      expect(
        screen.queryByRole('link', { name: 'Настройки смены' }),
      ).not.toBeInTheDocument();
    },
  );

  it('shows an accessible destructive badge for overdue active reports', async () => {
    mocks.listActiveShiftReports.mockResolvedValueOnce({
      reports: [
        { computedStatus: 'draft', id: 1 },
        { computedStatus: 'overdue', id: 2 },
        { computedStatus: 'submitted', id: 3 },
      ],
      shift: { id: 12 },
    });
    renderSidebar('admin', '/admin/shift/reports');

    const badge = await screen.findByLabelText(
      '2 отчетов требуют внимания, есть просроченные',
    );
    expect(badge).toHaveTextContent('2');
    expect(badge).toHaveClass('bg-destructive');
    expect(screen.getByRole('link', { name: 'Смена' })).toHaveAttribute(
      'data-active',
      'true',
    );
  });

  it('keeps the badge hidden for zero actionable reports', async () => {
    renderSidebar('owner');
    await waitFor(() => expect(mocks.listActiveShiftReports).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('keeps navigation usable when the badge API fails', async () => {
    mocks.listActiveShiftReports.mockRejectedValueOnce(new Error('offline'));
    renderSidebar('owner', '/admin/shift/cash');

    await waitFor(() => expect(mocks.listActiveShiftReports).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('link', { name: 'Смена' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/отчетов требуют внимания/)).not.toBeInTheDocument();
  });

  it('keeps sidebar and Reports badges consistent through realtime invalidation', async () => {
    mocks.listActiveShiftReports.mockResolvedValueOnce({
      reports: Array.from({ length: 100 }, (_, index) => ({
        computedStatus: 'pending',
        id: index + 1,
      })),
      shift: { id: 12 },
    });
    const { queryClient } = renderSidebarAndWorkspace();

    const initialBadges = await screen.findAllByLabelText(
      '100 отчетов требуют внимания',
    );
    expect(initialBadges).toHaveLength(2);
    for (const badge of initialBadges) expect(badge).toHaveTextContent('99+');
    expect(mocks.listActiveShiftReports).toHaveBeenCalledTimes(1);

    mocks.listActiveShiftReports.mockResolvedValueOnce({
      reports: [{ computedStatus: 'draft', id: 1 }],
      shift: { id: 12 },
    });
    const event: CrmChangedEvent = {
      action: 'submitted',
      actorId: null,
      actorRole: null,
      domain: 'shifts',
      entity: 'shift_report',
      entityId: '1',
      hints: { queryGroups: ['shiftReports'] },
      id: 'event-1',
      occurredAt: new Date().toISOString(),
      source: 'api',
    };
    for (const queryKey of getRealtimeQueryKeys(event)) {
      await queryClient.invalidateQueries({ queryKey });
    }

    await waitFor(() =>
      expect(
        screen.getAllByLabelText('1 отчетов требуют внимания'),
      ).toHaveLength(2),
    );
    const refreshedBadges = screen.getAllByLabelText(
      '1 отчетов требуют внимания',
    );
    for (const badge of refreshedBadges) {
      expect(badge).toHaveTextContent('1');
      expect(badge).toHaveClass('bg-primary');
    }
    expect(mocks.listActiveShiftReports).toHaveBeenCalledTimes(2);
  });
});
