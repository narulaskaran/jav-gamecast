import { describe, expect, it, vi } from 'vitest'
import { convexToJson } from 'convex/values'
import { DatasetError } from '../dataset/csvTypes'
import { validateCsvText } from '../dataset/validateDataset'
import { ConvexDatasetStore } from './analysisStore'
import {
  convexPutFailureReason,
  omitUndefinedDeep,
  toConvexDatasetPutArgs,
  wrapConvexPutError,
} from './convexDatasetPut'
import { toDatasetRecord } from './datasetStore'

const validated = validateCsvText('label,count\nurgent,2\n')

const byodRecord = () => toDatasetRecord({
  sourceType: 'upload',
  displayName: 'tickets.csv',
  validated,
  contentHash: 'hash',
  blobKey: 'blob-1',
  createdAt: 1_800_000_000_000,
})

describe('convex dataset put payload', () => {
  it('omits undefined keys so ConvexHttpClient can serialize a BYOD record', () => {
    const record = byodRecord()
    expect(record).not.toHaveProperty('fixtureKey')
    expect(record).not.toHaveProperty('sourceUrl')
    const args = toConvexDatasetPutArgs(record, validated.rows)
    expect(args.dataset).not.toHaveProperty('publicDataWarning')
    expect(args.dataset).not.toHaveProperty('fixtureKey')
    expect(args.dataset).not.toHaveProperty('sourceUrl')
    expect(args.dataset).toMatchObject({ blobKey: 'blob-1', sourceType: 'upload', acceptedRowCount: 1 })
    expect(JSON.stringify(args.dataset)).not.toContain('publicDataWarning')
    expect(() => convexToJson({ authToken: 'write-secret', ...args } as never)).not.toThrow()
    // Nested undefined is skipped by convexToJson; still omit keys so the
    // document matches the Convex schema and action return values stay defined.
    expect('fixtureKey' in args.dataset).toBe(false)
  })

  it('strips undefined nested fields and non-finite numbers', () => {
    expect(omitUndefinedDeep({ a: 1, b: undefined, c: { d: undefined, e: Number.NaN } })).toEqual({ a: 1, c: { e: null } })
  })

  it('maps Convex throws to CONVEX_PUT_FAILED without forwarding dumps', () => {
    expect(convexPutFailureReason(new Error('Unauthorized dataset mutation'))).toBe('Convex write authorization failed.')
    expect(convexPutFailureReason(new Error('undefined is not a valid Convex value (present at path .dataset.fixtureKey in original object {"authToken":"super-secret"})'))).toBe('Convex rejected undefined fields in the dataset payload.')
    expect(convexPutFailureReason(new Error('undefined is not a valid Convex value authToken=super-secret'))).not.toMatch(/super-secret/)
    const error = (() => {
      try { wrapConvexPutError(new Error('Could not find public function datasets:authorizedPutDataset')) }
      catch (caught) { return caught }
    })()
    expect(error).toMatchObject({
      code: 'DATASET_INTAKE_UNAVAILABLE',
      failure: 'CONVEX_PUT_FAILED',
      statusCode: 503,
      message: 'Convex dataset put function is not deployed.',
    })
    expect((error as Error).message).not.toMatch(/authToken|super-secret/i)
    expect((error as DatasetError).cause).toBeInstanceOf(Error)
  })
})

describe('ConvexDatasetStore.put', () => {
  it('sends a Convex-safe payload and wraps client failures', async () => {
    const action = vi.fn(async (_ref: unknown, args: { dataset: Record<string, unknown> }) => {
      convexToJson(args as never)
      expect(args.dataset).not.toHaveProperty('publicDataWarning')
      expect(args.dataset).not.toHaveProperty('fixtureKey')
    })
    const store = new ConvexDatasetStore('https://demo.convex.cloud', 'write-secret', { action } as never)
    await store.put(byodRecord(), validated.rows)
    expect(action).toHaveBeenCalledOnce()

    const failing = new ConvexDatasetStore('https://demo.convex.cloud', 'write-secret', {
      action: vi.fn(async () => { throw new Error('Unauthorized dataset mutation') }),
    } as never)
    await expect(failing.put(byodRecord(), validated.rows)).rejects.toMatchObject({
      code: 'DATASET_INTAKE_UNAVAILABLE',
      failure: 'CONVEX_PUT_FAILED',
      message: 'Convex write authorization failed.',
    })
  })

  it('fails closed without CONVEX_WRITE_SECRET using CONVEX_PUT_FAILED', async () => {
    const store = new ConvexDatasetStore('https://demo.convex.cloud', undefined, { action: vi.fn() } as never)
    await expect(store.put(byodRecord(), validated.rows)).rejects.toBeInstanceOf(DatasetError)
    await expect(store.put(byodRecord(), validated.rows)).rejects.toMatchObject({ failure: 'CONVEX_PUT_FAILED' })
  })
})
