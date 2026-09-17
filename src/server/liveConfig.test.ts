import { describe, expect, it } from 'vitest'
import { readLiveRuntimeConfig, readPublicRuntimeConfig } from './liveConfig'

describe('live environment validation', () => {
  it('fails closed without a Convex deployment or provider key', () => {
    expect(readPublicRuntimeConfig({ FEATURED_GAME_ID: 'game' })).toBeUndefined()
    expect(readLiveRuntimeConfig({ CONVEX_URL: 'https://demo.convex.cloud', FEATURED_GAME_ID: 'game', CRON_SECRET: 'secret', CONVEX_WRITE_SECRET: 'write-secret' })).toBeUndefined()
  })

  it('requires all server-side live inputs and never reads a VITE key', () => {
    const config = readLiveRuntimeConfig({
      CONVEX_URL: 'https://demo.convex.cloud', FEATURED_GAME_ID: 'game', CRON_SECRET: 'secret', CONVEX_WRITE_SECRET: 'write-secret', JEV_API_KEY: 'key', VITE_TYPESAFE_API_KEY: 'wrong',
    })
    expect(config).toEqual(expect.objectContaining({ convexUrl: 'https://demo.convex.cloud', featuredGameId: 'game', cronSecret: 'secret', convexWriteSecret: 'write-secret', typesafeApiKey: 'key' }))
  })
})
