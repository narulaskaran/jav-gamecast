import { memo, useCallback, useMemo, useRef, type CSSProperties, type PointerEvent, type SyntheticEvent } from 'react'
import { classDistribution, distributionAt } from '../dataset/classDistribution'
import { classColor } from '../runView/classColor'
import { areChartPropsEqual, barWidth } from '../runView/chartProps'
import { clampPlayhead, type PlayheadMotion } from '../runView/playhead'
import type { AnalysisResultRow } from '../shared/analysis'

const EMPTY_CLASSES: readonly string[] = []

const ClassBar = memo(function ClassBar({
  name,
  count,
  scale,
  color,
}: {
  name: string
  count: number
  scale: number
  color: string
}) {
  return (
    <div className="distribution-row" data-class={name} data-count={count}>
      <div className="distribution-label">
        <span>{name}</span>
        <b>{count}</b>
      </div>
      <div className="distribution-track">
        <span
          style={{
            '--bar-width': barWidth(count, scale),
            '--bar-color': color,
          } as CSSProperties}
        />
      </div>
    </div>
  )
})

export const ResultsChart = memo(function ResultsChart({
  rows,
  playheadIndex,
  classes = EMPTY_CLASSES,
  totalRows = 0,
  motion = 'tick',
  onSeek,
}: {
  rows: readonly AnalysisResultRow[]
  playheadIndex: number
  classes?: readonly string[]
  totalRows?: number
  motion?: PlayheadMotion
  onSeek: (index: number, phase?: 'scrub' | 'release') => void
}) {
  const plotRef = useRef<HTMLDivElement>(null)
  const completedCount = rows.length
  const prefixCount = completedCount === 0 ? 0 : playheadIndex + 1
  const values = useMemo(
    () => (completedCount === 0 ? classDistribution([], classes) : distributionAt(rows, prefixCount, classes)),
    [classes, completedCount, prefixCount, rows],
  )
  const classified = values.reduce((sum, item) => sum + item.count, 0)
  const scale = Math.max(totalRows, classified, 1)
  const waiting = classified === 0
  const latestLabel = completedCount === 0 ? 'Waiting' : `Through row ${prefixCount}`

  const indexFromClientX = useCallback((clientX: number) => {
    const node = plotRef.current
    if (!node || completedCount === 0) return 0
    const rect = node.getBoundingClientRect()
    if (rect.width <= 0) return 0
    const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return clampPlayhead(Math.round(t * (completedCount - 1)), completedCount)
  }, [completedCount])

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (completedCount === 0 || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    onSeek(indexFromClientX(event.clientX), 'scrub')
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (completedCount === 0 || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    onSeek(indexFromClientX(event.clientX), 'scrub')
  }

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (completedCount === 0 || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    onSeek(indexFromClientX(event.clientX), 'release')
  }

  const handleRange = (event: SyntheticEvent<HTMLInputElement>) => {
    onSeek(Number(event.currentTarget.value), 'scrub')
  }

  const handleRangeCommit = (event: SyntheticEvent<HTMLInputElement>) => {
    onSeek(Number(event.currentTarget.value), 'release')
  }

  return (
    <section className="distribution-card chart-hero" aria-labelledby="distribution-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Live chart</p>
          <h3 id="distribution-heading">Class distribution</h3>
        </div>
        <span className="table-count">{latestLabel}{totalRows ? ` · ${totalRows} total` : ''}</span>
      </div>
      <div
        className="chart-shell"
        data-motion={motion}
        data-waiting={waiting ? 'true' : 'false'}
        role="img"
        aria-label={waiting ? 'Waiting for the first row' : 'Class distribution visualization'}
      >
        <div
          ref={plotRef}
          className="chart-plot"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div className="chart-axes" aria-hidden="true">
            <span className="chart-y-axis" />
            <span className="chart-x-axis" />
          </div>
          {waiting ? <p className="chart-empty">Waiting for the first row…</p> : null}
          {values.length > 0 ? (
            <div className="distribution-chart" data-waiting={waiting ? 'true' : 'false'}>
              {values.map(({ name, count }) => (
                <ClassBar
                  key={name}
                  name={name}
                  count={count}
                  scale={scale}
                  color={classColor(name, classes)}
                />
              ))}
            </div>
          ) : null}
        </div>
        <label className="chart-scrubber">
          <span className="visually-hidden">Chart playhead</span>
          <input
            aria-label="Chart playhead"
            aria-valuetext={completedCount ? `Row ${playheadIndex + 1} of ${totalRows || completedCount}` : 'Waiting'}
            type="range"
            min={0}
            max={Math.max(0, completedCount - 1)}
            value={completedCount ? playheadIndex : 0}
            disabled={!completedCount}
            onChange={handleRange}
            onPointerDown={(event) => {
              if (!completedCount) return
              onSeek(Number(event.currentTarget.value), 'scrub')
            }}
            onPointerUp={handleRangeCommit}
            onKeyUp={handleRangeCommit}
          />
        </label>
      </div>
    </section>
  )
}, areChartPropsEqual)
