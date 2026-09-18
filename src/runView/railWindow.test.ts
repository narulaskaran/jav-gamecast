import { describe, expect, it } from 'vitest'
import { RAIL_VIRTUALIZE_AFTER, railWindow } from './railWindow'

describe('processed-row rail window', () => {
  it('renders every row until the virtualize threshold', () => {
    const window = railWindow({ count: RAIL_VIRTUALIZE_AFTER, scrollOffset: 0, viewportSize: 320 })
    expect(window).toEqual({ start: 0, end: RAIL_VIRTUALIZE_AFTER, padStart: 0, padEnd: 0, virtualized: false })
  })

  it('windows long rails and keeps the selected row in the slice', () => {
    const window = railWindow({
      count: 400,
      scrollOffset: 0,
      viewportSize: 320,
      itemSize: 44,
      includeIndex: 250,
    })
    expect(window.virtualized).toBe(true)
    expect(window.start).toBeLessThanOrEqual(250)
    expect(window.end).toBeGreaterThan(250)
    expect(window.padStart + window.padEnd).toBeGreaterThan(0)
  })
})
