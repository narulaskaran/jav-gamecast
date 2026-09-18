import { waitUntil } from '@vercel/functions'
import { createAnalysisRunHandler } from '../../src/server/analysisApi.js'
import { analysisService } from '../../src/server/analysisRuntime.js'

/** Keep waitUntil long enough for large BYOD pools; Vercel clamps to the plan max. */
export const maxDuration = 800

/** Vercel-supported continuation: the run is retained after the 202 response. */
export default createAnalysisRunHandler(analysisService, {
  schedule: (task) => waitUntil(task),
})
