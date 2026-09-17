import { memo, useCallback } from 'react'
import { ResultsChart } from './ResultsChart'
import { ResultsTable } from './ResultsTable'
import { RowRail } from './RowRail'
import { useRunPlayhead } from '../runView/playhead'
import type { AnalysisSnapshot, AnalysisStatus } from '../shared/analysis'

const statusLabels: Record<AnalysisStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  complete: 'Complete',
  error: 'Error',
}

const statusCopy: Record<AnalysisStatus, string> = {
  queued: 'Run accepted. Waiting for the bounded Jev worker.',
  running: 'Each persisted row prediction updates the chart.',
  complete: 'All accepted rows have a bounded classification result.',
  error: 'The run stopped with a stable error code; partial rows remain readable.',
}

const StatusBadge = ({ status }: { status: AnalysisStatus }) => (
  <span className={`analysis-status status-${status}`} role="status">
    <span className="status-dot" aria-hidden="true" />
    {statusLabels[status]}
  </span>
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

export const AnalysisRunView = memo(function AnalysisRunView({
  snapshot,
  shareUrl,
  shareMessage,
  onCopyShare,
}: {
  snapshot: AnalysisSnapshot
  shareUrl: string
  shareMessage: string
  onCopyShare: () => void
}) {
  const rows = snapshot.resultRows
  const columns = snapshot.columns ?? []
  const { index, motion, seek } = useRunPlayhead(rows.length, snapshot.analysisId)
  const handleSeek = useCallback((next: number, phase: 'scrub' | 'release' = 'release') => {
    seek(next, phase)
  }, [seek])
  const handleRailSelect = useCallback((next: number) => {
    seek(next, 'release')
  }, [seek])

  return (
    <section className="analysis-card" aria-labelledby="analysis-heading">
      <div className="analysis-head">
        <div>
          <p className="eyebrow">03 · Readback</p>
          <h2 id="analysis-heading">Jev analysis run</h2>
        </div>
        <div className="analysis-actions">
          <StatusBadge status={snapshot.status} />
          <button className="text-button" type="button" onClick={onCopyShare} disabled={!shareUrl} aria-label="Copy shareable public URL">↗ Share</button>
        </div>
      </div>
      <p className="run-id">Run {snapshot.analysisId} · no provider credentials are exposed to the browser</p>
      <Progress snapshot={snapshot} />
      {snapshot.error ? (
        <div className="error-banner compact" role="alert">
          <b>{snapshot.error.code}</b>
          <span>{snapshot.error.retryable ? 'Retryable provider boundary error.' : 'This run is not retrying automatically.'}</span>
        </div>
      ) : null}
      <div className="run-view">
        <div className="run-view-main">
          <ResultsChart
            rows={rows}
            playheadIndex={index}
            classes={snapshot.classes}
            totalRows={snapshot.progress.totalRows}
            motion={motion}
            onSeek={handleSeek}
          />
        </div>
        <RowRail
          rows={rows}
          totalRows={snapshot.progress.totalRows}
          playheadIndex={index}
          classes={snapshot.classes}
          onSelect={handleRailSelect}
        />
      </div>
      <ResultsTable rows={rows} columns={columns} />
      <div className="share-footer">
        <span>{shareMessage || 'Public URL reads the same bounded snapshot without calling a provider.'}</span>
        {shareUrl ? <a href={shareUrl} target="_blank" rel="noreferrer">Open public snapshot ↗</a> : null}
      </div>
    </section>
  )
})
