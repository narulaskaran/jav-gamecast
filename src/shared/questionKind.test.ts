import { describe, expect, it } from 'vitest'
import {
  SAMPLE_WIN_LIKELIHOOD_TASK,
  SAMPLE_WIN_NOUL_QUERY,
  chartVisualFor,
  fixtureAnalysisSliceFor,
  inferQuestionKind,
  resolveDraftedQuery,
  seriesValueFromRow,
} from './questionKind'

describe('draft honors the user prompt', () => {
  it('replaces the fixture player-class fallback for a win-likelihood task', () => {
    const drafted = resolveDraftedQuery({
      task: SAMPLE_WIN_LIKELIHOOD_TASK,
      query: 'Classify the most likely leading player from K.Walker, C.Kupp, J.Smith-Njigba, or Other.',
      questionKind: 'choice',
      classes: ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie'],
    })
    expect(drafted).toEqual({
      query: SAMPLE_WIN_NOUL_QUERY,
      questionKind: 'noul',
      classes: [],
    })
    expect(JSON.stringify(drafted)).not.toMatch(/K\.Walker|C\.Kupp|Smith-Njigba|Other\/Tie/)
  })

  it('keeps a Noul win query the model actually drafted', () => {
    expect(resolveDraftedQuery({
      task: SAMPLE_WIN_LIKELIHOOD_TASK,
      query: 'Will the Seahawks win given this play state?',
      questionKind: 'noul',
      classes: ['K.Walker', 'C.Kupp'],
    })).toEqual({
      query: 'Will the Seahawks win given this play state?',
      questionKind: 'noul',
      classes: [],
    })
  })

  it('does not inject fixture player classes into an unrelated Choice draft', () => {
    expect(resolveDraftedQuery({
      task: 'Classify support tickets as urgent or routine.',
      query: 'Classify each ticket as urgent or routine using message and tier.',
      questionKind: 'choice',
      classes: ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie'],
    })).toEqual({
      query: 'Classify each ticket as urgent or routine using message and tier.',
      questionKind: 'choice',
      classes: [],
    })
  })

  it('keeps user-asked Choice classes, including the fixture players when requested', () => {
    expect(resolveDraftedQuery({
      task: 'Who is the leading rusher: K.Walker, C.Kupp, J.Smith-Njigba, or Other?',
      query: 'Classify the leading player from the visible columns.',
      questionKind: 'choice',
      classes: ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie'],
    }).classes).toEqual(['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie'])
  })
})

describe('chart type follows the drafted query', () => {
  it('routes Noul and Score to a series chart and Choice to class bars', () => {
    expect(chartVisualFor('noul')).toBe('series')
    expect(chartVisualFor('score')).toBe('series')
    expect(chartVisualFor('choice')).toBe('bars')
    expect(inferQuestionKind(SAMPLE_WIN_LIKELIHOOD_TASK)).toBe('noul')
    expect(inferQuestionKind('Classify tickets.', ['urgent', 'routine'])).toBe('choice')
    expect(inferQuestionKind(JSON.stringify({ type: 'noul', instructions: SAMPLE_WIN_NOUL_QUERY }))).toBe('noul')
    expect(inferQuestionKind(JSON.stringify({ type: 'choice', instructions: 'Classify tickets.', criteria: { urgent: 'a', routine: 'b' } }))).toBe('choice')
    expect(inferQuestionKind(JSON.stringify({ type: 'score', instructions: 'Rate it.', criteria: ['Low', 'High'] }))).toBe('score')
  })

  it('routes the sample Noul path to full-game rows and keeps H1 yards evaluation isolated', () => {
    expect(fixtureAnalysisSliceFor()).toBe('win-likelihood')
    expect(fixtureAnalysisSliceFor({ task: SAMPLE_WIN_LIKELIHOOD_TASK })).toBe('win-likelihood')
    expect(fixtureAnalysisSliceFor({ query: SAMPLE_WIN_NOUL_QUERY, questionKind: 'noul' })).toBe('win-likelihood')
    expect(fixtureAnalysisSliceFor({
      query: JSON.stringify({ type: 'noul', instructions: SAMPLE_WIN_NOUL_QUERY }),
    })).toBe('win-likelihood')
    expect(fixtureAnalysisSliceFor({ task: 'Find a useful H1 classifier.' })).toBe('halftime-eval')
    expect(fixtureAnalysisSliceFor({
      query: 'Classify the most likely leading player from the visible first-half play inputs.',
      classes: ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie'],
    })).toBe('halftime-eval')
    expect(fixtureAnalysisSliceFor({
      questionKind: 'choice',
      classes: ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie'],
    })).toBe('halftime-eval')
  })

  it('reads Jev series values and never treats CSV wpa as the prediction', () => {
    expect(seriesValueFromRow({ value: 0.42 })).toBe(0.42)
    expect(seriesValueFromRow({ value: 1.4 })).toBe(1)
    expect(seriesValueFromRow({})).toBeUndefined()
    const row = { value: 0.31, input: { wpa: 0.91 } }
    expect(seriesValueFromRow(row)).toBe(0.31)
    expect(seriesValueFromRow({ input: { wpa: 0.91 } } as { value?: number })).toBeUndefined()
  })
})
