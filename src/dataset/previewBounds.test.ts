import { describe, expect, it } from 'vitest'
import {
  BYOD_PREVIEW_MAX_CELLS,
  SAMPLE_PREVIEW_COLUMNS,
  SAMPLE_PREVIEW_ROWS,
  boundByodPreviewRowCount,
  boundByodPreviewRows,
  shouldParseCsvOnClient,
  shouldVirtualizePreview,
} from './previewBounds'

describe('BYOD preview bounds', () => {
  it('keeps the sample cell budget as the large-BYOD cap', () => {
    expect(BYOD_PREVIEW_MAX_CELLS).toBe(SAMPLE_PREVIEW_ROWS * SAMPLE_PREVIEW_COLUMNS)
    expect(boundByodPreviewRowCount(3_000, 40)).toBe(Math.floor(BYOD_PREVIEW_MAX_CELLS / 40))
    expect(boundByodPreviewRowCount(3_000, 40) * 40).toBeLessThanOrEqual(BYOD_PREVIEW_MAX_CELLS)
    expect(boundByodPreviewRowCount(20, 2)).toBe(20)
    expect(boundByodPreviewRows(Array.from({ length: 200 }, (_, index) => ({ id: index })), 40)).toHaveLength(
      boundByodPreviewRowCount(200, 40),
    )
  })

  it('virtualizes large BYOD tables and never virtualizes the sample fixture', () => {
    expect(shouldVirtualizePreview({ sourceType: 'fixture', rowCount: 71, columnCount: 26 })).toBe(false)
    expect(shouldVirtualizePreview({ sourceType: 'upload', rowCount: 71, columnCount: 7 })).toBe(false)
    expect(shouldVirtualizePreview({ sourceType: 'public_url', rowCount: 3_000, columnCount: 40 })).toBe(true)
    expect(shouldParseCsvOnClient(1_024)).toBe(true)
    expect(shouldParseCsvOnClient(3_000 * 40 * 20)).toBe(false)
  })
})
