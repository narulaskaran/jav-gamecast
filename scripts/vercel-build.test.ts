import { describe, expect, it } from 'vitest'
import { shouldDeployConvex } from './vercel-build.mjs'

describe('Vercel Convex deploy gate', () => {
  it('deploys Convex functions only on Vercel production builds', () => {
    expect(shouldDeployConvex({ VERCEL_ENV: 'production' })).toBe(true)
    expect(shouldDeployConvex({ VERCEL_ENV: 'preview' })).toBe(false)
    expect(shouldDeployConvex({ VERCEL_ENV: 'development' })).toBe(false)
    expect(shouldDeployConvex({})).toBe(false)
  })
})
