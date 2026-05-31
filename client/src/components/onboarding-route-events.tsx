import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import {
  recordOnboardingEvent,
  type OnboardingClientEventPayload,
} from '@/api/onboarding';
import { queryKeys } from '@/api/query-keys';
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
  '/admin/finances': {
    entityId: '/admin/finances',
    entityType: 'route',
    eventKey: 'finance.report_viewed',
    payload: { route: '/admin/finances' },
  },
  '/admin/onboarding': {
    entityId: '/admin/onboarding',
    entityType: 'route',
    eventKey: 'report.viewed',
    payload: { report: 'onboarding_training_data', route: '/admin/onboarding' },
  },
  '/admin/references': {
    entityId: '/admin/references',
    entityType: 'route',
    eventKey: 'reference.viewed',
    payload: { route: '/admin/references' },
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

function normalizePathname(pathname: string) {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }

  return pathname;
}

export function OnboardingRouteEvents() {
  const { account } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();
  const recordedKeys = useRef(new Set<string>());
  const routeEvent = ROUTE_EVENTS[normalizePathname(location.pathname)];
  const eventKey = routeEvent?.eventKey;
  const payloadSignature = useMemo(
    () => JSON.stringify(routeEvent?.payload || {}),
    [routeEvent],
  );

  useEffect(() => {
    if (!account?.id || !routeEvent || !eventKey) return;

    const recordKey = [
      account.id,
      location.pathname,
      eventKey,
      payloadSignature,
    ].join(':');

    if (recordedKeys.current.has(recordKey)) return;
    recordedKeys.current.add(recordKey);

    void recordOnboardingEvent(routeEvent)
      .then((result) => {
        if (result.completedTaskKeys.length > 0) {
          queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.all });
        }
      })
      .catch(() => {
        recordedKeys.current.delete(recordKey);
      });
  }, [
    account?.id,
    eventKey,
    location.pathname,
    payloadSignature,
    queryClient,
    routeEvent,
  ]);

  return null;
}
