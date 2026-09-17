import { action, internalMutation, internalQuery, query } from './_generated/server'
import { internal } from './_generated/api'
import { v } from 'convex/values'

const MAX_ROWS = 5_000
const MAX_ID_LENGTH = 200

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

function validateDataset(value: unknown): asserts value is DurableDataset {
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
  if (!Array.isArray(value.rows) || value.rows.length !== value.acceptedRowCount || value.rows.length > MAX_ROWS) throw new Error('Invalid dataset rows')
  if (JSON.stringify(value).length > 1_500_000) throw new Error('Dataset is too large')
}

const publicDataset = (document: Record<string, unknown>, previewOnly = true) => ({
  datasetId: document.datasetId,
  sourceType: document.sourceType,
  displayName: document.displayName,
  fixtureKey: document.fixtureKey,
  blobKey: document.blobKey,
  sourceUrl: document.sourceUrl,
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
  publishedAt: document.publishedAt,
  publicDataWarning: 'This playground publishes datasets and results. Do not upload secrets or personal data.',
  ...(previewOnly ? {} : {}),
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

export const putDatasetInternal = internalMutation({
  args: {
    dataset: v.any(),
    rows: v.array(v.object({
      rowIndex: v.number(),
      rowHash: v.string(),
      values: v.any(),
    })),
  },
  handler: async (ctx, { dataset, rows }) => {
    validateDataset({ ...dataset, rows })
    const existing = await findDataset(ctx, dataset.datasetId)
    const document = {
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
    }
    if (existing) await ctx.db.replace(existing._id, document)
    else await ctx.db.insert('datasets', document)
    const currentRows = await ctx.db.query('datasetRows').withIndex('by_dataset_row', (q: any) => q.eq('datasetId', dataset.datasetId)).take(MAX_ROWS)
    for (const row of currentRows) await ctx.db.delete(row._id)
    for (const row of rows) {
      await ctx.db.insert('datasetRows', { datasetId: dataset.datasetId, rowIndex: row.rowIndex, rowHash: row.rowHash, values: row.values })
    }
    return publicDataset(document)
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
    rows: v.array(v.object({
      rowIndex: v.number(),
      rowHash: v.string(),
      values: v.any(),
    })),
  },
  handler: async (ctx: any, { authToken, dataset, rows }: { authToken: string; dataset: unknown; rows: Array<{ rowIndex: number; rowHash: string; values: unknown }> }): Promise<unknown> => {
    authorizeWrite(authToken)
    return await ctx.runMutation(internal.datasets.putDatasetInternal, { dataset, rows })
  },
})
