#!/usr/bin/env node
/**
 * Vercel production build: push Convex functions, then the Vite app.
 *
 * Prod BYOD (`datasets.put`) 500s with Convex HTTP `[Request ID] Server Error`
 * when Vercel only runs `npm run build`. Convex is a separate backend.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const shouldDeployConvex = (env = process.env) => env.VERCEL_ENV === 'production'

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const setConvexWriteSecret = (writeSecret) => {
  const result = spawnSync('npx', ['convex', 'env', 'set', 'CONVEX_WRITE_SECRET'], {
    env: process.env,
    input: writeSecret,
    stdio: ['pipe', 'inherit', 'inherit'],
  })
  if (result.status !== 0) {
    console.error('Failed to set CONVEX_WRITE_SECRET on the Convex deployment.')
    process.exit(result.status ?? 1)
  }
}

export const runVercelBuild = (env = process.env) => {
  const deployKey = env.CONVEX_DEPLOY_KEY?.trim()
  const writeSecret = env.CONVEX_WRITE_SECRET?.trim()

  if (shouldDeployConvex(env)) {
    if (!deployKey) {
      console.error('CONVEX_DEPLOY_KEY is not set on this Vercel Production environment.')
      console.error('Convex dashboard → this production deployment → Settings → Generate Production Deploy Key.')
      console.error('Add it as Vercel env CONVEX_DEPLOY_KEY (Production only). Then redeploy.')
      process.exit(1)
    }
    if (!writeSecret) {
      console.error('CONVEX_WRITE_SECRET is not set on Vercel. Convex authorizeWrite will reject datasets.put.')
      process.exit(1)
    }
    console.log('Deploying Convex functions with npx convex deploy (CONVEX_DEPLOY_KEY present).')
    run('npx', ['convex', 'deploy', '--cmd', 'npm run build'])
    setConvexWriteSecret(writeSecret)
    return
  }

  if (env.VERCEL) {
    console.log(`Skipping Convex deploy (VERCEL_ENV=${env.VERCEL_ENV ?? 'unset'}). Production builds require CONVEX_DEPLOY_KEY.`)
  }
  run('npm', ['run', 'build'])
}

const isMain = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isMain) runVercelBuild()
