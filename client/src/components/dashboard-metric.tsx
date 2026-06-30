import { type KeyboardEvent, type ReactNode, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { AnimatedMetricValue } from '@/components/animated-data';
import { cn } from '@/lib/utils';

export function HelpTooltip({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const closeOnEscape = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <Tooltip open={open}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Пояснение"
          aria-expanded={open}
          onBlur={() => setOpen(false)}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={closeOnEscape}
          onPointerEnter={() => setOpen(true)}
          onPointerLeave={() => setOpen(false)}
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
    <div className="flex min-w-0 items-center gap-1.5 text-xs leading-none text-muted-foreground">
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
    <div className="flex min-h-20 min-w-0 flex-col justify-center rounded-xl border bg-card p-4 shadow-sm shadow-foreground/5 [container-type:inline-size]">
      <div className="min-w-0">
        <MetricLabel tooltip={tooltip}>
          {icon}
          {label}
        </MetricLabel>
      </div>
      <div
        className={cn(
          'mt-2 max-w-full whitespace-normal [font-size:clamp(1rem,12cqw,1.5rem)] font-semibold leading-tight tracking-tight [overflow-wrap:anywhere]',
          valueClassName,
        )}
      >
        <AnimatedMetricValue value={value} />
      </div>
    </div>
  );
}
