import { type ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export function HelpTooltip({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Пояснение"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        className="max-w-[280px] flex-col items-start leading-relaxed"
      >
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

export function MetricLabel({
  children,
  tooltip,
}: {
  children: ReactNode;
  tooltip: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span className="inline-flex min-w-0 items-center gap-1 truncate">
        {children}
      </span>
      <HelpTooltip>{tooltip}</HelpTooltip>
    </div>
  );
}

export function MetricCard({
  icon,
  label,
  tooltip,
  value,
  valueClassName = '',
}: {
  icon?: ReactNode;
  label: ReactNode;
  tooltip: ReactNode;
  value: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <MetricLabel tooltip={tooltip}>
        {icon}
        {label}
      </MetricLabel>
      <div className={`mt-1 text-2xl font-semibold ${valueClassName}`}>
        {value}
      </div>
    </div>
  );
}
