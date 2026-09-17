import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'

describe('gamecast forecast rendering', () => {
  it('renders chart series, event markers, metadata, and replay state', () => {
    render(<App />)

    expect(screen.getByText('Jev forecasts this football game')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /historical forecast/i })).toBeInTheDocument()
    expect(screen.getAllByText('Harbor Hawks').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Cedar Foxes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('REPLAY').length).toBeGreaterThan(0)
    expect(screen.getByText('LIVE')).toBeInTheDocument()
    expect(screen.getByText('STALE')).toBeInTheDocument()
    expect(screen.getByText('Punt pins the opener')).toBeInTheDocument()
    expect(screen.getByText(/synthetic fixture/i)).toBeInTheDocument()
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
})
