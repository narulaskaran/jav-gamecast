import { useEffect, useMemo, useRef, useState } from 'react'
import type { DatasetPreview } from '../shared/dataset'
import { PREVIEW_OVERSCAN, PREVIEW_ROW_HEIGHT, PREVIEW_VIEWPORT, PREVIEW_VIRTUALIZE_AFTER } from '../dataset/previewWindow'
import { virtualWindow } from '../runView/virtualWindow'
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

const SpacerRow = ({ height, columns }: { height: number; columns: number }) => {
  if (height <= 0) return null
  return (
    <tr className="preview-spacer" aria-hidden="true">
      <td colSpan={Math.max(1, columns)} style={{ height }} />
    </tr>
  )
}

export const DatasetPreviewCard = ({ dataset, onChange }: { dataset: DatasetPreview; onChange?: () => void }) => {
  const columns = dataset.columns
  const rows = dataset.previewRows
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(PREVIEW_VIEWPORT)
  const virtualizeAfter = dataset.sourceType === 'fixture' ? rows.length : PREVIEW_VIRTUALIZE_AFTER

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return undefined
    const measure = () => setViewportHeight(node.clientHeight || PREVIEW_VIEWPORT)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(node)
    return () => observer?.disconnect()
  }, [rows.length, columns.length])

  const window = useMemo(
    () => virtualWindow({
      count: rows.length,
      scrollOffset: scrollTop,
      viewportSize: viewportHeight,
      itemSize: PREVIEW_ROW_HEIGHT,
      overscan: PREVIEW_OVERSCAN,
      virtualizeAfter,
    }),
    [rows.length, scrollTop, viewportHeight, virtualizeAfter],
  )
  const visibleRows = window.virtualized ? rows.slice(window.start, window.end) : rows

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
          ref={scrollRef}
          className="table-scroll preview-table"
          data-virtualized={window.virtualized ? 'true' : undefined}
          onScroll={window.virtualized ? (event) => setScrollTop(event.currentTarget.scrollTop) : undefined}
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
              {window.virtualized ? <SpacerRow height={window.padStart} columns={columns.length} /> : null}
              {visibleRows.map((row, offset) => {
                const rowIndex = window.virtualized ? window.start + offset : offset
                return (
                  <tr key={rowIndex}>
                    {columns.map((column, index) => (
                      <td key={column.name} className={index === 0 ? 'is-sticky' : undefined}>{previewValue(row[column.name])}</td>
                    ))}
                  </tr>
                )
              })}
              {window.virtualized ? <SpacerRow height={window.padEnd} columns={columns.length} /> : null}
            </tbody>
          </table>
        </div>
      </CardContent>
      {onChange && (
        <CardFooter className="preview-actions">
          <Button variant="ghost" type="button" onClick={onChange}>Change dataset</Button>
        </CardFooter>
      )}
    </Card>
  )
}
