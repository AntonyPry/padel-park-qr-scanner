import { useEffect } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import {
  clearStoredActiveOnboardingQuest,
  getStoredActiveOnboardingQuest,
} from '@/lib/onboarding-quest';
import { useAuth } from '@/lib/useAuth';

export function OnboardingQuestRouteObserver() {
  const { account } = useAuth();
  const location = useLocation();
  const taskKey = matchPath(
    '/admin/onboarding/:taskKey',
    location.pathname,
  )?.params.taskKey;

  useEffect(() => {
    if (!account?.id || !taskKey) return;
    if (!getStoredActiveOnboardingQuest()) return;

    clearStoredActiveOnboardingQuest();
  }, [account?.id, location.key, location.pathname, taskKey]);

  return null;
}
