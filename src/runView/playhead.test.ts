import { describe, expect, it } from 'vitest'
import { clampPlayhead, isLiveEdge, playDomainCount, playheadMotion, playIndexFromRatio } from './playhead'

describe('run-view playhead', () => {
  it('snaps mid-run seeks onto completed rows only', () => {
    expect(clampPlayhead(0, 0)).toBe(0)
    expect(clampPlayhead(-2, 12)).toBe(0)
    expect(clampPlayhead(11, 12)).toBe(11)
    expect(clampPlayhead(40, 12)).toBe(11)
    expect(clampPlayhead(3.9, 12)).toBe(3)
  })

  it('maps a full-game play-index ratio, then snaps to completed rows', () => {
    expect(playDomainCount(71, 12)).toBe(71)
    expect(playDomainCount(0, 12)).toBe(12)
    expect(playIndexFromRatio(0, 71, 12)).toBe(0)
    expect(playIndexFromRatio(2 / 70, 71, 71)).toBe(2)
    expect(playIndexFromRatio(1, 71, 12)).toBe(11)
    expect(playIndexFromRatio(40 / 70, 71, 12)).toBe(11)
    expect(playIndexFromRatio(1, 71, 71)).toBe(70)
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
