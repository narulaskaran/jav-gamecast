import { memo, useCallback, useMemo, useRef, type CSSProperties, type PointerEvent, type SyntheticEvent } from 'react'
import { classDistribution, distributionAt } from '../dataset/classDistribution'
import { classColor } from '../runView/classColor'
import { areChartPropsEqual, barWidth } from '../runView/chartProps'
import { clampPlayhead, playDomainCount, playIndexFromRatio, type PlayheadMotion } from '../runView/playhead'
import { areaPath, formatPercentTick, jevSeriesPoints, linePath, seriesX } from '../runView/seriesPath'
import { chartVisualFor, inferQuestionKind, type ChartVisualKind, type JevQuestionKind } from '../shared/questionKind'
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
  questionKind,
  chartKind,
  onSeek,
}: {
  rows: readonly AnalysisResultRow[]
  playheadIndex: number
  classes?: readonly string[]
  totalRows?: number
  motion?: PlayheadMotion
  questionKind?: JevQuestionKind
  chartKind?: ChartVisualKind
  onSeek: (index: number, phase?: 'scrub' | 'release') => void
}) {
  const plotRef = useRef<HTMLDivElement>(null)
  const completedCount = rows.length
  const domainCount = playDomainCount(totalRows, completedCount)
  const prefixCount = completedCount === 0 ? 0 : playheadIndex + 1
  const kind = questionKind
    ?? rows.find((row) => row.questionKind)?.questionKind
    ?? inferQuestionKind('', classes)
  const visual = chartKind ?? chartVisualFor(kind)
  const values = useMemo(
    () => (visual === 'bars' ? (completedCount === 0 ? classDistribution([], classes) : distributionAt(rows, prefixCount, classes)) : []),
    [classes, completedCount, prefixCount, rows, visual],
  )
  const series = useMemo(
    () => (visual === 'series' ? jevSeriesPoints(rows, prefixCount, domainCount) : []),
    [domainCount, prefixCount, rows, visual],
  )
  const classified = visual === 'bars' ? values.reduce((sum, item) => sum + item.count, 0) : series.length
  const scale = Math.max(totalRows, classified, 1)
  const waiting = classified === 0
  const playheadValue = series.find((point) => point.rowIndex === playheadIndex)?.yValue
  const latestLabel = completedCount === 0
    ? 'Waiting'
    : visual === 'series'
      ? `Play ${prefixCount}${playheadValue === undefined ? '' : ` · ${formatPercentTick(playheadValue)}`}`
      : `Through row ${prefixCount}`
  const heading = visual === 'series' ? 'Win probability' : 'Class distribution'
  const aria = waiting
    ? 'Waiting for the first row'
    : visual === 'series'
      ? 'Win probability over play index'
      : 'Class distribution visualization'

  const indexFromClientX = useCallback((clientX: number) => {
    const node = plotRef.current
    if (!node || completedCount === 0) return 0
    const rect = node.getBoundingClientRect()
    if (rect.width <= 0) return 0
    const t = (clientX - rect.left) / rect.width
    return playIndexFromRatio(t, totalRows, completedCount)
  }, [completedCount, totalRows])

  const emitSeek = (index: number, phase?: 'scrub' | 'release') => {
    onSeek(clampPlayhead(index, completedCount), phase)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (completedCount === 0 || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    emitSeek(indexFromClientX(event.clientX), 'scrub')
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (completedCount === 0 || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    emitSeek(indexFromClientX(event.clientX), 'scrub')
  }

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (completedCount === 0 || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    emitSeek(indexFromClientX(event.clientX), 'release')
  }

  const handleRange = (event: SyntheticEvent<HTMLInputElement>) => {
    emitSeek(Number(event.currentTarget.value), 'scrub')
  }

  const handleRangeCommit = (event: SyntheticEvent<HTMLInputElement>) => {
    emitSeek(Number(event.currentTarget.value), 'release')
  }

  const cursorX = seriesX(playheadIndex, domainCount)

  return (
    <section className="distribution-card chart-hero" aria-labelledby="distribution-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Live chart</p>
          <h3 id="distribution-heading">{heading}</h3>
        </div>
        <span className="table-count">{latestLabel}{totalRows ? ` · ${totalRows} total` : ''}</span>
      </div>
      <div
        className="chart-shell"
        data-motion={motion}
        data-waiting={waiting ? 'true' : 'false'}
        data-chart-kind={visual}
        role="img"
        aria-label={aria}
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
          {visual === 'series' ? (
            <div className="chart-y-ticks" aria-hidden="true">
              <span>100%</span>
              <span>50%</span>
              <span>0%</span>
            </div>
          ) : null}
          {waiting ? <p className="chart-empty">Waiting for the first row…</p> : null}
          {visual === 'series' && series.length > 0 ? (
            <svg className="series-svg" viewBox="0 0 1 1" preserveAspectRatio="none" data-series-points={series.length}>
              <path className="series-fill" d={areaPath(series)} />
              <path className="series-line" d={linePath(series)} />
              <line className="series-cursor" data-play-cursor="true" x1={cursorX} x2={cursorX} y1="0" y2="1" />
            </svg>
          ) : null}
          {visual === 'bars' && values.length > 0 ? (
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
            max={completedCount ? Math.max(0, domainCount - 1) : 0}
            value={completedCount ? playheadIndex : 0}
            disabled={!completedCount}
            onChange={handleRange}
            onPointerDown={(event) => {
              if (!completedCount) return
              emitSeek(Number(event.currentTarget.value), 'scrub')
            }}
            onPointerUp={handleRangeCommit}
            onKeyUp={handleRangeCommit}
          />
        </label>
      </div>
    </section>
  )
}, areChartPropsEqual)
