export const teamCode = (teamName: string): string => {
  const words = teamName.trim().split(/\s+/).filter(Boolean)
  if (words.length > 1) return words.map((word) => word[0]).join('').slice(0, 3).toUpperCase()
  return (words[0] ?? 'TEAM').slice(0, 3).toUpperCase()
}
