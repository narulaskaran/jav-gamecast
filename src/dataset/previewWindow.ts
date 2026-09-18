import { windowSlice, type WindowSlice } from '../lib/windowSlice'

export const PREVIEW_VIRTUALIZE_AFTER_ROWS = 80
export const PREVIEW_VIRTUALIZE_AFTER_CELLS = 2_400
export const PREVIEW_ROW_SIZE = 37
export const PREVIEW_OVERSCAN = 6
export const PREVIEW_VIEWPORT_SIZE = 280

export const previewVirtualizeAfter = (rowCount: number, columnCount: number): number => (
  rowCount * columnCount > PREVIEW_VIRTUALIZE_AFTER_CELLS ? 0 : PREVIEW_VIRTUALIZE_AFTER_ROWS
)

export const previewWindow = ({
  rowCount,
  columnCount,
  scrollOffset,
  viewportSize = PREVIEW_VIEWPORT_SIZE,
}: {
  rowCount: number
  columnCount: number
  scrollOffset: number
  viewportSize?: number
}): WindowSlice => windowSlice({
  count: rowCount,
  scrollOffset,
  viewportSize,
  itemSize: PREVIEW_ROW_SIZE,
  overscan: PREVIEW_OVERSCAN,
  virtualizeAfter: previewVirtualizeAfter(rowCount, columnCount),
})
