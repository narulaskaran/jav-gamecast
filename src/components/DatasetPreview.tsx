import { useEffect, useMemo, useRef, useState } from 'react'
import type { DatasetPreview } from '../shared/dataset'
import { PREVIEW_VIEWPORT_SIZE, previewWindow, shouldDeferPreviewRows } from '../dataset/previewWindow'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardFooter, CardHeader } from './ui/card'

const previewValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

const sourceLabel = (sourceType: DatasetPreview['sourceType']) => {
  if (sourceType === 'fixture') return 'Try sample'
  if (sourceType === 'upload') return 'Uploaded CSV'
  return 'Public CSV'
}

export const DatasetPreviewCard = ({ dataset, onChange }: { dataset: DatasetPreview; onChange?: () => void }) => {
  const columns = dataset.columns
  const rows = dataset.previewRows
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(PREVIEW_VIEWPORT_SIZE)
  const deferRows = shouldDeferPreviewRows(dataset.sourceType, rows.length, columns.length)
  const [rowsReady, setRowsReady] = useState(!deferRows)

  useEffect(() => {
    if (!deferRows) {
      setRowsReady(true)
      return undefined
    }
    setRowsReady(false)
    const frame = window.requestAnimationFrame(() => setRowsReady(true))
    return () => window.cancelAnimationFrame(frame)
  }, [dataset.datasetId, deferRows])

  useEffect(() => {
    if (!rowsReady) return undefined
    const node = scrollRef.current
    if (!node) return undefined
    const measure = () => setViewportHeight(node.clientHeight || PREVIEW_VIEWPORT_SIZE)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(node)
    return () => observer?.disconnect()
  }, [rowsReady, rows.length, columns.length])

  const windowed = useMemo(
    () => previewWindow({
      rowCount: rows.length,
      columnCount: columns.length,
      scrollOffset: scrollTop,
      viewportSize: viewportHeight,
    }),
    [columns.length, rows.length, scrollTop, viewportHeight],
  )
  const showTable = !deferRows || rowsReady
  const visible = showTable && windowed.virtualized ? rows.slice(windowed.start, windowed.end) : rows

  return (
    <Card className="dataset-preview" aria-labelledby="dataset-heading">
      <CardHeader className="section-heading flex-row items-start justify-between space-y-0">
        <div>
          <p className="eyebrow">{sourceLabel(dataset.sourceType)}</p>
          <h2 id="dataset-heading">{dataset.displayName}</h2>
        </div>
        <Badge variant="secondary">{dataset.acceptedRowCount} rows</Badge>
      </CardHeader>
      <CardContent>
        {columns.length > 0 ? (
          <p className="preview-meta">{columns.length} columns</p>
        ) : null}
        {showTable ? (
          <div
            ref={scrollRef}
            className={`table-scroll preview-table${windowed.virtualized ? ' is-virtualized' : ''}`}
            onScroll={windowed.virtualized ? (event) => setScrollTop(event.currentTarget.scrollTop) : undefined}
          >
            <table aria-label="Dataset preview" aria-rowcount={1 + rows.length}>
              <thead>
                <tr>
                  {columns.map((column, index) => (
                    <th key={column.name} className={index === 0 ? 'is-sticky' : undefined}>{column.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {windowed.virtualized && windowed.padStart > 0 ? (
                  <tr aria-hidden="true">
                    <td
                      className="preview-spacer"
                      colSpan={Math.max(1, columns.length)}
                      style={{ height: windowed.padStart }}
                    />
                  </tr>
                ) : null}
                {visible.map((row, offset) => {
                  const rowIndex = windowed.virtualized ? windowed.start + offset : offset
                  return (
                    <tr key={rowIndex} aria-rowindex={rowIndex + 2}>
                      {columns.map((column, index) => (
                        <td key={column.name} className={index === 0 ? 'is-sticky' : undefined}>{previewValue(row[column.name])}</td>
                      ))}
                    </tr>
                  )
                })}
                {windowed.virtualized && windowed.padEnd > 0 ? (
                  <tr aria-hidden="true">
                    <td
                      className="preview-spacer"
                      colSpan={Math.max(1, columns.length)}
                      style={{ height: windowed.padEnd }}
                    />
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="preview-loading" role="status">
            <p>Loading rows…</p>
            <div className="preview-skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </CardContent>
      {onChange && (
        <CardFooter className="preview-actions">
          <Button variant="ghost" type="button" onClick={onChange}>Change dataset</Button>
        </CardFooter>
      )}
    </Card>
  )
}
