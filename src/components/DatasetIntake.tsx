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
      <h2 id="intake-heading" className="visually-hidden">Choose a dataset</h2>
      <p className="intake-disclosure">{PUBLIC_DATA_WARNING}</p>
      <div className="intake-cards">
        <article className="intake-card">
          <p className="eyebrow">Try sample</p>
          <h3>Super Bowl Seahawks demo</h3>
          <p>A thin on-ramp that shows the live row chart. Football is the sample, not the product.</p>
          <button className="primary-button" type="button" onClick={onTrySample} disabled={disabled}>Try sample</button>
        </article>
        <article className={`intake-card ${disabled || byodBlocked ? 'is-disabled' : ''}`}>
          <p className="eyebrow">Bring your own</p>
          <h3>Upload .csv or public HTTPS CSV URL</h3>
          <p>Same run UX as the sample. The chart updates as each row is classified.</p>
          <label className="byod-file">
            Upload .csv
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
            className="byod-url"
            onSubmit={(event) => {
              event.preventDefault()
              const form = event.currentTarget
              const url = String(new FormData(form).get('csv-url') ?? '')
              onSubmitUrl(url)
            }}
          >
            <label htmlFor="csv-url">Public HTTPS CSV URL</label>
            <input id="csv-url" name="csv-url" type="url" placeholder="https://example.com/data.csv" disabled={disabled || byodBlocked} />
            <button className="secondary-button" type="submit" disabled={disabled || byodBlocked}>Use public CSV URL</button>
          </form>
        </article>
      </div>
      {missing && <p className="intake-missing" role="status">{missing} Sample still works; upload and public URL stay fail-closed.</p>}
      {intakeError && <div className="error-banner" role="alert"><b>Dataset needs attention</b><span>{plainDatasetError(intakeError, intakeError)}</span></div>}
    </section>
  )
}
