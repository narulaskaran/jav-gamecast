import type { DatasetPreview } from '../shared/dataset'

const previewValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

export const DatasetPreviewCard = ({ dataset, onChange }: { dataset: DatasetPreview; onChange?: () => void }) => {
  const columns = dataset.columns.slice(0, 6)
  return (
    <section className="fixture-card dataset-preview" aria-labelledby="dataset-heading">
      <div className="fixture-card-head">
        <div>
          <p className="eyebrow">{dataset.sourceType === 'fixture' ? 'Sample on-ramp' : dataset.sourceType === 'upload' ? 'Uploaded CSV' : 'Public CSV'}</p>
          <h2 id="dataset-heading">{dataset.displayName}</h2>
        </div>
        <span className="fixture-badge">{dataset.acceptedRowCount} rows</span>
      </div>
      <div className="fixture-meta">
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
      <p className="fixture-disclosure">{dataset.publicDataWarning}</p>
      {dataset.attribution && (
        <div className="fixture-links">
          <a href={dataset.attribution.sourceUrl} target="_blank" rel="noreferrer">Sample source</a>
          <a href={dataset.attribution.licenseUrl} target="_blank" rel="noreferrer">CC BY 4.0</a>
          <span>{dataset.attribution.disclosure}</span>
        </div>
      )}
      {onChange && <div className="preview-actions"><button className="text-button" type="button" onClick={onChange}>Change dataset</button></div>}
    </section>
  )
}
