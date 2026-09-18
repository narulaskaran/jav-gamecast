import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  choice,
  noul,
  score,
  TypeSafeClient,
  type EntryType,
  type RequestOptions,
  type ScoreCriteria,
  type SystemOneRequest,
  type TypeSafeClientConfig,
} from '@typesafe-ai/sdk'
import {
  ANALYSIS_MAX_QUERY_LENGTH,
  type AnalysisClassification,
  type JevQuestionKind,
} from '../shared/analysis.js'
import { inferQuestionKind, parseQuestionKind } from '../shared/questionKind.js'
import { AnalysisError, type AnalysisClassifier, type AnalysisDraftProvider } from './analysis.js'
import { createTypeSafeSdkConfig, hasTypeSafeApiKey, JEV_MODEL } from './jev.js'

export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
export const OPENROUTER_MODEL = 'openai/gpt-4o-mini'
const OPENROUTER_TIMEOUT_MS = 20_000

export class OpenRouterConfigurationError extends AnalysisError {
  constructor() {
    super('OPENROUTER_NOT_CONFIGURED', 'OpenRouter is not configured', 503, false)
    this.name = 'OpenRouterConfigurationError'
  }
}

export class OpenRouterProviderError extends AnalysisError {
  constructor(code: string, statusCode: number, retryable: boolean) {
    super(code, 'OpenRouter provider request failed', statusCode, retryable)
    this.name = 'OpenRouterProviderError'
  }
}

const serverEnv = (name: string): string | undefined => {
  const value = process.env[name]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

const parseDraftQuery = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > ANALYSIS_MAX_QUERY_LENGTH || trimmed.includes('\u0000')) return undefined
  return trimmed
}

const parseDraftClasses = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const classes = value.map((item) => typeof item === 'string' ? item.trim() : '').filter((item) => item.length > 0 && item.length <= 80)
  return classes.length >= 2 ? classes : undefined
}

const contentDraft = (content: unknown): { query: string; classes?: string[]; questionKind?: JevQuestionKind } | undefined => {
  const fromRecord = (value: unknown): { query: string; classes?: string[]; questionKind?: JevQuestionKind } | undefined => {
    if (!isRecord(value)) return undefined
    const query = parseDraftQuery(value.query)
    if (!query) return undefined
    const levels = parseDraftClasses(value.levels) ?? parseDraftClasses(value.classes)
    return { query, classes: levels, questionKind: parseQuestionKind(value.questionKind) }
  }
  if (isRecord(content)) return fromRecord(content)
  if (typeof content !== 'string') return undefined
  const stripped = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return fromRecord(JSON.parse(stripped)) ?? (parseDraftQuery(stripped) ? { query: parseDraftQuery(stripped)! } : undefined)
  } catch {
    const query = parseDraftQuery(stripped)
    return query ? { query } : undefined
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export interface OpenRouterDraftProviderOptions {
  apiKey?: string
  model?: string
  endpoint?: string
  timeoutMs?: number
  fetch?: typeof fetch
}

export class OpenRouterDraftProvider implements AnalysisDraftProvider {
  private readonly apiKey?: string
  private readonly model: string
  private readonly endpoint: string
  private readonly timeoutMs: number
  private readonly fetcher: typeof fetch

  constructor(options: OpenRouterDraftProviderOptions = {}) {
    this.apiKey = options.apiKey ?? serverEnv('OPENROUTER_KEY')
    this.model = options.model ?? OPENROUTER_MODEL
    this.endpoint = options.endpoint ?? OPENROUTER_ENDPOINT
    this.timeoutMs = options.timeoutMs ?? OPENROUTER_TIMEOUT_MS
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000) throw new RangeError('timeoutMs must be finite and between 1 and 60000')
    this.fetcher = options.fetch ?? globalThis.fetch
  }

  async draft(input: {
    fixtureId: string
    datasetId: string
    task: string
    classes?: readonly string[]
    columns?: readonly string[]
    sampleRows?: Array<Record<string, unknown>>
    sourceType?: string
    questionKindHint?: JevQuestionKind
  }): Promise<{ query: string; model: string; classes?: string[]; questionKind?: JevQuestionKind }> {
    if (!this.apiKey) throw new OpenRouterConfigurationError()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetcher(this.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          messages: [
            { role: 'system', content: 'Return JSON only: {"query":"...","questionKind":"noul"|"score"|"choice","classes":["..."]}. Honor the user task. Choose the Jev primitive that matches the answer: noul = yes/no probability 0-1 (for per-play win likelihood use "Will SEA win given this play state?"); score = ordered levels; choice = categorical labels the user asked for. Do not substitute a leftover demo player-yards classifier (K.Walker, C.Kupp, J.Smith-Njigba, Other). Do not treat CSV columns such as wpa or epa as the model output. Do not include credentials or executable code.' },
            { role: 'user', content: JSON.stringify({
              fixtureId: input.fixtureId,
              datasetId: input.datasetId,
              task: input.task,
              ...(input.classes && input.classes.length >= 2 ? { classes: input.classes } : {}),
              columns: input.columns,
              sampleRows: input.sampleRows,
              sourceType: input.sourceType,
              questionKindHint: input.questionKindHint,
            }) },
          ],
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const status = response.status
        throw new OpenRouterProviderError(`OPENROUTER_${status}`, status === 401 ? 502 : status === 429 ? 503 : 502, status === 429 || status >= 500)
      }
      let body: unknown
      try { body = await response.json() } catch { throw new OpenRouterProviderError('OPENROUTER_MALFORMED', 502, false) }
      const choices = isRecord(body) && Array.isArray(body.choices) ? body.choices : []
      const first = choices[0]
      const message = isRecord(first) && isRecord(first.message) ? first.message.content : undefined
      const draft = contentDraft(message)
      if (!draft?.query) throw new OpenRouterProviderError('OPENROUTER_MALFORMED', 502, false)
      const model = isRecord(body) && typeof body.model === 'string' && body.model.trim() ? body.model.trim() : this.model
      return { query: draft.query, model, ...(draft.classes ? { classes: draft.classes } : {}), ...(draft.questionKind ? { questionKind: draft.questionKind } : {}) }
    } catch (error) {
      if (error instanceof AnalysisError) throw error
      if (isAbortError(error)) throw new OpenRouterProviderError('OPENROUTER_TIMEOUT', 504, true)
      throw new OpenRouterProviderError('OPENROUTER_CONNECTION', 502, true)
    } finally {
      clearTimeout(timer)
    }
  }
}

const isAbortError = (error: unknown): boolean => isRecord(error) && error.name === 'AbortError'

const classifierCriteriaFor = (classes: readonly string[]): Record<string, string> => (
  Object.fromEntries(classes.map((name) => [name, `the ${name} class`]))
)

const scoreCriteriaFor = (classes: readonly string[]): ScoreCriteria => {
  const levels = classes.length >= 2 ? classes : ['Low', 'Medium', 'High']
  return [levels[0], levels[1], ...levels.slice(2)]
}

const questionFor = (input: Parameters<AnalysisClassifier['classify']>[0]) => {
  const kind = inferQuestionKind(input.query, input.classes, input.questionKind)
  if (kind === 'noul') return noul(input.query)
  if (kind === 'score') return score(input.query, scoreCriteriaFor(input.classes))
  if (!input.classes || input.classes.length < 2) throw new AnalysisError('INVALID_CLASSES', 'Query classes must contain between 2 and 32 labels')
  return choice(input.query, classifierCriteriaFor(input.classes))
}

export interface ClassifierClientBoundary {
  systemOne(request: SystemOneRequest, options?: RequestOptions): Promise<unknown>
}

const sdkClassifierBoundary = (client: TypeSafeClient): ClassifierClientBoundary => ({
  systemOne: (request, options) => client.systemOne(request, options),
})

export interface TypeSafeClassifierProviderOptions {
  client?: ClassifierClientBoundary
  apiKey?: string
  baseURL?: string
  timeoutMs?: number
  fetch?: TypeSafeClientConfig['fetch']
}

export class TypeSafeClassifierProvider implements AnalysisClassifier {
  private readonly client?: ClassifierClientBoundary
  private readonly options: TypeSafeClassifierProviderOptions
  private initializedClient?: ClassifierClientBoundary

  constructor(options: TypeSafeClassifierProviderOptions = {}) {
    this.client = options.client
    this.options = options
  }

  assertConfigured(): void {
    if (!this.client && !hasTypeSafeApiKey({ apiKey: this.options.apiKey })) throw new AnalysisError('JEV_NOT_CONFIGURED', 'Jev is not configured', 503, false)
  }

  async classify(input: Parameters<AnalysisClassifier['classify']>[0]): Promise<AnalysisClassification> {
    const client = this.client ?? this.initializedClient ?? (this.initializedClient = sdkClassifierBoundary(new TypeSafeClient(createTypeSafeSdkConfig({
      apiKey: this.options.apiKey,
      baseURL: this.options.baseURL,
      timeoutMs: this.options.timeoutMs,
      fetch: this.options.fetch,
    }))))
    const questionKind = inferQuestionKind(input.query, input.classes, input.questionKind)
    const request: SystemOneRequest = {
      model: JEV_MODEL,
      state: { fixtureId: input.fixtureId, datasetId: input.datasetId, rowIndex: input.rowIndex, input: input.row } as unknown as EntryType,
      questions: { classification: questionFor(input) },
    }
    try {
      const response = await client.systemOne(request, { headers: { 'Idempotency-Key': `analysis:${input.analysisId}:${input.rowIndex}` } })
      return parseClassifierResponse(response, input.classes ?? [], questionKind)
    } catch (error) {
      if (error instanceof AnalysisError) throw error
      if (error instanceof APITimeoutError) throw new AnalysisError('JEV_TIMEOUT', 'Jev request timed out', 504, true)
      if (error instanceof APIConnectionError) throw new AnalysisError('JEV_CONNECTION', 'Jev connection failed', 502, true)
      if (error instanceof APIError) {
        const status = error.status
        throw new AnalysisError(`JEV_${status}`, 'Jev provider request failed', status === 401 ? 502 : status === 429 ? 503 : 502, status === 429 || status >= 500)
      }
      throw error
    }
  }
}

export const parseClassifierResponse = (
  value: unknown,
  classes: readonly string[] = [],
  questionKind: JevQuestionKind = inferQuestionKind('', classes),
): AnalysisClassification => {
  if (!isRecord(value) || !isRecord(value.answers) || !isRecord(value.answers.classification)) throw new AnalysisError('JEV_MALFORMED_RESPONSE', 'Jev returned an invalid classification', 502)
  const answer = value.answers.classification
  const model = typeof value.model === 'string' && value.model.trim() ? value.model.trim() : JEV_MODEL
  if (questionKind === 'noul' || answer.type === 'noul') {
    if (answer.type !== 'noul' || typeof answer.noul !== 'number' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) {
      throw new AnalysisError('JEV_MALFORMED_RESPONSE', 'Jev returned an invalid noul', 502)
    }
    return { model, questionKind: 'noul', value: answer.noul }
  }
  if (questionKind === 'score' || answer.type === 'score') {
    if (answer.type !== 'score' || typeof answer.score !== 'number' || !Number.isFinite(answer.score)) {
      throw new AnalysisError('JEV_MALFORMED_RESPONSE', 'Jev returned an invalid score', 502)
    }
    const levels = classes.length >= 2 ? classes.length : Object.keys(isRecord(answer.legend) ? answer.legend : {}).length
    const max = Math.max(1, levels - 1)
    const value01 = Math.min(1, Math.max(0, answer.score / max))
    if (answer.confidence !== undefined && (typeof answer.confidence !== 'number' || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1)) {
      throw new AnalysisError('JEV_MALFORMED_RESPONSE', 'Jev returned invalid confidence', 502)
    }
    return {
      model,
      questionKind: 'score',
      value: value01,
      ...(answer.confidence === undefined ? {} : { confidence: answer.confidence }),
    }
  }
  const allowed = classes.length >= 2 ? classes : []
  if (allowed.length < 2 || answer.type !== 'choice' || typeof answer.choice !== 'string' || !allowed.includes(answer.choice) || !isRecord(answer.probabilities)) {
    throw new AnalysisError('JEV_MALFORMED_RESPONSE', 'Jev returned an invalid classification', 502)
  }
  const probabilities: Record<string, number> = {}
  for (const className of allowed) {
    const probability = answer.probabilities[className]
    if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) throw new AnalysisError('JEV_MALFORMED_RESPONSE', 'Jev returned invalid class probabilities', 502)
    probabilities[className] = probability
  }
  const total = Object.values(probabilities).reduce((sum, probability) => sum + probability, 0)
  if (Math.abs(total - 1) > 1e-6) throw new AnalysisError('JEV_MALFORMED_RESPONSE', 'Jev class probabilities are inconsistent', 502)
  if (answer.confidence !== undefined && (typeof answer.confidence !== 'number' || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1)) throw new AnalysisError('JEV_MALFORMED_RESPONSE', 'Jev returned invalid confidence', 502)
  return { model, questionKind: 'choice', selectedClass: answer.choice, probabilities, ...(answer.confidence === undefined ? {} : { confidence: answer.confidence }) }
}
