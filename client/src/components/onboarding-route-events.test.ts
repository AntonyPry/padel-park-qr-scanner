import { describe, expect, it } from 'vitest';
import {
  buildOnboardingRouteEventForPath,
  shouldClearActiveQuestAfterRouteEvent,
} from '@/lib/onboarding-route-event-utils';
import type { OnboardingClientEventPayload } from '@/api/onboarding';
import type { ActiveOnboardingQuest } from '@/lib/onboarding-quest';

const prepaymentsRouteEvent: OnboardingClientEventPayload = {
  entityId: '/admin/prepayments',
  entityType: 'route',
  eventKey: 'prepayments.viewed',
  payload: { route: '/admin/prepayments' },
};

const managerQuest: ActiveOnboardingQuest = {
  role: 'manager',
  route: '/admin/prepayments',
  startedAt: '2026-07-17T10:00:00.000Z',
  taskKey: 'manager.prepayments.dashboard-review',
  title: 'Проверить предоплаты',
};

describe('onboarding route event activation', () => {
  it('does not attach taskKey on direct route without active quest', () => {
    expect(
      buildOnboardingRouteEventForPath(
        prepaymentsRouteEvent,
        '/admin/prepayments',
        null,
      ),
    ).toEqual(prepaymentsRouteEvent);
  });

  it('does not attach taskKey when a sibling quest points to another route', () => {
    const siblingQuest: ActiveOnboardingQuest = {
      ...managerQuest,
      route: '/admin/manager-control',
      taskKey: 'manager.manager-control.daily-review',
    };

    expect(
      buildOnboardingRouteEventForPath(
        prepaymentsRouteEvent,
        '/admin/prepayments',
        siblingQuest,
      ),
    ).toEqual(prepaymentsRouteEvent);
  });

  it('attaches exact taskKey and selected role for active quest route', () => {
    expect(
      buildOnboardingRouteEventForPath(
        prepaymentsRouteEvent,
        '/admin/prepayments',
        managerQuest,
      ),
    ).toEqual({
      ...prepaymentsRouteEvent,
      role: 'manager',
      payload: {
        route: '/admin/prepayments',
        taskKey: 'manager.prepayments.dashboard-review',
      },
    });
  });

  it('clears exact quest after successful route event to avoid stale duplicate progress', () => {
    const routeEvent = buildOnboardingRouteEventForPath(
      prepaymentsRouteEvent,
      '/admin/prepayments',
      managerQuest,
    );

    expect(
      shouldClearActiveQuestAfterRouteEvent(
        managerQuest,
        '/admin/prepayments',
        { completedTaskKeys: [], progressedTaskKeys: [] },
        routeEvent,
      ),
    ).toBe(true);
  });

  it('clears when backend reports exact progressed task and keeps unrelated quests', () => {
    expect(
      shouldClearActiveQuestAfterRouteEvent(
        managerQuest,
        '/admin/prepayments',
        {
          completedTaskKeys: [],
          progressedTaskKeys: ['manager.prepayments.dashboard-review'],
        },
      ),
    ).toBe(true);

    expect(
      shouldClearActiveQuestAfterRouteEvent(
        managerQuest,
        '/admin/manager-control',
        {
          completedTaskKeys: [],
          progressedTaskKeys: ['manager.prepayments.dashboard-review'],
        },
      ),
    ).toBe(false);
  });

  it('supports owner role override by carrying the selected manager role', () => {
    const overrideQuest: ActiveOnboardingQuest = {
      role: 'manager',
      route: '/admin/shift-settings',
      startedAt: '2026-07-17T10:00:00.000Z',
      taskKey: 'manager.shift-report-templates.manage',
      title: 'Настроить шаблон отчета смены',
    };
    const shiftRouteEvent: OnboardingClientEventPayload = {
      entityId: '/admin/shift-settings',
      entityType: 'route',
      eventKey: 'report.viewed',
      payload: {
        report: 'shift_report_templates',
        route: '/admin/shift-settings',
      },
    };

    expect(
      buildOnboardingRouteEventForPath(
        shiftRouteEvent,
        '/admin/shift-settings',
        overrideQuest,
      ),
    ).toMatchObject({
      role: 'manager',
      payload: {
        report: 'shift_report_templates',
        route: '/admin/shift-settings',
        taskKey: 'manager.shift-report-templates.manage',
      },
    });
  });
});
