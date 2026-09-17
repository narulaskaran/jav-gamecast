import { describe, expect, it } from 'vitest'
import {
  JEV_MODEL,
  TYPESAFE_SYSTEM_ONE_ENDPOINT,
  TypeSafeJevProvider,
  buildJevRequest,
  createTypeSafeSdkConfig,
  parseChoiceAnswer,
  type TypeSafeClientBoundary,
} from './jev'

const validAnswer = {
  type: 'choice' as const,
  choice: 'home' as const,
  probabilities: { home: 0.62, away: 0.28, tie: 0.1 },
  confidence: 0.62,
}

const state = {
  id: 'game-1',
  eventId: 'event-1',
  playId: 'play-1',
  sequenceNumber: 1,
  homeTeam: 'Harbor Hawks',
  awayTeam: 'Cedar Foxes',
  homeScore: 17,
  awayScore: 14,
  quarter: 'Q2',
  clock: '04:12',
  status: 'quarter' as const,
  possession: 'home' as const,
  down: 2,
  distance: 7,
  fieldPosition: 'FOX 34',
  lastPlay: 'Pass complete to the Harbor Hawks 34 yard line',
  timestamp: '2026-09-17T03:40:00Z',
  feedTimestamp: '2026-09-17T03:40:00Z',
  sourceStatus: 'LIVE' as const,
}

describe('TypeSafe Choice contract', () => {
  it('builds the exact Jev model and typed Choice question shape', () => {
    expect(buildJevRequest(state)).toEqual({
      model: JEV_MODEL,
      state,
      questions: {
        winner: {
          type: 'choice',
          instructions: 'Who is most likely to win this game from the current state?',
          criteria: {
            home: 'the home team',
            away: 'the away team',
            tie: 'the game ends tied',
          },
        },
      },
    })
    expect(TYPESAFE_SYSTEM_ONE_ENDPOINT).toBe('https://api.typesafe.ai/v1/systemone')
  })

  it('rejects outcome and post-event fields before they reach TypeSafe', () => {
    expect(() => buildJevRequest({ ...state, finalOutcome: 'home' } as unknown as typeof state)).toThrow(/unsupported/i)
  })

  it('accepts every option with probabilities that sum to one', () => {
    expect(parseChoiceAnswer(validAnswer)).toEqual(validAnswer)
  })

  it.each([
    ['missing type', { ...validAnswer, type: undefined }],
    ['missing choice', { ...validAnswer, choice: undefined }],
    ['missing option probability', { ...validAnswer, probabilities: { home: 1, away: 0 } }],
    ['extra option probability', { ...validAnswer, probabilities: { ...validAnswer.probabilities, overtime: 0 } }],
    ['probabilities do not sum to one', { ...validAnswer, probabilities: { home: 0.6, away: 0.2, tie: 0.2 + 0.01 } }],
    ['negative probability', { ...validAnswer, probabilities: { home: -0.1, away: 1, tie: 0.1 } }],
    ['confidence is not numeric', { ...validAnswer, confidence: 'high' }],
    ['confidence is not a unit value', { ...validAnswer, confidence: 1.01 }],
  ])('rejects malformed Choice response: %s', (_label, response) => {
    expect(() => parseChoiceAnswer(response)).toThrow()
  })

  it('uses a server-only SDK boundary with bounded timeout and 429/529 backoff', () => {
    const config = createTypeSafeSdkConfig({
      apiKey: 'test-only-placeholder',
      timeoutMs: 2_000,
      maxRetries: 2,
      backoffInitialMs: 100,
      backoffMaxMs: 800,
    })
    expect(config.baseURL).toBe('https://api.typesafe.ai')
    expect(config.defaultModel).toBe(JEV_MODEL)
    expect(config.timeout).toBe(2_000)
    const retry = config.retry!
    expect(retry.maxRetries).toBe(2)
    expect(retry.backoffInitialMs).toBe(100)
    expect(retry.backoffMaxMs).toBe(800)
    expect([...retry.httpStatuses!]).toEqual([429, 529])
    expect(config.dangerouslyAllowBrowser).toBe(false)
  })

  it('adapts a typed client response without making a network call', async () => {
    const calls: { request: unknown; options: unknown }[] = []
    const client: TypeSafeClientBoundary = {
      systemOne: async (request, options) => {
        calls.push({ request, options })
        return { model: JEV_MODEL, answers: { winner: validAnswer }, usage: { input_tokens: 1, output_tokens: 1 } }
      },
    }
    const provider = new TypeSafeJevProvider({ client })

    await expect(provider.forecast({ state, idempotencyKey: 'game-1:event-1:hash' })).resolves.toEqual({
      model: JEV_MODEL,
      answer: validAnswer,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].request).toEqual(buildJevRequest(state))
    expect(calls[0].options).toEqual({ headers: { 'Idempotency-Key': 'game-1:event-1:hash' } })
  })
})
