const PALETTE = ['#3f8f76', '#d9654c', '#3d6e8a', '#c49a3c', '#6b5b95', '#5d8a4a', '#b85c38', '#4a7c8c'] as const

export const classColor = (name: string, classes: readonly string[] = []): string => {
  const known = classes.indexOf(name)
  if (known >= 0) return PALETTE[known % PALETTE.length]
  let hash = 0
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}
