import { useEffect, useReducer, useState } from 'react'
import { ForecastChart } from './ForecastChart'
import { defaultForecastSource, fixtureGameStateSource } from './sources'
import { teamCode } from './teamMetadata'
import { initialReplayState, replayReducer } from './replay'
import type { BrowserForecastSource } from './browser/forecastRead'
import type { FeedStatus, ForecastSource, GameState, GameStateSource } from './types'
import './styles.css'

interface AppProps {
  forecastSource?: ForecastSource | BrowserForecastSource
  gameStateSource?: GameStateSource
}

const formatTimestamp = (timestamp: string) => new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(timestamp))
const choiceLabel = (choice: 'home' | 'away' | 'tie', game: GameState) => choice === 'home' ? game.homeTeam : choice === 'away' ? game.awayTeam : 'Tie'
const titleCase = (value: string) => value[0].toUpperCase() + value.slice(1)
const statusDescription: Record<FeedStatus, string> = {
  REPLAY: 'Synthetic replay',
  LIVE: 'Live snapshot',
  STALE: 'Snapshot may be out of date',
  ERROR: 'Live feed unavailable',
  LIMITED: 'Limited live data',
  MOCK: 'Mock data',
}

const StatusPill = ({ label }: { label: FeedStatus }) => (
  <span className={`status-pill status-${label.toLowerCase()} is-current`} data-status={label} aria-label={`${statusDescription[label]} status`}>
    <span className="status-dot" aria-hidden="true" />
    <span>{label}</span>
    <span className="status-detail">{statusDescription[label]}</span>
  </span>
)

export const App = ({ forecastSource = defaultForecastSource, gameStateSource = fixtureGameStateSource }: AppProps) => {
  const [points, setPoints] = useState(() => forecastSource.getPoints())
  const [replay, dispatch] = useReducer(replayReducer, points.length, initialReplayState)
  const pointIndex = Math.max(0, Math.min(replay.index, points.length - 1))
  const point = points[pointIndex]
  const snapshot = gameStateSource.getSnapshotAt(pointIndex)
  const game = snapshot.state
  const status = 'feedStatus' in forecastSource && forecastSource.feedStatus ? forecastSource.feedStatus : snapshot.status
  const awayCode = teamCode(game.awayTeam)
  const homeCode = teamCode(game.homeTeam)
  const updateAge = pointIndex === 0 ? 'opening point' : `${Math.round(point.elapsedSeconds / 60)} min into replay`

  useEffect(() => {
    setPoints(forecastSource.getPoints())
    if (!('refresh' in forecastSource)) return undefined
    let active = true
    void forecastSource.refresh().then((nextPoints) => {
      if (active) setPoints(nextPoints)
    }, () => undefined)
    return () => { active = false }
  }, [forecastSource])

  useEffect(() => {
    if (!replay.isPlaying) return undefined
    const timer = window.setInterval(() => dispatch({ type: 'advance', points }), 1100)
    return () => window.clearInterval(timer)
  }, [points, replay.isPlaying])

  const step = (delta: number) => dispatch({ type: 'step', delta, total: points.length })

  return (
    <main className="page-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Jev Gamecast home"><span className="brand-mark">J</span><span>JEV / GAMECAST</span></a>
        <p className="positioning">A replay-first forecast for one game</p>
      </header>

      <section className="intro" aria-labelledby="page-title">
        <div className="intro-heading">
          <p className="eyebrow">Football / forecast replay</p>
          <h1 id="page-title">Jev forecasts<br /><em>this football game.</em></h1>
        </div>
        <p className="intro-copy">Follow the read as the game moves. Scrub the timeline or play the replay to see each checkpoint change.</p>
      </section>

      <section className="game-card" aria-label="Featured game">
        <div className="game-card-top">
          <div className="fixture-label"><span>Featured game</span><span className="muted-divider" aria-hidden="true">/</span><span>{status === 'LIVE' ? 'ESPN snapshot' : 'Synthetic fixture'}</span></div>
          <StatusPill label={status} />
        </div>
        <div className="matchup">
          <div className="team team-away"><span className="team-code">{awayCode}</span><div><span className="team-label">Away</span><strong>{game.awayTeam}</strong></div></div>
          <div className="scoreboard"><div className="score"><b>{game.awayScore}</b><span>—</span><b>{game.homeScore}</b></div><div className="score-status">{game.status === 'final' ? 'Final' : `${game.quarter} · ${game.clock}`}</div></div>
          <div className="team team-home"><div><span className="team-label">Home</span><strong>{game.homeTeam}</strong></div><span className="team-code home-code">{homeCode}</span></div>
        </div>
        <div className="game-context">
          <span><b>Possession</b>{game.possession ? titleCase(game.possession === 'home' ? game.homeTeam : game.awayTeam) : 'None'}</span>
          <span><b>Last play</b>{game.lastPlay}</span>
          <span><b>Checkpoint</b>{formatTimestamp(point.timestamp)} UTC</span>
        </div>
      </section>

      <section className="forecast-panel" aria-labelledby="forecast-heading">
        <div className="forecast-panel-top">
          <div>
            <p className="eyebrow">Jev forecast</p>
            <h2 id="forecast-heading">Current forecast</h2>
          </div>
          <span className="fictional-tag">Experimental · not betting odds</span>
        </div>
        <div className="forecast-readout" aria-label="Current forecast details">
          <div className="latest-choice"><span className="detail-label">Jev picks</span><div className="choice-line"><span className={`choice-dot choice-${point.choice}`} /><strong>{choiceLabel(point.choice, game)}</strong><span className="choice-arrow" aria-hidden="true">↗</span></div></div>
          <div className="metric"><span className="detail-label">Confidence</span><strong>{point.confidence}%</strong><span className="metric-bar" aria-hidden="true"><i style={{ width: `${point.confidence}%` }} /></span></div>
          <div className="probabilities"><span className="detail-label">Win / tie / win</span><div><span><i className="home-swatch" /> {homeCode} <b>{point.homeProbability}%</b></span><span><i className="away-swatch" /> {awayCode} <b>{point.awayProbability}%</b></span><span><i className="tie-swatch" /> TIE <b>{point.tieProbability}%</b></span></div></div>
        </div>
        <ForecastChart points={points} currentIndex={pointIndex} game={game} />
        <div className="event-rail" aria-label="Replay event checkpoints">
          {points.map((item, index) => <button className={`event-pin ${index === pointIndex ? 'is-selected' : ''}`} key={item.id} type="button" aria-label={`Jump to ${item.eventLabel ?? `checkpoint ${index + 1}`}`} aria-current={index === pointIndex ? 'step' : undefined} onClick={() => dispatch({ type: 'seek', index, total: points.length })}><span className="event-pin-dot" /><span className="event-pin-time">{formatTimestamp(item.timestamp)}</span></button>)}
        </div>
        <div className="current-event"><span className="event-kicker">At this checkpoint</span><strong>{point.eventLabel ?? `Checkpoint ${pointIndex + 1}`}</strong><span>{game.lastPlay}</span></div>
        <section className="replay-controls" aria-label="Offline replay controls">
          <div className="control-buttons"><button type="button" className="icon-button" aria-label="Restart replay" onClick={() => dispatch({ type: 'reset' })}>↺</button><button type="button" className="icon-button" aria-label="Step replay backward" disabled={pointIndex === 0} onClick={() => step(-1)}>‹</button><button type="button" className="play-button" aria-label={replay.isPlaying ? 'Pause replay' : 'Play replay'} onClick={() => dispatch({ type: 'toggle' })}>{replay.isPlaying ? 'Ⅱ' : '▶'} <span>{replay.isPlaying ? 'Pause' : 'Play replay'}</span></button><button type="button" className="icon-button" aria-label="Step replay forward" disabled={pointIndex === points.length - 1} onClick={() => step(1)}>›</button></div>
          <div className="scrubber"><div className="scrubber-label"><label htmlFor="replay-position">Replay position</label><span>{String(Math.max(1, pointIndex + 1)).padStart(2, '0')} / {String(points.length).padStart(2, '0')}</span></div><input id="replay-position" aria-label="Replay position" type="range" min="0" max={points.length - 1} value={pointIndex} onChange={(event) => dispatch({ type: 'seek', index: Number(event.target.value), total: points.length })} /></div>
          <div className="replay-note"><span className="replay-icon" aria-hidden="true">◌</span><span>Offline replay<br /><b>{updateAge}</b></span></div>
        </section>
      </section>

      <footer className="disclosure"><span><b>Experimental forecast</b> · Synthetic sanitized fixture · No live inference call</span><span>Updated {formatTimestamp(point.timestamp)} UTC · Not betting odds</span></footer>
    </main>
  )
}
