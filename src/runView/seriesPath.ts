import type { AnalysisResultRow } from '../shared/analysis'
import { clamp01, seriesValueFromRow } from '../shared/questionKind'

export const seriesX = (rowIndex: number, totalRows: number): number => {
  const denom = Math.max(1, totalRows - 1)
  return clamp01(rowIndex / denom)
}

export const seriesY = (value: number): number => 1 - clamp01(value)

export interface SeriesPoint {
  x: number
  yValue: number
  rowIndex: number
}

export const jevSeriesPoints = (
  rows: readonly AnalysisResultRow[],
  prefixCount: number,
  totalRows: number,
): SeriesPoint[] => {
  const prefix = rows.slice(0, Math.max(0, prefixCount))
  const points: SeriesPoint[] = []
  for (const row of prefix) {
    const yValue = seriesValueFromRow(row)
    if (yValue === undefined) continue
    points.push({ x: seriesX(row.rowIndex, Math.max(totalRows, rows.length, 1)), yValue, rowIndex: row.rowIndex })
  }
  return points
}

const coord = (value: number): string => String(Math.round(value * 1e6) / 1e6)

export const linePath = (points: readonly SeriesPoint[]): string => {
  if (points.length === 0) return ''
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${coord(point.x)} ${coord(seriesY(point.yValue))}`).join(' ')
}

export const areaPath = (points: readonly SeriesPoint[]): string => {
  if (points.length === 0) return ''
  const last = points[points.length - 1]
  const first = points[0]
  return `${linePath(points)} L${coord(last.x)} 1 L${coord(first.x)} 1 Z`
}

export const formatPercentTick = (value: number): string => `${Math.round(clamp01(value) * 100)}%`
