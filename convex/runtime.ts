import { action } from './_generated/server'
import { api } from './_generated/api'
import { v } from 'convex/values'

/** Read-only action used by an operator smoke check; it never invokes a provider. */
export const latestForecastHealth = action({
  args: { gameId: v.string() },
  handler: async (ctx, { gameId }) => {
    const records = await ctx.runQuery(api.forecasts.listForecastsByGame, { gameId, limit: 128 })
    const latest = records[records.length - 1]
    return {
      gameId,
      available: latest !== undefined,
      status: latest?.status ?? 'empty',
      source: latest?.source ?? null,
      updatedAt: latest?.completedAt ?? null,
    }
  },
})
