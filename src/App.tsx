import { useEffect, useReducer } from 'react'
import { ForecastChart } from './ForecastChart'
import { fixtureForecastSource, fixtureGameStateSource } from './sources'
import { getReplayStatus, initialReplayState, replayReducer } from './replay'
import type { GameState } from './types'
import './styles.css'

const formatTimestamp = (timestamp: string) => new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(timestamp))
const choiceLabel = (choice: 'home' | 'away' | 'tie', game: GameState) => choice === 'home' ? game.homeTeam : choice === 'away' ? game.awayTeam : 'Tie'
const titleCase = (value: string) => value[0].toUpperCase() + value.slice(1)

const StatusPill = ({ label, active = false }: { label: 'REPLAY' | 'LIVE' | 'STALE'; active?: boolean }) => <span className={`status-pill status-${label.toLowerCase()} ${active ? 'is-current' : ''}`} aria-current={active ? 'true' : undefined}><span className="status-dot" />{label}</span>

export const App = () => {
  const points = fixtureForecastSource.getPoints()
  const [replay, dispatch] = useReducer(replayReducer, points.length, initialReplayState)
  const game = fixtureGameStateSource.getStateAt(replay.index)
  const point = points[Math.max(0, replay.index)]
  const status = getReplayStatus(false, false)
  const updateAge = replay.index === 0 ? 'opening point' : `${Math.round(point.elapsedSeconds / 60)} min into replay`

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
        <p className="positioning">Jev forecasts this football game</p>
        <span className="stage-label">STAGE 01 <span aria-hidden="true">·</span> REPLAY</span>
      </header>

      <section className="intro" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">A systems demo in motion</p>
          <h1 id="page-title">One game.<br /><em>Every shift.</em></h1>
        </div>
        <p className="intro-copy">A replay of a fictional football game, with a new structured forecast at every checkpoint. Scrub the timeline to see the read change.</p>
      </section>

      <section className="game-card" aria-label="Featured game">
        <div className="game-card-top"><div className="game-ident"><span className="live-dot" /> FEATURED REPLAY <span className="muted-divider">/</span> SYNTHETIC FIXTURE</div><div className="status-pills"><StatusPill label="REPLAY" active /><StatusPill label="LIVE" /><StatusPill label="STALE" /></div></div>
        <div className="matchup">
          <div className="team team-away"><span className="team-code">CF</span><div><span className="team-label">AWAY</span><strong>{game.awayTeam}</strong></div></div>
          <div className="scoreboard"><div className="score"><b>{game.awayScore}</b><span>—</span><b>{game.homeScore}</b></div><div className="score-status">{game.status === 'final' ? 'FINAL' : `${game.quarter} · ${game.clock}`}</div></div>
          <div className="team team-home"><div><span className="team-label">HOME</span><strong>{game.homeTeam}</strong></div><span className="team-code home-code">HH</span></div>
        </div>
        <div className="game-context"><span><b>POSSESSION</b>{game.possession ? titleCase(game.possession === 'home' ? game.homeTeam : game.awayTeam) : 'None'}</span><span><b>LAST PLAY</b>{game.lastPlay}</span><span><b>CHECKPOINT</b>{formatTimestamp(point.timestamp)} UTC</span></div>
      </section>

      <section className="forecast-panel" aria-labelledby="forecast-heading">
        <div className="forecast-panel-top"><div><p className="eyebrow">Experimental forecast distribution</p><h2 id="forecast-heading">The forecast, checkpoint by checkpoint</h2></div><span className="fictional-tag">NOT BETTING ODDS</span></div>
        <ForecastChart points={points} currentIndex={replay.index} />
        <div className="event-rail" aria-label="Replay event checkpoints">
          {points.map((item, index) => <button className={`event-pin ${index === replay.index ? 'is-selected' : ''}`} key={item.id} type="button" aria-label={`Jump to ${item.eventLabel ?? `checkpoint ${index + 1}`}`} aria-current={index === replay.index ? 'step' : undefined} onClick={() => dispatch({ type: 'seek', index, total: points.length })}><span className="event-pin-dot" /><span className="event-pin-time">{formatTimestamp(item.timestamp)}</span></button>)}
        </div>
        <div className="current-event"><span className="event-kicker">CURRENT EVENT</span><strong>{point.eventLabel}</strong><span>{game.lastPlay}</span></div>
      </section>

      <section className="replay-controls" aria-label="Offline replay controls">
        <div className="control-buttons"><button type="button" className="icon-button" aria-label="Restart replay" onClick={() => dispatch({ type: 'reset' })}>↺</button><button type="button" className="icon-button" aria-label="Step replay backward" onClick={() => step(-1)}>‹</button><button type="button" className="play-button" aria-label={replay.isPlaying ? 'Pause replay' : 'Play replay'} onClick={() => dispatch({ type: 'toggle' })}>{replay.isPlaying ? 'Ⅱ' : '▶'} <span>{replay.isPlaying ? 'PAUSE' : 'PLAY REPLAY'}</span></button><button type="button" className="icon-button" aria-label="Step replay forward" onClick={() => step(1)}>›</button></div>
        <div className="scrubber"><div className="scrubber-label"><label htmlFor="replay-position">REPLAY POSITION</label><span>{String(Math.max(1, replay.index + 1)).padStart(2, '0')} / {String(points.length).padStart(2, '0')}</span></div><input id="replay-position" aria-label="Replay position" type="range" min="0" max={points.length - 1} value={Math.max(0, replay.index)} onChange={(event) => dispatch({ type: 'seek', index: Number(event.target.value), total: points.length })} /></div>
        <div className="replay-note"><span className="replay-icon">◌</span><span>Offline replay<br /><b>{updateAge}</b></span></div>
      </section>

      <section className="insight-grid" aria-label="Latest forecast details">
        <div className="latest-choice"><span className="eyebrow">Latest Jev choice</span><div className="choice-line"><span className={`choice-dot choice-${point.choice}`} /><strong>{choiceLabel(point.choice, game)}</strong><span className="choice-arrow">↗</span></div><span className="micro-copy">Most likely outcome at this checkpoint</span></div>
        <div className="metric"><span className="eyebrow">Confidence</span><strong>{point.confidence}%</strong><span className="metric-bar"><i style={{ width: `${point.confidence}%` }} /></span></div>
        <div className="probabilities"><span className="eyebrow">Distribution</span><div><span><i className="home-swatch" /> HH <b>{point.homeProbability}%</b></span><span><i className="away-swatch" /> CF <b>{point.awayProbability}%</b></span><span><i className="tie-swatch" /> TIE <b>{point.tieProbability}%</b></span></div></div>
      </section>

      <footer className="disclosure"><span><b>JEV FORECAST / EXPERIMENTAL</b> · Synthetic sanitized fixture · No live feed or inference call</span><span>State: <strong>{status}</strong> · Updated {formatTimestamp(point.timestamp)} UTC</span></footer>
    </main>
  )
}
