import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  className?: string;
  compact?: boolean;
  description?: string;
  icon?: ReactNode;
  title: string;
}

export function EmptyState({
  className,
  compact = false,
  description,
  icon,
  title,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col items-center justify-center text-center',
        compact ? 'gap-2 py-6' : 'gap-3 py-10',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="relative flex h-11 w-11 items-center justify-center rounded-2xl border bg-background text-muted-foreground shadow-sm"
      >
        <span className="absolute left-2 right-2 top-3 border-t border-dashed border-muted-foreground/30" />
        <span className="absolute bottom-3 left-3 right-3 border-t border-muted-foreground/20" />
        <span className="relative rounded-lg bg-background p-1">
          {icon || <Inbox className="h-4 w-4" />}
        </span>
      </div>
      <div className="min-w-0">
        <div className="break-words text-sm font-medium text-foreground">{title}</div>
        {description && (
          <div className="mt-1 max-w-md break-words text-sm text-muted-foreground">
            {description}
          </div>
        )}
      </div>
    </div>
  );
}
