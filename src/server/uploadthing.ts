import { DatasetError } from '../dataset/csvTypes'

export interface StoredCsvBlob {
  blobKey: string
  byteSize: number
}

export interface CsvBlobStore {
  isConfigured(): boolean
  putCsv(input: { bytes: Uint8Array; filename: string; contentType?: string }): Promise<StoredCsvBlob>
  getCsv(blobKey: string): Promise<Uint8Array>
}

export class UnconfiguredBlobStore implements CsvBlobStore {
  isConfigured(): boolean {
    return false
  }

  putCsv(): Promise<StoredCsvBlob> {
    throw new DatasetError('UPLOADTHING_NOT_CONFIGURED', 'CSV storage is not configured on this deployment.', 503)
  }

  getCsv(): Promise<Uint8Array> {
    throw new DatasetError('UPLOADTHING_NOT_CONFIGURED', 'CSV storage is not configured on this deployment.', 503)
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

const uploadthingToken = (env: NodeJS.ProcessEnv = process.env): string | undefined => {
  const token = env.UPLOADTHING_TOKEN?.trim() || env.UPLOADTHING_SECRET?.trim()
  return token || undefined
}

export const isUploadThingConfigured = (env: NodeJS.ProcessEnv = process.env): boolean => Boolean(uploadthingToken(env))

/**
 * Server-only UploadThing adapter. The browser never sees the token.
 * Missing credentials fail closed rather than inventing a local blob.
 */
export class UploadThingBlobStore implements CsvBlobStore {
  constructor(
    private readonly token = uploadthingToken(),
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.token)
  }

  async putCsv(input: { bytes: Uint8Array; filename: string; contentType?: string }): Promise<StoredCsvBlob> {
    if (!this.token) throw new DatasetError('UPLOADTHING_NOT_CONFIGURED', 'CSV storage is not configured on this deployment.', 503)
    const file = new File([Uint8Array.from(input.bytes)], input.filename.endsWith('.csv') ? input.filename : `${input.filename}.csv`, { type: input.contentType ?? 'text/csv' })
    const body = new FormData()
    body.set('files', file)
    const response = await this.fetcher('https://api.uploadthing.com/v6/uploadFiles', {
      method: 'POST',
      headers: { 'x-uploadthing-api-key': this.token },
      body,
    })
    if (!response.ok) throw new DatasetError('UPLOADTHING_NOT_CONFIGURED', 'CSV storage is not configured on this deployment.', 503)
    let payload: unknown
    try { payload = await response.json() } catch { throw new DatasetError('UPLOADTHING_NOT_CONFIGURED', 'CSV storage is not configured on this deployment.', 503) }
    const key = readBlobKey(payload)
    if (!key) throw new DatasetError('UPLOADTHING_NOT_CONFIGURED', 'CSV storage is not configured on this deployment.', 503)
    return { blobKey: key, byteSize: input.bytes.byteLength }
  }

  async getCsv(blobKey: string): Promise<Uint8Array> {
    if (!this.token) throw new DatasetError('UPLOADTHING_NOT_CONFIGURED', 'CSV storage is not configured on this deployment.', 503)
    const response = await this.fetcher(`https://api.uploadthing.com/v6/listFiles`, {
      method: 'POST',
      headers: { 'x-uploadthing-api-key': this.token, 'content-type': 'application/json' },
      body: JSON.stringify({ fileKeys: [blobKey] }),
    })
    if (!response.ok) throw new DatasetError('DATASET_NOT_FOUND', 'CSV blob was not found', 404)
    throw new DatasetError('DATASET_NOT_FOUND', 'CSV blob was not found', 404)
  }
}

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

export const createCsvBlobStore = (env: NodeJS.ProcessEnv = process.env): CsvBlobStore => (
  isUploadThingConfigured(env) ? new UploadThingBlobStore(uploadthingToken(env)) : new UnconfiguredBlobStore()
)
