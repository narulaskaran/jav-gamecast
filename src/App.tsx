import { useEffect, useMemo, useState } from 'react'
import {
  FOOTBALL_FIXTURE_ID,
  footballFixture,
  footballFixtureDisclosure,
  footballFixtureSourceLinks,
  getHalftimeModelInput,
} from './fixtures/footballTimeline'
import type {
  AnalysisDraftResult,
  AnalysisResultRow,
  AnalysisSnapshot,
  AnalysisStatus,
} from './shared/analysis'
import './styles.css'

export interface AnalysisApiClient {
  draft: (input: { fixtureId: string; task: string }) => Promise<AnalysisDraftResult>
  start: (input: { fixtureId: string; query: string }) => Promise<AnalysisSnapshot>
  read: (analysisId: string) => Promise<AnalysisSnapshot>
  share: (analysisId: string) => Promise<AnalysisSnapshot>
}

const apiError = async (response: Response): Promise<Error> => {
  if (response.ok) return new Error('')
  let code = 'REQUEST_FAILED'
  try {
    const body = await response.json() as { error?: unknown }
    if (typeof body.error === 'string' && /^[A-Z0-9_]+$/.test(body.error)) code = body.error
  } catch { /* Keep a stable client-side error when the body is not JSON. */ }
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
}

const DEFAULT_TASK = 'Find a useful first-half classification for the likely second-half leader.'
const inputRows = getHalftimeModelInput()
const identity = footballFixture.manifest.identity
const classes = ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie']
const statusLabels: Record<AnalysisStatus, string> = { queued: 'Queued', running: 'Running', complete: 'Complete', error: 'Error' }
const statusCopy: Record<AnalysisStatus, string> = {
  queued: 'Run accepted. Waiting for the bounded Jev worker.',
  running: 'Jev is classifying the H1 rows incrementally.',
  complete: 'All H1 rows have a bounded classification result.',
  error: 'The run stopped with a stable error code; partial rows remain readable.',
}
const percent = (value: number | undefined) => value === undefined ? '—' : `${Math.round(value * 100)}%`
const shortError = (error: unknown, fallback: string) => error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? `${fallback} (${error.message})` : fallback

const StatusBadge = ({ status }: { status: AnalysisStatus }) => (
  <span className={`analysis-status status-${status}`} role="status">
    <span className="status-dot" aria-hidden="true" />
    {statusLabels[status]}
  </span>
)

const FixtureCard = () => (
  <section className="fixture-card" aria-labelledby="fixture-heading">
    <div className="fixture-card-head">
      <div>
        <p className="eyebrow">Pinned demo fixture</p>
        <h2 id="fixture-heading">Super Bowl LX</h2>
      </div>
      <span className="fixture-badge">FIXTURE-FIRST</span>
    </div>
    <div className="fixture-score" aria-label="Seattle Seahawks 29, New England Patriots 13">
      <span><b>SEA</b><small>Seattle</small></span>
      <strong>29 <i>—</i> 13</strong>
      <span><b>NE</b><small>New England</small></span>
    </div>
    <div className="fixture-meta">
      <span><b>Input slice</b>{inputRows.length} first-half rows</span>
      <span><b>Evaluation</b>H2 label held out</span>
      <span><b>Source</b>nflverse / nflfastR</span>
    </div>
    <p className="fixture-disclosure">{footballFixtureDisclosure}</p>
    <div className="fixture-links">
      <a href={footballFixtureSourceLinks.pbp} target="_blank" rel="noreferrer">Source data</a>
      <a href={footballFixtureSourceLinks.license} target="_blank" rel="noreferrer">CC BY 4.0 attribution</a>
      <span>{identity.game_date} · neutral site</span>
    </div>
  </section>
)

const Progress = ({ snapshot }: { snapshot: AnalysisSnapshot }) => {
  const { completedRows, totalRows, completedCalls, totalCalls } = snapshot.progress
  const ratio = totalRows ? Math.min(100, Math.round((completedRows / totalRows) * 100)) : 0
  return (
    <div className="progress-block" aria-label="Analysis progress">
      <div className="progress-line"><span>{completedRows} / {totalRows} rows</span><b>{ratio}%</b></div>
      <div className="progress-track"><span style={{ width: `${ratio}%` }} /></div>
      <p>{completedCalls} / {totalCalls} bounded Jev calls · {statusCopy[snapshot.status]}</p>
    </div>
  )
}

const CurrentRow = ({ row }: { row: AnalysisSnapshot['currentFixtureRow'] }) => (
  <section className="inspector" aria-label="Current row inspector">
    <div className="section-heading"><div><p className="eyebrow">Cursor</p><h3>Current H1 row</h3></div><span className="inspector-note">model input only</span></div>
    {!row ? <p className="empty-copy">No current fixture row is available yet. The inspector follows the worker cursor; completed rows remain available in the deterministic replay below.</p> : (
      <dl className="field-grid">
        <div><dt>Row</dt><dd>#{row.rowIndex + 1}</dd></div>
        <div><dt>Play</dt><dd>{row.input.play_id}</dd></div>
        <div><dt>Quarter</dt><dd>Q{row.input.qtr}</dd></div>
        <div><dt>Possession</dt><dd>{row.input.posteam ?? '—'}</dd></div>
        <div><dt>Defense</dt><dd>{row.input.defteam ?? '—'}</dd></div>
        <div><dt>Play type</dt><dd>{row.input.play_type ?? '—'}</dd></div>
        <div><dt>Yard line</dt><dd>{row.input.yardline_100 ?? '—'}</dd></div>
        <div><dt>Score diff.</dt><dd>{row.input.score_differential ?? '—'}</dd></div>
      </dl>
    )}
  </section>
)

const ResultsTable = ({ rows }: { rows: readonly AnalysisResultRow[] }) => (
  <section className="results-card" aria-labelledby="results-heading">
    <div className="section-heading"><div><p className="eyebrow">Readback</p><h3 id="results-heading">Incremental results</h3></div><span className="table-count">{rows.length} rows</span></div>
    {rows.length === 0 ? <p className="empty-copy">Results appear here as Jev finishes each H1 row.</p> : (
      <div className="table-scroll"><table aria-label="Incremental analysis results"><thead><tr><th>Row</th><th>Play</th><th>Possession</th><th>Selected class</th><th>Confidence</th></tr></thead><tbody>
        {rows.map((row) => <tr key={row.rowIndex}><td>#{row.rowIndex + 1}</td><td>{row.input.play_id}</td><td>{row.input.posteam ?? '—'}</td><td><span className="class-chip">{row.selectedClass ?? row.error?.code ?? 'Pending'}</span></td><td>{percent(row.confidence)}</td></tr>)}
      </tbody></table></div>
    )}
  </section>
)

const Distribution = ({ rows }: { rows: readonly AnalysisResultRow[] }) => {
  const values = useMemo(() => classes.map((name) => ({ name, value: rows.length === 0 ? 0 : rows.reduce((sum, row) => sum + (row.probabilities?.[name] ?? 0), 0) / rows.length })), [rows])
  const max = Math.max(...values.map(({ value }) => value), 0.01)
  return (
    <section className="distribution-card" aria-labelledby="distribution-heading">
      <div className="section-heading"><div><p className="eyebrow">Signal mix</p><h3 id="distribution-heading">Class distribution</h3></div><span className="table-count">mean probability</span></div>
      {rows.length === 0 ? <p className="empty-copy">The distribution stays empty until the first classification returns.</p> : <div className="distribution-chart" role="img" aria-label="Class distribution visualization">
        {values.map(({ name, value }) => <div className="distribution-row" key={name}><div className="distribution-label"><span>{name}</span><b>{percent(value)}</b></div><div className="distribution-track"><span style={{ width: `${Math.max(6, (value / max) * 100)}%` }} /></div></div>)}
      </div>}
    </section>
  )
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
  const [task, setTask] = useState(DEFAULT_TASK)
  const [draft, setDraft] = useState<AnalysisDraftResult | undefined>()
  const [query, setQuery] = useState('')
  const [queryEdited, setQueryEdited] = useState(false)
  const [snapshot, setSnapshot] = useState<AnalysisSnapshot | undefined>()
  const [drafting, setDrafting] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [replayIndex, setReplayIndex] = useState(0)
  const [shareMessage, setShareMessage] = useState('')
  const [shareLoading, setShareLoading] = useState(false)

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
  }, [api, snapshot?.analysisId, snapshot?.status])

  const rows = snapshot?.resultRows ?? []
  const activeRow = rows[replayIndex] ?? rows[rows.length - 1]
  const shareUrl = snapshot ? `${window.location.origin}/share/${encodeURIComponent(snapshot.analysisId)}` : ''

  const handleDraft = async () => {
    if (!task.trim()) { setError('Enter a task before drafting a query.'); return }
    setDrafting(true); setError(undefined); setDraft(undefined); setQuery(''); setQueryEdited(false)
    try {
      const result = await api.draft({ fixtureId: FOOTBALL_FIXTURE_ID, task: task.trim() })
      setDraft(result); setQuery(result.query); setQueryEdited(false)
    } catch (draftError) { setError(shortError(draftError, 'Could not draft a Jev query'))
    } finally { setDrafting(false) }
  }

  const handleRun = async () => {
    if (!draft || !query.trim() || !queryEdited) return
    setStarting(true); setError(undefined); setSnapshot(undefined); setReplayIndex(0); setShareMessage('')
    try { setSnapshot(await api.start({ fixtureId: FOOTBALL_FIXTURE_ID, query: query.trim() }))
    } catch (runError) { setError(shortError(runError, 'Could not start Jev analysis'))
    } finally { setStarting(false) }
  }

  const copyShareUrl = async () => {
    if (!shareUrl) return
    try { await navigator.clipboard?.writeText(shareUrl); setShareMessage('Share URL copied')
    } catch { setShareMessage('Share URL ready') }
  }

  return (
    <main className="analysis-shell">
      <header className="site-header"><a className="brand" href="/" aria-label="Jev Data Analysis home"><span className="brand-mark">J</span><span>JEV / DATA ANALYSIS</span></a><span className="header-tag">{isShareView ? 'PUBLIC SNAPSHOT' : 'FIXTURE-FIRST · H1 → H2'}</span></header>
      <section className="hero" aria-labelledby="page-title"><div><p className="eyebrow">{isShareView ? 'A persisted public readback' : 'A bounded classifier workbench'}</p><h1 id="page-title">{isShareView ? <>Inspect a saved run.<br /><em>Every answer.</em></> : <>Ask a football question.<br /><em>Inspect every answer.</em></>}</h1></div><p className="hero-copy">{isShareView ? 'A read-only snapshot of one bounded Jev analysis, including its persisted progress, results, and deterministic replay.' : 'Draft a Jev classifier query, edit it in place, then run a transparent readback against one pinned game fixture.'}</p></section>
      <div className="workspace-grid">
        <div className="primary-column">
          <FixtureCard />
          {!isShareView && <>
            <section className="task-card" aria-labelledby="task-heading"><div className="section-heading"><div><p className="eyebrow">01 · Prompt</p><h2 id="task-heading">Describe the analysis task</h2></div><span className="step-mark">DRAFT</span></div><label htmlFor="analysis-task">Analysis task</label><textarea id="analysis-task" value={task} onChange={(event) => setTask(event.target.value)} rows={3} placeholder="What should Jev classify?" /><div className="form-footer"><span>Task is sent only when you choose Draft task.</span><button className="primary-button" type="button" onClick={() => void handleDraft()} disabled={drafting}>{drafting ? 'Drafting…' : 'Draft task'}</button></div></section>
            {draft && <section className="query-card" aria-labelledby="query-heading"><div className="section-heading"><div><p className="eyebrow">02 · Edit</p><h2 id="query-heading">Jev classifier query</h2></div><span className="step-mark">EDITABLE</span></div><label htmlFor="jev-query">Generated query</label><textarea id="jev-query" value={query} onChange={(event) => { setQuery(event.target.value); setQueryEdited(true) }} rows={5} /><div className="query-meta"><span>{draft.metadata.rowCount} H1 rows · {draft.metadata.classes.length} classes · {draft.metadata.model}</span><span>Provider: {draft.metadata.provider}</span></div><div className="form-footer"><span>{queryEdited ? 'Query changed. Ready for an explicit run.' : 'Edit the query before running Jev.'}</span><button className="primary-button run-button" type="button" onClick={() => void handleRun()} disabled={!query.trim() || !queryEdited || starting}>{starting ? 'Starting…' : 'Run Jev'}</button></div></section>}
            {error && <div className="error-banner" role="alert"><b>Action needs attention</b><span>{error}</span></div>}
          </>}
          {isShareView && shareLoading && <p className="empty-copy" role="status">Loading public snapshot…</p>}
          {isShareView && error && <div className="error-banner" role="alert"><b>Public snapshot unavailable</b><span>{error}</span></div>}
          {snapshot && <section className="analysis-card" aria-labelledby="analysis-heading"><div className="analysis-head"><div><p className="eyebrow">03 · Readback</p><h2 id="analysis-heading">Jev analysis run</h2></div><div className="analysis-actions"><StatusBadge status={snapshot.status} /><button className="text-button" type="button" onClick={() => void copyShareUrl()} disabled={!shareUrl} aria-label="Copy shareable public URL">↗ Share</button></div></div><p className="run-id">Run {snapshot.analysisId} · no provider credentials or H2 labels are exposed to the browser</p><Progress snapshot={snapshot} />{snapshot.error && <div className="error-banner compact" role="alert"><b>{snapshot.error.code}</b><span>{snapshot.error.retryable ? 'Retryable provider boundary error.' : 'This run is not retrying automatically.'}</span></div>}<div className="analysis-grid"><CurrentRow row={snapshot.currentFixtureRow} /><Distribution rows={rows} /></div><ResultsTable rows={rows} /><section className="replay-card" aria-label="Deterministic analysis replay"><div className="section-heading"><div><p className="eyebrow">Replay</p><h3>Scrub the readback</h3></div><span>{rows.length ? `${replayIndex + 1} / ${rows.length}` : 'Waiting'}</span></div><input aria-label="Analysis replay position" type="range" min="0" max={Math.max(0, rows.length - 1)} value={rows.length ? replayIndex : 0} disabled={!rows.length} onChange={(event) => setReplayIndex(Number(event.target.value))} /><div className="replay-summary">{activeRow ? <><strong>{activeRow.selectedClass ?? 'No class yet'}</strong><span>{Object.entries(activeRow.probabilities ?? {}).map(([name, value]) => `${name} ${percent(value)}`).join(' · ')}</span></> : <span>No completed rows to replay yet.</span>}</div></section><div className="share-footer"><span>{shareMessage || 'Public URL reads the same bounded snapshot without calling a provider.'}</span>{shareUrl && <a href={shareUrl} target="_blank" rel="noreferrer">Open public snapshot ↗</a>}</div></section>}
        </div>
        <aside className="side-column"><div className="boundary-card"><p className="eyebrow">Boundary contract</p><h2>Only the first half crosses the model boundary.</h2><ul><li><b>39</b> H1 model-input rows</li><li><b>5,000</b> max calls / rows</li><li><b>H2</b> labels held for evaluation only</li></ul><p>Every result is bounded, sorted by row index, and safe to share. Raw provider credentials never enter this page.</p></div><div className="about-card"><p className="eyebrow">About this fixture</p><p>{identity.away_team} at {identity.home_team}, {identity.game_date}. The fixture is a deterministic demo for inspecting workflow behavior, not model quality or generalization.</p><a href={footballFixtureSourceLinks.identity} target="_blank" rel="noreferrer">Verify game identity ↗</a></div></aside>
      </div>
      <footer className="site-footer"><span>JEV / DATA ANALYSIS</span><span>Demo fixture · not betting odds · {identity.game_id}</span></footer>
    </main>
  )
}

export { App }
