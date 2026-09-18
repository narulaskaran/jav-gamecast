import { DatasetError, DATASET_ERROR_COPY } from './csvTypes.js'
import { INTAKE_CLIENT_TIMEOUT_MS } from './previewBounds.js'

export { INTAKE_CLIENT_TIMEOUT_MS }

const isAbortError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false
  const record = error as { name?: unknown; code?: unknown }
  return record.name === 'AbortError' || record.code === 20 || record.code === 'ABORT_ERR'
}

export const intakeTimeoutError = (statusCode = 504): DatasetError => (
  new DatasetError('CSV_TIMEOUT', DATASET_ERROR_COPY.CSV_TIMEOUT, statusCode)
)

export const afterPaint = (): Promise<void> => new Promise((resolve) => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => resolve())
    return
  }
  setTimeout(resolve, 0)
})

export const fetchJsonWithTimeout = async <T>(
  url: string,
  init: RequestInit,
  options: {
    timeoutMs?: number
    fetch?: typeof fetch
    parseError?: (response: Response) => Promise<Error>
  } = {},
): Promise<T> => {
  const timeoutMs = options.timeoutMs ?? INTAKE_CLIENT_TIMEOUT_MS
  const fetcher = options.fetch ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      signal: controller.signal,
    })
    if (!response.ok) {
      if (response.status === 504 || response.status === 408) throw intakeTimeoutError(response.status)
      if (options.parseError) throw await options.parseError(response)
      throw new DatasetError('URL_FETCH_FAILED', DATASET_ERROR_COPY.URL_FETCH_FAILED, response.status)
    }
    return await response.json() as T
  } catch (error) {
    if (error instanceof DatasetError) throw error
    if (isAbortError(error)) throw intakeTimeoutError()
    throw error
  } finally {
    clearTimeout(timer)
  }
}
