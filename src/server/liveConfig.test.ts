import { describe, expect, it } from 'vitest'
import { isConvexWriteConfigured, readConvexRuntimeConfig, readLiveRuntimeConfig, readPublicRuntimeConfig } from './liveConfig'

describe('live environment validation', () => {
  it('fails closed without a Convex deployment or provider key', () => {
    expect(readPublicRuntimeConfig({ FEATURED_GAME_ID: 'game' })).toBeUndefined()
    expect(readLiveRuntimeConfig({ CONVEX_URL: 'https://demo.convex.cloud', FEATURED_GAME_ID: 'game', CRON_SECRET: 'secret', CONVEX_WRITE_SECRET: 'write-secret' })).toBeUndefined()
  })

  it('treats Convex analysis/dataset config as independent of the featured-game leftover', () => {
    expect(readConvexRuntimeConfig({ CONVEX_URL: 'https://demo.convex.cloud', CONVEX_WRITE_SECRET: 'write-secret' })).toEqual({ convexUrl: 'https://demo.convex.cloud', writeSecret: 'write-secret' })
    expect(isConvexWriteConfigured({ CONVEX_URL: 'https://demo.convex.cloud' })).toBe(false)
  })

  it('requires all server-side live inputs and never reads a VITE key', () => {
    const config = readLiveRuntimeConfig({
      CONVEX_URL: 'https://demo.convex.cloud', FEATURED_GAME_ID: 'game', CRON_SECRET: 'secret', CONVEX_WRITE_SECRET: 'write-secret', JEV_API_KEY: 'key', VITE_TYPESAFE_API_KEY: 'wrong',
    })
    expect(config).toEqual(expect.objectContaining({ convexUrl: 'https://demo.convex.cloud', featuredGameId: 'game', cronSecret: 'secret', convexWriteSecret: 'write-secret', typesafeApiKey: 'key' }))
  })
})
