import type { DatasetPreview } from '../shared/dataset'
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

export const previewRowCapCopy = (shown: number, total: number): string | undefined => {
  if (shown < 1 || shown >= total) return undefined
  return `Showing first ${shown} of ${total}`
}

export const DatasetPreviewCard = ({ dataset, onChange }: { dataset: DatasetPreview; onChange?: () => void }) => {
  const columns = dataset.columns
  const cap = previewRowCapCopy(dataset.previewRows.length, dataset.acceptedRowCount)
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
          <p className="preview-meta">
            {columns.length} columns{cap ? ` · ${cap}` : ''}
          </p>
        ) : cap ? (
          <p className="preview-meta">{cap}</p>
        ) : null}
        <div className="table-scroll preview-table">
          <table aria-label="Dataset preview">
            <thead>
              <tr>
                {columns.map((column, index) => (
                  <th key={column.name} className={index === 0 ? 'is-sticky' : undefined}>{column.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataset.previewRows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {columns.map((column, index) => (
                    <td key={column.name} className={index === 0 ? 'is-sticky' : undefined}>{previewValue(row[column.name])}</td>
                  ))}
                </tr>
              ))}
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
