import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/utils'

export const STAGE_FOLD_MS = 300

export const StageFold = ({
  open,
  animate,
  children,
  className,
  labelledBy,
  ...props
}: {
  open: boolean
  animate: boolean
  children: ReactNode
  labelledBy?: string
} & HTMLAttributes<HTMLDivElement>) => (
  <div
    data-stage-fold=""
    data-open={open ? 'true' : 'false'}
    aria-hidden={open ? undefined : true}
    aria-labelledby={labelledBy}
    className={cn('stage-fold', open && 'is-open', animate && 'is-animate', className)}
    {...(!open ? { inert: true } : {})}
    {...props}
  >
    <div className="stage-fold-clip">
      <div className="stage-fold-body">{children}</div>
    </div>
  </div>
)
