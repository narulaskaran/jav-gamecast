import type { AnalysisRowInput } from './csvTypes.js'

/** Sample preview is 71×26; BYOD playground preview stays at or under that cell budget. */
export const SAMPLE_PREVIEW_ROWS = 71
export const SAMPLE_PREVIEW_COLUMNS = 26
export const BYOD_PREVIEW_MAX_CELLS = SAMPLE_PREVIEW_ROWS * SAMPLE_PREVIEW_COLUMNS
export const BYOD_PREVIEW_MAX_ROWS = 80
export const PREVIEW_VIRTUALIZE_AFTER = 80
export const PREVIEW_ROW_SIZE = 37
export const PREVIEW_OVERSCAN = 6
export const CLIENT_CSV_PARSE_MAX_BYTES = 256 * 1024
export const INTAKE_CLIENT_TIMEOUT_MS = 30_000

export const boundByodPreviewRowCount = (rowCount: number, columnCount: number): number => {
  const columns = Math.max(1, columnCount)
  const byCells = Math.max(1, Math.floor(BYOD_PREVIEW_MAX_CELLS / columns))
  return Math.min(Math.max(0, rowCount), BYOD_PREVIEW_MAX_ROWS, byCells)
}

export const boundByodPreviewRows = <T extends AnalysisRowInput>(
  rows: readonly T[],
  columnCount: number,
): T[] => rows.slice(0, boundByodPreviewRowCount(rows.length, columnCount))

export const shouldVirtualizePreview = (input: {
  sourceType: 'fixture' | 'upload' | 'public_url'
  rowCount: number
  columnCount?: number
}): boolean => input.sourceType !== 'fixture' && input.rowCount > PREVIEW_VIRTUALIZE_AFTER

export const shouldParseCsvOnClient = (byteSize: number): boolean => (
  byteSize > 0 && byteSize <= CLIENT_CSV_PARSE_MAX_BYTES
)
