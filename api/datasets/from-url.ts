import { createDatasetFromUrlHandler } from '../../src/server/datasetApi'
import { datasetIntake } from '../../src/server/analysisRuntime'

export default createDatasetFromUrlHandler(datasetIntake)
