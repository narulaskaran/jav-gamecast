import { describe, expect, it } from 'vitest'
import { clampPlayhead, isLiveEdge, playheadMotion } from './playhead'

describe('run-view playhead', () => {
  it('snaps mid-run seeks onto completed rows only', () => {
    expect(clampPlayhead(0, 0)).toBe(0)
    expect(clampPlayhead(-2, 12)).toBe(0)
    expect(clampPlayhead(11, 12)).toBe(11)
    expect(clampPlayhead(40, 12)).toBe(11)
    expect(clampPlayhead(3.9, 12)).toBe(3)
  })

  it('treats the latest completed row as the live edge', () => {
    expect(isLiveEdge(0, 0)).toBe(true)
    expect(isLiveEdge(10, 12)).toBe(false)
    expect(isLiveEdge(11, 12)).toBe(true)
    expect(isLiveEdge(12, 12)).toBe(true)
  })

  it('uses instant seek motion while scrubbing or away from the live edge', () => {
    expect(playheadMotion(false, true)).toBe('tick')
    expect(playheadMotion(true, true)).toBe('seek')
    expect(playheadMotion(false, false)).toBe('seek')
  })
})
