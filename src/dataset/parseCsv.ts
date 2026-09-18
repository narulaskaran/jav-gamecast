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

const detectDelimiter = (headerLine: string): string => {
  let best: { delimiter: string; count: number } | undefined
  for (const delimiter of DELIMITERS) {
    let count = 0
    let inQuotes = false
    for (let index = 0; index < headerLine.length; index += 1) {
      const char = headerLine[index]
      if (char === '"') {
        if (inQuotes && headerLine[index + 1] === '"') {
          index += 1
          continue
        }
        inQuotes = !inQuotes
        continue
      }
      if (char === delimiter && !inQuotes) count += 1
    }
    if (!best || count > best.count) best = { delimiter, count }
  }
  return best && best.count > 0 ? best.delimiter : ','
}

const parseLine = (line: string, delimiter: string): string[] => {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"'
        index += 1
        continue
      }
      inQuotes = !inQuotes
      continue
    }
    if (char === delimiter && !inQuotes) {
      cells.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (inQuotes) throw new DatasetError('CSV_PARSE_FAILED', 'The CSV could not be parsed')
  cells.push(current)
  return cells
}

const splitRecords = (text: string): string[] => {
  const records: string[] = []
  let current = ''
  let inQuotes = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') {
      current += char
      if (inQuotes && text[index + 1] === '"') {
        current += text[index + 1]
        index += 1
        continue
      }
      inQuotes = !inQuotes
      continue
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      records.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (inQuotes) throw new DatasetError('CSV_PARSE_FAILED', 'The CSV could not be parsed')
  if (current.length > 0 || text.endsWith('\n') || text.endsWith('\r')) records.push(current)
  return records
}

export const parseCsvText = (text: string, byteSize = new TextEncoder().encode(text).byteLength): ParsedCsv => {
  if (byteSize > CSV_MAX_BYTES) throw new DatasetError('CSV_TOO_LARGE', 'CSV exceeds the 5 MB size limit', 413)
  const normalized = text.startsWith(UTF8_BOM) ? text.slice(1) : text
  if (!normalized.trim()) throw new DatasetError('CSV_EMPTY', 'The CSV has no data rows')
  if (looksLikeHtml(normalized) || normalized.includes('\u0000')) throw new DatasetError('NOT_CSV', 'Content is not a CSV')
  const records = splitRecords(normalized).filter((record, index, all) => record.length > 0 || index < all.length - 1)
  const nonempty = records.filter((record) => record.trim().length > 0)
  if (nonempty.length === 0) throw new DatasetError('CSV_EMPTY', 'The CSV has no data rows')
  const delimiter = detectDelimiter(nonempty[0])
  const header = parseLine(nonempty[0], delimiter).map((cell) => cell.trim())
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
    const cells = parseLine(record, delimiter)
    if (cells.length > CSV_MAX_COLUMNS) throw new DatasetError('CSV_TOO_MANY_COLUMNS', 'CSV exceeds the column limit', 413)
    if (cells.some((cell) => cell.length > CSV_MAX_CELL_LENGTH)) throw new DatasetError('CSV_PARSE_FAILED', 'A CSV cell exceeds the length limit', 413)
    const padded = header.map((_, index) => cells[index] ?? '')
    rows.push(padded)
  }
  if (rows.length === 0) throw new DatasetError('CSV_EMPTY', 'The CSV has no data rows')
  return { delimiter, encoding: 'utf-8', byteSize, header, rows }
}

export const parseCsvBytes = (bytes: Uint8Array): ParsedCsv => parseCsvText(decodeUtf8Csv(bytes), bytes.byteLength)
