import {
  FOOTBALL_FIXTURE_ID,
  footballFixtureDisclosure,
  footballFixtureSourceLinks,
  footballFixtureWinLikelihoodInputFields,
  getWinLikelihoodModelInput,
} from '../fixtures/footballTimeline'
import { asAnalysisRow, type DatasetPreview } from '../shared/dataset'
import { inferSampleColumns } from './sampleColumns'
import { SAMPLE_DATASET_NAME } from '../shared/sampleDatasetName'

const rows = getWinLikelihoodModelInput().map((row) => asAnalysisRow(row))

export const SAMPLE_DATASET_ID = FOOTBALL_FIXTURE_ID
export { SAMPLE_DATASET_NAME }

export const getSampleDatasetPreview = (): DatasetPreview => ({
  datasetId: SAMPLE_DATASET_ID,
  sourceType: 'fixture',
  displayName: SAMPLE_DATASET_NAME,
  byteSize: 0,
  contentHash: 'fixture',
  encoding: 'utf-8',
  delimiter: ',',
  columns: inferSampleColumns(rows, [...footballFixtureWinLikelihoodInputFields]),
  acceptedRowCount: rows.length,
  previewRows: rows,
  validationWarnings: [],
  publicDataWarning: 'Sample rows are a checked-in demo fixture. They are public.',
  attribution: {
    disclosure: footballFixtureDisclosure,
    sourceUrl: footballFixtureSourceLinks.csvFallback,
    licenseUrl: footballFixtureSourceLinks.license,
  },
})
