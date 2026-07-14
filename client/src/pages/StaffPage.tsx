import { useState, useEffect, useMemo, useCallback } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { cn } from '@/lib/utils';
import {
  Calendar as CalendarIcon,
  Plus,
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Download,
  Lock,
  Pencil,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { apiFetch, getApiErrorMessage, readApiError } from '@/lib/api';
import {
  canApprovePayroll,
  canManageShifts,
  canManageStaff,
  canPayPayroll,
  canReviewPayroll,
} from '@/lib/permissions';
import { useAuthorizationRole } from '@/lib/useAuth';
import {
  ConfirmActionDialog,
  type ConfirmAction,
} from '@/components/confirm-action-dialog';
import { DataTable } from '@/components/data-table';
import { MetricCard } from '@/components/dashboard-metric';
import {
  PermissionActionButton,
} from '@/components/permission-feedback';
import { toast } from '@/components/ui/toast';
import {
  permissionMessages,
  showPermissionDenied,
} from '@/lib/permission-feedback';
import { useRealtimeRefresh } from '@/lib/realtime';

interface AdminStat {
  staffId?: number | null;
  name: string;
  totalShifts: number;
  totalHours: number;
  basePay: number;
  calculatedBonusPay?: number;
  manualAdjustmentTotal?: number;
  bonusPay: number;
  totalPay: number;
}

const formatHours = (value: number) =>
  value.toLocaleString('ru-RU', {
    maximumFractionDigits: 2,
  });
interface PayrollItem {
  name: string;
  category: string;
  sum: number;
  qty: number;
  bucket?: string;
  bonus?: number;
  bonusRuleNames?: string[];
}
interface ShiftRecord {
  id: number | string;
  isDraft: boolean;
  date: string;
  endedAt?: string | null;
  status?: string;
  staffId?: number | null;
  adminName: string | null;
  startedAt?: string | null;
  hours: number;
  dailyRevenue: number;
  basePay: number;
  calculatedBonus?: number;
  manualAdjustment?: number;
  comment?: string;
  bonus: number;
  total: number;
  items: PayrollItem[];
}

interface PayrollPeriod {
  id: number;
  fromDate: string;
  toDate: string;
  status: 'draft' | 'reviewed' | 'approved' | 'paid';
  note?: string;
  reviewedAt?: string | null;
  approvedAt?: string | null;
  paidAt?: string | null;
  updatedAt?: string | null;
  reviewedBy?: PayrollActor | null;
  approvedBy?: PayrollActor | null;
  paidBy?: PayrollActor | null;
}

interface PayrollActor {
  id?: number;
  email?: string;
  name?: string;
  role?: string;
}

interface StaffMember {
  id: number;
  name: string;
  position?: string;
  role?: string;
  phone?: string | null;
  status: 'active' | 'inactive' | 'archived' | string;
}

type PendingAction = ConfirmAction & {
  onConfirm: () => Promise<void>;
};

const staffFormSchema = z.object({
  name: z.string().trim().min(2, 'Минимум 2 символа'),
  phone: z.string(),
  position: z.string().trim().min(2, 'Укажите должность'),
  status: z.enum(['active', 'inactive', 'archived']),
});
type StaffFormValues = z.infer<typeof staffFormSchema>;

const shiftFormSchema = z
  .object({
    adminName: z.string(),
    comment: z.string(),
    date: z.string().min(1, 'Укажите дату'),
    hours: z
      .string()
      .min(1, 'Укажите часы')
      .refine((value) => Number(value) > 0, {
        message: 'Часы должны быть больше 0',
      }),
    id: z.string(),
    manualAdjustment: z
      .string()
      .refine((value) => value === '' || Number.isFinite(Number(value)), {
        message: 'Введите число',
      }),
    staffId: z.string().min(1, 'Выберите сотрудника'),
  })
  .superRefine((value, ctx) => {
    if (Number(value.manualAdjustment || 0) !== 0 && !value.comment.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Укажите причину ручной корректировки',
        path: ['comment'],
      });
    }
  });
type ShiftFormValues = z.infer<typeof shiftFormSchema>;

const emptyStaffForm: StaffFormValues = {
  name: '',
  phone: '',
  position: 'Администратор',
  status: 'active',
};
const emptyShiftForm: ShiftFormValues = {
  adminName: '',
  comment: '',
  date: '',
  hours: '',
  id: '',
  manualAdjustment: '',
  staffId: '',
};

function getStaffPosition(staff: StaffMember) {
  return staff.position || staff.role || '-';
}

function formatTime(value?: string | null) {
  if (!value) return '';
  return format(new Date(value), 'HH:mm');
}

function formatShiftTimeRange(shift: ShiftRecord) {
  if (shift.startedAt && shift.endedAt) {
    return `${formatTime(shift.startedAt)}-${formatTime(shift.endedAt)}`;
  }
  if (shift.startedAt) return `с ${formatTime(shift.startedAt)}`;
  if (shift.endedAt) return `до ${formatTime(shift.endedAt)}`;
  return '';
}

export default function StaffPage() {
  const organizationRole = useAuthorizationRole('organization');
  const clubRole = useAuthorizationRole('club');
  const canEditStaff = canManageStaff(organizationRole);
  const canEditShifts = canManageShifts(clubRole);
  const canReview = canReviewPayroll(organizationRole);
  const canApprove = canApprovePayroll(organizationRole);
  const canPay = canPayPayroll(organizationRole);
  const [admins, setAdmins] = useState<AdminStat[]>([]);
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [payrollPeriod, setPayrollPeriod] = useState<PayrollPeriod | null>(null);
  const [payrollLocked, setPayrollLocked] = useState(false);
  const [payrollWarnings, setPayrollWarnings] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState('');

  const now = new Date();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(now.getFullYear(), now.getMonth(), 1),
    to: now,
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [detailModal, setDetailModal] = useState<{
    isOpen: boolean;
    shift: ShiftRecord | null;
  }>({ isOpen: false, shift: null });

  const [staffStatus, setStaffStatus] = useState<'active' | 'archived' | 'all'>(
    'active',
  );
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingActionLoading, setPendingActionLoading] = useState(false);
  const shiftForm = useForm<ShiftFormValues>({
    defaultValues: emptyShiftForm,
    resolver: zodResolver(shiftFormSchema),
  });
  const staffForm = useForm<StaffFormValues>({
    defaultValues: emptyStaffForm,
    resolver: zodResolver(staffFormSchema),
  });
  const shiftFormId = shiftForm.watch('id');
  const shiftFormStaffId = shiftForm.watch('staffId');
  const staffFormStatus = staffForm.watch('status');

  const fetchPayroll = useCallback(async () => {
    setErrorMessage('');
    const fromStr = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : '';
    const toStr = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : fromStr;

    try {
      const [payrollRes, staffRes] = await Promise.all([
        apiFetch(`/api/finance/payroll?from=${fromStr}&to=${toStr}`),
        apiFetch('/api/staff'),
      ]);
      const errors: string[] = [];

      if (payrollRes.ok) {
        const data = await payrollRes.json();
        setAdmins(data.admins);
        setShifts(data.shifts);
        setPayrollPeriod(data.period || null);
        setPayrollLocked(Boolean(data.locked));
        setPayrollWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      } else {
        const data = (await payrollRes.json().catch(() => ({}))) as {
          error?: string;
        };
        errors.push(data.error || 'Не удалось загрузить payroll');
      }

      if (staffRes.ok) {
        setStaff((await staffRes.json()) as StaffMember[]);
      } else {
        const apiError = await readApiError(
          staffRes,
          'Не удалось загрузить сотрудников',
        );
        errors.push(apiError.message);
      }

      if (errors.length > 0) {
        setErrorMessage(errors.join(' '));
      }
    } catch (e) {
      console.error(e);
      setErrorMessage(getApiErrorMessage(e, 'Не удалось загрузить payroll'));
    }
  }, [dateRange]);

  useEffect(() => {
    void fetchPayroll();
  }, [fetchPayroll]);

  useRealtimeRefresh(['staff', 'shifts', 'payroll', 'accounts', 'finance'], () => {
    void fetchPayroll();
  });

  useEffect(() => {
    if (errorMessage) {
      toast.error(errorMessage);
    }
  }, [errorMessage]);

  const handleSaveShift = shiftForm.handleSubmit(async (values) => {
    if (payrollLocked) {
      setErrorMessage('Payroll-период закрыт. Смены внутри него менять нельзя.');
      return;
    }

    const selectedStaff = staff.find(
      (item) => String(item.id) === values.staffId,
    );

    if (!selectedStaff) {
      shiftForm.setError('staffId', {
        message: 'Выберите сотрудника смены',
        type: 'manual',
      });
      return;
    }

    try {
      setErrorMessage('');
      const method =
        String(values.id).startsWith('draft-') || !values.id ? 'POST' : 'PUT';
      const payload = {
        ...values,
        id: String(values.id).startsWith('draft-') ? undefined : values.id,
        staffId: selectedStaff.id,
        adminName: selectedStaff.name,
        hours: Number(values.hours) || 0,
        manualAdjustment: Number(values.manualAdjustment) || 0,
      };

      const res = await apiFetch('/api/shifts', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setIsModalOpen(false);
        fetchPayroll();
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMessage(data.error || 'Не удалось сохранить смену');
      }
    } catch (e) {
      console.error(e);
      setErrorMessage('Не удалось сохранить смену');
    }
  });

  const handleDelete = async (id: number | string) => {
    if (String(id).startsWith('draft-')) return;
    if (payrollLocked) {
      setErrorMessage('Payroll-период закрыт. Смены внутри него менять нельзя.');
      return;
    }

    try {
      const res = await apiFetch('/api/shifts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          reason: 'Архивировано из раздела персонала и смен',
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMessage(data.error || 'Не удалось архивировать смену');
        return;
      }
      fetchPayroll();
    } catch (e) {
      console.error(e);
      setErrorMessage('Не удалось архивировать смену');
    }
  };

  const requestDeleteShift = (shift: ShiftRecord) => {
    setPendingAction({
      confirmLabel: 'В архив',
      description: `Смена за ${shift.date} будет убрана из расчета. Если период уже закрыт, сервер не даст изменить смену.`,
      isDestructive: true,
      onConfirm: () => handleDelete(shift.id),
      title: 'Архивировать смену?',
    });
  };

  const openForm = (shift?: ShiftRecord) => {
    if (shift) {
      const matchedStaff =
        shift.staffId ||
        staff.find((item) => item.name === shift.adminName)?.id ||
        '';

      shiftForm.reset({
        id: String(shift.id),
        date: shift.date,
        staffId: matchedStaff ? String(matchedStaff) : '',
        adminName: shift.adminName || '',
        hours: String(shift.hours || ''),
        manualAdjustment: String(shift.manualAdjustment || ''),
        comment: shift.comment || '',
      });
    } else {
      shiftForm.reset({
        ...emptyShiftForm,
        date: format(new Date(), 'yyyy-MM-dd'),
      });
    }
    setIsModalOpen(true);
  };

  const getRangeParams = () => {
    const fromStr = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : '';
    const toStr = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : fromStr;
    return { fromStr, toStr };
  };

  const requestCreatePayrollPeriod = () => {
    const { fromStr, toStr } = getRangeParams();
    setPendingAction({
      confirmLabel: 'Создать период',
      description: `Будет создан черновик payroll за ${fromStr} — ${toStr}. В нем сохранится расчет, который можно отправить на проверку.`,
      onConfirm: async () => {
        const res = await apiFetch('/api/finance/payroll/periods', {
          method: 'POST',
          body: JSON.stringify({ from: fromStr, to: toStr }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setErrorMessage(data.error || 'Не удалось создать payroll-период');
          return;
        }
        await fetchPayroll();
      },
      title: 'Создать payroll-период?',
    });
  };

  const requestRecalculatePayrollPeriod = () => {
    if (!payrollPeriod) return;
    setPendingAction({
      confirmLabel: 'Пересчитать',
      description:
        'Черновик будет пересчитан по текущим сменам, чекам, мотивации и ручным корректировкам.',
      onConfirm: async () => {
        const res = await apiFetch(
          `/api/finance/payroll/periods/${payrollPeriod.id}/recalculate`,
          {
            method: 'POST',
            body: JSON.stringify({ reason: 'Ручной пересчет payroll' }),
          },
        );
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setErrorMessage(data.error || 'Не удалось пересчитать payroll');
          return;
        }
        await fetchPayroll();
      },
      title: 'Пересчитать payroll?',
    });
  };

  const requestPayrollTransition = (
    status: PayrollPeriod['status'],
    title: string,
    confirmLabel: string,
    description: string,
    isDestructive = false,
  ) => {
    if (!payrollPeriod) return;
    if (status === 'paid' && !canPay) {
      showPermissionDenied(permissionMessages.payrollPay);
      return;
    }
    if (status === 'approved' && !canApprove) return;
    if ((status === 'reviewed' || status === 'draft') && !canReview) return;

    setPendingAction({
      confirmLabel,
      description,
      isDestructive,
      onConfirm: async () => {
        const res = await apiFetch(
          `/api/finance/payroll/periods/${payrollPeriod.id}/status`,
          {
            method: 'PATCH',
            body: JSON.stringify({ status }),
          },
        );
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setErrorMessage(data.error || 'Не удалось изменить статус payroll');
          return;
        }
        await fetchPayroll();
      },
      title,
    });
  };

  const handleExportPayroll = async () => {
    const { fromStr, toStr } = getRangeParams();
    const query = payrollPeriod
      ? `periodId=${payrollPeriod.id}`
      : `from=${fromStr}&to=${toStr}`;
    const res = await apiFetch(`/api/finance/payroll/export?${query}`);

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErrorMessage(data.error || 'Не удалось выгрузить payroll');
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `payroll-${fromStr}-${toStr}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const openStaffForm = (item?: StaffMember) => {
    if (item) {
      setEditingStaff(item);
      staffForm.reset({
        name: item.name,
        phone: item.phone || '',
        position: getStaffPosition(item),
        status: ['active', 'inactive', 'archived'].includes(item.status)
          ? (item.status as StaffFormValues['status'])
          : 'active',
      });
    } else {
      setEditingStaff(null);
      staffForm.reset(emptyStaffForm);
    }

    setIsStaffModalOpen(true);
  };

  const closeStaffForm = () => {
    setIsStaffModalOpen(false);
    setEditingStaff(null);
    staffForm.reset(emptyStaffForm);
  };

  const saveStaff = async (
    values: StaffFormValues,
    target: StaffMember | null,
  ) => {
    try {
      const payload = {
        name: values.name.trim(),
        position: values.position.trim(),
        phone: values.phone.trim() || undefined,
        status: values.status,
      };

      const res = await apiFetch(
        target ? `/api/staff/${target.id}` : '/api/staff',
        {
          method: target ? 'PUT' : 'POST',
          body: JSON.stringify(payload),
        },
      );

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setErrorMessage(data.error || 'Не удалось сохранить сотрудника');
        return;
      }

      closeStaffForm();
      fetchPayroll();
    } catch (e) {
      console.error(e);
      setErrorMessage('Не удалось сохранить сотрудника');
    }
  };

  const handleSaveStaff = staffForm.handleSubmit(async (values) => {
    const changesArchiveState =
      editingStaff &&
      values.status !== editingStaff.status &&
      (values.status === 'archived' || editingStaff.status === 'archived');

    if (changesArchiveState) {
      const target = editingStaff;
      const goesToArchive = values.status === 'archived';
      setPendingAction({
        confirmLabel: goesToArchive ? 'В архив' : 'Восстановить',
        description: goesToArchive
          ? `Сотрудник «${target.name}» будет убран из активного списка. Остальные изменения формы тоже будут сохранены.`
          : `Сотрудник «${target.name}» снова появится в активной операционной базе. Остальные изменения формы тоже будут сохранены.`,
        isDestructive: goesToArchive,
        onConfirm: () => saveStaff(values, target),
        title: goesToArchive
          ? 'Архивировать сотрудника?'
          : 'Восстановить сотрудника?',
      });
      return;
    }

    await saveStaff(values, editingStaff);
  });

  const executeArchiveStaff = async (item: StaffMember) => {
    try {
      const res = await apiFetch(`/api/staff/${item.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setErrorMessage(data.error || 'Не удалось отключить сотрудника');
        return;
      }

      fetchPayroll();
    } catch (e) {
      console.error(e);
    }
  };

  const executeRestoreStaff = async (item: StaffMember) => {
    const res = await apiFetch(`/api/staff/${item.id}/restore`, {
      method: 'POST',
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setErrorMessage(data.error || 'Не удалось восстановить сотрудника');
      return;
    }
    fetchPayroll();
  };

  const executePermanentDeleteStaff = async (item: StaffMember) => {
    const res = await apiFetch(`/api/staff/${item.id}/permanent`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setErrorMessage(data.error || 'Не удалось удалить сотрудника из архива');
      return;
    }
    fetchPayroll();
  };

  const requestArchiveStaff = (item: StaffMember) => {
    const isArchived = item.status === 'archived';
    setPendingAction({
      confirmLabel: isArchived ? 'Восстановить' : 'В архив',
      description: isArchived
        ? `Сотрудник «${item.name}» снова появится в активной операционной базе.`
        : `Сотрудник «${item.name}» будет убран из активного списка. Смены и payroll сохранятся.`,
      isDestructive: !isArchived,
      onConfirm: () =>
        isArchived ? executeRestoreStaff(item) : executeArchiveStaff(item),
      title: isArchived ? 'Восстановить сотрудника?' : 'Архивировать сотрудника?',
    });
  };

  const requestPermanentDeleteStaff = (item: StaffMember) => {
    setPendingAction({
      confirmLabel: 'Удалить навсегда',
      description: `Сотрудник «${item.name}» будет удален без возможности восстановления. Сервер не даст удалить его, если есть смены или привязанный аккаунт.`,
      isDestructive: true,
      onConfirm: () => executePermanentDeleteStaff(item),
      title: 'Удалить сотрудника из архива?',
    });
  };

  const confirmPendingAction = async () => {
    if (!pendingAction) return;

    setPendingActionLoading(true);
    try {
      await pendingAction.onConfirm();
      setPendingAction(null);
    } finally {
      setPendingActionLoading(false);
    }
  };

  const stats = useMemo(() => {
    let totalShifts = 0,
      totalDrafts = 0,
      totalHours = 0,
      totalRev = 0,
      totalPay = 0;
    shifts.forEach((s) => {
      if (s.isDraft) totalDrafts++;
      else {
        totalShifts++;
        totalHours += s.hours;
      }
      totalRev += s.dailyRevenue;
      totalPay += s.total;
    });
    return { totalShifts, totalDrafts, totalHours, totalRev, totalPay };
  }, [shifts]);

  const activeStaff = useMemo(
    () => staff.filter((item) => item.status === 'active'),
    [staff],
  );
  const displayedStaff = useMemo(() => {
    if (staffStatus === 'all') return staff;
    return staff.filter((item) => item.status === staffStatus);
  }, [staff, staffStatus]);

  const getBucketStyles = (bucket: string) => {
    switch (bucket) {
      case 'bonus':
        return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border-transparent';
      default:
        return 'bg-transparent';
    }
  };

  const payrollStatusLabel: Record<PayrollPeriod['status'], string> = {
    draft: 'Черновик',
    reviewed: 'Проверен',
    approved: 'Утвержден',
    paid: 'Выплачен',
  };

  const payrollStatusClass = payrollPeriod
    ? {
        draft: 'bg-muted text-foreground',
        reviewed: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
        approved: 'bg-green-500/10 text-green-500 border-green-500/20',
        paid: 'bg-primary/10 text-primary border-primary/20',
      }[payrollPeriod.status]
    : 'bg-muted text-muted-foreground';

  const canChangeShifts = canEditShifts && !payrollLocked;
  const staffColumns: ColumnDef<StaffMember>[] = [
    {
      accessorKey: 'name',
      header: 'Имя',
      size: 220,
      meta: {
        cellClassName: 'truncate font-medium',
      },
    },
    {
      id: 'position',
      header: 'Должность',
      size: 220,
      meta: {
        cellClassName: 'truncate',
      },
      cell: ({ row }) => getStaffPosition(row.original),
    },
    {
      accessorKey: 'phone',
      header: 'Телефон',
      size: 170,
      meta: {
        cellClassName: 'truncate text-muted-foreground',
      },
      cell: ({ row }) => row.original.phone || '-',
    },
  ];
  const shiftColumns: ColumnDef<ShiftRecord>[] = [
    {
      accessorKey: 'date',
      header: 'Дата',
      size: 170,
      meta: {
        cellClassName: 'whitespace-nowrap font-medium',
      },
      cell: ({ row }) => {
        const shift = row.original;
        const timeRange = formatShiftTimeRange(shift);

        return (
          <div>
            <div>{shift.date}</div>
            {timeRange ? (
              <div className="mt-0.5 text-xs font-normal text-muted-foreground">
                {timeRange}
              </div>
            ) : !shift.isDraft ? (
              <div className="mt-0.5 text-xs font-normal text-muted-foreground">
                Смена #{shift.id}
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'admin',
      header: 'Администратор',
      cell: ({ row }) =>
        row.original.isDraft ? (
          <span className="text-xs text-muted-foreground">Не указано</span>
        ) : (
          row.original.adminName
        ),
    },
    {
      accessorKey: 'hours',
      header: 'Часы',
      meta: {
        cellClassName: 'text-right',
        headerClassName: 'text-right',
      },
      cell: ({ row }) => row.original.hours || '—',
    },
    {
      accessorKey: 'dailyRevenue',
      header: 'Выручка',
      meta: {
        cellClassName: 'text-right',
        headerClassName: 'text-right',
      },
      cell: ({ row }) => `${row.original.dailyRevenue.toLocaleString('ru-RU')} ₽`,
    },
    {
      id: 'bonus',
      header: 'Бонус',
      meta: {
        cellClassName: 'text-right text-muted-foreground',
        headerClassName: 'text-right',
      },
      cell: ({ row }) => {
        const bonus = Number(row.original.calculatedBonus || 0);

        if (bonus > 0) return `+${bonus.toLocaleString('ru-RU')} ₽`;
        if (bonus === 0) return '—';
        return `${bonus.toLocaleString('ru-RU')} ₽`;
      },
    },
    {
      id: 'adjustment',
      header: 'Корр.',
      meta: {
        headerClassName: 'text-right',
      },
      cell: ({ row }) => {
        const adjustment = Number(row.original.manualAdjustment || 0);

        return (
          <span
            className={
              adjustment < 0 ? 'text-destructive' : 'text-muted-foreground'
            }
          >
            {adjustment === 0
              ? '—'
              : `${adjustment > 0 ? '+' : ''}${adjustment.toLocaleString(
                  'ru-RU',
                )} ₽`}
          </span>
        );
      },
    },
    {
      accessorKey: 'total',
      header: 'Итого',
      meta: {
        cellClassName: 'text-right text-base font-bold',
        headerClassName: 'text-right',
      },
      cell: ({ row }) =>
        row.original.total > 0
          ? `${row.original.total.toLocaleString('ru-RU')} ₽`
          : '—',
    },
  ];
  const adminColumns: ColumnDef<AdminStat>[] = [
    {
      accessorKey: 'name',
      header: 'Администратор',
      meta: {
        cellClassName: 'text-base font-medium',
      },
    },
    {
      accessorKey: 'totalShifts',
      header: 'Смен',
      meta: {
        cellClassName: 'text-right font-medium',
        headerClassName: 'text-right',
      },
    },
    {
      accessorKey: 'totalHours',
      header: 'Часы',
      meta: {
        cellClassName: 'text-right',
        headerClassName: 'text-right',
      },
      cell: ({ row }) => formatHours(row.original.totalHours),
    },
    {
      accessorKey: 'basePay',
      header: 'База',
      meta: {
        cellClassName: 'text-right text-muted-foreground',
        headerClassName: 'text-right',
      },
      cell: ({ row }) => `${row.original.basePay.toLocaleString('ru-RU')} ₽`,
    },
    {
      id: 'bonusPay',
      header: 'Бонусы',
      meta: {
        cellClassName: 'text-right text-muted-foreground',
        headerClassName: 'text-right',
      },
      cell: ({ row }) =>
        `${Number(
          row.original.calculatedBonusPay ?? row.original.bonusPay,
        ).toLocaleString('ru-RU')} ₽`,
    },
    {
      id: 'manualAdjustmentTotal',
      header: 'Корр.',
      meta: {
        headerClassName: 'text-right',
      },
      cell: ({ row }) => {
        const adjustment = Number(row.original.manualAdjustmentTotal || 0);

        return (
          <span
            className={
              adjustment < 0 ? 'text-destructive' : 'text-muted-foreground'
            }
          >
            {adjustment.toLocaleString('ru-RU')} ₽
          </span>
        );
      },
    },
    {
      accessorKey: 'totalPay',
      header: 'Итого',
      meta: {
        cellClassName: 'text-right text-lg font-bold',
        headerClassName: 'text-right',
      },
      cell: ({ row }) => `${row.original.totalPay.toLocaleString('ru-RU')} ₽`,
    },
  ];
  const sortedAdmins = useMemo(
    () => admins.toSorted((a, b) => b.totalPay - a.totalPay),
    [admins],
  );

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <h1 className="sr-only">Персонал и смены</h1>
      <div className="flex flex-col gap-3 rounded-xl border bg-card/60 p-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={payrollStatusClass}>
              {payrollPeriod ? payrollStatusLabel[payrollPeriod.status] : 'Период не создан'}
            </Badge>
            <span className="truncate text-sm text-muted-foreground">
              {payrollPeriod
                ? `${payrollPeriod.fromDate} — ${payrollPeriod.toDate}`
                : 'Выберите даты и создайте период'}
            </span>
            {payrollLocked && (
              <Badge variant="outline" className="gap-1">
                <Lock className="h-3 w-3" /> Закрыт
              </Badge>
            )}
            {payrollWarnings.length > 0 && (
              <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-600">
                <AlertTriangle className="h-3 w-3" />
                {payrollWarnings.length} предупрежд.
              </Badge>
            )}
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center justify-end gap-2 xl:w-auto xl:flex-nowrap">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={'outline'}
                className={cn(
                  'w-full justify-start bg-card text-left font-normal sm:w-[240px]',
                  !dateRange && 'text-muted-foreground',
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateRange?.from ? (
                  dateRange.to ? (
                    <>
                      {format(dateRange.from, 'dd.MM.yyyy')} —{' '}
                      {format(dateRange.to, 'dd.MM.yyyy')}
                    </>
                  ) : (
                    format(dateRange.from, 'dd.MM.yyyy')
                  )
                ) : (
                  <span>Выберите период</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                initialFocus
                mode="range"
                defaultMonth={dateRange?.from}
                selected={dateRange}
                onSelect={setDateRange}
                numberOfMonths={1}
                locale={ru}
              />
            </PopoverContent>
          </Popover>
          <Button variant="outline" onClick={handleExportPayroll}>
            <Download className="w-4 h-4 mr-2" /> Экспорт
          </Button>
          {canEditStaff && (
            <Button variant="outline" onClick={() => openStaffForm()}>
              <Plus className="w-4 h-4 mr-2" /> Сотрудник
            </Button>
          )}
          {canEditShifts && (
            <Button
              onClick={() => openForm()}
              disabled={payrollLocked}
              title={
                payrollLocked
                  ? 'Payroll-период закрыт, смены внутри него менять нельзя'
                  : 'Добавить смену'
              }
            >
              <Plus className="w-4 h-4 mr-2" /> Добавить смену
            </Button>
          )}
          {!payrollPeriod && canReview && (
            <Button onClick={requestCreatePayrollPeriod}>Создать период</Button>
          )}
          {payrollPeriod?.status === 'draft' && canReview && (
            <>
              <Button variant="outline" onClick={requestRecalculatePayrollPeriod}>
                <RotateCcw className="w-4 h-4 mr-2" /> Пересчитать
              </Button>
              <Button
                onClick={() =>
                  requestPayrollTransition(
                    'reviewed',
                    'Отправить payroll на проверку?',
                    'На проверку',
                    'Расчет будет пересчитан и зафиксирован. После этого смены и ручные операции в периоде нельзя будет менять без возврата в черновик.',
                  )
                }
              >
                На проверку
              </Button>
            </>
          )}
          {payrollPeriod?.status === 'reviewed' && canReview && (
            <Button
              variant="outline"
              onClick={() =>
                requestPayrollTransition(
                  'draft',
                  'Вернуть payroll в черновик?',
                  'Вернуть',
                  'Период снова станет редактируемым. Это нужно делать только если нашли ошибку в сменах или корректировках.',
                  true,
                )
              }
            >
              В черновик
            </Button>
          )}
          {payrollPeriod?.status === 'reviewed' && canApprove && (
            <Button
              onClick={() =>
                requestPayrollTransition(
                  'approved',
                  'Утвердить payroll?',
                  'Утвердить',
                  'После утверждения расчет считается финальным для выплаты.',
                )
              }
            >
              Утвердить
            </Button>
          )}
          {payrollPeriod?.status === 'approved' && (
            <PermissionActionButton
              allowed={canPay}
              deniedMessage={permissionMessages.payrollPay}
              onClick={() =>
                requestPayrollTransition(
                  'paid',
                  'Отметить payroll выплаченным?',
                  'Выплачено',
                  'Период будет помечен как выплаченный. Это финальный статус.',
                )
              }
            >
              Выплачено
            </PermissionActionButton>
          )}
        </div>
      </div>

      {/* KPI КАРТОЧКИ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <MetricCard
          label="Смен"
          tooltip="Заполненные смены, которые участвуют в расчете payroll."
          value={stats.totalShifts}
        />
        <MetricCard
          label="Черновики"
          tooltip="Дни, где есть кассовые операции, но смена еще не заполнена администратором и часами."
          value={stats.totalDrafts}
          valueClassName="text-amber-500"
        />
        <MetricCard
          label="Часов"
          tooltip="Сумма рабочих часов по заполненным сменам в выбранном периоде."
          value={stats.totalHours.toLocaleString()}
        />
        <MetricCard
          label="Выручка"
          tooltip="Выручка, которая использована для расчета бонусов смен в выбранном периоде."
          value={`${stats.totalRev.toLocaleString()} ₽`}
        />
        <MetricCard
          label="Начислено"
          tooltip="Базовая оплата, бонусы мотивации и ручные корректировки по всем заполненным сменам."
          value={`${stats.totalPay.toLocaleString()} ₽`}
          valueClassName="text-primary"
        />
      </div>

      <div className="rounded-md border bg-card">
        <div className="px-4 py-3 border-b flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold">Сотрудники</div>
            <div className="text-xs text-muted-foreground">
              Рабочие смены привязываются к этой базе.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={staffStatus}
              onValueChange={(value) =>
                setStaffStatus(value as 'active' | 'archived' | 'all')
              }
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Активные</SelectItem>
                <SelectItem value="archived">Архив</SelectItem>
                <SelectItem value="all">Все</SelectItem>
              </SelectContent>
            </Select>
            {canEditStaff && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => openStaffForm()}
              >
                <Plus className="w-4 h-4 mr-2" /> Добавить
              </Button>
            )}
          </div>
        </div>
        <DataTable
          columns={staffColumns}
          data={displayedStaff}
          emptyText="Сотрудники еще не добавлены"
          getRowProps={(row) => ({
            className: canEditStaff
              ? 'cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'
              : undefined,
            onClick: canEditStaff
              ? () => openStaffForm(row.original)
              : undefined,
            onKeyDown: canEditStaff
              ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openStaffForm(row.original);
                  }
                }
              : undefined,
            role: canEditStaff ? 'button' : undefined,
            tabIndex: canEditStaff ? 0 : undefined,
          })}
          tableClassName="table-fixed"
          renderMobileCard={(row) => {
            const item = row.original;

            return (
              <button
                type="button"
                className="w-full min-w-0 rounded-xl border bg-card p-4 text-left shadow-sm transition enabled:hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                disabled={!canEditStaff}
                onClick={() => openStaffForm(item)}
              >
                <div className="break-words font-semibold">{item.name}</div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">Должность</div>
                    <div className="mt-1 break-words">{getStaffPosition(item)}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">Телефон</div>
                    <div className="mt-1 break-all">{item.phone || '-'}</div>
                  </div>
                </div>
                {canEditStaff && (
                  <div className="mt-3 text-xs font-medium text-primary">
                    Открыть карточку сотрудника
                  </div>
                )}
              </button>
            );
          }}
        />
      </div>

      {/* ЖУРНАЛ СМЕН */}
      <div className="rounded-md border bg-card">
        <div className="border-b px-4 py-3">
          <div className="font-semibold">Журнал смен</div>
          <div className="text-xs text-muted-foreground">
            Показаны смены выбранного периода. Откройте строку для детализации
            продаж и бонусов.
          </div>
        </div>
        <DataTable
          columns={shiftColumns}
          data={shifts}
          emptyText="Нет данных за этот период"
          getRowProps={(row) => ({
            className:
              'cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            onClick: () =>
              setDetailModal({ isOpen: true, shift: row.original }),
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setDetailModal({ isOpen: true, shift: row.original });
              }
            },
            role: 'button',
            tabIndex: 0,
          })}
          pageSize={15}
          tableClassName="table-fixed"
          renderMobileCard={(row) => {
            const shift = row.original;
            const timeRange = formatShiftTimeRange(shift);

            return (
              <button
                type="button"
                className="w-full min-w-0 rounded-xl border bg-card p-4 text-left shadow-sm transition hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setDetailModal({ isOpen: true, shift })}
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div>
                    <div className="whitespace-nowrap font-semibold">{shift.date}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {timeRange || `Смена #${shift.id}`}
                    </div>
                  </div>
                  <div className="min-w-0 text-right text-sm">
                    <div className="break-words font-medium">
                      {shift.adminName || 'Администратор не указан'}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {shift.hours || '—'} ч
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Выручка</div>
                    <div className="mt-1 font-medium">
                      {shift.dailyRevenue.toLocaleString('ru-RU')} ₽
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Итого</div>
                    <div className="mt-1 font-semibold">
                      {shift.total > 0
                        ? `${shift.total.toLocaleString('ru-RU')} ₽`
                        : '—'}
                    </div>
                  </div>
                </div>
              </button>
            );
          }}
        />
      </div>

      {/* ТАБЛИЦА АГРЕГАЦИИ ПО АДМИНАМ */}
      <div className="mt-8 rounded-md border bg-card">
        <DataTable
          columns={adminColumns}
          data={sortedAdmins}
          emptyText="Нет заполненных смен за выбранный период"
          tableClassName="table-fixed"
          renderMobileCard={(row) => {
            const admin = row.original;

            return (
              <div className="min-w-0 rounded-xl border bg-card p-4 shadow-sm">
                <div className="break-words font-semibold">{admin.name}</div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Смены / часы</div>
                    <div className="mt-1 font-medium">
                      {admin.totalShifts} / {formatHours(admin.totalHours)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">База</div>
                    <div className="mt-1">{admin.basePay.toLocaleString('ru-RU')} ₽</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Бонусы</div>
                    <div className="mt-1">
                      {Number(
                        admin.calculatedBonusPay ?? admin.bonusPay,
                      ).toLocaleString('ru-RU')} ₽
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Итого</div>
                    <div className="mt-1 font-semibold">
                      {admin.totalPay.toLocaleString('ru-RU')} ₽
                    </div>
                  </div>
                </div>
              </div>
            );
          }}
        />
      </div>

      <Dialog
        open={isStaffModalOpen}
        onOpenChange={(open) => (open ? setIsStaffModalOpen(true) : closeStaffForm())}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingStaff ? 'Редактировать сотрудника' : 'Новый сотрудник'}
            </DialogTitle>
            <div className="text-sm text-muted-foreground">
              Сотрудник используется в сменах, payroll и операционной логике.
              Доступ в CRM создается в разделе пользователей.
            </div>
          </DialogHeader>
          <form onSubmit={handleSaveStaff} className="space-y-4 pt-2">
            <div>
              <Label className="mb-1 block text-xs">Имя</Label>
              <Input
                {...staffForm.register('name')}
                aria-invalid={Boolean(staffForm.formState.errors.name)}
              />
              {staffForm.formState.errors.name && (
                <p className="mt-1 text-xs text-destructive">
                  {staffForm.formState.errors.name.message}
                </p>
              )}
            </div>
            <div>
              <Label className="mb-1 block text-xs">
                Должность
              </Label>
              <Input
                {...staffForm.register('position')}
                aria-invalid={Boolean(staffForm.formState.errors.position)}
              />
              {staffForm.formState.errors.position && (
                <p className="mt-1 text-xs text-destructive">
                  {staffForm.formState.errors.position.message}
                </p>
              )}
            </div>
            <div>
              <Label className="mb-1 block text-xs">Телефон</Label>
              <Input {...staffForm.register('phone')} />
            </div>
            <div>
              <Label className="mb-1 block text-xs">Статус</Label>
              <Select
                value={staffFormStatus}
                onValueChange={(status) =>
                  staffForm.setValue('status', status as StaffFormValues['status'], {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Активен</SelectItem>
                  <SelectItem value="inactive">Отключен</SelectItem>
                  <SelectItem value="archived">Архив</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <div className="flex flex-wrap gap-2">
                {editingStaff && canEditStaff && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const target = editingStaff;
                      closeStaffForm();
                      requestArchiveStaff(target);
                    }}
                  >
                    {editingStaff.status === 'archived' ? (
                      <ArchiveRestore className="mr-2 h-4 w-4" />
                    ) : (
                      <Archive className="mr-2 h-4 w-4" />
                    )}
                    {editingStaff.status === 'archived' ? 'Восстановить' : 'В архив'}
                  </Button>
                )}
                {editingStaff?.status === 'archived' && canEditStaff && (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => {
                      const target = editingStaff;
                      closeStaffForm();
                      requestPermanentDeleteStaff(target);
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Удалить
                  </Button>
                )}
              </div>
              <Button type="submit">
                {editingStaff ? 'Сохранить' : 'Создать'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ФОРМА ДОБАВЛЕНИЯ/РЕДАКТИРОВАНИЯ */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {shiftFormId && !String(shiftFormId).startsWith('draft-')
                ? 'Редактирование смены'
                : 'Заполнение черновика / Новая смена'}
            </DialogTitle>
            <div className="text-sm text-muted-foreground">
              Выберите сотрудника и укажите рабочие часы.
            </div>
          </DialogHeader>
          <form onSubmit={handleSaveShift} className="space-y-4 pt-2">
            <div>
              <Label className="mb-1 block text-xs">Дата</Label>
              <Input
                type="date"
                {...shiftForm.register('date')}
                aria-invalid={Boolean(shiftForm.formState.errors.date)}
                disabled={String(shiftFormId).startsWith('draft-')}
              />
              {shiftForm.formState.errors.date && (
                <p className="mt-1 text-xs text-destructive">
                  {shiftForm.formState.errors.date.message}
                </p>
              )}
            </div>
            <div>
              <Label className="mb-1 block text-xs">
                Администратор
              </Label>
              <Select
                value={shiftFormStaffId}
                onValueChange={(staffId) => {
                  const selectedStaff = staff.find(
                    (item) => String(item.id) === staffId,
                  );
                  shiftForm.setValue('staffId', staffId, {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                  shiftForm.setValue('adminName', selectedStaff?.name || '', {
                    shouldDirty: true,
                  });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Выберите сотрудника" />
                </SelectTrigger>
                <SelectContent>
                  {activeStaff.map((item) => (
                    <SelectItem key={item.id} value={String(item.id)}>
                      {item.name} · {getStaffPosition(item)}
                    </SelectItem>
                  ))}
                  {activeStaff.length === 0 && (
                    <SelectItem value="empty" disabled>
                      Сначала добавьте сотрудника
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              {shiftForm.formState.errors.staffId && (
                <p className="mt-1 text-xs text-destructive">
                  {shiftForm.formState.errors.staffId.message}
                </p>
              )}
            </div>
            <div>
              <Label className="mb-1 block text-xs">Часы</Label>
              <Input
                type="number"
                step="0.5"
                placeholder="12"
                {...shiftForm.register('hours')}
                aria-invalid={Boolean(shiftForm.formState.errors.hours)}
              />
              {shiftForm.formState.errors.hours && (
                <p className="mt-1 text-xs text-destructive">
                  {shiftForm.formState.errors.hours.message}
                </p>
              )}
            </div>
            <div>
              <Label className="mb-1 block text-xs">
                Корректировка зарплаты
              </Label>
              <Input
                type="number"
                step="1"
                placeholder="0"
                {...shiftForm.register('manualAdjustment')}
                aria-invalid={Boolean(
                  shiftForm.formState.errors.manualAdjustment,
                )}
              />
              <div className="mt-1 text-xs text-muted-foreground">
                Можно указать премию или штраф вручную.
              </div>
              {shiftForm.formState.errors.manualAdjustment && (
                <p className="mt-1 text-xs text-destructive">
                  {shiftForm.formState.errors.manualAdjustment.message}
                </p>
              )}
            </div>
            <div>
              <Label className="mb-1 block text-xs">
                Комментарий
              </Label>
              <Input
                placeholder="По необходимости"
                {...shiftForm.register('comment')}
                aria-invalid={Boolean(shiftForm.formState.errors.comment)}
              />
              {shiftForm.formState.errors.comment && (
                <p className="mt-1 text-xs text-destructive">
                  {shiftForm.formState.errors.comment.message}
                </p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={payrollLocked}>
              Сохранить
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* ДЕТАЛИЗАЦИЯ (ЧЕКИ ВНУТРИ СМЕНЫ) */}
      <Dialog
        open={detailModal.isOpen}
        onOpenChange={(val) =>
          setDetailModal((prev) => ({ ...prev, isOpen: val }))
        }
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col p-0">
          <div className="px-6 py-4 border-b bg-muted/30">
            <DialogTitle className="text-2xl font-bold">
              {detailModal.shift?.date} —{' '}
              {detailModal.shift?.isDraft
                ? 'Черновик'
                : detailModal.shift?.adminName}
            </DialogTitle>
            {!detailModal.shift?.isDraft && (
              <div className="text-sm text-muted-foreground mt-1">
                Часы: {detailModal.shift?.hours} • Выручка:{' '}
                {detailModal.shift?.dailyRevenue.toLocaleString()} ₽ • База:{' '}
                {detailModal.shift?.basePay.toLocaleString()} ₽ • Премия:{' '}
                {Number(
                  detailModal.shift?.calculatedBonus ??
                    detailModal.shift?.bonus ??
                    0,
                ).toLocaleString()}{' '}
                ₽
                {Number(detailModal.shift?.manualAdjustment || 0) !== 0 &&
                  ` • Корректировка: ${Number(detailModal.shift?.manualAdjustment).toLocaleString()} ₽`}
              </div>
            )}
          </div>

          <div className="px-6 py-3 border-b flex gap-2 flex-wrap bg-card">
            <Badge variant="outline" className={getBucketStyles('bonus')}>
              Начислен бонус по правилу мотивации
            </Badge>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-2 sm:px-6">
            <div className="grid gap-2 md:hidden">
              {detailModal.shift?.items?.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Нет кассовых операций в этот день
                </div>
              )}
              {detailModal.shift?.items?.map((item, idx) => (
                <div
                  key={idx}
                  className={cn(
                    'min-w-0 rounded-xl border p-3',
                    item.bucket ? getBucketStyles(item.bucket) : '',
                  )}
                >
                  <div className="break-words font-medium">{item.name}</div>
                  <div className="mt-1 break-words text-xs opacity-70">
                    {item.category}
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <div className="text-xs text-muted-foreground">Кол-во</div>
                      <div className="mt-1">{item.qty}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Сумма</div>
                      <div className="mt-1 font-medium">
                        {item.sum.toLocaleString('ru-RU')} ₽
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Бонус</div>
                      <div className="mt-1 font-medium">
                        {Number(item.bonus) > 0
                          ? `+${Number(item.bonus).toLocaleString('ru-RU')} ₽`
                          : '-'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <Table
              className="hidden table-fixed md:table"
              containerClassName="hidden overflow-visible md:block"
            >
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40%]">Позиция</TableHead>
                  <TableHead className="w-[14%] text-right">Кол-во</TableHead>
                  <TableHead className="w-[20%] text-right">Сумма</TableHead>
                  <TableHead className="w-[26%] text-right">Бонус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detailModal.shift?.items?.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center py-8 text-muted-foreground"
                    >
                      Нет кассовых операций в этот день
                    </TableCell>
                  </TableRow>
                )}
                {detailModal.shift?.items?.map((item, idx) => (
                  <TableRow
                    key={idx}
                    className={item.bucket ? getBucketStyles(item.bucket) : ''}
                  >
                    <TableCell className="align-top whitespace-normal">
                      <div className="font-medium break-words">{item.name}</div>
                      <div className="text-xs opacity-70 mt-0.5 break-words">
                        {item.category}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{item.qty}</TableCell>
                    <TableCell className="text-right font-medium">
                      {item.sum.toLocaleString('ru-RU')} ₽
                    </TableCell>
                    <TableCell className="text-right align-top whitespace-normal">
                      {Number(item.bonus) > 0 ? (
                        <div>
                          <div className="font-medium text-green-600">
                            +{Number(item.bonus).toLocaleString('ru-RU')} ₽
                          </div>
                          <div className="text-xs text-muted-foreground break-words">
                            {item.bonusRuleNames?.join(', ')}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t bg-card p-4">
            {detailModal.shift && canEditShifts && (
              <Button
                type="button"
                disabled={!canChangeShifts}
                title={
                  canChangeShifts
                    ? 'Изменить смену'
                    : 'Payroll-период закрыт, смены менять нельзя'
                }
                onClick={() => {
                  const shift = detailModal.shift;
                  if (!shift) return;
                  setDetailModal({ isOpen: false, shift: null });
                  openForm(shift);
                }}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Изменить
              </Button>
            )}
            {detailModal.shift && canEditShifts && !detailModal.shift.isDraft && (
              <Button
                type="button"
                variant="destructive"
                disabled={!canChangeShifts}
                title={
                  canChangeShifts
                    ? 'Архивировать смену'
                    : 'Payroll-период закрыт, смены менять нельзя'
                }
                onClick={() => {
                  const shift = detailModal.shift;
                  if (!shift) return;
                  setDetailModal({ isOpen: false, shift: null });
                  requestDeleteShift(shift);
                }}
              >
                <Archive className="mr-2 h-4 w-4" />
                В архив
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() =>
                setDetailModal((prev) => ({ ...prev, isOpen: false }))
              }
            >
              Закрыть
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        action={pendingAction}
        loading={pendingActionLoading}
        onCancel={() => setPendingAction(null)}
        onConfirm={confirmPendingAction}
      />
    </div>
  );
}
