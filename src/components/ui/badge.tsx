import type { HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'text-foreground',
        destructive: 'border-transparent bg-destructive/10 text-destructive',
        queued: 'border-transparent bg-muted text-muted-foreground',
        running: 'border-transparent text-[var(--run)] bg-[color-mix(in_oklab,var(--run)_16%,transparent)]',
        complete: 'border-transparent bg-muted text-muted-foreground',
        error: 'border-transparent bg-destructive/10 text-destructive',
      },
    },
    defaultVariants: {
      variant: 'secondary',
    },
  },
)

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = ({ className, variant, ...props }: BadgeProps) => (
  <span className={cn(badgeVariants({ variant }), className)} {...props} />
)

export { badgeVariants }
