import { describe, expect, it } from 'vitest'
import { railMetaLine, runErrorCopy, runErrorHint, runSubsetCopy, runViewHeading, chartHeading, plainAnalysisError, savedRunCopy, resumeRunLabel } from './format'

describe('rail meta line', () => {
  it('keeps one compact play_id · qtr · class-or-percent line', () => {
    expect(railMetaLine({
      rowIndex: 0,
      input: { play_id: 57, qtr: 1, wpa: 0.91, message: 'hello' },
      model: 'jev',
      selectedClass: 'K.Walker',
    }, 'bars')).toBe('57 · Q1 · K.Walker')
    expect(railMetaLine({
      rowIndex: 2,
      input: { play_id: 184, qtr: 2, wpa: 0.4 },
      model: 'jev',
      questionKind: 'noul',
      value: 0.42,
    }, 'series')).toBe('184 · Q2 · 42%')
  })

  it('falls back to a short native field instead of dumping the row', () => {
    expect(railMetaLine({
      rowIndex: 0,
      input: { message: 'hello', tier: 'gold' },
      model: 'jev',
      selectedClass: 'gold',
    }, 'bars')).toBe('hello · gold')
  })
})

describe('run view copy', () => {
  it('uses Results for the panel and chart labels for the plot', () => {
    expect(runViewHeading()).toBe('Results')
    expect(chartHeading('noul')).toBe('Win probability')
    expect(chartHeading('score')).toBe('Score')
    expect(chartHeading('choice')).toBe('Class distribution')
  })

  it('humanizes retryable vs stopped run errors', () => {
    expect(runErrorHint(true)).toBe('You can try again.')
    expect(runErrorHint(false)).toBe('This run stopped.')
    expect(plainAnalysisError('JEV_MALFORMED_RESPONSE')).toMatch(/could not use/i)
    expect(plainAnalysisError('JEV_MALFORMED_RESPONSE')).not.toMatch(/JEV_MALFORMED_RESPONSE/)
    expect(runErrorCopy({ code: 'JEV_MALFORMED_RESPONSE', retryable: false }, 31)).toEqual({
      title: "Couldn't finish this run",
      detail: 'Jev returned a response this run could not use. Saved rows are kept. You can resume from row 32.',
    })
    expect(resumeRunLabel(31)).toBe('Resume from row 32')
    expect(savedRunCopy()).toMatch(/share copies a public link/i)
  })

  it('explains fixture H1 subset runs without changing the 39 vs 71 split', () => {
    expect(runSubsetCopy({ analyzedRows: 39, datasetRows: 71, sourceType: 'fixture', inputHalf: 'H1' })).toBe('Analyzing H1 plays (39 of 71)')
    expect(runSubsetCopy({ analyzedRows: 39, sourceType: 'fixture', tense: 'analyzed' })).toBe('Analyzed H1 plays (39 of 71)')
    expect(runSubsetCopy({ analyzedRows: 71, datasetRows: 71, sourceType: 'fixture' })).toBeUndefined()
    expect(runSubsetCopy({ analyzedRows: 10, datasetRows: 40, sourceType: 'upload' })).toBe('Analyzing a subset (10 of 40 rows)')
  })
})
