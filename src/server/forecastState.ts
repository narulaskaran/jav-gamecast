import type { FeedStatus, GameState, GameStatus } from '../types'

/**
 * The only state accepted by the forecast worker: the server-normalized
 * current GameState. ForecastRecord.rawNormalizedState stores this exact
 * allowlisted shape, so future outcome/post-event fields cannot cross the
 * inference boundary.
 */
export type CurrentForecastState = GameState

const allowedKeys = new Set([
  'id',
  'eventId',
  'playId',
  'sequenceNumber',
  'homeTeam',
  'awayTeam',
  'homeScore',
  'awayScore',
  'quarter',
  'clock',
  'status',
  'possession',
  'down',
  'distance',
  'fieldPosition',
  'lastPlay',
  'timestamp',
  'feedTimestamp',
  'sourceStatus',
])
const statuses: readonly GameStatus[] = ['quarter', 'halftime', 'final']
const feedStatuses: readonly FeedStatus[] = ['REPLAY', 'LIVE', 'STALE']
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isDateString = (value: unknown): value is string => isNonEmptyString(value) && !Number.isNaN(Date.parse(value))
const hasOnlyAllowedKeys = (value: Record<string, unknown>): boolean => Object.keys(value).every((key) => allowedKeys.has(key))

export const normalizeCurrentForecastState = (value: unknown): CurrentForecastState => {
  if (!isRecord(value) || !hasOnlyAllowedKeys(value)) throw new TypeError('Forecast state contains unsupported future or post-event fields')
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.homeTeam) || !isNonEmptyString(value.awayTeam) || value.homeTeam === value.awayTeam) {
    throw new TypeError('Forecast state requires distinct game and team identity')
  }
  if (![value.homeScore, value.awayScore].every((score) => isFiniteNumber(score) && score >= 0 && Number.isInteger(score))) {
    throw new TypeError('Forecast state scores must be non-negative integers')
  }
  if (!isNonEmptyString(value.quarter) || !isNonEmptyString(value.clock) || !statuses.includes(value.status as GameStatus)) {
    throw new TypeError('Forecast state period or status is invalid')
  }
  if (value.possession !== null && value.possession !== 'home' && value.possession !== 'away') {
    throw new TypeError('Forecast state possession is invalid')
  }
  if (!isNonEmptyString(value.lastPlay) || !isDateString(value.timestamp)) throw new TypeError('Forecast state play text or timestamp is invalid')
  if (value.eventId !== undefined && !isNonEmptyString(value.eventId)) throw new TypeError('Forecast state event ID is invalid')
  if (value.playId !== undefined && !isNonEmptyString(value.playId)) throw new TypeError('Forecast state play ID is invalid')
  if (value.sequenceNumber !== undefined && (!isFiniteNumber(value.sequenceNumber) || value.sequenceNumber < 0 || !Number.isInteger(value.sequenceNumber))) {
    throw new TypeError('Forecast state sequence number is invalid')
  }
  if (value.down !== undefined && value.down !== null && (!isFiniteNumber(value.down) || value.down < 0 || !Number.isInteger(value.down))) throw new TypeError('Forecast state down is invalid')
  if (value.distance !== undefined && value.distance !== null && (!isFiniteNumber(value.distance) || value.distance < 0)) throw new TypeError('Forecast state distance is invalid')
  if (value.fieldPosition !== undefined && value.fieldPosition !== null && !isNonEmptyString(value.fieldPosition)) throw new TypeError('Forecast state field position is invalid')
  if (value.feedTimestamp !== undefined && !isDateString(value.feedTimestamp)) throw new TypeError('Forecast state feed timestamp is invalid')
  if (value.sourceStatus !== undefined && !feedStatuses.includes(value.sourceStatus as FeedStatus)) throw new TypeError('Forecast state source status is invalid')

  return {
    id: value.id,
    ...(value.eventId === undefined ? {} : { eventId: value.eventId }),
    ...(value.playId === undefined ? {} : { playId: value.playId }),
    ...(value.sequenceNumber === undefined ? {} : { sequenceNumber: value.sequenceNumber }),
    homeTeam: value.homeTeam,
    awayTeam: value.awayTeam,
    homeScore: value.homeScore as number,
    awayScore: value.awayScore as number,
    quarter: value.quarter,
    clock: value.clock,
    status: value.status as GameStatus,
    possession: value.possession,
    ...(value.down === undefined ? {} : { down: value.down }),
    ...(value.distance === undefined ? {} : { distance: value.distance }),
    ...(value.fieldPosition === undefined ? {} : { fieldPosition: value.fieldPosition }),
    lastPlay: value.lastPlay,
    timestamp: value.timestamp,
    ...(value.feedTimestamp === undefined ? {} : { feedTimestamp: value.feedTimestamp }),
    ...(value.sourceStatus === undefined ? {} : { sourceStatus: value.sourceStatus as FeedStatus }),
  }
}
