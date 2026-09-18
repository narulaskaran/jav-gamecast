import { createDatasetFromUrlHandler } from '../../src/server/datasetApi.js'
import { datasetIntake } from '../../src/server/analysisRuntime.js'

export default createDatasetFromUrlHandler(datasetIntake)
