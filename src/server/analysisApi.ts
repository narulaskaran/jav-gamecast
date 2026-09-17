import { DatasetError } from '../dataset/csvTypes'
import { AnalysisError, type AnalysisService } from './analysis'
import type { AnalysisSnapshot } from '../shared/analysis'

export interface AnalysisApiRequest {
  method?: string
  headers?: Record<string, string | string[] | undefined>
  body?: unknown
  query?: Record<string, string | string[] | undefined>
}

export interface AnalysisApiResponse {
  status: (code: number) => AnalysisApiResponse
  json: (body: unknown) => AnalysisApiResponse
  setHeader: (name: string, value: string) => AnalysisApiResponse
  end: () => void
}

export type AnalysisApiHandler = (request: AnalysisApiRequest, response: AnalysisApiResponse) => Promise<void>

const queryValue = (request: AnalysisApiRequest, name: string): string | undefined => {
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

const applyHeaders = (response: AnalysisApiResponse): void => {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'application/json')
}

const errorResponse = (response: AnalysisApiResponse, error: unknown): void => {
  if (error instanceof DatasetError) {
    response.status(error.statusCode).json({ error: error.code })
    return
  }
  const statusCode = error instanceof AnalysisError ? error.statusCode : 500
  const code = error instanceof AnalysisError ? error.code : 'ANALYSIS_UNAVAILABLE'
  response.status(statusCode).json({ error: code })
}

const snapshotBody = (snapshot: AnalysisSnapshot): AnalysisSnapshot => snapshot

export const createAnalysisDraftHandler = (service: AnalysisService): AnalysisApiHandler => async (request, response) => {
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
    const result = await service.draft({
      fixtureId: typeof body.fixtureId === 'string' ? body.fixtureId : undefined,
      datasetId: typeof body.datasetId === 'string' ? body.datasetId : undefined,
      task: body.task as string,
    })
    response.status(200).json(result)
  } catch (error) {
    errorResponse(response, error)
  }
}

export const createAnalysisRunHandler = (service: AnalysisService, options: { schedule?: (task: Promise<unknown>) => void } = {}): AnalysisApiHandler => async (request, response) => {
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
    const snapshot = await service.start({
      fixtureId: typeof body.fixtureId === 'string' ? body.fixtureId : undefined,
      datasetId: typeof body.datasetId === 'string' ? body.datasetId : undefined,
      query: body.query as string,
      analysisId: body.analysisId as string | undefined,
      classes: Array.isArray(body.classes) ? body.classes as string[] : undefined,
    })
    const execution = service.run(snapshot.analysisId)
    if (options.schedule) {
      try {
        options.schedule(execution.catch(() => undefined))
      } catch {
        await execution
      }
    } else {
      await execution
    }
    response.status(202).json(snapshotBody(snapshot))
  } catch (error) {
    errorResponse(response, error)
  }
}

export const createAnalysisReadHandler = (service: AnalysisService, options: { share?: boolean } = {}): AnalysisApiHandler => async (request, response) => {
  applyHeaders(response)
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    response.status(405).json({ error: 'METHOD_NOT_ALLOWED' })
    return
  }
  const analysisId = queryValue(request, 'analysisId') ?? queryValue(request, 'id')
  if (!analysisId) {
    response.status(400).json({ error: 'INVALID_ANALYSIS_ID' })
    return
  }
  try {
    const snapshot = options.share ? await service.share(analysisId) : await service.get(analysisId)
    response.status(200).json(snapshotBody(snapshot))
  } catch (error) {
    errorResponse(response, error)
  }
}
