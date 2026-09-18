import { parseJevQueryJson } from './jevQuery.js'

export const FIXTURE_PLAYER_CLASSES = ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie'] as const
export const SAMPLE_WIN_LIKELIHOOD_TASK = 'Win likelihood of the game per play.'
export const SAMPLE_WIN_NOUL_QUERY = 'Will SEA win given this play state?'

export const JEV_QUESTION_KINDS = ['noul', 'score', 'choice'] as const
export type JevQuestionKind = typeof JEV_QUESTION_KINDS[number]
export type ChartVisualKind = 'series' | 'bars'

const WIN_LIKELIHOOD_RE = /win[-\s]?likelihood|\bp\s*\(\s*win|will\s+(?:sea|the\s+seahawks|seattle|this\s+team|the\s+home\s+team)\s+win|probability\s+(?:that\s+)?(?:sea|the\s+seahawks|seattle)?\s*(?:will\s+)?win|chance\s+(?:that\s+)?(?:sea|the\s+seahawks)?\s*(?:wins|of winning)/i
const FIXTURE_PLAYER_RE = /k\.?\s*walker|c\.?\s*kupp|j\.?\s*smith-?njigba|scrimmage\s+yards|leading\s+(?:player|rusher|receiver)/i

export const parseQuestionKind = (value: unknown): JevQuestionKind | undefined => (
  value === 'noul' || value === 'score' || value === 'choice' ? value : undefined
)

export const looksLikeWinLikelihood = (text: string): boolean => WIN_LIKELIHOOD_RE.test(text.trim())

export const isPlayerClassifierQuery = (query: string): boolean => FIXTURE_PLAYER_RE.test(query)

export const isFixturePlayerClassList = (classes: readonly string[] = []): boolean => {
  if (classes.length === 0) return false
  const normalized = new Set(classes.map((name) => name.trim().toLowerCase()).filter(Boolean))
  return FIXTURE_PLAYER_CLASSES.some((name) => normalized.has(name.toLowerCase()))
}

export const userAskedForFixturePlayers = (task: string): boolean => FIXTURE_PLAYER_RE.test(task)

export const chartVisualFor = (kind: JevQuestionKind): ChartVisualKind => (
  kind === 'choice' ? 'bars' : 'series'
)

export const inferQuestionKind = (
  text: string,
  classes: readonly string[] = [],
  explicit?: JevQuestionKind,
): JevQuestionKind => {
  if (explicit) return explicit
  const parsed = parseJevQueryJson(text)
  if (parsed) return parsed.type
  if (looksLikeWinLikelihood(text)) return 'noul'
  if (classes.length >= 2) return 'choice'
  return 'choice'
}

export const resolveDraftedQuery = (input: {
  task: string
  query: string
  questionKind?: string
  classes?: readonly string[]
}): { query: string; questionKind: JevQuestionKind; classes: string[] } => {
  const query = input.query.trim()
  const task = input.task.trim()
  const parsedKind = parseQuestionKind(input.questionKind)
  const rawClasses = [...new Set((input.classes ?? []).map((item) => item.trim()).filter(Boolean))]

  if (looksLikeWinLikelihood(task) || looksLikeWinLikelihood(query)) {
    const leftoverPlayerDraft = isPlayerClassifierQuery(query) || query.length === 0
    return {
      query: leftoverPlayerDraft ? SAMPLE_WIN_NOUL_QUERY : query,
      questionKind: 'noul',
      classes: [],
    }
  }

  if (parsedKind === 'noul') {
    return { query, questionKind: 'noul', classes: [] }
  }

  const dropFixtureFallback = isFixturePlayerClassList(rawClasses) && !userAskedForFixturePlayers(task)
  const classes = dropFixtureFallback ? [] : rawClasses

  if (parsedKind === 'score') {
    return { query, questionKind: 'score', classes: classes.length >= 2 ? classes : ['Low', 'Medium', 'High'] }
  }

  return {
    query,
    questionKind: parsedKind === 'choice' || classes.length >= 2 ? 'choice' : inferQuestionKind(query, classes),
    classes,
  }
}

export const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export const seriesValueFromRow = (row: { value?: number }): number | undefined => {
  if (typeof row.value !== 'number' || !Number.isFinite(row.value)) return undefined
  return clamp01(row.value)
}
