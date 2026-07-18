import { useEffect } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import {
  clearStoredActiveOnboardingQuest,
  getStoredActiveOnboardingQuest,
} from '@/lib/onboarding-quest';
import { useAuth } from '@/lib/useAuth';

const ONBOARDING_TASK_DETAIL_ROUTE = '/admin/onboarding/:taskKey';

function clearActiveQuestOnTaskDetailEntry(pathname: string) {
  if (!matchPath(ONBOARDING_TASK_DETAIL_ROUTE, pathname)) return;
  if (!getStoredActiveOnboardingQuest()) return;

  clearStoredActiveOnboardingQuest();
}

export function OnboardingQuestRouteObserver() {
  const { account } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!account?.id) return;

    clearActiveQuestOnTaskDetailEntry(location.pathname);
  }, [account?.id, location.pathname]);

  useEffect(() => {
    if (!account?.id) return;

    const handleHistoryEntry = () => {
      clearActiveQuestOnTaskDetailEntry(window.location.pathname);
    };

    window.addEventListener('popstate', handleHistoryEntry);
    window.addEventListener('pageshow', handleHistoryEntry);

    return () => {
      window.removeEventListener('popstate', handleHistoryEntry);
      window.removeEventListener('pageshow', handleHistoryEntry);
    };
  }, [account?.id]);

  return null;
}
