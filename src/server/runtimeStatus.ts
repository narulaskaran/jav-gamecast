import type { DatasetIntakeStatus } from '../shared/dataset.js'
import { isConvexWriteConfigured } from './liveConfig.js'
import { isUploadThingConfigured } from './uploadthing.js'

/**
 * Status for GET /api/datasets/status. Reads env only — never imports the
 * Convex generated client — so a broken adapter cannot 500 this route and
 * falsely report durable storage as missing.
 */
export const readDatasetIntakeStatus = (env: NodeJS.ProcessEnv = process.env): DatasetIntakeStatus => ({
  convex: isConvexWriteConfigured(env),
  uploadThing: isUploadThingConfigured(env),
  sampleAvailable: true,
})
