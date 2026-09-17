import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ResultsChart } from './ResultsChart'

describe('ResultsChart empty shell', () => {
  it('keeps axes and waiting copy before the first persisted row', () => {
    render(
      <ResultsChart
        rows={[]}
        playheadIndex={0}
        classes={['gold', 'silver']}
        totalRows={12}
        onSeek={vi.fn()}
      />,
    )
    expect(screen.getByText('Waiting for the first row…')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /waiting for the first row/i })).toBeInTheDocument()
    expect(document.querySelector('.chart-y-axis')).toBeTruthy()
    expect(document.querySelector('.chart-x-axis')).toBeTruthy()
    expect(screen.getByRole('slider', { name: /chart playhead/i })).toBeDisabled()
  })
})
