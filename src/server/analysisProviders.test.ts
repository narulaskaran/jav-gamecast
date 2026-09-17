import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OPENROUTER_ENDPOINT,
  OpenRouterConfigurationError,
  OpenRouterDraftProvider,
  TypeSafeClassifierProvider,
  type ClassifierClientBoundary,
} from './analysisProviders'
import { FOOTBALL_FIXTURE_ID, getHalftimeModelInput } from '../fixtures/footballTimeline'
import { AnalysisService, InMemoryAnalysisStore } from './analysis'

const input = getHalftimeModelInput()[0]
const draftBody = (content: unknown) => ({ choices: [{ message: { content } }], model: 'openrouter/test' })
const fetchResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => vi.unstubAllEnvs())

describe('OpenRouter analysis draft adapter', () => {
  it('uses OPENROUTER_KEY server-side and returns only an editable query', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetcher: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init })
      return fetchResponse(draftBody('{"query":"Classify the H1 rows.","notes":"ignore me"}'))
    }
    const result = await new OpenRouterDraftProvider({ apiKey: 'placeholder', fetch: fetcher }).draft({
      fixtureId: FOOTBALL_FIXTURE_ID,
      task: 'Find a useful classification.',
      classes: ['K.Walker', 'Other/Tie'],
    })
    expect(result).toEqual({ query: 'Classify the H1 rows.', model: 'openrouter/test' })
    expect(calls[0]?.url).toBe(OPENROUTER_ENDPOINT)
    expect(String(calls[0]?.init?.headers)).not.toContain('test-openrouter-key')
    expect(JSON.stringify(calls[0]?.init?.body)).toContain('Find a useful classification.')
  })

  it('fails closed when the OpenRouter key is missing', async () => {
    vi.stubEnv('OPENROUTER_KEY', '')
    await expect(new OpenRouterDraftProvider().draft({ fixtureId: FOOTBALL_FIXTURE_ID, task: 'task', classes: ['A', 'B'] })).rejects.toBeInstanceOf(OpenRouterConfigurationError)
  })

  it.each([401, 429, 500])('maps OpenRouter HTTP %s without exposing provider bodies', async (status) => {
    const fetcher: typeof fetch = async () => fetchResponse({ error: { message: 'secret provider body' } }, status)
    await expect(new OpenRouterDraftProvider({ apiKey: 'placeholder', fetch: fetcher }).draft({ fixtureId: FOOTBALL_FIXTURE_ID, task: 'task', classes: ['A', 'B'] })).rejects.toMatchObject({ code: `OPENROUTER_${status}`, statusCode: status === 401 ? 502 : status === 429 ? 503 : 502 })
    await expect(new OpenRouterDraftProvider({ apiKey: 'placeholder', fetch: fetcher }).draft({ fixtureId: FOOTBALL_FIXTURE_ID, task: 'task', classes: ['A', 'B'] })).rejects.not.toThrow('secret provider body')
  })

  it('rejects malformed output and timeouts truthfully', async () => {
    const malformed: typeof fetch = async () => fetchResponse({ choices: [] })
    await expect(new OpenRouterDraftProvider({ apiKey: 'placeholder', fetch: malformed }).draft({ fixtureId: FOOTBALL_FIXTURE_ID, task: 'task', classes: ['A', 'B'] })).rejects.toMatchObject({ code: 'OPENROUTER_MALFORMED', statusCode: 502 })
    const timeout: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })
    await expect(new OpenRouterDraftProvider({ apiKey: 'placeholder', fetch: timeout, timeoutMs: 5 }).draft({ fixtureId: FOOTBALL_FIXTURE_ID, task: 'task', classes: ['A', 'B'] })).rejects.toMatchObject({ code: 'OPENROUTER_TIMEOUT', statusCode: 504 })
  })
})

describe('editable Jev classifier adapter', () => {
  it('fails a run before creating work when JEV_API_KEY is missing', async () => {
    vi.stubEnv('JEV_API_KEY', '')
    const service = new AnalysisService({
      store: new InMemoryAnalysisStore(),
      draftProvider: { async draft() { return { query: 'query', model: 'openrouter/test' } } },
      classifier: new TypeSafeClassifierProvider(),
    })
    await expect(service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query: 'query' })).rejects.toMatchObject({ code: 'JEV_NOT_CONFIGURED', statusCode: 503 })
  })

  it('sends the editable query with one H1 row and parses bounded probabilities', async () => {
    const calls: unknown[] = []
    const client: ClassifierClientBoundary = {
      async systemOne(request) {
        calls.push(request)
        return { model: 'jev-latest', answers: { classification: { type: 'choice', choice: 'K.Walker', probabilities: { 'K.Walker': 0.7, 'C.Kupp': 0.1, 'J.Smith-Njigba': 0.1, 'Other/Tie': 0.1 }, confidence: 0.7 } } }
      },
    }
    const provider = new TypeSafeClassifierProvider({ client })
    await expect(provider.classify({ analysisId: 'analysis-1', fixtureId: FOOTBALL_FIXTURE_ID, query: 'custom query', rowIndex: 0, row: input })).resolves.toMatchObject({ selectedClass: 'K.Walker', confidence: 0.7 })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(expect.objectContaining({ state: { fixtureId: FOOTBALL_FIXTURE_ID, rowIndex: 0, input }, questions: expect.objectContaining({ classification: expect.objectContaining({ instructions: 'custom query' }) }) }))
  })

  it.each([401, 429, 500])('maps Jev HTTP %s to a truthful stable error', async (status) => {
    const fetcher: typeof fetch = async () => fetchResponse({ error: { message: 'provider details' } }, status)
    const provider = new TypeSafeClassifierProvider({ apiKey: 'placeholder', fetch: fetcher })
    const browserWindow = globalThis.window
    vi.stubGlobal('window', undefined)
    try {
      await expect(provider.classify({ analysisId: 'analysis-1', fixtureId: FOOTBALL_FIXTURE_ID, query: 'query', rowIndex: 0, row: input })).rejects.toMatchObject({ code: `JEV_${status}`, statusCode: status === 429 ? 503 : 502 })
    } finally {
      vi.stubGlobal('window', browserWindow)
    }
  })
})
