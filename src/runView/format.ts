export const percent = (value: number | undefined): string => (
  value === undefined ? '—' : `${Math.round(value * 100)}%`
)

export const cell = (value: unknown): string => (
  value === null || value === undefined || value === '' ? '—' : String(value)
)
