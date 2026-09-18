import { describe, expect, it, vi } from 'vitest'
import { DatasetError } from '../dataset/csvTypes'
import { readDatasetIntakeStatus } from './runtimeStatus'
import {
  createCsvBlobStore,
  isUploadThingConfigured,
  readUploadThingToken,
  UploadThingBlobStore,
} from './uploadthing'

const encodedToken = (apiKey: string): string => Buffer.from(JSON.stringify({ apiKey, appId: 'app_demo', regions: ['sea1'] })).toString('base64')

const jwtToken = (apiKey: string): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ apiKey, appId: 'app_demo' })).toString('base64url')
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

  it('extracts the inner API key from an UploadThing dashboard token', () => {
    const token = encodedToken('sk_live_from_token')
    expect(readUploadThingToken({ UPLOADTHING_TOKEN: token })).toBe('sk_live_from_token')
    expect(isUploadThingConfigured({ UPLOADTHING_TOKEN: token })).toBe(true)
    expect(readUploadThingToken({ UPLOADTHING_TOKEN: jwtToken('sk_live_jwt') })).toBe('sk_live_jwt')
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

describe('UploadThing blob store', () => {
  it('fails closed with UPLOADTHING_NOT_CONFIGURED when the shared reader has no token', async () => {
    const store = new UploadThingBlobStore({})
    await expect(store.putCsv({ bytes: new Uint8Array([1]), filename: 'a.csv' })).rejects.toMatchObject({
      code: 'UPLOADTHING_NOT_CONFIGURED',
      statusCode: 503,
    })
  })

  it('does not map a rejected UploadThing API response to not-configured', async () => {
    const env: NodeJS.ProcessEnv = { UPLOADTHING_TOKEN: 'sk_live_upload' }
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

  it('sends the parsed API key and uploads via the JSON presign path', async () => {
    const env: NodeJS.ProcessEnv = { UPLOADTHING_TOKEN: encodedToken('sk_live_upload') }
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = String(input)
      if (url === 'https://api.uploadthing.com/v6/uploadFiles') {
        expect(init?.headers).toEqual(expect.objectContaining({ 'x-uploadthing-api-key': 'sk_live_upload' }))
        expect(String(init?.body)).toContain('n.csv')
        expect(String(init?.body)).toContain('public-read')
        expect(String(init?.body)).toContain('inline')
        return new Response(JSON.stringify({ data: [{ key: 'blob-1', url: 'https://upload.example/put' }] }), { status: 200 })
      }
      if (url === 'https://upload.example/put') {
        expect(init?.method).toBe('PUT')
        return new Response(null, { status: 200 })
      }
      throw new Error(`unexpected fetch ${url}`)
    }) as unknown as typeof fetch
    const store = new UploadThingBlobStore(env, fetchMock)
    await expect(store.putCsv({ bytes: csvBytes(), filename: 'n.csv' })).resolves.toEqual({
      blobKey: 'blob-1',
      byteSize: 8,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('POSTs the CSV through v6 presigned fields and returns the blob key', async () => {
    const env: NodeJS.ProcessEnv = { UPLOADTHING_TOKEN: 'sk_live_fields' }
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = String(input)
      if (url === 'https://api.uploadthing.com/v6/uploadFiles') {
        return new Response(JSON.stringify({
          data: [{
            key: 'blob-fields',
            url: 'https://s3.example/post',
            fields: { bucket: 'uploadthing', key: 'blob-fields' },
          }],
        }), { status: 200 })
      }
      if (url === 'https://s3.example/post') {
        expect(init?.method).toBe('POST')
        expect(init?.body).toBeInstanceOf(FormData)
        const form = init?.body as FormData
        expect(form.get('bucket')).toBe('uploadthing')
        expect(form.get('key')).toBe('blob-fields')
        expect(form.get('file')).toBeInstanceOf(Blob)
        return new Response(null, { status: 204 })
      }
      throw new Error(`unexpected fetch ${url}`)
    }) as unknown as typeof fetch
    const store = new UploadThingBlobStore(env, fetchMock)
    await expect(store.putCsv({ bytes: csvBytes(), filename: 'tickets.csv' })).resolves.toEqual({
      blobKey: 'blob-fields',
      byteSize: 8,
    })
  })
})
