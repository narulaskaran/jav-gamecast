import { describe, expect, it } from 'vitest'
import { FOOTBALL_FIXTURE_ID } from '../fixtures/footballTimeline'
import { AnalysisService, InMemoryAnalysisStore, type AnalysisClassifier, type AnalysisDraftProvider } from './analysis'
import { createAnalysisDraftHandler, createAnalysisReadHandler, createAnalysisRunHandler } from './analysisApi'

type ResponseState = { code?: number; body?: unknown; headers: Record<string, string> }
const response = (state: ResponseState) => ({
  status(code: number) { state.code = code; return this },
  json(body: unknown) { state.body = body; return this },
  setHeader(name: string, value: string) { state.headers[name] = value; return this },
  end() { return this },
})
const query = 'Classify H1 rows.'
const choiceClasses = ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie']
const service = () => new AnalysisService({
  store: new InMemoryAnalysisStore(),
  draftProvider: { async draft() { return { query, model: 'openrouter/test' } } } satisfies AnalysisDraftProvider,
  classifier: { async classify() { return { model: 'jev-latest', selectedClass: 'K.Walker', probabilities: { 'K.Walker': 0.7, 'C.Kupp': 0.1, 'J.Smith-Njigba': 0.1, 'Other/Tie': 0.1 }, confidence: 0.7 } } } satisfies AnalysisClassifier,
  idFactory: () => 'analysis-api-1',
  now: () => 1_800_000_000_000,
})

describe('analysis API contract', () => {
  it('rejects malformed draft bodies and does not include provider details', async () => {
    const state: ResponseState = { headers: {} }
    await createAnalysisDraftHandler(service())({ method: 'POST', headers: {}, body: '{"fixtureId":' }, response(state))
    expect(state.code).toBe(400)
    expect(state.body).toEqual({ error: 'INVALID_JSON' })
  })

  it('drafts through OpenRouter boundary only', async () => {
    const state: ResponseState = { headers: {} }
    await createAnalysisDraftHandler(service())({ method: 'POST', headers: {}, body: { fixtureId: FOOTBALL_FIXTURE_ID, task: 'draft' } }, response(state))
    expect(state.code).toBe(200)
    expect(state.body).toEqual(expect.objectContaining({ fixtureId: FOOTBALL_FIXTURE_ID, query, metadata: expect.objectContaining({ inputHalf: 'H1', labelHalf: 'H2' }) }))
  })

  it('starts a run with queued status and reads it without starting another provider call', async () => {
    const instance = service()
    const runState: ResponseState = { headers: {} }
    await createAnalysisRunHandler(instance)({ method: 'POST', headers: {}, body: { fixtureId: FOOTBALL_FIXTURE_ID, query, classes: choiceClasses } }, response(runState))
    expect(runState.code).toBe(202)
    const analysisId = (runState.body as { analysisId: string }).analysisId
    const readState: ResponseState = { headers: {} }
    await createAnalysisReadHandler(instance)({ method: 'GET', headers: {}, query: { analysisId } }, response(readState))
    expect(readState.code).toBe(200)
    expect(readState.body).toEqual(expect.objectContaining({ analysisId, status: expect.stringMatching(/queued|running|complete/) }))
  })

  it('supports the public share read path with GET only', async () => {
    const instance = service()
    const runState: ResponseState = { headers: {} }
    await createAnalysisRunHandler(instance)({ method: 'POST', headers: {}, body: { fixtureId: FOOTBALL_FIXTURE_ID, query, classes: choiceClasses } }, response(runState))
    const analysisId = (runState.body as { analysisId: string }).analysisId
    const shareState: ResponseState = { headers: {} }
    await createAnalysisReadHandler(instance, { share: true })({ method: 'GET', headers: {}, query: { analysisId } }, response(shareState))
    expect(shareState.code).toBe(200)
    expect(shareState.body).toEqual(expect.objectContaining({ analysisId, fixtureId: FOOTBALL_FIXTURE_ID }))
    const postState: ResponseState = { headers: {} }
    await createAnalysisReadHandler(instance, { share: true })({ method: 'POST', headers: {}, query: { analysisId } }, response(postState))
    expect(postState.code).toBe(405)
  })
})
