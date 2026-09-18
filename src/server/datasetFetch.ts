import { CSV_MAX_BYTES, DatasetError } from '../dataset/csvTypes.js'
import { assertPublicHttpsCsvUrl, isResolvedAddressSafe } from '../dataset/urlSafety.js'
import { sniffCsvContentType } from '../dataset/validateDataset.js'

const FETCH_TIMEOUT_MS = 12_000
const MAX_REDIRECTS = 3

export interface DatasetFetchOptions {
  fetch?: typeof fetch
  lookup?: (hostname: string) => Promise<string[]>
  timeoutMs?: number
}

const headerValue = (headers: Headers, name: string): string | undefined => headers.get(name) ?? undefined

const assertSafeHost = async (url: URL, lookup?: (hostname: string) => Promise<string[]>): Promise<void> => {
  assertPublicHttpsCsvUrl(url.toString())
  if (!lookup) return
  try {
    const addresses = await lookup(url.hostname)
    if (addresses.some((address) => !isResolvedAddressSafe(address))) {
      throw new DatasetError('URL_UNSAFE', 'The URL is not a public HTTPS CSV link.')
    }
  } catch (error) {
    if (error instanceof DatasetError) throw error
    throw new DatasetError('URL_NOT_PUBLIC', 'The URL is not a public HTTPS CSV link.')
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
        if (!location || redirect === MAX_REDIRECTS) throw new DatasetError('URL_NOT_PUBLIC', 'The URL is not a public HTTPS CSV link.')
        current = assertPublicHttpsCsvUrl(new URL(location, current).toString())
        await assertSafeHost(current, options.lookup)
        continue
      }
      if (!response.ok) throw new DatasetError('URL_NOT_PUBLIC', 'The URL is not a public HTTPS CSV link.')
      const contentLength = Number(headerValue(response.headers, 'content-length') ?? '0')
      if (Number.isFinite(contentLength) && contentLength > CSV_MAX_BYTES) throw new DatasetError('CSV_TOO_LARGE', 'This file is too big. Maximum size is 5 MB.', 413)
      const contentType = headerValue(response.headers, 'content-type')
      const buffer = new Uint8Array(await response.arrayBuffer())
      if (buffer.byteLength > CSV_MAX_BYTES) throw new DatasetError('CSV_TOO_LARGE', 'This file is too big. Maximum size is 5 MB.', 413)
      sniffCsvContentType(contentType, buffer)
      return { bytes: buffer, finalUrl: current.toString(), contentType }
    } catch (error) {
      if (error instanceof DatasetError) throw error
      throw new DatasetError('URL_NOT_PUBLIC', 'The URL is not a public HTTPS CSV link.')
    } finally {
      clearTimeout(timer)
    }
  }
  throw new DatasetError('URL_NOT_PUBLIC', 'The URL is not a public HTTPS CSV link.')
}
