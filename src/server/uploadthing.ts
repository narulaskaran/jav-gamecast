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

const NOT_CONFIGURED_COPY = 'CSV storage is not configured on this deployment.'

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
const UPLOADTHING_UPLOAD_FILES_URL = 'https://api.uploadthing.com/v6/uploadFiles'
const UPLOADTHING_LIST_FILES_URL = 'https://api.uploadthing.com/v6/listFiles'
const API_KEY_PREFIX = 'sk_'
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

const credentialFromEncoded = (raw: string): string | undefined => {
  const fromJson = apiKeyFromRecord(parseJsonObject(raw)) ?? apiKeyFromRecord(decodeBase64Json(raw))
  if (fromJson) return fromJson
  const parts = raw.split('.')
  if (parts.length >= 2 && parts[1]) return apiKeyFromRecord(decodeBase64Json(parts[1]))
  return undefined
}

/**
 * Credential the upload/fetch path will send. Status must use this same reader
 * so `uploadThing: true` cannot diverge from `createCsvBlobStore()`.
 *
 * Accepts `UPLOADTHING_TOKEN` (raw sk_ key or UploadThing's base64/JWT token)
 * or `UPLOADTHING_SECRET`. Encoded tokens are reduced to the inner API key.
 * Empty or invalid-format values are treated as missing — never as configured.
 */
export const readUploadThingToken = (env: NodeJS.ProcessEnv = process.env): string | undefined => {
  for (const name of UPLOADTHING_ENV_KEYS) {
    const raw = envValue(env, name)
    if (!raw) continue
    const normalized = normalizeSecret(raw)
    if (!normalized) continue
    if (isApiKey(normalized)) return normalized
    const extracted = credentialFromEncoded(normalized)
    if (extracted) return extracted
  }
  return undefined
}

export const isUploadThingConfigured = (env: NodeJS.ProcessEnv = process.env): boolean => Boolean(readUploadThingToken(env))

const csvFilename = (filename: string): string => (filename.endsWith('.csv') ? filename : `${filename}.csv`)

const asRecord = (value: unknown): Record<string, unknown> | undefined => (
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
)

const firstOf = (value: unknown): Record<string, unknown> | undefined => (
  Array.isArray(value) ? asRecord(value[0]) : undefined
)

const looksLikeFileRecord = (record: Record<string, unknown> | undefined): record is Record<string, unknown> => (
  Boolean(record && (typeof record.key === 'string' || typeof record.fileKey === 'string' || typeof record.url === 'string' || asRecord(record.fields)))
)

const firstFileRecord = (payload: unknown): Record<string, unknown> | undefined => {
  const record = asRecord(payload)
  if (!record) return undefined
  const nested = asRecord(record.data)
  return firstOf(record.data)
    ?? firstOf(nested?.files)
    ?? firstOf(record.files)
    ?? (looksLikeFileRecord(nested) ? nested : undefined)
    ?? (looksLikeFileRecord(record) ? record : undefined)
}

const readBlobKey = (payload: unknown): string | undefined => {
  const file = firstFileRecord(payload)
  if (!file) return undefined
  if (typeof file.key === 'string' && file.key.trim()) return file.key.trim()
  if (typeof file.fileKey === 'string' && file.fileKey.trim()) return file.fileKey.trim()
  return undefined
}

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

const isCdnFileUrl = (value: string): boolean => {
  try {
    const host = new URL(value).hostname.toLowerCase()
    return host === 'utfs.io' || host.endsWith('.utfs.io') || host === 'ufs.sh' || host.endsWith('.ufs.sh')
  } catch {
    return false
  }
}

const readStringFields = (value: unknown): Record<string, string> | undefined => {
  const record = asRecord(value)
  if (!record) return undefined
  const fields: Record<string, string> = {}
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === 'string') fields[key] = entry
  }
  return Object.keys(fields).length > 0 ? fields : undefined
}

interface UploadThingPresign {
  key?: string
  uploadUrl?: string
  fields?: Record<string, string>
}

const readPresign = (payload: unknown): UploadThingPresign => {
  const file = firstFileRecord(payload)
  const key = readBlobKey(payload)
  if (!file) return { key }
  const fields = readStringFields(file.fields)
  const candidates = [file.uploadUrl, file.presignedUrl, file.url]
  const uploadUrl = candidates.find((value): value is string => typeof value === 'string' && isHttpUrl(value.trim()) && !isCdnFileUrl(value.trim()))
    ?.trim()
  return { key, uploadUrl, fields }
}

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

/**
 * Server-only UploadThing adapter. The browser never sees the token.
 * Credentials are read lazily from env so a module-load snapshot cannot
 * ignore a token that `/api/datasets/status` would report as present.
 */
export class UploadThingBlobStore implements CsvBlobStore {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private token(): string | undefined {
    return readUploadThingToken(this.env)
  }

  isConfigured(): boolean {
    return Boolean(this.token())
  }

  async putCsv(input: { bytes: Uint8Array; filename: string; contentType?: string }): Promise<StoredCsvBlob> {
    const token = this.token()
    if (!token) return notConfigured()
    const filename = csvFilename(input.filename)
    const contentType = input.contentType ?? 'text/csv'
    const bytes = Uint8Array.from(input.bytes)
    const response = await this.fetcher(UPLOADTHING_UPLOAD_FILES_URL, {
      method: 'POST',
      headers: {
        'x-uploadthing-api-key': token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        files: [{ name: filename, size: bytes.byteLength, type: contentType }],
        metadata: {},
        contentDisposition: 'inline',
        acl: 'public-read',
      }),
    })
    if (!response.ok) return failureFromResponse(response, 'uploadFiles')
    let payload: unknown
    try { payload = await response.json() } catch {
      return uploadFailed('UploadThing returned a non-JSON uploadFiles response.')
    }
    const presign = readPresign(payload)
    if (presign.fields && presign.uploadUrl) {
      const form = new FormData()
      for (const [key, value] of Object.entries(presign.fields)) form.append(key, value)
      form.append('file', new Blob([bytes], { type: contentType }), filename)
      const uploaded = await this.fetcher(presign.uploadUrl, { method: 'POST', body: form })
      if (!uploaded.ok) return failureFromResponse(uploaded, 'blob upload')
    } else if (presign.uploadUrl) {
      const uploaded = await this.fetcher(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': contentType },
        body: new Blob([bytes], { type: contentType }),
      })
      if (!uploaded.ok) return failureFromResponse(uploaded, 'blob upload')
    }
    if (!presign.key) {
      return uploadFailed('UploadThing returned an unexpected uploadFiles response (missing file key).')
    }
    return { blobKey: presign.key, byteSize: bytes.byteLength }
  }

  async getCsv(blobKey: string): Promise<Uint8Array> {
    const token = this.token()
    if (!token) return notConfigured()
    const response = await this.fetcher(UPLOADTHING_LIST_FILES_URL, {
      method: 'POST',
      headers: { 'x-uploadthing-api-key': token, 'content-type': 'application/json' },
      body: JSON.stringify({ fileKeys: [blobKey] }),
    })
    if (!response.ok) throw new DatasetError('DATASET_NOT_FOUND', 'CSV blob was not found', 404)
    throw new DatasetError('DATASET_NOT_FOUND', 'CSV blob was not found', 404)
  }
}

export const createCsvBlobStore = (env: NodeJS.ProcessEnv = process.env): CsvBlobStore => new UploadThingBlobStore(env)
