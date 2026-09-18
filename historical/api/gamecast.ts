import { ConvexForecastStore } from '../../src/server/convexStore'
import { readPublicRuntimeConfig } from '../../src/server/liveConfig'
import type { ForecastRecord } from '../../src/shared/forecastRecords'

type Request = { method?: string; headers: Record<string, string | string[] | undefined>; query?: Record<string, string | string[] | undefined> }
type Response = { status: (code: number) => Response; json: (body: unknown) => Response; setHeader: (name: string, value: string) => Response; end: () => void }

type WindowBucket = { startedAt: number; count: number }
let readBucket: WindowBucket = { startedAt: Date.now(), count: 0 }

const header = (request: Request, name: string): string | undefined => {
  const value = request.headers[name] ?? request.headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

const applyCors = (request: Request, response: Response, publicOrigin?: string): boolean => {
  const origin = header(request, 'origin')
  if (publicOrigin && origin && origin !== publicOrigin) {
    response.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' })
    return false
  }
  response.setHeader('Access-Control-Allow-Origin', publicOrigin ?? origin ?? '*')
  response.setHeader('Vary', 'Origin')
  response.setHeader('Cache-Control', 'no-store')
  return true
}

const queryValue = (request: Request, name: string): string | undefined => {
  const value = request.query?.[name]
  return Array.isArray(value) ? value[0] : value
}

type PublicMode = 'live' | 'replay' | 'stale' | 'mock' | 'error' | 'limited'
type PublicStatus = 'LIVE' | 'REPLAY' | 'STALE' | 'MOCK' | 'ERROR' | 'LIMITED'

const sourceStatusOf = (record: ForecastRecord): string | undefined =>
  record.rawNormalizedState && typeof record.rawNormalizedState === 'object' && !Array.isArray(record.rawNormalizedState)
    ? (record.rawNormalizedState as { sourceStatus?: unknown }).sourceStatus as string | undefined
    : undefined

const deriveLabel = (records: readonly ForecastRecord[]): { mode: PublicMode; status: PublicStatus } => {
  const latest = records[records.length - 1]
  if (!latest) return { mode: 'stale', status: 'STALE' }
  if (latest.status === 'error') return { mode: latest.source === 'stale' || sourceStatusOf(latest) === 'STALE' ? 'stale' : 'error', status: latest.source === 'stale' || sourceStatusOf(latest) === 'STALE' ? 'STALE' : 'ERROR' }
  if (latest.status === 'limited') return { mode: 'limited', status: 'LIMITED' }
  if (latest.source === 'live' && latest.status === 'success' && sourceStatusOf(latest) === 'LIVE') return { mode: 'live', status: 'LIVE' }
  if (latest.source === 'replay' || sourceStatusOf(latest) === 'REPLAY') return { mode: 'replay', status: 'REPLAY' }
  if (latest.source === 'mock') return { mode: 'mock', status: 'MOCK' }
  return { mode: 'stale', status: 'STALE' }
}

export default async function handler(request: Request, response: Response): Promise<void> {
  const config = readPublicRuntimeConfig()
  if (!config) {
    response.status(503).json({ error: 'LIVE_UNAVAILABLE', mode: 'error', status: 'ERROR' })
    return
  }
  if (!applyCors(request, response, config.publicOrigin)) return
  if (request.method === 'OPTIONS') {
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Accept')
    response.status(204).end()
    return
  }
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET, OPTIONS')
    response.status(405).json({ error: 'METHOD_NOT_ALLOWED' })
    return
  }
  const now = Date.now()
  if (now - readBucket.startedAt >= 60_000) readBucket = { startedAt: now, count: 0 }
  readBucket.count += 1
  if (readBucket.count > 120) {
    response.status(429).json({ error: 'READ_RATE_LIMIT' })
    return
  }
  const requestedGameId = queryValue(request, 'gameId')
  const requestedKey = queryValue(request, 'idempotencyKey')
  if (requestedGameId && requestedGameId !== config.featuredGameId) {
    response.status(404).json({ error: 'FEATURED_GAME_ONLY' })
    return
  }
  try {
    const store = new ConvexForecastStore(config.convexUrl)
    const record = requestedKey ? await store.getForecastByIdempotencyKey(requestedKey) : undefined
    if (requestedKey && (!record || record.gameId !== config.featuredGameId)) {
      response.status(404).json({ error: 'FORECAST_NOT_FOUND' })
      return
    }
    const records: readonly ForecastRecord[] = requestedKey
      ? (record ? [record] : [])
      : await store.listForecastsByGame(config.featuredGameId)
    const label = deriveLabel(records)
    response.status(200).json({ ...label, gameId: config.featuredGameId, records })
  } catch {
    response.status(503).json({ error: 'LIVE_READ_FAILED', mode: 'error', status: 'ERROR' })
  }
}
