import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ErrorStateProps {
  actionLabel?: string;
  className?: string;
  compact?: boolean;
  message: string;
  onRetry?: () => void;
  title?: string;
}

export function ErrorState({
  actionLabel = 'Повторить',
  className,
  compact = false,
  message,
  onRetry,
  title = 'Не удалось загрузить данные',
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        'rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive',
        compact && 'p-3',
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <div className="font-medium">{title}</div>
            <div className="mt-1 text-destructive/85">{message}</div>
          </div>
        </div>
        {onRetry && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={onRetry}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {actionLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
