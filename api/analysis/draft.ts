import { createAnalysisDraftHandler } from '../../src/server/analysisApi'
import { analysisService } from '../../src/server/analysisRuntime'

export default createAnalysisDraftHandler(analysisService)
