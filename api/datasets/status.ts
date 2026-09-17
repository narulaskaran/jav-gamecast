import { createDatasetStatusHandler } from '../../src/server/datasetApi'
import { datasetIntake } from '../../src/server/analysisRuntime'

export default createDatasetStatusHandler(datasetIntake)
