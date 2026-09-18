import { CSV_MAX_BYTES, DATASET_ERROR_COPY, DatasetError } from '../dataset/csvTypes.js'
import { assertPublicHttpsCsvUrl, isResolvedAddressSafe } from '../dataset/urlSafety.js'
import { sniffCsvContentType } from '../dataset/validateDataset.js'

/** Fail with a shaped timeout before a platform kill turns into a silent hang. */
const FETCH_TIMEOUT_MS = 8_000
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

const wrapFetchError = (error: unknown): DatasetError => {
  if (error instanceof DatasetError) return error
  if (isAbortError(error)) return new DatasetError('URL_TIMEOUT', DATASET_ERROR_COPY.URL_TIMEOUT, 504)
  return new DatasetError('URL_FETCH_FAILED', DATASET_ERROR_COPY.URL_FETCH_FAILED)
}

const statusError = (status: number): DatasetError => {
  if (status === 404 || status === 410) return new DatasetError('URL_NOT_FOUND', DATASET_ERROR_COPY.URL_NOT_FOUND, 404)
  if (status === 408 || status === 504) return new DatasetError('URL_TIMEOUT', DATASET_ERROR_COPY.URL_TIMEOUT, 504)
  return new DatasetError('URL_FETCH_FAILED', `The CSV URL returned HTTP ${status}.`)
}

const assertSafeHost = async (url: URL, lookup?: (hostname: string) => Promise<string[]>): Promise<void> => {
  assertPublicHttpsCsvUrl(url.toString())
  if (!lookup) return
  try {
    const addresses = await lookup(url.hostname)
    if (addresses.some((address) => !isResolvedAddressSafe(address))) {
      throw new DatasetError('URL_UNSAFE', DATASET_ERROR_COPY.URL_UNSAFE)
    }
  } catch (error) {
    if (error instanceof DatasetError) throw error
    throw new DatasetError('URL_FETCH_FAILED', 'Could not resolve that CSV host.')
  }
}

const concatChunks = (chunks: readonly Uint8Array[], byteLength: number): Uint8Array => {
  const buffer = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }
  return buffer
}

const readBoundedBody = async (response: Response): Promise<Uint8Array> => {
  const contentLengthHeader = headerValue(response.headers, 'content-length')
  const contentLength = contentLengthHeader === undefined ? Number.NaN : Number(contentLengthHeader)
  if (Number.isFinite(contentLength) && contentLength > CSV_MAX_BYTES) {
    throw new DatasetError('CSV_TOO_LARGE', DATASET_ERROR_COPY.CSV_TOO_LARGE, 413)
  }
  const body = response.body
  if (!body || typeof body.getReader !== 'function') {
    const buffer = new Uint8Array(await response.arrayBuffer())
    if (buffer.byteLength > CSV_MAX_BYTES) throw new DatasetError('CSV_TOO_LARGE', DATASET_ERROR_COPY.CSV_TOO_LARGE, 413)
    return buffer
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value?.byteLength) continue
    received += value.byteLength
    if (received > CSV_MAX_BYTES) {
      try { await reader.cancel() } catch { /* Stop reading an oversized body. */ }
      throw new DatasetError('CSV_TOO_LARGE', DATASET_ERROR_COPY.CSV_TOO_LARGE, 413)
    }
    chunks.push(value)
  }
  return concatChunks(chunks, received)
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
      const buffer = await readBoundedBody(response)
      sniffCsvContentType(contentType, buffer)
      return { bytes: buffer, finalUrl: current.toString(), contentType }
    } catch (error) {
      throw wrapFetchError(error)
    } finally {
      clearTimeout(timer)
    }
  }
  throw new DatasetError('URL_FETCH_FAILED', DATASET_ERROR_COPY.URL_FETCH_FAILED)
}
