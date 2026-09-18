import { createHmac, randomBytes } from 'node:crypto'
import Sqids, { defaultOptions } from 'sqids'
import { DatasetError } from '../dataset/csvTypes.js'

export interface StoredCsvBlob {
  blobKey: string
  byteSize: number
}

export interface CsvBlobStore {
  isConfigured(): boolean
  putCsv(input: { bytes: Uint8Array; filename: string; contentType?: string }): Promise<StoredCsvBlob>
  getCsv(blobKey: string): Promise<Uint8Array>
}

export interface UploadThingCredentials {
  apiKey: string
  appId?: string
  regions?: readonly string[]
  ingestHost?: string
}

const NOT_CONFIGURED_COPY = 'CSV storage is not configured on this deployment.'
const V7_TOKEN_REQUIRED_COPY = 'UploadThing v7 needs a dashboard API token with app id and region. The v6 uploadFiles API is no longer supported.'

const notConfigured = (): never => {
  throw new DatasetError('UPLOADTHING_NOT_CONFIGURED', NOT_CONFIGURED_COPY, 503)
}

export class UnconfiguredBlobStore implements CsvBlobStore {
  isConfigured(): boolean {
    return false
  }

  putCsv(): Promise<StoredCsvBlob> {
    return notConfigured()
  }

  getCsv(): Promise<Uint8Array> {
    return notConfigured()
  }
}

export class InMemoryBlobStore implements CsvBlobStore {
  private readonly blobs = new Map<string, Uint8Array>()
  private sequence = 0

  isConfigured(): boolean {
    return true
  }

  async putCsv(input: { bytes: Uint8Array; filename: string }): Promise<StoredCsvBlob> {
    const blobKey = `memory:${++this.sequence}:${input.filename.replace(/[^a-zA-Z0-9._-]+/g, '_')}`
    this.blobs.set(blobKey, Uint8Array.from(input.bytes))
    return { blobKey, byteSize: input.bytes.byteLength }
  }

  async getCsv(blobKey: string): Promise<Uint8Array> {
    const bytes = this.blobs.get(blobKey)
    if (!bytes) throw new DatasetError('DATASET_NOT_FOUND', 'CSV blob was not found', 404)
    return Uint8Array.from(bytes)
  }
}

const UPLOADTHING_ENV_KEYS = ['UPLOADTHING_TOKEN', 'UPLOADTHING_SECRET'] as const
const UPLOADTHING_LIST_FILES_URL = 'https://api.uploadthing.com/v6/listFiles'
const DEFAULT_INGEST_HOST = 'ingest.uploadthing.com'
const API_KEY_PREFIX = 'sk_'
const SIGNATURE_PREFIX = 'hmac-sha256='
const SAFE_PROVIDER_ERROR = /^[A-Za-z0-9][A-Za-z0-9 .,_':()-]{0,160}$/

const envValue = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  // Bracket access so Vercel/esbuild cannot replace process.env.UPLOADTHING_* at
  // build time with undefined and freeze BYOD closed while status still reads live env.
  const value = env[name]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

const stripWrappingQuotes = (raw: string): string => {
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1).trim()
  }
  return raw
}

const normalizeSecret = (raw: string): string => {
  let value = raw.replace(/^\uFEFF/, '').trim()
  value = stripWrappingQuotes(value)
  if (/^bearer\s+/i.test(value)) value = value.replace(/^bearer\s+/i, '').trim()
  return value
}

const isApiKey = (value: string | undefined): value is string => (
  typeof value === 'string' && value.startsWith(API_KEY_PREFIX) && value.length > API_KEY_PREFIX.length
)

const decodeBase64Json = (raw: string): Record<string, unknown> | undefined => {
  const normalized = raw.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + (4 - (normalized.length % 4 || 4)) % 4, '=')
  try {
    const parsed: unknown = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
  return undefined
}

const parseJsonObject = (raw: string): Record<string, unknown> | undefined => {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{')) return undefined
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
  return undefined
}

const apiKeyFromRecord = (record: Record<string, unknown> | undefined): string | undefined => {
  if (!record) return undefined
  for (const key of ['apiKey', 'api_key', 'secret', 'key', 'uploadthingSecret']) {
    const value = record[key]
    if (isApiKey(typeof value === 'string' ? value.trim() : undefined)) return (value as string).trim()
  }
  return undefined
}

const stringField = (record: Record<string, unknown>, ...keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

const regionsFromRecord = (record: Record<string, unknown>): string[] | undefined => {
  if (Array.isArray(record.regions)) {
    const regions = record.regions.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())).map((entry) => entry.trim())
    return regions.length > 0 ? regions : undefined
  }
  const single = stringField(record, 'region')
  return single ? [single] : undefined
}

const credentialsFromRecord = (record: Record<string, unknown> | undefined): UploadThingCredentials | undefined => {
  const apiKey = apiKeyFromRecord(record)
  if (!apiKey || !record) return undefined
  const appId = stringField(record, 'appId', 'app_id')
  const regions = regionsFromRecord(record)
  const ingestHost = stringField(record, 'ingestHost', 'ingest_host')
  return {
    apiKey,
    ...(appId ? { appId } : {}),
    ...(regions ? { regions } : {}),
    ...(ingestHost ? { ingestHost } : {}),
  }
}

const credentialsFromEncoded = (raw: string): UploadThingCredentials | undefined => {
  const fromJson = credentialsFromRecord(parseJsonObject(raw)) ?? credentialsFromRecord(decodeBase64Json(raw))
  if (fromJson) return fromJson
  const parts = raw.split('.')
  if (parts.length >= 2 && parts[1]) return credentialsFromRecord(decodeBase64Json(parts[1]))
  return undefined
}

/**
 * Credential the upload/fetch path will send. Status must use this same reader
 * so `uploadThing: true` cannot diverge from `createCsvBlobStore()`.
 *
 * Accepts `UPLOADTHING_TOKEN` (raw sk_ key or UploadThing's v7 dashboard token)
 * or `UPLOADTHING_SECRET`. Encoded tokens keep apiKey, appId, and regions.
 * Empty or invalid-format values are treated as missing — never as configured.
 *
 * A raw sk_ key is enough to report configured, but server-side upload requires
 * the v7 dashboard token (apiKey + appId + regions). v6 uploadFiles is retired.
 */
export const readUploadThingCredentials = (env: NodeJS.ProcessEnv = process.env): UploadThingCredentials | undefined => {
  for (const name of UPLOADTHING_ENV_KEYS) {
    const raw = envValue(env, name)
    if (!raw) continue
    const normalized = normalizeSecret(raw)
    if (!normalized) continue
    if (isApiKey(normalized)) return { apiKey: normalized }
    const extracted = credentialsFromEncoded(normalized)
    if (extracted) return extracted
  }
  return undefined
}

export const readUploadThingToken = (env: NodeJS.ProcessEnv = process.env): string | undefined => (
  readUploadThingCredentials(env)?.apiKey
)

export const isUploadThingConfigured = (env: NodeJS.ProcessEnv = process.env): boolean => Boolean(readUploadThingToken(env))

const csvFilename = (filename: string): string => (filename.endsWith('.csv') ? filename : `${filename}.csv`)

const asRecord = (value: unknown): Record<string, unknown> | undefined => (
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
)

const readSafeProviderError = (payload: unknown): string | undefined => {
  const candidates: unknown[] = [payload]
  const record = asRecord(payload)
  if (record) {
    candidates.push(record.error, record.message, record.code)
    const nested = asRecord(record.error)
    if (nested) candidates.push(nested.message, nested.code, nested.error)
  }
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const text = candidate.trim()
    if (!SAFE_PROVIDER_ERROR.test(text)) continue
    if (/sk_|bearer\s|UPLOADTHING_/i.test(text)) continue
    return text
  }
  return undefined
}

const uploadFailed = (reason: string, statusCode = 503): never => {
  throw new DatasetError('UPLOADTHING_FAILED', reason, statusCode)
}

const failureFromResponse = async (response: Response, action: string): Promise<never> => {
  let payload: unknown
  try { payload = await response.json() } catch { payload = undefined }
  const provider = readSafeProviderError(payload)
  if (response.status === 401 || response.status === 403) {
    return uploadFailed(
      provider
        ? `UploadThing rejected the API key (HTTP ${response.status}): ${provider}`
        : `UploadThing rejected the API key (HTTP ${response.status}).`,
    )
  }
  return uploadFailed(
    provider
      ? `UploadThing ${action} failed (HTTP ${response.status}): ${provider}`
      : `UploadThing ${action} failed (HTTP ${response.status}).`,
  )
}

/** Effect Hash.string + optimize — must match @uploadthing/shared file-key prefixes. */
const hashString = (value: string): number => {
  let hash = 5381
  let index = value.length
  while (index) {
    hash = hash * 33 ^ value.charCodeAt(--index)
  }
  return (hash & 0xbfffffff) | ((hash >>> 1) & 0x40000000)
}

const shuffleAlphabet = (alphabet: string, seed: string): string => {
  const chars = alphabet.split('')
  const seedNum = hashString(seed)
  for (let i = 0; i < chars.length; i++) {
    const j = ((seedNum % (i + 1)) + i) % chars.length
    const temp = chars[i]!
    chars[i] = chars[j]!
    chars[j] = temp
  }
  return chars.join('')
}

export const uploadThingAppIdPrefix = (appId: string): string => {
  const alphabet = shuffleAlphabet(defaultOptions.alphabet, appId)
  return new Sqids({ alphabet, minLength: 12 }).encode([Math.abs(hashString(appId))])
}

const generateFileKey = (appId: string, file: { name: string; size: number; type: string; lastModified: number }): string => {
  const alphabet = shuffleAlphabet(defaultOptions.alphabet, appId)
  const hashParts = JSON.stringify([file.name, file.size, file.type, file.lastModified, Date.now(), randomBytes(8).toString('hex')])
  const encodedFileSeed = new Sqids({ alphabet, minLength: 36 }).encode([Math.abs(hashString(hashParts))])
  return `${uploadThingAppIdPrefix(appId)}${encodedFileSeed}`
}

const canSignIngest = (credentials: UploadThingCredentials): credentials is UploadThingCredentials & { appId: string; regions: readonly [string, ...string[]] } => (
  Boolean(credentials.appId && credentials.regions && credentials.regions.length > 0)
)

/**
 * v7 server-side upload: locally HMAC-sign an ingest URL (UTApi.uploadFiles).
 * Matches @uploadthing/shared generateSignedURL, including encode-then-append.
 */
export const signedIngestUrl = (input: {
  apiKey: string
  appId: string
  region: string
  ingestHost?: string
  fileKey: string
  filename: string
  byteSize: number
  contentType: string
  expiresAtMs: number
  acl?: 'public-read' | 'private'
}): string => {
  const ingestHost = input.ingestHost || DEFAULT_INGEST_HOST
  const url = new URL(`https://${input.region}.${ingestHost}/${input.fileKey}`)
  url.searchParams.append('expires', String(input.expiresAtMs))
  const data: Record<string, string | number> = {
    'x-ut-identifier': input.appId,
    'x-ut-file-name': input.filename,
    'x-ut-file-size': input.byteSize,
    'x-ut-file-type': input.contentType,
    'x-ut-content-disposition': 'inline',
    'x-ut-acl': input.acl ?? 'public-read',
  }
  for (const [key, value] of Object.entries(data)) {
    url.searchParams.append(key, encodeURIComponent(value))
  }
  const signature = `${SIGNATURE_PREFIX}${createHmac('sha256', input.apiKey).update(url.toString()).digest('hex')}`
  url.searchParams.append('signature', signature)
  return url.href
}

/**
 * Server-only UploadThing adapter. The browser never sees the token.
 * Credentials are read lazily from env so a module-load snapshot cannot
 * ignore a token that `/api/datasets/status` would report as present.
 *
 * Uploads follow the v7 UTApi path: sign an ingest URL with the dashboard
 * token and PUT the CSV. Do not call retired `/v6/uploadFiles`.
 */
export class UploadThingBlobStore implements CsvBlobStore {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private credentials(): UploadThingCredentials | undefined {
    return readUploadThingCredentials(this.env)
  }

  isConfigured(): boolean {
    return Boolean(this.credentials()?.apiKey)
  }

  async putCsv(input: { bytes: Uint8Array; filename: string; contentType?: string }): Promise<StoredCsvBlob> {
    const credentials = this.credentials()
    if (!credentials) return notConfigured()
    if (!canSignIngest(credentials)) return uploadFailed(V7_TOKEN_REQUIRED_COPY)

    const filename = csvFilename(input.filename)
    const contentType = input.contentType ?? 'text/csv'
    const bytes = Uint8Array.from(input.bytes)
    const lastModified = this.now()
    const fileKey = generateFileKey(credentials.appId, {
      name: filename,
      size: bytes.byteLength,
      type: contentType,
      lastModified,
    })
    const uploadUrl = signedIngestUrl({
      apiKey: credentials.apiKey,
      appId: credentials.appId,
      region: credentials.regions[0],
      ingestHost: credentials.ingestHost,
      fileKey,
      filename,
      byteSize: bytes.byteLength,
      contentType,
      expiresAtMs: lastModified + 60 * 60 * 1000,
    })
    const form = new FormData()
    form.append('file', new File([bytes], filename, { type: contentType }))
    const uploaded = await this.fetcher(uploadUrl, {
      method: 'PUT',
      headers: { Range: 'bytes=0-' },
      body: form,
    })
    if (!uploaded.ok) return failureFromResponse(uploaded, 'ingest upload')
    return { blobKey: fileKey, byteSize: bytes.byteLength }
  }

  async getCsv(blobKey: string): Promise<Uint8Array> {
    const credentials = this.credentials()
    if (!credentials) return notConfigured()
    const response = await this.fetcher(UPLOADTHING_LIST_FILES_URL, {
      method: 'POST',
      headers: { 'x-uploadthing-api-key': credentials.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ fileKeys: [blobKey] }),
    })
    if (!response.ok) throw new DatasetError('DATASET_NOT_FOUND', 'CSV blob was not found', 404)
    throw new DatasetError('DATASET_NOT_FOUND', 'CSV blob was not found', 404)
  }
}

export const createCsvBlobStore = (env: NodeJS.ProcessEnv = process.env): CsvBlobStore => new UploadThingBlobStore(env)
