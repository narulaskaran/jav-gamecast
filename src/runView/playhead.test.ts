import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clampPlayhead,
  isLiveEdge,
  playDomainCount,
  playbackIntervalMs,
  PLAYBACK_INTERVAL_MS,
  playheadMotion,
  playIndexFromRatio,
  REDUCED_PLAYBACK_INTERVAL_MS,
  startPlaybackIndex,
  stepPlayback,
  useRunPlayhead,
} from './playhead'

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

  it('rewinds from the live edge, then stops on the last play without looping', () => {
    expect(startPlaybackIndex(11, 12)).toBe(0)
    expect(startPlaybackIndex(3, 12)).toBe(3)
    expect(startPlaybackIndex(0, 1)).toBe(0)
    expect(stepPlayback(0, 12)).toEqual({ index: 1, playing: true })
    expect(stepPlayback(10, 12)).toEqual({ index: 11, playing: false })
    expect(stepPlayback(11, 12)).toEqual({ index: 11, playing: false })
    expect(playbackIntervalMs(false)).toBe(PLAYBACK_INTERVAL_MS)
    expect(playbackIntervalMs(true)).toBe(REDUCED_PLAYBACK_INTERVAL_MS)
    expect(PLAYBACK_INTERVAL_MS).toBeGreaterThanOrEqual(Math.ceil(1000 / 12))
    expect(PLAYBACK_INTERVAL_MS).toBeLessThanOrEqual(Math.floor(1000 / 8))
  })
})

describe('useRunPlayhead playback', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('plays, pauses, stops on scrub, and stops at the last play', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useRunPlayhead(5, 'run-1'))
    expect(result.current.index).toBe(4)
    expect(result.current.playing).toBe(false)

    act(() => { result.current.togglePlayback() })
    expect(result.current.playing).toBe(true)
    expect(result.current.index).toBe(0)

    act(() => { result.current.togglePlayback() })
    expect(result.current.playing).toBe(false)
    expect(result.current.index).toBe(0)

    act(() => { result.current.togglePlayback() })
    act(() => { vi.advanceTimersByTime(PLAYBACK_INTERVAL_MS) })
    expect(result.current.index).toBe(1)
    expect(result.current.playing).toBe(true)

    act(() => { result.current.seek(0, 'scrub') })
    expect(result.current.playing).toBe(false)
    expect(result.current.index).toBe(0)

    act(() => { vi.advanceTimersByTime(PLAYBACK_INTERVAL_MS * 4) })
    expect(result.current.index).toBe(0)

    act(() => { result.current.togglePlayback() })
    act(() => { vi.advanceTimersByTime(PLAYBACK_INTERVAL_MS * 4) })
    expect(result.current.index).toBe(4)
    expect(result.current.playing).toBe(false)

    act(() => { vi.advanceTimersByTime(PLAYBACK_INTERVAL_MS * 4) })
    expect(result.current.index).toBe(4)
  })

  it('steps slowly when prefers-reduced-motion is set', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    }))
    vi.useFakeTimers()
    const { result } = renderHook(() => useRunPlayhead(4, 'reduced'))
    act(() => { result.current.togglePlayback() })
    act(() => { vi.advanceTimersByTime(PLAYBACK_INTERVAL_MS) })
    expect(result.current.index).toBe(0)
    act(() => { vi.advanceTimersByTime(REDUCED_PLAYBACK_INTERVAL_MS) })
    expect(result.current.index).toBe(1)
    expect(result.current.playing).toBe(true)
  })
})
