import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const collect = (dir: string): string[] => {
  const entries = readdirSync(dir)
  const files: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry === 'server' || entry === 'persistence') continue
      files.push(...collect(path))
      continue
    }
    if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) files.push(path)
  }
  return files
}

const browserSource = collect('src').map((file) => readFileSync(file, 'utf8')).join('\n')

describe('browser/server boundary', () => {
  it('does not import or expose the server-only Jev client or its credential boundary', () => {
    expect(browserSource).not.toMatch(/from ['\"].*\/server\//)
    expect(browserSource).not.toContain('@typesafe-ai/sdk')
    expect(browserSource).not.toContain('JEV_API_KEY')
    expect(browserSource).not.toContain('OPENROUTER_KEY')
    expect(browserSource).not.toContain('UPLOADTHING_TOKEN')
    expect(browserSource).not.toContain('UPLOADTHING_SECRET')
    expect(browserSource).not.toContain('api.typesafe.ai')
    expect(browserSource).not.toContain('openrouter.ai')
    expect(browserSource).not.toContain('uploadthing/server')
    expect(browserSource).not.toContain('CONVEX_WRITE_SECRET')
    expect(browserSource).not.toContain('CONVEX_DEPLOY_KEY')
  })
})
