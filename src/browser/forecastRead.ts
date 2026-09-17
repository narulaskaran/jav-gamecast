import type { ForecastPoint, ForecastSource } from '../types'
import type { ForecastRecord, ForecastRecordReadBoundary } from '../shared/forecastRecords'

export interface BrowserForecastReadPath {
  getCachedForecast(idempotencyKey: string): Promise<ForecastRecord | undefined>
  getReplayForecasts(gameId: string): Promise<readonly ForecastRecord[]>
}

export const createBrowserForecastReadPath = (boundary: ForecastRecordReadBoundary): BrowserForecastReadPath => ({
  async getCachedForecast(idempotencyKey) {
    return await boundary.getForecastByIdempotencyKey(idempotencyKey)
  },
  async getReplayForecasts(gameId) {
    return await boundary.listForecastsByGame(gameId)
  },
})

const stateObject = (record: ForecastRecord): Record<string, unknown> | undefined =>
  typeof record.rawNormalizedState === 'object' && record.rawNormalizedState !== null && !Array.isArray(record.rawNormalizedState)
    ? record.rawNormalizedState as Record<string, unknown>
    : undefined

const stateTimestamp = (record: ForecastRecord): string => {
  const timestamp = stateObject(record)?.timestamp
  if (typeof timestamp === 'string' && !Number.isNaN(Date.parse(timestamp))) return timestamp
  return record.completedAt
}

const eventMetadata = (record: ForecastRecord): Pick<ForecastPoint, 'eventLabel' | 'eventKind'> => {
  const state = stateObject(record)
  const eventLabel = typeof state?.eventLabel === 'string' && state.eventLabel.length > 0 ? state.eventLabel : undefined
  const eventKinds = ['opening', 'swing', 'score', 'turnover', 'halftime', 'final'] as const
  const eventKind = eventKinds.includes(state?.eventKind as typeof eventKinds[number]) ? state?.eventKind as typeof eventKinds[number] : undefined
  return {
    ...(eventLabel === undefined ? {} : { eventLabel }),
    ...(eventKind === undefined ? {} : { eventKind }),
  }
}

const isUnitProbability = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1
const toDisplayPercent = (value: number): number => Math.round(value * 10_000) / 100
const hasValidDistribution = (record: ForecastRecord): record is ForecastRecord & Required<Pick<ForecastRecord, 'choice' | 'probabilities' | 'confidence'>> => {
  if (record.status !== 'success' || record.choice === undefined || record.probabilities === undefined || record.confidence === undefined) return false
  const values = [record.probabilities.home, record.probabilities.away, record.probabilities.tie]
  return values.every(isUnitProbability) && Math.abs(values.reduce((total, value) => total + value, 0) - 1) <= 1e-9 && isUnitProbability(record.confidence)
}

export const forecastRecordsToPoints = (records: readonly ForecastRecord[]): readonly ForecastPoint[] => {
  const usable = records.filter(hasValidDistribution)
  const firstTimestamp = usable.length > 0 ? Date.parse(stateTimestamp(usable[0])) : 0
  return usable.map((record) => {
    const timestamp = stateTimestamp(record)
    const elapsedSeconds = Math.max(0, Math.round((Date.parse(timestamp) - firstTimestamp) / 1000))
    return {
      id: record.idempotencyKey,
      gameId: record.gameId,
      eventId: record.providerEventId,
      timestamp,
      elapsedSeconds,
      homeProbability: toDisplayPercent(record.probabilities.home),
      awayProbability: toDisplayPercent(record.probabilities.away),
      tieProbability: toDisplayPercent(record.probabilities.tie),
      choice: record.choice,
      confidence: toDisplayPercent(record.confidence),
      ...eventMetadata(record),
    }
  })
}

export interface BrowserForecastSource extends ForecastSource {
  refresh(): Promise<readonly ForecastPoint[]>
}

export interface BrowserForecastSourceOptions {
  readPath: Pick<BrowserForecastReadPath, 'getReplayForecasts'>
  gameId: string
  fallback: readonly ForecastPoint[]
}

export const createBrowserForecastSource = ({ readPath, gameId, fallback }: BrowserForecastSourceOptions): BrowserForecastSource => {
  let points = fallback

  return {
    getPoints: () => points,
    async refresh() {
      const nextPoints = forecastRecordsToPoints(await readPath.getReplayForecasts(gameId))
      if (nextPoints.length > 0) points = nextPoints
      return points
    },
  }
}
