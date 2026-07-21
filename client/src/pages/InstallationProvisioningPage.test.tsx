import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@/lib/theme';
import InstallationProvisioningPage from './InstallationProvisioningPage';

const snapshot = {
  audits: [],
  foundation: { state: 'initialized' },
  organizations: [{
    clubCount: 1,
    createdAt: '2026-07-20T12:00:00.000Z',
    id: 1,
    name: 'Padel Park',
    ownerState: 'active',
    slug: 'padel-park',
    status: 'active',
    updatedAt: '2026-07-21T12:00:00.000Z',
  }],
};

const organization = {
  clubs: [{
    id: 1,
    integrations: [
      integration('beeline', { safeIdentity: 'Линия •••• 42' }),
      integration('evotor', { validationStatus: 'pending_event' }),
      integration('telegram'),
      integration('vk'),
    ],
    name: 'Padel Park',
    status: 'active',
    timezone: 'Europe/Moscow',
    updatedAt: '2026-07-21T12:00:00.000Z',
  }],
  createdAt: '2026-07-20T12:00:00.000Z',
  id: 1,
  name: 'Padel Park',
  status: 'active',
  updatedAt: '2026-07-21T12:00:00.000Z',
};

function integration(
  provider: 'beeline' | 'evotor' | 'telegram' | 'vk',
  overrides: Record<string, unknown> = {},
) {
  return {
    configured: true,
    lastActivityAt: '2026-07-21T11:45:00.000Z',
    lastValidatedAt: '2026-07-21T11:30:00.000Z',
    provider,
    proxyConfigured: false,
    safeCallbackUrl: `https://setly.tech/callback/[redacted-${provider}]`,
    safeIdentity: `${provider} •••• 42`,
    secretUpdatedAt: '2026-07-21T10:00:00.000Z',
    settings: {},
    status: 'active',
    validationStatus: 'verified',
    updatedAt: '2026-07-21T12:00:00.000Z',
    ...overrides,
  };
}

function json(value: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
    status,
  }));
}

function renderPage(path: string) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <InstallationProvisioningPage />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('InstallationProvisioningPage integration management', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        addEventListener: vi.fn(),
        matches: false,
        removeEventListener: vi.fn(),
      }),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('offers a direct return from operator login to the regular Setly login', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({
      enabled: true,
      managementEnabled: true,
      provisioningEnabled: false,
    })));

    renderPage('/installation');

    expect(await screen.findByRole('link', { name: 'Вернуться к обычному входу' }))
      .toHaveAttribute('href', 'https://setly.tech/login');
  });

  it('keeps the overview concise and confirms a provider mutation on its detail page', async () => {
    window.sessionStorage.setItem('setly_installation_operator_token', 'operator-token');
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/status')) {
        return json({ enabled: true, managementEnabled: true, provisioningEnabled: false });
      }
      if (url.endsWith('/snapshot')) return json(snapshot);
      if (url.endsWith('/organizations/1') && (!init?.method || init.method === 'GET')) {
        return json(organization);
      }
      if (url.endsWith('/integrations/beeline/disable') && init?.method === 'POST') {
        return json({ ok: true });
      }
      return json({ error: 'Unexpected request' }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage('/installation/organizations/1/clubs/1/integrations');

    await screen.findByRole('heading', { name: 'Интеграции · Padel Park' });
    expect(screen.getAllByRole('button', { name: 'Открыть' })).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Отключить' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Проверить подписку' })).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Открыть' })[0]);
    await screen.findByRole('heading', { name: 'Билайн' });
    expect(screen.getByRole('button', { name: 'Изменить настройки' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Проверить подписку' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Отключить' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Отключить Билайн?')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/disable'))).toBe(false);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Отключить' }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/disable'))).toBe(true);
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: 'Обновить учётные данные' }).at(-1)!);
    fireEvent.change(screen.getByLabelText('Токен API · только запись'), {
      target: { value: 'replacement-secret' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Обновить учётные данные' }).at(-1)!);

    const credentialDialog = await screen.findByRole('dialog');
    expect(within(credentialDialog).getByText('Обновить учётные данные Билайн?'))
      .toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/credentials')))
      .toBe(false);
  });
});
