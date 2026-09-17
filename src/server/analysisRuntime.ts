import { AnalysisService, InMemoryAnalysisStore } from './analysis'
import { OpenRouterDraftProvider, TypeSafeClassifierProvider } from './analysisProviders'

/**
 * Temporary non-production store. The Convex analysis adapter will replace this
 * module before deployment; the API/domain contract does not depend on storage.
 */
export const analysisService = new AnalysisService({
  store: new InMemoryAnalysisStore(),
  draftProvider: new OpenRouterDraftProvider(),
  classifier: new TypeSafeClassifierProvider(),
})
