import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LegacyShiftRedirect } from '@/components/legacy-shift-redirect';
import ShiftWorkspaceLayout from '@/components/shift-workspace-layout';

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

const sections = [
  { label: 'Мотивация', path: '/admin/shift/motivation' },
  { label: 'Отчеты', path: '/admin/shift/reports' },
  { label: 'Касса', path: '/admin/shift/cash' },
];

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {`${location.pathname}${location.search}${location.hash}`}
    </output>
  );
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}

function activeShift() {
  return {
    adminName: 'Администратор',
    date: '2026-07-16',
    id: 12,
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    status: 'active',
  };
}

beforeEach(() => {
  mocks.apiFetch.mockReset().mockResolvedValue(jsonResponse({ shift: activeShift() }));
});

afterEach(() => cleanup());

describe('ShiftWorkspaceLayout', () => {
  it.each(sections)('keeps navigation and current shift visible on $label', async (section) => {
    render(
      <MemoryRouter initialEntries={[section.path]}>
        <Routes>
          <Route path="/admin/shift" element={<ShiftWorkspaceLayout />}>
            <Route path="motivation" element={<div>motivation content</div>} />
            <Route path="reports" element={<div>reports content</div>} />
            <Route path="cash" element={<div>cash content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('navigation', { name: 'Разделы смены' })).toHaveClass(
      'grid-cols-3',
    );
    expect(screen.queryByRole('heading', { name: 'Смена' })).not.toBeInTheDocument();
    expect(
      screen.queryByText('Текущая работа, отчеты и касса смены.'),
    ).not.toBeInTheDocument();
    for (const item of sections) {
      const link = screen.getByRole('link', { name: item.label });
      expect(link).toHaveAttribute('href', item.path);
      if (item.path === section.path) {
        expect(link).toHaveAttribute('aria-current', 'page');
        expect(link).toHaveClass('bg-foreground/10', 'text-foreground', 'ring-foreground/15');
      } else {
        expect(link).not.toHaveAttribute('aria-current');
        expect(link).not.toHaveClass('bg-foreground/10');
      }
    }
    expect(await screen.findByText('Администратор')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Завершить' })).toBeInTheDocument();
    expect(
      mocks.apiFetch.mock.calls.filter(([input]) => input === '/api/shifts/active'),
    ).toHaveLength(1);
  });

  it('keeps the active shift context mounted while switching sections', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/admin/shift/motivation']}>
        <Routes>
          <Route path="/admin/shift" element={<ShiftWorkspaceLayout />}>
            <Route path="motivation" element={<div>motivation content</div>} />
            <Route path="reports" element={<div>reports content</div>} />
            <Route path="cash" element={<div>cash content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Администратор')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Отчеты' }));

    expect(await screen.findByText('reports content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Завершить' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Начать смену' })).not.toBeInTheDocument();
    expect(
      mocks.apiFetch.mock.calls.filter(([input]) => input === '/api/shifts/active'),
    ).toHaveLength(1);
  });

  it('uses a neutral placeholder while the active shift is loading', () => {
    mocks.apiFetch.mockImplementation(() => new Promise(() => undefined));
    const { container } = render(
      <MemoryRouter initialEntries={['/admin/shift/reports']}>
        <Routes>
          <Route path="/admin/shift" element={<ShiftWorkspaceLayout />}>
            <Route path="reports" element={<div>reports content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: 'Начать смену' })).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
  });

  it('starts a shift from the shared panel', async () => {
    const user = userEvent.setup();
    mocks.apiFetch
      .mockResolvedValueOnce(jsonResponse({ shift: null }))
      .mockResolvedValueOnce(jsonResponse({ shift: activeShift() }));

    render(
      <MemoryRouter initialEntries={['/admin/shift/reports']}>
        <Routes>
          <Route path="/admin/shift" element={<ShiftWorkspaceLayout />}>
            <Route path="reports" element={<div>reports content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Начать смену' }));
    expect(await screen.findByText('Администратор')).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.apiFetch).toHaveBeenCalledWith('/api/shifts/start', {
        method: 'POST',
      }),
    );
  });

  it.each([
    [
      '/admin/motivation?closeShift=1#close',
      '/admin/shift/motivation?closeShift=1#close',
      '/admin/shift/motivation',
    ],
    [
      '/admin/shift-reports?date=2026-07-16&status=overdue#filters',
      '/admin/shift/reports?date=2026-07-16&status=overdue#filters',
      '/admin/shift/reports',
    ],
    [
      '/admin/shift-cash?openExpense=1#expenses',
      '/admin/shift/cash?openExpense=1#expenses',
      '/admin/shift/cash',
    ],
  ])(
    'preserves query and hash while redirecting legacy %s',
    (legacyPath, expectedLocation, canonicalPath) => {
      render(
        <MemoryRouter initialEntries={[legacyPath]}>
          <Routes>
            <Route
              path={legacyPath.split(/[?#]/)[0]}
              element={<LegacyShiftRedirect to={canonicalPath} />}
            />
            <Route path={canonicalPath} element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>,
      );

      expect(screen.getByTestId('location')).toHaveTextContent(expectedLocation);
    },
  );

  it('redirects a legacy route exactly once without a loop', async () => {
    const onRedirectMount = vi.fn();

    function RedirectProbe() {
      useEffect(() => {
        onRedirectMount();
      }, []);
      return <LegacyShiftRedirect to="/admin/shift/motivation" />;
    }

    render(
      <MemoryRouter initialEntries={['/admin/motivation?closeShift=1#close']}>
        <Routes>
          <Route path="/admin/motivation" element={<RedirectProbe />} />
          <Route path="/admin/shift/motivation" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/admin/shift/motivation?closeShift=1#close',
    );
    await waitFor(() => expect(onRedirectMount).toHaveBeenCalledTimes(1));
  });
});
