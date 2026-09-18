import { beforeEach, describe, expect, it } from 'vitest'
import { convexTest } from 'convex-test'
import { api } from './_generated/api'
import schema from './schema'

const modules = (import.meta as ImportMeta & { glob: (pattern: string) => Record<string, () => Promise<unknown>> }).glob('./**/*.ts')
const writeSecret = ['analysis', 'convex', 'test', 'auth'].join('-')
const dataset = {
  datasetId: 'dataset-convex-1',
  sourceType: 'upload' as const,
  displayName: 'tickets.csv',
  byteSize: 24,
  contentHash: 'hash',
  encoding: 'utf-8',
  delimiter: ',',
  columns: [{ name: 'label', normalizedName: 'label', inferredType: 'string' }],
  acceptedRowCount: 1,
  previewRows: [{ label: 'urgent' }],
  validationWarnings: [],
  visibility: 'published' as const,
  createdAt: 1_800_000_000_000,
}
const rows = [{ rowIndex: 0, rowHash: 'row-0', values: { label: 'urgent' } }]

beforeEach(() => {
  process.env.CONVEX_WRITE_SECRET = writeSecret
})

describe('durable Convex dataset functions', () => {
  it('requires authenticated writes and exposes only public preview metadata', async () => {
    const t = convexTest(schema, modules)
    await expect(t.action(api.datasets.authorizedPutDataset, { authToken: 'wrong', dataset, rows })).rejects.toThrow(/unauthorized/i)
    await expect(t.action(api.datasets.authorizedPutDataset, { authToken: writeSecret, dataset, rows })).resolves.toMatchObject({ datasetId: dataset.datasetId, previewRows: [{ label: 'urgent' }] })
    const storedMeta = await t.action(api.datasets.authorizedPutDataset, { authToken: writeSecret, dataset, rows }) as Record<string, unknown>
    expect(Object.values(storedMeta).every((value) => value !== undefined)).toBe(true)
    expect(storedMeta).not.toHaveProperty('fixtureKey')
    expect(storedMeta).not.toHaveProperty('sourceUrl')
    await expect(t.action(api.datasets.authorizedGetDatasetRows, { authToken: writeSecret, datasetId: dataset.datasetId })).resolves.toEqual([{ label: 'urgent' }])
    await expect(t.query(api.datasets.listPublicDatasets, {})).resolves.toEqual([expect.objectContaining({ datasetId: dataset.datasetId, displayName: 'tickets.csv', acceptedRowCount: 1 })])
    const preview = await t.query(api.datasets.getDatasetSharePreview, { datasetId: dataset.datasetId })
    expect(JSON.stringify(preview)).not.toContain(writeSecret)
  })

  it('persists BYOD metadata without fixtureKey and batches more than 200 rows', async () => {
    const t = convexTest(schema, modules)
    const many = Array.from({ length: 201 }, (_, rowIndex) => ({
      rowIndex,
      rowHash: `row-${rowIndex}`,
      values: { label: `row-${rowIndex}` },
    }))
    const payload = {
      ...dataset,
      datasetId: 'dataset-convex-batch',
      acceptedRowCount: many.length,
      publicDataWarning: 'This playground publishes datasets and results. Do not upload secrets or personal data.',
    }
    await expect(t.action(api.datasets.authorizedPutDataset, { authToken: writeSecret, dataset: payload, rows: many })).resolves.toMatchObject({
      datasetId: 'dataset-convex-batch',
      acceptedRowCount: 201,
    })
    const stored = await t.action(api.datasets.authorizedGetDatasetRows, { authToken: writeSecret, datasetId: 'dataset-convex-batch' }) as unknown[]
    expect(stored).toHaveLength(201)
    expect(stored[0]).toEqual({ label: 'row-0' })
    expect(stored[200]).toEqual({ label: 'row-200' })
  })
})
