import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App, defaultAnalysisApi, type AnalysisApiClient } from './App'
import { FOOTBALL_FIXTURE_ID, getHalftimeModelInput } from './fixtures/footballTimeline'
import type { AnalysisDraftResult, AnalysisSnapshot } from './shared/analysis'

const input = getHalftimeModelInput()[0]

const snapshot = (overrides: Partial<AnalysisSnapshot> = {}): AnalysisSnapshot => ({
  analysisId: 'analysis-demo-1',
  fixtureId: FOOTBALL_FIXTURE_ID,
  query: 'Classify the likely H2 leader using only the supplied H1 row.',
  status: 'complete',
  createdAt: '2026-09-17T18:00:00.000Z',
  updatedAt: '2026-09-17T18:01:00.000Z',
  progress: { completedRows: 1, totalRows: 39, completedCalls: 1, totalCalls: 39 },
  currentFixtureRow: { rowIndex: 0, input },
  resultRows: [{ rowIndex: 0, input, model: 'jev-latest', selectedClass: 'K.Walker', probabilities: { 'K.Walker': 0.72, 'C.Kupp': 0.1, 'J.Smith-Njigba': 0.12, 'Other/Tie': 0.06 }, confidence: 0.72 }],
  ...overrides,
})

const draft: AnalysisDraftResult = {
  fixtureId: FOOTBALL_FIXTURE_ID,
  query: 'Classify the likely H2 leader using only the supplied H1 row.',
  metadata: { provider: 'openrouter', model: 'openai/gpt-4o-mini', rowCount: 39, inputHalf: 'H1', labelHalf: 'H2', classes: ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie'] },
}

const makeApi = (overrides: Partial<AnalysisApiClient> = {}): AnalysisApiClient => ({
  draft: vi.fn(async () => draft),
  start: vi.fn(async () => snapshot({ status: 'queued', progress: { completedRows: 0, totalRows: 39, completedCalls: 0, totalCalls: 39 }, resultRows: [], currentFixtureRow: { rowIndex: 0, input } })),
  read: vi.fn(async () => snapshot()),
  share: vi.fn(async () => snapshot()),
  ...overrides,
})

describe('Jev data analysis flow', () => {
  it('does not fetch on initial load or editing, and requires draft then edit then run', async () => {
    const api = makeApi()
    render(<App api={api} />)

    expect(api.draft).not.toHaveBeenCalled()
    expect(api.start).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(/^Analysis task$/i), { target: { value: 'Find a first-half signal.' } })
    expect(api.draft).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    await screen.findByDisplayValue(draft.query)
    expect(api.draft).toHaveBeenCalledTimes(1)
    expect(api.start).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/^Generated query$/i), { target: { value: 'Use only H1 inputs to classify the H2 leader.' } })
    expect(api.start).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /run jev/i }))
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1))
    expect(api.start).toHaveBeenCalledWith({ fixtureId: FOOTBALL_FIXTURE_ID, query: 'Use only H1 inputs to classify the H2 leader.' })
  })

  it('renders progress, current-row inspector, incremental results, chart, replay, and share action', async () => {
    const api = makeApi({ read: vi.fn(async () => snapshot({
      status: 'running',
      progress: { completedRows: 12, totalRows: 39, completedCalls: 12, totalCalls: 39 },
      resultRows: Array.from({ length: 3 }, (_, rowIndex) => ({ rowIndex, input, model: 'jev-latest', selectedClass: 'K.Walker', probabilities: { 'K.Walker': 0.72, 'C.Kupp': 0.1, 'J.Smith-Njigba': 0.12, 'Other/Tie': 0.06 }, confidence: 0.72 })),
    })) })
    render(<App api={api} />)
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    await screen.findByDisplayValue(draft.query)
    fireEvent.change(screen.getByLabelText(/^Generated query$/i), { target: { value: 'Edited query.' } })
    fireEvent.click(screen.getByRole('button', { name: /run jev/i }))

    expect(await screen.findByText(/running/i)).toBeInTheDocument()
    expect(screen.getByText('12 / 39 rows')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /current row inspector/i })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: /incremental analysis results/i })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /class distribution/i })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: /analysis replay position/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy shareable public url/i })).toBeInTheDocument()
  })

  it('keeps the cursor inspector on the worker current fixture row instead of a replay result', async () => {
    const replayInput = { ...input, play_id: input.play_id + 1 }
    const api = makeApi({ read: vi.fn(async () => snapshot({
      status: 'running',
      currentFixtureRow: { rowIndex: 0, input },
      progress: { completedRows: 1, totalRows: 39, completedCalls: 1, totalCalls: 39 },
      resultRows: [{ rowIndex: 1, input: replayInput, model: 'jev-latest', selectedClass: 'C.Kupp' }],
    })) })
    render(<App api={api} />)
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    await screen.findByDisplayValue(draft.query)
    fireEvent.change(screen.getByLabelText(/^Generated query$/i), { target: { value: 'Edited query.' } })
    fireEvent.click(screen.getByRole('button', { name: /run jev/i }))

    await screen.findByText('1 / 39 rows')
    const inspector = screen.getByRole('region', { name: /current row inspector/i })
    expect(within(inspector).getByText('#1')).toBeInTheDocument()
    expect(within(inspector).getByText(String(input.play_id))).toBeInTheDocument()
    const results = screen.getByRole('table', { name: /incremental analysis results/i })
    expect(await within(results).findByText('C.Kupp')).toBeInTheDocument()
    expect(within(results).getByText('#2')).toBeInTheDocument()
  })

  it('loads and renders a persisted snapshot on direct public share navigation', async () => {
    const analysisId = 'analysis-shared-1'
    const api = makeApi({ share: vi.fn(async (requestedId) => snapshot({ analysisId: requestedId, status: 'complete' })) })
    window.history.pushState({}, '', `/share/${analysisId}`)

    try {
      render(<App api={api} />)

      expect(await screen.findByText('Jev analysis run')).toBeInTheDocument()
      expect(api.share).toHaveBeenCalledWith(analysisId)
      expect(screen.getByText(`Run ${analysisId} · no provider credentials or H2 labels are exposed to the browser`)).toBeInTheDocument()
      expect(screen.getByRole('table', { name: /incremental analysis results/i })).toBeInTheDocument()
      expect(screen.getByRole('slider', { name: /analysis replay position/i })).toBeInTheDocument()
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
    render(<App api={api} />)
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    await screen.findByDisplayValue(draft.query)
    fireEvent.change(screen.getByLabelText(/^Generated query$/i), { target: { value: 'Edited query.' } })
    fireEvent.click(screen.getByRole('button', { name: /run jev/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not start/i)
    expect(screen.queryByText(/provider response|api key|secret/i)).not.toBeInTheDocument()
  })
})
