import { createAnalysisReadHandler } from '../../src/server/analysisApi'
import { analysisService } from '../../src/server/analysisRuntime'

export default createAnalysisReadHandler(analysisService)
