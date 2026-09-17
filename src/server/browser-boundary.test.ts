import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const browserEntryFiles = ['src/main.tsx', 'src/App.tsx', 'src/sources.ts', 'src/fixture.ts', 'src/browser/forecastRead.ts']
const browserSource = browserEntryFiles.map((file) => readFileSync(file, 'utf8')).join('\n')

describe('browser/server boundary', () => {
  it('does not import or expose the server-only Jev client or its credential boundary', () => {
    expect(browserSource).not.toMatch(/from ['\"].*\/server\//)
    expect(browserSource).not.toContain('@typesafe-ai/sdk')
    expect(browserSource).not.toContain('JEV_API_KEY')
    expect(browserSource).not.toContain('OPENROUTER_KEY')
    expect(browserSource).not.toContain('api.typesafe.ai')
    expect(browserSource).not.toContain('openrouter.ai')
  })
})
