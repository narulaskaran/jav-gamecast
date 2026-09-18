import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, canConfirmJevRun, defaultAnalysisApi, hasRunnableQuery, queryRunFooter, type AnalysisApiClient } from './App'
import { FOOTBALL_FIXTURE_ID, getHalftimeModelInput } from './fixtures/footballTimeline'
import { asAnalysisRow } from './shared/dataset'
import type { AnalysisDraftResult, AnalysisSnapshot } from './shared/analysis'
import { SAMPLE_WIN_LIKELIHOOD_TASK, SAMPLE_WIN_NOUL_QUERY } from './shared/questionKind'
import { formatDraftQueryForEditor, parseJevQueryJson } from './shared/jevQuery'
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

const draftQueryJson = formatDraftQueryForEditor({
  query: 'Classify each row using the visible columns.',
  questionKind: 'choice',
  classes: ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie'],
})
const noulQueryJson = formatDraftQueryForEditor({
  query: SAMPLE_WIN_NOUL_QUERY,
  questionKind: 'noul',
  classes: [],
})

const draft: AnalysisDraftResult = {
  fixtureId: FOOTBALL_FIXTURE_ID,
  datasetId: FOOTBALL_FIXTURE_ID,
  sourceType: 'fixture',
  query: draftQueryJson,
  metadata: { provider: 'openrouter', model: 'openai/gpt-4o-mini', rowCount: 39, inputHalf: 'H1', labelHalf: 'H2', questionKind: 'choice', classes: ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie'], columns: ['play_id'], displayName: '2026 Super Bowl Demo' },
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
  await screen.findByLabelText(/^Jev query JSON$/i)
  fireEvent.click(screen.getByRole('button', { name: /run jev/i }))
}

describe('Jev playground flow', () => {
  afterEach(() => {
    window.localStorage.clear()
    document.documentElement.classList.remove('dark')
    delete document.documentElement.dataset.theme
    document.documentElement.style.colorScheme = ''
  })
  it('renders a quiet idle landing with sample and BYOD only', async () => {
    const api = makeApi()
    render(<App api={api} />)
    expect(screen.getByRole('link', { name: /jev playground home/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /run jev on a csv/i })).toBeInTheDocument()
    expect(screen.queryByText(/bring a dataset\. ask a question\. see jev classify every row/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /choose a dataset/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /2026 super bowl demo/i })).toBeInTheDocument()
    expect(screen.queryByText(/football is the sample, not the product/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/same live chart as the sample/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /upload \.csv or public https csv url/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/upload csv/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /use public csv url/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^try sample$/i })).toBeInTheDocument()
    expect(document.querySelector('[data-stage="intake"]')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: /analysis task/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /jev query json/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/playground limits|5 mb|5,000|engineer playground|how a run works|demo playground/i)).not.toBeInTheDocument()
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
    expect(canConfirmJevRun({ query: '{not-json', starting: false })).toBe(false)
    expect(canConfirmJevRun({ query: SAMPLE_WIN_LIKELIHOOD_TASK, starting: false })).toBe(false)
    expect(queryRunFooter({ query: draft.query, starting: false, hasSnapshot: false })).toBeUndefined()
    expect(queryRunFooter({ query: draft.query, starting: true, hasSnapshot: false })).toBe('Starting…')
    expect(queryRunFooter({ query: draft.query, starting: false, hasSnapshot: true })).toBeUndefined()
    expect(queryRunFooter({ query: '{not-json', starting: false, hasSnapshot: false })).toBe('Valid Jev JSON required.')
    expect(queryRunFooter({ query: '', starting: false, hasSnapshot: false })).toBe('Enter Jev query JSON before running.')
    expect(queryRunFooter({ query: '', starting: true, hasSnapshot: false })).toBe('Starting…')
  })

  it('does not fetch on sample task editing, and enables Run Jev after draft without a query edit', async () => {
    const api = makeApi()
    render(<App api={api} />)
    fireEvent.click(screen.getByRole('button', { name: /^try sample$/i }))
    expect(document.querySelector('[data-stage="task"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^try sample$/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /run jev on a csv/i })).toBeInTheDocument()
    expect(screen.queryByText(/bring a dataset\. ask a question\. see jev classify every row/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /choose a dataset/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Analysis task$/i)).toHaveValue(SAMPLE_WIN_LIKELIHOOD_TASK)
    expect(screen.getByText('71 rows')).toBeInTheDocument()
    expect(screen.getByText(/\d+ columns · showing first 8 of 71/i)).toBeInTheDocument()
    expect(screen.queryByText(/delimiter/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/not evidence of model quality/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^source$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^license$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /2026 super bowl demo/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'posteam_score' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'defteam_score' })).toBeInTheDocument()
    const previewTable = screen.getByRole('table', { name: /dataset preview/i })
    expect(within(previewTable).getByRole('columnheader', { name: 'wpa' })).toBeInTheDocument()
    expect(within(previewTable).getByRole('columnheader', { name: 'fumble' })).toBeInTheDocument()
    expect(within(previewTable).getAllByRole('columnheader').length).toBeGreaterThan(6)
    expect(within(previewTable).getAllByRole('row')).toHaveLength(9)
    expect(screen.getByText(/showing first 8 of 71/i)).toBeInTheDocument()
    expect(api.draft).not.toHaveBeenCalled()
    expect(api.start).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(/^Analysis task$/i), { target: { value: 'Find a first-half signal.' } })
    expect(api.draft).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    const editor = await screen.findByLabelText(/^Jev query JSON$/i)
    expect(document.querySelector('[data-stage="query"]')).toBeTruthy()
    expect((editor as HTMLTextAreaElement).value).not.toBe(SAMPLE_WIN_LIKELIHOOD_TASK)
    expect(screen.queryByLabelText(/^Generated query$/i)).not.toBeInTheDocument()
    expect(api.draft).toHaveBeenCalledTimes(1)
    expect(api.start).not.toHaveBeenCalled()
    const runButton = screen.getByRole('button', { name: /run jev/i })
    expect(runButton).toBeEnabled()
    expect(screen.getByRole('button', { name: /^copy$/i })).toBeInTheDocument()
    expect(document.querySelector('[data-stage="query"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^try sample$/i })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /class distribution|win probability/i })).not.toBeInTheDocument()
    fireEvent.click(runButton)
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1))
    expect(document.querySelector('[data-stage="run"]')).toBeTruthy()
    expect(api.start).toHaveBeenCalledWith({ datasetId: FOOTBALL_FIXTURE_ID, fixtureId: FOOTBALL_FIXTURE_ID, query: draftQueryJson, classes: draft.metadata.classes, questionKind: 'choice' })
    expect(api.draft).toHaveBeenCalledTimes(1)
  })

  it('keeps Starting… in the query footer while Run is in flight', async () => {
    let finish: ((value: AnalysisSnapshot) => void) | undefined
    const pending = new Promise<AnalysisSnapshot>((resolve) => { finish = resolve })
    const api = makeApi({
      start: vi.fn(() => pending),
    })
    render(<App api={api} />)
    fireEvent.click(screen.getByRole('button', { name: /^try sample$/i }))
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    await screen.findByLabelText(/^Jev query JSON$/i)
    expect(screen.queryByText(/review the json, then run jev/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/draft builds the editable/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /run jev/i }))
    expect(await screen.findByRole('button', { name: /starting/i })).toBeDisabled()
    expect(document.querySelector('.query-card .form-footer span')).toHaveTextContent('Starting…')
    expect(screen.queryByText(/enter jev query json before running/i)).not.toBeInTheDocument()
    finish?.(snapshot({ status: 'queued', progress: { completedRows: 0, totalRows: 71, completedCalls: 0, totalCalls: 71 }, resultRows: [], currentFixtureRow: { rowIndex: 0, input } }))
    await waitFor(() => expect(document.querySelector('[data-stage="run"]')).toBeTruthy())
    expect(screen.queryByText(/enter jev query json before running/i)).not.toBeInTheDocument()
    expect(document.querySelector('.query-card .form-footer span')).toBeNull()
  })

  it('drafts the Jev query JSON into the editor, not a prose paraphrase of the task', async () => {
    const api = makeApi()
    render(<App api={api} />)
    fireEvent.click(screen.getByRole('button', { name: /^try sample$/i }))
    expect(screen.getByLabelText(/^Analysis task$/i)).toHaveValue(SAMPLE_WIN_LIKELIHOOD_TASK)
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    const editor = await screen.findByLabelText(/^Jev query JSON$/i)
    const parsed = parseJevQueryJson((editor as HTMLTextAreaElement).value)
    expect(parsed?.type).toMatch(/^(noul|score|choice)$/)
    expect((editor as HTMLTextAreaElement).value).toBe(JSON.stringify(parsed, null, 2))
    expect((editor as HTMLTextAreaElement).value.trim().startsWith('{')).toBe(true)
    expect((editor as HTMLTextAreaElement).value).toMatch(/"type"\s*:/)
    expect((editor as HTMLTextAreaElement).value).not.toBe(SAMPLE_WIN_LIKELIHOOD_TASK)
    expect(screen.queryByLabelText(/^Generated query$/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^jev query$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /run jev/i })).toBeEnabled()
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith((editor as HTMLTextAreaElement).value))
  })

  it('runs after the user edits the Jev query JSON', async () => {
    const api = makeApi()
    render(<App api={api} />)
    fireEvent.click(screen.getByRole('button', { name: /^try sample$/i }))
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    await screen.findByLabelText(/^Jev query JSON$/i)
    const edited = formatDraftQueryForEditor({
      query: 'Will SEA cover given this play state?',
      questionKind: 'noul',
      classes: [],
    })
    fireEvent.change(screen.getByLabelText(/^Jev query JSON$/i), { target: { value: edited } })
    expect(screen.getByRole('button', { name: /run jev/i })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /run jev/i }))
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1))
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({
      query: edited,
      questionKind: 'noul',
      classes: [],
    }))
  })

  it('keeps Run Jev disabled when Edit query text is cleared, and still accepts a manual edit', async () => {
    const api = makeApi()
    render(<App api={api} />)
    fireEvent.click(screen.getByRole('button', { name: /^try sample$/i }))
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    await screen.findByLabelText(/^Jev query JSON$/i)
    fireEvent.change(screen.getByLabelText(/^Jev query JSON$/i), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: /run jev/i })).toBeDisabled()
    expect(screen.getByText(/enter jev query json before running/i)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^Jev query JSON$/i), { target: { value: '{not-json' } })
    expect(screen.getByRole('button', { name: /run jev/i })).toBeDisabled()
    expect(screen.getByText(/valid jev json required/i)).toBeInTheDocument()
    const edited = formatDraftQueryForEditor({
      query: 'Use only visible columns.',
      questionKind: 'choice',
      classes: draft.metadata.classes,
    })
    fireEvent.change(screen.getByLabelText(/^Jev query JSON$/i), { target: { value: edited } })
    expect(screen.getByRole('button', { name: /run jev/i })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /run jev/i }))
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1))
    expect(api.start).toHaveBeenCalledWith({ datasetId: FOOTBALL_FIXTURE_ID, fixtureId: FOOTBALL_FIXTURE_ID, query: edited, classes: draft.metadata.classes, questionKind: 'choice' })
  })

  it('renders progress, live chart, processed-row rail, and share action', async () => {
    const api = makeApi({ read: vi.fn(async () => snapshot({
      status: 'running',
      progress: { completedRows: 12, totalRows: 39, completedCalls: 12, totalCalls: 39 },
      resultRows: Array.from({ length: 3 }, (_, rowIndex) => ({ rowIndex, input, model: 'jev-latest', selectedClass: 'K.Walker', probabilities: { 'K.Walker': 0.72, 'C.Kupp': 0.1, 'J.Smith-Njigba': 0.12, 'Other/Tie': 0.06 }, confidence: 0.72 })),
    })) })
    await startSampleRun(api)
    expect(await screen.findByText('12 / 39 rows')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Class distribution' })).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /class distribution/i })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: /chart playhead/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^play$/i })).not.toBeInTheDocument()
    const rail = screen.getByRole('complementary', { name: /processed rows/i })
    expect(within(rail).getByRole('button', { name: /row 1 of 39/i })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: new RegExp(`row 3 of 39 ${input.play_id} · Q${input.qtr} · K\\.Walker`, 'i') })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /current row inspector/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('table', { name: /incremental analysis results/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /incremental results/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy shareable public url/i })).toBeInTheDocument()
    expect(screen.queryByText(/open public snapshot/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /switch to (dark|light) theme/i })).toBeInTheDocument()
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
      query: noulQueryJson,
      metadata: { ...draft.metadata, rowCount: 71, questionKind: 'noul', classes: [], columns: ['play_id', 'posteam_score', 'defteam_score', 'score_differential'] },
    }
    const noulRun = snapshot({
      query: noulQueryJson,
      questionKind: 'noul',
      classes: [],
      status: 'running',
      progress: { completedRows: 3, totalRows: 71, completedCalls: 3, totalCalls: 71 },
      resultRows: Array.from({ length: 3 }, (_, rowIndex) => ({
        rowIndex,
        input: { ...input, wpa: 0.91, posteam_score: 3, defteam_score: 0 },
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
    const editor = await screen.findByLabelText(/^Jev query JSON$/i)
    expect(parseJevQueryJson((editor as HTMLTextAreaElement).value)).toEqual({ type: 'noul', instructions: SAMPLE_WIN_NOUL_QUERY })
    expect(screen.queryByText(/noul · yes\/no probability 0–1/i)).not.toBeInTheDocument()
    expect(document.querySelector('.query-summary')).toHaveTextContent(SAMPLE_WIN_NOUL_QUERY)
    expect(screen.getByText('71 rows')).toBeInTheDocument()
    expect((editor as HTMLTextAreaElement).value.trim().startsWith('{')).toBe(true)
    expect((editor as HTMLTextAreaElement).value).not.toBe(SAMPLE_WIN_LIKELIHOOD_TASK)
    fireEvent.click(screen.getByRole('button', { name: /run jev/i }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Win probability' })).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: /win probability over play index/i })).toBeInTheDocument()
    expect(await screen.findByText('3 / 71 rows')).toBeInTheDocument()
    expect(document.querySelector('[data-chart-kind="series"]')).toBeTruthy()
    expect(document.querySelector('[data-play-cursor="true"]')).toBeTruthy()
    expect(document.querySelector('[data-series-points="3"]')).toBeTruthy()
    expect(document.querySelector('[data-class="K.Walker"]')).toBeNull()
    expect(document.querySelector('[data-class="Adams"]')).toBeNull()
    const rail = screen.getByRole('complementary', { name: /processed rows/i })
    expect(within(rail).getByRole('button', { name: /row 1 of 71/i })).toBeInTheDocument()
    expect(within(rail).queryByText('K.Walker')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Row 3 of 71' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: /chart playhead/i })).toHaveAttribute('max', '70')
    expect(document.querySelector('.series-line')).toBeTruthy()
    expect(document.querySelector('.series-fill')).toBeTruthy()
    expect(api.draft).toHaveBeenCalledWith(expect.objectContaining({ task: SAMPLE_WIN_LIKELIHOOD_TASK }))
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ query: noulQueryJson, questionKind: 'noul', classes: [] }))
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
    expect(within(rail).getByText(new RegExp(`${input.play_id}`))).toBeInTheDocument()
    await waitFor(() => expect(within(rail).getByRole('button', { name: /row 3 of 39/i })).toBeInTheDocument())
    expect(document.querySelector('[data-class="C.Kupp"]')).toHaveAttribute('data-count', '0')
    fireEvent.change(screen.getByRole('slider', { name: /chart playhead/i }), { target: { value: '2' } })
    fireEvent.pointerUp(screen.getByRole('slider', { name: /chart playhead/i }))
    await waitFor(() => expect(document.querySelector('[data-class="C.Kupp"]')).toHaveAttribute('data-count', '2'))
    expect(screen.queryByRole('table', { name: /incremental analysis results/i })).not.toBeInTheDocument()
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
    const ticketsQueryJson = formatDraftQueryForEditor({
      query: 'Classify each row using the visible columns.',
      questionKind: 'choice',
      classes: ['gold', 'silver'],
    })
    const api = makeApi({
      draft: vi.fn(async () => ({
        ...draft,
        datasetId: uploaded.datasetId,
        fixtureId: uploaded.datasetId,
        sourceType: 'upload' as const,
        query: ticketsQueryJson,
        metadata: { ...draft.metadata, displayName: 'tickets.csv', rowCount: 2, questionKind: 'choice' as const, classes: ['gold', 'silver'], columns: ['message'] },
      })),
      start: vi.fn(async () => byod),
      read: vi.fn(async () => byod),
    })
    render(<App api={api} />)
    const file = new File(['message,tier\nhello,gold\n'], 'tickets.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText(/upload csv/i), { target: { files: [file] } })
    expect(await screen.findByRole('heading', { name: 'tickets.csv' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    await screen.findByLabelText(/^Jev query JSON$/i)
    expect(screen.getByRole('button', { name: /run jev/i })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /run jev/i }))
    await waitFor(() => expect(api.start).toHaveBeenCalledWith({
      datasetId: uploaded.datasetId,
      fixtureId: undefined,
      query: ticketsQueryJson,
      classes: ['gold', 'silver'],
      questionKind: 'choice',
    }))
    expect(await screen.findByText('1 / 2 rows')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /class distribution/i })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: /chart playhead/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /row 1 of 2/i })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /current row inspector/i })).not.toBeInTheDocument()
    expect(document.querySelector('[data-class="gold"]')).toHaveAttribute('data-count', '1')
  })

  it('keeps idle intake quiet when durable storage is down, and still lets sample start', async () => {
    const api = makeApi({
      intakeStatus: vi.fn(async (): Promise<DatasetIntakeStatus> => ({ convex: false, uploadThing: false, sampleAvailable: true })),
      createFromCsv: vi.fn(async () => { throw new Error('UPLOADTHING_NOT_CONFIGURED') }),
    })
    render(<App api={api} />)
    await waitFor(() => expect(screen.getByLabelText(/upload csv/i)).toBeDisabled())
    expect(screen.queryByText(/not configured on this deployment/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/durable storage/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/uploadthing/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/sample still works/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^try sample$/i })).not.toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /^try sample$/i }))
    expect(screen.getByLabelText(/^Analysis task$/i)).toHaveValue(SAMPLE_WIN_LIKELIHOOD_TASK)
    expect(api.start).not.toHaveBeenCalled()
  })

  it('shows a short BYOD error without durable-storage jargon', async () => {
    const api = makeApi({
      createFromCsv: vi.fn(async () => { throw new Error('UPLOADTHING_NOT_CONFIGURED') }),
    })
    render(<App api={api} />)
    const file = new File(['message,tier\nhello,gold\n'], 'tickets.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText(/upload csv/i), { target: { files: [file] } })
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not upload this csv/i)
    expect(screen.getByText(/couldn't use this csv/i)).toBeInTheDocument()
    expect(screen.queryByText(/not configured on this deployment/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/durable storage/i)).not.toBeInTheDocument()
    expect(api.start).not.toHaveBeenCalled()
  })

  it('loads and renders a persisted snapshot on direct public share navigation', async () => {
    const analysisId = 'analysis-shared-1'
    const api = makeApi({ share: vi.fn(async (requestedId) => snapshot({ analysisId: requestedId, status: 'complete' })) })
    window.history.pushState({}, '', `/share/${analysisId}`)
    try {
      render(<App api={api} />)
      expect(await screen.findByRole('heading', { level: 2, name: 'Class distribution' })).toBeInTheDocument()
      expect(api.share).toHaveBeenCalledWith(analysisId)
      expect(screen.queryByText(/no provider credentials|bounded jev worker|engineer playground/i)).not.toBeInTheDocument()
      expect(screen.queryByRole('table', { name: /incremental analysis results/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: /incremental results/i })).not.toBeInTheDocument()
      expect(screen.getByRole('slider', { name: /chart playhead/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^play$/i })).toBeInTheDocument()
      expect(screen.getByRole('img', { name: /class distribution/i })).toBeInTheDocument()
      const rail = screen.getByRole('complementary', { name: /processed rows/i })
      expect(within(rail).getByRole('button', { name: new RegExp(`row 1 of 39 ${input.play_id} · Q${input.qtr} · K\\.Walker`, 'i') })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /copy shareable public url/i })).toBeInTheDocument()
      expect(screen.queryByText(/public snapshot/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/open public snapshot/i)).not.toBeInTheDocument()
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

  it('persists a header theme toggle over the system color scheme', () => {
    render(<App api={makeApi()} />)
    const toggle = screen.getByRole('button', { name: /switch to (dark|light) theme/i })
    const next = toggle.getAttribute('aria-label')?.includes('dark') ? 'dark' : 'light'
    fireEvent.click(toggle)
    expect(window.localStorage.getItem('jev-theme')).toBe(next)
    expect(document.documentElement.classList.contains('dark')).toBe(next === 'dark')
    expect(document.documentElement.dataset.theme).toBe(next)
    expect(screen.getByRole('button', { name: next === 'dark' ? /switch to light theme/i : /switch to dark theme/i })).toBeInTheDocument()
  })

  it('renders stable API errors and empty results without exposing provider details', async () => {
    const api = makeApi({ start: vi.fn(async () => { throw new Error('ANALYSIS_PROVIDER_ERROR') }) })
    await startSampleRun(api)
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not start/i)
    expect(screen.getByText(/couldn't run/i)).toBeInTheDocument()
    expect(screen.queryByText(/action needs attention/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/provider response|api key/i)).not.toBeInTheDocument()
  })

  it('humanizes in-run error status instead of Retryable/Stopped', async () => {
    const failed = snapshot({
      status: 'error',
      error: { code: 'ANALYSIS_PROVIDER_ERROR', retryable: true },
    })
    const api = makeApi({
      start: vi.fn(async () => failed),
      read: vi.fn(async () => failed),
    })
    await startSampleRun(api)
    expect(await screen.findByText('You can try again.')).toBeInTheDocument()
    expect(screen.queryByText(/retryable/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^stopped\.$/i)).not.toBeInTheDocument()
  })
})
