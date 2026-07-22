import { useQuery } from '@tanstack/react-query';
import { listActiveShiftReports } from '@/api/shift-reports';
import { queryKeys } from '@/api/query-keys';
import { getShiftReportsAttention } from '@/components/shift-reports-attention';
import { SidebarMenuBadge } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

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

  const statusClassName = 'bg-destructive text-destructive-foreground';

  if (placement === 'sidebar') {
    return (
      <SidebarMenuBadge
        aria-atomic="true"
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
      aria-atomic="true"
      aria-label={attention.ariaLabel}
      aria-live="polite"
      className={cn(
        'inline-flex h-5 min-w-6 shrink-0 items-center justify-center rounded-md px-1.5 text-[10px] font-semibold tabular-nums',
        statusClassName,
        className,
      )}
      data-slot="shift-reports-attention-badge"
      role="status"
    >
      {attention.label}
    </span>
  );
}
