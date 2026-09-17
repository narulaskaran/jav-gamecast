import { AnalysisError, AnalysisService, type AnalysisStorage } from './analysis'
import { ConvexAnalysisStore } from './analysisStore'
import { OpenRouterDraftProvider, TypeSafeClassifierProvider } from './analysisProviders'
import { readPublicRuntimeConfig } from './liveConfig'

class UnconfiguredAnalysisStore implements AnalysisStorage {
  private unavailable(): never {
    throw new AnalysisError('ANALYSIS_STORAGE_NOT_CONFIGURED', 'Analysis storage is not configured', 503, true)
  }

  get(): never { return this.unavailable() }
  put(): never { return this.unavailable() }
  getPublic(): never { return this.unavailable() }
  claim(): never { return this.unavailable() }
  release(): never { return this.unavailable() }
}

const publicConfig = readPublicRuntimeConfig()
const convexWriteSecret = process.env.CONVEX_WRITE_SECRET?.trim()
const storage: AnalysisStorage = publicConfig && convexWriteSecret
  ? new ConvexAnalysisStore(publicConfig.convexUrl, convexWriteSecret)
  : new UnconfiguredAnalysisStore()

/**
 * Production runtime: Convex is mandatory for reads, writes, claims, and
 * incremental snapshots. Missing deployment configuration fails closed rather
 * than falling back to a process-local store that would lose serverless state.
 */
export const analysisService = new AnalysisService({
  store: storage,
  draftProvider: new OpenRouterDraftProvider(),
  classifier: new TypeSafeClassifierProvider(),
})
