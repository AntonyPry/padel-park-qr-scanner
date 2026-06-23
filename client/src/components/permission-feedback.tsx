import { LockKeyhole } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  PERMISSION_DENIED_TITLE,
  showPermissionDenied,
} from '@/lib/permission-feedback';
import { cn } from '@/lib/utils';

type PermissionActionButtonProps = Omit<
  ComponentProps<typeof Button>,
  'disabled' | 'onClick'
> & {
  allowed: boolean;
  deniedMessage: ReactNode;
  deniedTitle?: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  onClick?: ComponentProps<'button'>['onClick'];
};

export function PermissionActionButton({
  allowed,
  children,
  className,
  deniedMessage,
  deniedTitle = PERMISSION_DENIED_TITLE,
  disabled = false,
  disabledReason,
  onClick,
  title,
  ...props
}: PermissionActionButtonProps) {
  const permissionBlocked = !allowed;
  const displayTitle =
    permissionBlocked && typeof deniedMessage === 'string'
      ? deniedMessage
      : !permissionBlocked && disabled && disabledReason
        ? disabledReason
        : title;

  return (
    <Button
      {...props}
      aria-disabled={permissionBlocked || undefined}
      className={cn(
        permissionBlocked &&
          'cursor-not-allowed opacity-60 hover:bg-background hover:text-foreground active:translate-y-0',
        className,
      )}
      disabled={permissionBlocked ? false : disabled}
      onClick={(event) => {
        if (permissionBlocked) {
          event.preventDefault();
          event.stopPropagation();
          showPermissionDenied(deniedMessage);
          return;
        }
        onClick?.(event);
      }}
      title={typeof displayTitle === 'string' ? displayTitle : undefined}
    >
      {children}
      {permissionBlocked && (
        <span className="sr-only">
          {typeof deniedTitle === 'string' ? `: ${deniedTitle}` : ''}
        </span>
      )}
    </Button>
  );
}

export function PermissionHint({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
