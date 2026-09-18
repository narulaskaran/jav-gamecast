import { describe, expect, it } from 'vitest'
import { SAMPLE_WIN_LIKELIHOOD_TASK, SAMPLE_WIN_NOUL_QUERY } from './questionKind'
import {
  buildJevQuery,
  classesFromJevQuery,
  formatDraftQueryForEditor,
  jevQuerySummary,
  looksLikeJevQueryJson,
  parseJevQueryJson,
  stringifyJevQuery,
} from './jevQuery'

describe('Jev query JSON', () => {
  it('serializes Noul / Choice / Score as the editable query shape', () => {
    expect(JSON.parse(stringifyJevQuery({ type: 'noul', instructions: SAMPLE_WIN_NOUL_QUERY }))).toEqual({
      type: 'noul',
      instructions: SAMPLE_WIN_NOUL_QUERY,
    })
    expect(JSON.parse(stringifyJevQuery({
      type: 'choice',
      instructions: 'Classify each ticket.',
      criteria: { urgent: 'the urgent class', routine: 'the routine class' },
    }))).toEqual({
      type: 'choice',
      instructions: 'Classify each ticket.',
      criteria: { urgent: 'the urgent class', routine: 'the routine class' },
    })
    expect(JSON.parse(stringifyJevQuery({
      type: 'score',
      instructions: 'Rate severity.',
      criteria: ['Low', 'Medium', 'High'],
    })).type).toBe('score')
  })

  it('formats a drafted prose query into JSON so the editor is not a task paraphrase', () => {
    const json = formatDraftQueryForEditor({
      query: SAMPLE_WIN_NOUL_QUERY,
      questionKind: 'noul',
      classes: [],
    })
    expect(looksLikeJevQueryJson(json)).toBe(true)
    expect(json).not.toBe(SAMPLE_WIN_LIKELIHOOD_TASK)
    expect(parseJevQueryJson(json)).toEqual({ type: 'noul', instructions: SAMPLE_WIN_NOUL_QUERY })
    expect(jevQuerySummary(parseJevQueryJson(json)!)).toBe('Noul · yes/no probability 0–1')
  })

  it('round-trips an edited Choice JSON including class criteria', () => {
    const edited = stringifyJevQuery({
      type: 'choice',
      instructions: 'Use only visible columns.',
      criteria: { gold: 'premium', silver: 'standard' },
    })
    const parsed = parseJevQueryJson(edited)
    expect(parsed?.type).toBe('choice')
    expect(classesFromJevQuery(parsed!)).toEqual(['gold', 'silver'])
    expect(buildJevQuery({ type: 'noul', instructions: SAMPLE_WIN_NOUL_QUERY }).type).toBe('noul')
  })
})
