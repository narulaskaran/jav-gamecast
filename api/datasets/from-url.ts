import { createDatasetFromUrlHandler } from '../../src/server/datasetApi.js'
import { datasetIntake } from '../../src/server/analysisRuntime.js'

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
}

export default createDatasetFromUrlHandler(datasetIntake)
