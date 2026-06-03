import { apiRequest } from '@/lib/api';
import type { AccountRole } from '@/lib/roles';

export interface OnboardingRoleOption {
  description: string;
  isCurrent: boolean;
  isSelectable: boolean;
  label: string;
  value: AccountRole;
}

export interface OnboardingCheckpoint {
  conditions?: Record<string, unknown>;
  event: string;
}

export interface OnboardingTaskProgress {
  completedAt: string | null;
  isCompleted: boolean;
  isNext: boolean;
  lesson: {
    isRead: boolean;
    readAt: string | null;
  };
  practice: {
    activeStepKey: string | null;
    completedAt: string | null;
    completedStepKeys: string[];
    isCompleted: boolean;
    isStarted: boolean;
    startedAt: string | null;
    totalSteps: number;
  };
  quiz: {
    attemptsCount: number;
    isPassed: boolean;
    lastAttemptAt: string | null;
    lastCorrectCount: number | null;
    passedAt: string | null;
    totalQuestions: number;
  };
  status: 'completed' | 'in_progress' | 'skipped' | 'not_started';
}

export interface OnboardingTask {
  badge: string;
  checkpoint: OnboardingCheckpoint;
  description: string;
  estimatedMinutes: number;
  key: string;
  kind: 'action' | 'review';
  progress: OnboardingTaskProgress;
  rewardXp: number;
  route: string;
  skills: string[];
  title: string;
  guidance?: {
    hasLesson: boolean;
    hasPractice: boolean;
    hasQuiz: boolean;
    practiceStepCount: number;
    quizQuestionCount: number;
    screenshotCount: number;
  };
  trainingMode?: {
    recommended: boolean;
  };
}

export interface OnboardingLessonBlock {
  items?: string[];
  screenshotIndex?: number;
  text: string;
  title?: string;
  type: string;
}

export interface OnboardingLessonScreenshot {
  alt?: string;
  caption?: string;
  src: string;
}

export interface OnboardingLesson {
  blocks: OnboardingLessonBlock[];
  screenshots: OnboardingLessonScreenshot[];
  summary: string;
  title: string;
}

export interface OnboardingPracticeStep {
  description: string;
  key: string;
  target: string | null;
  title: string;
}

export interface OnboardingPractice {
  autoTrainingMode: boolean;
  route: string;
  steps: OnboardingPracticeStep[];
  targetSelectors: string[];
  testData: Record<string, unknown> | null;
}

export interface OnboardingQuizQuestion {
  hint: string | null;
  key: string;
  options: Array<{ id: string; text: string }>;
  prompt: string;
  type: string;
}

export interface OnboardingQuiz {
  passingScorePercent: number;
  questions: OnboardingQuizQuestion[];
}

export interface OnboardingGuidedTask extends OnboardingTask {
  lesson: OnboardingLesson;
  practice: OnboardingPractice;
  quiz: OnboardingQuiz;
}

export interface OnboardingTaskDetail {
  availableRoles: OnboardingRoleOption[];
  mission: {
    description: string;
    key: string;
    title: string;
  };
  ownerRoleOverrideEnabled: boolean;
  path: {
    completionBadge: string;
    description: string;
    levelLabel: string;
    role: AccountRole;
    title: string;
  };
  selectedRole: AccountRole;
  task: OnboardingGuidedTask;
}

export interface OnboardingMission {
  description: string;
  key: string;
  tasks: OnboardingTask[];
  title: string;
}

export interface OnboardingPath {
  completionBadge: string;
  description: string;
  levelLabel: string;
  missions: OnboardingMission[];
  outcomes: string[];
  role: AccountRole;
  title: string;
}

export interface OnboardingSkillSummary {
  completedTasks: number;
  earnedXp: number;
  name: string;
  percent: number;
  totalTasks: number;
  totalXp: number;
}

export interface OnboardingSummary {
  completedTaskKeys: string[];
  completedTasks: number;
  earnedXp: number;
  nextTaskKey: string | null;
  percent: number;
  skills: OnboardingSkillSummary[];
  totalTasks: number;
  totalXp: number;
}

export interface OnboardingOverview {
  availableRoles: OnboardingRoleOption[];
  ownerRoleOverrideEnabled: boolean;
  path: OnboardingPath;
  selectedRole: AccountRole;
  summary: OnboardingSummary;
}

export interface OnboardingTrainingMode {
  disabledAt: string | null;
  enabledAt: string | null;
  isEnabled: boolean;
  role: AccountRole;
}

export interface OnboardingTrainingDataEntity {
  count: number;
  key: string;
  label: string;
}

export interface OnboardingTrainingDataSummary {
  entities: OnboardingTrainingDataEntity[];
  hasRecords: boolean;
  role: AccountRole | null;
  totalRecords: number;
}

export interface OnboardingTrainingDataCleanup {
  deleted: Record<string, number>;
  remaining: OnboardingTrainingDataSummary;
  role: AccountRole | null;
}

export interface OnboardingTaskMetric {
  completedAccounts: number;
  key: string;
  percent: number;
  title: string;
}

export interface OnboardingRoleMetric {
  averageAccountPercent: number;
  completedAccounts: number;
  completedTaskSlots: number;
  label: string;
  lastCompletedAt: string | null;
  nativeAccounts: number;
  percent: number;
  role: AccountRole;
  startedAccounts: number;
  taskCount: number;
  tasks: OnboardingTaskMetric[];
  totalAccounts: number;
  totalTaskSlots: number;
  trainingRecommendedTasks: number;
}

export interface OnboardingMetrics {
  generatedAt: string;
  roles: OnboardingRoleMetric[];
  summary: {
    activeAccounts: number;
    completedAccounts: number;
    completedTaskSlots: number;
    percent: number;
    roles: number;
    startedAccounts: number;
    totalTaskSlots: number;
  };
}

export interface OnboardingClientEventPayload {
  entityId?: string | null;
  entityType?: string | null;
  eventKey:
    | 'audit.viewed'
    | 'booking.schedule_viewed'
    | 'call_task.report_viewed'
    | 'finance.report_viewed'
    | 'methodology.analytics_viewed'
    | 'methodology.viewed'
    | 'reference.viewed'
    | 'report.viewed'
    | 'trainer.viewed'
    | 'utilization.viewed';
  payload?: Record<string, unknown> | null;
  role?: AccountRole;
}

export interface OnboardingEventResult {
  completedTaskKeys: string[];
  event: unknown;
  progressedTaskKeys?: string[];
  role: AccountRole | null;
}

export interface OnboardingQuizAttemptResult {
  attempt: {
    correctCount: number;
    isPassed: boolean;
    results: Array<{
      explanation: string | null;
      hint: string | null;
      isCorrect: boolean;
      questionKey: string;
      selectedOptionIds: string[];
    }>;
    scorePercent: number;
    submittedAt: string;
    totalQuestions: number;
  };
  detail: OnboardingTaskDetail;
}

function roleQuery(role?: AccountRole) {
  if (!role) return '';

  const params = new URLSearchParams({ role });
  return `?${params.toString()}`;
}

export function getOnboardingOverview(role?: AccountRole) {
  return apiRequest<OnboardingOverview>(
    `/api/onboarding${roleQuery(role)}`,
    {},
    'Не удалось загрузить обучение',
  );
}

export function completeOnboardingTask(taskKey: string, role?: AccountRole) {
  return apiRequest<OnboardingOverview>(
    `/api/onboarding/tasks/${encodeURIComponent(taskKey)}/complete`,
    {
      body: JSON.stringify({ role }),
      method: 'POST',
    },
    'Не удалось обновить прогресс обучения',
  );
}

export function getOnboardingTaskDetail(taskKey: string, role?: AccountRole) {
  return apiRequest<OnboardingTaskDetail>(
    `/api/onboarding/tasks/${encodeURIComponent(taskKey)}${roleQuery(role)}`,
    {},
    'Не удалось загрузить задание обучения',
  );
}

export function markOnboardingLessonRead(
  taskKey: string,
  role?: AccountRole,
) {
  return apiRequest<OnboardingTaskDetail>(
    `/api/onboarding/tasks/${encodeURIComponent(taskKey)}/lesson-read`,
    {
      body: JSON.stringify({ role }),
      method: 'POST',
    },
    'Не удалось отметить инструкцию прочитанной',
  );
}

export function startOnboardingPractice(taskKey: string, role?: AccountRole) {
  return apiRequest<OnboardingTaskDetail>(
    `/api/onboarding/tasks/${encodeURIComponent(taskKey)}/practice-start`,
    {
      body: JSON.stringify({ role }),
      method: 'POST',
    },
    'Не удалось начать практику задания',
  );
}

export function completeOnboardingPracticeStep(payload: {
  role?: AccountRole;
  stepKey: string;
  taskKey: string;
}) {
  return apiRequest<OnboardingTaskDetail>(
    `/api/onboarding/tasks/${encodeURIComponent(payload.taskKey)}/steps/${encodeURIComponent(payload.stepKey)}`,
    {
      body: JSON.stringify({ role: payload.role }),
      method: 'POST',
    },
    'Не удалось обновить шаг задания',
  );
}

export function submitOnboardingQuizAttempt(payload: {
  answers: Record<string, string | string[]>;
  role?: AccountRole;
  taskKey: string;
}) {
  return apiRequest<OnboardingQuizAttemptResult>(
    `/api/onboarding/tasks/${encodeURIComponent(payload.taskKey)}/quiz-attempt`,
    {
      body: JSON.stringify({
        answers: payload.answers,
        role: payload.role,
      }),
      method: 'POST',
    },
    'Не удалось проверить тест задания',
  );
}

export function resetOnboardingProgress(role?: AccountRole) {
  return apiRequest<OnboardingOverview>(
    `/api/onboarding/progress${roleQuery(role)}`,
    { method: 'DELETE' },
    'Не удалось сбросить прогресс обучения',
  );
}

export function getOnboardingTrainingMode() {
  return apiRequest<OnboardingTrainingMode>(
    '/api/onboarding/training-mode',
    {},
    'Не удалось загрузить режим тренировки',
  );
}

export function setOnboardingTrainingMode(payload: {
  isEnabled: boolean;
  role?: AccountRole;
}) {
  return apiRequest<OnboardingTrainingMode>(
    '/api/onboarding/training-mode',
    {
      body: JSON.stringify(payload),
      method: 'PUT',
    },
    'Не удалось изменить режим тренировки',
  );
}

export function getOnboardingTrainingData(role?: AccountRole) {
  return apiRequest<OnboardingTrainingDataSummary>(
    `/api/onboarding/training-data${roleQuery(role)}`,
    {},
    'Не удалось загрузить учебные данные',
  );
}

export function getOnboardingMetrics() {
  return apiRequest<OnboardingMetrics>(
    '/api/onboarding/metrics',
    {},
    'Не удалось загрузить метрики обучения',
  );
}

export function recordOnboardingEvent(payload: OnboardingClientEventPayload) {
  return apiRequest<OnboardingEventResult>(
    '/api/onboarding/events',
    {
      body: JSON.stringify(payload),
      method: 'POST',
    },
    'Не удалось записать событие обучения',
  );
}

export function cleanupOnboardingTrainingData(role?: AccountRole) {
  return apiRequest<OnboardingTrainingDataCleanup>(
    `/api/onboarding/training-data${roleQuery(role)}`,
    { method: 'DELETE' },
    'Не удалось очистить учебные данные',
  );
}
