export interface WindowSliceInput {
  count: number
  scrollOffset: number
  viewportSize: number
  itemSize: number
  overscan?: number
  includeIndex?: number
  virtualizeAfter: number
}

export interface WindowSlice {
  start: number
  end: number
  padStart: number
  padEnd: number
  virtualized: boolean
}

export const windowSlice = ({
  count,
  scrollOffset,
  viewportSize,
  itemSize,
  overscan = 8,
  includeIndex,
  virtualizeAfter,
}: WindowSliceInput): WindowSlice => {
  if (count <= virtualizeAfter) {
    return { start: 0, end: count, padStart: 0, padEnd: 0, virtualized: false }
  }
  const safeSize = Math.max(1, itemSize)
  const rawStart = Math.floor(Math.max(0, scrollOffset) / safeSize) - overscan
  let start = Math.max(0, rawStart)
  const visible = Math.ceil(Math.max(viewportSize, safeSize) / safeSize) + overscan * 2
  let end = Math.min(count, Math.max(start + 1, start + visible))
  if (includeIndex !== undefined && count > 0) {
    const clamped = Math.max(0, Math.min(includeIndex, count - 1))
    if (clamped < start) start = clamped
    if (clamped >= end) end = Math.min(count, clamped + 1)
  }
  return {
    start,
    end,
    padStart: start * safeSize,
    padEnd: Math.max(0, count - end) * safeSize,
    virtualized: true,
  }
}
