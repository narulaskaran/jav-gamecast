export type ForecastChoice = 'home' | 'away' | 'tie'
export type GameStatus = 'quarter' | 'halftime' | 'final'
export type FeedStatus = 'REPLAY' | 'LIVE' | 'STALE'

export interface GameState {
  id: string
  eventId?: string
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
  quarter: string
  clock: string
  status: GameStatus
  possession: 'home' | 'away' | null
  lastPlay: string
  timestamp: string
}

export interface ForecastPoint {
  id: string
  gameId: string
  eventId: string
  timestamp: string
  elapsedSeconds: number
  homeProbability: number
  awayProbability: number
  tieProbability: number
  choice: ForecastChoice
  confidence: number
  eventLabel?: string
  eventKind?: 'opening' | 'swing' | 'score' | 'turnover' | 'halftime' | 'final'
}

export interface GamecastFixture {
  game: GameState
  points: readonly ForecastPoint[]
}

export interface GameStateSnapshot {
  state: GameState
  status: FeedStatus
}

export interface GameStateSource {
  getSnapshotAt(pointIndex: number): GameStateSnapshot
}

export interface ForecastSource {
  getPoints(): readonly ForecastPoint[]
}
