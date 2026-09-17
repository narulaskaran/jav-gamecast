import type { ForecastPoint, GamecastFixture, GameState } from './types'

const rawFixture = {
  game: {
    id: 'demo-2026-09-17',
    homeTeam: 'Harbor Hawks',
    awayTeam: 'Cedar Foxes',
    homeScore: 24,
    awayScore: 27,
    quarter: 'Q4',
    clock: '00:42',
    status: 'final',
    possession: 'away',
    lastPlay: 'Cedar Foxes kneel to close the replay.',
    timestamp: '2026-09-17T02:51:02Z',
  },
  points: [
    { id: 'p-01', gameId: 'demo-2026-09-17', eventId: 'kickoff', timestamp: '2026-09-17T02:51:02Z', elapsedSeconds: 0, homeProbability: 40, awayProbability: 48, tieProbability: 12, choice: 'away', confidence: 55, eventLabel: 'Punt pins the opener', eventKind: 'opening' },
    { id: 'p-02', gameId: 'demo-2026-09-17', eventId: 'drive-01', timestamp: '2026-09-17T02:52:32Z', elapsedSeconds: 90, homeProbability: 51, awayProbability: 37, tieProbability: 12, choice: 'home', confidence: 61, eventLabel: 'Hawks cross midfield', eventKind: 'swing' },
    { id: 'p-03', gameId: 'demo-2026-09-17', eventId: 'score-01', timestamp: '2026-09-17T02:54:02Z', elapsedSeconds: 180, homeProbability: 59, awayProbability: 29, tieProbability: 12, choice: 'home', confidence: 68, eventLabel: 'Touchdown: Harbor Hawks', eventKind: 'score' },
    { id: 'p-04', gameId: 'demo-2026-09-17', eventId: 'turnover-01', timestamp: '2026-09-17T02:55:32Z', elapsedSeconds: 270, homeProbability: 34, awayProbability: 53, tieProbability: 13, choice: 'away', confidence: 64, eventLabel: 'Interception flips the read', eventKind: 'turnover' },
    { id: 'p-05', gameId: 'demo-2026-09-17', eventId: 'score-02', timestamp: '2026-09-17T02:57:02Z', elapsedSeconds: 360, homeProbability: 39, awayProbability: 49, tieProbability: 12, choice: 'away', confidence: 59, eventLabel: 'Foxes answer on fourth down', eventKind: 'score' },
    { id: 'p-06', gameId: 'demo-2026-09-17', eventId: 'half-01', timestamp: '2026-09-17T02:58:32Z', elapsedSeconds: 450, homeProbability: 43, awayProbability: 45, tieProbability: 12, choice: 'away', confidence: 52, eventLabel: 'Halftime: one-score game', eventKind: 'halftime' },
    { id: 'p-07', gameId: 'demo-2026-09-17', eventId: 'score-03', timestamp: '2026-09-17T03:00:02Z', elapsedSeconds: 540, homeProbability: 31, awayProbability: 57, tieProbability: 12, choice: 'away', confidence: 70, eventLabel: 'Foxes take the lead', eventKind: 'score' },
    { id: 'p-08', gameId: 'demo-2026-09-17', eventId: 'final-01', timestamp: '2026-09-17T03:01:32Z', elapsedSeconds: 630, homeProbability: 28, awayProbability: 63, tieProbability: 9, choice: 'away', confidence: 76, eventLabel: 'Final whistle', eventKind: 'final' },
  ],
} satisfies { game: GameState; points: ForecastPoint[] }

const isProbability = (value: unknown): value is number => typeof value === 'number' && value >= 0 && value <= 100

export const parseFixture = (input: unknown): GamecastFixture => {
  if (!input || typeof input !== 'object') throw new Error('Fixture must be an object')
  const candidate = input as { game?: unknown; points?: unknown }
  if (!candidate.game || typeof candidate.game !== 'object') throw new Error('Fixture game is required')
  if (!Array.isArray(candidate.points) || candidate.points.length < 2) throw new Error('Fixture needs forecast points')
  const game = candidate.game as Partial<GameState>
  if (!game.id || !game.homeTeam || !game.awayTeam) throw new Error('Fixture game teams are required')
  const points = candidate.points as ForecastPoint[]
  for (const point of points) {
    if (!point.id || !point.gameId || point.gameId !== game.id) throw new Error('Forecast point has an invalid game ID')
    if (![point.homeProbability, point.awayProbability, point.tieProbability].every(isProbability)) throw new Error('Forecast probabilities must be between 0 and 100')
    if (point.homeProbability + point.awayProbability + point.tieProbability !== 100) throw new Error('Forecast probabilities must total 100')
    if (!point.timestamp || point.elapsedSeconds < 0) throw new Error('Forecast point timestamp is invalid')
  }
  return Object.freeze({ game: Object.freeze({ ...game }) as GameState, points: Object.freeze(points.map((point) => Object.freeze({ ...point }))) })
}

export const fixture = parseFixture(rawFixture)
