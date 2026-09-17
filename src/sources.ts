import { fixture } from './fixture'
import type { FeedStatus, ForecastSource, GameState, GameStateSource, GameStateSnapshot } from './types'

const replayState = (pointIndex: number, overrides: Partial<GameState>): GameState => {
  const point = fixture.points[pointIndex]
  return {
    ...fixture.game,
    eventId: point.eventId,
    timestamp: point.timestamp,
    lastPlay: point.eventLabel ? `${point.eventLabel} — replay state recorded.` : fixture.game.lastPlay,
    ...overrides,
  }
}

const replaySnapshots: readonly GameStateSnapshot[] = [
  { state: replayState(0, { homeScore: 0, awayScore: 0, quarter: 'Q1', clock: '15:00', status: 'quarter', possession: 'away' }), status: 'REPLAY' },
  { state: replayState(1, { homeScore: 7, awayScore: 0, quarter: 'Q1', clock: '11:42', status: 'quarter', possession: 'away' }), status: 'REPLAY' },
  { state: replayState(2, { homeScore: 14, awayScore: 0, quarter: 'Q2', clock: '08:10', status: 'quarter', possession: 'home' }), status: 'REPLAY' },
  { state: replayState(3, { homeScore: 14, awayScore: 14, quarter: 'Q2', clock: '02:48', status: 'quarter', possession: 'away' }), status: 'REPLAY' },
  { state: replayState(4, { homeScore: 14, awayScore: 17, quarter: 'Q3', clock: '09:34', status: 'quarter', possession: 'home' }), status: 'REPLAY' },
  { state: replayState(5, { homeScore: 17, awayScore: 17, quarter: 'HALF', clock: '00:00', status: 'halftime', possession: null }), status: 'REPLAY' },
  { state: replayState(6, { homeScore: 17, awayScore: 24, quarter: 'Q4', clock: '02:00', status: 'quarter', possession: 'away' }), status: 'REPLAY' },
  { state: replayState(7, { homeScore: 24, awayScore: 27, quarter: 'Q4', clock: '00:42', status: 'final', possession: 'away' }), status: 'REPLAY' },
].map((snapshot) => Object.freeze({ state: Object.freeze(snapshot.state), status: snapshot.status as FeedStatus }))

export const fixtureGameStateSource: GameStateSource = {
  getSnapshotAt(pointIndex) {
    return replaySnapshots[Math.max(0, Math.min(pointIndex, replaySnapshots.length - 1))]
  },
}

export const fixtureForecastSource: ForecastSource = {
  getPoints: () => fixture.points,
}
