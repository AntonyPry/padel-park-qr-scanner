import {
  CheckCircle2,
  Info,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ToastVariant = 'error' | 'info' | 'success';

interface ToastInput {
  description?: ReactNode;
  duration?: number;
  title: ReactNode;
  variant?: ToastVariant;
}

interface ToastMessage extends Required<Pick<ToastInput, 'duration' | 'variant'>> {
  description?: ReactNode;
  id: number;
  title: ReactNode;
}

type ToastOptions = Omit<ToastInput, 'title' | 'variant'>;

const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof window.setTimeout>>();
let messages: ToastMessage[] = [];
let idCounter = 1;

function notify() {
  listeners.forEach((listener) => listener());
}

function dismiss(id: number) {
  const timer = timers.get(id);
  if (timer) window.clearTimeout(timer);
  timers.delete(id);
  messages = messages.filter((message) => message.id !== id);
  notify();
}

function show(input: ToastInput | ReactNode, options?: ToastOptions) {
  const message: ToastMessage =
    typeof input === 'object' && input !== null && 'title' in input
      ? {
          description: input.description,
          duration: input.duration ?? 5000,
          id: idCounter++,
          title: input.title,
          variant: input.variant ?? 'info',
        }
      : {
          description: options?.description,
          duration: options?.duration ?? 5000,
          id: idCounter++,
          title: input,
          variant: 'info',
        };

  const nextMessages = [message, ...messages].slice(0, 5);
  const visibleIds = new Set(nextMessages.map((item) => item.id));
  timers.forEach((timer, id) => {
    if (!visibleIds.has(id)) {
      window.clearTimeout(timer);
      timers.delete(id);
    }
  });
  messages = nextMessages;
  notify();

  if (message.duration > 0) {
    timers.set(message.id, window.setTimeout(() => dismiss(message.id), message.duration));
  }

  return message.id;
}

export const toast = {
  dismiss,
  error(title: ReactNode, options?: ToastOptions) {
    return show({ ...options, title, variant: 'error' });
  },
  info(title: ReactNode, options?: ToastOptions) {
    return show({ ...options, title, variant: 'info' });
  },
  show,
  success(title: ReactNode, options?: ToastOptions) {
    return show({ ...options, title, variant: 'success' });
  },
};

const variantStyles: Record<ToastVariant, string> = {
  error: 'border-destructive/35 bg-destructive/10 text-foreground',
  info: 'border-border bg-popover text-popover-foreground',
  success: 'border-emerald-500/35 bg-emerald-500/10 text-foreground',
};

const variantIcons: Record<ToastVariant, typeof Info> = {
  error: TriangleAlert,
  info: Info,
  success: CheckCircle2,
};

export function Toaster() {
  const [items, setItems] = useState(messages);

  useEffect(() => {
    const listener = () => setItems([...messages]);
    listeners.add(listener);
    listener();

    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed right-4 top-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2"
    >
      {items.map((item) => {
        const Icon = variantIcons[item.variant];

        return (
          <div
            key={item.id}
            className={cn(
              'rounded-md border p-3 shadow-lg backdrop-blur',
              variantStyles[item.variant],
            )}
          >
            <div className="flex items-start gap-3">
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium leading-5">{item.title}</div>
                {item.description && (
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">
                    {item.description}
                  </div>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="-mr-1 -mt-1 h-7 w-7"
                onClick={() => dismiss(item.id)}
                aria-label="Закрыть уведомление"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
