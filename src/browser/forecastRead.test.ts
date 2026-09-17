import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createBrowserForecastReadPath, forecastRecordsToPoints } from './forecastRead'
import type { ForecastRecord } from '../shared/forecastRecords'

const record: ForecastRecord = {
  idempotencyKey: 'game-1:event-1:play-1:hash',
  gameId: 'game-1',
  providerEventId: 'event-1',
  providerPlayId: 'play-1',
  stateHash: 'hash',
  rawNormalizedState: {
    eventId: 'event-1',
    timestamp: '2026-09-17T03:40:00Z',
  },
  model: 'jev-latest',
  status: 'success',
  source: 'replay',
  requestedAt: '2026-09-17T03:40:00Z',
  completedAt: '2026-09-17T03:40:00Z',
  latencyMs: 12,
  choice: 'away',
  probabilities: { home: 0.3, away: 0.6, tie: 0.1 },
  confidence: 0.6,
}

describe('browser forecast read path', () => {
  it('reads shared cached and replay records through a server-neutral boundary', async () => {
    const boundary = {
      getForecastByIdempotencyKey: async (key: string) => key === record.idempotencyKey ? record : undefined,
      listForecastsByGame: async (gameId: string) => gameId === record.gameId ? [record] : [],
    }
    const reader = createBrowserForecastReadPath(boundary)

    await expect(reader.getCachedForecast(record.idempotencyKey)).resolves.toBe(record)
    await expect(reader.getReplayForecasts('game-1')).resolves.toEqual([record])
    expect(forecastRecordsToPoints([record])).toEqual([expect.objectContaining({
      id: record.idempotencyKey,
      eventId: 'event-1',
      choice: 'away',
      homeProbability: 0.3,
      awayProbability: 0.6,
      tieProbability: 0.1,
    })])
  })

  it('does not import server modules', () => {
    const source = readFileSync('src/browser/forecastRead.ts', 'utf8')
    expect(source).not.toMatch(/\.\.\/server\//)
    expect(source).not.toContain('@typesafe-ai/sdk')
  })
})
