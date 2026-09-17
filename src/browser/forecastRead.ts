import type { ForecastPoint } from '../types'
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

const stateTimestamp = (record: ForecastRecord): string => {
  if (typeof record.rawNormalizedState === 'object' && record.rawNormalizedState !== null && !Array.isArray(record.rawNormalizedState)) {
    const timestamp = record.rawNormalizedState.timestamp
    if (typeof timestamp === 'string' && !Number.isNaN(Date.parse(timestamp))) return timestamp
  }
  return record.completedAt
}

export const forecastRecordsToPoints = (records: readonly ForecastRecord[]): readonly ForecastPoint[] => {
  const usable = records.filter((record): record is ForecastRecord & Required<Pick<ForecastRecord, 'choice' | 'probabilities' | 'confidence'>> =>
    record.status === 'success' && record.choice !== undefined && record.probabilities !== undefined && record.confidence !== undefined)
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
      homeProbability: record.probabilities.home,
      awayProbability: record.probabilities.away,
      tieProbability: record.probabilities.tie,
      choice: record.choice,
      confidence: record.confidence,
    }
  })
}
