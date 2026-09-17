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

const required = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const value = env[name]?.trim()
  return value || undefined
}

export const readPublicRuntimeConfig = (env: NodeJS.ProcessEnv = process.env): PublicRuntimeConfig | undefined => {
  const convexUrl = required(env, 'CONVEX_URL')
  const featuredGameId = required(env, 'FEATURED_GAME_ID')
  if (!convexUrl || !featuredGameId || !/^https:\/\/[^\s]+\.convex\.cloud$/i.test(convexUrl)) return undefined
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
