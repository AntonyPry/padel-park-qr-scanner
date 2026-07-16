import type { ReactNode } from 'react';
import { AlertTriangle, Clock, Play, RotateCcw, Square } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
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
  { label: 'Отчеты', to: '/admin/shift/reports' },
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

  if (statusError && !activeShift) {
    return (
      <div className="flex min-h-[50px] w-full items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 lg:w-auto lg:min-w-[320px]">
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
        'flex min-h-[50px] w-full items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2 lg:w-auto lg:min-w-[320px]',
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
                'mt-0.5 flex items-center gap-2 font-mono text-lg leading-none tracking-widest',
                isLongShift ? 'text-amber-500' : 'text-foreground',
              )}
            >
              {isLongShift ? (
                <AlertTriangle className="h-5 w-5 shrink-0" />
              ) : (
                <Clock className="h-5 w-5 shrink-0 text-muted-foreground" />
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
            <Square className="mr-2 h-4 w-4 fill-current" />
            Завершить
          </Button>
        </>
      ) : (
        <>
          <span className="text-sm font-medium text-muted-foreground">
            {loaded ? 'Смена не начата' : 'Проверяем смену...'}
          </span>
          <Button
            className="shrink-0 bg-green-600 text-white hover:bg-green-700"
            disabled={!loaded || starting}
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
          className="grid min-h-[50px] min-w-0 flex-1 grid-cols-3 gap-1 rounded-xl border bg-muted/50 p-1"
        >
          {shiftSections.map((section) => (
            <NavLink
              key={section.to}
              className={({ isActive }) =>
                cn(
                  'flex min-h-10 min-w-0 items-center justify-center rounded-lg px-2 text-center text-sm font-medium text-muted-foreground transition-[background-color,color,box-shadow] duration-200',
                  'hover:bg-background/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  isActive &&
                    'bg-primary font-semibold text-primary-foreground shadow-md ring-1 ring-primary/30 hover:bg-primary/90 hover:text-primary-foreground',
                )
              }
              to={section.to}
            >
              <span className="min-w-0 break-words">{section.label}</span>
            </NavLink>
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
