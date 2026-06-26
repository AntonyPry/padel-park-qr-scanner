import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2.5 py-0.5 text-xs font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-200 ease-out motion-safe:hover:scale-[1.02] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm [a]:hover:bg-primary/85",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/85",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border bg-background/60 text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function getBadgeSignature(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getBadgeSignature).join('|');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return getBadgeSignature(node.props.children);
  }
  return '';
}

function Badge({
  children,
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"
  const signature = React.useMemo(
    () => `${variant}:${className ?? ''}:${getBadgeSignature(children)}`,
    [children, className, variant],
  )
  const previousSignature = React.useRef(signature)
  const [swapIndex, setSwapIndex] = React.useState(0)

  React.useEffect(() => {
    if (previousSignature.current === signature) return
    previousSignature.current = signature
    setSwapIndex((value) => value + 1)
  }, [signature])

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(
        badgeVariants({ variant }),
        swapIndex % 2 === 0 ? 'crm-badge-swap-a' : 'crm-badge-swap-b',
        className,
      )}
      {...props}
    >
      {children}
    </Comp>
  )
}

export { Badge, badgeVariants }
