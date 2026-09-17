import { beforeEach, describe, expect, it, vi } from 'vitest'
import { footballFixture, getHalftimeModelInput, FOOTBALL_FIXTURE_ID, FOOTBALL_FIXTURE_SCHEMA } from '../fixtures/footballTimeline'
import {
  ANALYSIS_MAX_CALLS,
  ANALYSIS_MAX_ROWS,
  AnalysisService,
  InMemoryAnalysisStore,
  type AnalysisClassifier,
  type AnalysisDraftProvider,
  type AnalysisSnapshot,
} from './analysis'

const query = 'Classify the most likely leading player from the visible first-half play inputs.'
const classification = (selectedClass = 'K.Walker') => ({
  model: 'jev-latest',
  selectedClass,
  probabilities: { 'K.Walker': 0.7, 'C.Kupp': 0.1, 'J.Smith-Njigba': 0.1, 'Other/Tie': 0.1 },
  confidence: 0.7,
})

const makeClassifier = (calls: Array<unknown>, result = classification()): AnalysisClassifier => ({
  async classify(input) {
    calls.push(input)
    return result
  },
})

const makeDraftProvider = (calls: Array<unknown>, result = { query, model: 'openrouter/test' }): AnalysisDraftProvider => ({
  async draft(input) {
    calls.push(input)
    return result
  },
})

const serviceWith = (classifier: AnalysisClassifier, draftProvider = makeDraftProvider([])) => new AnalysisService({
  store: new InMemoryAnalysisStore(),
  classifier,
  draftProvider,
  now: () => 1_800_000_000_000,
  idFactory: () => 'analysis-test-1',
})

describe('analysis domain contract', () => {
  it('drafts without invoking the classifier or Jev', async () => {
    const classifierCalls: unknown[] = []
    const draftCalls: unknown[] = []
    const service = serviceWith(makeClassifier(classifierCalls), makeDraftProvider(draftCalls))

    await expect(service.draft({ fixtureId: FOOTBALL_FIXTURE_ID, task: 'Find a useful H1 classifier.' })).resolves.toEqual({
      fixtureId: FOOTBALL_FIXTURE_ID,
      query,
      metadata: expect.objectContaining({ provider: 'openrouter', rowCount: 39 }),
    })
    expect(draftCalls).toHaveLength(1)
    expect(classifierCalls).toHaveLength(0)
  })

  it('runs only H1 rows, reports bounded progress, and sorts replay rows deterministically', async () => {
    const calls: unknown[] = []
    const service = serviceWith(makeClassifier(calls))
    const started = await service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query })
    expect(started.status).toBe('queued')
    expect(started.progress).toEqual({ completedRows: 0, totalRows: 39, completedCalls: 0, totalCalls: 39 })

    const completed = await service.run(started.analysisId)
    expect(completed.status).toBe('complete')
    expect(completed.resultRows).toHaveLength(39)
    expect(completed.resultRows.map((row) => row.rowIndex)).toEqual([...Array(39).keys()])
    expect(completed.progress).toEqual({ completedRows: 39, totalRows: 39, completedCalls: 39, totalCalls: 39 })
    expect(calls).toHaveLength(39)
    for (const call of calls as Array<{ row: Record<string, unknown> }>) {
      expect(call.row).not.toHaveProperty('game_date')
      expect(call.row).not.toHaveProperty('posteam_score')
      expect(call.row).not.toHaveProperty('defteam_score')
      expect(call.row).not.toHaveProperty('final_score')
    }
    expect(completed.resultRows[0]?.input).toEqual(getHalftimeModelInput(footballFixture)[0])
  })

  it('coalesces duplicate runs and never invokes Jev twice', async () => {
    const calls: unknown[] = []
    let resolve: ((value: ReturnType<typeof classification>) => void) | undefined
    let invocation = 0
    const classifier: AnalysisClassifier = {
      classify: vi.fn(() => {
        invocation += 1
        if (invocation === 1) return new Promise<ReturnType<typeof classification>>((done) => { resolve = done })
        return Promise.resolve(classification())
      }),
    }
    const service = serviceWith(classifier)
    const started = await service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query })
    const first = service.run(started.analysisId)
    const second = service.run(started.analysisId)
    await vi.waitFor(() => expect(classifier.classify).toHaveBeenCalledTimes(1))
    resolve?.(classification())
    await expect(Promise.all([first, second])).resolves.toSatisfy((results: AnalysisSnapshot[]) => results[0] === results[1])
    expect(classifier.classify).toHaveBeenCalledTimes(39)
    expect(calls).toHaveLength(0)
  })

  it('rejects an invalid fixture and invalid query before any provider call', async () => {
    const calls: unknown[] = []
    const service = serviceWith(makeClassifier(calls))
    await expect(service.start({ fixtureId: 'not-the-fixture', query })).rejects.toMatchObject({ code: 'INVALID_FIXTURE', statusCode: 400 })
    await expect(service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query: '  ' })).rejects.toMatchObject({ code: 'INVALID_QUERY', statusCode: 400 })
    await expect(service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query: 'x'.repeat(20_001) })).rejects.toMatchObject({ code: 'INVALID_QUERY', statusCode: 400 })
    expect(calls).toHaveLength(0)
  })

  it('returns a bounded share snapshot without invoking a provider', async () => {
    const calls: unknown[] = []
    const service = serviceWith(makeClassifier(calls))
    const started = await service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query })
    const shared = await service.share(started.analysisId)
    expect(shared).toEqual(expect.objectContaining({ analysisId: started.analysisId, fixtureId: FOOTBALL_FIXTURE_ID, status: 'queued' }))
    expect(JSON.stringify(shared)).not.toContain('OPENROUTER_KEY')
    expect(calls).toHaveLength(0)
  })

  it('keeps bounds explicit for future fixtures', () => {
    expect(ANALYSIS_MAX_CALLS).toBe(5_000)
    expect(ANALYSIS_MAX_ROWS).toBe(5_000)
    expect(FOOTBALL_FIXTURE_SCHEMA).toHaveLength(31)
  })
})
