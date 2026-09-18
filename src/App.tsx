import { useCallback, useEffect, useState } from 'react'
import { AnalysisRunView } from './components/AnalysisRunView'
import { DatasetIntake } from './components/DatasetIntake'
import { DatasetPreviewCard } from './components/DatasetPreview'
import { getSampleDatasetPreview, SAMPLE_DATASET_ID } from './dataset/sampleDataset'
import { DatasetError, DATASET_ERROR_COPY, plainDatasetError, PUBLIC_DATA_WARNING } from './dataset/csvTypes'
import { validateCsvText } from './dataset/validateDataset'
import type {
  AnalysisDraftResult,
  AnalysisSnapshot,
} from './shared/analysis'
import type { DatasetIntakeStatus, DatasetPreview } from './shared/dataset'
import './styles.css'

export interface AnalysisApiClient {
  draft: (input: { fixtureId?: string; datasetId?: string; task: string }) => Promise<AnalysisDraftResult>
  start: (input: { fixtureId?: string; datasetId?: string; query: string; classes?: readonly string[] }) => Promise<AnalysisSnapshot>
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
  try {
    const body = await response.json() as { error?: unknown; message?: unknown }
    if (typeof body.error === 'string' && /^[A-Z0-9_]+$/.test(body.error)) code = body.error
    if (typeof body.message === 'string') {
      const trimmed = body.message.trim()
      if (trimmed && trimmed.length <= 240 && !/sk_|UPLOADTHING_TOKEN|UPLOADTHING_SECRET/i.test(trimmed)) message = trimmed
    }
  } catch { /* Keep a stable client-side error when the body is not JSON. */ }
  if (message && code in DATASET_ERROR_COPY) {
    return new DatasetError(code as DatasetError['code'], message, response.status)
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

const App = ({ api = defaultAnalysisApi }: { api?: AnalysisApiClient }) => {
  const shareAnalysisId = sharePathId()
  const isShareView = shareAnalysisId !== undefined
  const [dataset, setDataset] = useState<DatasetPreview | undefined>()
  const [intakeStatus, setIntakeStatus] = useState<DatasetIntakeStatus>()
  const [task, setTask] = useState(DEFAULT_TASK)
  const [draft, setDraft] = useState<AnalysisDraftResult | undefined>()
  const [query, setQuery] = useState('')
  const [queryEdited, setQueryEdited] = useState(false)
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
    setQueryEdited(false)
    setSnapshot(undefined)
    setShareMessage('')
    setError(undefined)
  }

  const handleDraft = async () => {
    if (!datasetId) { setError('Choose a dataset first.'); return }
    if (!task.trim()) { setError('Enter a task before drafting a query.'); return }
    setDrafting(true); setError(undefined); setDraft(undefined); setQuery(''); setQueryEdited(false)
    try {
      const result = await api.draft({ datasetId, fixtureId: dataset?.sourceType === 'fixture' ? SAMPLE_DATASET_ID : undefined, task: task.trim() })
      setDraft(result); setQuery(result.query); setQueryEdited(false)
    } catch (draftError) { setError(shortError(draftError, 'Could not draft a Jev query'))
    } finally { setDrafting(false) }
  }

  const handleRun = async () => {
    if (!draft || !query.trim() || !queryEdited || !datasetId) return
    setStarting(true); setError(undefined); setSnapshot(undefined); setShareMessage('')
    try {
      setSnapshot(await api.start({
        datasetId,
        fixtureId: dataset?.sourceType === 'fixture' ? SAMPLE_DATASET_ID : undefined,
        query: query.trim(),
        classes: draft.metadata.classes,
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
    setTask(DEFAULT_TASK)
  }

  const copyShareUrl = useCallback(async () => {
    if (!shareUrl) return
    try { await navigator.clipboard?.writeText(shareUrl); setShareMessage('Share URL copied')
    } catch { setShareMessage('Share URL ready') }
  }, [shareUrl])

  const showLanding = !isShareView && !dataset

  return (
    <main className="analysis-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Jev playground home"><span className="brand-mark">J</span><span>JEV PLAYGROUND</span></a>
        <span className="header-tag">{isShareView ? 'PUBLIC SNAPSHOT' : 'Demo playground'}</span>
      </header>
      <section className="hero" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">{isShareView ? 'A persisted public readback' : 'Jev playground'}</p>
          <h1 id="page-title">{isShareView ? <>Inspect a saved run.</> : <>Run Jev on a CSV.</>}</h1>
        </div>
        <p className="hero-copy">{isShareView ? 'A read-only snapshot of one bounded Jev analysis, including its persisted progress, live chart, and deterministic replay.' : 'This is an engineer playground for TypeSafe Jev. Try the sample run, or bring your own CSV — the chart updates as each row is classified.'}</p>
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
          {!isShareView && dataset && <>
            <section className="task-card" aria-labelledby="task-heading"><div className="section-heading"><div><p className="eyebrow">01 · Prompt</p><h2 id="task-heading">Describe the analysis task</h2></div><span className="step-mark">DRAFT</span></div><label htmlFor="analysis-task">Analysis task</label><textarea id="analysis-task" value={task} onChange={(event) => setTask(event.target.value)} rows={3} placeholder="What should Jev classify?" /><div className="form-footer"><span>Task is sent only when you choose Draft task.</span><button className="primary-button" type="button" onClick={() => void handleDraft()} disabled={drafting}>{drafting ? 'Drafting…' : 'Draft task'}</button></div></section>
            {draft && <section className="query-card" aria-labelledby="query-heading"><div className="section-heading"><div><p className="eyebrow">02 · Edit</p><h2 id="query-heading">Jev classifier query</h2></div><span className="step-mark">EDITABLE</span></div><label htmlFor="jev-query">Generated query</label><textarea id="jev-query" value={query} onChange={(event) => { setQuery(event.target.value); setQueryEdited(true) }} rows={5} /><div className="query-meta"><span>{draft.metadata.rowCount} rows · {draft.metadata.classes.length} classes · {draft.metadata.model}</span><span>Provider: {draft.metadata.provider}</span></div><div className="form-footer"><span>{queryEdited ? 'Query changed. Ready for an explicit run.' : 'Edit the query before running Jev.'}</span><button className="primary-button run-button" type="button" onClick={() => void handleRun()} disabled={!query.trim() || !queryEdited || starting}>{starting ? 'Starting…' : 'Run Jev'}</button></div></section>}
            {error && <div className="error-banner" role="alert"><b>Action needs attention</b><span>{error}</span></div>}
          </>}
          {isShareView && shareLoading && <p className="empty-copy" role="status">Loading public snapshot…</p>}
          {isShareView && error && <div className="error-banner" role="alert"><b>Public snapshot unavailable</b><span>{error}</span></div>}
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
          <div className="boundary-card">
            <p className="eyebrow">Playground limits</p>
            <h2>A technical demo, not production analytics.</h2>
            <ul>
              <li><b>5 MB</b> CSV maximum</li>
              <li><b>5,000</b> max rows / Jev calls</li>
              <li><b>HTTPS</b> public CSV URLs only</li>
            </ul>
            <p>{PUBLIC_DATA_WARNING} The browser never calls Jev, OpenRouter, or UploadThing credentials.</p>
          </div>
          <div className="about-card">
            <p className="eyebrow">How a run works</p>
            <p>Draft an editable classifier query, confirm Run Jev, then watch the class-distribution chart tick as each row is persisted. Share and replay use stored predictions only.</p>
          </div>
        </aside>
      </div>
      <footer className="site-footer"><span>JEV PLAYGROUND</span><span>Demo playground</span></footer>
    </main>
  )
}

export { App }
