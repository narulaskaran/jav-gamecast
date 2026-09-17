import { describe, expect, it } from 'vitest'
import { fixture } from './fixture'
import { fixtureGameStateSource } from './sources'

describe('fixture replay source integrity', () => {
  it('keeps every game snapshot aligned with its forecast checkpoint and status', () => {
    fixture.points.forEach((point, index) => {
      const snapshot = fixtureGameStateSource.getSnapshotAt(index)

      expect(snapshot.status).toBe('REPLAY')
      expect(snapshot.state).toMatchObject({
        eventId: point.eventId,
        timestamp: point.timestamp,
        lastPlay: expect.stringContaining(point.eventLabel ?? ''),
      })
    })
  })

  it('clamps source reads while preserving the source-owned replay status', () => {
    expect(fixtureGameStateSource.getSnapshotAt(-1)).toEqual(fixtureGameStateSource.getSnapshotAt(0))
    expect(fixtureGameStateSource.getSnapshotAt(999)).toEqual(fixtureGameStateSource.getSnapshotAt(fixture.points.length - 1))
    expect(fixtureGameStateSource.getSnapshotAt(0).status).toBe('REPLAY')
  })

  it('shows the away team leading at the Foxes take the lead checkpoint', () => {
    const pointIndex = fixture.points.findIndex((point) => point.eventLabel === 'Foxes take the lead')
    const snapshot = fixtureGameStateSource.getSnapshotAt(pointIndex)

    expect(snapshot.state).toMatchObject({
      eventId: 'score-03',
      homeScore: 17,
      awayScore: 24,
      lastPlay: expect.stringContaining('Foxes take the lead'),
    })
  })
})
