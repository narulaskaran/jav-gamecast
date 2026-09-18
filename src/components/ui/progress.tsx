import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export const Progress = ({
  value = 0,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { value?: number }) => {
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <div
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      {...props}
    >
      <div
        className="progress-fill h-full rounded-full bg-[var(--run)]"
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}
