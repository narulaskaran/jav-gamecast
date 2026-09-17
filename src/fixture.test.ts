import { describe, expect, it } from 'vitest'
import { fixture, parseFixture } from './fixture'

describe('synthetic fixture parsing', () => {
  it('provides a normalized game state and immutable forecast points', () => {
    const parsed = parseFixture(fixture)
    expect(parsed.game.homeTeam).toBe('Harbor Hawks')
    expect(parsed.game.awayTeam).toBe('Cedar Foxes')
    expect(parsed.points).toHaveLength(8)
    expect(parsed.points[0]).toMatchObject({ gameId: 'demo-2026-09-17', choice: 'away' })
    expect(parsed.points.every((point) => point.homeProbability + point.awayProbability + point.tieProbability === 100)).toBe(true)
  })

  it('rejects malformed or future-leaking fixture points', () => {
    expect(() => parseFixture({ game: fixture.game, points: [] })).toThrow(/forecast points/i)
    expect(() => parseFixture({ game: fixture.game, points: [{ ...fixture.points[0], homeProbability: 101 }, fixture.points[1]] })).toThrow(/probabilit/i)
  })
})
