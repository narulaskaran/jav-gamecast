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

export const DatasetPreviewCard = ({ dataset, onChange }: { dataset: DatasetPreview; onChange?: () => void }) => {
  const columns = dataset.columns.slice(0, 6)
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
        {dataset.columns.length > 0 ? (
          <p className="preview-meta">{dataset.columns.length} columns</p>
        ) : null}
        <div className="table-scroll preview-table">
          <table aria-label="Dataset preview">
            <thead>
              <tr>{columns.map((column) => <th key={column.name}>{column.name}</th>)}</tr>
            </thead>
            <tbody>
              {dataset.previewRows.map((row, index) => (
                <tr key={index}>{columns.map((column) => <td key={column.name}>{previewValue(row[column.name])}</td>)}</tr>
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
