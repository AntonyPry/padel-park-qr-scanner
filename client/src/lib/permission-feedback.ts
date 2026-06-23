import type { ReactNode } from 'react';
import { toast } from '@/components/ui/toast';

export const PERMISSION_DENIED_TITLE = 'Недостаточно прав';

export const permissionMessages = {
  catalogManage:
    'Недостаточно прав для управления P&L-категориями и правилами справочника. Обратитесь к владельцу или бухгалтеру.',
  corporateDepositsManage:
    'Недостаточно прав для управления пополнениями и списаниями корпоративного баланса. Обратитесь к владельцу или бухгалтеру.',
  financeManage:
    'Недостаточно прав для создания финансовых операций. Обратитесь к владельцу или бухгалтеру.',
  motivationManage:
    'Недостаточно прав для управления мотивационными правилами категорий. Обратитесь к владельцу или менеджеру.',
  onboardingOwnerOnly:
    'Эта функция доступна только владельцу клуба.',
  payrollPay:
    'Недостаточно прав для отметки payroll выплаченным. Обратитесь к владельцу или бухгалтеру.',
  systemUsersRestricted:
    'Менеджер не может управлять аккаунтами владельца и других менеджеров. Обратитесь к владельцу.',
} as const;

export function showPermissionDenied(message: ReactNode) {
  toast.info(PERMISSION_DENIED_TITLE, {
    description: message,
  });
}
