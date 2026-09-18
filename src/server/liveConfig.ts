export interface LiveRuntimeConfig {
  convexUrl: string
  convexWriteSecret: string
  typesafeApiKey: string
  cronSecret: string
  featuredGameId: string
  publicOrigin?: string
}

export interface PublicRuntimeConfig {
  convexUrl: string
  featuredGameId: string
  publicOrigin?: string
}

const CONVEX_CLOUD_URL = /^https:\/\/[^\s.][^\s]*\.convex\.cloud$/i

const required = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const value = env[name]?.trim()
  return value || undefined
}

const normalizeConvexUrl = (value: string | undefined): string | undefined => {
  const convexUrl = value?.trim().replace(/\/+$/, '')
  if (!convexUrl || !CONVEX_CLOUD_URL.test(convexUrl)) return undefined
  return convexUrl
}

/**
 * Convex HTTP URL for the Node runtime. Convex's Vite/Vercel path often
 * provisions `VITE_CONVEX_URL` rather than `CONVEX_URL`; both are the public
 * `.convex.cloud` deployment URL, not a secret.
 */
export const readConvexUrl = (env: NodeJS.ProcessEnv = process.env): string | undefined => (
  normalizeConvexUrl(required(env, 'CONVEX_URL'))
  ?? normalizeConvexUrl(required(env, 'VITE_CONVEX_URL'))
)

export const readConvexRuntimeConfig = (env: NodeJS.ProcessEnv = process.env): { convexUrl: string; writeSecret?: string } | undefined => {
  const convexUrl = readConvexUrl(env)
  if (!convexUrl) return undefined
  return { convexUrl, writeSecret: required(env, 'CONVEX_WRITE_SECRET') }
}

export const isConvexWriteConfigured = (env: NodeJS.ProcessEnv = process.env): boolean => {
  const config = readConvexRuntimeConfig(env)
  return Boolean(config?.convexUrl && config.writeSecret)
}

export const readPublicRuntimeConfig = (env: NodeJS.ProcessEnv = process.env): PublicRuntimeConfig | undefined => {
  const convexUrl = readConvexUrl(env)
  const featuredGameId = required(env, 'FEATURED_GAME_ID')
  if (!convexUrl || !featuredGameId) return undefined
  return { convexUrl, featuredGameId, publicOrigin: required(env, 'LIVE_PUBLIC_ORIGIN') }
}

export const readLiveRuntimeConfig = (env: NodeJS.ProcessEnv = process.env): LiveRuntimeConfig | undefined => {
  const publicConfig = readPublicRuntimeConfig(env)
  const typesafeApiKey = required(env, 'JEV_API_KEY')
  const cronSecret = required(env, 'CRON_SECRET')
  const convexWriteSecret = required(env, 'CONVEX_WRITE_SECRET')
  if (!publicConfig || !typesafeApiKey || !cronSecret || !convexWriteSecret) return undefined
  return { ...publicConfig, convexWriteSecret, typesafeApiKey, cronSecret }
}
