import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactElement, useEffect } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LegacyShiftRedirect } from '@/components/legacy-shift-redirect';
import ShiftWorkspaceLayout from '@/components/shift-workspace-layout';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  listActiveShiftReports: vi.fn(),
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, apiFetch: mocks.apiFetch };
});

vi.mock('@/lib/realtime', () => ({
  useRealtimeRefresh: vi.fn(),
}));

vi.mock('@/api/shift-reports', () => ({
  listActiveShiftReports: mocks.listActiveShiftReports,
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

function renderWorkspace(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.apiFetch.mockReset().mockResolvedValue(jsonResponse({ shift: activeShift() }));
  mocks.listActiveShiftReports.mockReset();
  mocks.listActiveShiftReports.mockResolvedValue({ reports: [], shift: null });
});

afterEach(() => cleanup());

describe('ShiftWorkspaceLayout', () => {
  it.each(sections)('keeps navigation and current shift visible on $label', async (section) => {
    renderWorkspace(
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
    renderWorkspace(
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
    const { container } = renderWorkspace(
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

    renderWorkspace(
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

  it('shows an overdue attention badge only beside Reports', async () => {
    mocks.listActiveShiftReports.mockResolvedValueOnce({
      reports: [
        { computedStatus: 'draft', id: 1 },
        { computedStatus: 'overdue', id: 2 },
        { computedStatus: 'submitted', id: 3 },
      ],
      shift: { id: 12 },
    });

    renderWorkspace(
      <MemoryRouter initialEntries={['/admin/shift/motivation']}>
        <Routes>
          <Route path="/admin/shift" element={<ShiftWorkspaceLayout />}>
            <Route path="motivation" element={<div>motivation content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const navigation = screen.getByRole('navigation', { name: 'Разделы смены' });
    const reportsLink = within(navigation).getByRole('link', { name: 'Отчеты' });
    const reportsItem = reportsLink.parentElement;
    const badge = await within(reportsItem!).findByLabelText(
      '2 отчетов требуют внимания, есть просроченные',
    );

    expect(badge).toHaveTextContent('2');
    expect(badge).toHaveClass('bg-destructive');
    expect(reportsLink).toHaveClass('px-2');
    expect(reportsLink).not.toContainElement(badge);
    expect(reportsLink.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    for (const label of ['Мотивация', 'Касса']) {
      const link = within(navigation).getByRole('link', { name: label });
      expect(
        within(link.parentElement!).queryByLabelText(/отчетов требуют внимания/),
      ).not.toBeInTheDocument();
    }
  });

  it('keeps the Reports badge slot empty while reports are loading', () => {
    mocks.listActiveShiftReports.mockImplementation(() => new Promise(() => undefined));

    renderWorkspace(
      <MemoryRouter initialEntries={['/admin/shift/reports']}>
        <Routes>
          <Route path="/admin/shift" element={<ShiftWorkspaceLayout />}>
            <Route path="reports" element={<div>reports content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Отчеты' })).toHaveClass('px-2');
    expect(
      screen.queryByLabelText(/отчетов требуют внимания/),
    ).not.toBeInTheDocument();
  });

  it('keeps the Reports badge slot empty when reports fail to load', async () => {
    mocks.listActiveShiftReports.mockRejectedValueOnce(new Error('offline'));

    renderWorkspace(
      <MemoryRouter initialEntries={['/admin/shift/reports']}>
        <Routes>
          <Route path="/admin/shift" element={<ShiftWorkspaceLayout />}>
            <Route path="reports" element={<div>reports content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(mocks.listActiveShiftReports).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('link', { name: 'Отчеты' })).toHaveClass('px-2');
    expect(
      screen.queryByLabelText(/отчетов требуют внимания/),
    ).not.toBeInTheDocument();
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
      renderWorkspace(
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

    renderWorkspace(
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
