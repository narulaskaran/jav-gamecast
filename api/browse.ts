import { createDatasetBrowseHandler } from '../src/server/datasetApi'
import { datasetIntake } from '../src/server/analysisRuntime'

export default createDatasetBrowseHandler(datasetIntake)
