import { describe, expect, it } from 'vitest'
import { areChartPropsEqual, areRailPropsEqual, barWidth } from './chartProps'
import type { AnalysisResultRow } from '../shared/analysis'

const row = (rowIndex: number, selectedClass: string): AnalysisResultRow => ({
  rowIndex,
  input: { message: 'x' },
  model: 'jev',
  selectedClass,
})

describe('chart visual compare', () => {
  it('scales bars against a fixed total so only the changed class grows', () => {
    expect(barWidth(0, 10)).toBe('0%')
    expect(barWidth(1, 10)).toBe('10%')
    expect(barWidth(2, 10)).toBe('20%')
  })

  it('treats a new array with the same prefix as visually equal', () => {
    const rows = [row(0, 'gold')]
    const prev = { rows, playheadIndex: 0, classes: ['gold', 'silver'], totalRows: 10, motion: 'tick' as const }
    const next = { ...prev, rows: [...rows] }
    expect(areChartPropsEqual(prev, next)).toBe(true)
    expect(areChartPropsEqual(prev, { ...next, rows: [...rows, row(1, 'gold')], playheadIndex: 1 })).toBe(false)
  })

  it('lets the rail skip when only the snapshot object identity changed', () => {
    const rows = [row(0, 'gold'), row(1, 'silver')]
    const prev = { rows, playheadIndex: 1, totalRows: 10, classes: ['gold', 'silver'] }
    expect(areRailPropsEqual(prev, { ...prev, rows: [...rows] })).toBe(true)
    expect(areRailPropsEqual(prev, { ...prev, playheadIndex: 0 })).toBe(false)
  })
})
