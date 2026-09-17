import type { FeedStatus, GameState, GameStateSnapshot, GameStateSource, GameStatus, LiveGameStateSource } from '../types'

export const ESPN_ENDPOINTS = {
  scoreboard: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
  summary: (eventId: string) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(eventId)}`,
  plays: (eventId: string) => `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${encodeURIComponent(eventId)}/competitions/${encodeURIComponent(eventId)}/plays?limit=300`,
} as const

export const DEFAULT_ESPN_OPTIONS = {
  timeoutMs: 5_000,
  maxRetries: 2,
  backoffMs: 250,
  staleAfterMs: 180_000,
  userAgent: 'jev-gamecast/0.1 (+project URL)',
} as const

export const ESPN_CONFIG_LIMITS = {
  timeoutMs: { min: 1, max: 60_000 },
  maxRetries: { min: 0, max: 5 },
  backoffMs: { min: 0, max: 30_000 },
  staleAfterMs: { min: 1, max: 86_400_000 },
} as const

export type EspnFetch = (input: string, init?: RequestInit) => Promise<Response>
export type Sleep = (milliseconds: number) => Promise<void>

export interface EspnPayloads {
  scoreboard: unknown
  summary: unknown
  plays: unknown
  preferredEventId?: string
}

export interface EspnGameStateSourceOptions {
  fetch?: EspnFetch
  now?: () => number
  sleep?: Sleep
  timeoutMs?: number
  maxRetries?: number
  backoffMs?: number
  staleAfterMs?: number
  userAgent?: string
  featuredEventId?: string
  replay?: GameStateSource
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const stringValue = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value : undefined
const numberValue = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return undefined
}
const recordAt = (value: unknown, key: string): Record<string, unknown> | undefined => {
  const child = isRecord(value) ? value[key] : undefined
  return isRecord(child) ? child : undefined
}
const arrayAt = (value: unknown, key: string): unknown[] => {
  const child = isRecord(value) ? value[key] : undefined
  return Array.isArray(child) ? child : []
}
const validDate = (value: unknown): string | undefined => {
  const candidate = stringValue(value)
  return candidate && !Number.isNaN(Date.parse(candidate)) ? candidate : undefined
}

const eventState = (event: Record<string, unknown>): string | undefined =>
  stringValue(recordAt(recordAt(event, 'status'), 'type')?.state) ??
  stringValue(recordAt(recordAt(recordAt(event, 'competitions')?.[0], 'status'), 'type')?.state)

const eventFromScoreboard = (scoreboard: unknown, preferredId?: string): Record<string, unknown> => {
  const events = arrayAt(scoreboard, 'events').filter(isRecord)
  const selected = preferredId
    ? events.find((event) => stringValue(event.id) === preferredId)
    : events.find((event) => eventState(event) === 'in' || eventState(event) === 'halftime')
  if (!selected) throw new Error(preferredId ? `ESPN event ${preferredId} was not found` : 'ESPN scoreboard has no live event')
  return selected
}

const competitionFrom = (event: Record<string, unknown>, summary: unknown): Record<string, unknown> => {
  const summaryHeader = recordAt(summary, 'header')
  const summaryCompetition = arrayAt(summaryHeader, 'competitions').find(isRecord)
  const eventCompetition = arrayAt(event, 'competitions').find(isRecord)
  const competition = summaryCompetition ?? eventCompetition
  if (!competition) throw new Error('ESPN event has no competition')
  return competition
}

const playItemsFrom = (summary: unknown, plays: unknown): Record<string, unknown>[] => {
  const coreItems = arrayAt(plays, 'items').filter(isRecord)
  const summaryItems = arrayAt(summary, 'plays').filter(isRecord)
  const items = coreItems.length > 0 ? coreItems : summaryItems
  const byIdentity = new Map<string, Record<string, unknown>>()
  for (const play of items) {
    const id = stringValue(play.id)
    if (id) byIdentity.set(id, play)
  }
  return [...(byIdentity.values())].sort((left, right) => {
    const leftSequence = numberValue(left.sequenceNumber) ?? numberValue(left.sequence) ?? -1
    const rightSequence = numberValue(right.sequenceNumber) ?? numberValue(right.sequence) ?? -1
    if (leftSequence !== rightSequence) return leftSequence - rightSequence
    return (Date.parse(validDate(left.date) ?? validDate(left.timestamp) ?? '') || 0) -
      (Date.parse(validDate(right.date) ?? validDate(right.timestamp) ?? '') || 0)
  })
}

const teamFrom = (competitor: Record<string, unknown>): Record<string, unknown> =>
  recordAt(competitor, 'team') ?? competitor

const competitorBySide = (competition: Record<string, unknown>, side: 'home' | 'away'): Record<string, unknown> | undefined =>
  arrayAt(competition, 'competitors')
    .filter(isRecord)
    .find((competitor) => stringValue(competitor.homeAway) === side)

const teamName = (competitor: Record<string, unknown> | undefined): string | undefined => {
  const team = competitor ? teamFrom(competitor) : undefined
  return team && (stringValue(team.displayName) ?? stringValue(team.abbreviation) ?? stringValue(team.name))
}

const teamId = (competitor: Record<string, unknown> | undefined): string | undefined => {
  const team = competitor ? teamFrom(competitor) : undefined
  return team && (stringValue(team.id) ?? stringValue(competitor?.id))
}

const statusFrom = (competition: Record<string, unknown>, event: Record<string, unknown>): Record<string, unknown> =>
  recordAt(competition, 'status') ?? recordAt(event, 'status') ?? {}

const gameStatus = (status: Record<string, unknown>): GameStatus => {
  const type = recordAt(status, 'type')
  const state = stringValue(type?.state)
  const detail = `${stringValue(type?.detail) ?? ''} ${stringValue(type?.shortDetail) ?? ''}`.toLowerCase()
  if (state === 'post' || state === 'final') return 'final'
  if (state === 'halftime' || detail.includes('halftime')) return 'halftime'
  return 'quarter'
}

const periodLabel = (status: Record<string, unknown>): string => {
  const period = numberValue(status.period) ?? numberValue(recordAt(status, 'period')?.number)
  return period === undefined ? '' : `Q${period}`
}

const possessionSide = (competition: Record<string, unknown>, homeId: string | undefined, awayId: string | undefined): 'home' | 'away' | null => {
  const situation = recordAt(competition, 'situation')
  const possession = stringValue(situation?.possession)
  if (!possession) return null
  if (possession === homeId) return 'home'
  if (possession === awayId) return 'away'
  return null
}

const latestTimestamp = (
  event: Record<string, unknown>,
  competition: Record<string, unknown>,
  latestPlay: Record<string, unknown> | undefined,
): string => {
  const timestamp = [
    latestPlay?.date,
    latestPlay?.timestamp,
    competition.date,
    event.date,
  ].map(validDate).find((value): value is string => value !== undefined)
  if (!timestamp) throw new Error('ESPN feed has no valid timestamp')
  return timestamp
}

export const normalizeEspnGameState = (payloads: EspnPayloads): GameState => {
  const event = eventFromScoreboard(payloads.scoreboard, payloads.preferredEventId)
  const eventId = stringValue(event.id)
  if (!eventId) throw new Error('ESPN event has no stable event ID')
  const competition = competitionFrom(event, payloads.summary)
  const home = competitorBySide(competition, 'home')
  const away = competitorBySide(competition, 'away')
  const homeTeam = teamName(home)
  const awayTeam = teamName(away)
  if (!homeTeam || !awayTeam) throw new Error('ESPN event is missing team identity')

  const status = statusFrom(competition, event)
  const plays = playItemsFrom(payloads.summary, payloads.plays)
  const latestPlay = plays.length > 0 ? plays[plays.length - 1] : undefined
  const homeId = teamId(home)
  const awayId = teamId(away)
  const situation = recordAt(competition, 'situation')
  const latestPlayId = latestPlay && stringValue(latestPlay.id)
  const sequenceNumber = latestPlay && (numberValue(latestPlay.sequenceNumber) ?? numberValue(latestPlay.sequence))
  const timestamp = latestTimestamp(event, competition, latestPlay)
  const rawClock = stringValue(status.displayClock) ?? stringValue(recordAt(status, 'type')?.shortDetail)

  const homeScore = numberValue(home?.score)
  const awayScore = numberValue(away?.score)
  if (homeScore === undefined || awayScore === undefined) throw new Error('ESPN event is missing score')

  return {
    id: eventId,
    eventId,
    ...(latestPlayId ? { playId: latestPlayId } : {}),
    ...(sequenceNumber === undefined ? {} : { sequenceNumber }),
    homeTeam,
    awayTeam,
    homeScore,
    awayScore,
    quarter: periodLabel(status),
    clock: rawClock ?? '',
    status: gameStatus(status),
    possession: possessionSide(competition, homeId, awayId),
    down: numberValue(situation?.down) ?? null,
    distance: numberValue(situation?.distance) ?? null,
    fieldPosition: stringValue(situation?.possessionText) ?? null,
    lastPlay: stringValue(latestPlay?.text) ?? '',
    timestamp,
    feedTimestamp: timestamp,
    sourceStatus: 'LIVE',
  }
}

const defaultFetch: EspnFetch = (input, init) => globalThis.fetch(input, init)
const defaultSleep: Sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const boundedOption = (
  name: string,
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  integer = false,
): number => {
  const candidate = value ?? fallback
  if (!Number.isFinite(candidate) || (integer && !Number.isInteger(candidate)) || candidate < min || candidate > max) {
    throw new RangeError(`${name} must be a finite number between ${min} and ${max}`)
  }
  return candidate
}

const retryableStatus = (status: number): boolean => status === 408 || status === 425 || status === 429 || status >= 500
const stateVersion = (state: GameState): number => state.sequenceNumber ?? Date.parse(state.timestamp)
const sameState = (left: GameState, right: GameState): boolean =>
  left.eventId === right.eventId && left.playId === right.playId && left.timestamp === right.timestamp &&
  left.homeScore === right.homeScore && left.awayScore === right.awayScore

const withStatus = (state: GameState, status: FeedStatus): GameState => ({ ...state, sourceStatus: status })

export class EspnGameStateSource implements LiveGameStateSource {
  private readonly fetch: EspnFetch
  private readonly now: () => number
  private readonly sleep: Sleep
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly backoffMs: number
  private readonly staleAfterMs: number
  private readonly userAgent: string
  private readonly featuredEventId?: string
  private readonly replay?: GameStateSource
  private cached?: GameStateSnapshot

  constructor(options: EspnGameStateSourceOptions = {}) {
    this.fetch = options.fetch ?? defaultFetch
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? defaultSleep
    this.timeoutMs = boundedOption(
      'timeoutMs',
      options.timeoutMs,
      DEFAULT_ESPN_OPTIONS.timeoutMs,
      ESPN_CONFIG_LIMITS.timeoutMs.min,
      ESPN_CONFIG_LIMITS.timeoutMs.max,
    )
    this.maxRetries = boundedOption(
      'maxRetries',
      options.maxRetries,
      DEFAULT_ESPN_OPTIONS.maxRetries,
      ESPN_CONFIG_LIMITS.maxRetries.min,
      ESPN_CONFIG_LIMITS.maxRetries.max,
      true,
    )
    this.backoffMs = boundedOption(
      'backoffMs',
      options.backoffMs,
      DEFAULT_ESPN_OPTIONS.backoffMs,
      ESPN_CONFIG_LIMITS.backoffMs.min,
      ESPN_CONFIG_LIMITS.backoffMs.max,
    )
    this.staleAfterMs = boundedOption(
      'staleAfterMs',
      options.staleAfterMs,
      DEFAULT_ESPN_OPTIONS.staleAfterMs,
      ESPN_CONFIG_LIMITS.staleAfterMs.min,
      ESPN_CONFIG_LIMITS.staleAfterMs.max,
    )
    this.userAgent = options.userAgent ?? DEFAULT_ESPN_OPTIONS.userAgent
    this.featuredEventId = options.featuredEventId
    this.replay = options.replay
  }

  async poll(): Promise<GameStateSnapshot> {
    try {
      const scoreboard = await this.requestJson(ESPN_ENDPOINTS.scoreboard)
      const event = eventFromScoreboard(scoreboard, this.featuredEventId)
      const eventId = stringValue(event.id)
      if (!eventId) throw new Error('ESPN event has no stable event ID')
      const [summary, plays] = await Promise.all([
        this.requestJson(ESPN_ENDPOINTS.summary(eventId)),
        this.requestJson(ESPN_ENDPOINTS.plays(eventId)),
      ])
      return this.accept(normalizeEspnGameState({ scoreboard, summary, plays, preferredEventId: eventId }))
    } catch {
      return this.failureSnapshot()
    }
  }

  getCachedSnapshot(): GameStateSnapshot | undefined {
    return this.cached
  }

  private async requestJson<T>(url: string): Promise<T> {
    let lastError: unknown = new Error(`ESPN request failed: ${url}`)
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeoutMs)
      let retryAllowed = true
      try {
        const response = await this.fetch(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': this.userAgent,
          },
          signal: controller.signal,
        })
        if (!response.ok) {
          lastError = new Error(`ESPN HTTP ${response.status}`)
          if (!retryableStatus(response.status) || attempt === this.maxRetries) {
            retryAllowed = false
            throw lastError
          }
        } else {
          return await response.json() as T
        }
      } catch (error) {
        lastError = error
        if (!retryAllowed || attempt === this.maxRetries) throw lastError
      } finally {
        clearTimeout(timer)
      }
      await this.sleep(this.backoffMs * 2 ** attempt)
    }
    throw lastError
  }

  private accept(state: GameState): GameStateSnapshot {
    const previous = this.cached
    if (previous && previous.state.eventId === state.eventId) {
      const currentVersion = stateVersion(previous.state)
      const incomingVersion = stateVersion(state)
      if (incomingVersion < currentVersion) {
        return { state: withStatus(previous.state, 'STALE'), status: 'STALE' }
      }
    }

    const age = this.now() - Date.parse(state.feedTimestamp ?? state.timestamp)
    if (age > this.staleAfterMs) {
      const snapshot = { state: withStatus(state, 'STALE'), status: 'STALE' as const }
      this.cached = snapshot
      return snapshot
    }

    if (previous && previous.state.eventId === state.eventId) {
      const currentVersion = stateVersion(previous.state)
      const incomingVersion = stateVersion(state)
      if (incomingVersion === currentVersion || sameState(previous.state, state)) {
        if (previous.status === 'STALE') {
          const snapshot = { state: withStatus(state, 'LIVE'), status: 'LIVE' as const }
          this.cached = snapshot
          return snapshot
        }
        return previous
      }
    }

    const snapshot = { state: withStatus(state, 'LIVE'), status: 'LIVE' as const }
    this.cached = snapshot
    return snapshot
  }

  private failureSnapshot(): GameStateSnapshot {
    if (this.cached) {
      const snapshot = { state: withStatus(this.cached.state, 'STALE'), status: 'STALE' as const }
      this.cached = snapshot
      return snapshot
    }
    if (this.replay) {
      const replay = this.replay.getSnapshotAt(0)
      return { state: withStatus(replay.state, 'REPLAY'), status: 'REPLAY' }
    }
    throw new Error('ESPN feed unavailable and no replay fallback configured')
  }
}
