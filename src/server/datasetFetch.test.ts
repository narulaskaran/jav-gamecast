import { describe, expect, it, vi } from 'vitest'
import { CSV_MAX_BYTES, DatasetError, DATASET_ERROR_COPY } from '../dataset/csvTypes'
import { fetchPublicCsv } from './datasetFetch'

describe('public CSV fetch errors', () => {
  it('maps timeout, 404, HTML, and network failures to distinct codes', async () => {
    const timeout: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })
    await expect(fetchPublicCsv('https://example.com/slow.csv', { fetch: timeout, timeoutMs: 5, lookup: async () => ['93.184.216.34'] })).rejects.toMatchObject({
      code: 'URL_TIMEOUT',
      message: DATASET_ERROR_COPY.URL_TIMEOUT,
    })

    const notFound: typeof fetch = vi.fn(async () => new Response('missing', { status: 404, headers: { 'content-type': 'text/plain' } }))
    await expect(fetchPublicCsv('https://example.com/missing.csv', { fetch: notFound, lookup: async () => ['93.184.216.34'] })).rejects.toMatchObject({
      code: 'URL_NOT_FOUND',
    })

    const html: typeof fetch = vi.fn(async () => new Response('<html><body>hi</body></html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    await expect(fetchPublicCsv('https://example.com/', { fetch: html, lookup: async () => ['93.184.216.34'] })).rejects.toMatchObject({
      code: 'NOT_CSV',
    })

    const boom: typeof fetch = vi.fn(async () => { throw new TypeError('fetch failed') })
    await expect(fetchPublicCsv('https://example.com/data.csv', { fetch: boom, lookup: async () => ['93.184.216.34'] })).rejects.toMatchObject({
      code: 'URL_FETCH_FAILED',
      message: 'Could not fetch that CSV URL.',
    })
  })

  it('still rejects non-HTTPS URLs before fetch', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('should not fetch') })
    await expect(fetchPublicCsv('http://example.com/data.csv', { fetch: fetchMock })).rejects.toMatchObject({ code: 'URL_NOT_HTTPS' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an oversized stream without Content-Length before buffering the whole body', async () => {
    const chunk = new Uint8Array(64 * 1024)
    const oversize: typeof fetch = vi.fn(async () => new Response(new ReadableStream({
      pull(controller) {
        controller.enqueue(chunk)
      },
    }), { status: 200, headers: { 'content-type': 'text/csv' } }))
    await expect(fetchPublicCsv('https://example.com/huge.csv', { fetch: oversize, lookup: async () => ['93.184.216.34'] })).rejects.toBeInstanceOf(DatasetError)
    await expect(fetchPublicCsv('https://example.com/huge.csv', { fetch: oversize, lookup: async () => ['93.184.216.34'] })).rejects.toMatchObject({
      code: 'CSV_TOO_LARGE',
      statusCode: 413,
    })
  })
})
