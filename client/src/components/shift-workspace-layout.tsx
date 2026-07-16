import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';

const shiftSections = [
  { label: 'Мотивация', to: '/admin/shift/motivation' },
  { label: 'Отчеты', to: '/admin/shift/reports' },
  { label: 'Касса', to: '/admin/shift/cash' },
];

export default function ShiftWorkspaceLayout({ children }: { children?: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-5">
      <header className="grid min-w-0 gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Смена</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Текущая работа, отчеты и касса смены.
          </p>
        </div>
        <nav
          aria-label="Разделы смены"
          className="grid min-w-0 grid-cols-3 gap-1 rounded-xl border bg-muted/40 p-1"
        >
          {shiftSections.map((section) => (
            <NavLink
              key={section.to}
              className={({ isActive }) =>
                cn(
                  'flex min-h-10 min-w-0 items-center justify-center rounded-lg px-2 text-center text-sm font-medium text-muted-foreground transition-colors',
                  'hover:bg-background/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  isActive && 'bg-background text-foreground shadow-sm',
                )
              }
              to={section.to}
            >
              <span className="min-w-0 break-words">{section.label}</span>
            </NavLink>
          ))}
        </nav>
      </header>
      {children ?? <Outlet />}
    </div>
  );
}
