import { anyApi } from 'convex/server'

/**
 * Dual CJS/ESM function refs for the Vercel Node runtime.
 *
 * The generated Convex API module is ESM-only. Loading it through Node
 * `require` (including a CJS Vercel lambda) throws ERR_REQUIRE_ESM, and a
 * NodeNext typecheck of that generated .d.ts pulls Convex function source
 * into the functions graph. `anyApi` is the same runtime object with a
 * package export that works in both CJS and ESM.
 */
export const api = anyApi
