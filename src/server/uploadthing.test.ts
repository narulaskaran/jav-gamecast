import { describe, expect, it, vi } from 'vitest'
import { DatasetError } from '../dataset/csvTypes'
import { readDatasetIntakeStatus } from './runtimeStatus'
import {
  createCsvBlobStore,
  isUploadThingConfigured,
  readUploadThingToken,
  UploadThingBlobStore,
} from './uploadthing'

const encodedToken = (apiKey: string): string => Buffer.from(JSON.stringify({ apiKey, appId: 'app_demo' })).toString('base64')

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
  })

  it('extracts the inner API key from an UploadThing dashboard token', () => {
    const token = encodedToken('sk_live_from_token')
    expect(readUploadThingToken({ UPLOADTHING_TOKEN: token })).toBe('sk_live_from_token')
    expect(isUploadThingConfigured({ UPLOADTHING_TOKEN: token })).toBe(true)
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

  it('sends the parsed API key and uploads via the JSON presign path', async () => {
    const env: NodeJS.ProcessEnv = { UPLOADTHING_TOKEN: encodedToken('sk_live_upload') }
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = String(input)
      if (url === 'https://api.uploadthing.com/v6/uploadFiles') {
        expect(init?.headers).toEqual(expect.objectContaining({ 'x-uploadthing-api-key': 'sk_live_upload' }))
        expect(String(init?.body)).toContain('n.csv')
        return new Response(JSON.stringify({ data: [{ key: 'blob-1', url: 'https://upload.example/put' }] }), { status: 200 })
      }
      if (url === 'https://upload.example/put') {
        expect(init?.method).toBe('PUT')
        return new Response(null, { status: 200 })
      }
      throw new Error(`unexpected fetch ${url}`)
    }) as unknown as typeof fetch
    const store = new UploadThingBlobStore(env, fetchMock)
    await expect(store.putCsv({ bytes: new TextEncoder().encode('a,b\n1,2\n'), filename: 'n.csv' })).resolves.toEqual({
      blobKey: 'blob-1',
      byteSize: 8,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
