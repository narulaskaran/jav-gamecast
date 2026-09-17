import { ConvexForecastStore } from '../../src/server/convexStore'
import { readLiveRuntimeConfig } from '../../src/server/liveConfig'
import { TypeSafeJevProvider } from '../../src/server/jev'
import { runForecastCycle } from '../../src/server/orchestrator'
import type { ForecastRecord } from '../../src/shared/forecastRecords'

type Request = { method?: string; headers: Record<string, string | string[] | undefined> }
type Response = { status: (code: number) => Response; json: (body: unknown) => Response; setHeader: (name: string, value: string) => Response }
let running = false

const runtimeLabel = (snapshotStatus: string, record: ForecastRecord): { mode: string; status: string } => {
  if (snapshotStatus === 'REPLAY' || record.source === 'replay') return { mode: 'replay', status: 'REPLAY' }
  if (snapshotStatus === 'STALE' || record.source === 'stale') return { mode: 'stale', status: 'STALE' }
  if (record.status === 'limited') return { mode: 'limited', status: 'LIMITED' }
  if (record.status === 'error') return { mode: 'error', status: 'ERROR' }
  if (snapshotStatus === 'LIVE' && record.source === 'live' && record.status === 'success') return { mode: 'live', status: 'LIVE' }
  return { mode: 'error', status: 'ERROR' }
}

const header = (request: Request, name: string): string | undefined => {
  const value = request.headers[name] ?? request.headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

const authorized = (request: Request, secret: string): boolean => {
  const authorization = header(request, 'authorization')
  return authorization === `Bearer ${secret}` || header(request, 'x-cron-secret') === secret
}

export default async function handler(request: Request, response: Response): Promise<void> {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    response.status(405).json({ error: 'METHOD_NOT_ALLOWED' })
    return
  }
  const config = readLiveRuntimeConfig()
  if (!config) {
    response.status(503).json({ error: 'LIVE_NOT_PROVISIONED', mode: 'error', status: 'ERROR' })
    return
  }
  if (!authorized(request, config.cronSecret)) {
    response.status(401).json({ error: 'UNAUTHORIZED' })
    return
  }
  if (running) {
    response.status(409).json({ error: 'CYCLE_IN_PROGRESS' })
    return
  }
  running = true
  try {
    const result = await runForecastCycle({
      mode: 'live',
      store: new ConvexForecastStore(config.convexUrl, config.convexWriteSecret),
      budgetScope: `featured:${config.featuredGameId}`,
      provider: new TypeSafeJevProvider({ apiKey: config.typesafeApiKey }),
      espn: { featuredEventId: config.featuredGameId },
    })
    response.status(200).json({
      ...runtimeLabel(result.snapshot.status, result.forecast.record),
      feedStatus: result.snapshot.status,
      record: result.forecast.record,
      cacheHit: result.forecast.cacheHit,
    })
  } catch {
    response.status(503).json({ error: 'LIVE_CYCLE_FAILED', mode: 'error', status: 'ERROR' })
  } finally {
    running = false
  }
}
