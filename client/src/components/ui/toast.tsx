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

type ToastState = 'closing' | 'open';

interface ToastMessage extends Required<Pick<ToastInput, 'duration' | 'variant'>> {
  description?: ReactNode;
  id: number;
  state: ToastState;
  title: ReactNode;
}

type ToastOptions = Omit<ToastInput, 'title' | 'variant'>;

const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof window.setTimeout>>();
const exitTimers = new Map<number, ReturnType<typeof window.setTimeout>>();
const buttonDoneTimers = new WeakMap<HTMLElement, ReturnType<typeof window.setTimeout>>();
let messages: ToastMessage[] = [];
let idCounter = 1;
let lastActionButton: HTMLElement | null = null;
let lastActionButtonAt = 0;
let feedbackTrackerInstalled = false;

function notify() {
  listeners.forEach((listener) => listener());
}

function removeMessage(id: number) {
  const exitTimer = exitTimers.get(id);
  if (exitTimer) window.clearTimeout(exitTimer);
  exitTimers.delete(id);
  messages = messages.filter((message) => message.id !== id);
  notify();
}

function dismiss(id: number) {
  const timer = timers.get(id);
  if (timer) window.clearTimeout(timer);
  timers.delete(id);
  const currentMessage = messages.find((message) => message.id === id);
  if (!currentMessage || currentMessage.state === 'closing') return;

  messages = messages.map((message) =>
    message.id === id ? { ...message, state: 'closing' } : message,
  );
  notify();
  exitTimers.set(id, window.setTimeout(() => removeMessage(id), 220));
}

function installFeedbackTracker() {
  if (feedbackTrackerInstalled || typeof window === 'undefined') return;
  feedbackTrackerInstalled = true;

  window.document.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest<HTMLElement>('[data-slot="button"]');
      if (!button) return;
      lastActionButton = button;
      lastActionButtonAt = Date.now();
    },
    true,
  );
}

function getFeedbackButton() {
  if (typeof window === 'undefined') return null;

  const activeElement = window.document.activeElement;
  const activeButton =
    activeElement instanceof HTMLElement
      ? activeElement.closest<HTMLElement>('[data-slot="button"]')
      : null;
  const recentButton =
    lastActionButton && Date.now() - lastActionButtonAt < 4000
      ? lastActionButton
      : null;
  const button = activeButton || recentButton;
  if (!button || !button.isConnected) return null;
  if (button.getAttribute('aria-haspopup')) return null;
  if (button.dataset.size?.startsWith('icon')) return null;
  if (!button.textContent?.trim()) return null;

  return button;
}

function markActionButtonDone() {
  const button = getFeedbackButton();
  if (!button) return;

  const previousTimer = buttonDoneTimers.get(button);
  if (previousTimer) window.clearTimeout(previousTimer);
  button.dataset.feedbackState = 'done';
  buttonDoneTimers.set(
    button,
    window.setTimeout(() => {
      if (button.dataset.feedbackState === 'done') {
        delete button.dataset.feedbackState;
      }
      buttonDoneTimers.delete(button);
    }, 1100),
  );
}

function show(input: ToastInput | ReactNode, options?: ToastOptions) {
  installFeedbackTracker();
  const message: ToastMessage =
    typeof input === 'object' && input !== null && 'title' in input
      ? {
          description: input.description,
          duration: input.duration ?? 5000,
          id: idCounter++,
          state: 'open',
          title: input.title,
          variant: input.variant ?? 'info',
        }
      : {
          description: options?.description,
          duration: options?.duration ?? 5000,
          id: idCounter++,
          state: 'open',
          title: input,
          variant: 'info',
        };

  const nextMessages = [
    message,
    ...messages.filter((item) => item.state === 'open'),
  ].slice(0, 5);
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
    markActionButtonDone();
    return show({ ...options, title, variant: 'success' });
  },
};

const variantStyles: Record<ToastVariant, string> = {
  error: 'border-destructive/35 bg-popover text-popover-foreground',
  info: 'border-border bg-popover text-popover-foreground',
  success: 'border-emerald-500/35 bg-popover text-popover-foreground',
};

const variantIcons: Record<ToastVariant, typeof Info> = {
  error: TriangleAlert,
  info: Info,
  success: CheckCircle2,
};

const variantIconStyles: Record<ToastVariant, string> = {
  error: 'text-destructive',
  info: 'text-muted-foreground',
  success: 'text-emerald-500',
};

export function Toaster() {
  const [items, setItems] = useState(messages);

  useEffect(() => {
    installFeedbackTracker();
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
            data-state={item.state}
            data-variant={item.variant}
            className={cn(
              'crm-toast-item rounded-xl border p-3 shadow-lg shadow-foreground/10',
              variantStyles[item.variant],
            )}
          >
            <div className="flex items-start gap-3">
              <Icon
                className={cn(
                  'mt-0.5 h-4 w-4 shrink-0',
                  item.variant === 'success' && 'crm-toast-check',
                  variantIconStyles[item.variant],
                )}
              />
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
