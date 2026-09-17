import { beforeEach, describe, expect, it } from 'vitest'
import { convexTest } from 'convex-test'
import { api } from './_generated/api'
import schema from './schema'

const modules = (import.meta as ImportMeta & { glob: (pattern: string) => Record<string, () => Promise<unknown>> }).glob('./**/*.ts')
const writeSecret = ['analysis', 'convex', 'test', 'auth'].join('-')
const baseSnapshot = {
  analysisId: 'analysis-convex-1',
  fixtureId: 'football-fixture-2026',
  query: 'Classify H1 rows.',
  status: 'queued' as const,
  createdAt: '2026-09-17T18:00:00.000Z',
  updatedAt: '2026-09-17T18:00:00.000Z',
  progress: { completedRows: 0, totalRows: 2, completedCalls: 0, totalCalls: 2 },
  resultRows: [],
}
const resultRow = (rowIndex: number) => ({
  rowIndex,
  input: { playId: `play-${rowIndex}`, source: 'H1' },
  model: 'jev-test',
  selectedClass: 'K.Walker',
  probabilities: { 'K.Walker': 0.7, 'C.Kupp': 0.1, 'J.Smith-Njigba': 0.1, 'Other/Tie': 0.1 },
  confidence: 0.7,
})

beforeEach(() => {
  process.env.CONVEX_WRITE_SECRET = writeSecret
})

describe('durable Convex analysis functions', () => {
  it('requires authenticated writes, supports incremental readback, public share snapshots, and idempotent updates', async () => {
    const t = convexTest(schema, modules)
    await expect(t.action(api.analyses.authorizedPutAnalysisSnapshot, { authToken: 'wrong', snapshot: baseSnapshot })).rejects.toThrow(/unauthorized/i)

    await expect(t.action(api.analyses.authorizedPutAnalysisSnapshot, { authToken: writeSecret, snapshot: baseSnapshot })).resolves.toMatchObject({ analysisId: baseSnapshot.analysisId, resultRows: [] })
    const partial = { ...baseSnapshot, status: 'running' as const, updatedAt: '2026-09-17T18:01:00.000Z', progress: { completedRows: 1, totalRows: 2, completedCalls: 1, totalCalls: 2 }, currentFixtureRow: { rowIndex: 1, input: { playId: 'play-1', source: 'H1' } }, resultRows: [resultRow(0)] }
    await t.action(api.analyses.authorizedPutAnalysisSnapshot, { authToken: writeSecret, snapshot: partial })

    await expect(t.action(api.analyses.authorizedGetAnalysis, { authToken: writeSecret, analysisId: baseSnapshot.analysisId })).resolves.toMatchObject({ status: 'running', progress: partial.progress, resultRows: [expect.objectContaining({ rowIndex: 0 })] })
    await expect(t.query(api.analyses.getAnalysisShareSnapshot, { analysisId: baseSnapshot.analysisId })).resolves.toMatchObject({ analysisId: baseSnapshot.analysisId, resultRows: [expect.objectContaining({ rowIndex: 0 })] })
    await expect(t.query(api.analyses.getAnalysisShareSnapshot, { analysisId: 'missing' })).resolves.toBeNull()
  })

  it('claims one execution, rejects a live duplicate, and permits stale recovery', async () => {
    const t = convexTest(schema, modules)
    await t.action(api.analyses.authorizedPutAnalysisSnapshot, { authToken: writeSecret, snapshot: baseSnapshot })
    await expect(t.action(api.analyses.authorizedClaimAnalysis, { authToken: writeSecret, analysisId: baseSnapshot.analysisId, ownerToken: 'owner-a', nowMs: 1_000, leaseMs: 300_000 })).resolves.toBe('claimed')
    await expect(t.action(api.analyses.authorizedClaimAnalysis, { authToken: writeSecret, analysisId: baseSnapshot.analysisId, ownerToken: 'owner-b', nowMs: 2_000, leaseMs: 300_000 })).resolves.toBe('busy')
    await expect(t.action(api.analyses.authorizedClaimAnalysis, { authToken: writeSecret, analysisId: baseSnapshot.analysisId, ownerToken: 'owner-b', nowMs: 301_001, leaseMs: 300_000 })).resolves.toBe('claimed')
    await expect(t.action(api.analyses.authorizedReleaseAnalysis, { authToken: writeSecret, analysisId: baseSnapshot.analysisId, ownerToken: 'owner-b' })).resolves.toBeNull()
  })
})
