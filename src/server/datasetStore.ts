import { createHash, randomUUID } from 'node:crypto'
import type { AnalysisRowInput } from '../shared/analysis.js'
import type { DatasetPreview, DatasetRecord, DatasetSourceType } from '../shared/dataset.js'
import { PUBLIC_DATA_WARNING } from '../dataset/csvTypes.js'
import type { ValidatedDataset } from '../dataset/csvTypes.js'
import type { AnalysisDatasetSource, ResolvedAnalysisDataset } from './analysis.js'

export interface DatasetStorage {
  get(datasetId: string): Promise<DatasetRecord | undefined> | DatasetRecord | undefined
  put(dataset: DatasetRecord, rows: readonly AnalysisRowInput[]): Promise<void> | void
  getRows(datasetId: string): Promise<readonly AnalysisRowInput[]> | readonly AnalysisRowInput[]
  listPublic?(): Promise<readonly DatasetRecord[]> | readonly DatasetRecord[]
}

export class InMemoryDatasetStore implements DatasetStorage {
  private readonly datasets = new Map<string, DatasetRecord>()
  private readonly rows = new Map<string, AnalysisRowInput[]>()

  get(datasetId: string): DatasetRecord | undefined {
    const dataset = this.datasets.get(datasetId)
    return dataset ? cloneDataset(dataset) : undefined
  }

  put(dataset: DatasetRecord, rows: readonly AnalysisRowInput[]): void {
    this.datasets.set(dataset.datasetId, cloneDataset(dataset))
    this.rows.set(dataset.datasetId, rows.map((row) => ({ ...row })))
  }

  getRows(datasetId: string): readonly AnalysisRowInput[] {
    return (this.rows.get(datasetId) ?? []).map((row) => ({ ...row }))
  }

  listPublic(): DatasetRecord[] {
    return [...this.datasets.values()].map((dataset) => cloneDataset(dataset))
  }
}

const cloneDataset = (dataset: DatasetRecord): DatasetRecord => ({
  ...dataset,
  columns: dataset.columns.map((column) => ({ ...column })),
  previewRows: dataset.previewRows.map((row) => ({ ...row })),
  validationWarnings: [...dataset.validationWarnings],
})

export const analysisSourceFromDatasetStore = (store: DatasetStorage): AnalysisDatasetSource => ({
  async get(datasetId: string): Promise<ResolvedAnalysisDataset | undefined> {
    const dataset = await store.get(datasetId)
    if (!dataset) return undefined
    const rows = await store.getRows(datasetId)
    return {
      datasetId: dataset.datasetId,
      fixtureId: dataset.datasetId,
      sourceType: dataset.sourceType,
      displayName: dataset.displayName,
      columns: dataset.columns.map((column) => column.name),
      rows,
    }
  },
})

export const hashBytes = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

export const hashRow = (row: AnalysisRowInput): string => createHash('sha256').update(JSON.stringify(row)).digest('hex')

export const toDatasetRecord = (input: {
  datasetId?: string
  sourceType: DatasetSourceType
  displayName: string
  validated: ValidatedDataset
  contentHash: string
  blobKey?: string
  sourceUrl?: string
  fixtureKey?: string
  createdAt?: number
}): DatasetRecord => {
  const createdAt = input.createdAt ?? Date.now()
  return {
    datasetId: input.datasetId ?? randomUUID(),
    sourceType: input.sourceType,
    displayName: input.displayName,
    byteSize: input.validated.byteSize,
    contentHash: input.contentHash,
    encoding: 'utf-8',
    delimiter: input.validated.delimiter,
    columns: input.validated.columns,
    acceptedRowCount: input.validated.acceptedRowCount,
    previewRows: input.validated.previewRows,
    validationWarnings: input.validated.validationWarnings,
    publicDataWarning: PUBLIC_DATA_WARNING,
    visibility: 'published',
    createdAt,
    publishedAt: createdAt,
    ...(input.blobKey === undefined ? {} : { blobKey: input.blobKey }),
    ...(input.sourceUrl === undefined ? {} : { sourceUrl: input.sourceUrl }),
    ...(input.fixtureKey === undefined ? {} : { fixtureKey: input.fixtureKey }),
  }
}

export const toDatasetPreview = (dataset: DatasetRecord): DatasetPreview => ({
  datasetId: dataset.datasetId,
  sourceType: dataset.sourceType,
  displayName: dataset.displayName,
  byteSize: dataset.byteSize,
  contentHash: dataset.contentHash,
  encoding: dataset.encoding,
  delimiter: dataset.delimiter,
  columns: dataset.columns,
  acceptedRowCount: dataset.acceptedRowCount,
  previewRows: dataset.previewRows,
  validationWarnings: dataset.validationWarnings,
  publicDataWarning: dataset.publicDataWarning,
  attribution: dataset.attribution,
})
