import { describe, expect, it } from 'vitest'
import { createBrowserForecastHttpReadPath } from './forecastHttp'
import { createBrowserForecastSource } from './forecastRead'

const record = {
  idempotencyKey: 'key', gameId: 'game', providerEventId: 'event', stateHash: 'hash', rawNormalizedState: { sourceStatus: 'LIVE' },
  model: 'jev-latest', status: 'success' as const, source: 'live' as const, requestedAt: '2026-09-17T03:00:00Z', completedAt: '2026-09-17T03:00:01Z', latencyMs: 1,
  choice: 'home' as const, probabilities: { home: 0.6, away: 0.3, tie: 0.1 }, confidence: 0.6,
}

describe('browser live HTTP boundary', () => {
  it('reads the same persisted record without a Convex or provider import', async () => {
    const calls: string[] = []
    const path = createBrowserForecastHttpReadPath('/api/gamecast', async (input) => {
      calls.push(String(input))
      return new Response(JSON.stringify({ mode: 'live', gameId: 'game', status: 'LIVE', records: [record] }), { status: 200 })
    })
    await expect(path.getReplayForecasts('game')).resolves.toEqual([record])
    await expect(path.getForecastByIdempotencyKey('key')).resolves.toEqual(record)
    expect(path.mode).toBe('live')
    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain('gameId=')
    expect(calls[1]).toContain('idempotencyKey=')
  })

  it('fails closed on an invalid public response', async () => {
    const path = createBrowserForecastHttpReadPath('/api/gamecast', async () => new Response('{}', { status: 200 }))
    await expect(path.getReplayForecasts('game')).rejects.toThrow('invalid payload')
  })

  it('marks the live source stale while retaining its replay fallback', async () => {
    const source = createBrowserForecastSource({
      readPath: createBrowserForecastHttpReadPath('/api/gamecast', async () => new Response('{}', { status: 200 })),
      gameId: 'game',
      fallback: [],
    })
    await expect(source.refresh()).rejects.toThrow()
    expect(source.feedStatus).toBe('STALE')
    expect(source.getPoints()).toEqual([])
  })
})
