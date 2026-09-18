import { DatasetError, type DatasetFailure } from '../dataset/csvTypes.js'
import { AnalysisError } from './analysis.js'
import type { DatasetIntakeService } from './datasetIntake.js'
import type { DatasetIntakeStatus, DatasetPreview } from '../shared/dataset.js'

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

const errorShape = (error: unknown): { statusCode: number; code: string; failure?: DatasetFailure; message?: string } | undefined => {
  if (typeof error !== 'object' || error === null) return undefined
  const record = error as { statusCode?: unknown; code?: unknown; failure?: unknown; message?: unknown; name?: unknown }
  const statusCode = record.statusCode
  const code = record.code
  if (typeof statusCode !== 'number' || typeof code !== 'string') {
    if (error instanceof DatasetError || error instanceof AnalysisError) {
      return {
        statusCode: error.statusCode,
        code: error.code,
        ...('failure' in error && typeof error.failure === 'string' ? { failure: error.failure as DatasetFailure } : {}),
        message: error.message,
      }
    }
    return undefined
  }
  const failure = typeof record.failure === 'string' && /^[A-Z0-9_]{1,64}$/.test(record.failure)
    ? record.failure as DatasetFailure
    : undefined
  const message = typeof record.message === 'string' ? record.message : undefined
  return { statusCode, code, ...(failure ? { failure } : {}), ...(message ? { message } : {}) }
}

const publicErrorMessage = (message: string | undefined, code: string): string | undefined => {
  const text = message?.trim()
  if (!text || text === code) return undefined
  if (text.length > 240) return undefined
  if (/\bsk_|bearer\s|hmac-sha256=/i.test(text)) return undefined
  return text
}

const redactLogText = (text: string): string => (
  text
    .replace(/sk_[A-Za-z0-9]+/g, 'sk_[redacted]')
    .replace(/bearer\s+\S+/ig, 'bearer [redacted]')
    .replace(/hmac-sha256=[0-9a-f]+/ig, 'hmac-sha256=[redacted]')
    .slice(0, 500)
)

const logIntakeError = (error: unknown, shaped?: { code: string; failure?: string }): void => {
  const name = error instanceof Error ? error.name : typeof error
  const message = error instanceof Error ? redactLogText(error.message) : 'non-error'
  const stack = error instanceof Error ? error.stack?.split('\n').slice(0, 6).join('\n') : undefined
  console.error('[datasets] intake failed', {
    error: shaped?.code ?? 'DATASET_UNAVAILABLE',
    failure: shaped?.failure ?? 'UNCAUGHT',
    name,
    message,
    ...(stack ? { stack } : {}),
  })
}

const errorResponse = (response: DatasetApiResponse, error: unknown): void => {
  const shaped = errorShape(error)
  logIntakeError(error, shaped)
  if (shaped) {
    const message = publicErrorMessage(shaped.message, shaped.code)
    response.status(shaped.statusCode).json({
      error: shaped.code,
      ...(shaped.failure ? { failure: shaped.failure } : {}),
      ...(message ? { message } : {}),
    })
    return
  }
  response.status(500).json({
    error: 'DATASET_UNAVAILABLE',
    failure: 'UNCAUGHT',
    message: 'CSV intake failed on this deployment.',
  })
}

export const createDatasetStatusHandler = (intake: { status: () => DatasetIntakeStatus }): DatasetApiHandler => async (request, response) => {
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
