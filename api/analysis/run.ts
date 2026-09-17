import { waitUntil } from '@vercel/functions'
import { createAnalysisRunHandler } from '../../src/server/analysisApi'
import { analysisService } from '../../src/server/analysisRuntime'

/** Vercel-supported continuation: the run is retained after the 202 response. */
export default createAnalysisRunHandler(analysisService, {
  schedule: (task) => waitUntil(task),
})
