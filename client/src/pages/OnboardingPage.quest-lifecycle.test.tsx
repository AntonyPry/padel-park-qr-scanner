import { StrictMode, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingTaskDetail } from '@/api/onboarding';
import { OnboardingQuestRouteObserver } from '@/components/onboarding-quest-route-observer';
import { apiRequest } from '@/lib/api';
import {
  activateOnboardingQuest,
  clearStoredActiveOnboardingQuest,
  getStoredActiveOnboardingQuest,
  ONBOARDING_QUEST_EVENT,
} from '@/lib/onboarding-quest';
import OnboardingPage from './OnboardingPage';

const { getOnboardingTaskDetailMock } = vi.hoisted(() => ({
  getOnboardingTaskDetailMock: vi.fn(),
}));
const taskDetailPath = '/admin/onboarding/admin.client.create';
const observedPathnames: string[] = [];

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

function PersistentLocationTrace() {
  const location = useLocation();

  useEffect(() => {
    observedPathnames.push(location.pathname);
  }, [location.pathname]);

  return null;
}

function renderLifecycle(initialPath = taskDetailPath, strictMode = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  window.history.replaceState(null, '', initialPath);

  const app = (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <OnboardingQuestRouteObserver />
        <PersistentLocationTrace />
        <Routes>
          <Route path="/admin/onboarding/:taskKey" element={<OnboardingPage />} />
          <Route path="/admin/clients" element={<ClientsRoute />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );

  return render(strictMode ? <StrictMode>{app}</StrictMode> : app);
}

beforeEach(() => {
  observedPathnames.length = 0;
  getOnboardingTaskDetailMock.mockResolvedValue(taskDetail);
});

afterEach(() => {
  cleanup();
  clearStoredActiveOnboardingQuest();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  getOnboardingTaskDetailMock.mockReset();
  observedPathnames.length = 0;
  vi.unstubAllGlobals();
});

describe('global onboarding quest route lifecycle', () => {
  it('clears a stale same-task quest on direct task-detail mount', async () => {
    activateOnboardingQuest(taskDetail.task, 'admin');

    renderLifecycle();

    await waitFor(() => expect(getStoredActiveOnboardingQuest()).toBeNull());
    expect(await screen.findByText(taskDetail.task.title)).toBeInTheDocument();
  });

  it('clears a stale sibling quest on direct task-detail entry', async () => {
    activateOnboardingQuest(
      {
        key: 'admin.booking.review-schedule',
        route: '/admin/bookings',
        title: 'Проверить расписание',
      },
      'admin',
    );

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
    expect(observedPathnames).toEqual([
      taskDetailPath,
      '/admin/clients',
      taskDetailPath,
    ]);

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

  it('retains an exact quest when the persistent shell starts on its CRM target', async () => {
    activateOnboardingQuest(taskDetail.task, 'admin');

    renderLifecycle('/admin/clients', true);

    expect(await screen.findByText('CRM clients')).toBeInTheDocument();
    expect(getStoredActiveOnboardingQuest()).toMatchObject({
      taskKey: 'admin.client.create',
    });
    expect(observedPathnames).toContain('/admin/clients');
  });

  it('clears synchronously when popstate restores a task entry before a router effect can commit', async () => {
    activateOnboardingQuest(taskDetail.task, 'admin');
    renderLifecycle('/admin/clients', true);

    expect(await screen.findByText('CRM clients')).toBeInTheDocument();
    expect(getStoredActiveOnboardingQuest()).toMatchObject({
      taskKey: 'admin.client.create',
    });

    let questChangeCount = 0;
    window.addEventListener(
      ONBOARDING_QUEST_EVENT,
      () => {
        questChangeCount += 1;
      },
      { once: true },
    );
    let questAtEndOfNativeEvent = getStoredActiveOnboardingQuest();
    window.addEventListener(
      'popstate',
      () => {
        questAtEndOfNativeEvent = getStoredActiveOnboardingQuest();
      },
      { once: true },
    );
    window.history.replaceState({ idx: 0 }, '', taskDetailPath);

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { idx: 0 } }));
    });

    expect(questAtEndOfNativeEvent).toBeNull();
    expect(getStoredActiveOnboardingQuest()).toBeNull();
    expect(questChangeCount).toBe(1);
    expect(await screen.findByText(taskDetail.task.title)).toBeInTheDocument();
  });
});
