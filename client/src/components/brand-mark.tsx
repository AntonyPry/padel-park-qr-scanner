import { cn } from '@/lib/utils';

interface BrandMarkProps {
  className?: string;
  decorative?: boolean;
}

export function BrandMark({ className, decorative = false }: BrandMarkProps) {
  const alt = decorative ? '' : 'Setly';

  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center', className)}>
      <img
        src="/brand/setly-mark-black.png?v=20260721"
        alt={alt}
        className="size-full object-contain dark:hidden"
      />
      <img
        src="/brand/setly-mark-white.png?v=20260721"
        alt={alt}
        className="hidden size-full object-contain dark:block"
      />
    </span>
  );
}
