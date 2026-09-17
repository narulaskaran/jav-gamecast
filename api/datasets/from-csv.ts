import { createDatasetFromCsvHandler } from '../../src/server/datasetApi'
import { datasetIntake } from '../../src/server/analysisRuntime'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '6mb',
    },
  },
}

export default createDatasetFromCsvHandler(datasetIntake)
