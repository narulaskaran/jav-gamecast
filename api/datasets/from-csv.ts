import { createDatasetFromCsvHandler } from '../../src/server/datasetApi.js'
import { datasetIntake } from '../../src/server/analysisRuntime.js'

export const config = {
  runtime: 'nodejs',
  api: {
    bodyParser: {
      sizeLimit: '6mb',
    },
  },
}

export default createDatasetFromCsvHandler(datasetIntake)
