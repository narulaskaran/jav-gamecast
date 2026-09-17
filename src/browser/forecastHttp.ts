import type { FeedStatus } from '../types'
import type { ForecastRecord, ForecastRecordReadBoundary } from '../shared/forecastRecords'

export interface BrowserForecastHttpReadPath extends ForecastRecordReadBoundary {
  readonly mode: 'live'
  readonly getStatus: () => FeedStatus
  getReplayForecasts(gameId: string): Promise<readonly ForecastRecord[]>
}

interface LiveReadResponse {
  mode: 'live' | 'replay' | 'stale' | 'mock' | 'error' | 'limited'
  gameId: string
  status: FeedStatus
  records: readonly ForecastRecord[]
}

const isLiveRecord = (record: ForecastRecord | undefined): boolean => {
  const state = record?.rawNormalizedState
  const sourceStatus = typeof state === 'object' && state !== null && !Array.isArray(state)
    ? (state as { sourceStatus?: unknown }).sourceStatus
    : undefined
  return record?.source === 'live' && record.status === 'success' && sourceStatus === 'LIVE'
}

const parseResponse = async (response: Response): Promise<LiveReadResponse> => {
  if (!response.ok) throw new Error(`Live read unavailable (${response.status})`)
  const payload = await response.json() as unknown
  if (typeof payload !== 'object' || payload === null || !['live', 'replay', 'stale', 'mock', 'error', 'limited'].includes((payload as { mode?: unknown }).mode as string) || !['LIVE', 'REPLAY', 'STALE', 'MOCK', 'ERROR', 'LIMITED'].includes((payload as { status?: unknown }).status as string) || !Array.isArray((payload as { records?: unknown }).records)) {
    throw new Error('Live read returned an invalid payload')
  }
  const parsed = payload as LiveReadResponse
  if (parsed.mode === 'live' && (parsed.status !== 'LIVE' || !isLiveRecord(parsed.records[parsed.records.length - 1]))) {
    throw new Error('Live read violated live-data gating')
  }
  if (parsed.status === 'LIVE' && parsed.mode !== 'live') throw new Error('Live status requires live mode')
  return parsed
}

export const createBrowserForecastHttpReadPath = (baseUrl = '/api/gamecast', fetcher: typeof fetch = fetch): BrowserForecastHttpReadPath => {
  let lastStatus: FeedStatus = 'STALE'
  const read = async (query: { gameId?: string; idempotencyKey?: string }): Promise<LiveReadResponse> => {
    const url = new URL(baseUrl, typeof window === 'undefined' ? 'http://localhost' : window.location.origin)
    for (const [key, value] of Object.entries(query)) if (value) url.searchParams.set(key, value)
    const payload = await parseResponse(await fetcher(url, { headers: { Accept: 'application/json' } }))
    lastStatus = payload.status
    return payload
  }
  return {
    mode: 'live',
    getStatus: () => lastStatus,
    async getForecastByIdempotencyKey(idempotencyKey) {
      const response = await read({ idempotencyKey })
      return response.records.find((record) => record.idempotencyKey === idempotencyKey)
    },
    async listForecastsByGame(gameId) {
      return (await read({ gameId })).records
    },
    async getReplayForecasts(gameId) {
      return (await read({ gameId })).records
    },
  }
}
