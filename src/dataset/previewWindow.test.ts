import { describe, expect, it } from 'vitest'
import {
  PREVIEW_VIRTUALIZE_AFTER_CELLS,
  PREVIEW_VIRTUALIZE_AFTER_ROWS,
  previewVirtualizeAfter,
  previewWindow,
} from './previewWindow'

describe('dataset preview window', () => {
  it('keeps the sample-sized table fully in the DOM', () => {
    expect(previewVirtualizeAfter(71, 26)).toBe(PREVIEW_VIRTUALIZE_AFTER_ROWS)
    const window = previewWindow({ rowCount: 71, columnCount: 26, scrollOffset: 0 })
    expect(window).toEqual({ start: 0, end: 71, padStart: 0, padEnd: 0, virtualized: false })
  })

  it('windows large BYOD tables without dropping row access', () => {
    expect(previewVirtualizeAfter(3_023, 40)).toBe(0)
    expect(3_023 * 40).toBeGreaterThan(PREVIEW_VIRTUALIZE_AFTER_CELLS)
    const window = previewWindow({
      rowCount: 3_023,
      columnCount: 40,
      scrollOffset: 37 * 400,
      viewportSize: 280,
    })
    expect(window.virtualized).toBe(true)
    expect(window.end - window.start).toBeLessThan(80)
    expect(window.start).toBeGreaterThan(0)
    expect(window.padStart + window.padEnd).toBeGreaterThan(0)
    expect(window.end).toBeLessThanOrEqual(3_023)
  })
})
