const PALETTE = ['#4f46e5', '#0f766e', '#334155', '#6366f1', '#115e59', '#475569', '#4338ca', '#0e7490'] as const

export const classColor = (name: string, classes: readonly string[] = []): string => {
  const known = classes.indexOf(name)
  if (known >= 0) return PALETTE[known % PALETTE.length]
  let hash = 0
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}
