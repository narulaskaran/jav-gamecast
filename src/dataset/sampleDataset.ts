import {
  FOOTBALL_FIXTURE_ID,
  footballFixtureDisclosure,
  footballFixtureModelInputFields,
  footballFixtureSourceLinks,
  getHalftimeModelInput,
} from '../fixtures/footballTimeline'
import { CSV_PREVIEW_ROWS } from './csvTypes'
import { asAnalysisRow, type DatasetPreview } from '../shared/dataset'
import { inferSampleColumns } from './sampleColumns'

const rows = getHalftimeModelInput().map((row) => asAnalysisRow(row))

export const SAMPLE_DATASET_ID = FOOTBALL_FIXTURE_ID
export const SAMPLE_DATASET_NAME = 'Sample dataset'

export const getSampleDatasetPreview = (): DatasetPreview => ({
  datasetId: SAMPLE_DATASET_ID,
  sourceType: 'fixture',
  displayName: SAMPLE_DATASET_NAME,
  byteSize: 0,
  contentHash: 'fixture',
  encoding: 'utf-8',
  delimiter: ',',
  columns: inferSampleColumns(rows, [...footballFixtureModelInputFields]),
  acceptedRowCount: rows.length,
  previewRows: rows.slice(0, CSV_PREVIEW_ROWS),
  validationWarnings: [],
  publicDataWarning: 'Sample rows are a checked-in demo fixture. They are public.',
  attribution: {
    disclosure: footballFixtureDisclosure,
    sourceUrl: footballFixtureSourceLinks.csvFallback,
    licenseUrl: footballFixtureSourceLinks.license,
  },
})
