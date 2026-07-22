import { createElement, StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnboardingRouteEvents } from './onboarding-route-events';
import {
  activateOnboardingQuest,
  clearStoredActiveOnboardingQuest,
  getStoredActiveOnboardingQuest,
} from '@/lib/onboarding-quest';

const { recordOnboardingEventMock } = vi.hoisted(() => ({
  recordOnboardingEventMock: vi.fn(),
}));

vi.mock('@/api/onboarding', () => ({
  recordOnboardingEvent: recordOnboardingEventMock,
}));

vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({ account: { id: 10, role: 'manager' } }),
}));

function NavigationHarness() {
  const navigate = useNavigate();
  return createElement(
    'div',
    null,
    createElement('button', {
      onClick: () => navigate('/admin/catalog'),
      children: 'catalog',
    }),
    createElement('button', {
      onClick: () => navigate('/admin/prepayments'),
      children: 'prepayments',
    }),
    createElement(OnboardingRouteEvents),
  );
}

function renderRouteEvents(initialPath = '/admin/prepayments') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    createElement(
      StrictMode,
      null,
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          MemoryRouter,
          { initialEntries: [initialPath] },
          createElement(NavigationHarness),
        ),
      ),
    ),
  );
}

afterEach(() => {
  cleanup();
  clearStoredActiveOnboardingQuest();
  window.localStorage.clear();
  recordOnboardingEventMock.mockReset();
});

describe('OnboardingRouteEvents navigation lifecycle', () => {
  it('records one exact route event in StrictMode and no generic duplicate after clear', async () => {
    activateOnboardingQuest(
      {
        key: 'manager.prepayments.dashboard-review',
        route: '/admin/prepayments',
        title: 'Проверить предоплаты',
      },
      'manager',
    );
    recordOnboardingEventMock.mockResolvedValue({
      completedTaskKeys: [],
      progressedTaskKeys: ['manager.prepayments.dashboard-review'],
      role: 'manager',
    });

    renderRouteEvents();

    await waitFor(() => expect(recordOnboardingEventMock).toHaveBeenCalledTimes(1));
    expect(recordOnboardingEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          taskKey: 'manager.prepayments.dashboard-review',
        }),
      }),
    );
    await waitFor(() => expect(getStoredActiveOnboardingQuest()).toBeNull());
    expect(recordOnboardingEventMock).toHaveBeenCalledTimes(1);
  });

  it('records generic events again only for truly separate navigations', async () => {
    recordOnboardingEventMock.mockResolvedValue({
      completedTaskKeys: [],
      progressedTaskKeys: [],
      role: 'manager',
    });
    renderRouteEvents();

    await waitFor(() => expect(recordOnboardingEventMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'catalog' }));
    await waitFor(() => expect(recordOnboardingEventMock).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'prepayments' }));
    await waitFor(() => expect(recordOnboardingEventMock).toHaveBeenCalledTimes(3));
  });
});
