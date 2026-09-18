import { describe, expect, it } from 'vitest'
import { readDatasetIntakeStatus } from './runtimeStatus'

describe('dataset intake status', () => {
  it('reports Convex and UploadThing from env without loading the Convex client', () => {
    expect(readDatasetIntakeStatus({})).toEqual({
      convex: false,
      uploadThing: false,
      sampleAvailable: true,
      missingEnv: ['CONVEX_URL', 'CONVEX_WRITE_SECRET', 'UPLOADTHING_TOKEN'],
    })
    expect(readDatasetIntakeStatus({
      VITE_CONVEX_URL: 'https://demo.convex.cloud/',
      CONVEX_WRITE_SECRET: 'write-secret',
      UPLOADTHING_TOKEN: 'ut_token',
    })).toEqual({ convex: true, uploadThing: true, sampleAvailable: true })
    expect(readDatasetIntakeStatus({
      CONVEX_URL: 'https://demo.convex.cloud',
    })).toEqual({
      convex: false,
      uploadThing: false,
      sampleAvailable: true,
      missingEnv: ['CONVEX_WRITE_SECRET', 'UPLOADTHING_TOKEN'],
    })
    expect(readDatasetIntakeStatus({
      CONVEX_URL: 'https://demo.convex.cloud',
      CONVEX_WRITE_SECRET: 'write-secret',
      UPLOADTHING_SECRET: 'sk_live_secret',
    })).toEqual({ convex: true, uploadThing: true, sampleAvailable: true })
  })
})
