import { describe, expect, it } from 'vitest'

describe('serverless handler import safety', () => {
  it('loads dataset and analysis handlers without a module-init throw', async () => {
    const handlers = await Promise.all([
      import('../../api/datasets/status.ts'),
      import('../../api/datasets/from-csv.ts'),
      import('../../api/datasets/from-url.ts'),
      import('../../api/datasets/[datasetId].ts'),
      import('../../api/analysis/draft.ts'),
      import('../../api/analysis/run.ts'),
      import('../../api/analysis/[analysisId].ts'),
      import('../../api/share/[analysisId].ts'),
      import('../../api/browse.ts'),
    ])
    for (const mod of handlers) {
      expect(typeof mod.default).toBe('function')
    }
  })
})
