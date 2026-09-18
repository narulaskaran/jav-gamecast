import { describe, expect, it } from 'vitest'
import { virtualWindow } from '../runView/virtualWindow'
import { PREVIEW_ROW_HEIGHT, PREVIEW_VIRTUALIZE_AFTER, PREVIEW_VIEWPORT } from './previewWindow'

describe('dataset preview window', () => {
  it('keeps the sample-sized table fully rendered', () => {
    const window = virtualWindow({
      count: 71,
      scrollOffset: 0,
      viewportSize: PREVIEW_VIEWPORT,
      itemSize: PREVIEW_ROW_HEIGHT,
      virtualizeAfter: PREVIEW_VIRTUALIZE_AFTER,
    })
    expect(window).toEqual({ start: 0, end: 71, padStart: 0, padEnd: 0, virtualized: false })
  })

  it('windows large BYOD tables instead of mounting every row', () => {
    const window = virtualWindow({
      count: 3_023,
      scrollOffset: 0,
      viewportSize: PREVIEW_VIEWPORT,
      itemSize: PREVIEW_ROW_HEIGHT,
      overscan: 6,
      virtualizeAfter: PREVIEW_VIRTUALIZE_AFTER,
    })
    expect(window.virtualized).toBe(true)
    expect(window.start).toBe(0)
    expect(window.end).toBeLessThan(80)
    expect(window.padEnd).toBeGreaterThan(0)
    expect(window.end - window.start).toBeLessThan(PREVIEW_VIRTUALIZE_AFTER)
  })
})
