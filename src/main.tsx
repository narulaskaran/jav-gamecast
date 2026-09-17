import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createBrowserForecastHttpReadPath } from './browser/forecastHttp'
import { createBrowserForecastSource } from './browser/forecastRead'
import { defaultForecastSource } from './sources'

const clientEnv = (import.meta as ImportMeta & { env: { VITE_GAMECAST_MODE?: string; VITE_FEATURED_GAME_ID?: string } }).env
const liveSource = clientEnv.VITE_GAMECAST_MODE === 'live' && clientEnv.VITE_FEATURED_GAME_ID
  ? createBrowserForecastSource({
      readPath: createBrowserForecastHttpReadPath(),
      gameId: clientEnv.VITE_FEATURED_GAME_ID,
      fallback: defaultForecastSource.getPoints(),
    })
  : undefined

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App forecastSource={liveSource ?? defaultForecastSource} />
  </StrictMode>,
)
