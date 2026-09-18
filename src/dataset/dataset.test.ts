import { describe, expect, it } from 'vitest'
import { CSV_MAX_BYTES, CSV_MAX_COLUMNS, CSV_MAX_ROWS, DatasetError } from './csvTypes'
import { parseCsvBytes, parseCsvText } from './parseCsv'
import { validateCsvText } from './validateDataset'
import { assertPublicHttpsCsvUrl, isResolvedAddressSafe } from './urlSafety'
import { classDistribution, distributionAt } from './classDistribution'

const bytes = (text: string) => new TextEncoder().encode(text)

describe('CSV parser and validator', () => {
  it('parses headers, quoted commas, and coerces types', () => {
    const csv = 'label,count,flag\n"urgent, now",2,true\nroutine,1,false\n'
    const parsed = parseCsvText(csv)
    expect(parsed.header).toEqual(['label', 'count', 'flag'])
    expect(parsed.rows[0]).toEqual(['urgent, now', '2', 'true'])
    const validated = validateCsvText(csv)
    expect(validated.columns.map((column) => column.inferredType)).toEqual(['string', 'number', 'boolean'])
    expect(validated.acceptedRowCount).toBe(2)
    expect(validated.rows[0]).toEqual({ label: 'urgent, now', count: 2, flag: true })
  })

  it('rejects oversized, empty, non-CSV, duplicate headers, and over-wide tables', () => {
    expect(() => parseCsvBytes(new Uint8Array(CSV_MAX_BYTES + 1))).toThrow(DatasetError)
    expect(() => parseCsvText('')).toThrowError(/no data rows/i)
    expect(() => parseCsvText('<html><body>not csv</body></html>')).toThrowError(/not a CSV/i)
    expect(() => parseCsvBytes(bytes('\u0000\u0000\u0000binary'))).toThrowError(/not a CSV/i)
    expect(() => parseCsvText('a,a\n1,2')).toThrowError(/header/i)
    const wideHeader = Array.from({ length: CSV_MAX_COLUMNS + 1 }, (_, index) => `c${index}`).join(',')
    expect(() => parseCsvText(`${wideHeader}\n${wideHeader}`)).toThrow(DatasetError)
  })

  it('rejects more than the accepted row cap and unclosed quotes', () => {
    const header = 'id,name'
    const rows = Array.from({ length: CSV_MAX_ROWS + 1 }, (_, index) => `${index},n`)
    expect(() => parseCsvText([header, ...rows].join('\n'))).toThrow(DatasetError)
    expect(() => parseCsvText('a,b\n"unclosed,value')).toThrowError(/could not be parsed/i)
  })

  it('treats client and server text validation as the same parser', () => {
    const csv = 'ticket,tier\nhello,gold\n'
    expect(validateCsvText(csv).acceptedRowCount).toBe(parseCsvText(csv).rows.length)
  })
})

describe('public CSV URL safety', () => {
  it('accepts public HTTPS URLs and rejects credentials, http, and local/private targets', () => {
    expect(assertPublicHttpsCsvUrl('https://example.com/data.csv').hostname).toBe('example.com')
    expect(() => assertPublicHttpsCsvUrl('http://example.com/data.csv')).toThrowError(/not a public HTTPS CSV/i)
    expect(() => assertPublicHttpsCsvUrl('https://user:pass@example.com/data.csv')).toThrowError(/not a public HTTPS CSV/i)
    expect(() => assertPublicHttpsCsvUrl('https://localhost/data.csv')).toThrowError(/not a public HTTPS CSV/i)
    expect(() => assertPublicHttpsCsvUrl('https://127.0.0.1/data.csv')).toThrowError(/not a public HTTPS CSV/i)
    expect(() => assertPublicHttpsCsvUrl('https://10.0.0.8/data.csv')).toThrowError(/not a public HTTPS CSV/i)
    expect(() => assertPublicHttpsCsvUrl('https://192.168.1.9/data.csv')).toThrowError(/not a public HTTPS CSV/i)
    expect(() => assertPublicHttpsCsvUrl('https://169.254.169.254/latest/meta-data')).toThrowError(/not a public HTTPS CSV/i)
    expect(() => assertPublicHttpsCsvUrl('https://[::1]/data.csv')).toThrowError(/not a public HTTPS CSV/i)
    expect(() => assertPublicHttpsCsvUrl('https://metadata.google.internal/computeMetadata')).toThrowError(/not a public HTTPS CSV/i)
    expect(isResolvedAddressSafe('1.1.1.1')).toBe(true)
    expect(isResolvedAddressSafe('172.16.0.4')).toBe(false)
    expect(isResolvedAddressSafe('::1')).toBe(false)
  })
})

describe('running class distribution', () => {
  it('counts selected classes as rows arrive and supports replay prefixes', () => {
    const rows = [
      { selectedClass: 'urgent' },
      { selectedClass: 'routine' },
      { selectedClass: 'urgent' },
    ]
    expect(classDistribution([])).toEqual([])
    expect(classDistribution(rows.slice(0, 1), ['urgent', 'routine'])).toEqual([
      { name: 'urgent', count: 1 },
      { name: 'routine', count: 0 },
    ])
    expect(classDistribution(rows)).toEqual([
      { name: 'urgent', count: 2 },
      { name: 'routine', count: 1 },
    ])
    expect(distributionAt(rows, 2)).toEqual([
      { name: 'routine', count: 1 },
      { name: 'urgent', count: 1 },
    ])
  })
})
