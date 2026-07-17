import type { OnboardingClientEventPayload } from '@/api/onboarding';
import type { ActiveOnboardingQuest } from '@/lib/onboarding-quest';

export function normalizeOnboardingRoutePathname(pathname: string) {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }

  return pathname;
}

export function buildOnboardingRouteEventForPath(
  baseRouteEvent: OnboardingClientEventPayload | undefined,
  pathname: string,
  activeQuest: ActiveOnboardingQuest | null,
) {
  if (!baseRouteEvent) return undefined;
  const normalizedPathname = normalizeOnboardingRoutePathname(pathname);

  if (
    !activeQuest?.taskKey ||
    normalizeOnboardingRoutePathname(activeQuest.route) !== normalizedPathname
  ) {
    return baseRouteEvent;
  }

  return {
    ...baseRouteEvent,
    ...(activeQuest.role ? { role: activeQuest.role } : {}),
    payload: {
      ...(baseRouteEvent.payload || {}),
      taskKey: activeQuest.taskKey,
    },
  };
}

export function shouldClearActiveQuestAfterRouteEvent(
  activeQuest: ActiveOnboardingQuest | null,
  pathname: string,
  result: { completedTaskKeys?: string[]; progressedTaskKeys?: string[] },
  routeEvent?: OnboardingClientEventPayload,
) {
  if (!activeQuest?.taskKey) return false;
  if (
    normalizeOnboardingRoutePathname(activeQuest.route) !==
    normalizeOnboardingRoutePathname(pathname)
  ) {
    return false;
  }
  if (routeEvent?.payload?.taskKey === activeQuest.taskKey) return true;

  const completedTaskKeys = result.completedTaskKeys || [];
  const progressedTaskKeys = result.progressedTaskKeys || [];
  return (
    completedTaskKeys.includes(activeQuest.taskKey) ||
    progressedTaskKeys.includes(activeQuest.taskKey)
  );
}
