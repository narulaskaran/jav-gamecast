import { CSV_MAX_BYTES, DatasetError, DATASET_ERROR_COPY } from '../dataset/csvTypes.js'
import { assertPublicHttpsCsvUrl, isResolvedAddressSafe } from '../dataset/urlSafety.js'
import { sniffCsvContentType } from '../dataset/validateDataset.js'

export const FETCH_TIMEOUT_MS = 12_000
const MAX_REDIRECTS = 3

export interface DatasetFetchOptions {
  fetch?: typeof fetch
  lookup?: (hostname: string) => Promise<string[]>
  timeoutMs?: number
}

const headerValue = (headers: Headers, name: string): string | undefined => headers.get(name) ?? undefined

const isAbortError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false
  const record = error as { name?: unknown; code?: unknown }
  return record.name === 'AbortError' || record.code === 20 || record.code === 'ABORT_ERR'
}

const tooLarge = (): DatasetError => new DatasetError('CSV_TOO_LARGE', 'This file is too big. Maximum size is 5 MB.', 413)

const wrapFetchError = (error: unknown): DatasetError => {
  if (error instanceof DatasetError) return error
  if (isAbortError(error)) return new DatasetError('URL_TIMEOUT', DATASET_ERROR_COPY.URL_TIMEOUT, 504)
  return new DatasetError('URL_FETCH_FAILED', 'Could not fetch that CSV URL.')
}

const concatChunks = (chunks: readonly Uint8Array[], total: number): Uint8Array => {
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export const readLimitedBody = async (response: Response, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> => {
  const contentLength = Number(response.headers.get('content-length') ?? 'NaN')
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw tooLarge()
  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = new Uint8Array(await response.arrayBuffer())
    if (buffer.byteLength > maxBytes) throw tooLarge()
    return buffer
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    while (true) {
      if (signal?.aborted) throw new DatasetError('URL_TIMEOUT', DATASET_ERROR_COPY.URL_TIMEOUT, 504)
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      received += value.byteLength
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw tooLarge()
      }
      chunks.push(value)
    }
  } finally {
    try { reader.releaseLock() } catch { /* already released */ }
  }
  return concatChunks(chunks, received)
}

const statusError = (status: number): DatasetError => {
  if (status === 404 || status === 410) return new DatasetError('URL_NOT_FOUND', 'That CSV URL was not found.', 404)
  return new DatasetError('URL_FETCH_FAILED', `The CSV URL returned HTTP ${status}.`)
}

const assertSafeHost = async (url: URL, lookup?: (hostname: string) => Promise<string[]>): Promise<void> => {
  assertPublicHttpsCsvUrl(url.toString())
  if (!lookup) return
  try {
    const addresses = await lookup(url.hostname)
    if (addresses.some((address) => !isResolvedAddressSafe(address))) {
      throw new DatasetError('URL_UNSAFE', 'That URL is not a public CSV link.')
    }
  } catch (error) {
    if (error instanceof DatasetError) throw error
    throw new DatasetError('URL_FETCH_FAILED', 'Could not resolve that CSV host.')
  }
}

export const fetchPublicCsv = async (rawUrl: string, options: DatasetFetchOptions = {}): Promise<{ bytes: Uint8Array; finalUrl: string; contentType?: string }> => {
  const fetcher = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS
  let current = assertPublicHttpsCsvUrl(rawUrl)
  await assertSafeHost(current, options.lookup)

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetcher(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        headers: { Accept: 'text/csv, text/plain;q=0.9, */*;q=0.1' },
        signal: controller.signal,
      })
      if (response.status >= 300 && response.status < 400) {
        const location = headerValue(response.headers, 'location')
        if (!location) throw new DatasetError('URL_FETCH_FAILED', 'The CSV URL redirected without a location.')
        if (redirect === MAX_REDIRECTS) throw new DatasetError('URL_FETCH_FAILED', 'The CSV URL redirected too many times.')
        current = assertPublicHttpsCsvUrl(new URL(location, current).toString())
        await assertSafeHost(current, options.lookup)
        continue
      }
      if (!response.ok) throw statusError(response.status)
      const contentType = headerValue(response.headers, 'content-type')
      const buffer = await readLimitedBody(response, CSV_MAX_BYTES, controller.signal)
      sniffCsvContentType(contentType, buffer)
      return { bytes: buffer, finalUrl: current.toString(), contentType }
    } catch (error) {
      throw wrapFetchError(error)
    } finally {
      clearTimeout(timer)
    }
  }
  throw new DatasetError('URL_FETCH_FAILED', 'Could not fetch that CSV URL.')
}
