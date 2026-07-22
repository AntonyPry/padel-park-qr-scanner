import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activateOnboardingQuest,
  buildActiveOnboardingQuest,
  clearStoredActiveOnboardingQuest,
  clearStoredActiveOnboardingQuestAfterProgress,
  getStoredActiveOnboardingQuest,
  getStoredActiveOnboardingQuestForPath,
  ONBOARDING_QUEST_STORAGE_KEY,
} from './onboarding-quest';

afterEach(() => {
  clearStoredActiveOnboardingQuest();
  window.localStorage.clear();
  vi.useRealTimers();
});

describe('onboarding quest activation', () => {
  it('builds exact task, route, title and selected role before CRM navigation', () => {
    vi.setSystemTime(new Date('2026-07-17T10:00:00.000Z'));

    const quest = buildActiveOnboardingQuest(
      {
        key: 'manager.shift-report-templates.manage',
        route: '/admin/shift-settings',
        title: 'Настроить шаблон отчета смены',
      },
      'manager',
    );

    expect(quest).toEqual({
      role: 'manager',
      route: '/admin/shift-settings',
      startedAt: '2026-07-17T10:00:00.000Z',
      taskKey: 'manager.shift-report-templates.manage',
      title: 'Настроить шаблон отчета смены',
    });
  });

  it('stores owner role for ordinary owner tasks', () => {
    activateOnboardingQuest(
      {
        key: 'owner.shift-report-templates.manage',
        route: '/admin/shift-settings',
        title: 'Проверить шаблоны отчетов смены',
      },
      'owner',
    );

    expect(getStoredActiveOnboardingQuest()).toMatchObject({
      role: 'owner',
      route: '/admin/shift-settings',
      taskKey: 'owner.shift-report-templates.manage',
      title: 'Проверить шаблоны отчетов смены',
    });
  });

  it('stores selected lesson role for owner role override tasks', () => {
    activateOnboardingQuest(
      {
        key: 'manager.shift-report-templates.manage',
        route: '/admin/shift-settings',
        title: 'Настроить шаблон отчета смены',
      },
      'manager',
    );

    expect(getStoredActiveOnboardingQuest()).toMatchObject({
      role: 'manager',
      route: '/admin/shift-settings',
      taskKey: 'manager.shift-report-templates.manage',
    });
  });

  it('does not store missing, disabled or external routes', () => {
    expect(
      activateOnboardingQuest(
        {
          key: 'manager.shift-report-templates.manage',
          route: '',
          title: 'Настроить шаблон отчета смены',
        },
        'manager',
      ),
    ).toBeNull();
    expect(
      activateOnboardingQuest(
        {
          key: 'manager.shift-report-templates.manage',
          route: 'https://example.com',
          title: 'Настроить шаблон отчета смены',
        },
        'manager',
      ),
    ).toBeNull();
    expect(window.localStorage.getItem(ONBOARDING_QUEST_STORAGE_KEY)).toBeNull();
  });

  it('replaces the previous task intentionally and only exposes it on its CRM route', () => {
    activateOnboardingQuest(
      {
        key: 'manager.prepayments.dashboard-review',
        route: '/admin/prepayments',
        title: 'Проверить предоплаты',
      },
      'manager',
    );
    activateOnboardingQuest(
      {
        key: 'manager.shift-report-templates.manage',
        route: '/admin/shift-settings',
        title: 'Настроить шаблон отчета смены',
      },
      'manager',
    );

    expect(getStoredActiveOnboardingQuest()?.taskKey).toBe(
      'manager.shift-report-templates.manage',
    );
    expect(
      getStoredActiveOnboardingQuestForPath('/admin/prepayments'),
    ).toBeNull();
    expect(
      getStoredActiveOnboardingQuestForPath('/admin/shift-settings/'),
    ).toMatchObject({
      taskKey: 'manager.shift-report-templates.manage',
    });
  });

  it('clears only after backend confirms exact progress or completion', () => {
    activateOnboardingQuest(
      {
        key: 'admin.client.create',
        route: '/admin/clients',
        title: 'Создать клиента из обращения',
      },
      'admin',
    );

    expect(
      clearStoredActiveOnboardingQuestAfterProgress({
        progressedTaskKeys: [],
      }),
    ).toBeNull();
    expect(getStoredActiveOnboardingQuest()).not.toBeNull();

    expect(
      clearStoredActiveOnboardingQuestAfterProgress({
        completedTaskKeys: ['admin.booking.review-schedule'],
      }),
    ).toBeNull();
    expect(getStoredActiveOnboardingQuest()).not.toBeNull();

    expect(
      clearStoredActiveOnboardingQuestAfterProgress({
        progressedTaskKeys: ['admin.client.create'],
      }),
    ).toMatchObject({ taskKey: 'admin.client.create' });
    expect(getStoredActiveOnboardingQuest()).toBeNull();
  });
});
