import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { DatasetError } from '../dataset/csvTypes'
import { readDatasetIntakeStatus } from './runtimeStatus'
import {
  createCsvBlobStore,
  isUploadThingConfigured,
  readUploadThingCredentials,
  readUploadThingToken,
  signedIngestUrl,
  uploadThingAppIdPrefix,
  UploadThingBlobStore,
} from './uploadthing'

const encodedToken = (apiKey: string, extras?: { appId?: string; regions?: string[] }): string => (
  Buffer.from(JSON.stringify({
    apiKey,
    appId: extras?.appId ?? 'app_demo',
    regions: extras?.regions ?? ['sea1'],
  })).toString('base64')
)

const jwtToken = (apiKey: string): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ apiKey, appId: 'app_demo', regions: ['sea1'] })).toString('base64url')
  return `${header}.${payload}.sig`
}

const csvBytes = () => new TextEncoder().encode('a,b\n1,2\n')

describe('UploadThing credential reader', () => {
  it('reads UPLOADTHING_TOKEN and UPLOADTHING_SECRET through the same path status uses', () => {
    expect(readUploadThingToken({})).toBeUndefined()
    expect(readUploadThingToken({ UPLOADTHING_TOKEN: '  sk_live_token  ' })).toBe('sk_live_token')
    expect(readUploadThingToken({ UPLOADTHING_SECRET: 'sk_live_secret' })).toBe('sk_live_secret')
    expect(readUploadThingToken({
      UPLOADTHING_TOKEN: 'sk_live_token',
      UPLOADTHING_SECRET: 'sk_live_secret',
    })).toBe('sk_live_token')
    expect(readUploadThingToken({ UPLOADTHING_TOKEN: '   ' })).toBeUndefined()
    expect(readUploadThingToken({ UPLOADTHING_TOKEN: '"sk_live_quoted"' })).toBe('sk_live_quoted')
  })

  it('extracts the inner API key and v7 app fields from an UploadThing dashboard token', () => {
    const token = encodedToken('sk_live_from_token')
    expect(readUploadThingToken({ UPLOADTHING_TOKEN: token })).toBe('sk_live_from_token')
    expect(readUploadThingCredentials({ UPLOADTHING_TOKEN: token })).toEqual({
      apiKey: 'sk_live_from_token',
      appId: 'app_demo',
      regions: ['sea1'],
    })
    expect(isUploadThingConfigured({ UPLOADTHING_TOKEN: token })).toBe(true)
    expect(readUploadThingToken({ UPLOADTHING_TOKEN: jwtToken('sk_live_jwt') })).toBe('sk_live_jwt')
    expect(readUploadThingCredentials({ UPLOADTHING_TOKEN: jwtToken('sk_live_jwt') })).toMatchObject({
      apiKey: 'sk_live_jwt',
      appId: 'app_demo',
      regions: ['sea1'],
    })
    expect(readUploadThingToken({
      UPLOADTHING_TOKEN: JSON.stringify({ apiKey: 'sk_live_json', appId: 'app_demo', regions: ['sea1'] }),
    })).toBe('sk_live_json')
  })

  it('does not treat empty or invalid-format values as configured', () => {
    expect(readUploadThingToken({ UPLOADTHING_TOKEN: 'ut_token' })).toBeUndefined()
    expect(isUploadThingConfigured({ UPLOADTHING_TOKEN: 'ut_token' })).toBe(false)
    expect(readDatasetIntakeStatus({
      CONVEX_URL: 'https://demo.convex.cloud',
      CONVEX_WRITE_SECRET: 'write-secret',
      UPLOADTHING_TOKEN: 'not-a-token',
    })).toMatchObject({ uploadThing: false })
    expect(createCsvBlobStore({ UPLOADTHING_TOKEN: 'not-a-token' }).isConfigured()).toBe(false)
  })

  it('keeps status and createCsvBlobStore aligned, including after construction', () => {
    const env: NodeJS.ProcessEnv = {}
    const store = createCsvBlobStore(env)
    expect(store.isConfigured()).toBe(false)
    expect(readDatasetIntakeStatus(env).uploadThing).toBe(false)
    expect(isUploadThingConfigured(env)).toBe(false)

    env.UPLOADTHING_TOKEN = encodedToken('sk_live_late')
    expect(store.isConfigured()).toBe(true)
    expect(readDatasetIntakeStatus(env).uploadThing).toBe(true)
    expect(createCsvBlobStore(env).isConfigured()).toBe(true)
  })

  it('reports SECRET-only env as configured for both status and runtime', () => {
    const env: NodeJS.ProcessEnv = { UPLOADTHING_SECRET: 'sk_live_only_secret' }
    expect(readDatasetIntakeStatus(env).uploadThing).toBe(true)
    expect(createCsvBlobStore(env).isConfigured()).toBe(true)
    expect(readDatasetIntakeStatus(env).missingEnv).not.toContain('UPLOADTHING_TOKEN')
  })
})

describe('UploadThing v7 ingest signing', () => {
  it('HMAC-signs the ingest URL the same way UTApi does (encode-then-append)', () => {
    const url = signedIngestUrl({
      apiKey: 'sk_live_sign',
      appId: 'app_demo',
      region: 'sea1',
      fileKey: 'abc123',
      filename: 'n.csv',
      byteSize: 8,
      contentType: 'text/csv',
      expiresAtMs: 1_700_000_000_000,
    })
    const parsed = new URL(url)
    expect(parsed.origin).toBe('https://sea1.ingest.uploadthing.com')
    expect(parsed.pathname).toBe('/abc123')
    expect(parsed.searchParams.get('x-ut-identifier')).toBe(encodeURIComponent('app_demo'))
    expect(parsed.searchParams.get('x-ut-file-type')).toBe(encodeURIComponent('text/csv'))
    const signature = parsed.searchParams.get('signature')
    expect(signature).toMatch(/^hmac-sha256=[0-9a-f]+$/)
    const unsigned = new URL(url)
    unsigned.searchParams.delete('signature')
    const expected = `hmac-sha256=${createHmac('sha256', 'sk_live_sign').update(unsigned.toString()).digest('hex')}`
    expect(signature).toBe(expected)
  })

  it('keeps a stable app-id file-key prefix', () => {
    expect(uploadThingAppIdPrefix('app_demo')).toMatch(/^[A-Za-z0-9]{12,}$/)
    expect(uploadThingAppIdPrefix('app_demo')).toBe(uploadThingAppIdPrefix('app_demo'))
  })
})

describe('UploadThing blob store', () => {
  it('fails closed with UPLOADTHING_NOT_CONFIGURED when the shared reader has no token', async () => {
    const store = new UploadThingBlobStore({})
    await expect(store.putCsv({ bytes: new Uint8Array([1]), filename: 'a.csv' })).rejects.toMatchObject({
      code: 'UPLOADTHING_NOT_CONFIGURED',
      statusCode: 503,
    })
  })

  it('does not map a missing v7 app id to not-configured when an sk_ key is present', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch
    const store = new UploadThingBlobStore({ UPLOADTHING_TOKEN: 'sk_live_upload' }, fetchMock)
    const error = await store.putCsv({ bytes: csvBytes(), filename: 'n.csv' }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(DatasetError)
    expect(error).toMatchObject({ code: 'UPLOADTHING_FAILED', statusCode: 503 })
    expect((error as DatasetError).code).not.toBe('UPLOADTHING_NOT_CONFIGURED')
    expect((error as DatasetError).code).not.toBe('DATASET_INTAKE_UNAVAILABLE')
    expect((error as DatasetError).message).not.toMatch(/not configured/i)
    expect((error as DatasetError).message).toMatch(/v7/i)
    expect((error as DatasetError).message).toMatch(/uploadFiles/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not map a rejected ingest response to not-configured', async () => {
    const env: NodeJS.ProcessEnv = { UPLOADTHING_TOKEN: encodedToken('sk_live_upload') }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'Invalid API key' }), { status: 401 })) as unknown as typeof fetch
    const store = new UploadThingBlobStore(env, fetchMock)
    const error = await store.putCsv({ bytes: csvBytes(), filename: 'n.csv' }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(DatasetError)
    expect(error).toMatchObject({ code: 'UPLOADTHING_FAILED', statusCode: 503 })
    expect((error as DatasetError).code).not.toBe('UPLOADTHING_NOT_CONFIGURED')
    expect((error as DatasetError).code).not.toBe('DATASET_INTAKE_UNAVAILABLE')
    expect((error as DatasetError).message).not.toMatch(/not configured/i)
    expect((error as DatasetError).message).toMatch(/401/)
    expect((error as DatasetError).message).toMatch(/Invalid API key/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('PUTs the CSV to the regional ingest host and never calls v6 uploadFiles', async () => {
    const env: NodeJS.ProcessEnv = { UPLOADTHING_TOKEN: encodedToken('sk_live_upload') }
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = String(input)
      expect(url).not.toContain('/v6/uploadFiles')
      expect(url).toContain('https://sea1.ingest.uploadthing.com/')
      expect(init?.method).toBe('PUT')
      expect(init?.body).toBeInstanceOf(FormData)
      const form = init?.body as FormData
      expect(form.get('file')).toBeInstanceOf(Blob)
      expect(new URL(url).searchParams.get('x-ut-file-name')).toBe(encodeURIComponent('n.csv'))
      return new Response(JSON.stringify({ ufsUrl: 'https://app_demo.ufs.sh/f/key' }), { status: 200 })
    }) as unknown as typeof fetch
    const store = new UploadThingBlobStore(env, fetchMock)
    const result = await store.putCsv({ bytes: csvBytes(), filename: 'n.csv' })
    expect(result.byteSize).toBe(8)
    expect(result.blobKey.startsWith(uploadThingAppIdPrefix('app_demo'))).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('signs ingest URLs for a dashboard token that includes a custom ingest host', async () => {
    const token = Buffer.from(JSON.stringify({
      apiKey: 'sk_live_fields',
      appId: 'app_demo',
      regions: ['fra1'],
      ingestHost: 'ingest.example.test',
    })).toString('base64')
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      expect(String(input)).toContain('https://fra1.ingest.example.test/')
      return new Response(null, { status: 204 })
    }) as unknown as typeof fetch
    const store = new UploadThingBlobStore({ UPLOADTHING_TOKEN: token }, fetchMock)
    await expect(store.putCsv({ bytes: csvBytes(), filename: 'tickets.csv' })).resolves.toMatchObject({
      byteSize: 8,
    })
  })
})
