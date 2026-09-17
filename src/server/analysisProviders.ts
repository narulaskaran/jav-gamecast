import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  choice,
  TypeSafeClient,
  type EntryType,
  type RequestOptions,
  type SystemOneRequest,
  type TypeSafeClientConfig,
} from '@typesafe-ai/sdk'
import {
  ANALYSIS_CLASS_NAMES,
  ANALYSIS_MAX_QUERY_LENGTH,
  type AnalysisClassification,
} from '../shared/analysis'
import { FOOTBALL_FIXTURE_ID } from '../fixtures/footballTimeline'
import { AnalysisError, type AnalysisClassifier, type AnalysisDraftProvider } from './analysis'
import { createTypeSafeSdkConfig, hasTypeSafeApiKey, JEV_MODEL } from './jev'

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

const contentQuery = (content: unknown): string | undefined => {
  if (isRecord(content)) return parseDraftQuery(content.query)
  if (typeof content !== 'string') return undefined
  const stripped = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const parsed: unknown = JSON.parse(stripped)
    if (isRecord(parsed)) return parseDraftQuery(parsed.query)
  } catch {
    return parseDraftQuery(stripped)
  }
  return undefined
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

  async draft(input: { fixtureId: string; task: string; classes: readonly string[] }): Promise<{ query: string; model: string }> {
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
            { role: 'system', content: 'Return JSON only: {"query":"..."}. Draft a concise editable Jev classifier query. Do not include provider credentials, future rows, labels, or results.' },
            { role: 'user', content: JSON.stringify({ fixtureId: input.fixtureId, task: input.task, classes: input.classes }) },
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
      const query = contentQuery(message)
      if (!query) throw new OpenRouterProviderError('OPENROUTER_MALFORMED', 502, false)
      const model = isRecord(body) && typeof body.model === 'string' && body.model.trim() ? body.model.trim() : this.model
      return { query, model }
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

const classifierCriteria = {
  'K.Walker': 'the K.Walker class',
  'C.Kupp': 'the C.Kupp class',
  'J.Smith-Njigba': 'the J.Smith-Njigba class',
  'Other/Tie': 'Other or a tie',
} as const

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
    const request: SystemOneRequest = {
      model: JEV_MODEL,
      state: { fixtureId: FOOTBALL_FIXTURE_ID, rowIndex: input.rowIndex, input: input.row } as unknown as EntryType,
      questions: { classification: choice(input.query, classifierCriteria) },
    }
    try {
      const response = await client.systemOne(request, { headers: { 'Idempotency-Key': `analysis:${input.analysisId}:${input.rowIndex}` } })
      return parseClassifierResponse(response)
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

export const parseClassifierResponse = (value: unknown): AnalysisClassification => {
  if (!isRecord(value) || !isRecord(value.answers) || !isRecord(value.answers.classification)) throw new AnalysisError('JEV_MALFORMED_RESPONSE', 'Jev returned an invalid classification', 502)
  const answer = value.answers.classification
  if (answer.type !== 'choice' || typeof answer.choice !== 'string' || !ANALYSIS_CLASS_NAMES.includes(answer.choice as typeof ANALYSIS_CLASS_NAMES[number]) || !isRecord(answer.probabilities)) throw new AnalysisError('JEV_MALFORMED_RESPONSE', 'Jev returned an invalid classification', 502)
  const probabilities: Record<string, number> = {}
  for (const className of ANALYSIS_CLASS_NAMES) {
    const probability = answer.probabilities[className]
    if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) throw new AnalysisError('JEV_MALFORMED_RESPONSE', 'Jev returned invalid class probabilities', 502)
    probabilities[className] = probability
  }
  const total = Object.values(probabilities).reduce((sum, probability) => sum + probability, 0)
  if (Math.abs(total - 1) > 1e-6) throw new AnalysisError('JEV_MALFORMED_RESPONSE', 'Jev class probabilities are inconsistent', 502)
  if (answer.confidence !== undefined && (typeof answer.confidence !== 'number' || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1)) throw new AnalysisError('JEV_MALFORMED_RESPONSE', 'Jev returned invalid confidence', 502)
  return { model: typeof value.model === 'string' && value.model.trim() ? value.model.trim() : JEV_MODEL, selectedClass: answer.choice, probabilities, ...(answer.confidence === undefined ? {} : { confidence: answer.confidence }) }
}
