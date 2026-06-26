import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ModuleSwitchItem {
  label: string;
  to: string;
}

interface ModuleSwitchProps {
  className?: string;
  items: ModuleSwitchItem[];
}

export function ModuleSwitch({ className, items }: ModuleSwitchProps) {
  const location = useLocation();

  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex w-full items-center rounded-full border bg-muted/40 p-1 shadow-sm shadow-foreground/5 sm:w-auto',
        className,
      )}
    >
      {items.map((item) => {
        const active = location.pathname === item.to;

        return (
          <Button
            key={item.to}
            asChild
            size="sm"
            variant="ghost"
            className={cn(
              'h-8 flex-1 rounded-full px-3 text-sm text-muted-foreground hover:text-foreground sm:flex-none',
              active &&
                'bg-background text-foreground shadow-sm shadow-foreground/10 hover:bg-background hover:text-foreground',
            )}
          >
            <Link to={item.to}>{item.label}</Link>
          </Button>
        );
      })}
    </div>
  );
}
