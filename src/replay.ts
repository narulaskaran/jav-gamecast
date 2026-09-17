import type { ForecastPoint } from './types'

export interface ReplayState {
  index: number
  isPlaying: boolean
}

export type ReplayAction =
  | { type: 'toggle' }
  | { type: 'step'; delta: number; total: number }
  | { type: 'seek'; index: number; total: number }
  | { type: 'reset' }
  | { type: 'advance'; points: readonly ForecastPoint[] }

export const initialReplayState = (total: number): ReplayState => ({
  index: total > 0 ? 0 : -1,
  isPlaying: false,
})

export const advanceReplay = (index: number, total: number, delta: number): number => {
  if (total <= 0) return -1
  return Math.min(total - 1, Math.max(0, index + delta))
}

export const replayReducer = (state: ReplayState, action: ReplayAction): ReplayState => {
  switch (action.type) {
    case 'toggle':
      return { ...state, isPlaying: !state.isPlaying }
    case 'step':
      return { index: advanceReplay(state.index, action.total, action.delta), isPlaying: false }
    case 'seek':
      return { index: advanceReplay(0, action.total, action.index), isPlaying: false }
    case 'reset':
      return { index: 0, isPlaying: false }
    case 'advance':
      return nextReplayPoint(state, action.points)
  }
}

export const nextReplayPoint = (state: ReplayState, points: readonly ForecastPoint[]): ReplayState => {
  if (state.index >= points.length - 1) return { ...state, isPlaying: false }
  return { index: advanceReplay(state.index, points.length, 1), isPlaying: true }
}

export const getReplayStatus = (live: boolean, stale: boolean): 'REPLAY' | 'LIVE' | 'STALE' => {
  if (stale) return 'STALE'
  if (live) return 'LIVE'
  return 'REPLAY'
}
