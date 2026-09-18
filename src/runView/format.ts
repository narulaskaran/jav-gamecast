import type { AnalysisResultRow } from '../shared/analysis'
import type { ChartVisualKind, JevQuestionKind } from '../shared/questionKind'

export const runViewHeading = (): string => 'Results'

export const chartHeading = (kind: JevQuestionKind): string => {
  if (kind === 'noul') return 'Win probability'
  if (kind === 'score') return 'Score'
  return 'Class distribution'
}

export const runErrorHint = (retryable: boolean): string => (
  retryable ? 'You can try again.' : 'This run stopped.'
)

export const percent = (value: number | undefined): string => (
  value === undefined ? '—' : `${Math.round(value * 100)}%`
)

export const cell = (value: unknown): string => (
  value === null || value === undefined || value === '' ? '—' : String(value)
)

const SKIP_META_KEYS = new Set(['wpa', 'epa', 'game_id', 'game_date'])

const isCompact = (value: unknown): value is string | number => {
  if (typeof value === 'number' && Number.isFinite(value)) return true
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 && trimmed.length <= 24
  }
  return false
}

export const railMetaLine = (row: AnalysisResultRow, chartKind: ChartVisualKind = 'bars'): string => {
  const parts: string[] = []
  const playId = row.input.play_id
  const qtr = row.input.qtr
  if (isCompact(playId)) parts.push(String(playId))
  if (isCompact(qtr)) parts.push(`Q${qtr}`)
  if (parts.length === 0) {
    for (const [key, value] of Object.entries(row.input)) {
      if (SKIP_META_KEYS.has(key) || !isCompact(value)) continue
      parts.push(String(value).trim())
      break
    }
  }
  if (chartKind === 'series' && row.value !== undefined) parts.push(percent(row.value))
  else if (row.selectedClass) parts.push(row.selectedClass)
  else if (row.value !== undefined) parts.push(percent(row.value))
  return parts.join(' · ')
}
