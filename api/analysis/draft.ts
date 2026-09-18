import { createAnalysisDraftHandler } from '../../src/server/analysisApi.js'
import { analysisService } from '../../src/server/analysisRuntime.js'

export default createAnalysisDraftHandler(analysisService)
