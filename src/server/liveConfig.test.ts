import { describe, expect, it } from 'vitest'
import { isConvexWriteConfigured, readConvexRuntimeConfig, readConvexUrl, readLiveRuntimeConfig, readPublicRuntimeConfig } from './liveConfig'

describe('live environment validation', () => {
  it('fails closed without a Convex deployment or provider key', () => {
    expect(readPublicRuntimeConfig({ FEATURED_GAME_ID: 'game' })).toBeUndefined()
    expect(readLiveRuntimeConfig({ CONVEX_URL: 'https://demo.convex.cloud', FEATURED_GAME_ID: 'game', CRON_SECRET: 'secret', CONVEX_WRITE_SECRET: 'write-secret' })).toBeUndefined()
  })

  it('treats Convex analysis/dataset config as independent of the featured-game leftover', () => {
    expect(readConvexRuntimeConfig({ CONVEX_URL: 'https://demo.convex.cloud', CONVEX_WRITE_SECRET: 'write-secret' })).toEqual({ convexUrl: 'https://demo.convex.cloud', writeSecret: 'write-secret' })
    expect(isConvexWriteConfigured({ CONVEX_URL: 'https://demo.convex.cloud' })).toBe(false)
  })

  it('accepts VITE_CONVEX_URL and trailing slashes as the public Convex HTTP URL', () => {
    expect(readConvexUrl({ VITE_CONVEX_URL: 'https://demo.convex.cloud/' })).toBe('https://demo.convex.cloud')
    expect(readConvexRuntimeConfig({
      VITE_CONVEX_URL: 'https://demo.convex.cloud/',
      CONVEX_WRITE_SECRET: 'write-secret',
    })).toEqual({ convexUrl: 'https://demo.convex.cloud', writeSecret: 'write-secret' })
    expect(isConvexWriteConfigured({
      VITE_CONVEX_URL: 'https://demo.convex.cloud',
      CONVEX_WRITE_SECRET: 'write-secret',
    })).toBe(true)
    expect(readConvexUrl({ CONVEX_URL: 'https://primary.convex.cloud', VITE_CONVEX_URL: 'https://alias.convex.cloud' })).toBe('https://primary.convex.cloud')
    expect(readConvexUrl({ CONVEX_URL: 'https://not-convex.example' })).toBeUndefined()
  })

  it('requires all server-side live inputs and never reads a VITE key', () => {
    const config = readLiveRuntimeConfig({
      CONVEX_URL: 'https://demo.convex.cloud', FEATURED_GAME_ID: 'game', CRON_SECRET: 'secret', CONVEX_WRITE_SECRET: 'write-secret', JEV_API_KEY: 'key', VITE_TYPESAFE_API_KEY: 'wrong',
    })
    expect(config).toEqual(expect.objectContaining({ convexUrl: 'https://demo.convex.cloud', featuredGameId: 'game', cronSecret: 'secret', convexWriteSecret: 'write-secret', typesafeApiKey: 'key' }))
  })
})
