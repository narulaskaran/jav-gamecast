import { SAMPLE_DATASET_NAME } from '../shared/sampleDatasetName'
import { plainDatasetError } from '../dataset/csvTypes'
import type { DatasetIntakeStatus } from '../shared/dataset'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { Label } from './ui/label'

const BYOD_ERROR_HEADING = "Couldn't use this CSV"

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
  return (
    <section className="intake-panel" aria-labelledby="intake-heading">
      <h2 id="intake-heading">Choose a dataset</h2>
      <div className="intake-cards">
        <Card className="intake-card">
          <CardHeader>
            <p className="eyebrow">Try sample</p>
            <CardTitle>{SAMPLE_DATASET_NAME}</CardTitle>
          </CardHeader>
          <CardContent>
            <Button type="button" onClick={onTrySample} disabled={disabled}>Try sample</Button>
          </CardContent>
        </Card>
        <Card className={`intake-card ${disabled || byodBlocked ? 'is-disabled' : ''}`}>
          <CardHeader>
            <p className="eyebrow">Bring your own</p>
            <CardTitle>Upload .csv or public HTTPS CSV URL</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="byod-file">
              <Label htmlFor="csv-file">Upload .csv</Label>
              <Input
                id="csv-file"
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
            </div>
            <form
              className="byod-url"
              onSubmit={(event) => {
                event.preventDefault()
                const form = event.currentTarget
                const url = String(new FormData(form).get('csv-url') ?? '')
                onSubmitUrl(url)
              }}
            >
              <Label htmlFor="csv-url">Public HTTPS CSV URL</Label>
              <Input id="csv-url" name="csv-url" type="url" placeholder="https://example.com/data.csv" disabled={disabled || byodBlocked} />
              <Button variant="secondary" type="submit" disabled={disabled || byodBlocked}>Use public CSV URL</Button>
            </form>
          </CardContent>
        </Card>
      </div>
      {intakeError && (
        <div className="error-banner" role="alert">
          <b>{BYOD_ERROR_HEADING}</b>
          <span>{plainDatasetError(intakeError, intakeError)}</span>
        </div>
      )}
    </section>
  )
}
