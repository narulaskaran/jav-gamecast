import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { createBrowserForecastReadPath, createBrowserForecastSource } from './browser/forecastRead'
import { fixture, parseFixture } from './fixture'
import { InMemoryForecastStore } from './persistence/forecastStore'
import { ForecastWorker } from './server/forecastWorker'
import type { ForecastRecord } from './shared/forecastRecords'
import type { GameStateSource } from './types'

const makeSource = (game: typeof fixture.game, status: 'REPLAY' | 'LIVE' | 'STALE'): GameStateSource => ({
  getSnapshotAt(index) {
    const point = fixture.points[index]
    return {
      state: {
        ...game,
        eventId: point.eventId,
        timestamp: point.timestamp,
        lastPlay: point.eventLabel ?? game.lastPlay,
      },
      status,
    }
  },
})

describe('gamecast forecast rendering', () => {
  it('renders a live-shaped TypeSafe unit answer as display percentages exactly once', async () => {
    const store = new InMemoryForecastStore()
    const worker = new ForecastWorker({
      store,
      now: () => 1_000,
      provider: {
        async forecast() {
          return {
            model: 'jev-latest',
            answer: { type: 'choice' as const, choice: 'home' as const, probabilities: { home: 0.62, away: 0.28, tie: 0.1 }, confidence: 0.62 },
          }
        },
      },
    })
    await worker.forecast({ gameId: fixture.game.id, providerEventId: 'live-event', state: fixture.game })
    const source = createBrowserForecastSource({
      readPath: createBrowserForecastReadPath(store),
      gameId: fixture.game.id,
      fallback: fixture.points,
    })

    render(<App forecastSource={source} />)

    await waitFor(() => expect(document.querySelector('.probabilities')?.textContent).toContain('HH 62%'))
    expect(document.querySelector('.probabilities')?.textContent).toContain('CF 28%')
    expect(document.querySelector('.probabilities')?.textContent).toContain('TIE 10%')
    expect(document.querySelector('.metric strong')).toHaveTextContent('62%')
  })

  it('renders forecast points loaded through the injected shared read boundary', async () => {
    const record: ForecastRecord = {
      idempotencyKey: 'demo-2026-09-17:cached-event:event:shared-state',
      gameId: fixture.game.id,
      providerEventId: 'cached-event',
      stateHash: 'shared-state',
      rawNormalizedState: {
        eventId: 'cached-event',
        timestamp: '2026-09-17T03:40:00Z',
        eventLabel: 'Shared cached checkpoint',
        eventKind: 'swing',
      },
      model: 'replay-fixture',
      status: 'success',
      source: 'live',
      requestedAt: '2026-09-17T03:40:00Z',
      completedAt: '2026-09-17T03:40:00Z',
      latencyMs: 0,
      choice: 'home',
      probabilities: { home: 0.6, away: 0.3, tie: 0.1 },
      confidence: 0.6,
    }
    const store = new InMemoryForecastStore()
    store.put(record)
    const source = createBrowserForecastSource({
      readPath: createBrowserForecastReadPath({
        async getForecastByIdempotencyKey(key) { return store.getForecastByIdempotencyKey(key) },
        async listForecastsByGame(gameId) { return store.listForecastsByGame(gameId) },
      }),
      gameId: fixture.game.id,
      fallback: fixture.points,
    })

    render(<App forecastSource={source} />)

    await waitFor(() => expect(screen.getByText('Shared cached checkpoint')).toBeInTheDocument())
    expect(document.querySelector('.probabilities')?.textContent).toContain('HH 60%')
  })

  it('renders chart series, event markers, metadata, and replay state', () => {
    render(<App />)

    expect(screen.getByText('Jev forecasts this football game')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /historical forecast.*Harbor Hawks.*Cedar Foxes/i })).toBeInTheDocument()
    expect(screen.getAllByText('Harbor Hawks').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Cedar Foxes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('REPLAY').length).toBeGreaterThan(0)
    expect(screen.getByText('LIVE')).toBeInTheDocument()
    expect(screen.getByText('STALE')).toBeInTheDocument()
    expect(screen.getByText('Punt pins the opener')).toBeInTheDocument()
    expect(screen.getByText(/synthetic fixture/i)).toBeInTheDocument()
    expect(screen.getAllByText('HH').length).toBeGreaterThan(0)
    expect(screen.getAllByText('CF').length).toBeGreaterThan(0)
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Away')).toBeInTheDocument()
    expect(screen.getByTestId('forecast-line-homeProbability')).toHaveAttribute('d', expect.stringContaining('M'))
    expect(screen.getByTestId('forecast-line-awayProbability')).toHaveAttribute('d', expect.stringContaining('M'))
    expect(document.querySelector('[data-series-key="awayProbability"].future-line')).toHaveAttribute('d', expect.stringContaining('L'))
  })

  it('starts with an accessible replay control at the opening point', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: /play replay/i })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: /replay position/i })).toHaveValue('0')
    expect(screen.getAllByText('Cedar Foxes').length).toBeGreaterThan(0)
  })

  it('advances the visible checkpoint while playing', () => {
    vi.useFakeTimers()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /play replay/i }))
    act(() => { vi.advanceTimersByTime(1100) })
    expect(screen.getByRole('slider', { name: /replay position/i })).toHaveValue('1')
    vi.useRealTimers()
  })

  it('seeks to the selected event pin and exposes the checkpoint data', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /jump to foxes take the lead/i }))

    expect(screen.getByRole('slider', { name: /replay position/i })).toHaveValue('6')
    expect(screen.getByText('Foxes take the lead')).toBeInTheDocument()
    expect(screen.getByText('24')).toBeInTheDocument()
    expect(screen.getAllByText(/3:00 AM/).length).toBeGreaterThan(0)
  })

  it('derives status and every team label from the active source metadata', () => {
    const alternate = parseFixture({
      game: { ...fixture.game, homeTeam: 'North Stars', awayTeam: 'South Comets' },
      points: fixture.points,
    })
    const source = makeSource(alternate.game, 'STALE')

    render(<App forecastSource={{ getPoints: () => alternate.points }} gameStateSource={source} />)

    expect(screen.getByText('North Stars', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getAllByText('South Comets', { selector: 'strong' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('NS').length).toBeGreaterThan(0)
    expect(screen.getAllByText('SC').length).toBeGreaterThan(0)
    expect(screen.getByText('STALE', { selector: '.status-pill.is-current' })).toBeInTheDocument()
    expect(screen.getByText('North Stars', { selector: '.legend-long' })).toBeInTheDocument()
    expect(screen.getByText('South Comets', { selector: '.legend-long' })).toBeInTheDocument()
    expect(document.querySelector('.probabilities')?.textContent).toContain('NS 40%')
    expect(document.querySelector('.probabilities')?.textContent).toContain('SC 48%')
  })
})
