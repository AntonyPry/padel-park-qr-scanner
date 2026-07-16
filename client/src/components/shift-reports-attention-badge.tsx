import { useQuery } from '@tanstack/react-query';
import { listActiveShiftReports, type ShiftReport } from '@/api/shift-reports';
import { queryKeys } from '@/api/query-keys';
import { SidebarMenuBadge } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

const ACTIONABLE_STATUSES = new Set(['pending', 'draft', 'overdue']);

export interface ShiftReportsAttention {
  ariaLabel: string;
  count: number;
  hasOverdue: boolean;
  label: string;
}

function getShiftReportsAttention(
  reports: Array<Pick<ShiftReport, 'computedStatus'>>,
): ShiftReportsAttention | null {
  const actionable = reports.filter((report) =>
    ACTIONABLE_STATUSES.has(report.computedStatus),
  );
  if (actionable.length === 0) return null;

  const hasOverdue = actionable.some(
    (report) => report.computedStatus === 'overdue',
  );

  return {
    ariaLabel: hasOverdue
      ? `${actionable.length} отчетов требуют внимания, есть просроченные`
      : `${actionable.length} отчетов требуют внимания`,
    count: actionable.length,
    hasOverdue,
    label: actionable.length > 99 ? '99+' : String(actionable.length),
  };
}

function useShiftReportsAttention() {
  const reportsQuery = useQuery({
    queryFn: listActiveShiftReports,
    queryKey: queryKeys.shiftReports.active(),
    retry: false,
    staleTime: 30_000,
  });

  if (
    reportsQuery.isError ||
    reportsQuery.isFetching ||
    !reportsQuery.data
  ) {
    return null;
  }

  return getShiftReportsAttention(reportsQuery.data.reports);
}

export function ShiftReportsAttentionBadge({
  className,
  placement = 'inline',
}: {
  className?: string;
  placement?: 'inline' | 'sidebar';
}) {
  const attention = useShiftReportsAttention();
  if (!attention) return null;

  const statusClassName = attention.hasOverdue
    ? 'bg-destructive text-destructive-foreground'
    : 'bg-primary text-primary-foreground';

  if (placement === 'sidebar') {
    return (
      <SidebarMenuBadge
        aria-label={attention.ariaLabel}
        aria-live="polite"
        className={cn(
          'min-w-6 justify-center px-1.5 text-[10px] font-semibold tabular-nums',
          statusClassName,
          className,
        )}
        data-slot="shift-reports-attention-badge"
        role="status"
      >
        {attention.label}
      </SidebarMenuBadge>
    );
  }

  return (
    <span
      aria-label={attention.ariaLabel}
      className={cn(
        'inline-flex h-5 min-w-6 shrink-0 items-center justify-center rounded-md px-1.5 text-[10px] font-semibold tabular-nums',
        statusClassName,
        className,
      )}
      data-slot="shift-reports-attention-badge"
    >
      {attention.label}
    </span>
  );
}
