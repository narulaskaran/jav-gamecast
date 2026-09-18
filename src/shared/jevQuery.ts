import type { JevQuestionKind } from './questionKind.js'

export type JevNoulQueryJson = {
  type: 'noul'
  instructions: string
}

export type JevScoreQueryJson = {
  type: 'score'
  instructions: string
  criteria: string[]
}

export type JevChoiceQueryJson = {
  type: 'choice'
  instructions: string
  criteria: Record<string, string>
}

export type JevQueryJson = JevNoulQueryJson | JevScoreQueryJson | JevChoiceQueryJson

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const parseInstructions = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const instructions = value.trim()
  return instructions.length > 0 ? instructions : undefined
}

const parseScoreCriteria = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const criteria = value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean)
  return criteria.length >= 2 ? criteria : undefined
}

const parseChoiceCriteria = (value: unknown): Record<string, string> | undefined => {
  if (!isRecord(value)) return undefined
  const criteria: Record<string, string> = {}
  for (const [key, description] of Object.entries(value)) {
    const name = key.trim()
    if (!name || typeof description !== 'string' || !description.trim()) continue
    criteria[name] = description.trim()
  }
  return criteria
}

export const classesFromJevQuery = (query: JevQueryJson): string[] => {
  if (query.type === 'noul') return []
  if (query.type === 'score') return [...query.criteria]
  return Object.keys(query.criteria)
}

export const parseJevQueryRecord = (value: unknown): JevQueryJson | undefined => {
  if (!isRecord(value)) return undefined
  const nested = isRecord(value.query) ? parseJevQueryRecord(value.query) : undefined
  if (nested) return nested
  const type = value.type === 'noul' || value.type === 'score' || value.type === 'choice'
    ? value.type
    : value.questionKind === 'noul' || value.questionKind === 'score' || value.questionKind === 'choice'
      ? value.questionKind
      : undefined
  const instructions = parseInstructions(value.instructions) ?? parseInstructions(value.query)
  if (!type || !instructions) return undefined
  if (type === 'noul') return { type: 'noul', instructions }
  if (type === 'score') {
    const criteria = parseScoreCriteria(value.criteria) ?? parseScoreCriteria(value.levels) ?? parseScoreCriteria(value.classes)
    return criteria ? { type: 'score', instructions, criteria } : { type: 'score', instructions, criteria: ['Low', 'Medium', 'High'] }
  }
  const classList = Array.isArray(value.classes) ? value.classes : Array.isArray(value.levels) ? value.levels : undefined
  const criteria = parseChoiceCriteria(value.criteria)
    ?? (classList
      ? parseChoiceCriteria(Object.fromEntries(classList.map((name) => (
        typeof name === 'string' && name.trim() ? [name.trim(), `the ${name.trim()} class`] : ['', '']
      ))))
      : undefined)
  return { type: 'choice', instructions, criteria: criteria ?? {} }
}

export const parseJevQueryJson = (text: string): JevQueryJson | undefined => {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return undefined
  try {
    return parseJevQueryRecord(JSON.parse(trimmed) as unknown)
  } catch {
    return undefined
  }
}

export const stringifyJevQuery = (query: JevQueryJson): string => {
  if (query.type === 'noul') return JSON.stringify({ type: 'noul', instructions: query.instructions }, null, 2)
  if (query.type === 'score') return JSON.stringify({ type: 'score', instructions: query.instructions, criteria: query.criteria }, null, 2)
  return JSON.stringify({ type: 'choice', instructions: query.instructions, criteria: query.criteria }, null, 2)
}

export const defaultChoiceCriteria = (classes: readonly string[]): Record<string, string> => (
  Object.fromEntries(classes.map((name) => [name, `the ${name} class`]))
)

export const buildJevQuery = (input: {
  type: JevQuestionKind
  instructions: string
  classes?: readonly string[]
  criteria?: JevQueryJson
}): JevQueryJson => {
  const instructions = input.instructions.trim()
  if (input.type === 'noul') return { type: 'noul', instructions }
  if (input.type === 'score') {
    const criteria = input.criteria?.type === 'score'
      ? input.criteria.criteria
      : (input.classes && input.classes.length >= 2 ? [...input.classes] : ['Low', 'Medium', 'High'])
    return { type: 'score', instructions, criteria }
  }
  const criteria = input.criteria?.type === 'choice'
    ? input.criteria.criteria
    : defaultChoiceCriteria(input.classes ?? [])
  return { type: 'choice', instructions, criteria }
}

export const formatDraftQueryForEditor = (input: {
  query: string
  questionKind?: JevQuestionKind
  classes?: readonly string[]
}): string => {
  const parsed = parseJevQueryJson(input.query)
  if (parsed) return stringifyJevQuery(parsed)
  if (input.query.trim().startsWith('{')) return input.query.trim()
  const type = input.questionKind ?? (input.classes && input.classes.length >= 2 ? 'choice' : 'noul')
  return stringifyJevQuery(buildJevQuery({ type, instructions: input.query, classes: input.classes }))
}

export const jevQuerySummary = (query: JevQueryJson): string => {
  if (query.type === 'noul') return 'Noul · yes/no probability 0–1'
  if (query.type === 'score') return `Score · ${query.criteria.join(' → ')}`
  return `Choice · ${Object.keys(query.criteria).join(', ')}`
}

export const looksLikeJevQueryJson = (text: string): boolean => parseJevQueryJson(text) !== undefined
