import { createDatasetFromCsvHandler } from '../../src/server/datasetApi.js'
import { datasetIntake } from '../../src/server/analysisRuntime.js'

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
  api: {
    bodyParser: {
      sizeLimit: '6mb',
    },
  },
}

export default createDatasetFromCsvHandler(datasetIntake)
