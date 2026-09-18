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
        <div className="preview-meta">
          <span><b>Columns</b>{dataset.columns.length}</span>
          <span><b>Delimiter</b>{dataset.delimiter === '\t' ? 'tab' : dataset.delimiter}</span>
          <span><b>Source</b>{dataset.sourceType.replace('_', ' ')}</span>
        </div>
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
        <p className="preview-disclosure">{dataset.publicDataWarning}</p>
        {dataset.attribution && (
          <div className="preview-links">
            <a href={dataset.attribution.sourceUrl} target="_blank" rel="noreferrer">Sample source</a>
            <a href={dataset.attribution.licenseUrl} target="_blank" rel="noreferrer">CC BY 4.0</a>
            <span>{dataset.attribution.disclosure}</span>
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
