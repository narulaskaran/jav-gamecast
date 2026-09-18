import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { ResultsChart } from './ResultsChart'
import { RowRail } from './RowRail'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader } from './ui/card'
import { Progress as ProgressBar } from './ui/progress'
import { runErrorHint, runViewHeading } from '../runView/format'
import { downloadTextFile, resultsCsv, resultsCsvFilename } from '../runView/resultsCsv'
import { useRunPlayhead } from '../runView/playhead'
import { chartVisualFor, inferQuestionKind } from '../shared/questionKind'
import type { AnalysisSnapshot, AnalysisStatus } from '../shared/analysis'

const statusLabels: Record<AnalysisStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  complete: 'Complete',
  error: 'Error',
}

const statusVariant: Record<AnalysisStatus, 'queued' | 'running' | 'complete' | 'error'> = {
  queued: 'queued',
  running: 'running',
  complete: 'complete',
  error: 'error',
}

const StatusBadge = memo(function StatusBadge({ status }: { status: AnalysisStatus }) {
  return (
    <Badge className={`analysis-status status-${status}`} variant={statusVariant[status]} role="status">
      {statusLabels[status]}
    </Badge>
  )
})

const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

const Progress = memo(function Progress({
  completedRows,
  totalRows,
}: {
  completedRows: number
  totalRows: number
}) {
  const ratio = totalRows ? Math.min(100, Math.round((completedRows / totalRows) * 100)) : 0
  return (
    <div className="progress-block" aria-label="Analysis progress">
      <div className="progress-line"><span>{completedRows} / {totalRows} rows</span><b>{ratio}%</b></div>
      <ProgressBar value={ratio} />
    </div>
  )
})

export const AnalysisRunView = memo(function AnalysisRunView({
  snapshot,
  shareUrl,
  shareMessage,
  onCopyShare,
  latencyHint,
}: {
  snapshot: AnalysisSnapshot
  shareUrl: string
  shareMessage: string
  onCopyShare: () => void
  latencyHint?: 'saved' | 'live'
}) {
  const rows = snapshot.resultRows
  const playbackEnabled = snapshot.status === 'complete'
  const live = snapshot.status === 'queued' || snapshot.status === 'running'
  const [elapsedMs, setElapsedMs] = useState(0)
  const { index, motion, playing, seek, togglePlayback } = useRunPlayhead(rows.length, snapshot.analysisId)
  const seekRef = useRef(seek)
  const toggleRef = useRef(togglePlayback)
  seekRef.current = seek
  toggleRef.current = togglePlayback
  const handleSeek = useCallback((next: number, phase: 'scrub' | 'release' = 'release') => {
    seekRef.current(next, phase)
  }, [])
  const handleTogglePlayback = useCallback(() => {
    toggleRef.current()
  }, [])
  const questionKind = inferQuestionKind(snapshot.query, snapshot.classes, snapshot.questionKind)
  const chartKind = chartVisualFor(questionKind)
  const canDownload = rows.length > 0

  useEffect(() => {
    if (!live) return undefined
    const startedAt = Date.parse(snapshot.createdAt)
    const origin = Number.isFinite(startedAt) ? startedAt : Date.now()
    const tick = () => setElapsedMs(Math.max(0, Date.now() - origin))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [live, snapshot.analysisId, snapshot.createdAt])

  const latencyCopy = live
    ? `Live run · ${formatElapsed(elapsedMs)} · ${snapshot.progress.totalRows} rows can take a few minutes.`
    : latencyHint === 'saved' && snapshot.status === 'complete'
      ? 'Saved run.'
      : undefined

  return (
    <Card className="analysis-card" aria-labelledby="analysis-heading" data-analysis-id={snapshot.analysisId}>
      <CardHeader className="analysis-head flex-row items-start justify-between space-y-0 p-6 pb-0">
        <div>
          <p className="eyebrow">Run</p>
          <h2 id="analysis-heading">{runViewHeading()}</h2>
        </div>
        <div className="analysis-actions">
          <StatusBadge status={snapshot.status} />
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => {
              if (!canDownload) return
              downloadTextFile(resultsCsvFilename(snapshot), resultsCsv(snapshot))
            }}
            disabled={!canDownload}
            aria-label="Download results CSV"
          >
            Download CSV
          </Button>
          <Button variant="ghost" size="sm" type="button" onClick={onCopyShare} disabled={!shareUrl} aria-label="Copy shareable public URL">
            {shareMessage || 'Share'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Progress
          completedRows={snapshot.progress.completedRows}
          totalRows={snapshot.progress.totalRows}
        />
        {latencyCopy ? <p className="run-latency" role="status">{latencyCopy}</p> : null}
        {snapshot.error ? (
          <div className="error-banner compact" role="alert">
            <b>{snapshot.error.code}</b>
            <span>{runErrorHint(snapshot.error.retryable)}</span>
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
              questionKind={questionKind}
              chartKind={chartKind}
              playing={playing}
              playbackEnabled={playbackEnabled}
              onSeek={handleSeek}
              onTogglePlayback={handleTogglePlayback}
            />
          </div>
          <RowRail
            rows={rows}
            totalRows={snapshot.progress.totalRows}
            playheadIndex={index}
            classes={snapshot.classes}
            chartKind={chartKind}
            onSelect={handleSeek}
          />
        </div>
      </CardContent>
    </Card>
  )
})
