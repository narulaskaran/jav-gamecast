import { DatasetError } from './csvTypes.js'

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.',
  'metadata.google.internal',
  'metadata.google.internal.',
  'metadata',
  'instance-data',
])

const ipv4ToInt = (value: string): number | undefined => {
  const parts = value.split('.')
  if (parts.length !== 4) return undefined
  const nums = parts.map((part) => Number(part))
  if (nums.some((num) => !Number.isInteger(num) || num < 0 || num > 255)) return undefined
  return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0
}

const ipv4InRange = (ip: number, prefix: number, bits: number): boolean => {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return (ip & mask) === (prefix & mask)
}

const isPrivateIPv4 = (hostname: string): boolean => {
  const ip = ipv4ToInt(hostname)
  if (ip === undefined) return false
  return (
    ipv4InRange(ip, ipv4ToInt('0.0.0.0')!, 8)
    || ipv4InRange(ip, ipv4ToInt('10.0.0.0')!, 8)
    || ipv4InRange(ip, ipv4ToInt('100.64.0.0')!, 10)
    || ipv4InRange(ip, ipv4ToInt('127.0.0.0')!, 8)
    || ipv4InRange(ip, ipv4ToInt('169.254.0.0')!, 16)
    || ipv4InRange(ip, ipv4ToInt('172.16.0.0')!, 12)
    || ipv4InRange(ip, ipv4ToInt('192.168.0.0')!, 16)
    || ipv4InRange(ip, ipv4ToInt('198.18.0.0')!, 15)
    || ipv4InRange(ip, ipv4ToInt('224.0.0.0')!, 4)
    || ipv4InRange(ip, ipv4ToInt('255.255.255.255')!, 32)
  )
}

const isPrivateIPv6 = (hostname: string): boolean => {
  const value = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!value.includes(':')) return false
  return (
    value === '::' || value === '::1'
    || value.startsWith('fc') || value.startsWith('fd')
    || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')
    || value.startsWith('ff')
    || value.startsWith('::ffff:') && isPrivateIPv4(value.slice('::ffff:'.length))
  )
}

const isBlockedHostname = (hostname: string): boolean => {
  const host = hostname.replace(/\.$/, '').toLowerCase()
  if (BLOCKED_HOSTS.has(host)) return true
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.arpa')) return true
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) return true
  return false
}

export const assertPublicHttpsCsvUrl = (value: string): URL => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new DatasetError('URL_NOT_PUBLIC', 'Enter a public HTTPS CSV URL first.')
  }
  if (value.trim().length < 12 || value.length > 2_048) {
    throw new DatasetError('URL_NOT_PUBLIC', 'The URL is not a public HTTPS CSV link.')
  }
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new DatasetError('URL_NOT_PUBLIC', 'The URL is not a public HTTPS CSV link.')
  }
  if (parsed.protocol !== 'https:') throw new DatasetError('URL_NOT_HTTPS', 'Use an HTTPS CSV URL.')
  if (parsed.username || parsed.password) throw new DatasetError('URL_NOT_PUBLIC', 'The URL is not a public HTTPS CSV link.')
  if (!parsed.hostname || isBlockedHostname(parsed.hostname)) throw new DatasetError('URL_UNSAFE', 'That URL is not a public CSV link.')
  if (parsed.port && parsed.port !== '443') {
    const port = Number(parsed.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 80) {
      throw new DatasetError('URL_UNSAFE', 'That URL is not a public CSV link.')
    }
  }
  return parsed
}

export const isResolvedAddressSafe = (address: string): boolean => !isBlockedHostname(address) && !isPrivateIPv4(address) && !isPrivateIPv6(address)
