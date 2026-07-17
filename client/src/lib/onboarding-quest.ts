import type { AccountRole } from '@/lib/roles';

export const ONBOARDING_QUEST_STORAGE_KEY = 'padel-park-active-onboarding-quest';
export const ONBOARDING_QUEST_EVENT = 'padel-park-onboarding-quest-change';

export interface ActiveOnboardingQuest {
  role?: AccountRole;
  route: string;
  startedAt: string;
  taskKey: string;
  title: string;
}

export interface OnboardingQuestTaskSeed {
  key: string;
  route?: string | null;
  title: string;
}

function canUseStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function emitQuestChange() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(ONBOARDING_QUEST_EVENT));
}

export function getStoredActiveOnboardingQuest(): ActiveOnboardingQuest | null {
  if (!canUseStorage()) return null;

  const raw = window.localStorage.getItem(ONBOARDING_QUEST_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<ActiveOnboardingQuest>;
    if (!parsed.taskKey || !parsed.route || !parsed.title) return null;

    return {
      role: parsed.role,
      route: parsed.route,
      startedAt: parsed.startedAt || new Date().toISOString(),
      taskKey: parsed.taskKey,
      title: parsed.title,
    };
  } catch {
    return null;
  }
}

export function setStoredActiveOnboardingQuest(quest: ActiveOnboardingQuest) {
  if (!canUseStorage()) return;

  window.localStorage.setItem(
    ONBOARDING_QUEST_STORAGE_KEY,
    JSON.stringify(quest),
  );
  emitQuestChange();
}

export function buildActiveOnboardingQuest(
  task: OnboardingQuestTaskSeed,
  role?: AccountRole,
): ActiveOnboardingQuest | null {
  if (!task.route || !task.route.startsWith('/admin')) return null;

  return {
    ...(role ? { role } : {}),
    route: task.route,
    startedAt: new Date().toISOString(),
    taskKey: task.key,
    title: task.title,
  };
}

export function activateOnboardingQuest(
  task: OnboardingQuestTaskSeed,
  role?: AccountRole,
) {
  const quest = buildActiveOnboardingQuest(task, role);
  if (!quest) return null;

  setStoredActiveOnboardingQuest(quest);
  return quest;
}

export function clearStoredActiveOnboardingQuest() {
  if (!canUseStorage()) return;

  window.localStorage.removeItem(ONBOARDING_QUEST_STORAGE_KEY);
  emitQuestChange();
}
