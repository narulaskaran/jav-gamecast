import { beforeEach, describe, expect, it, vi } from 'vitest'
import { footballFixture, getHalftimeModelInput, FOOTBALL_FIXTURE_ID, FOOTBALL_FIXTURE_SCHEMA } from '../fixtures/footballTimeline'
import { SAMPLE_WIN_LIKELIHOOD_TASK, SAMPLE_WIN_NOUL_QUERY } from '../shared/questionKind'
import { parseJevQueryJson } from '../shared/jevQuery'
import {
  ANALYSIS_MAX_CALLS,
  ANALYSIS_MAX_ROWS,
  AnalysisError,
  AnalysisService,
  InMemoryAnalysisStore,
  InMemoryDatasetSource,
  type AnalysisClassifier,
  type AnalysisDraftProvider,
  type AnalysisSnapshot,
} from './analysis'

const query = 'Classify the most likely leading player from the visible first-half play inputs.'
const choiceClasses = ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie']
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

    const drafted = await service.draft({ fixtureId: FOOTBALL_FIXTURE_ID, task: 'Find a useful H1 classifier.' })
    expect(drafted).toEqual({
      fixtureId: FOOTBALL_FIXTURE_ID,
      datasetId: FOOTBALL_FIXTURE_ID,
      sourceType: 'fixture',
      query: expect.any(String),
      metadata: expect.objectContaining({ provider: 'openrouter', rowCount: 39, inputHalf: 'H1', labelHalf: 'H2' }),
    })
    expect(parseJevQueryJson(drafted.query)).toEqual(expect.objectContaining({ type: expect.stringMatching(/^(noul|score|choice)$/), instructions: query }))
    expect(drafted.query.trim().startsWith('{')).toBe(true)
    expect(draftCalls).toHaveLength(1)
    expect(classifierCalls).toHaveLength(0)
  })

  it('honors a win-likelihood prompt instead of the fixture player-class fallback', async () => {
    const draftCalls: Array<{ task: string; classes?: readonly string[] }> = []
    const service = serviceWith(makeClassifier([]), {
      async draft(input) {
        draftCalls.push(input)
        return {
          query: 'Classify the most likely leading player from K.Walker, C.Kupp, J.Smith-Njigba, or Other.',
          model: 'openrouter/test',
          questionKind: 'choice',
          classes: ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie'],
        }
      },
    })
    const drafted = await service.draft({ fixtureId: FOOTBALL_FIXTURE_ID, task: SAMPLE_WIN_LIKELIHOOD_TASK })
    expect(parseJevQueryJson(drafted.query)).toEqual({ type: 'noul', instructions: SAMPLE_WIN_NOUL_QUERY })
    expect(drafted.query).not.toBe(SAMPLE_WIN_LIKELIHOOD_TASK)
    expect(drafted.metadata.questionKind).toBe('noul')
    expect(drafted.metadata.classes).toEqual([])
    expect(JSON.stringify(drafted)).not.toMatch(/K\.Walker|C\.Kupp|Smith-Njigba|Other\/Tie/)
    expect(draftCalls[0]?.task).toBe(SAMPLE_WIN_LIKELIHOOD_TASK)
    expect(draftCalls[0]?.classes ?? []).toEqual([])
  })

  it('starts a Noul run from edited Jev query JSON', async () => {
    const jsonQuery = JSON.stringify({ type: 'noul', instructions: SAMPLE_WIN_NOUL_QUERY }, null, 2)
    const service = serviceWith(makeClassifier([]))
    const started = await service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query: jsonQuery })
    expect(started.questionKind).toBe('noul')
    expect(started.classes).toEqual([])
    expect(started.query).toBe(jsonQuery)
  })

  it('runs a Noul win-likelihood analysis from Jev values, not CSV wpa', async () => {
    const calls: Array<{ questionKind?: string; row: Record<string, unknown> }> = []
    const classifier: AnalysisClassifier = {
      async classify(input) {
        calls.push({ questionKind: input.questionKind, row: input.row })
        return { model: 'jev-latest', questionKind: 'noul', value: 0.41 }
      },
    }
    const service = serviceWith(classifier)
    const started = await service.start({
      fixtureId: FOOTBALL_FIXTURE_ID,
      query: SAMPLE_WIN_NOUL_QUERY,
      questionKind: 'noul',
    })
    const completed = await service.run(started.analysisId)
    expect(started.questionKind).toBe('noul')
    expect(completed.resultRows[0]).toEqual(expect.objectContaining({ value: 0.41 }))
    expect(completed.resultRows[0]?.selectedClass).toBeUndefined()
    expect(calls[0]?.questionKind).toBe('noul')
    expect(calls[0]?.row).toHaveProperty('wpa')
    expect(completed.resultRows.every((row) => row.value === 0.41 && row.value !== row.input.wpa)).toBe(true)
  })

  it('runs only H1 rows, reports bounded progress, and sorts replay rows deterministically', async () => {
    const calls: unknown[] = []
    const service = serviceWith(makeClassifier(calls))
    const started = await service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query, classes: choiceClasses })
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
    const started = await service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query, classes: choiceClasses })
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
    await expect(service.start({ fixtureId: 'not-the-fixture', query, classes: choiceClasses })).rejects.toMatchObject({ code: 'DATASET_NOT_FOUND', statusCode: 404 })
    await expect(service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query: '  ', classes: choiceClasses })).rejects.toMatchObject({ code: 'INVALID_QUERY', statusCode: 400 })
    await expect(service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query: 'x'.repeat(20_001), classes: choiceClasses })).rejects.toMatchObject({ code: 'INVALID_QUERY', statusCode: 400 })
    expect(calls).toHaveLength(0)
  })

  it('returns a bounded share snapshot without invoking a provider', async () => {
    const calls: unknown[] = []
    const service = serviceWith(makeClassifier(calls))
    const started = await service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query, classes: choiceClasses })
    const shared = await service.share(started.analysisId)
    expect(shared).toEqual(expect.objectContaining({ analysisId: started.analysisId, fixtureId: FOOTBALL_FIXTURE_ID, status: 'queued' }))
    expect(JSON.stringify(shared)).not.toContain('OPENROUTER_KEY')
    expect(calls).toHaveLength(0)
  })

  it('persists each BYOD row prediction before the next classify call', async () => {
    const store = new InMemoryAnalysisStore()
    const seenCounts: number[] = []
    const classifier: AnalysisClassifier = {
      async classify() {
        seenCounts.push(store.get('byod-1')?.resultRows.length ?? 0)
        return { model: 'jev-latest', selectedClass: 'urgent', probabilities: { urgent: 0.7, routine: 0.3 } }
      },
    }
    const service = new AnalysisService({
      store,
      classifier,
      draftProvider: makeDraftProvider([]),
      datasets: new InMemoryDatasetSource([{
        datasetId: 'tickets',
        fixtureId: 'tickets',
        sourceType: 'upload',
        displayName: 'tickets.csv',
        columns: ['message'],
        rows: [{ message: 'one' }, { message: 'two' }, { message: 'three' }],
        classes: ['urgent', 'routine'],
      }]),
      now: () => 1_800_000_000_000,
      idFactory: () => 'byod-1',
    })
    const started = await service.start({ datasetId: 'tickets', query, classes: ['urgent', 'routine'] })
    expect(started.status).toBe('queued')
    expect(started.progress.totalRows).toBe(3)
    const completed = await service.run(started.analysisId)
    expect(completed.status).toBe('complete')
    expect(completed.resultRows).toHaveLength(3)
    expect(seenCounts).toEqual([0, 1, 2])
  })

  it('keeps bounds explicit for future fixtures', () => {
    expect(ANALYSIS_MAX_CALLS).toBe(5_000)
    expect(ANALYSIS_MAX_ROWS).toBe(5_000)
    expect(FOOTBALL_FIXTURE_SCHEMA).toHaveLength(31)
  })

  it('requeues retryable provider failures and resumes from the persisted partial result', async () => {
    let calls = 0
    const classifier: AnalysisClassifier = {
      async classify() {
        calls += 1
        if (calls === 2) throw new AnalysisError('JEV_TIMEOUT', 'timeout', 504, true)
        return classification()
      },
    }
    const service = serviceWith(classifier)
    const started = await service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query, analysisId: 'recoverable-analysis', classes: choiceClasses })
    const failed = await service.run(started.analysisId)
    expect(failed).toMatchObject({ status: 'error', progress: { completedRows: 1 }, error: { code: 'JEV_TIMEOUT', retryable: true } })
    const recovered = await service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query, analysisId: started.analysisId })
    expect(recovered).toMatchObject({ status: 'queued', progress: { completedRows: 1 }, resultRows: expect.arrayContaining([expect.objectContaining({ rowIndex: 0 })]) })
    await expect(service.run(started.analysisId)).resolves.toMatchObject({ status: 'complete', progress: { completedRows: 39 } })
  })

  it('requeues a stale running snapshot without dropping completed rows', async () => {
    const store = new InMemoryAnalysisStore()
    const service = new AnalysisService({
      store,
      classifier: makeClassifier([]),
      draftProvider: makeDraftProvider([]),
      idFactory: () => 'stale-analysis',
      now: () => 1_800_000_000_000,
    })
    const started = await service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query, classes: choiceClasses })
    store.put({ ...started, status: 'running', updatedAt: new Date(1_800_000_000_000 - 16 * 60_000).toISOString(), progress: { ...started.progress, completedRows: 2, completedCalls: 2 }, resultRows: [{ ...classification(), rowIndex: 0, input: getHalftimeModelInput(footballFixture)[0] }, { ...classification(), rowIndex: 1, input: getHalftimeModelInput(footballFixture)[1] }] })
    await expect(service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query })).resolves.toMatchObject({ status: 'queued', progress: { completedRows: 2 }, resultRows: expect.any(Array) })
  })

  it('suppresses duplicate execution across independent service instances with a durable claim', async () => {
    const store = new InMemoryAnalysisStore()
    let releaseFirst: (() => void) | undefined
    let calls = 0
    const classifier: AnalysisClassifier = {
      async classify() {
        calls += 1
        if (calls === 1) await new Promise<void>((resolve) => { releaseFirst = resolve })
        return classification()
      },
    }
    const make = () => new AnalysisService({ store, classifier, draftProvider: makeDraftProvider([]), idFactory: () => `owner-${calls}`, now: () => 1_800_000_000_000 })
    const firstService = make()
    const secondService = make()
    const started = await firstService.start({ fixtureId: FOOTBALL_FIXTURE_ID, query, analysisId: 'claimed-analysis', classes: choiceClasses })
    const first = firstService.run(started.analysisId)
    await vi.waitFor(() => expect(calls).toBe(1))
    await expect(secondService.run(started.analysisId)).resolves.toMatchObject({ status: 'running' })
    expect(calls).toBe(1)
    releaseFirst?.()
    await expect(first).resolves.toMatchObject({ status: 'complete' })
  })
})
