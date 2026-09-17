import { PUBLIC_DATA_WARNING, plainDatasetError } from '../dataset/csvTypes'
import type { DatasetIntakeStatus } from '../shared/dataset'

export const DatasetIntake = ({
  status,
  intakeError,
  onUploadFile,
  onSubmitUrl,
  onTrySample,
  disabled,
}: {
  status?: DatasetIntakeStatus
  intakeError?: string
  onUploadFile: (file: File) => void
  onSubmitUrl: (url: string) => void
  onTrySample: () => void
  disabled?: boolean
}) => {
  const byodBlocked = status?.convex === false || status?.uploadThing === false
  const missing = status?.convex === false ? 'Durable storage is not configured on this deployment.' : status?.uploadThing === false ? 'CSV storage is not configured on this deployment.' : undefined
  return (
    <section className="intake-panel" aria-labelledby="intake-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Bring a dataset</p>
          <h2 id="intake-heading">CSV in. Live classes out.</h2>
        </div>
      </div>
      <p className="intake-disclosure">{PUBLIC_DATA_WARNING}</p>
      <div className="intake-cards">
        <label className={`intake-card ${disabled || byodBlocked ? 'is-disabled' : ''}`}>
          <p className="eyebrow">Primary</p>
          <h3>Upload CSV</h3>
          <p>Choose a .csv file from this machine. The server re-validates it before anything is stored.</p>
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="Upload CSV"
            disabled={disabled || byodBlocked}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) onUploadFile(file)
            }}
          />
        </label>
        <form
          className={`intake-card ${disabled || byodBlocked ? 'is-disabled' : ''}`}
          onSubmit={(event) => {
            event.preventDefault()
            const form = event.currentTarget
            const url = String(new FormData(form).get('csv-url') ?? '')
            onSubmitUrl(url)
          }}
        >
          <p className="eyebrow">Equal path</p>
          <h3>Public CSV URL</h3>
          <p>HTTPS only. The link must be public and return CSV directly — no cookies or signed private files.</p>
          <label htmlFor="csv-url">Public CSV URL</label>
          <input id="csv-url" name="csv-url" type="url" placeholder="https://example.com/data.csv" disabled={disabled || byodBlocked} />
          <button className="secondary-button" type="submit" disabled={disabled || byodBlocked}>Use public CSV URL</button>
        </form>
      </div>
      <button className="tertiary-button" type="button" onClick={onTrySample} disabled={disabled}>Try sample dataset</button>
      {missing && <p className="intake-missing" role="status">{missing} Sample still works; upload and public URL stay fail-closed.</p>}
      {intakeError && <div className="error-banner" role="alert"><b>Dataset needs attention</b><span>{plainDatasetError(intakeError, intakeError)}</span></div>}
    </section>
  )
}
