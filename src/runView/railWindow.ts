export const RAIL_VIRTUALIZE_AFTER = 100
export const RAIL_ITEM_SIZE = 40
export const RAIL_OVERSCAN = 8

export const railWindow = ({
  count,
  scrollOffset,
  viewportSize,
  itemSize = RAIL_ITEM_SIZE,
  overscan = RAIL_OVERSCAN,
  includeIndex,
}: {
  count: number
  scrollOffset: number
  viewportSize: number
  itemSize?: number
  overscan?: number
  includeIndex?: number
}): { start: number; end: number; padStart: number; padEnd: number; virtualized: boolean } => {
  if (count <= RAIL_VIRTUALIZE_AFTER) {
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
