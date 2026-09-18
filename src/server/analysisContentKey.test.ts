import { describe, expect, it } from 'vitest'
import { FOOTBALL_FIXTURE_ID } from '../fixtures/footballTimeline'
import { SAMPLE_WIN_NOUL_QUERY } from '../shared/questionKind'
import { analysisContentFingerprint, analysisContentKey } from './analysisContentKey'

describe('analysis content key', () => {
  it('hashes datasetId, canonical query, question kind, and classes', () => {
    const fromJson = analysisContentKey({
      datasetId: FOOTBALL_FIXTURE_ID,
      query: JSON.stringify({ type: 'noul', instructions: SAMPLE_WIN_NOUL_QUERY }, null, 2),
      questionKind: 'noul',
    })
    const fromPlain = analysisContentKey({
      datasetId: FOOTBALL_FIXTURE_ID,
      query: `  ${SAMPLE_WIN_NOUL_QUERY}  `,
      questionKind: 'noul',
      classes: ['ignored-for-noul'],
    })
    expect(fromJson).toBe(fromPlain)
    expect(fromJson).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.parse(analysisContentFingerprint({
      datasetId: FOOTBALL_FIXTURE_ID,
      query: SAMPLE_WIN_NOUL_QUERY,
      questionKind: 'noul',
    }))).toEqual({
      v: 1,
      datasetId: FOOTBALL_FIXTURE_ID,
      query: JSON.stringify({ type: 'noul', instructions: SAMPLE_WIN_NOUL_QUERY }),
      questionKind: 'noul',
      classes: [],
    })
  })

  it('changes when the dataset or query changes', () => {
    const sample = analysisContentKey({
      datasetId: FOOTBALL_FIXTURE_ID,
      query: SAMPLE_WIN_NOUL_QUERY,
      questionKind: 'noul',
    })
    expect(analysisContentKey({
      datasetId: 'tickets',
      query: SAMPLE_WIN_NOUL_QUERY,
      questionKind: 'noul',
    })).not.toBe(sample)
    expect(analysisContentKey({
      datasetId: FOOTBALL_FIXTURE_ID,
      query: 'Will the away team cover the spread?',
      questionKind: 'noul',
    })).not.toBe(sample)
  })

  it('treats choice class order as equivalent', () => {
    const query = 'Classify each ticket as urgent or routine.'
    const left = analysisContentKey({
      datasetId: 'tickets',
      query,
      questionKind: 'choice',
      classes: ['urgent', 'routine'],
    })
    const right = analysisContentKey({
      datasetId: 'tickets',
      query,
      questionKind: 'choice',
      classes: ['routine', 'urgent'],
    })
    expect(left).toBe(right)
  })
})
