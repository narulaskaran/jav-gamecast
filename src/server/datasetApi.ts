import { DatasetError } from '../dataset/csvTypes'
import { AnalysisError } from './analysis'
import type { DatasetIntakeService } from './datasetIntake'
import type { DatasetPreview } from '../shared/dataset'

export interface DatasetApiRequest {
  method?: string
  headers?: Record<string, string | string[] | undefined>
  body?: unknown
  query?: Record<string, string | string[] | undefined>
}

export interface DatasetApiResponse {
  status: (code: number) => DatasetApiResponse
  json: (body: unknown) => DatasetApiResponse
  setHeader: (name: string, value: string) => DatasetApiResponse
  end: () => void
}

export type DatasetApiHandler = (request: DatasetApiRequest, response: DatasetApiResponse) => Promise<void>

const queryValue = (request: DatasetApiRequest, name: string): string | undefined => {
  const value = request.query?.[name]
  return Array.isArray(value) ? value[0] : value
}

const parseBody = (body: unknown): Record<string, unknown> | undefined => {
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { return undefined }
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  return body as Record<string, unknown>
}

const applyHeaders = (response: DatasetApiResponse): void => {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'application/json')
}

const errorResponse = (response: DatasetApiResponse, error: unknown): void => {
  if (error instanceof DatasetError) {
    response.status(error.statusCode).json({ error: error.code })
    return
  }
  if (error instanceof AnalysisError) {
    response.status(error.statusCode).json({ error: error.code })
    return
  }
  response.status(500).json({ error: 'DATASET_UNAVAILABLE' })
}

export const createDatasetStatusHandler = (intake: DatasetIntakeService): DatasetApiHandler => async (request, response) => {
  applyHeaders(response)
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    response.status(405).json({ error: 'METHOD_NOT_ALLOWED' })
    return
  }
  response.status(200).json(intake.status())
}

export const createDatasetFromCsvHandler = (intake: DatasetIntakeService): DatasetApiHandler => async (request, response) => {
  applyHeaders(response)
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    response.status(405).json({ error: 'METHOD_NOT_ALLOWED' })
    return
  }
  const body = parseBody(request.body)
  if (!body) {
    response.status(400).json({ error: typeof request.body === 'string' ? 'INVALID_JSON' : 'INVALID_BODY' })
    return
  }
  try {
    const preview: DatasetPreview = await intake.fromCsvText({
      csvText: String(body.csvText ?? ''),
      filename: typeof body.filename === 'string' ? body.filename : undefined,
      displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
    })
    response.status(201).json(preview)
  } catch (error) {
    errorResponse(response, error)
  }
}

export const createDatasetFromUrlHandler = (intake: DatasetIntakeService): DatasetApiHandler => async (request, response) => {
  applyHeaders(response)
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    response.status(405).json({ error: 'METHOD_NOT_ALLOWED' })
    return
  }
  const body = parseBody(request.body)
  if (!body) {
    response.status(400).json({ error: typeof request.body === 'string' ? 'INVALID_JSON' : 'INVALID_BODY' })
    return
  }
  try {
    const preview = await intake.fromPublicUrl({
      url: String(body.url ?? ''),
      displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
    })
    response.status(201).json(preview)
  } catch (error) {
    errorResponse(response, error)
  }
}

export const createDatasetReadHandler = (intake: DatasetIntakeService): DatasetApiHandler => async (request, response) => {
  applyHeaders(response)
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    response.status(405).json({ error: 'METHOD_NOT_ALLOWED' })
    return
  }
  const datasetId = queryValue(request, 'datasetId') ?? queryValue(request, 'id')
  if (!datasetId) {
    response.status(400).json({ error: 'INVALID_DATASET' })
    return
  }
  try {
    response.status(200).json(await intake.get(datasetId))
  } catch (error) {
    errorResponse(response, error)
  }
}

export const createDatasetBrowseHandler = (intake: DatasetIntakeService): DatasetApiHandler => async (request, response) => {
  applyHeaders(response)
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    response.status(405).json({ error: 'METHOD_NOT_ALLOWED' })
    return
  }
  try {
    const datasets = await intake.listPublic()
    response.status(200).json({
      datasets: datasets.map((dataset) => ({
        datasetId: dataset.datasetId,
        displayName: dataset.displayName,
        sourceType: dataset.sourceType,
        acceptedRowCount: dataset.acceptedRowCount,
        createdAt: dataset.createdAt,
      })),
    })
  } catch (error) {
    errorResponse(response, error)
  }
}
