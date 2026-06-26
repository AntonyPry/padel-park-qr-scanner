import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface ChartLoadingStateProps {
  className?: string;
  title?: string;
}

function MetricPlaceholder({ index }: { index: number }) {
  return (
    <div
      className="crm-soft-pop rounded-2xl border bg-card p-4 shadow-sm"
      style={{ animationDelay: `${index * 45}ms` }}
    >
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-7 w-24" />
    </div>
  );
}

function ChartPlaceholderCard({ index }: { index: number }) {
  return (
    <Card className="crm-soft-pop" style={{ animationDelay: `${index * 70}ms` }}>
      <CardHeader className="pb-3">
        <Skeleton className="h-4 w-40" />
      </CardHeader>
      <CardContent>
        <div className="grid min-h-[250px] gap-5 md:grid-cols-[220px_minmax(0,1fr)] md:items-center">
          <div className="relative mx-auto h-[210px] w-[210px]">
            <Skeleton className="h-full w-full rounded-full" />
            <div className="absolute inset-12 rounded-full border bg-card shadow-inner" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-2">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            {Array.from({ length: 5 }).map((_, rowIndex) => (
              <div key={rowIndex} className="flex items-center gap-3">
                <Skeleton className="h-2.5 w-2.5 rounded-full" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-12" />
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ChartLoadingState({
  className,
  title = 'Загрузка данных',
}: ChartLoadingStateProps) {
  return (
    <div
      role="status"
      aria-label={title}
      className={cn('grid gap-4', className)}
    >
      <span className="sr-only">{title}</span>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <MetricPlaceholder key={index} index={index} />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartPlaceholderCard index={0} />
        <ChartPlaceholderCard index={1} />
      </div>
    </div>
  );
}
