import { describe, expect, it } from 'vitest'
import type { AnalysisResultRow } from '../shared/analysis'
import { areaPath, jevSeriesPoints, linePath, seriesX } from './seriesPath'

const row = (rowIndex: number, value: number | undefined, wpa = 0.88): AnalysisResultRow => ({
  rowIndex,
  input: { play_id: rowIndex, wpa },
  model: 'jev-latest',
  ...(value === undefined ? {} : { value }),
})

describe('Jev series path', () => {
  it('places points on play index 0-1 and ignores CSV wpa', () => {
    expect(seriesX(0, 39)).toBe(0)
    expect(seriesX(38, 39)).toBe(1)
    const points = jevSeriesPoints([
      row(0, 0.4, 0.99),
      row(1, undefined, 0.5),
      row(2, 0.7, 0.01),
    ], 3, 39)
    expect(points).toEqual([
      { x: 0, yValue: 0.4, rowIndex: 0 },
      { x: 2 / 38, yValue: 0.7, rowIndex: 2 },
    ])
    expect(points.every((point) => point.yValue !== 0.99 && point.yValue !== 0.5 && point.yValue !== 0.01)).toBe(true)
  })

  it('builds a left-to-right area and line that grow with persisted Jev values', () => {
    const points = jevSeriesPoints([row(0, 0.2), row(1, 0.8)], 2, 3)
    expect(linePath(points)).toBe('M0 0.8 L0.5 0.2')
    expect(areaPath(points)).toBe('M0 0.8 L0.5 0.2 L0.5 1 L0 1 Z')
    expect(jevSeriesPoints([row(0, 0.2), row(1, 0.8)], 1, 3)).toHaveLength(1)
  })
})
