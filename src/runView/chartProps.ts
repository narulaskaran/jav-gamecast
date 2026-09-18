import type { AnalysisResultRow } from '../shared/analysis'
import type { PlayheadMotion } from './playhead'

export const barWidth = (count: number, scale: number): string => {
  if (count <= 0 || scale <= 0) return '0%'
  return `${(count / scale) * 100}%`
}

export const sameStringList = (left: readonly string[] = [], right: readonly string[] = []): boolean => (
  left === right || (left.length === right.length && left.every((value, index) => value === right[index]))
)

type ChartVisual = {
  rows: readonly AnalysisResultRow[]
  playheadIndex: number
  classes?: readonly string[]
  totalRows?: number
  motion?: PlayheadMotion
}

export const areChartPropsEqual = (prev: ChartVisual, next: ChartVisual): boolean => (
  prev.playheadIndex === next.playheadIndex
  && prev.motion === next.motion
  && prev.totalRows === next.totalRows
  && prev.rows.length === next.rows.length
  && sameStringList(prev.classes, next.classes)
  && prev.rows[prev.playheadIndex]?.selectedClass === next.rows[next.playheadIndex]?.selectedClass
  && prev.rows[prev.rows.length - 1]?.rowIndex === next.rows[next.rows.length - 1]?.rowIndex
)

type RailVisual = {
  rows: readonly AnalysisResultRow[]
  playheadIndex: number
  totalRows: number
  classes?: readonly string[]
}

export const areRailPropsEqual = (prev: RailVisual, next: RailVisual): boolean => (
  prev.playheadIndex === next.playheadIndex
  && prev.totalRows === next.totalRows
  && prev.rows.length === next.rows.length
  && sameStringList(prev.classes, next.classes)
  && prev.rows[prev.playheadIndex]?.selectedClass === next.rows[next.playheadIndex]?.selectedClass
  && prev.rows[prev.rows.length - 1]?.rowIndex === next.rows[next.rows.length - 1]?.rowIndex
)
