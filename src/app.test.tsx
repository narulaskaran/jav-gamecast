import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App, canConfirmJevRun, defaultAnalysisApi, hasRunnableQuery, type AnalysisApiClient } from './App'
import { FOOTBALL_FIXTURE_ID, getHalftimeModelInput } from './fixtures/footballTimeline'
import { asAnalysisRow } from './shared/dataset'
import type { AnalysisDraftResult, AnalysisSnapshot } from './shared/analysis'
import { SAMPLE_WIN_LIKELIHOOD_TASK, SAMPLE_WIN_NOUL_QUERY } from './shared/questionKind'
import type { DatasetIntakeStatus, DatasetPreview } from './shared/dataset'

const input = asAnalysisRow(getHalftimeModelInput()[0])

const snapshot = (overrides: Partial<AnalysisSnapshot> = {}): AnalysisSnapshot => ({
  analysisId: 'analysis-demo-1',
  fixtureId: FOOTBALL_FIXTURE_ID,
  datasetId: FOOTBALL_FIXTURE_ID,
  sourceType: 'fixture',
  query: 'Classify each row using the visible columns.',
  status: 'complete',
  createdAt: '2026-09-17T18:00:00.000Z',
  updatedAt: '2026-09-17T18:01:00.000Z',
  progress: { completedRows: 1, totalRows: 39, completedCalls: 1, totalCalls: 39 },
  classes: ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie'],
  columns: ['play_id', 'posteam'],
  currentFixtureRow: { rowIndex: 0, input },
  resultRows: [{ rowIndex: 0, input, model: 'jev-latest', selectedClass: 'K.Walker', probabilities: { 'K.Walker': 0.72, 'C.Kupp': 0.1, 'J.Smith-Njigba': 0.12, 'Other/Tie': 0.06 }, confidence: 0.72 }],
  ...overrides,
})

const draft: AnalysisDraftResult = {
  fixtureId: FOOTBALL_FIXTURE_ID,
  datasetId: FOOTBALL_FIXTURE_ID,
  sourceType: 'fixture',
  query: 'Classify each row using the visible columns.',
  metadata: { provider: 'openrouter', model: 'openai/gpt-4o-mini', rowCount: 39, inputHalf: 'H1', labelHalf: 'H2', classes: ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie'], columns: ['play_id'], displayName: 'Super Bowl Seahawks demo' },
}

const uploaded: DatasetPreview = {
  datasetId: 'dataset-upload-1',
  sourceType: 'upload',
  displayName: 'tickets.csv',
  byteSize: 32,
  contentHash: 'abc',
  encoding: 'utf-8',
  delimiter: ',',
  columns: [{ name: 'message', normalizedName: 'message', inferredType: 'string' }, { name: 'tier', normalizedName: 'tier', inferredType: 'string' }],
  acceptedRowCount: 2,
  previewRows: [{ message: 'hello', tier: 'gold' }],
  validationWarnings: [],
  publicDataWarning: 'public',
}

const makeApi = (overrides: Partial<AnalysisApiClient> = {}): AnalysisApiClient => ({
  draft: vi.fn(async () => draft),
  start: vi.fn(async () => snapshot({ status: 'queued', progress: { completedRows: 0, totalRows: 39, completedCalls: 0, totalCalls: 39 }, resultRows: [], currentFixtureRow: { rowIndex: 0, input } })),
  read: vi.fn(async () => snapshot()),
  share: vi.fn(async () => snapshot()),
  intakeStatus: vi.fn(async (): Promise<DatasetIntakeStatus> => ({ convex: true, uploadThing: true, sampleAvailable: true })),
  createFromCsv: vi.fn(async () => uploaded),
  createFromUrl: vi.fn(async (): Promise<DatasetPreview> => ({ ...uploaded, datasetId: 'dataset-url-1', sourceType: 'public_url', displayName: 'remote.csv' })),
  ...overrides,
})

const startSampleRun = async (api: AnalysisApiClient) => {
  render(<App api={api} />)
  fireEvent.click(screen.getByRole('button', { name: /^try sample$/i }))
  fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
  await screen.findByDisplayValue(draft.query)
  fireEvent.click(screen.getByRole('button', { name: /run jev/i }))
}

describe('Jev playground flow', () => {
  it('renders the engineer playground landing without fetching providers', async () => {
    const api = makeApi()
    render(<App api={api} />)
    expect(screen.getByRole('link', { name: /jev playground home/i })).toBeInTheDocument()
    expect(screen.getByText('Demo')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /run jev on a csv/i })).toBeInTheDocument()
    expect(screen.getByText(/this is an engineer playground for typesafe jev/i)).toBeInTheDocument()
    expect(screen.getByText(/try the sample run, or bring your own csv/i)).toBeInTheDocument()
    expect(screen.getAllByText(/demo playground/i).length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: /super bowl seahawks demo/i })).toBeInTheDocument()
    expect(screen.getByText(/football is the sample, not the product/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /upload \.csv or public https csv url/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/upload csv/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /use public csv url/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^try sample$/i })).toBeInTheDocument()
    expect(screen.queryByText(/espn|gamecast|ask a football question|analyze your business/i)).not.toBeInTheDocument()
    expect(api.draft).not.toHaveBeenCalled()
    expect(api.start).not.toHaveBeenCalled()
    await waitFor(() => expect(api.intakeStatus).toHaveBeenCalled())
  })

  it('unlocks Run Jev from existing Edit query text without another Draft or forced edit', () => {
    expect(hasRunnableQuery('')).toBe(false)
    expect(hasRunnableQuery('   ')).toBe(false)
    expect(hasRunnableQuery(draft.query)).toBe(true)
    expect(canConfirmJevRun({ query: draft.query, starting: false })).toBe(true)
    expect(canConfirmJevRun({ query: draft.query, starting: true })).toBe(false)
    expect(canConfirmJevRun({ query: '  ', starting: false })).toBe(false)
  })

  it('does not fetch on sample task editing, and enables Run Jev after draft without a query edit', async () => {
    const api = makeApi()
    render(<App api={api} />)
    fireEvent.click(screen.getByRole('button', { name: /^try sample$/i }))
    expect(screen.getByLabelText(/^Analysis task$/i)).toHaveValue(SAMPLE_WIN_LIKELIHOOD_TASK)
    expect(api.draft).not.toHaveBeenCalled()
    expect(api.start).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(/^Analysis task$/i), { target: { value: 'Find a first-half signal.' } })
    expect(api.draft).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    await screen.findByDisplayValue(draft.query)
    expect(api.draft).toHaveBeenCalledTimes(1)
    expect(api.start).not.toHaveBeenCalled()
    const runButton = screen.getByRole('button', { name: /run jev/i })
    expect(runButton).toBeEnabled()
    expect(screen.getByText(/review the query, then confirm run jev/i)).toBeInTheDocument()
    fireEvent.click(runButton)
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1))
    expect(api.start).toHaveBeenCalledWith({ datasetId: FOOTBALL_FIXTURE_ID, fixtureId: FOOTBALL_FIXTURE_ID, query: draft.query, classes: draft.metadata.classes, questionKind: draft.metadata.questionKind })
    expect(api.draft).toHaveBeenCalledTimes(1)
  })

  it('keeps Run Jev disabled when Edit query text is cleared, and still accepts a manual edit', async () => {
    const api = makeApi()
    render(<App api={api} />)
    fireEvent.click(screen.getByRole('button', { name: /^try sample$/i }))
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    await screen.findByDisplayValue(draft.query)
    fireEvent.change(screen.getByLabelText(/^Generated query$/i), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: /run jev/i })).toBeDisabled()
    expect(screen.getByText(/enter a query before running jev/i)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^Generated query$/i), { target: { value: 'Use only visible columns.' } })
    expect(screen.getByRole('button', { name: /run jev/i })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /run jev/i }))
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1))
    expect(api.start).toHaveBeenCalledWith({ datasetId: FOOTBALL_FIXTURE_ID, fixtureId: FOOTBALL_FIXTURE_ID, query: 'Use only visible columns.', classes: draft.metadata.classes, questionKind: draft.metadata.questionKind })
  })

  it('renders progress, live chart, processed-row rail, secondary results, and share action', async () => {
    const api = makeApi({ read: vi.fn(async () => snapshot({
      status: 'running',
      progress: { completedRows: 12, totalRows: 39, completedCalls: 12, totalCalls: 39 },
      resultRows: Array.from({ length: 3 }, (_, rowIndex) => ({ rowIndex, input, model: 'jev-latest', selectedClass: 'K.Walker', probabilities: { 'K.Walker': 0.72, 'C.Kupp': 0.1, 'J.Smith-Njigba': 0.12, 'Other/Tie': 0.06 }, confidence: 0.72 })),
    })) })
    await startSampleRun(api)
    expect(await screen.findByText(/running/i)).toBeInTheDocument()
    expect(screen.getByText('12 / 39 rows')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /class distribution/i })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: /chart playhead/i })).toBeInTheDocument()
    const rail = screen.getByRole('complementary', { name: /processed rows/i })
    expect(within(rail).getByRole('button', { name: /row 1 of 39/i })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: /row 3 of 39/i })).toBeInTheDocument()
    expect(within(rail).queryByText(String(input.play_id))).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /current row inspector/i })).not.toBeInTheDocument()
    expect(await screen.findByRole('table', { name: /incremental analysis results/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy shareable public url/i })).toBeInTheDocument()
  })

  it('updates the class chart from incremental running predictions, not only terminal status', async () => {
    const running = (count: number, status: AnalysisSnapshot['status'] = 'running'): AnalysisSnapshot => snapshot({
      status,
      progress: { completedRows: count, totalRows: 3, completedCalls: count, totalCalls: 3 },
      resultRows: Array.from({ length: count }, (_, rowIndex) => ({
        rowIndex,
        input,
        model: 'jev-latest',
        selectedClass: rowIndex === 1 ? 'C.Kupp' : 'K.Walker',
        probabilities: { 'K.Walker': 0.6, 'C.Kupp': 0.4 },
      })),
    })
    let reads = 0
    const api = makeApi({
      start: vi.fn(async () => running(0, 'queued')),
      read: vi.fn(async () => {
        reads += 1
        if (reads === 1) return running(1)
        if (reads === 2) return running(2)
        return running(3, 'complete')
      }),
    })
    await startSampleRun(api)
    expect(await screen.findByText('Waiting for the first row…')).toBeInTheDocument()
    expect(within(screen.getByRole('complementary', { name: /processed rows/i })).queryByRole('button')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Waiting for the first row…')).not.toBeInTheDocument())
    await waitFor(() => expect(document.querySelector('[data-class="K.Walker"]')).toHaveAttribute('data-count', '1'))
    await waitFor(() => expect(document.querySelector('[data-class="C.Kupp"]')).toHaveAttribute('data-count', '1'))
    expect(api.read).toHaveBeenCalled()
  })

  it('charts a Noul win-probability series instead of leftover player-class bars', async () => {
    const noulDraft: AnalysisDraftResult = {
      ...draft,
      query: SAMPLE_WIN_NOUL_QUERY,
      metadata: { ...draft.metadata, questionKind: 'noul', classes: [] },
    }
    const noulRun = snapshot({
      query: SAMPLE_WIN_NOUL_QUERY,
      questionKind: 'noul',
      classes: [],
      status: 'running',
      progress: { completedRows: 3, totalRows: 39, completedCalls: 3, totalCalls: 39 },
      resultRows: Array.from({ length: 3 }, (_, rowIndex) => ({
        rowIndex,
        input: { ...input, wpa: 0.91 },
        model: 'jev-latest',
        questionKind: 'noul' as const,
        value: 0.4 + rowIndex * 0.1,
      })),
    })
    const api = makeApi({
      draft: vi.fn(async () => noulDraft),
      start: vi.fn(async () => noulRun),
      read: vi.fn(async () => noulRun),
    })
    render(<App api={api} />)
    fireEvent.click(screen.getByRole('button', { name: /^try sample$/i }))
    expect(screen.getByLabelText(/^Analysis task$/i)).toHaveValue(SAMPLE_WIN_LIKELIHOOD_TASK)
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    await screen.findByDisplayValue(SAMPLE_WIN_NOUL_QUERY)
    fireEvent.click(screen.getByRole('button', { name: /run jev/i }))
    expect(await screen.findByRole('img', { name: /win probability over play index/i })).toBeInTheDocument()
    expect(document.querySelector('[data-chart-kind="series"]')).toBeTruthy()
    expect(document.querySelector('[data-play-cursor="true"]')).toBeTruthy()
    expect(document.querySelector('[data-series-points="3"]')).toBeTruthy()
    expect(document.querySelector('[data-class="K.Walker"]')).toBeNull()
    expect(document.querySelector('[data-class="Adams"]')).toBeNull()
    const rail = screen.getByRole('complementary', { name: /processed rows/i })
    expect(within(rail).getByRole('button', { name: /row 1 of 39/i })).toBeInTheDocument()
    expect(within(rail).queryByText('K.Walker')).not.toBeInTheDocument()
    expect(api.draft).toHaveBeenCalledWith(expect.objectContaining({ task: SAMPLE_WIN_LIKELIHOOD_TASK }))
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ query: SAMPLE_WIN_NOUL_QUERY, questionKind: 'noul', classes: [] }))
  })

  it('follows the live edge until the user scrubs back, then seeks from the row rail', async () => {
    const running = (count: number): AnalysisSnapshot => snapshot({
      status: 'running',
      currentFixtureRow: { rowIndex: Math.max(0, count - 1), input },
      progress: { completedRows: count, totalRows: 39, completedCalls: count, totalCalls: 39 },
      resultRows: Array.from({ length: count }, (_, rowIndex) => ({
        rowIndex,
        input: { ...input, play_id: Number(input.play_id) + rowIndex },
        model: 'jev-latest',
        selectedClass: rowIndex === 0 ? 'K.Walker' : 'C.Kupp',
        probabilities: { 'K.Walker': 0.6, 'C.Kupp': 0.4 },
      })),
    })
    let reads = 0
    const api = makeApi({
      start: vi.fn(async () => running(0)),
      read: vi.fn(async () => {
        reads += 1
        if (reads === 1) return running(1)
        if (reads === 2) return running(2)
        return running(3)
      }),
    })
    await startSampleRun(api)
    const rail = await screen.findByRole('complementary', { name: /processed rows/i })
    await waitFor(() => expect(within(rail).getByRole('button', { name: /row 2 of 39/i })).toBeInTheDocument())
    await waitFor(() => expect(document.querySelector('[data-class="C.Kupp"]')).toHaveAttribute('data-count', '1'))
    fireEvent.click(within(rail).getByRole('button', { name: /row 1 of 39/i }))
    await waitFor(() => expect(document.querySelector('[data-class="C.Kupp"]')).toHaveAttribute('data-count', '0'))
    expect(within(rail).queryByText(String(input.play_id))).not.toBeInTheDocument()
    await waitFor(() => expect(within(rail).getByRole('button', { name: /row 3 of 39/i })).toBeInTheDocument())
    expect(document.querySelector('[data-class="C.Kupp"]')).toHaveAttribute('data-count', '0')
    fireEvent.change(screen.getByRole('slider', { name: /chart playhead/i }), { target: { value: '2' } })
    fireEvent.pointerUp(screen.getByRole('slider', { name: /chart playhead/i }))
    await waitFor(() => expect(document.querySelector('[data-class="C.Kupp"]')).toHaveAttribute('data-count', '2'))
    expect(await screen.findByRole('table', { name: /incremental analysis results/i })).toBeInTheDocument()
  })

  it('loads upload and public URL datasets into the same draft → chart path', async () => {
    const api = makeApi()
    render(<App api={api} />)
    const file = new File(['message,tier\nhello,gold\n'], 'tickets.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText(/upload csv/i), { target: { files: [file] } })
    expect(await screen.findByRole('heading', { name: 'tickets.csv' })).toBeInTheDocument()
    expect(api.createFromCsv).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /change dataset/i }))
    fireEvent.change(screen.getByLabelText(/public https csv url/i), { target: { value: 'https://example.com/data.csv' } })
    fireEvent.click(screen.getByRole('button', { name: /use public csv url/i }))
    expect(await screen.findByRole('heading', { name: 'remote.csv' })).toBeInTheDocument()
    expect(api.createFromUrl).toHaveBeenCalledWith({ url: 'https://example.com/data.csv' })
  })

  it('uses the same chart and row-rail shell for a BYOD run', async () => {
    const byod = snapshot({
      analysisId: 'analysis-upload-1',
      fixtureId: uploaded.datasetId,
      datasetId: uploaded.datasetId,
      sourceType: 'upload',
      status: 'running',
      classes: ['gold', 'silver'],
      columns: ['message', 'tier'],
      progress: { completedRows: 1, totalRows: 2, completedCalls: 1, totalCalls: 2 },
      resultRows: [{ rowIndex: 0, input: { message: 'hello', tier: 'gold' }, model: 'jev-latest', selectedClass: 'gold', confidence: 0.9 }],
    })
    const api = makeApi({
      draft: vi.fn(async () => ({
        ...draft,
        datasetId: uploaded.datasetId,
        fixtureId: uploaded.datasetId,
        sourceType: 'upload' as const,
        metadata: { ...draft.metadata, displayName: 'tickets.csv', rowCount: 2, classes: ['gold', 'silver'], columns: ['message'] },
      })),
      start: vi.fn(async () => byod),
      read: vi.fn(async () => byod),
    })
    render(<App api={api} />)
    const file = new File(['message,tier\nhello,gold\n'], 'tickets.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText(/upload csv/i), { target: { files: [file] } })
    expect(await screen.findByRole('heading', { name: 'tickets.csv' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    await screen.findByDisplayValue(draft.query)
    expect(screen.getByRole('button', { name: /run jev/i })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /run jev/i }))
    await waitFor(() => expect(api.start).toHaveBeenCalledWith({
      datasetId: uploaded.datasetId,
      fixtureId: undefined,
      query: draft.query,
      classes: ['gold', 'silver'],
    }))
    expect(await screen.findByText('1 / 2 rows')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /class distribution/i })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: /chart playhead/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /row 1 of 2/i })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /current row inspector/i })).not.toBeInTheDocument()
    expect(document.querySelector('[data-class="gold"]')).toHaveAttribute('data-count', '1')
  })

  it('fails closed on upload when CSV storage is not configured and does not fake a run', async () => {
    const api = makeApi({
      intakeStatus: vi.fn(async (): Promise<DatasetIntakeStatus> => ({ convex: true, uploadThing: false, sampleAvailable: true })),
      createFromCsv: vi.fn(async () => { throw new Error('UPLOADTHING_NOT_CONFIGURED') }),
    })
    render(<App api={api} />)
    await waitFor(() => expect(screen.getByText(/csv storage is not configured/i)).toBeInTheDocument())
    expect(screen.getByLabelText(/upload csv/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: /^try sample$/i })).not.toBeDisabled()
    expect(api.start).not.toHaveBeenCalled()
  })

  it('loads and renders a persisted snapshot on direct public share navigation', async () => {
    const analysisId = 'analysis-shared-1'
    const api = makeApi({ share: vi.fn(async (requestedId) => snapshot({ analysisId: requestedId, status: 'complete' })) })
    window.history.pushState({}, '', `/share/${analysisId}`)
    try {
      render(<App api={api} />)
      expect(await screen.findByText('Jev analysis run')).toBeInTheDocument()
      expect(api.share).toHaveBeenCalledWith(analysisId)
      expect(screen.getByText(`Run ${analysisId} · no provider credentials are exposed to the browser`)).toBeInTheDocument()
      expect(await screen.findByRole('table', { name: /incremental analysis results/i })).toBeInTheDocument()
      expect(screen.getByRole('slider', { name: /chart playhead/i })).toBeInTheDocument()
      expect(screen.getByRole('img', { name: /class distribution/i })).toBeInTheDocument()
      expect(screen.getByRole('complementary', { name: /processed rows/i })).toBeInTheDocument()
      expect(screen.queryByLabelText(/^Analysis task$/i)).not.toBeInTheDocument()
    } finally {
      window.history.pushState({}, '', '/')
    }
  })

  it('routes the default public share client through the share API path', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(snapshot()), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await defaultAnalysisApi.share('analysis /1')
      expect(fetchMock).toHaveBeenCalledWith('/api/share/analysis%20%2F1', expect.objectContaining({ method: 'GET' }))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('renders stable API errors and empty results without exposing provider details', async () => {
    const api = makeApi({ start: vi.fn(async () => { throw new Error('ANALYSIS_PROVIDER_ERROR') }) })
    await startSampleRun(api)
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not start/i)
    expect(screen.queryByText(/provider response|api key/i)).not.toBeInTheDocument()
  })
})
