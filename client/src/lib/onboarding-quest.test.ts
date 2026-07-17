import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activateOnboardingQuest,
  buildActiveOnboardingQuest,
  clearStoredActiveOnboardingQuest,
  getStoredActiveOnboardingQuest,
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
});
