import { createDatasetFromUrlHandler } from '../../src/server/datasetApi.js'
import { datasetIntake } from '../../src/server/analysisRuntime.js'

export const config = {
  runtime: 'nodejs',
}

export default createDatasetFromUrlHandler(datasetIntake)
