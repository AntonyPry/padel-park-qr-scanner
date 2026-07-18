import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import {
  recordOnboardingEvent,
  type OnboardingClientEventPayload,
} from '@/api/onboarding';
import { queryKeys } from '@/api/query-keys';
import {
  clearStoredActiveOnboardingQuest,
  getStoredActiveOnboardingQuest,
  ONBOARDING_QUEST_EVENT,
} from '@/lib/onboarding-quest';
import {
  buildOnboardingRouteEventRecordKey,
  buildOnboardingRouteEventForPath,
  normalizeOnboardingRoutePathname,
  shouldClearActiveQuestAfterRouteEvent,
} from '@/lib/onboarding-route-event-utils';
import { useAuth } from '@/lib/useAuth';

const ROUTE_EVENTS: Record<string, OnboardingClientEventPayload> = {
  '/admin/audit': {
    entityId: '/admin/audit',
    entityType: 'route',
    eventKey: 'audit.viewed',
    payload: { route: '/admin/audit' },
  },
  '/admin/bookings': {
    entityId: '/admin/bookings',
    entityType: 'route',
    eventKey: 'booking.schedule_viewed',
    payload: { route: '/admin/bookings' },
  },
  '/admin/call-tasks': {
    entityId: '/admin/call-tasks',
    entityType: 'route',
    eventKey: 'call_task.report_viewed',
    payload: { route: '/admin/call-tasks' },
  },
  '/admin/catalog': {
    entityId: '/admin/catalog',
    entityType: 'route',
    eventKey: 'catalog.viewed',
    payload: { route: '/admin/catalog' },
  },
  '/admin/certificates': {
    entityId: '/admin/certificates',
    entityType: 'route',
    eventKey: 'certificates.viewed',
    payload: { route: '/admin/certificates' },
  },
  '/admin/clients': {
    entityId: '/admin/clients',
    entityType: 'route',
    eventKey: 'clients.viewed',
    payload: { route: '/admin/clients' },
  },
  '/admin/corporate-clients': {
    entityId: '/admin/corporate-clients',
    entityType: 'route',
    eventKey: 'corporate_clients.viewed',
    payload: { route: '/admin/corporate-clients' },
  },
  '/admin/finances': {
    entityId: '/admin/finances',
    entityType: 'route',
    eventKey: 'finance.report_viewed',
    payload: { route: '/admin/finances' },
  },
  '/admin/manager-control': {
    entityId: '/admin/manager-control',
    entityType: 'route',
    eventKey: 'manager_control.viewed',
    payload: { route: '/admin/manager-control' },
  },
  '/admin/methodology': {
    entityId: '/admin/methodology',
    entityType: 'route',
    eventKey: 'methodology.viewed',
    payload: { route: '/admin/methodology' },
  },
  '/admin/methodology-analytics': {
    entityId: '/admin/methodology-analytics',
    entityType: 'route',
    eventKey: 'methodology.analytics_viewed',
    payload: { route: '/admin/methodology-analytics' },
  },
  '/admin/onboarding': {
    entityId: '/admin/onboarding',
    entityType: 'route',
    eventKey: 'report.viewed',
    payload: { report: 'onboarding_training_data', route: '/admin/onboarding' },
  },
  '/admin/prepayments': {
    entityId: '/admin/prepayments',
    entityType: 'route',
    eventKey: 'prepayments.viewed',
    payload: { route: '/admin/prepayments' },
  },
  '/admin/references': {
    entityId: '/admin/references',
    entityType: 'route',
    eventKey: 'reference.viewed',
    payload: { route: '/admin/references' },
  },
  '/admin/shift-settings': {
    entityId: '/admin/shift-settings',
    entityType: 'route',
    eventKey: 'report.viewed',
    payload: { report: 'shift_report_templates', route: '/admin/shift-settings' },
  },
  '/admin/trainer': {
    entityId: '/admin/trainer',
    entityType: 'route',
    eventKey: 'trainer.viewed',
    payload: { route: '/admin/trainer' },
  },
  '/admin/utilization': {
    entityId: '/admin/utilization',
    entityType: 'route',
    eventKey: 'utilization.viewed',
    payload: { route: '/admin/utilization' },
  },
  '/admin/visits-analytics': {
    entityId: '/admin/visits-analytics',
    entityType: 'route',
    eventKey: 'report.viewed',
    payload: { report: 'visits_analytics', route: '/admin/visits-analytics' },
  },
};

export function OnboardingRouteEvents() {
  const { account } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();
  const recordedKeys = useRef(new Set<string>());
  const [activeQuest, setActiveQuest] = useState(() =>
    getStoredActiveOnboardingQuest(),
  );
  const normalizedPathname = normalizeOnboardingRoutePathname(location.pathname);
  const baseRouteEvent = ROUTE_EVENTS[normalizedPathname];
  const routeEvent = useMemo(() => {
    return buildOnboardingRouteEventForPath(
      baseRouteEvent,
      normalizedPathname,
      activeQuest,
    );
  }, [activeQuest, baseRouteEvent, normalizedPathname]);
  const eventKey = routeEvent?.eventKey;

  useEffect(() => {
    const refreshActiveQuest = () => {
      setActiveQuest(getStoredActiveOnboardingQuest());
    };

    window.addEventListener(ONBOARDING_QUEST_EVENT, refreshActiveQuest);
    window.addEventListener('storage', refreshActiveQuest);

    return () => {
      window.removeEventListener(ONBOARDING_QUEST_EVENT, refreshActiveQuest);
      window.removeEventListener('storage', refreshActiveQuest);
    };
  }, []);

  useEffect(() => {
    if (!account?.id || !routeEvent || !eventKey) return;

    const recordKey = buildOnboardingRouteEventRecordKey({
      accountId: account.id,
      eventKey,
      locationKey: location.key,
      pathname: location.pathname,
    });

    if (recordedKeys.current.has(recordKey)) return;
    recordedKeys.current.add(recordKey);

    void recordOnboardingEvent(routeEvent)
      .then((result) => {
        if (
          shouldClearActiveQuestAfterRouteEvent(
            activeQuest,
            location.pathname,
            result,
          )
        ) {
          clearStoredActiveOnboardingQuest();
          setActiveQuest(null);
        }
        if (
          result.completedTaskKeys.length > 0 ||
          (result.progressedTaskKeys?.length || 0) > 0
        ) {
          queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.all });
        }
      })
      .catch(() => {
        recordedKeys.current.delete(recordKey);
      });
  }, [
    account?.id,
    eventKey,
    location.key,
    location.pathname,
    queryClient,
    routeEvent,
    activeQuest,
  ]);

  return null;
}
