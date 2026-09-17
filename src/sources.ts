import { fixture } from './fixture'
import type { ForecastSource, GameState, GameStateSource } from './types'

const replaySnapshots: readonly GameState[] = [
  { ...fixture.game, homeScore: 0, awayScore: 0, quarter: 'Q1', clock: '15:00', status: 'quarter', possession: 'away', lastPlay: 'Opening kickoff; the replay begins.' },
  { ...fixture.game, homeScore: 7, awayScore: 0, quarter: 'Q1', clock: '11:42', status: 'quarter', possession: 'away', lastPlay: 'Harbor Hawks finish a long opening drive.' },
  { ...fixture.game, homeScore: 14, awayScore: 0, quarter: 'Q2', clock: '08:10', status: 'quarter', possession: 'home', lastPlay: 'A red-zone catch extends the Hawks lead.' },
  { ...fixture.game, homeScore: 14, awayScore: 14, quarter: 'Q2', clock: '02:48', status: 'quarter', possession: 'away', lastPlay: 'Cedar Foxes answer before the break.' },
  { ...fixture.game, homeScore: 14, awayScore: 17, quarter: 'Q3', clock: '09:34', status: 'quarter', possession: 'home', lastPlay: 'A field goal nudges the Foxes ahead.' },
  { ...fixture.game, homeScore: 17, awayScore: 17, quarter: 'HALF', clock: '00:00', status: 'halftime', possession: null, lastPlay: 'Halftime checkpoint in the synthetic replay.' },
  { ...fixture.game, homeScore: 24, awayScore: 17, quarter: 'Q4', clock: '02:00', status: 'quarter', possession: 'away', lastPlay: 'Hawks lead late after a quick strike.' },
  fixture.game,
]

export const fixtureGameStateSource: GameStateSource = {
  getStateAt(pointIndex) {
    return replaySnapshots[Math.max(0, Math.min(pointIndex, replaySnapshots.length - 1))]
  },
}

export const fixtureForecastSource: ForecastSource = {
  getPoints: () => fixture.points,
}
