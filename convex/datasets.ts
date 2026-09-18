import { action, internalMutation, internalQuery, query } from './_generated/server'
import { internal } from './_generated/api'
import { v } from 'convex/values'

const MAX_ROWS = 5_000
const MAX_ID_LENGTH = 200
const MAX_METADATA_JSON = 400_000
const ROW_WRITE_BATCH = 200

const datasetRowValidator = v.object({
  rowIndex: v.number(),
  rowHash: v.string(),
  values: v.any(),
})

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const authorizeWrite = (authToken: string): void => {
  const expected = process.env.CONVEX_WRITE_SECRET?.trim()
  if (!expected || authToken !== expected) throw new Error('Unauthorized dataset mutation')
}

type DurableDataset = {
  datasetId: string
  sourceType: 'fixture' | 'upload' | 'public_url'
  displayName: string
  fixtureKey?: string
  blobKey?: string
  sourceUrl?: string
  byteSize: number
  contentHash: string
  encoding: string
  delimiter: string
  columns: Array<{ name: string; normalizedName: string; inferredType: string }>
  acceptedRowCount: number
  previewRows: unknown[]
  validationWarnings: string[]
  visibility: 'published'
  createdAt: number
  publishedAt?: number
  rows: Array<{ rowIndex: number; rowHash: string; values: unknown }>
}

function validateDatasetMeta(value: unknown): asserts value is Omit<DurableDataset, 'rows'> {
  if (!isRecord(value) || typeof value.datasetId !== 'string' || value.datasetId.length < 1 || value.datasetId.length > MAX_ID_LENGTH) throw new Error('Invalid dataset')
  if (!['fixture', 'upload', 'public_url'].includes(value.sourceType as string)) throw new Error('Invalid dataset source')
  if (typeof value.displayName !== 'string' || value.displayName.length < 1 || value.displayName.length > 200) throw new Error('Invalid dataset name')
  if (typeof value.byteSize !== 'number' || value.byteSize < 0 || typeof value.contentHash !== 'string' || !value.contentHash) throw new Error('Invalid dataset hash')
  if (typeof value.encoding !== 'string' || typeof value.delimiter !== 'string') throw new Error('Invalid dataset encoding')
  if (!Array.isArray(value.columns) || value.columns.length < 1 || value.columns.length > 100) throw new Error('Invalid dataset columns')
  if (typeof value.acceptedRowCount !== 'number' || !Number.isInteger(value.acceptedRowCount) || value.acceptedRowCount < 1 || value.acceptedRowCount > MAX_ROWS) throw new Error('Invalid dataset row count')
  if (!Array.isArray(value.previewRows) || value.previewRows.length > 16) throw new Error('Invalid dataset preview')
  if (!Array.isArray(value.validationWarnings)) throw new Error('Invalid dataset warnings')
  if (value.visibility !== 'published' || typeof value.createdAt !== 'number') throw new Error('Invalid dataset visibility')
  const { rows: _ignoredRows, publicDataWarning: _ignoredWarning, attribution: _ignoredAttribution, ...meta } = value
  if (JSON.stringify(meta).length > MAX_METADATA_JSON) throw new Error('Dataset metadata is too large')
}

function validateDataset(value: unknown): asserts value is DurableDataset {
  if (!isRecord(value)) throw new Error('Invalid dataset')
  const rows = value.rows
  validateDatasetMeta(value)
  if (!Array.isArray(rows) || rows.length !== value.acceptedRowCount || rows.length > MAX_ROWS) throw new Error('Invalid dataset rows')
}

const datasetDocument = (dataset: Omit<DurableDataset, 'rows'>) => ({
  datasetId: dataset.datasetId,
  sourceType: dataset.sourceType,
  displayName: dataset.displayName,
  ...(dataset.fixtureKey === undefined ? {} : { fixtureKey: dataset.fixtureKey }),
  ...(dataset.blobKey === undefined ? {} : { blobKey: dataset.blobKey }),
  ...(dataset.sourceUrl === undefined ? {} : { sourceUrl: dataset.sourceUrl }),
  byteSize: dataset.byteSize,
  contentHash: dataset.contentHash,
  encoding: dataset.encoding,
  delimiter: dataset.delimiter,
  columns: dataset.columns,
  acceptedRowCount: dataset.acceptedRowCount,
  previewRows: dataset.previewRows,
  validationWarnings: dataset.validationWarnings,
  visibility: 'published' as const,
  createdAt: dataset.createdAt,
  ...(dataset.publishedAt === undefined ? {} : { publishedAt: dataset.publishedAt }),
})

const optionalField = (key: string, value: unknown): Record<string, unknown> => (
  value === undefined ? {} : { [key]: value }
)

const publicDataset = (document: Record<string, unknown>) => ({
  datasetId: document.datasetId,
  sourceType: document.sourceType,
  displayName: document.displayName,
  ...optionalField('fixtureKey', document.fixtureKey),
  ...optionalField('blobKey', document.blobKey),
  ...optionalField('sourceUrl', document.sourceUrl),
  byteSize: document.byteSize,
  contentHash: document.contentHash,
  encoding: document.encoding,
  delimiter: document.delimiter,
  columns: document.columns,
  acceptedRowCount: document.acceptedRowCount,
  previewRows: document.previewRows,
  validationWarnings: document.validationWarnings,
  visibility: document.visibility,
  createdAt: document.createdAt,
  ...optionalField('publishedAt', document.publishedAt),
  publicDataWarning: 'This playground publishes datasets and results. Do not upload secrets or personal data.',
})

const findDataset = async (ctx: { db: any }, datasetId: string) => await ctx.db.query('datasets').withIndex('by_dataset_id', (q: any) => q.eq('datasetId', datasetId)).unique()

export const getDatasetInternal = internalQuery({
  args: { datasetId: v.string() },
  handler: async (ctx, { datasetId }) => {
    const document = await findDataset(ctx, datasetId)
    if (!document) return null
    const { _id: _ignoredId, _creationTime: _ignoredCreationTime, ...safe } = document
    return publicDataset(safe)
  },
})

export const getDatasetRowsInternal = internalQuery({
  args: { datasetId: v.string() },
  handler: async (ctx, { datasetId }) => {
    const rows = await ctx.db.query('datasetRows').withIndex('by_dataset_row', (q: any) => q.eq('datasetId', datasetId)).order('asc').take(MAX_ROWS)
    return rows.map((row: Record<string, unknown>) => row.values)
  },
})

export const listPublicDatasets = query({
  args: {},
  handler: async (ctx) => {
    const documents = await ctx.db.query('datasets').take(48)
    return documents.map((document) => ({
      datasetId: document.datasetId,
      displayName: document.displayName,
      sourceType: document.sourceType,
      acceptedRowCount: document.acceptedRowCount,
      createdAt: document.createdAt,
    }))
  },
})

export const getDatasetSharePreview = query({
  args: { datasetId: v.string() },
  handler: async (ctx, { datasetId }) => {
    const document = await findDataset(ctx, datasetId)
    if (!document) return null
    const { _id: _ignoredId, _creationTime: _ignoredCreationTime, blobKey: _blob, ...safe } = document
    return publicDataset(safe)
  },
})

export const putDatasetMetaInternal = internalMutation({
  args: { dataset: v.any() },
  handler: async (ctx, { dataset }) => {
    validateDatasetMeta(dataset)
    const existing = await findDataset(ctx, dataset.datasetId)
    const document = datasetDocument(dataset)
    if (existing) await ctx.db.replace(existing._id, document)
    else await ctx.db.insert('datasets', document)
    return publicDataset(document)
  },
})

export const replaceDatasetRowsInternal = internalMutation({
  args: { datasetId: v.string(), rows: v.array(datasetRowValidator) },
  handler: async (ctx, { datasetId, rows }) => {
    const currentRows = await ctx.db.query('datasetRows').withIndex('by_dataset_row', (q: any) => q.eq('datasetId', datasetId)).take(MAX_ROWS)
    for (const row of currentRows) await ctx.db.delete(row._id)
    for (const row of rows) {
      await ctx.db.insert('datasetRows', { datasetId, rowIndex: row.rowIndex, rowHash: row.rowHash, values: row.values })
    }
  },
})

export const appendDatasetRowsInternal = internalMutation({
  args: { datasetId: v.string(), rows: v.array(datasetRowValidator) },
  handler: async (ctx, { datasetId, rows }) => {
    for (const row of rows) {
      await ctx.db.insert('datasetRows', { datasetId, rowIndex: row.rowIndex, rowHash: row.rowHash, values: row.values })
    }
  },
})

export const authorizedGetDataset = action({
  args: { authToken: v.string(), datasetId: v.string() },
  handler: async (ctx: any, { authToken, datasetId }: { authToken: string; datasetId: string }): Promise<unknown> => {
    authorizeWrite(authToken)
    return await ctx.runQuery(internal.datasets.getDatasetInternal, { datasetId })
  },
})

export const authorizedGetDatasetRows = action({
  args: { authToken: v.string(), datasetId: v.string() },
  handler: async (ctx: any, { authToken, datasetId }: { authToken: string; datasetId: string }): Promise<unknown> => {
    authorizeWrite(authToken)
    return await ctx.runQuery(internal.datasets.getDatasetRowsInternal, { datasetId })
  },
})

export const authorizedPutDataset = action({
  args: {
    authToken: v.string(),
    dataset: v.any(),
    rows: v.array(datasetRowValidator),
  },
  handler: async (ctx: any, { authToken, dataset, rows }: { authToken: string; dataset: unknown; rows: Array<{ rowIndex: number; rowHash: string; values: unknown }> }): Promise<unknown> => {
    authorizeWrite(authToken)
    if (!isRecord(dataset)) throw new Error('Invalid dataset')
    validateDataset({ ...dataset, rows })
    const datasetId = dataset.datasetId
    if (typeof datasetId !== 'string') throw new Error('Invalid dataset')
    try {
      const stored = await ctx.runMutation(internal.datasets.putDatasetMetaInternal, { dataset })
      for (let offset = 0; offset < rows.length; offset += ROW_WRITE_BATCH) {
        const batch = rows.slice(offset, offset + ROW_WRITE_BATCH)
        if (offset === 0) {
          await ctx.runMutation(internal.datasets.replaceDatasetRowsInternal, { datasetId, rows: batch })
        } else {
          await ctx.runMutation(internal.datasets.appendDatasetRowsInternal, { datasetId, rows: batch })
        }
      }
      return stored
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown'
      if (/unauthorized/i.test(detail)) throw error
      throw new Error(`dataset put failed: ${detail.slice(0, 180)}`)
    }
  },
})
