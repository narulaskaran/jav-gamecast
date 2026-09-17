#!/usr/bin/env node
import fs from 'node:fs'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import path from 'node:path'

export const FIXTURE_ID = 'seahawks-super-bowl-2026-jev-v1'
export const GAME_ID = '2025_22_SEA_NE'
export const PBP_URL = 'https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2025.parquet'
export const CSV_URL = 'https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2025.csv.gz'
export const GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/33fe6d59c16f7119f72332e2222e43c53415acf1/data/games.csv'
export const EXPECTED_PBP_SHA256 = 'c6ecedd6d678cc37ed316b23ef84ee1ec6abb69c514bb11868a7ebd5a367df29'
export const EXPECTED_CSV_SHA256 = '2f135887790a013fd004e609e37096bb4816d5cc80b9f19122e1bad478961978'
export const EXPECTED_GAMES_SHA256 = '12a5c62f81c2cf6e50c383bbd96f0e5b80e05bfffb830151b787d32d39804564'
export const IDENTITY_COMMIT = '33fe6d59c16f7119f72332e2222e43c53415acf1'

export const SCHEMA_FIELDS = [
  'game_id', 'play_id', 'game_date', 'qtr', 'game_seconds_remaining', 'half_seconds_remaining',
  'posteam', 'defteam', 'side_of_field', 'yardline_100', 'down', 'ydstogo', 'score_differential',
  'play_type', 'passer_player_id', 'passer_player_name', 'receiver_player_id', 'receiver_player_name',
  'rusher_player_id', 'rusher_player_name', 'yards_gained', 'air_yards', 'yards_after_catch', 'epa',
  'wpa', 'posteam_score', 'defteam_score', 'complete_pass', 'sack', 'penalty', 'fumble',
]

const NUMERIC_FIELDS = new Set([
  'play_id', 'qtr', 'game_seconds_remaining', 'half_seconds_remaining', 'yardline_100', 'down',
  'ydstogo', 'score_differential', 'yards_gained', 'air_yards', 'yards_after_catch', 'epa', 'wpa',
  'posteam_score', 'defteam_score', 'complete_pass', 'sack', 'penalty', 'fumble',
])
const MODEL_INPUT_FIELDS = [
  'play_id', 'qtr', 'game_seconds_remaining', 'half_seconds_remaining', 'posteam', 'defteam',
  'side_of_field', 'yardline_100', 'down', 'ydstogo', 'score_differential', 'play_type',
  'passer_player_id', 'receiver_player_id', 'rusher_player_id', 'yards_gained', 'air_yards',
  'yards_after_catch', 'epa', 'wpa', 'complete_pass', 'sack', 'penalty', 'fumble',
]
const AUDIT_FIELDS = ['game_id', 'game_date', 'passer_player_name', 'receiver_player_name', 'rusher_player_name', 'posteam_score', 'defteam_score']
const LABEL_FIELDS = ['yards_gained', 'play_type', 'receiver_player_id', 'rusher_player_id', 'complete_pass', 'sack', 'penalty', 'fumble']
const LABEL_DEFINITION = 'highest Seattle second-half scrimmage-yard contributor; sacks and penalties excluded'
const NAMED_CANDIDATE_LABELS = new Map([
  ['00-0038134', 'K.Walker'],
  ['00-0033908', 'C.Kupp'],
  ['00-0038543', 'J.Smith-Njigba'],
])
const EXPECTED_PLAY_IDS = [57, 84, 106, 131, 161, 184, 206, 485, 515, 540, 710, 739, 761, 786, 808, 831, 992, 1015, 1042, 1065, 1092, 1114, 1137, 1303, 1340, 1362, 1385, 1410, 1440, 1462, 1484, 1744, 1776, 1798, 1827, 1852, 1874, 1906, 1948, 2219, 2246, 2271, 2296, 2318, 2340, 2370, 2397, 2427, 2587, 2619, 2644, 2806, 2835, 2858, 3051, 3096, 3118, 3141, 3166, 3344, 3374, 3396, 3422, 3645, 3672, 3694, 3716, 3738, 4280, 4302, 4376]
const EXPECTED_IDENTITY = {
  game_id: GAME_ID,
  game_date: '2026-02-08',
  game_type: 'SB',
  week: 22,
  away_team: 'SEA',
  away_score: 29,
  home_team: 'NE',
  home_score: 13,
  location: 'Neutral',
  gsis: '60176',
  old_game_id: '2026020800',
  pfr: '202602080nwe',
  espn: '401772988',
}
const EXPECTED_RETRIEVED_UTC = '2026-09-17 15:41:55 UTC'
const EXPECTED_FIXTURE_GENERATED_UTC = '2026-09-17 15:50:58 UTC'
const EXPECTED_LICENSE_URL = 'https://raw.githubusercontent.com/nflverse/nflverse-data/main/LICENSE.md'
const EXPECTED_ATTRIBUTION = 'nflverse/nflfastR contributors'
const EXPECTED_DISCLOSURE = 'Demo fixture, not evidence of model quality or generalization; the label is an MVP proxy, not an official award.'
const OMITTED_SOURCE_FIELDS = ['touchdown', 'incomplete_pass', 'interception', 'extra_point_result', 'field_goal_result', 'two_point_conv_result']

function fail(message) { throw new Error(`[football-fixture] ${message}`) }
function readHash(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex') }
function assertHash(filePath, expected, label) {
  const actual = readHash(filePath)
  if (actual !== expected) fail(`${label} SHA-256 mismatch: expected ${expected}, got ${actual}`)
  return actual
}

function expectedSourceHash(sourceFormat) {
  if (sourceFormat === 'csv.gz') return EXPECTED_CSV_SHA256
  if (sourceFormat === 'parquet') return EXPECTED_PBP_SHA256
  fail(`unsupported source format: ${sourceFormat}`)
}

export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1 }
      else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') { row.push(field); field = '' }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (char !== '\r') field += char
  }
  if (quoted) fail('CSV ended inside a quoted field')
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows
}

function csvRecords(filePath, requiredFields = []) {
  const bytes = fs.readFileSync(filePath)
  const text = filePath.endsWith('.gz') ? zlib.gunzipSync(bytes).toString('utf8') : bytes.toString('utf8')
  const rows = parseCsv(text)
  if (rows.length < 2) fail(`${filePath} has no data rows`)
  const header = rows[0]
  if (new Set(header).size !== header.length) fail(`${filePath} has duplicate columns`)
  for (const field of requiredFields) if (!header.includes(field)) fail(`${filePath} is missing required column ${field}`)
  return rows.slice(1).filter((row) => row.some((value) => value !== '')).map((row, index) => {
    if (row.length !== header.length) fail(`${filePath} row ${index + 2} has ${row.length} columns; expected ${header.length}`)
    return Object.fromEntries(header.map((name, position) => [name, row[position]]))
  }).map((record) => ({ record }))
}

function numberOrNull(value, field) {
  if (value === '' || value === undefined) return null
  const number = Number(value)
  if (!Number.isFinite(number)) fail(`${field} is not numeric: ${value}`)
  return number
}
function valueOrNull(value) { return value === '' || value === undefined ? null : value }
function sourceValue(record, field) {
  return NUMERIC_FIELDS.has(field) ? numberOrNull(record[field], field) : valueOrNull(record[field])
}

function identityFromGames(gamesPath) {
  const games = csvRecords(gamesPath, ['game_id', 'gameday', 'game_type', 'week', 'away_team', 'away_score', 'home_team', 'home_score', 'location', 'gsis', 'old_game_id', 'pfr', 'espn']).map(({ record }) => record)
  const game = games.find((record) => record.game_id === GAME_ID)
  if (!game) fail(`games.csv does not contain ${GAME_ID}`)
  const actual = {
    game_id: game.game_id,
    game_date: game.gameday,
    game_type: game.game_type,
    week: Number(game.week),
    away_team: game.away_team,
    away_score: Number(game.away_score),
    home_team: game.home_team,
    home_score: Number(game.home_score),
    location: game.location,
    gsis: game.gsis,
    old_game_id: game.old_game_id,
    pfr: game.pfr,
    espn: game.espn,
  }
  for (const [field, expected] of Object.entries(EXPECTED_IDENTITY)) {
    if (actual[field] !== expected) fail(`identity ${field} mismatch: expected ${expected}, got ${actual[field]}`)
  }
  return actual
}

function mapPlay(record) {
  return Object.fromEntries(SCHEMA_FIELDS.map((field) => [field, sourceValue(record, field)]))
}

export function filterPlays(records) {
  return records.filter(({ record }) => record.game_id === GAME_ID && record.posteam === 'SEA' && ['run', 'pass', 'sack'].includes(record.play_type))
    .sort((left, right) => Number(left.record.play_id) - Number(right.record.play_id))
}

function assertRowSchema(row, index) {
  if (!row || typeof row !== 'object') fail(`row ${index + 1} is not an object`)
  const keys = Object.keys(row)
  if (keys.length !== SCHEMA_FIELDS.length || keys.some((key, keyIndex) => key !== SCHEMA_FIELDS[keyIndex])) fail(`row ${index + 1} schema does not match the exact 31-field contract`)
  for (const field of NUMERIC_FIELDS) if (row[field] !== null && (typeof row[field] !== 'number' || !Number.isFinite(row[field]))) fail(`row ${index + 1} has an invalid numeric field: ${field}`)
}

function assertPlayShape(rows) {
  if (rows.length !== 71) fail(`filtered play count mismatch: expected 71, got ${rows.length}`)
  rows.forEach(assertRowSchema)
  const playIds = rows.map((row) => Number(row.play_id))
  if (new Set(playIds).size !== playIds.length) fail('filtered play IDs are not unique')
  if (playIds.some((playId, index) => index > 0 && playId <= playIds[index - 1])) fail('filtered rows are not ordered by play_id ASC')
  if (JSON.stringify(playIds) !== JSON.stringify(EXPECTED_PLAY_IDS)) fail('filtered rows do not match the pinned source play membership')
  const h1 = rows.filter((row) => row.qtr <= 2 && row.half_seconds_remaining > 0)
  const h2 = rows.filter((row) => row.qtr >= 3)
  if (h1.length !== 39 || h2.length !== 32) fail(`half split mismatch: expected 39/32, got ${h1.length}/${h2.length}`)
  if (rows.some((row, index) => (row.qtr <= 2 && row.half_seconds_remaining !== null && row.half_seconds_remaining > 0) !== (index < 39))) fail('rows cross the pinned H1/H2 temporal boundary')
  return { h1, h2 }
}

function credit(row) {
  if (row.penalty || row.sack || row.play_type === 'sack') return null
  if (row.play_type === 'run' && row.rusher_player_id) return { id: row.rusher_player_id, name: row.rusher_player_name, yards: row.yards_gained ?? 0 }
  if (row.play_type === 'pass' && row.complete_pass === 1 && row.receiver_player_id) return { id: row.receiver_player_id, name: row.receiver_player_name, yards: row.yards_gained ?? 0 }
  return null
}

export function buildEvaluation(rows) {
  const { h1, h2 } = assertPlayShape(rows)
  const totals = new Map()
  for (const row of h2) {
    const contribution = credit(row)
    if (!contribution) continue
    const current = totals.get(contribution.id) ?? { player_id: contribution.id, player_name: contribution.name, scrimmage_yards: 0 }
    current.scrimmage_yards += contribution.yards
    totals.set(contribution.id, current)
  }
  const leaderboard = [...totals.values()].sort((left, right) => right.scrimmage_yards - left.scrimmage_yards || left.player_id.localeCompare(right.player_id))
  const top = leaderboard[0]
  const tied = top && leaderboard.filter((entry) => entry.scrimmage_yards === top.scrimmage_yards).length > 1
  const label = top && !tied ? NAMED_CANDIDATE_LABELS.get(top.player_id) ?? 'Other/Tie' : 'Other/Tie'
  return {
    input_half: 'H1',
    label_half: 'H2',
    label_definition: LABEL_DEFINITION,
    label_class: label,
    leaderboard,
    h1_row_count: h1.length,
    h2_row_count: h2.length,
  }
}

export function manifestFor({ pbpPath, gamesPath, sourceFormat = 'csv.gz' }) {
  if (sourceFormat !== 'csv.gz' && sourceFormat !== 'parquet') fail(`unsupported source format: ${sourceFormat}`)
  const sourceHash = assertHash(pbpPath, expectedSourceHash(sourceFormat), `${sourceFormat} source`)
  const gamesHash = assertHash(gamesPath, EXPECTED_GAMES_SHA256, 'games.csv source')
  return {
    fixture_id: FIXTURE_ID,
    game_id: GAME_ID,
    source_format: sourceFormat,
    source_url: PBP_URL,
    csv_fallback_url: CSV_URL,
    identity_manifest_url: GAMES_URL,
    identity_commit: IDENTITY_COMMIT,
    retrieved_utc: '2026-09-17 15:41:55 UTC',
    fixture_generated_utc: '2026-09-17 15:50:58 UTC',
    source_sha256: sourceHash,
    parquet_sha256: EXPECTED_PBP_SHA256,
    csv_fallback_sha256: EXPECTED_CSV_SHA256,
    identity_manifest_sha256: gamesHash,
    license: 'CC BY 4.0',
    attribution: 'nflverse/nflfastR contributors',
    license_url: 'https://raw.githubusercontent.com/nflverse/nflverse-data/main/LICENSE.md',
    disclosure: 'Demo fixture, not evidence of model quality or generalization; the label is an MVP proxy, not an official award.',
    filter: { game_id: GAME_ID, posteam: 'SEA', play_type: ['run', 'pass', 'sack'], order: 'play_id ASC' },
    expected_counts: { game_pbp_rows: 193, filtered_rows: 71, h1_rows: 39, h2_rows: 32 },
    identity: EXPECTED_IDENTITY,
    fields: SCHEMA_FIELDS.map((name) => ({ name, role: MODEL_INPUT_FIELDS.includes(name) ? 'feature' : AUDIT_FIELDS.includes(name) ? 'audit' : 'label/evaluation-only' })),
    model_input_fields: MODEL_INPUT_FIELDS,
    label_fields: LABEL_FIELDS,
    omitted_source_fields: ['touchdown', 'incomplete_pass', 'interception', 'extra_point_result', 'field_goal_result', 'two_point_conv_result'],
  }
}

export function validateFixture(fixture) {
  if (!fixture || typeof fixture !== 'object') fail('fixture must be an object')
  const manifest = fixture.manifest
  if (!manifest || manifest.fixture_id !== FIXTURE_ID) fail('fixture manifest ID is invalid')
  if (manifest.game_id !== GAME_ID) fail('fixture manifest game ID is invalid')
  const expectedHash = expectedSourceHash(manifest.source_format)
  if (manifest.source_format !== 'csv.gz') fail('fixture source format must be the pinned CSV fallback; Parquet parsing is explicit but not bundled')
  if (manifest.source_url !== PBP_URL || manifest.csv_fallback_url !== CSV_URL || manifest.identity_manifest_url !== GAMES_URL) fail('fixture source URL is not pinned')
  if (manifest.identity_commit !== IDENTITY_COMMIT) fail('fixture identity commit is not pinned')
  if (manifest.retrieved_utc !== EXPECTED_RETRIEVED_UTC || manifest.fixture_generated_utc !== EXPECTED_FIXTURE_GENERATED_UTC) fail('fixture provenance timestamps are not pinned')
  if (manifest.source_sha256 !== expectedHash) fail('fixture source hash does not match the declared source format')
  if (manifest.csv_fallback_sha256 !== EXPECTED_CSV_SHA256 || manifest.parquet_sha256 !== EXPECTED_PBP_SHA256) fail('fixture source hashes are not pinned')
  if (manifest.identity_manifest_sha256 !== EXPECTED_GAMES_SHA256) fail('fixture identity manifest hash is not pinned')
  if (manifest.license !== 'CC BY 4.0' || manifest.license_url !== EXPECTED_LICENSE_URL || manifest.attribution !== EXPECTED_ATTRIBUTION) fail('fixture attribution or license is not pinned')
  if (manifest.disclosure !== EXPECTED_DISCLOSURE) fail('fixture demo/generalization disclosure is not pinned')
  for (const [field, expected] of Object.entries(EXPECTED_IDENTITY)) if (JSON.stringify(manifest.identity?.[field]) !== JSON.stringify(expected)) fail(`fixture identity ${field} does not match games.csv`)
  if (JSON.stringify(manifest.expected_counts) !== JSON.stringify({ game_pbp_rows: 193, filtered_rows: 71, h1_rows: 39, h2_rows: 32 })) fail('fixture row-count manifest is not pinned')
  if (JSON.stringify(manifest.filter) !== JSON.stringify({ game_id: GAME_ID, posteam: 'SEA', play_type: ['run', 'pass', 'sack'], order: 'play_id ASC' })) fail('fixture source filter is not pinned')
  if (JSON.stringify(manifest.omitted_source_fields) !== JSON.stringify(OMITTED_SOURCE_FIELDS)) fail('fixture omitted source fields are not pinned')
  if (JSON.stringify(manifest.model_input_fields) !== JSON.stringify(MODEL_INPUT_FIELDS)) fail('fixture model-input fields do not match the H1 contract')
  if (manifest.model_input_fields.some((field) => ['game_id', 'game_date', 'posteam_score', 'defteam_score', 'away_score', 'home_score', 'result', 'total', 'postgame', 'final_score'].includes(field))) fail('fixture model input contains identity or result leakage')
  if (JSON.stringify(manifest.label_fields) !== JSON.stringify(LABEL_FIELDS)) fail('fixture label fields do not match the H2 contract')
  if (!Array.isArray(manifest.fields) || manifest.fields.length !== SCHEMA_FIELDS.length || manifest.fields.some((field, index) => field.name !== SCHEMA_FIELDS[index] || field.role !== (MODEL_INPUT_FIELDS.includes(field.name) ? 'feature' : AUDIT_FIELDS.includes(field.name) ? 'audit' : 'label/evaluation-only'))) fail('fixture field metadata does not match the compact schema')
  if (!Array.isArray(fixture.rows) || fixture.rows.length !== 71) fail(`fixture must contain 71 rows, got ${fixture.rows?.length}`)
  for (let index = 0; index < fixture.rows.length; index += 1) {
    const row = fixture.rows[index]
    if (JSON.stringify(Object.keys(row)) !== JSON.stringify(SCHEMA_FIELDS)) fail(`fixture row ${index + 1} schema does not match the 31-field contract`)
    if (row.game_id !== GAME_ID || row.posteam !== 'SEA') fail(`row ${index + 1} has the wrong game or offense`)
    if (row.game_date !== EXPECTED_IDENTITY.game_date) fail(`row ${index + 1} has the wrong game date`)
    if (['run', 'pass', 'sack'].includes(row.play_type) === false) fail(`row ${index + 1} has an unsupported play type`)
    if (index > 0 && row.play_id <= fixture.rows[index - 1].play_id) fail('fixture rows are not ordered by play_id ASC')
  }
  const { h1, h2 } = assertPlayShape(fixture.rows)
  if (fixture.evaluation?.h1_row_count !== h1.length || fixture.evaluation?.h2_row_count !== h2.length) fail('evaluation row counts do not match fixture rows')
  if (JSON.stringify(fixture.evaluation) !== JSON.stringify(buildEvaluation(fixture.rows))) fail('evaluation metadata does not match the deterministic H2 label calculation')
  if (fixture.manifest.model_input_fields.some((field) => !SCHEMA_FIELDS.includes(field))) fail('model input includes a field outside the compact schema')
  if (fixture.manifest.model_input_fields.some((field) => ['game_id', 'game_date', 'posteam_score', 'defteam_score'].includes(field))) fail('model input includes identity or score audit leakage')
  return true
}

export function generateFixture({ pbpPath, gamesPath, sourceFormat = 'csv.gz' }) {
  if (sourceFormat !== 'csv.gz') fail('Parquet parsing is not bundled; use the hash-pinned CSV.gz fallback with --format csv.gz')
  const identity = identityFromGames(gamesPath)
  const sourceRecords = csvRecords(pbpPath, SCHEMA_FIELDS)
  const selected = filterPlays(sourceRecords)
  if (sourceRecords.filter(({ record }) => record.game_id === GAME_ID).length !== 193) fail('game PBP row count mismatch: expected 193')
  const rows = selected.map(({ record }) => mapPlay(record))
  const evaluation = buildEvaluation(rows)
  const fixture = { manifest: { ...manifestFor({ pbpPath, gamesPath, sourceFormat }), identity }, rows, evaluation }
  validateFixture(fixture)
  return fixture
}

function parseArgs(argv) {
  const args = Object.fromEntries(argv.flatMap((value, index) => value.startsWith('--') ? [[value.slice(2), argv[index + 1] ?? true]] : []))
  return args
}

const args = parseArgs(process.argv.slice(2))
if (import.meta.url === `file://${process.argv[1]}`) {
  const fixturePath = path.resolve(args.fixture ?? 'src/fixtures/data/seahawks-super-bowl-2026.json')
  if (args.validate) {
    validateFixture(JSON.parse(fs.readFileSync(fixturePath, 'utf8')))
    console.log(`validated ${fixturePath}`)
  } else {
    if (!args.pbp || !args.games || !args.out) fail('usage: node scripts/generate-football-fixture.mjs --pbp <csv.gz> --games <games.csv> --out <fixture.json>')
    const fixture = generateFixture({ pbpPath: args.pbp, gamesPath: args.games, sourceFormat: args.format ?? 'csv.gz' })
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true })
    fs.writeFileSync(path.resolve(args.out), `${JSON.stringify(fixture, null, 2)}\n`)
    console.log(`generated ${fixture.rows.length} rows at ${path.resolve(args.out)}`)
  }
}
