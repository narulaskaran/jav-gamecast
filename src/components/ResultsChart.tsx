import { classDistribution } from '../dataset/classDistribution'
import type { AnalysisResultRow } from '../shared/analysis'

export const ResultsChart = ({
  rows,
  classes = [],
  totalRows,
}: {
  rows: readonly AnalysisResultRow[]
  classes?: readonly string[]
  totalRows?: number
}) => {
  const values = classDistribution(rows, classes)
  const max = Math.max(...values.map((item) => item.count), 1)
  const classified = rows.filter((row) => row.selectedClass).length
  return (
    <section className="distribution-card chart-hero" aria-labelledby="distribution-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Live chart</p>
          <h3 id="distribution-heading">Class distribution</h3>
        </div>
        <span className="table-count">{classified} classified{totalRows ? ` · ${totalRows} total` : ''}</span>
      </div>
      <div className="chart-shell" role="img" aria-label={classified === 0 ? 'Waiting for the first row' : 'Class distribution visualization'}>
        <div className="chart-axes" aria-hidden="true">
          <span className="chart-y-axis" />
          <span className="chart-x-axis" />
        </div>
        {classified === 0 ? (
          <p className="chart-empty">Waiting for the first row…</p>
        ) : (
          <div className="distribution-chart">
            {values.map(({ name, count }) => (
              <div className="distribution-row" key={name}>
                <div className="distribution-label">
                  <span>{name}</span>
                  <b>{count}</b>
                </div>
                <div className="distribution-track">
                  <span style={{ width: `${Math.max(count === 0 ? 0 : 6, (count / max) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
