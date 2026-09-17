import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { createBrowserForecastReadPath, createBrowserForecastSource } from './browser/forecastRead'
import { fixture, parseFixture } from './fixture'
import { InMemoryForecastStore } from './persistence/forecastStore'
import { ForecastWorker } from './server/forecastWorker'
import type { ForecastRecord } from './shared/forecastRecords'
import type { FeedStatus, GameStateSource } from './types'

const makeSource = (game: typeof fixture.game, status: FeedStatus): GameStateSource => ({
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
    await worker.forecast({ gameId: fixture.game.id, providerEventId: 'live-event', sourceStatus: 'LIVE', state: fixture.game })
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

    expect(screen.getByRole('heading', { level: 1, name: /Jev forecasts this football game/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /current forecast/i })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /historical forecast.*Harbor Hawks.*Cedar Foxes/i })).toBeInTheDocument()
    expect(screen.getAllByText('Harbor Hawks').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Cedar Foxes').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.status-pill')).toHaveLength(1)
    expect(document.querySelector('.status-pill.is-current')).toHaveTextContent('REPLAY')
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument()
    expect(screen.queryByText('STALE')).not.toBeInTheDocument()
    expect(screen.getByText('Punt pins the opener')).toBeInTheDocument()
    expect(screen.getByText(/synthetic fixture/i)).toBeInTheDocument()
    expect(screen.getAllByText('HH').length).toBeGreaterThan(0)
    expect(screen.getAllByText('CF').length).toBeGreaterThan(0)
    expect(screen.getByText('Home', { selector: '.team-label' })).toBeInTheDocument()
    expect(screen.getByText('Away', { selector: '.team-label' })).toBeInTheDocument()
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

  it('disables backward stepping at the opening endpoint', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: /step replay backward/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /step replay forward/i })).toBeEnabled()
  })

  it('disables forward stepping at the final endpoint', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /jump to final whistle/i }))

    expect(screen.getByRole('button', { name: /step replay backward/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /step replay forward/i })).toBeDisabled()
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
    expect(document.querySelector('.status-pill.is-current')).toHaveTextContent('STALE')
    expect(screen.getByText('North Stars', { selector: '.legend-long' })).toBeInTheDocument()
    expect(screen.getByText('South Comets', { selector: '.legend-long' })).toBeInTheDocument()
    expect(document.querySelector('.probabilities')?.textContent).toContain('NS 40%')
    expect(document.querySelector('.probabilities')?.textContent).toContain('SC 48%')
  })

  it('keeps the product hierarchy to one forecast readout and one replay timeline', () => {
    render(<App />)

    expect(document.querySelector('.intro h1')).toHaveTextContent(/Jev forecasts.*this football game\./)
    expect(document.querySelector('.game-card')).toBeInTheDocument()
    expect(document.querySelector('.forecast-panel')).toBeInTheDocument()
    expect(document.querySelector('.forecast-readout')).toBeInTheDocument()
    expect(document.querySelector('.event-rail')).toBeInTheDocument()
    expect(document.querySelectorAll('.status-pill')).toHaveLength(1)
    expect(document.querySelector('.forecast-panel')?.querySelectorAll('h2')).toHaveLength(1)
  })

  it('keeps the promise, matchup, forecast, chart, and timeline in the first-viewport flow', () => {
    render(<App />)

    const flow = [
      document.querySelector('#page-title'),
      document.querySelector('.game-card'),
      document.querySelector('#forecast-heading'),
      document.querySelector('.forecast-chart'),
      document.querySelector('.event-rail'),
    ]
    expect(flow.every((element): element is Element => element !== null)).toBe(true)
    for (let index = 1; index < flow.length; index += 1) {
      expect(flow[index - 1]?.compareDocumentPosition(flow[index] as Node) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    }
    expect(document.querySelector('.page-shell')).toHaveAttribute('data-flow', 'promise matchup forecast chart timeline')
  })

  it.each([
    ['REPLAY', 'Synthetic replay fixture', 'No live inference'],
    ['LIVE', 'Live ESPN snapshot', 'Live inference state'],
    ['STALE', 'ESPN snapshot stale', 'Showing last available inference'],
    ['ERROR', 'ESPN snapshot unavailable', 'Showing fallback forecast'],
    ['LIMITED', 'ESPN snapshot limited', 'Inference may be incomplete'],
    ['MOCK', 'Mock data', 'No live inference'],
  ] as const)('uses truthful %s disclosure copy', (status, sourceCopy, inferenceCopy) => {
    const source = { getPoints: () => fixture.points, feedStatus: status }
    render(<App forecastSource={source} gameStateSource={makeSource(fixture.game, status)} />)

    const disclosure = document.querySelector(`[data-disclosure-status="${status}"]`)
    expect(disclosure).toBeInTheDocument()
    expect(disclosure).toHaveTextContent(sourceCopy)
    expect(disclosure).toHaveTextContent(inferenceCopy)
  })

  it('renders STALE after a live refresh rejects without dropping fallback points', async () => {
    let status: FeedStatus = 'LIVE'
    const source = {
      mode: 'live' as const,
      get feedStatus() { return status },
      getPoints: () => fixture.points,
      async refresh() {
        status = 'STALE'
        throw new Error('live read rejected')
      },
    }

    render(<App forecastSource={source} />)

    await waitFor(() => expect(document.querySelector('.status-pill.is-current')).toHaveAttribute('data-status', 'STALE'))
    expect(screen.getByText('Punt pins the opener')).toBeInTheDocument()
    expect(document.querySelector('.forecast-chart')).toBeInTheDocument()
    expect(document.querySelector('[data-disclosure-status="STALE"]')).toHaveTextContent('ESPN snapshot stale')
  })

  it('distinguishes non-replay feed states with the same single indicator', () => {
    const source = makeSource(fixture.game, 'ERROR')
    render(<App forecastSource={{ getPoints: () => fixture.points, feedStatus: 'ERROR' }} gameStateSource={source} />)

    const indicator = document.querySelector('.status-pill.is-current')
    expect(indicator).toHaveAttribute('data-status', 'ERROR')
    expect(indicator).toHaveAccessibleName('Live feed unavailable status')
    expect(document.querySelectorAll('.status-pill')).toHaveLength(1)
  })

  it('keeps the replay timeline keyboard reachable on a narrow layout', () => {
    render(<App />)

    const slider = screen.getByRole('slider', { name: /replay position/i })
    slider.focus()
    expect(document.activeElement).toBe(slider)
    fireEvent.change(slider, { target: { value: '6' } })
    expect(slider).toHaveValue('6')
    expect(screen.getByRole('button', { name: /jump to final whistle/i })).toBeVisible()
  })
})
