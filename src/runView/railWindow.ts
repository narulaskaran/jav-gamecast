import { windowSlice, type WindowSlice } from '../lib/windowSlice'

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
}): WindowSlice => windowSlice({
  count,
  scrollOffset,
  viewportSize,
  itemSize,
  overscan,
  includeIndex,
  virtualizeAfter: RAIL_VIRTUALIZE_AFTER,
})
