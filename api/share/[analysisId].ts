import { createAnalysisReadHandler } from '../../src/server/analysisApi.js'
import { analysisService } from '../../src/server/analysisRuntime.js'

export default createAnalysisReadHandler(analysisService, { share: true })
