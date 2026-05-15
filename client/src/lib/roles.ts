export type AccountRole = 'owner' | 'manager' | 'admin' | 'accountant' | 'viewer';

export const ACCOUNT_ROLES: Array<{
  value: AccountRole;
  label: string;
  description: string;
}> = [
  {
    value: 'owner',
    label: 'Владелец',
    description:
      'Полный доступ: пользователи системы, настройки клуба, сотрудники, финансы, мотивация и SaaS-управление.',
  },
  {
    value: 'manager',
    label: 'Менеджер',
    description:
      'Операционное управление: гости, смены, сотрудники, финансы на просмотр и пользователи без ролей владельца/менеджера.',
  },
  {
    value: 'admin',
    label: 'Администратор',
    description:
      'Рабочая смена: входы гостей, ключи, цели визитов и собственная мотивация.',
  },
  {
    value: 'accountant',
    label: 'Бухгалтер',
    description:
      'Финансовый контур: P&L, ручные операции, категории, экспорт и сверка начислений.',
  },
  {
    value: 'viewer',
    label: 'Наблюдатель',
    description:
      'Только просмотр отчетов и аналитики без права менять операционные данные.',
  },
];

export function getAccountRole(role?: string | null) {
  return ACCOUNT_ROLES.find((item) => item.value === role);
}

export function getAccountRoleLabel(role?: string | null) {
  return getAccountRole(role)?.label || role || '-';
}

export function getAccountRoleDescription(role?: string | null) {
  return getAccountRole(role)?.description || '';
}
