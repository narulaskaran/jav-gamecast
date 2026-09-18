import type { DatasetIntakeStatus } from '../shared/dataset.js'
import { readConvexUrl } from './liveConfig.js'
import { isUploadThingConfigured } from './uploadthing.js'

const hasWriteSecret = (env: NodeJS.ProcessEnv): boolean => Boolean(env.CONVEX_WRITE_SECRET?.trim())

/**
 * Status for GET /api/datasets/status. Reads env only — never imports the
 * Convex generated client — so a broken adapter cannot 500 this route and
 * falsely report durable storage as missing.
 */
export const readDatasetIntakeStatus = (env: NodeJS.ProcessEnv = process.env): DatasetIntakeStatus => {
  const convexUrl = Boolean(readConvexUrl(env))
  const writeSecret = hasWriteSecret(env)
  const uploadThing = isUploadThingConfigured(env)
  const missingEnv = [
    ...convexUrl ? [] : ['CONVEX_URL'],
    ...writeSecret ? [] : ['CONVEX_WRITE_SECRET'],
    ...uploadThing ? [] : ['UPLOADTHING_TOKEN'],
  ]
  return {
    convex: convexUrl && writeSecret,
    uploadThing,
    sampleAvailable: true,
    ...(missingEnv.length > 0 ? { missingEnv } : {}),
  }
}
