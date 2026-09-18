import { useCallback, useEffect, useRef, useState } from 'react'

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

/** Replay rate for completed/share transport. 100ms = 10 plays/sec (locked 8–12). */
export const PLAYBACK_INTERVAL_MS = 100
/** Slow discrete step when the user prefers reduced motion. */
export const REDUCED_PLAYBACK_INTERVAL_MS = 500

export const playbackIntervalMs = (reducedMotion: boolean): number => (
  reducedMotion ? REDUCED_PLAYBACK_INTERVAL_MS : PLAYBACK_INTERVAL_MS
)

export const prefersReducedMotion = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export const startPlaybackIndex = (index: number, completedCount: number): number => {
  if (completedCount < 2) return clampPlayhead(index, completedCount)
  return isLiveEdge(index, completedCount) ? 0 : clampPlayhead(index, completedCount)
}

export const stepPlayback = (index: number, completedCount: number): { index: number; playing: boolean } => {
  const clamped = clampPlayhead(index, completedCount)
  if (completedCount < 2 || clamped >= completedCount - 1) {
    return { index: clampPlayhead(completedCount - 1, completedCount), playing: false }
  }
  const next = clamped + 1
  return { index: next, playing: next < completedCount - 1 }
}

export type PlayheadMotion = 'tick' | 'seek'

export const playheadMotion = (scrubbing: boolean, followLive: boolean): PlayheadMotion => (
  scrubbing || !followLive ? 'seek' : 'tick'
)

export const useRunPlayhead = (completedCount: number, runId?: string) => {
  const [index, setIndex] = useState(() => clampPlayhead(completedCount - 1, completedCount))
  const [followLive, setFollowLive] = useState(true)
  const [scrubbing, setScrubbing] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion)
  const indexRef = useRef(index)
  const playingRef = useRef(playing)
  indexRef.current = index
  playingRef.current = playing

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    setFollowLive(true)
    setScrubbing(false)
    setPlaying(false)
  }, [runId])

  useEffect(() => {
    if (completedCount <= 0) {
      setIndex(0)
      return
    }
    const latest = completedCount - 1
    setIndex((current) => (followLive && !scrubbing && !playing ? latest : Math.min(current, latest)))
  }, [completedCount, followLive, playing, scrubbing])

  useEffect(() => {
    if (!playing || completedCount < 2) return undefined
    const id = window.setInterval(() => {
      const stepped = stepPlayback(indexRef.current, completedCount)
      indexRef.current = stepped.index
      setIndex(stepped.index)
      if (!stepped.playing) {
        setPlaying(false)
        setFollowLive(true)
      }
    }, playbackIntervalMs(reducedMotion))
    return () => window.clearInterval(id)
  }, [completedCount, playing, reducedMotion])

  const seek = useCallback((next: number, phase: 'scrub' | 'release' = 'release') => {
    const clamped = clampPlayhead(next, completedCount)
    indexRef.current = clamped
    setPlaying(false)
    setIndex(clamped)
    if (phase === 'scrub') {
      setScrubbing(true)
      setFollowLive(false)
    } else {
      setScrubbing(false)
      setFollowLive(isLiveEdge(clamped, completedCount))
    }
  }, [completedCount])

  const togglePlayback = useCallback(() => {
    if (playingRef.current) {
      setPlaying(false)
      return
    }
    if (completedCount < 2) return
    setIndex((current) => {
      const next = startPlaybackIndex(current, completedCount)
      indexRef.current = next
      return next
    })
    setFollowLive(false)
    setScrubbing(false)
    setPlaying(true)
  }, [completedCount])

  return {
    index,
    followLive,
    scrubbing,
    playing,
    motion: playheadMotion(scrubbing, followLive),
    seek,
    togglePlayback,
  }
}
