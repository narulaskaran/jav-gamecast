import { createDatasetStatusHandler } from '../../src/server/datasetApi.js'
import { readDatasetIntakeStatus } from '../../src/server/runtimeStatus.js'

export default createDatasetStatusHandler({ status: readDatasetIntakeStatus })
