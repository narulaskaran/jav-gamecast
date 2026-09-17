import { createHash } from 'node:crypto'
import {
  APITimeoutError,
  APIConnectionError,
  APIError,
  TypeSafeClient,
  choice,
  type ChoiceResponse,
  type EntryType,
  type RequestOptions,
  type SystemOneRequest,
  type TypeSafeClientConfig,
} from '@typesafe-ai/sdk'
import { normalizeCurrentForecastState, type CurrentForecastState } from './forecastState'

export const TYPESAFE_SYSTEM_ONE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
export const TYPESAFE_BASE_URL = 'https://api.typesafe.ai'
export const JEV_MODEL = 'jev-latest'
export const JEV_QUESTION_NAME = 'winner'
export const JEV_INSTRUCTIONS = 'Who is most likely to win this game from the current state?'

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export type TypeSafeState = Exclude<EntryType, null>
export type { CurrentForecastState } from './forecastState'
export type ChoiceLabel = 'home' | 'away' | 'tie'

export interface ChoiceAnswer {
  type: 'choice'
  choice: ChoiceLabel
  probabilities: Record<ChoiceLabel, number>
  confidence: number
}

export interface JevProviderRequest {
  state: CurrentForecastState
  idempotencyKey: string
}

export interface JevProviderResult {
  model: string
  answer: ChoiceAnswer
}

export interface JevProvider {
  forecast(request: JevProviderRequest): Promise<JevProviderResult>
}

export interface TypeSafeClientBoundary {
  systemOne(request: TypeSafeChoiceRequest, options?: RequestOptions): Promise<unknown>
}

const choiceCriteria = {
  home: 'the home team',
  away: 'the away team',
  tie: 'the game ends tied',
} as const

export type TypeSafeChoiceQuestion = ReturnType<typeof choice<typeof choiceCriteria>>
export type TypeSafeChoiceRequest = SystemOneRequest<{ winner: TypeSafeChoiceQuestion }>

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isFiniteUnitNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
const choiceLabels: readonly ChoiceLabel[] = ['home', 'away', 'tie']

export const buildJevRequest = (state: CurrentForecastState): TypeSafeChoiceRequest => ({
  model: JEV_MODEL,
  state: normalizeCurrentForecastState(state) as unknown as TypeSafeState,
  questions: {
    winner: choice(JEV_INSTRUCTIONS, choiceCriteria),
  },
})

export const parseChoiceAnswer = (value: unknown): ChoiceAnswer => {
  if (!isRecord(value) || value.type !== 'choice') throw new Error('TypeSafe response is not a Choice answer')
  if (!choiceLabels.includes(value.choice as ChoiceLabel)) throw new Error('TypeSafe Choice answer has an invalid choice')
  if (!isRecord(value.probabilities)) throw new Error('TypeSafe Choice answer is missing probabilities')

  const probabilityKeys = Object.keys(value.probabilities).sort()
  if (probabilityKeys.join(',') !== [...choiceLabels].sort().join(',')) {
    throw new Error('TypeSafe Choice answer must provide probabilities for home, away, and tie')
  }
  const probabilityValues: Record<ChoiceLabel, unknown> = {
    home: value.probabilities.home,
    away: value.probabilities.away,
    tie: value.probabilities.tie,
  }
  if (!choiceLabels.every((label) => isFiniteUnitNumber(probabilityValues[label]))) {
    throw new Error('TypeSafe Choice probabilities must be finite numbers between zero and one')
  }
  const probabilities = {
    home: probabilityValues.home as number,
    away: probabilityValues.away as number,
    tie: probabilityValues.tie as number,
  }
  const total = probabilities.home + probabilities.away + probabilities.tie
  if (Math.abs(total - 1) > 1e-9) throw new Error('TypeSafe Choice probabilities must sum to one')
  if (!isFiniteUnitNumber(value.confidence)) throw new Error('TypeSafe Choice confidence must be a finite number between zero and one')

  return {
    type: 'choice',
    choice: value.choice as ChoiceLabel,
    probabilities: {
      home: probabilities.home as number,
      away: probabilities.away as number,
      tie: probabilities.tie as number,
    },
    confidence: value.confidence,
  }
}

const serverEnv = (name: string): string | undefined => {
  const value = process.env[name]
  return typeof value === 'string' && value.trim() ? value : undefined
}

export class TypeSafeConfigurationError extends Error {
  constructor(message = 'TYPESAFE_API_KEY is required for live Jev forecasts') {
    super(message)
    this.name = 'TypeSafeConfigurationError'
  }
}

export interface TypeSafeSdkConfigOptions {
  apiKey?: string
  baseURL?: string
  timeoutMs?: number
  maxRetries?: number
  backoffInitialMs?: number
  backoffMaxMs?: number
  fetch?: TypeSafeClientConfig['fetch']
}

const bounded = (name: string, value: number | undefined, minimum: number, maximum: number, fallback: number): number => {
  const candidate = value ?? fallback
  if (!Number.isFinite(candidate) || candidate < minimum || candidate > maximum) {
    throw new RangeError(`${name} must be finite and between ${minimum} and ${maximum}`)
  }
  return candidate
}

export const createTypeSafeSdkConfig = (options: TypeSafeSdkConfigOptions = {}): TypeSafeClientConfig => {
  const timeout = bounded('timeoutMs', options.timeoutMs, 1, 60_000, 10_000)
  const maxRetries = bounded('maxRetries', options.maxRetries, 0, 5, 2)
  const backoffInitialMs = bounded('backoffInitialMs', options.backoffInitialMs, 0, 30_000, 500)
  const backoffMaxMs = bounded('backoffMaxMs', options.backoffMaxMs, backoffInitialMs, 60_000, 5_000)
  const apiKey = options.apiKey ?? serverEnv('TYPESAFE_API_KEY')

  return {
    ...(apiKey ? { apiKey } : {}),
    baseURL: options.baseURL ?? serverEnv('TYPESAFE_BASE_URL') ?? TYPESAFE_BASE_URL,
    defaultModel: JEV_MODEL,
    timeout,
    retry: {
      maxRetries,
      backoffInitialMs,
      backoffMaxMs,
      backoffJitter: 0,
      httpStatuses: new Set([429, 529]),
      respectRetryAfter: true,
      maxRetryAfterMs: backoffMaxMs,
      apiConnectionError: true,
      apiTimeoutError: true,
    },
    dangerouslyAllowBrowser: false,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  }
}

export interface TypeSafeJevProviderOptions extends TypeSafeSdkConfigOptions {
  client?: TypeSafeClientBoundary
}

export const hasTypeSafeApiKey = (options: TypeSafeSdkConfigOptions = {}): boolean =>
  Boolean((options.apiKey ?? serverEnv('TYPESAFE_API_KEY'))?.trim())

const sdkBoundary = (client: TypeSafeClient): TypeSafeClientBoundary => ({
  systemOne: (request, options) => client.systemOne(request, options),
})

export class TypeSafeJevProvider implements JevProvider {
  private readonly client?: TypeSafeClientBoundary
  private readonly sdkOptions: TypeSafeSdkConfigOptions
  private initializedClient?: TypeSafeClientBoundary

  constructor(options: TypeSafeJevProviderOptions = {}) {
    this.client = options.client
    this.sdkOptions = options
  }

  async forecast(request: JevProviderRequest): Promise<JevProviderResult> {
    if (!this.client && !this.initializedClient && !hasTypeSafeApiKey(this.sdkOptions)) {
      throw new TypeSafeConfigurationError()
    }
    const client = this.client ?? this.initializedClient ?? (this.initializedClient = sdkBoundary(new TypeSafeClient(createTypeSafeSdkConfig(this.sdkOptions))))
    const response = await client.systemOne(buildJevRequest(request.state), {
      headers: { 'Idempotency-Key': request.idempotencyKey },
    })
    const result = isRecord(response) ? response : undefined
    const answers = result && isRecord(result.answers) ? result.answers : undefined
    const answer = parseChoiceAnswer(answers?.[JEV_QUESTION_NAME])
    const model = typeof result?.model === 'string' && result.model.trim() ? result.model : JEV_MODEL
    return { model, answer }
  }
}

export const isTypeSafeTimeout = (error: unknown): boolean => error instanceof APITimeoutError
export const isTypeSafeConnectionError = (error: unknown): boolean => error instanceof APIConnectionError
export const isTypeSafeApiError = (error: unknown): error is APIError => error instanceof APIError

export const sha256Hex = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex')

export const choiceAnswerFromSdk = (value: ChoiceResponse): ChoiceAnswer => parseChoiceAnswer(value)
