import {
  CSV_MAX_BYTES,
  CSV_MAX_CELL_LENGTH,
  CSV_MAX_COLUMNS,
  CSV_MAX_HEADER_LENGTH,
  CSV_MAX_ROWS,
  DatasetError,
  type ParsedCsv,
} from './csvTypes.js'

const UTF8_BOM = '\uFEFF'
const DELIMITERS = [',', '\t', ';', '|'] as const

const looksLikeHtml = (text: string): boolean => /^\s*<(!doctype\s+html|html|head|body|script|div)\b/i.test(text)
const looksBinary = (bytes: Uint8Array): boolean => {
  const sample = bytes.subarray(0, Math.min(bytes.length, 512))
  if (sample.length >= 2 && sample[0] === 0x1f && sample[1] === 0x8b) return true
  if (sample.length >= 4 && sample[0] === 0x25 && sample[1] === 0x50 && sample[2] === 0x44 && sample[3] === 0x46) return true
  let nul = 0
  for (const byte of sample) if (byte === 0) nul += 1
  return nul > 2
}

export const decodeUtf8Csv = (bytes: Uint8Array): string => {
  if (bytes.byteLength > CSV_MAX_BYTES) throw new DatasetError('CSV_TOO_LARGE', 'CSV exceeds the 5 MB size limit', 413)
  if (looksBinary(bytes)) throw new DatasetError('NOT_CSV', 'Content is not a CSV')
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (text.includes('\u0000')) throw new DatasetError('NOT_CSV', 'Content is not a CSV')
    if (looksLikeHtml(text)) throw new DatasetError('NOT_CSV', 'Content is not a CSV')
    return text.startsWith(UTF8_BOM) ? text.slice(1) : text
  } catch (error) {
    if (error instanceof DatasetError) throw error
    throw new DatasetError('NOT_CSV', 'CSV must be valid UTF-8')
  }
}

const firstPhysicalLine = (text: string): string => {
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '\n' || char === '\r') return text.slice(0, index)
  }
  return text
}

/** Excel/pandas-style: quotes open a field only at field start; unclosed quotes close at EOL/EOF. */
const parseLine = (line: string, delimiter: string): string[] => {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  let fieldStart = true
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"'
          index += 1
          continue
        }
        inQuotes = false
        fieldStart = false
        continue
      }
      current += char
      continue
    }
    if (fieldStart && char === '"') {
      inQuotes = true
      fieldStart = false
      continue
    }
    if (char === delimiter) {
      cells.push(current)
      current = ''
      fieldStart = true
      inQuotes = false
      continue
    }
    current += char
    fieldStart = false
  }
  cells.push(current)
  return cells
}

const parseRecords = (text: string, delimiter: string): string[][] => {
  const records: string[][] = []
  let cells: string[] = []
  let current = ''
  let inQuotes = false
  let fieldStart = true
  const endField = () => {
    cells.push(current)
    current = ''
    fieldStart = true
    inQuotes = false
  }
  const endRecord = () => {
    endField()
    records.push(cells)
    cells = []
  }
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          current += '"'
          index += 1
          continue
        }
        inQuotes = false
        fieldStart = false
        continue
      }
      current += char
      continue
    }
    if (fieldStart && char === '"') {
      inQuotes = true
      fieldStart = false
      continue
    }
    if (char === delimiter) {
      endField()
      continue
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      endRecord()
      continue
    }
    current += char
    fieldStart = false
  }
  if (current.length > 0 || cells.length > 0 || text.endsWith('\n') || text.endsWith('\r')) endRecord()
  return records
}

const detectDelimiter = (headerLine: string): string => {
  let best: { delimiter: string; count: number } | undefined
  for (const delimiter of DELIMITERS) {
    const count = Math.max(0, parseLine(headerLine, delimiter).length - 1)
    if (!best || count > best.count) best = { delimiter, count }
  }
  return best && best.count > 0 ? best.delimiter : ','
}

const tidyHeaderCell = (name: string): string => {
  let cell = name.trim()
  if (cell.length >= 2 && cell.startsWith('"') && cell.endsWith('"')) cell = cell.slice(1, -1).trim()
  if (cell.endsWith('"') && !cell.includes('"'.repeat(2)) && cell.indexOf('"') === cell.length - 1) {
    cell = cell.slice(0, -1).trim()
  }
  return cell
}

export const parseCsvText = (text: string, byteSize = new TextEncoder().encode(text).byteLength): ParsedCsv => {
  if (byteSize > CSV_MAX_BYTES) throw new DatasetError('CSV_TOO_LARGE', 'CSV exceeds the 5 MB size limit', 413)
  const normalized = text.startsWith(UTF8_BOM) ? text.slice(1) : text
  if (!normalized.trim()) throw new DatasetError('CSV_EMPTY', 'The CSV has no data rows')
  if (looksLikeHtml(normalized) || normalized.includes('\u0000')) throw new DatasetError('NOT_CSV', 'Content is not a CSV')
  const delimiter = detectDelimiter(firstPhysicalLine(normalized))
  const records = parseRecords(normalized, delimiter).filter((record, index, all) => {
    const empty = record.length === 0 || record.every((cell) => cell.length === 0)
    return !empty || index < all.length - 1
  })
  const nonempty = records.filter((record) => record.some((cell) => cell.trim().length > 0))
  if (nonempty.length === 0) throw new DatasetError('CSV_EMPTY', 'The CSV has no data rows')
  const header = nonempty[0].map(tidyHeaderCell)
  if (header.length === 0 || header.every((cell) => cell.length === 0)) throw new DatasetError('CSV_INVALID_HEADER', 'The CSV header is missing')
  if (header.length > CSV_MAX_COLUMNS) throw new DatasetError('CSV_TOO_MANY_COLUMNS', 'CSV exceeds the column limit', 413)
  if (header.some((cell) => cell.length === 0 || cell.length > CSV_MAX_HEADER_LENGTH)) throw new DatasetError('CSV_INVALID_HEADER', 'The CSV header is missing, duplicated, or invalid')
  const seen = new Set<string>()
  for (const name of header) {
    const key = name.toLowerCase()
    if (seen.has(key)) throw new DatasetError('CSV_INVALID_HEADER', 'The CSV header is missing, duplicated, or invalid')
    seen.add(key)
  }
  const rows: string[][] = []
  for (const record of nonempty.slice(1)) {
    if (rows.length >= CSV_MAX_ROWS) throw new DatasetError('CSV_TOO_MANY_ROWS', 'CSV exceeds the 5,000 row limit', 413)
    if (record.length > CSV_MAX_COLUMNS) throw new DatasetError('CSV_TOO_MANY_COLUMNS', 'CSV exceeds the column limit', 413)
    if (record.some((cell) => cell.length > CSV_MAX_CELL_LENGTH)) throw new DatasetError('CSV_PARSE_FAILED', 'A CSV cell exceeds the length limit', 413)
    const padded = header.map((_, index) => record[index] ?? '')
    rows.push(padded)
  }
  if (rows.length === 0) throw new DatasetError('CSV_EMPTY', 'The CSV has no data rows')
  return { delimiter, encoding: 'utf-8', byteSize, header, rows }
}

export const parseCsvBytes = (bytes: Uint8Array): ParsedCsv => parseCsvText(decodeUtf8Csv(bytes), bytes.byteLength)
