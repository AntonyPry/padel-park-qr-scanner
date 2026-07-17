import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingTaskDetail } from '@/api/onboarding';
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

function renderLifecycle() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/onboarding/admin.client.create']}>
        <Routes>
          <Route path="/admin/onboarding/:taskKey" element={<OnboardingPage />} />
          <Route path="/admin/clients" element={<ClientsRoute />} />
        </Routes>
      </MemoryRouter>
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
  getOnboardingTaskDetailMock.mockReset();
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
  });
});
