import { createRequire } from 'node:module'

// Runtime-only load so Vercel NodeNext does not typecheck Convex function source.
const require = createRequire(import.meta.url)
export const api = (require('../../convex/_generated/api.js') as { api: any }).api
