import { describe, expect, it } from 'vitest'
import { readDatasetIntakeStatus } from './runtimeStatus'

describe('dataset intake status', () => {
  it('reports Convex and UploadThing from env without loading the Convex client', () => {
    expect(readDatasetIntakeStatus({})).toEqual({ convex: false, uploadThing: false, sampleAvailable: true })
    expect(readDatasetIntakeStatus({
      VITE_CONVEX_URL: 'https://demo.convex.cloud/',
      CONVEX_WRITE_SECRET: 'write-secret',
      UPLOADTHING_TOKEN: 'ut_token',
    })).toEqual({ convex: true, uploadThing: true, sampleAvailable: true })
  })
})
