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
    await expect(t.action(api.datasets.authorizedGetDatasetRows, { authToken: writeSecret, datasetId: dataset.datasetId })).resolves.toEqual([{ label: 'urgent' }])
    await expect(t.query(api.datasets.listPublicDatasets, {})).resolves.toEqual([expect.objectContaining({ datasetId: dataset.datasetId, displayName: 'tickets.csv', acceptedRowCount: 1 })])
    const preview = await t.query(api.datasets.getDatasetSharePreview, { datasetId: dataset.datasetId })
    expect(JSON.stringify(preview)).not.toContain(writeSecret)
  })
})
