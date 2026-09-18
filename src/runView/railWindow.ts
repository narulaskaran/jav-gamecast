import { virtualWindow } from './virtualWindow'

export const RAIL_VIRTUALIZE_AFTER = 100
export const RAIL_ITEM_SIZE = 56
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
}): { start: number; end: number; padStart: number; padEnd: number; virtualized: boolean } =>
  virtualWindow({
    count,
    scrollOffset,
    viewportSize,
    itemSize,
    overscan,
    virtualizeAfter: RAIL_VIRTUALIZE_AFTER,
    includeIndex,
  })
