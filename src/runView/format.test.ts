import { describe, expect, it } from 'vitest'
import { railMetaLine, runErrorHint, runViewHeading } from './format'

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
  it('uses chart labels instead of Jev analysis run', () => {
    expect(runViewHeading('noul')).toBe('Win probability')
    expect(runViewHeading('score')).toBe('Score')
    expect(runViewHeading('choice')).toBe('Class distribution')
  })

  it('humanizes retryable vs stopped run errors', () => {
    expect(runErrorHint(true)).toBe('You can try again.')
    expect(runErrorHint(false)).toBe('This run stopped.')
  })
})
