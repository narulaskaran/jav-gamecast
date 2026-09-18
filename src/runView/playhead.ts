import { useCallback, useEffect, useState } from 'react'

export const clampPlayhead = (index: number, completedCount: number): number => {
  if (completedCount <= 0) return 0
  return Math.max(0, Math.min(Math.trunc(index), completedCount - 1))
}

export const playDomainCount = (totalRows: number, completedCount: number): number => (
  Math.max(1, totalRows, completedCount)
)

export const playIndexFromRatio = (t: number, totalRows: number, completedCount: number): number => {
  const domain = playDomainCount(totalRows, completedCount)
  const raw = Math.round(Math.min(1, Math.max(0, t)) * (domain - 1))
  return clampPlayhead(raw, completedCount)
}

export const isLiveEdge = (index: number, completedCount: number): boolean => {
  if (completedCount <= 0) return true
  return index >= completedCount - 1
}

export type PlayheadMotion = 'tick' | 'seek'

export const playheadMotion = (scrubbing: boolean, followLive: boolean): PlayheadMotion => (
  scrubbing || !followLive ? 'seek' : 'tick'
)

export const useRunPlayhead = (completedCount: number, runId?: string) => {
  const [index, setIndex] = useState(() => clampPlayhead(completedCount - 1, completedCount))
  const [followLive, setFollowLive] = useState(true)
  const [scrubbing, setScrubbing] = useState(false)

  useEffect(() => {
    setFollowLive(true)
    setScrubbing(false)
  }, [runId])

  useEffect(() => {
    if (completedCount <= 0) {
      setIndex(0)
      return
    }
    const latest = completedCount - 1
    setIndex((current) => (followLive && !scrubbing ? latest : Math.min(current, latest)))
  }, [completedCount, followLive, scrubbing])

  const seek = useCallback((next: number, phase: 'scrub' | 'release' = 'release') => {
    const clamped = clampPlayhead(next, completedCount)
    setIndex(clamped)
    if (phase === 'scrub') {
      setScrubbing(true)
      setFollowLive(false)
    } else {
      setScrubbing(false)
      setFollowLive(isLiveEdge(clamped, completedCount))
    }
  }, [completedCount])

  return {
    index,
    followLive,
    scrubbing,
    motion: playheadMotion(scrubbing, followLive),
    seek,
  }
}
