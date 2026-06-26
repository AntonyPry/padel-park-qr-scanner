import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={isDark ? 'Включить светлую тему' : 'Включить темную тему'}
      aria-pressed={isDark}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="ml-auto size-8 rounded-xl text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      <span className="relative size-4">
        <Sun
          className={cn(
            'absolute inset-0 h-4 w-4 transition-[opacity,transform] duration-1000 ease-out',
            isDark ? 'rotate-0 scale-100 opacity-100' : '-rotate-45 scale-75 opacity-0',
          )}
        />
        <Moon
          className={cn(
            'absolute inset-0 h-4 w-4 transition-[opacity,transform] duration-1000 ease-out',
            isDark ? 'rotate-45 scale-75 opacity-0' : 'rotate-0 scale-100 opacity-100',
          )}
        />
      </span>
    </Button>
  );
}
