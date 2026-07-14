import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

class ResizeObserverMock {
  disconnect() {}
  observe() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverMock);

afterEach(() => cleanup());

function renderSidebar(role: AccountRole) {
  return render(
    <MemoryRouter initialEntries={['/admin/catalog']}>
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
    </MemoryRouter>,
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
