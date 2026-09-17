export interface ClassCount {
  name: string
  count: number
}

export interface ClassifiedRow {
  selectedClass?: string
}

export const classDistribution = (
  rows: readonly ClassifiedRow[],
  knownClasses: readonly string[] = [],
): ClassCount[] => {
  const counts = new Map<string, number>()
  for (const name of knownClasses) {
    if (name.trim()) counts.set(name, 0)
  }
  for (const row of rows) {
    const name = row.selectedClass?.trim()
    if (!name) continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([name, count]) => ({ name, count }))
}

export const distributionAt = (
  rows: readonly ClassifiedRow[],
  completedCount: number,
  knownClasses: readonly string[] = [],
): ClassCount[] => classDistribution(rows.slice(0, Math.max(0, completedCount)), knownClasses)
