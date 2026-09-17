import type { ForecastChoice, ForecastPoint, GamecastFixture, GameState, GameStatus } from './types'

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
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isProbability = (value: unknown): value is number => isFiniteNumber(value) && value >= 0 && value <= 100
const isDateString = (value: unknown): value is string => isNonEmptyString(value) && !Number.isNaN(Date.parse(value))
const gameStatuses: readonly GameStatus[] = ['quarter', 'halftime', 'final']
const choices: readonly ForecastChoice[] = ['home', 'away', 'tie']
const eventKinds = ['opening', 'swing', 'score', 'turnover', 'halftime', 'final'] as const

const requireGame = (value: unknown): GameState => {
  if (!isRecord(value)) throw new Error('Fixture game is required')
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.homeTeam) || !isNonEmptyString(value.awayTeam)) throw new Error('Fixture game IDs and teams are required')
  if (value.homeTeam === value.awayTeam) throw new Error('Fixture game teams must differ')
  if (!isFiniteNumber(value.homeScore) || value.homeScore < 0 || !isFiniteNumber(value.awayScore) || value.awayScore < 0) throw new Error('Fixture game scores are invalid')
  if (!isNonEmptyString(value.quarter) || !isNonEmptyString(value.clock)) throw new Error('Fixture game period and clock are required')
  if (!gameStatuses.includes(value.status as GameStatus)) throw new Error('Fixture game status is invalid')
  if (value.possession !== null && value.possession !== 'home' && value.possession !== 'away') throw new Error('Fixture game possession is invalid')
  if (!isNonEmptyString(value.lastPlay) || !isDateString(value.timestamp)) throw new Error('Fixture game text and timestamp are invalid')
  if (value.eventId !== undefined && !isNonEmptyString(value.eventId)) throw new Error('Fixture game event ID is invalid')

  return {
    id: value.id,
    ...(value.eventId === undefined ? {} : { eventId: value.eventId }),
    homeTeam: value.homeTeam,
    awayTeam: value.awayTeam,
    homeScore: value.homeScore,
    awayScore: value.awayScore,
    quarter: value.quarter,
    clock: value.clock,
    status: value.status as GameStatus,
    possession: value.possession,
    lastPlay: value.lastPlay,
    timestamp: value.timestamp,
  }
}

export const parseFixture = (input: unknown): GamecastFixture => {
  if (!isRecord(input)) throw new Error('Fixture must be an object')
  if (!Array.isArray(input.points) || input.points.length < 2) throw new Error('Fixture needs forecast points')
  const game = requireGame(input.game)
  const pointIds = new Set<string>()
  const eventIds = new Set<string>()
  let previousTimestamp = -Infinity
  let previousElapsed = -Infinity

  const points = input.points.map((value, index): ForecastPoint => {
    if (!isRecord(value)) throw new Error(`Forecast point ${index + 1} is invalid`)
    if (!isNonEmptyString(value.id) || !isNonEmptyString(value.gameId) || value.gameId !== game.id) throw new Error(`Forecast point ${index + 1} has an invalid game ID`)
    if (!isNonEmptyString(value.eventId)) throw new Error(`Forecast point ${index + 1} event ID is invalid`)
    if (pointIds.has(value.id) || eventIds.has(value.eventId)) throw new Error(`Forecast point ${index + 1} has a duplicate ID`)
    pointIds.add(value.id)
    eventIds.add(value.eventId)

    if (!isDateString(value.timestamp)) throw new Error(`Forecast point ${index + 1} timestamp is invalid`)
    if (!isFiniteNumber(value.elapsedSeconds) || value.elapsedSeconds < 0) throw new Error(`Forecast point ${index + 1} elapsed seconds are invalid`)
    const timestamp = Date.parse(value.timestamp)
    if (timestamp <= previousTimestamp || value.elapsedSeconds <= previousElapsed) throw new Error('Forecast points must be in chronological order')
    previousTimestamp = timestamp
    previousElapsed = value.elapsedSeconds

    const probabilities = [value.homeProbability, value.awayProbability, value.tieProbability]
    if (!probabilities.every(isProbability)) throw new Error(`Forecast point ${index + 1} probabilities are invalid`)
    const [homeProbability, awayProbability, tieProbability] = probabilities
    if (Math.abs(homeProbability + awayProbability + tieProbability - 100) > 1e-9) throw new Error('Forecast probabilities must total 100')
    if (!choices.includes(value.choice as ForecastChoice)) throw new Error(`Forecast point ${index + 1} choice is invalid`)
    if (!isFiniteNumber(value.confidence) || value.confidence < 0 || value.confidence > 100) throw new Error(`Forecast point ${index + 1} confidence is invalid`)
    if (value.eventLabel !== undefined && !isNonEmptyString(value.eventLabel)) throw new Error(`Forecast point ${index + 1} event label is invalid`)
    if (value.eventKind !== undefined && !eventKinds.includes(value.eventKind as typeof eventKinds[number])) throw new Error(`Forecast point ${index + 1} event kind is invalid`)

    return {
      id: value.id,
      gameId: value.gameId,
      eventId: value.eventId,
      timestamp: value.timestamp,
      elapsedSeconds: value.elapsedSeconds,
      homeProbability,
      awayProbability,
      tieProbability,
      choice: value.choice as ForecastChoice,
      confidence: value.confidence,
      ...(value.eventLabel === undefined ? {} : { eventLabel: value.eventLabel }),
      ...(value.eventKind === undefined ? {} : { eventKind: value.eventKind as typeof eventKinds[number] }),
    }
  })

  const frozenPoints = Object.freeze(points.map((point) => Object.freeze(point)))
  return Object.freeze({ game: Object.freeze(game), points: frozenPoints })
}

export const fixture = parseFixture(rawFixture)
