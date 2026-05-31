import { FlaskConical, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getAccountRoleLabel } from '@/lib/roles';
import { useTrainingMode } from '@/lib/useTrainingMode';

export function TrainingModeBanner() {
  const { disable, loading, state } = useTrainingMode();

  if (!state.isEnabled) return null;

  return (
    <div className="sticky top-0 z-30 border-b border-amber-200 bg-amber-50 px-4 py-2 text-amber-950 shadow-sm dark:border-amber-900/60 dark:bg-amber-950 dark:text-amber-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <FlaskConical className="h-4 w-4 shrink-0" />
          <span className="truncate font-medium">
            Режим тренировки: {getAccountRoleLabel(state.role)}
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-amber-300 bg-amber-100 text-amber-950 hover:bg-amber-200 dark:border-amber-800 dark:bg-amber-900 dark:text-amber-50 dark:hover:bg-amber-800"
          disabled={loading}
          onClick={() => {
            void disable();
          }}
        >
          <Power className="h-4 w-4" />
          Выключить
        </Button>
      </div>
    </div>
  );
}
