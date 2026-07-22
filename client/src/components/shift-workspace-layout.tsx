import type { ReactNode } from 'react';
import { AlertTriangle, Clock, Play, RotateCcw, Square } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ShiftReportsAttentionBadge } from '@/components/shift-reports-attention-badge';
import {
  ShiftWorkspaceProvider,
} from '@/components/shift-workspace-context';
import {
  formatShiftDuration,
  useShiftWorkspace,
} from '@/components/shift-workspace-state';
import { cn } from '@/lib/utils';

const shiftSections = [
  { label: 'Мотивация', to: '/admin/shift/motivation' },
  { attentionBadge: true, label: 'Отчеты', to: '/admin/shift/reports' },
  { label: 'Касса', to: '/admin/shift/cash' },
];

function CurrentShiftPanel() {
  const navigate = useNavigate();
  const {
    activeShift,
    loaded,
    now,
    refreshActiveShift,
    startShift,
    starting,
    statusError,
  } = useShiftWorkspace();
  const isActive = activeShift?.status === 'active';
  const startedAt = activeShift?.startedAt
    ? new Date(activeShift.startedAt).getTime()
    : null;
  const durationMs = startedAt ? now - startedAt : 0;
  const isLongShift = isActive && durationMs > 16 * 3600000;

  if (!loaded && !activeShift && !statusError) {
    return (
      <div className="flex min-h-11 w-full items-center gap-3 rounded-xl border bg-card px-3 py-1.5 lg:w-auto lg:min-w-[300px]">
        <div className="grid flex-1 gap-1">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-7 w-24 rounded-lg" />
      </div>
    );
  }

  if (statusError && !activeShift) {
    return (
      <div className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-1.5 lg:w-auto lg:min-w-[300px]">
        <span className="text-sm text-destructive">Статус смены недоступен</span>
        <Button size="sm" variant="outline" onClick={() => void refreshActiveShift()}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Повторить
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border bg-card px-3 py-1.5 lg:w-auto lg:min-w-[300px]',
        isLongShift && 'border-amber-500/40 bg-amber-500/5',
      )}
    >
      {isActive ? (
        <>
          <div className="min-w-0">
            <div className="truncate text-xs text-muted-foreground">
              {activeShift.adminName}
            </div>
            <div
              className={cn(
                'mt-0.5 flex items-center gap-1.5 font-mono text-base leading-none tracking-widest',
                isLongShift ? 'text-amber-500' : 'text-foreground',
              )}
            >
              {isLongShift ? (
                <AlertTriangle className="h-4 w-4 shrink-0" />
              ) : (
                <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              {formatShiftDuration(durationMs)}
            </div>
          </div>
          <Button
            className="shrink-0"
            size="sm"
            variant="destructive"
            onClick={() => navigate('/admin/shift/motivation?closeShift=1')}
          >
            <Square className="h-3.5 w-3.5 fill-current" />
            Завершить
          </Button>
        </>
      ) : (
        <>
          <span className="text-sm font-medium text-muted-foreground">
            Смена не начата
          </span>
          <Button
            className="shrink-0 bg-green-600 text-white hover:bg-green-700"
            disabled={starting}
            size="sm"
            onClick={() => void startShift()}
          >
            <Play className="mr-2 h-4 w-4 fill-current" />
            Начать смену
          </Button>
        </>
      )}
    </div>
  );
}

function ShiftWorkspaceContent({ children }: { children?: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-stretch">
        <nav
          aria-label="Разделы смены"
          className="grid min-h-11 min-w-0 flex-1 grid-cols-3 gap-0.5 rounded-xl border bg-muted/40 p-0.5"
        >
          {shiftSections.map((section) => (
            <div className="relative grid min-w-0" key={section.to}>
              <NavLink
                className={({ isActive }) =>
                  cn(
                    'col-start-1 row-start-1 flex h-full min-h-9 min-w-0 items-center justify-center rounded-[10px] px-2 text-center text-sm font-medium text-muted-foreground transition-[background-color,color,box-shadow] duration-150',
                    'hover:bg-background/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    isActive &&
                      'bg-foreground/10 font-semibold text-foreground ring-1 ring-foreground/15 hover:bg-foreground/10 hover:text-foreground',
                  )
                }
                to={section.to}
              >
                {section.attentionBadge ? (
                  <span className="inline-grid min-w-0 grid-cols-[auto_1.5rem] items-center gap-1.5">
                    <span className="min-w-0 whitespace-nowrap">{section.label}</span>
                    <span aria-hidden="true" className="h-5 w-6" />
                  </span>
                ) : (
                  <span className="min-w-0 whitespace-nowrap">{section.label}</span>
                )}
              </NavLink>
              {section.attentionBadge ? (
                <span className="pointer-events-none col-start-1 row-start-1 inline-grid grid-cols-[auto_1.5rem] items-center gap-1.5 place-self-center text-sm font-medium">
                  <span aria-hidden="true" className="invisible whitespace-nowrap">
                    {section.label}
                  </span>
                  <ShiftReportsAttentionBadge className="w-6 min-w-6 px-0 text-[9px]" />
                </span>
              ) : null}
            </div>
          ))}
        </nav>
        <CurrentShiftPanel />
      </div>
      {children ?? <Outlet />}
    </div>
  );
}

export default function ShiftWorkspaceLayout({ children }: { children?: ReactNode }) {
  return (
    <ShiftWorkspaceProvider>
      <ShiftWorkspaceContent>{children}</ShiftWorkspaceContent>
    </ShiftWorkspaceProvider>
  );
}
