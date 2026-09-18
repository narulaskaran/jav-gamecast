import { describe, expect, it, vi } from 'vitest'
import { DatasetError } from '../dataset/csvTypes'
import { DatasetIntakeService } from './datasetIntake'
import { createDatasetFromUrlHandler } from './datasetApi'
import { InMemoryDatasetStore } from './datasetStore'
import { InMemoryBlobStore } from './uploadthing'

type ResponseState = { code?: number; body?: unknown; headers: Record<string, string> }
const response = (state: ResponseState) => ({
  status(code: number) { state.code = code; return this },
  json(body: unknown) { state.body = body; return this },
  setHeader(name: string, value: string) { state.headers[name] = value; return this },
  end() { return this },
})

const csv = 'label,count\nurgent,2\n'

describe('dataset API error shaping', () => {
  it('returns TOKEN_MISSING_APP_REGION instead of DATASET_UNAVAILABLE', async () => {
    const intake = new DatasetIntakeService({
      datasets: new InMemoryDatasetStore(),
      blobs: {
        isConfigured: () => true,
        async putCsv() {
          throw new DatasetError(
            'UPLOADTHING_FAILED',
            'UploadThing v7 needs a dashboard API token with app id and region. The v6 uploadFiles API is no longer supported.',
            503,
            'TOKEN_MISSING_APP_REGION',
          )
        },
        async getCsv() { throw new Error('unused') },
      },
      convexConfigured: true,
      fetch: vi.fn(async () => new Response(csv, { status: 200, headers: { 'content-type': 'text/csv' } })),
      lookup: async () => ['93.184.216.34'],
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const state: ResponseState = { headers: {} }
    await createDatasetFromUrlHandler(intake)({ method: 'POST', body: { url: 'https://example.com/data.csv' } }, response(state))
    expect(state.code).toBe(503)
    expect(state.body).toEqual({
      error: 'UPLOADTHING_FAILED',
      failure: 'TOKEN_MISSING_APP_REGION',
      message: 'UploadThing v7 needs a dashboard API token with app id and region. The v6 uploadFiles API is no longer supported.',
    })
    expect(errorSpy).toHaveBeenCalled()
    expect(JSON.stringify(errorSpy.mock.calls[0])).toContain('TOKEN_MISSING_APP_REGION')
    errorSpy.mockRestore()
  })

  it('maps Convex persist throws to CONVEX_PUT_FAILED instead of UNCAUGHT', async () => {
    const intake = new DatasetIntakeService({
      datasets: {
        get: () => undefined,
        put: async () => { throw new Error('convex exploded') },
        getRows: () => [],
      },
      blobs: new InMemoryBlobStore(),
      convexConfigured: true,
      fetch: vi.fn(async () => new Response(csv, { status: 200, headers: { 'content-type': 'text/csv' } })),
      lookup: async () => ['93.184.216.34'],
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const state: ResponseState = { headers: {} }
    await createDatasetFromUrlHandler(intake)({ method: 'POST', body: { url: 'https://example.com/data.csv' } }, response(state))
    expect(state.body).toEqual({
      error: 'DATASET_INTAKE_UNAVAILABLE',
      failure: 'CONVEX_PUT_FAILED',
      message: 'Convex dataset put failed: convex exploded',
    })
    expect(errorSpy).toHaveBeenCalled()
    expect(JSON.stringify(errorSpy.mock.calls[0])).toContain('CONVEX_PUT_FAILED')
    expect(JSON.stringify(errorSpy.mock.calls[0])).not.toContain('UNCAUGHT')
    errorSpy.mockRestore()
  })

  it('maps a raw blob-store TypeError to UPLOADTHING_FAILED INGEST_RUNTIME', async () => {
    const intake = new DatasetIntakeService({
      datasets: new InMemoryDatasetStore(),
      blobs: {
        isConfigured: () => true,
        async putCsv() { throw new TypeError('File is not defined') },
        async getCsv() { throw new Error('unused') },
      },
      convexConfigured: true,
      fetch: vi.fn(async () => new Response(csv, { status: 200, headers: { 'content-type': 'text/csv' } })),
      lookup: async () => ['93.184.216.34'],
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const state: ResponseState = { headers: {} }
    await createDatasetFromUrlHandler(intake)({ method: 'POST', body: { url: 'https://example.com/data.csv' } }, response(state))
    expect(state.body).toEqual({
      error: 'UPLOADTHING_FAILED',
      failure: 'INGEST_RUNTIME',
      message: 'UploadThing ingest failed (TypeError).',
    })
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('still succeeds for a configured in-memory blob store', async () => {
    const intake = new DatasetIntakeService({
      datasets: new InMemoryDatasetStore(),
      blobs: new InMemoryBlobStore(),
      convexConfigured: true,
      fetch: vi.fn(async () => new Response(csv, { status: 200, headers: { 'content-type': 'text/csv' } })),
      lookup: async () => ['93.184.216.34'],
    })
    const state: ResponseState = { headers: {} }
    await createDatasetFromUrlHandler(intake)({ method: 'POST', body: { url: 'https://example.com/data.csv' } }, response(state))
    expect(state.code).toBe(201)
    expect(state.body).toEqual(expect.objectContaining({ sourceType: 'public_url', acceptedRowCount: 1 }))
  })
})
