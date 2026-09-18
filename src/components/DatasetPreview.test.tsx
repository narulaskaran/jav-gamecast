import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DatasetPreviewCard, previewRowCapCopy } from './DatasetPreview'
import type { DatasetPreview } from '../shared/dataset'

const preview = (overrides: Partial<DatasetPreview> = {}): DatasetPreview => ({
  datasetId: 'dataset-1',
  sourceType: 'upload',
  displayName: 'wide.csv',
  byteSize: 32,
  contentHash: 'abc',
  encoding: 'utf-8',
  delimiter: ',',
  columns: [
    { name: 'play_id', normalizedName: 'play_id', inferredType: 'number' },
    { name: 'qtr', normalizedName: 'qtr', inferredType: 'number' },
    { name: 'posteam', normalizedName: 'posteam', inferredType: 'string' },
    { name: 'defteam', normalizedName: 'defteam', inferredType: 'string' },
    { name: 'wpa', normalizedName: 'wpa', inferredType: 'number' },
    { name: 'epa', normalizedName: 'epa', inferredType: 'number' },
    { name: 'fumble', normalizedName: 'fumble', inferredType: 'number' },
  ],
  acceptedRowCount: 71,
  previewRows: Array.from({ length: 8 }, (_, index) => ({
    play_id: index + 1,
    qtr: 1,
    posteam: 'SEA',
    defteam: 'NE',
    wpa: 0.1,
    epa: 0.2,
    fumble: 0,
  })),
  validationWarnings: [],
  publicDataWarning: 'public',
  ...overrides,
})

describe('preview row cap copy', () => {
  it('names the loaded preview rows when the dataset is larger', () => {
    expect(previewRowCapCopy(8, 71)).toBe('Showing first 8 of 71')
    expect(previewRowCapCopy(2, 2)).toBeUndefined()
    expect(previewRowCapCopy(0, 10)).toBeUndefined()
  })
})

describe('DatasetPreviewCard', () => {
  it('renders every column and the loaded preview rows in a scroll box', () => {
    const dataset = preview()
    render(<DatasetPreviewCard dataset={dataset} />)
    const table = screen.getByRole('table', { name: /dataset preview/i })
    const headers = within(table).getAllByRole('columnheader').map((node) => node.textContent)
    expect(headers).toEqual(dataset.columns.map((column) => column.name))
    expect(headers).toContain('fumble')
    expect(headers.length).toBeGreaterThan(6)
    expect(within(table).getAllByRole('row')).toHaveLength(1 + dataset.previewRows.length)
    expect(screen.getByText(/7 columns · showing first 8 of 71/i)).toBeInTheDocument()
    expect(document.querySelector('.preview-table')).toBeTruthy()
    expect(table.querySelectorAll('th.is-sticky, td.is-sticky').length).toBe(1 + dataset.previewRows.length)
  })

  it('does not claim a row cap when the preview is the whole dataset', () => {
    render(<DatasetPreviewCard dataset={preview({
      acceptedRowCount: 2,
      previewRows: [{ play_id: 1, qtr: 1 }, { play_id: 2, qtr: 1 }],
    })} />)
    expect(screen.getByText(/^7 columns$/)).toBeInTheDocument()
    expect(screen.queryByText(/showing first/i)).not.toBeInTheDocument()
  })
})
