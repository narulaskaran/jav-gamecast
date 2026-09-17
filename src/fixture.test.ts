import { describe, expect, it } from 'vitest'
import { fixture, parseFixture } from './fixture'

const copyFixture = () => ({
  game: { ...fixture.game },
  points: fixture.points.map((point) => ({ ...point })),
})

describe('synthetic fixture parsing', () => {
  it('provides a normalized game state and immutable forecast points', () => {
    const parsed = parseFixture(fixture)

    expect(parsed.game.homeTeam).toBe('Harbor Hawks')
    expect(parsed.game.awayTeam).toBe('Cedar Foxes')
    expect(parsed.points).toHaveLength(8)
    expect(parsed.points[0]).toMatchObject({ gameId: 'demo-2026-09-17', choice: 'away' })
    expect(parsed.points.every((point) => point.homeProbability + point.awayProbability + point.tieProbability === 100)).toBe(true)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.game)).toBe(true)
    expect(Object.isFrozen(parsed.points)).toBe(true)
    expect(Object.isFrozen(parsed.points[0])).toBe(true)
  })

  it('does not mutate the source object while normalizing it', () => {
    const input = copyFixture()
    const original = JSON.stringify(input)

    parseFixture(input)

    expect(JSON.stringify(input)).toBe(original)
  })

  it('rejects malformed fixture structure and game fields', () => {
    const malformedGames: unknown[] = [
      { ...fixture.game, id: 42 },
      { ...fixture.game, homeTeam: '' },
      { ...fixture.game, awayTeam: 7 },
      { ...fixture.game, homeScore: Number.NaN },
      { ...fixture.game, quarter: '' },
      { ...fixture.game, status: 'overtime' },
      { ...fixture.game, possession: 'both' },
      { ...fixture.game, timestamp: 'not-a-date' },
      { ...fixture.game, lastPlay: null },
    ]

    expect(() => parseFixture({ game: fixture.game, points: [] })).toThrow(/forecast points/i)
    for (const game of malformedGames) {
      expect(() => parseFixture({ game, points: fixture.points })).toThrow()
    }
  })

  it.each([
    ['point id', { id: 42 }],
    ['event id', { eventId: 42 }],
    ['timestamp', { timestamp: 'not-a-date' }],
    ['elapsed seconds type', { elapsedSeconds: '90' }],
    ['negative elapsed seconds', { elapsedSeconds: -1 }],
    ['choice', { choice: 'home-team' }],
    ['confidence', { confidence: 101 }],
    ['probability range', { homeProbability: 101 }],
    ['probability total', { tieProbability: 11 }],
  ])('rejects an invalid %s', (_label, change) => {
    const input = copyFixture()
    input.points[1] = { ...input.points[1], ...change } as typeof input.points[number]

    expect(() => parseFixture(input)).toThrow()
  })

  it('rejects non-string and wrong-game point IDs', () => {
    const wrongGame = copyFixture()
    wrongGame.points[1] = { ...wrongGame.points[1], gameId: 'other-game' }
    expect(() => parseFixture(wrongGame)).toThrow(/game id/i)

    const nonStringEvent = copyFixture()
    nonStringEvent.points[1] = { ...nonStringEvent.points[1], eventId: 123 } as unknown as typeof nonStringEvent.points[number]
    expect(() => parseFixture(nonStringEvent)).toThrow(/event id/i)
  })

  it('rejects duplicate IDs and out-of-order checkpoints', () => {
    const duplicatePoint = copyFixture()
    duplicatePoint.points[1] = { ...duplicatePoint.points[1], id: duplicatePoint.points[0].id }
    expect(() => parseFixture(duplicatePoint)).toThrow(/duplicate/i)

    const duplicateEvent = copyFixture()
    duplicateEvent.points[1] = { ...duplicateEvent.points[1], eventId: duplicateEvent.points[0].eventId }
    expect(() => parseFixture(duplicateEvent)).toThrow(/duplicate/i)

    const outOfOrderTime = copyFixture()
    outOfOrderTime.points[1] = { ...outOfOrderTime.points[1], timestamp: outOfOrderTime.points[0].timestamp }
    expect(() => parseFixture(outOfOrderTime)).toThrow(/order/i)

    const outOfOrderElapsed = copyFixture()
    outOfOrderElapsed.points[1] = { ...outOfOrderElapsed.points[1], elapsedSeconds: outOfOrderElapsed.points[0].elapsedSeconds }
    expect(() => parseFixture(outOfOrderElapsed)).toThrow(/order/i)
  })
})
