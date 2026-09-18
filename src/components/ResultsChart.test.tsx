import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ResultsChart } from './ResultsChart'
import { AnalysisRunView } from './AnalysisRunView'
import { useRunPlayhead } from '../runView/playhead'
import type { AnalysisResultRow, AnalysisSnapshot } from '../shared/analysis'

const row = (rowIndex: number, selectedClass: string): AnalysisResultRow => ({
  rowIndex,
  input: { message: 'hello' },
  model: 'jev',
  selectedClass,
})

const ChartHarness = ({ rows }: { rows: readonly AnalysisResultRow[] }) => {
  const { index, motion, seek } = useRunPlayhead(rows.length, 'run-1')
  return (
    <ResultsChart
      rows={rows}
      playheadIndex={index}
      classes={['gold', 'silver']}
      totalRows={10}
      motion={motion}
      onSeek={seek}
    />
  )
}

describe('ResultsChart motion', () => {
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

  it('keeps class tracks mounted and only grows the changed series', () => {
    const classes = ['gold', 'silver']
    const { rerender } = render(
      <ResultsChart rows={[]} playheadIndex={0} classes={classes} totalRows={10} motion="tick" onSeek={vi.fn()} />,
    )
    const gold = document.querySelector('[data-class="gold"]')
    const silver = document.querySelector('[data-class="silver"]')
    const goldBar = gold?.querySelector('.distribution-track span') as HTMLElement | null
    const silverBar = silver?.querySelector('.distribution-track span') as HTMLElement | null
    const silverWidth = silverBar?.style.getPropertyValue('--bar-width')
    expect(gold).toBeTruthy()
    expect(silverWidth).toBe('0%')

    rerender(
      <ResultsChart rows={[row(0, 'gold')]} playheadIndex={0} classes={classes} totalRows={10} motion="tick" onSeek={vi.fn()} />,
    )
    expect(document.querySelector('[data-class="gold"]')).toBe(gold)
    expect(document.querySelector('[data-class="silver"]')).toBe(silver)
    expect(gold).toHaveAttribute('data-count', '1')
    expect(silver).toHaveAttribute('data-count', '0')
    expect(silverBar?.style.getPropertyValue('--bar-width')).toBe(silverWidth)
    expect(goldBar?.style.getPropertyValue('--bar-width')).toBe('10%')

    rerender(
      <ResultsChart
        rows={[row(0, 'gold'), row(1, 'gold')]}
        playheadIndex={1}
        classes={classes}
        totalRows={10}
        motion="tick"
        onSeek={vi.fn()}
      />,
    )
    expect(document.querySelector('[data-class="silver"]')).toBe(silver)
    expect(document.querySelector('[data-class="gold"]')).toHaveAttribute('data-count', '2')
    expect(silverBar?.style.getPropertyValue('--bar-width')).toBe('0%')
    expect(goldBar?.style.getPropertyValue('--bar-width')).toBe('20%')
  })

  it('uses instant seek motion while the playhead is dragged off the live edge', () => {
    render(<ChartHarness rows={[row(0, 'gold'), row(1, 'silver'), row(2, 'gold')]} />)
    const shell = document.querySelector('.chart-shell')
    expect(shell).toHaveAttribute('data-motion', 'tick')
    fireEvent.change(screen.getByRole('slider', { name: /chart playhead/i }), { target: { value: '0' } })
    expect(shell).toHaveAttribute('data-motion', 'seek')
    expect(document.querySelector('[data-class="silver"]')).toHaveAttribute('data-count', '0')
  })
})

describe('AnalysisRunView tick isolation', () => {
  const snapshot = (count: number): AnalysisSnapshot => ({
    analysisId: 'analysis-demo-1',
    fixtureId: 'dataset-1',
    datasetId: 'dataset-1',
    sourceType: 'upload',
    query: 'Classify',
    status: 'running',
    createdAt: '2026-09-17T18:00:00.000Z',
    updatedAt: '2026-09-17T18:01:00.000Z',
    progress: { completedRows: count, totalRows: 10, completedCalls: count, totalCalls: 10 },
    classes: ['gold', 'silver'],
    columns: ['message'],
    resultRows: Array.from({ length: count }, (_, rowIndex) => row(rowIndex, rowIndex === 1 ? 'silver' : 'gold')),
  })

  it('does not remount the analysis card or class tracks when a row appends', () => {
    const { rerender } = render(
      <AnalysisRunView snapshot={snapshot(1)} shareUrl="" shareMessage="" onCopyShare={() => undefined} />,
    )
    const card = document.querySelector('.analysis-card')
    const gold = document.querySelector('[data-class="gold"]')
    rerender(<AnalysisRunView snapshot={snapshot(2)} shareUrl="" shareMessage="" onCopyShare={() => undefined} />)
    expect(document.querySelector('.analysis-card')).toBe(card)
    expect(document.querySelector('[data-class="gold"]')).toBe(gold)
    expect(document.querySelector('[data-class="silver"]')).toHaveAttribute('data-count', '1')
  })
})
