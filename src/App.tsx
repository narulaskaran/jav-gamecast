import { useCallback, useEffect, useState } from 'react'
import { AnalysisRunView } from './components/AnalysisRunView'
import { DatasetIntake } from './components/DatasetIntake'
import { DatasetPreviewCard } from './components/DatasetPreview'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from './components/ui/card'
import { Label } from './components/ui/label'
import { Textarea } from './components/ui/textarea'
import { getSampleDatasetPreview, SAMPLE_DATASET_ID } from './dataset/sampleDataset'
import { DatasetError, DATASET_ERROR_COPY, plainDatasetError, PUBLIC_DATA_WARNING } from './dataset/csvTypes'
import { validateCsvText } from './dataset/validateDataset'
import type {
  AnalysisDraftResult,
  AnalysisSnapshot,
} from './shared/analysis'
import {
  SAMPLE_WIN_LIKELIHOOD_TASK,
} from './shared/questionKind'
import type { DatasetIntakeStatus, DatasetPreview } from './shared/dataset'
import './styles.css'

export interface AnalysisApiClient {
  draft: (input: { fixtureId?: string; datasetId?: string; task: string }) => Promise<AnalysisDraftResult>
  start: (input: { fixtureId?: string; datasetId?: string; query: string; classes?: readonly string[]; questionKind?: AnalysisDraftResult['metadata']['questionKind'] }) => Promise<AnalysisSnapshot>
  read: (analysisId: string) => Promise<AnalysisSnapshot>
  share: (analysisId: string) => Promise<AnalysisSnapshot>
  intakeStatus?: () => Promise<DatasetIntakeStatus>
  createFromCsv?: (input: { csvText: string; filename: string }) => Promise<DatasetPreview>
  createFromUrl?: (input: { url: string }) => Promise<DatasetPreview>
}

const apiError = async (response: Response): Promise<Error> => {
  if (response.ok) return new Error('')
  let code = 'REQUEST_FAILED'
  let message: string | undefined
  let failure: string | undefined
  try {
    const body = await response.json() as { error?: unknown; message?: unknown; failure?: unknown }
    if (typeof body.error === 'string' && /^[A-Z0-9_]+$/.test(body.error)) code = body.error
    if (typeof body.message === 'string') {
      const trimmed = body.message.trim()
      if (trimmed && trimmed.length <= 240 && !/\bsk_|bearer\s/i.test(trimmed)) message = trimmed
    }
    if (typeof body.failure === 'string' && /^[A-Z0-9_]+$/.test(body.failure)) failure = body.failure
  } catch { /* Keep a stable client-side error when the body is not JSON. */ }
  if (message && code in DATASET_ERROR_COPY) {
    return new DatasetError(code as DatasetError['code'], failure ? `${message} (${failure})` : message, response.status)
  }
  return new Error(code)
}

const json = async <T,>(url: string, init: RequestInit): Promise<T> => {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } })
  if (!response.ok) throw await apiError(response)
  return response.json() as Promise<T>
}

export const defaultAnalysisApi: AnalysisApiClient = {
  draft: (input) => json<AnalysisDraftResult>('/api/analysis/draft', { method: 'POST', body: JSON.stringify(input) }),
  start: (input) => json<AnalysisSnapshot>('/api/analysis/run', { method: 'POST', body: JSON.stringify(input) }),
  read: (analysisId) => json<AnalysisSnapshot>(`/api/analysis/${encodeURIComponent(analysisId)}`, { method: 'GET' }),
  share: (analysisId) => json<AnalysisSnapshot>(`/api/share/${encodeURIComponent(analysisId)}`, { method: 'GET' }),
  intakeStatus: () => json<DatasetIntakeStatus>('/api/datasets/status', { method: 'GET' }),
  createFromCsv: (input) => json<DatasetPreview>('/api/datasets/from-csv', { method: 'POST', body: JSON.stringify(input) }),
  createFromUrl: (input) => json<DatasetPreview>('/api/datasets/from-url', { method: 'POST', body: JSON.stringify(input) }),
}

const DEFAULT_TASK = 'Classify each row using the visible columns.'
const SAMPLE_TASK = SAMPLE_WIN_LIKELIHOOD_TASK

export const hasRunnableQuery = (query: string): boolean => query.trim().length > 0

export const canConfirmJevRun = ({ query, starting }: { query: string; starting: boolean }): boolean =>
  hasRunnableQuery(query) && !starting

const shortError = (error: unknown, fallback: string) => {
  if (error instanceof DatasetError) return error.message.trim() || plainDatasetError(error.code, fallback)
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) return plainDatasetError(error.message, `${fallback} (${error.message})`)
  return fallback
}

const sharePathId = (): string | undefined => {
  if (typeof window === 'undefined') return undefined
  const match = window.location.pathname.match(/^\/share\/([^/]+)\/?$/)
  if (!match) return undefined
  try { return decodeURIComponent(match[1]) } catch { return undefined }
}

const Thinking = ({ children }: { children: string }) => (
  <p className="thinking" role="status">
    <span className="thinking-dot" aria-hidden="true" />
    {children}
  </p>
)

const App = ({ api = defaultAnalysisApi }: { api?: AnalysisApiClient }) => {
  const shareAnalysisId = sharePathId()
  const isShareView = shareAnalysisId !== undefined
  const [dataset, setDataset] = useState<DatasetPreview | undefined>()
  const [intakeStatus, setIntakeStatus] = useState<DatasetIntakeStatus>()
  const [task, setTask] = useState(DEFAULT_TASK)
  const [draft, setDraft] = useState<AnalysisDraftResult | undefined>()
  const [query, setQuery] = useState('')
  const [snapshot, setSnapshot] = useState<AnalysisSnapshot | undefined>()
  const [drafting, setDrafting] = useState(false)
  const [starting, setStarting] = useState(false)
  const [intakeBusy, setIntakeBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [shareMessage, setShareMessage] = useState('')
  const [shareLoading, setShareLoading] = useState(false)

  useEffect(() => {
    if (isShareView || !api.intakeStatus) return undefined
    let active = true
    void api.intakeStatus().then((status) => { if (active) setIntakeStatus(status) }).catch(() => {
      if (active) setIntakeStatus({ convex: false, uploadThing: false, sampleAvailable: true })
    })
    return () => { active = false }
  }, [api, isShareView])

  useEffect(() => {
    if (!shareAnalysisId) return undefined
    let active = true
    setShareLoading(true)
    setError(undefined)
    setSnapshot(undefined)
    setDraft(undefined)
    void api.share(shareAnalysisId).then((nextSnapshot) => {
      if (active) setSnapshot(nextSnapshot)
    }).catch((readError) => {
      if (active) setError(shortError(readError, 'Could not read public snapshot'))
    }).finally(() => {
      if (active) setShareLoading(false)
    })
    return () => { active = false }
  }, [api, shareAnalysisId])

  useEffect(() => {
    if (!snapshot || snapshot.status === 'complete' || snapshot.status === 'error') return undefined
    let active = true
    let timer: number | undefined
    const poll = async () => {
      try {
        const next = await (isShareView ? api.share(snapshot.analysisId) : api.read(snapshot.analysisId))
        if (!active) return
        setSnapshot(next)
        if (next.status !== 'complete' && next.status !== 'error') timer = window.setTimeout(poll, 350)
      } catch (readError) {
        if (active) setError(shortError(readError, 'Could not read analysis progress'))
      }
    }
    timer = window.setTimeout(poll, 250)
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer) }
  }, [api, isShareView, snapshot?.analysisId, snapshot?.status])

  const shareUrl = snapshot ? `${window.location.origin}/share/${encodeURIComponent(snapshot.analysisId)}` : ''
  const datasetId = dataset?.datasetId

  const resetRunState = () => {
    setDraft(undefined)
    setQuery('')
    setSnapshot(undefined)
    setShareMessage('')
    setError(undefined)
  }

  const handleDraft = async () => {
    if (!datasetId) { setError('Choose a dataset first.'); return }
    if (!task.trim()) { setError('Enter a task before drafting a query.'); return }
    setDrafting(true); setError(undefined); setDraft(undefined); setQuery('')
    try {
      const result = await api.draft({ datasetId, fixtureId: dataset?.sourceType === 'fixture' ? SAMPLE_DATASET_ID : undefined, task: task.trim() })
      setDraft(result); setQuery(result.query)
    } catch (draftError) { setError(shortError(draftError, 'Could not draft a Jev query'))
    } finally { setDrafting(false) }
  }

  const handleRun = async () => {
    if (!draft || !hasRunnableQuery(query) || !datasetId) return
    setStarting(true); setError(undefined); setSnapshot(undefined); setShareMessage('')
    try {
      setSnapshot(await api.start({
        datasetId,
        fixtureId: dataset?.sourceType === 'fixture' ? SAMPLE_DATASET_ID : undefined,
        query: query.trim(),
        classes: draft.metadata.classes,
        questionKind: draft.metadata.questionKind,
      }))
    } catch (runError) { setError(shortError(runError, 'Could not start Jev analysis'))
    } finally { setStarting(false) }
  }

  const readCsvText = async (file: File): Promise<string> => {
    if (typeof file.text === 'function') return file.text()
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(new DatasetError('NOT_CSV', 'That does not look like a CSV.'))
      reader.readAsText(file)
    })
  }

  const handleUpload = async (file: File) => {
    setIntakeBusy(true); setError(undefined)
    try {
      const csvText = await readCsvText(file)
      validateCsvText(csvText)
      if (!api.createFromCsv) throw new DatasetError('UPLOADTHING_NOT_CONFIGURED', 'CSV storage is not configured on this deployment.', 503)
      const preview = await api.createFromCsv({ csvText, filename: file.name })
      resetRunState()
      setDataset(preview)
      setTask(DEFAULT_TASK)
    } catch (uploadError) {
      setError(shortError(uploadError, 'Could not use this CSV'))
    } finally { setIntakeBusy(false) }
  }

  const handleUrl = async (url: string) => {
    setIntakeBusy(true); setError(undefined)
    try {
      if (!api.createFromUrl) throw new DatasetError('UPLOADTHING_NOT_CONFIGURED', 'CSV storage is not configured on this deployment.', 503)
      const preview = await api.createFromUrl({ url })
      resetRunState()
      setDataset(preview)
      setTask(DEFAULT_TASK)
    } catch (urlError) {
      setError(shortError(urlError, 'Could not use this CSV URL'))
    } finally { setIntakeBusy(false) }
  }

  const handleSample = () => {
    resetRunState()
    setDataset(getSampleDatasetPreview())
    setTask(SAMPLE_TASK)
  }

  const copyShareUrl = useCallback(async () => {
    if (!shareUrl) return
    try { await navigator.clipboard?.writeText(shareUrl); setShareMessage('Share URL copied')
    } catch { setShareMessage('Share URL ready') }
  }, [shareUrl])

  const showLanding = !isShareView && !dataset
  const canRun = Boolean(draft && datasetId && canConfirmJevRun({ query, starting }))

  return (
    <main className="analysis-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Jev playground home">Jev</a>
        <Badge variant="secondary">{isShareView ? 'Public snapshot' : 'Demo'}</Badge>
      </header>
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">{isShareView ? 'A persisted public readback' : 'Demo playground'}</p>
        <h1 id="page-title">{isShareView ? 'Inspect a saved run.' : 'Run Jev on a CSV.'}</h1>
        <p className="hero-copy">
          {isShareView
            ? 'A read-only snapshot of one bounded Jev analysis, including its persisted progress, live chart, and deterministic replay.'
            : 'This is an engineer playground for TypeSafe Jev. Try the sample run, or bring your own CSV — the chart updates as each row is classified.'}
        </p>
      </section>
      <div className="workspace-grid">
        <div className="primary-column">
          {showLanding && (
            <DatasetIntake
              status={intakeStatus}
              intakeError={error}
              disabled={intakeBusy}
              onUploadFile={(file) => void handleUpload(file)}
              onSubmitUrl={(url) => void handleUrl(url)}
              onTrySample={handleSample}
            />
          )}
          {dataset && !isShareView && (
            <DatasetPreviewCard dataset={dataset} onChange={() => { setDataset(undefined); resetRunState() }} />
          )}
          {!isShareView && dataset && (
            <>
              <Card className="task-card" aria-labelledby="task-heading">
                <CardHeader className="section-heading flex-row items-start justify-between space-y-0">
                  <div>
                    <p className="eyebrow">Prompt</p>
                    <h2 id="task-heading">Describe the analysis task</h2>
                  </div>
                  {drafting ? <Badge variant="running">Drafting</Badge> : <Badge variant="secondary">Draft</Badge>}
                </CardHeader>
                <CardContent>
                  <div className="grid gap-2">
                    <Label htmlFor="analysis-task">Analysis task</Label>
                    <Textarea
                      id="analysis-task"
                      value={task}
                      onChange={(event) => setTask(event.target.value)}
                      rows={3}
                      placeholder="What should Jev answer per row?"
                    />
                  </div>
                  {drafting ? <Thinking>Drafting query…</Thinking> : null}
                </CardContent>
                <CardFooter className="form-footer">
                  <span>Task is sent only when you choose Draft task.</span>
                  <Button type="button" onClick={() => void handleDraft()} disabled={drafting}>
                    {drafting ? 'Drafting…' : 'Draft task'}
                  </Button>
                </CardFooter>
              </Card>
              {draft && (
                <Card className="query-card" aria-labelledby="query-heading">
                  <CardHeader className="section-heading flex-row items-start justify-between space-y-0">
                    <div>
                      <p className="eyebrow">Query</p>
                      <h2 id="query-heading">Jev query</h2>
                    </div>
                    <Badge variant="secondary">Editable</Badge>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-2">
                      <Label htmlFor="jev-query">Generated query</Label>
                      <Textarea
                        id="jev-query"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        rows={5}
                      />
                    </div>
                    <div className="query-meta">
                      <span>{draft.metadata.rowCount} rows · {draft.metadata.questionKind ?? 'query'}{draft.metadata.classes.length ? ` · ${draft.metadata.classes.length} classes` : ''} · {draft.metadata.model}</span>
                      <span>Provider: {draft.metadata.provider}</span>
                    </div>
                    {starting ? <Thinking>Starting run…</Thinking> : null}
                  </CardContent>
                  <CardFooter className="form-footer">
                    <span>{hasRunnableQuery(query) ? 'Review the query, then confirm Run Jev.' : 'Enter a query before running Jev.'}</span>
                    <Button
                      className="run-button"
                      variant="run"
                      type="button"
                      onClick={() => void handleRun()}
                      disabled={!canRun}
                    >
                      {starting ? 'Starting…' : 'Run Jev'}
                    </Button>
                  </CardFooter>
                </Card>
              )}
              {error && (
                <div className="error-banner" role="alert">
                  <b>Action needs attention</b>
                  <span>{error}</span>
                </div>
              )}
            </>
          )}
          {isShareView && shareLoading && <p className="empty-copy" role="status">Loading public snapshot…</p>}
          {isShareView && error && (
            <div className="error-banner" role="alert">
              <b>Public snapshot unavailable</b>
              <span>{error}</span>
            </div>
          )}
          {snapshot && (
            <AnalysisRunView
              snapshot={snapshot}
              shareUrl={shareUrl}
              shareMessage={shareMessage}
              onCopyShare={copyShareUrl}
            />
          )}
        </div>
        <aside className="side-column">
          <Card className="boundary-card">
            <CardHeader>
              <p className="eyebrow">Playground limits</p>
              <h2>A technical demo, not production analytics.</h2>
            </CardHeader>
            <CardContent>
              <ul>
                <li><b>5 MB</b> CSV maximum</li>
                <li><b>5,000</b> max rows / Jev calls</li>
                <li><b>HTTPS</b> public CSV URLs only</li>
              </ul>
              <p className="text-sm text-muted-foreground leading-relaxed">{PUBLIC_DATA_WARNING} The browser never calls Jev, OpenRouter, or UploadThing credentials.</p>
            </CardContent>
          </Card>
          <Card className="about-card">
            <CardHeader>
              <p className="eyebrow">How a run works</p>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground leading-relaxed">Draft an editable query, confirm Run Jev, then watch the live chart tick as each row is persisted. Share and replay use stored predictions only.</p>
            </CardContent>
          </Card>
        </aside>
      </div>
      <footer className="site-footer">Demo playground · engineer demo</footer>
    </main>
  )
}

export { App }
