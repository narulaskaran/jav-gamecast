import { action, internalMutation, internalQuery, query } from './_generated/server'
import { internal } from './_generated/api'
import { v } from 'convex/values'

const MAX_ROWS = 5_000
const MAX_CALLS = 5_000
const MAX_ID_LENGTH = 200
const MAX_QUERY_LENGTH = 20_000

const analysisArgs = {
  analysisId: v.string(),
  fixtureId: v.string(),
  datasetId: v.optional(v.string()),
  sourceType: v.optional(v.union(v.literal('fixture'), v.literal('upload'), v.literal('public_url'))),
  query: v.string(),
  status: v.union(v.literal('queued'), v.literal('running'), v.literal('complete'), v.literal('error')),
  createdAt: v.string(),
  updatedAt: v.string(),
  progress: v.object({
    completedRows: v.number(),
    totalRows: v.number(),
    completedCalls: v.number(),
    totalCalls: v.number(),
  }),
  questionKind: v.optional(v.union(v.literal('noul'), v.literal('score'), v.literal('choice'))),
  classes: v.optional(v.array(v.string())),
  columns: v.optional(v.array(v.string())),
  currentFixtureRow: v.optional(v.any()),
  error: v.optional(v.object({ code: v.string(), retryable: v.boolean() })),
  resultRows: v.array(v.any()),
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

type DurableSnapshot = {
  analysisId: string
  fixtureId: string
  datasetId?: string
  sourceType?: 'fixture' | 'upload' | 'public_url'
  query: string
  status: 'queued' | 'running' | 'complete' | 'error'
  createdAt: string
  updatedAt: string
  progress: { completedRows: number; totalRows: number; completedCalls: number; totalCalls: number }
  questionKind?: 'noul' | 'score' | 'choice'
  classes?: string[]
  columns?: string[]
  currentFixtureRow?: unknown
  error?: { code: string; retryable: boolean }
  resultRows: unknown[]
}

const authorizeWrite = (authToken: string): void => {
  const expected = process.env.CONVEX_WRITE_SECRET?.trim()
  if (!expected || authToken !== expected) throw new Error('Unauthorized analysis mutation')
}

const validateSnapshot: (snapshot: unknown) => asserts snapshot is DurableSnapshot = (snapshot) => {
  if (!isRecord(snapshot) || typeof snapshot.analysisId !== 'string' || snapshot.analysisId.length < 1 || snapshot.analysisId.length > MAX_ID_LENGTH) throw new Error('Invalid analysis snapshot')
  if (typeof snapshot.fixtureId !== 'string' || snapshot.fixtureId.length < 1 || snapshot.fixtureId.length > MAX_ID_LENGTH) throw new Error('Invalid analysis fixture')
  if (typeof snapshot.query !== 'string' || snapshot.query.length < 1 || snapshot.query.length > MAX_QUERY_LENGTH || snapshot.query.includes('\u0000')) throw new Error('Invalid analysis query')
  if (!['queued', 'running', 'complete', 'error'].includes(snapshot.status as string)) throw new Error('Invalid analysis status')
  if (typeof snapshot.createdAt !== 'string' || Number.isNaN(Date.parse(snapshot.createdAt)) || typeof snapshot.updatedAt !== 'string' || Number.isNaN(Date.parse(snapshot.updatedAt))) throw new Error('Invalid analysis timestamp')
  if (!isRecord(snapshot.progress)) throw new Error('Invalid analysis progress')
  const progress = snapshot.progress as { [key: string]: unknown }
  const progressNames = ['completedRows', 'totalRows', 'completedCalls', 'totalCalls'] as const
  for (const name of progressNames) {
    const value = progress[name]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_ROWS) throw new Error('Analysis progress exceeds bounds')
  }
  const completedRows = progress.completedRows as number
  const totalRows = progress.totalRows as number
  const completedCalls = progress.completedCalls as number
  const totalCalls = progress.totalCalls as number
  if (totalRows > MAX_ROWS || totalCalls > MAX_CALLS || completedRows > totalRows || completedCalls > totalCalls) throw new Error('Analysis progress is inconsistent')
  if (!Array.isArray(snapshot.resultRows) || snapshot.resultRows.length > MAX_ROWS) throw new Error('Analysis result rows exceed bounds')
  const indexes = new Set<number>()
  for (const row of snapshot.resultRows) {
    if (!isRecord(row) || typeof row.rowIndex !== 'number' || !Number.isInteger(row.rowIndex) || row.rowIndex < 0 || row.rowIndex >= MAX_ROWS || indexes.has(row.rowIndex)) throw new Error('Invalid analysis result row')
    if (typeof row.model !== 'string' || row.model.length < 1 || row.model.length > 256 || !isRecord(row.input)) throw new Error('Invalid analysis result row')
    indexes.add(row.rowIndex)
  }
  if (snapshot.currentFixtureRow !== undefined && !isRecord(snapshot.currentFixtureRow)) throw new Error('Invalid current analysis row')
  if (snapshot.error !== undefined && (!isRecord(snapshot.error) || typeof snapshot.error.code !== 'string' || !/^[A-Z0-9_]+$/.test(snapshot.error.code) || typeof snapshot.error.retryable !== 'boolean')) throw new Error('Invalid analysis error')
  if (JSON.stringify(snapshot).length > 900_000) throw new Error('Analysis snapshot is too large')
}

const snapshotDocument = (snapshot: {
  analysisId: string
  fixtureId: string
  datasetId?: string
  sourceType?: 'fixture' | 'upload' | 'public_url'
  query: string
  status: 'queued' | 'running' | 'complete' | 'error'
  createdAt: string
  updatedAt: string
  progress: { completedRows: number; totalRows: number; completedCalls: number; totalCalls: number }
  questionKind?: 'noul' | 'score' | 'choice'
  classes?: string[]
  columns?: string[]
  currentFixtureRow?: unknown
  error?: { code: string; retryable: boolean }
}) => ({
  analysisId: snapshot.analysisId,
  fixtureId: snapshot.fixtureId,
  ...(snapshot.datasetId === undefined ? {} : { datasetId: snapshot.datasetId }),
  ...(snapshot.sourceType === undefined ? {} : { sourceType: snapshot.sourceType }),
  query: snapshot.query,
  status: snapshot.status,
  createdAt: snapshot.createdAt,
  updatedAt: snapshot.updatedAt,
  progress: snapshot.progress,
  ...(snapshot.questionKind === undefined ? {} : { questionKind: snapshot.questionKind }),
  ...(snapshot.classes === undefined ? {} : { classes: snapshot.classes }),
  ...(snapshot.columns === undefined ? {} : { columns: snapshot.columns }),
  ...(snapshot.currentFixtureRow === undefined ? {} : { currentFixtureRow: snapshot.currentFixtureRow }),
  ...(snapshot.error === undefined ? {} : { error: snapshot.error }),
})

const publicSnapshot = (document: Record<string, unknown>, rows: unknown[]) => ({
  analysisId: document.analysisId,
  fixtureId: document.fixtureId,
  datasetId: document.datasetId ?? document.fixtureId,
  sourceType: document.sourceType ?? 'fixture',
  query: document.query,
  status: document.status,
  createdAt: document.createdAt,
  updatedAt: document.updatedAt,
  progress: document.progress,
  questionKind: document.questionKind,
  classes: document.classes ?? [],
  columns: document.columns ?? [],
  ...(document.currentFixtureRow === undefined ? {} : { currentFixtureRow: document.currentFixtureRow }),
  ...(document.error === undefined ? {} : { error: document.error }),
  resultRows: rows,
})

const findDocument = async (ctx: { db: any }, analysisId: string) => await ctx.db.query('analyses').withIndex('by_analysis_id', (q: any) => q.eq('analysisId', analysisId)).unique()

const readSnapshot = async (ctx: { db: any }, analysisId: string) => {
  const document = await findDocument(ctx, analysisId)
  if (!document) return null
  const rows = await ctx.db.query('analysisRows').withIndex('by_analysis_row', (q: any) => q.eq('analysisId', analysisId)).order('asc').take(MAX_ROWS)
  return publicSnapshot(document, rows.map((row: Record<string, unknown>) => {
    const { _id: _ignoredId, _creationTime: _ignoredCreationTime, analysisId: _ignoredAnalysisId, ...safe } = row
    return safe
  }))
}

export const getAnalysisInternal = internalQuery({
  args: { analysisId: v.string() },
  handler: async (ctx, { analysisId }) => await readSnapshot(ctx, analysisId),
})

export const getAnalysisShareSnapshot = query({
  args: { analysisId: v.string() },
  handler: async (ctx, { analysisId }) => await readSnapshot(ctx, analysisId),
})

export const putAnalysisSnapshotInternal = internalMutation({
  args: { snapshot: v.any() },
  handler: async (ctx, { snapshot }) => {
    validateSnapshot(snapshot)
    const existing = await findDocument(ctx, snapshot.analysisId)
    const currentClaims = existing ? {
      ...(existing.runOwnerToken === undefined ? {} : { runOwnerToken: existing.runOwnerToken }),
      ...(existing.runLeaseExpiresAt === undefined ? {} : { runLeaseExpiresAt: existing.runLeaseExpiresAt }),
    } : {}
    const document = { ...snapshotDocument(snapshot), ...currentClaims }
    if (existing) await ctx.db.replace(existing._id, document)
    else await ctx.db.insert('analyses', document)

    const currentRows = await ctx.db.query('analysisRows').withIndex('by_analysis_row', (q: any) => q.eq('analysisId', snapshot.analysisId)).take(MAX_ROWS)
    for (const row of currentRows) await ctx.db.delete(row._id)
    for (const row of snapshot.resultRows) {
      const durableRow = row as { rowIndex: number; input: unknown; model: string; selectedClass?: string; probabilities?: unknown; confidence?: number; value?: number; questionKind?: 'noul' | 'score' | 'choice'; error?: { code: string; retryable: boolean } }
      await ctx.db.insert('analysisRows', { analysisId: snapshot.analysisId, ...durableRow })
    }
    return publicSnapshot(document, snapshot.resultRows)
  },
})

export const claimAnalysisInternal = internalMutation({
  args: { analysisId: v.string(), ownerToken: v.string(), nowMs: v.number(), leaseMs: v.number() },
  handler: async (ctx, args) => {
    if (!args.analysisId.trim() || !args.ownerToken.trim() || !Number.isFinite(args.nowMs) || !Number.isFinite(args.leaseMs) || args.leaseMs < 1_000 || args.leaseMs > 86_400_000) throw new Error('Invalid analysis claim')
    const document = await findDocument(ctx, args.analysisId)
    if (!document) return 'missing' as const
    if (document.status === 'complete') return 'complete' as const
    if (document.runOwnerToken && document.runOwnerToken !== args.ownerToken && (document.runLeaseExpiresAt ?? 0) > args.nowMs) return 'busy' as const
    await ctx.db.patch(document._id, { status: 'running', updatedAt: new Date(args.nowMs).toISOString(), runOwnerToken: args.ownerToken, runLeaseExpiresAt: args.nowMs + args.leaseMs })
    return 'claimed' as const
  },
})

export const releaseAnalysisInternal = internalMutation({
  args: { analysisId: v.string(), ownerToken: v.string() },
  handler: async (ctx, { analysisId, ownerToken }) => {
    const document = await findDocument(ctx, analysisId)
    if (document?.runOwnerToken === ownerToken) await ctx.db.patch(document._id, { runOwnerToken: undefined, runLeaseExpiresAt: undefined })
    return null
  },
})

export const authorizedGetAnalysis = action({
  args: { authToken: v.string(), analysisId: v.string() },
  handler: async (ctx: any, { authToken, analysisId }: { authToken: string; analysisId: string }): Promise<unknown> => {
    authorizeWrite(authToken)
    return await ctx.runQuery(internal.analyses.getAnalysisInternal, { analysisId })
  },
})

export const authorizedPutAnalysisSnapshot = action({
  args: { authToken: v.string(), snapshot: v.any() },
  handler: async (ctx: any, { authToken, snapshot }: { authToken: string; snapshot: unknown }): Promise<unknown> => {
    authorizeWrite(authToken)
    validateSnapshot(snapshot)
    return await ctx.runMutation(internal.analyses.putAnalysisSnapshotInternal, { snapshot })
  },
})

export const authorizedClaimAnalysis = action({
  args: { authToken: v.string(), analysisId: v.string(), ownerToken: v.string(), nowMs: v.number(), leaseMs: v.number() },
  handler: async (ctx: any, { authToken, ...args }: { authToken: string; analysisId: string; ownerToken: string; nowMs: number; leaseMs: number }): Promise<unknown> => {
    authorizeWrite(authToken)
    return await ctx.runMutation(internal.analyses.claimAnalysisInternal, args)
  },
})

export const authorizedReleaseAnalysis = action({
  args: { authToken: v.string(), analysisId: v.string(), ownerToken: v.string() },
  handler: async (ctx: any, { authToken, ...args }: { authToken: string; analysisId: string; ownerToken: string }): Promise<unknown> => {
    authorizeWrite(authToken)
    return await ctx.runMutation(internal.analyses.releaseAnalysisInternal, args)
  },
})

export const listPublicAnalyses = query({
  args: {},
  handler: async (ctx) => {
    const documents = await ctx.db.query('analyses').take(48)
    return documents.map((document) => ({
      analysisId: document.analysisId,
      datasetId: document.datasetId ?? document.fixtureId,
      title: document.query.slice(0, 80),
      status: document.status,
      completedRows: document.progress.completedRows,
      totalRows: document.progress.totalRows,
      createdAt: document.createdAt,
    }))
  },
})
