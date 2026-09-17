import { fixtureGameStateSource } from '../sources'
import type { GameStateSnapshot, LiveGameStateSource } from '../types'
import type { ForecastRecord } from '../shared/forecastRecords'
import {
  DeterministicMockForecastProvider,
  ForecastWorker,
  InMemoryForecastStore,
  ReplayForecastProvider,
  type ForecastJob,
  type ForecastMode,
  type ForecastResult,
  type ForecastStore,
} from './forecastWorker'
import { EspnGameStateSource, type EspnGameStateSourceOptions } from './espn'

/** The scheduler invokes one cycle per tick; this function never starts a polling loop. */
export const SCHEDULER_RESPONSIBILITY = 'Invoke runForecastCycle once per bounded scheduler tick; own cadence, retries, and process lifetime outside this handler.'

export type ForecastCycleSource = LiveGameStateSource

export interface ForecastCycleOptions {
  mode?: ForecastMode
  source?: ForecastCycleSource
  worker?: ForecastWorker
  store?: ForecastStore
  now?: () => number
  espn?: Omit<EspnGameStateSourceOptions, 'now' | 'replay'>
  replayRecords?: readonly ForecastRecord[]
}

export interface ForecastCycleResult {
  snapshot: GameStateSnapshot
  job: ForecastJob
  forecast: ForecastResult
}

const replaySource: ForecastCycleSource = {
  async poll() {
    return fixtureGameStateSource.getSnapshotAt(0)
  },
  getCachedSnapshot() {
    return fixtureGameStateSource.getSnapshotAt(0)
  },
}

const sourceFor = (options: ForecastCycleOptions, mode: ForecastMode): ForecastCycleSource => {
  if (options.source) return options.source
  if (mode !== 'live') return replaySource
  return new EspnGameStateSource({
    ...options.espn,
    ...(options.now ? { now: options.now } : {}),
    replay: fixtureGameStateSource,
  })
}

const workerFor = (options: ForecastCycleOptions, mode: ForecastMode): ForecastWorker => {
  if (options.worker) return options.worker
  const store = options.store ?? new InMemoryForecastStore()
  return new ForecastWorker({
    mode,
    store,
    ...(options.now ? { now: options.now } : {}),
    ...(mode === 'mock' ? { mockProvider: new DeterministicMockForecastProvider() } : {}),
    ...(mode === 'replay' ? {
      replayProvider: options.replayRecords
        ? new ReplayForecastProvider(options.replayRecords)
        : new DeterministicMockForecastProvider(),
    } : {}),
  })
}

export const forecastJobFromSnapshot = (snapshot: GameStateSnapshot): ForecastJob => {
  const gameId = snapshot.state.id.trim()
  const providerEventId = (snapshot.state.eventId ?? snapshot.state.id).trim()
  if (!gameId || !providerEventId) throw new Error('Forecast cycle requires stable game and provider event IDs')
  return {
    gameId,
    providerEventId,
    ...(snapshot.state.playId ? { providerPlayId: snapshot.state.playId } : {}),
    state: snapshot.state,
  }
}

export const runForecastCycle = async (options: ForecastCycleOptions = {}): Promise<ForecastCycleResult> => {
  const mode = options.mode ?? 'live'
  const source = sourceFor(options, mode)
  const worker = workerFor(options, mode)
  const snapshot = await source.poll()
  const job = forecastJobFromSnapshot(snapshot)
  const forecast = await worker.forecast(job)
  return { snapshot, job, forecast }
}

export const createForecastCycleHandler = (options: ForecastCycleOptions = {}) =>
  async (): Promise<ForecastCycleResult> => runForecastCycle(options)
