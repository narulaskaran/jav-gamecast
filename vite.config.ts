import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const SERVER_ONLY_MARKERS = ['@typesafe-ai/sdk', 'TYPESAFE_API_KEY', 'https://api.typesafe.ai', 'convex/browser', 'CONVEX_URL'] as const

const browserServerBoundaryGuard = (): Plugin => ({
  name: 'browser-server-boundary-guard',
  generateBundle(_options, bundle) {
    for (const [fileName, output] of Object.entries(bundle)) {
      if (output.type !== 'chunk') continue
      for (const marker of SERVER_ONLY_MARKERS) {
        if (output.code.includes(marker)) {
          this.error(`Server-only marker ${marker} reached browser chunk ${fileName}`)
        }
      }
    }
  },
})

export default defineConfig({
  plugins: [react(), browserServerBoundaryGuard()],
})
