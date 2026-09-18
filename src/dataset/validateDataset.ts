import {
  CSV_PREVIEW_ROWS,
  DatasetError,
  type AnalysisRowInput,
  type DatasetColumn,
  type DatasetColumnType,
  type ParsedCsv,
  type ValidatedDataset,
} from './csvTypes.js'
import { parseCsvBytes, parseCsvText } from './parseCsv.js'

const normalizeName = (name: string): string => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'column'

const inferType = (values: string[]): DatasetColumnType => {
  let sawValue = false
  let numberCount = 0
  let booleanCount = 0
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    sawValue = true
    if (/^(true|false|yes|no)$/i.test(trimmed)) {
      booleanCount += 1
      continue
    }
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
      numberCount += 1
      continue
    }
    return 'string'
  }
  if (!sawValue) return 'empty'
  if (booleanCount && !numberCount) return 'boolean'
  if (numberCount && !booleanCount) return 'number'
  return 'string'
}

const coerceValue = (value: string, type: DatasetColumnType): string | number | boolean | null => {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (type === 'number') {
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : trimmed
  }
  if (type === 'boolean') {
    if (/^(true|yes)$/i.test(trimmed)) return true
    if (/^(false|no)$/i.test(trimmed)) return false
  }
  return value
}

export const toValidatedDataset = (parsed: ParsedCsv, warnings: string[] = []): ValidatedDataset => {
  const columns: DatasetColumn[] = parsed.header.map((name, index) => ({
    name,
    normalizedName: normalizeName(name),
    inferredType: inferType(parsed.rows.map((row) => row[index] ?? '')),
  }))
  const rows: AnalysisRowInput[] = parsed.rows.map((cells) => {
    const row: AnalysisRowInput = {}
    for (let index = 0; index < columns.length; index += 1) {
      row[columns[index].name] = coerceValue(cells[index] ?? '', columns[index].inferredType)
    }
    return row
  })
  return {
    delimiter: parsed.delimiter,
    encoding: 'utf-8',
    byteSize: parsed.byteSize,
    columns,
    acceptedRowCount: rows.length,
    rows,
    previewRows: rows.slice(0, CSV_PREVIEW_ROWS),
    validationWarnings: warnings,
  }
}

export const validateCsvBytes = (bytes: Uint8Array): ValidatedDataset => toValidatedDataset(parseCsvBytes(bytes))
export const validateCsvText = (text: string): ValidatedDataset => toValidatedDataset(parseCsvText(text))

export const sniffCsvContentType = (contentType: string | undefined, bytes: Uint8Array): void => {
  const normalized = contentType?.split(';')[0]?.trim().toLowerCase()
  if (!normalized) return
  const allowed = new Set(['text/csv', 'text/plain', 'application/csv', 'application/vnd.ms-excel', 'application/octet-stream'])
  if (!allowed.has(normalized)) throw new DatasetError('NOT_CSV', 'That does not look like a CSV.')
  void bytes
}
