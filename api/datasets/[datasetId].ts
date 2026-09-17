import { createDatasetReadHandler } from '../../src/server/datasetApi'
import { datasetIntake } from '../../src/server/analysisRuntime'

export default createDatasetReadHandler(datasetIntake)
