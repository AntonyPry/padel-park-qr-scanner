import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingTaskDetail } from '@/api/onboarding';
import { apiRequest } from '@/lib/api';
import {
  activateOnboardingQuest,
  clearStoredActiveOnboardingQuest,
  getStoredActiveOnboardingQuest,
} from '@/lib/onboarding-quest';
import OnboardingPage from './OnboardingPage';

const { getOnboardingTaskDetailMock } = vi.hoisted(() => ({
  getOnboardingTaskDetailMock: vi.fn(),
}));

vi.mock('@/api/onboarding', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/onboarding')>();
  return {
    ...original,
    getOnboardingTaskDetail: getOnboardingTaskDetailMock,
  };
});

vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({ account: { id: 10, role: 'admin' } }),
}));

const taskDetail: OnboardingTaskDetail = {
  availableRoles: [],
  mission: {
    description: 'Работа с клиентами',
    key: 'admin.clients',
    title: 'Клиенты',
  },
  ownerRoleOverrideEnabled: false,
  path: {
    completionBadge: 'Администратор',
    description: 'Путь администратора',
    levelLabel: 'Начальный',
    role: 'admin',
    title: 'Администратор',
  },
  selectedRole: 'admin',
  task: {
    badge: 'Первый клиент',
    checkpoint: {
      conditions: { taskKey: 'admin.client.create' },
      event: 'client.created',
    },
    description: 'Создайте клиента через обычную форму CRM.',
    estimatedMinutes: 5,
    guidance: {
      hasLesson: true,
      hasPractice: true,
      hasQuiz: false,
      practiceStepCount: 1,
      quizQuestionCount: 0,
      screenshotCount: 0,
    },
    key: 'admin.client.create',
    kind: 'action',
    lesson: {
      blocks: [{ text: 'Откройте раздел клиентов.', type: 'paragraph' }],
      screenshots: [],
      summary: 'Создание клиента',
      title: 'Создать клиента',
      updatedAt: '2026-07-18T00:00:00.000Z',
    },
    practice: {
      autoTrainingMode: false,
      route: '/admin/clients',
      steps: [],
      targetSelectors: [],
      testData: null,
    },
    progress: {
      completedAt: null,
      isCompleted: false,
      isNext: true,
      lesson: {
        isRead: false,
        isUpdatedAfterCompletion: false,
        readAt: null,
        reviewedAt: null,
        reviewedVersionAt: null,
        updatedAt: null,
      },
      practice: {
        activeStepKey: null,
        completedAt: null,
        completedStepKeys: [],
        isCompleted: false,
        isStarted: false,
        startedAt: null,
        totalSteps: 0,
      },
      quiz: {
        attemptsCount: 0,
        isPassed: false,
        lastAttemptAt: null,
        lastCorrectCount: null,
        passedAt: null,
        totalQuestions: 0,
      },
      status: 'not_started',
    },
    quiz: { passingScorePercent: 100, questions: [] },
    rewardXp: 100,
    route: '/admin/clients',
    skills: ['Клиенты'],
    title: 'Создать клиента из обращения',
  },
};

function ClientsRoute() {
  const navigate = useNavigate();
  const activeQuest = getStoredActiveOnboardingQuest();

  return (
    <div>
      <div>CRM clients</div>
      <div>quest: {activeQuest?.taskKey || 'none'}</div>
      <button type="button" onClick={() => navigate(-1)}>
        browser back
      </button>
    </div>
  );
}

function RouteEntryControls() {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => navigate('/admin/onboarding/admin.client.create')}
    >
      enter same task detail
    </button>
  );
}

function renderLifecycle() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  window.history.replaceState(
    null,
    '',
    '/admin/onboarding/admin.client.create',
  );

  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <RouteEntryControls />
        <Routes>
          <Route path="/admin/onboarding/:taskKey" element={<OnboardingPage />} />
          <Route path="/admin/clients" element={<ClientsRoute />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getOnboardingTaskDetailMock.mockResolvedValue(taskDetail);
});

afterEach(() => {
  cleanup();
  clearStoredActiveOnboardingQuest();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  getOnboardingTaskDetailMock.mockReset();
  vi.unstubAllGlobals();
});

describe('OnboardingPage active quest abandonment', () => {
  it('clears a stale same-task quest on direct task-detail mount', async () => {
    activateOnboardingQuest(taskDetail.task, 'admin');

    renderLifecycle();

    await waitFor(() => expect(getStoredActiveOnboardingQuest()).toBeNull());
    expect(await screen.findByText(taskDetail.task.title)).toBeInTheDocument();
  });

  it('clears the action quest when browser Back returns to the same task detail', async () => {
    renderLifecycle();

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть в CRM' }));

    expect(await screen.findByText('CRM clients')).toBeInTheDocument();
    expect(screen.getByText('quest: admin.client.create')).toBeInTheDocument();
    expect(getStoredActiveOnboardingQuest()).toMatchObject({
      taskKey: 'admin.client.create',
    });

    fireEvent.click(screen.getByRole('button', { name: 'browser back' }));

    expect(await screen.findByText(taskDetail.task.title)).toBeInTheDocument();
    await waitFor(() => expect(getStoredActiveOnboardingQuest()).toBeNull());

    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => {
        void _input;
        void _init;
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
          status: 201,
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/clients', { method: 'POST', body: '{}' });

    const [, init] = fetchMock.mock.calls[0] || [];
    const headers = new Headers(init?.headers);
    expect(headers.has('X-Onboarding-Quest-Task-Key')).toBe(false);
    expect(headers.has('X-Onboarding-Quest-Role')).toBe(false);
  });

  it('clears a quest on a new same-task route entry without remounting the page', async () => {
    renderLifecycle();

    expect(await screen.findByText(taskDetail.task.title)).toBeInTheDocument();
    activateOnboardingQuest(taskDetail.task, 'admin');
    expect(getStoredActiveOnboardingQuest()).toMatchObject({
      taskKey: 'admin.client.create',
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'enter same task detail' }),
    );

    await waitFor(() => expect(getStoredActiveOnboardingQuest()).toBeNull());
    expect(screen.getByText(taskDetail.task.title)).toBeInTheDocument();
  });
});
