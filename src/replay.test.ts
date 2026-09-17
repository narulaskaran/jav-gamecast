import { describe, expect, it } from 'vitest'
import { advanceReplay, getReplayStatus, initialReplayState, replayReducer } from './replay'

describe('replay progression', () => {
  it('starts at the first stored point and advances one point at a time', () => {
    expect(initialReplayState(4)).toEqual({ index: 0, isPlaying: false })
    expect(advanceReplay(0, 4, 1)).toBe(1)
    expect(advanceReplay(3, 4, 1)).toBe(3)
    expect(advanceReplay(1, 4, -1)).toBe(0)
  })

  it('toggles play and resets to the first point', () => {
    expect(replayReducer({ index: 1, isPlaying: false }, { type: 'toggle' })).toEqual({ index: 1, isPlaying: true })
    expect(replayReducer({ index: 0, isPlaying: true }, { type: 'advance', points: [{}, {}, {}] as never[] })).toEqual({ index: 1, isPlaying: true })
    expect(replayReducer({ index: 2, isPlaying: true }, { type: 'advance', points: [{}, {}, {}] as never[] })).toEqual({ index: 2, isPlaying: false })
    expect(replayReducer({ index: 3, isPlaying: true }, { type: 'reset' })).toEqual({ index: 0, isPlaying: false })
  })
})

describe('forecast state labels', () => {
  it('keeps the fixture in replay and exposes all operational labels', () => {
    expect(getReplayStatus(false, false)).toBe('REPLAY')
    expect(getReplayStatus(true, false)).toBe('LIVE')
    expect(getReplayStatus(false, true)).toBe('STALE')
  })
})
