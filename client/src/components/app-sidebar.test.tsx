import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSidebar } from '@/components/app-sidebar';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AuthContext } from '@/lib/auth-context';
import type { AccountRole } from '@/lib/roles';

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}));

vi.mock('@/components/theme-toggle', () => ({
  ThemeToggle: () => null,
}));

const mocks = vi.hoisted(() => ({
  listActiveShiftReports: vi.fn(),
}));

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
  mocks.listActiveShiftReports.mockReset();
  mocks.listActiveShiftReports.mockResolvedValue({ reports: [], shift: null });
});

function renderSidebar(role: AccountRole, path = '/admin/catalog') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
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

  it('refreshes the badge from realtime and caps large counts at 99+', async () => {
    mocks.listActiveShiftReports.mockResolvedValueOnce({
      reports: [{ computedStatus: 'draft', id: 1 }],
      shift: { id: 12 },
    });
    renderSidebar('owner');
    expect(await screen.findByLabelText('1 отчетов требуют внимания')).toHaveTextContent('1');

    mocks.listActiveShiftReports.mockResolvedValueOnce({
      reports: Array.from({ length: 100 }, (_, index) => ({
        computedStatus: 'pending',
        id: index + 1,
      })),
      shift: { id: 12 },
    });
    window.dispatchEvent(
      new CustomEvent('realtime:crm:changed', {
        detail: {
          action: 'submitted',
          domain: 'shifts',
          entity: 'shift_report',
          entityId: '1',
          hints: { queryGroups: ['shiftReports'] },
          id: 'event-1',
          occurredAt: new Date().toISOString(),
          source: 'api',
        },
      }),
    );

    expect(await screen.findByLabelText('100 отчетов требуют внимания')).toHaveTextContent(
      '99+',
    );
  });
});
