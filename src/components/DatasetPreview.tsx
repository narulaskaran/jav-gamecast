import { useEffect, useMemo, useRef, useState } from 'react'
import type { DatasetPreview } from '../shared/dataset'
import {
  PREVIEW_OVERSCAN,
  PREVIEW_ROW_SIZE,
  PREVIEW_VIRTUALIZE_AFTER,
  shouldVirtualizePreview,
} from '../dataset/previewBounds'
import { railWindow } from '../runView/railWindow'
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
  const tableRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(280)
  const virtualize = shouldVirtualizePreview({
    sourceType: dataset.sourceType,
    rowCount: rows.length,
    columnCount: columns.length,
  })

  useEffect(() => {
    const node = tableRef.current
    if (!node || !virtualize) return undefined
    const measure = () => setViewportHeight(node.clientHeight || 280)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(node)
    return () => observer?.disconnect()
  }, [virtualize])

  const window = useMemo(
    () => virtualize
      ? railWindow({
        count: rows.length,
        scrollOffset: scrollTop,
        viewportSize: viewportHeight,
        itemSize: PREVIEW_ROW_SIZE,
        overscan: PREVIEW_OVERSCAN,
        virtualizeAfter: PREVIEW_VIRTUALIZE_AFTER,
      })
      : { start: 0, end: rows.length, padStart: 0, padEnd: 0, virtualized: false },
    [rows.length, scrollTop, viewportHeight, virtualize],
  )
  const visibleRows = virtualize ? rows.slice(window.start, window.end) : rows
  const previewLimited = dataset.sourceType !== 'fixture' && (
    rows.length < dataset.acceptedRowCount || window.virtualized
  )

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
        <div
          ref={tableRef}
          className={`table-scroll preview-table${window.virtualized ? ' is-virtualized' : ''}`}
          onScroll={virtualize ? (event) => setScrollTop(event.currentTarget.scrollTop) : undefined}
        >
          <table aria-label="Dataset preview">
            <thead>
              <tr>
                {columns.map((column, index) => (
                  <th key={column.name} className={index === 0 ? 'is-sticky' : undefined}>{column.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {window.virtualized && window.padStart > 0 ? (
                <tr className="preview-spacer" aria-hidden="true">
                  <td colSpan={Math.max(1, columns.length)} style={{ height: window.padStart }} />
                </tr>
              ) : null}
              {visibleRows.map((row, offset) => {
                const rowIndex = window.start + offset
                return (
                  <tr key={rowIndex}>
                    {columns.map((column, index) => (
                      <td key={column.name} className={index === 0 ? 'is-sticky' : undefined}>{previewValue(row[column.name])}</td>
                    ))}
                  </tr>
                )
              })}
              {window.virtualized && window.padEnd > 0 ? (
                <tr className="preview-spacer" aria-hidden="true">
                  <td colSpan={Math.max(1, columns.length)} style={{ height: window.padEnd }} />
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {previewLimited ? (
          <p className="preview-meta">Large table — preview is limited so the page stays responsive.</p>
        ) : null}
      </CardContent>
      {onChange && (
        <CardFooter className="preview-actions">
          <Button variant="ghost" type="button" onClick={onChange}>Change dataset</Button>
        </CardFooter>
      )}
    </Card>
  )
}
