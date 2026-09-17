import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { classColor } from '../runView/classColor'
import { RAIL_ITEM_SIZE, railWindow } from '../runView/railWindow'
import type { AnalysisResultRow } from '../shared/analysis'

export const RowRail = memo(function RowRail({
  rows,
  totalRows,
  playheadIndex,
  classes = [],
  onSelect,
}: {
  rows: readonly AnalysisResultRow[]
  totalRows: number
  playheadIndex: number
  classes?: readonly string[]
  onSelect: (index: number) => void
}) {
  const listRef = useRef<HTMLUListElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(320)

  useEffect(() => {
    const node = listRef.current
    if (!node) return undefined
    const measure = () => setViewportHeight(node.clientHeight || 320)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(node)
    return () => observer?.disconnect()
  }, [])

  useEffect(() => {
    const selected = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]')
    selected?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [playheadIndex, rows.length])

  const window = useMemo(
    () => railWindow({
      count: rows.length,
      scrollOffset: scrollTop,
      viewportSize: viewportHeight,
      itemSize: RAIL_ITEM_SIZE,
      includeIndex: playheadIndex,
    }),
    [playheadIndex, rows.length, scrollTop, viewportHeight],
  )

  const visible = rows.slice(window.start, window.end)

  return (
    <aside className="run-rail" aria-label="Processed rows">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Rows</p>
          <h3>Playhead</h3>
        </div>
      </div>
      <ul
        ref={listRef}
        className={`rail-list${window.virtualized ? ' is-virtualized' : ''}`}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        {window.virtualized ? <li className="rail-spacer" style={{ height: window.padStart }} aria-hidden="true" /> : null}
        {visible.map((row, offset) => {
          const index = window.start + offset
          const selected = index === playheadIndex
          const label = `Row ${row.rowIndex + 1} of ${totalRows}`
          return (
            <li key={row.rowIndex}>
              <button
                type="button"
                className={`rail-item${selected ? ' is-selected' : ''}`}
                aria-current={selected ? 'true' : undefined}
                aria-label={row.selectedClass ? `${label} ${row.selectedClass}` : label}
                onClick={() => onSelect(index)}
              >
                <span className="rail-index">{label}</span>
                {row.selectedClass ? (
                  <span className="rail-chip" style={{ '--chip-color': classColor(row.selectedClass, classes) } as CSSProperties}>
                    {row.selectedClass}
                  </span>
                ) : null}
              </button>
            </li>
          )
        })}
        {window.virtualized ? <li className="rail-spacer" style={{ height: window.padEnd }} aria-hidden="true" /> : null}
      </ul>
    </aside>
  )
})
