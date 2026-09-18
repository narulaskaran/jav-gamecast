import { describe, expect, it, vi } from 'vitest'
import { DatasetError } from './csvTypes'
import { fetchJsonWithTimeout } from './intakeClient'

describe('intake client fetch', () => {
  it('maps aborts and gateway timeouts to a clear CSV timeout', async () => {
    const aborting: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })
    await expect(fetchJsonWithTimeout('https://example.com/from-url', { method: 'POST' }, { fetch: aborting, timeoutMs: 5 })).rejects.toMatchObject({
      code: 'CSV_TIMEOUT',
      message: 'This CSV took too long to load. Try a smaller file or a faster link.',
    })

    const gateway: typeof fetch = vi.fn(async () => new Response('Gateway Timeout', { status: 504 }))
    await expect(fetchJsonWithTimeout('/api/datasets/from-url', { method: 'POST' }, { fetch: gateway, timeoutMs: 1_000 })).rejects.toBeInstanceOf(DatasetError)
    await expect(fetchJsonWithTimeout('/api/datasets/from-url', { method: 'POST' }, { fetch: gateway, timeoutMs: 1_000 })).rejects.toMatchObject({
      code: 'CSV_TIMEOUT',
      statusCode: 504,
    })
  })
})
