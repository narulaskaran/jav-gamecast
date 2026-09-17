import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { fixture, parseFixture } from './fixture'
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
