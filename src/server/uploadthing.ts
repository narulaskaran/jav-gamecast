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

const notConfigured = (): never => {
  throw new DatasetError('UPLOADTHING_NOT_CONFIGURED', 'CSV storage is not configured on this deployment.', 503)
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

const envValue = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  // Bracket access so Vercel/esbuild cannot replace process.env.UPLOADTHING_* at
  // build time with undefined and freeze BYOD closed while status still reads live env.
  const value = env[name]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

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

const apiKeyFromRecord = (record: Record<string, unknown> | undefined): string | undefined => {
  if (!record) return undefined
  for (const key of ['apiKey', 'api_key', 'secret', 'key']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

/**
 * Credential the upload/fetch path will send. Status must use this same reader
 * so `uploadThing: true` cannot diverge from `createCsvBlobStore()`.
 *
 * Accepts `UPLOADTHING_TOKEN` (raw sk_ key or UploadThing's base64/JWT token)
 * or `UPLOADTHING_SECRET`. Encoded tokens are reduced to the inner API key
 * when present; otherwise the trimmed raw value is used.
 */
export const readUploadThingToken = (env: NodeJS.ProcessEnv = process.env): string | undefined => {
  for (const name of UPLOADTHING_ENV_KEYS) {
    const raw = envValue(env, name)
    if (!raw) continue
    if (raw.startsWith('sk_')) return raw
    const fromJson = apiKeyFromRecord(decodeBase64Json(raw))
    if (fromJson) return fromJson
    const jwtPayload = raw.split('.')[1]
    const fromJwt = jwtPayload ? apiKeyFromRecord(decodeBase64Json(jwtPayload)) : undefined
    if (fromJwt) return fromJwt
    return raw
  }
  return undefined
}

export const isUploadThingConfigured = (env: NodeJS.ProcessEnv = process.env): boolean => Boolean(readUploadThingToken(env))

const csvFilename = (filename: string): string => (filename.endsWith('.csv') ? filename : `${filename}.csv`)

const readBlobKey = (payload: unknown): string | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined
  const record = payload as Record<string, unknown>
  const data = Array.isArray(record.data) ? record.data[0] : Array.isArray(record.files) ? record.files[0] : record
  if (typeof data !== 'object' || data === null) return undefined
  const file = data as Record<string, unknown>
  if (typeof file.key === 'string' && file.key.trim()) return file.key.trim()
  if (typeof file.fileKey === 'string' && file.fileKey.trim()) return file.fileKey.trim()
  if (typeof file.url === 'string' && file.url.trim()) return file.url.trim()
  return undefined
}

const readUploadUrl = (payload: unknown): string | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined
  const record = payload as Record<string, unknown>
  const data = Array.isArray(record.data) ? record.data[0] : Array.isArray(record.files) ? record.files[0] : record
  if (typeof data !== 'object' || data === null) return undefined
  const file = data as Record<string, unknown>
  if (typeof file.url === 'string' && file.url.trim().startsWith('http')) return file.url.trim()
  if (typeof file.uploadUrl === 'string' && file.uploadUrl.trim().startsWith('http')) return file.uploadUrl.trim()
  if (typeof file.presignedUrl === 'string' && file.presignedUrl.trim().startsWith('http')) return file.presignedUrl.trim()
  return undefined
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
    const response = await this.fetcher('https://api.uploadthing.com/v6/uploadFiles', {
      method: 'POST',
      headers: {
        'x-uploadthing-api-key': token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        files: [{ name: filename, size: input.bytes.byteLength, type: contentType }],
      }),
    })
    if (!response.ok) {
      throw new DatasetError('DATASET_INTAKE_UNAVAILABLE', 'CSV intake is not configured on this deployment.', 503)
    }
    let payload: unknown
    try { payload = await response.json() } catch {
      throw new DatasetError('DATASET_INTAKE_UNAVAILABLE', 'CSV intake is not configured on this deployment.', 503)
    }
    const uploadUrl = readUploadUrl(payload)
    if (uploadUrl) {
      const uploaded = await this.fetcher(uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': contentType },
        body: new Blob([Uint8Array.from(input.bytes)], { type: contentType }),
      })
      if (!uploaded.ok) {
        throw new DatasetError('DATASET_INTAKE_UNAVAILABLE', 'CSV intake is not configured on this deployment.', 503)
      }
    }
    const key = readBlobKey(payload)
    if (!key) {
      throw new DatasetError('DATASET_INTAKE_UNAVAILABLE', 'CSV intake is not configured on this deployment.', 503)
    }
    return { blobKey: key, byteSize: input.bytes.byteLength }
  }

  async getCsv(blobKey: string): Promise<Uint8Array> {
    const token = this.token()
    if (!token) return notConfigured()
    const response = await this.fetcher('https://api.uploadthing.com/v6/listFiles', {
      method: 'POST',
      headers: { 'x-uploadthing-api-key': token, 'content-type': 'application/json' },
      body: JSON.stringify({ fileKeys: [blobKey] }),
    })
    if (!response.ok) throw new DatasetError('DATASET_NOT_FOUND', 'CSV blob was not found', 404)
    throw new DatasetError('DATASET_NOT_FOUND', 'CSV blob was not found', 404)
  }
}

export const createCsvBlobStore = (env: NodeJS.ProcessEnv = process.env): CsvBlobStore => new UploadThingBlobStore(env)
