import { describe, expect, it, vi } from 'vitest'
import { fixtureGameStateSource } from '../sources'
import {
  ESPN_ENDPOINTS,
  EspnGameStateSource,
  normalizeEspnGameState,
  type EspnFetch,
} from './espn'

const scoreboard = (overrides: Record<string, unknown> = {}) => ({
  events: [{
    id: '401999001',
    date: '2026-09-17T03:00:00Z',
    name: 'Cedar Foxes at Harbor Hawks',
    competitions: [{
      id: '401999001',
      date: '2026-09-17T03:00:00Z',
      competitors: [
        { id: '10', homeAway: 'home', score: '21', team: { id: '10', abbreviation: 'HAW', displayName: 'Harbor Hawks' } },
        { id: '20', homeAway: 'away', score: '17', team: { id: '20', abbreviation: 'FOX', displayName: 'Cedar Foxes' } },
      ],
      situation: { possession: '20', down: 2, distance: 7, possessionText: 'FOX 34' },
      status: { type: { state: 'in', detail: 'Q3 04:12', shortDetail: 'Q3 04:12' }, period: 3, displayClock: '04:12' },
    }],
    status: { type: { state: 'in', detail: 'Q3 04:12', shortDetail: 'Q3 04:12' }, period: 3, displayClock: '04:12' },
    ...overrides,
  }],
})

const summary = (overrides: Record<string, unknown> = {}) => ({
  header: {
    id: '401999001',
    competitions: [{
      competitors: [
        { id: '10', homeAway: 'home', score: '21', team: { id: '10', abbreviation: 'HAW', displayName: 'Harbor Hawks' } },
        { id: '20', homeAway: 'away', score: '17', team: { id: '20', abbreviation: 'FOX', displayName: 'Cedar Foxes' } },
      ],
      situation: { possession: '20', down: 2, distance: 7, possessionText: 'FOX 34' },
      status: { type: { state: 'in' }, period: 3, displayClock: '04:12' },
    }],
  },
  plays: [{
    id: '9002',
    sequenceNumber: 22,
    text: 'Pass complete to the Harbor Hawks 34 yard line',
    clock: { displayValue: '04:12' },
    period: { number: 3 },
    type: { text: 'Pass' },
    date: '2026-09-17T03:40:00Z',
  }],
  ...overrides,
})

const corePlays = {
  items: [{
    id: '9002',
    sequenceNumber: 22,
    text: 'Pass complete to the Harbor Hawks 34 yard line',
    clock: { displayValue: '04:12' },
    period: { number: 3 },
    date: '2026-09-17T03:40:00Z',
  }],
}

const response = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

const fetchSequence = (responses: Response[]): { fetch: EspnFetch; calls: { url: string; init?: RequestInit }[] } => {
  const calls: { url: string; init?: RequestInit }[] = []
  let index = 0
  const fetch: EspnFetch = vi.fn(async (url, init) => {
    calls.push({ url, init })
    return responses[Math.min(index++, responses.length - 1)]
  })
  return { fetch, calls }
}

const adapterOptions = (fetch: EspnFetch) => ({
  fetch,
  now: () => Date.parse('2026-09-17T03:41:00Z'),
  sleep: async () => undefined,
  backoffMs: 0,
})

describe('normalizeEspnGameState', () => {
  it('normalizes scoreboard, summary, and core play fields without leaking provider shape', () => {
    const state = normalizeEspnGameState({ scoreboard: scoreboard(), summary: summary(), plays: corePlays })

    expect(state).toEqual(expect.objectContaining({
      id: '401999001',
      eventId: '401999001',
      playId: '9002',
      sequenceNumber: 22,
      homeTeam: 'Harbor Hawks',
      awayTeam: 'Cedar Foxes',
      homeScore: 21,
      awayScore: 17,
      quarter: 'Q3',
      clock: '04:12',
      possession: 'away',
      lastPlay: 'Pass complete to the Harbor Hawks 34 yard line',
      timestamp: '2026-09-17T03:40:00Z',
      down: 2,
      distance: 7,
      fieldPosition: 'FOX 34',
    }))
  })

  it('rejects a feed without stable event identity, timestamp, or score', () => {
    expect(() => normalizeEspnGameState({ scoreboard: { events: [] }, summary: {}, plays: {} })).toThrow(/event/i)
    expect(() => normalizeEspnGameState({
      scoreboard: scoreboard({
        date: undefined,
        competitions: [{ ...scoreboard().events[0].competitions[0], date: undefined }],
      }),
      summary: summary({ plays: [{ ...summary().plays[0], date: undefined }] }),
      plays: { items: [] },
    })).toThrow(/timestamp/i)
    expect(() => normalizeEspnGameState({
      scoreboard: scoreboard({
        competitions: [{
          ...scoreboard().events[0].competitions[0],
          competitors: [
            { ...scoreboard().events[0].competitions[0].competitors[0], score: undefined },
            scoreboard().events[0].competitions[0].competitors[1],
          ],
        }],
      }),
      summary: {
        ...summary(),
        header: {
          ...summary().header,
          competitions: [{
            ...summary().header.competitions[0],
            competitors: [
              { ...summary().header.competitions[0].competitors[0], score: undefined },
              summary().header.competitions[0].competitors[1],
            ],
          }],
        },
      },
      plays: corePlays,
    })).toThrow(/score/i)
  })
})

describe('EspnGameStateSource', () => {
  it('uses the configured endpoints, descriptive user agent, bounded retry, and live status', async () => {
    const { fetch, calls } = fetchSequence([
      response({}, 503),
      response(scoreboard()),
      response(summary()),
      response(corePlays),
    ])
    const source = new EspnGameStateSource(adapterOptions(fetch))

    const snapshot = await source.poll()

    expect(snapshot.status).toBe('LIVE')
    expect(snapshot.state.playId).toBe('9002')
    expect(calls.map(({ url }) => url)).toEqual([
      ESPN_ENDPOINTS.scoreboard,
      ESPN_ENDPOINTS.scoreboard,
      ESPN_ENDPOINTS.summary('401999001'),
      ESPN_ENDPOINTS.plays('401999001'),
    ])
    expect(new Headers(calls[0].init?.headers).get('user-agent')).toBe('jev-gamecast/0.1 (+project URL)')
  })

  it('keeps the configured featured event identity when multiple scoreboard events are live', async () => {
    const firstEvent = scoreboard().events[0]
    const featuredScoreboard = {
      events: [
        firstEvent,
        {
          ...firstEvent,
          id: '401999002',
          name: 'River Owls at Mountain Bears',
          competitions: [{
            ...firstEvent.competitions[0],
            id: '401999002',
            competitors: [
              { id: '30', homeAway: 'home', score: '7', team: { id: '30', abbreviation: 'BEA', displayName: 'Mountain Bears' } },
              { id: '40', homeAway: 'away', score: '3', team: { id: '40', abbreviation: 'OWL', displayName: 'River Owls' } },
            ],
          }],
        },
      ],
    }
    const featuredSummary = {
      ...summary(),
      header: {
        ...summary().header,
        id: '401999002',
        competitions: [{
          ...summary().header.competitions[0],
          competitors: [
            { id: '30', homeAway: 'home', score: '7', team: { id: '30', abbreviation: 'BEA', displayName: 'Mountain Bears' } },
            { id: '40', homeAway: 'away', score: '3', team: { id: '40', abbreviation: 'OWL', displayName: 'River Owls' } },
          ],
        }],
      },
      plays: [{ ...summary().plays[0], id: '9102', sequenceNumber: 8, text: 'River Owls punt', date: '2026-09-17T03:40:00Z' }],
    }
    const featuredPlays = {
      items: [{ ...corePlays.items[0], id: '9102', sequenceNumber: 8, text: 'River Owls punt', date: '2026-09-17T03:40:00Z' }],
    }
    const { fetch } = fetchSequence([
      response(featuredScoreboard), response(featuredSummary), response(featuredPlays),
    ])
    const source = new EspnGameStateSource({
      ...adapterOptions(fetch),
      featuredEventId: '401999002',
    })

    const snapshot = await source.poll()

    expect(snapshot.state).toEqual(expect.objectContaining({
      eventId: '401999002',
      id: '401999002',
      homeTeam: 'Mountain Bears',
      awayTeam: 'River Owls',
      playId: '9102',
    }))
  })

  it('ignores duplicate and out-of-order play updates', async () => {
    const older = { ...corePlays, items: [{ ...corePlays.items[0], id: '9001', sequenceNumber: 21, date: '2026-09-17T03:39:00Z', text: 'Earlier play' }] }
    const newerScoreboard = scoreboard({
      competitions: [{
        ...scoreboard().events[0].competitions[0],
        competitors: [
          { ...scoreboard().events[0].competitions[0].competitors[0], score: '24' },
          scoreboard().events[0].competitions[0].competitors[1],
        ],
      }],
    })
    const { fetch } = fetchSequence([
      response(scoreboard()), response(summary()), response(corePlays),
      response(scoreboard()), response(summary()), response(corePlays),
      response(newerScoreboard), response(summary()), response(older),
    ])
    const source = new EspnGameStateSource(adapterOptions(fetch))

    const first = await source.poll()
    const duplicate = await source.poll()
    const outOfOrder = await source.poll()

    expect(duplicate).toEqual(first)
    expect(outOfOrder).toEqual(expect.objectContaining({ status: 'STALE' }))
    expect(outOfOrder.state).toEqual(expect.objectContaining({
      eventId: first.state.eventId,
      timestamp: first.state.timestamp,
      sourceStatus: 'STALE',
    }))
  })

  it('does not replace a newer cache when an older payload is also beyond the stale threshold', async () => {
    const freshPlays = {
      items: [{ ...corePlays.items[0], id: '9003', sequenceNumber: 23, date: '2026-09-17T03:40:55Z', text: 'Fresh play' }],
    }
    const oldPlays = {
      items: [{ ...corePlays.items[0], id: '9001', sequenceNumber: 21, date: '2026-09-17T03:39:00Z', text: 'Old play' }],
    }
    const { fetch } = fetchSequence([
      response(scoreboard()), response(summary()), response(freshPlays),
      response(scoreboard()), response(summary()), response(oldPlays),
    ])
    const source = new EspnGameStateSource({
      ...adapterOptions(fetch),
      staleAfterMs: 30_000,
      now: () => Date.parse('2026-09-17T03:41:00Z'),
    })

    const fresh = await source.poll()
    const old = await source.poll()

    expect(fresh.status).toBe('LIVE')
    expect(old).toEqual({
      state: expect.objectContaining({
        eventId: fresh.state.eventId,
        playId: fresh.state.playId,
        timestamp: fresh.state.timestamp,
        sourceStatus: 'STALE',
      }),
      status: 'STALE',
    })
    expect(source.getCachedSnapshot()).toEqual(fresh)
  })

  it('returns cached state as stale after failures and deterministic replay when uncached', async () => {
    const cachedFetch = fetchSequence([
      response(scoreboard()), response(summary()), response(corePlays),
      response({}, 503), response({}, 503), response({}, 503),
    ])
    const cachedSource = new EspnGameStateSource(adapterOptions(cachedFetch.fetch))
    const live = await cachedSource.poll()
    const stale = await cachedSource.poll()

    expect(live.status).toBe('LIVE')
    expect(stale.status).toBe('STALE')
    expect(stale.state).toEqual(expect.objectContaining({
      eventId: live.state.eventId,
      timestamp: live.state.timestamp,
      sourceStatus: 'STALE',
    }))

    const failed = fetchSequence([response({}, 503), response({}, 503), response({}, 503)])
    const replaySource = new EspnGameStateSource({
      ...adapterOptions(failed.fetch),
      replay: fixtureGameStateSource,
    })
    const replay = await replaySource.poll()

    expect(replay.status).toBe('REPLAY')
    expect(replay.state).toEqual(expect.objectContaining({
      id: 'demo-2026-09-17',
      sourceStatus: 'REPLAY',
    }))
  })

  it('aborts timed-out requests and falls back without an unbounded poll', async () => {
    const timeoutFetch: EspnFetch = vi.fn((_url, init) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const source = new EspnGameStateSource({
      ...adapterOptions(timeoutFetch),
      timeoutMs: 1,
      maxRetries: 1,
      replay: fixtureGameStateSource,
    })

    const snapshot = await source.poll()

    expect(snapshot.status).toBe('REPLAY')
    expect(timeoutFetch).toHaveBeenCalledTimes(2)
  })

  it('rejects non-finite, fractional, and out-of-range retry policy configuration', () => {
    const invalidOptions = [
      ['timeoutMs', { timeoutMs: Infinity }],
      ['maxRetries', { maxRetries: Infinity }],
      ['maxRetries', { maxRetries: 1.5 }],
      ['backoffMs', { backoffMs: Number.NaN }],
      ['backoffMs', { backoffMs: -1 }],
    ] as const

    for (const [name, options] of invalidOptions) {
      expect(() => new EspnGameStateSource(options)).toThrow(name)
    }
  })

  it('marks an old but valid feed stale without inventing a current timestamp', async () => {
    const { fetch } = fetchSequence([response(scoreboard()), response(summary()), response(corePlays)])
    const source = new EspnGameStateSource({
      ...adapterOptions(fetch),
      staleAfterMs: 30_000,
      now: () => Date.parse('2026-09-17T03:42:00Z'),
    })

    const snapshot = await source.poll()

    expect(snapshot.status).toBe('STALE')
    expect(snapshot.state.timestamp).toBe('2026-09-17T03:40:00Z')
  })
})
