import type { ForecastPoint, GameState } from './types'

interface ForecastChartProps {
  points: readonly ForecastPoint[]
  currentIndex: number
  game: GameState
}

const WIDTH = 760
const HEIGHT = 360
const PADDING = { top: 26, right: 24, bottom: 46, left: 46 }
const INNER_WIDTH = WIDTH - PADDING.left - PADDING.right
const INNER_HEIGHT = HEIGHT - PADDING.top - PADDING.bottom

type ProbabilityKey = keyof Pick<ForecastPoint, 'homeProbability' | 'awayProbability' | 'tieProbability'>

const xFor = (index: number, total: number) => PADDING.left + (total <= 1 ? 0 : (index / (total - 1)) * INNER_WIDTH)
const yFor = (probability: number) => PADDING.top + ((100 - probability) / 100) * INNER_HEIGHT
const pathFor = (points: readonly ForecastPoint[], key: ProbabilityKey, endIndex = points.length - 1) =>
  points.slice(0, endIndex + 1).map((point, index) => `${index === 0 ? 'M' : 'L'} ${xFor(index, points.length).toFixed(1)} ${yFor(point[key]).toFixed(1)}`).join(' ')

const seriesFor = (game: GameState) => [
  { key: 'homeProbability', label: game.homeTeam, short: 'Home', color: '#f05d4f' },
  { key: 'awayProbability', label: game.awayTeam, short: 'Away', color: '#2f70c0' },
  { key: 'tieProbability', label: 'Tie', short: 'Tie', color: '#8b7cf6' },
] as const

export const ForecastChart = ({ points, currentIndex, game }: ForecastChartProps) => {
  const safeIndex = Math.max(0, Math.min(currentIndex, points.length - 1))
  const current = points[safeIndex]
  const series = seriesFor(game)
  return (
    <div className="chart-shell">
      <div className="chart-heading">
        <div>
          <p className="eyebrow">Forecast history</p>
          <h2>What Jev saw as the game moved</h2>
        </div>
        <div className="chart-range" aria-label="Chart range">0–100<span>%</span></div>
      </div>
      <div className="chart-wrap">
        <svg className="forecast-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`Historical forecast chart for ${game.homeTeam}, ${game.awayTeam}, and tie probabilities`}>
          <defs>
            <linearGradient id="chartGlow" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#f05d4f" stopOpacity=".13" />
              <stop offset="1" stopColor="#f05d4f" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 25, 50, 75, 100].map((value) => (
            <g key={value}>
              <line className="grid-line" x1={PADDING.left} x2={WIDTH - PADDING.right} y1={yFor(value)} y2={yFor(value)} />
              <text className="axis-label" x={PADDING.left - 12} y={yFor(value) + 4} textAnchor="end">{value}</text>
            </g>
          ))}
          <path d={`${pathFor(points, 'homeProbability')} L ${xFor(points.length - 1, points.length)} ${HEIGHT - PADDING.bottom} L ${PADDING.left} ${HEIGHT - PADDING.bottom} Z`} fill="url(#chartGlow)" className="chart-area" />
          {series.map(({ key, color, label }) => (
            <g key={key}>
              <path data-series={label} data-series-key={key} d={pathFor(points, key)} fill="none" stroke={color} strokeWidth="2" strokeDasharray="4 5" opacity=".18" className="future-line" />
              <path data-testid={`forecast-line-${key}`} data-series={label} data-series-key={key} d={pathFor(points, key, safeIndex)} fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="forecast-line" />
            </g>
          ))}
          {points.map((point, index) => {
            const isEvent = Boolean(point.eventLabel)
            const active = index <= safeIndex
            return (
              <g key={point.id} className={active ? 'chart-point is-active' : 'chart-point'}>
                {isEvent && <line className="event-marker" data-timestamp={point.timestamp} x1={xFor(index, points.length)} x2={xFor(index, points.length)} y1={PADDING.top} y2={HEIGHT - PADDING.bottom} />}
                {series.map(({ key, color, label }) => (
                  <circle key={key} cx={xFor(index, points.length)} cy={yFor(point[key])} r={index === safeIndex ? 4.5 : 2.5} fill={color} stroke="#fbfaf7" strokeWidth="2">
                    <title>{`${point.timestamp}: ${label} ${point[key]}%`}</title>
                  </circle>
                ))}
              </g>
            )
          })}
          <line className="current-line" x1={xFor(safeIndex, points.length)} x2={xFor(safeIndex, points.length)} y1={PADDING.top} y2={HEIGHT - PADDING.bottom} />
          <text className="current-label" x={xFor(safeIndex, points.length)} y={PADDING.top - 9} textAnchor="middle">NOW</text>
          <text className="axis-label" x={PADDING.left} y={HEIGHT - 15}>START</text>
          <text className="axis-label" x={WIDTH - PADDING.right} y={HEIGHT - 15} textAnchor="end">FINAL</text>
          <title>{`Forecast at ${current?.timestamp ?? 'replay start'}`}</title>
        </svg>
      </div>
      <div className="legend" aria-label="Forecast series legend">
        {series.map(({ label, short, color }) => <span key={label} className="legend-item"><i style={{ backgroundColor: color }} /> <b>{short}</b><span className="legend-long">{label}</span></span>)}
      </div>
    </div>
  )
}
